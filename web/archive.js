// Recorded Week 7 slate. Reconstructs what a live feed would report at any
// moment: who has the ball, where, and whether the game is on a live play,
// between snaps, or in a break (TV timeout, quarter end, after a score).
import {alias} from './scoring.js';
export const F={T:0,PERIOD:1,CLOCK:2,TYPE:3,OFFENSE:4,DOWN:5,DISTANCE:6,YTG:7,AWAY:8,HOME:9,TEXT:10};
export const PLAY_SECONDS=7;          // snap to whistle
const SETTLE=15;                      // back from a break this long before the next snap
const LONG_GAP=90;                    // snap-to-snap gaps longer than this are breaks
const STOPPAGE=/^(Timeout|Official Timeout|End Period|Two-minute warning|End of Half|End of Regulation)$/;
const NO_ACTION=/^(Timeout|Official Timeout|End Period|Two-minute warning|End of Half|End of Regulation|End of Game|Penalty)$/;
const SPECIAL=/^(Kickoff|Punt)$/;
const eastern=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'short',day:'numeric'});
const clockFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'});
export const timeLabel=seconds=>clockFormat.format(new Date(seconds*1000));

export function findPlay(plays,rel){
 let low=0,high=plays.length-1,result=-1;
 while(low<=high){const mid=(low+high)>>1;if(plays[mid][0]<=rel){result=mid;low=mid+1;}else high=mid-1;}
 return result;
}
const ordinal=n=>n+(['th','st','nd','rd'][n]||'th');

// The shape shared by replay and live games; the director only sees this.
export function sampleGame(game,at,types){
 const rel=at-game.start,plays=game.plays,i=findPlay(plays,rel),last=game.plays.at(-1);
 const teams=game.teams.map(t=>({...t,abbr:alias(t.abbreviation)}));
 const base={id:game.id,name:game.name,teams,start:game.start,end:game.end,kind:'replay'};
 if(i<0)return {...base,state:'pre',phase:'pre',score:[0,0],possession:-1,detail:'Kickoff '+timeLabel(game.start),scores:[],nextSnapIn:-rel};
 // Rows sharing one timestamp: the football play (if any) is what is happening, the marker says what follows.
 let first=i;while(first>0&&plays[first-1][F.T]===plays[i][F.T])first--;
 const group=plays.slice(first,i+1),p=group.find(r=>!NO_ACTION.test(types[r[F.TYPE]]))||plays[i],marker=plays[i];
 const next=plays[i+1],type=types[p[F.TYPE]],markerType=types[marker[F.TYPE]],age=rel-p[F.T];
 const scores=game.scores.filter(s=>s.t<=rel),tally=scores.at(-1);
 // Never below the scoring summary: ESPN's marker rows can carry a stale pre-conversion tally.
 const score=[Math.max(p[F.AWAY],tally?.away??0),Math.max(p[F.HOME],tally?.home??0)];
 if(!next&&age>20)return {...base,state:'post',phase:'final',score,possession:-1,period:p[F.PERIOD],detail:'Final',scores,lastPlay:marker[F.TEXT]};
 const gap=next?next[F.T]-p[F.T]:Infinity,nextType=next?types[next[F.TYPE]]:'';
 const live=!NO_ACTION.test(type)&&age<PLAY_SECONDS;
 // Between snaps the feed already shows the upcoming situation (past any stoppage rows).
 let k=i+1;while(plays[k]&&STOPPAGE.test(types[plays[k][F.TYPE]]))k++;
 const upcoming=plays[k];
 const s=live||!upcoming?p:upcoming,sType=live||!upcoming?type:types[upcoming[F.TYPE]];
 let phase=live?'play':'live',breakKind=null;
 if(!live&&next){
  const untilSnap=next[F.T]-rel;
  const scored=game.scores.some(x=>x.i===i);
  if(markerType==='End of Half'){phase='break';breakKind='halftime';}
  else if(untilSnap>SETTLE&&STOPPAGE.test(markerType)){phase='break';breakKind=/End Period|End of Regulation/.test(markerType)?'quarter':/Two-minute/.test(markerType)?'two-minute':'timeout';}
  else if(untilSnap>SETTLE&&scored&&age>25){phase='break';breakKind='score';}
  else if(untilSnap>SETTLE&&gap>LONG_GAP&&age>20){phase='break';breakKind=nextType==='Kickoff'?'score':'stoppage';}
 }
 const offense=s[F.OFFENSE],down=s[F.DOWN],ytg=s[F.YTG];
 const period=live?p[F.PERIOD]:(next?.[F.PERIOD]??p[F.PERIOD]);
 // Kickoffs, punts and conversion tries (ESPN down -1) are not drives.
 return {...base,state:'in',phase,breakKind,score,possession:offense,down,distance:s[F.DISTANCE],yardsToGoal:ytg,
  special:SPECIAL.test(sType)||down<=0,period,clock:live?p[F.CLOCK]:(next?.[F.CLOCK]??p[F.CLOCK]),
  detail:phase==='break'?breakLabel(breakKind,period):`Q${period>4?'OT':period} ${live?p[F.CLOCK]:(next?.[F.CLOCK]??'')}`.trim(),
  downDistance:down&&!SPECIAL.test(sType)?`${ordinal(down)} & ${ytg!==null&&s[F.DISTANCE]>=ytg?'Goal':s[F.DISTANCE]}`:'',
  lastPlay:live?p[F.TEXT]:marker[F.TEXT],playType:live?type:markerType,playIndex:first+group.indexOf(p),playAge:age,nextSnapIn:next?next[F.T]-rel:null,scores};
}
function breakLabel(kind,period){return {halftime:'Halftime',quarter:`End of Q${period-1||1}`,'two-minute':'Two-minute warning',timeout:'Timeout',score:'After the score',stoppage:'Break'}[kind]||'Break';}

export class ReplayArchive{
 constructor(data){
  if(data.version!==2)throw new Error('Unsupported archive.');
  this.data=data;this.types=data.types;
  this.games=data.games.map(g=>({...g,scores:g.scores.map(s=>({...s,id:`${g.id}:${s.i}`,at:g.start+s.t}))}));
  const groups=new Map();
  for(const game of this.games){const key=eastern.format(new Date(game.start*1000));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(game);}
  this.sessions=[...groups].map(([label,games])=>({label,start:Math.min(...games.map(g=>g.start))-60,end:Math.max(...games.map(g=>g.end)),gameIds:games.map(g=>g.id)}));
 }
 game(id){return this.games.find(g=>g.id===id);}
 sample(at,ids=null){return (ids?this.games.filter(g=>ids.includes(g.id)):this.games).map(g=>sampleGame(g,at,this.types));}
 session(at){return this.sessions.find(s=>at>=s.start&&at<=s.end)||null;}
}

// Data-only and live playback share this clock; with video, the visible
// recording's playhead drives it instead.
export class Clock{
 constructor(at=0){this.at=at;this.running=false;this.rate=1;this.last=null;this.end=Infinity;}
 tick(now){if(this.last!==null&&this.running)this.at=Math.min(this.end,this.at+Math.max(0,now-this.last)/1000*this.rate);this.last=now;if(this.at>=this.end)this.running=false;return this.at;}
 seek(at,now){this.at=Math.min(this.end,at);this.last=now;}
 set(running,now){this.tick(now);this.running=running;}
}
