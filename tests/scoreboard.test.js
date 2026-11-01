import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCards,fantasyBoard,FantasyScoreFeed,formatPoints} from '../web/scoreboard.js';
import {fantasyScores} from '../server/api.js';

const starter=(id,points,slot=2)=>({lineupSlotId:slot,playerPoolEntry:{appliedStatTotal:points,player:{id,fullName:'Player '+id,proTeamId:11,defaultPositionId:2,stats:[{scoringPeriodId:8,statSourceId:0,statSplitTypeId:1,appliedTotal:points}]}}});
const league=entries=>({scoringPeriodId:8,teams:[{id:1,roster:{entries}}]});
test('fantasy totals apply ESPN league points to starters, excluding bench and IR',()=>{
 const data=fantasyScores(league([starter(1,22.34),starter(2,-1.2),starter(3,0),starter(4,80,20),starter(5,40,21)]));
 assert.equal(data.week,8);assert.equal(data.teams[0].points,21.14);assert.equal(data.teams[0].players.length,3);assert.equal(data.teams[0].complete,true);
});
test('actual weekly stats take priority over projections and season totals',()=>{
 const entry=starter(1,9);entry.playerPoolEntry.player.stats=[{scoringPeriodId:0,statSourceId:0,statSplitTypeId:0,appliedTotal:200},{scoringPeriodId:8,statSourceId:1,statSplitTypeId:1,appliedTotal:35},{scoringPeriodId:7,statSourceId:0,statSplitTypeId:1,appliedTotal:30},{scoringPeriodId:8,statSourceId:0,statSplitTypeId:1,appliedTotal:11.5}];
 assert.equal(fantasyScores(league([entry])).teams[0].points,11.5);
});
test('ESPN cumulative pool totals cannot fill in a missing current week',()=>{
 const entry=starter(1,54);entry.playerPoolEntry.player.stats=[{scoringPeriodId:7,statSourceId:0,statSplitTypeId:1,appliedTotal:26}];
 assert.equal(fantasyScores(league([entry])).teams[0].points,null);
 entry.playerPoolEntry.player.stats=[];assert.equal(fantasyScores(league([entry])).teams[0].points,null);
});
test('missing stats, unknown week and empty rosters cannot produce a misleading total',()=>{
 for(const value of [null,undefined,'',NaN,Infinity]){const data=fantasyScores(league([starter(1,10),starter(2,value)]));assert.equal(data.teams[0].points,null);assert.equal(data.teams[0].complete,false);}
 assert.equal(fantasyScores({...league([starter(1,20)]),scoringPeriodId:0}).teams[0].points,null);
 assert.equal(fantasyScores(league([])).teams[0].points,null);
 assert.equal(formatPoints(null),'—');assert.equal(formatPoints(-0.25),'-0.25');
});
test('fantasy player rows distinguish missing points and escape upstream names',()=>{
 const data={scoring:fantasyScores(league([starter('<img onerror=x>',null),starter(2,-2)]))};
 const board=fantasyBoard(data,'1');assert.equal(board.points,'—');assert.match(board.rows,/&lt;img onerror=x&gt;/);assert.doesNotMatch(board.rows,/<img onerror/);assert.match(board.rows,/-2.00/);assert.equal(fantasyBoard(data,'2'),null);
});
const game={id:'123',name:'IND at MIN',state:'in',detail:'Q3 10:00',score:[24,17],scoreKnown:true,teams:[{abbr:'IND',name:'Indianapolis Colts'},{abbr:'MIN',name:'Minnesota Vikings'}],possession:0,downDistance:'2nd & 5'};
test('NFL cards distinguish live, scheduled, final and missing scores',()=>{
 assert.match(scoreCards([game]),/>24</);assert.match(scoreCards([game]),/IND · Ball/);
 const pre=scoreCards([{...game,state:'pre',date:'2026-11-02T01:00:00Z'}]);assert.doesNotMatch(pre,/>24</);assert.match(pre,/>—</);
 assert.doesNotMatch(scoreCards([{...game,scoreKnown:false}]),/>24</);
 assert.match(scoreCards([{...game,state:'post'}]),/sb-winner/);
});
test('NFL filter includes every roster game without mutating the shared feed',()=>{
 const games=[{...game,id:'2',teams:[{abbr:'SEA'},{abbr:'SF'}]},game],before=JSON.stringify(games);
 assert.doesNotMatch(scoreCards(games,[{team:'IND',name:'Taylor'}],{mine:true}),/San Francisco|>SF</);
 assert.match(scoreCards(games,[{team:'IND',name:'Taylor'}],{mine:true}),/Taylor/);assert.equal(JSON.stringify(games),before);
 assert.match(scoreCards(games,[],{mine:true}),/No games for your starters/);
});
const connection={leagueId:'123',teamId:'1',swid:'',s2:''};
const result=(id='123',points=10)=>({leagueId:id,scoring:{week:8,teams:[{id:'1',players:[],points}]}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('fantasy polling coalesces renders, refreshes after 30 seconds and accepts corrections',async()=>{
 let now=1000,calls=0;const wait=deferred();const feed=new FantasyScoreFeed({now:()=>now,fetcher:()=>{calls++;return calls===1?wait.promise:Promise.resolve(Response.json(result('123',8)));}});
 const first=feed.sync(connection);feed.sync(connection);assert.equal(calls,1);wait.resolve(Response.json(result()));await first;feed.sync(connection);assert.equal(calls,1);
 now+=30000;await feed.sync(connection);assert.equal(calls,2);assert.equal(feed.data.scoring.teams[0].points,8);
});
test('a late league response cannot overwrite a different league or restore replay scores',async()=>{
 const old=deferred();let calls=0;const feed=new FantasyScoreFeed({fetcher:()=>++calls===1?old.promise:Promise.resolve(Response.json(result('456')))});
 const first=feed.sync(connection);await feed.sync({...connection,leagueId:'456'});old.resolve(Response.json(result()));await first;assert.equal(feed.data.leagueId,'456');
 feed.sync(null);assert.equal(feed.data,null);assert.equal(feed.key,'');
});
test('score failures preserve the last result, label it stale and retry without changing a roster',async()=>{
 let now=1,calls=0;const feed=new FantasyScoreFeed({now:()=>now,fetcher:async()=>++calls===1?Response.json(result()):Response.json({error:'Unavailable'},{status:502})});
 await feed.sync(connection);now+=30000;await feed.sync(connection);assert.equal(feed.data.scoring.teams[0].points,10);assert.match(feed.error,/Retrying/);assert.equal(feed.updated,1);assert.equal(feed.next,60001);
});
test('week rollover clears old points and rejects a response from the wrong scoring period',async()=>{
 const feed=new FantasyScoreFeed({fetcher:async()=>Response.json({...result(),season:2026})});
 await feed.sync({...connection,week:8,season:2026});assert.equal(feed.data.scoring.week,8);
 await feed.sync({...connection,week:9,season:2026});assert.equal(feed.data,null);assert.match(feed.error,/Retrying/);
});
