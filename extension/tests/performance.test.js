import test from 'node:test';
import assert from 'node:assert/strict';
import {measure} from './performance-benchmark.js';
import {harness} from './helpers.js';
test('steady state avoids full-history buffering and checkpoints at most once per 30 seconds',async()=>{
 const m=await measure();assert.ok(m.sessionWrites<=7);assert.equal(m.retainedHistorySnapshots,0);assert.equal(m.deskTimingSamples,1);assert.ok(m.deskPayloadBytes<25000);
});
test('unrelated tab changes do not write or broadcast director state',async()=>{
 const h=harness();await h.setup();let writes=0;h.api.storage.session.set=async()=>writes++;const messages=h.messages.length;
 await h.director.tabChanged(999);assert.equal(writes,0);assert.equal(h.messages.length,messages);
});
test('desk only includes selected team player details and hides the rehearsal backup',async()=>{
 const h=harness();await h.setup('fantasy');h.director.s.runtime.league.teams.push({id:'other',name:'Other team',players:[{name:'Private opponent player'}]});
 assert.equal(h.director.view().runtime.league.teams[1].players.length,0);
 await h.director.dispatch({action:'rehearsal'});assert.equal(h.director.view().runtime.lab.saved,undefined);
 await h.director.dispatch({action:'exitRehearsal'});
});
