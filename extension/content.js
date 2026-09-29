(() => {
 if(window.top!==window)return;
 const VERSION='1.6.1',L=CourseLogic,sleep=ms=>new Promise(r=>setTimeout(r,ms));
 let busy=false,waitSince=Date.now(),lastAction=0,videoBound=null,playAttempted=false,startError="",hasPlayed=false,boundAt=0,lastTime=0,lastAdvance=Date.now(),ending=false,panel;
 let catalogScan=null,lastTickAt=0,lastWakeAt=0,activeToken=null,transition=null,sidebarSearch=null,mediaRevision=0,endedHandler,playingHandler,oldInfo=null;
 const chapterDocuments=new Map();let chapterActionSequence=0,emptyChaptersSkipped=0;
 for(const name of ['loadstart','emptied'])document.addEventListener?.(name,e=>{if(e.target?.tagName==='VIDEO')mediaRevision++;},true);
 async function send(m){const r=await chrome.runtime.sendMessage(m);if(r?.error)throw Error(r.error);return r;}
 const get=()=>send({type:'GET'}),patch=(p,status)=>send({type:'PATCH',patch:p,status});
 function docs(){const a=[document];for(let i=0;i<a.length;i++)for(const f of a[i].querySelectorAll('iframe')){try{if(f.contentDocument&&!a.includes(f.contentDocument))a.push(f.contentDocument);}catch{}}return a;}
 function pause(){for(const d of docs())for(const v of d.querySelectorAll('video'))v.pause();}
 function show(text){if(!panel){const host=document.createElement('div');host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647';const sh=host.attachShadow({mode:'closed'});sh.innerHTML='<style>section{box-sizing:border-box;width:320px;max-width:calc(100vw - 36px);background:#123f37;color:white;padding:14px;border-radius:12px;font:14px/1.7 system-ui;box-shadow:0 4px 24px #0003}b{font-size:16px}p{margin:5px 0 10px}button{font:inherit;padding:6px 12px;border:0;border-radius:6px;cursor:pointer}</style><section><b>云开课程连播助手</b><p></p><button>停止连播</button></section>';panel=sh.querySelector('p');sh.querySelector('button').onclick=()=>stop('已手动停止');document.documentElement.append(host);}panel.textContent=text;}
 function stoppedSearch(){if(sidebarSearch){sidebarSearch.stage='stopped';sidebarSearch.finishedAt=Date.now();}}
 function sidebarSnapshot(){if(!sidebarSearch)return null;const q=sidebarSearch;return {stage:q.stage,elapsedMs:Math.max(0,(q.finishedAt||Date.now())-q.at),expandedCount:q.tried.size,chapterClicks:q.chapterClicks,videoCount:q.videoCount,visibleVideos:q.visibleVideos,chapterCount:q.chapterCount,unloadedChapters:q.unloadedChapters,collapsedChapters:q.collapsedChapters,matchedTarget:q.matchedTarget};}
 function chapterEvent(d,data){d.dispatchEvent(new d.defaultView.CustomEvent('__ynouChapterAction134',{detail:JSON.stringify(data)}));}
 function armChapterClick(el){
  const d=el.ownerDocument||document;if(!d.defaultView?.CustomEvent)return;
  if(!chapterDocuments.has(d)){
   d.addEventListener('__ynouEmptyChapter134',event=>{
    try{const data=JSON.parse(event.detail);if(data.token!==chapterDocuments.get(d))return;emptyChaptersSkipped++;show('该章节无内容，已跳过，正在继续读取目录…');}catch{}
   });
  }
  const token=String(++chapterActionSequence);chapterDocuments.set(d,token);chapterEvent(d,{action:'arm',token});
 }
 function clearChapterActions(){for(const d of chapterDocuments.keys()){chapterDocuments.set(d,null);try{chapterEvent(d,{action:'clear'});}catch{}}}
 async function stop(reason){clearChapterActions();stoppedSearch();await send({type:'STOP',reason});show(reason);}
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m.type==='WAKE_MAIN'&&location.pathname==='/webindex.action'){
   lastWakeAt=Date.now();reply({ready:true,version:VERSION});tick();return;
  }
  if(m.type==='PAUSE'){clearChapterActions();pause();stoppedSearch();if(m.reason)show(m.reason);}
  if(m.type==='PING')reply({ready:true,version:VERSION,sidebar:sidebarSnapshot(),emptyChaptersSkipped,pageActivity:{visibility:document.visibilityState||'unknown',lastTickAt,lastWakeAt,busy,catalog:catalogScan?.summary||null},userKey:Array.from(document.querySelectorAll('p')).find(e=>e.textContent.includes('欢迎您'))?.textContent.split('个人设置')[0].replace(/\s+/g,'').trim()||''});
 });
 async function click(el,expected,beforeClick){const live=await get();if(!live.running||(expected&&(live.phase!=='switchVideo'||live.pending?.token!==expected.token)))return false;beforeClick?.();el.scrollIntoView({block:'center'});el.click();lastAction=Date.now();waitSince=Date.now();return true;}
 const link=(d,text)=>Array.from(d.querySelectorAll('a')).find(a=>a.textContent.trim()===text);
 function quota(d){const e=d.querySelector('#actualvideo');return e&&/^\s*\d+\s*\/\s*\d+\s*$/.test(e.textContent)?L.quota(e.textContent,d.querySelector('#study')?.style.width):null;}
 function courseRows(){return docs().flatMap(d=>Array.from(d.querySelectorAll('a.studybtn')).filter(a=>a.getClientRects().length).map(a=>({a,url:a.href,title:a.closest('li')?.querySelector('.coursetit')?.textContent.trim()||'课程'}))).filter(r=>L.trusted(r.url));}
 function videos(d){return Array.from(d.querySelectorAll('li a[onclick]')).map((a,index)=>{const id=L.resource(a.getAttribute('onclick')||'');return id?{id,a,index,title:a.title||a.textContent.trim(),complete:L.completed(a.closest('li').querySelector('.tree-conr')?.textContent||'')}:null;}).filter(Boolean).sort(L.order);}
 async function saveQuota(s,q){
  const courses=s.courses.map((c,i)=>i===s.courseIndex?{...c,progress:q,checkedAt:Date.now()}:c);
  return patch({courses});
 }
 async function home(){const a=link(document,'首页');if(a)await click(a);else await stop('未找到首页入口，请返回首页重新开始。');}
 async function nextCourse(s){
  await send({type:'CLOSE_VIDEO'});let i=s.courseIndex+1;
  while(i<s.courses.length&&s.courses[i].progress?.full)i++;
  if(i>=s.courses.length){await stop(s.skippedCourses?.length?'本轮视频已处理完；'+s.skippedCourses.length+' 科进度待平台更新，已跳过。':'所有本期科目的视频进度均已达标。');return;}
  await patch({courseIndex:i,pending:null,phase:'home'},'切换科目：'+s.courses[i].title);
  const home=link(document,'首页');if(home)await click(home);else await stop('未找到首页入口，请返回首页重新开始。');
 }
 async function catalog(s,d){
  if(!s.scanComplete||!L.plan(s.courses).ready){await stop('全部科目进度尚未扫描完成，请重新开始。');return;}
  if(!catalogScan||catalogScan.document!==d||catalogScan.round!==s.batch?.round||catalogScan.courseUrl!==s.batch?.courseUrl)catalogScan={document:d,round:s.batch?.round,courseUrl:s.batch?.courseUrl,at:Date.now(),tried:new Set(),lastReport:'',summary:null};
  const q=catalogScan,rows=videos(d),headers=Array.from(d.querySelectorAll('.parent_tit'));
  const key=el=>el.id||String(headers.indexOf(el))+':'+(el.textContent||'').trim();
  const summary={expanded:q.tried.size,total:headers.length,videos:rows.length,eligible:rows.filter(r=>!r.complete).length,visibility:document.visibilityState||'visible'};
  const report=JSON.stringify(summary);q.summary=summary;
  if(q.lastReport!==report){q.lastReport=report;await send({type:'CATALOG_PROGRESS',round:s.batch?.round,progress:summary});}
  show('正在准备第 '+(s.batch?.round||1)+' 批目录：已展开 '+summary.expanded+'/'+summary.total+' 章，找到 '+summary.eligible+' 条未学视频。');
  if(Date.now()-q.at>180000){await stop('读取补播目录超过 3 分钟，已展开 '+summary.expanded+'/'+summary.total+' 章。请查看首页是否有网站提示，并导出诊断。');return;}
  // Yield between steps without awaiting a page timer: hidden tabs may run those only once a minute.
  if(Date.now()-lastAction<3500)return;
  const branch=Array.from(d.querySelectorAll('.parent_tit[title="Expand this branch"]')).find(e=>!q.tried.has(key(e)));
  if(branch){if(await click(branch,undefined,()=>armChapterClick(branch)))q.tried.add(key(branch));return;}
  if(!d.querySelector('.parent_tit')){if(Date.now()-waitSince>60000)await stop('课程目录未加载，请检查网络。');return;}
  const result=await send({type:'QUEUE_READY',rows:rows.filter(r=>!r.complete).map(r=>({id:r.id,title:r.title}))});
  if(result.running&&result.phase==='video'&&!result.videoTabId){
   const first=rows.find(r=>r.id===result.pending.id);
   if(first)await click(first.a);else await stop('未找到本批首条视频入口。');
  }
 }
 function batchLabel(s){const b=s.batch;return b?'第 '+b.round+' 批已尝试 '+b.attempts.length+'/'+b.goal+' 条；上次平台进度 '+b.baseline+'/'+b.total:'正在播放';}
 async function finishVideo(token,outcome,reason=''){
  if(ending||token!==activeToken)return;ending=true;
  const current=await get();if(!current.running||current.phase!=='video'||current.pending?.token!==token)return;
  if(outcome==='ended'){show('本条结束，等待平台保存后从右侧继续…');await sleep(12000);}
  else {videoBound?.pause?.();show('本条无法播放，已记下，准备继续下一条…');}
  const live=await get();if(live.running&&live.phase==='video'&&live.pending?.token===token)await send({type:outcome==='ended'?'VIDEO_END':'VIDEO_FAILED',token,reason});
 }
 const sidebarBranchSelector='.parent_tit, [title="Expand this branch"], [title="Collapse this branch"], [aria-expanded][aria-controls]';
 function visible(el){return !!el?.getClientRects().length&&el.ownerDocument?.defaultView?.getComputedStyle(el).visibility!=='hidden';}
 function branchBody(el){
  const controlled=el.getAttribute('aria-controls');
  if(controlled){const body=document.getElementById(controlled);if(body)return body;}
  if(el.nextElementSibling?.matches('ul, ol, [role="group"]'))return el.nextElementSibling;
  return Array.from(el.closest('li')?.children||[]).find(e=>e.matches('ul, ol, [role="group"]'))||null;
 }
 function branchState(el){
  const aria=el.getAttribute('aria-expanded'),title=el.getAttribute('title')?.trim();
  if(aria==='false'||title==='Expand this branch')return 'closed';
  if(aria==='true'||title==='Collapse this branch')return 'open';
  const body=branchBody(el),siteChapter=el.matches('.parent_tit')&&el.closest('li')?.classList.contains('parent_li');
  // The player's headers have no expand/collapse title. An unopened chapter has
  // no UL yet; a loaded closed chapter hides its LI children, not the UL itself.
  if(!body)return siteChapter?'unloaded':'unknown';
  if(!visible(body))return 'closed';
  const items=Array.from(body.children);
  if(!items.length)return siteChapter?'unloaded':'unknown';
  return items.some(visible)?'open':'closed';
 }
 async function findSidebarVideo(p){
  // Discover and expand the site's own tree before starting the media-switch timeout.
  // A new DOM node is not a new chapter: stable keys prevent re-rendered headers toggling repeatedly.
  if(!sidebarSearch||sidebarSearch.token!==p.token)sidebarSearch={token:p.token,at:Date.now(),quietSince:Date.now(),waitUntil:0,tried:new Map(),chapterClicks:0,signature:'',stage:'searching'};
  const q=sidebarSearch,now=Date.now();
  const rows=Array.from(document.querySelectorAll('a[onclick]')).map(a=>({a,id:a.getAttribute('onclick')?.match(/\bplayFile\(\s*(['"])([^'"]+)\1/)?.[2]})).filter(r=>r.id);
  const headers=Array.from(document.querySelectorAll(sidebarBranchSelector));
  const branches=headers.map((el,index)=>{const state=branchState(el);return {el,key:el.id||el.getAttribute('aria-controls')||el.closest('li')?.id||((el.textContent||'').trim()+'|'+index),state,closed:state==='closed'||state==='unloaded',visible:visible(el)};});
  const target=rows.find(r=>r.id===p.id)?.a;
  Object.assign(q,{videoCount:rows.length,visibleVideos:rows.filter(r=>visible(r.a)).length,chapterCount:headers.length,unloadedChapters:branches.filter(b=>b.state==='unloaded').length,collapsedChapters:branches.filter(b=>b.closed).length,matchedTarget:!!target});
  const signature=JSON.stringify([rows.map(r=>[r.id,visible(r.a)]),branches.map(b=>[b.key,b.closed,b.visible])]);
  if(signature!==q.signature){q.signature=signature;q.quietSince=now;}
  if(target&&visible(target))return target;
  if(now-q.at>=120000){await stop('右侧章节查找超过 120 秒，已展开 '+q.tried.size+' 个章节，仍未找到可点击的目标视频：'+p.title+'。请导出诊断。');return null;}
  if(now<q.waitUntil){q.stage='waiting-directory';show('正在等待右侧章节加载：'+p.title);return null;}
  const candidates=branches.filter(b=>b.closed&&b.visible);
  // If the link exists inside a closed branch, open its visible ancestor first.
  // One extra opening is allowed if an accordion closed an earlier branch while a slow request was finishing.
  const branch=target?candidates.find(b=>(branchBody(b.el)?.contains(target)||b.el.closest('li')?.contains(target))&&(q.tried.get(b.key)||0)<2):candidates.find(b=>!q.tried.has(b.key));
  if(branch){
   if(!await click(branch.el,p,()=>armChapterClick(branch.el)))return null;
   q.tried.set(branch.key,(q.tried.get(branch.key)||0)+1);q.chapterClicks++;q.quietSince=Date.now();q.waitUntil=Date.now()+3500;q.stage='opening-chapter';
   show('正在展开右侧章节（已展开 '+q.tried.size+' 个），查找：'+p.title);return null;
  }
  q.stage='waiting-directory';show('等待右侧视频目录加载；已展开 '+q.tried.size+' 个章节，目标：'+p.title);
  if(now-q.quietSince>=15000)await stop('已展开右侧 '+q.tried.size+' 个章节，等待目录加载后仍'+(target?'无法展开目标视频所在章节':'未找到目标视频')+'：'+p.title+'。请导出诊断。');
  return null;
 }
 async function switchVideo(s){
  const p=s.pending;
  if(!p){await stop('下一条视频记录不完整，请重新开始。');return;}
  if(!transition||transition.token!==p.token){
   const a=await findSidebarVideo(p);if(!a)return;
   if(!await click(a,p,()=>{
    const old=document.querySelector('video');
    transition={token:p.token,video:old,source:old?.currentSrc||old?.src||'',revision:mediaRevision,at:Date.now()};
    ending=true;sidebarSearch.stage='waiting-video';
   }))return;
   show('正在通过右侧目录切换：'+p.title);return;
  }
  const v=document.querySelector('video');
  const changed=v&&(v!==transition.video||(v.currentSrc||v.src||'')!==transition.source||mediaRevision>transition.revision);
  if(changed&&(v.readyState>=1||v.error)){
   const updated=await send({type:'SWITCH_CONFIRMED',token:p.token});
   if(!updated.running||updated.phase!=='video'||updated.pending?.token!==p.token)return;
   transition=null;sidebarSearch=null;activeToken=null;ending=false;await player(updated);return;
  }
  if(Date.now()-transition.at>60000){await stop('右侧目录切换后，播放器 60 秒内未完成切换，已停止。');return;}
  show('等待当前窗口加载：'+p.title);
 }
 async function player(s){
  if(s.phase==='switchVideo'){await switchVideo(s);return;}
  if(s.phase!=='video'){
   if(s.phase==='verify'||s.phase==='batchInfo')show('本批结束，等待核对平台进度；不足时继续在当前窗口补播。');
   else if(s.phase==='catalog')show(s.catalogProgress?.stage==='collecting'?s.status+'。请保留当前视频窗口。':'正在读取课程目录、准备播放队列，请保留当前视频窗口。');
   else show(s.status||'等待课程页面准备完成，请保留当前视频窗口。');
   return;
  }
  if(!s.pending){await stop('当前视频记录不完整，请重新开始。');return;}
  const v=document.querySelector('video');if(!v){if(Date.now()-waitSince>60000)await stop('播放器未加载，请检查页面。');return;}
  if(videoBound!==v||activeToken!==s.pending.token){
   if(videoBound){videoBound.removeEventListener?.('ended',endedHandler);videoBound.removeEventListener?.('playing',playingHandler);}
   videoBound=v;activeToken=s.pending.token;ending=false;playAttempted=false;startError="";hasPlayed=!v.paused;boundAt=Date.now();lastAdvance=Date.now();lastTime=v.currentTime;
   const token=activeToken;
   playingHandler=()=>{if(activeToken===token)hasPlayed=true;};
   endedHandler=()=>{if(activeToken===token&&!transition)finishVideo(token,'ended').catch(e=>stop('播放记录失败：'+e.message));};
   v.addEventListener('playing',playingHandler);v.addEventListener('ended',endedHandler);
  }
  if(ending)return;if(v.error){await finishVideo(activeToken,'failed','视频加载失败');return;}
  if(v.ended){await finishVideo(activeToken,'ended');return;}
  if(!hasPlayed&&v.readyState<2&&Date.now()-boundAt>90000){await finishVideo(activeToken,'failed','视频 90 秒内未加载完成');return;}
  if(!v.paused)hasPlayed=true;
  if(v.paused&&!hasPlayed&&!playAttempted&&v.readyState>=2&&Date.now()-boundAt>=3000){
   playAttempted=true;
   try{await L.startVideo(v);hasPlayed=true;}catch(e){startError=L.playbackError(e);show(startError);return;}
  }
  if(v.currentTime>lastTime+.2){lastTime=v.currentTime;lastAdvance=Date.now();}
  if(v.paused){lastAdvance=Date.now();show(hasPlayed?'视频已暂停，点击播放器的播放按钮继续。':playAttempted?(startError||'请点击播放器开始播放。'):'正在等待视频加载并自动启动…');return;}
  if(Date.now()-lastAdvance>90000){await finishVideo(activeToken,'failed','视频已卡住 90 秒');return;}
  show('正在播放：'+s.pending.title+(v.muted?'（静音中，可点击播放器扬声器开启声音）':'')+'；'+batchLabel(s)+'。');
 }
 async function tick(){
  if(busy)return;busy=true;lastTickAt=Date.now();
  try{
   const s=await get();if(!s.running)return;show(s.status);
   if(location.pathname==='/play/playVideo.action'){await player(s);return;}
   if(Date.now()<(s.waitUntil||0)){show('上一视频已关闭，等待 '+Math.ceil((s.waitUntil-Date.now())/1000)+' 秒后继续…');return;}
   if(Date.now()-lastAction<2000)return;
   if(s.phase==='skipCourse'){await nextCourse(s);return;}
   const ds=docs();if(ds.some(d=>d.querySelector('input[type="password"]'))){await stop('登录失效，请重新登录。');return;}
   const info=ds.find(d=>d.querySelector('#actualvideo'));
   const cat=ds.find(d=>d.querySelector('.parent_tit'));
   if(s.phase==='home'||s.phase==='scanHome'){
    const scanning=s.phase==='scanHome';
    const rows=courseRows();
    if(!rows.length){
     if(info||cat){await home();return;}
     show('等待本期课程列表加载…');
     if(Date.now()-waitSince>60000)await stop('课程列表 60 秒内未加载，请检查网络后刷新首页再开始。');
     return;
    }
    let courses=s.courses;
    if(!courses.length){courses=[...new Map(rows.map(r=>[r.url,{url:r.url,title:r.title}])).values()];await patch({courses},'识别到 '+courses.length+' 门本期课程');}
    const row=rows.find(r=>r.url===courses[s.courseIndex].url);if(!row){await stop('未找到下一科目的学习入口。');return;}
    await patch({phase:scanning?'scanInfo':'info'},(scanning?'扫描视频进度：':'检查科目：')+row.title);await click(row.a);return;
   }
   if(s.phase==='scanInfo'){
    if(!info){if(Date.now()-waitSince>60000)await stop('扫描时课程信息未加载，请重新开始。');return;}
    const q=quota(info);if(!q){if(Date.now()-waitSince>60000)await stop('无法读取当前科目的视频进度，扫描已停止。');return;}
    const updated=await saveQuota(s,q),i=s.courseIndex+1;
    if(i<s.courses.length){await patch({courseIndex:i,phase:'scanHome'},'已读取 '+s.courses[s.courseIndex].title+'：'+q.label);await home();return;}
    const result=L.plan(updated.courses);
    if(!result.ready){await stop('全部科目已检查，但有科目的视频进度无法确定，请重新扫描全部课程。');return;}
    await send({type:'SCAN_DONE'});show('扫描完成，已缓存全部科目。请在插件中点击使用缓存开始学习。');return;
   }
   if(s.phase==='video'||s.phase==='switchVideo'){
    if(!s.videoTabId){if(Date.now()-lastAction>20000)await stop('20 秒内未连接到视频页面。可能被浏览器拦截，或页面在初始化时退出；请查看运行记录后再测试。');return;}
    show('保持当前视频窗口，从右侧目录连续播放；'+batchLabel(s)+'。');
    return;
   }
   if(s.phase==='verify'){
    const a=link(info||cat||document,'课程信息');
    if(a){oldInfo=info;await patch({phase:'batchInfo'},'本批结束，统一读取平台实际进度');await click(a);}
    else if(Date.now()-waitSince>60000)await stop('未找到核对科目进度的入口。');
    return;
   }
   if((s.phase==='info'||s.phase==='batchInfo')&&info){
    if(s.phase==='batchInfo'&&info===oldInfo){if(Date.now()-waitSince>60000)await stop('科目进度页面未重新加载，请检查网络。');return;}
    oldInfo=null;
    const q=quota(info);if(!q){if(Date.now()-waitSince>60000)await stop('无法读取视频进度，例如 0/40。');return;}
    const updated=await saveQuota(s,q);
    if(q.full){await nextCourse(updated);return;}
    const a=link(info,'课程目录');if(a){await send({type:'BATCH_BEGIN'});await click(a);}else await stop('未找到当前科目的课程目录。');return;
   }
   if(s.phase==='catalog'&&cat){await catalog(s,cat);return;}
   if(Date.now()-waitSince>60000)await stop('页面未正常加载，请返回首页重新开始。');
  }catch(e){try{await stop('连播已停止：'+e.message);}catch{}}
  finally{busy=false;}
 }
 setInterval(tick,1500);tick();
})();
