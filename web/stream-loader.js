// HLS is loaded only for sources that need it; MP4 replays pay no SDK cost.
let hlsModule,hlsAttempts=0;
// A failed import must not poison the session. A fresh URL also handles
// browsers that retain a failed module fetch; successful imports stay shared.
async function hls(){
 if(!hlsModule){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The video player took too long to download.')),15000);});
  const request=Promise.race([import(hlsAttempts?'/hls.light.mjs?retry='+hlsAttempts:'/hls.light.mjs'),timeout]).catch(error=>{if(hlsModule===request){hlsModule=null;hlsAttempts++;}throw error;}).finally(()=>clearTimeout(timer));
  hlsModule=request;
 }
 return (await hlsModule).default;
}
export async function attachMediaSource(video,source,onFatal=()=>{},{signal}={}){
 if(signal?.aborted)return null;
 if(source.type==='provider/ok'){video.src=source.url;video.load();return null;}
 const isHLS=/mpegurl/i.test(source.type||'')||/\.m3u8(?:\?|$)/i.test(source.url);
 // Chromium builds may answer "maybe" to canPlayType for HLS and then fail; trust hls.js wherever MSE exists.
 const nativeHLS=!('MediaSource' in globalThis)&&video.canPlayType('application/vnd.apple.mpegurl');
 if(!isHLS||nativeHLS){video.src=source.url;video.load();return null;}
 const Hls=await hls();if(signal?.aborted)return null;
 if(!Hls.isSupported()){
  if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=source.url;video.load();return null;}
  throw new Error('HLS is unavailable in this browser.');
 }
 const controller=new Hls({enableWorker:true,maxBufferLength:24,maxMaxBufferLength:40,backBufferLength:10,capLevelToPlayerSize:true,startLevel:0,lowLatencyMode:false,enableCEA708Captions:false,enableWebVTT:false,enableIMSC1:false});
 controller.subtitleDisplay=false;controller.subtitleTrack=-1;
 let recoveries=0;
 controller.on(Hls.Events.ERROR,(_,event)=>{if(signal?.aborted||!event.fatal)return;if(event.type===Hls.ErrorTypes.MEDIA_ERROR&&recoveries++<1)controller.recoverMediaError();else onFatal();});
 controller.loadSource(source.url);controller.attachMedia(video);return controller;
}
