const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const L=require('../extension/logic.js');
const root='extension/';
const host='https://teach.ynou.edu.cn';
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function setup({counts=[2,35,39,40],total=40,resources=46,second=true,pausedStarts=false,chapters=[],accordion=false,catalogBranches=0,freezeMainTimers=false}={}){
 let run={},listener,removed,mainTick,playerTick,frame,screen='home',courseIndex=0,verification=0,serialMessages=[];
 const clock={now:100000},stats={opens:[],sidebar:[],chapters:[],catalog:[],wakes:[],closed:[],checks:[],study:[],nativeAlerts:[]};
 const courseUrls=[0,1].map(i=>host+'/eduCourseBaseinfo/courseinfo.action?courseId=c'+i+'&classId=k'+i);
 const courses=[{url:courseUrls[0],title:'测试科目',progress:L.quota(counts[0]+'/'+total)}];
 if(second)courses.push({url:courseUrls[1],title:'第二科',progress:L.quota('0/5')});
 let local={courseCache:{courses:structuredClone(courses),userKey:'测试账号',scannedAt:1}};
 const tabs=new Map([[1,{id:1,url:host+'/webindex.action'}]]);
 const mainSender={tab:{id:1},frameId:0,url:host+'/webindex.action'},popup={url:'chrome-extension://test/popup.html'};
 const observers=new Map(),mediaListeners=new Map(),receivers=new Map();
 let resource='',holdSwitch=false,missingSidebar=null,videoSender,playerWindow;
 const no=()=>{},panel={textContent:''};
 const media={tagName:'VIDEO',paused:false,ended:false,currentTime:0,duration:10,readyState:4,currentSrc:'',src:'',error:null,
  addEventListener:(name,fn)=>{mediaListeners.set(name,new Set([...(mediaListeners.get(name)||[]),fn]));},
  removeEventListener:(name,fn)=>mediaListeners.get(name)?.delete(fn),
  play:async()=>{media.paused=false;emitMedia('playing');},pause:()=>media.paused=true};
 function emitMedia(name){for(const fn of [...(mediaListeners.get(name)||[])])fn({target:media});for(const fn of observers.get(name)||[])fn({target:media});}
 function beginMedia(id){resource=id;media.error=null;media.ended=false;media.currentTime=pausedStarts?5:0;media.paused=pausedStarts;media.readyState=4;media.src=media.currentSrc='media/'+id;emitMedia('loadstart');if(!pausedStarts)emitMedia('playing');}
 function call(m,sender=mainSender){serialMessages.push(m.type);return new Promise(resolve=>listener(m,sender,resolve));}
 const chrome={storage:{session:{get:async()=>({run:structuredClone(run)}),set:async obj=>run=structuredClone(obj.run)},local:{get:async()=>structuredClone(local),set:async obj=>Object.assign(local,structuredClone(obj))}},runtime:{getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn}},tabs:{
  query:async()=>[...tabs.values()],get:async id=>tabs.get(id),
  remove:async id=>{stats.closed.push(id);tabs.delete(id);removed(id);},
  sendMessage:async(id,m)=>{if(m.type==='PING')return {ready:true,version:'1.6.1',userKey:'测试账号'};if(m.type==='WAKE_MAIN')stats.wakes.push(id);let response;receivers.get(id)?.(m,{},value=>response=value);return response;},
  onRemoved:{addListener:fn=>removed=fn}
 }};
 let alarm,alarmListener;
 chrome.alarms={get:async()=>alarm,create:async(name,options)=>{alarm={name,...options};},clear:async()=>{alarm=undefined;return true;},onAlarm:{addListener:fn=>alarmListener=fn}};
 const workerTimers=require('./background-timers.cjs')(clock);
 function loadWorker(){vm.runInNewContext(fs.readFileSync(root+'background.js','utf8'),{chrome,CourseLogic:L,Date:{now:()=>clock.now},URL,importScripts:no,setTimeout:workerTimers.setTimeout,clearTimeout:workerTimers.clearTimeout});}
 loadWorker();
 const ids=Array.from({length:resources},(_,i)=>'r'+i);
 const title=id=>['第10讲','第2讲','第1讲'][Number(id.slice(1))%3]+' '+id;
 function anchor(text,click,href=host+'/placeholder'){return {textContent:text,href,title:text,click,scrollIntoView:no,getClientRects:()=>[1]};}
 // A tree with delayed child insertion and real visibility relationships. Recreate headers
 // on every read to also exercise sites that replace nodes after loading a chapter.
 const tree=chapters.map((c,index)=>({...c,key:c.key||'chapter'+index,opened:!!c.open,loadedAt:c.open||c.preloaded?-Infinity:Infinity}));
 const parent=b=>tree.find(p=>p.key===b.parent);
 const belongs=(b,ancestor)=>!!b&&(b===ancestor||belongs(parent(b),ancestor));
 const branchFor=id=>tree.find(b=>b.ids?.includes(id));
 const branchVisible=b=>!parent(b)||(parent(b).opened&&branchVisible(parent(b)));
 const bodyVisible=b=>b.opened&&branchVisible(b);
 const headerLoaded=b=>!parent(b)||(parent(b).loadedAt<=clock.now&&headerLoaded(parent(b)));
 function chapterHeader(b){
  const body={matches:()=>true,contains:a=>belongs(branchFor(a.resourceId),b),getClientRects:()=>(b.sitePlayer?branchVisible(b):bodyVisible(b))?[1]:[],
   get children(){return [...(b.ids||[]),...tree.filter(c=>c.parent===b.key)].map(()=>({getClientRects:()=>bodyVisible(b)?[1]:[]}));}};
  const loadedBody=()=>b.sitePlayer&&b.loadedAt>clock.now?null:body;
  const li={id:b.key,classList:{contains:name=>name==='parent_li'},get children(){return loadedBody()?[body]:[];},contains:body.contains};
  return Object.assign(anchor(b.key,()=>{
   stats.chapters.push(b.key);if(b.empty){playerWindow.alert('该章节无内容');return;}if(b.noop)return;
   b.opened=!b.opened;
   if(b.opened){if(b.loadedAt===Infinity)b.loadedAt=clock.now+(b.delay||0);if(accordion)for(const other of tree)if(other!==b&&other.parent===b.parent)other.opened=false;}
  }),{
   id:b.sitePlayer?'':b.key,ownerDocument:playerDocument,matches:sel=>sel==='.parent_tit',closest:()=>li,get nextElementSibling(){return loadedBody();},getClientRects:()=>branchVisible(b)?[1]:[],
   getAttribute:name=>name==='title'&&!b.plainHeader&&!b.sitePlayer?(b.opened?'Collapse this branch':'Expand this branch'):null
  });
 }
 function sidebarRows(){
  return ids.filter(id=>id!==missingSidebar&&(!branchFor(id)||branchFor(id).loadedAt<=clock.now)).map(id=>{
   const b=branchFor(id);
   return Object.assign(anchor(title(id),()=>{
    assert.ok(!b||bodyVisible(b),'不能点击仍处于折叠章节里的视频');
    stats.sidebar.push(id);if(!holdSwitch)beginMedia(id);
   }),{resourceId:id,getClientRects:()=>!b||bodyVisible(b)?[1]:[],getAttribute:()=>`playFile('${id}','row',this);`});
  });
 }
 function statusNumber(){return courseIndex===0?counts[Math.min(verification,counts.length-1)]:0;}
 function navigate(next){screen=next;frame=makeFrame();}
 const study=courses.map((c,i)=>Object.assign(anchor('学习',()=>{courseIndex=i;stats.study.push(i);navigate('info');},c.url),{closest:()=>({querySelector:()=>({textContent:c.title})})}));
 const home=anchor('首页',()=>navigate('home'));
 function makeFrame(){
  const info=anchor('课程信息',()=>{stats.checks.push(courseIndex);if(courseIndex===0)verification++;navigate('info');});
  const catalog=anchor('课程目录',()=>navigate('catalog'));
  const rows=ids.map((id,index)=>Object.assign(anchor(title(id),()=>openPlayer(id)),{
   getAttribute:name=>name==='onclick'?`viewRes('${id}','mp4','视频',${index},this)`:null,
   closest:()=>({querySelector:()=>({textContent:index<statusNumber()?'已学':'未学'})})
  }));
  const branchRows=Array.from({length:catalogBranches},(_,i)=>Object.assign(anchor('章节'+i,()=>{stats.catalog.push(i);branchRows[i].open=true;}),{id:'catalog'+i,open:false}));
  return {
   querySelector:sel=>sel==='#actualvideo'&&screen==='info'?{textContent:statusNumber()+'/'+(courseIndex===0?total:5)}:sel==='.parent_tit'&&screen==='catalog'?{}:null,
   querySelectorAll:sel=>sel==='a.studybtn'&&screen==='home'?study:sel==='a'&&screen!=='home'?[info,catalog]:sel==='.parent_tit'&&screen==='catalog'?branchRows:sel==='.parent_tit[title="Expand this branch"]'&&screen==='catalog'?branchRows.filter(b=>!b.open):sel==='li a[onclick]'&&screen==='catalog'&&branchRows.every(b=>b.open)?rows:[]
  };
 }
 const shell=()=>({style:{},attachShadow:()=>({set innerHTML(value){},querySelector:()=>panel})});
 const mainDocument={visibilityState:freezeMainTimers?'hidden':'visible',documentElement:{append:no},createElement:shell,querySelector:()=>null,querySelectorAll:sel=>sel==='iframe'?[{contentDocument:frame}]:sel==='a'?[home]:[]};
 const playerDocument={documentElement:{append:no},createElement:shell,
  addEventListener:(name,fn)=>observers.set(name,[...(observers.get(name)||[]),fn]),
  querySelector:sel=>sel==='video'?media:null,
  querySelectorAll:sel=>sel==='video'?[media]:sel==='a[onclick]'?sidebarRows():sel.includes('.parent_tit')?tree.filter(headerLoaded).map(chapterHeader):[]
 };
 function controller(document,id,sender,onInterval){
  const window={};window.top=window;
  if(id===2){
   playerWindow=window;window.alert=text=>stats.nativeAlerts.push(text);
   window.CustomEvent=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
   document.defaultView=window;window.getComputedStyle=()=>({visibility:'visible'});
   document.dispatchEvent=e=>{for(const fn of observers.get(e.type)||[])fn(e);};
   vm.runInNewContext(fs.readFileSync(root+'chapter-alert.js','utf8'),{window,document,CustomEvent:window.CustomEvent,Date:{now:()=>clock.now},Reflect});
  }
  vm.runInNewContext(fs.readFileSync(root+'content.js','utf8'),{window,document,CourseLogic:L,Date:{now:()=>clock.now},WeakSet,
   chrome:{runtime:{onMessage:{addListener:fn=>receivers.set(id,fn)},sendMessage:m=>call(m,sender)}},
   location:{pathname:id===1?'/webindex.action':'/play/playVideo.action'},
   setInterval:onInterval,setTimeout:(fn,ms)=>{if(id===1&&freezeMainTimers)return;clock.now+=ms;queueMicrotask(fn);}
  });
 }
 function openPlayer(id){
  stats.opens.push(id);const url=host+'/play/playVideo.action?courseId=c'+courseIndex+'&classId=k'+courseIndex+'&ksId='+id;
  tabs.set(2,{id:2,openerTabId:1,url});videoSender={tab:{id:2},frameId:0,url};beginMedia(id);
  controller(playerDocument,2,videoSender,fn=>playerTick=fn);
 }
 navigate('home');controller(mainDocument,1,mainSender,fn=>mainTick=fn);await settle();
 const started=await call({type:'START',tabId:1},popup);assert.equal(started.running,true);
 async function drive(){clock.now+=5000;await mainTick();if(playerTick&&tabs.has(2))await playerTick();await settle();return run;}
 async function until(predicate){for(let i=0;i<40;i++){if(predicate(run))return run;await drive();}throw Error('状态未达到预期：'+JSON.stringify({phase:run.phase,status:run.status}));}
 return {stats,media,mediaListeners,clock,call,drive,until,get state(){return run;},get cache(){return local.courseCache;},get current(){return resource;},get videoSender(){return videoSender;},get panel(){return panel.textContent;},get messages(){return serialMessages;},set holdSwitch(v){holdSwitch=v;},set missingSidebar(v){missingSidebar=v;},
  async wakeOnly(){await workerTimers.advance(2000);if(playerTick&&tabs.has(2))await playerTick();await settle();},
  async restartWorker(){workerTimers.clearAll();loadWorker();await settle();},
  async restoreFromAlarm(){workerTimers.clearAll();alarmListener({name:'ynou-local-window-check'});await settle();},
  get workerTimerCount(){return workerTimers.size;},
  async ready(){return until(s=>s.phase==='video'&&s.videoTabId===2&&s.pending?.id===resource);},
  async end(){media.ended=true;media.paused=true;media.currentTime=media.duration;emitMedia('ended');await settle();},
  async fail(){media.error={message:'测试文件失败'};await playerTick();await settle();},
  async mainOnly(){clock.now+=5000;await mainTick();await settle();},
  async ping(){return new Promise(resolve=>receivers.get(2)({type:'PING'},{},resolve));},
  async mainPing(){return new Promise(resolve=>receivers.get(1)({type:'PING'},{},resolve));},
  async playerOnly(){clock.now+=5000;await playerTick();await settle();}
 };
}

async function untilWake(h,predicate){
 for(let i=0;i<130;i++){if(predicate(h.state))return;await h.wakeOnly();}
 throw Error('扩展消息未推进状态：'+JSON.stringify({phase:h.state.phase,status:h.state.status,catalog:h.state.catalogProgress}));
}
const readyByWake=h=>untilWake(h,s=>s.phase==='video'&&s.videoTabId===2&&s.pending?.id===h.current);

test('首页全部页面定时器冻结，仍按 19/30 播11条、29/30补1条、实际30/30结束，保留同一播放器',async()=>{
 const h=await setup({counts:[19,29,30],total:30,resources:32,second:false,catalogBranches:20,freezeMainTimers:true});
 await readyByWake(h);assert.equal(h.current,'r19');assert.equal(h.state.batch.goal,11);
 assert.equal(h.workerTimerCount,0,'播放中不继续唤醒首页');
 for(let i=0;i<11;i++){await h.end();assert.equal(h.stats.checks.length,0);if(i<10)await readyByWake(h);}
 assert.equal(h.state.phase,'verify');assert.equal(h.stats.closed.length,0);
 await readyByWake(h);
 assert.equal(h.state.batch.round,2);assert.equal(h.state.batch.goal,1);assert.equal(h.current,'r30');
 assert.equal(h.cache.courses[0].progress.label,'29/30');assert.equal(h.stats.checks.length,1);
 assert.deepEqual(h.stats.catalog,[...Array(20).keys(),...Array(20).keys()]);
 assert.deepEqual(h.stats.opens,['r19']);assert.deepEqual(h.stats.closed,[]);
 const activity=(await h.mainPing()).pageActivity;
 assert.equal(activity.visibility,'hidden');assert.ok(activity.lastWakeAt>0);assert.equal(activity.catalog.expanded,20);
 assert.equal(h.state.catalogProgress.stage,'ready');
 await h.end();await untilWake(h,s=>!s.running);
 assert.equal(h.cache.courses[0].progress.label,'30/30');assert.equal(h.state.finished,12);
 assert.deepEqual(h.stats.closed,[2]);assert.equal(h.workerTimerCount,0);
});

test('读取目录中扩展后台重新启动，保留已展开章节并恢复消息推进',async()=>{
 const h=await setup({counts:[0,1],total:1,resources:2,second:false,catalogBranches:5,freezeMainTimers:true});
 await untilWake(h,()=>h.stats.catalog.length===2);await h.restartWorker();await readyByWake(h);
 assert.deepEqual(h.stats.catalog,[0,1,2,3,4]);assert.deepEqual(h.stats.opens,['r0']);
});

test('短定时器丢失后由持久闹钟恢复目录推进，停止会取消后续唤醒',async()=>{
 const h=await setup({counts:[0,1],total:1,resources:2,second:false,catalogBranches:5,freezeMainTimers:true});
 await untilWake(h,()=>h.stats.catalog.length===1);await h.restoreFromAlarm();
 await untilWake(h,()=>h.stats.catalog.length===3);await h.call({type:'STOP',reason:'测试停止'});
 const wakes=h.stats.wakes.length;for(let i=0;i<4;i++)await h.wakeOnly();
 assert.equal(h.state.running,false);assert.equal(h.workerTimerCount,0);assert.equal(h.stats.wakes.length,wakes);
 assert.deepEqual(h.stats.catalog,[0,1,2]);assert.deepEqual(h.stats.opens,[]);
});

test('2/40先播38条，35/40补5条，39/40再补1条，实际满额才换科；全程只开一个播放器',async()=>{
 const h=await setup();await h.ready();
 assert.equal(h.state.batch.goal,38);assert.equal(h.current,'r2');
 for(let i=0;i<38;i++){
  assert.equal(h.current,'r'+(i+2));await h.end();
  assert.equal(h.stats.checks.length,0,'批内不能读取课程进度');
  assert.equal(h.cache.courses[0].progress.label,'2/40','估算不得写成平台进度');
  if(i<37)await h.ready();
 }
 assert.equal(h.state.phase,'verify');assert.equal(h.state.courseIndex,0);assert.equal(h.state.videoTabId,2);
 await h.ready();assert.equal(h.stats.checks.length,1);assert.equal(h.state.batch.goal,5);assert.equal(h.state.batch.round,2);assert.equal(h.current,'r40');
 for(let i=0;i<5;i++){await h.end();assert.equal(h.stats.checks.length,1);if(i<4)await h.ready();}
 await h.ready();assert.equal(h.stats.checks.length,2);assert.equal(h.state.batch.goal,1);assert.equal(h.state.batch.round,3);assert.equal(h.current,'r45');
 await h.end();assert.equal(h.stats.closed.length,0);
 await h.until(s=>s.courseIndex===1);
 assert.deepEqual(h.stats.checks,[0,0,0]);assert.deepEqual(h.stats.opens,['r2']);assert.deepEqual(h.stats.closed,[2]);
 assert.equal(h.cache.courses[0].progress.label,'40/40');assert.equal(h.state.finished,44);
 assert.equal(h.stats.sidebar.length,43);assert.equal(h.state.batch,null);
});

test('旧视频结束事件和重复消息不能计入新视频；同一视频元素换源能继续播放',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:3,second:false});await h.ready();
 const oldHandler=[...h.mediaListeners.get('ended')][0],oldToken=h.state.pending.token;
 await h.end();assert.equal(h.state.phase,'switchVideo');
 await h.ready();assert.equal(h.current,'r1');assert.equal(h.media.ended,false);
 oldHandler();await settle();await h.call({type:'VIDEO_END',token:oldToken},h.videoSender);
 assert.equal(h.state.batch.attempts.length,1);assert.equal(h.state.phase,'video');assert.equal(h.state.pending.id,'r1');
 assert.deepEqual(h.stats.opens,['r0']);assert.deepEqual(h.stats.sidebar,['r1']);
});

test('单个视频失败也记录尝试并右侧继续；平台拒绝仍立即停止',async()=>{
 const h=await setup({counts:[0,1,2],total:2,resources:3,second:false});await h.ready();
 await h.fail();assert.equal(h.state.batch.attempts[0].outcome,'failed');assert.equal(h.state.phase,'switchVideo');
 assert.equal(h.stats.checks.length,0);await h.ready();assert.equal(h.current,'r1');
 await h.call({type:'PLAYER_DIAGNOSTIC',data:{kind:'platform-multiple-window'}},h.videoSender);
 await h.end();await h.drive();assert.equal(h.state.running,false);assert.equal(h.state.batch.attempts.length,1);
 assert.deepEqual(h.stats.sidebar,['r1']);assert.equal(h.stats.checks.length,0);
});

test('右侧切换未完成时只点击一次，不把旧媒体结束计成下一条',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:3,second:false});await h.ready();h.holdSwitch=true;
 await h.end();for(let i=0;i<5;i++)await h.playerOnly();
 assert.deepEqual(h.stats.sidebar,['r1']);assert.equal(h.state.phase,'switchVideo');assert.equal(h.state.batch.attempts.length,1);
 for(let i=0;i<9;i++)await h.playerOnly();
 assert.equal(h.state.running,false);assert.match(h.state.status,/未完成切换/);assert.equal(h.state.batch.attempts.length,1);
});

test('全部视频已尝试但进度仍0/1时跳过，不循环重播同一资源',async()=>{
 const h=await setup({counts:[0,0,1],total:1,resources:1,second:false});await h.ready();
 await h.end();await h.until(s=>!s.running);
 assert.equal(h.state.batch.round,2);assert.deepEqual(h.stats.sidebar,[]);assert.equal(h.stats.opens.length,1);assert.equal(h.cache.courses[0].progress.full,false);assert.equal(h.state.skippedCourses[0].progress,'0/1');assert.deepEqual(h.stats.closed,[2]);
});

test('目录没有可补播条目时跳过，避免反复刷新进度页',async()=>{
 const h=await setup({counts:[0,1],total:3,resources:1,second:false});await h.ready();await h.end();
 await h.until(s=>!s.running);assert.match(h.state.status,/已跳过/);assert.equal(h.stats.checks.length,1);assert.equal(h.cache.courses[0].progress.label,'1/3');
 for(let i=0;i<4;i++)await h.drive();assert.equal(h.stats.checks.length,1);assert.equal(h.stats.opens.length,1);
});
test('视频目录耗尽跳过后继续下一科，同名资源可播放，关闭间隔和原进度保留',async()=>{
 const h=await setup({counts:[0],total:1,resources:1,second:true,freezeMainTimers:true});await readyByWake(h);await h.end();await untilWake(h,s=>s.courseIndex===1&&s.phase==='video'&&s.videoTabId===2);
 assert.equal(h.state.skippedCourses.length,1);assert.equal(h.cache.courses[0].progress.label,'0/1');assert.deepEqual(h.stats.opens,['r0','r0']);assert.deepEqual(h.stats.closed,[2]);
 await h.end();await untilWake(h,s=>!s.running);assert.equal(h.state.skippedCourses.length,2);assert.deepEqual(h.stats.closed,[2,2]);assert.equal(h.cache.courses[1].progress.label,'0/5');
});

test('右侧切换到有历史播放位置但仍暂停的视频，也能自动开始',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:3,second:false,pausedStarts:true});await h.ready();
 await h.playerOnly();assert.equal(h.media.paused,false);
 await h.end();await h.ready();assert.equal(h.current,'r1');assert.equal(h.media.currentTime,5);
 await h.playerOnly();assert.equal(h.media.paused,false);
 h.media.pause();await h.playerOnly();assert.equal(h.media.paused,true,'用户后来手动暂停时不重复启动');
});

test('下一条未加载时展开右侧章节并等待，仍按原目录队列选视频且不另开窗口',async()=>{
 const h=await setup({counts:[0,3],total:3,resources:3,second:false,chapters:[
  {key:'已展开',ids:['r0'],open:true},
  {key:'下一章',ids:['r1'],delay:12000},
  {key:'再下一章',ids:['r2']}
 ]});await h.ready();await h.end();await h.playerOnly();
 assert.equal(h.state.running,true);assert.match(h.panel,/展开右侧章节/);
 assert.equal(h.state.batch.attempts.length,1);assert.equal(h.stats.checks.length,0);
 await h.ready();assert.equal(h.current,'r1');assert.deepEqual(h.stats.chapters,['下一章','再下一章']);
 assert.deepEqual(h.stats.sidebar,['r1']);assert.deepEqual(h.stats.opens,['r0']);assert.deepEqual(h.stats.closed,[]);
 await h.end();await h.ready();assert.equal(h.current,'r2');assert.deepEqual(h.stats.sidebar,['r1','r2']);
 assert.equal(h.cache.courses[0].progress.label,'0/3');assert.equal(h.stats.checks.length,0);
});

test('目标已存在但藏在两层折叠章节时，依次展开祖先再点击；不展开无关章节',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false,chapters:[
  {key:'无关章节',ids:[]},
  {key:'外层章节',preloaded:true,plainHeader:true},
  {key:'内层章节',parent:'外层章节',ids:['r1'],preloaded:true,plainHeader:true}
 ]});await h.ready();await h.end();await h.ready();
 assert.deepEqual(h.stats.chapters,['外层章节','内层章节']);assert.deepEqual(h.stats.sidebar,['r1']);assert.equal(h.current,'r1');
});

test('手风琴章节切换且请求较慢时，能重新展开已加载目标的章节',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false,accordion:true,chapters:[
  {key:'目标章节',ids:['r1'],delay:15000},
  {key:'空章节',ids:[]}
 ]});await h.ready();await h.end();await h.ready();
 assert.deepEqual(h.stats.chapters,['目标章节','空章节','目标章节']);assert.deepEqual(h.stats.sidebar,['r1']);assert.equal(h.state.running,true);
});

test('章节点击无效且节点重复重建时不反复点击，超时保留窗口和诊断',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false,chapters:[{key:'加载失败的章节',ids:['r1'],noop:true}]});
 await h.ready();await h.end();await h.until(s=>!s.running);
 assert.deepEqual(h.stats.chapters,['加载失败的章节']);assert.deepEqual(h.stats.sidebar,[]);assert.deepEqual(h.stats.closed,[]);
 assert.match(h.state.status,/等待目录加载后仍未找到目标视频/);assert.equal(h.state.batch.attempts.length,1);
 const diagnostic=(await h.ping()).sidebar;
 assert.equal(diagnostic.stage,'stopped');assert.equal(diagnostic.expandedCount,1);assert.equal(diagnostic.chapterClicks,1);assert.equal(diagnostic.matchedTarget,false);
 assert.equal(h.stats.checks.length,0);assert.equal(h.cache.courses[0].progress.label,'0/2');
 await h.playerOnly();assert.equal((await h.ping()).sidebar.elapsedMs,diagnostic.elapsedMs);
});

test('章节仍在加载时点击停止，后续加载完成也不会继续展开或播放',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false,chapters:[{key:'慢章节',ids:['r1'],delay:20000}]});
 await h.ready();await h.end();await h.playerOnly();await h.call({type:'STOP',reason:'用户停止'});
 for(let i=0;i<6;i++)await h.playerOnly();
 assert.equal(h.state.running,false);assert.deepEqual(h.stats.sidebar,[]);assert.deepEqual(h.stats.chapters,['慢章节']);
 assert.equal(h.state.batch.attempts.length,1);assert.match(h.panel,/用户停止/);assert.equal((await h.ping()).sidebar.stage,'stopped');
});

test('右侧目录初始未加载时保留等待机会，而非立即停止',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false});await h.ready();h.missingSidebar='r1';await h.end();
 await h.playerOnly();await h.playerOnly();assert.equal(h.state.running,true);assert.deepEqual(h.stats.sidebar,[]);
 h.missingSidebar=null;await h.ready();assert.deepEqual(h.stats.sidebar,['r1']);assert.equal(h.current,'r1');
});

test('遍历大量章节仍无目标时，120秒上限会终止查找',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false,chapters:Array.from({length:40},(_,i)=>({key:'空章节'+i,ids:[]}))});
 await h.ready();h.missingSidebar='r1';await h.end();await h.until(s=>!s.running);
 assert.match(h.state.status,/查找超过 120 秒/);assert.equal(new Set(h.stats.chapters).size,h.stats.chapters.length);
 assert.deepEqual(h.stats.sidebar,[]);assert.equal(h.state.batch.attempts.length,1);assert.deepEqual(h.stats.closed,[]);
});

test('仅实际核对阶段显示本批结束，读取补播目录时显示准备队列',async()=>{
 const h=await setup({counts:[0,0,1],total:1,resources:1,second:false});await h.ready();await h.end();
 await h.playerOnly();assert.equal(h.state.phase,'verify');assert.match(h.panel,/本批结束/);
 await h.mainOnly();await h.mainOnly();assert.equal(h.state.phase,'catalog');await h.playerOnly();
 assert.match(h.panel,/正在读取课程目录/);assert.doesNotMatch(h.panel,/本批结束/);
});

test('播放器右侧空章节提示自动确认后继续展开下一章，不计为视频尝试',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false,chapters:[
  {key:'空章节',ids:[],empty:true},{key:'视频章节',ids:['r1']}
 ]});await h.ready();await h.end();await h.ready();
 assert.deepEqual(h.stats.chapters,['空章节','视频章节']);assert.deepEqual(h.stats.nativeAlerts,[]);
 assert.deepEqual(h.stats.sidebar,['r1']);assert.equal((await h.ping()).emptyChaptersSkipped,1);
 assert.equal(h.state.batch.attempts.length,1);assert.equal(h.state.running,true);assert.equal(h.cache.courses[0].progress.label,'0/2');
});

for(const preloaded of [false,true])test('真实播放器结构：无标题的章节'+(preloaded?'保留UL但隐藏全部LI':'未点击前没有UL')+'时仍会展开',async()=>{
 const h=await setup({counts:[0,2],total:2,resources:2,second:false,chapters:[
  {key:'52984',ids:['r0'],sitePlayer:true,open:true},
  {key:'52972',ids:['r1'],sitePlayer:true,preloaded,delay:3000}
 ]});await h.ready();await h.end();await h.playerOnly();
 assert.deepEqual(h.stats.chapters,['52972'],'已经展开的第五章不能被再次点击收起');
 const diagnostic=(await h.ping()).sidebar;
 assert.equal(diagnostic.chapterCount,2);assert.equal(diagnostic.unloadedChapters,preloaded?0:1);
 assert.equal(diagnostic.collapsedChapters,1);assert.equal(diagnostic.expandedCount,1);
 await h.ready();assert.deepEqual(h.stats.sidebar,['r1']);assert.equal(h.state.batch.attempts.length,1);
 assert.equal(h.current,'r1');assert.equal(h.state.running,true);assert.deepEqual(h.stats.closed,[]);
});
