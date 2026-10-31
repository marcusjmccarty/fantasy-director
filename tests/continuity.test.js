import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ReplayArchive,playWindow} from '../web/archive.js';
import {RecordingSync} from '../web/sync.js';
import {protectedReplayPlay,protectedHighlight,broadcastReplayWindow} from '../web/continuity.js';
const data=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
const archive=new ReplayArchive(data),g=archive.game('401873012'),sync=new RecordingSync(g,{types:data.types,anchors:g.anchors});
const flowers=[{name:'Zay Flowers',team:'BAL',position:'WR'}];
test('replay continuity: the Flowers Q4 reception keeps video time even where mapping compresses its play window',()=>{
 const p=g.plays[136],start=sync.media(p[0]),end=sync.media(p[0]+playWindow(data.types[p[3]],p[10]));
 assert.ok(end-start<6,'negative control: old mapped protection ends in under six seconds');
 assert.equal(protectedReplayPlay(g,data.types,sync,start+10,flowers).index,136);
 assert.ok(protectedReplayPlay(g,data.types,sync,start+19.9,flowers));
 assert.equal(protectedReplayPlay(g,data.types,sync,start+20,flowers),null);
});
test('replay continuity: a scoring play gets 32 media seconds even after the sampled phase changes',()=>{
 const start=sync.media(g.plays[4][0]);
 assert.equal(protectedReplayPlay(g,data.types,sync,start+30,flowers)?.index,4);
 assert.equal(protectedReplayPlay(g,data.types,sync,start+32,flowers),null);
 assert.equal(protectedReplayPlay(g,data.types,sync,start+10,[{name:'Other Player',team:'SEA',position:'RB'}]),null);
 assert.equal(protectedReplayPlay(g,data.types,sync,NaN,flowers),null);
});
test('replay continuity: a nearby earlier play covers the alignment gap at the Flowers scoring drive',()=>{
 // The stored OCR reports the scorebug running 13:45 -> 13:36 around
 // video 501..510, well before the interpolated scoring timestamp (538).
 assert.ok(protectedReplayPlay(g,data.types,sync,508,flowers));
});
test('broadcast fallback includes lead-in and the full scoring window in media seconds',()=>{
 const score=g.scores.find(s=>s.i===4),w=broadcastReplayWindow({at:score.at,score},g,sync);
 assert.ok(w.start<=501,'includes the earlier scoring-drive footage');
 assert.ok(w.start+w.duration>=sync.media(score.t)+32);
 assert.ok(w.duration>=47&&w.duration<=77);
 const edge=broadcastReplayWindow({at:98},{start:0,recordingDuration:100},{media:t=>t});
 assert.deepEqual(edge,{start:83,duration:17});
});
test('highlight continuity: short visible clips finish; loading, finished, and ad states release protection',()=>{
 const h={playing:true,done:false,src:{start:0,duration:20,fullClip:true}};
 assert.equal(protectedHighlight(h,{currentTime:12,duration:20}),true);
 assert.equal(protectedHighlight({...h,playing:false},{currentTime:0}),false);
 assert.equal(protectedHighlight({...h,done:true},{currentTime:20}),false);
 assert.equal(protectedHighlight(h,{currentTime:12,inAd:true}),false);
 assert.equal(protectedHighlight({...h,src:{...h.src,data:true}},{currentTime:12}),false);
});
test('highlight continuity: long and unknown clips do not hold the channel indefinitely',()=>{
 const h={playing:true,src:{start:0,duration:20,fullClip:true}};
 assert.equal(protectedHighlight(h,{currentTime:20,duration:180}),true);
 assert.equal(protectedHighlight(h,{currentTime:31,duration:180}),false,'actual long duration wins over a short catalog estimate');
 const unknown={...h,src:{start:0,duration:0,fullClip:true}};
 assert.equal(protectedHighlight(unknown,{currentTime:31}),false);
});

test('manual choice protects replay action even when neither team has a fantasy starter',()=>{
 const start=sync.media(g.plays[4][0]);assert.equal(protectedReplayPlay(g,data.types,sync,start+20,[]),null);
 assert.equal(protectedReplayPlay(g,data.types,sync,start+20,[],{allAction:true})?.index,4);
});
