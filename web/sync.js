// Maps game time to a position in a full-game recording and back.
//
// The recordings edit down many breaks, but can still contain commercials.
// This model estimates retained footage rather than detecting it. Ordinary
// snap-to-snap gaps map one-to-one, while each break (TV timeout, quarter
// end, after a score, before a kickoff) keeps only `keep` seconds: half right
// after the play, half leading into the next snap. Scorebug anchors pin the
// curve; between two anchors `keep` is solved so both are hit exactly.
const STOPPAGE=/^(Timeout|Official Timeout|End Period|Two-minute warning|End of Half|End of Regulation)$/;
const LONGEST_PLAY_GAP=100;

export class RecordingSync{
 constructor(game,{types=[],duration=game.recordingDuration,anchors=[],tail=20}={}){
  this.game=game;this.duration=Number(duration)||0;
  const plays=game.plays,scored=new Set((game.scores||[]).map(s=>s.i));
  this.times=plays.map(p=>p[0]);
  this.breaks=plays.map((p,i)=>{
   const next=plays[i+1];if(!next)return false;const gap=next[0]-p[0],type=types[p[3]]||'',nextType=types[next[3]]||'';
   return STOPPAGE.test(type)||scored.has(i)||nextType==='Kickoff'&&gap>60||gap>150;
  });
  this.base=solveKeep(this,0,this.times.at(-1),this.duration-tail);
  // Keep the anchors monotonic even if one was misread: each must advance past the last one kept.
  const points=[];
  for(const a of anchors.filter(a=>Number.isFinite(a.wall)&&Number.isFinite(a.media)).sort((a,b)=>a.wall-b.wall)){
   const last=points.at(-1);if(!last||a.media>last.media&&a.wall>last.wall)points.push(a);
  }
  this.segments=[];
  for(let k=0;k+1<points.length;k++){const a=points[k],b=points[k+1];this.segments.push({a,b,...solveKeep(this,a.wall,b.wall,b.media-a.media)});}
  this.anchors=points;this.calibrated=points.length>0;
  const fair=this.segments.filter(x=>x.factor===1);
  this.edgeKeep=fair.length?fair.reduce((sum,x)=>sum+x.keep,0)/fair.length:this.base.keep;
 }
 // Seconds of footage between two game times for a given break retention.
 span(from,to,keep){
  if(to===from)return 0;if(to<from)return -this.span(to,from,keep);
  const t=this.times;let total=0;
  if(from<t[0]){total+=Math.min(t[0],to)-from;from=t[0];if(to<=from)return total;}
  let i=index(t,from);
  while(from<to){
   const end=t[i+1]??Infinity,stop=Math.min(to,end);
   total+=gapContent(this,i,stop-t[i],keep)-gapContent(this,i,from-t[i],keep);
   from=stop;i++;
  }
  return total;
 }
 media(rel){
  const segs=this.segments,a=this.anchors;
  let m;
  if(!a.length)m=this.span(0,rel,this.base.keep)*this.base.factor;
  else if(rel<=a[0].wall)m=a[0].media-this.span(rel,a[0].wall,this.edgeKeep);
  else if(rel>=a.at(-1).wall)m=a.at(-1).media+this.span(a.at(-1).wall,rel,this.edgeKeep);
  else{const s=segs.find(s=>rel<=s.b.wall);m=s.a.media+this.span(s.a.wall,rel,s.keep)*s.factor;}
  return clamp(m,this.duration);
 }
 // Inverse: where the recording is in game time. A break collapses to its edges.
 wall(media){
  let low=-3600,high=this.times.at(-1)+60;
  for(let k=0;k<44;k++){const mid=(low+high)/2;if(this.media(mid)<media)low=mid;else high=mid;}
  return high;
 }
}
function index(t,rel){let low=0,high=t.length-1,i=0;while(low<=high){const mid=(low+high)>>1;if(t[mid]<=rel){i=mid;low=mid+1;}else high=mid-1;}return i;}
function gapContent(sync,i,elapsed,keep){
 const t=sync.times,next=t[i+1];
 if(next===undefined)return elapsed;
 const gap=next-t[i];if(gap<=0)return 0;
 if(!sync.breaks[i]){const kept=Math.min(gap,LONGEST_PLAY_GAP);return elapsed*kept/gap;}
 if(gap<=keep)return elapsed;
 const half=keep/2;return Math.min(elapsed,half)+Math.max(0,elapsed-(gap-half));
}
// Break retention that makes [from,to] fill `target` seconds of footage. When
// even dropping every break is too long (or keeping all is too short), the
// segment is scaled uniformly instead.
function solveKeep(sync,from,to,target){
 let low=0,high=1200;
 const at=keep=>sync.span(from,to,keep);
 if(at(low)>=target)return {keep:low,factor:target/Math.max(1e-3,at(low))};
 if(at(high)<=target)return {keep:high,factor:target/Math.max(1e-3,at(high))};
 for(let k=0;k<40;k++){const mid=(low+high)/2;if(at(mid)>target)high=mid;else low=mid;}
 return {keep:low,factor:1};
}
function clamp(value,duration){return Math.max(0,duration>0?Math.min(duration-.5,value):value);}

export function addMark(marks,wall,media){
 if(!Number.isFinite(wall)||!Number.isFinite(media)||media<0)throw new Error('Enter a valid video time.');
 const next=[...marks.filter(m=>Math.abs(m.wall-wall)>5),{wall,media}].sort((a,b)=>a.wall-b.wall);
 if(next.some((m,i)=>i&&m.media<=next[i-1].media))throw new Error('Sync marks must move forward in the recording.');
 return next;
}

// Viewer marks outrank automatic readings. Discard only built-in anchors that
// would contradict those marks; the recording interpolation itself is unchanged.
export function mergeAnchors(automatic,manual){
 const marks=[];
 for(const m of manual.filter(m=>Number.isFinite(m?.wall)&&Number.isFinite(m?.media)&&m.media>=0).sort((a,b)=>a.wall-b.wall)){
  const last=marks.at(-1);if(!last||m.wall>last.wall&&m.media>last.media)marks.push(m);
 }
 return [...automatic.filter(a=>marks.every(m=>a.wall<m.wall?a.media<m.media:a.wall>m.wall&&a.media>m.media)),...marks].sort((a,b)=>a.wall-b.wall);
}

// Game-time window during which the scorebug shows this quarter and clock.
// A running clock pins a single second. A stopped clock (the value the next
// snap starts from) shows from the moment it stopped until that snap, so the
// window spans the whole stoppage.
export function clockSpan(game,period,clock){
 const m=/^(\d{1,2}):([0-5]\d)$/.exec(String(clock).trim());if(!m)throw new Error('Enter the game clock as m:ss.');
 const target=Number(m[1])*60+Number(m[2]);
 if(target>15*60)throw new Error('The game clock must be between 0:00 and 15:00.');
 const secs=c=>{const [a,b]=String(c).split(':').map(Number);return a*60+b;};
 const rows=game.plays.filter(p=>p[1]===Number(period));
 if(!rows.length)throw new Error('No plays in that quarter.');
 const same=k=>{let j=k;while(rows[j+1]&&secs(rows[j+1][2])===target)j++;return rows[j][0];};   // last snap showing this clock
 for(let k=0;k<rows.length;k++){
  const here=secs(rows[k][2]),next=rows[k+1];
  if(here===target)return {lo:rows[k][0],hi:same(k)};
  if(here<target)return {lo:rows[k][0]-(target-here),hi:rows[k][0]-(target-here)};   // before this quarter's first snap
  if(!next){const w=rows[k][0]+(here-target);return {lo:w,hi:w};}
  const stop=secs(next[2]);
  if(target>stop){const w=rows[k][0]+(here-target);return {lo:w,hi:w};}
  if(target===stop)return {lo:rows[k][0]+Math.min(here-target,next[0]-rows[k][0]),hi:same(k+1)};
 }
 return {lo:rows.at(-1)[0],hi:rows.at(-1)[0]};
}
// Game time for a reading taken at a snap (the viewer paused on one): a
// stopped clock resolves to the snap that starts it running again.
export function wallForClock(game,period,clock){return clockSpan(game,period,clock).hi;}
