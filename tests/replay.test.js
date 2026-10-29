import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarios,SOURCES} from '../web/replays.js';
import {chooseGame} from '../web/director.js';
const roster=[{name:'Receiver',team:'PHI',position:'WR'},{name:'Runner',team:'IND',position:'RB'}];
test('real replay fixture directs roster, fallback, quiet highlight window and priority return',()=>{
 ['replay-phi','replay-ind','replay-phi',undefined,'replay-ind'].forEach((id,i)=>assert.equal(chooseGame(scenarios(i),roster,null,0,9999)?.game.id,id));
});
test('replay fixtures keep scripted data separate from real videos',()=>{for(const g of scenarios(0)){assert.equal(g.detail,'Scripted test event');assert.ok(g.teams.every(t=>t.score===''));assert.ok(g.embed.startsWith('https://ok.ru/videoembed/'));assert.ok(g.page.startsWith('https://nfl-video.com/'));}assert.equal(SOURCES.length,2);});
