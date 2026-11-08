// Runs in the provider's main world only after the background service verifies
// the Fantasy Stream top-level tab. No media URLs or browsing data leave it.
(()=>{
 if(window.__fantasyStreamMedia)return;window.__fantasyStreamMedia=true;
 let state=null,seen=-Infinity,dead=false;
 const proto=HTMLMediaElement.prototype,muted=Object.getOwnPropertyDescriptor(proto,'muted'),play=proto.play;
 const silent=()=>!state||Date.now()-seen>2500||!state.playing||!state.visible||state.muted;
 const setMute=(video,value)=>{if(muted?.set)muted.set.call(video,value);else video.muted=value;};
 const tracksOff=video=>{for(const track of video.textTracks||[])if(['captions','subtitles'].includes(track.kind)&&track.mode!=='disabled')track.mode='disabled';};
 // A provider that resets volume during startup cannot make a warming frame
 // audible between our polls. The visible frame still follows the app volume.
 if(muted?.configurable)Object.defineProperty(proto,'muted',{...muted,set(value){muted.set.call(this,silent()||!!value);}});
 proto.play=function(){tracksOff(this);if(silent())setMute(this,true);if(!state?.playing||Date.now()-seen>2500)return Promise.resolve();return play.call(this);};
 function apply(){
  if(dead)return;
  for(const video of document.querySelectorAll('video')){tracksOff(video);if(silent())setMute(video,true);if(!state?.playing||Date.now()-seen>2500)video.pause();}
  // JW renders some subtitles outside TextTrack; use its documented CC API.
  if(typeof window.jwplayer==='function')for(const element of document.querySelectorAll('.jwplayer')){
   try{const player=window.jwplayer(element.id);if(player.getCurrentCaptions?.()!==0)player.setCurrentCaptions?.(0);}catch{}
  }
  // Plyr may render captions from its own selected track.
  for(const video of document.querySelectorAll('video'))try{if(video.plyr?.captions?.active)video.plyr.toggleCaptions(false);}catch{}
 }
 window.addEventListener('fantasy-stream-media-state',event=>{
  try{const next=JSON.parse(event.detail);if(typeof next.playing!=='boolean'||typeof next.muted!=='boolean')return;state=next;seen=Date.now();apply();}catch{}
 });
 const style=document.createElement('style');style.textContent='.jw-captions,.vjs-text-track-display,.plyr__captions{display:none!important} video::cue{opacity:0!important}';
 const mount=()=>{if(document.documentElement&&!style.isConnected)document.documentElement.append(style);};
 mount();document.addEventListener('DOMContentLoaded',mount,{once:true});
 const timer=setInterval(apply,250);
 window.addEventListener('pagehide',()=>{dead=true;clearInterval(timer);});
})();
