// The dashboard is an extension window, separate from all teaching/player tabs.
// Only its dimensions are persisted; the linked teaching tab is session-scoped.
(function(root){
 const KEY='controllerWindow',SIZE='controllerWindowSize',URL_UI=chrome.runtime.getURL('popup.html');let queue=Promise.resolve();
 const read=async()=>((await chrome.storage.session.get(KEY))[KEY]||{});
 const trusted=sender=>sender?.url===URL_UI&&(sender.frameId==null||sender.frameId===0);
 const home=tab=>{try{const u=new URL(tab?.url);return u.origin==='https://teach.ynou.edu.cn'&&u.pathname==='/webindex.action';}catch{return false;}};
 const enqueue=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 const size=raw=>({width:Number.isFinite(raw?.width)?Math.max(360,Math.min(1800,Math.round(raw.width))):540,height:Number.isFinite(raw?.height)?Math.max(440,Math.min(1500,Math.round(raw.height))):860});
 async function target(clicked,previous){
  if(home(clicked))return clicked.id;
  for(const id of [clicked?.openerTabId,previous.targetTabId])if(Number.isInteger(id)){const tab=await chrome.tabs.get(id).catch(()=>null);if(home(tab))return id;}
  const tabs=(await chrome.tabs.query({url:'https://teach.ynou.edu.cn/webindex.action*'})).filter(home);return tabs.length===1?tabs[0].id:null;
 }
 async function contexts(){return chrome.runtime.getContexts({documentUrls:[URL_UI]});}
 async function closeWithoutBrowser(){
  if((await chrome.windows.getAll({windowTypes:['normal']})).length)return;
  const live=await contexts(),ids=[...new Set(live.filter(c=>c.windowId>=0&&c.documentUrl===URL_UI).map(c=>c.windowId))];
  for(const id of ids){
   const win=await chrome.windows.get(id,{populate:true}).catch(()=>null);
   // Close only windows consisting entirely of our own dashboard tabs.
   if(win?.type!=='popup'||!win.tabs?.length||win.tabs.some(t=>!live.some(c=>c.windowId===id&&c.tabId===t.id&&c.documentUrl===URL_UI)))continue;
   const current=await contexts();if(win.tabs.some(t=>!current.some(c=>c.windowId===id&&c.tabId===t.id&&c.documentUrl===URL_UI)))continue;
   if((await chrome.windows.getAll({windowTypes:['normal']})).length)return;
   if(win.state==='normal')await chrome.storage.local.set({[SIZE]:size(win)});
   await chrome.windows.remove(id).catch(()=>{});
  }
 }
 async function open(clicked){return enqueue(async()=>{
  const old=await read(),targetTabId=await target(clicked,old),live=(await contexts()).filter(c=>c.windowId>=0&&c.documentUrl===URL_UI);
  const ordered=live.sort((a,b)=>Number(b.windowId===old.windowId)-Number(a.windowId===old.windowId));
  for(const context of ordered){const win=await chrome.windows.get(context.windowId).catch(()=>null);if(win?.type!=='popup')continue;
   await chrome.storage.session.set({[KEY]:{windowId:win.id,targetTabId}});
   await chrome.windows.update(win.id,{focused:true,...(win.state==='minimized'?{state:'normal'}:{})});await closeWithoutBrowser();return {windowId:win.id,reused:true};
  }
  const stored=(await chrome.storage.local.get(SIZE))[SIZE],dimensions=size(stored);
  const win=await chrome.windows.create({url:URL_UI,type:'popup',focused:true,...dimensions});if(!Number.isInteger(win?.id))throw Error('未能打开课程助手窗口。');
  await chrome.storage.session.set({[KEY]:{windowId:win.id,targetTabId}});await closeWithoutBrowser();return {windowId:win.id,reused:false};
 });}
 async function handle(m,sender){
  if(!trusted(sender))throw Error('仅课程助手窗口可操作此功能。');
  if(m.type==='UI_TARGET'){await queue;const state=await read(),tabId=await target(null,state);if(tabId==null)throw Error('请在要使用的教学平台首页点击插件图标，再开始任务。');return {tabId};}
  if(m.type==='UI_RESET_SIZE')return enqueue(async()=>{
   const state=await read(),live=await contexts();if(!live.some(c=>c.windowId===state.windowId&&c.documentUrl===URL_UI))throw Error('请重新点击插件图标打开助手窗口。');
   const dimensions=size(null);await chrome.windows.update(state.windowId,{state:'normal'});await chrome.windows.update(state.windowId,{...dimensions,focused:true});await chrome.storage.local.set({[SIZE]:dimensions});return {ok:true};
  });
  throw Error('未知的界面操作。');
 }
 if(chrome.action?.onClicked&&chrome.windows){
  chrome.action.onClicked.addListener(tab=>open(tab).then(()=>chrome.action.setTitle({title:'云开课程助手'}),error=>chrome.action.setTitle({title:'打开失败：'+String(error.message).slice(0,100)})));
  chrome.windows.onBoundsChanged.addListener(win=>enqueue(async()=>{const s=await read();if(win.id!==s.windowId||win.state!=='normal')return;await chrome.storage.local.set({[SIZE]:size(win)});}).catch(()=>{}));
  chrome.windows.onRemoved.addListener(id=>enqueue(async()=>{const s=await read();if(s.windowId===id)await chrome.storage.session.set({[KEY]:{targetTabId:s.targetTabId}});await closeWithoutBrowser();}).catch(()=>{}));
  // Reconcile restored dashboard windows even when the worker missed a close event.
  enqueue(closeWithoutBrowser).catch(()=>{});
 }
 root.ControllerUI={open,handle};
})(globalThis);
