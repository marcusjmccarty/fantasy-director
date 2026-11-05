// Any web page the viewer points a game at (a stream site, a team's own
// player) shown in an iframe. Nothing inside it can be observed or driven, and
// it cannot be muted, so the page is loaded only while it is on screen: a
// hidden one would play its own sound over the picture. Hidden, it counts as
// ready (there is nothing to warm); shown, it is ready once it has loaded.
// A loaded page is NOT proof of moving video. Periodic reconnect is an explicit
// fallback for that blind spot, separate from page-loading recovery. Loading
// retries back off, but never abandon a stream the viewer still wants playing.
// A page with ads and nested frames can take a long time to fire `load`, or
// never fire it. Before a slow page is reloaded its host is asked once whether
// it answers; a page that answers is left alone, a picture that may be playing
// is worth more than a retry. A host that does not answer gets the spaced
// retries and the backup. After a few attempts the viewer gets the Reload and
// Open stream buttons instead of a loop.
import {ntvEmbedURL} from './stream-policy.js';
const RECONNECT_EVERY=120000,LOAD_WINDOWS=[45000,60000,90000],MAX_LOAD_RETRIES=3,NETWORK_RETRY_GAP=10000,OFFLINE_SETTLE=5000,INTERACTION_TRUST=600000;
export class EmbedPlayer{
 constructor(url,{now=()=>performance.now(),createFrame=()=>document.createElement('iframe'),autoReconnect=true,probe=null}={}){
  this.kind='embed';this.url=ntvEmbedURL(url)||url;this.now=now;this.listeners=new Map();this.inAd=false;this.error=null;this.wantPlay=false;this.target=null;
  this.primed=true;this.advances=2;this.loadedAt=null;this.audioLocked=false;this.isMuted=true;this.duration=NaN;this.visible=false;
  this.destroyed=false;
  this.autoReconnect=!!autoReconnect;this.loadStartedAt=null;this.nextReconnectAt=null;this.loadRetries=0;this.lastReconnectAt=-Infinity;this.suspendedAt=null;this.offline=false;this.offlineSince=null;this.recoveryMessage='';this.everLoaded=false;this.interactedAt=null;this.gaveUp=false;
  this.probe=probe;this.probing=null;this.probedFrame=null;this.createFrame=createFrame;this.element=this.newFrame();
 }
 newFrame(){
  const f=this.createFrame();f.className='layer';f.title='Stream';
  f.classList?.toggle('on',this.visible);f.setAttribute('aria-hidden',String(!this.visible));f.tabIndex=this.visible?0:-1;
  // NTV rejects any sandbox attribute. Its published player is the only
  // exception; it can open ad tabs after clicks. All other pages retain the
  // sandbox, including arbitrary pages on NTV and lookalike domains.
  if(!ntvEmbedURL(this.url))f.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-presentation allow-storage-access-by-user-activation');
  // The site's own player can fullscreen just its video after a viewer click.
  // Our button uses the stable outer stage; nested fullscreen can end when its
  // document reconnects, so the app preserves a stage fallback before reload.
  f.allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *";f.allowFullscreen=true;f.referrerPolicy='strict-origin-when-cross-origin';
  f.addEventListener('load',()=>{if(!this.destroyed&&f===this.element&&this.visible&&this.wantPlay&&this.loadStartedAt!==null&&f.src&&f.src!=='about:blank'){this.loadedAt=this.now();this.loadRetries=0;this.everLoaded=true;this.gaveUp=false;}});
  return f;
 }
 replaceFrame(url){
  // A fresh browsing context keeps late events from about:blank, the previous
  // game, or an aborted reload from being accepted as the current attempt.
  const old=this.element,f=this.newFrame();this.element=f;f.src=url;old.replaceWith(f);
 }
 unload(){
  if(this.element.src&&this.element.src!=='about:blank')this.replaceFrame('about:blank');
 }
 on(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name,detail){for(const callback of this.listeners.get(name)||[])callback(detail);}
 setVisible(on){
  if(this.destroyed)return;
  this.visible=!!on;const f=this.element;
  if(on){if(this.wantPlay&&f.src!==this.url){this.resetRecovery();this.navigate();}}
  else{this.resetRecovery();this.unload();}
 }
 get currentTime(){return 0;}
 get progressing(){return !this.destroyed&&!this.error&&(!this.visible||this.loadedAt!==null&&this.now()-this.loadedAt>1500);}
 near(){return this.progressing;}
 // The one sign of real viewing a cross-origin page gives: a recent click inside this document (a reload clears it).
 get viewerConfirmed(){return !this.destroyed&&!this.error&&this.visible&&this.wantPlay&&this.loadedAt!==null&&this.interactedAt!==null&&this.now()-this.interactedAt<INTERACTION_TRUST&&this.suspendedAt===null&&!this.offline;}
 play(){if(this.destroyed)return;this.wantPlay=true;if(this.visible)this.setVisible(true);}
 pause(){this.wantPlay=false;this.resetRecovery();this.unload();}
 seek(){}
 // A cross-origin page can display an error or navigate inside its own frame
 // without telling us. Reload just that document; preserve the channel state.
 reload(){if(this.destroyed||!this.visible||!this.wantPlay)return false;this.resetRecovery();this.navigate('Reloading stream…');return true;}
 resetRecovery(){this.loadedAt=null;this.loadStartedAt=null;this.nextReconnectAt=null;this.loadRetries=0;this.suspendedAt=null;this.offline=false;this.offlineSince=null;this.recoveryMessage='';this.interactedAt=null;this.gaveUp=false;}
 // The viewer clicked inside the page: it is alive, whatever its load event said.
 noteInteraction(){if(this.destroyed||!this.visible)return;this.interactedAt=this.now();this.loadedAt??=this.now();this.loadRetries=0;this.gaveUp=false;this.recoveryMessage='';}
 navigate(message='',detail={}){
  const now=this.now();this.loadedAt=null;this.gaveUp=false;this.interactedAt=null;this.loadStartedAt=now;this.lastReconnectAt=now;this.nextReconnectAt=this.autoReconnect?now+RECONNECT_EVERY:null;this.recoveryMessage=message;
  if(message)this.emit('reconnect',detail);
  if(!this.destroyed&&this.visible&&this.wantPlay)this.replaceFrame(this.url);
 }
 setAutoReconnect(value){
  if(this.autoReconnect===!!value)return;
  this.autoReconnect=!!value;this.nextReconnectAt=this.autoReconnect&&this.visible&&this.wantPlay?this.now()+RECONNECT_EVERY:null;
 }
 get reconnecting(){return !!this.recoveryMessage&&(this.loadedAt===null||this.gaveUp)&&!this.error;}
 // Called only for the on-screen game by the app loop. No background timers
 // can reload an old frame after a switch, Pause, highlight, or destruction.
 checkHealth({online=true,foreground=true}={}){
  if(this.destroyed||this.error||!this.visible||!this.wantPlay||this.loadStartedAt===null)return;
  const now=this.now();
  if(!online||!foreground){this.suspendedAt??=now;if(!online){this.offlineSince??=now;if(now-this.offlineSince>=OFFLINE_SETTLE)this.offline=true;}return;}
  this.offlineSince=null;
  if(this.suspendedAt!==null){
   const elapsed=now-this.suspendedAt;this.loadStartedAt+=elapsed;if(this.nextReconnectAt!==null)this.nextReconnectAt+=elapsed;this.suspendedAt=null;
  }
  // A click inside the page proves it is alive: nothing automatic touches it for a while.
  if(this.interactedAt!==null&&now-this.interactedAt<INTERACTION_TRUST&&!this.offline)return;
  if(this.offline){
   // A flapping connection cannot produce a rapid reload loop.
   if(now-this.lastReconnectAt<NETWORK_RETRY_GAP)return;
   this.offline=false;this.loadRetries=0;this.navigate('Connection restored · reconnecting stream…');return;
  }
  if(this.loadedAt===null){
   if(now-this.loadStartedAt<LOAD_WINDOWS[Math.min(this.loadRetries,LOAD_WINDOWS.length-1)])return;
   if(this.probing===this.element)return;
   if(this.probe&&this.probedFrame!==this.element){this.probeHost();return;}
   if(this.loadRetries>=MAX_LOAD_RETRIES){if(!this.gaveUp){this.gaveUp=true;this.recoveryMessage='The stream page is not responding · Reload stream, or Open stream in a new tab.';this.emit('reconnect',{reason:'gaveup'});}return;}
   this.loadRetries++;this.navigate(`The stream page is slow to load · attempt ${this.loadRetries} of ${MAX_LOAD_RETRIES}.`,{reason:'load',attempt:this.loadRetries,failover:!this.everLoaded&&this.loadRetries>=2});return;
  }
  if(this.autoReconnect&&this.nextReconnectAt!==null&&now>=this.nextReconnectAt){this.loadRetries=0;this.navigate('Refreshing stream connection…');}
 }
 // Once per frame. An answer counts as loaded for this frame, but is weaker than a `load`: everLoaded stays false so a host that later dies still fails over. A late answer for a retired frame is ignored.
 probeHost(){
  const f=this.element;this.probing=f;this.probedFrame=f;
  Promise.resolve().then(()=>this.probe(this.url)).then(()=>true,()=>false).then(answered=>{
   if(this.probing===f)this.probing=null;
   if(answered&&!this.destroyed&&f===this.element&&this.visible&&this.wantPlay&&this.loadedAt===null){this.loadedAt=this.now();this.loadRetries=0;this.gaveUp=false;this.recoveryMessage='';}
  });
 }
 set muted(value){this.isMuted=!!value;}
 get muted(){return this.isMuted;}
 destroy(){this.destroyed=true;this.wantPlay=false;this.visible=false;this.resetRecovery();this.element.src='about:blank';this.element.remove();this.listeners.clear();}
}
