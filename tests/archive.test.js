import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ReplayArchive,ReplayClock,mediaTime,addSyncMark} from '../web/replay-engine.js';
import {chooseGame,involved} from '../web/director.js';
const data=JSON.parse(await readFile(new URL('../web/week7.json',import.meta.url),'utf8'));
const archive=new ReplayArchive(data);
test('all 14 real games have imported replay sources and sorted recorded events',()=>{
 assert.equal(archive.games.length,14);assert.equal(new Set(archive.games.map(g=>g.id)).size,14);
 assert.equal(archive.games.reduce((n,g)=>n+g.plays.length,0),2493);
 assert.equal(archive.sessions.length,3);
 for(const g of archive.games){assert.equal(new URL(g.page).hostname,'nfl-video.com');assert.match(g.embed,/^https:\/\/ok.ru\/videoembed\/\d+$/);assert.ok(g.plays.length>100);assert.ok(g.plays.every((p,i)=>!i||p[0]>=g.plays[i-1][0]));}
});
test('seeking backwards reproduces every game state without accumulated timer drift',()=>{
 const sunday=archive.sessions.find(s=>s.label.startsWith('Sunday'));
 const at=Date.parse('2026-10-25T17:20:00Z')/1000;const expected=archive.sample(at);
 archive.sample(sunday.end-200);assert.deepEqual(archive.sample(at),expected);
 assert.ok(expected.filter(g=>g.state==='in').length>5);
});
test('switching franchises changes priority against the same archived slate',()=>{
 const ind=[{name:'Colts starter',team:'IND',position:'RB'}],bal=[{name:'Ravens starter',team:'BAL',position:'QB'}];
 const at=archive.events.find(at=>{const games=archive.sample(at);return games.some(g=>involved(g,ind).length)&&games.some(g=>involved(g,bal).length);});
 assert.ok(at);const games=archive.sample(at);const a=chooseGame(games,ind,null,0,at*1000),b=chooseGame(games,bal,null,0,at*1000);
 assert.notEqual(a.game.id,b.game.id);assert.equal(a.players[0].team,'IND');assert.equal(b.players[0].team,'BAL');
});
test('next switch seeks to an actual upcoming recorded event',()=>{
 const s=archive.sessions.find(s=>s.label.startsWith('Sunday'));const at=s.start+60;const roster=[{name:'Runner',team:'IND',position:'RB'}];const current=chooseGame(archive.sample(at),roster,null,0,at*1000).game.id;
 const next=archive.nextSwitch(at,roster,current,s.end);assert.ok(next>at);assert.ok(archive.events.includes(next));assert.notEqual(chooseGame(archive.sample(next),roster,current,0,next*1000).game.id,current);
});
test('one shared clock respects pause, speed and backwards seek',()=>{
 const clock=new ReplayClock(100);clock.setRunning(true,1000);clock.rate=4;assert.equal(clock.tick(3500),110);clock.setRunning(false,3500);assert.equal(clock.tick(8000),110);clock.seek(25,8000);clock.setRunning(true,8000);assert.equal(clock.tick(8250),26);
});
test('recording offsets and multiple edit anchors map the same wallclock to media time',()=>{
 const g={start:1000};assert.equal(mediaTime(g,1060,{offset:12}),72);
 let c=addSyncMark({},0,10);c=addSyncMark(c,600,490);assert.equal(mediaTime(g,1300,c),250);assert.equal(mediaTime(g,1700,c),590);
 assert.throws(()=>addSyncMark(c,300,600),/forward/);
});
