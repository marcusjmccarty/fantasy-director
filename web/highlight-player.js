let apiPromise;
function youtubeAPI(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(!apiPromise)apiPromise=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{apiPromise=null;reject(new Error('YouTube did not respond.'));},12000);
  window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve(window.YT);};
  const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.referrerPolicy='strict-origin-when-cross-origin';script.onerror=()=>{clearTimeout(timer);apiPromise=null;reject(new Error('Could not load YouTube.'));};document.head.append(script);
 });
 return apiPromise;
}
export class HighlightPlayer{
 constructor(host,{ended=()=>{},status=()=>{}}={}){this.host=host;this.ended=ended;this.status=status;this.player=null;this.generation=0;this.muted=true;this.visible=false;this.timer=null;this.observer=null;}
 async play(clip,muted=true){
  this.stop();const generation=this.generation;this.muted=muted;this.host.hidden=false;this.status('Loading the official NFL player…');
  try{
   const YT=await youtubeAPI();if(generation!==this.generation)return;
   const mount=document.createElement('div');this.host.replaceChildren(mount);
   // No hidden autoplay/prebuffer: YouTube requires a visible player.
   this.observer=new IntersectionObserver(entries=>{this.visible=entries[0]?.intersectionRatio>=.5;if(!this.visible)this.player?.pauseVideo?.();},{threshold:[.5]});this.observer.observe(this.host);
   this.player=new YT.Player(mount,{host:'https://www.youtube-nocookie.com',videoId:clip.youtubeId,width:'100%',height:'100%',playerVars:{playsinline:1,origin:location.origin,rel:0},events:{
    onReady:e=>{if(generation!==this.generation)return;const frame=e.target.getIframe();frame.referrerPolicy='strict-origin-when-cross-origin';if(this.muted)e.target.mute();else e.target.unMute();const box=this.host.getBoundingClientRect(),visible=Math.max(0,Math.min(box.bottom,innerHeight)-Math.max(0,box.top))*Math.max(0,Math.min(box.right,innerWidth)-Math.max(0,box.left));if(!document.hidden&&visible>=box.width*box.height*.5)e.target.playVideo();this.status('Official NFL highlight · YouTube controls playback.');},
    onStateChange:e=>{if(generation!==this.generation)return;if(e.data===0)this.ended();if(e.data===1)this.status('Playing official NFL highlight');if(e.data===3)this.status('The highlight provider is buffering. Return to game is available.');},
    onAutoplayBlocked:()=>this.status('Press play inside the official NFL player.'),
    onError:()=>{if(generation===this.generation){this.status('This official highlight cannot be embedded here. Returning to the game.');this.ended();}}
   }});
   this.timer=setTimeout(()=>{if(generation===this.generation)this.ended();},120000);
  }catch(error){if(generation===this.generation){this.status(error.message);this.ended();}}
 }
 setMuted(muted){this.muted=muted;if(muted)this.player?.mute?.();else this.player?.unMute?.();}
 pause(){this.player?.pauseVideo?.();}
 stop(){this.generation++;clearTimeout(this.timer);this.observer?.disconnect();this.player?.destroy?.();this.player=null;this.host.replaceChildren();this.host.hidden=true;}
}
