const $ = id => document.getElementById(id);
const POPUP_VERSION='1.6.1';
let actionError='',connectionError='',pending=false,snapshot=null,refreshPromise=null,listSignature='',resultsSignature='',settingsLoaded=false,selectedSection='homework';
const sections=['video','homework','offline'];
async function send(m){const r=await chrome.runtime.sendMessage(m);if(!r)throw Error('后台未连接，请重新加载扩展。');if(r.error)throw Error(r.error);return r;}
function notice(id,text){$(id).textContent=text;$(id).hidden=!text;}
const validQuota=q=>!!q&&Number.isInteger(q.current)&&q.current>=0&&Number.isInteger(q.total)&&q.total>=0;
const full=q=>validQuota(q)&&q.current>=q.total;
const readyCache=(cache,key)=>!!cache?.courses?.length&&cache.courses.every(c=>validQuota(c[key]));
const dateText=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
const logText=rows=>(rows||[]).slice().reverse().map(x=>new Date(x.at).toLocaleTimeString('zh-CN',{hour12:false})+' '+x.text).join('\n')||'暂无运行记录';
function chooseSection(section,persist=false){
 selectedSection=sections.includes(section)?section:'homework';
 for(const name of sections){const active=name===selectedSection;$(name+'Section').hidden=!active;$(name+'Tab').setAttribute('aria-selected',String(active));$(name+'Tab').tabIndex=active?0:-1;}
 if(selectedSection==='offline')$('courseDetails').open=true;
 if(persist)chrome.storage.local.set({popupSection:selectedSection}).catch(()=>{});
 if(snapshot)renderCourses(snapshot.video,snapshot.homework);
 if(snapshot)$('homeworkConfigure').hidden=selectedSection!=='homework'||!!snapshot.homework.settings?.ready;
}
for(const name of sections){
 $(name+'Tab').onclick=()=>chooseSection(name,true);
 $(name+'Tab').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'video':e.key==='End'?'offline':sections[(sections.indexOf(name)+(e.key==='ArrowRight'?1:2))%3];chooseSection(next,true);$(next+'Tab').focus();}};
}
function cachedCourses(s,hw){
 const video=selectedSection==='video',cache=video?s.cache:hw.cache,key=video?'progress':'homework';
 return (cache?.courses||[]).map(c=>({title:c.title,quota:selectedSection==='offline'?c.offline?.quota:c[key],...(selectedSection==='offline'?{offline:c.offline}: {})}));
}
function metric(label,q){
 const box=document.createElement('div'),head=document.createElement('div'),name=document.createElement('span'),value=document.createElement('strong'),meter=document.createElement('div'),fill=document.createElement('i');
 head.className='metric-head';name.textContent=label;value.textContent=validQuota(q)?q.current+'/'+q.total:'待扫描';head.append(name,value);
 meter.className='meter'+(full(q)?' done':'');const percent=validQuota(q)?q.total?Math.min(100,q.current/q.total*100):100:0;fill.style.width=percent+'%';meter.setAttribute('role','progressbar');meter.setAttribute('aria-label',label);meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');meter.setAttribute('aria-valuenow',String(Math.round(percent)));meter.setAttribute('aria-valuetext',validQuota(q)?q.total?q.current+'/'+q.total+'，'+Math.round(percent)+'%':'无数量要求':'待扫描');meter.append(fill);box.append(head,meter);return box;
}
function offlineStats(o){
 if(!o?.catalogComplete||!Array.isArray(o.items))return null;
 const counts={total:o.items.length,submitted:0,pending:0,graded:0,unsubmitted:0,returned:0,unknown:0};
 for(const item of o.items){const key=['pending','graded','unsubmitted','returned'].includes(item.status)?item.status:'unknown';counts[key]++;if(key==='pending'||key==='graded')counts.submitted++;}return counts;
}
const stateNames={pending:'已提交待批改',graded:'已批改',unsubmitted:'未提交',returned:'已退回',unknown:'状态待确认'};
function offlineDetail(o){
 const box=document.createElement('div'),q=o?.quota,counts=offlineStats(o);box.className='offline-detail';box.append(metric('平台已计入',q));
 const note=document.createElement('p');note.className='offline-note';
 if(!counts){note.textContent='尚未读取提交状态，请点击“扫描全部课程”。';box.append(note);return box;}
 note.textContent=!q?.total?'本课程无离线作业数量要求':!counts.total?'未找到离线条目，请核对课程目录':full(q)?'平台进度已达标':counts.submitted>=q.total?'提交数量已达到要求，等待批改及本期进度核对':'本期要求 '+q.total+' 份 · 目录已提交 '+counts.submitted+' 份';box.append(note);
 const meter=document.createElement('div');meter.className='submission-meter';meter.setAttribute('role','img');meter.setAttribute('aria-label','目录共 '+counts.total+' 份，已批改 '+counts.graded+'，待批改 '+counts.pending+'，未提交 '+counts.unsubmitted+'，退回 '+counts.returned+'，状态待确认 '+counts.unknown);
 for(const status of ['graded','pending','unsubmitted','returned','unknown']){const segment=document.createElement('i');segment.className=status;segment.style.width=(counts.total?counts[status]/counts.total*100:0)+'%';meter.append(segment);}box.append(meter);
 const legend=document.createElement('div');legend.className='offline-legend';for(const status of ['graded','pending','unsubmitted','returned','unknown'])if(counts[status]||['pending','unsubmitted'].includes(status)){const tag=document.createElement('span');tag.className=status;tag.textContent=stateNames[status]+' '+counts[status];legend.append(tag);}box.append(legend);
 if(counts.total){const details=document.createElement('details'),summary=document.createElement('summary');details.className='offline-items';summary.textContent='查看 '+counts.total+' 份作业明细';details.append(summary);for(const item of o.items){const row=document.createElement('div'),name=document.createElement('span'),badge=document.createElement('span');row.className='offline-item';name.textContent=item.title||'未命名作业';const status=stateNames[item.status]?item.status:'unknown';badge.className='item-status '+status;badge.textContent=stateNames[status];badge.title=item.statusText||'';row.append(name,badge);details.append(row);}box.append(details);}return box;
}
function renderOverview(s,hw){
 const mismatch=s.cache?.userKey&&hw.cache?.userKey&&s.cache.userKey!==hw.cache.userKey;
 for(const [kind,label,cache,key] of [['video','视频',s.cache,'progress'],['homework','网上作业',hw.cache,'homework'],['offline','离线作业',hw.cache,'offline']]){
  const quotas=(cache?.courses||[]).map(c=>kind==='offline'?c.offline?.quota:c[key]);
  const q=!mismatch&&quotas.length&&quotas.every(validQuota)?quotas.reduce((sum,q)=>({current:sum.current+Math.min(q.current,q.total),total:sum.total+q.total}),{current:0,total:0}):null;
  const target=$(kind+'Overview');target.replaceChildren(metric(label,q));
 }
 const counts=(hw.cache?.courses||[]).map(c=>offlineStats(c.offline));
 $('overviewHint').textContent=mismatch?'两类缓存账号不同，请重新扫描。':counts.length&&counts.every(Boolean)?'离线待批改 '+counts.reduce((n,c)=>n+c.pending,0)+' 份 · 上方为平台已计入进度':'离线提交状态尚未扫描 · 平台进度按课程要求合计';
 $('offlineState').textContent=counts.length&&counts.every(Boolean)?'已扫描':'待扫描';
 $('offlineStatus').textContent=hw.running&&hw.scanning?hw.status||'正在扫描离线提交状态…':'已提交但未批改的作业以橙色显示，平台进度仍按网站记录。点击顶部扫描按钮更新。';
}
function renderCourses(s,hw){
 const rows=cachedCourses(s,hw),count=rows.length,complete=rows.filter(c=>full(c.quota)).length,label=selectedSection==='video'?'视频':selectedSection==='offline'?'离线作业':'网上作业';
 $('courseProgressTitle').textContent=label+'进度';
 $('courseCount').textContent=count+' 门';
 const allRead=count&&rows.every(c=>validQuota(c.quota));
 $('cacheSummary').textContent=!count?'扫描后，即可查看各科'+label+'进度':allRead?`${label} ${complete}/${count} 科达标`:'本模式进度不完整，请扫描全部课程';
 const signature=selectedSection+'|'+JSON.stringify(rows);if(signature===listSignature)return;listSignature=signature;
 const scroll=$('courseList').scrollTop;$('courseList').replaceChildren();
 if(!count){const empty=document.createElement('p');empty.className='small';empty.textContent='暂无'+label+'缓存，点击上方扫描按钮开始。';$('courseList').append(empty);}
 rows.forEach((c,i)=>{const row=document.createElement('div'),name=document.createElement('div'),grid=document.createElement('div');row.className='course-row';name.className='course-name';name.textContent=String(i+1).padStart(2,'0')+'  '+(c.title||'未命名课程');grid.className='progress-grid';grid.append(selectedSection==='offline'?offlineDetail(c.offline):metric(label,c.quota));row.append(name,grid);$('courseList').append(row);});
 $('courseList').scrollTop=scroll;
}
function renderTask(s,kind,hasCache,scanning){
 const video=kind==='video',running=!!s.running&&!scanning,id=video?'status':'homeworkStatus',badge=$(kind+'State');
 badge.textContent=scanning?'同步中':running?'进行中':s.canResume?'待复核':(s.phase==='done'||/^(本轮视频已处理完|所有本期科目的视频进度均已达标)/.test(s.status||''))?(s.skippedCourses?.length?'本轮结束':'已完成'):s.phase==='stopped'||s.logs?.length?'已停止':hasCache?'已就绪':'待扫描';
 badge.className='state'+(running?' running':badge.textContent==='已停止'||s.canResume?' stopped':'');
 $(kind+'Title').textContent=running||s.canResume?(s.courses?.[s.courseIndex]?.title||'当前作业'):scanning?'正在同步课程进度':video?'按你的节奏，继续学习':'按要求完成，恰到好处';
 $(id).textContent=scanning?'扫描结束后，即可使用缓存开始。':s.status&&(running||s.logs?.length)?s.status:hasCache?(video?'按页面顺序播放，批次结束后统一核对。':'按进度差额完成作业，批次结束后统一核对。'):'先扫描全部课程，视频与作业进度会一起保存。';
 const batch=$(video?'batchStatus':'homeworkBatch');batch.hidden=!running||!s.batch;
 if(s.batch)batch.textContent=`第 ${s.batch.round} 批 · ${video?'已尝试':'新完成'} ${video?s.batch.attempts?.length||0:s.batch.completed||0}/${s.batch.goal} ${video?'条':'份'} · 平台 ${s.batch.baseline}/${s.batch.total}`;
}
function render(){
 const s=snapshot?.video||{},hw=snapshot?.homework||{},manifestVersion=chrome.runtime.getManifest().version;
 const mismatch=!!snapshot&&(s.buildVersion!==POPUP_VERSION||hw.version!==POPUP_VERSION||manifestVersion!==POPUP_VERSION);
 notice('versionNote',mismatch?'组件版本不一致，请重新加载扩展，再刷新教学平台首页。':'');
 notice('actionNotice',actionError||connectionError||(hw.scanning&&!hw.running&&hw.phase==='stopped'?hw.status:''));
 const videoScan=!!s.running&&s.scanComplete===false,hwScan=!!hw.running&&hw.scanning,scanning=videoScan||hwScan,anyRunning=!!s.running||!!hw.running;
 const blocked=pending||!snapshot||!!connectionError||mismatch,vReady=readyCache(s.cache,'progress'),hReady=readyCache(hw.cache,'homework');
 $('scan').disabled=pending||(!scanning&&(blocked||anyRunning));$('scanLabel').textContent=scanning?'停止扫描':'扫描全部课程';
 $('start').disabled=blocked||anyRunning||!vReady;$('homeworkStart').disabled=blocked||anyRunning||!hw.settings?.ready||(!hReady&&!hw.canResume);
 $('homeworkStart').firstChild.textContent=!hw.settings?.ready?'请先配置模型':hw.canResume?'重新检查并继续':'使用缓存开始作业';
 $('stop').disabled=pending||!s.running||videoScan;$('homeworkStop').disabled=pending||!hw.running||hwScan;
 const scanState=hwScan?hw:s,total=scanState.courses?.length||0,completed=Math.min(scanState.courseIndex||0,total);
 const stamps=[s.cache?.scannedAt,hw.cache?.scannedAt].filter(Boolean),both=s.cache?.userKey&&s.cache.userKey===hw.cache?.userKey&&stamps.length===2,hasOffline=!!hw.cache?.courses?.length&&hw.cache.courses.every(c=>offlineStats(c.offline));
 $('cacheTime').textContent=scanning?(total?'正在读取 '+(scanState.courses?.[scanState.courseIndex]?.title||'课程进度'):'正在读取本期课程…'):both&&hasOffline?'已缓存 · '+dateText(Math.min(...stamps)):stamps.length?'已有缓存 · 请扫描离线状态':'尚未扫描';
 $('scanCount').textContent=scanning?completed+'/'+total:both?Math.max(s.cache.courses?.length||0,hw.cache.courses?.length||0)+' 门课程':'';
 $('scanDot').className='dot'+(scanning||both?' active':'');$('scanTrack').hidden=!scanning;$('scanFill').style.width=(total?completed/total*100:0)+'%';
 renderTask(s,'video',vReady,scanning);renderTask(hw.scanning?{}:hw,'homework',hReady,scanning);renderCourses(s,hw);renderOverview(s,hw);
 $('homeworkConfigure').hidden=selectedSection!=='homework'||!!hw.settings?.ready;
 if(!hw.settings?.ready&&!anyRunning){$('homeworkState').textContent='待配置';$('homeworkStatus').textContent='请先在模型设置中填写 API 地址和 Key，选择解题模型并保存。';}
 $('logs').textContent=logText(s.logs);$('homeworkLogs').textContent=logText(hw.logs);
 $('diagnosisNote').textContent='导出当前状态、页面连接与历史事件。'+(s.diagnosis?.at?'最近记录 '+dateText(s.diagnosis.at)+'。':'');
 const signature=JSON.stringify(hw.results||[]);if(signature!==resultsSignature){resultsSignature=signature;$('homeworkResults').replaceChildren();for(const row of (hw.results||[]).slice(-20).reverse()){const node=document.createElement('div');node.textContent=row.title+' · '+row.score+' 分'+(row.existingResult?' · 历史成绩':'');$('homeworkResults').append(node);}}
 if(hw.settings&&!settingsLoaded){$('homeworkApi').value=hw.settings.baseUrl||'';$('homeworkModel').value=hw.settings.model||'';settingsLoaded=true;}
 $('homeworkKeyStatus').textContent=hw.settings?.ready?'当前已保存：'+hw.settings.model:hw.settings?.hasKey?'Key 已保存，模型或接口授权不完整':'尚未配置；插件不包含内置 Key';
 $('homeworkKey').placeholder=hw.settings?.hasKey?'同一 API 留空可保留已保存 Key':'请输入自己的 API Key';
 for(const id of ['homeworkSave','homeworkFetchModels','homeworkClear','homeworkAvailable','homeworkApi','homeworkModel','homeworkKey'])$(id).disabled=blocked||!!hw.running;
}
function refresh(){
 if(refreshPromise)return refreshPromise;
 refreshPromise=(async()=>{try{const [video,homework]=await Promise.all([send({type:'GET'}),send({type:'HW_GET'})]);snapshot={video,homework};connectionError='';}catch(e){connectionError=e.message;}finally{render();refreshPromise=null;}})();return refreshPromise;
}
async function action(type,needsTab=false){
 if(pending)return;pending=true;actionError='';render();
 try{const message={type};if(needsTab){const target=await send({type:'UI_TARGET'});if(!Number.isInteger(target.tabId))throw Error('请在教学平台首页点击插件图标打开助手。');message.tabId=target.tabId;}await send(message);}
 catch(e){actionError=e.message;}
 finally{if(refreshPromise)await refreshPromise;pending=false;await refresh();}
}
$('scan').onclick=()=>action(snapshot?.homework.running&&snapshot.homework.scanning?'HW_STOP':snapshot?.video.running&&snapshot.video.scanComplete===false?'STOP':'SCAN_ALL',!(snapshot?.homework.running&&snapshot.homework.scanning||snapshot?.video.running&&snapshot.video.scanComplete===false));
$('start').onclick=()=>action('START',true);$('stop').onclick=()=>action('STOP');
$('resetWindowSize').onclick=()=>action('UI_RESET_SIZE');
$('homeworkStart').onclick=()=>action(snapshot?.homework.canResume?'HW_RESUME':'HW_START',!snapshot?.homework.canResume);$('homeworkStop').onclick=()=>action('HW_STOP');
function clearModelChoices(){$('homeworkAvailable').replaceChildren(new Option('获取列表后选择，或手动填写模型名称',''));$('modelFetchStatus').textContent='';}
$('homeworkApi').oninput=()=>{clearModelChoices();};$('homeworkKey').oninput=()=>{clearModelChoices();};
$('homeworkAvailable').onchange=()=>{if($('homeworkAvailable').value)$('homeworkModel').value=$('homeworkAvailable').value;};
$('homeworkConfigure').onclick=()=>{$('settingsDetails').open=true;$('settingsDetails').scrollIntoView({behavior:'smooth',block:'start'});$('homeworkApi').focus();};
async function modelAction(kind){
 if(pending)return;actionError='';let message,permission;
 try{
  if(kind!=='clear'){
   const urls=HomeworkModel.endpoint($('homeworkApi').value),apiKey=$('homeworkKey').value.trim(),saved=snapshot?.homework.settings;
   if(apiKey)HomeworkModel.key(apiKey);else if(!saved?.hasKey||saved.baseUrl!==urls.baseUrl)throw Error('请填写此 API 对应的 Key；更换 API 地址后需要重新填写。');
   const model=kind==='save'?HomeworkModel.modelName($('homeworkModel').value):undefined;
   message={type:kind==='fetch'?'HW_MODELS':'HW_SETTINGS',baseUrl:urls.baseUrl,apiKey,model};
   // Request only this API host while the button's user gesture is still active.
   permission=chrome.permissions.request({origins:[urls.permission]});
  }else message={type:'HW_CLEAR_SETTINGS'};
  pending=true;if(kind==='fetch'){$('modelFetchStatus').textContent='正在获取模型列表…';$('homeworkAvailable').replaceChildren(new Option('正在获取…',''));}render();
  if(permission&&!await permission)throw Error('未授权访问该 API，未获取或保存模型配置。');
  const result=await send(message);
  if(kind==='fetch'){
   $('homeworkApi').value=result.baseUrl;const select=$('homeworkAvailable');select.replaceChildren(new Option('请选择文字对话模型',''));for(const name of result.models)select.append(new Option(name,name));select.value=result.models.includes($('homeworkModel').value)?$('homeworkModel').value:'';
   $('modelFetchStatus').textContent='已获取 '+result.models.length+' 个模型，选择后点击“保存设置”。';
  }else{settingsLoaded=false;$('homeworkKey').value='';if(kind==='clear')clearModelChoices();$('modelFetchStatus').textContent=kind==='clear'?'配置已清除，网上作业已禁用。':'已保存，可以使用网上作业功能。';}
 }catch(e){actionError=e.message;$('modelFetchStatus').textContent=e.message;if(kind==='fetch')$('homeworkAvailable').replaceChildren(new Option('获取失败，可重试或手动填写模型名称',''));}
 finally{if(refreshPromise)await refreshPromise;pending=false;await refresh();}
}
$('homeworkSave').onclick=()=>modelAction('save');$('homeworkFetchModels').onclick=()=>modelAction('fetch');$('homeworkClear').onclick=()=>modelAction('clear');
for(const [name,other] of [['settingsDetails','recordsDetails'],['recordsDetails','settingsDetails']])$(name).ontoggle=()=>{if($(name).open)$(other).open=false;};
const nonnegative=value=>Number.isFinite(value)?Math.max(0,value):null;
function catalogSummary(value){
 if(!value)return null;
 return {
  ...Object.fromEntries(['expanded','total','videos','eligible'].map(key=>[key,nonnegative(value[key])])),
  visibility:['hidden','visible'].includes(value.visibility)?value.visibility:'unknown'
 };
}
async function pageConnection(tab){
 let timer;
 try{
  const response=await Promise.race([
   chrome.tabs.sendMessage(tab.id,{type:'PING'},{frameId:0}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('页面连接检查超时')),2000);})
  ]);
  const sidebar=response?.sidebar;
  const sidebarSummary=sidebar?{
   stage:['searching','opening-chapter','waiting-directory','waiting-video','stopped'].includes(sidebar.stage)?sidebar.stage:'unknown',
   ...Object.fromEntries(['elapsedMs','expandedCount','chapterClicks','videoCount','visibleVideos','chapterCount','unloadedChapters','collapsedChapters'].map(key=>[key,Number.isFinite(sidebar[key])?Math.max(0,sidebar[key]):null])),
   matchedTarget:sidebar.matchedTarget===true
  }:null;
  const activity=response?.pageActivity;
  const pageActivity=activity?{visibility:['hidden','visible'].includes(activity.visibility)?activity.visibility:'unknown',lastTickAt:nonnegative(activity.lastTickAt),lastWakeAt:nonnegative(activity.lastWakeAt),busy:activity.busy===true,catalog:catalogSummary(activity.catalog)}:null;
  return {tabId:tab.id,path:new URL(tab.url).pathname,connected:response?.ready===true,contentVersion:response?.version||null,sidebar:sidebarSummary,emptyChaptersSkipped:Number.isFinite(response?.emptyChaptersSkipped)?Math.max(0,response.emptyChaptersSkipped):null,pageActivity};
 }catch(error){return {tabId:tab.id,path:new URL(tab.url).pathname,connected:false,error:String(error.message||error).slice(0,200)};}
 finally{clearTimeout(timer);}
}
async function currentDiagnosis(){
 const [stateResult,tabsResult]=await Promise.allSettled([send({type:'GET'}),chrome.tabs.query({url:'https://teach.ynou.edu.cn/*'})]);
 const s=stateResult.status==='fulfilled'?stateResult.value:{};
 const tabs=tabsResult.status==='fulfilled'?tabsResult.value:[];
 const pages=await Promise.all(tabs.filter(tab=>{try{return new URL(tab.url).origin==='https://teach.ynou.edu.cn';}catch{return false;}}).slice(0,20).map(pageConnection));
 const course=s.courses?.[s.courseIndex];
 return {
  formatVersion:2,version:POPUP_VERSION,exportedAt:Date.now(),
  versions:{popup:POPUP_VERSION,manifest:chrome.runtime.getManifest().version,background:s.buildVersion||null},
  popupError:actionError||null,
  runtime:stateResult.status==='fulfilled'?{
   running:s.running===true,status:s.status||'尚未开始',phase:s.phase||null,
   tabId:s.tabId??null,videoTabId:s.videoTabId??null,courseIndex:s.courseIndex??null,
   lastContact:s.lastContact||null,lastLocalRelease:s.lastLocalRelease||null,waitUntil:s.waitUntil||null,
   courseTitle:course?.title||null,progress:course?.progress||null,
   pending:s.pending?{id:s.pending.id,title:s.pending.title,token:s.pending.token}:null,
   batch:s.batch?{round:s.batch.round,baseline:s.batch.baseline,total:s.batch.total,goal:s.batch.goal,attempts:s.batch.attempts}:null,
   catalogProgress:s.catalogProgress?{...catalogSummary(s.catalogProgress),stage:['waiting','collecting','ready'].includes(s.catalogProgress.stage)?s.catalogProgress.stage:'unknown',at:nonnegative(s.catalogProgress.at)}:null,
   finished:s.finished||0,failed:s.failed||0,scanComplete:!!s.scanComplete,
   queueCount:s.queue?.length||0,logs:(s.logs||[]).slice(-60),skippedCourses:(s.skippedCourses||[]).map(c=>({title:c.title,progress:c.progress,reason:c.reason,at:c.at}))
  }:null,
  runtimeError:stateResult.status==='rejected'?String(stateResult.reason?.message||stateResult.reason):null,
  cache:s.cache?{scannedAt:s.cache.scannedAt,updatedAt:s.cache.updatedAt,courseCount:s.cache.courses?.length||0}:null,
  pages,tabsError:tabsResult.status==='rejected'?String(tabsResult.reason?.message||tabsResult.reason):null,
  historyVersion:s.diagnosis?.version||null,historyLastEventAt:s.diagnosis?.at||null,
  events:(s.diagnosis?.events||[]).map(event=>({...event,version:event.version||s.diagnosis.version}))
 };
}
$('exportDiagnosis').onclick=async()=>{
 $('exportDiagnosis').disabled=true;
 try{
  const diagnosis=await currentDiagnosis();
  const blob=new Blob([JSON.stringify(diagnosis,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='云开连播诊断-'+new Date(diagnosis.exportedAt).toISOString().replace(/[:.]/g,'-')+'.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }catch(error){actionError='诊断导出失败：'+error.message;$('status').textContent=actionError;}
 finally{$('exportDiagnosis').disabled=false;}
};
$('homeworkExport').onclick=async()=>{
 $('homeworkExport').disabled=true;
 try{
  const s=await send({type:'HW_GET'}),c=s.courses?.[s.courseIndex];
  const diagnosis={version:POPUP_VERSION,exportedAt:Date.now(),backgroundVersion:s.version,running:!!s.running,scanning:!!s.scanning,unifiedScan:!!s.unifiedScan,phase:s.phase,status:s.status,phaseAt:s.phaseAt,courseIndex:s.courseIndex,courseTitle:c?.title,homework:c?.homework,batch:s.batch,finished:s.finished,questionCount:s.questionCount,tokens:s.tokens,pending:s.pending?{title:s.pending.title,token:s.pending.token}:null,queueCount:s.queue?.length||0,results:s.results||[],logs:s.logs||[],cache:s.cache?{scannedAt:s.cache.scannedAt,updatedAt:s.cache.updatedAt,courseCount:s.cache.courses?.length||0}:null,settings:{model:s.settings?.model,hasKey:!!s.settings?.hasKey}};
  diagnosis.skippedCourses=(s.skippedCourses||[]).map(c=>({title:c.title,progress:c.progress,reason:c.reason,at:c.at}));
  diagnosis.review={canResume:!!s.canResume,count:s.reviewCount||0,questions:(s.uncertainQuestions||[]).filter(Number.isInteger)};
  diagnosis.modelProgress=s.modelProgress?{kind:s.modelProgress.kind,group:s.modelProgress.group,groups:s.modelProgress.groups,done:s.modelProgress.done,total:s.modelProgress.total,attempt:s.modelProgress.attempt}:null;
  diagnosis.failedPapers=(s.failedPapers||[]).map(p=>({title:p.title,course:p.course,reason:p.reason,at:p.at}));
  diagnosis.offline=(s.cache?.courses||[]).map(c=>({title:c.title,quota:c.offline?.quota,checkedAt:c.offline?.checkedAt,counts:offlineStats(c.offline)}));
  const v=s.verification;diagnosis.verification=v?{courseTitle:v.courseTitle,attempt:v.attempt,baseline:v.baseline,expected:v.expected,requestedAt:v.requestedAt,homeClickedAt:v.homeClickedAt,loadedAt:v.loadedAt,courseEnteredAt:v.courseEnteredAt,observedAt:v.observedAt,quota:v.quota,freshDocument:!!v.documentId&&v.documentId!==v.sourceDocumentId}:null;
  const blob=new Blob([JSON.stringify(diagnosis,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='云开作业诊断-'+new Date(diagnosis.exportedAt).toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }catch(e){actionError='作业诊断导出失败：'+e.message;render();}
 finally{$('homeworkExport').disabled=false;}
};
render();
(async()=>{await refresh();try{const saved=await chrome.storage.local.get('popupSection');chooseSection(saved.popupSection|| (snapshot?.video.running?'video':'homework'));}catch{chooseSection('homework');}})();
setInterval(refresh,1500);
