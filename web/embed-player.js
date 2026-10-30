// Any web page the viewer points a game at (a stream site, a team's own
// player) shown in an iframe. Nothing inside it can be observed or driven, and
// it cannot be muted, so the page is loaded only while it is on screen: a
// hidden one would play its own sound over the picture. Hidden, it counts as
// ready (there is nothing to warm); shown, it is ready once it has loaded.
export class EmbedPlayer{
 constructor(url,{now=()=>performance.now()}={}){
  this.kind='embed';this.url=url;this.now=now;this.listeners=new Map();this.inAd=false;this.error=null;this.wantPlay=false;this.target=null;
  this.primed=true;this.advances=2;this.loadedAt=null;this.audioLocked=false;this.isMuted=true;this.duration=NaN;this.visible=false;
  const f=this.element=document.createElement('iframe');f.className='layer';f.title='Stream';
  f.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';f.referrerPolicy='no-referrer';
  f.addEventListener('load',()=>{if(this.visible)this.loadedAt=this.now();});
 }
 on(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name,detail){for(const callback of this.listeners.get(name)||[])callback(detail);}
 setVisible(on){
  this.visible=!!on;const f=this.element;
  if(on){if(f.src!==this.url){this.loadedAt=null;f.src=this.url;}}
  else if(f.src&&f.src!=='about:blank'){this.loadedAt=null;f.src='about:blank';}
 }
 get currentTime(){return 0;}
 get progressing(){return !this.visible||this.loadedAt!==null&&this.now()-this.loadedAt>1500;}
 near(){return this.progressing;}
 play(){this.wantPlay=true;}
 pause(){this.wantPlay=false;}
 seek(){}
 set muted(value){this.isMuted=!!value;}
 get muted(){return this.isMuted;}
 destroy(){this.visible=false;this.element.src='about:blank';this.element.remove();this.listeners.clear();}
}
