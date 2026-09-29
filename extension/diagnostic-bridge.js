(() => {
  if (window.top !== window) return;
  const allowed = new Set(['probe-ready','platform-multiple-window','site-close','media-play','media-playing','media-ended','media-error','media-seeking','media-seeked','lifecycle-beforeunload','lifecycle-pagehide','lifecycle-unload','lifecycle-visibility','cookie-write','storage-write','storage-remove','site-request-finished','site-error','site-promise-error']);
  const counts={};
  document.addEventListener('ynou-player-diagnostic', event => {
    if (typeof event.detail !== 'string' || event.detail.length > 12000) return;
    try {
      const data = JSON.parse(event.detail);
      if (!allowed.has(data.kind)) return;
      const group=data.kind.startsWith('media-')?'media':data.kind==='site-request-finished'?'network':data.kind.includes('write')||data.kind==='storage-remove'?'marker':data.kind.startsWith('lifecycle-')?'lifecycle':data.kind;
      counts[group]=(counts[group]||0)+1;
      if(counts[group]>(({media:120,network:80,marker:80,lifecycle:40})[group]||20))return;
      chrome.runtime.sendMessage({type: 'PLAYER_DIAGNOSTIC', data}).catch(() => {});
    } catch {}
  });
  chrome.runtime.sendMessage({type: 'PLAYER_EARLY'}).catch(() => {});
})();
