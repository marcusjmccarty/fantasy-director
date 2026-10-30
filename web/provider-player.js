// Drives OK's embedded player through the postMessage interface its public
// player ships (actions: play, pause, seek, mute, unmute, volume; events:
// inited, started, resumed, paused, timeupdate, rewound, ended, error, adShown).
// Media stays inside the provider's own player.
const ORIGIN='https://ok.ru';
export function providerURL(value){
 const u=new URL(value);if(u.origin!==ORIGIN||!/^\/videoembed\/\d+$/.test(u.pathname))throw new Error('Unknown replay provider.');
 u.search='?autoplay=1&muted=1&silent=1';u.hash='';return u.href;
}
const ERRORS={100:'This recording is still processing.',101:'This recording was removed.',102:'The provider blocked this recording.',103:'The provider could not find this recording.',150:'The provider restricted this recording.',151:'The provider denied access to this recording.',152:'The provider disabled embedded playback.',153:'This recording is unavailable in your region.'};

export class ProviderPlayer{
 constructor(url,{events=window,now=()=>performance.now(),createFrame=()=>document.createElement('iframe'),duration=NaN}={}){
  this.kind='provider';this.events=events;this.now=now;this.listeners=new Map();
  this.element=createFrame();this.element.className='layer';this.element.title='Game replay';
  this.element.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';this.element.referrerPolicy='strict-origin-when-cross-origin';
  this.duration=Number(duration)>0?Number(duration):NaN;this.knownDuration=Number.isFinite(this.duration);this.lastTime=0;this.lastMessage=-Infinity;this.lastAdvance=-Infinity;this.advances=0;
  this.initialized=false;this.primed=false;this.inAd=false;this.timer=null;this.error=null;this.wantPlay=false;this.target=null;this.isMuted=true;this.seekedAt=-Infinity;this.seekStartedAt=null;this.seekLatency=3000;this.lastReport=-Infinity;this.kickedAt=-Infinity;this.audioLocked=false;this.audioWatch=null;
  this.element.src=providerURL(url);   // validated before anything is registered
  this.onMessage=event=>this.receive(event);events.addEventListener('message',this.onMessage);
 }
 on(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name,detail){for(const callback of this.listeners.get(name)||[])callback(detail);}
 send(action,extra={}){try{this.element.contentWindow?.postMessage({action,...extra},ORIGIN);}catch{}}
 get currentTime(){
  const playing=this.wantPlay&&!this.inAd&&this.now()-this.lastAdvance<1500;
  return this.lastTime+(playing?Math.min(1,(this.now()-this.lastMessage)/1000):0);
 }
 // Footage is moving right now (two recent advancing time reports, no ad).
 get progressing(){return !this.inAd&&!this.error&&this.advances>=2&&this.now()-this.lastAdvance<1500;}
 // Ready to be shown at `target`: footage has played at this position since
 // the last seek, and is either still moving or deliberately paused there.
 near(target,tolerance=2.5){return this.primed&&!this.inAd&&!this.error&&this.target===null&&(this.progressing||!this.wantPlay)&&Math.abs(this.currentTime-target)<=tolerance;}
 play(){this.wantPlay=true;if(this.initialized)this.bootstrap();}
 pause(){this.wantPlay=false;this.advances=0;this.stopBootstrap();if(this.initialized)this.send('pause');}
 // The provider drops a play sent before its player is ready (observed: one
 // play after `inited` yields nothing, a half-second retry starts footage), so
 // keep asking until a time report proves the footage is moving.
 bootstrap(){
  if(this.timer)return;let tries=0;
  const tick=()=>{
   if(!this.wantPlay||this.advances>=2||++tries>120){this.stopBootstrap();return;}
   if(this.inAd)return;
   // A provider that has gone quiet after a seek or a restart is wedged; a pause breaks the spell and the next tick plays again.
   if(this.initialized&&this.now()-this.lastReport>6000&&this.now()-this.kickedAt>6000){this.kickedAt=this.now();this.send('pause');return;}
   if(tries%4===1)this.applyVolume();
   // Re-seeking every tick would abort the provider's own seek; ask again only when one has gone unanswered.
   if(this.target!==null&&this.now()-this.seekedAt>3000){this.seekedAt=this.now();this.send('seek',{time:this.target});}
   this.send('play');
  };
  tick();if(!this.timer){this.timer=setInterval(tick,500);this.timer.unref?.();}
 }
 stopBootstrap(){if(this.timer){clearInterval(this.timer);this.timer=null;}}
 // Footage stopped moving although we want it to: forget the progress seen so far and ask again until it moves.
 kick(){this.advances=0;this.primed=false;this.stalled=true;if(this.initialized)this.bootstrap();}
 seek(time){
  this.target=Math.max(0,Number(time)||0);this.advances=0;this.primed=false;this.seekedAt=this.now();this.seekStartedAt??=this.now();
  if(Number.isFinite(this.duration))this.target=Math.min(this.target,this.duration-1);
  if(this.initialized&&!this.inAd){this.send('seek',{time:this.target});if(this.wantPlay)this.bootstrap();}
 }
 // Unmuting can wedge the provider's player (observed: footage stops within a
 // second and ignores play/seek until muted again). Watch for that and fall
 // back to muted playback, flagging the slot so the app can offer a retry.
 set muted(value){
  this.isMuted=!!value;clearTimeout(this.audioWatch);this.audioWatch=null;
  if(!this.initialized)return;
  this.applyVolume();
  if(!this.isMuted&&this.wantPlay){
   const mark=this.lastTime;
   this.audioWatch=setTimeout(()=>{this.audioWatch=null;if(this.isMuted||this.inAd)return;if(this.lastTime<=mark+.5){this.audioLocked=true;this.isMuted=true;this.applyVolume(true);this.kick();this.emit('audiolocked');}},3000);
   this.audioWatch.unref?.();
  }
 }
 get muted(){return this.isMuted;}
 // Volume commands are sent only when the wanted state changes (or the player re-initialized); repeating them audibly stutters the provider.
 applyVolume(force=false){if(!force&&this.appliedMuted===this.isMuted)return;this.appliedMuted=this.isMuted;this.send(this.isMuted?'mute':'unmute');this.send('volume',{value:this.isMuted?0:1});}
 receive(event){
  if(event.origin!==ORIGIN||event.source!==this.element.contentWindow||!event.data||typeof event.data!=='object')return;
  const data=event.data,now=this.now();this.lastReport=now;
  switch(data.event){
   case 'inited':
    this.initialized=true;this.applyVolume(true);
    if(this.target!==null)this.send('seek',{time:this.target});
    if(this.wantPlay)this.bootstrap();else this.send('pause');
    return;
   case 'error':
    this.error={code:'PROVIDER_'+(data.code??0),message:(ERRORS[data.code]||'The replay provider could not start this recording.')};
    this.emit('error',this.error);return;
   case 'adShown':
    if(!this.inAd){this.inAd=true;this.advances=0;this.primed=false;this.emit('ad',true);}return;
   case 'ended':this.emit('ended');return;
   case 'started':case 'resumed':
    // The provider restarts from its own remembered position; put it back on ours.
    if(!this.wantPlay)this.send('pause');
    else if(this.target!==null&&!this.inAd){this.seekedAt=now;this.send('seek',{time:this.target});}
    this.applyVolume(true);return;
   case 'timeupdate':case 'rewound':break;
   default:return;
  }
  if(typeof data.time!=='number'||!Number.isFinite(data.time)||data.time<0)return;
  // Only content progress with the recording's own duration ends an ad. Before
  // the recording length is known, a pre-roll's own length must not be adopted.
  if(typeof data.duration==='number'&&data.duration>0){
   if(this.inAd){
    // Content is recognized by the recording's length (from the catalog when we have it); ads are short.
    const content=Number.isFinite(this.duration)?Math.abs(data.duration-this.duration)<=5:data.duration>180;
    if(!content)return;this.inAd=false;this.emit('ad',false);if(this.target!==null)this.send('seek',{time:this.target});
   }
   if(!Number.isFinite(this.duration))this.duration=data.duration;
  }else if(this.inAd)return;
  if(this.target!==null){
   if(Math.abs(data.time-this.target)>3){
    // A rewind elsewhere means the provider moved us; a stale time report just means our seek is pending.
    if(!this.inAd&&(data.event==='rewound'||now-this.seekedAt>3000)){this.seekedAt=now;this.send('seek',{time:this.target});}
    return;
   }
   // Landed. Remember how long that took, then ask for play again until footage moves.
   if(this.seekStartedAt!==null){this.seekLatency=Math.round(this.seekLatency*.5+Math.min(15000,now-this.seekStartedAt)*.5);this.seekStartedAt=null;}
   this.target=null;this.advances=0;if(this.wantPlay)this.bootstrap();
  }
  if(data.event!=='timeupdate')return;
  if(data.time>this.lastTime+.02||this.advances===0){this.advances++;this.lastAdvance=now;if(this.advances>=2){this.primed=true;this.stalled=false;this.stopBootstrap();}}
  this.lastTime=data.time;this.lastMessage=now;
  if(!this.wantPlay&&this.advances>2)this.send('pause');
 }
 destroy(){this.wantPlay=false;this.stopBootstrap();clearTimeout(this.audioWatch);this.events.removeEventListener('message',this.onMessage);this.element.removeAttribute('src');this.element.remove();this.listeners.clear();}
}
