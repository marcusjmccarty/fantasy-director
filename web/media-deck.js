import {attachMediaSource} from './stream-loader.js';
export function bufferedAhead(video,at=video.currentTime){
 for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=at+.08&&video.buffered.end(i)>at)return video.buffered.end(i)-at;
 return 0;
}
export function readyToCut(video,target,lead=8){
 const needed=Number.isFinite(video.duration)?Math.min(lead,Math.max(0,video.duration-target-.1)):lead;
 return !video.seeking&&video.readyState>=3&&Math.abs(video.currentTime-target)<.8&&bufferedAhead(video,target)>=needed;
}
export class CutGate{
 constructor(){this.generation=0;this.current=null;this.pending=null;}
 request(key){const ticket={key,generation:++this.generation};this.pending=ticket;return ticket;}
 commit(ticket,ready){if(!ready||this.pending!==ticket||ticket.generation!==this.generation)return false;this.current=ticket.key;this.pending=null;return true;}
 cancel(){this.generation++;this.pending=null;}
}
const targetValue=(slot)=>{const n=Math.max(0,Number(typeof slot.target==='function'?slot.target():slot.target)||0);return Number.isFinite(slot.video.duration)?Math.min(n,Math.max(0,slot.video.duration-.2)):n;};
export class MediaDeck{
 constructor(host,{onCommit=()=>{},onStatus=()=>{},onEnd=()=>{},onStall=()=>{},attachSource=attachMediaSource,lead=8}={}){
  Object.assign(this,{host,onCommit,onStatus,onEnd,onStall,attachSource,lead});this.slots=new Map();this.gate=new CutGate();this.active=null;this.activeSlot=null;this.muted=true;this.running=false;this.rate=1;this.sequence=0;this.cooldowns=new Map();this.history=[];this.stalls=0;this.controls=false;
 }
 ensure(key,url,{fresh=false,type=''}={}){
  let slot=this.slots.get(key);if(slot&&slot.url===url&&!slot.failed&&!fresh){slot.used=++this.sequence;return slot;}
  if(slot&&slot!==this.activeSlot)this.dispose(slot);
  const video=document.createElement('video');video.className='media-layer';video.playsInline=true;video.preload='auto';video.muted=true;video.controls=false;video.setAttribute('aria-label',key);this.host.append(video);
  slot={key,url,type,video,target:0,used:++this.sequence,operation:0,decoded:false,failed:false,prepared:false,preparing:null,frameAt:0,controller:null};this.slots.set(key,slot);
  video.addEventListener('error',()=>{slot.failed=true;if(slot===this.activeSlot){this.onStatus('The source stopped. Looking for another ready game.');if(this.running)this.onStall(key);}});
  video.addEventListener('waiting',()=>{if(slot===this.activeSlot&&this.running){this.stalls++;this.onStall(key);}});
  video.addEventListener('ended',()=>{if(slot===this.activeSlot)this.onEnd(key);});
  slot.attached=Promise.resolve(this.attachSource(video,{url,type},()=>{slot.failed=true;})).then(controller=>{if(this.slots.get(key)!==slot){controller?.destroy?.();return;}slot.controller=controller;}).catch(()=>{slot.failed=true;});
  this.prune();return slot;
 }
 dispose(slot){slot.operation++;slot.controller?.destroy?.();slot.video.pause();slot.video.removeAttribute('src');slot.video.load();slot.video.remove();if(this.slots.get(slot.key)===slot)this.slots.delete(slot.key);}
 remove(key){const slot=this.slots.get(key);if(slot&&slot!==this.activeSlot)this.dispose(slot);}
 prune(){
  // During a same-game seek, the previous visible element is retained until the replacement commits.
  while(this.slots.size+(this.activeSlot&&!new Set(this.slots.values()).has(this.activeSlot)?1:0)>3){
   const candidate=[...this.slots.values()].filter(s=>s!==this.activeSlot&&s.key!==this.gate.pending?.key).sort((a,b)=>a.used-b.used)[0];if(!candidate)break;this.dispose(candidate);
  }
 }
 waitFor(slot,predicate,timeout,current){return new Promise((resolve,reject)=>{
  const start=performance.now();const check=()=>{
   if(!current()){reject(new Error('Cancelled'));return;}
   if(slot.failed){reject(new Error('The provider could not play this source.'));return;}
   if(predicate()){resolve();return;}
   if(performance.now()-start>timeout){reject(new Error('The next source is still loading. Current picture retained.'));return;}
   setTimeout(check,50);
  };check();
 });}
 async decode(slot,current){
  const v=slot.video;if(!v.requestVideoFrameCallback){slot.decoded=v.readyState>=3;return;}
  await new Promise((resolve,reject)=>{
   let handle;const timer=setTimeout(()=>{v.cancelVideoFrameCallback?.(handle);reject(new Error('The next frame is not decoded yet.'));},3000);
   handle=v.requestVideoFrameCallback((_,metadata)=>{clearTimeout(timer);if(!current()){reject(new Error('Cancelled'));return;}slot.frameAt=metadata?.mediaTime??v.currentTime;slot.decoded=true;resolve();});
  });
 }
 async prepare(slot,target){
  slot.target=target;slot.used=++this.sequence;
  if(slot.preparing)return slot.preparing;
  const operation=++slot.operation,current=()=>this.slots.get(slot.key)===slot&&slot.operation===operation;
  const task=(async()=>{
   await slot.attached;
   await this.waitFor(slot,()=>slot.video.readyState>0,12000,current);
   const v=slot.video,t=targetValue(slot);if(Math.abs(v.currentTime-t)>.6){slot.decoded=false;v.currentTime=t;}
   v.playbackRate=this.rate;if(slot!==this.activeSlot)v.muted=true;
   try{await v.play();}catch{throw new Error('Press Play to allow video playback.');}
   await this.waitFor(slot,()=>{
    const target=targetValue(slot);
    if(!v.seeking&&Math.abs(v.currentTime-target)>1.1){slot.decoded=false;v.currentTime=target;}
    return readyToCut(v,target,this.lead*Math.max(1,this.rate));
   },18000,current);
   for(let frameAttempt=0;frameAttempt<3;frameAttempt++){await this.decode(slot,current);if(readyToCut(v,targetValue(slot),this.lead*Math.max(1,this.rate)))break;v.currentTime=targetValue(slot);await this.waitFor(slot,()=>readyToCut(v,targetValue(slot),this.lead*Math.max(1,this.rate)),5000,current);}
   if(!current())throw new Error('Cancelled');slot.prepared=true;
   if(!this.running)v.pause();return slot;
  })();slot.preparing=task;
  try{return await task;}finally{if(slot.preparing===task)slot.preparing=null;}
 }
 async request(key,url,target,{force=false,type=''}={}){
  const current=this.slots.get(key),value=Number(typeof target==='function'?target():target)||0;
  if(!force&&this.activeSlot===current&&current?.url===url&&!current.failed&&!this.gate.pending&&Math.abs(current.video.currentTime-value)<.8)return true;
  if(!force&&this.gate.pending?.key===key)return false;
  if(this.cooldowns.get(key+'|'+url)>performance.now())return false;
  const ticket=this.gate.request(key),started=performance.now();
  const fresh=current===this.activeSlot&&(force||Math.abs(current.video.currentTime-value)>=.8);
  const slot=this.ensure(key,url,{fresh,type});this.onStatus(this.activeSlot?'Preparing the next picture…':'Preparing the replay…');
  try{
   await this.prepare(slot,target);
   if(this.gate.pending!==ticket)return false;
   if(this.running)await slot.video.play();
   if(!this.gate.commit(ticket,slot.decoded&&readyToCut(slot.video,targetValue(slot),this.lead*Math.max(1,this.rate)))){
    if(this.gate.pending===ticket)this.gate.cancel();return false;
   }
   const previous=this.activeSlot;
   if(previous&&previous!==slot){previous.video.muted=true;previous.video.pause();previous.video.classList.toggle('active',false);previous.video.controls=false;}
   slot.video.classList.toggle('active',true);slot.video.controls=this.controls;slot.video.muted=this.muted;this.active=key;this.activeSlot=slot;
   if(this.running)slot.video.play().catch(()=>{});else slot.video.pause();
   if(previous&&this.slots.get(previous.key)!==previous)this.dispose(previous);
   this.history.push({from:previous?.key||null,to:key,waitMs:Math.round(performance.now()-started),bufferSeconds:Math.round(bufferedAhead(slot.video)*10)/10,mediaTime:Math.round(slot.video.currentTime*10)/10,decoded:true});this.history=this.history.slice(-50);
   this.onStatus('Playing · next sources prepare in the background');this.onCommit(key);this.prune();return true;
  }catch(error){if(this.gate.pending===ticket){this.gate.cancel();this.cooldowns.set(key+'|'+url,performance.now()+15000);this.onStatus(error.message);}return false;}
 }
 warm(key,url,target,{type='',hold=false}={}){
  if(key===this.active||this.cooldowns.get(key+'|'+url)>performance.now())return Promise.resolve(false);
  const slot=this.ensure(key,url,{type});
  return this.prepare(slot,target).then(()=>{if(hold&&slot!==this.activeSlot)slot.video.pause();return true;}).catch(error=>{if(error.message!=='Cancelled')this.cooldowns.set(key+'|'+url,performance.now()+15000);return false;});
 }
 sync(target){
  if(!this.running)return;const slot=this.activeSlot;if(!slot||this.gate.pending)return;
  if(Math.abs(slot.video.currentTime-target)>1.5){this.request(slot.key,slot.url,target,{force:true,type:slot.type});return;}
  if(slot.video.paused)slot.video.play().catch(()=>{});
 }
 ready(key,target){const slot=this.slots.get(key);return !!slot?.prepared&&!slot.failed&&readyToCut(slot.video,target??targetValue(slot),this.lead*Math.max(1,this.rate));}
 snapshot(){return {active:this.active,pending:this.gate.pending?.key||null,stalls:this.stalls,cuts:this.history.slice(),players:[...this.slots.values()].map(s=>({id:s.key,ready:this.ready(s.key),bufferSeconds:Math.round(bufferedAhead(s.video)*10)/10,mediaTime:Math.round(s.video.currentTime*10)/10,failed:s.failed,active:s===this.activeSlot}))};}
 cancelPending(){this.gate.cancel();for(const slot of this.slots.values()){slot.operation++;slot.preparing=null;slot.prepared=false;}}
 retry(){this.cooldowns.clear();}
 setControls(value){this.controls=value;if(this.activeSlot)this.activeSlot.video.controls=value;}
 setRunning(value){this.running=value;for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean))){if(value&&slot.prepared)slot.video.play().catch(()=>{});else if(!value)slot.video.pause();}}
 setMuted(value){this.muted=value;for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean)))slot.video.muted=slot!==this.activeSlot||value;}
 setRate(rate){this.rate=Math.min(4,Math.max(.5,rate));for(const slot of this.slots.values())slot.video.playbackRate=this.rate;}
 suspend(){this.cancelPending();for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean)))slot.video.pause();}
 destroy(){this.suspend();for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean)))this.dispose(slot);this.active=null;this.activeSlot=null;this.cooldowns.clear();}
 get currentTime(){return this.activeSlot?.video.currentTime??null;}
}
