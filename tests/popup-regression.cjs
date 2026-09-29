const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

async function popupHarness(initial,{backendError=false,pageError=false,pageData={},homework={version:'1.6.1'},savedSection}={}){
 const exports=[],clicks=[],messages=[],clock={now:1800000000000},stored={popupSection:savedSection};
 const configured=value=>({...value,settings:{baseUrl:'https://models.example/v1',model:'custom-chat',hasKey:true,ready:true,...value.settings}});
 let state=initial,hw=configured(homework);
 const d=new JSDOM(fs.readFileSync('extension/popup.html','utf8'),{url:'https://extension.test/popup.html',runScripts:'outside-only'}),w=d.window;
 const get=id=>w.document.getElementById(id);
 w.HTMLAnchorElement.prototype.click=function(){clicks.push(this.download);};
 class TestDate extends Date{static now(){return clock.now;}}
 class TestBlob{constructor(parts){this.text=parts.join('');}}
 class TestURL extends URL{static createObjectURL(blob){exports.push(JSON.parse(blob.text));return 'blob:local-test';}static revokeObjectURL(){}}
 const permissionRequests=[];const chrome={permissions:{request:async request=>{permissionRequests.push(request);return true;}},storage:{local:{get:async()=>stored,set:async value=>Object.assign(stored,value)}},runtime:{getManifest:()=>({version:'1.6.1'}),sendMessage:async m=>{messages.push(m);if(backendError)throw Error('后台未连接');if(m.type==='GET')return structuredClone(state);if(m.type==='HW_GET')return structuredClone(hw);if(m.type==='UI_TARGET')return {tabId:9};if(m.type==='SCAN_ALL')hw={...hw,running:true,scanning:true,unifiedScan:true};if(m.type==='HW_STOP')hw={...hw,running:false};if(m.type==='HW_MODELS')return {baseUrl:m.baseUrl,models:['custom-chat','new-chat']};if(m.type==='HW_SETTINGS')hw={...hw,settings:{baseUrl:m.baseUrl,model:m.model,hasKey:true,ready:true}};if(m.type==='HW_CLEAR_SETTINGS')hw={...hw,settings:{ready:false,hasKey:false}};return {ok:true};}},tabs:{
  query:async()=>[{id:9,url:'https://teach.ynou.edu.cn/webindex.action?secret=not-for-export'}],
  sendMessage:async()=>{if(pageError)throw Error('页面脚本未连接');return {ready:true,version:'1.6.1',userKey:'private-account',...pageData};}
 }};
 Object.assign(w,{chrome,Blob:TestBlob,URL:TestURL,Date:TestDate,
  setInterval:()=>0,setTimeout:(fn,ms)=>ms===10000?0:setTimeout(fn,ms),clearTimeout
 });w.eval(fs.readFileSync('extension/homework-model.js','utf8'));w.eval(fs.readFileSync('extension/popup.js','utf8'));
 await new Promise(resolve=>setImmediate(resolve));
 return {get,exports,clicks,messages,clock,stored,permissionRequests,chrome,window:w,refresh:()=>w.refresh(),set state(value){state=value;},set homework(value){hw=configured(value);},async export(){await get('exportDiagnosis').onclick();return exports.at(-1);}};
}

test('导出重新读取当前停止状态，旧历史保留版本，文件名使用本次导出时间',async()=>{
 const old={version:'1.2.5',at:1000,events:[{at:800,kind:'media-ended'}]};
 const h=await popupHarness({buildVersion:'1.6.1',running:true,phase:'catalog',status:'旧的弹窗快照',diagnosis:old});
 h.state={buildVersion:'1.6.1',running:false,phase:'catalog',status:'刚刚停止',logs:[{at:1500,text:'停止原因'}],userKey:'private-account',
  cache:{scannedAt:100,updatedAt:200,userKey:'private-account',courses:[{}]},diagnosis:old};
 const exported=await h.export();
 assert.equal(exported.runtime.running,false);assert.equal(exported.runtime.status,'刚刚停止');assert.equal(exported.runtime.phase,'catalog');
 assert.equal(exported.version,'1.6.1');assert.equal(exported.versions.background,'1.6.1');assert.equal(exported.pages[0].contentVersion,'1.6.1');
 assert.equal(exported.events[0].version,'1.2.5');assert.equal(exported.historyLastEventAt,1000);assert.equal(exported.exportedAt,h.clock.now);
 assert.ok(h.clicks[0].includes(new Date(h.clock.now).toISOString().replace(/[:.]/g,'-')));
 assert.doesNotMatch(JSON.stringify(exported),/private-account|not-for-export|userKey/);
 h.clock.now+=5000;await h.export();assert.notEqual(h.clicks[0],h.clicks[1]);
});

test('没有历史视频事件也能导出当前状态',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',running:false,status:'尚未开始'});
 const exported=await h.export();
 assert.equal(exported.runtime.status,'尚未开始');assert.equal(exported.events.length,0);assert.equal(exported.historyVersion,null);
 assert.equal(exported.pages[0].connected,true);assert.equal(h.get('exportDiagnosis').disabled,false);
});

test('旧后台不能被弹窗版本冒充，阻止继续启动并允许导出版本差异',async()=>{
 const h=await popupHarness({running:false,status:'已停止',cache:{courses:[{}]}});
 assert.equal(h.get('start').disabled,true);assert.equal(h.get('scan').disabled,true);
 assert.match(h.get('versionNote').textContent,/版本不一致/);
 const exported=await h.export();assert.equal(exported.versions.background,null);assert.equal(exported.versions.popup,'1.6.1');
});

test('后台或页面未连接时仍可导出失败信息，不依赖成功播放',async()=>{
 const h=await popupHarness({}, {backendError:true,pageError:true});
 const exported=await h.export();
 assert.equal(exported.runtime,null);assert.match(exported.runtimeError,/后台未连接/);
 assert.equal(exported.pages[0].connected,false);assert.match(exported.pages[0].error,/页面脚本未连接/);
 assert.equal(h.get('exportDiagnosis').disabled,false);
});

test('导出章节查找阶段与空章节跳过次数，仅保留必要诊断字段',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',running:false,status:'目录加载失败'},{pageData:{emptyChaptersSkipped:2,sidebar:{stage:'stopped',elapsedMs:25000,expandedCount:3,chapterClicks:4,videoCount:10,visibleVideos:2,collapsedChapters:5,matchedTarget:false,raw:'private-value'}}});
 const exported=await h.export();
 assert.deepEqual(exported.pages[0].sidebar,{stage:'stopped',elapsedMs:25000,expandedCount:3,chapterClicks:4,videoCount:10,visibleVideos:2,chapterCount:null,unloadedChapters:null,collapsedChapters:5,matchedTarget:false});
 assert.equal(exported.pages[0].emptyChaptersSkipped,2);assert.doesNotMatch(JSON.stringify(exported),/private-value/);
});

test('导出后台目录进度和页面最后唤醒时间，过滤附加页面内容',async()=>{
 const counts={expanded:3,total:20,videos:12,eligible:1,visibility:'hidden',private:'private-value'};
 const h=await popupHarness({buildVersion:'1.6.1',status:'正在读取目录',catalogProgress:{...counts,stage:'collecting',at:10000}},
  {pageData:{pageActivity:{visibility:'hidden',lastTickAt:9990,lastWakeAt:9980,busy:false,catalog:counts,private:'private-value'}}});
 const result=await h.export();
 assert.deepEqual(result.runtime.catalogProgress,{expanded:3,total:20,videos:12,eligible:1,visibility:'hidden',stage:'collecting',at:10000});
 assert.equal(result.pages[0].pageActivity.lastWakeAt,9980);assert.equal(result.pages[0].pageActivity.busy,false);
 assert.equal(result.pages[0].pageActivity.catalog.eligible,1);assert.doesNotMatch(JSON.stringify(result),/private-value/);
});

const videoCache={userKey:'private-account',scannedAt:100,courses:[{url:'https://teach.ynou.edu.cn/course?courseId=1&classId=1',title:'课程 10',progress:{current:40,total:40}}]};
const homeworkCache={...videoCache,courses:[{...videoCache.courses[0],progress:{current:2,total:40},homework:{current:1,total:4}}]};
test('两个模式共用一个独立扫描按钮，作业页仅开始与停止，扫描中互斥并可随时停止',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:homeworkCache}});
 assert.equal(h.window.document.querySelectorAll('#scan').length,1);assert.equal(h.get('homeworkSection').contains(h.get('scan')),false);
 assert.equal(h.get('homeworkSection').querySelectorAll('button').length,2);assert.equal(h.get('homeworkScan'),null);
 assert.equal(h.get('homeworkStart').disabled,false);assert.equal(h.get('start').disabled,false);
 await h.get('scan').onclick();assert.ok(h.messages.some(m=>m.type==='SCAN_ALL'&&m.tabId===9));assert.ok(!h.messages.some(m=>['HW_SCAN','SCAN'].includes(m.type)));
 assert.equal(h.get('scanLabel').textContent,'停止扫描');assert.equal(h.get('scan').disabled,false);assert.equal(h.get('start').disabled,true);assert.equal(h.get('homeworkStart').disabled,true);
 await h.get('scan').onclick();assert.ok(h.messages.some(m=>m.type==='HW_STOP'));assert.equal(h.get('scanLabel').textContent,'扫描全部课程');
 h.homework={version:'1.6.1',running:false,scanning:true,phase:'stopped',status:'视频进度未加载，原缓存保留。',cache:homeworkCache};await h.refresh();assert.equal(h.get('actionNotice').hidden,false);assert.match(h.get('actionNotice').textContent,/原缓存保留/);
});
test('扫描先取得关联教学首页，恢复窗口大小不发送停止或启动任务',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:homeworkCache}});
 await h.get('scan').onclick();const target=h.messages.findIndex(m=>m.type==='UI_TARGET'),scan=h.messages.findIndex(m=>m.type==='SCAN_ALL');assert.ok(target>=0&&scan>target);assert.equal(h.messages[scan].tabId,9);
 const before=h.messages.length;await h.get('resetWindowSize').onclick();assert.ok(h.messages.slice(before).some(m=>m.type==='UI_RESET_SIZE'));assert.ok(!h.messages.slice(before).some(m=>/^(HW_)?(START|STOP)$/.test(m.type)));
});
test('未配置仅禁用网上作业；输入API和Key自动读取模型列表，选择保存后启用，清除后禁用',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:homeworkCache,settings:{baseUrl:'',model:'',hasKey:false,ready:false}}});
 assert.equal(h.get('homeworkStart').disabled,true);assert.equal(h.get('scan').disabled,false);assert.equal(h.get('start').disabled,false);assert.match(h.get('homeworkStatus').textContent,/模型设置/);
 h.get('homeworkApi').value='https://custom.example/v1';h.get('homeworkKey').value='test-custom-key';await h.get('homeworkFetchModels').onclick();
 assert.equal(h.get('homeworkAvailable').options.length,3);assert.equal(h.get('homeworkStart').disabled,true);assert.equal(h.permissionRequests[0].origins[0],'https://custom.example/*');
 h.get('homeworkAvailable').value='new-chat';h.get('homeworkAvailable').onchange();assert.equal(h.get('homeworkModel').value,'new-chat');await h.get('homeworkSave').onclick();assert.equal(h.get('homeworkStart').disabled,false);assert.equal(h.get('homeworkKey').value,'');
 await h.get('homeworkClear').onclick();assert.equal(h.get('homeworkStart').disabled,true);assert.equal(h.get('homeworkApi').value,'');assert.equal(h.get('homeworkModel').value,'');assert.equal(h.get('start').disabled,false);
});
test('不同API留空Key时不发请求，权限拒绝不获取不保存，获取失败可手动填模型',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:homeworkCache}});
 h.get('homeworkApi').value='https://new.example/v1';await h.get('homeworkFetchModels').onclick();assert.equal(h.permissionRequests.length,0);assert.match(h.get('actionNotice').textContent,/重新填写/);
 h.get('homeworkKey').value='new-key';h.chrome.permissions.request=async()=>false;await h.get('homeworkFetchModels').onclick();assert.ok(!h.messages.some(m=>m.type==='HW_MODELS'));assert.match(h.get('actionNotice').textContent,/未授权/);
 h.chrome.permissions.request=async()=>true;h.get('homeworkModel').value='manually-added-v2';await h.get('homeworkSave').onclick();assert.equal(h.messages.find(m=>m.type==='HW_SETTINGS').model,'manually-added-v2');
});
test('进度列表按当前选项只显示一种进度，轮询不重建，切换保留偏好并支持键盘',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:homeworkCache}});
 assert.equal(h.get('homeworkSection').hidden,false);assert.match(h.get('courseList').textContent,/1\/4/);assert.doesNotMatch(h.get('courseList').textContent,/视频|40\/40|2\/40/);assert.equal(h.get('courseProgressTitle').textContent,'网上作业进度');
 const first=h.get('courseList').firstChild;h.get('courseDetails').open=true;await h.refresh();assert.equal(h.get('courseList').firstChild,first);assert.equal(h.get('courseDetails').open,true);
 h.get('homeworkTab').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(h.get('videoSection').hidden,false);assert.equal(h.stored.popupSection,'video');assert.equal(h.get('videoTab').getAttribute('aria-selected'),'true');
 assert.match(h.get('courseList').textContent,/40\/40/);assert.doesNotMatch(h.get('courseList').textContent,/网上作业|1\/4|2\/40/);assert.equal(h.get('cacheSummary').textContent,'视频 1/1 科达标');
 h.get('homeworkTab').click();assert.match(h.get('courseList').textContent,/1\/4/);assert.doesNotMatch(h.get('cacheSummary').textContent,/视频/);
});
test('不同账号的两类缓存不拼接到一门课程，数据缺失明确要求重新扫描',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:{...homeworkCache,userKey:'another-account'}}});
 assert.match(h.get('courseList').textContent,/1\/4/);assert.doesNotMatch(h.get('courseList').textContent,/40\/40/);h.get('videoTab').click();assert.match(h.get('courseList').textContent,/40\/40/);assert.doesNotMatch(h.get('courseList').textContent,/1\/4/);
});
test('当前模式没有缓存时显示待扫描，不借用另一模式的课程或进度',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache});assert.match(h.get('courseList').textContent,/暂无网上作业缓存/);assert.doesNotMatch(h.get('courseList').textContent,/课程 10|40\/40/);
 h.get('videoTab').click();assert.match(h.get('courseList').textContent,/40\/40/);
});

test('三类进度总览同时可见，离线提交数不添加到平台0/4，详情显示待批改及未提交',async()=>{
 const offline={quota:{current:0,total:4},catalogComplete:true,items:[{id:'a',title:'第10章',status:'pending',statusText:'已提交'},{id:'b',title:'第2章',status:'unsubmitted'},{id:'c',title:'第1章',status:'pending'},{id:'d',title:'第3章',status:'pending'}]};
 const hw={version:'1.6.1',cache:{...homeworkCache,courses:[{...homeworkCache.courses[0],offline}]}};
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:hw,savedSection:'offline'});
 assert.equal(h.get('offlineSection').hidden,false);assert.equal(h.get('homeworkSection').hidden,true);assert.match(h.get('videoOverview').textContent,/40\/40/);assert.match(h.get('homeworkOverview').textContent,/1\/4/);assert.match(h.get('offlineOverview').textContent,/0\/4/);assert.match(h.get('overviewHint').textContent,/待批改 3/);
 assert.match(h.get('courseList').textContent,/目录已提交 3/);assert.match(h.get('courseList').textContent,/已提交待批改 3/);assert.match(h.get('courseList').textContent,/未提交 1/);assert.equal(h.get('offlineOverview').querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'0');
 const items=Array.from(h.get('courseList').querySelectorAll('.offline-item')).map(e=>e.textContent);assert.ok(items[0].startsWith('第10章'));assert.ok(items[1].startsWith('第2章'));assert.equal(h.get('offlineSection').querySelectorAll('button').length,0);
 h.get('offlineTab').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(h.get('videoSection').hidden,false);assert.equal(h.stored.popupSection,'video');
});

test('离线目录未扫描显示缺失、空目录不猜已完成，提交达到数量后仍明确等待批改核对',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:homeworkCache},savedSection:'offline'});
 assert.match(h.get('courseList').textContent,/尚未读取提交状态/);assert.match(h.get('offlineOverview').textContent,/待扫描/);assert.equal(h.get('homeworkStart').disabled,false);
 const offline={quota:{current:0,total:1},catalogComplete:true,items:[]};h.homework={version:'1.6.1',cache:{...homeworkCache,courses:[{...homeworkCache.courses[0],offline}]}};await h.refresh();assert.match(h.get('courseList').textContent,/未找到离线条目/);
 offline.items=[{title:'<img onerror=alert(1)>',status:'pending'},{title:'第二份',status:'returned'}];await h.refresh();assert.match(h.get('courseList').textContent,/提交数量已达到要求，等待批改及本期进度核对/);assert.equal(h.get('courseList').querySelector('img'),null);assert.match(h.get('courseList').textContent,/已退回 1/);
 await h.get('homeworkExport').onclick();assert.deepEqual(h.exports.at(-1).offline[0].counts,{total:2,submitted:1,pending:1,graded:0,unsubmitted:0,returned:1,unknown:0});assert.doesNotMatch(JSON.stringify(h.exports.at(-1)),/onerror|第二份/);
});
test('作业运行时阻止视频和扫描，设置折叠且已输入的模型设置不被轮询覆盖',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1',cache:videoCache},{homework:{version:'1.6.1',cache:homeworkCache,settings:{hasKey:true,model:'MiniMax-M2.7'}}});
 h.get('homeworkModel').value='MiniMax-M2.5';h.get('homeworkKey').value='sk-typing';await h.refresh();assert.equal(h.get('homeworkModel').value,'MiniMax-M2.5');assert.equal(h.get('homeworkKey').value,'sk-typing');assert.equal(h.get('settingsDetails').open,false);
 h.homework={version:'1.6.1',running:true,phase:'thinking',cache:homeworkCache};await h.refresh();assert.equal(h.get('scan').disabled,true);assert.equal(h.get('start').disabled,true);assert.equal(h.get('homeworkStop').disabled,false);assert.equal(h.get('homeworkSave').disabled,true);
});
test('作业诊断导出排除题目、答案、账号、原始链接与密钥',async()=>{
 const h=await popupHarness({buildVersion:'1.6.1'},{homework:{version:'1.6.1',userKey:'private-account',settings:{model:'MiniMax-M2.7',hasKey:true,apiKey:'sk-private-SECRET'},questions:[{text:'private-question'}],answers:['private-answer'],pending:{title:'一章',url:'private-url',paperId:'private-paper',token:1},cache:homeworkCache}});
 await h.get('homeworkExport').onclick();assert.equal(h.exports.at(-1).version,'1.6.1');assert.doesNotMatch(JSON.stringify(h.exports.at(-1)),/private-account|SECRET|private-question|private-answer|private-url|private-paper/);
});

test('分组状态和失败作业可导出，额外题目内容及答案不进入诊断',async()=>{
 const modelProgress={kind:'answer',group:2,groups:4,done:12,total:42,attempt:2,questions:'private-question'};
 const failedPapers=[{title:'试题四',course:'软件工程',reason:'本组超时',at:100,answers:'private-answer'}];
 const h=await popupHarness({buildVersion:'1.6.1'},{homework:{version:'1.6.1',modelProgress,failedPapers}});await h.get('homeworkExport').onclick();
 assert.deepEqual(h.exports.at(-1).modelProgress,{kind:'answer',group:2,groups:4,done:12,total:42,attempt:2});
 assert.deepEqual(h.exports.at(-1).failedPapers,[{title:'试题四',course:'软件工程',reason:'本组超时',at:100}]);assert.doesNotMatch(JSON.stringify(h.exports.at(-1)),/private-question|private-answer/);
});

test('复核暂停时开始按钮变为继续，发送恢复指令并导出疑问题号，视频运行时禁止继续',async()=>{
 const homework={version:'1.6.1',phase:'review',running:false,canResume:true,uncertainQuestions:[21],reviewCount:1,status:'第 21 题复核后仍有疑问',logs:[{at:1,text:'等待复核'}],courses:[{title:'软件工程'}],courseIndex:0};
 const h=await popupHarness({buildVersion:'1.6.1'},{homework});
 assert.equal(h.get('homeworkStart').disabled,false);assert.match(h.get('homeworkStart').textContent,/重新检查并继续/);assert.equal(h.get('homeworkState').textContent,'待复核');assert.equal(h.get('homeworkTitle').textContent,'软件工程');
 await h.get('homeworkStart').onclick();assert.ok(h.messages.some(m=>m.type==='HW_RESUME'));assert.equal(h.messages.some(m=>m.type==='HW_START'),false);
 await h.get('homeworkExport').onclick();assert.deepEqual(h.exports.at(-1).review,{canResume:true,count:1,questions:[21]});
 h.state={buildVersion:'1.6.1',running:true};await h.refresh();assert.equal(h.get('homeworkStart').disabled,true);
 h.state={buildVersion:'1.6.1'};h.homework={version:'1.6.1',phase:'done',canResume:false};await h.refresh();assert.match(h.get('homeworkStart').textContent,/使用缓存开始作业/);
});
