// Feed timestamps and recording anchors are estimates, not whistle detection.
// Protect football in *video seconds*: compressed wall time must not shorten it.
import {F,playWindow,sampleGame} from './archive.js';
import {involvement} from './director.js';

export function replayPlayBounds(game,types,sync,index){
 const p=game.plays[index],window=p&&playWindow(types[p[F.TYPE]],p[F.TEXT]);if(!window)return null;
 // Honor both minimum video time and the mapped end, with a finite cap for
 // expanded anchor intervals. These estimates cannot identify a whistle.
 const from=sync.media(p[F.T]),seconds=game.scores.some(s=>s.i===index)?32:Math.max(20,window+6);
 return {index,from,to:Math.max(from+seconds,Math.min(from+60,sync.media(p[F.T]+window)+8))};
}
export function protectedReplayPlay(game,types,sync,media,roster,{includeDefense=true,allAction=false}={}){
 if(!Number.isFinite(media))return null;
 for(let i=game.plays.length-1;i>=0;i--){
  const p=game.plays[i],window=playWindow(types[p[F.TYPE]],p[F.TEXT]);
  if(!window)continue;
  const bounds=replayPlayBounds(game,types,sync,i),{from,to}=bounds;
  if(from>media)continue;
  if(media>=to)continue;
  const snap=sampleGame(game,game.start+p[F.T]+.01,types);
  if(allAction||involvement(snap,roster,{includeDefense}).length)return bounds;
 }
 return null;
}

export function protectedHighlight(h,player){
 if(!h?.playing||h.done||h.src.data||player?.inAd)return false;
 const actual=Number.isFinite(player?.duration)&&player.duration>0?player.duration:0;
 const duration=h.src.fullClip?(actual||h.src.duration):h.src.duration;
 // Finish short clips once revealed. Long/unknown footage gets a bounded
 // opening; a stalled player still reaches the existing recovery watchdog.
 return duration>0&&duration<=90||Number.isFinite(player?.currentTime)&&player.currentTime<(h.src.start||0)+30;
}

export function broadcastReplayWindow(item,game,sync){
 const snap=sync.media(item.at-game.start);
 // Start/end both use media time. Subtracting wall seconds and then treating
 // their difference as video duration could truncate an expanded segment.
 // ESPN timestamps/clock readings can describe the end of a scoring play.
 // Include the preceding boundary, bounded to 45 seconds of lead-in, instead
 // of assuming the interpolated score timestamp is an exact snap.
 const previous=game.plays?.[item.score?.i-1];
 const lead=previous?Math.min(snap-15,sync.media(previous[F.T])-3):snap-15;
 const start=Math.max(0,snap-45,lead),end=Math.min(game.recordingDuration||Infinity,snap+32);
 return {start,duration:end-start};
}
