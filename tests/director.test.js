import test from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE_ROSTER,simulation,chooseGame,involved,parseRoster,safeVideo} from '../dist/director.js';
import {normalizeScoreboard} from '../dist/adapters.js';
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
