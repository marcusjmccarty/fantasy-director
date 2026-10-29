// Opaque iframes cannot report buffered/decoded readiness. This deck accepts native media only.
export function bufferedAhead(video,at=video.currentTime){
 for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=at+.08&&video.buffered.end(i)>at)return video.buffered.end(i)-at;
 return 0;
}
export function readyToCut(video,target,lead=3){
 const needed=Number.isFinite(video.duration)?Math.min(lead,Math.max(0,video.duration-target-.1)):lead;
 return !video.seeking&&video.readyState>=3&&Math.abs(video.currentTime-target)<1&&bufferedAhead(video,target)>=needed;
}
export class CutGate{
 constructor(){this.generation=0;this.current=null;this.pending=null;}
 request(key){const ticket={key,generation:++this.generation};this.pending=ticket;return ticket;}
 commit(ticket,ready){if(!ready||this.pending!==ticket||ticket.generation!==this.generation)return false;this.current=ticket.key;this.pending=null;return true;}
 cancel(){this.generation++;this.pending=null;}
}
export class MediaDeck{
 constructor(host,{onCommit=()=>{},onStatus=()=>{},onEnd=()=>{}}={}){
  this.host=host;this.onCommit=onCommit;this.onStatus=onStatus;this.onEnd=onEnd;this.slots=new Map();this.gate=new CutGate();this.active=null;this.muted=true;this.running=false;this.rate=1;this.sequence=0;this.cooldowns=new Map();
 }
 ensure(key,url){
  let slot=this.slots.get(key);if(slot&&slot.url===url&&!slot.failed)return slot;
  if(slot)this.remove(key);
  const video=document.createElement('video');video.className='media-layer';video.playsInline=true;video.preload='auto';video.muted=true;video.controls=false;
  video.setAttribute('aria-label',key);this.host.append(video);
  slot={key,url,video,target:0,used:++this.sequence,decoded:false,failed:false,operation:0};this.slots.set(key,slot);
  video.addEventListener('error',()=>{slot.failed=true;if(this.active===key||this.gate.pending?.key===key)this.onStatus('This source could not play. Keeping the current picture.');});
  video.addEventListener('waiting',()=>{if(this.active===key)this.onStatus('The source is catching up. The current picture stays on screen.');});
  video.addEventListener('ended',()=>{if(this.active===key)this.onEnd(key);});
  if(/\.m3u8(?:\?|$)/i.test(url)&&!video.canPlayType('application/vnd.apple.mpegurl')){slot.failed=true;return slot;}
  video.src=url;video.load();this.prune();return slot;
 }
 prune(){
  while(this.slots.size>3){const candidate=[...this.slots.values()].filter(s=>s.key!==this.active&&s.key!==this.gate.pending?.key).sort((a,b)=>a.used-b.used)[0];if(!candidate)break;this.remove(candidate.key);}
 }
 remove(key){const s=this.slots.get(key);if(!s)return;s.operation++;s.video.pause();s.video.removeAttribute('src');s.video.load();s.video.remove();this.slots.delete(key);}
 async align(slot,target,valid=()=>true){
  const v=slot.video,operation=++slot.operation;
  const current=()=>this.slots.get(slot.key)===slot&&operation===slot.operation&&valid();
  const readTarget=()=>{const value=Math.max(0,Number(typeof target==='function'?target():target)||0);return Number.isFinite(v.duration)?Math.min(value,Math.max(0,v.duration-.2)):value;};
  slot.used=++this.sequence;slot.decoded=false;
  const wait=(predicate,timeout)=>this.waitFor(slot,predicate,timeout,current);
  if(v.readyState===0)await wait(()=>v.readyState>0,10000);
  if(!current())throw new Error('Cancelled');
  slot.target=readTarget();if(Math.abs(v.currentTime-slot.target)>.75)v.currentTime=slot.target;
  v.playbackRate=this.rate;if(slot.key!==this.active)v.muted=true;
  try{await v.play();}catch{throw new Error('Playback needs a click. Use Play to try again.');}
  await wait(()=>{
   slot.target=readTarget();
   if(!v.seeking&&Math.abs(v.currentTime-slot.target)>1.25)v.currentTime=slot.target;
   return readyToCut(v,slot.target);
  },12000);
  if(v.requestVideoFrameCallback){
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('No decoded video frame yet.')),3000);
    v.requestVideoFrameCallback(()=>{clearTimeout(timer);if(!current()){reject(new Error('Cancelled'));return;}slot.decoded=true;resolve();});
   });
  }else slot.decoded=v.readyState>=3;
  if(!current())throw new Error('Cancelled');
  slot.target=readTarget();
  if(!this.running)v.pause();
  return slot;
 }
 waitFor(slot,predicate,timeout,current=()=>true){return new Promise((resolve,reject)=>{
  const start=performance.now();const check=()=>{
   if(!current()){reject(new Error('Cancelled'));return;}
   if(this.slots.get(slot.key)!==slot||slot.failed){reject(new Error('Video unavailable. Use a direct MP4/WebM or browser-supported HLS source.'));return;}
   if(predicate()){resolve();return;}
   if(performance.now()-start>timeout){reject(new Error('The next video is still loading. Keeping the current picture; retrying shortly.'));return;}
   setTimeout(check,80);
  };check();
 });}
 async request(key,url,target){
  const value=Number(typeof target==='function'?target():target)||0;
  const active=this.slots.get(key);
  if(this.active===key&&active?.url===url&&!active.failed&&!this.gate.pending&&Math.abs(active.video.currentTime-value)<1)return true;
  if(this.gate.pending?.key===key||this.cooldowns.get(key+'|'+url)>performance.now())return false;
  const ticket=this.gate.request(key),slot=this.ensure(key,url);this.onStatus(this.active?'Preparing the next source…':'Preparing video…');
  try{
   await this.align(slot,target,()=>this.gate.pending===ticket);
   if(!this.gate.commit(ticket,slot.decoded&&readyToCut(slot.video,slot.target))){
    if(this.gate.pending===ticket){this.gate.cancel();this.cooldowns.set(key+'|'+url,performance.now()+1000);}
    return false;
   }
   for(const s of this.slots.values()){const visible=s.key===key;s.video.classList.toggle('active',visible);s.video.controls=visible;s.video.muted=!visible||this.muted;if(!visible)s.video.pause();}
   this.active=key;slot.video.muted=this.muted;if(this.running)slot.video.play().catch(()=>{});this.onStatus('Ready');this.onCommit(key);return true;
  }catch(error){if(this.gate.pending===ticket){this.gate.cancel();this.cooldowns.set(key+'|'+url,performance.now()+15000);this.onStatus(error.message);}return false;}
 }
 warm(key,url,target){
  if(key===this.active||key===this.gate.pending?.key||this.cooldowns.get(key+'|'+url)>performance.now())return;
  const slot=this.ensure(key,url);if(slot.warming)return;slot.warming=true;
  const task=this.align(slot,target,()=>key!==this.gate.pending?.key);const operation=slot.operation;
  task.catch(error=>{if(error.message!=='Cancelled')this.cooldowns.set(key+'|'+url,performance.now()+15000);}).finally(()=>{slot.warming=false;if(slot.operation===operation&&slot.key!==this.active&&slot.key!==this.gate.pending?.key)slot.video.pause();});
 }
 sync(target){const slot=this.slots.get(this.active);if(!slot||this.gate.pending||!this.running)return;const v=slot.video;
  if(Math.abs(v.currentTime-target)>1.5){this.request(slot.key,slot.url,target);return;}
  if(v.paused)v.play().catch(()=>{});
 }
 cancelPending(){this.gate.cancel();for(const s of this.slots.values())s.operation++;}
 retry(){this.cooldowns.clear();}
 setRunning(value){this.running=value;const v=this.slots.get(this.active)?.video;if(v){if(value)v.play().catch(()=>{});else v.pause();}}
 setMuted(value){this.muted=value;for(const s of this.slots.values())s.video.muted=s.key!==this.active||value;}
 setRate(rate){this.rate=Math.min(4,Math.max(.5,rate));for(const s of this.slots.values())s.video.playbackRate=this.rate;}
 suspend(){this.cancelPending();for(const s of this.slots.values())s.video.pause();}
 destroy(){this.suspend();for(const key of [...this.slots.keys()])this.remove(key);this.active=null;this.cooldowns.clear();}
 get currentTime(){return this.slots.get(this.active)?.video.currentTime??null;}
}
