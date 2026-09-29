/* Shared parsing functions, also exercised by the offline regression tests. */
(function (root) {
  const seconds = s => s.split(':').reduce((n, x) => n * 60 + Number(x), 0);
  function completed(text) {
    if (/未学|未完成|学习中|已学中|进行中/.test(text)) return false;
    const m = text.match(/(\d{2}:\d{2}:\d{2})\s*\/\s*(\d{2}:\d{2}:\d{2})/);
    if (m && seconds(m[2]) > 0 && seconds(m[1]) >= seconds(m[2])) return true;
    return /已完成|已学完|完成学习|已学/.test(text);
  }
  function resource(raw) {
    const m = raw.match(/viewRes\(\s*'([^']+)'\s*,\s*'([^']+)'/);
    return m && /^(mp4|flv|wmv|avi|mov|m3u8)$/i.test(m[2]) ? m[1] : null;
  }
  function order(a, b) { return a.index - b.index; }
  function trusted(url) {
    try { return new URL(url).origin === 'https://teach.ynou.edu.cn'; } catch { return false; }
  }
  function quota(text, percent) {
    const m = String(text).match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    if(m){const current=Number(m[1]),total=Number(m[2]);return {current,total,full:current>=total,label:`${current}/${total}`};}
    const p=String(percent).match(/^\s*(\d+(?:\.\d+)?)%\s*$/);
    if(p)return {full:Number(p[1])>=100,label:p[0].trim()};
    return null;
  }
  function plan(courses) {
    const ready=courses.length>0 && courses.every(c=>c.progress && Number.isInteger(c.progress.current) && c.progress.current>=0 && Number.isInteger(c.progress.total) && c.progress.total>=0);
    return {ready, next:ready?courses.findIndex(c=>!c.progress.full):-1};
  }
  function newBatch(course, previous) {
    const q=course?.progress;
    if(!course?.url||!q||!Number.isInteger(q.current)||!Number.isInteger(q.total)||q.current<0||q.total<=0)throw Error('当前科目的视频进度不完整，无法建立播放批次。');
    return {courseUrl:course.url,baseline:q.current,total:q.total,goal:Math.max(0,q.total-q.current),attempts:[],round:previous?.courseUrl===course.url?previous.round+1:1};
  }
  function batchDue(batch) { return !!batch && batch.attempts.length>=batch.goal; }
  function nextVideo(rows,batch) {
    if(!batch||batchDue(batch))return null;
    const attempted=new Set(batch.attempts.map(a=>a.id));
    return rows.find(row=>!row.complete&&!attempted.has(row.id))||null;
  }
  async function startVideo(video) {
    try { await video.play(); return; }
    catch (error) {
      if (error.name !== 'NotAllowedError' || video.muted) throw error;
      video.muted = true;
      try { await video.play(); }
      catch (retryError) { video.muted = false; throw retryError; }
    }
  }
  function playbackError(error) {
    if(error.name==='NotAllowedError')return '浏览器仍阻止自动播放，请点击播放器左下角播放按钮。';
    if(error.name==='NotSupportedError')return '视频格式或来源无法播放，请检查播放器和网络。';
    if(error.name==='AbortError')return '播放请求被页面中断，请点击播放器重试。';
    return '播放失败：'+(error.name||'未知错误')+'。请点击播放器重试。';
  }
  const api = {completed, resource, order, trusted, quota, plan, newBatch, batchDue, nextVideo, startVideo, playbackError};
  root.CourseLogic = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
