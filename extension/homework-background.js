/* Homework has its own state and cache; all control messages still use the main worker's serial queue. */
(function(root){
 const H=HomeworkLogic,KEY='homeworkRun',CACHE='homeworkCache',ALARM='ynou-homework-wake';
 let timer=null,job=null;
 function resumable(s){return !s.running&&!s.pending?.submissionStarted&&!!s.pending&&s.paperTabId!=null&&(['review'].includes(s.phase)||s.phase==='stopped'&&(s.uncertainQuestions?.length||/^模型对第 \d+ 题没有把握/.test(s.status||'')));}
 const read=async()=>{
  const current=(await chrome.storage.session.get(KEY))[KEY];if(current)return current;
  // Extension reloads can clear session storage. Recover only a paused, unsubmitted
  // paper; the resume action must recheck the live tabs and reread all questions.
  const previous=(await chrome.storage.local.get('homeworkDiagnosis')).homeworkDiagnosis;
  if(previous&&resumable(previous)){const recovered={...previous,running:false};delete recovered.version;delete recovered.at;await chrome.storage.session.set({[KEY]:recovered});return recovered;}
  return {running:false,phase:'idle',status:'网上作业尚未开始',logs:[]};
 };
 const enqueue=fn=>{serial=serial.then(fn).catch(()=>{});};
 function log(s,text){s.status=text;s.logs=[...(s.logs||[]),{at:Date.now(),text}].slice(-80);}
 function phase(s,value,text){s.phase=value;s.phaseAt=Date.now();if(text)log(s,text);}
 function redacted(s){const {questions,answers,...rest}=s;return {...rest,canResume:resumable(s),questionCount:questions?.length||s.questionCount||0};}
 async function save(s){
  await chrome.storage.session.set({[KEY]:s});
  await chrome.storage.local.set({homeworkDiagnosis:{version:VERSION,at:Date.now(),...redacted(s)}});
  if(s.running){if(!await chrome.alarms.get(ALARM))await chrome.alarms.create(ALARM,{periodInMinutes:1});schedule(s);}
  else {if(timer!==null)clearTimeout(timer);timer=null;await chrome.alarms.clear(ALARM);}
  return s;
 }
 function schedule(s){if(!s.running||timer!==null)return;timer=setTimeout(()=>{timer=null;enqueue(wake);},1500);}
 async function halt(s,reason){job?.controller.abort();job=null;s.running=false;phase(s,'stopped',reason);await save(s);for(const id of [s.tabId,s.paperTabId].filter(id=>id!=null))await messageTab(id,{type:'HW_CANCEL',status:s.status,canResume:resumable(s)}).catch(()=>{});return s;}
 async function wake(){
  const s=await read();if(!s.running)return;
  const tabs=await chrome.tabs.query({url:H.origin+'/*'});
  const main=tabs.find(t=>t.id===s.tabId),paper=tabs.find(t=>t.id===s.paperTabId);
  if(!main||new URL(main.url).pathname!=='/webindex.action')return halt(s,'作业首页已关闭或离开，已停止。');
  if(s.paperTabId!=null&&!paper)return halt(s,'作业窗口已关闭，已停止；请先核对已提交的作业进度。');
  if(s.phase==='thinking'&&!job)return halt(s,'模型请求因扩展重启中断，未自动重新提交；请重新开始。');
  const elapsed=Date.now()-s.phaseAt,limit=s.phase==='thinking'?200000:180000;
  if(elapsed>limit)return halt(s,'当前步骤超过等待时间：'+s.status+'。页面已保留，请检查后重新开始。');
  const target=['opening','answering','thinking','ready','submitting','confirming','submitted','viewing'].includes(s.phase)?s.paperTabId??s.tabId:s.tabId;
  if(target!=null)await messageTab(target,{type:'HW_WAKE'}).catch(()=>null);
  schedule(await read());
 }
 function sameCourse(actual,expected){try{const a=new URL(actual),b=new URL(expected);return a.origin===H.origin&&['courseId','classId'].every(k=>a.searchParams.get(k)===b.searchParams.get(k)&&b.searchParams.get(k));}catch{return false;}}
 function isResult(url,s){try{const u=new URL(url);return u.origin===H.origin&&u.pathname==='/hw/student/studentViewHomework.action'&&u.searchParams.get('paper_id')===s.pending?.paperId&&u.searchParams.get('studentClass')===new URL(s.courses[s.courseIndex].url).searchParams.get('classId');}catch{return false;}}
 function allowedPaper(url,s){return H.samePaper(url,s.pending,s.courses?.[s.courseIndex])||isResult(url,s);}
 async function cache(s){
  const previous=(await chrome.storage.local.get(CACHE))[CACHE],now=Date.now();
  const homeworkCache={userKey:s.userKey,courses:s.courses,scannedAt:s.scanning?now:previous?.scannedAt||now,updatedAt:now};
  if(s.scanning&&s.unifiedScan){
   if(!s.courses.length||!s.courses.every(c=>H.validQuota(c.homework)&&H.validQuota(c.progress)&&H.validQuota(c.offline?.quota)&&c.offline?.catalogComplete))throw Error('视频、网上作业或离线作业状态不完整，原缓存已保留。');
   // Publish both caches in one storage operation only after every course is complete.
   await chrome.storage.local.set({homeworkCache,courseCache:{userKey:s.userKey,courses:s.courses.map(c=>({url:c.url,title:c.title,progress:c.progress,checkedAt:c.checkedAt})),scannedAt:now,updatedAt:now},combinedScan:{at:now,userKey:s.userKey,courseCount:s.courses.length}});
  }else await chrome.storage.local.set({[CACHE]:homeworkCache});
 }
 function beginVerify(s,text,expected){s.verifyAgain=0;s.verifyExpected=expected;s.verification=null;s.verifyAt=Date.now()+5000;phase(s,'verify',text);}
 function nextCourse(s){s.courseIndex++;s.pending=null;s.queue=[];s.attempted=[];s.batch=null;s.verifyAgain=0;s.verifyExpected=null;while(s.courseIndex<s.courses.length&&H.fullQuota(s.courses[s.courseIndex].homework))s.courseIndex++;if(s.courseIndex>=s.courses.length){s.running=false;phase(s,'done',s.skippedCourses?.length?'本轮作业已处理完；'+s.skippedCourses.length+' 科仍未达标，已跳过，原因见运行记录。':'所有本期科目的网上作业进度均已满额。');}else phase(s,'home','下一科：'+s.courses[s.courseIndex].title);}
 async function openPaper(s,next){
  if(!s.batch||s.batch.completed>=s.batch.goal)throw Error('本批已结束，需要先核对平台进度。');
  const existing=await chrome.tabs.query({url:H.origin+'/*'});if(existing.some(t=>/\/hw\/student\//.test(new URL(t.url).pathname)))throw Error('已有作业窗口，未重复打开。');
  s.pending={...next,token:++s.sequence,submissionStarted:false};s.openClicked=false;s.existingTabs=existing.map(t=>t.id);s.questions=null;s.answers=null;s.questionCount=0;s.uncertainQuestions=[];s.acceptUncertain=false;s.reviewCount=0;s.modelProgress=null;phase(s,'opening','本批 '+s.batch.completed+'/'+s.batch.goal+'；打开网上作业：'+next.title);return save(s);
 }
 function publicState(s,sender){const result=redacted(s);if(sender?.tab?.id===s.paperTabId&&['ready','submitting','confirming'].includes(s.phase)){result.questions=s.questions;result.answers=s.answers;}return result;}
 function safeQuestions(raw){
  if(!Array.isArray(raw)||!raw.length||raw.length>200)throw Error('作业题目数量不合法。');
  let length=0;
  return raw.map((q,i)=>{if(q.number!==i+1||!['radio','checkbox','text'].includes(q.type)||typeof q.text!=='string'||!q.text.trim()||q.text.length>16000)throw Error('作业题干格式不正确。');
   length+=q.text.length;if(length>120000)throw Error('单份作业过长，请手动处理。');
   const options=q.type==='text'?[]:q.options;
   if(!Array.isArray(options)||options.length>30||options.some(v=>typeof v!=='string'||!v||v.length>100)||new Set(options).size!==options.length||q.type!=='text'&&!options.length)throw Error('作业选项格式不正确。');
   if(q.type==='text'&&(!Number.isInteger(q.fields)||q.fields<1||q.fields>30))throw Error('填空数量不正确。');
   return {number:q.number,type:q.type,text:q.text,options,fields:q.type==='text'?q.fields:undefined};});
 }
 async function config(){const stored=(await chrome.storage.local.get('homeworkSettings')).homeworkSettings||{};return stored.schema===2?{baseUrl:stored.baseUrl,apiKey:stored.apiKey,model:stored.model}:{};}
 async function permitted(cfg){try{return await chrome.permissions.contains({origins:[HomeworkModel.endpoint(cfg.baseUrl).permission]});}catch{return false;}}
 async function requireConfig(){const cfg=await config();if(!HomeworkModel.configured(cfg))throw Error('请先在模型设置中填写 API 地址、API Key 并保存解题模型。');if(!await permitted(cfg))throw Error('模型接口尚未授权，请在模型设置中点击“保存设置”授权后再开始。');return cfg;}
 async function draftConfig(m){
  const baseUrl=HomeworkModel.endpoint(m.baseUrl).baseUrl,old=await config();
  const apiKey=HomeworkModel.key(typeof m.apiKey==='string'&&m.apiKey.trim()?m.apiKey:old.baseUrl===baseUrl?old.apiKey:'');
  const cfg={baseUrl,apiKey};if(!await permitted(cfg))throw Error('模型接口尚未授权，请在助手窗口重新点击获取模型或保存设置。');return cfg;
 }
 function updateJob(identity,fn){
  const task=serial.then(async()=>{const live=await read();if(job!==identity||!live.running||live.session!==identity.session||live.pending?.token!==identity.token||live.phase!=='thinking')return null;return fn(live);});
  serial=task.catch(()=>{});return task;
 }
 async function skipModelPaper(s,error){
  if(s.pending?.submissionStarted)return halt(s,'作业已开始提交，无法跳过；请检查当前页面。');
  const tab=await chrome.tabs.get(s.paperTabId).catch(()=>null);
  if(!tab||!H.samePaper(tab.url,s.pending,s.courses[s.courseIndex]))return halt(s,'当前作业页面已关闭或改变，未自动处理其他窗口。');
  const title=s.pending.title,reason=safeError(error),id=s.paperTabId;
  s.failedPapers=[...(s.failedPapers||[]),{title,course:s.courses[s.courseIndex].title,courseIndex:s.courseIndex,reason,at:Date.now()}].slice(-100);
  s.attempted=[...new Set([...s.attempted,s.pending.id])];s.pending=null;s.paperTabId=null;s.questions=null;s.answers=null;s.uncertainQuestions=[];s.acceptUncertain=false;s.modelProgress=null;
  const text=title+'：模型本组重试后仍失败，未提交，已跳过。'+reason;
  if(s.queue.some(r=>!r.complete&&!s.attempted.includes(r.id)))phase(s,'nextPaper',text+' 正在继续下一份作业');
  else beginVerify(s,text+' 返回首页核对已完成进度',Math.min(s.batch.total,s.batch.baseline+s.batch.completed));
  await save(s);
  try{await chrome.tabs.remove(id);}catch{const tabs=await chrome.tabs.query({});if(tabs.some(t=>t.id===id))await halt(s,'失败作业窗口未能关闭，已停止，避免重复打开窗口。');}
 }
 function retryDelay(signal){return new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,8000);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}
 async function solveGroups(identity,questions,cfg,review){
  const groups=HomeworkModel.batches(questions),answers=[];let tokens=0;
  for(let i=0;i<groups.length;i++){
   const group=groups[i],numbers=review?group.map(q=>q.number).join('、'):group[0].number+(group.length>1?'～'+group.at(-1).number:'');let result;
   for(let attempt=1;attempt<=2;attempt++){
    const live=await updateJob(identity,async s=>{s.modelProgress={kind:review?'review':'answer',group:i+1,groups:groups.length,done:answers.length,total:questions.length,attempt};phase(s,'thinking',(review?'正在自动复核':'模型分组解答')+' '+(i+1)+'/'+groups.length+' 组（第 '+numbers+' 题），已完成 '+answers.length+'/'+questions.length+' 题'+(attempt>1?'，本组自动重试 1/1':''));await save(s);return s;});
    if(!live)return null;
    const request=new AbortController(),cancel=()=>request.abort();let timedOut=false;
    identity.controller.signal.addEventListener('abort',cancel,{once:true});if(identity.controller.signal.aborted)cancel();
    const timeout=setTimeout(()=>{timedOut=true;request.abort();},90000);
    try{result=await HomeworkModel.solve(group,cfg,{signal:request.signal,allowUncertain:true,review});break;}
    catch(error){
     if(identity.controller.signal.aborted)return null;
     if(timedOut)error=Object.assign(new Error('模型本组响应超过 90 秒。'),{code:'MODEL_TIMEOUT',retryable:true});
     if(error.name==='TypeError')error.retryable=true;
     if(!error.retryable||attempt===2)throw error;
     const waiting=await updateJob(identity,async s=>{phase(s,'thinking','第 '+(i+1)+'/'+groups.length+' 组暂未完成，8 秒后自动重试一次：'+safeError(error));await save(s);return true;});
     if(!waiting)return null;await retryDelay(identity.controller.signal);if(identity.controller.signal.aborted)return null;
    }finally{clearTimeout(timeout);identity.controller.signal.removeEventListener('abort',cancel);}
   }
   if(identity.controller.signal.aborted)return null;
   answers.push(...result.answers);tokens+=result.tokens;
   const active=await updateJob(identity,async s=>{s.modelProgress.done=answers.length;s.tokens=(s.tokens||0)+result.tokens;await save(s);return true;});if(!active)return null;
  }
  return {answers,tokens};
 }
 function startJob(s,cfg,{review=false,autoReview=true}={}){
  const controller=new AbortController(),identity={session:s.session,token:s.pending.token,controller};job=identity;
  const questions=review&&s.answers?s.questions.filter(q=>s.uncertainQuestions.includes(q.number)):s.questions;
  solveGroups(identity,questions,cfg,review).then(result=>enqueue(async()=>{
   const live=await read();if(job!==identity||!live.running||live.session!==identity.session||live.pending?.token!==identity.token||live.phase!=='thinking')return;
   if(!result)return;
   job=null;const merged=review&&live.answers?live.answers.map(a=>result.answers.find(r=>r.number===a.number)||a):result.answers;
   live.answers=HomeworkModel.validate(live.questions,{answers:merged},{allowUncertain:true});
   live.uncertainQuestions=live.answers.filter(a=>a.uncertain).map(a=>a.number);
   if(live.uncertainQuestions.length){
    const numbers=live.uncertainQuestions.join('、');
    if(autoReview){live.reviewCount=(live.reviewCount||0)+1;phase(live,'thinking','模型对第 '+numbers+' 题暂不确定，正在单独复核一次（'+live.uncertainQuestions.length+' 题）');await save(live);startJob(live,cfg,{review:true,autoReview:false});return;}
    live.acceptUncertain=true;phase(live,'ready','第 '+numbers+' 题复核后仍不确定，按模型给出的最佳答案继续，疑问题号已记录。');await save(live);return;
   }
   live.acceptUncertain=false;phase(live,'ready',review?'复核通过，正在校验并填入整份 '+live.questionCount+' 题':'答案已生成，正在校验并填入 '+live.questionCount+' 题');await save(live);
  }),error=>enqueue(async()=>{const live=await read();if(job!==identity||!live.running||live.session!==identity.session)return;job=null;if(error.retryable)await skipModelPaper(live,error);else await halt(live,safeError(error));}));
 }
 function safeError(error){return String(error?.message||'作业处理失败').replace(/sk-[A-Za-z0-9_-]+/g,'[已隐藏密钥]').replace(/Bearer\s+\S+/g,'Bearer [已隐藏]').slice(0,300);}
 async function handle(m,sender){
  let s=await read();const popup=sender.url===chrome.runtime.getURL('popup.html')&&(sender.frameId==null||sender.frameId===0);
  const page=sender.tab&&sender.frameId===0&&CourseLogic.trusted(sender.url);
  if(m.type==='HW_GET'){
   if(popup){const local=await chrome.storage.local.get(CACHE);const cfg=await config();return {...redacted(s),cache:local[CACHE]||null,settings:{baseUrl:cfg.baseUrl||'',model:cfg.model||'',hasKey:!!cfg.apiKey,ready:HomeworkModel.configured(cfg)&&await permitted(cfg)},version:VERSION};}
   if(!page)return {running:false};
   if(s.running&&s.phase==='opening'&&s.paperTabId==null&&allowedPaper(sender.url,s)){
    const tab=await chrome.tabs.get(sender.tab.id);if(s.existingTabs.includes(tab.id)||(tab.openerTabId!=null&&tab.openerTabId!==s.tabId))return {running:false};
    s.paperTabId=tab.id;phase(s,isResult(sender.url,s)?'viewing':'answering','正在读取：'+s.pending.title);await save(s);
   }
   if(sender.tab.id===s.tabId||sender.tab.id===s.paperTabId&&allowedPaper(sender.url,s))return publicState(s,sender);
   return {running:false};
  }
  if(m.type==='HW_SETTINGS'&&popup){
   if(s.running)throw Error('请先停止作业再修改模型设置。');
   const cfg=await draftConfig(m);cfg.model=HomeworkModel.modelName(m.model);await chrome.storage.local.set({homeworkSettings:{schema:2,...cfg}});return {ok:true};
  }
  if(m.type==='HW_CLEAR_SETTINGS'&&popup){
   if(s.running)throw Error('请先停止作业再清除模型设置。');await chrome.storage.local.set({homeworkSettings:{schema:2}});return {ok:true};
  }
  if(m.type==='HW_MODELS'&&popup){
   if(s.running)throw Error('请先停止作业再获取模型。');const cfg=await draftConfig(m),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
   try{return await HomeworkModel.listModels(cfg,{signal:controller.signal});}finally{clearTimeout(timeout);}
  }
  if(m.type==='HW_RESUME'&&(popup||page&&(sender.tab.id===s.tabId||sender.tab.id===s.paperTabId))){
   if(!resumable(s))throw Error('当前没有可继续复核的作业。');
   const cfg=await requireConfig();
   if(m.session&&m.session!==s.session)throw Error('这份作业的运行状态已变化，请重新打开插件。');
   if((await chrome.storage.session.get('run')).run?.running)throw Error('请先停止视频任务。');
   const tabs=await chrome.tabs.query({url:H.origin+'/*'}),mainTab=tabs.find(t=>t.id===s.tabId),paperTab=tabs.find(t=>t.id===s.paperTabId);
   if(!mainTab||new URL(mainTab.url).pathname!=='/webindex.action'||!paperTab||!H.samePaper(paperTab.url,s.pending,s.courses[s.courseIndex]))throw Error('原作业或教学首页已关闭或改变，请返回首页使用缓存重新开始。');
   if(tabs.some(t=>/\/play\/playVideo\.action/.test(new URL(t.url).pathname)||/\/hw\/student\//.test(new URL(t.url).pathname)&&t.id!==s.paperTabId))throw Error('请先关闭其他视频或作业窗口，保留当前作业。');
   const mainReady=await messageTab(s.tabId,{type:'HW_PING'}),paperReady=await messageTab(s.paperTabId,{type:'HW_RESUME_CHECK'});
   if(mainReady?.version!==VERSION||paperReady?.version!==VERSION)throw Error('请刷新教学首页和当前作业页，加载新版脚本后再继续。');
   if(mainReady.userKey!==s.userKey)throw Error('登录账号已改变，未继续原作业。');
   if(paperReady.error)throw Error(paperReady.error);if(!paperReady.ready)throw Error('当前作业已不可填写，请检查页面。');
   const questions=safeQuestions(paperReady.questions);
   if(s.questions&&H.fingerprint(questions)!==H.fingerprint(s.questions))throw Error('当前题目已发生变化，不能续用原答案；请返回首页重新开始。');
   const review=!!s.answers&&!!s.uncertainQuestions?.length;
   s.questions=questions;s.questionCount=questions.length;s.running=true;s.pending.token=++s.sequence;s.reviewCount=(s.reviewCount||0)+1;
   phase(s,'thinking',review?'正在重新检查第 '+s.uncertainQuestions.join('、')+' 题，通过后继续当前作业':'正在重新解答当前 '+questions.length+' 题，通过后继续当前作业');await save(s);startJob(s,cfg,{review,autoReview:!review});return redacted(s);
  }
  if((m.type==='SCAN_ALL'||m.type==='HW_SCAN'||m.type==='HW_START')&&popup){
   if(s.running||(await chrome.storage.session.get('run')).run?.running)throw Error('请先停止当前视频或作业任务。');
   if(m.type==='HW_START')await requireConfig();
   const tab=await chrome.tabs.get(m.tabId);if(!CourseLogic.trusted(tab?.url)||new URL(tab.url).pathname!=='/webindex.action')throw Error('请在教学平台首页打开插件。');
   const open=await chrome.tabs.query({url:H.origin+'/*'});if(open.some(t=>/\/play\/playVideo\.action|\/hw\/student\//.test(new URL(t.url).pathname)))throw Error('请先关闭已有的视频和作业窗口，再开始。');
   const ready=await messageTab(tab.id,{type:'HW_PING'});if(!ready?.ready||ready.version!==VERSION)throw Error('请刷新教学平台首页，加载新版作业脚本。');
   if(!ready.userKey)throw Error('无法确认当前登录账号。');
   const cached=(await chrome.storage.local.get(CACHE))[CACHE];const scanning=m.type==='HW_SCAN'||m.type==='SCAN_ALL';
   if(!scanning&&(!cached||cached.userKey!==ready.userKey||!cached.courses?.length||!cached.courses.every(c=>H.validQuota(c.homework))))throw Error('请先手动扫描当前账号的网上作业进度。');
   const next=scanning?0:cached.courses.findIndex(c=>!H.fullQuota(c.homework));
   s={session:Date.now()+'-'+Math.random().toString(36).slice(2),running:next>=0,scanning,unifiedScan:m.type==='SCAN_ALL',userKey:ready.userKey,tabId:tab.id,paperTabId:null,courses:scanning?[]:cached.courses,courseIndex:next>=0?next:cached.courses.length,queue:[],attempted:[],sequence:0,finished:0,logs:[],results:[],phaseAt:Date.now()};
   phase(s,scanning?'scanHome':next>=0?'home':'done',scanning?(s.unifiedScan?'正在扫描全部课程的视频和网上作业进度':'正在手动扫描各科网上作业进度'):next<0?'缓存中的所有科目网上作业均已达标，无需打开课程。':next?'已跳过缓存中前 '+next+' 门达标课程，从 '+s.courses[next].title+' 开始网上作业':'使用缓存开始网上作业，先核对本科学习要求');await save(s);return redacted(s);
  }
  const main=page&&sender.tab.id===s.tabId,paper=page&&sender.tab.id===s.paperTabId&&allowedPaper(sender.url,s);
  if(m.type==='HW_STOP'&&(popup||main||paper))return redacted(await halt(s,popup?(s.scanning?'扫描已停止，原缓存完整保留。':'网上作业已停止，缓存保留。'):safeError({message:m.reason||'网上作业已停止。'})));
  if(!s.running||!main&&!paper)return {running:false};
  if(m.session&&m.session!==s.session)return {running:false};
  if(m.type==='HW_COURSES'&&main&&['home','scanHome'].includes(s.phase)&&!s.courses.length){
   const rows=Array.isArray(m.rows)?m.rows:[];s.courses=[...new Map(rows.filter(c=>CourseLogic.trusted(c.url)&&new URL(c.url).pathname==='/eduCourseBaseinfo/courseinfo.action').map(c=>[c.url,{url:c.url,title:H.norm(c.title).slice(0,160)}])).values()].slice(0,100);if(!s.courses.length)throw Error('没有读取到本期课程。');return publicState(await save(s),sender);
  }
  if(m.type==='HW_ENTER'&&main&&['home','scanHome','verifyHome'].includes(s.phase)&&sameCourse(m.url,s.courses[s.courseIndex]?.url)){
   const verifying=s.phase==='verifyHome';if(verifying&&(!s.verification?.documentId||m.documentId!==s.verification.documentId))return {running:false};
   if(verifying)s.verification.courseEnteredAt=Date.now();
   phase(s,verifying?'verifyInfo':s.scanning?'scanInfo':'info',(verifying?'已从首页点击本课程，等待实际进度：':s.unifiedScan?'读取视频和作业进度：':'读取网上作业进度：')+s.courses[s.courseIndex].title);return publicState(await save(s),sender);
  }
  if(m.type==='HW_QUOTA'&&main&&['info','scanInfo','verifyInfo'].includes(s.phase)){
   const verifying=s.phase==='verifyInfo';
   if(verifying&&(!s.verification?.documentId||m.documentId!==s.verification.documentId||m.verifyToken!==s.verification.token))return {running:false};
   if(!sameCourse(m.url,s.courses[s.courseIndex]?.url)||!H.validQuota(m.quota))throw Error('网上作业进度与当前科目不匹配。');
   if(s.scanning&&s.unifiedScan&&(!H.validQuota(m.videoQuota)||!H.validQuota(m.offlineQuota)))throw Error('本课程的视频或离线作业进度未完整读取，原缓存已保留。');
   const q=H.quota(m.quota.current+'/'+m.quota.total);s.courses[s.courseIndex].homework={...q,checkedAt:Date.now()};
   if(s.scanning&&s.unifiedScan){s.courses[s.courseIndex].progress=H.quota(m.videoQuota.current+'/'+m.videoQuota.total);s.courses[s.courseIndex].checkedAt=Date.now();s.courses[s.courseIndex].offline={quota:H.quota(m.offlineQuota.current+'/'+m.offlineQuota.total),catalogComplete:false};}
   log(s,s.courses[s.courseIndex].title+'：'+(s.scanning&&s.unifiedScan?'视频 '+s.courses[s.courseIndex].progress.label+' · ':'')+'网上作业 '+q.label);
   if(s.scanning){if(s.unifiedScan)phase(s,'scanOffline','正在检查离线作业提交状态：'+s.courses[s.courseIndex].title);else {s.courseIndex++;if(s.courseIndex===s.courses.length){await cache(s);s.running=false;phase(s,'done','网上作业扫描完成并已缓存。');}else phase(s,'scanHome');}}
   else {
    await cache(s);
    if(verifying){
     s.verification.observedAt=Date.now();s.verification.quota=q.label;
     if(!q.full&&q.current<s.verifyExpected){
      if((s.verifyAgain||0)<2){s.verifyAgain=(s.verifyAgain||0)+1;const seconds=20*s.verifyAgain;s.verifyAt=Date.now()+seconds*1000;phase(s,'verify','从首页重进后网上作业仍为 '+q.label+'，等待 '+seconds+' 秒再返回首页核对（复查 '+s.verifyAgain+'/2），期间不打开新作业');return publicState(await save(s),sender);}
      log(s,'三次从首页重进核对后仍为 '+q.label+'；按平台实际要求继续选择下一份未做网上作业');
     }
    }
    if(q.full)nextCourse(s);
    else {s.batch={baseline:q.current,total:q.total,goal:verifying?1:q.total-q.current,completed:0,round:(s.batch?.round||0)+1};s.verifyAgain=0;s.verifyExpected=null;phase(s,'catalog','平台网上作业 '+q.label+'；第 '+s.batch.round+' 批'+(verifying?'补做 1 份，再返回首页核对':'计划完成 '+s.batch.goal+' 份，再统一核对'));}
   }
   return publicState(await save(s),sender);
  }
  if(m.type==='HW_OFFLINE_DIRECTORY'&&main&&s.scanning&&s.unifiedScan&&s.phase==='scanOffline'){
   const c=s.courses[s.courseIndex];if(!sameCourse(m.url,c.url)||!Array.isArray(m.rows)||m.rows.length>2000||!H.validQuota(c.offline?.quota))throw Error('离线作业目录与当前科目不匹配，原缓存已保留。');
   const ids=new Set(),items=m.rows.map(r=>{if(!r||typeof r.id!=='string'||!/^\w[\w-]{0,99}$/.test(r.id)||ids.has(r.id)||!['pending','graded','unsubmitted','returned','unknown'].includes(r.status))throw Error('离线作业条目不完整，原缓存已保留。');ids.add(r.id);return {id:r.id,title:H.norm(r.title).slice(0,200),status:r.status,statusText:H.norm(r.statusText).slice(0,100)};});
   c.offline={...c.offline,items,summary:H.offlineSummary(items),catalogComplete:true,checkedAt:Date.now()};
   log(s,c.title+'：离线作业平台 '+c.offline.quota.label+'，目录已提交 '+c.offline.summary.submitted+' 份（待批改 '+c.offline.summary.pending+'），未提交 '+c.offline.summary.unsubmitted+'，退回 '+c.offline.summary.returned+'，状态不明 '+c.offline.summary.unknown);
   s.courseIndex++;if(s.courseIndex===s.courses.length){await cache(s);s.running=false;phase(s,'done','扫描完成，视频、网上作业与离线提交状态已一起缓存。');}else phase(s,'scanHome','继续扫描下一科：'+s.courses[s.courseIndex].title);
   return publicState(await save(s),sender);
  }
  if(m.type==='HW_DIRECTORY'&&main&&s.phase==='catalog'){
   if(!sameCourse(m.url,s.courses[s.courseIndex].url)||!Array.isArray(m.rows))throw Error('作业目录与当前科目不匹配。');
   const ids=new Set();s.queue=m.rows.filter(r=>typeof r.id==='string'&&/^[\w-]{1,100}$/.test(r.id)&&typeof r.paperId==='string'&&/^[\w-]{1,100}$/.test(r.paperId)&&!ids.has(r.id)&&ids.add(r.id)).map(r=>({id:r.id,paperId:r.paperId,title:H.norm(r.title).slice(0,200),complete:r.complete===true}));
   const next=s.queue.find(r=>!r.complete&&!s.attempted.includes(r.id));
   if(!next){const c=s.courses[s.courseIndex],failed=(s.failedPapers||[]).filter(p=>p.courseIndex===s.courseIndex).length,reason=failed?'本轮剩余作业已尝试，其中 '+failed+' 份模型失败未提交':'没有可继续完成的网上作业';s.skippedCourses=[...(s.skippedCourses||[]),{title:c.title,progress:c.homework.label,at:Date.now(),reason}];log(s,c.title+'：'+reason+'，平台进度 '+c.homework.label+(failed?'，保留实际进度并跳过本科':'，记录待平台更新并跳过本科'));nextCourse(s);return publicState(await save(s),sender);}
   return publicState(await openPaper(s,next),sender);
  }
  if(m.type==='HW_NEXT_PAPER'&&main&&s.phase==='nextPaper'){
   const next=s.queue.find(r=>!r.complete&&!s.attempted.includes(r.id));if(!next){beginVerify(s,'本批目录已用完，返回首页重进本科核对实际进度',Math.min(s.batch.total,s.batch.baseline+s.batch.completed));return publicState(await save(s),sender);}
   return publicState(await openPaper(s,next),sender);
  }
  if(m.type==='HW_CLAIM_OPEN'&&main&&s.phase==='opening'&&m.token===s.pending?.token){if(s.openClicked)return {running:false};s.openClicked=true;return publicState(await save(s),sender);}
  if(m.type==='HW_SOLVE'&&paper&&s.phase==='answering'&&m.token===s.pending?.token){
   let cfg;try{cfg=await requireConfig();}catch(error){return publicState(await halt(s,error.message),sender);}
   s.questions=safeQuestions(m.questions);s.questionCount=s.questions.length;phase(s,'thinking','模型正在解答 '+s.questionCount+' 道题');await save(s);startJob(s,cfg);return publicState(s,sender);
  }
  if(m.type==='HW_PREPARE_SUBMIT'&&paper&&s.phase==='ready'&&m.token===s.pending?.token){HomeworkModel.validate(s.questions,{answers:s.answers},{allowUncertain:s.acceptUncertain===true});s.pending.submissionStarted=true;phase(s,'submitting','已校验全部答案，点击完成作业');return publicState(await save(s),sender);}
  if(m.type==='HW_CONFIRM'&&paper&&s.phase==='submitting'&&m.token===s.pending?.token){phase(s,'confirming','确认提交，等待平台结果');return publicState(await save(s),sender);}
  if(m.type==='HW_VIEW'&&paper&&['answering','submitting','confirming'].includes(s.phase)&&m.token===s.pending?.token){phase(s,'viewing','已提交，正在打开答题成绩和解析');return publicState(await save(s),sender);}
  if(m.type==='HW_RESULT'&&paper&&isResult(sender.url,s)&&['viewing','answering'].includes(s.phase)&&m.token===s.pending?.token){
   const score=Number(m.score),count=Number(m.count);if(!Number.isFinite(score)||score<0||!Number.isInteger(count)||count<1||count>200)throw Error('成绩尚未完整加载。');
   const existingResult=!s.pending.submissionStarted;
   s.results.push({title:s.pending.title,course:s.courses[s.courseIndex].title,score,count,existingResult,uncertainQuestions:s.acceptUncertain?[...(s.uncertainQuestions||[])]:[],at:Date.now()});s.results=s.results.slice(-150);s.attempted.push(s.pending.id);s.questions=null;s.answers=null;
   const id=s.paperTabId;s.paperTabId=null;if(!existingResult){s.finished++;s.batch.completed++;}
   const due=s.batch.completed>=s.batch.goal||!s.queue.some(r=>!r.complete&&!s.attempted.includes(r.id));
   const status=(existingResult?'此作业已有成绩，已查看并跳过，不计入本批新完成数；':'已查看成绩和解析，得分 '+score+'；')+'本批 '+s.batch.completed+'/'+s.batch.goal+' 份，'+(due?'返回首页重进本科后统一核对进度':'继续下一份作业');
   if(due)beginVerify(s,status,Math.min(s.batch.total,s.batch.baseline+s.batch.completed));else phase(s,'nextPaper',status);await save(s);
   try{await chrome.tabs.remove(id);}catch{const open=await chrome.tabs.query({});if(open.some(t=>t.id===id))return redacted(await halt(s,'成绩窗口未能关闭，请关闭后重新开始。'));}
   return publicState(s,sender);
  }
  if(m.type==='HW_VERIFY'&&main&&s.phase==='verify'&&Date.now()>=s.verifyAt){
   if(typeof m.documentId!=='string'||!m.documentId||m.documentId.length>100)throw Error('请刷新教学平台首页，加载新版核对脚本。');
   s.verification={token:Date.now()+'-'+Math.random().toString(36).slice(2),sourceDocumentId:m.documentId,courseTitle:s.courses[s.courseIndex].title,baseline:s.batch.baseline,expected:s.verifyExpected,attempt:(s.verifyAgain||0)+1,requestedAt:Date.now()};
   phase(s,'verifyReturnHome','准备第 '+s.verification.attempt+'/3 次点击首页，再进入本课程核对进度');return publicState(await save(s),sender);
  }
  if(m.type==='HW_CLAIM_HOME'&&main){
   if(s.phase!=='verifyReturnHome'||m.token!==s.verification?.token)return {running:false};
   const tabs=await chrome.tabs.query({url:H.origin+'/*'});
   if(tabs.some(t=>/\/play\/playVideo\.action|\/hw\/student\//.test(new URL(t.url).pathname)))return redacted(await halt(s,'仍有视频或作业窗口，已暂停进度核对，请关闭后重新开始。'));
   // Claim once before the real page click; background wakeups must not click Home repeatedly.
   s.verification.homeClickedAt=Date.now();phase(s,'verifyHome','正在点击首页，等待本期课程列表加载');return publicState(await save(s),sender);
  }
  if(m.type==='HW_VERIFY_READY'&&main&&s.phase==='verifyHome'&&s.verification?.homeClickedAt&&m.token===s.verification.token){
   if(typeof m.documentId!=='string'||!m.documentId||m.documentId.length>100||m.documentId===s.verification.sourceDocumentId)return {running:false};
   if(m.userKey!==s.userKey)return redacted(await halt(s,'返回首页后登录账号发生变化，已停止核对。'));
   if(s.verification.documentId!==m.documentId){s.verification.documentId=m.documentId;s.verification.loadedAt=Date.now();log(s,'已返回首页并加载本期课程列表，正在重新点击本课程学习入口');await save(s);}return publicState(s,sender);
  }
  if(m.type==='HW_ACTIVITY'&&main&&['catalog','nextPaper','scanOffline'].includes(s.phase)){s.status=String(m.status||'正在读取作业目录').slice(0,200);if(s.phase==='scanOffline')s.phaseAt=Date.now();return publicState(await save(s),sender);}
  return publicState(s,sender);
 }
 chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM){if(timer!==null)clearTimeout(timer);timer=null;enqueue(wake);}});
 chrome.tabs.onRemoved.addListener(id=>enqueue(async()=>{const s=await read();if(s.running&&(s.tabId===id||s.paperTabId===id))await halt(s,'作业相关窗口已关闭，任务停止，缓存保留。');}));
 const api={handle,read,save,halt,publicState,sameCourse,isResult,safeQuestions,safeError};root.HomeworkController=api;
 enqueue(async()=>{const s=await read();if(s.running)schedule(s);});
})(globalThis);
