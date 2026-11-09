import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseGame,rankGames,alignedGames,DEFAULTS,normalizeScoreboard} from '../engine.js';
import {playPhase} from '../adapters.js';
import {game,rawBoard} from './helpers.js';
const now=2000000000000;
const runtime={running:true,fetchedAt:now,currentGame:'2',switchedAt:now-3000,lastSwitchMode:'redzone'};
const bindings={'1':{},'2':{}};
const roster=[{id:'p1',name:'QB',position:'QB',teamId:'3',starter:true}];
test('new roster possession bypasses routine hold as soon as fresh data arrives',()=>{
 const result=chooseGame(rankGames([game('1','3',80),game('2','21',1)],roster),bindings,runtime,DEFAULTS,now);assert.equal(result.game.id,'1');assert.equal(result.code,'urgent');
});
test('new red-zone and goal-line threats bypass hold within the same roster tier',()=>{
 for(const [a,b] of [[18,40],[3,15]]){const ranked=rankGames([game('1','9',a),game('2','21',b)],[]);assert.equal(chooseGame(ranked,bindings,runtime,DEFAULTS,now).game.id,'1');}
});
test('an urgent opportunity respects a two-second anti-flap guard and no longer',()=>{
 const ranked=rankGames([game('1','9',2),game('2','21',40)],[]);
 assert.equal(chooseGame(ranked,bindings,{...runtime,switchedAt:now-1999},DEFAULTS,now).game,null);
 assert.equal(chooseGame(ranked,bindings,{...runtime,switchedAt:now-2000},DEFAULTS,now).game.id,'1');
});
test('a completed touchdown is not mistaken for an upcoming goal-line opportunity',()=>{
 const raw=rawBoard([game('1','3',0,{phase:'between-drives'}),game('2','21',45)]),games=normalizeScoreboard(raw);
 const ranked=rankGames(games,roster);assert.equal(ranked.find(g=>g.id==='1').eligible,false);assert.equal(chooseGame(ranked,bindings,{...runtime,currentGame:'1'},DEFAULTS,now).game.id,'2');
 assert.equal(playPhase({type:{text:'Passing Touchdown'},text:'Play reversed. No play.'}),'scrimmage');
});
test('routine candidates must remain best for two seconds; a changed leader resets settling',()=>{
 const games=rankGames([game('1','9',25),game('2','21',40)],[]),r={...runtime,switchedAt:now-20000};
 const first=chooseGame(games,bindings,r,DEFAULTS,now);assert.equal(first.game,null);assert.equal(first.candidate.id,'1');
 assert.equal(chooseGame(games,bindings,{...r,candidate:first.candidate},DEFAULTS,now+1999).game,null);
 assert.equal(chooseGame(games,bindings,{...r,candidate:first.candidate},DEFAULTS,now+2000).game.id,'1');
 assert.equal(chooseGame(rankGames([game('1','9',50),game('2','21',40)],[]),bindings,{...r,candidate:first.candidate},DEFAULTS,now+2000).candidate,null);
});
test('a more urgent unrelated game cannot displace confirmed roster involvement',()=>{
 const ranked=rankGames([game('1','3',70),game('2','21',1)],roster);
 assert.equal(chooseGame(ranked,bindings,{...runtime,currentGame:'1',switchedAt:now-120000,lastSwitchMode:'roster'},DEFAULTS,now).game,null);
});
test('per-stream alignment uses the proper historical snapshot; zero never adds an artificial wait',()=>{
 const old=[game('1','9',80),game('2','21',40)],latest=[game('1','3',10),game('2','6',15)],history=[{at:now-40000,games:old},{at:now,games:latest}];
 const aligned=alignedGames(latest,history,{'1':{delaySeconds:30},'2':{delaySeconds:0}},0,now);assert.equal(aligned[0].possession,'9');assert.equal(aligned[1].possession,'6');
 assert.equal(alignedGames(latest,history,{'1':{delaySeconds:120}},0,now)[0].buffering,true);
});
test('aligned game cannot be chosen before its buffer exists',()=>{
 const latest=[game('1','3',3),game('2','21',40)],aligned=alignedGames(latest,[{at:now,games:latest}],{'1':{delaySeconds:30}},0,now);
 const ranked=rankGames(aligned,roster);assert.equal(ranked.find(g=>g.id==='1').eligible,false);
});
test('locked, replaying, stale and stopped states never cut even for goal-line opportunities',()=>{
 const ranked=rankGames([game('1','3',1),game('2','21',40)],roster);
 for(const override of [{lockGame:'2'},{replay:{}},{fetchedAt:now-21000},{running:false},{feedError:'offline'}])assert.equal(chooseGame(ranked,bindings,{...runtime,...override},DEFAULTS,now).game,null);
});
test('rotation prevents indefinite ties while preserving an active red-zone drive',()=>{
 const ranked=rankGames([game('1','',null),game('2','',null)],[]),r={...runtime,switchedAt:now-100000};
 const pending=chooseGame(ranked,bindings,r,DEFAULTS,now);assert.equal(pending.candidate.id,'1');assert.equal(chooseGame(ranked,bindings,{...r,candidate:pending.candidate},DEFAULTS,now+2000).code,'rotation');
 const red=rankGames([game('1','9',10),game('2','21',10)],[]);assert.equal(chooseGame(red,bindings,r,DEFAULTS,now).game,null);
});
test('ambiguous possession cannot claim roster involvement or a scoring threat',()=>{
 const ranked=rankGames([game('1','',3,{redZone:true}),game('2','21',40)],roster);assert.equal(ranked[0].id,'2');assert.equal(ranked.find(g=>g.id==='1').rosterActive,false);
});
