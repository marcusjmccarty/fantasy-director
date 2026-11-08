(()=>{
 const CHANNEL='fantasy-stream-playback-v1';
 chrome.runtime.sendMessage({type:'init'}).then(config=>{
  if(!config?.enabled)return;
  if(config.top){
   chrome.runtime.onMessage.addListener(message=>{
    if(message?.type!=='fullscreen')return;
    const stage=document.querySelector('.stage'),button=document.getElementById('fullButton');
    if(!stage||!button)return;
    const full=!!(document.fullscreenElement||document.webkitFullscreenElement||stage.classList.contains('theater'));
    if(message.toggle||full===message.exit)button.click();
   });
   const announce=()=>{document.documentElement?.setAttribute('data-fantasy-stream-helper','2');window.dispatchEvent(new Event('fantasy-stream-helper-ready'));};
   announce();document.addEventListener('DOMContentLoaded',announce,{once:true});return;
  }
  let state=null,childStatus=null,childSeen=-Infinity,audioLocked=false,playPending=false,lastPlay=-Infinity,lastClick=-Infinity,clicks=0,dead=false,lastState=-Infinity;
  const watched=new WeakSet();
  const visible=el=>{const r=el.getBoundingClientRect();return r.width>80&&r.height>45;};
  const largest=elements=>[...elements].filter(visible).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;})[0];
  const frames=()=>[...document.querySelectorAll('iframe')];
  const post=data=>window.parent.postMessage({channel:CHANNEL,...data},'*');
  const sendState=()=>{if(state)for(const f of frames())f.contentWindow?.postMessage({channel:CHANNEL,type:'state',...state},'*');};
  const pageState=()=>window.dispatchEvent(new CustomEvent('fantasy-stream-media-state',{detail:JSON.stringify(state||{playing:false,visible:false,muted:true,captions:false})}));
  const buffer=video=>{try{for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=video.currentTime+.05&&video.buffered.end(i)>video.currentTime)return video.buffered.end(i)-video.currentTime;}catch{}return 0;};
  function captionsOff(video){for(const track of video.textTracks||[])if(['subtitles','captions'].includes(track.kind)&&track.mode!=='disabled')track.mode='disabled';}
  function guard(video){
   captionsOff(video);if(!state||!state.visible||state.muted||!state.playing)video.muted=true;
   if(watched.has(video))return;watched.add(video);
   const enforce=()=>{captionsOff(video);if(!state||!state.visible||state.muted||!state.playing)video.muted=true;};
   video.addEventListener?.('volumechange',enforce);video.addEventListener?.('loadedmetadata',enforce);
   // Chrome can pause muted autoplay on an unmute without rejecting the old
   // play promise. Recover on that pause event instead of waiting a second.
   video.addEventListener?.('pause',()=>{if(state?.playing&&!dead){lastPlay=-Infinity;start(video);}});
   video.textTracks?.addEventListener?.('addtrack',enforce);video.textTracks?.addEventListener?.('change',enforce);
  }
  const media=()=>largest(document.querySelectorAll('video'));
  function status(video){
   if(!state)return;
   const own=video?{playing:!video.paused&&!video.ended&&!video.seeking&&video.readyState>=3,time:video.currentTime,buffered:buffer(video),audioLocked}:null;
   const child=Date.now()-childSeen<1500?childStatus:null;
   post({type:'status',session:state.session,...(own||child||{playing:false,time:0,buffered:0,audioLocked:false})});
  }
  function start(video){
   if(!state?.playing||dead)return;
   video.playsInline=true;video.autoplay=true;
   video.muted=!state.visible||state.muted||audioLocked;
   if(!video.paused||playPending||Date.now()-lastPlay<1000)return;
   lastPlay=Date.now();playPending=true;const session=state.session;
   Promise.resolve().then(()=>{
    if(dead||state?.session!==session||!state.playing){video.pause();return;}
    return video.play();
   }).catch(error=>{
    if(dead||state?.session!==session||!state.playing)return;
    if(error?.name==='NotAllowedError'){
     audioLocked=true;video.muted=true;return video.play().catch(()=>{});
    }
   }).finally(()=>{playPending=false;if(dead||state?.session!==session||!state?.playing)video.pause();});
  }
  function pressPlay(video){
   if(!state?.playing||clicks>=3||Date.now()-lastClick<2500||video&&!video.paused)return;
   // Only recognized player controls, never arbitrary page buttons, ads, links,
   // consent prompts, or coordinates. No synthetic trusted-gesture claims.
   const button=document.querySelector('.jw-display-icon-display .jw-icon-display, .jw-display-icon-container .jw-icon-playback, .vjs-big-play-button, .plyr__control--overlaid, [data-player] .play-wrapper, [data-player] [data-playback]');
   if(!button||button.closest('a'))return;
   const rect=button.getBoundingClientRect();
   if(rect.width<=0||rect.height<=0)return;
   if(typeof getComputedStyle==='function'){const style=getComputedStyle(button);if(style.visibility==='hidden'||style.display==='none'||style.opacity==='0')return;}
   lastClick=Date.now();clicks++;button.click();
  }
  function tick(){
   if(dead)return;
   for(const v of document.querySelectorAll('video'))guard(v);
   if(state&&Date.now()-lastState>2500){state={...state,playing:false,visible:false,muted:true};pageState();}
   if(!state){post({type:'ready'});return;}
   sendState();pageState();const video=media();
   if(video&&!video.paused){clicks=0;lastClick=-Infinity;}
   if(state.playing){if(video)start(video);pressPlay(video);}
   else for(const v of document.querySelectorAll('video')){v.muted=true;if(!v.paused)v.pause();}
   status(video);
  }
  window.addEventListener('message',event=>{
   const d=event.data;if(!d||d.channel!==CHANNEL)return;
   if(event.source===window.parent&&d.type==='state'&&typeof d.session==='string'&&typeof d.playing==='boolean'&&typeof d.muted==='boolean'){
    if(state?.session!==d.session){audioLocked=false;clicks=0;childStatus=null;childSeen=-Infinity;lastClick=-Infinity;lastPlay=-Infinity;}
    if(state?.muted!==d.muted||state?.audioRevision!==d.audioRevision)audioLocked=false;
    lastState=Date.now();state={session:d.session,playing:d.playing,visible:d.visible!==false,muted:d.muted,captions:false,audioRevision:Number(d.audioRevision)||0};tick();return;
   }
   const children=frames(),child=children.find(f=>f.contentWindow===event.source);
   if(!child)return;
   if(d.type==='ready'){sendState();return;}
   if(d.type==='status'&&state&&d.session===state.session&&child===largest(children)){
    childSeen=Date.now();childStatus={playing:d.playing===true,time:Number(d.time)||0,buffered:Math.max(0,Number(d.buffered)||0),audioLocked:d.audioLocked===true};status(media());
   }
  });
  window.addEventListener('fantasy-stream-fullscreen',event=>{
   if(state?.playing&&state.visible)chrome.runtime.sendMessage({type:'fullscreen',exit:event.detail?.exit===true}).catch(()=>{});
  });
  // Native fullscreen buttons without a JS API call use the same route.
  document.addEventListener('click',event=>{
   if(!event.isTrusted||!state?.playing||!state.visible)return;
   if(event.target.closest?.('.jw-icon-fullscreen,.vjs-fullscreen-control,[data-plyr="fullscreen"],[data-fullscreen]')){
    event.preventDefault();event.stopImmediatePropagation();chrome.runtime.sendMessage({type:'fullscreen',toggle:true}).catch(()=>{});
   }
  },true);
  const observer=typeof MutationObserver==='function'?new MutationObserver(()=>{for(const v of document.querySelectorAll('video'))guard(v);}):null;
  if(document.documentElement)observer?.observe(document.documentElement,{childList:true,subtree:true});
  const timer=setInterval(()=>{post({type:'ready'});tick();},250);
  window.addEventListener('pagehide',()=>{dead=true;state=null;pageState();clearInterval(timer);observer?.disconnect();});
  post({type:'ready'});
 }).catch(()=>{});
})();
