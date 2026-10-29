// OK's published VideoEmbed module accepts action messages. Its classic player
// reports inited/started/timeupdate/rewound/paused/ended/error to the parent.
// Keep media delivery inside the original provider; never export its signed URL.
export function providerURL(value){
 const u=new URL(value);if(u.origin!=='https://ok.ru'||!/^\/videoembed\/\d+$/.test(u.pathname))throw new Error('Unknown replay provider.');
 u.search='?muted=1&silent=1';u.hash='';return u.href;
}
export class ProviderPlayer{
 constructor({createFrame=()=>document.createElement('iframe'),events=window,now=()=>performance.now()}={}){
  this.kind='provider';this.element=createFrame();this.events=events;this.now=now;this.listeners=new Map();this.pendingPlay=[];
  this.readyState=0;this.networkState=0;this.duration=NaN;this.error=null;this.seeking=false;this.paused=true;this.initialized=false;this.progress=0;this.lastTime=0;this.lastProgress=-Infinity;this.lastAdvance=-Infinity;this.wantsPlay=false;this._muted=true;this._target=null;this._src='';this.userInteractable=false;this._seekSent=false;
  this.buffered={length:0};this.element.title='Full-game replay · provider player';this.element.allow='autoplay; fullscreen; picture-in-picture';this.element.allowFullscreen=true;this.element.referrerPolicy='strict-origin-when-cross-origin';
  this.message=event=>this.receive(event);events.addEventListener('message',this.message);
 }
 get classList(){return this.element.classList;}set className(value){this.element.className=value;}
 set userInteractable(value){this._interactive=!!value;this.element.classList.toggle('interactive',!!value);}get userInteractable(){return this._interactive;}
 setAttribute(name,value){this.element.setAttribute(name,value);}
 removeAttribute(name){if(name==='src')this._src='';this.element.removeAttribute(name);}
 set src(value){this._src=providerURL(value);}get src(){return this._src;}
 load(){if(this._src){this.element.src=this._src;this.networkState=2;}else this.stopTimer();}
 addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 emit(name){for(const callback of this.listeners.get(name)||[])callback();}
 send(action,extra={}){this.element.contentWindow?.postMessage({action,...extra},'https://ok.ru');}
 set muted(value){this._muted=!!value;this.send(value?'mute':'unmute');this.send('volume',{value:value?0:1});}
 get muted(){return this._muted;}
 set controls(value){}set playsInline(value){}set preload(value){}set playbackRate(value){}get playbackRate(){return 1;}
 get currentTime(){const elapsed=this.paused?0:Math.min(2.5,Math.max(0,(this.now()-this.lastProgress)/1000));return this.lastTime+elapsed;}
 set currentTime(value){this._target=Math.max(0,Number(value)||0);this.seeking=true;this.progress=0;this.seekAt=this.now();this._seekSent=false;this._startedSeek=false;if(this.initialized){this.send('seek',{time:this._target});this._seekSent=true;}}
 stopTimer(){clearInterval(this.bootstrap);this.bootstrap=null;}
 start(){
  if(!this.initialized||!this.wantsPlay)return;
  this.send(this._muted?'mute':'unmute');if(this._muted)this.send('volume',{value:0});this.send('play');
  if(this._target!==null&&this.seeking&&!this._seekSent){this.send('seek',{time:this._target});this._seekSent=true;}
 }
 play(){
  this.wantsPlay=true;
  if(!this.paused&&this.progress>0)return Promise.resolve();
  const promise=new Promise((resolve,reject)=>this.pendingPlay.push({resolve,reject}));this.start();
  if(!this.bootstrap){let tries=0;this.bootstrap=setInterval(()=>{if(!this.wantsPlay||++tries>60){this.stopTimer();return;}this.start();},500);}
  return promise;
 }
 pause(){this.wantsPlay=false;this.paused=true;this.stopTimer();this.send('pause');const pending=this.pendingPlay.splice(0);for(const p of pending)p.reject(new DOMException('Playback paused','AbortError'));}
 readyAt(target){return this.progress>=2&&!this.seeking&&!this.error&&this.now()-this.lastAdvance<3000&&Math.abs(this.currentTime-target)<3;}
 receive(event){
  if(event.origin!=='https://ok.ru'||event.source!==this.element.contentWindow||!event.data||typeof event.data!=='object')return;
  const data=event.data;
  if(data.event==='inited'){this.initialized=true;this.readyState=1;this.networkState=1;this.emit('loadedmetadata');this.start();return;}
  if(data.event==='error'){const messages={100:'This recording is still processing.',101:'This recording was removed.',102:'The provider blocked this recording.',103:'The provider could not find this recording.',150:'The provider restricted this recording.',151:'The provider denied access to this recording.',152:'The provider disabled embedded playback.',153:'This recording is unavailable in your region.'};this.error={code:'PROVIDER_'+String(data.code??0),message:(messages[data.code]||'The replay provider could not start this recording.')+' Choose another game.'};this.readyState=0;this.stopTimer();for(const p of this.pendingPlay.splice(0))p.reject(new Error(this.error.message));this.emit('error');return;}
  if(data.event==='paused'){this.paused=true;return;}
  if(data.event==='ended'){this.paused=true;this.emit('ended');return;}
  if(data.event==='adShown'){this.progress=0;this.readyState=1;return;}
  if(data.event==='started'||data.event==='resumed'){if(this.userInteractable)this.wantsPlay=true;this.send(this._muted?'mute':'unmute');if(this.seeking&&!this._startedSeek){this._startedSeek=true;this.send('seek',{time:this._target});}return;}
  if(data.event!=='timeupdate'&&data.event!=='rewound')return;
  if(typeof data.time!=='number'||!Number.isFinite(data.time)||data.time<0)return;
  if(typeof data.duration==='number'&&data.duration>0)this.duration=data.duration;
  if(this.seeking){
   // A rewind acknowledgement alone is not proof of delivered video.
   if(Math.abs(data.time-this._target)>3)return;
   if(data.event==='timeupdate'){this.seeking=false;this.progress=0;this.emit('seeked');}
  }
  if(data.event!=='timeupdate')return;
  const advanced=data.time>this.lastTime+.025;
  if(this.progress===0||advanced)this.lastAdvance=this.now();
  this.progress=this.progress===0?1:advanced?this.progress+1:this.progress;
  this.lastTime=data.time;this.lastProgress=this.now();this.paused=!this.wantsPlay;this.readyState=this.progress>=2?3:2;
  if(this.wantsPlay){this.stopTimer();for(const p of this.pendingPlay.splice(0))p.resolve();}
  this.emit('timeupdate');
 }
 remove(){this.pause();this.events.removeEventListener('message',this.message);this.element.remove();}
}
