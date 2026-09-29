importScripts('logic.js');
let serial=Promise.resolve();
const VERSION='1.6.1',MONITOR='ynou-local-window-check',CONTACT_TIMEOUT=180000;
let monitorKnown=false;
let mainWakeTimer=null;
const MAIN_PHASES=new Set(['home','info','catalog','verify','batchInfo','skipCourse','scanHome','scanInfo']);
function scheduleMainWake(s,delay=1500){
 if(!s.running||s.tabId==null||!MAIN_PHASES.has(s.phase)){if(mainWakeTimer!==null)clearTimeout(mainWakeTimer);mainWakeTimer=null;return;}
 if(mainWakeTimer!==null)return;
 // Each wake is an extension message, independent of the hidden page's timers.
 // The existing persistent alarm re-arms this short-lived scheduler after worker suspension.
 mainWakeTimer=setTimeout(()=>{
  mainWakeTimer=null;
  serial=serial.then(async()=>{
   const live=await read();if(!live.running||live.tabId==null||!MAIN_PHASES.has(live.phase)){scheduleMainWake(live);return;}
   const reply=await messageTab(live.tabId,{type:'WAKE_MAIN'}).catch(()=>null);
   scheduleMainWake(await read(),reply?.ready?1500:10000);
  }).catch(()=>{});
 },delay);
}
async function syncMonitor(running){
 if(!running){await chrome.alarms.clear(MONITOR);monitorKnown=false;return;}
 if(!monitorKnown){if(!await chrome.alarms.get(MONITOR))await chrome.alarms.create(MONITOR,{periodInMinutes:1});monitorKnown=true;}
}
async function messageTab(id,message){
 let timer;
 try{return await Promise.race([chrome.tabs.sendMessage(id,message,{frameId:0}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('页面连接超时')),2000);})]);}
 finally{clearTimeout(timer);}
}
async function read(){return (await chrome.storage.session.get('run')).run||{running:false,status:'尚未开始',logs:[]};}
async function save(s,diagnosticStatus){
 await syncMonitor(s.running);
 await chrome.storage.session.set({run:s});
 if(s.diagnostics?.length){
  const old=(await chrome.storage.local.get('lastDiagnosis')).lastDiagnosis;
  const identity=e=>e.eventId||[e.at,e.kind,e.tabId??''].join(':');
  const merged=new Map((old?.events||[]).map(e=>[identity(e),e]));let added=false;
  for(const event of s.diagnostics)if(!merged.has(identity(event))){merged.set(identity(event),event);added=true;}
  if(added){const events=[...merged.values()].sort((a,b)=>a.at-b.at).slice(-240);await chrome.storage.local.set({lastDiagnosis:{version:VERSION,at:events.at(-1).at,status:diagnosticStatus||s.status,events}});}
 }
 scheduleMainWake(s);return s;
}
function log(s,text){s.status=text;s.logs=[...(s.logs||[]),{at:Date.now(),text}].slice(-60);}
function diagnose(s,kind,detail={}){s.diagnostics=[...(s.diagnostics||[]),{eventId:Date.now()+'-'+Math.random().toString(36).slice(2),at:Date.now(),version:VERSION,kind,...detail}].slice(-160);}
function markerData(data){
 const result={keyTag:typeof data.keyTag==='string'&&/^[0-9a-f]{1,8}$/.test(data.keyTag)?data.keyTag:'unknown',category:data.category==='progress-cache'?'progress-cache':'playback'};
 result.value=typeof data.value==='boolean'||(Number.isInteger(data.value)&&data.value>=0&&data.value<=99)?data.value:'[redacted]';
 if(['cookie','localStorage','sessionStorage'].includes(data.area))result.area=data.area;
 return result;
}
function diagnosticData(data){
 const result={};
 if(typeof data.stack==='string')result.stack=data.stack.slice(0,2500).replace(/https?:\/\/[^\s)]+/g,url=>url.includes('?')?url.split('?')[0]+(url.match(/:[0-9]+:[0-9]+$/)?.[0]||''):url);
 for(const key of ['time','duration','status','pageAt','videoCount'])if(Number.isFinite(data[key]))result[key]=data[key];
 for(const key of ['persisted','expired','cookieObserved','storageObserved'])if(typeof data[key]==='boolean')result[key]=data[key];
 if(typeof data.unloadAllowed==='boolean')result.unloadAllowed=data.unloadAllowed;
 if(typeof data.browser==='string')result.browser=data.browser.replace(/[^A-Za-z0-9./ ]/g,'').slice(0,100);
 if(typeof data.errorName==='string'&&/^[A-Za-z]+Error$|^Error$/.test(data.errorName))result.errorName=data.errorName.slice(0,50);
 if(['visible','hidden'].includes(data.visibility))result.visibility=data.visibility;
 if(typeof data.path==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(data.path))result.path=data.path.slice(0,300);
 if(data.keyTag)Object.assign(result,markerData(data));
 if(Array.isArray(data.markers))result.markers=data.markers.slice(0,30).map(markerData);
 return result;
}
async function adoptVideo(s,sender){
 if(!s.running||s.phase!=='video'||!s.pending||s.videoTabId||!sender.tab||sender.frameId>0||!CourseLogic.trusted(sender.url))return false;
 const u=new URL(sender.url),course=s.courses[s.courseIndex];
 if(u.pathname!=='/play/playVideo.action'||u.searchParams.get('ksId')!==s.pending.id||!course?.url)return false;
 const c=new URL(course.url);
 if(!['courseId','classId'].every(k=>c.searchParams.get(k)&&c.searchParams.get(k)===u.searchParams.get(k)))return false;
 if(!s.opening||Date.now()-s.opening.at>60000||s.opening.existingIds.includes(sender.tab.id))return false;
 const t=await chrome.tabs.get(sender.tab.id);
 // target=_blank may have noopener; do not require an opener that Chrome omitted.
 if(t.openerTabId!=null&&t.openerTabId!==s.tabId)return false;
 const active=await videoTabs();
 if(active.some(v=>v.id!==t.id))return false;
 s.videoTabId=t.id;s.lastContact={...(s.lastContact||{}),player:Date.now()};
 diagnose(s,'video-registered',{tabId:t.id,openerTabId:t.openerTabId??null});
 await save(s);return true;
}
async function pauseOwned(s){await Promise.all([s.tabId,s.videoTabId].filter(Boolean).map(id=>messageTab(id,{type:'PAUSE',reason:s.status}).catch(()=>{})));}
async function videoTabs(){return (await chrome.tabs.query({url:'https://teach.ynou.edu.cn/*'})).filter(t=>{try{return new URL(t.url).pathname==='/play/playVideo.action';}catch{return false;}});}
function releaseRegistration(s,id,cause){
 const main=s.tabId===id,player=s.videoTabId===id,closing=s.closingVideoTabId===id,observed=s.observedVideoTabIds?.includes(id);
 if(!main&&!player&&!closing&&!observed)return false;
 diagnose(s,'local-window-released',{tabId:id,cause,scope:main||player||closing?'automation':'manual'});
 s.lastContact={...(s.lastContact||{})};
 if(main){s.tabId=null;delete s.lastContact.main;}
 if(player){s.videoTabId=null;delete s.lastContact.player;}
 if(closing){s.closingVideoTabId=null;if(!s.videoTabId)delete s.lastContact.player;}
 if(player||closing||observed){
  s.waitUntil=Math.max(s.waitUntil||0,Date.now()+20000);
  s.lastLocalRelease={at:Date.now(),tabId:id,cause,platformReleased:null};
 }
 s.observedVideoTabIds=(s.observedVideoTabIds||[]).filter(value=>value!==id);
 if(main||player){
  s.running=false;s.pending=null;s.opening=null;s.queue=[];s.phase='idle';
  if(!s.platformBlocked)log(s,main?'连播首页已关闭或离开平台，已停止。现有视频请在播放器中确认。':'视频窗口已关闭或离开播放器，旧登记已清理，连播已停止。平台播放状态仍需确认。');
 }
 return true;
}
async function reconcileWindows(s){
 const wasRunning=s.running;
 const ids=[s.tabId,s.videoTabId,s.closingVideoTabId,...(s.observedVideoTabIds||[])].filter(id=>id!=null);
 if(!ids.length)return;
 // Only retain metadata for known tabs; never infer closure from a timed-out message.
 const tabs=new Map((await chrome.tabs.query({})).filter(tab=>ids.includes(tab.id)).map(tab=>[tab.id,tab]));
 let changed=false;
 for(const id of new Set(ids)){
  const tab=tabs.get(id),owned=s.tabId===id||s.videoTabId===id;
  const expected=s.tabId===id?'/webindex.action':'/play/playVideo.action';
  if(!tab)changed=releaseRegistration(s,id,'tab-missing')||changed;
  else if(owned&&(!CourseLogic.trusted(tab.url)||new URL(tab.url).pathname!==expected))changed=releaseRegistration(s,id,'page-left')||changed;
 }
 if(changed){await save(s);if(wasRunning&&!s.running)await pauseOwned(s);}
}
async function watchdog(){
 const s=await read();await reconcileWindows(s);
 if(!s.running){await syncMonitor(false);return;}
 let changed=false;
 for(const [role,id] of [['main',s.tabId],['player',s.videoTabId]]){
  if(id==null)continue;
  s.lastContact={...(s.lastContact||{})};
  if(!s.lastContact[role]){s.lastContact[role]=Date.now();changed=true;continue;}
  if(Date.now()-s.lastContact[role]<CONTACT_TIMEOUT)continue;
  const reply=await messageTab(id,{type:'PING'}).catch(()=>null);
  if(reply?.ready&&reply.version===VERSION){s.lastContact[role]=Date.now();changed=true;continue;}
  // A tab that still exists remains registered. A failed heartbeat is not permission to open another player.
  s.running=false;s.pending=null;s.opening=null;s.queue=[];s.phase='idle';
  log(s,(role==='player'?'播放器':'课程首页')+'超过 3 分钟没有消息且连接检查失败，已停止连播。现有窗口保留，请确认页面状态。');
  diagnose(s,'local-connection-timeout',{tabId:id,role});await save(s);await pauseOwned(s);return;
 }
 if(changed)await save(s);
 // Re-arm independently on the persistent alarm, including after a delayed short timer.
 if(mainWakeTimer!==null)clearTimeout(mainWakeTimer);mainWakeTimer=null;
 scheduleMainWake(s);
}
async function closeVideo(s){
 const id=s.videoTabId;if(!id)return;
 await messageTab(id,{type:'PAUSE'}).catch(()=>{});
 s.videoTabId=null;s.closingVideoTabId=id;s.waitUntil=Date.now()+20000;
 diagnose(s,'extension-close-request',{tabId:id});await save(s);
 try{await chrome.tabs.remove(id);}
 catch(error){
  const inventory=await chrome.tabs.query({}).catch(()=>null);
  if(!inventory||inventory.some(tab=>tab.id===id)){s.videoTabId=id;s.closingVideoTabId=null;s.running=false;log(s,'视频窗口未能关闭或无法确认关闭，已停止切换科目。');diagnose(s,'extension-close-failed',{tabId:id});await save(s);await pauseOwned(s);throw Error('视频窗口未能关闭或无法确认关闭，已停止切换科目。');}
  releaseRegistration(s,id,'close-already-completed');diagnose(s,'close-already-completed',{tabId:id});await save(s);
 }
}
async function selectVideo(s,next){
 if(!s.scanComplete||!CourseLogic.plan(s.courses).ready)throw Error('全部科目的视频进度尚未扫描完成，不能开始播放。');
 if(!s.batch||s.batch.courseUrl!==s.courses[s.courseIndex]?.url||CourseLogic.batchDue(s.batch))throw Error('当前播放批次尚未准备好，或已经需要核对进度。');
 if(!next?.id||s.batch.attempts.some(a=>a.id===next.id))throw Error('不能重复打开本批已经尝试的视频。');
 if(!s.videoTabId){
  if((await videoTabs()).length)throw Error('已有课程视频窗口，已停止打开新窗口。');
  if(Date.now()<(s.waitUntil||0))throw Error('上一视频刚关闭，请等待插件的关闭间隔结束。该间隔不代表平台已经释放播放状态。');
  s.opening={at:Date.now(),existingIds:(await chrome.tabs.query({url:'https://teach.ynou.edu.cn/*'})).map(t=>t.id)};
  diagnose(s,'video-open-request',{resourceId:next.id});
 }
 s.pending={id:next.id,title:next.title,token:(s.sequence||0)+1};s.sequence=s.pending.token;
 s.phase=s.videoTabId?'switchVideo':'video';s.switchStartedAt=Date.now();
 if(s.videoTabId)diagnose(s,'sidebar-switch-request',{tabId:s.videoTabId,resourceId:next.id,token:s.pending.token});
}
function verifyBatch(s){s.pending=null;s.phase='verify';diagnose(s,'batch-verify-request',{attempted:s.batch.attempts.length});log(s,'本批已尝试 '+s.batch.attempts.length+' 条，统一核对平台进度');}
async function handle(m,sender){
 let s=await read();const popup=sender.url===chrome.runtime.getURL('popup.html')&&(sender.frameId==null||sender.frameId===0);
 if((m.type==='START'||m.type==='SCAN')&&popup){
  if(typeof HomeworkController!=='undefined'&&(await HomeworkController.read()).running)throw Error('网上作业正在运行，请先停止作业任务。');
  await reconcileWindows(s);
  const tab=await chrome.tabs.get(m.tabId);
  if(!CourseLogic.trusted(tab.url)||new URL(tab.url).pathname!=='/webindex.action')throw Error('请在教学平台首页启动（地址为 webindex.action）。');
  if(s.running)throw Error('已有任务，请先停止。');
  if((await videoTabs()).length)throw Error('检测到已打开的课程视频窗口。请先关闭该视频窗口，等待 20 秒后再开始，避免平台多窗口播放提示。');
  let ready;
  try{ready=await messageTab(tab.id,{type:'PING'});}catch{}
  if(!ready?.ready)throw Error('插件尚未连接此页面。请刷新教学平台首页，再点击开始；若仍失败，请在扩展详情中允许访问 teach.ynou.edu.cn。');
  if(ready.version!==VERSION)throw Error('此页面仍运行旧版脚本，请刷新教学平台首页后再开始。');
  if(!ready.userKey)throw Error('无法确认当前登录账号，请回到已登录首页再试。');
  const cached=(await chrome.storage.local.get('courseCache')).courseCache;
  const scanning=m.type==='SCAN';
  if(!scanning&&(!cached||!CourseLogic.plan(cached.courses).ready))throw Error('没有完整的扫描缓存，请先点击手动扫描。');
  if(!scanning&&cached.userKey!==ready.userKey)throw Error('当前账号与扫描缓存不一致，请重新手动扫描。');
  const courses=scanning?[]:cached.courses;
  const next=scanning?0:CourseLogic.plan(courses).next;
  s={running:next>=0,tabId:tab.id,videoTabId:null,courses,courseIndex:Math.max(0,next),pending:null,batch:null,queue:[],sequence:0,finished:0,failed:0,userKey:ready.userKey,scanComplete:!scanning,phase:scanning?'scanHome':'home',logs:[],diagnostics:[],waitUntil:s.waitUntil||0,lastLocalRelease:s.lastLocalRelease||null,lastContact:{main:Date.now()}};
  diagnose(s,'automation-start',{mode:scanning?'scan':'play',tabId:tab.id});
  log(s,scanning?'正在手动扫描全部科目，扫描后保存缓存':next<0?'缓存中的科目均已满额，可手动扫描更新':'已读取缓存，开始未达标科目');return save(s);
 }
 if(m.type==='GET'){
  await adoptVideo(s,sender);
  if(s.running&&sender.tab&&sender.frameId!==undefined&&sender.frameId!==0)return {running:false};
  if(s.running&&sender.tab&&CourseLogic.trusted(sender.url)){
   const role=sender.tab.id===s.tabId?'main':sender.tab.id===s.videoTabId?'player':null;
   if(role&&Date.now()-(s.lastContact?.[role]||0)>=30000){s.lastContact={...(s.lastContact||{}),[role]:Date.now()};await save(s);}
  }
  if(popup){const local=await chrome.storage.local.get(['courseCache','lastDiagnosis']);return {...s,buildVersion:VERSION,cache:local.courseCache||null,diagnosis:local.lastDiagnosis||null};}
  return sender.tab?.id===s.tabId||sender.tab?.id===s.videoTabId?s:{running:false};
 }
 if(m.type==='PLAYER_EARLY'||m.type==='PLAYER_DIAGNOSTIC'){
  if(!sender.tab||sender.frameId>0||!CourseLogic.trusted(sender.url)||new URL(sender.url).pathname!=='/play/playVideo.action')return {running:false};
  await adoptVideo(s,sender);
  const isOwned=sender.tab.id===s.videoTabId;
  s.observedVideoTabIds=[...new Set([...(s.observedVideoTabIds||[]),sender.tab.id])].slice(-20);
  if(m.type==='PLAYER_EARLY')diagnose(s,'video-document-start',{tabId:sender.tab.id,scope:isOwned?'automation':'manual'});
  else {
   const kinds=['probe-ready','platform-multiple-window','site-close','media-play','media-playing','media-ended','media-error','media-seeking','media-seeked','lifecycle-beforeunload','lifecycle-pagehide','lifecycle-unload','lifecycle-visibility','cookie-write','storage-write','storage-remove','site-request-finished','site-error','site-promise-error'];
   if(!kinds.includes(m.data?.kind))return {running:false};
   const detail=diagnosticData(m.data);if(m.data.kind==='platform-multiple-window')detail.videoWindowCount=(await videoTabs()).length;
   diagnose(s,m.data.kind,{tabId:sender.tab.id,scope:isOwned?'automation':'manual',...detail});
   if(m.data.kind==='platform-multiple-window'){
    const wasRunning=s.running;s.running=false;s.platformBlocked=true;
    log(s,'平台拒绝播放并提示“不允许多窗口播放”。已保留本次报错和前后的记录。');
    await save(s);if(wasRunning)await pauseOwned(s);return isOwned?s:{running:false};
   }
  }
  await save(s);return isOwned?s:{running:false};
 }
 const owned=sender.tab&&(sender.tab.id===s.tabId||sender.tab.id===s.videoTabId)&&CourseLogic.trusted(sender.url);
 if(m.type==='STOP'&&(popup||owned)){
  s.running=false;log(s,m.reason||'已停止。缓存仍保留，请在插件中点击“使用缓存开始学习”继续。');diagnose(s,'automation-stop',{source:popup?'popup':'page',reason:s.status});await save(s);
  await pauseOwned(s);
  return s;
 }
 if(!owned||!s.running)return {running:false};
 if(m.type==='SCAN_DONE'&&sender.tab.id===s.tabId){
  if(!CourseLogic.plan(s.courses).ready)throw Error('扫描尚未完整，保留原缓存。');
  await chrome.storage.local.set({courseCache:{courses:s.courses,userKey:s.userKey,scannedAt:Date.now(),updatedAt:Date.now()}});
  s.running=false;s.scanComplete=true;s.phase='idle';log(s,'扫描完成并已保存。点击使用缓存开始学习即可播放。');return save(s);
 }
 if(m.type==='BATCH_BEGIN'&&sender.tab.id===s.tabId){
  if(!s.scanComplete||!['info','batchInfo'].includes(s.phase))throw Error('当前不能开始新的播放批次。');
  s.batch=CourseLogic.newBatch(s.courses[s.courseIndex],s.batch);s.pending=null;s.queue=[];s.phase='catalog';
  s.catalogProgress={stage:'waiting',at:Date.now(),expanded:0,total:0,videos:0,eligible:0};
  log(s,'平台进度 '+s.batch.baseline+'/'+s.batch.total+'；第 '+s.batch.round+' 批计划播放 '+s.batch.goal+' 条，结束后统一核对');
  return save(s);
 }
 if(m.type==='CATALOG_PROGRESS'&&sender.tab.id===s.tabId){
  if(s.phase!=='catalog'||m.round!==s.batch?.round)return s;
  const p=m.progress||{},counts={};
  for(const key of ['expanded','total','videos','eligible'])counts[key]=Number.isInteger(p[key])&&p[key]>=0?Math.min(p[key],100000):0;
  s.catalogProgress={stage:'collecting',at:Date.now(),...counts,visibility:p.visibility==='hidden'?'hidden':'visible'};
  s.status='正在准备第 '+s.batch.round+' 批目录：已展开 '+counts.expanded+'/'+counts.total+' 章，找到 '+counts.eligible+' 条未学视频';
  return save(s);
 }
 if(m.type==='QUEUE_READY'&&sender.tab.id===s.tabId){
  if(s.phase!=='catalog'||!s.batch)throw Error('当前不能更新播放目录。');
  if(!Array.isArray(m.rows))throw Error('视频目录数据不完整。');
  const attempted=new Set(s.attemptedVideos||[]);
  s.queue=[...new Map(m.rows.filter(r=>typeof r.id==='string'&&r.id.length>0&&r.id.length<200&&!attempted.has(r.id)).map(r=>[r.id,{id:r.id,title:String(r.title||'视频').slice(0,200)}])).values()];
  if(s.catalogProgress){s.catalogProgress={...s.catalogProgress,stage:'ready',at:Date.now(),eligible:s.queue.length};diagnose(s,'catalog-ready',{round:s.batch.round,queueCount:s.queue.length});}
  const next=CourseLogic.nextVideo(s.queue,s.batch);
  if(next){await selectVideo(s,next);log(s,(s.videoTabId?'在当前播放器切换：':'打开本科学习窗口：')+next.title);}
  else if(s.batch.attempts.length)verifyBatch(s);
  else {const c=s.courses[s.courseIndex];s.skippedCourses=[...(s.skippedCourses||[]),{title:c.title,progress:c.progress.label,at:Date.now(),reason:'目录已无可继续播放的视频'}];s.phase='skipCourse';log(s,c.title+'：目录已无可继续播放的视频，平台进度 '+c.progress.label+'，记录待平台更新并跳过本科');}
  await save(s);if(!s.running)await pauseOwned(s);return s;
 }
 if(m.type==='SWITCH_CONFIRMED'&&sender.tab.id===s.videoTabId){
  if(s.phase==='switchVideo'&&m.token===s.pending?.token){s.phase='video';diagnose(s,'sidebar-switch-confirmed',{tabId:s.videoTabId,token:m.token});log(s,'正在播放：'+s.pending.title);await save(s);}
  return s;
 }
 if((m.type==='VIDEO_END'||m.type==='VIDEO_FAILED')&&sender.tab.id===s.videoTabId){
  if(s.phase!=='video'||m.token!==s.pending?.token)return s;
  if(!s.pending||!s.batch||s.batch.attempts.some(a=>a.id===s.pending.id))throw Error('本次播放记录与批次不一致，已停止。');
  const outcome=m.type==='VIDEO_END'?'ended':'failed';
  diagnose(s,'video-outcome',{tabId:s.videoTabId,resourceId:s.pending.id,token:m.token,outcome});
  s.batch.attempts.push({id:s.pending.id,title:s.pending.title,outcome,at:Date.now(),reason:outcome==='failed'?String(m.reason||'视频播放失败').slice(0,200):''});
  s.attemptedVideos=[...new Set([...(s.attemptedVideos||[]),s.pending.id])];
  if(outcome==='ended')s.finished=(s.finished||0)+1;else s.failed=(s.failed||0)+1;
  const next=CourseLogic.nextVideo(s.queue||[],s.batch);s.pending=null;
  if(next){await selectVideo(s,next);log(s,(outcome==='failed'?'本条播放失败，已记下；':'本条播放结束，已记下；')+'本批已尝试 '+s.batch.attempts.length+'/'+s.batch.goal+' 条，在右侧切换下一条');}
  else verifyBatch(s);
  return save(s);
 }
 if(m.type==='CLOSE_VIDEO'&&sender.tab.id===s.tabId){await closeVideo(s);return s;}
 if(m.type==='PATCH'&&sender.tab.id===s.tabId){
  if(m.patch.phase==='video'){
   await selectVideo(s,m.patch.pending);if(m.status)log(s,m.status);return save(s);
  }
  for(const k of ['courses','courseIndex','pending','phase','scanComplete'])if(k in m.patch)s[k]=m.patch[k];
  if(s.batch&&s.batch.courseUrl!==s.courses[s.courseIndex]?.url){s.batch=null;s.queue=[];s.attemptedVideos=[];}
  if(m.status)log(s,m.status);
  if(m.patch.courses&&s.scanComplete){const old=(await chrome.storage.local.get('courseCache')).courseCache;if(old&&old.userKey===s.userKey)await chrome.storage.local.set({courseCache:{...old,courses:s.courses,updatedAt:Date.now()}});}
  return save(s);
 }
 return s;
}
importScripts('homework-logic.js','homework-model.js','homework-background.js');
importScripts('ui-window.js');
chrome.runtime.onMessage.addListener((m,sender,reply)=>{const fail=e=>reply({error:String(e.message).replace(/sk-[A-Za-z0-9_-]+/g,'[已隐藏密钥]')});if(m.type==='HW_MODELS'){HomeworkController.handle(m,sender).then(reply,fail);return true;}serial=serial.then(()=>String(m.type).startsWith('UI_')?ControllerUI.handle(m,sender):String(m.type).startsWith('HW_')||m.type==='SCAN_ALL'?HomeworkController.handle(m,sender):handle(m,sender)).then(reply,fail);return true;});
chrome.tabs.onRemoved.addListener(id=>{serial=serial.then(async()=>{
 const s=await read(),wasRunning=s.running;
 if(s.tabId!==id&&s.videoTabId!==id&&s.closingVideoTabId!==id&&!s.observedVideoTabIds?.includes(id))return;
 diagnose(s,'tab-closed',{tabId:id});
 releaseRegistration(s,id,'tab-closed');await save(s);if(wasRunning&&!s.running)await pauseOwned(s);
}).catch(()=>{});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===MONITOR)serial=serial.then(watchdog).catch(()=>{});});
serial=serial.then(async()=>{const s=await read();await syncMonitor(s.running);scheduleMainWake(s);}).catch(()=>{});
