import {chooseGame} from './director.js';
const eastern=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'short',day:'numeric'});
const clockFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'});
export const timeLabel=seconds=>clockFormat.format(new Date(seconds*1000));
export function findPlay(plays,relative){
 let low=0,high=plays.length-1,result=-1;
 while(low<=high){const mid=(low+high)>>1;if(plays[mid][0]<=relative){result=mid;low=mid+1;}else high=mid-1;}
 return result;
}
export function sampleGame(game,at,types){
 const index=findPlay(game.plays,at-game.start),p=game.plays[Math.max(0,index)];
 const pre=at<game.start,post=at>game.end,age=index<0?0:at-game.start-p[0];
 const after=age>=8,team=p[after?5:4],down=p[after?7:6],yards=p[after?11:10];
 const next=game.plays[index+1],gap=next?next[0]-p[0]:0;
 const type=types[p[3]],breakTime=after&&((p[14]&3)!==0||/end of|timeout|two.minute/i.test(type)||gap>100&&age>25);
 const halftime=breakTime&&p[1]===2&&next?.[1]===3;
 return {...game,teams:game.teams.map((t,i)=>({...t,score:pre?'0':String(p[12+i])})),state:pre?'pre':post?'post':'in',statusName:halftime?'STATUS_HALFTIME':breakTime?'STATUS_END_PERIOD':'STATUS_IN_PROGRESS',
  phase:breakTime?'between-drives':'scrimmage',possession:!pre&&!post&&team>=0?game.teams[team].id:'',yardsToGoal:yards,down,downDistance:down?`${down}${['','st','nd','rd','th'][down]||'th'} & ${p[after?9:8]}`:'',
  period:p[1],clock:p[2],playType:type,redZone:yards!==null&&yards<=20,detail:pre?'Kickoff '+timeLabel(game.start):post?'Final':halftime?'Halftime':breakTime?'Between plays':`Q${p[1]} · ${p[2]}`,playIndex:index};
}
export class ReplayArchive{
 constructor(data){
  this.data=data;this.games=data.games;this.types=data.types;
  const groups=new Map();
  for(const game of this.games){const key=eastern.format(new Date(game.date));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(game);}
  this.sessions=[...groups].map(([label,games])=>({label,start:Math.min(...games.map(g=>g.start)),end:Math.max(...games.map(g=>g.end)),gameIds:games.map(g=>g.id)}));
  this.events=[...new Set(this.games.flatMap(g=>g.plays.map(p=>g.start+p[0])))].sort((a,b)=>a-b);
 }
 sample(at){return this.games.map(g=>sampleGame(g,at,this.types));}
 nextSwitch(at,roster,currentId,end=Infinity){
  for(const event of this.events){if(event<=at+1||event>end)continue;const best=chooseGame(this.sample(event),roster,currentId,0,event*1000);if(best&&best.game.id!==currentId)return event;}
  return Math.min(end,at+30);
 }
}
export class ReplayClock{
 constructor(at=0){this.at=at;this.running=false;this.rate=1;this.last=null;this.end=Infinity;}
 tick(now){if(this.last!==null&&this.running)this.at=Math.min(this.end,this.at+Math.max(0,now-this.last)/1000*this.rate);this.last=now;if(this.at>=this.end)this.running=false;return this.at;}
 seek(at,now){this.at=at;this.last=now;}
 setRunning(running,now){this.tick(now);this.running=running;}
}
export function mediaTime(game,at,config={}){
 const wall=at-game.start,marks=(config.marks||[]).filter(m=>Number.isFinite(m.wall)&&Number.isFinite(m.media)).sort((a,b)=>a.wall-b.wall);
 if(!marks.length)return Math.max(0,wall+(Number(config.offset)||0));
 if(wall<=marks[0].wall)return Math.max(0,marks[0].media+wall-marks[0].wall);
 const right=marks.findIndex(m=>m.wall>=wall);
 if(right<0){const m=marks.at(-1);return Math.max(0,m.media+wall-m.wall);}
 const a=marks[right-1],b=marks[right],fraction=(wall-a.wall)/(b.wall-a.wall);
 return Math.max(0,a.media+(b.media-a.media)*fraction);
}
export function addSyncMark(config,wall,media){
 if(!Number.isFinite(wall)||!Number.isFinite(media)||media<0)throw new Error('Enter a valid video time.');
 const marks=[...(config.marks||[]).filter(m=>Math.abs(m.wall-wall)>1),{wall,media}].sort((a,b)=>a.wall-b.wall);
 if(marks.some((m,i)=>i&&m.media<marks[i-1].media))throw new Error('Sync marks must move forward in the recording.');
 return {...config,marks};
}
