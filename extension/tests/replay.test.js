import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,game} from './helpers.js';
import {normalizeHighlights,mediaURL,playable,mergeHighlights} from '../highlights.js';
import {nextReplay} from '../replay-policy.js';
const source='https://espnmedia-cdn.akamaized.net/espn/media/16x9/test/clip.mp4';
const clip=now=>({id:'clip:77',kind:'clip',gameId:'1',gameName:'CHI @ GB',title:'Published clip',description:'',athleteIds:[],teamIds:[],duration:20,publishedAt:now,discoveredAt:now,mediaUrl:source,url:'https://www.espn.com/video/clip/_/id/77'});
const sender=h=>({url:h.api.runtime.getURL('replay.html'),tab:{id:h.director.s.runtime.player.tabId}});
const event=(h,type,nonce=h.director.s.runtime.replay?.nonce)=>h.director.playerRequest({action:'playerEvent',event:type,nonce},sender(h));
async function quiet(){const h=harness();await h.setup();await h.director.dispatch({action:'start'});h.director.s.runtime.highlights=[clip(h.now())];h.advance(6000);await h.feed([game('1','9',70),game('2','21',70)]);return h;}

test('published source is parsed with embargo, expiry, and desktop restrictions',()=>{
 const now=Date.now(),videos=[{id:77,duration:20,links:{source:{href:source}},timeRestrictions:{embargoDate:new Date(now-1000).toISOString(),expirationDate:new Date(now+1000).toISOString()},deviceRestrictions:{type:'whitelist',devices:['desktop']}}];
 const item=normalizeHighlights({videos},game(),now)[0];assert.equal(item.mediaUrl,source);assert.equal(playable(item,now),true);assert.equal(playable(item,now+1001),false);assert.equal(playable(item,now-1001),false);
 assert.equal(playable({...item,desktopAllowed:false},now),false);
 for(const url of ['https://evil.test/clip.mp4','https://espnmedia-cdn.akamaized.net.evil.test/clip.mp4','http://espnmedia-cdn.akamaized.net/clip.mp4','https://u:p@espnmedia-cdn.akamaized.net/clip.mp4','https://espnmedia-cdn.akamaized.net/clip.m3u8'])assert.equal(mediaURL(url),null);
});
test('quiet coverage automatically prepares a clip without waiting for a click',async()=>{
 const h=await quiet(),r=h.director.s.runtime;assert.equal(r.replay.automatic,true);assert.equal(r.replay.phase,'loading');
 assert.equal(r.currentGame,'2');assert.equal(h.tabs.get(102).mutedInfo.muted,false);
 const state=await h.director.playerRequest({action:'playerState'},sender(h));assert.equal(state.url,source);
 await event(h,'ready');assert.equal(h.tabs.get(101).mutedInfo.muted,true);assert.equal(h.tabs.get(102).mutedInfo.muted,true);assert.equal(r.replay.phase,'playing');
 await event(h,'playing');assert.equal(r.highlights[0].played,true);
 await event(h,'ended');assert.equal(r.replay,null);assert.ok(r.currentGame);assert.equal(r.running,true);assert.equal(h.tabs.has(r.player.tabId),true);
});
test('live scoring threat preempts automatic replay and stale player events cannot affect the next clip',async()=>{
 const h=await quiet();const old=h.director.s.runtime.replay.nonce;await event(h,'ready');await event(h,'playing');h.advance(1000);
 await h.feed([game('1','9',3),game('2','21',70)]);assert.equal(h.director.s.runtime.replay,null);assert.equal(h.director.s.runtime.currentGame,'1');
 assert.equal(await event(h,'ended',old),null);assert.equal(h.director.s.runtime.currentGame,'1');
});
test('roster involvement, a lock, Watch preview, stale feed and long clips suppress automatic replay',async()=>{
 const h=await quiet(),r=h.director.s.runtime;await event(h,'ended');const item=clip(h.now());
 const base={...r,replay:null,lastReplayAt:0,quietSince:h.now()-6000,manualUntil:0};const c=h.director.s.config;
 for(const patch of [{lockGame:'1'},{manualUntil:h.now()+10000},{feedError:'offline'},{fetchedAt:h.now()-200000}])assert.equal(nextReplay([item],h.director.games(),{...base,...patch},c,h.now()),null);
 assert.equal(nextReplay([{...item,duration:200}],h.director.games(),base,c,h.now()),null);
 assert.equal(nextReplay([item],h.director.games().map(g=>({...g,rosterActive:true})),base,c,h.now()),null);
});
test('failed playback and missing player readiness return to live without retry loops',async()=>{
 const h=await quiet();await event(h,'error');assert.equal(h.director.s.runtime.replay,null);assert.equal(h.director.s.runtime.highlights[0].playbackError,'Playback unavailable');
 h.advance(121000);await h.feed([game('1','9',70),game('2','21',70)]);assert.equal(h.director.s.runtime.replay,null);
 h.director.s.runtime.highlights=[{...clip(h.now()),id:'clip:78'}];h.advance(6000);await h.feed([game('1','9',70),game('2','21',70)]);assert.ok(h.director.s.runtime.replay);
 h.advance(13000);await h.pulse();assert.equal(h.director.s.runtime.replay,null);assert.ok(h.director.s.runtime.currentGame);
});
test('replay player rejects other tabs and preserves manual locks on return',async()=>{
 const h=await quiet();await assert.rejects(h.director.playerRequest({action:'playerState'},{url:h.api.runtime.getURL('replay.html'),tab:{id:999}}),/not owned/);
 await event(h,'ended');await h.director.dispatch({action:'lock',gameId:'1'});await h.director.dispatch({action:'openHighlight',highlightId:'clip:77'});
 await event(h,'ready');await event(h,'ended');assert.equal(h.director.s.runtime.lockGame,'1');assert.equal(h.director.s.runtime.currentGame,'1');
});
test('played/attempted flags survive repeated feed updates and expiry excludes automation',()=>{
 const now=Date.now(),old={...clip(now),played:true,attemptedAt:now,playbackError:'Unavailable'},merged=mergeHighlights([old],[clip(now+1000)],now+1000);
 assert.equal(merged[0].played,true);assert.equal(merged[0].attemptedAt,now);assert.equal(merged[0].playbackError,'Unavailable');
});
test('Stop clears the owned player and restores original stream audio',async()=>{
 const h=await quiet();await event(h,'ready');await h.director.dispatch({action:'stop'});assert.equal(h.director.s.runtime.replay,null);assert.equal(h.offscreen(),false);
 assert.equal(h.tabs.get(101).mutedInfo.muted,true);assert.equal(h.tabs.get(102).mutedInfo.muted,false);assert.ok(h.messages.some(m=>m.target==='replay-player'&&m.type==='clear'));
});
test('off-hours highlight queue does not require a league or stream assignments',async()=>{
 const h=harness();await h.director.ready();h.director.ingest([game('1','3',70,{state:'post'})],{receivedAt:h.now(),networkMs:0},[clip(h.now())]);
 await h.director.dispatch({action:'reel'});assert.equal(h.director.s.runtime.replay.automatic,true);assert.equal(h.director.s.runtime.reel,true);
 await event(h,'ready');await event(h,'ended');assert.equal(h.director.s.runtime.running,true);await h.director.dispatch({action:'stop'});
});
test('closing or navigating the owned player returns to coverage and never closes an unrelated destination',async()=>{
 const h=await quiet();await event(h,'ready');const id=h.director.s.runtime.player.tabId;
 h.tabs.get(id).url='https://example.test/unrelated';await h.director.tabChanged(id);
 assert.equal(h.director.s.runtime.replay,null);assert.ok(h.director.s.runtime.currentGame);assert.equal(h.tabs.has(id),true);
});
test('Return to live exits an off-hours reel instead of immediately queuing another clip',async()=>{
 const h=harness();await h.director.ready();h.director.ingest([game('1','3',70,{state:'post'})],{receivedAt:h.now(),networkMs:0},[clip(h.now())]);
 await h.director.dispatch({action:'reel'});await h.director.dispatch({action:'returnLive'});
 assert.equal(h.director.s.runtime.running,false);assert.equal(h.director.s.runtime.reel,false);assert.equal(h.director.s.runtime.replay,null);
});
