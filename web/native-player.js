// A <video> element (MP4, WebM or HLS) behind the same small interface as
// ProviderPlayer, so the pool can treat every source alike.
import {attachMediaSource} from './stream-loader.js';
export class NativePlayer{
 constructor(source,{now=()=>performance.now()}={}){
  this.destroyed=false;this.kind='native';this.now=now;this.listeners=new Map();this.inAd=false;this.error=null;this.wantPlay=false;this.target=null;this.primed=false;this.lastAdvance=-Infinity;this.lastTime=0;this.audioLocked=false;this.audioWatch=null;
  const v=this.element=document.createElement('video');v.className='layer';v.playsInline=true;v.preload='auto';v.muted=true;v.controls=false;
  v.addEventListener('timeupdate',()=>{
   if(v.seeking)return;
   if(this.target!==null&&Math.abs(v.currentTime-this.target)<1.5)this.target=null;
   if(v.currentTime>this.lastTime+.02){this.lastAdvance=this.now();if(this.target===null)this.primed=true;}
   this.lastTime=v.currentTime;
  });
  v.addEventListener('ended',()=>this.emit('ended'));
  v.addEventListener('error',()=>{this.error={code:'MEDIA_'+(v.error?.code||0),message:'This video source could not be played.'};this.emit('error',this.error);});
  // play() before the source is attached is aborted by the load, so ask again once it is, and whenever the element can play.
  this.attached=false;
  this.ready=Promise.resolve(attachMediaSource(v,source,()=>{this.error={code:'HLS_FATAL',message:'The stream stopped responding.'};this.emit('error',this.error);})).then(controller=>{if(this.destroyed){controller?.destroy?.();return;}this.controller=controller;this.attached=true;if(this.wantPlay)this.play();}).catch(error=>{if(this.destroyed)return;this.error={code:'SOURCE',message:error.message};this.emit('error',this.error);});
  v.addEventListener('canplay',()=>{if(this.wantPlay&&v.paused)v.play().catch(()=>{});});
 }
 on(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name,detail){for(const callback of this.listeners.get(name)||[])callback(detail);}
 get duration(){return this.element.duration;}
 get currentTime(){return this.element.currentTime;}
 get progressing(){return !this.error&&!this.element.paused&&this.now()-this.lastAdvance<1200;}
 near(target,tolerance=2.5){const v=this.element;return this.primed&&!this.error&&this.target===null&&!v.seeking&&v.readyState>=3&&(this.progressing||!this.wantPlay)&&Math.abs(v.currentTime-target)<=tolerance;}
 play(){if(this.destroyed)return;this.wantPlay=true;if(!this.attached)return;this.element.play().catch(error=>{if(error.name==='NotAllowedError'){this.element.muted=true;this.element.play().catch(()=>{});}});}
 pause(){this.wantPlay=false;this.element.pause();}
 seek(time){const v=this.element,t=Math.max(0,Number(time)||0);this.target=Number.isFinite(v.duration)?Math.min(t,Math.max(0,v.duration-.5)):t;this.primed=false;v.currentTime=this.target;}
 // The browser may refuse sound without a gesture and pause the element on
 // unmute; if that happens, go back to muted playback and flag it.
 set muted(value){
  const v=this.element;v.muted=!!value;clearTimeout(this.audioWatch);this.audioWatch=null;
  if(!value&&this.wantPlay){
   const mark=v.currentTime;
   this.audioWatch=setTimeout(()=>{this.audioWatch=null;if(v.muted||this.error)return;if(v.paused||v.currentTime<=mark+.3){this.audioLocked=true;v.muted=true;v.play().catch(()=>{});this.emit('audiolocked');}},1500);
   this.audioWatch.unref?.();
  }
 }
 get muted(){return this.element.muted;}
 destroy(){this.destroyed=true;this.wantPlay=false;clearTimeout(this.audioWatch);this.controller?.destroy?.();const v=this.element;v.pause();v.removeAttribute('src');v.load();v.remove();this.listeners.clear();}
}
