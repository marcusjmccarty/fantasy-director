// Compare healthy-stream decisions with the pre-review implementation.
// Usage: node scripts/audit-director.mjs [git-ref]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Director} from '../web/director.js';
const ref=process.argv[2]||'22d3d1d031fa3adf9b9b61e658c387271cbc31bf';
const original=execFileSync('git',['show',`${ref}:web/director.js`],{encoding:'utf8'})
 .replace("'./scoring.js'",JSON.stringify(new URL('../web/scoring.js',import.meta.url).href));
const {Director:Original}=await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'));
const roster=[{name:'Jonathan Taylor',team:'IND',position:'RB'},{name:'CeeDee Lamb',team:'DAL',position:'WR'},{name:'Brandon Aubrey',team:'DAL',position:'K'},{name:'Steelers D/ST',team:'PIT',position:'D/ST'}];
const game=(id,away,home)=>({id,name:`${away} at ${home}`,teams:[{abbr:away},{abbr:home}],state:'in',phase:'live',possession:0,down:1,distance:10,yardsToGoal:50,special:false,nextSnapIn:30,scores:[]});
let seed=1729,comparisons=0,intentionalBreakRecoveries=0;
const pick=values=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return values[Math.floor(seed/4294967296*values.length)];};
for(let scenario=0;scenario<10000;scenario++){
 const before=new Original(),after=new Director();before.committed(990);after.committed(990);
 let current={kind:pick(['game','standby','highlight']),id:pick(['A','B','C'])},at=1000;
 for(let frame=0;frame<6;frame++){
  const games=[game('A','IND','MIN'),game('B','DAL','NYG'),game('C','SEA','PIT')].map(g=>{
   const phase=pick(['live','live','play','break','pre','final']);return {...g,phase,state:phase==='pre'?'pre':phase==='final'?'post':'in',possession:pick([-1,0,1]),down:pick([0,1,3,4]),distance:pick([1,3,10]),yardsToGoal:pick([null,5,20,35,50,80]),special:pick([false,false,false,true]),nextSnapIn:pick([null,0,4,10,30])};
  });
  const excluded=new Set(games.filter(g=>g.id!==current.id&&pick([false,false,true])).map(g=>g.id));
  const scoring=pick([null,'A','B']),queue=pick([[],[{id:'score',queuedAt:at-pick([0,5,30,90])}]]);
  const input={games,roster,at,current,excluded,queue,includeDefense:pick([false,true]),recentScore:g=>g.id===scoring};
  // Compare the same input and decision history. New break recovery changes
  // subsequent cut times; those trajectory differences are exercised by the
  // full-day simulation, not mistaken for isolated policy changes here.
  after.lastCut=before.lastCut;after.challenger=before.challenger?{...before.challenger}:null;
  const a=before.decide(input),b=after.decide(input);
  if(JSON.stringify(b)!==JSON.stringify(a)){
   const was=games.find(g=>g.id===a.id);
   assert.ok(current.kind==='game'&&a.id===current.id&&was?.phase==='break'&&was.state==='in');
   assert.ok(b.kind==='game'&&b.entry.tier===0&&b.entry.game.phase!=='break'&&b.entry.game.state==='in'&&!excluded.has(b.id));
   intentionalBreakRecoveries++;
  }else assert.deepEqual(b,a);
  assert.deepEqual(after.challenger,before.challenger);comparisons++;
  if(a.kind==='game'&&(current.kind!=='game'||current.id!==a.id)){before.committed(at);after.committed(at);}
  current={kind:a.kind,id:a.id};at+=pick([.25,1,2,10]);
 }
}
// Negative controls: the old implementation must exhibit the two exclusion bugs.
const g=game('A','IND','MIN');
for(const scored of [false,true]){
 const input={games:[g],roster,at:1000,current:{kind:'game',id:'A'},excluded:new Set(['A']),recentScore:()=>scored};
 assert.equal(new Original().decide(input).kind,'game');assert.equal(new Director().decide(input).kind,'standby');
}
console.log(JSON.stringify({baseline:ref,healthyStreamComparisons:comparisons,unexpectedDifferences:0,intentionalBreakRecoveries,reproducedExclusionBugs:2}));
