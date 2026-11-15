import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './helpers.js';
import {rehearsalFrame} from '../rehearsal.js';

test('72-second rehearsal makes real tab calls, starts a local replay, recovers from an outage, and restores the live setup',async()=>{
 const h=harness();await h.setup();const config=structuredClone(h.director.s.config),bindings=structuredClone(h.director.s.runtime.bindings);
 h.director.request=async()=>{throw new Error('Rehearsal must not request the network');};
 await h.director.dispatch({action:'rehearsal'});let r=h.director.s.runtime;assert.equal(r.lab.tabs.length,4);assert.equal(h.offscreen(),true);assert.equal(r.currentGame,'demo-1');
 const owned=r.lab.tabs.map(t=>t.tabId),seen=new Set([r.currentGame]);let replaySeen=false;
 for(let second=1;second<=72;second++){
   h.advance(1000);const f=rehearsalFrame(second,h.now());
   await h.director.packet({...f,type:f.offline?'feedError':'feed',error:f.offline?'Rehearsal outage':'',token:r.engineToken,meta:{receivedAt:h.now(),networkMs:0},lab:true});
   seen.add(r.currentGame);
   if(r.replay&&!replaySeen){replaySeen=true;const sender={url:h.api.runtime.getURL('replay.html'),tab:{id:r.player.tabId}};
     const state=await h.director.playerRequest({action:'playerState'},sender);assert.ok(state.url.endsWith('assets/rehearsal.webm'));
     await h.director.playerRequest({action:'playerEvent',nonce:r.replay.nonce,event:'ready'},sender);
     await h.director.playerRequest({action:'playerEvent',nonce:r.replay.nonce,event:'playing'},sender);
   }
   if(second===35 && r.replay)await h.director.playerRequest({action:'playerEvent',nonce:r.replay.nonce,event:'ended'},{url:h.api.runtime.getURL('replay.html'),tab:{id:r.player.tabId}});
   if(second===52)assert.equal(r.decisionCode,'stale');
 }
 assert.equal(replaySeen,true);assert.ok(seen.has('demo-2'));assert.ok(seen.has('demo-4'));assert.equal(r.lab.complete,true);assert.equal(r.running,false);assert.equal(h.offscreen(),false);
 assert.ok(h.calls.filter(c=>c[0]==='tab' && c[2].active).length>=5);
 // Navigated test tabs are no longer ours to close.
 h.tabs.get(owned[0]).url='https://example.test/user-navigation';
 await h.director.dispatch({action:'exitRehearsal'});r=h.director.s.runtime;
 assert.equal(r.lab,null);assert.deepEqual(h.director.s.config,config);assert.deepEqual(Object.keys(r.bindings),Object.keys(bindings));assert.equal(r.running,false);
 assert.equal(h.tabs.has(owned[0]),true);for(const id of owned.slice(1))assert.equal(h.tabs.has(id),false);
});
test('rehearsal works without a league or network and can be stopped and rerun',async()=>{
 const h=harness({request:async()=>{throw new Error('No network');}});await h.director.dispatch({action:'rehearsal'});assert.equal(h.director.s.runtime.currentGame,'demo-1');
 const old=h.director.s.runtime.engineToken;await h.director.dispatch({action:'stop'});assert.equal(h.offscreen(),false);
 await assert.rejects(h.director.dispatch({action:'settings',config:{teamId:'unexpected'}}),/Exit rehearsal/);
 await h.director.dispatch({action:'rehearsal'});assert.notEqual(h.director.s.runtime.engineToken,old);assert.equal(h.director.s.runtime.lab.elapsed,0);
 await h.director.dispatch({action:'exitRehearsal'});assert.equal(h.director.s.runtime.league,null);assert.equal(h.tabs.size,0);
});
