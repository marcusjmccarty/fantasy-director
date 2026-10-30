// A deterministic full-Sunday rehearsal: the recorded Week 7 slate
// (web/week7.json via ReplayArchive) is stepped one second at a time with a
// roster spread across several games, driving Director.decide and
// Coverage.watch/update the way web/app.js does in data-only mode. The
// assertions encode the product intent (only roster games, offense over
// D/ST, whistle before cutting, kicker rules, celebration hold, missed scores
// replayed at quiet moments) rather than the trace itself. No timers, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ReplayArchive,PLAY_SECONDS} from '../web/archive.js';
import {Director,RULES,KICK_RANGE,rank,rate,involvement,hasRoster,rosterTeams} from '../web/director.js';
import {Coverage} from '../web/coverage.js';
import {rosterCredit,worthReplaying} from '../web/scoring.js';

const week7=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
const archive=new ReplayArchive(week7);
const SUNDAY=archive.sessions[1];
const IDS=SUNDAY.gameIds;
const rel=at=>at-SUNDAY.start;           // seconds since the session opened (readable in failures)
const sample=(id,at)=>archive.sample(at,[id])[0];

// Game ids on the Sunday slate.
const IND_MIN='401873014',CIN_BAL='401873012',CLE_TEN='401873013',TB_CAR='401873018',GB_DET='401873020';
const PIT_NO='401873011',SF_ATL='401873017',NYG_HOU='401873016',MIA_NYJ='401873015',DEN_ARI='401873019',LAR_LV='401873021',KC_SEA='401873022';
const NO_ROSTER_GAMES=[PIT_NO,SF_ATL,NYG_HOU,MIA_NYJ,DEN_ARI,LAR_LV,KC_SEA];

const ROSTER=[
 {name:'Jonathan Taylor',team:'IND',position:'RB'},
 {name:"Ja'Marr Chase",team:'CIN',position:'WR'},
 {name:'Zay Flowers',team:'BAL',position:'WR'},
 {name:'Jameson Williams',team:'DET',position:'WR'},
 {name:'Will Reichard',team:'MIN',position:'K'},
 {name:'Buccaneers D/ST',team:'TB',position:'D/ST'},
 {name:'Tony Pollard',team:'TEN',position:'RB'},
];
// A bigger lineup (more games, more misses) used to force replay pre-emption.
const BIG_ROSTER=[...ROSTER,
 {name:'Joe Burrow',team:'CIN',position:'QB'},{name:'Bijan Robinson',team:'ATL',position:'RB'},
 {name:'Nico Collins',team:'HOU',position:'WR'},{name:'Christian McCaffrey',team:'SF',position:'RB'},{name:'Jets D/ST',team:'NYJ',position:'D/ST'}];
// The 13 scoring plays that credit the default roster (from the archive).
const PAT_ONLY=`${IND_MIN}:123`;        // Hockenson TD, Reichard only kicked the extra point
const ROSTER_SCORES=[`${IND_MIN}:11`,`${IND_MIN}:42`,`${IND_MIN}:62`,PAT_ONLY,`${IND_MIN}:161`,`${TB_CAR}:46`,`${CIN_BAL}:4`,`${CIN_BAL}:146`,
 `${CLE_TEN}:6`,`${CLE_TEN}:17`,`${CLE_TEN}:173`,`${GB_DET}:19`,`${GB_DET}:107`];

// ---------------------------------------------------------------- the rehearsal
// Mirrors web/app.js step()/cutTo()/commit()/startHighlight()/finishHighlight()
// in data-only replay mode: a highlight shows for `replaySeconds`, then the
// channel is committed back to a game. Everything is keyed to the archive clock.
function rehearse({roster=ROSTER,includeDefense=true,highlights=true,rules={},from=SUNDAY.start,to=SUNDAY.end,replaySeconds=25}={}){
 const director=new Director(rules),coverage=new Coverage(),R=director.rules;
 let at=from,lastAt=null,program={kind:'idle'},highlight=null,games=archive.sample(at,IDS);
 coverage.skipTo(games,at);
 const trace=[],cuts=[],events=[],queuedIds=new Set(),replayed=new Set(),requeued=[];
 const recentScore=(game,t)=>(game.scores||[]).some(s=>t-s.at>=0&&t-s.at<R.scoreHold&&rosterCredit(s,game,roster).length);
 const finishHighlight=()=>{
  const h=highlight;if(!h||h.done)return;
  const watched=(at-(h.until-replaySeconds))/replaySeconds;
  if(watched<.5&&!h.requeued){h.requeued=true;coverage.requeue(h.item);requeued.push({id:h.item.id,at,watched});}
  else{replayed.add(h.item.id);events.push({kind:'replayed',id:h.item.id,at});}
  h.done=true;if(!h.returnTo){highlight=null;program={kind:'standby'};}
 };
 const closeHighlight=()=>{const h=highlight;if(!h)return;highlight=null;if(!h.playing&&!h.done)coverage.requeue(h.item);if(program.kind==='highlight')program={kind:'standby'};};
 const commit=id=>{const was=program.kind==='game'?program.id:null;if(highlight)closeHighlight();program={kind:'game',id,since:at};director.committed(at);return was!==id;};
 for(;at<=to;at++){
  games=archive.sample(at,IDS);
  if(lastAt!==null&&program.kind==='game')coverage.watch(program.id,lastAt,at,3+1.5);   // data-only: the picture is always confirmed
  lastAt=at;
  for(const item of coverage.update(games,roster,at,0))if(item.queued)queuedIds.add(item.id);
  if(!highlights)coverage.queue.length=0;
  if(highlight&&!highlight.done&&at>=highlight.until)finishHighlight();
  const current=highlight&&!highlight.done?{kind:'highlight',id:highlight.item.id}:highlight?.done?{kind:'game',id:highlight.returnTo}:program.kind==='game'?{kind:'game',id:program.id}:{};
  const before=program.kind==='game'?games.find(g=>g.id===program.id):null;
  const decision=director.decide({games,roster,at,current,queue:coverage.queue,includeDefense,recentScore});
  const challenger=director.challenger?{...director.challenger}:null;
  const ranked=rank(games,roster,{includeDefense,currentId:current.id}),best=ranked[0]||null;
  let cut=null;
  if(decision.kind==='highlight'){
   if(!highlight||highlight.done){
    const item=coverage.take(decision.id);
    if(item){highlight={item,returnTo:program.kind==='game'?program.id:null,playing:true,done:false,until:at+replaySeconds};
     events.push({kind:'start',id:item.id,at,queuedAt:item.queuedAt,returnTo:highlight.returnTo,before,anyCritical:ranked.some(e=>e.critical)});
     program={kind:'highlight',id:item.id};}
   }
  }else if(decision.kind==='game'){
   if(highlight&&!highlight.done&&highlight.playing){events.push({kind:'preempt',id:highlight.item.id,at,reason:decision.reason});finishHighlight();}
   if(!highlight?.playing||highlight.done){
    const prevKind=program.kind,prevId=program.id;
    if(!(program.kind==='game'&&program.id===decision.id&&!highlight)&&commit(decision.id))   // app.js cutTo(): nothing to do when already on it
     cut={at,from:prevKind==='game'?prevId:prevKind,to:decision.id,reason:decision.reason,before,entry:decision.entry,ranked,challenger,fromHighlight:prevKind==='highlight'};
   }
  }else if(decision.kind==='standby'&&!highlight&&program.kind!=='standby')program={kind:'standby'};
  if(cut)cuts.push(cut);
  const e=decision.entry||null;
  trace.push({at,kind:decision.kind,id:decision.id,reason:decision.reason,roles:e?.players?.map(x=>x.role)||null,tier:e?.tier??0,score:e?.score??null,
   critical:!!e?.critical,yards:e?.yards??null,program:program.kind,programId:program.id??null,
   best:best?{id:best.game.id,tier:best.tier,score:best.score,critical:best.critical}:null,anyCritical:ranked.some(x=>x.critical),challenger});
 }
 return {trace,cuts,events,queuedIds,replayed,requeued,coverage,director,roster,includeDefense,from,to};
}
const runs={};
const run=(key,opts)=>runs[key]??=rehearse(opts);
const main=()=>run('main');
const onAir=r=>r.trace.filter(t=>t.kind==='game');
const picks=r=>onAir(r).filter(t=>t.roles&&t.roles.length);          // on a game because a starter is on the field
const onlyRole=(t,role)=>t.roles&&t.roles.length>0&&t.roles.every(x=>x===role);
const rosterGame=(r,id)=>hasRoster(sample(id,r.from),r.roster);
const programAt=r=>new Map(r.trace.map(t=>[t.at,t.program==='game'?t.programId:t.program]));
// Longest streak of consecutive trace steps matching `pred` (steps matching `pause` neither extend nor break it).
function longestRun(trace,pred,pause=()=>false){let run=0,max=0,where=null;for(const t of trace){if(pause(t))continue;if(pred(t)){if(++run>max){max=run;where=rel(t.at);}}else run=0;}return {max,where};}
const HOLD=PLAY_SECONDS+Math.ceil(RULES.debounce)+1;   // a play in progress, then the debounce, measured in 1-second steps
const HOLDS=['Play in progress','Your player just scored'];   // stay reasons that replace the explain() text

// ---------------------------------------------------------------- the slate
test('fixture: the Sunday slate has 12 games, the roster is spread over five of them, and seven games have no starter',()=>{
 assert.equal(SUNDAY.label,'Sunday, Oct 25');
 assert.equal(IDS.length,12);
 const games=archive.sample(SUNDAY.start,IDS);
 assert.deepEqual(games.filter(g=>hasRoster(g,ROSTER)).map(g=>g.id).sort(),[CIN_BAL,CLE_TEN,IND_MIN,TB_CAR,GB_DET].sort());
 assert.deepEqual(games.filter(g=>!hasRoster(g,ROSTER)).map(g=>g.id).sort(),[...NO_ROSTER_GAMES].sort());
 assert.deepEqual([...rosterTeams(ROSTER)].sort(),['BAL','CIN','DET','IND','MIN','TB','TEN']);
 // The archive credits the roster on exactly these plays; only the extra point is not worth a replay.
 const credited=[];
 for(const id of IDS)for(const s of archive.game(id).scores){const c=rosterCredit(s,archive.game(id),ROSTER);if(c.length)credited.push({id:s.id,worth:worthReplaying(c)});}
 assert.deepEqual(credited.map(x=>x.id).sort(),[...ROSTER_SCORES].sort());
 assert.deepEqual(credited.filter(x=>!x.worth).map(x=>x.id),[PAT_ONLY]);
});

test('the rehearsal is deterministic: a second run reproduces the same decisions, cuts and replays',()=>{
 const a=main(),b=rehearse();
 assert.equal(a.trace.length,SUNDAY.end-SUNDAY.start+1,'one decision per second of the session');
 assert.equal(b.trace.map(t=>`${t.kind}:${t.id}:${t.reason}`).join('|'),a.trace.map(t=>`${t.kind}:${t.id}:${t.reason}`).join('|'));
 assert.deepEqual(b.cuts.map(c=>[c.at,c.to]),a.cuts.map(c=>[c.at,c.to]));
 assert.deepEqual(b.events,a.events);
 assert.deepEqual(b.coverage.log.map(x=>[x.id,x.seen,x.queued]),a.coverage.log.map(x=>[x.id,x.seen,x.queued]));
});

// ---------------------------------------------------------------- only roster games
test('every second on air is a game with one of the roster teams; the seven starter-less games are never shown',()=>{
 const r=main();
 const shown=new Set(onAir(r).map(t=>t.id));
 for(const id of NO_ROSTER_GAMES)assert.equal(shown.has(id),false,`${sample(id,r.from).name} has none of your players`);
 for(const t of onAir(r))assert.ok(rosterGame(r,t.id),`${rel(t.at)}: ${t.id} (${t.reason})`);
 assert.deepEqual([...shown].sort(),[CIN_BAL,CLE_TEN,IND_MIN,TB_CAR,GB_DET].sort(),'all five roster games get screen time');
 // Between series the channel stays on (or falls back to) a roster game rather than wandering off.
 const idle=onAir(r).filter(t=>!t.roles||!t.roles.length);
 assert.ok(idle.length>1000,'there are plenty of between-series seconds');
 for(const t of idle)assert.ok(['Break in the action','Your players are off the field','Your matchup','Your player just scored'].includes(t.reason),`${rel(t.at)}: ${t.reason}`);
 for(const t of idle)assert.equal(sample(t.id,t.at).state,'in','a game we idle on is still in progress');
});

test('standby before the 1 PM kickoffs and after the last roster game: the morning game and the night game never fill the gap',()=>{
 const r=main();
 const firstKick=Math.min(...[IND_MIN,CIN_BAL,CLE_TEN,TB_CAR].map(id=>archive.game(id).start));
 for(const t of r.trace.filter(t=>t.at<firstKick))assert.equal(t.kind,'standby',`${rel(t.at)}: ${t.kind} ${t.id} while only PIT vs NO is playing`);
 assert.equal(r.trace.find(t=>t.at===firstKick)?.kind,'game','the channel comes on at the first roster kickoff');
 const lastFinal=r.trace.findLast(t=>t.kind==='game').at;
 assert.equal(r.trace.find(t=>t.at===lastFinal).id,GB_DET,'the last roster game (GB at DET) is the last thing shown');
 assert.ok(lastFinal>=archive.game(GB_DET).end-60&&lastFinal<=archive.game(GB_DET).end,`the channel stays until the final (${rel(lastFinal)} vs end ${rel(archive.game(GB_DET).end)})`);
 assert.ok(archive.game(KC_SEA).start>archive.game(GB_DET).end,'the night game kicks off after every roster game is over');
 for(const t of r.trace.filter(t=>t.at>lastFinal))assert.equal(t.kind,'standby',`${rel(t.at)}: ${t.kind} ${t.id} after your last game ended`);
 assert.ok(r.trace.filter(t=>t.at>archive.game(KC_SEA).start).every(t=>t.kind==='standby'),'the night game is never shown');
 assert.ok(r.trace.filter(t=>t.kind==='standby').length>20000);
 assert.ok(r.trace.filter(t=>t.kind==='standby').every(t=>t.reason==='None of your starters are playing right now'));
});

// ---------------------------------------------------------------- the whistle
test('never cuts away from a game while a play with a starter involved is in progress, and never starts a replay over one',()=>{
 const r=main();
 for(const c of r.cuts){
  if(!c.before)continue;
  const inv=involvement(c.before,r.roster,{includeDefense:r.includeDefense});
  assert.ok(!(c.before.phase==='play'&&inv.length),`${rel(c.at)}: left ${c.from} mid-play (${inv.map(x=>x.player.name)}) for ${c.to}: ${c.reason}`);
 }
 for(const e of r.events.filter(e=>e.kind==='start')){
  if(!e.before)continue;
  assert.ok(!(e.before.phase==='play'&&involvement(e.before,r.roster).length),`${rel(e.at)}: replay ${e.id} started over a live play on ${e.before.id}`);
 }
 const held=r.trace.filter(t=>t.reason==='Play in progress');
 assert.ok(held.length>500,`the whistle rule actually held the channel (${held.length} seconds)`);
 for(const t of held){const g=sample(t.id,t.at);assert.equal(g.phase,'play');assert.ok(involvement(g,r.roster).length);}
});

// ---------------------------------------------------------------- kickers and special teams
test('a kicker-only pick is always a 4th down at or inside the opponent 42, never a kickoff, punt or conversion try',()=>{
 const r=main();
 const kicks=onAir(r).filter(t=>onlyRole(t,'kicker'));
 assert.ok(kicks.length>50,`Reichard gets picked for field-goal tries (${kicks.length} seconds)`);
 for(const t of kicks){
  const g=sample(t.id,t.at);
  assert.equal(t.id,IND_MIN);
  assert.equal(g.down,4,`${rel(t.at)}: down ${g.down}`);
  assert.ok(g.yardsToGoal<=KICK_RANGE,`${rel(t.at)}: ${g.yardsToGoal} yards out`);
  assert.equal(g.special,false,`${rel(t.at)}: ${g.playType}`);
  assert.equal(g.possession,1,'Minnesota (home) has the ball');
  assert.ok(t.critical,'a kick try is critical');
  if(!HOLDS.includes(t.reason))assert.match(t.reason,/Reichard · field-goal range on 4th down/);
 }
 // Distinct tries, not one long stare: the three made field goals plus any attempts.
 const tries=new Set(kicks.map(t=>sample(t.id,t.at).playIndex));
 assert.ok(tries.size>=3,`${tries.size} distinct 4th-down kick situations`);
 // The kicker never counts as involved on any special-teams snap anywhere in the day.
 for(const t of onAir(r))if(t.roles?.includes('kicker'))assert.equal(sample(t.id,t.at).special,false);
});

test('an offensive starter is never the reason for a pick during a kickoff, punt, conversion try or an obvious 4th-down kick or punt',()=>{
 const r=main();
 const off=onAir(r).filter(t=>t.roles?.includes('offense'));
 assert.ok(off.length>5000);
 for(const t of off){
  const g=sample(t.id,t.at),where=`${rel(t.at)} ${g.name} ${g.phase} ${g.playType} ${g.down}&${g.distance} at ${g.yardsToGoal}`;
  assert.equal(g.special,false,where);
  assert.ok(g.down>=1&&g.down<=4,where);
  if(g.down===4&&g.phase!=='play')assert.ok(g.distance<=2,`between snaps a long 4th down is a kick or a punt: ${where}`);
  if(g.down===4&&g.phase==='play')assert.doesNotMatch(g.playType||'',/Field Goal|Punt|Kickoff/i,where);
 }
 // Roles agree with what involvement() reports for the sampled state.
 for(const t of picks(r).filter((_,i)=>i%7===0)){
  assert.deepEqual([...t.roles].sort(),involvement(sample(t.id,t.at),r.roster).map(x=>x.role).sort(),`${rel(t.at)}`);
 }
});

test('critical means red zone, a kick try or a 4th-down go; the explanation says "red zone" exactly inside the 20',()=>{
 const r=main();
 for(const t of picks(r)){
  const g=sample(t.id,t.at),kickTry=onlyRole(t,'kicker'),attacking=t.roles.some(x=>x!=='defense');
  const expected=attacking&&(g.yardsToGoal<=20||kickTry||g.down===4);
  assert.equal(t.critical,expected,`${rel(t.at)} ${g.name} ${t.roles} ${g.down}&${g.distance} at ${g.yardsToGoal}`);
  if(t.roles.includes('offense')&&!HOLDS.includes(t.reason))assert.equal(/red zone/.test(t.reason),g.yardsToGoal<=20,`${rel(t.at)}: ${t.reason}`);
  if(onlyRole(t,'defense'))assert.equal(t.critical,false,'a D/ST on the field is never critical');
 }
 assert.ok(picks(r).some(t=>t.critical&&t.roles.includes('offense')&&t.yards<=20),'red-zone drives happened');
});

// ---------------------------------------------------------------- priority
test('offense beats D/ST: the D/ST game yields to an available offense within a play plus the debounce, and is still followed when nothing else is on',()=>{
 const r=main();
 const def=onAir(r).filter(t=>onlyRole(t,'defense'));
 assert.ok(def.length>300,`the Buccaneers defense gets screen time (${def.length} seconds)`);
 for(const t of def)assert.equal(t.id,TB_CAR);
 // While an offense is available elsewhere, a defense-only pick never outlasts the whistle and the debounce
 // (the celebration hold is a separate, longer rule and is excluded here).
 const {max,where}=longestRun(r.trace,t=>t.kind==='game'&&onlyRole(t,'defense')&&t.best?.tier===2,t=>t.reason==='Your player just scored');
 assert.ok(max>0,'the situation arises');
 assert.ok(max<=HOLD,`defense held ${max}s against an available offense around ${where}`);
 // Nothing ever beats an offense that is on the field: a tier-1 pick means no tier-2 option existed for long.
 const defWhileOffense=r.trace.filter(t=>t.kind==='game'&&onlyRole(t,'defense')&&t.best?.tier===2).length;
 assert.ok(defWhileOffense<def.length*.2,`${defWhileOffense} of ${def.length} defense seconds overlapped an offense`);
});

test('a red-zone drive elsewhere with a higher score takes over a non-critical game within a play plus the debounce',()=>{
 const r=main();
 const pred=t=>t.kind==='game'&&t.tier>0&&!t.critical&&t.best&&t.best.id!==t.id&&t.best.critical&&t.best.score>t.score;
 const {max,where}=longestRun(r.trace,pred,t=>t.reason==='Your player just scored');
 assert.ok(max>0,'the situation arises');
 assert.ok(max<=HOLD,`a critical drive waited ${max}s around ${where}`);
 // Urgent upgrades do happen inside the dwell window.
 const urgent=r.cuts.filter(c=>c.entry?.critical&&c.before&&c.ranked.find(e=>e.game.id===c.before.id&&!e.critical&&e.tier>0));
 assert.ok(urgent.length>=3,`${urgent.length} cuts to a critical drive from a quieter one`);
});

test('the channel is on the best-ranked option nearly all the time it has one; the rest is justified holds',()=>{
 const r=main();
 const withOption=onAir(r).filter(t=>t.best);
 const onBest=withOption.filter(t=>t.id===t.best.id).length;
 assert.ok(onBest/withOption.length>=.9,`${(onBest/withOption.length*100).toFixed(1)}% on the best option`);
 for(const t of withOption.filter(t=>t.id!==t.best.id&&!HOLDS.includes(t.reason))){
  // Not a play, not a celebration: then it is the dwell/margin/debounce keeping us, on a roster game still in progress.
  assert.ok(rosterGame(r,t.id)&&sample(t.id,t.at).state==='in',`${rel(t.at)}: ${t.reason}`);
 }
 // With nobody of ours on the current game and an option elsewhere, only the debounce (or a celebration) can hold us.
 const {max,where}=longestRun(r.trace,t=>t.kind==='game'&&t.tier===0&&!!t.best,t=>t.reason==='Your player just scored');
 assert.ok(max>0&&max<=Math.ceil(RULES.debounce)+1,`sat ${max}s on an empty game with an option elsewhere around ${where}`);
});

// ---------------------------------------------------------------- dwell, margin, debounce
test('dwell: a second cut within RULES.dwell happens only when the starters left the field, a higher tier appeared, or an urgent upgrade',()=>{
 const r=main();
 let quick=0;
 for(let i=1;i<r.cuts.length;i++){
  const prev=r.cuts[i-1],c=r.cuts[i];
  if(c.fromHighlight||c.at-prev.at>=RULES.dwell)continue;
  quick++;
  const cur=c.ranked.find(e=>e.game.id===c.before?.id)||{tier:0,score:0,critical:false};
  const best=c.entry;
  const ok=cur.tier===0||best.tier>cur.tier||(best.critical&&!cur.critical&&best.score>cur.score);
  assert.ok(ok,`${rel(c.at)}: cut ${c.from}->${c.to} only ${c.at-prev.at}s after the last one (${c.reason})`);
 }
 assert.ok(quick>0&&quick<r.cuts.length/4,`${quick} quick cuts out of ${r.cuts.length}`);
 // And ordinary same-tier takeovers do wait out the dwell.
 const sameTier=r.cuts.filter((c,i)=>i&&!c.fromHighlight&&c.before&&c.ranked.find(e=>e.game.id===c.before.id)?.tier===c.entry?.tier);
 assert.ok(sameTier.length>10);
 for(const c of sameTier){const prev=r.cuts[r.cuts.indexOf(c)-1];if(!c.entry.critical)assert.ok(c.at-prev.at>=RULES.dwell,`${rel(c.at)}: ${c.from}->${c.to} after ${c.at-prev.at}s`);}
});

test('margin: a same-tier challenger needs RULES.margin more score to take over, unless it is imminent or an urgent upgrade',()=>{
 const r=main();
 const takeovers=r.cuts.filter(c=>!c.fromHighlight&&c.before&&c.entry?.tier>0&&c.ranked.find(e=>e.game.id===c.before.id)?.tier===c.entry.tier);
 assert.ok(takeovers.length>10,`${takeovers.length} same-tier takeovers`);
 for(const c of takeovers){
  const cur=c.ranked.find(e=>e.game.id===c.before.id),best=c.entry;
  const urgent=best.critical&&!cur.critical&&best.score>cur.score;
  const imminent=best.imminent&&!cur.critical&&best.score>cur.score;
  assert.ok(best.score>=cur.score+RULES.margin||urgent||imminent,`${rel(c.at)}: ${c.from} (${cur.score}) -> ${c.to} (${best.score}): ${c.reason}`);
 }
 // The margin is real: some challengers won by exactly the margin's worth, none by a hair.
 const plain=takeovers.filter(c=>{const cur=c.ranked.find(e=>e.game.id===c.before.id);return !c.entry.critical&&!c.entry.imminent&&!cur.critical;});
 assert.ok(plain.length>5);
 for(const c of plain){const cur=c.ranked.find(e=>e.game.id===c.before.id);assert.ok(c.entry.score-cur.score>=RULES.margin);}
});

test('debounce: leaving a live game waits for the same challenger RULES.debounce seconds; leaving a break or a final does not',()=>{
 const r=main();
 let live=0,breaks=0;
 for(const c of r.cuts){
  if(!c.before||c.fromHighlight)continue;
  const b=c.before;
  if(b.state==='in'&&b.phase!=='break'&&b.phase!=='final'){
   live++;
   assert.ok(c.challenger,`${rel(c.at)}: left live ${c.from} for ${c.to} with no challenger on record`);
   assert.equal(c.challenger.id,c.to,`${rel(c.at)}: the challenger that won is the one that was waiting`);
   assert.ok(c.at-c.challenger.since>=RULES.debounce,`${rel(c.at)}: challenger ${c.to} waited only ${c.at-c.challenger.since}s`);
  }else breaks++;
 }
 assert.ok(live>10&&breaks>10,`${live} cuts from live games, ${breaks} from breaks/finals`);
 // The rules matter: a director with no dwell, margin, debounce or celebration cuts more often on the same day.
 const loose=run('loose',{rules:{dwell:0,margin:0,debounce:0,scoreHold:0}});
 assert.ok(loose.cuts.length>r.cuts.length,`${loose.cuts.length} loose cuts vs ${r.cuts.length}`);
});

test('total cuts stay within a sane bound for a seven-starter Sunday',()=>{
 const r=main();
 assert.ok(r.cuts.length<120,`${r.cuts.length} cuts`);
 assert.ok(r.cuts.length>=20,`${r.cuts.length} cuts: a seven-game roster should move around`);
 for(const c of r.cuts)assert.notEqual(c.from,c.to,'a cut always changes the program');
 const consecutive=r.cuts.filter((c,i)=>i&&!c.fromHighlight&&c.to===r.cuts[i-1].to);
 assert.equal(consecutive.length,0,'back-to-back cuts land on different games (only a replay returns to the same one)');
 assert.ok(r.cuts.filter(c=>c.fromHighlight).length===r.events.filter(e=>e.kind==='replayed').length,'every finished replay hands back to a game');
 for(const c of r.cuts)assert.ok(rosterGame(r,c.to));
 assert.equal(r.cuts[0].from,'standby');assert.equal(r.cuts[0].to,IND_MIN,'the day opens on the first roster kickoff (lowest id among the simultaneous ones)');
});

// ---------------------------------------------------------------- the celebration
test('score hold: after a starter scores on screen the channel stays RULES.scoreHold seconds for the celebration unless the game breaks',()=>{
 const r=main(),prog=programAt(r);
 for(const c of r.cuts){
  if(!c.before)continue;
  const recent=(c.before.scores||[]).some(s=>c.at-s.at>=0&&c.at-s.at<RULES.scoreHold&&rosterCredit(s,c.before,r.roster).length);
  assert.ok(!recent||c.before.phase==='break',`${rel(c.at)}: left ${c.from} ${c.at-Math.max(...c.before.scores.map(s=>s.at))}s after your player scored (${c.before.phase})`);
 }
 const seen=r.coverage.log.filter(x=>x.seen);
 assert.ok(seen.length>=8,`${seen.length} scores seen live`);
 for(const x of seen){
  for(let t=x.at;t<x.at+RULES.scoreHold;t++){
   if(prog.get(t)===x.gameId)continue;
   assert.equal(sample(x.gameId,t).phase,'break',`${x.id}: left ${rel(t)} (${t-x.at}s after the score) for ${prog.get(t)}`);
   break;
  }
 }
 assert.ok(r.trace.filter(t=>t.reason==='Your player just scored').length>=RULES.scoreHold,'the hold was the deciding reason at least once');
});

// ---------------------------------------------------------------- coverage and replays
test('coverage: what Coverage calls "seen" is what the rehearsal actually had on screen around the snap',()=>{
 const r=main(),prog=programAt(r);
 assert.equal(r.coverage.log.length,ROSTER_SCORES.length);
 for(const x of r.coverage.log){
  let covered=0;for(let s=-3;s<4;s++)if(prog.get(x.at+s)===x.gameId)covered++;
  assert.equal(x.seen,covered>=5,`${x.id}: seen=${x.seen} but ${covered}/7 seconds around the snap were on ${x.gameId}`);
 }
 assert.ok(r.coverage.log.some(x=>x.seen)&&r.coverage.log.some(x=>!x.seen),'the day has both seen and missed scores');
 assert.deepEqual(r.coverage.log.map(x=>x.id),[...r.coverage.log].sort((a,b)=>b.at-a.at).map(x=>x.id),'the log is newest first');
});

test('coverage: every roster score is logged once; an extra point alone is logged but never queued; queued means missed and worth replaying',()=>{
 const r=main();
 assert.deepEqual(r.coverage.log.map(x=>x.id).sort(),[...ROSTER_SCORES].sort());
 assert.equal(new Set(r.coverage.log.map(x=>x.id)).size,ROSTER_SCORES.length);
 const pat=r.coverage.log.find(x=>x.id===PAT_ONLY);
 assert.deepEqual(pat.credits.map(c=>c.role),['pat']);
 assert.equal(pat.queued,false);assert.equal(pat.seen,false);
 assert.equal(r.queuedIds.has(PAT_ONLY),false);
 for(const x of r.coverage.log){
  assert.equal(x.queued,!x.seen&&worthReplaying(x.credits),x.id);
  assert.equal(r.queuedIds.has(x.id),x.queued,x.id);
  assert.ok(x.queuedAt>=x.at+9,'a score is judged only once the play has settled');
 }
 assert.ok(r.queuedIds.size>=2,`${r.queuedIds.size} misses queued`);
});

test('replays: every queued miss is replayed exactly once at a quiet moment, and the queue is empty by the end of the day',()=>{
 const r=main();
 const starts=r.events.filter(e=>e.kind==='start');
 assert.deepEqual([...r.replayed].sort(),[...r.queuedIds].sort(),'nothing queued is silently lost');
 assert.equal(starts.length,r.queuedIds.size,'each miss is replayed once');
 assert.deepEqual(r.requeued,[],'with 25-second replays nothing needed a second attempt');
 assert.equal(r.coverage.queue.length,0);
 for(const e of starts){
  assert.equal(e.anyCritical,false,`${rel(e.at)}: replay ${e.id} started while a drive was critical`);
  assert.ok(e.at>=e.queuedAt,'never before it was queued');
  assert.ok(e.returnTo===null||rosterGame(r,e.returnTo));
 }
 // Highlight seconds never coincide with an urgent live situation (the director would have cut back).
 for(const t of r.trace.filter(t=>t.kind==='highlight')){
  const urgent=rank(archive.sample(t.at,IDS),r.roster,{}).find(e=>e.critical&&(e.game.phase==='play'||e.game.nextSnapIn===null||e.game.nextSnapIn<10));
  assert.equal(urgent,undefined,`${rel(t.at)}: still replaying while ${urgent?.game.name} is ${urgent?.game.yardsToGoal} yards out`);
 }
 assert.equal(r.trace.filter(t=>t.kind==='highlight').length,starts.length*25);
});

test('replays: a miss waits past RULES.highlightWait only for a critical drive, a live play of ours, a celebration or another replay',()=>{
 const r=main(),byAt=new Map(r.trace.map(t=>[t.at,t]));
 const starts=r.events.filter(e=>e.kind==='start');
 assert.ok(starts.some(e=>e.at-e.queuedAt>RULES.highlightWait),'at least one replay had to wait');
 for(const e of starts){
  for(let at=e.queuedAt+RULES.highlightWait;at<e.at;at++){
   const t=byAt.get(at);if(t.kind==='highlight'||t.anyCritical)continue;
   const cur=t.program==='game'?sample(t.programId,at):null;
   const play=cur&&cur.phase==='play'&&involvement(cur,r.roster).length;
   const celebrating=cur&&(cur.scores||[]).some(s=>at-s.at>=0&&at-s.at<RULES.scoreHold&&rosterCredit(s,cur,r.roster).length);
   assert.ok(play||celebrating,`${rel(at)}: replay ${e.id} kept waiting (${t.reason})`);
  }
 }
});

test('replays: pre-empted by an imminent critical snap, requeued when barely watched, and still replayed later (12 starters, 90-second replays)',()=>{
 const r=run('big',{roster:BIG_ROSTER,replaySeconds:90});
 const preempts=r.events.filter(e=>e.kind==='preempt'),starts=r.events.filter(e=>e.kind==='start');
 assert.ok(preempts.length>=2,`${preempts.length} replays were pre-empted`);
 assert.ok(r.requeued.length>=1,`${r.requeued.length} replays went back in the queue`);
 for(const p of preempts){
  assert.equal(p.reason,'Back to live action');
  const urgent=rank(archive.sample(p.at,IDS),r.roster,{}).find(e=>e.critical&&(e.game.phase==='play'||e.game.nextSnapIn===null||e.game.nextSnapIn<10));
  assert.ok(urgent,`${rel(p.at)}: ${p.id} pre-empted with nothing urgent`);
  assert.ok(urgent.game.yardsToGoal<=20||urgent.game.down===4,`${urgent.game.name} at ${urgent.game.yardsToGoal}`);
 }
 for(const q of r.requeued){
  assert.ok(q.watched<.5);
  const later=r.events.filter(e=>e.id===q.id&&e.at>q.at);
  assert.ok(later.some(e=>e.kind==='start')&&later.some(e=>e.kind==='replayed'),`${q.id} was requeued at ${rel(q.at)} and never replayed`);
 }
 assert.deepEqual([...r.replayed].sort(),[...r.queuedIds].sort(),'nothing queued is silently lost');
 assert.equal(starts.length,r.queuedIds.size+r.requeued.length,'one start per queue entry, plus one per requeue');
 assert.equal(r.coverage.queue.length,0);
 for(const e of starts)assert.equal(e.anyCritical,false,`${rel(e.at)}: ${e.id} started while critical`);
 // The same whistle and roster invariants hold on the busier day.
 for(const c of r.cuts)if(c.before)assert.ok(!(c.before.phase==='play'&&involvement(c.before,r.roster).length),`${rel(c.at)}: mid-play cut`);
 for(const t of onAir(r))assert.ok(rosterGame(r,t.id));
 for(const t of onAir(r))if(onlyRole(t,'kicker')){const g=sample(t.id,t.at);assert.ok(g.down===4&&g.yardsToGoal<=KICK_RANGE&&!g.special);}
});

test('highlights off: no replay ever starts and the queue stays empty, while live direction is unaffected',()=>{
 const r=run('nohl',{highlights:false});
 assert.equal(r.trace.filter(t=>t.kind==='highlight').length,0);
 assert.equal(r.events.length,0);
 assert.equal(r.coverage.queue.length,0);
 assert.ok(r.queuedIds.size>=2,'misses are still detected and logged');
 assert.equal(r.coverage.log.length,ROSTER_SCORES.length);
 assert.ok(r.cuts.length<120&&r.cuts.length>=20);
 for(const t of onAir(r))assert.ok(rosterGame(r,t.id));
});

// ---------------------------------------------------------------- options and rosters
test('includeDefense=false: the D/ST is never a reason to be on a game, and TB at CAR is never shown while Carolina has the ball',()=>{
 const r=run('nodef',{includeDefense:false}),withDef=main();
 for(const t of onAir(r))assert.ok(!t.roles?.includes('defense'),`${rel(t.at)}: ${t.reason}`);
 for(const t of onAir(r).filter(t=>t.id===TB_CAR)){
  const g=sample(t.id,t.at);
  assert.ok(!(g.state==='in'&&g.phase!=='break'&&g.possession===1),`${rel(t.at)}: on TB at CAR while CAR drives (${t.reason})`);
  assert.deepEqual(t.roles||[],[],'only ever a between-series fallback');
 }
 assert.ok(onAir(withDef).some(t=>onlyRole(t,'defense')),'with the option on, the same day does follow the Buccaneers defense');
 assert.ok(r.cuts.length<withDef.cuts.length,'fewer things to cut to');
 for(const c of r.cuts)if(c.before)assert.ok(!(c.before.phase==='play'&&involvement(c.before,r.roster,{includeDefense:false}).length));
 // Fantasy points are fantasy points: the D/ST touchdown is still logged and, being missed, still replayed.
 const dst=r.coverage.log.find(x=>x.id===`${TB_CAR}:46`);
 assert.deepEqual(dst.credits.map(c=>c.role),['defense']);
 assert.equal(dst.seen,false);
 assert.ok(r.replayed.has(dst.id));
});

test('a single-starter roster sits on that game from kickoff to final: one cut, every score seen live, nothing queued',()=>{
 const pollard=[{name:'Tony Pollard',team:'TEN',position:'RB'}];
 const r=run('pollard',{roster:pollard});
 assert.equal(r.cuts.length,1);
 assert.deepEqual([r.cuts[0].from,r.cuts[0].to,r.cuts[0].at],['standby',CLE_TEN,archive.game(CLE_TEN).start]);
 assert.deepEqual([...new Set(onAir(r).map(t=>t.id))],[CLE_TEN]);
 const game=archive.game(CLE_TEN);
 for(const t of r.trace){
  if(t.at<game.start)assert.equal(t.kind,'standby');
  else if(t.at<game.end-30)assert.equal(t.kind,'game',`${rel(t.at)}: ${t.kind} ${t.reason}`);
 }
 assert.equal(r.trace.at(-1).kind,'standby');
 assert.deepEqual(r.coverage.log.map(x=>`${x.id} seen=${x.seen} queued=${x.queued}`).sort(),[6,17,173].map(i=>`${CLE_TEN}:${i} seen=true queued=false`).sort());
 assert.equal(r.queuedIds.size,0);assert.equal(r.events.length,0);
 // Each touchdown: the play itself is 'Play in progress', the rest of the hold is the celebration.
 const celebrating=r.trace.filter(t=>t.reason==='Your player just scored').length;
 assert.ok(celebrating>=3*(RULES.scoreHold-PLAY_SECONDS)-3&&celebrating<=3*RULES.scoreHold,`${celebrating} celebration seconds`);
});

test('a mid-day start skips the scores already in the past: never logged, never replayed, and the channel comes straight on',()=>{
 const from=SUNDAY.start+14000;   // 1:23 PM-ish, well into the early window
 const r=run('late',{from});
 const past=[`${CIN_BAL}:4`,`${CLE_TEN}:6`,`${IND_MIN}:11`,`${CLE_TEN}:17`];
 for(const id of past){
  assert.ok(archive.games.flatMap(g=>g.scores).find(s=>s.id===id).at<from);
  assert.ok(r.coverage.judged.has(id),`${id} marked as skipped`);
  assert.equal(r.coverage.log.some(x=>x.id===id),false,`${id} must not be logged`);
  assert.equal(r.queuedIds.has(id),false,`${id} must not be replayed`);
 }
 assert.deepEqual(r.coverage.log.map(x=>x.id).sort(),ROSTER_SCORES.filter(id=>!past.includes(id)).sort());
 assert.equal(r.trace[0].kind,'game');
 assert.ok(rosterGame(r,r.trace[0].id));
 assert.deepEqual([...r.replayed].sort(),[...r.queuedIds].sort());
 for(const t of onAir(r))assert.ok(rosterGame(r,t.id));
});
