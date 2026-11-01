// Any web page the viewer points a game at (a stream site, a team's own
// player) shown in an iframe. Nothing inside it can be observed or driven, and
// it cannot be muted, so the page is loaded only while it is on screen: a
// hidden one would play its own sound over the picture. Hidden, it counts as
// ready (there is nothing to warm); shown, it is ready once it has loaded.
export class EmbedPlayer{
 constructor(url,{now=()=>performance.now(),createFrame=()=>document.createElement('iframe')}={}){
  this.kind='embed';this.url=url;this.now=now;this.listeners=new Map();this.inAd=false;this.error=null;this.wantPlay=false;this.target=null;
  this.primed=true;this.advances=2;this.loadedAt=null;this.audioLocked=false;this.isMuted=true;this.duration=NaN;this.visible=false;
  this.destroyed=false;
  const f=this.element=createFrame();f.className='layer';f.title='Stream';
  // This also confines nested players and ad frames. Keep playback/storage
  // working, but never let an embedded page open tabs, navigate our window,
  // launch browser dialogs or download files, even after a viewer clicks it.
  f.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-presentation');
  f.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';f.referrerPolicy='no-referrer';
  f.addEventListener('load',()=>{if(!this.destroyed&&this.visible&&f.src===this.url)this.loadedAt=this.now();});
 }
 on(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name,detail){for(const callback of this.listeners.get(name)||[])callback(detail);}
 setVisible(on){
  if(this.destroyed)return;
  this.visible=!!on;const f=this.element;
  if(on){if(f.src!==this.url){this.loadedAt=null;f.src=this.url;}}
  else if(f.src&&f.src!=='about:blank'){this.loadedAt=null;f.src='about:blank';}
 }
 get currentTime(){return 0;}
 get progressing(){return !this.destroyed&&!this.error&&(!this.visible||this.loadedAt!==null&&this.now()-this.loadedAt>1500);}
 near(){return this.progressing;}
 play(){if(this.destroyed)return;this.wantPlay=true;if(this.visible)this.setVisible(true);}
 pause(){this.wantPlay=false;if(this.visible){this.loadedAt=null;this.element.src='about:blank';}}
 seek(){}
 // A cross-origin page can display an error or navigate inside its own frame
 // without telling us. Reload just that document; preserve the channel state.
 reload(){if(this.destroyed||!this.visible||!this.wantPlay)return false;this.loadedAt=null;this.element.src=this.url;return true;}
 set muted(value){this.isMuted=!!value;}
 get muted(){return this.isMuted;}
 destroy(){this.destroyed=true;this.wantPlay=false;this.visible=false;this.loadedAt=null;this.element.src='about:blank';this.element.remove();this.listeners.clear();}
}
