// A small pool of stacked players: the one on screen plus a couple warming in
// the background. A cut is a swap between players that are already showing
// footage at the right moment, never a fresh load in front of the viewer.
import {ProviderPlayer} from './provider-player.js';
import {NativePlayer} from './native-player.js';

export const TOLERANCE=8;      // seconds a warm player may be from the shared clock and still be cut to
const AHEAD=1.2,BEHIND=8;      // native hidden players pause when ahead, everyone re-seeks when this far behind
const STUCK=15000;             // ms a seek may stay unanswered before it is sent again
const STALE=20000;             // ms an unwanted hidden player is kept before it is closed

export class PlayerPool{
 constructor(host,{capacity=4,create=createPlayer,now=()=>performance.now(),onAd=()=>{},onEnded=()=>{},onError=()=>{},onAudioLocked=()=>{}}={}){
  Object.assign(this,{host,capacity,create,now,onAd,onEnded,onError,onAudioLocked});
  this.slots=new Map();this.visible=null;this.muted=true;this.running=false;this.sequence=0;
 }
 get(key){return this.slots.get(key)||null;}
 open(key,source){
  let slot=this.slots.get(key);
  if(slot&&slot.url===source.url&&!slot.player.error){this.touch(slot);return slot;}
  if(slot)this.close(key);
  const player=this.create(source);
  slot={key,url:source.url,source,player,used:++this.sequence,usedAt:this.now(),openedAt:this.now(),seekAt:0};
  player.on('ad',on=>this.onAd(key,on));player.on('ended',()=>this.onEnded(key));player.on('error',error=>this.onError(key,error));player.on?.('audiolocked',()=>this.onAudioLocked(key));
  player.element.classList.add('layer');player.element.setAttribute('aria-hidden','true');player.element.tabIndex=-1;
  this.host.append(player.element);this.slots.set(key,slot);this.trim();return slot;
 }
 touch(slot){slot.used=++this.sequence;slot.usedAt=this.now();}
 close(key){const slot=this.slots.get(key);if(!slot)return;slot.player.destroy();this.slots.delete(key);if(this.visible===key)this.visible=null;}
 // Seconds a seek on this player takes to land; a moving target is led by this much.
 lead(key){const p=this.slots.get(key)?.player;return p?.kind==='provider'?Math.min(12,Math.max(1,(p.seekLatency||3000)/1000)):0;}
 // Keep a player at `target` (seconds into its media). A moving target (the
 // shared clock while playing) is led by the player's seek latency; an
 // outstanding seek is left alone until it lands or looks stuck, because
 // re-seeking a provider every poll never lets it deliver a frame.
 hold(key,target,{play=this.running,fixed=false}={}){
  const slot=this.slots.get(key);if(!slot)return;this.touch(slot);const p=slot.player;
  if(target===null||target===undefined){if(play)p.play();else p.pause();return;}
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
  for(const s of this.slots.values()){const on=s.key===key;s.player.element.classList.toggle('on',on);s.player.element.setAttribute('aria-hidden',String(!on));s.player.muted=!on||this.muted;}
  this.visible=key;this.touch(slot);if(this.running)slot.player.play();return true;
 }
 hide(){for(const s of this.slots.values()){s.player.element.classList.remove('on');s.player.muted=true;}this.visible=null;}
 setMuted(value){this.muted=!!value;const slot=this.slots.get(this.visible);if(slot)slot.player.muted=this.muted;}
 // The viewer asked for sound on the visible player (inside their gesture): try the unmute again.
 retryAudio(){const p=this.current;if(!p||this.muted)return false;p.audioLocked=false;p.muted=false;return true;}
 setRunning(value){this.running=!!value;if(!value)for(const s of this.slots.values())s.player.pause();else if(this.visible)this.slots.get(this.visible)?.player.play();}
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
export function createPlayer(source){return source.type==='provider/ok'?new ProviderPlayer(source.url,{duration:source.duration}):new NativePlayer(source);}
