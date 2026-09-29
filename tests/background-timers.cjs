function backgroundTimers(clock){
 let sequence=0;const pending=new Map();
 return {
  setTimeout(fn,ms){const id=++sequence;pending.set(id,{fn,at:clock.now+ms});return id;},
  clearTimeout(id){pending.delete(id);},
  clearAll(){pending.clear();},
  get size(){return pending.size;},
  async advance(ms){clock.now+=ms;const due=[...pending].filter(([,v])=>v.at<=clock.now);for(const [id,v] of due)if(pending.delete(id))v.fn();await new Promise(resolve=>setImmediate(resolve));}
 };
}
module.exports=backgroundTimers;
