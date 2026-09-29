const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const UI='chrome-extension://test/popup.html',HOME='https://teach.ynou.edu.cn/webindex.action';
function harness({restored=false}={}){
 const local={},session={},wins=new Map([[1,{id:1,type:'normal',state:'normal',tabs:[{id:1}]}]]),tabs=new Map([[1,{id:1,url:HOME,windowId:1}]]),created=[],updated=[],closed=[],contexts=[],behavior={};let action,resize,removed,next=10;
 if(restored){wins.delete(1);wins.set(10,{id:10,type:'popup',state:'normal',width:700,height:800,tabs:[{id:50}]});contexts.push({windowId:10,tabId:50,documentUrl:UI});}
 const erase=id=>{wins.delete(id);contexts.splice(0,contexts.length,...contexts.filter(c=>c.windowId!==id));};
 const storage=data=>({get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))});
 const chrome={runtime:{getURL:file=>'chrome-extension://test/'+file,getContexts:async filter=>contexts.filter(c=>filter.documentUrls.includes(c.documentUrl))},storage:{local:storage(local),session:storage(session)},tabs:{get:async id=>tabs.get(id),query:async()=>[...tabs.values()]},action:{onClicked:{addListener:fn=>action=fn},setTitle:async()=>{}},windows:{
  getAll:async options=>{if(behavior.listError)throw Error('无法读取窗口');if(behavior.beforeList)behavior.beforeList();return [...wins.values()].filter(w=>options.windowTypes.includes(w.type));},
  get:async id=>{if(behavior.beforeGet)behavior.beforeGet(id);return wins.get(id);},create:async opts=>{created.push(structuredClone(opts));const win={id:next++,state:'normal',...opts};win.tabs=[{id:win.id+40}];wins.set(win.id,win);contexts.push({windowId:win.id,tabId:win.tabs[0].id,documentUrl:opts.url});if(behavior.afterCreate)behavior.afterCreate();return win;},
  remove:async id=>{if(behavior.removeError)throw Error('关闭失败');closed.push(id);erase(id);removed(id);},
  update:async(id,patch)=>{assert.ok(wins.has(id));updated.push({id,...structuredClone(patch)});Object.assign(wins.get(id),patch);return wins.get(id);},onBoundsChanged:{addListener:fn=>resize=fn},onRemoved:{addListener:fn=>removed=fn}
 }};
 const scope={chrome,URL};vm.runInNewContext(fs.readFileSync('extension/ui-window.js','utf8'),scope);
 return {api:scope.ControllerUI,local,session,wins,tabs,created,updated,closed,contexts,behavior,action:tab=>action(tab),resize:win=>resize(win),remove:id=>{erase(id);return removed(id);},settle:()=>scope.ControllerUI.handle({type:'UI_TARGET'},{url:UI}).catch(()=>{}),sender:{url:UI,tab:{id:50,windowId:10},frameId:0}};
}
test('点击图标只创建一个独立助手窗口，多次快速点击复用，不创建视频或首页',async()=>{
 const h=harness();await Promise.all([h.api.open(h.tabs.get(1)),h.api.open(h.tabs.get(1)),h.api.open(h.tabs.get(1))]);
 assert.equal(h.created.length,1);assert.deepEqual(h.created[0],{url:UI,type:'popup',focused:true,width:540,height:860});assert.equal(h.updated.length,2);assert.equal(h.session.controllerWindow.targetTabId,1);
 assert.equal((await h.api.handle({type:'UI_TARGET'},h.sender)).tabId,1);
});
test('原教学首页一直作为目标，助手自身成为活动标签也不影响启动；多首页未绑定时不猜',async()=>{
 const h=harness();h.tabs.set(2,{id:2,url:HOME});await h.api.open(h.tabs.get(2));assert.equal((await h.api.handle({type:'UI_TARGET'},h.sender)).tabId,2);
 h.tabs.set(50,{id:50,url:UI});assert.equal((await h.api.handle({type:'UI_TARGET'},h.sender)).tabId,2);
 h.session.controllerWindow.targetTabId=null;await assert.rejects(h.api.handle({type:'UI_TARGET'},h.sender),/教学平台首页/);
 h.tabs.delete(1);h.tabs.delete(2);await assert.rejects(h.api.handle({type:'UI_TARGET'},h.sender),/教学平台首页/);
});
test('从播放器点击图标通过原窗口找到教学首页；其他网站不能冒充控制界面',async()=>{
 const h=harness();await h.api.open({id:5,url:'https://teach.ynou.edu.cn/play/playVideo.action',openerTabId:1});assert.equal((await h.api.handle({type:'UI_TARGET'},h.sender)).tabId,1);
 for(const sender of [{url:HOME,tab:{id:1},frameId:0},{url:UI,tab:{id:1},frameId:1},{url:UI+'?spoof=1'}])await assert.rejects(h.api.handle({type:'UI_RESET_SIZE'},sender),/仅课程助手窗口/);
 assert.equal(h.updated.length,0);
});
test('只记住助手普通状态的大小，最大化及其他窗口不覆盖，关闭重开还原尺寸',async()=>{
 const h=harness();await h.api.open(h.tabs.get(1));await h.resize({id:10,state:'normal',width:900,height:1000});
 await h.resize({id:77,state:'normal',width:400,height:500});await h.resize({id:10,state:'maximized',width:1920,height:1080});assert.deepEqual(h.local.controllerWindowSize,{width:900,height:1000});
 h.session.run={running:true,videoTabId:7};h.session.homeworkRun={running:false};await h.remove(10);assert.equal(h.session.run.running,true);assert.equal(h.tabs.size,1);
 await h.api.open(h.tabs.get(1));assert.equal(h.created[1].width,900);assert.equal(h.created[1].height,1000);
});
test('后台会话信息丢失仍能找回已打开的助手，恢复大小不会修改教学窗口',async()=>{
 const h=harness();await h.api.open(h.tabs.get(1));delete h.session.controllerWindow;
 await h.api.open(h.tabs.get(1));assert.equal(h.created.length,1);await h.api.handle({type:'UI_RESET_SIZE'},h.sender);
 assert.deepEqual(h.local.controllerWindowSize,{width:540,height:860});assert.ok(h.updated.every(u=>u.id===10));
});
test('已登记窗口离开助手页面后不接管，创建新助手；畸形尺寸限制在可用范围',async()=>{
 const h=harness();h.local.controllerWindowSize={width:-5,height:999999};await h.api.open(h.tabs.get(1));assert.equal(h.created[0].width,360);assert.equal(h.created[0].height,1500);
 h.contexts[0].documentUrl='https://unrelated.test/';await h.api.open(h.tabs.get(1));assert.equal(h.created.length,2);assert.equal(h.updated.length,0);
});
test('发布入口移除工具栏弹窗，保留原权限并使用独立窗口控制器',()=>{
 const m=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));assert.equal(m.action.default_popup,undefined);assert.deepEqual(m.permissions,['storage','activeTab','alarms']);assert.equal(m.minimum_chrome_version,'116');
});
test('关闭最后一个普通浏览器窗口时关闭助手；无关弹出窗口不影响识别也不会被关闭',async()=>{
 const h=harness();await h.api.open(h.tabs.get(1));h.wins.set(88,{id:88,type:'popup',tabs:[{id:188}]});
 h.wins.get(10).width=820;h.wins.get(10).height=950;await h.remove(1);await h.settle();
 assert.deepEqual(h.closed,[10]);assert.equal(h.wins.has(88),true);assert.equal(h.session.controllerWindow.windowId,undefined);assert.deepEqual(h.local.controllerWindowSize,{width:820,height:950});
});
test('还有一个普通窗口时保留助手，最小化也算打开；仅关闭助手不关闭浏览器',async()=>{
 const h=harness();await h.api.open(h.tabs.get(1));h.wins.set(2,{id:2,type:'normal',state:'minimized'});await h.remove(1);assert.deepEqual(h.closed,[]);assert.equal(h.wins.has(10),true);
 await h.remove(10);assert.equal(h.wins.has(2),true);assert.deepEqual(h.closed,[]);
});
test('后台重启时清理恢复出来的独立助手，登记丢失也能识别；最大化不覆盖历史尺寸',async()=>{
 const h=harness({restored:true});h.local.controllerWindowSize={width:600,height:700};h.wins.get(10).state='maximized';await h.settle();
 assert.deepEqual(h.closed,[10]);assert.deepEqual(h.local.controllerWindowSize,{width:600,height:700});
});
test('普通窗口恰在助手创建期间关闭时仍收起助手，检查期间新开普通窗口则保留',async()=>{
 const h=harness();h.behavior.afterCreate=()=>h.wins.delete(1);await h.api.open(h.tabs.get(1));assert.deepEqual(h.closed,[10]);
 const next=harness();await next.api.open(next.tabs.get(1));next.behavior.beforeGet=id=>{if(id===10)next.wins.set(2,{id:2,type:'normal'});};await next.remove(1);assert.deepEqual(next.closed,[]);assert.equal(next.wins.has(10),true);
});
test('助手窗口包含其他网页时不整窗关闭，已导航离开助手或普通标签页也不误关',async()=>{
 for(const changed of ['extra-tab','navigated','normal']){const h=harness();await h.api.open(h.tabs.get(1));if(changed==='extra-tab')h.wins.get(10).tabs.push({id:900});if(changed==='navigated')h.contexts[0].documentUrl='https://unrelated.test';if(changed==='normal')h.wins.get(10).type='normal';await h.remove(1);assert.deepEqual(h.closed,[],changed);}
});
test('无法确认窗口列表时不猜测关闭，关闭失败后下次事件可继续清理',async()=>{
 const h=harness();await h.api.open(h.tabs.get(1));h.behavior.listError=true;await h.remove(1);assert.deepEqual(h.closed,[]);h.behavior.listError=false;h.behavior.removeError=true;await h.remove(88);assert.equal(h.wins.has(10),true);h.behavior.removeError=false;await h.remove(89);assert.deepEqual(h.closed,[10]);
});
test('确认窗口过程中页面跳转到其他网址时，重新核对归属并保留该窗口',async()=>{
 const h=harness();await h.api.open(h.tabs.get(1));h.behavior.beforeGet=id=>{if(id===10)h.contexts[0].documentUrl='https://unrelated.test/';};await h.remove(1);assert.deepEqual(h.closed,[]);assert.equal(h.wins.has(10),true);
});
