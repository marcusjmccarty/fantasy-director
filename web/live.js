// ESPN's public scoreboard and game summaries, normalized to the same game
// state the replay archive produces, so the director cannot tell them apart.
import {alias,parseScoringPlay} from './scoring.js';
const STOPPAGE=/timeout|end period|end of (half|quarter|regulation)|two.minute/i;

export function yardsFromText(text,teams,possession){
 const raw=String(text||'').trim();if(raw==='50')return 50;
 const m=/^([A-Z]{2,4})\s+(\d{1,2})$/.exec(raw);
 if(!m||possession<0)return null;
 const side=teams.findIndex(t=>t.abbr===alias(m[1]));if(side<0)return null;
 return Number(m[2])===50?50:side===possession?100-Number(m[2]):Number(m[2]);
}
export function liveGames(raw,nowSeconds=Date.now()/1000){
 if(!Array.isArray(raw?.events))throw new Error('Unexpected NFL scoreboard format.');
 return raw.events.map(e=>{
  const c=e.competitions?.[0]||{},s=c.situation||{},status=c.status||e.status||{},type=status.type||{};
  const ordered=[...(c.competitors||[])].sort((a,b)=>(a.homeAway==='away'?0:1)-(b.homeAway==='away'?0:1));
  // Display defaults must not be treated as evidence of a score correction.
  const scoreKnown=ordered.length===2&&ordered.every(t=>['number','string'].includes(typeof t.score)&&String(t.score).trim()!==''&&Number.isFinite(Number(t.score))&&Number(t.score)>=0);
  const teams=ordered.map(t=>({id:String(t.team?.id||t.id),abbreviation:t.team?.abbreviation||'?',abbr:alias(t.team?.abbreviation||'?'),name:t.team?.displayName||'',score:Number(t.score||0)}));
  const possession=teams.findIndex(t=>t.id===String(s.possession?.id??s.possession??''));
  const state=type.completed?'post':type.state||'pre';
  const last=s.lastPlay||{},lastType=last.type?.text||'',lastPlayId=String(last.id||'');
  const down=Number(s.down||0),explicit=Number(s.yardsToEndzone);
  const ytg=Number.isFinite(explicit)&&explicit>0&&explicit<=100?explicit:yardsFromText(s.possessionText,teams,possession);
  let phase=state==='post'?'final':state==='pre'?'pre':'live',breakKind=null;
  if(state==='in'){
   if(/HALFTIME/.test(type.name||'')){phase='break';breakKind='halftime';}
   else if(/END_PERIOD/.test(type.name||'')){phase='break';breakKind='quarter';}
   else if(STOPPAGE.test(lastType)){phase='break';breakKind='timeout';}
   else if(last.scoringPlay||/touchdown|field goal good|safety/i.test(lastType)){phase='break';breakKind='score';}
   else if(possession<0){phase='break';breakKind='stoppage';}
  }
  return {id:String(e.id),name:e.shortName||e.name||'NFL game',kind:'live',teams,state,phase,breakKind,score:teams.map(t=>t.score),scoreKnown,
   possession,down,distance:Number(s.distance||0),yardsToGoal:ytg,special:down<=0||/kickoff|punt/i.test(lastType)&&down<=0,
   period:Number(status.period||0),clock:status.displayClock||'',detail:type.shortDetail||'',downDistance:s.shortDownDistanceText||'',
   lastPlay:last.text||'',lastPlayId,playType:lastType,nextSnapIn:null,date:e.date,season:Number(raw.season?.year||e.season?.year)||null,week:Number(raw.week?.number||e.week?.number)||null,scores:[],fetchedAt:nowSeconds};
 }).filter(g=>g.teams.length===2);
}
// A live feed seen through the stream's delay. The director acts on the
// scoreboard as it stood when the picture on screen happened, so a drive is
// followed as the viewer sees it rather than spoiled by data that runs ahead.
// ESPN logs a play only after the whistle: a new entry means the play just
// ended on screen, the next snap follows within the play clock, and the gap
// between is the only safe time to cut away. A game that goes quiet for much
// longer than a play clock is stalled (injury, review), not snapping.
// ESPN also keeps a timeout as "the last play" until the next whistle, and
// drops possession for a snapshot or two around kicks; the feed reads the
// clock and its own history so neither looks like a long break.
export const SAFE_AFTER_PLAY=18;   // seconds after a logged play before the next snap can be near
export const STALLED_AFTER=75;     // seconds without a new play: the snap is not coming
export const TEMPO=30;             // logged plays this close together mean a hurry-up offense: the safe window shrinks
export const CELEBRATION=20;       // seconds a fresh score stays on screen before the game is a break
export const STOPPAGE_GRACE=12;    // a possession missing for less than this is a gap in the feed, not a stoppage
export const STOPPAGE_MAX=180;     // a logged stoppage with no sign of football since is over
const KEEP=900;                    // seconds of snapshots kept (the longest delay, with room)
const clockSeconds=c=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(c||'').trim());return m?Number(m[1])*60+Number(m[2]):null;};
export class LiveFeed{
 constructor(){this.snapshots=[];this.logged=new Map();this.scored=new Map();this.resumed=new Map();this.lost=new Map();}
 push(games,at){
  const last=this.snapshots.at(-1);
  const note=(map,id,event,limit=80)=>{const list=map.get(id)||[];list.push(event);if(list.length>limit)list.shift();map.set(id,list);};
  for(const g of games){
   const prev=last?.games.find(x=>x.id===g.id);
   if(!prev)continue;   // the first sighting says nothing about when anything happened
   if(g.lastPlayId&&prev.lastPlayId!==g.lastPlayId)note(this.logged,g.id,{at,playId:g.lastPlayId});
   // A score increase starts the celebration; the extra point that follows it does not start another.
   const gained=(g.score||[]).reduce((sum,n,i)=>sum+Math.max(0,Number(n)-Number(prev.score?.[i]??n)),0);
   if(g.scoreKnown!==false&&prev.scoreKnown!==false&&gained>0&&!(gained===1&&at-(this.scored.get(g.id)?.at(-1)?.at??-Infinity)<CELEBRATION+15))note(this.scored,g.id,{at},40);
   // The clock ran down within the same period while no new play was logged: football is back after a stoppage.
   const was=clockSeconds(prev.clock),now=clockSeconds(g.clock);
   if(g.state==='in'&&g.lastPlayId&&g.lastPlayId===prev.lastPlayId&&g.period===prev.period&&was!==null&&now!==null&&now<=was-2)note(this.resumed,g.id,{at,playId:g.lastPlayId},40);
   if(!(g.possession>=0)&&prev.possession>=0)note(this.lost,g.id,{at},40);
  }
  this.snapshots.push({at,games});
  while(this.snapshots.length>1&&at-this.snapshots[0].at>KEEP)this.snapshots.shift();
 }
 get latest(){return this.snapshots.at(-1)?.games||[];}
 // The feed as it stood `delay` seconds before `now` (the oldest snapshot while the delay has not elapsed).
 view(now,delay=0){
  const t=now-Math.max(0,delay);
  let index=-1;for(let i=0;i<this.snapshots.length;i++){if(this.snapshots[i].at<=t)index=i;else break;}
  if(!this.snapshots.length)return [];
  if(index<0)index=0;
  const snap=this.snapshots[index];
  const before=(map,id)=>(map.get(id)||[]).filter(x=>x.at<=t).at(-1)||null;
  return snap.games.map(g=>{
   if(g.state!=='in')return {...g,sinceLogged:null};
   const logged=before(this.logged,g.id),since=logged?t-logged.at:null,out={...g,sinceLogged:since};
   // A fresh score is still on screen: the celebration, the replay, the try. Nobody's offense is on the field, and it is not a break yet.
   const score=before(this.scored,g.id);
   if(score&&t-score.at<CELEBRATION)return {...out,phase:'live',breakKind:null,celebrating:true,possession:-1,special:true};
   if(g.phase==='break'&&g.breakKind==='timeout'){
    const resumed=before(this.resumed,g.id),stoppedAt=logged?.playId===g.lastPlayId?logged.at:null;
    if(resumed&&resumed.playId===g.lastPlayId&&(stoppedAt===null||resumed.at>stoppedAt)){
     const age=t-resumed.at;
     return age<=STALLED_AFTER?{...out,phase:'play',breakKind:null,playAge:age,playEndsIn:null,synthesized:true}:{...out,phase:'live',breakKind:null};
    }
    if(stoppedAt!==null&&t-stoppedAt>STOPPAGE_MAX)return {...out,phase:'live',breakKind:null};
    return out;
   }
   if(g.phase==='break'&&g.breakKind==='stoppage'){
    // A possession that vanished seconds ago is a gap in the feed: keep the last known situation.
    const lost=before(this.lost,g.id);
    if(lost&&t-lost.at<STOPPAGE_GRACE)for(let i=index;i>=0;i--){const p=this.snapshots[i].games.find(x=>x.id===g.id);if(p&&p.possession>=0&&p.phase!=='break')return {...out,phase:p.phase,breakKind:null,possession:p.possession,down:p.down,distance:p.distance,yardsToGoal:p.yardsToGoal,downDistance:p.downDistance,special:p.special};}
    return out;
   }
   if(out.phase!=='live'||!(out.possession>=0))return out;
   // In tempo the next snap comes well inside the play clock: the window to cut away shrinks with the offense's cadence.
   const recent=(this.logged.get(g.id)||[]).filter(x=>x.at<=t).slice(-3),gaps=recent.slice(1).map((x,i)=>x.at-recent[i].at),cadence=gaps.length?Math.min(...gaps):Infinity;
   const safe=cadence<TEMPO?Math.max(5,cadence-8):SAFE_AFTER_PLAY;
   if(since!==null&&since>safe&&since<=STALLED_AFTER)return {...out,phase:'play',playAge:since-safe,playEndsIn:null,synthesized:true,safeWindow:safe};
   return {...out,safeWindow:safe};
  });
 }
}
// Scoring plays with the wallclock of the snap, from a game summary.
export function liveScores(summary,game,previous=[]){
 // Missing fields are not an authoritative removal. An explicit empty list is.
 if(!Array.isArray(summary?.scoringPlays))return previous;
 const plays=[...(Array.isArray(summary.drives?.previous)?summary.drives.previous:[]),summary.drives?.current].filter(Boolean).flatMap(d=>Array.isArray(d.plays)?d.plays:[]);
 const at=new Map(plays.filter(p=>p?.wallclock&&Number.isFinite(Date.parse(p.wallclock))).map(p=>[String(p.id),{at:Date.parse(p.wallclock)/1000,offense:p.start?.team?.id}]));
 const known=new Map(previous.map(s=>[s.id,s]));
 return summary.scoringPlays.map(s=>{
  if(s?.id===undefined||s.id===null)return null;
  const id=`${game.id}:${s.id}`,old=known.get(id),when=at.get(String(s.id)),time=when?.at??old?.at;if(!Number.isFinite(time))return null;
  const team=game.teams.findIndex(t=>t.id===String(s.team?.id)),offense=game.teams.findIndex(t=>t.id===String(when?.offense??''));
  const parsed=parseScoringPlay(s.text,s.type?.text,s.scoringType?.name);
  const retainedDefense=offense<0&&old?.defensive&&old.team===team&&old.kind===parsed.kind&&old.text.replace(/\s*\(.*$/,'')===String(s.text||'').trim().replace(/\s*\(.*$/,'');
  return {id,at:time,team,kind:parsed.kind,defensive:!!(parsed.defensive||team>=0&&offense>=0&&team!==offense||retainedDefense),text:String(s.text||'').trim(),players:parsed.players,away:s.awayScore,home:s.homeScore,period:s.period?.number||0,clock:s.clock?.displayValue||''};
 }).filter(Boolean);
}
