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
   document.documentElement?.setAttribute('data-fantasy-stream-helper','1');return;
  }
  let state=null,childStatus=null,audioLocked=false,playPending=false,lastPlay=-Infinity,lastClick=-Infinity,clicks=0,dead=false;
  const visible=el=>{const r=el.getBoundingClientRect();return r.width>80&&r.height>45;};
  const largest=elements=>[...elements].filter(visible).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;})[0];
  const frames=()=>[...document.querySelectorAll('iframe')];
  const post=data=>window.parent.postMessage({channel:CHANNEL,...data},'*');
  const sendState=()=>{if(state)for(const f of frames())f.contentWindow?.postMessage({channel:CHANNEL,type:'state',...state},'*');};
  const media=()=>largest(document.querySelectorAll('video'));
  function status(video){
   if(!state)return;
   const own=video?{playing:!video.paused&&!video.ended&&video.readyState>=2,time:video.currentTime,audioLocked}:null;
   post({type:'status',session:state.session,...(own||childStatus||{playing:false,time:0,audioLocked:false})});
  }
  function start(video){
   if(!state?.playing||dead)return;
   video.playsInline=true;video.autoplay=true;
   video.muted=state.muted||audioLocked;
   if(!video.paused||playPending||Date.now()-lastPlay<1000)return;
   lastPlay=Date.now();playPending=true;const session=state.session;
   Promise.resolve().then(()=>{
    if(dead||state?.session!==session||!state.playing)return;
    return video.play();
   }).catch(error=>{
    if(dead||state?.session!==session||!state.playing)return;
    if(error?.name==='NotAllowedError'){
     audioLocked=true;video.muted=true;return video.play().catch(()=>{});
    }
   }).finally(()=>{playPending=false;if(dead||!state?.playing)video.pause();});
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
   if(!state){post({type:'ready'});return;}
   sendState();const video=media();
   if(state.playing){if(video)start(video);pressPlay(video);}
   else for(const v of document.querySelectorAll('video')){v.muted=true;if(!v.paused)v.pause();}
   status(video);
  }
  window.addEventListener('message',event=>{
   const d=event.data;if(!d||d.channel!==CHANNEL)return;
   if(event.source===window.parent&&d.type==='state'&&typeof d.session==='string'&&typeof d.playing==='boolean'&&typeof d.muted==='boolean'){
    if(state?.session!==d.session){audioLocked=false;clicks=0;childStatus=null;lastClick=-Infinity;lastPlay=-Infinity;}
    if(state?.muted!==d.muted||state?.audioRevision!==d.audioRevision)audioLocked=false;
    state={session:d.session,playing:d.playing,muted:d.muted,audioRevision:Number(d.audioRevision)||0};tick();return;
   }
   const children=frames(),child=children.find(f=>f.contentWindow===event.source);
   if(!child)return;
   if(d.type==='ready'){sendState();return;}
   if(d.type==='status'&&state&&d.session===state.session&&child===largest(children)){
    childStatus={playing:d.playing===true,time:Number(d.time)||0,audioLocked:d.audioLocked===true};status(media());
   }
  });
  window.addEventListener('fantasy-stream-fullscreen',event=>{
   if(state?.playing)chrome.runtime.sendMessage({type:'fullscreen',exit:event.detail?.exit===true}).catch(()=>{});
  });
  // Native fullscreen buttons without a JS API call use the same route.
  document.addEventListener('click',event=>{
   if(!event.isTrusted||!state?.playing)return;
   if(event.target.closest?.('.jw-icon-fullscreen,.vjs-fullscreen-control,[data-plyr="fullscreen"],[data-fullscreen]')){
    event.preventDefault();event.stopImmediatePropagation();chrome.runtime.sendMessage({type:'fullscreen',toggle:true}).catch(()=>{});
   }
  },true);
  const timer=setInterval(tick,500);
  window.addEventListener('pagehide',()=>{dead=true;clearInterval(timer);});
  post({type:'ready'});
 }).catch(()=>{});
})();
