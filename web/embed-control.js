// The optional browser helper runs inside provider frames. A page alone cannot
// access cross-origin media. Commands contain playback state only, never URLs,
// lineup information, cookies, or credentials.
const CHANNEL='fantasy-stream-playback-v1';
let sequence=0;
export class EmbedControl{
 constructor(player,events=globalThis.window){
  this.player=player;this.events=events;this.audioRevision=0;this.reset();
  this.receive=event=>{
   const p=this.player,d=event.data;
   if(p.destroyed||event.source!==p.element.contentWindow||!d||d.channel!==CHANNEL)return;
   if(d.type==='ready'){this.send();return;}
   if(d.type!=='status'||d.session!==this.session||!p.activePlayback||!p.wantPlay)return;
   this.connected=true;this.seen=p.now();
   const time=Number(d.time);
   if(d.playing===true&&Number.isFinite(time)&&this.sampled&&time>this.time+.01){this.advanced=p.now();this.advances++;}
   this.sampled=true;
   this.time=Number.isFinite(time)?time:0;this.playing=d.playing===true;
   this.buffered=Number.isFinite(d.buffered)?Math.max(0,d.buffered):0;
   if(d.audioLocked===true&&!p.audioLocked){p.audioLocked=true;p.emit('audiolocked');}
  };
  events?.addEventListener?.('message',this.receive);
 }
 reset(){this.session=String(++sequence);this.connected=false;this.seen=-Infinity;this.advanced=-Infinity;this.time=0;this.playing=false;this.sampled=false;this.advances=0;this.buffered=0;}
 get active(){return this.connected&&this.player.now()-this.seen<3000;}
 get progressing(){return this.player.wantPlay&&this.player.activePlayback&&this.active&&this.playing&&this.advances>=2&&this.player.now()-this.advanced<2000;}
 get ready(){return this.progressing&&this.buffered>=.75;}
 send(){const p=this.player;if(!p.wantPlay||!p.activePlayback){this.playing=false;this.sampled=false;this.advances=0;this.buffered=0;}try{p.element.contentWindow?.postMessage({channel:CHANNEL,type:'state',session:this.session,playing:!p.destroyed&&p.activePlayback&&p.wantPlay,visible:p.visible,muted:!p.visible||p.isMuted,captions:false,audioRevision:this.audioRevision},'*');}catch{}}
 destroy(){this.events?.removeEventListener?.('message',this.receive);}
}
