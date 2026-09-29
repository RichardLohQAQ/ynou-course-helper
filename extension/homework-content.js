(() => {
 if(window.top!==window)return;
 if(location.pathname!=='/webindex.action'&&!/^\/hw\/student\/student(?:Start|View)Homework\.action$/.test(location.pathname))return;
 const H=HomeworkLogic,VERSION='1.6.1',documentId=Date.now()+'-'+Math.random().toString(36).slice(2);let busy=false,lastAction=0,scan=null,offlineScan=null,panel=null,resumeButton=null,gradeSample=null,quotaSample=null,runSession=null;
 const chapterDocs=new Set();
 const send=async m=>{const r=await chrome.runtime.sendMessage(m);if(r?.error)throw Error(r.error);return r;};
 const get=()=>send({type:'HW_GET'});
 const docs=()=>{const a=[document];for(let i=0;i<a.length;i++)for(const f of a[i].querySelectorAll('iframe')){try{if(f.contentDocument&&!a.includes(f.contentDocument))a.push(f.contentDocument);}catch{}}return a;};
 const link=(d,text)=>Array.from(d.querySelectorAll('a')).find(a=>H.norm(a.textContent)===text&&H.visible(a));
 const userKey=()=>Array.from(document.querySelectorAll('p')).find(e=>e.textContent.includes('欢迎您'))?.textContent.split('个人设置')[0].replace(/\s+/g,'').trim()||'';
 const command=(s,type,data={})=>send({type,session:s.session,...data});
 function show(text,canResume=false){
  if(!panel){const host=document.createElement('div');host.id='ynou-homework-status';host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647';const sh=host.attachShadow({mode:'closed'});sh.innerHTML='<style>section{box-sizing:border-box;width:320px;max-width:calc(100vw - 36px);background:#183963;color:white;padding:16px;border-radius:12px;font:14px/1.7 system-ui;box-shadow:0 4px 24px #0003}b{font-size:16px}p{margin:7px 0 12px}.actions{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;padding:7px 14px;border:0;border-radius:6px;cursor:pointer}button[hidden]{display:none}</style><section><b>网上作业助手</b><p></p><div class="actions"><button id="resume" hidden>重新检查并继续</button><button id="stop">停止作业</button></div></section>';panel=sh.querySelector('p');resumeButton=sh.querySelector('#resume');sh.querySelector('#stop').onclick=()=>stop('网上作业已手动停止。');resumeButton.onclick=async()=>{resumeButton.disabled=true;try{const s=await get(),r=await command(s,'HW_RESUME');show(r.status,r.canResume);}catch(e){show(e.message,true);}finally{resumeButton.disabled=false;}};document.documentElement.append(host);}panel.textContent=text;resumeButton.hidden=!canResume;
 }
 function clearChapters(){if(offlineScan)offlineScan.document.removeEventListener('__ynouEmptyChapter134',offlineScan.onEmpty);offlineScan=null;for(const d of chapterDocs){try{d.dispatchEvent(new d.defaultView.CustomEvent('__ynouChapterAction134',{detail:JSON.stringify({action:'clear'})}));}catch{}}chapterDocs.clear();}
 async function stop(reason){clearChapters();await send({type:'HW_STOP',reason});show(reason);}
 async function click(a,s,expected){
  const live=await get();if(!live.running||live.session!==s.session||(expected&&live.phase!==expected))return false;
  if(!a?.isConnected||!H.visible(a))throw Error('页面入口已改变或不可见，已停止。');
  a.scrollIntoView({block:'center'});a.click();lastAction=Date.now();return true;
 }
 async function goHome(s){const a=link(document,'首页');if(!a)throw Error('未找到首页入口。');await click(a,s);}
 function courseRows(){return docs().flatMap(d=>Array.from(d.querySelectorAll('a.studybtn')).filter(H.visible).map(a=>({a,url:a.href,title:H.norm(a.closest('li')?.querySelector('.coursetit')?.textContent||'课程')})));}
 function sameCourse(a,b){try{const x=new URL(a),y=new URL(b);return x.origin===H.origin&&['courseId','classId'].every(k=>x.searchParams.get(k)===y.searchParams.get(k)&&y.searchParams.get(k));}catch{return false;}}
 function armChapter(el){const token='hw-'+Date.now();chapterDocs.add(el.ownerDocument);el.ownerDocument.dispatchEvent(new el.ownerDocument.defaultView.CustomEvent('__ynouChapterAction134',{detail:JSON.stringify({action:'arm',token})}));return token;}
 async function openPending(s,d){
  if(s.openClicked)return;
  const target=H.rows(d).find(r=>r.id===s.pending?.id);if(!target)throw Error('目录未找到下一份作业入口。');
  if(!H.visible(target.a)){
   for(let li=target.a.closest('li')?.parentElement?.closest('li');li;li=li.parentElement?.closest('li')){
    const header=Array.from(li.children).find(e=>e.matches('.parent_tit')&&H.visible(e));
    if(header){armChapter(header);await click(header,s,'opening');return;}
   }
   throw Error('无法展开下一份作业所在章节。');
  }
  const live=await command(s,'HW_CLAIM_OPEN',{token:s.pending.token});if(live.running)await click(target.a,live,'opening');
 }
 async function catalog(s,d,continuing=false){
  if(!scan||scan.document!==d||scan.session!==s.session||scan.course!==s.courseIndex)scan={document:d,session:s.session,course:s.courseIndex,tried:new Set(),at:Date.now(),lastClick:0};
  if(Date.now()-scan.lastClick<3500)return;
  const headers=Array.from(d.querySelectorAll('.parent_tit')).filter(H.visible);
  const dedicated=headers.filter(e=>H.onlineSection(e.textContent));
  const candidates=dedicated.length?dedicated:headers.filter(e=>!H.offlineSection(e.textContent)&&!/视频|模拟试题|考试/.test(H.norm(e.textContent)));
  const key=e=>e.id||e.closest('li')?.id||H.norm(e.textContent);
  const closed=e=>e.getAttribute('title')==='Expand this branch'||e.getAttribute('aria-expanded')==='false'||!e.closest('li')?.querySelector('ul');
  const next=candidates.find(e=>closed(e)&&!scan.tried.has(key(e)));
  if(next){await command(s,'HW_ACTIVITY',{status:'正在展开作业章节：'+H.norm(next.textContent).slice(0,100)+'（已展开 '+scan.tried.size+' 章）'});armChapter(next);if(await click(next,s,continuing?'nextPaper':'catalog')){scan.tried.add(key(next));scan.lastClick=Date.now();}return;}
  const rows=H.rows(d);if(!rows.length&&Date.now()-scan.at<12000)return;
  const result=continuing?await command(s,'HW_NEXT_PAPER'):await command(s,'HW_DIRECTORY',{url:d.location.href,rows:rows.map(({a,...r})=>r)});
  if(!result.running){show(result.status);return;}
  if(result.phase==='opening')await openPending(result,d);
  else if(result.phase==='home')await goHome(result);
 }
 async function main(s){
  const ds=docs();if(ds.some(d=>d.querySelector('input[type=password]')))throw Error('登录已失效，请重新登录。');
  const info=ds.find(d=>d.querySelector('#testnum')),cat=ds.find(d=>d.querySelector('#course .parent_tit')||d.querySelector('.parent_tit'));
  if(s.phase==='verifyReturnHome'){
   const a=link(document,'首页');if(!a)throw Error('未找到首页入口，无法返回首页核对进度。');
   const live=await command(s,'HW_CLAIM_HOME',{token:s.verification.token});await click(a,live,'verifyHome');return;
  }
  if(s.phase==='verifyHome'){
   if(!s.verification?.homeClickedAt||documentId===s.verification.sourceDocumentId)return;
   if(!courseRows().length)return;
   if(s.verification.documentId!==documentId){const currentUser=userKey();if(!currentUser)return;await command(s,'HW_VERIFY_READY',{documentId,token:s.verification.token,userKey:currentUser});return;}
  }
  if(['home','scanHome','verifyHome'].includes(s.phase)){
   const rows=courseRows();if(!rows.length){if(info||cat)await goHome(s);return;}
   if(!s.courses.length)s=await command(s,'HW_COURSES',{rows:rows.map(({a,...r})=>r)});
   const current=s.courses[s.courseIndex],row=rows.find(r=>sameCourse(r.url,current.url));if(!row)throw Error('本期课程发生变化，请重新手动扫描。');
   const live=await command(s,'HW_ENTER',{url:row.url,documentId});await click(row.a,live);return;
  }
  if(['info','scanInfo','verifyInfo'].includes(s.phase)){
   if(!info)return;
   if(s.phase==='verifyInfo'&&documentId!==s.verification?.documentId)return;
   const q=H.progress(info);if(!q)return;
   if(!H.norm(info.querySelector('#course_Code')?.textContent))return;
   const videoQuota=s.scanning&&s.unifiedScan?H.quota(info.querySelector('#actualvideo')?.textContent):null,offlineQuota=s.scanning&&s.unifiedScan?H.offlineProgress(info):null;
   if(s.scanning&&s.unifiedScan&&(!videoQuota||!offlineQuota))return;
   const signature=info.location.href+'|'+q.label+'|'+(videoQuota?.label||'')+'|'+(offlineQuota?.label||'');
   if(quotaSample?.document!==info||quotaSample?.signature!==signature){quotaSample={document:info,signature,at:Date.now()};return;}
   if(Date.now()-quotaSample.at<3000)return;
   // Data populates asynchronously. A matching course ID plus its rendered quota is required.
   if(!sameCourse(info.location.href,s.courses[s.courseIndex].url))return;
   const result=await command(s,'HW_QUOTA',{url:info.location.href,quota:q,videoQuota,offlineQuota,documentId,verifyToken:s.verification?.token});
   if(!result.running){show(result.status);return;}
   if(['home','scanHome'].includes(result.phase))await goHome(result);
   else if(['catalog','scanOffline'].includes(result.phase)){const a=link(info,'课程目录');if(!a)throw Error('未找到课程目录。');await click(a,result,result.phase);}
   return;
  }
  if(s.phase==='scanOffline'){
   if(cat&&sameCourse(cat.location.href,s.courses[s.courseIndex].url))await scanOfflineCatalog(s,cat);
   else if(info&&sameCourse(info.location.href,s.courses[s.courseIndex].url)){const a=link(info,'课程目录');if(!a)throw Error('未找到离线作业目录入口。');await click(a,s,'scanOffline');}return;
  }
  if(s.phase==='catalog'){
   if(cat&&sameCourse(cat.location.href,s.courses[s.courseIndex].url))await catalog(s,cat);
   else if(info){const a=link(info,'课程目录');if(a)await click(a,s,'catalog');}return;
  }
  if(s.phase==='nextPaper'){
   if(cat&&sameCourse(cat.location.href,s.courses[s.courseIndex].url)){await catalog(s,cat,true);return;}
   if(info&&sameCourse(info.location.href,s.courses[s.courseIndex].url)){const a=link(info,'课程目录');if(a)await click(a,s,'nextPaper');return;}
   const row=courseRows().find(r=>sameCourse(r.url,s.courses[s.courseIndex].url));if(row)await click(row.a,s,'nextPaper');else if(info||cat)await goHome(s);return;
  }
  if(s.phase==='opening'&&!s.paperTabId&&cat){await openPending(s,cat);return;}
  if(s.phase==='verify'&&Date.now()>=s.verifyAt){
   await command(s,'HW_VERIFY',{documentId});return;
  }
 }
 async function scanOfflineCatalog(s,d){
  if(!offlineScan||offlineScan.document!==d||offlineScan.session!==s.session||offlineScan.course!==s.courseIndex){
   if(offlineScan)offlineScan.document.removeEventListener('__ynouEmptyChapter134',offlineScan.onEmpty);
   offlineScan={document:d,session:s.session,course:s.courseIndex,tried:new Set(),rows:new Map(),pending:null,changedAt:Date.now(),signature:''};
   offlineScan.onEmpty=e=>{try{if(JSON.parse(e.detail).token===offlineScan?.pending?.token)offlineScan.pending.empty=true;}catch{}};d.addEventListener('__ynouEmptyChapter134',offlineScan.onEmpty);
  }
  const o=offlineScan,key=e=>e.id||e.closest('li')?.id||H.norm(e.textContent);
  for(const row of H.offlineRows(d))o.rows.set(row.id,row);
  const signature=JSON.stringify(H.offlineRows(d));if(signature!==o.signature){o.signature=signature;o.changedAt=Date.now();}
  const headers=Array.from(d.querySelectorAll('.parent_tit')).filter(H.visible);
  if(o.pending){
   if(Date.now()-o.pending.at<3500)return;
   const header=headers.find(e=>key(e)===o.pending.key),loaded=header?.closest('li')?.querySelector('ul');
   if(!o.pending.empty&&!loaded?.children.length){if(Date.now()-o.pending.at>25000)throw Error('离线章节未加载完成：'+o.pending.title+'，原缓存已保留。');return;}
   o.pending=null;o.changedAt=Date.now();
  }
  const candidates=headers.filter(e=>/离线\s*作业/.test(H.norm(e.textContent))||!H.onlineSection(e.textContent)&&!/视频|模拟试题|考试/.test(H.norm(e.textContent)));
  const next=candidates.find(e=>!o.tried.has(key(e))&&(e.getAttribute('title')==='Expand this branch'||e.getAttribute('aria-expanded')==='false'||!e.closest('li')?.querySelector('ul')));
  if(next){
   const title=H.norm(next.textContent);await command(s,'HW_ACTIVITY',{status:'正在扫描离线作业章节：'+title+'（已识别 '+o.rows.size+' 份）'});
   o.pending={key:key(next),title,at:Date.now(),token:null,empty:false};o.pending.token=armChapter(next);
   if(await click(next,s,'scanOffline')){o.tried.add(key(next));o.changedAt=Date.now();}else o.pending=null;return;
  }
  if(Date.now()-o.changedAt<6000)return;
  const rows=Array.from(o.rows.values()).sort((a,b)=>{for(let i=0;i<Math.max(a.order.length,b.order.length);i++){const delta=(a.order[i]??-1)-(b.order[i]??-1);if(delta)return delta;}return 0;}).map(({order,...row})=>row);
  const result=await command(s,'HW_OFFLINE_DIRECTORY',{url:d.location.href,rows});clearChapters();
  if(result.running&&result.phase==='scanHome')await goHome(result);else show(result.status);
 }
 function dialog(){return Array.from(document.querySelectorAll('.aui_dialog')).filter(H.visible).map(el=>({el,text:H.norm(el.querySelector('.aui_content')?.textContent||''),buttons:Array.from(el.querySelectorAll('button')).filter(H.visible)}));}
 function resultLink(s){return Array.from(document.querySelectorAll('a')).find(a=>{if(H.norm(a.textContent)!=='查看答题成绩和解析'||!H.visible(a))return false;try{const u=new URL(a.href),current=new URL(location.href);return u.origin===H.origin&&u.pathname==='/hw/student/studentViewHomework.action'&&u.searchParams.get('paper_id')===s.pending.paperId&&u.searchParams.get('studentClass')===current.searchParams.get('eduCourseClassPaper.classId');}catch{return false;}});}
 async function paper(s){
  if(location.pathname==='/hw/student/studentViewHomework.action'){
   const scores=Array.from(document.querySelectorAll('input[id$="_cj"]'));
   const count=(document.body.innerText.match(/答题历史[：:]/g)||[]).length;
   if(!scores.length||scores.length!==count||scores.some(e=>!e.disabled||!/^\d+(\.\d+)?$/.test(e.value)))return;
   const values=scores.map(e=>+e.value),signature=JSON.stringify(values);
   if(gradeSample?.signature!==signature){gradeSample={signature,at:Date.now()};return;}
   if(Date.now()-gradeSample.at<3000)return;
   await command(s,'HW_RESULT',{token:s.pending.token,score:values.reduce((a,b)=>a+b,0),count});return;
  }
  const completed=resultLink(s);
  if(completed&&['answering','submitting','confirming'].includes(s.phase)){const live=await command(s,'HW_VIEW',{token:s.pending.token});await click(completed,live,'viewing');return;}
  const dialogs=dialog();const unknown=dialogs.find(d=>d.text&&!/^loading\.*$/i.test(d.text)&&d.text!=='检查下是否有未做完的试题，点击【确定】按钮提交！'&&!d.text.includes('作业做完了！'));
  if(unknown)throw Error('网站提示：'+unknown.text.slice(0,180));
  if(s.phase==='answering'){
   if(dialogs.some(d=>/^loading\.*$/i.test(d.text)))return;
   const questions=H.questions(document);await command(s,'HW_SOLVE',{questions,token:s.pending.token});return;
  }
  if(s.phase==='ready'){
   if(Date.now()-s.phaseAt<3000)return;
   HomeworkModel.validate(s.questions,{answers:s.answers},{allowUncertain:s.acceptUncertain===true});H.apply(document,s.questions,s.answers);
   const submit=document.querySelector('#bt');if(!submit||submit.value!=='完成作业'||submit.disabled)throw Error('未找到可用的完成作业按钮。');
   const live=await command(s,'HW_PREPARE_SUBMIT',{token:s.pending.token});await click(submit,live,'submitting');return;
  }
  if(s.phase==='submitting'){
   const confirm=dialogs.find(d=>d.text==='检查下是否有未做完的试题，点击【确定】按钮提交！');
   if(confirm){if(!H.matches(document,s.questions,s.answers))throw Error('提交前答案发生变化，已停止。');const button=confirm.buttons.find(b=>H.norm(b.textContent)==='确定');if(!button)throw Error('未找到提交确认按钮。');const live=await command(s,'HW_CONFIRM',{token:s.pending.token});await click(button,live,'confirming');}
  }
 }
 async function tick(){
  if(busy)return;busy=true;
  try{const s=await get();if(!s.running){if(panel||s.canResume)show(s.status||'网上作业已停止。',s.canResume);return;}
   if(runSession!==s.session){runSession=s.session;scan=null;gradeSample=null;quotaSample=null;}
   show(s.status);if(Date.now()-lastAction<1800)return;
   if(location.pathname==='/webindex.action')await main(s);else await paper(s);
  }catch(e){try{await stop('网上作业已停止：'+e.message);}catch{}}
  finally{busy=false;}
 }
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m.type==='HW_PING'){reply({ready:true,version:VERSION,userKey:userKey()});return;}
  if(m.type==='HW_CANCEL'){clearChapters();if(panel||m.canResume)show(m.status||'网上作业已停止。',m.canResume);reply({ready:true});return;}
  if(m.type==='HW_RESUME_CHECK'){
   try{const submit=document.querySelector('#bt'),done=Array.from(document.querySelectorAll('a')).some(a=>H.visible(a)&&H.norm(a.textContent)==='查看答题成绩和解析');
    if(!submit||submit.value!=='完成作业'||submit.disabled||done||dialog().some(d=>d.text))reply({ready:false,version:VERSION});
    else reply({ready:true,version:VERSION,questions:H.questions(document)});
   }catch(e){reply({ready:false,version:VERSION,error:e.message});}return;
  }
  if(m.type==='HW_WAKE'){reply({ready:true,version:VERSION});tick();}
 });
 setInterval(tick,1500);tick();
})();
