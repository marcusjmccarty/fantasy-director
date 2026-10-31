// Remembers what was actually on screen, so every score by one of your
// starters is either seen live or queued as a highlight.
import {rosterCredit,worthReplaying,normalName} from './scoring.js';
const WINDOW=[-3,4];   // seconds around the snap that must have been visible
const SETTLED=9;       // judge a score once the play is over
const identity=s=>JSON.stringify([s.at,s.team,s.kind,!!s.defensive,(s.players||[]).filter(p=>p.role!=='pat').map(p=>[normalName(p.name),p.role]).sort()]);
const replayText=s=>String(s.text||'').replace(/\s*\(.*$/,'').trim().toLowerCase().replace(/\s+/g,' ');

export class Coverage{
 constructor(){this.reset();}
 reset(){this.intervals=new Map();this.judged=new Set();this.queue=[];this.log=[];}
 // Scores before `at` were skipped on purpose (a seek); never replay them.
 skipTo(games,at){for(const g of games)for(const s of g.scores||[])if(s.at<=at)this.judged.add(s.id);this.queue=this.queue.filter(q=>q.at>at);}
 watch(gameId,from,to,maxStep=5){
  if(!gameId||!(to>from)||to-from>maxStep)return;   // a jump is not watching
  let list=this.intervals.get(gameId)||[];const last=list.at(-1);
  if(last&&from<last[0]){
   // A rewind can insert footage before intervals already watched. Keep the
   // union ordered so neither discarded footage nor overlap changes seen().
   const ordered=[...list,[from,to]].sort((a,b)=>a[0]-b[0]);list=[];
   for(const interval of ordered){const end=list.at(-1);if(end&&interval[0]<=end[1]+.6)end[1]=Math.max(end[1],interval[1]);else list.push([...interval]);}
  }else if(last&&from<=last[1]+.6)last[1]=Math.max(last[1],to);else list.push([from,to]);
  if(list.length>400)list.splice(0,list.length-400);this.intervals.set(gameId,list);
 }
 // `slack` widens the window when the snap's exact on-screen moment is uncertain (a live stream's delay).
 seen(gameId,at,slack=0){
  const [a,b]=[at+WINDOW[0],at+WINDOW[1]+slack];let covered=0;
  for(const [x,y] of this.intervals.get(gameId)||[])covered+=Math.max(0,Math.min(b,y)-Math.max(a,x));
  return covered>=(b-a)*.7;
 }
 // Reconcile an authoritative score list before settling new plays. Cosmetic
 // scoreboard/PAT edits update the same item; changed replay matches are retired.
 reconcile(game,previous,roster){
  const current=new Map((game.scores||[]).map(s=>[s.id,s])),invalid=new Set();
  const entries=new Map([...this.log,...this.queue].filter(e=>e.gameId===game.id).map(e=>[e.id,e]));
  for(const old of previous){
   const score=current.get(old.id),entry=entries.get(old.id),credits=score?rosterCredit(score,game,roster):[];
   const same=score&&identity(old)===identity(score),changed=!same||replayText(old)!==replayText(score);
   if(!score||entry&&!credits.length||changed){
    invalid.add(old.id);
    // A yardage edit does not make a watched touchdown unseen.
    if(entry&&credits.length&&same&&(entry.seen||entry.status==='replayed')){
     Object.assign(entry,{score,credits,at:score.at,watchUrl:null});continue;
    }
    this.judged.delete(old.id);this.drop(old.id);this.log=this.log.filter(e=>e.id!==old.id);
   }else if(entry)Object.assign(entry,{score,credits,at:score.at});
  }
  return [...invalid];
 }
 // Returns newly settled roster scores; misses join the queue.
 update(games,roster,at,delay=0,slack=0){
  const fresh=[];
  for(const game of games)for(const s of game.scores||[]){
   if(!Number.isFinite(s.at)||this.judged.has(s.id)||at<s.at+delay+slack+SETTLED)continue;this.judged.add(s.id);
   const credits=rosterCredit(s,game,roster);if(!credits.length)continue;
   const seen=this.seen(game.id,s.at+delay,slack),replay=!seen&&worthReplaying(credits);
   const item={id:s.id,gameId:game.id,gameName:game.name,score:s,credits,at:s.at,queuedAt:at,seen,queued:replay};
   if(replay)this.queue.push(item);
   this.log.unshift(item);this.log=this.log.slice(0,40);fresh.push(item);
  }
  return fresh;
 }
 take(id){const i=this.queue.findIndex(q=>q.id===id);return i<0?null:this.queue.splice(i,1)[0];}
 requeue(item){if(!this.queue.some(q=>q.id===item.id))this.queue.unshift(item);}
 drop(id){this.queue=this.queue.filter(q=>q.id!==id);}
}
