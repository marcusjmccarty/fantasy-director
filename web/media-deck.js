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
const failure=(code,message)=>Object.assign(new Error(message),{code});
const mediaFailure=video=>{const code=video.error?.code;return failure('MEDIA_'+(code||'SOURCE'),code===2?'The replay connection failed.':code===3?'The browser could not decode this recording.':code===4?'This source is unavailable or unsupported in this browser.':'The provider could not play this source.');};
const frameCount=video=>video.getVideoPlaybackQuality?.().totalVideoFrames??video.webkitDecodedFrameCount??0;
const targetValue=(slot)=>{const n=Math.max(0,Number(typeof slot.target==='function'?slot.target():slot.target)||0);return Number.isFinite(slot.video.duration)?Math.min(n,Math.max(0,slot.video.duration-.2)):n;};
export class MediaDeck{
 constructor(host,{onCommit=()=>{},onStatus=()=>{},onEnd=()=>{},onStall=()=>{},attachSource=attachMediaSource,lead=8,timeouts={}}={}){
  Object.assign(this,{host,onCommit,onStatus,onEnd,onStall,attachSource,lead});this.slots=new Map();this.gate=new CutGate();this.active=null;this.activeSlot=null;this.muted=true;this.running=false;this.rate=1;this.sequence=0;this.cooldowns=new Map();this.history=[];this.stalls=0;this.controls=false;this.failures=[];this.timeouts={attach:8000,metadata:8000,buffer:12000,play:5000,frame:1500,total:25000,poll:50,frameFallback:250,...timeouts};
 }
 ensure(key,url,{fresh=false,type=''}={}){
  let slot=this.slots.get(key);if(slot&&slot.url===url&&!slot.failed&&!fresh){slot.used=++this.sequence;return slot;}
  if(slot&&slot!==this.activeSlot)this.dispose(slot);
  const video=document.createElement('video');video.className='media-layer';video.playsInline=true;video.preload='auto';video.muted=true;video.controls=false;video.setAttribute('aria-label',key);this.host.append(video);
  slot={key,url,type,video,target:0,used:++this.sequence,operation:0,decoded:false,failed:false,prepared:false,preparing:null,frameAt:0,controller:null,phase:'source',failure:null,deadline:Infinity,frameEvidence:null};this.slots.set(key,slot);
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
 requiredLead(){return (this.activeSlot?this.lead:Math.min(2,this.lead))*Math.max(1,this.rate);}
 phase(slot,phase){
  slot.phase=phase;
  if(this.gate.pending?.key===slot.key){const messages={source:'Connecting to the recording…',metadata:'Loading video metadata…',buffer:'Buffering the next picture…',play:'Starting video playback…',frame:'Checking the first picture…'};this.onStatus(messages[phase]||phase);}
 }
 waitFor(slot,predicate,timeout,current){return new Promise((resolve,reject)=>{
  const start=performance.now();const check=()=>{
   if(!current()){reject(failure('CANCELLED','Cancelled'));return;}
   if(slot.failed||slot.video.error){reject(mediaFailure(slot.video));return;}
   if(performance.now()>=slot.deadline||performance.now()-start>=timeout){reject(failure('TIMEOUT_'+slot.phase.toUpperCase(),'Timed out while '+({source:'connecting to the recording',metadata:'loading video metadata',buffer:'buffering the recording',play:'starting video playback',frame:'waiting for a picture'}[slot.phase]||'preparing video')+'.'));return;}
   try{if(predicate()){resolve();return;}}catch(error){reject(error);return;}
   setTimeout(check,this.timeouts.poll);
  };check();
 });}
 bounded(slot,promise,timeout,current){return new Promise((resolve,reject)=>{
  let finished=false,timer;const start=performance.now();
  const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const check=()=>{
   if(!current())return finish(failure('CANCELLED','Cancelled'));
   if(slot.failed||slot.video.error)return finish(mediaFailure(slot.video));
   if(performance.now()>=slot.deadline||performance.now()-start>=timeout)return finish(failure('TIMEOUT_'+slot.phase.toUpperCase(),'Timed out while '+({source:'connecting to the recording',play:'starting video playback',frame:'waiting for a picture'}[slot.phase]||'preparing video')+'.'));
   timer=setTimeout(check,this.timeouts.poll);
  };
  // The browser may keep play() pending. Its promise always has a deadline and
  // rejection handler; a late resolution cannot commit a cancelled request.
  Promise.resolve(promise).then(value=>{if(!current())finish(failure('CANCELLED','Cancelled'));else if(slot.failed||slot.video.error)finish(mediaFailure(slot.video));else finish(null,value);},error=>finish(error));check();
 });}
 async decode(slot,current){
  const v=slot.video,started=performance.now(),initialTime=v.currentTime,initialFrames=frameCount(v);let handle,fallbackTimer;
  slot.decoded=false;slot.frameEvidence=null;
  const frame=new Promise(resolve=>{
   const accept=(evidence,time)=>{if(!current())return;slot.frameAt=time;slot.decoded=true;slot.frameEvidence=evidence;resolve();};
   if(v.requestVideoFrameCallback)handle=v.requestVideoFrameCallback((_,metadata)=>accept('frame-callback',metadata?.mediaTime??v.currentTime));
   const fallback=()=>{
    if(!current()||slot.decoded)return;
    // Prepared video may not receive compositor callbacks. Require genuine frame
    // or playhead progress with usable video dimensions before accepting it.
    if(performance.now()-started>=Math.min(this.timeouts.frameFallback,350/this.rate)&&!v.seeking&&v.readyState>=3&&v.videoWidth>0&&v.videoHeight>0){
     if(frameCount(v)>initialFrames)return accept('decoded-frame-count',v.currentTime);
     if(!v.paused&&v.currentTime-initialTime>=.04)return accept('playback-progress',v.currentTime);
    }
    fallbackTimer=setTimeout(fallback,this.timeouts.poll);
   };fallback();
  });
  try{await this.bounded(slot,frame,this.timeouts.frame,current);}finally{clearTimeout(fallbackTimer);if(handle!==undefined)v.cancelVideoFrameCallback?.(handle);}
 }
 async prepare(slot,target){
  slot.target=target;slot.used=++this.sequence;
  if(slot.preparing)return slot.preparing;
  if(slot.prepared&&!slot.failed&&readyToCut(slot.video,targetValue(slot),this.requiredLead()))return slot;
  const operation=++slot.operation,current=()=>this.slots.get(slot.key)===slot&&slot.operation===operation;
  const task=(async()=>{
   slot.deadline=performance.now()+this.timeouts.total;slot.failure=null;
   this.phase(slot,'source');await this.bounded(slot,slot.attached,this.timeouts.attach,current);
   this.phase(slot,'metadata');await this.waitFor(slot,()=>slot.video.readyState>0,this.timeouts.metadata,current);
   const v=slot.video;v.playbackRate=this.rate;if(slot!==this.activeSlot)v.muted=true;
   for(let attempt=0;attempt<3;attempt++){
    v.pause();this.phase(slot,'buffer');const loadingAt=targetValue(slot);
    // Keep the load target fixed until its buffer arrives. Re-seeking while the
    // shared clock moves can abort range requests before they deliver a picture.
    if(Math.abs(v.currentTime-loadingAt)>.6){slot.decoded=false;v.currentTime=loadingAt;}
    await this.waitFor(slot,()=>readyToCut(v,loadingAt,this.requiredLead()),this.timeouts.buffer,current);
    if(Math.abs(v.currentTime-targetValue(slot))>.6)continue;
    this.phase(slot,'play');
    try{await this.bounded(slot,v.play(),this.timeouts.play,current);}catch(error){if(error.name==='NotAllowedError')throw failure('AUTOPLAY','The browser blocked playback. Press Retry video to start it.');throw error;}
    this.phase(slot,'frame');await this.decode(slot,current);
    if(!current())throw failure('CANCELLED','Cancelled');
    if(readyToCut(v,targetValue(slot),this.requiredLead())){slot.prepared=true;slot.phase='ready';break;}
   }
   if(!slot.prepared)throw failure('TARGET_MOVED','The replay position changed before the picture was ready. Retry video.');
   if(!this.running)v.pause();return slot;
  })();slot.preparing=task;
  try{return await task;}finally{if(slot.preparing===task)slot.preparing=null;}
 }
 recordFailure(slot,error){
  const cancelled=error.code==='CANCELLED'||error.message==='Cancelled';
  if(cancelled||slot.phase==='failed'&&slot.failure)return;
  const record={id:slot.key,code:error.code||error.name||'PLAYBACK',phase:slot.phase,readyState:slot.video.readyState,networkState:slot.video.networkState??null,mediaError:slot.video.error?.code??null,bufferSeconds:Math.round(bufferedAhead(slot.video)*10)/10};
  slot.failure=record;slot.phase='failed';slot.prepared=false;slot.operation++;slot.video.pause();
  this.failures.push(record);this.failures=this.failures.slice(-20);
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
   if(this.running&&slot.video.paused){this.phase(slot,'play');await this.bounded(slot,slot.video.play(),this.timeouts.play,()=>this.gate.pending===ticket&&this.slots.get(key)===slot);}
   if(!this.gate.commit(ticket,slot.decoded&&readyToCut(slot.video,targetValue(slot),this.requiredLead()))){
    if(this.gate.pending===ticket)this.gate.cancel();return false;
   }
   const previous=this.activeSlot;
   if(previous&&previous!==slot){previous.video.muted=true;previous.video.pause();previous.video.classList.toggle('active',false);previous.video.controls=false;}
   slot.video.classList.toggle('active',true);slot.video.controls=this.controls;slot.video.muted=this.muted;this.active=key;this.activeSlot=slot;
   if(this.running)slot.video.play().catch(()=>{});else slot.video.pause();
   if(previous&&this.slots.get(previous.key)!==previous)this.dispose(previous);
   this.history.push({from:previous?.key||null,to:key,waitMs:Math.round(performance.now()-started),bufferSeconds:Math.round(bufferedAhead(slot.video)*10)/10,mediaTime:Math.round(slot.video.currentTime*10)/10,decoded:true,frameEvidence:slot.frameEvidence});this.history=this.history.slice(-50);
   this.onStatus('Playing · next sources prepare in the background');this.onCommit(key);this.prune();return true;
  }catch(error){if(this.gate.pending===ticket){this.gate.cancel();this.recordFailure(slot,error);this.cooldowns.set(key+'|'+url,performance.now()+15000);this.onStatus(error.message);}return false;}
 }
 warm(key,url,target,{type='',hold=false}={}){
  if(key===this.active||this.cooldowns.get(key+'|'+url)>performance.now())return Promise.resolve(false);
  const slot=this.ensure(key,url,{type});
  return this.prepare(slot,target).then(()=>{if(hold&&slot!==this.activeSlot)slot.video.pause();return true;}).catch(error=>{if(error.message!=='Cancelled'){this.recordFailure(slot,error);this.cooldowns.set(key+'|'+url,performance.now()+15000);}return false;});
 }
 sync(target){
  if(!this.running)return;const slot=this.activeSlot;if(!slot||this.gate.pending)return;
  if(Math.abs(slot.video.currentTime-target)>1.5){this.request(slot.key,slot.url,target,{force:true,type:slot.type});return;}
  if(slot.video.paused)slot.video.play().catch(()=>{});
 }
 ready(key,target){const slot=this.slots.get(key);return !!slot?.prepared&&!slot.failed&&readyToCut(slot.video,target??targetValue(slot),this.requiredLead());}
 snapshot(){return {active:this.active,pending:this.gate.pending?.key||null,stalls:this.stalls,cuts:this.history.slice(),failures:this.failures.slice(),players:[...this.slots.values()].map(s=>({id:s.key,ready:this.ready(s.key),bufferSeconds:Math.round(bufferedAhead(s.video)*10)/10,mediaTime:Math.round(s.video.currentTime*10)/10,failed:s.failed,phase:s.phase,readyState:s.video.readyState,networkState:s.video.networkState??null,mediaError:s.video.error?.code??null,failure:s.failure,active:s===this.activeSlot}))};}
 cancelPending(){this.gate.cancel();for(const slot of this.slots.values()){slot.operation++;slot.preparing=null;if(slot!==this.activeSlot){slot.prepared=false;slot.video.pause();slot.phase='cancelled';}}}
 retry(){this.cooldowns.clear();}
 setControls(value){this.controls=value;if(this.activeSlot)this.activeSlot.video.controls=value;}
 setRunning(value){this.running=value;for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean))){if(value&&slot.prepared)slot.video.play().catch(()=>{});else if(!value)slot.video.pause();}}
 setMuted(value){this.muted=value;for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean)))slot.video.muted=slot!==this.activeSlot||value;}
 setRate(rate){this.rate=Math.min(4,Math.max(.5,rate));for(const slot of this.slots.values())slot.video.playbackRate=this.rate;}
 suspend(){this.cancelPending();for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean)))slot.video.pause();}
 destroy(){this.suspend();for(const slot of new Set([...this.slots.values(),this.activeSlot].filter(Boolean)))this.dispose(slot);this.active=null;this.activeSlot=null;this.cooldowns.clear();}
 get currentTime(){return this.activeSlot?.video.currentTime??null;}
}
