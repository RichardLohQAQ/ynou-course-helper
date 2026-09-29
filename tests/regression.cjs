const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const L=require('../extension/logic.js');
const courseUrl='https://teach.ynou.edu.cn/eduCourseBaseinfo/courseinfo.action?courseId=course-a&classId=class-a';
test('未学不能误判为已学',()=>{for(const s of ['未学','未完成','学习中','00:01:00 / 00:04:00 未学'])assert.equal(L.completed(s),false);assert.equal(L.completed('00:04:00 / 00:04:00 已学'),true);});
test('科目满额优先于目录完成数量，零要求也视为满额',()=>{assert.equal(L.quota('40/40').full,true);assert.equal(L.quota('39/40').full,false);assert.equal(L.quota('41/40').full,true);assert.equal(L.quota('0/0').full,true);assert.equal(L.quota('0'),null);});
test('统一扫描含无视频要求科目时，可继续后面的未达标科目',()=>{assert.deepEqual(L.plan([{progress:L.quota('0/0')},{progress:L.quota('2/40')}]),{ready:true,next:1});assert.deepEqual(L.plan([{progress:L.quota('0/0')}]),{ready:true,next:-1});});
test('视频按页面顺序，不按讲数排序',()=>assert.deepEqual([{title:'第10讲',index:0},{title:'第2讲',index:2},{title:'第1讲',index:1}].sort(L.order).map(x=>x.title),['第10讲','第1讲','第2讲']));
test('只识别视频入口，不识别作业文档',()=>{assert.equal(L.resource("viewRes('123','mp4','课',1,this)"),'123');assert.equal(L.resource("viewRes('123','doc','课',1,this)"),null);});
test('网站限制',()=>{assert.equal(L.trusted('https://teach.ynou.edu.cn:443/play/playVideo.action'),true);assert.equal(L.trusted('https://teach.ynou.edu.cn.evil.test/'),false);});
function harness(existingVideos=[]){
 let state={},local={},listener,removed,alarm,alarmListener;
 const videoUrl='https://teach.ynou.edu.cn/play/playVideo.action?ksId=abc&courseId=course-a&classId=class-a';
 const tabs=new Map([[1,{id:1,url:'https://teach.ynou.edu.cn/webindex.action'}],[2,{id:2,openerTabId:1,url:videoUrl}],[3,{id:3,openerTabId:9,url:videoUrl}]]);
 const closed=[],messages=[],live=[tabs.get(1),...existingVideos],clock={now:Date.now()},behavior={failClose:false};
 const chrome={storage:{local:{get:async()=>structuredClone(local),set:async s=>{Object.assign(local,structuredClone(s));}},session:{get:async()=>structuredClone(state),set:async s=>{state=structuredClone(s);}}},runtime:{getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>listener=f}},tabs:{query:async()=>live,get:async id=>tabs.get(id),remove:async id=>{if(behavior.failClose)throw Error('测试关闭失败');closed.push(id);},sendMessage:async(id,m)=>{if(m.type==='PING')return {ready:true,version:behavior.pageVersion||'1.6.1',userKey:'测试账号'};messages.push([id,m]);},onRemoved:{addListener:f=>removed=f}}};
 const baseQuery=chrome.tabs.query;
 chrome.tabs.query=async options=>{if(behavior.queryFails)throw Error('无法读取窗口列表');return baseQuery(options);};
 const baseMessage=chrome.tabs.sendMessage;
 chrome.tabs.sendMessage=async(id,m)=>{if(behavior.unresponsive===id&&m.type==='PING')throw Error('页面没有响应');return baseMessage(id,m);};
 chrome.alarms={get:async()=>alarm,create:async(name,options)=>{alarm={name,...options};},clear:async()=>{alarm=undefined;return true;},onAlarm:{addListener:fn=>alarmListener=fn}};
 const workerTimers=require('./background-timers.cjs')(clock);
 vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),{chrome,CourseLogic:L,importScripts:()=>{},Date:{now:()=>clock.now},URL,setTimeout:workerTimers.setTimeout,clearTimeout:workerTimers.clearTimeout});
 return{call:(m,s)=>new Promise(r=>listener(m,s,r)),popup:{url:'chrome-extension://test/popup.html'},main:{tab:{id:1},url:tabs.get(1).url},video:{tab:{id:2},url:tabs.get(2).url},other:{tab:{id:3},url:tabs.get(3).url},closed,messages,tabs,live,clock,behavior,remove:id=>{tabs.delete(id);for(let i=live.length-1;i>=0;i--)if(live[i].id===id)live.splice(i,1);removed(id);},restart:()=>{state={};},fireAlarm:()=>alarmListener({name:'ynou-local-window-check'}),get alarm(){return alarm;}};
}
test('识别由首页打开的视频标签，并拒绝其他标签',async()=>{const h=harness();await prepareVideo(h);assert.equal((await h.call({type:'GET'},h.other)).running,false);assert.equal((await h.call({type:'GET'},h.video)).videoTabId,2);});
test('批末保留视频窗口等待核对，不立即关闭重开',async()=>{const h=harness();await prepareVideo(h);const live=await h.call({type:'GET'},h.video);const s=await h.call({type:'VIDEO_END',token:live.pending.token},h.video);assert.equal(s.phase,'verify');assert.equal(s.videoTabId,2);assert.deepEqual(h.closed,[]);assert.equal(s.batch.attempts.length,1);assert.equal(s.courses[0].progress.current,0);});
test('停止会暂停已登记的两个标签页',async()=>{const h=harness();await prepareVideo(h);await h.call({type:'GET'},h.video);assert.equal((await h.call({type:'STOP'},h.popup)).running,false);assert.deepEqual(h.messages.map(x=>x[0]),[1,2]);});
test('非首页不能启动，重复任务不能启动',async()=>{const h=harness();assert.match((await h.call({type:'SCAN',tabId:2},h.popup)).error,/首页/);await h.call({type:'SCAN',tabId:1},h.popup);assert.match((await h.call({type:'SCAN',tabId:1},h.popup)).error,/已有任务/);});
test('独立助手窗口带tab身份仍可扫描和停止，子框架不能冒充控制界面',async()=>{
 const h=harness(),controller={...h.popup,tab:{id:90,windowId:8},frameId:0};
 await h.call({type:'SCAN',tabId:1},{...controller,frameId:2});assert.equal(!!(await h.call({type:'GET'},controller)).running,false);
 const started=await h.call({type:'SCAN',tabId:1},controller);assert.equal(started.running,true);assert.equal(started.tabId,1);
 const stopped=await h.call({type:'STOP'},controller);assert.equal(stopped.running,false);assert.deepEqual(h.messages.map(x=>x[0]),[1]);
});
test('旧版页面脚本必须刷新后才能启动，停止后明确指向已有缓存',async()=>{
 const h=harness();h.behavior.pageVersion='1.3.1';
 assert.match((await h.call({type:'SCAN',tabId:1},h.popup)).error,/刷新教学平台首页/);
 assert.equal((await h.call({type:'GET'},h.popup)).running,false);
 h.behavior.pageVersion='1.6.1';await h.call({type:'SCAN',tabId:1},h.popup);
 await h.call({type:'STOP'},h.popup);const s=await h.call({type:'GET'},h.popup);
 assert.equal(s.buildVersion,'1.6.1');assert.match(s.status,/使用缓存开始学习/);
 const event=s.diagnosis.events.find(event=>event.kind==='automation-stop');assert.equal(event.source,'popup');assert.equal(event.reason,s.status);
});
test('插件没有直接导航、后台 iframe 或观看记录接口',()=>{const src=['content.js','background.js'].map(f=>fs.readFileSync('extension/'+f,'utf8')).join('\n');assert.doesNotMatch(src,/tabs\.update|location\.(?:href\s*=|assign|replace)|createElement\(['"]iframe|fetch\(/);});

test('每科独立满额，全部扫描后才生成播放计划',()=>{
 const courses=[40,5,30,50,9].map(total=>({progress:L.quota('0/'+total)}));
 assert.deepEqual(L.plan(courses),{ready:true,next:0});
 courses[0].progress=L.quota('40/40');courses[1].progress=L.quota('5/5');
 assert.equal(L.plan(courses).next,2);
 assert.equal(L.plan([...courses,{}]).ready,false);
 for(const c of courses)c.progress=L.quota(c.progress.total+'/'+c.progress.total);
 assert.equal(L.plan(courses).next,-1);
});
test('后台拒绝未完成全科扫描时开始视频',async()=>{
 const h=harness();await h.call({type:'SCAN',tabId:1},h.popup);
 assert.match((await h.call({type:'PATCH',patch:{phase:'video'}},h.main)).error,/尚未扫描完成/);
 assert.equal((await h.call({type:'GET'},h.main)).phase,'scanHome');
});
// Run the actual content controller against a small simulated five-course page.
test('手动扫描读取全部5科后停止，不自动播放',async()=>{
 const quotas=['40/40','5/5','0/30','0/50','0/9'];
 let state={running:true,courses:[],courseIndex:0,phase:'scanHome',scanComplete:false,logs:[]};
 let screen='loading',selected=-1,now=100000,interval,opened=[],videoClicks=0,homeClicks=0;
 const no=()=>{};
 const anchor=(text,click,href='https://teach.ynou.edu.cn/test')=>({textContent:text,href,scrollIntoView:no,click});
 const home=anchor('首页',()=>{homeClicks++;screen='home';});
 const courseLinks=quotas.map((q,i)=>Object.assign(anchor('学习',()=>{screen='info';selected=i;opened.push(i);},'https://teach.ynou.edu.cn/course?courseId='+i),{getClientRects:()=>[1],closest:()=>({querySelector:()=>({textContent:'课程'+i})})}));
 const infoLink=anchor('课程信息',()=>screen='info');
 const catLink=anchor('课程目录',()=>{screen='catalog';videoClicks++;});
 const frame={querySelector:sel=>sel==='#actualvideo'&&screen==='info'?{textContent:quotas[selected]}:null,querySelectorAll:sel=>sel==='a.studybtn'&&screen==='home'?courseLinks:sel==='a'&&screen==='info'?[infoLink,catLink]:[]};
 const panel={textContent:''};
 const document={documentElement:{append:no},querySelector:()=>null,querySelectorAll:sel=>sel==='iframe'?[{contentDocument:frame}]:sel==='a'?[home]:[],createElement:()=>({style:{},attachShadow:()=>({set innerHTML(v){},querySelector:()=>panel})})};
 const chrome={runtime:{onMessage:{addListener:no},sendMessage:async m=>{
  if(m.type==='GET')return structuredClone(state);
  if(m.type==='PATCH'){Object.assign(state,m.patch);return structuredClone(state);}
  if(m.type==='SCAN_DONE'){state.running=false;state.scanComplete=true;return structuredClone(state);}
  if(m.type==='STOP'){state.running=false;state.status=m.reason;return structuredClone(state);}
  return structuredClone(state);
 }}};
 const window={};window.top=window;
 vm.runInNewContext(fs.readFileSync('extension/content.js','utf8'),{window,document,chrome,CourseLogic:L,Date:{now:()=>now},location:{pathname:'/webindex.action'},setTimeout,WeakSet,setInterval:f=>interval=f});
 await new Promise(r=>setImmediate(r));
 for(let i=0;i<4;i++){now+=5000;await interval();}
 assert.equal(homeClicks,0,'页面加载时不能重复点击首页');
 assert.equal(state.running,true);screen='home';
 for(let i=0;i<30&&!state.scanComplete;i++){now+=5000;await interval();}
 assert.equal(state.scanComplete,true);
 assert.deepEqual(opened,[0,1,2,3,4]);
 assert.equal(videoClicks,0);
 assert.deepEqual(state.courses.map(c=>c.progress.label),quotas);
 assert.equal(state.running,false);
 now+=5000;await interval();
 assert.deepEqual(opened,[0,1,2,3,4]);
});

test('启动时发现已有视频窗口就拒绝启动',async()=>{
 const h=harness([{id:9,url:'https://teach.ynou.edu.cn/play/playVideo.action?ksId=old'}]);
 assert.match((await h.call({type:'SCAN',tabId:1},h.popup)).error,/已打开的课程视频窗口/);
 assert.equal((await h.call({type:'GET'},h.popup)).running,false);
});

test('手动扫描缓存与学习分开，开始学习不会进入全科扫描',async()=>{
 const h=harness();
 assert.match((await h.call({type:'START',tabId:1},h.popup)).error,/没有完整的扫描缓存/);
 await h.call({type:'SCAN',tabId:1},h.popup);
 const courses=[{title:'已完成',progress:L.quota('5/5')},{title:'待学习',progress:L.quota('3/30')}];
 await h.call({type:'PATCH',patch:{courses}},h.main);
 const done=await h.call({type:'SCAN_DONE'},h.main);assert.equal(done.running,false);
 const saved=await h.call({type:'GET'},h.popup);assert.deepEqual(saved.cache.courses,courses);
 const run=await h.call({type:'START',tabId:1},h.popup);assert.equal(run.phase,'home');assert.equal(run.courseIndex,1);
 await h.call({type:'PATCH',patch:{courses:[courses[0],{title:'待学习',progress:L.quota('4/30')}]}},h.main);
 assert.equal((await h.call({type:'GET'},h.popup)).cache.courses[1].progress.label,'4/30');
});
test('播放期间不点击课程信息，也不重复调用播放器play',async()=>{
 for(const videoPage of [false,true]){
  let clicked=0,played=0,interval;
  const noop=()=>{};
  const state={running:true,phase:'video',videoTabId:2,pending:{title:'示例'},courses:[{url:courseUrl,progress:L.quota('0/40')}],courseIndex:0};
  const video={currentTime:1,paused:false,addEventListener:noop,play:()=>{played++;}};
  const a={textContent:'课程信息',click:()=>clicked++,scrollIntoView:noop};
  const panel={textContent:''};
  const document={documentElement:{append:noop},querySelector:sel=>sel==='video'&&videoPage?video:sel==='#actualvideo'?{textContent:'0/40'}:null,querySelectorAll:sel=>sel==='a'?[a]:[],createElement:()=>({style:{},attachShadow:()=>({set innerHTML(v){},querySelector:()=>panel})})};
  const chrome={runtime:{onMessage:{addListener:noop},sendMessage:async()=>state}};
  const window={};window.top=window;
  vm.runInNewContext(fs.readFileSync('extension/content.js','utf8'),{window,document,chrome,CourseLogic:L,Date,location:{pathname:videoPage?'/play/playVideo.action':'/webindex.action'},setTimeout,WeakSet,setInterval:f=>interval=f});
  await new Promise(r=>setImmediate(r));await interval();await interval();
  assert.equal(clicked,0);assert.equal(played,0);
 }
});
test('未启动的视频加载后只尝试播放一次，失败也不重复尝试',async()=>{
 for(const blocked of [false,true]){
  let played=0,interval,now=100000;
  const noop=()=>{},state={running:true,phase:'video',videoTabId:2,pending:{title:'测试'}};
  const v={paused:true,currentTime:0,readyState:2,addEventListener:noop,play:async()=>{played++;if(blocked){const e=Error('blocked');e.name='NotAllowedError';throw e;}v.paused=false;}};
  const p={};const document={documentElement:{append:noop},querySelector:sel=>sel==='video'?v:null,createElement:()=>({style:{},attachShadow:()=>({set innerHTML(v){},querySelector:()=>p})})};
  const chrome={runtime:{onMessage:{addListener:noop},sendMessage:async()=>state}},window={};window.top=window;
  vm.runInNewContext(fs.readFileSync('extension/content.js','utf8'),{window,document,chrome,CourseLogic:L,Date:{now:()=>now},location:{pathname:'/play/playVideo.action'},setTimeout,WeakSet,setInterval:f=>interval=f});
  await new Promise(r=>setImmediate(r));assert.equal(played,0);
  now+=4000;await interval();assert.equal(played,blocked?2:1);
  v.paused=true;now+=4000;await interval();assert.equal(played,blocked?2:1);
 }
});

test('有声被拦截时静音启动，其他错误不重复播放',async()=>{
 let calls=0;const v={muted:false,play:async()=>{calls++;if(!v.muted){const e=Error();e.name='NotAllowedError';throw e;}}};
 await L.startVideo(v);assert.equal(calls,2);assert.equal(v.muted,true);
 calls=0;const unsupported={muted:false,play:async()=>{calls++;const e=Error();e.name='NotSupportedError';throw e;}};
 await assert.rejects(()=>L.startVideo(unsupported),{name:'NotSupportedError'});assert.equal(calls,1);assert.equal(unsupported.muted,false);
 assert.match(L.playbackError({name:'NotSupportedError'}),/格式/);
});

async function prepareVideo(h){
 await h.call({type:'SCAN',tabId:1},h.popup);
 await h.call({type:'PATCH',patch:{scanComplete:true,phase:'info',courses:[{url:courseUrl,progress:L.quota('0/40')}]}},h.main);
 await h.call({type:'BATCH_BEGIN'},h.main);
 await h.call({type:'QUEUE_READY',rows:[{id:'abc',title:'测试视频'}]},h.main);
}
test('播放器在加载完成前报错并自行关闭，仍保留平台原因且重启可导出',async()=>{
 const h=harness();await prepareVideo(h);
 delete h.tabs.get(2).openerTabId;h.live.push(h.tabs.get(2));
 const early=await h.call({type:'PLAYER_EARLY'},h.video);
 assert.equal(early.videoTabId,2);
 const blocked=await h.call({type:'PLAYER_DIAGNOSTIC',data:{kind:'platform-multiple-window',stack:'at siteCheck (player.js:10:2)'}},h.video);
 assert.equal(blocked.running,false);assert.match(blocked.status,/平台拒绝播放/);
 await h.call({type:'PLAYER_DIAGNOSTIC',data:{kind:'site-close'}},h.video);
 h.remove(2);let result=await h.call({type:'GET'},h.popup);
 assert.match(result.status,/平台拒绝播放/);assert.doesNotMatch(result.status,/未打开/);
 assert.deepEqual(result.diagnosis.events.map(e=>e.kind),['automation-start','catalog-ready','video-open-request','video-registered','video-document-start','platform-multiple-window','site-close','tab-closed','local-window-released']);
 assert.deepEqual(h.closed,[],'插件没有在平台拒绝时再次打开或主动关闭窗口');
 h.restart();result=await h.call({type:'GET'},h.popup);
 assert.ok(result.diagnosis.events.some(e=>e.kind==='platform-multiple-window'));
 assert.equal('userKey' in result.diagnosis,false);
});
test('没有opener时也必须校验科目、班级、时限和唯一视频窗口',async()=>{
 for(const condition of ['wrongCourse','wrongClass','wrongOpener','expired','secondVideo']){
  const h=harness();await prepareVideo(h);delete h.tabs.get(2).openerTabId;
  let sender=structuredClone(h.video);
  if(condition==='wrongCourse')sender.url=sender.url.replace('course-a','course-b');
  if(condition==='wrongClass')sender.url=sender.url.replace('class-a','class-b');
  if(condition==='wrongOpener')h.tabs.get(2).openerTabId=99;
  if(condition==='expired')h.clock.now+=61000;
  if(condition==='secondVideo')h.live.push(h.tabs.get(3));
  assert.equal((await h.call({type:'PLAYER_EARLY'},sender)).running,false,condition);
  assert.equal((await h.call({type:'GET'},h.popup)).videoTabId,null,condition);
 }
});
test('早期诊断保留平台原始alert和close行为，不启动视频',()=>{
 const order=[],handlers={};let alerts=0,closes=0;
 const document={dispatchEvent:e=>{order.push(JSON.parse(e.detail).kind);},addEventListener:(name,fn)=>handlers[name]=fn};
 const window={alert:function(message){alerts++;order.push('native-alert');return message;},close:function(){closes++;order.push('native-close');return 123;}};window.top=window;
 const context={window,document,Date,Reflect,Error,CustomEvent:class{constructor(name,data){Object.assign(this,data);}},HTMLVideoElement:class{}};
 vm.runInNewContext(fs.readFileSync('extension/diagnostic-page.js','utf8'),context);
 assert.equal(window.alert('对不起,不允许多窗口播放视频资源!'),'对不起,不允许多窗口播放视频资源!');
 assert.equal(window.close(),123);assert.equal(alerts,1);assert.equal(closes,1);
 assert.deepEqual(order,['probe-ready','platform-multiple-window','native-alert','site-close','native-close']);
 window.alert('普通提示');assert.equal(order.at(-1),'native-alert');
 vm.runInNewContext(fs.readFileSync('extension/diagnostic-page.js','utf8'),context);
 window.close();assert.equal(order.filter(x=>x==='site-close').length,2,'同页不重复包装');
});
test('真实诊断脚本和桥接脚本能在主控制器加载前将平台报错传到后台',async()=>{
 const h=harness();await prepareVideo(h);delete h.tabs.get(2).openerTabId;
 const listeners=new Map(),pending=[],no=()=>{};
 const document={addEventListener:(name,fn)=>{listeners.set(name,[...(listeners.get(name)||[]),fn]);},dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);}};
 const bridgeWindow={};bridgeWindow.top=bridgeWindow;
 vm.runInNewContext(fs.readFileSync('extension/diagnostic-bridge.js','utf8'),{window:bridgeWindow,document,chrome:{runtime:{sendMessage:m=>{const p=h.call(m,h.video);pending.push(p);return p;}}}});
 const pageWindow={alert:no,close:no};pageWindow.top=pageWindow;
 vm.runInNewContext(fs.readFileSync('extension/diagnostic-page.js','utf8'),{window:pageWindow,document,Date,Error,Reflect,CustomEvent:class{constructor(type,data){this.type=type;Object.assign(this,data);}},HTMLVideoElement:class{}});
 pageWindow.alert('对不起,不允许多窗口播放视频资源!');pageWindow.close();
 await Promise.all(pending);
 const result=await h.call({type:'GET'},h.popup);
 assert.equal(result.running,false);assert.match(result.status,/平台拒绝播放/);
 assert.ok(result.diagnosis.events.some(e=>e.kind==='probe-ready'));
 assert.ok(result.diagnosis.events.some(e=>e.kind==='platform-multiple-window'));
 assert.ok(result.diagnosis.events.some(e=>e.kind==='site-close'));
});

test('停止后手动打开的视频报错也能保存，历史记录跨重启不丢失',async()=>{
 const h=harness();await prepareVideo(h);await h.call({type:'GET'},h.video);await h.call({type:'STOP'},h.popup);h.restart();
 assert.equal((await h.call({type:'PLAYER_EARLY'},h.other)).running,false);
 h.live.push(h.tabs.get(3));
 await h.call({type:'PLAYER_DIAGNOSTIC',data:{kind:'platform-multiple-window',markers:[{keyTag:'abcd',value:'secret-value',category:'playback'}]}},h.other);
 const s=await h.call({type:'GET'},h.popup);assert.equal(s.running,false);assert.equal(s.diagnosis.version,'1.6.1');
 assert.ok(s.diagnosis.events.some(e=>e.kind==='automation-stop'));
 const warning=s.diagnosis.events.find(e=>e.kind==='platform-multiple-window');
 assert.equal(warning.scope,'manual');assert.equal(warning.videoWindowCount,1);assert.equal(warning.markers[0].value,'[redacted]');
 assert.deepEqual(h.messages.map(x=>x[0]),[1,2],'被动记录不会控制手动打开的视频');
});
test('关闭窗口失败时保留窗口归属并停止，不假设已经关闭',async()=>{
 const h=harness();await prepareVideo(h);h.live.push(h.tabs.get(2));await h.call({type:'GET'},h.video);h.behavior.failClose=true;
 assert.match((await h.call({type:'CLOSE_VIDEO'},h.main)).error,/未能关闭/);
 const s=await h.call({type:'GET'},h.popup);assert.equal(s.running,false);assert.equal(s.videoTabId,2);assert.deepEqual(h.closed,[]);
 assert.ok(s.diagnosis.events.some(e=>e.kind==='extension-close-request'));
 assert.ok(s.diagnosis.events.some(e=>e.kind==='extension-close-failed'));
});

test('关闭失败且无法读取窗口列表时保留登记，不把检查异常当作已关闭',async()=>{
 const h=harness();await prepareVideo(h);await h.call({type:'GET'},h.video);
 h.behavior.failClose=true;h.behavior.queryFails=true;
 assert.match((await h.call({type:'CLOSE_VIDEO'},h.main)).error,/无法确认关闭/);
 const s=await h.call({type:'GET'},h.popup);assert.equal(s.videoTabId,2);assert.equal(s.running,false);
 assert.equal(s.lastLocalRelease,null);
});

test('停止后关闭窗口仍清理登记，重新启动保留关闭间隔和扫描缓存',async()=>{
 const h=harness();await prepareVideo(h);h.live.push(h.tabs.get(2));await h.call({type:'GET'},h.video);
 await h.call({type:'SCAN_DONE'},h.main);await h.call({type:'STOP'},h.popup);h.remove(2);
 const stopped=await h.call({type:'GET'},h.popup);
 assert.equal(stopped.videoTabId,null);assert.equal(stopped.pending,null);assert.equal(stopped.running,false);
 assert.equal(stopped.lastLocalRelease.platformReleased,null);assert.equal(stopped.lastLocalRelease.tabId,2);
 assert.equal(h.alarm,undefined);assert.equal(stopped.cache.courses[0].progress.label,'0/40');
 const started=await h.call({type:'START',tabId:1},h.popup);
 assert.equal(started.running,true);assert.equal(started.waitUntil,stopped.waitUntil);assert.ok(started.waitUntil>h.clock.now);
 assert.equal(h.alarm.periodInMinutes,1);
});

test('遗漏关闭通知时，定时核对实际窗口并清理插件登记',async()=>{
 const h=harness();await prepareVideo(h);await h.call({type:'GET'},h.video);
 // No player is present in the browser inventory; no onRemoved notification was received.
 h.fireAlarm();const s=await h.call({type:'GET'},h.popup);
 assert.equal(s.running,false);assert.equal(s.videoTabId,null);assert.equal(s.pending,null);
 assert.equal(s.lastLocalRelease.cause,'tab-missing');assert.equal(s.lastLocalRelease.platformReleased,null);
 assert.deepEqual(h.closed,[]);assert.equal(s.finished,0);
});

test('连接超时但窗口仍存在时保留窗口登记，不重开也不计入播放次数',async()=>{
 const h=harness();await prepareVideo(h);h.live.push(h.tabs.get(2));await h.call({type:'GET'},h.video);
 h.behavior.unresponsive=2;h.clock.now+=181000;h.fireAlarm();
 const s=await h.call({type:'GET'},h.popup);
 assert.equal(s.running,false);assert.equal(s.videoTabId,2);assert.equal(s.pending,null);assert.equal(s.batch.attempts.length,0);
 assert.match(s.status,/连接检查失败/);assert.equal(h.alarm,undefined);assert.deepEqual(h.closed,[]);
 assert.match((await h.call({type:'START',tabId:1},h.popup)).error,/已打开的课程视频窗口/);
});

test('定时器延迟后页面仍能响应时保持运行，不把休眠间隔当作窗口关闭',async()=>{
 const h=harness();await prepareVideo(h);h.live.push(h.tabs.get(2));await h.call({type:'GET'},h.video);
 h.clock.now+=600000;h.fireAlarm();const s=await h.call({type:'GET'},h.popup);
 assert.equal(s.running,true);assert.equal(s.videoTabId,2);assert.equal(s.lastContact.player,h.clock.now);
 assert.equal(s.lastLocalRelease,null);assert.deepEqual(h.closed,[]);
});

test('手动视频关闭时只记录本地状态，不接管其他窗口',async()=>{
 const h=harness();h.live.push(h.tabs.get(3));await h.call({type:'PLAYER_EARLY'},h.other);
 h.remove(3);const s=await h.call({type:'GET'},h.popup);
 assert.equal(s.running,false);assert.deepEqual(h.messages,[]);assert.deepEqual(h.closed,[]);
 assert.equal(s.lastLocalRelease.tabId,3);assert.equal(s.lastLocalRelease.platformReleased,null);assert.equal(h.alarm,undefined);
});
test('普通事件耗尽预算后，仍保存多窗口提示',()=>{
 let receive;const messages=[],window={};window.top=window;
 vm.runInNewContext(fs.readFileSync('extension/diagnostic-bridge.js','utf8'),{window,document:{addEventListener:(name,fn)=>receive=fn},chrome:{runtime:{sendMessage:m=>{messages.push(m);return Promise.resolve();}}}});
 for(let i=0;i<150;i++)receive({detail:JSON.stringify({kind:'media-playing',time:i})});
 for(let i=0;i<30;i++)receive({detail:JSON.stringify({kind:'site-error'})});
 receive({detail:JSON.stringify({kind:'platform-multiple-window'})});
 assert.equal(messages.filter(m=>m.data?.kind==='media-playing').length,120);
 assert.equal(messages.filter(m=>m.data?.kind==='platform-multiple-window').length,1);
});
test('播放标记观察保持网站原有写入结果，凭据和标记名称不导出',()=>{
 const events=[];
 class Document{constructor(){this.cookieValue='JSESSIONID=secret-session; play_count=1';}get cookie(){return this.cookieValue;}set cookie(value){this.cookieValue=value;}dispatchEvent(event){events.push(JSON.parse(event.detail));}addEventListener(){}}
 class Storage{constructor(){this.data=new Map();}get length(){return this.data.size;}key(i){return [...this.data.keys()][i];}getItem(key){return this.data.get(key)??null;}setItem(key,value){if(key==='play_throw')throw Error('original failure');this.data.set(key,value);return 7;}removeItem(key){this.data.delete(key);return 9;}}
 const document=new Document(),local=new Storage(),session=new Storage(),window={localStorage:local,sessionStorage:session,alert:()=>{},close:()=>{},addEventListener:()=>{}};window.top=window;
 local.setItem('video_account_private','secret-token');
 vm.runInNewContext(fs.readFileSync('extension/diagnostic-page.js','utf8'),{window,document,Document,Storage,Date,Reflect,Error,CustomEvent:class{constructor(name,data){Object.assign(this,data);}},HTMLVideoElement:class{}});
 assert.equal(local.setItem('play_count','2'),7);assert.equal(local.getItem('play_count'),'2');
 assert.equal(local.removeItem('play_count'),9);assert.equal(local.getItem('play_count'),null);
 assert.throws(()=>local.setItem('play_throw','3'),/original failure/);
 document.cookie='play_count=0';assert.equal(document.cookie,'play_count=0');
 Object.defineProperty(window,'localStorage',{get(){throw Error('observer denied');}});
 assert.equal(local.setItem('play_count','3'),7,'观察器失败不改变网站写入结果');
 const exported=JSON.stringify(events);assert.doesNotMatch(exported,/secret-session|secret-token|video_account_private|JSESSIONID/);
 assert.ok(events.some(e=>e.kind==='cookie-write'&&e.value===0));
});
