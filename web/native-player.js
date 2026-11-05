// A <video> element (MP4, WebM or HLS) behind the same small interface as
// ProviderPlayer, so the pool can treat every source alike.
import {attachMediaSource} from './stream-loader.js';
export class NativePlayer{
 constructor(source,{now=()=>performance.now()}={}){
  this.destroyed=false;this.kind='native';this.now=now;this.listeners=new Map();this.inAd=false;this.error=null;this.wantPlay=false;this.target=null;this.primed=false;this.lastAdvance=-Infinity;this.lastTime=0;this.audioLocked=false;this.audioWatch=null;this.playGeneration=0;this.audioGeneration=0;
  this.source=source;this.live=source.live===true;this.visible=false;this.attachGeneration=0;this.recoveryAttempts=0;this.lastReconnectAt=-Infinity;this.recoveryMessage='';this.resetRecovery();
  const v=this.element=document.createElement('video');v.className='layer';v.playsInline=true;v.preload='auto';v.muted=true;v.controls=false;
  v.addEventListener('timeupdate',()=>{
   if(v.seeking)return;
   // The landing frame can differ slightly from the requested position. It
   // establishes a baseline; only later advancing footage establishes readiness.
   if(this.target!==null){if(Math.abs(v.currentTime-this.target)<1.5)this.target=null;this.lastTime=v.currentTime;return;}
   if(v.currentTime>this.lastTime+.02){this.lastAdvance=this.now();if(this.target===null)this.primed=true;}
   this.lastTime=v.currentTime;
  });
  v.addEventListener('ended',()=>{if(this.destroyed)return;if(this.live)this.fault({code:'LIVE_ENDED',message:'The live source stopped.'});else this.emit('ended');});
  v.addEventListener('error',()=>{if(!this.destroyed&&v.error)this.fault({code:'MEDIA_'+v.error.code,message:'This video source could not be played.'});});
  // play() before the source is attached is aborted by the load, so ask again once it is, and whenever the element can play.
  this.attach();
  v.addEventListener('canplay',()=>{if(this.wantPlay&&v.paused)this.play();});
 }
 retryDelay(){return [10000,15000,30000,60000][Math.min(this.recoveryAttempts,3)];}
 fault(error){if(this.destroyed)return;this.error=error;if(this.live){this.stalledSince??=this.now();this.nextRetryAt??=Math.max(this.now()+3000,this.lastReconnectAt+this.retryDelay());this.recoveryMessage='Stream interrupted · reconnecting…';}this.emit('error',error);}
 attach(){
  const generation=++this.attachGeneration;this.attachment?.abort();this.controller?.destroy?.();this.controller=null;
  const attachment=this.attachment=new AbortController();this.attached=false;
  this.ready=Promise.resolve().then(()=>{
   if(this.destroyed||attachment.signal.aborted)return null;
   return attachMediaSource(this.element,this.source,()=>{if(generation===this.attachGeneration&&!this.destroyed)this.fault({code:'HLS_FATAL',message:'The stream stopped responding.'});},{signal:attachment.signal});
  }).then(controller=>{
   if(this.destroyed||generation!==this.attachGeneration){controller?.destroy?.();return;}
   this.controller=controller;this.attached=true;if(this.wantPlay)this.play();
  }).catch(error=>{if(!this.destroyed&&generation===this.attachGeneration)this.fault({code:'SOURCE',message:error.message});});
 }
 setVisible(value){this.visible=!!value;}
 resetRecovery(){this.stalledSince=null;this.nextRetryAt=null;this.healthySince=null;this.softTried=false;this.suspendedAt=null;this.offline=false;}
 get reconnecting(){return this.live&&!!this.recoveryMessage&&!this.progressing;}
 // Direct live sources expose progress; healthy video never needs a periodic reload.
 // The app calls this only for the visible or deliberately loading game.
 checkHealth({active=false,online=true,foreground=true}={}){
  if(!this.live||this.destroyed||!active||!this.wantPlay)return;
  const now=this.now();
  if(!online||!foreground){this.suspendedAt??=now;if(!online)this.offline=true;return;}
  if(this.suspendedAt!==null){const elapsed=now-this.suspendedAt;for(const key of ['stalledSince','nextRetryAt','healthySince'])if(this[key]!==null)this[key]+=elapsed;this.suspendedAt=null;}
  if(this.offline){if(now-this.lastReconnectAt<10000)return;this.offline=false;this.reconnect('Connection restored · reconnecting stream…',{reason:'network'});return;}
  if(this.progressing){this.stalledSince=null;this.nextRetryAt=null;this.softTried=false;this.recoveryMessage='';this.healthySince??=now;if(now-this.healthySince>=15000)this.recoveryAttempts=0;return;}
  this.healthySince=null;this.stalledSince??=now;this.nextRetryAt??=Math.max(this.stalledSince+(this.error?3000:10000),this.lastReconnectAt+this.retryDelay());
  if(!this.error&&!this.softTried&&now-this.stalledSince>=3000){this.softTried=true;this.recoveryMessage='Resuming stream…';this.kick();return;}
  if(now>=this.nextRetryAt)this.reconnect('Reconnecting stream…',{reason:this.error?'error':'stall',failover:true});
 }
 kick(){
  if(this.destroyed||!this.wantPlay)return;
  if(this.live){
   this.controller?.startLoad?.(-1);
   // Only a live HLS timeline supplies an edge; never seek a finite replay here.
   let edge=this.controller?.liveSyncPosition;
   const v=this.element,isHLS=/mpegurl/i.test(this.source.type||'')||/\.m3u8(?:[?#]|$)/i.test(this.source.url);
   if(!Number.isFinite(edge)&&isHLS&&!Number.isFinite(v.duration)&&v.seekable?.length)edge=Math.max(v.seekable.start(v.seekable.length-1),v.seekable.end(v.seekable.length-1)-3);
   if(Number.isFinite(edge)&&edge>=0&&Math.abs(edge-v.currentTime)>1){try{v.currentTime=edge;this.lastTime=edge;this.lastAdvance=-Infinity;}catch{}}
  }
  this.play();
 }
 reconnect(message,detail={}){
  if(this.destroyed||!this.wantPlay||!this.live)return false;
  const now=this.now();this.recoveryMessage=message;this.lastReconnectAt=now;this.recoveryAttempts++;
  this.emit('reconnect',{...detail,attempt:this.recoveryAttempts});
  if(this.destroyed||!this.wantPlay)return false;
  this.stalledSince=now;this.softTried=false;this.healthySince=null;this.nextRetryAt=now+this.retryDelay();
  this.error=null;this.target=null;this.primed=false;this.lastAdvance=-Infinity;this.lastTime=0;
  this.playGeneration++;this.audioGeneration++;clearTimeout(this.audioWatch);this.audioWatch=null;
  this.element.pause();this.element.removeAttribute('src');this.element.load();this.attach();return true;
 }
 reload(){if(!this.live||!this.visible||!this.wantPlay||this.destroyed)return false;this.resetRecovery();this.recoveryAttempts=0;return this.reconnect('Reloading stream…',{reason:'manual'});}
 on(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name,detail){for(const callback of this.listeners.get(name)||[])callback(detail);}
 get duration(){return this.element.duration;}
 get currentTime(){return this.element.currentTime;}
 get progressing(){return !this.error&&!this.element.paused&&this.now()-this.lastAdvance<1200;}
 near(target,tolerance=2.5){const v=this.element;return this.primed&&!this.error&&this.target===null&&!v.seeking&&v.readyState>=3&&(this.progressing||!this.wantPlay)&&Math.abs(v.currentTime-target)<=tolerance;}
 play(){if(this.destroyed)return;this.wantPlay=true;const generation=++this.playGeneration;if(!this.attached)return;this.element.play().catch(error=>{if(this.destroyed||!this.wantPlay||generation!==this.playGeneration)return;if(error.name==='NotAllowedError'){this.audioLocked=true;this.element.muted=true;this.emit('audiolocked');this.element.play().catch(()=>{});}});}
 pause(){this.wantPlay=false;this.playGeneration++;this.audioGeneration++;clearTimeout(this.audioWatch);this.audioWatch=null;this.resetRecovery();this.recoveryMessage='';this.element.pause();}
 seek(time){const v=this.element,t=Math.max(0,Number(time)||0);this.target=Number.isFinite(v.duration)?Math.min(t,Math.max(0,v.duration-.5)):t;this.primed=false;this.lastAdvance=-Infinity;this.lastTime=this.target;v.currentTime=this.target;}
 // The browser may refuse sound without a gesture and pause the element on
 // unmute; if that happens, go back to muted playback and flag it.
 set muted(value){
  const v=this.element,generation=++this.audioGeneration;v.muted=!!value;clearTimeout(this.audioWatch);this.audioWatch=null;
  // A source still loading has no footage to judge: a real refusal arrives through play() once it attaches or can play.
  if(!value&&this.wantPlay&&this.attached&&!(v.readyState<3)){
   const mark=v.currentTime;
   this.audioWatch=setTimeout(()=>{if(generation!==this.audioGeneration)return;this.audioWatch=null;if(this.destroyed||!this.wantPlay||v.muted||this.error)return;if(v.paused||v.currentTime<=mark+.3){this.audioLocked=true;v.muted=true;this.play();this.emit('audiolocked');}else this.audioLocked=false;},1500);
   this.audioWatch.unref?.();
  }
 }
 get muted(){return this.element.muted;}
 destroy(){this.destroyed=true;this.wantPlay=false;this.attachGeneration++;this.attachment?.abort();this.playGeneration++;this.audioGeneration++;clearTimeout(this.audioWatch);this.audioWatch=null;this.controller?.destroy?.();const v=this.element;v.pause();v.removeAttribute('src');v.load();v.remove();this.listeners.clear();}
}
