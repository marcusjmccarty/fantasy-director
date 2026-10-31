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
   else if(last.scoringPlay||/touchdown|field goal good/i.test(lastType)){phase='break';breakKind='score';}
   else if(possession<0){phase='break';breakKind='stoppage';}
  }
  return {id:String(e.id),name:e.shortName||e.name||'NFL game',kind:'live',teams,state,phase,breakKind,score:teams.map(t=>t.score),
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
export const SAFE_AFTER_PLAY=18;   // seconds after a logged play before the next snap can be near
export const STALLED_AFTER=75;     // seconds without a new play: the snap is not coming
const KEEP=900;                    // seconds of snapshots kept (the longest delay, with room)
export class LiveFeed{
 constructor(){this.snapshots=[];this.logged=new Map();}
 push(games,at){
  const last=this.snapshots.at(-1);
  for(const g of games){
   const prev=last?.games.find(x=>x.id===g.id);
   if(g.lastPlayId&&(!prev||prev.lastPlayId!==g.lastPlayId)){const list=this.logged.get(g.id)||[];list.push({at,playId:g.lastPlayId});if(list.length>80)list.shift();this.logged.set(g.id,list);}
  }
  this.snapshots.push({at,games});
  while(this.snapshots.length>1&&at-this.snapshots[0].at>KEEP)this.snapshots.shift();
 }
 get latest(){return this.snapshots.at(-1)?.games||[];}
 // The feed as it stood `delay` seconds before `now` (the oldest snapshot while the delay has not elapsed).
 view(now,delay=0){
  const t=now-Math.max(0,delay);
  let snap=null;for(const s of this.snapshots){if(s.at<=t)snap=s;else break;}
  snap??=this.snapshots[0];if(!snap)return [];
  return snap.games.map(g=>{
   if(g.state!=='in'||g.phase!=='live'||!(g.possession>=0))return {...g,sinceLogged:null};
   const logged=(this.logged.get(g.id)||[]).filter(x=>x.at<=t).at(-1);
   const since=logged?t-logged.at:0;
   if(since>SAFE_AFTER_PLAY&&since<=STALLED_AFTER)return {...g,phase:'play',playAge:since-SAFE_AFTER_PLAY,playEndsIn:null,sinceLogged:since};
   return {...g,sinceLogged:since};
  });
 }
}
// Scoring plays with the wallclock of the snap, from a game summary.
export function liveScores(summary,game){
 const plays=[...(summary.drives?.previous||[]),summary.drives?.current].filter(Boolean).flatMap(d=>d.plays||[]);
 const at=new Map(plays.filter(p=>p.wallclock).map(p=>[String(p.id),{at:Date.parse(p.wallclock)/1000,offense:p.start?.team?.id}]));
 return (summary.scoringPlays||[]).map(s=>{
  const when=at.get(String(s.id));if(!when)return null;
  const team=game.teams.findIndex(t=>t.id===String(s.team?.id)),offense=game.teams.findIndex(t=>t.id===String(when.offense??''));
  const parsed=parseScoringPlay(s.text,s.type?.text,s.scoringType?.name);
  return {id:`${game.id}:${s.id}`,at:when.at,team,kind:parsed.kind,defensive:parsed.defensive||team>=0&&offense>=0&&team!==offense,text:String(s.text||'').trim(),players:parsed.players,away:s.awayScore,home:s.homeScore,period:s.period?.number||0,clock:s.clock?.displayValue||''};
 }).filter(Boolean);
}
