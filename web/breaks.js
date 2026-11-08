// Break evidence survives compressed replay time and protected scoring plays.
// This consumes feed/player evidence; it does not recognize ads in pixels.
import {F,playWindow} from './archive.js';
import {replayPlayBounds} from './continuity.js';
const STOP=/^(Timeout|Official Timeout|End Period|Two-minute warning|End of Half|End of Regulation)$/;
const CONVERSION=/extra point|two.point|conversion/i;
// Seconds a new play must have been logged before it ends a hold: a stream
// further behind than the delay setting still shows the commercial for a while.
export const RETURN_MARGIN=10;

export function nextFootball(game,types,index){
 return game.plays.slice(index+1).find(p=>p[F.T]>game.plays[index][F.T]&&playWindow(types[p[F.TYPE]],p[F.TEXT])>0&&!CONVERSION.test(types[p[F.TYPE]]));
}
function replayHint(g,game,types,sync,protection,previousAt){
 // A flat anchor interval can remove the scoring row altogether. Detect the
 // crossed score from archive history, without treating old scores at startup
 // as a new break. Explicit seeks reset this history.
 const crossed=previousAt==null?null:game.scores.filter(s=>game.start+s.t>previousAt&&game.start+s.t<=g.sampledAt).at(-1);
 const i=crossed?.i??g.playIndex,p=game.plays[i];if(!p)return null;
 const scored=game.scores.some(s=>s.i===i),type=types[p[F.TYPE]];
 if(!scored&&g.phase!=='break'&&!STOP.test(type))return null;
 const next=nextFootball(game,types,i),until=next?game.start+next[F.T]:game.end;
 const boundary=next?sync.media(next[F.T]):game.recordingDuration??Infinity;
 const finish=scored?replayPlayBounds(game,types,sync,i):protection;
 return {key:i+':'+(scored?'score':'break'),kind:scored?'score':g.breakKind||'stoppage',until,
  releaseMedia:Math.min(finish?.to??sync.media(p[F.T]),boundary)};
}
const situation=g=>[g.lastPlayId||'',g.period||'',g.clock||'',g.possession,g.down].join('|');

export class BreakControl{
 constructor(){this.reset();}
 reset(){this.records=new Map();this.holds=new Map();this.live=new Map();this.positions=new Map();}
 // One game's mapping changed: its evidence goes, and a commercial on another game stays held.
 forget(id){for(const map of [this.records,this.holds,this.live,this.positions])map.delete(id);}
 update({games,at,available,recording=()=>null,syncFor,types=[],currentId=null,media=null,protection=null}){
  const blocked=new Set(),released=new Set(),reasons=new Map();
  for(const g of games){
   if(!available.has(g.id)||g.state!=='in'){this.holds.delete(g.id);this.records.delete(g.id);this.live.delete(g.id);this.positions.delete(g.id);continue;}
   const game=recording(g.id);
   if(game){
    const sync=syncFor(game),position=g.id===currentId&&Number.isFinite(media)?media:sync.media(at-game.start);
    const hint=replayHint({...g,sampledAt:at},game,types,sync,g.id===currentId?protection:null,this.positions.get(g.id));
    this.positions.set(g.id,at);
    let record=this.records.get(g.id);
    // Finish an earlier boundary even if an edit has already jumped to a new
    // play. A newer play must not extend the scoring play's protection.
    const finish=()=>{
     if(record&&!record.done&&position>=record.releaseMedia){
      record.done=true;released.add(g.id);
      if(record.until>at)this.holds.set(g.id,record);
     }
    };
    finish();
    if(hint&&(!record||record.done&&record.key!==hint.key)){record={...hint,done:false};this.records.set(g.id,record);}
    finish();
    const hold=this.holds.get(g.id);
    if(hold&&hold.until<=at)this.holds.delete(g.id);
    else if(hold){blocked.add(g.id);reasons.set(g.id,hold);}
   }else{
    const previous=this.live.get(g.id),key=situation(g),score=g.score||[],scoreKnown=g.scoreKnown!==false;
    const increased=scoreKnown&&previous&&score.some((n,i)=>Number(n)>Number(previous.score[i]??n));
    // A scoreboard score can arrive without a dedicated timeout snapshot.
    // Wait for fresh action evidence, not an arbitrary wall-clock expiry.
    let hold=previous?.hold;
    // A hold taken during the celebration has no baseline yet: the first snapshot after it is the break's starting situation.
    if(hold&&hold.key===null&&!g.celebrating)hold={...hold,key,playId:g.lastPlayId||null};
    // Losing an ID is missing evidence, never evidence of a new play.
    const fresh=hold&&hold.key!==null&&(hold.playId?g.lastPlayId&&hold.playId!==g.lastPlayId:key!==hold.key);
    // A review can overturn the score without replacing its play ID. Retain
    // the pre-touchdown total through PAT updates; 7 -> 6 is not an overturn.
    const overturned=scoreKnown&&hold?.before?.length===score.length&&score.length>0&&score.every((n,i)=>Number(n)<=Number(hold.before[i]));
    const settled=!(g.sinceLogged>=0)||g.sinceLogged>=RETURN_MARGIN;
    if(hold&&!increased&&g.phase!=='break'&&(fresh&&settled||overturned)&&g.possession>=0&&g.down>0)hold=null;
    if(increased||g.phase==='break'&&g.breakKind==='score'){
     hold=g.celebrating?{key:null,playId:null,before:hold?.before??(increased?[...previous.score]:null),kind:'score'}:{key,playId:g.lastPlayId||hold?.playId,before:hold?.before??(increased?[...previous.score]:null),kind:'score'};if(!g.celebrating)released.add(g.id);
    }
    // Every detected break stays covered until fresh football arrives. A disappearing
    // timeout label or an elapsed timer is not evidence that the broadcast returned.
    if(!hold&&g.phase==='break'&&g.lastPlayId)hold={key,playId:g.lastPlayId||null,kind:g.breakKind||'stoppage'};
    // The feed keeps a fresh score on screen for the celebration; the break starts when it says so.
    if((g.phase==='break'||hold)&&!g.celebrating){blocked.add(g.id);released.add(g.id);reasons.set(g.id,hold||{kind:g.breakKind||'stoppage'});}
    this.live.set(g.id,{score:scoreKnown?[...score]:previous?.score||[],hold});
   }
  }
  return {blocked,released,reasons};
 }
}
