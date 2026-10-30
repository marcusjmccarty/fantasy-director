// Remembers what was actually on screen, so every score by one of your
// starters is either seen live or queued as a highlight.
import {rosterCredit,worthReplaying} from './scoring.js';
const WINDOW=[-3,4];   // seconds around the snap that must have been visible
const SETTLED=9;       // judge a score once the play is over

export class Coverage{
 constructor(){this.reset();}
 reset(){this.intervals=new Map();this.judged=new Set();this.queue=[];this.log=[];}
 // Scores before `at` were skipped on purpose (a seek); never replay them.
 skipTo(games,at){for(const g of games)for(const s of g.scores||[])if(s.at<=at)this.judged.add(s.id);this.queue=this.queue.filter(q=>q.at>at);}
 watch(gameId,from,to,maxStep=5){
  if(!gameId||!(to>from)||to-from>maxStep)return;   // a jump is not watching
  const list=this.intervals.get(gameId)||[],last=list.at(-1);
  if(last&&from<=last[1]+.6)last[1]=Math.max(last[1],to);else list.push([from,to]);
  if(list.length>400)list.splice(0,list.length-400);this.intervals.set(gameId,list);
 }
 seen(gameId,at){
  const [a,b]=[at+WINDOW[0],at+WINDOW[1]];let covered=0;
  for(const [x,y] of this.intervals.get(gameId)||[])covered+=Math.max(0,Math.min(b,y)-Math.max(a,x));
  return covered>=(b-a)*.7;
 }
 // Returns newly settled roster scores; misses join the queue.
 update(games,roster,at,delay=0){
  const fresh=[];
  for(const game of games)for(const s of game.scores||[]){
   if(this.judged.has(s.id)||at<s.at+delay+SETTLED)continue;this.judged.add(s.id);
   const credits=rosterCredit(s,game,roster);if(!credits.length)continue;
   const seen=this.seen(game.id,s.at+delay),replay=!seen&&worthReplaying(credits);
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
