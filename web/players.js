// A small pool of stacked players: the one on screen plus a couple warming in
// the background. A cut is a swap between players that are already showing
// footage at the right moment, never a fresh load in front of the viewer.
import {ProviderPlayer} from './provider-player.js';
import {NativePlayer} from './native-player.js';
import {EmbedPlayer} from './embed-player.js';

export const TOLERANCE=8;      // seconds a warm player may be from the shared clock and still be cut to
const AHEAD=1.2,BEHIND=8;      // native hidden players pause when ahead, everyone re-seeks when this far behind
const STUCK=15000;             // ms a seek may stay unanswered before it is sent again
const STALE=20000;             // ms an unwanted hidden player is kept before it is closed

export class PlayerPool{
 constructor(host,{capacity=4,create=createPlayer,now=()=>performance.now(),onAd=()=>{},onClose=()=>{},onEnded=()=>{},onError=()=>{},onAudioLocked=()=>{},onReconnect=()=>{},onBeforeLeave=()=>{}}={}){
  Object.assign(this,{host,capacity,create,now,onAd,onClose,onEnded,onError,onAudioLocked,onReconnect,onBeforeLeave});
  this.slots=new Map();this.visible=null;this.muted=true;this.running=false;this.sequence=0;
 }
 get(key){return this.slots.get(key)||null;}
 open(key,source){
  let slot=this.slots.get(key);
  if(slot&&slot.url===source.url&&(!slot.player.error||slot.player.live)){this.touch(slot);return slot;}
  if(slot)this.close(key);
  const player=this.create(source);
  slot={key,url:source.url,source,player,used:++this.sequence,usedAt:this.now(),openedAt:this.now(),seekAt:0};
  const current=()=>this.slots.get(key)===slot;
  player.on('ad',on=>{if(current())this.onAd(key,on);});player.on('ended',()=>{if(current())this.onEnded(key);});player.on('error',error=>{if(current())this.onError(key,error);});player.on?.('audiolocked',()=>{if(current())this.onAudioLocked(key);});
  player.on?.('reconnect',detail=>{if(current())this.onReconnect(key,detail);});
  player.on?.('beforenavigate',()=>{if(current()&&this.visible===key)this.onBeforeLeave(key);});
  player.element.classList.add('layer');player.element.setAttribute('aria-hidden','true');player.element.tabIndex=-1;
  this.host.append(player.element);this.slots.set(key,slot);this.trim();return slot;
 }
 touch(slot){slot.used=++this.sequence;slot.usedAt=this.now();}
 close(key){const slot=this.slots.get(key);if(!slot)return;if(this.visible===key)this.onBeforeLeave(key);this.slots.delete(key);if(this.visible===key)this.visible=null;slot.player.destroy();this.onClose(key);}
 // Seconds a seek on this player takes to land; a moving target is led by this much.
 lead(key){const p=this.slots.get(key)?.player;return p?.kind==='provider'?Math.min(12,Math.max(1,(p.seekLatency||3000)/1000)):0;}
 // Players that cannot be driven (page embeds) are shown as soon as they have loaded.
 static drivable(player){return player.kind!=='embed';}
 // Keep a player at `target` (seconds into its media). A moving target (the
 // shared clock while playing) is led by the player's seek latency; an
 // outstanding seek is left alone until it lands or looks stuck, because
 // re-seeking a provider every poll never lets it deliver a frame.
 hold(key,target,{play=this.running,fixed=false}={}){
  const slot=this.slots.get(key);if(!slot)return;this.touch(slot);const p=slot.player;
  if(target===null||target===undefined||p.kind==='embed'){if(play&&!p.wantPlay)p.play();else if(!play&&p.wantPlay)p.pause();return;}
  const lead=play&&!fixed?this.lead(key):0;
  const seek=()=>{slot.seekAt=this.now();p.seek(target+lead);if(play)p.play();};
  if(p.target!==null){
   if(play&&!p.wantPlay)p.play();
   if(this.now()-slot.seekAt>STUCK)seek();
   return;
  }
  const fresh=!p.primed&&!p.wantPlay&&p.advances===0;
  if(fresh){seek();return;}
  const drift=p.currentTime-target;
  if(drift<-BEHIND||drift>30){seek();return;}
  if(p.kind==='native'&&key!==this.visible&&drift>AHEAD){p.pause();return;}
  if(play&&!p.wantPlay)p.play();else if(!play&&p.wantPlay)p.pause();
 }
 ready(key,target,tolerance=TOLERANCE){const p=this.slots.get(key)?.player;return !!p&&(target===null||target===undefined?p.progressing:p.near(target,tolerance));}
 show(key){
  const slot=this.slots.get(key);if(!slot)return false;
  if(this.visible&&this.visible!==key)this.onBeforeLeave(this.visible);
  // Retire every outgoing page before starting the incoming one, including a
  // return to an older slot that precedes the current one in insertion order.
  for(const s of this.slots.values())if(s!==slot){s.player.element.classList.remove('on');s.player.element.setAttribute('aria-hidden','true');s.player.element.tabIndex=-1;s.player.muted=true;s.player.setVisible?.(false);}
  slot.player.element.classList.add('on');slot.player.element.setAttribute('aria-hidden','false');slot.player.element.tabIndex=0;slot.player.muted=this.muted;slot.player.setVisible?.(true);
  // A warm, moving player only needs to be revealed. Starting it again can
  // re-enter a provider's startup/recovery flow right at the cut.
  this.visible=key;this.touch(slot);if(this.running&&(!slot.player.wantPlay||!slot.player.progressing))slot.player.play();return true;
 }
 hide(){if(this.visible)this.onBeforeLeave(this.visible);for(const s of this.slots.values()){s.player.element.classList.remove('on');s.player.element.setAttribute('aria-hidden','true');s.player.element.tabIndex=-1;s.player.muted=true;s.player.setVisible?.(false);}this.visible=null;}
 setMuted(value){this.muted=!!value;const slot=this.slots.get(this.visible);if(slot)slot.player.muted=this.muted;}
 // The viewer asked for sound on the visible player (inside their gesture): try the unmute again, and start a video whose muted autoplay was refused too.
 retryAudio(){const p=this.current;if(!p||this.muted)return false;p.audioLocked=false;p.muted=false;if(p.kind==='native'&&p.wantPlay&&p.element.paused)p.play();return true;}
 setRunning(value,{resumeVisible=true}={}){this.running=!!value;if(!value)for(const s of this.slots.values())s.player.pause();else if(this.visible&&resumeVisible)this.slots.get(this.visible)?.player.play();}
 // Release players nobody wants; never the visible one. Providers keep
 // playing muted meanwhile, since a paused provider restarts from its own
 // remembered position.
 keep(keys){
  for(const key of [...this.slots.keys()])if(key!==this.visible&&!keys.has(key)){const s=this.slots.get(key);if(s.player.kind==='native')s.player.pause();if(this.now()-s.usedAt>STALE)this.close(key);}
  this.trim();
 }
 trim(){while(this.slots.size>this.capacity){const victim=[...this.slots.values()].filter(s=>s.key!==this.visible).sort((a,b)=>a.used-b.used)[0];if(!victim)break;this.close(victim.key);}}
 destroy(){for(const key of [...this.slots.keys()])this.close(key);}
 get current(){return this.slots.get(this.visible)?.player||null;}
}
// Did the page's own host answer? The response is opaque and unread: it only tells a held load event from a dead host.
const answers=url=>fetch(url,{method:'HEAD',mode:'no-cors',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});
export function createPlayer(source){
 if(source.type==='provider/ok')return new ProviderPlayer(source.url,{duration:source.duration});
 if(source.type==='embed/page')return new EmbedPlayer(source.url,{autoReconnect:source.autoReconnect,probe:answers});
 return new NativePlayer(source);
}
