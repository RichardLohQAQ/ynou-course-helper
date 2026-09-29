(function(root){
 const origin='https://teach.ynou.edu.cn';
 const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
 const visible=e=>!!e?.getClientRects().length&&e.ownerDocument.defaultView.getComputedStyle(e).visibility!=='hidden';
 function quota(text){const m=String(text).match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);if(!m)return null;const current=+m[1],total=+m[2];return {current,total,full:current>=total,label:current+'/'+total};}
 function validQuota(q){return !!q&&Number.isInteger(q.current)&&q.current>=0&&Number.isInteger(q.total)&&q.total>=0&&q.current<=100000&&q.total<=100000;}
 const fullQuota=q=>validQuota(q)&&q.current>=q.total;
 const onlineSection=text=>/(?:在线|网上)\s*(?:作业|练习)/.test(norm(text));
 const offlineSection=text=>/离线\s*作业/.test(norm(text))&&!onlineSection(text);
 function progress(d){
  const actual=d.querySelector('#testnum');if(actual&&/网上作业进度/.test(actual.parentElement?.textContent||''))return quota(actual.textContent);
  const labels=Array.from(d.querySelectorAll('span,div,dt,p')).filter(e=>norm(e.textContent)==='网上作业进度');
  for(const label of labels)for(let e=label.parentElement,n=0;e&&n<3;e=e.parentElement,n++){
   const matches=Array.from(e.querySelectorAll('span,div,dd')).map(e=>quota(e.textContent)).filter(Boolean);
   if(matches.length===1)return matches[0];
  }
  return null;
 }
 function resource(raw){const m=String(raw).match(/\bviewPaper\(\s*['"]([\w-]+)['"]\s*,\s*['"]([\w-]+)['"]/);return m?{paperId:m[1],id:m[2]}:null;}
 function paperIdentity(url){try{const u=new URL(url);if(u.origin!==origin||u.pathname!=='/hw/student/studentStartHomework.action')return null;return {paperId:u.searchParams.get('eduCourseClassPaper.conOtherId'),id:u.searchParams.get('eduCourseClassPaper.courseActivityId'),classId:u.searchParams.get('eduCourseClassPaper.classId')};}catch{return null;}}
 function samePaper(url,pending,course){const p=paperIdentity(url);try{return !!p&&p.id===pending?.id&&p.paperId===pending?.paperId&&p.classId===new URL(course.url).searchParams.get('classId');}catch{return false;}}
 function offline(a){
  if(offlineSection(a.title||a.textContent))return true;
  for(let li=a.closest('li');li;li=li.parentElement?.closest('li')){
   const header=Array.from(li.children).find(e=>e.matches('.parent_tit'));
   if(header&&offlineSection(header.textContent))return true;
  }
  return false;
 }
 function rows(d){return Array.from(d.querySelectorAll('a[onclick]')).map(a=>{const r=resource(a.getAttribute('onclick'));if(!r||offline(a))return null;const status=norm(a.closest('li')?.querySelector('.tree-conr')?.textContent);return {...r,a,title:norm(a.title||a.textContent),complete:!/未学|未完成|未提交|不及格|未通过/.test(status)&&(/已学|已完成|已提交/.test(status)||/^(及格|通过|已通过)$/.test(status))};}).filter(Boolean);}
 function offlineProgress(d){
  const actual=d.querySelector('#work');if(actual&&/离线作业进度/.test(actual.parentElement?.textContent||''))return quota(actual.textContent);
  for(const e of d.querySelectorAll('li,dl'))if(/离线作业进度/.test(e.textContent)&&!/(视频|网上作业)进度/.test(e.textContent)){
   const values=Array.from(e.querySelectorAll('span,dd')).map(n=>quota(n.textContent)).filter(Boolean);if(values.length===1)return values[0];
  }
  return null;
 }
 function offlineStatus(text){
  const value=norm(text);
  if(/退回|退改|驳回|需(?:要)?重(?:做|交)|重新提交/.test(value))return 'returned';
  if(/未提交|未学|未完成|未做/.test(value))return 'unsubmitted';
  if(/待批(?:改|阅)|未批(?:改|阅)|待评(?:分|阅)|待审(?:核)?/.test(value))return /已提交|待/.test(value)?'pending':'unknown';
  if(/已批(?:改|阅)|已评(?:分|阅)|及格|未通过|已通过|^(?:通过|已学|已完成)$/.test(value)||/^\d+(?:\.\d+)?\s*分?$/.test(value))return 'graded';
  if(/已提交/.test(value))return 'pending';
  return 'unknown';
 }
 function offlineRows(d){
  const seen=new Set();return Array.from(d.querySelectorAll('a[onclick]')).map(a=>{
   const raw=a.getAttribute('onclick')||'',match=raw.match(/\bviewAssignment\(\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,\s*['"]([\w-]+)['"]/);if(!match||seen.has(match[1]))return null;seen.add(match[1]);
   const li=a.closest('li'),statusText=norm(li?.querySelector('.tree-conr')?.textContent),order=[];
   for(let item=li;item;item=item.parentElement?.closest('li'))order.unshift(Array.from(item.parentElement?.children||[]).filter(e=>e.tagName==='LI').indexOf(item));
   return {id:match[1],title:norm(a.title||a.textContent),status:offlineStatus(statusText),statusText,order};
  }).filter(Boolean);
 }
 function offlineSummary(items){
  const counts={total:items.length,submitted:0,pending:0,graded:0,unsubmitted:0,returned:0,unknown:0};
  for(const item of items){const status=['pending','graded','unsubmitted','returned'].includes(item.status)?item.status:'unknown';counts[status]++;if(status==='pending'||status==='graded')counts.submitted++;}return counts;
 }
 function questions(d){
  const controls=Array.from(d.querySelectorAll('[answer_control]')).filter(visible);
  if(!controls.length)throw Error('当前页面没有可识别的作业答题控件。');
  if(controls.length>200)throw Error('单份作业超过 200 题，请手动处理。');
  const seen=new Set();const result=controls.map((el,index)=>{
   const container=el.closest('.e_juan02daan'),content=container?.querySelector('.qcontent');
   const inputs=Array.from(el.querySelectorAll('input:not([type=hidden]),textarea,select,[contenteditable=true]')).filter(visible);
   if(!content||!inputs.length||inputs.some(e=>e.disabled||e.readOnly))throw Error('第 '+(index+1)+' 题未处于可作答状态。');
   if(content.querySelector('canvas,svg,video,audio,iframe,object'))throw Error('第 '+(index+1)+' 题包含暂不支持的嵌入媒体，需要手动处理。');
   // Inline images are ignored: innerText/textContent provide the written question,
   // without downloading image data or sending its URL to the model.
   const text=norm(content.innerText||content.textContent);if(!text||text.length>16000)throw Error('题干为空或过长，已停止。');
   let type=inputs.every(e=>e.type==='radio')?'radio':inputs.every(e=>e.type==='checkbox')?'checkbox':inputs.every(e=>e.tagName==='TEXTAREA'||e.tagName==='INPUT'&&['text','number'].includes(e.type))?'text':null;
   if(!type)throw Error('第 '+(index+1)+' 题暂不支持自动填写。');
   const name=inputs[0].name;
   if(type!=='text'&&(!name||inputs.some(e=>e.name!==name)||seen.has(name)))throw Error('题目选项分组不明确，已停止。');
   seen.add(name);const options=type==='text'?[]:inputs.map(e=>e.value);
   if(new Set(options).size!==options.length||options.some(v=>!v||v.length>100))throw Error('页面选项值不唯一，已停止。');
   return {number:index+1,type,text,options,fields:type==='text'?inputs.length:undefined};
  });
  const declared=Array.from((d.body?.innerText||'').matchAll(/共\s*(\d+)\s*题/g)).map(m=>+m[1]);
  if(declared.length&&declared.reduce((a,b)=>a+b,0)!==result.length)throw Error('页面题目总数与识别到的控件数不一致，已停止。');
  return result;
 }
 function fingerprint(q){
  // Storage may reorder dictionary keys. Only fixed-position semantic values
  // identify a question; question and option array order must remain significant.
  return JSON.stringify(q.map(item=>[item.number,item.type,item.text,item.options,item.type==='text'?item.fields:null]));
 }
 function apply(d,qs,answers){
  if(fingerprint(questions(d))!==fingerprint(qs))throw Error('题目内容已经变化，未写入旧答案。');
  const controls=Array.from(d.querySelectorAll('[answer_control]')).filter(visible);
  for(const q of qs){const a=answers.find(a=>a.number===q.number),inputs=Array.from(controls[q.number-1].querySelectorAll('input:not([type=hidden]),textarea')).filter(visible);if(!a)throw Error('答案缺失。');
   if(q.type==='text')inputs.forEach((e,i)=>{const w=e.ownerDocument.defaultView,proto=e.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,a.values[i]);e.dispatchEvent(new w.Event('input',{bubbles:true}));e.dispatchEvent(new w.Event('change',{bubbles:true}));});
   else for(const input of inputs){const needed=a.values.includes(input.value);if(input.checked!==needed&&(needed||q.type==='checkbox'))input.click();}
  }
  if(!matches(d,qs,answers))throw Error('页面答案未成功填入，未提交。');
 }
 function matches(d,qs,answers){
  if(fingerprint(questions(d))!==fingerprint(qs))return false;
  const controls=Array.from(d.querySelectorAll('[answer_control]')).filter(visible);
  return qs.every(q=>{const inputs=Array.from(controls[q.number-1].querySelectorAll('input:not([type=hidden]),textarea')).filter(visible),values=q.type==='text'?inputs.map(e=>e.value):inputs.filter(e=>e.checked).map(e=>e.value),expected=answers.find(a=>a.number===q.number)?.values;return expected&&JSON.stringify(q.type==='text'?values:[...values].sort())===JSON.stringify(q.type==='text'?expected:[...expected].sort());});
 }
 const api={origin,norm,visible,quota,validQuota,fullQuota,onlineSection,offlineSection,progress,resource,paperIdentity,samePaper,rows,offlineProgress,offlineStatus,offlineRows,offlineSummary,questions,fingerprint,apply,matches};root.HomeworkLogic=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
