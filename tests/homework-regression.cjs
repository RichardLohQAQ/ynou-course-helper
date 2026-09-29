const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const H=require('../extension/homework-logic.js'),M=require('../extension/homework-model.js');
const dir='extension/',origin=H.origin,settle=()=>new Promise(r=>setImmediate(r));
function dom(html,url=origin+'/hw/student/studentStartHomework.action'){
 const d=new JSDOM(html,{url,runScripts:'outside-only'}),w=d.window;
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(options){const shadow=attach.call(this,options);this.testShadow=shadow;return shadow;};
 w.HTMLElement.prototype.getClientRects=function(){for(let el=this;el;el=el.parentElement)if(el.hidden||el.style.display==='none')return [];return this.isConnected?[{}]:[];};
 w.HTMLElement.prototype.scrollIntoView=function(){};return d;
}
const question=(number,type='radio')=>`<div class="e_juan02daan"><div class="qcontent">题目 ${number}，A 错误，B 正确</div><div answer_control="${type}">${type==='text'?'<input type="text"><textarea></textarea>':['A','B'].map(v=>`<input type="${type}" name="q${number}" id="q${number}" value="${v}">`).join('')}</div></div>`;
// Persisted dictionary property order is not part of the question identity.
// Reorder keys and omit undefined fields as observed in the exported browser state.
function storedValue(value){
 if(Array.isArray(value))return Array.from(value,storedValue);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,storedValue(value[k])]));
 return value;
}

test('作业进度读取只取网上作业，不混淆视频和离线作业，支持0/0',()=>{
 const d=dom('<ul><li><span>视频进度</span><span>40/40</span></li><li><span>离线作业进度</span><span>0/4</span></li><li><span>网上作业进度</span><span id="testnum">1/4</span></li></ul>').window.document;
 assert.equal(H.progress(d).label,'1/4');assert.equal(H.quota('0/0').full,true);assert.equal(H.quota('x/y'),null);
});
test('按DOM顺序识别网上作业入口，跳过离线文档，已学与未学区分',()=>{
 const d=dom(`<ul>${[['10','未学'],['2','已学'],['1','未学']].map(([n,status])=>`<li><a onclick="viewPaper('paper${n}','${n}',this)">第${n}章 网上作业</a><span class="tree-conr">${status}</span></li>`).join('')}<li><a onclick="viewRes('file','pdf')">离线作业</a></li></ul>`).window.document;
 assert.deepEqual(H.rows(d).map(r=>[r.id,r.complete]),[['10',false],['2',true],['1',false]]);
});
test('真实控件结构提取题干，重复id按题目分组，支持单选多选和逐空填写',()=>{
 const d=dom(question(1)+question(2,'checkbox')+question(3,'text')).window.document;
 const qs=H.questions(d),answers=[{number:1,values:['B']},{number:2,values:['A','B']},{number:3,values:['first','second']}];
 M.validate(qs,{answers});H.apply(d,qs,answers);assert.equal(H.matches(d,qs,answers),true);
 d.querySelector('textarea').value='first';d.querySelector('input[type=text]').value='second';assert.equal(H.matches(d,qs,answers),false,'填空顺序不可交换');
});
test('题目通过缓存后字段重排和省略undefined不影响身份，单选多选填空均可填入并校验',()=>{
 const d=dom(question(1)+question(2,'checkbox')+question(3,'text')).window.document,original=H.questions(d),saved=storedValue(original);
 assert.notEqual(JSON.stringify(original),JSON.stringify(saved),'真实触发旧版JSON字符串比较差异');
 assert.equal(H.fingerprint(original),H.fingerprint(saved));
 const answers=storedValue([{number:1,values:['B']},{number:2,values:['A','B']},{number:3,values:['first','second']}]);
 H.apply(d,saved,answers);assert.equal(H.matches(d,saved,answers),true);
});
test('规范比较仍拒绝题干、题序、选项顺序或值、类型、填空数量的真实变化，且不写入旧答案',()=>{
 const base=H.questions(dom(question(1)+question(2,'checkbox')+question(3,'text')).window.document);
 const changes=[qs=>qs[0].text+='新的题干',qs=>qs.reverse(),qs=>qs[0].options.reverse(),qs=>qs[0].options[0]='Z',qs=>qs[0].type='checkbox',qs=>qs[2].fields++,qs=>qs.pop()];
 for(const change of changes){const saved=storedValue(base);change(saved);const d=dom(question(1)+question(2,'checkbox')+question(3,'text')).window.document;
  assert.throws(()=>H.apply(d,saved,[{number:1,values:['B']},{number:2,values:['A','B']},{number:3,values:['first','second']}]),/变化/);
  assert.equal(d.querySelectorAll('input:checked').length,0);assert.equal(d.querySelector('textarea').value,'');
 }
});
test('不支持的嵌入媒体、题数不一致、页面变化、非法选项或模型不完整结果都会拒绝提交',()=>{
 const d=dom(question(1)).window.document;const qs=H.questions(d);
 assert.throws(()=>M.validate(qs,{answers:[{number:1,values:['C']}]}),/选项/);
 assert.throws(()=>M.validate(qs,{answers:[]}),/全部/);
 assert.throws(()=>M.validate(qs,{answers:[{number:1,values:['B'],uncertain:true}]}),/没有把握/);
 assert.throws(()=>M.parse(qs,{choices:[{finish_reason:'length',message:{content:'{}'}}]}),/完整/);
 d.querySelector('.qcontent').textContent='更改后的题目';assert.throws(()=>H.apply(d,qs,[{number:1,values:['B']}]),/变化/);
 d.querySelector('.qcontent').innerHTML='<video></video>视频题';assert.throws(()=>H.questions(d),/嵌入媒体/);
 const missing=dom('<p>共3题</p>'+question(1)).window.document;assert.throws(()=>H.questions(missing),/总数/);
});
test('模型请求仅发题干选项到配置的接口，认证错误不包含密钥',async()=>{
 const questions=[{number:1,type:'radio',text:'题干',options:['A','B']}];let call;
 const result=await M.solve(questions,{baseUrl:'https://models.example/v1',apiKey:'test-key-custom',model:'custom-chat'},{fetcher:async(url,request)=>{call={url,request};return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'```json\n{"answers":[{"number":1,"values":["B"]}]}\n```'}}],usage:{total_tokens:10}})}}});
 assert.equal(result.answers[0].values[0],'B');assert.equal(call.url,'https://models.example/v1/chat/completions');assert.equal(call.request.redirect,'error');assert.equal(call.request.credentials,'omit');assert.doesNotMatch(call.request.body,/SECRET|userKey|cookie/);
 await assert.rejects(M.solve(questions,{baseUrl:'https://models.example/v1',apiKey:'test-key-custom',model:'custom-chat'},{fetcher:async()=>({ok:false,status:401})}),e=>/Key 无效/.test(e.message)&&!e.message.includes('SECRET'));
});

test('带配图的文字题正常填写，图片加载或地址变化不影响题目校验，文字变化仍拒绝',()=>{
 const d=dom(question(1)).window.document,content=d.querySelector('.qcontent');
 content.innerHTML='CMMI 阶段式模型成熟度等级中最高的是哪一级？ A. 已管理级 B. 优化级 <img src="/diagram.png?private=test" alt="图片替代文字">';
 const qs=H.questions(d),answers=[{number:1,values:['B']}];
 assert.match(qs[0].text,/CMMI/);assert.doesNotMatch(JSON.stringify(qs),/diagram|private|替代文字/);
 content.querySelector('img').src='/changed.png';H.apply(d,qs,answers);assert.equal(H.matches(d,qs,answers),true);
 content.querySelector('img').remove();assert.equal(H.matches(d,qs,answers),true);
 content.insertAdjacentText('afterbegin','改为最低等级：');assert.throws(()=>H.apply(d,qs,answers),/变化/);
});

test('只有图片没有文字时不会把空题发送给模型',()=>{
 const d=dom(question(1)).window.document;d.querySelector('.qcontent').innerHTML='<img src="/diagram.png" alt="整道题在图片中">';assert.throws(()=>H.questions(d),/题干为空/);
});

async function harness({counts=[0,3,3,3,4],total=4,questionCount=2,existingGrades=[],unmarkedDirectory=false,holdModel=false,extraCourse=false,secondTotal=0,videos=['40/40','0/0'],staleUntilHome=false,missingHomeLink=false,holdHomeNavigation=false,passed=[],reverseHome=false,directoryTitles=null,chapterTitle='在线作业',imageQuestion=0,uncertainRounds=[],holdReview=false,modelFailures=[],holdRounds=[],offlineQuotas=['0/4','0/0'],offlineItems=[],offlineMode='normal'}={}){
 const clock={now:100000},workerTimers=require('./background-timers.cjs')(clock),stats={opens:[],closes:[],submits:[],viewClicks:[],checks:[],homeClicks:[],route:[],visits:[],publications:0,modelCalls:0,chapterClicks:0},tabs=new Map(),receivers=new Map();
 const mainId=1,courseUrl=i=>origin+'/eduCourseBaseinfo/courseinfo.action?num=num1&courseId=c'+i+'&classId=k'+i,catUrl=i=>origin+'/eduCourseBaseinfo/courseCata.action?num=num2&courseId=c'+i+'&classId=k'+i;
 let local={homeworkSettings:{schema:2,baseUrl:'https://models.example/v1',apiKey:'test-key-custom',model:'custom-chat'},homeworkCache:{userKey:'欢迎您:测试',courses:[{url:courseUrl(0),title:'测试科目',homework:H.quota(counts[0]+'/'+total)},...(extraCourse?[{url:courseUrl(1),title:secondTotal?'下一科目':'无作业科目',homework:H.quota('0/'+secondTotal)}]:[])]},courseCache:{userKey:'欢迎您:测试',courses:[]}},session={},messageListener,removedListeners=[],alarmListeners=[],alarms=new Map(),worker,frame,course=0,verification=0,nextTab=10,paperDom,modelResolve;
 let mainDom=dom('<p>欢迎您:测试个人设置</p><a href="'+origin+'/webindex.action">首页</a><iframe id="contentFrame"></iframe>',origin+'/webindex.action');
 function wireMain(){
  const a=mainDom.window.document.querySelector('a');
  if(missingHomeLink)a.remove();else a.onclick=e=>{
   e.preventDefault();
   if(session.homeworkRun?.phase==='verifyHome'){
    assert.equal([...tabs.values()].filter(t=>/\/hw\//.test(t.url)).length,0,'返回首页必须等成绩页关闭');stats.homeClicks.push({at:clock.now,submits:stats.submits.length,action:'home-click'});stats.route.push('home');
    if(holdHomeNavigation)return;
    verification++;stats.checks.push(stats.submits.length);mainDom=dom('<p>欢迎您:测试个人设置</p><a href="'+origin+'/webindex.action">首页</a><iframe id="contentFrame"></iframe>',origin+'/webindex.action');wireMain();setFrame('home');loadController(mainDom,mainId);
   }else setFrame('home');
  };
  Object.defineProperty(mainDom.window.document.querySelector('iframe'),'contentDocument',{get:()=>frame.window.document});
 }
 tabs.set(1,{id:1,url:origin+'/webindex.action'});wireMain();
 function storage(obj){return {get:async keys=>{if(keys==null)return storedValue(obj);const result={};for(const k of Array.isArray(keys)?keys:[keys])result[k]=storedValue(obj[k]);return result;},set:async value=>{if(obj===local&&value.courseCache&&value.homeworkCache)stats.publications++;Object.assign(obj,storedValue(value));}};}
 const permissionState={allowed:true};const chrome={permissions:{contains:async()=>permissionState.allowed},storage:{local:storage(local),session:storage(session)},runtime:{getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>messageListener=fn}},tabs:{
  query:async opts=>[...tabs.values()].filter(t=>!opts?.url||t.url.startsWith(origin)),get:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);},remove:async id=>{tabs.delete(id);receivers.delete(id);stats.closes.push(id);for(const listener of removedListeners)listener(id);},
  reload:async()=>{throw Error('核对必须点击页面首页入口，不能用浏览器刷新代替');},
  sendMessage:async(id,m)=>{let result;for(const receive of receivers.get(id)||[])receive(m,{},r=>result=r);return result;},onRemoved:{addListener:fn=>removedListeners.push(fn)}
 },alarms:{get:async n=>alarms.get(n),create:async(n,options)=>alarms.set(n,options),clear:async n=>alarms.delete(n),onAlarm:{addListener:fn=>alarmListeners.push(fn)}}};
 const popup={url:'chrome-extension://test/popup.html'},sender=id=>({tab:{id},frameId:0,url:tabs.get(id)?.url});
 const call=(m,from=popup)=>new Promise(resolve=>messageListener(m,from,resolve));
 function boot(){
  removedListeners=[];alarmListeners=[];workerTimers.clearAll();worker=vm.createContext({chrome,URL,AbortController,Math,Date:class extends Date{static now(){return clock.now;}},setTimeout:workerTimers.setTimeout,clearTimeout:workerTimers.clearTimeout,fetch:async(url,request)=>{
   if(request.method==='GET'){stats.modelListUrl=url;return {ok:true,json:async()=>({data:[{id:'custom-chat'},{id:'second-chat'}]})};}
   stats.modelCalls++;const round=stats.modelCalls-1,qs=JSON.parse(JSON.parse(request.body).messages[1].content).questions;stats.lastQuestions=qs;(stats.requestedNumbers??=[]).push(qs.map(q=>q.number));
   const fail=modelFailures[round];
   if(fail==='timeout')return new Promise((resolve,reject)=>{const abort=()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}));request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();});
   if(fail==='network')throw new TypeError('network unavailable');
   if(typeof fail==='number')return {ok:false,status:fail};
   if(fail==='truncated')return {ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})};
   if(holdModel||holdReview&&round>0||holdRounds.includes(round))await new Promise(r=>modelResolve=r);
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:qs.map(q=>({number:q.number,values:['B'],uncertain:(uncertainRounds[round]||[]).includes(q.number)}))})}}],usage:{total_tokens:20}})};
  }});
  worker.importScripts=(...files)=>{for(const f of files){vm.runInContext(fs.readFileSync(dir+f,'utf8'),worker,{filename:f});}};
  vm.runInContext(fs.readFileSync(dir+'background.js','utf8'),worker);
 }
 function loadController(d,id){
  receivers.set(id,[]);d.window.chrome={runtime:{sendMessage:m=>call(m,sender(id)),onMessage:{addListener:fn=>receivers.get(id).push(fn)}}};
  d.window.Date=class extends Date{static now(){return clock.now;}};
  // All webpage intervals/timeouts are frozen. Only real background messages drive the flow.
  d.window.setInterval=()=>0;d.window.setTimeout=()=>0;
  for(const file of ['homework-logic.js','homework-model.js','homework-content.js'])d.window.eval(fs.readFileSync(dir+file,'utf8'));
 }
 function setFrame(kind){
  if(kind==='home'){
   const order=[0,...(extraCourse?[1]:[])];if(reverseHome)order.reverse();
   frame=dom(order.map(i=>`<li><span class="coursetit">${i?(secondTotal?'下一科目':'无作业科目'):'测试科目'}</span><a class="studybtn" href="${courseUrl(i)}">学习</a></li>`).join(''),origin+'/webContent.action');
   frame.window.document.querySelectorAll('a').forEach((a,index)=>a.onclick=e=>{e.preventDefault();const i=order[index];course=i;stats.visits.push(i);if(session.homeworkRun?.phase==='verifyInfo')stats.route.push('course:'+i);setFrame('info');});return;
  }
  const nav=`<a href="${courseUrl(course)}">课程信息</a><a href="${catUrl(course)}">课程目录</a>`;
  if(kind==='info')frame=dom(nav+`<span id="course_Code">13521</span><li><span>视频进度</span><span id="actualvideo">${videos[course]||''}</span></li><li><span>离线作业进度</span><span id="work">${offlineQuotas[course]||''}</span></li><li><span>网上作业进度</span><span id="testnum">${course?'0/'+secondTotal:counts[Math.min(verification,counts.length-1)]+'/'+total}</span></li>`,courseUrl(course));
  else frame=dom(nav+'<ul id="course"><li class="parent_li" id="chapter"><span class="parent_tit" title="Expand this branch">'+chapterTitle+'</span></li></ul>',catUrl(course));
  frame.window.document.querySelectorAll('a').forEach((a,i)=>a.onclick=e=>{e.preventDefault();if(!i){if(!staleUntilHome)verification++;stats.checks.push(stats.submits.length);setFrame('info');}else setFrame('catalog');});
  if(kind==='catalog')frame.window.document.querySelector('.parent_tit').onclick=()=>{
   stats.chapterClicks++;const header=frame.window.document.querySelector('.parent_tit');header.title='Collapse this branch';if(header.nextElementSibling)return;
   const ul=frame.window.document.createElement('ul');ul.innerHTML=Array.from({length:directoryTitles?.length||8},(_,i)=>`<li><a href="javascript:void(0)" onclick="viewPaper('paper${i}','r${i}',this)">${directoryTitles?.[i]||'第'+[10,2,1,4,5,6,7,8][i]+'章 网上作业'}</a><span class="tree-conr">${passed.includes(i)?'及格':!unmarkedDirectory&&i<counts[0]?'已学':'未学'}</span></li>`).join('');header.after(ul);
   ul.querySelectorAll('a').forEach((a,i)=>a.onclick=e=>{e.preventDefault();openPaper(i);});
  };
  if(kind==='catalog'&&offlineItems[course]){
   const d=frame.window.document,li=d.createElement('li');li.id='offline-chapter';li.innerHTML='<span class="parent_tit" id="offlineHeader" title="Expand this branch">软件工程课程复习与在线练习及离线作业</span>';d.querySelector('#course').append(li);
   let chapterToken;d.addEventListener('__ynouChapterAction134',e=>{chapterToken=JSON.parse(e.detail).token;});
   const insert=(target,items)=>{const ul=d.createElement('ul');ul.innerHTML=items.map((row,i)=>`<li><a title="${row.title||'第'+i+'章 离线作业'}" onclick="viewAssignment('标题','${row.id||'off'+i}',this)">${row.title||'第'+i+'章 离线作业'}</a><span class="tree-conr"><span>${row.status}</span></span></li>`).join('');target.append(ul);for(const a of ul.querySelectorAll('a'))a.onclick=()=>{throw Error('离线状态扫描不能打开、填写或提交作业');};};
   li.querySelector('span').onclick=()=>{
    stats.offlineChapterClicks=(stats.offlineChapterClicks||0)+1;if(offlineMode==='hang')return;
    if(offlineMode==='empty'||!offlineItems[course].length){d.dispatchEvent(new frame.window.CustomEvent('__ynouEmptyChapter134',{detail:JSON.stringify({token:chapterToken})}));return;}
    li.querySelector('span').title='Collapse this branch';if(li.querySelector('ul'))return;
    if(offlineMode==='nested'){li.insertAdjacentHTML('beforeend','<ul><li><span id="nestedOff" class="parent_tit" title="Expand this branch">离线作业</span></li></ul>');const nested=li.querySelector('#nestedOff');nested.onclick=()=>{nested.title='Collapse this branch';insert(nested.parentElement,offlineItems[course]);};}
    else if(offlineMode==='accordion')insert(li,offlineItems[course].slice(0,1));
    else if(offlineMode==='delayed')workerTimers.setTimeout(()=>insert(li,offlineItems[course]),12000);
    else insert(li,offlineItems[course]);
   };
   if(offlineMode==='accordion'){
    const next=d.createElement('li');next.innerHTML='<span class="parent_tit" id="offlineSecond" title="Expand this branch">第二组离线作业</span>';d.querySelector('#course').append(next);next.querySelector('span').onclick=()=>{li.querySelector('ul')?.remove();li.querySelector('span').title='Expand this branch';next.querySelector('span').title='Collapse this branch';insert(next,offlineItems[course].slice(1));};
   }
  }
 }
 function startUrl(i){return origin+'/hw/student/studentStartHomework.action?eduCourseClassPaper.conOtherId=paper'+i+'&eduCourseClassPaper.courseActivityId=r'+i+'&eduCourseClassPaper.classId=k0';}
 function viewUrl(i){return origin+'/hw/student/studentViewHomework.action?paper_id=paper'+i+'&studentClass=k0';}
 function grade(id,i,count=questionCount){tabs.get(id).url=viewUrl(i);paperDom=dom(Array.from({length:count},(_,j)=>`<p>答题历史：B</p><input disabled id="q${j+1}_cj" value="${Math.floor(100/count)+(j<100%count?1:0)}">`).join(''),viewUrl(i));loadController(paperDom,id);}
 function openPaper(i){
  const id=nextTab++;assert.equal([...tabs.values()].filter(t=>/\/hw\//.test(t.url)).length,0,'不能同时开多个作业');tabs.set(id,{id,url:startUrl(i),openerTabId:1});stats.opens.push(i);
  if(existingGrades.includes(i)){grade(id,i,10);return;}
  paperDom=dom('<h1>网上作业</h1><p>共'+questionCount+'题</p>'+Array.from({length:questionCount},(_,i)=>question(i+1)).join('')+'<input type="button" id="bt" value="完成作业">',startUrl(i));const doc=paperDom.window.document;
  if(imageQuestion){const content=doc.querySelectorAll('.qcontent')[imageQuestion-1];content.insertAdjacentHTML('beforeend','<img src="/test-diagram.png?private=test" alt="图片替代文字">');}
  doc.querySelector('#bt').onclick=()=>{
   assert.deepEqual(Array.from(doc.querySelectorAll('input:checked')).map(e=>e.value),Array(questionCount).fill('B'));
   const box=doc.createElement('table');box.className='aui_dialog';box.innerHTML='<tr><td class="aui_content">检查下是否有未做完的试题，点击【确定】按钮提交！</td><td><button>确定</button><button>取消</button></td></tr>';doc.body.append(box);
   box.querySelector('button').onclick=()=>{stats.submits.push(i);box.innerHTML='<tr><td class="aui_content">作业做完了！<a href="'+viewUrl(i)+'">查看答题成绩和解析</a></td></tr>';box.querySelector('a').onclick=e=>{e.preventDefault();stats.viewClicks.push(i);grade(id,i);};};
  };
  loadController(paperDom,id);
 }
 setFrame('home');boot();loadController(mainDom,1);await settle();
 async function advance(){await workerTimers.advance(2000);await settle();}
 async function until(predicate,limit=300){for(let i=0;i<limit;i++){if(predicate(session.homeworkRun||{}))return;await advance();}throw Error('未到达目标: '+JSON.stringify({phase:session.homeworkRun?.phase,status:session.homeworkRun?.status,stats}));}
 return {call,stats,session,local,tabs,popup,permissionState,worker:()=>worker,advance,until,sender,mainDom,paper:()=>paperDom,resolveModel:()=>modelResolve?.(),restart:async()=>{boot();await settle();},reloadMain:()=>{mainDom=dom('<p>欢迎您:测试个人设置</p><a href="'+origin+'/webindex.action">首页</a><iframe id="contentFrame"></iframe>',origin+'/webindex.action');wireMain();setFrame('home');loadController(mainDom,mainId);},alarm:async()=>{workerTimers.clearAll();for(const f of alarmListeners)f({name:'ynou-homework-wake'});await settle();},async start(type='HW_START'){const s=await call({type,tabId:1});assert.ok(!s.error,s.error);},state:()=>session.homeworkRun};
}

// Fixture for the paused state created by 1.4.8. New runs do not pause for uncertainty.
test('未配置或旧版私有配置不能启动网上作业，但无模型的统一扫描仍可完成',async()=>{
 const h=await harness();delete h.local.homeworkSettings;h.worker().HomeworkPrivateConfig={apiKey:'OLD-DO-NOT-USE',model:'old'};
 const state=await h.call({type:'HW_GET'});assert.equal(state.settings.ready,false);assert.equal(state.settings.hasKey,false);assert.equal(state.settings.model,'');
 assert.match((await h.call({type:'HW_START',tabId:1})).error,/先在模型设置/);assert.equal(h.stats.opens.length,0);assert.equal(h.stats.modelCalls,0);
 h.local.homeworkSettings={apiKey:'OLD-STORED-KEY',model:'old'};assert.match((await h.call({type:'HW_START',tabId:1})).error,/先在模型设置/);
 await h.start('SCAN_ALL');await h.until(s=>!s.running&&s.phase==='done');assert.equal(h.stats.modelCalls,0);assert.equal(h.stats.opens.length,0);
});
test('获取列表不保存Key，任意模型可保存；更换API不复用旧Key，清除后不能启动',async()=>{
 const h=await harness();delete h.local.homeworkSettings;const draft={baseUrl:'https://custom.example/api/v1/',apiKey:'non-sk-custom-secret'};
 const listed=await h.call({type:'HW_MODELS',...draft});assert.deepEqual(Array.from(listed.models),['custom-chat','second-chat']);assert.equal(h.stats.modelListUrl,'https://custom.example/api/v1/models');assert.equal(h.local.homeworkSettings,undefined);
 assert.equal((await h.call({type:'HW_SETTINGS',...draft,model:'my-own-model:2026'})).ok,true);
 const state=await h.call({type:'HW_GET'});assert.equal(state.settings.ready,true);assert.equal(state.settings.model,'my-own-model:2026');assert.ok(!JSON.stringify(state).includes(draft.apiKey));
 assert.equal((await h.call({type:'HW_SETTINGS',baseUrl:draft.baseUrl,apiKey:'',model:'second-model'})).ok,true);assert.equal(h.local.homeworkSettings.apiKey,draft.apiKey);
 assert.match((await h.call({type:'HW_SETTINGS',baseUrl:'https://other.example/v1',apiKey:'',model:'second-model'})).error,/API Key/);assert.equal(h.local.homeworkSettings.baseUrl,'https://custom.example/api/v1');
 assert.equal((await h.call({type:'HW_CLEAR_SETTINGS'})).ok,true);assert.equal(h.local.homeworkSettings.apiKey,undefined);assert.match((await h.call({type:'HW_START',tabId:1})).error,/模型设置/);
});
test('接口权限被撤销时禁止解题和列表请求，网页不能读取Key或修改配置',async()=>{
 const h=await harness();h.permissionState.allowed=false;
 assert.equal((await h.call({type:'HW_GET'})).settings.ready,false);assert.match((await h.call({type:'HW_START',tabId:1})).error,/授权/);
 assert.match((await h.call({type:'HW_MODELS',baseUrl:'https://models.example/v1',apiKey:''})).error,/授权/);assert.equal(h.stats.modelListUrl,undefined);
 const old=JSON.stringify(h.local.homeworkSettings);await h.call({type:'HW_CLEAR_SETTINGS'},h.sender(1));await h.call({type:'HW_SETTINGS',baseUrl:'https://evil.example',apiKey:'bad',model:'evil'},h.sender(1));assert.equal(JSON.stringify(h.local.homeworkSettings),old);assert.equal((await h.call({type:'HW_GET'},h.sender(1))).settings,undefined);
});
test('独立助手窗口读取缓存、统一扫描与停止均通过真实后台路由，子框架无控制权限',async()=>{
 const h=await harness(),controller={...h.popup,tab:{id:90,windowId:8},frameId:0};
 const state=await h.call({type:'HW_GET'},controller);assert.equal(state.cache.courses.length,1);assert.equal(state.settings.hasKey,true);
 await h.call({type:'SCAN_ALL',tabId:1},{...controller,frameId:2});assert.equal(!!h.state()?.running,false);
 const started=await h.call({type:'SCAN_ALL',tabId:1},controller);assert.equal(started.running,true);assert.equal(h.state().tabId,1);
 await h.call({type:'HW_STOP'},controller);assert.equal(h.state().running,false);assert.equal(h.stats.submits.length,0);
});
async function legacyPause(h){
 await h.until(s=>s.phase==='ready'&&s.acceptUncertain);await h.call({type:'HW_STOP'});
 const s=h.state();s.phase='review';s.acceptUncertain=false;s.status='旧版复核后等待继续';
 const {questions,answers,...diagnosis}=s;h.local.homeworkDiagnosis=storedValue(diagnosis);
}

test('冻结页面定时器：0/4整批完成4份并查看成绩，实际3/4再补1份，4/4停止',async()=>{
 const h=await harness();await h.start();await h.until(s=>!s.running&&s.phase==='done');
 assert.deepEqual(h.stats.opens,[0,1,2,3,4]);assert.deepEqual(h.stats.submits,[0,1,2,3,4]);assert.deepEqual(h.stats.viewClicks,[0,1,2,3,4]);
 assert.deepEqual(h.stats.checks,[4,4,4,5],'批末先返回首页重新进入科目，三次仍3/4才补1份');assert.equal(h.stats.closes.length,5);assert.equal(h.stats.modelCalls,5);assert.equal(h.local.homeworkCache.courses[0].homework.label,'4/4');
 assert.equal(h.state().finished,5);assert.doesNotMatch(JSON.stringify(h.local.homeworkDiagnosis),/sk-test|SECRET|题目 1|"answers"|"questions"/);
});

test('第15题有配图的16题作业可完整解答、填写、提交和查看成绩，按实际进度结束',async()=>{
 const h=await harness({counts:[0,1],total:1,questionCount:16,imageQuestion:15,staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.submits,[0]);assert.deepEqual(h.stats.viewClicks,[0]);assert.equal(h.stats.closes.length,1);assert.equal(h.stats.modelCalls,2);assert.equal(h.stats.lastQuestions.length,4);assert.match(h.stats.lastQuestions[2].text,/题目 15/);assert.doesNotMatch(JSON.stringify(h.stats.lastQuestions),/diagram|private|替代文字/);assert.equal(h.local.homeworkCache.courses[0].homework.label,'1/1');
});

test('42题中第21题不确定时只自动复核这一题，保留原题号，合并后提交一次',async()=>{
 const h=await harness({counts:[0,1],total:1,questionCount:42,uncertainRounds:[[],[21],[],[],[]],staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.requestedNumbers,[[1,2,3,4,5,6,7,8,9,10,11,12],[13,14,15,16,17,18,19,20,21,22,23,24],[25,26,27,28,29,30,31,32,33,34,35,36],[37,38,39,40,41,42],[21]]);assert.deepEqual(h.stats.opens,[0]);assert.deepEqual(h.stats.submits,[0]);assert.deepEqual(h.stats.viewClicks,[0]);assert.equal(h.state().tokens,100);
});

test('普通题最多12题一组；长题按文字量缩小分组，原始题号不变',()=>{
 const normal=Array.from({length:42},(_,i)=>({number:i+1,text:'题目'}));
 assert.deepEqual(M.batches(normal).map(g=>g.length),[12,12,12,6]);
 const long=[21,24,31,39,40].map(number=>({number,text:'长题'.repeat(4000)}));
 assert.deepEqual(M.batches(long).map(g=>g.map(q=>q.number)),[[21,24],[31,39],[40]]);
 assert.deepEqual(M.batches([]),[]);
});

test('42题第二组超时只重试该组，最后一组未返回前零填入零提交，全部校验后只提交一次',async()=>{
 const h=await harness({counts:[0,1],total:1,questionCount:42,modelFailures:[null,'timeout'],holdRounds:[4],staleUntilHome:true});await h.start();
 await h.until(()=>h.stats.modelCalls===5);
 assert.deepEqual(h.stats.requestedNumbers,[[1,2,3,4,5,6,7,8,9,10,11,12],[13,14,15,16,17,18,19,20,21,22,23,24],[13,14,15,16,17,18,19,20,21,22,23,24],[25,26,27,28,29,30,31,32,33,34,35,36],[37,38,39,40,41,42]]);
 assert.deepEqual(h.state().modelProgress,{kind:'answer',group:4,groups:4,done:36,total:42,attempt:1});
 assert.deepEqual(h.stats.submits,[]);assert.equal(h.paper().window.document.querySelectorAll('input:checked').length,0);assert.equal(h.state().pending.submissionStarted,false);
 assert.match(h.state().logs.map(l=>l.text).join('\n'),/90 秒/);
 h.resolveModel();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.submits,[0]);assert.deepEqual(h.stats.viewClicks,[0]);assert.equal(h.state().tokens,80);assert.equal(h.local.homeworkCache.courses[0].homework.label,'1/1');
});

test('同组连续超时后跳过未提交作业，已解答部分不提交、不计完成，自动继续下一份',async()=>{
 const h=await harness({counts:[0,1],total:1,questionCount:13,modelFailures:[null,'timeout','timeout'],staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.opens,[0,1]);assert.deepEqual(h.stats.submits,[1]);assert.deepEqual(h.stats.viewClicks,[1]);assert.equal(h.stats.closes.length,2);assert.equal(h.state().finished,1);assert.equal(h.stats.modelCalls,5);
 assert.equal(h.state().failedPapers.length,1);assert.match(h.state().failedPapers[0].reason,/90 秒/);assert.equal(h.state().results.length,1);assert.deepEqual(h.stats.checks,[1]);assert.equal(h.local.homeworkCache.courses[0].homework.label,'1/1');
});

test('网络、503和不完整输出各只重试失败组一次，成功后继续；401和429保留页面停止',async()=>{
 for(const failure of ['network',503,'truncated']){
  const h=await harness({counts:[0,1],total:1,modelFailures:[failure],staleUntilHome:true});await h.start();await h.until(s=>!s.running);
  assert.equal(h.state().phase,'done',String(failure));assert.equal(h.stats.modelCalls,2);assert.deepEqual(h.stats.submits,[0]);
 }
 for(const status of [401,429]){
  const h=await harness({counts:[0],total:1,modelFailures:[status]});await h.start();await h.until(s=>!s.running);
  assert.equal(h.state().phase,'stopped');assert.equal(h.stats.modelCalls,1);assert.deepEqual(h.stats.submits,[]);assert.equal(h.stats.closes.length,0);assert.ok(h.tabs.has(h.state().paperTabId));
 }
});

test('自动重试倒计时中点击停止，不再发出请求或跳过当前作业',async()=>{
 const h=await harness({counts:[0],total:1,modelFailures:[503]});await h.start();await h.until(s=>s.status?.includes('8 秒后'));
 await h.call({type:'HW_STOP'});for(let i=0;i<60;i++)await h.advance();
 assert.equal(h.stats.modelCalls,1);assert.equal(h.state().running,false);assert.deepEqual(h.stats.submits,[]);assert.equal(h.stats.closes.length,0);assert.ok(h.tabs.has(h.state().paperTabId));
});

test('所有作业都因模型暂时故障失败时保留实际0/1，跳过科目后结束，不伪造已完成',async()=>{
 const h=await harness({counts:[0],total:1,directoryTitles:['网上作业一','网上作业二'],modelFailures:[503,503,503,503],extraCourse:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.opens,[0,1]);assert.deepEqual(h.stats.submits,[]);assert.equal(h.state().finished,0);assert.equal(h.state().failedPapers.length,2);assert.equal(h.state().skippedCourses.length,1);assert.match(h.state().skippedCourses[0].reason,/2 份模型失败未提交/);assert.equal(h.local.homeworkCache.courses[0].homework.label,'0/1');assert.equal(h.stats.modelCalls,4);
});

test('复核后仍不确定时按最佳有效答案自动继续，记录疑问题号，不等待手动点击',async()=>{
 const h=await harness({counts:[0,1],total:1,questionCount:4,uncertainRounds:[[2,4],[4]],staleUntilHome:true});await h.start();await h.until(s=>s.phase==='ready');
 assert.equal(h.state().running,true);assert.equal(h.state().acceptUncertain,true);assert.deepEqual(h.state().uncertainQuestions,[4]);assert.equal(h.stats.modelCalls,2);assert.deepEqual(h.stats.submits,[]);assert.match(h.state().status,/最佳答案/);
 assert.equal((await h.call({type:'HW_GET'})).canResume,false);await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.requestedNumbers,[[1,2,3,4],[2,4]]);assert.deepEqual(h.stats.opens,[0]);assert.deepEqual(h.stats.submits,[0]);assert.deepEqual(h.state().results[0].uncertainQuestions,[4]);
});

test('单独复核期间手动停止，迟到模型结果不能继续填写或提交',async()=>{
 const h=await harness({counts:[0],total:1,uncertainRounds:[[2],[]],holdReview:true});await h.start();await h.until(()=>h.stats.modelCalls===2);
 await h.call({type:'HW_STOP'});h.resolveModel();await settle();for(let i=0;i<6;i++)await h.advance();
 assert.equal(h.state().running,false);assert.deepEqual(h.stats.submits,[]);assert.equal(h.paper().window.document.querySelectorAll('input:checked').length,0);
});

test('继续前题干变更、原作业关闭、已提交或账号变化时拒绝重新调用模型',async()=>{
 for(const kind of ['question','closed','submitted','account']){
  const h=await harness({counts:[0],total:1,uncertainRounds:[[2],[2]]});await h.start();await legacyPause(h);
  if(kind==='question')h.paper().window.document.querySelector('.qcontent').textContent='题干已改变';
  if(kind==='closed')h.tabs.delete(h.state().paperTabId);
  if(kind==='submitted')h.paper().window.document.querySelector('#bt').disabled=true;
  if(kind==='account')h.mainDom.window.document.querySelector('p').textContent='欢迎您:其他用户个人设置';
  const r=await h.call({type:'HW_RESUME'});assert.ok(r.error,kind);assert.equal(h.state().running,false);assert.equal(h.stats.modelCalls,2);assert.deepEqual(h.stats.submits,[]);
 }
});

test('后台重启后可从复核暂停恢复；重复继续和其他标签不能重复请求',async()=>{
 const h=await harness({counts:[0,1],total:1,uncertainRounds:[[2],[2],[]],holdReview:true});await h.start();await h.until(()=>h.stats.modelCalls===2);h.resolveModel();await legacyPause(h);
 await h.restart();const outsider=await h.call({type:'HW_RESUME'}, {tab:{id:999},frameId:0,url:origin+'/webindex.action'});assert.equal(outsider.running,false);assert.equal(h.stats.modelCalls,2);
 const r=await h.call({type:'HW_RESUME'});assert.equal(r.error,undefined);await settle();const twice=await h.call({type:'HW_RESUME'});assert.ok(twice.error);assert.equal(h.stats.modelCalls,3);h.resolveModel();await h.until(s=>!s.running);assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.submits,[0]);
});

test('扩展更新后从本机暂停记录恢复当前作业，首页刷新后仍能继续下一份',async()=>{
 const h=await harness({counts:[0,2],total:2,uncertainRounds:[[2],[2],[],[]],staleUntilHome:true});await h.start();await legacyPause(h);
 assert.equal(h.local.homeworkDiagnosis.answers,undefined);assert.equal(h.local.homeworkDiagnosis.questions,undefined);
 delete h.session.homeworkRun;h.reloadMain();await h.restart();const paused=await h.call({type:'HW_GET'});assert.equal(paused.canResume,true);
 const r=await h.call({type:'HW_RESUME'});assert.equal(r.error,undefined);await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done',JSON.stringify({status:h.state().status,logs:h.state().logs,stats:h.stats}));assert.deepEqual(h.stats.requestedNumbers,[[1,2],[2],[1,2],[1,2]]);assert.deepEqual(h.stats.opens,[0,1]);assert.deepEqual(h.stats.submits,[0,1]);assert.equal(h.local.homeworkCache.courses[0].homework.label,'2/2');
});

test('兼容1.4.7因不确定而停止的记录，重读当前作业后可继续',async()=>{
 const h=await harness({counts:[0,1],total:1,uncertainRounds:[[2],[2],[]],staleUntilHome:true});await h.start();await legacyPause(h);
 h.local.homeworkDiagnosis.phase='stopped';h.local.homeworkDiagnosis.status='模型对第 2 题没有把握，已保留作业等待检查。';delete h.local.homeworkDiagnosis.uncertainQuestions;delete h.local.homeworkDiagnosis.canResume;delete h.session.homeworkRun;await h.restart();
 assert.equal((await h.call({type:'HW_GET'})).canResume,true);const r=await h.call({type:'HW_RESUME'});assert.equal(r.error,undefined);await h.until(s=>!s.running);assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.opens,[0]);assert.deepEqual(h.stats.submits,[0]);
});
test('诊断场景复现：1/4先遇到10题旧成绩，再完成三份15题作业；旧成绩不消耗新作业批次',async()=>{
 const h=await harness({counts:[1,4],questionCount:15,existingGrades:[0],unmarkedDirectory:true});await h.start();await h.until(s=>s.finished===0&&s.results?.length===1);
 assert.equal(h.state().batch.completed,0);assert.equal(h.state().results[0].existingResult,true);assert.equal(h.stats.modelCalls,0);assert.equal(h.stats.submits.length,0);
 await h.until(s=>!s.running&&s.phase==='done');
 assert.deepEqual(h.stats.opens,[0,1,2,3]);assert.deepEqual(h.stats.submits,[1,2,3]);assert.deepEqual(h.stats.checks,[3]);assert.equal(h.stats.modelCalls,6);assert.equal(h.state().finished,3);
 assert.deepEqual(h.state().results.map(r=>[r.count,r.existingResult]),[[10,true],[15,false],[15,false],[15,false]]);
});
test('批末旧信息页保持1/4：点击首页再进入科目后4/4，不能误开第5章',async()=>{
 const h=await harness({counts:[1,4],staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.submits,[1,2,3]);assert.deepEqual(h.stats.opens,[1,2,3]);assert.equal(h.stats.homeClicks.length,1);
 assert.equal(h.local.homeworkCache.courses[0].homework.label,'4/4');
});
test('从首页重进后暂未同步：等待复查后4/4，等待期间不增加作业',async()=>{
 const h=await harness({counts:[1,1,4],staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.submits,[1,2,3]);assert.equal(h.stats.homeClicks.length,2);assert.ok(h.stats.homeClicks[1].at-h.stats.homeClicks[0].at>=20000);
});
test('三次仍不足时逐份补做，目录耗尽后跳过，不重复作业或伪造满额',async()=>{
 const h=await harness({counts:[1],staleUntilHome:true});await h.start();await h.until(s=>!s.running,600);
 assert.equal(h.state().phase,'done');assert.match(h.state().status,/已跳过/);assert.deepEqual(h.stats.submits,[1,2,3,4,5,6,7]);assert.equal(h.state().finished,7);assert.equal(h.state().skippedCourses.length,1);assert.equal(h.local.homeworkCache.courses[0].homework.label,'1/4');
 assert.deepEqual(h.stats.checks,[3,3,3,4,4,4,5,5,5,6,6,6,7,7,7]);
});
test('真实诊断0/1：23秋网上作业已及格，跳过离线作业，直接完成网上作业2',async()=>{
 const h=await harness({counts:[0,1],total:1,passed:[0],directoryTitles:['23秋网上作业','23秋离线作业 新','网上作业2'],staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.opens,[2]);assert.deepEqual(h.stats.submits,[2]);assert.equal(h.stats.modelCalls,1);assert.deepEqual(h.stats.checks,[1]);assert.equal(h.local.homeworkCache.courses[0].homework.label,'1/1');
});
test('作业目录全已完成但进度不足，跳过本科学习下一科；及格和不及格准确区分',async()=>{
 const d=dom('<ul><li><a onclick="viewPaper(\'p1\',\'r1\',this)">已通过</a><span class="tree-conr">及格</span></li><li><a onclick="viewPaper(\'p2\',\'r2\',this)">未通过</a><span class="tree-conr">不及格</span></li></ul>').window.document;assert.deepEqual(H.rows(d).map(r=>r.complete),[true,false]);
 const h=await harness({counts:[0],total:1,passed:[0,1,2,3,4,5,6,7],extraCourse:true,secondTotal:1,staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.match(h.state().status,/已跳过/);assert.equal(h.stats.homeClicks.length,0);assert.equal(h.stats.opens.length,0);assert.equal(h.stats.modelCalls,0);assert.equal(h.state().skippedCourses[0].progress,'0/1');assert.equal(h.state().courseIndex,2);assert.deepEqual(h.stats.visits,[0,1]);assert.equal(h.state().skippedCourses.length,2);assert.equal(h.local.homeworkCache.courses[1].homework.label,'0/1');
});
test('新完成的一份仍未计入时再做下一份，新增计入后满额结束',async()=>{
 const h=await harness({counts:[0,0,0,0,1],total:1,staleUntilHome:true});await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.opens,[0,1]);assert.deepEqual(h.stats.checks,[1,1,1,2]);assert.equal(h.state().skippedCourses?.length||0,0);
});
test('共用viewPaper入口的离线作业按标题和所属章节排除，在线入口顺序不变',()=>{
 const d=dom('<ul><li><span class="parent_tit">23秋离线作业</span><ul><li><a onclick="viewPaper(\'p1\',\'r1\',this)">练习一</a></li></ul></li><li><span class="parent_tit">网上作业</span><ul><li><a onclick="viewPaper(\'p2\',\'r2\',this)">网上作业2</a></li><li><a onclick="viewPaper(\'p3\',\'r3\',this)">离线作业 新</a></li><li><a onclick="viewPaper(\'p4\',\'r4\',this)">网上作业3</a></li></ul></li></ul>').window.document;
 assert.deepEqual(H.rows(d).map(r=>r.id),['r2','r4']);
});

test('软件工程混合章节先展开，保留在线练习并排除离线作业，完成三份后核对3/3',async()=>{
 const h=await harness({counts:[0,3],total:3,chapterTitle:'软件工程课程复习与在线练习及离线作业',directoryTitles:['第1章 在线练习','离线作业 新','第2章 在线练习','第3章 网上作业'],staleUntilHome:true});
 await h.start();await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done');assert.equal(h.stats.chapterClicks,1);assert.deepEqual(h.stats.opens,[0,2,3]);assert.deepEqual(h.stats.submits,[0,2,3]);assert.deepEqual(h.stats.checks,[3]);assert.equal(h.local.homeworkCache.courses[0].homework.label,'3/3');assert.equal(h.state().skippedCourses?.length||0,0);
});

test('混合章节内的在线入口可读，内层纯离线章节、离线叶节点和文档仍排除',()=>{
 const d=dom('<ul><li><span class="parent_tit">软件工程课程复习与在线练习及离线作业</span><ul><li><a onclick="viewPaper(\'p1\',\'r1\',this)">练习一</a></li><li><span class="parent_tit">离线作业</span><ul><li><a onclick="viewPaper(\'p2\',\'r2\',this)">练习二</a></li></ul></li><li><a onclick="viewPaper(\'p3\',\'r3\',this)">23秋离线作业 新</a></li><li><a onclick="viewRes(\'file\',\'pdf\')">复习材料</a></li><li><a onclick="viewPaper(\'p4\',\'r4\',this)">网上练习</a></li></ul></li></ul>').window.document;
 assert.deepEqual(H.rows(d).map(r=>r.id),['r1','r4']);
});

test('只有纯离线作业章节时不展开、不调用模型，仍按目录耗尽规则跳过',async()=>{
 const h=await harness({counts:[0],total:1,chapterTitle:'23秋离线作业'});await h.start();await h.until(s=>!s.running);
 assert.equal(h.stats.chapterClicks,0);assert.equal(h.stats.modelCalls,0);assert.equal(h.stats.opens.length,0);assert.equal(h.state().skippedCourses[0].progress,'0/1');
});

test('使用缓存从首个未达标科目开始，首科4/4即使旧full标记不一致也不进入',async()=>{
 const h=await harness({counts:[4],total:4,extraCourse:true,secondTotal:1});h.local.homeworkCache.courses[0].homework.full=false;
 await h.start();assert.equal(h.state().courseIndex,1);await h.until(s=>s.phase==='info');
 assert.deepEqual(h.stats.visits,[1]);assert.equal(h.stats.modelCalls,0);assert.doesNotMatch(JSON.stringify(h.state().logs),/读取网上作业进度：测试科目/);
});

test('缓存全部达标或没有作业要求时直接结束，手动统一扫描仍重新读取全部科目',async()=>{
 const h=await harness({counts:[4],total:4,extraCourse:true});await h.start();
 assert.equal(h.state().running,false);assert.equal(h.state().phase,'done');assert.match(h.state().status,/缓存.*均已达标/);assert.deepEqual(h.stats.visits,[]);assert.equal(h.stats.opens.length,0);assert.equal(h.stats.modelCalls,0);
 await h.start('SCAN_ALL');await h.until(s=>!s.running);assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.visits,[0,1]);assert.equal(h.local.homeworkCache.courses[0].homework.label,'4/4');assert.equal(h.local.homeworkCache.courses[1].homework.label,'0/0');
});
test('首页入口缺失或点击未跳转时保留现场停止，不反复点击、不采纳旧进度',async()=>{
 for(const option of [{missingHomeLink:true},{holdHomeNavigation:true}]){
  const h=await harness({counts:[1,4],staleUntilHome:true,...option});await h.start();await h.until(s=>!s.running);
  assert.equal(h.state().phase,'stopped');assert.equal(h.stats.homeClicks.length,option.missingHomeLink?0:1);assert.deepEqual(h.stats.submits,[1,2,3]);assert.equal(h.local.homeworkCache.courses[0].homework.label,'1/4');
 }
});
test('核对只采纳重进后的页面和当前核对编号；后台重启不会重复点击首页',async()=>{
 const h=await harness({counts:[1,4],staleUntilHome:true});await h.start();await h.until(s=>s.phase==='verifyInfo');const s=structuredClone(h.state()),oldQuota=h.local.homeworkCache.courses[0].homework.label;
 const payload={type:'HW_QUOTA',session:s.session,url:s.courses[0].url,quota:H.quota('4/4'),documentId:s.verification.sourceDocumentId,verifyToken:s.verification.token};
 await h.call(payload,h.sender(1));assert.equal(h.state().phase,'verifyInfo');assert.equal(h.local.homeworkCache.courses[0].homework.label,oldQuota);
 await h.call({...payload,documentId:s.verification.documentId,verifyToken:'previous-attempt'},h.sender(1));assert.equal(h.state().phase,'verifyInfo');
 await h.restart();await h.alarm();await h.until(s=>!s.running);assert.equal(h.state().phase,'done');assert.equal(h.stats.homeClicks.length,1);assert.equal(h.stats.submits.length,3);
});
test('等待同步时手动停止，后续后台唤醒不再点击首页或打开作业',async()=>{
 const h=await harness({counts:[1,1,4],staleUntilHome:true});await h.start();await h.until(s=>s.phase==='verify'&&s.verifyAgain===1);await h.call({type:'HW_STOP'});
 for(let i=0;i<30;i++)await h.advance();assert.equal(h.stats.homeClicks.length,1);assert.deepEqual(h.stats.submits,[1,2,3]);assert.equal(h.state().running,false);
});
test('主页课程顺序变动仍点击原科目：每次核对都先首页后科目，重复领取不重复点击',async()=>{
 const h=await harness({counts:[1,1,4],staleUntilHome:true,extraCourse:true,reverseHome:true});await h.start();await h.until(s=>s.phase==='verifyReturnHome');await h.restart();await h.alarm();await h.until(s=>s.phase==='verifyHome');
 const s=h.state(),duplicate=await h.call({type:'HW_CLAIM_HOME',session:s.session,token:s.verification.token},h.sender(1));assert.equal(duplicate.running,false);assert.equal(h.state().running,true);
 await h.until(s=>!s.running);assert.equal(h.state().phase,'done');assert.deepEqual(h.stats.route,['home','course:0','home','course:0']);assert.deepEqual(h.stats.visits,[0,0,0]);assert.deepEqual(h.stats.opens,[1,2,3]);
 assert.ok(h.state().verification.courseEnteredAt>=h.state().verification.loadedAt);assert.ok(h.state().verification.loadedAt>=h.state().verification.homeClickedAt);
});
test('模型返回前题干真的变化时，即使缓存字段已规范仍停止，零答案写入且不提交',async()=>{
 const h=await harness({holdModel:true});await h.start();await h.until(s=>s.phase==='thinking');h.paper().window.document.querySelector('.qcontent').textContent='真正更换后的题目';h.resolveModel();await h.until(s=>!s.running);
 assert.match(h.state().status,/题目内容已经变化/);assert.equal(h.stats.submits.length,0);assert.equal(h.paper().window.document.querySelectorAll('input:checked').length,0);
});
test('手动扫描独立缓存，扫描不调用模型，0/0科目可正常跳过',async()=>{
 const h=await harness({extraCourse:true});delete h.local.homeworkCache;await h.start('HW_SCAN');await h.until(s=>!s.running&&s.phase==='done');
 assert.deepEqual(h.local.homeworkCache.courses.map(c=>c.homework.label),['0/4','0/0']);assert.equal(h.stats.modelCalls,0);assert.equal(h.stats.opens.length,0);
});
test('统一扫描只逐科访问一次，同次发布两类进度且保持页面顺序，不开视频或调用模型',async()=>{
 const h=await harness({extraCourse:true});await h.start('SCAN_ALL');await h.until(s=>!s.running&&s.phase==='done');
 assert.deepEqual(h.stats.visits,[0,1]);assert.equal(h.stats.publications,1);
 const v=h.local.courseCache,a=h.local.homeworkCache;
 assert.deepEqual(v.courses.map(c=>c.progress.label),['40/40','0/0']);assert.deepEqual(a.courses.map(c=>c.homework.label),['0/4','0/0']);
 assert.deepEqual(v.courses.map(c=>c.url),a.courses.map(c=>c.url));assert.equal(v.scannedAt,a.scannedAt);assert.equal(v.scannedAt,h.local.combinedScan.at);
 assert.equal(h.stats.modelCalls,0);assert.equal(h.stats.opens.length,0);
 assert.equal(require('../extension/logic.js').plan(v.courses).ready,true);
 await h.start();await h.until(s=>!s.running&&s.phase==='done');assert.equal(h.state().finished,5,'同次扫描所得作业缓存可以直接开始');
});

test('离线状态按实际目录识别，已提交待批改与平台0/4独立，去重且保留页面顺序',()=>{
 const d=dom('<li><span>离线作业进度</span><span id="work">0/4</span></li><ul><li><span class="parent_tit">离线作业</span><ul>'+[['10','已提交'],['2','未学'],['1','及格'],['4','已提交 未批改'],['5','已退回'],['6','加载中']].map(([n,status])=>`<li><a onclick="viewAssignment('第${n}章 离线作业','${n}',this)">第${n}章</a><span class="tree-conr">${status}</span></li>`).join('')+'<li><a onclick="viewPaper(\'online\',\'onlineId\',this)">在线作业</a></li><li><a onclick="viewAssignment(\'重复\',\'10\',this)">重复条目</a></li></ul></li></ul>').window.document;
 const rows=H.offlineRows(d);assert.deepEqual(rows.map(r=>r.id),['10','2','1','4','5','6']);assert.deepEqual(rows.map(r=>r.status),['pending','unsubmitted','graded','pending','returned','unknown']);assert.equal(H.offlineProgress(d).label,'0/4');
 assert.deepEqual(H.offlineSummary(rows),{total:6,submitted:3,pending:2,graded:1,unsubmitted:1,returned:1,unknown:1});
 for(const s of ['未提交','未完成','未学'])assert.equal(H.offlineStatus(s),'unsubmitted');
 assert.equal(H.offlineStatus('未批改'),'unknown');assert.equal(H.offlineStatus('已提交 已批改'),'graded');assert.equal(H.offlineStatus('不及格'),'graded');assert.equal(H.offlineStatus('已提交 退回重做'),'returned');
 assert.equal(H.offlineStatus('85 分 及格'),'graded');assert.equal(H.offlineStatus('85'),'graded');
 const a=d.createElement('a');a.setAttribute('onclick',"viewAssignment('title\\'s work','escapedId',this)");d.body.append(a);assert.equal(H.offlineRows(d).at(-1).id,'escapedId');
});

test('统一扫描穿过混合与嵌套离线章节，只读目录并缓存三份待批改，不打开作业或改写0/4',async()=>{
 const items=[{title:'第10章 离线作业',status:'已提交'},{title:'第2章 离线作业',status:'未学'},{title:'第1章 离线作业',status:'已提交'},{title:'第3章 离线作业',status:'已提交'}];
 const h=await harness({extraCourse:true,offlineItems:[items,[]],offlineMode:'nested'});await h.start('SCAN_ALL');await h.until(s=>!s.running);
 assert.equal(h.state().phase,'done',h.state().status);assert.equal(h.stats.publications,1);assert.deepEqual(h.stats.visits,[0,1]);
 const a=h.local.homeworkCache.courses[0].offline;assert.equal(a.quota.label,'0/4');assert.equal(a.catalogComplete,true);assert.equal(a.summary.submitted,3);assert.equal(a.summary.pending,3);assert.equal(a.summary.unsubmitted,1);assert.deepEqual(a.items.map(r=>r.title),items.map(r=>r.title));assert.equal(h.local.homeworkCache.courses[1].offline.quota.label,'0/0');
 assert.equal(h.stats.opens.length,0);assert.equal(h.stats.modelCalls,0);assert.equal(h.stats.submits.length,0);
});

test('离线章节返回无内容时继续扫描，章节没有加载或离线汇总缺失时保留全部旧缓存',async()=>{
 const empty=await harness({offlineItems:[[]],offlineMode:'empty'});await empty.start('SCAN_ALL');await empty.until(s=>!s.running);
 assert.equal(empty.state().phase,'done');assert.equal(empty.local.homeworkCache.courses[0].offline.summary.total,0);assert.equal(empty.local.homeworkCache.courses[0].offline.quota.label,'0/4');
 for(const options of [{offlineItems:[[]],offlineMode:'hang'},{offlineQuotas:['']}]){
  const h=await harness(options),old=structuredClone({video:h.local.courseCache,homework:h.local.homeworkCache});await h.start('SCAN_ALL');await h.until(s=>!s.running);
  assert.equal(h.state().phase,'stopped');assert.equal(h.stats.publications,0);assert.deepEqual(h.local.courseCache,old.video);assert.deepEqual(h.local.homeworkCache,old.homework);assert.equal(h.stats.opens.length,0);assert.equal(h.stats.modelCalls,0);
 }
});

test('离线章节延迟加载时等待，展开下一组导致旧节点删除时仍保留原条目与页面顺序',async()=>{
 const items=[{id:'a',title:'第10章',status:'已提交'},{id:'b',title:'第2章',status:'未学'}];
 for(const offlineMode of ['delayed','accordion']){
  const h=await harness({offlineItems:[items],offlineMode});await h.start('SCAN_ALL');await h.until(s=>!s.running);
  assert.equal(h.state().phase,'done',h.state().status);assert.deepEqual(h.local.homeworkCache.courses[0].offline.items.map(r=>r.title),['第10章','第2章']);assert.equal(h.local.homeworkCache.courses[0].offline.summary.pending,1);assert.equal(h.stats.opens.length,0);
 }
});

test('离线扫描中停止后不再展开，伪造的其他标签或科目目录不能覆盖当前扫描',async()=>{
 const h=await harness({offlineItems:[[{status:'已提交'}]],offlineMode:'hang'}),old=structuredClone(h.local.homeworkCache);await h.start('SCAN_ALL');await h.until(s=>s.phase==='scanOffline');
 const foreign=await h.call({type:'HW_OFFLINE_DIRECTORY',url:h.state().courses[0].url,rows:[]},{...h.sender(1),tab:{id:999}});assert.equal(foreign.running,false);assert.equal(h.state().courseIndex,0);
 const wrong=await h.call({type:'HW_OFFLINE_DIRECTORY',url:origin+'/eduCourseBaseinfo/courseCata.action?courseId=other&classId=other',rows:[]},h.sender(1));assert.match(wrong.error,/不匹配/);assert.equal(h.stats.publications,0);
 await h.call({type:'HW_STOP'});const clicks=h.stats.offlineChapterClicks||0;for(let i=0;i<30;i++)await h.advance();assert.equal(h.stats.offlineChapterClicks||0,clicks);assert.deepEqual(h.local.homeworkCache,old);
});
test('统一扫描中途停止保留两份旧缓存，没有半套覆盖',async()=>{
 const h=await harness({extraCourse:true}),old=structuredClone({video:h.local.courseCache,homework:h.local.homeworkCache});
 await h.start('SCAN_ALL');await h.until(s=>s.courseIndex===1);await h.call({type:'HW_STOP'});for(let i=0;i<5;i++)await h.advance();
 assert.equal(h.state().running,false);assert.equal(h.stats.publications,0);assert.deepEqual(h.local.courseCache,old.video);assert.deepEqual(h.local.homeworkCache,old.homework);
 assert.match(h.state().status,/原缓存完整保留/);
});
test('视频进度未加载时统一扫描等待，超时停止且不覆盖已存两类缓存',async()=>{
 const h=await harness({extraCourse:true,videos:['40/40','']}),old=structuredClone({video:h.local.courseCache,homework:h.local.homeworkCache});
 await h.start('SCAN_ALL');await h.until(s=>!s.running);assert.equal(h.state().phase,'stopped');assert.match(h.state().status,/超过等待时间/);
 assert.equal(h.stats.publications,0);assert.deepEqual(h.local.courseCache,old.video);assert.deepEqual(h.local.homeworkCache,old.homework);
 assert.equal(h.stats.modelCalls,0);assert.equal(h.stats.opens.length,0);
});
test('模型运行中停止立即生效，迟到响应不能填题或提交，原作业标签保留',async()=>{
 const h=await harness({holdModel:true});await h.start();await h.until(s=>s.phase==='thinking');await h.call({type:'HW_STOP'});h.resolveModel();await settle();for(let i=0;i<8;i++)await h.advance();
 assert.equal(h.state().running,false);assert.equal(h.stats.submits.length,0);assert.equal(h.stats.closes.length,0);assert.equal(h.paper().window.document.querySelectorAll('input:checked').length,0);
});
test('重复点击领取和非所属标签事件不能重复打开或提交，视频与作业互斥',async()=>{
 const h=await harness({holdModel:true});await h.start();await h.until(s=>s.phase==='thinking');const s=h.state();
 const wrong=await h.call({type:'HW_SOLVE',questions:[{number:1,type:'radio',text:'wrong',options:['A']}],token:s.pending.token},{tab:{id:999},url:h.tabs.get(s.paperTabId).url,frameId:0});assert.equal(wrong.running,false);
 await h.call({type:'HW_NEXT_PAPER'},h.sender(1));assert.equal(h.stats.opens.length,1);
 const video=await h.call({type:'START',tabId:1});assert.match(video.error,/网上作业正在运行/);await h.call({type:'HW_STOP'});h.resolveModel();
});
test('后台重启和闹钟恢复后继续准备作业目录，不重复提交；等待模型时重启则保留页面停止',async()=>{
 const h=await harness();await h.start();await h.until(s=>s.phase==='catalog');await h.restart();await h.alarm();await h.until(s=>!s.running&&s.phase==='done');assert.equal(h.stats.opens.length,5);
 const stalled=await harness({holdModel:true});await stalled.start();await stalled.until(s=>s.phase==='thinking');await stalled.restart();await stalled.until(s=>!s.running);assert.match(stalled.state().status,/模型请求因扩展重启中断/);assert.equal(stalled.stats.submits.length,0);stalled.resolveModel();
});
