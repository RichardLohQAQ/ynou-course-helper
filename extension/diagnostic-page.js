// Record the site's startup failure without suppressing its alert or close.
(() => {
  if (window.top !== window || window.__ynouStartupProbe131) return;
  window.__ynouStartupProbe131 = true;
  const emit = (kind, data = {}) => {
    try {
      document.dispatchEvent(new CustomEvent('ynou-player-diagnostic', {
        detail: JSON.stringify({kind, at: Date.now(), ...data})
      }));
    } catch {}
  };
  const stack = () => String(new Error().stack || '').slice(0, 2500);
  // Only playback-related markers are observed. Never export cookie/session tokens.
  const playbackKey = key => typeof key === 'string' && /play|video|window|winnum|wincount|^data$/i.test(key);
  function marker(key, value) {
    let hash=2166136261;for(const ch of key)hash=Math.imul(hash^ch.charCodeAt(0),16777619);
    let primitive=value;try{primitive=JSON.parse(value);}catch{}
    return {keyTag:(hash>>>0).toString(16),category:key==='data'?'progress-cache':'playback',value:typeof primitive==='boolean'||(typeof primitive==='number'&&Number.isInteger(primitive)&&primitive>=0&&primitive<=99)?primitive:'[redacted]'};
  }
  function snapshotMarkers() {
    const markers=[];
    try{for(const item of String(document.cookie||'').split(';')){const pos=item.indexOf('=');if(pos<0)continue;const key=item.slice(0,pos).trim();if(playbackKey(key))markers.push({area:'cookie',...marker(key,item.slice(pos+1))});}}catch{}
    for(const area of ['localStorage','sessionStorage'])try{const store=window[area];if(!store)continue;for(let i=0;i<Math.min(store.length,200);i++){const key=store.key(i);if(playbackKey(key))markers.push({area,...marker(key,store.getItem(key))});}}catch{}
    return markers.slice(0,30);
  }
  let cookieObserved=false,storageObserved=false;
  try{
    if(typeof Document!=='undefined'){
      const descriptor=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');
      if(descriptor?.get&&descriptor?.set&&descriptor.configurable){
        Object.defineProperty(Document.prototype,'cookie',{...descriptor,set:function(value){
          const result=Reflect.apply(descriptor.set,this,[value]);
          try{if(typeof value==='string'){const first=value.split(';')[0],pos=first.indexOf('='),key=first.slice(0,pos).trim();if(pos>=0&&playbackKey(key))emit('cookie-write',{...marker(key,first.slice(pos+1)),expired:/max-age\s*=\s*(?:0|-[0-9]+)/i.test(value),stack:stack()});}}catch{}
          return result;
        }});cookieObserved=true;
      }
    }
  }catch{}
  try{
    if(typeof Storage!=='undefined'){
      for(const name of ['setItem','removeItem']){
        const original=Storage.prototype[name];
        Storage.prototype[name]=function(key,value){
          const result=Reflect.apply(original,this,arguments);
          try{if(playbackKey(key))emit(name==='setItem'?'storage-write':'storage-remove',{area:this===window.localStorage?'localStorage':'sessionStorage',...marker(key,typeof value==='string'?value:''),stack:stack()});}catch{}
          return result;
        };
      }
      storageObserved=true;
    }
  }catch{}
  const originalAlert = window.alert;
  window.alert = function(message) {
    if (typeof message === 'string' && /不允许多窗口播放/.test(message)) {
      emit('platform-multiple-window', {stack: stack(),markers:snapshotMarkers(),videoCount:document.querySelectorAll?.('video')?.length??null});
    }
    return Reflect.apply(originalAlert, this, arguments);
  };
  const originalClose = window.close;
  window.close = function() {
    emit('site-close', {stack: stack()});
    return Reflect.apply(originalClose, this, arguments);
  };
  // Capture media events without calling or replacing play().
  for (const kind of ['play', 'playing', 'ended', 'error', 'seeking', 'seeked']) {
    document.addEventListener(kind, event => {
      if (event.target instanceof HTMLVideoElement) {
        emit('media-' + kind, {time: event.target.currentTime});
      }
    }, true);
  }
  if(window.addEventListener)for(const name of ['beforeunload','pagehide','unload'])window.addEventListener(name,event=>emit('lifecycle-'+name,{persisted:!!event.persisted,markers:snapshotMarkers()}));
  if(window.addEventListener){
    window.addEventListener('error',event=>emit('site-error',{errorName:event.error?.name||'Error',stack:String(event.error?.stack||'').slice(0,2500)}));
    window.addEventListener('unhandledrejection',event=>emit('site-promise-error',{errorName:event.reason?.name||'Error',stack:String(event.reason?.stack||'').slice(0,2500)}));
  }
  document.addEventListener('visibilitychange',()=>emit('lifecycle-visibility',{visibility:document.visibilityState}));
  try{
    if(typeof PerformanceObserver!=='undefined'&&typeof location!=='undefined'){
      new PerformanceObserver(list=>{for(const entry of list.getEntries()){
        const url=new URL(entry.name);
        if(url.origin===location.origin&&['xmlhttprequest','fetch','beacon'].includes(entry.initiatorType))emit('site-request-finished',{path:url.pathname,duration:Math.round(entry.duration),status:Number(entry.responseStatus)||null});
      }}).observe({type:'resource',buffered:true});
    }
  }catch{}
  emit('probe-ready',{browser:typeof navigator!=='undefined'?navigator.userAgent.match(/(?:Chrome|Edg)\/[0-9.]+/g)?.join(' '):'',unloadAllowed:document.featurePolicy?.allowsFeature?.('unload')??null,cookieObserved,storageObserved,markers:snapshotMarkers()});
})();
