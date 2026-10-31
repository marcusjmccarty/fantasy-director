import test from 'node:test';
import assert from 'node:assert/strict';
import {Coverage} from '../web/coverage.js';
import {alias,normalName,parseScoringPlay,rosterCredit,worthReplaying,describeScore,HIGHLIGHT_ROLES} from '../web/scoring.js';

// ---------- fixtures ----------
// Scores look like what web/live.js builds from ESPN scoring plays; games like S.games.
const IND=0,MIN=1;
const teams=()=>[{abbreviation:'IND'},{abbreviation:'MIN'}];
const game=(id,scores,name='IND @ MIN')=>({id,name,teams:teams(),scores});
const play=(id,at,team,text,extra={})=>({id,at,team,kind:'TD',defensive:false,text,...parseScoringPlay(text),...extra});
const roster=[
 {name:'Jonathan Taylor',team:'IND',position:'RB'},
 {name:'Justin Jefferson',team:'MIN',position:'WR'},
 {name:'J.J. McCarthy',team:'MIN',position:'QB'},
 {name:'Will Reichard',team:'MIN',position:'K'},
 {name:'Colts D/ST',team:'IND',position:'D/ST'},
];
const byName=name=>roster.find(p=>p.name===name);
// Common plays.
const taylorTD=(id='s1',at=100)=>play(id,at,IND,'Jonathan Taylor 4 Yd Run (Spencer Shrader Kick)');
const jeffersonTD=(id='s1',at=100)=>play(id,at,MIN,'Justin Jefferson 9 Yd pass from J.J. McCarthy (Will Reichard Kick)');
const patOnly=(id='s1',at=100)=>play(id,at,MIN,'Jordan Addison 12 Yd pass from Sam Darnold (Will Reichard Kick)');
const nobody=(id='s1',at=100)=>play(id,at,IND,'Josh Downs 7 Yd pass from Anthony Richardson (Spencer Shrader Kick)');
const reichardFG=(id='s1',at=100)=>play(id,at,MIN,'Will Reichard 48 Yd Field Goal');
const pickSix=(id='s1',at=100)=>play(id,at,IND,'Kenny Moore II 40 Yd Interception Return (Spencer Shrader Kick)');
const roles=credits=>credits.map(c=>`${c.player.name}:${c.role}`);

// ---------- Coverage.watch ----------
test('watch() rejects jumps larger than maxStep, backward and empty steps, and missing game ids',()=>{
 const c=new Coverage();
 c.watch('g',0,6);                 // 6s > default maxStep 5: a seek, not watching
 assert.equal(c.intervals.has('g'),false);
 c.watch('g',0,5);                 // exactly maxStep is still a step
 assert.deepEqual(c.intervals.get('g'),[[0,5]]);
 c.watch('g',5,5);c.watch('g',5,3);c.watch('g',NaN,8);c.watch('g',5,NaN);
 c.watch('',5,8);c.watch(null,5,8);c.watch(undefined,5,8);
 assert.deepEqual(c.intervals.get('g'),[[0,5]]);
 assert.deepEqual([...c.intervals.keys()],['g']);
});
test('watch() honors a custom maxStep so faster playback rates still count as watching',()=>{
 const c=new Coverage();
 c.watch('g',0,8,10);assert.deepEqual(c.intervals.get('g'),[[0,8]]);
 c.watch('g',8,19,10);assert.deepEqual(c.intervals.get('g'),[[0,8]]);     // 11s > 10: rejected
 c.watch('g',8,10,1);assert.deepEqual(c.intervals.get('g'),[[0,8]]);      // 2s > 1: rejected
 c.watch('g',8,9,1);assert.deepEqual(c.intervals.get('g'),[[0,9]]);
});
test('watch() merges contiguous and near-contiguous (<=0.6s gap) steps into one interval',()=>{
 const c=new Coverage();
 c.watch('g',0,3);c.watch('g',3,6);
 assert.deepEqual(c.intervals.get('g'),[[0,6]]);
 c.watch('g',6.5,9);                                   // 0.5s of feed jitter is bridged
 assert.deepEqual(c.intervals.get('g'),[[0,9]]);
 c.watch('g',4,7);                                     // overlapping/backward step never shrinks
 assert.deepEqual(c.intervals.get('g'),[[0,9]]);
 // Tick-sized steps collapse into a single interval.
 const t=new Coverage();
 for(let at=90;at<110;at+=.25)t.watch('g',at,at+.25);
 assert.equal(t.intervals.get('g').length,1);
 assert.equal(t.intervals.get('g')[0][0],90);
 assert.ok(Math.abs(t.intervals.get('g')[0][1]-110)<1e-9);
});
test('watch() starts a new interval after a gap wider than 0.6s and tracks games separately',()=>{
 const c=new Coverage();
 c.watch('g',0,3);c.watch('g',3.7,6);
 assert.deepEqual(c.intervals.get('g'),[[0,3],[3.7,6]]);
 c.watch('h',6,9);c.watch('g',6,9);
 assert.deepEqual(c.intervals.get('h'),[[6,9]]);
 assert.deepEqual(c.intervals.get('g'),[[0,3],[3.7,9]]);
});
test('watch() keeps at most 400 intervals per game, dropping the oldest',()=>{
 const c=new Coverage();
 for(let i=0;i<=500;i++)c.watch('g',i*10,i*10+1);     // 501 separate intervals
 const list=c.intervals.get('g');
 assert.equal(list.length,400);
 assert.deepEqual(list[0],[1010,1011]);
 assert.deepEqual(list.at(-1),[5000,5001]);
 for(let i=0;i<=500;i++)c.watch('h',i*10,i*10+1);     // the cap is per game
 assert.equal(c.intervals.get('g').length,400);
 assert.equal(c.intervals.get('h').length,400);
});

// ---------- Coverage.seen ----------
test('seen() needs 70% of the [-3,+4] window around the snap on screen',()=>{
 const full=new Coverage();full.watch('g',97,104,10);
 assert.equal(full.seen('g',100),true);
 const five=new Coverage();five.watch('g',97,102);     // 5 of 7 seconds
 assert.equal(five.seen('g',100),true);
 const four=new Coverage();four.watch('g',97,101);     // 4 of 7 seconds
 assert.equal(four.seen('g',100),false);
 const before=new Coverage();before.watch('g',90,97,10);   // ends as the window opens
 assert.equal(before.seen('g',100),false);
 const after=new Coverage();after.watch('g',104,111,10);   // starts as the window closes
 assert.equal(after.seen('g',100),false);
});
test('seen() window is asymmetric: 3s before the snap, 4s after',()=>{
 const early=new Coverage();early.watch('g',94,101,10);    // overlap [97,101] = 4s
 assert.equal(early.seen('g',100),false);
 const late=new Coverage();late.watch('g',99,106,10);      // overlap [99,104] = 5s
 assert.equal(late.seen('g',100),true);
});
test('seen() sums coverage across separate intervals',()=>{
 const c=new Coverage();c.watch('g',97,99);c.watch('g',101,104);   // 2s + 3s
 assert.equal(c.intervals.get('g').length,2);
 assert.equal(c.seen('g',100),true);
 const d=new Coverage();d.watch('g',97,99);d.watch('g',102,104);   // 2s + 2s
 assert.equal(d.seen('g',100),false);
});
test('seen() is false for unknown games and ignores coverage of other games',()=>{
 const c=new Coverage();
 assert.equal(c.seen('g',100),false);
 c.watch('other',97,104,10);
 assert.equal(c.seen('g',100),false);
 assert.equal(c.seen('other',100),true);
});

// ---------- Coverage.update ----------
test('update() judges a score only once SETTLED (9s) has passed since the snap',()=>{
 const c=new Coverage(),games=[game('g1',[taylorTD('s1',100)])];
 assert.deepEqual(c.update(games,roster,100),[]);
 assert.deepEqual(c.update(games,roster,108.9),[]);
 assert.equal(c.judged.has('s1'),false);
 assert.equal(c.log.length,0);assert.equal(c.queue.length,0);
 const fresh=c.update(games,roster,109);
 assert.equal(fresh.length,1);assert.equal(fresh[0].id,'s1');
 assert.equal(c.judged.has('s1'),true);
});
test('update() with a stream delay waits for the delayed snap and judges visibility around it',()=>{
 const games=[game('g1',[taylorTD('s1',100)])],delay=30;
 // Viewer watched the delayed snap (shown at 130) -> seen live.
 const a=new Coverage();for(let t=125;t<140;t++)a.watch('g1',t,t+1);
 assert.deepEqual(a.update(games,roster,138,delay),[]);     // 100+30+9 not yet reached
 assert.deepEqual(a.update(games,roster,138.9,delay),[]);
 const fresh=a.update(games,roster,139,delay);
 assert.equal(fresh.length,1);assert.equal(fresh[0].seen,true);assert.equal(fresh[0].queued,false);
 assert.equal(a.queue.length,0);
 // Viewer was on this game at the undelayed timestamp but away when the play actually aired -> missed.
 const b=new Coverage();for(let t=95;t<106;t++)b.watch('g1',t,t+1);
 const missed=b.update(games,roster,139,delay);
 assert.equal(missed.length,1);assert.equal(missed[0].seen,false);assert.equal(missed[0].queued,true);
 assert.equal(b.queue.length,1);
 // Without delay the same coverage counts.
 const d=new Coverage();for(let t=95;t<106;t++)d.watch('g1',t,t+1);
 assert.equal(d.update(games,roster,109)[0].seen,true);
});
test('update() ignores scores by non-roster players: judged, but neither logged nor queued',()=>{
 const c=new Coverage();
 const games=[game('g1',[nobody('s1',100),play('s2',110,-1,'Josh Downs 7 Yd pass from Anthony Richardson (Spencer Shrader Kick)')])];
 assert.deepEqual(c.update(games,roster,200),[]);
 assert.equal(c.judged.has('s1'),true);assert.equal(c.judged.has('s2'),true);
 assert.equal(c.log.length,0);assert.equal(c.queue.length,0);
 assert.deepEqual(c.update(games,roster,300),[]);
 // Games without a scores list are fine too.
 assert.deepEqual(c.update([{id:'g2',name:'x',teams:teams()}],roster,300),[]);
});
test('update() logs a roster score that was on screen without queueing it',()=>{
 const c=new Coverage(),score=taylorTD('s1',100),games=[game('g1',[score])];
 c.watch('g1',97,104,10);
 const [item]=c.update(games,roster,109);
 assert.equal(item.id,'s1');assert.equal(item.gameId,'g1');assert.equal(item.gameName,'IND @ MIN');
 assert.equal(item.score,score);assert.equal(item.at,100);assert.equal(item.queuedAt,109);
 assert.equal(item.seen,true);assert.equal(item.queued,false);
 assert.deepEqual(roles(item.credits),['Jonathan Taylor:scorer']);
 assert.equal(item.credits[0].player,byName('Jonathan Taylor'));
 assert.deepEqual(c.queue,[]);
 assert.deepEqual(c.log,[item]);
});
test('update() queues a missed roster touchdown for replay',()=>{
 const c=new Coverage(),score=taylorTD('s1',100),games=[game('g1',[score])];
 c.watch('g1',97,101);                                     // only 4 of 7 seconds: not seen
 const [item]=c.update(games,roster,109);
 assert.equal(item.seen,false);assert.equal(item.queued,true);
 assert.deepEqual(c.queue,[item]);
 assert.deepEqual(c.log,[item]);
 assert.equal(c.queue[0],c.log[0]);
});
test('update() logs but does not queue a missed extra point alone',()=>{
 const c=new Coverage(),games=[game('g1',[patOnly('s1',100)])];
 const [item]=c.update(games,roster,109);
 assert.deepEqual(roles(item.credits),['Will Reichard:pat']);
 assert.equal(item.seen,false);assert.equal(item.queued,false);
 assert.deepEqual(c.queue,[]);
 assert.deepEqual(c.log,[item]);
});
test('update() credits passer, kicker, defense and two-point and queues each when missed',()=>{
 const c=new Coverage();
 const games=[game('g1',[
  play('pass',100,MIN,'Jordan Addison 12 Yd pass from J.J. McCarthy (Will Reichard Kick)'),
  reichardFG('fg',200),
  pickSix('pick',300),
  play('two',400,MIN,'Jordan Addison 5 Yd pass from Sam Darnold (Sam Darnold Pass to Justin Jefferson for Two-Point Conversion)'),
 ])];
 const fresh=c.update(games,roster,1000);
 assert.deepEqual(fresh.map(x=>x.id),['pass','fg','pick','two']);
 assert.deepEqual(roles(fresh[0].credits),['J.J. McCarthy:passer','Will Reichard:pat']);
 assert.deepEqual(roles(fresh[1].credits),['Will Reichard:kicker']);
 assert.deepEqual(roles(fresh[2].credits),['Colts D/ST:defense']);
 assert.deepEqual(roles(fresh[3].credits),['Justin Jefferson:two-point']);
 assert.deepEqual(c.queue.map(x=>x.id),['pass','fg','pick','two']);
 assert.ok(fresh.every(x=>x.queued&&!x.seen));
});
test('update() judges each score exactly once and never re-queues it',()=>{
 const c=new Coverage(),games=[game('g1',[jeffersonTD('s1',100)])];
 assert.equal(c.update(games,roster,109).length,1);
 assert.deepEqual(c.update(games,roster,109),[]);
 assert.deepEqual(c.update(games,roster,500),[]);
 assert.equal(c.queue.length,1);assert.equal(c.log.length,1);
 c.take('s1');
 assert.deepEqual(c.update(games,roster,600),[]);
 assert.equal(c.queue.length,0);
});
test('update() returns scores from several games in one pass',()=>{
 const c=new Coverage();
 const other={id:'g2',name:'CIN @ BAL',teams:[{abbreviation:'CIN'},{abbreviation:'BAL'}],scores:[play('b1',100,1,'Zay Flowers 20 Yd pass from Lamar Jackson (Justin Tucker Kick)')]};
 const games=[game('g1',[taylorTD('a1',100),jeffersonTD('a2',150)]),other];
 const r=[...roster,{name:'Zay Flowers',team:'BAL',position:'WR'}];
 c.watch('g2',97,104,10);
 const fresh=c.update(games,r,200);
 assert.deepEqual(fresh.map(x=>[x.id,x.gameId,x.gameName,x.seen,x.queued]),[['a1','g1','IND @ MIN',false,true],['a2','g1','IND @ MIN',false,true],['b1','g2','CIN @ BAL',true,false]]);
 assert.deepEqual(c.queue.map(x=>x.id),['a1','a2']);
 assert.deepEqual(c.log.map(x=>x.id),['b1','a2','a1']);
});
test('update() keeps the log newest-first and capped at 40 entries; the queue is not capped',()=>{
 const c=new Coverage();
 const scores=Array.from({length:45},(_,i)=>jeffersonTD(`s${i+1}`,i+1));
 const fresh=c.update([game('g1',scores)],roster,1000);
 assert.equal(fresh.length,45);
 assert.equal(c.queue.length,45);
 assert.equal(c.log.length,40);
 assert.equal(c.log[0].id,'s45');
 assert.equal(c.log[39].id,'s6');
 // A later batch pushes the oldest entries out.
 c.update([game('g1',[jeffersonTD('s46',46)])],roster,2000);
 assert.equal(c.log.length,40);
 assert.equal(c.log[0].id,'s46');assert.equal(c.log[39].id,'s7');
 assert.equal(c.queue.length,46);
});

// ---------- Coverage.skipTo ----------
test('skipTo() marks scores at or before the seek target as judged so they are never replayed',()=>{
 const c=new Coverage();
 const games=[game('g1',[taylorTD('s50',50),taylorTD('s100',100),taylorTD('s150',150)]),{id:'g2',name:'none',teams:teams()}];
 c.skipTo(games,100);
 assert.equal(c.judged.has('s50'),true);assert.equal(c.judged.has('s100'),true);assert.equal(c.judged.has('s150'),false);
 assert.deepEqual(c.update(games,roster,1000).map(x=>x.id),['s150']);
 assert.deepEqual(c.queue.map(x=>x.id),['s150']);assert.deepEqual(c.log.map(x=>x.id),['s150']);
});
test('skipTo() prunes queued replays at or before the seek target and keeps later ones',()=>{
 const c=new Coverage();
 const games=[game('g1',[taylorTD('s50',50),taylorTD('s100',100),taylorTD('s150',150)])];
 c.update(games,roster,1000);
 assert.deepEqual(c.queue.map(x=>x.id),['s50','s100','s150']);
 c.skipTo(games,100);
 assert.deepEqual(c.queue.map(x=>x.id),['s150']);
 assert.equal(c.log.length,3);                        // the log is history, not pruned
 c.skipTo(games,149.99);
 assert.deepEqual(c.queue.map(x=>x.id),['s150']);
 c.skipTo(games,150);
 assert.deepEqual(c.queue,[]);
});

// ---------- queue management ----------
test('take() removes and returns the queued item; null when it is not queued',()=>{
 const c=new Coverage(),games=[game('g1',[taylorTD('a',100),jeffersonTD('b',110)])];
 const [a,b]=c.update(games,roster,200);
 assert.equal(c.take('b'),b);
 assert.deepEqual(c.queue,[a]);
 assert.equal(c.take('b'),null);
 assert.equal(c.take('nope'),null);
 assert.equal(c.take('a'),a);
 assert.deepEqual(c.queue,[]);
 assert.equal(c.log.length,2);
});
test('requeue() puts an item back at the front without duplicating it',()=>{
 const c=new Coverage(),games=[game('g1',[taylorTD('a',100),jeffersonTD('b',110)])];
 const [a,b]=c.update(games,roster,200);
 const taken=c.take('a');
 assert.deepEqual(c.queue,[b]);
 c.requeue(taken);
 assert.deepEqual(c.queue.map(x=>x.id),['a','b']);
 c.requeue(taken);c.requeue(b);
 assert.deepEqual(c.queue.map(x=>x.id),['a','b']);
 assert.equal(c.queue[0],a);
});
test('drop() removes an item from the queue and is a no-op for unknown ids',()=>{
 const c=new Coverage(),games=[game('g1',[taylorTD('a',100),jeffersonTD('b',110)])];
 c.update(games,roster,200);
 c.drop('a');
 assert.deepEqual(c.queue.map(x=>x.id),['b']);
 c.drop('zzz');c.drop('a');
 assert.deepEqual(c.queue.map(x=>x.id),['b']);
 assert.equal(c.log.length,2);
});
test('reset() clears intervals, judged ids, queue and log',()=>{
 const c=new Coverage(),games=[game('g1',[taylorTD('a',100)])];
 c.watch('g1',0,3);c.update(games,roster,200);
 assert.equal(c.intervals.size,1);assert.equal(c.judged.size,1);assert.equal(c.queue.length,1);assert.equal(c.log.length,1);
 c.reset();
 assert.equal(c.intervals.size,0);assert.equal(c.judged.size,0);assert.deepEqual(c.queue,[]);assert.deepEqual(c.log,[]);
 assert.equal(c.update(games,roster,200).length,1);     // judged again after a reset
});

// ---------- scoring.js ----------
test('normalName() and alias() normalize names and team abbreviations',()=>{
 assert.equal(normalName('José Ramírez'),'jose ramirez');
 assert.equal(normalName('Ja’Marr Chase'),'jamarr chase');
 assert.equal(normalName("Ja'Marr Chase"),'jamarr chase');
 assert.equal(normalName('Amon-Ra St. Brown'),'amon ra st brown');
 assert.equal(normalName('Kyle Pitts Sr.'),'kyle pitts');
 assert.equal(normalName('Marvin Harrison Jr.'),'marvin harrison');
 assert.equal(normalName('Kenny Moore II'),'kenny moore');
 assert.equal(normalName('  D.K.   Metcalf '),'dk metcalf');
 assert.equal(normalName(null),'');assert.equal(normalName(undefined),'');
 assert.equal(alias('WSH'),'WAS');assert.equal(alias('JAX'),'JAC');assert.equal(alias('LA'),'LAR');assert.equal(alias('IND'),'IND');
});
test('rosterCredit() matches starters by normalized name and aliased team',()=>{
 const r=[
  {name:'Kyle Pitts Sr.',team:'ATL',position:'TE'},
  {name:'Jayden Daniels',team:'WSH',position:'QB'},
  {name:'Brian Thomas Jr.',team:'JAC',position:'WR'},
  {name:'Puka Nacua',team:'LAR',position:'WR'},
 ];
 const g=(a,b)=>({id:'x',name:'x',teams:[{abbreviation:a},{abbreviation:b}]});
 assert.deepEqual(roles(rosterCredit(play('1',0,0,'Kyle Pitts 11 Yd pass from Michael Penix Jr. (Younghoe Koo Kick)'),g('ATL','WAS'),r)),['Kyle Pitts Sr.:scorer']);
 assert.deepEqual(roles(rosterCredit(play('2',0,1,'Terry McLaurin 11 Yd pass from Jayden Daniels (Matt Gay Kick)'),g('ATL','WAS'),r)),['Jayden Daniels:passer']);
 assert.deepEqual(roles(rosterCredit(play('3',0,0,'Brian Thomas Jr. 40 Yd pass from Trevor Lawrence (Cam Little Kick)'),g('JAX','LA'),r)),['Brian Thomas Jr.:scorer']);
 assert.deepEqual(roles(rosterCredit(play('4',0,1,'Puka Nacua 3 Yd Run (Joshua Karty Kick)'),g('JAX','LA'),r)),['Puka Nacua:scorer']);
 assert.deepEqual(rosterCredit(play('5',0,1,'Puka Nacua 3 Yd Run (Joshua Karty Kick)'),g('JAX','SEA'),r),[]);
});
test('rosterCredit() never credits a same-named player on the other side of the ball',()=>{
 const g=game('g1',[]);
 const onMin=play('1',0,MIN,'Jonathan Taylor 4 Yd Run (Will Reichard Kick)');
 assert.deepEqual(roles(rosterCredit(onMin,g,roster)),['Will Reichard:pat']);
 const onInd=play('2',0,IND,'Jonathan Taylor 4 Yd Run (Will Reichard Kick)');
 assert.deepEqual(roles(rosterCredit(onInd,g,roster)),['Jonathan Taylor:scorer']);
 const noTeam=play('3',0,-1,'Jonathan Taylor 4 Yd Run (Will Reichard Kick)');
 assert.deepEqual(rosterCredit(noTeam,g,roster),[]);
});
test('rosterCredit() credits a D/ST only for its own defensive scores, safeties and defensive two-point tries',()=>{
 const g=game('g1',[]),dst=[byName('Colts D/ST')];
 assert.deepEqual(roles(rosterCredit(pickSix('1',0),g,dst)),['Colts D/ST:defense']);
 assert.deepEqual(rosterCredit(taylorTD('2',0),g,dst),[]);                 // own offense: no D/ST points
 assert.deepEqual(rosterCredit(play('3',0,MIN,'Harrison Smith 30 Yd Interception Return (Will Reichard Kick)'),g,dst),[]);   // other team's defense
 assert.deepEqual(roles(rosterCredit({id:'4',at:0,team:IND,kind:'SAF',defensive:false,text:'Safety',players:[]},g,dst)),['Colts D/ST:defense']);
 assert.deepEqual(roles(rosterCredit({id:'5',at:0,team:IND,kind:'D2P',defensive:false,text:'Kenny Moore II Defensive PAT Conversion',players:[{name:'Kenny Moore II',role:'scorer'}]},g,dst)),['Colts D/ST:defense']);
 // Full roster: the pick six is a D/ST credit only; a MIN touchdown against IND credits nobody from IND.
 assert.deepEqual(roles(rosterCredit(pickSix('6',0),g,roster)),['Colts D/ST:defense']);
 assert.deepEqual(roles(rosterCredit(patOnly('7',0),g,roster)),['Will Reichard:pat']);
});
test('parseScoringPlay() parses passes, runs, field goals, returns, PATs and two-point tries',()=>{
 assert.deepEqual(parseScoringPlay('CeeDee Lamb 9 Yd pass from Dak Prescott (Brandon Aubrey Kick)'),
  {kind:'TD',defensive:false,players:[{name:'CeeDee Lamb',role:'scorer'},{name:'Dak Prescott',role:'passer'},{name:'Brandon Aubrey',role:'pat'}]});
 assert.deepEqual(parseScoringPlay('Saquon Barkley 3 Yd Run (Jake Elliott Kick)'),
  {kind:'TD',defensive:false,players:[{name:'Saquon Barkley',role:'scorer'},{name:'Jake Elliott',role:'pat'}]});
 assert.deepEqual(parseScoringPlay('Jalen Hurts 1 Yd Rush (Jalen Hurts Pass to A.J. Brown for Two-Point Conversion)'),
  {kind:'TD',defensive:false,players:[{name:'Jalen Hurts',role:'scorer'},{name:'Jalen Hurts',role:'two-point'},{name:'A.J. Brown',role:'two-point'}]});
 assert.deepEqual(parseScoringPlay('Saquon Barkley 3 Yd Run (Saquon Barkley Run for Two-Point Conversion)'),
  {kind:'TD',defensive:false,players:[{name:'Saquon Barkley',role:'scorer'},{name:'Saquon Barkley',role:'two-point'}]});
 assert.deepEqual(parseScoringPlay('Brandon Aubrey 52 Yd Field Goal'),{kind:'FG',defensive:false,players:[{name:'Brandon Aubrey',role:'kicker'}]});
 assert.deepEqual(parseScoringPlay('Brandon Aubrey 52 Yd Field Goal','Field Goal Good','Field Goal'),{kind:'FG',defensive:false,players:[{name:'Brandon Aubrey',role:'kicker'}]});
 assert.deepEqual(parseScoringPlay("Derek Stingley Jr. 46 Yd Interception Return (Ka'imi Fairbairn Kick)"),
  {kind:'TD',defensive:true,players:[{name:'Derek Stingley Jr.',role:'scorer'},{name:"Ka'imi Fairbairn",role:'pat'}]});
 assert.equal(parseScoringPlay('Marcus Jones 2 Yd Fumble Recovery (Chad Ryland Kick)','Fumble Recovery (Touchdown)','Touchdown').defensive,true);
 const saf=parseScoringPlay('Safety','Safety','Safety');
 assert.equal(saf.kind,'SAF');assert.equal(saf.defensive,true);assert.deepEqual(saf.players,[]);
 assert.deepEqual(parseScoringPlay('Marcus Jones Defensive PAT Conversion','','Two Point Conversion'),
  {kind:'D2P',defensive:true,players:[{name:'Marcus Jones',role:'scorer'}]});
 assert.deepEqual(parseScoringPlay(''),{kind:'TD',defensive:false,players:[]});
});
test('parseScoringPlay() does not credit failed or blocked extra points, or team placeholders',()=>{
 assert.deepEqual(parseScoringPlay('Jalen Hurts 1 Yd Rush (Jake Elliott PAT failed)').players,[{name:'Jalen Hurts',role:'scorer'}]);
 assert.deepEqual(parseScoringPlay('Jalen Hurts 1 Yd Rush (Kick failed)').players,[{name:'Jalen Hurts',role:'scorer'}]);
 assert.deepEqual(parseScoringPlay('Jalen Hurts 1 Yd Rush (Jake Elliott Kick blocked)').players,[{name:'Jalen Hurts',role:'scorer'}]);
 assert.deepEqual(parseScoringPlay('Jalen Hurts 1 Yd Rush (Two-Point Pass failed)').players,[{name:'Jalen Hurts',role:'scorer'}]);
 assert.deepEqual(parseScoringPlay('Jalen Hurts 1 Yd Rush (Team Run for Two-Point Conversion)').players,[{name:'Jalen Hurts',role:'scorer'}]);
 assert.deepEqual(parseScoringPlay('Jalen Hurts 1 Yd Rush (Two-Point Run failed)').players,[{name:'Jalen Hurts',role:'scorer'}]);
});
test('worthReplaying() is false for an extra point alone and true for every highlight role',()=>{
 const p=byName('Jonathan Taylor');
 assert.equal(worthReplaying([]),false);
 assert.equal(worthReplaying([{player:p,role:'pat'}]),false);
 assert.equal(worthReplaying([{player:p,role:'pat'},{player:p,role:'pat'}]),false);
 for(const role of ['scorer','passer','kicker','defense','two-point'])assert.equal(worthReplaying([{player:p,role}]),true,role);
 assert.equal(worthReplaying([{player:p,role:'pat'},{player:p,role:'scorer'}]),true);
 assert.deepEqual([...HIGHLIGHT_ROLES].sort(),['defense','kicker','passer','scorer']);
});
test('describeScore() labels the score, names the scoring team and strips the parenthetical',()=>{
 const g=game('g1',[]);
 assert.deepEqual(describeScore({kind:'TD',team:MIN,away:7,home:14,text:'Justin Jefferson 9 Yd pass from J.J. McCarthy (Will Reichard Kick)'},g),
  {label:'Touchdown',team:'MIN',line:'IND 7 – MIN 14',text:'Justin Jefferson 9 Yd pass from J.J. McCarthy'});
 assert.deepEqual(describeScore({kind:'FG',team:IND,away:3,home:0,text:'Spencer Shrader 44 Yd Field Goal'},g),
  {label:'Field goal',team:'IND',line:'IND 3 – MIN 0',text:'Spencer Shrader 44 Yd Field Goal'});
 assert.equal(describeScore({kind:'SAF',team:IND,away:2,home:0,text:'Safety'},g).label,'Safety');
 assert.equal(describeScore({kind:'D2P',team:IND,away:2,home:0,text:'x'},g).label,'Defensive 2-pt');
 assert.equal(describeScore({kind:'??',team:IND,away:0,home:0,text:'x'},g).label,'Score');
});

test('seen()/update(): slack widens the window after the snap for feeds whose exact on-screen moment is uncertain',()=>{
 const c=new Coverage();const on=(c,a,b)=>{for(let t=a;t<b;t+=2)c.watch('g',t,Math.min(b,t+2));};
 on(c,96,110);   // on screen from 4 s before a snap at 100 until 10 s after
 assert.equal(c.seen('g',100),true,'the ordinary window [-3,+4] is covered');
 assert.equal(c.seen('g',100,12),false,'with 12 s of slack the window [-3,+16] is only half covered');
 on(c,110,118);
 assert.equal(c.seen('g',100,12),true);
 const game={id:'g',name:'G',teams:[{abbreviation:'IND'},{abbreviation:'MIN'}],scores:[{id:'g:1',at:100,team:0,kind:'TD',players:[{name:'Jonathan Taylor',role:'scorer'}],text:'J Taylor 5 Yd Rush'}]};
 const roster=[{name:'Jonathan Taylor',team:'IND',position:'RB'}];
 const d=new Coverage();on(d,96,118);
 assert.equal(d.update([game],roster,100+30+9+12-1,30,12).length,0,'with slack the score is judged later');
 const [item]=d.update([game],roster,100+30+9+12,30,12);
 assert.equal(item.id,'g:1');assert.equal(item.seen,false,'the delayed window [127,146] was not on screen');
});

test('watch preserves earlier intervals after a rewind and merges overlaps without double counting',()=>{
 const c=new Coverage();c.watch('g',100,104);c.watch('g',90,94);assert.deepEqual(c.intervals.get('g'),[[90,94],[100,104]]);
 c.watch('g',92,96);c.watch('g',95,100);assert.deepEqual(c.intervals.get('g'),[[90,104]]);
 assert.equal(c.seen('g',97),true);assert.equal(c.seen('g',110),false);
});
