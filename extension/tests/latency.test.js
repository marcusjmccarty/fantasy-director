import test from 'node:test';
import assert from 'node:assert/strict';
import {runBenchmark} from './latency-benchmark.js';
import {harness,game} from './helpers.js';
test('deterministic old/new comparison catches every scripted v3 opportunity within one polling interval',()=>{
 const result=runBenchmark();assert.equal(result.v30.captured,result.v30.total);assert.ok(result.v30.maxDelaySeconds<=5);assert.equal(result.v30.lateScoringCuts,0);
 assert.ok(result.v22.captured<result.v30.captured);assert.ok(result.v22.maxDelaySeconds>result.v30.maxDelaySeconds);
});
test('two-hour worker-driven session rotates tied data and handles a connection outage without stale cuts',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});const visited=new Set();
 for(let i=0;i<7200;i++){
  h.advance(1000);
  if(i>=300 && i<360){await h.pulse();if(i===330)assert.equal(h.director.s.runtime.decisionCode,'stale');}
  else if(i%5===0)await h.feed([game('1','',null),game('2','',null)]);else await h.pulse();
  visited.add(h.director.s.runtime.currentGame);
 }
 assert.equal(visited.size,2);assert.ok(h.director.s.runtime.switchCount>60);assert.equal(h.director.s.runtime.timing.samples.length,120);assert.ok(h.director.s.runtime.history.length<=100);await h.director.dispatch({action:'stop'});assert.equal(h.offscreen(),false);
});
