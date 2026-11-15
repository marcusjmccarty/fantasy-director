import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,normalizeLeague,normalizeScoreboard,rankGames,chooseGame,delayedGames,validateConfig} from '../engine.js';
import {demoData} from '../demo.js';
const now=1000000;
const config={...DEFAULTS,holdSeconds:8};
const data=demoData(0,now),roster=data.league.teams[0].players;
test('league adapter selects actual starters, excludes bench and IR, and preserves team IDs',()=> {
 const raw={scoringPeriodId:7,teams:[{id:4,name:'Test team',roster:{entries:[
  {lineupSlotId:0,playerPoolEntry:{player:{id:1,fullName:'Quarterback',defaultPositionId:1,proTeamId:3}}},
  {lineupSlotId:20,playerPoolEntry:{player:{id:2,fullName:'Bench',defaultPositionId:2,proTeamId:9}}},
  {lineupSlotId:21,playerPoolEntry:{player:{id:3,fullName:'IR',defaultPositionId:3,proTeamId:11}}}
 ]}}]};
 const league=normalizeLeague(raw);assert.equal(league.week,7);assert.equal(league.teams[0].id,'4');assert.deepEqual(league.teams[0].players.map(p=>p.starter),[true,false,false]);assert.equal(league.teams[0].players[0].teamId,'3');assert.throws(()=>normalizeLeague({}));
});
test('scoreboard handles possession objects, completion, and missing situation conservatively',()=> {
 const event={id:'x',competitions:[{competitors:[{team:{id:3},score:'7'},{team:{id:9},score:'3'}],status:{type:{state:'in'}},situation:{possession:{id:3},isRedZone:true}}]};
 let game=normalizeScoreboard({events:[event]},now)[0];assert.equal(game.possession,'3');assert.equal(game.redZone,true);
 event.competitions[0].situation={lastPlay:{team:{id:3}},isRedZone:true};
 game=normalizeScoreboard({events:[event]},now)[0];assert.equal(game.possession,'');
 event.competitions[0].status.type.completed=true;assert.equal(normalizeScoreboard({events:[event]})[0].state,'post');
 assert.throws(()=>normalizeScoreboard({bad:true}));assert.deepEqual(normalizeScoreboard({events:[]}),[]);
});
test('roster offense in red zone wins; possession change changes the recommendation',()=> {
 assert.equal(rankGames(data.games,roster,config)[0].id,'demo-1');
 assert.equal(rankGames(demoData(1,now).games,roster,config)[0].id,'demo-2');
});
test('bench exclusion prevents roster priority; nonlive states never drive automatic cuts',()=> {
 const bench=[{...roster[0],starter:false}];
 assert.ok(rankGames(data.games,bench,config).every(g=>!g.rosterActive));
 assert.equal(rankGames(data.games,bench,{includeBench:true})[0].id,'demo-1');
 for (const state of ['pre','post']) assert.ok(rankGames(data.games.map(g=>({...g,state})),roster,config).every(g=>!g.eligible));
 for(const statusName of ['STATUS_HALFTIME','STATUS_DELAYED','STATUS_SUSPENDED','STATUS_END_PERIOD']) assert.ok(rankGames(data.games.map(g=>({...g,statusName})),roster,config).every(g=>!g.eligible));
});
test('defense scores on opposing possession; kicker gets fourth-down opportunity, no imaginary red-zone offense',()=> {
 const game=data.games[0];
 let ranked=rankGames([game],[{teamId:'9',position:'D/ST',starter:true}],config);
 assert.match(ranked[0].reason,/defense faces the opposing possession/);assert.doesNotMatch(ranked[0].reason,/offense/);
 ranked=rankGames([{...game,down:4}],[{teamId:'3',position:'K',starter:true}],config);assert.match(ranked[0].reason,/kicker/);
 ranked=rankGames([{...game,possession:''}],roster,config);assert.doesNotMatch(ranked[0].reason,/in the red zone/);
});
const runtime={running:true,fetchedAt:now,switchedAt:0,currentGame:'',lockGame:'',feedError:''};
const ranked=rankGames(data.games,roster,config);
test('only assigned streams can be selected; stopped, stale, error, and manual lock block switching',()=> {
 assert.equal(chooseGame(ranked,{},runtime,config,now).game,null);
 assert.equal(chooseGame(ranked,{'demo-2':true},runtime,config,now).game.id,'demo-2');
 for(const overrides of [{running:false},{fetchedAt:now-90001},{feedError:'offline'},{lockGame:'demo-2'}]) assert.equal(chooseGame(ranked,{'demo-1':true},{...runtime,...overrides},config,now).game,null);
});
test('hold time and hysteresis prevent stream flapping, ended current game can cut immediately',()=> {
 const bindings={'demo-1':true,'demo-2':true};
 const sameTier=ranked.map(g=>({...g,rosterActive:true}));
 assert.equal(chooseGame(sameTier,bindings,{...runtime,currentGame:'demo-2',switchedAt:now-1000},config,now).game,null);
 const tied=ranked.map(g=>({...g,score:50,rosterActive:false,redZone:false,yardsToGoal:40}));
 assert.equal(chooseGame(tied,bindings,{...runtime,currentGame:'demo-2',switchedAt:now-60000},config,now).game,null);
 assert.equal(chooseGame(ranked,bindings,{...runtime,currentGame:'finished',switchedAt:now-1000},config,now).game.id,'demo-1');
});
test('delay buffer never uses future snapshots and waits until enough history exists',()=> {
 const history=[{at:now-60000,games:['old']},{at:now,games:['new']}];
 assert.deepEqual(delayedGames(history,30,now),['old']);assert.deepEqual(delayedGames(history,0,now),['new']);assert.equal(delayedGames(history,120,now),null);
});
test('settings are range checked and whitelist fields so credentials cannot leak into config',()=> {
 assert.throws(()=>validateConfig({leagueId:'bad'}));assert.throws(()=>validateConfig({holdSeconds:0}));assert.throws(()=>validateConfig({delaySeconds:121}));assert.throws(()=>validateConfig({season:NaN}));
 const c=validateConfig({espn_s2:'do-not-store',swid:'do-not-store',teamId:2});assert.equal(c.teamId,'2');assert.equal(c.espn_s2,undefined);assert.equal(c.swid,undefined);
});
