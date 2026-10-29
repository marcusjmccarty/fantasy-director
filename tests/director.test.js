import test from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE_ROSTER,simulation} from './fixtures/simulation.js';
import {StreamDirector,rankGames,rosterForGame,chooseGame,involved,parseRoster,safeVideo} from '../web/director.js';
import {normalizeScoreboard} from '../web/adapters.js';
test('rehearsal follows three roster offenses, then the closest scoring threat, then a quiet window',()=>{
 const expected=['test-0','test-1','test-2','test-3',undefined,'test-0'];
 expected.forEach((id,i)=>assert.equal(chooseGame(simulation(i*12),SAMPLE_ROSTER,'test-0',0,10000)?.game.id,id));
});
test('urgent roster possession immediately replaces another game',()=>{assert.equal(chooseGame(simulation(12),SAMPLE_ROSTER,'test-0',9999,10000).game.id,'test-1');});
test('no roster defaults to nearest goal line',()=>{const g=simulation(0);g[3].yardsToGoal=2;assert.equal(chooseGame(g,[],null,0,10).game.id,'test-3');});
test('completed scoring plays and unknown possession do not count as roster involvement',()=>{const g=simulation(0)[0];assert.equal(involved({...g,phase:'between-drives'},SAMPLE_ROSTER).length,0);assert.equal(involved({...g,possession:''},SAMPLE_ROSTER).length,0);});
test('defense and kicking roles follow the relevant side',()=>{const g=simulation(0)[0];assert.equal(involved(g,[{team:'GB',position:'D/ST'}]).length,1);assert.equal(involved(g,[{team:'CHI',position:'K'}]).length,0);assert.equal(involved({...g,down:4},[{team:'CHI',position:'K'}]).length,1);});
test('roster and video input validation',()=>{assert.equal(parseRoster('Sample Player, jax, wr')[0].team,'JAC');assert.deepEqual(parseRoster(''),[]);assert.throws(()=>parseRoster('Missing fields'));assert.throws(()=>safeVideo('javascript:alert(1)'));assert.throws(()=>safeVideo('https://example.com/watch'));assert.equal(safeVideo('https://example.com/live.m3u8?token=abc'),'https://example.com/live.m3u8?token=abc');});
test('scoreboard adapter handles empty slate and possession distance',()=>{assert.deepEqual(normalizeScoreboard({events:[]}),[]);const [g]=normalizeScoreboard({events:[{id:'1',competitions:[{status:{type:{state:'in'}},competitors:[{team:{id:'3',abbreviation:'CHI'}},{team:{id:'9',abbreviation:'GB'}}],situation:{possession:'3',possessionText:'GB 12'}}]}]});assert.equal(g.yardsToGoal,12);});

test('the stream director never prefers a non-roster scoring threat to roster possession',()=>{
 const d=new StreamDirector(),games=simulation(0);games[3].yardsToGoal=1;
 assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now:20000}).game.id,'test-0');
 assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-3',now:20000}).game.id,'test-3');
 assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-3',now:21001}).game.id,'test-0');
});
test('a brief possession pause holds the roster game before RedZone fallback',()=>{
 const d=new StreamDirector(),games=simulation(36);d.commit(1000);
 assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now:20000}).game.id,'test-0');
 assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now:25999}).game.id,'test-0');
 d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now:26001});
 assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now:29002}).game.id,'test-3');
});
test('small yardage changes cannot cause repeated cuts between roster games',()=>{
 const d=new StreamDirector(),games=simulation(0);games[1].possession=games[1].teams[0].id;games[1].yardsToGoal=30;d.commit(1000);
 for(const now of [2000,5000,17000,60000])assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now}).game.id,'test-0');
 games[1].yardsToGoal=4;d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now:61000});assert.equal(d.choose(games,SAMPLE_ROSTER,{currentId:'test-0',now:62001}).game.id,'test-1');
});
test('roster-only mode excludes unrelated games and ads even when they are closest to scoring',()=>{
 const games=simulation(36),options={rosterOnly:true,excluded:new Set(['test-0'])};
 const ranked=rankGames(games,SAMPLE_ROSTER,options);assert.ok(ranked.length);assert.ok(ranked.every(x=>rosterForGame(x.game,SAMPLE_ROSTER).length));assert.ok(ranked.every(x=>!['test-0','test-3'].includes(x.game.id)));
 assert.equal(rankGames(games,[],{rosterOnly:true}).length,0);
});
test('possession matching normalizes numeric team IDs and roster aliases',()=>{
 const game=simulation(0)[0];game.teams[0].abbreviation='JAC';game.possession=Number(game.teams[0].id);
 const roster=[{name:'Receiver',team:'JAX',position:'WR'}];assert.equal(involved(game,roster).length,1);assert.equal(rosterForGame(game,roster).length,1);
});
