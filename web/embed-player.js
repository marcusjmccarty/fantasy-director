// Any web page the viewer points a game at (a stream site, a team's own
// player) shown in an iframe. Nothing inside it can be observed or driven, and
// it cannot be muted, so the page is loaded only while it is on screen: a
// hidden one would play its own sound over the picture. Hidden, it counts as
// ready (there is nothing to warm); shown, it is ready once it has loaded.
// A loaded page is NOT proof of moving video. Periodic reconnect is an explicit
// fallback for that blind spot, separate from bounded page-loading recovery.
const RECONNECT_EVERY=120000,LOAD_WINDOWS=[15000,20000,30000],NETWORK_RETRY_GAP=10000;
export class EmbedPlayer{
 constructor(url,{now=()=>performance.now(),createFrame=()=>document.createElement('iframe'),autoReconnect=true}={}){
  this.kind='embed';this.url=url;this.now=now;this.listeners=new Map();this.inAd=false;this.error=null;this.wantPlay=false;this.target=null;
  this.primed=true;this.advances=2;this.loadedAt=null;this.audioLocked=false;this.isMuted=true;this.duration=NaN;this.visible=false;
  this.destroyed=false;
  this.autoReconnect=!!autoReconnect;this.loadStartedAt=null;this.nextReconnectAt=null;this.loadRetries=0;this.lastReconnectAt=-Infinity;this.suspendedAt=null;this.offline=false;this.recoveryMessage='';
  const f=this.element=createFrame();f.className='layer';f.title='Stream';
  // This also confines nested players and ad frames. Keep playback/storage
  // working, but never let an embedded page open tabs, navigate our window,
  // launch browser dialogs or download files, even after a viewer clicks it.
  f.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-presentation');
  f.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';f.referrerPolicy='no-referrer';
  f.addEventListener('load',()=>{if(!this.destroyed&&this.visible&&f.src===this.url){this.loadedAt=this.now();this.loadRetries=0;}});
 }
 on(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name,detail){for(const callback of this.listeners.get(name)||[])callback(detail);}
 setVisible(on){
  if(this.destroyed)return;
  this.visible=!!on;const f=this.element;
  if(on){if(f.src!==this.url){this.resetRecovery();this.navigate();}}
  else{this.resetRecovery();if(f.src&&f.src!=='about:blank')f.src='about:blank';}
 }
 get currentTime(){return 0;}
 get progressing(){return !this.destroyed&&!this.error&&(!this.visible||this.loadedAt!==null&&this.now()-this.loadedAt>1500);}
 near(){return this.progressing;}
 play(){if(this.destroyed)return;this.wantPlay=true;if(this.visible)this.setVisible(true);}
 pause(){this.wantPlay=false;this.resetRecovery();if(this.visible)this.element.src='about:blank';}
 seek(){}
 // A cross-origin page can display an error or navigate inside its own frame
 // without telling us. Reload just that document; preserve the channel state.
 reload(){if(this.destroyed||!this.visible||!this.wantPlay)return false;this.resetRecovery();this.navigate('Reloading stream…');return true;}
 resetRecovery(){this.loadedAt=null;this.loadStartedAt=null;this.nextReconnectAt=null;this.loadRetries=0;this.suspendedAt=null;this.offline=false;this.recoveryMessage='';}
 navigate(message=''){
  const now=this.now();this.loadedAt=null;this.loadStartedAt=now;this.lastReconnectAt=now;this.nextReconnectAt=this.autoReconnect?now+RECONNECT_EVERY:null;this.recoveryMessage=message;this.element.src=this.url;
 }
 setAutoReconnect(value){
  if(this.autoReconnect===!!value)return;
  this.autoReconnect=!!value;this.nextReconnectAt=this.autoReconnect&&this.visible&&this.wantPlay?this.now()+RECONNECT_EVERY:null;
 }
 get reconnecting(){return !!this.recoveryMessage&&this.loadedAt===null&&!this.error;}
 // Called only for the on-screen game by the app loop. No background timers
 // can reload an old frame after a switch, Pause, highlight, or destruction.
 checkHealth({online=true,foreground=true}={}){
  if(this.destroyed||this.error||!this.visible||!this.wantPlay||this.loadStartedAt===null)return;
  const now=this.now();
  if(!online||!foreground){this.suspendedAt??=now;if(!online)this.offline=true;return;}
  if(this.suspendedAt!==null){
   const elapsed=now-this.suspendedAt;this.loadStartedAt+=elapsed;if(this.nextReconnectAt!==null)this.nextReconnectAt+=elapsed;this.suspendedAt=null;
  }
  if(this.offline){
   // A flapping connection cannot produce a rapid reload loop.
   if(now-this.lastReconnectAt<NETWORK_RETRY_GAP)return;
   this.offline=false;this.loadRetries=0;this.navigate('Connection restored · reconnecting stream…');return;
  }
  if(this.loadedAt===null){
   if(now-this.loadStartedAt<LOAD_WINDOWS[this.loadRetries])return;
   if(this.loadRetries<LOAD_WINDOWS.length-1){this.loadRetries++;this.navigate(`Reconnecting stream · attempt ${this.loadRetries} of 2…`);return;}
   this.error={code:'EMBED_LOAD_TIMEOUT',message:'The stream page did not respond after two reconnect attempts.'};this.emit('error',this.error);return;
  }
  if(this.autoReconnect&&this.nextReconnectAt!==null&&now>=this.nextReconnectAt){this.loadRetries=0;this.navigate('Refreshing stream connection…');}
 }
 set muted(value){this.isMuted=!!value;}
 get muted(){return this.isMuted;}
 destroy(){this.destroyed=true;this.wantPlay=false;this.visible=false;this.resetRecovery();this.element.src='about:blank';this.element.remove();this.listeners.clear();}
}
