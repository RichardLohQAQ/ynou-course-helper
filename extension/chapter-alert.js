// Only acknowledge the known empty-chapter notice during an extension chapter action.
// All other dialogs, and empty notices outside that short action window, use the site's alert.
(() => {
 if(window.__ynouEmptyChapterGuard134)return;
 window.__ynouEmptyChapterGuard134=true;
 let armed=null;
 document.addEventListener('__ynouChapterAction134',event=>{
  try{
   const data=JSON.parse(event.detail);
   if(data.action==='clear')armed=null;
   else if(data.action==='arm'&&typeof data.token==='string'&&data.token.length<=40)armed={token:data.token,until:Date.now()+60000};
  }catch{}
 });
 const originalAlert=window.alert;
 window.alert=function(message){
  if(armed&&Date.now()<armed.until&&typeof message==='string'&&/^该章节无内容[。！!]?$/u.test(message.trim())){
   try{document.dispatchEvent(new CustomEvent('__ynouEmptyChapter134',{detail:JSON.stringify({token:armed.token})}));}catch{}
   return;
  }
  return Reflect.apply(originalAlert,this,arguments);
 };
})();
