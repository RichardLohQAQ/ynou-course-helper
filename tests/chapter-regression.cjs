const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const L=require('../extension/logic.js');
const root='extension/';
const source=fs.readFileSync(root+'chapter-alert.js','utf8');
const no=()=>{},settle=()=>new Promise(resolve=>setImmediate(resolve));
class Event {constructor(type,options){this.type=type;Object.assign(this,options);}}
function page(clock){
 const listeners=new Map(),native=[],notifications=[];
 const document={addEventListener:(name,fn)=>listeners.set(name,[...(listeners.get(name)||[]),fn]),dispatchEvent:e=>{for(const fn of listeners.get(e.type)||[])fn(e);}};
 const window={CustomEvent:Event,alert:function(...args){native.push({receiver:this,args});return 'native-return';}};
 document.defaultView=window;
 document.addEventListener('__ynouEmptyChapter134',e=>notifications.push(JSON.parse(e.detail)));
 const context={document,window,Date:{now:()=>clock.now},CustomEvent:Event,Reflect};
 vm.runInNewContext(source,context);
 return {document,window,native,notifications,context,action:data=>document.dispatchEvent(new Event('__ynouChapterAction134',{detail:JSON.stringify(data)}))};
}
test('只在章节操作期间确认精确的无内容提示，其他提示保持原始调用',()=>{
 const h=page({now:1000});
 assert.equal(h.window.alert('该章节无内容'),'native-return');
 h.action({action:'arm',token:'test1'});
 assert.equal(h.window.alert('该章节无内容'),undefined);assert.equal(h.notifications.length,1);
 assert.equal(h.window.alert(' 该章节无内容。 '),undefined);assert.equal(h.notifications.length,2);
 const receiver={test:true};
 assert.equal(h.window.alert.call(receiver,'对不起,不允许多窗口播放视频资源!',42),'native-return');
 assert.equal(h.native.at(-1).receiver,receiver);assert.deepEqual(h.native.at(-1).args,['对不起,不允许多窗口播放视频资源!',42]);
 for(const text of ['登录失效','需要学习确认','该章节无内容，请先登录','其他章节无内容'])assert.equal(h.window.alert(text),'native-return');
 assert.equal(h.notifications.length,2);
});
test('停止或60秒到期后恢复普通提示，损坏的控制消息不会开启自动确认',()=>{
 const clock={now:1000},h=page(clock);
 h.document.dispatchEvent(new Event('__ynouChapterAction134',{detail:'invalid'}));
 assert.equal(h.window.alert('该章节无内容'),'native-return');
 h.action({action:'arm',token:'test2'});h.action({action:'clear'});
 assert.equal(h.window.alert('该章节无内容'),'native-return');
 h.action({action:'arm',token:'test3'});clock.now+=60000;
 assert.equal(h.window.alert('该章节无内容'),'native-return');assert.equal(h.notifications.length,0);
});
test('无内容处理可在iframe中独立安装，重复注入不会重复确认或记录',()=>{
 const h=page({now:1000});h.window.top={};
 vm.runInNewContext(source,h.context);h.action({action:'arm',token:'test4'});h.window.alert('该章节无内容');
 assert.equal(h.notifications.length,1);assert.equal(h.native.length,0);
 const manifest=JSON.parse(fs.readFileSync(root+'manifest.json','utf8'));
 const entry=manifest.content_scripts.find(s=>s.js.includes('chapter-alert.js'));
 assert.equal(entry.all_frames,true);assert.equal(entry.world,'MAIN');assert.equal(entry.run_at,'document_start');
 assert.deepEqual(entry.matches,['https://teach.ynou.edu.cn/*']);
});

async function catalog(){
 const clock={now:100000},frame=page(clock),clicks=[],queued=[],panel={textContent:''};let tick,receiver,opened=false;
 let state={running:true,phase:'catalog',scanComplete:true,courseIndex:0,courses:[{title:'测试',progress:L.quota('0/2')}],status:'准备目录'};
 const empty={ownerDocument:frame.document,scrollIntoView:no,click(){clicks.push('常见问题解答');frame.window.alert('该章节无内容');}};
 const videos={ownerDocument:frame.document,scrollIntoView:no,click(){clicks.push('视频章节');opened=true;}};
 const row={title:'真实视频',getAttribute:()=>"viewRes('resource','mp4','视频',1,this)",closest:()=>({querySelector:()=>({textContent:'未学'})})};
 Object.assign(frame.document,{querySelector:sel=>sel==='.parent_tit'?empty:null,querySelectorAll:sel=>sel==='.parent_tit'?[empty,videos]:sel==='.parent_tit[title="Expand this branch"]'?(opened?[empty]:[empty,videos]):sel==='li a[onclick]'&&opened?[row]:[]});
 const document={querySelector:()=>null,querySelectorAll:sel=>sel==='iframe'?[{contentDocument:frame.document}]:[],documentElement:{append:no},createElement:()=>({style:{},attachShadow:()=>({set innerHTML(v){},querySelector:()=>panel})})};
 const window={};window.top=window;
 const chrome={runtime:{onMessage:{addListener:fn=>receiver=fn},sendMessage:async m=>{
  if(m.type==='QUEUE_READY'){queued.push(m.rows);state={...state,phase:'verify'};}
  if(m.type==='STOP')state={...state,running:false,status:m.reason};
  return structuredClone(state);
 }}};
 vm.runInNewContext(fs.readFileSync(root+'content.js','utf8'),{document,window,chrome,CourseLogic:L,Date:{now:()=>clock.now},location:{pathname:'/webindex.action'},setInterval:fn=>tick=fn,setTimeout:(fn,ms)=>{clock.now+=ms;queueMicrotask(fn);}});
 await settle();
 return {frame,clicks,queued,clock,get state(){return state;},async tick(){clock.now+=5000;await tick();await settle();},
  ping:()=>new Promise(resolve=>receiver({type:'PING'},{},resolve)),pause:()=>receiver({type:'PAUSE',reason:'测试停止'},{},no)};
}
test('实际主控制器展开iframe空章节后继续下一章，只将真实视频放入队列',async()=>{
 const h=await catalog();for(let i=0;i<3;i++)await h.tick();
 assert.deepEqual(h.clicks,['常见问题解答','视频章节']);assert.equal(h.frame.native.length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(h.queued)),[[{id:'resource',title:'真实视频'}]]);
 assert.equal((await h.ping()).emptyChaptersSkipped,1);assert.equal(h.state.courses[0].progress.label,'0/2');
 // A delayed empty result from an earlier chapter is still acknowledged after queuing.
 h.frame.window.alert('该章节无内容');assert.equal(h.frame.native.length,0);assert.equal((await h.ping()).emptyChaptersSkipped,2);
});
test('停止连播会撤销已操作iframe中的无内容自动确认',async()=>{
 const h=await catalog();assert.equal(h.frame.native.length,0);h.pause();
 h.frame.window.alert('该章节无内容');assert.equal(h.frame.native.length,1);assert.equal((await h.ping()).emptyChaptersSkipped,1);
});
