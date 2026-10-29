// HLS is loaded only for sources that need it; MP4 replays pay no SDK cost.
let hlsModule;
async function hls(){hlsModule??=import('/hls.light.mjs');return (await hlsModule).default;}
export async function attachMediaSource(video,source,onFatal=()=>{}){
 if(source.type==='provider/ok'){video.src=source.url;video.load();return null;}
 const isHLS=/mpegurl/i.test(source.type||'')||/\.m3u8(?:\?|$)/i.test(source.url);
 if(!isHLS||video.canPlayType('application/vnd.apple.mpegurl')){video.src=source.url;video.load();return null;}
 const Hls=await hls();if(!Hls.isSupported())throw new Error('HLS is unavailable in this browser.');
 const controller=new Hls({enableWorker:true,maxBufferLength:24,maxMaxBufferLength:40,backBufferLength:10,capLevelToPlayerSize:true,startLevel:0,lowLatencyMode:false});
 let recoveries=0;
 controller.on(Hls.Events.ERROR,(_,event)=>{if(!event.fatal)return;if(event.type===Hls.ErrorTypes.MEDIA_ERROR&&recoveries++<1)controller.recoverMediaError();else onFatal();});
 controller.loadSource(source.url);controller.attachMedia(video);return controller;
}
