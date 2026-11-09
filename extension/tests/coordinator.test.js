import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,game,rawBoard,deferred} from './helpers.js';
import {ALARM,Coordinator} from '../coordinator.js';
import {DEFAULTS} from '../engine.js';

test('start creates one dedicated-worker host, selects a stream and restores original audio/discard settings on Stop',async()=>{
 const h=harness();await h.setup();let s=await h.director.dispatch({action:'start'});assert.equal(s.runtime.currentGame,'2');assert.equal(h.offscreen(),true);assert.deepEqual(h.calls.find(c=>c[0]==='offscreen')[1].reasons,['WORKERS']);
 assert.equal(h.tabs.get(101).mutedInfo.muted,true);assert.equal(h.tabs.get(102).mutedInfo.muted,false);assert.equal(h.tabs.get(101).autoDiscardable,false);
 await h.director.dispatch({action:'stop'});assert.equal(h.offscreen(),false);assert.equal(h.tabs.get(101).mutedInfo.muted,true);assert.equal(h.tabs.get(102).mutedInfo.muted,false);assert.equal(h.tabs.get(101).autoDiscardable,true);assert.equal(h.alarms.has(ALARM),false);
});
test('urgent possession cuts happen on receipt, with no second network poll or 45-second hold',async()=>{
 const h=harness();await h.setup('fantasy');await h.director.dispatch({action:'start'});h.advance(3000);
 await h.feed([game('1','9',70),game('2','21',4)]);assert.equal(h.director.s.runtime.currentGame,'2');
 h.advance(3000);await h.feed([game('1','3',80),game('2','21',2)]);assert.equal(h.director.s.runtime.currentGame,'1');assert.equal(h.director.s.runtime.decisionCode,'urgent');
});
test('ordinary priority changes settle on one-second pulses rather than waiting for another feed request',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});h.advance(9000);
 await h.feed([game('1','9',25),game('2','21',45)]);assert.equal(h.director.s.runtime.currentGame,'2');assert.equal(h.director.s.runtime.nextGame,'1');
 h.advance(2000);await h.pulse();assert.equal(h.director.s.runtime.currentGame,'1');
});
test('Watch expires on pulses and Lock remains explicit',async()=>{
 const h=harness();await h.setup('fantasy');await h.director.dispatch({action:'start'});await h.director.dispatch({action:'watch',gameId:'2'});
 assert.equal(h.director.s.runtime.lockGame,'');h.advance(8001);await h.pulse();assert.equal(h.director.s.runtime.currentGame,'1');
 await h.director.dispatch({action:'lock',gameId:'2'});h.advance(8001);await h.pulse();assert.equal(h.director.s.runtime.currentGame,'2');await h.director.dispatch({action:'auto'});assert.equal(h.director.s.runtime.currentGame,'1');
});
test('Stop and live cuts remain responsive while a highlight request is unresolved',async()=>{
 const blocked=deferred();let clock=2000000000000;
 const h=harness({request:async url=>url.includes('/summary?')?blocked.promise:{raw:rawBoard(),meta:{receivedAt:clock,networkMs:1}}});
 await h.setup();await h.director.dispatch({action:'start'});const refresh=h.director.dispatch({action:'refreshHighlights'});
 await new Promise(resolve=>setImmediate(resolve));h.advance(3000);clock=h.now();await h.feed([game('1','9',3),game('2','21',30)]);assert.equal(h.director.s.runtime.currentGame,'1');
 await h.director.dispatch({action:'stop'});assert.equal(h.director.s.runtime.running,false);assert.equal(h.offscreen(),false);
 blocked.resolve({raw:{videos:[]},meta:{receivedAt:clock,networkMs:4000}});await refresh;assert.equal(h.director.s.runtime.running,false);
});
test('Stop does not wait for a roster login request; its late response cannot re-enable Auto',async()=>{
 const blocked=deferred();const h=harness({request:async url=>url.includes('fantasy.espn')?blocked.promise:{raw:rawBoard(),meta:{receivedAt:2000000000000,networkMs:0}}});
 const connect=h.director.dispatch({action:'connect',config:{leagueId:'123',season:2026}});await new Promise(resolve=>setImmediate(resolve));
 await h.director.dispatch({action:'stop'});assert.equal(h.director.s.runtime.running,false);
 blocked.resolve({raw:{teams:[{id:1,name:'Fixture',roster:{entries:[]}}]},meta:{}});await connect;assert.equal(h.director.s.runtime.running,false);
});
test('late worker packets are ignored after Stop and after a worker restart',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});const old=h.director.s.runtime.engineToken;
 await h.director.dispatch({action:'stop'});const count=h.director.s.runtime.switchCount;
 await h.director.packet({type:'feed',token:old,games:[game('1','9',1)],meta:{receivedAt:h.now()}});assert.equal(h.director.s.runtime.switchCount,count);
 await h.director.dispatch({action:'start'});const newToken=h.director.s.runtime.engineToken;assert.notEqual(old,newToken);await h.director.packet({type:'feedError',token:old,error:'old failure'});assert.equal(h.director.s.runtime.feedError,'');
});
test('watchdog recreates a missing or stalled engine and never becomes the normal polling driver',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});const old=h.director.s.runtime.engineToken;
 h.advance(11000);await h.director.watchdog();assert.notEqual(h.director.s.runtime.engineToken,old);assert.equal(h.offscreen(),true);
 const token=h.director.s.runtime.engineToken;await h.pulse();await h.director.watchdog();assert.equal(h.director.s.runtime.engineToken,token);
});
test('worker restart recovers persisted session, current selection and active token',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});const token=h.director.s.runtime.engineToken;
 const recovered=new Coordinator(h.api,{now:h.now});const s=await recovered.dispatch({action:'state'});assert.equal(s.runtime.currentGame,'2');assert.equal(recovered.s.runtime.engineToken,token);assert.equal(s.runtime.running,true);
});
test('zero stream startup fails; discarded tabs cannot be chosen automatically',async()=>{
 const h=harness();await h.director.dispatch({action:'settings',config:{focusMode:'nfl'}});await assert.rejects(h.director.dispatch({action:'start'}),/Assign game tabs/);
 await h.setup();h.tabs.get(102).discarded=true;let s=await h.director.dispatch({action:'start'});assert.equal(s.runtime.currentGame,'1');
 s=await h.director.dispatch({action:'watch',gameId:'2'});assert.equal(s.runtime.currentGame,'2');assert.equal(h.tabs.get(102).discarded,false);
});
test('query navigation removes a mapping; a fragment change preserves it',async()=>{
 const h=harness();await h.setup();h.tabs.get(101).url+='#playing';await h.director.tabChanged(101);assert.ok(h.director.s.runtime.bindings['1']);
 h.tabs.get(101).url='https://provider.test/one?game=another';await h.director.tabChanged(101);assert.equal(h.director.s.runtime.bindings['1'],undefined);
});
test('tab activation failures are visible and cannot be reported as successful cuts',async()=>{
 const h=harness();await h.setup();h.setActivation(false);await assert.rejects(h.director.dispatch({action:'testSwitch'}),/did not activate/);assert.equal(h.director.s.runtime.switchCount,0);assert.equal(h.director.s.runtime.lastSwitchResult.ok,false);
});
test('highlight handoff pauses cuts, closes only its owned tab and resumes the prior lock',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});await h.director.dispatch({action:'lock',gameId:'1'});await h.director.dispatch({action:'refreshHighlights'});
 let s=await h.director.dispatch({action:'openHighlight',highlightId:'clip:12345'}),id=s.runtime.replay.tabId;
 assert.equal(h.tabs.get(101).mutedInfo.muted,true);assert.equal(h.tabs.get(102).mutedInfo.muted,true);await h.pulse();assert.equal(h.director.s.runtime.currentGame,'1');
 s=await h.director.dispatch({action:'returnLive'});assert.equal(s.runtime.lockGame,'1');assert.equal(s.runtime.currentGame,'1');assert.equal(h.tabs.has(id),false);
});
test('highlight links honor per-stream timing offsets',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'refreshHighlights'});await h.director.dispatch({action:'streamTiming',gameId:'1',seconds:30});
 assert.ok(!h.director.clips().some(x=>x.gameId==='1'));await assert.rejects(h.director.dispatch({action:'streamTiming',gameId:'1',seconds:-5}),/0–120/);
});
test('cookie import never enters settings, runtime or downloadable timing reports',async()=>{
 const h=harness();const auth={swid:'{11111111-1111-1111-1111-111111111111}',s2:'synthetic-test-cookie'};
 await h.director.dispatch({action:'connect',config:{leagueId:'123',season:2026},auth});assert.equal(h.cookies.length,2);
 const all=JSON.stringify({local:h.local,session:h.session,report:await h.director.dispatch({action:'report'})});assert.ok(!all.includes(auth.s2));assert.ok(!all.includes(auth.swid));
});
test('timing report excludes provider URLs and fantasy roster identity',async()=>{
 const h=harness();await h.setup('fantasy');await h.director.dispatch({action:'start'});const report=JSON.stringify(await h.director.dispatch({action:'report'}));
 assert.ok(!report.includes('provider.test'));assert.ok(!report.includes('Synthetic Team'));assert.ok(!report.includes('Sample Quarterback'));assert.ok(report.includes('receivedToActivationMs'));
});
test('upgrade migrates the old slow defaults instead of carrying a 45-second hold into 3.0',async()=>{
 const h=harness({storedConfig:{leagueId:'222',teamId:'8',holdSeconds:45,delaySeconds:60}});const s=await h.director.dispatch({action:'state'});
 assert.equal(s.config.holdSeconds,8);assert.equal(s.config.delaySeconds,0);assert.equal(s.config.pollSeconds,5);assert.equal(s.config.teamId,'8');
});
test('stale or failed feed blocks cuts despite a live worker heartbeat',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});h.advance(21000);await h.pulse();assert.equal(h.director.s.runtime.decisionCode,'stale');
 await h.feed([game('1','9',3),game('2','21',30)]);assert.equal(h.director.s.runtime.currentGame,'1');
 await h.director.packet({type:'feedError',token:h.director.s.runtime.engineToken,error:'offline'});assert.equal(h.director.s.runtime.decisionCode,'stale');
});
test('restarting Auto retakes the selected stream and reestablishes its audio state',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});
 h.advance(3000);await h.feed([game('1','9',3),game('2','21',30)]);assert.equal(h.director.s.runtime.currentGame,'1');
 await h.director.dispatch({action:'stop'});assert.equal(h.tabs.get(101).mutedInfo.muted,true);assert.equal(h.tabs.get(102).mutedInfo.muted,false);
 const count=h.director.s.runtime.switchCount;await h.director.dispatch({action:'start'});
 assert.equal(h.director.s.runtime.switchCount,count+1);assert.equal(h.tabs.get(101).mutedInfo.muted,false);assert.equal(h.tabs.get(102).mutedInfo.muted,true);
});
test('audio preference updates take effect during Auto without re-enabling tab discarding',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});
 await h.director.dispatch({action:'settings',config:{muteOthers:false}});assert.equal(h.tabs.get(101).autoDiscardable,false);
 h.tabs.get(101).mutedInfo.muted=false;
 await h.director.dispatch({action:'settings',config:{muteOthers:true}});assert.equal(h.tabs.get(101).mutedInfo.muted,true);assert.equal(h.tabs.get(102).mutedInfo.muted,false);
});
test('stream preparation does not change a tab that navigated after validation',async()=>{
 const h=harness();await h.setup();h.tabs.get(101).url='https://provider.test/unrelated';
 await h.director.router.prepare(h.director.s.runtime,()=>h.director.persist());
 assert.equal(h.tabs.get(101).autoDiscardable,true);assert.equal(h.director.s.runtime.originalMutes[101],undefined);
});
test('unchanged polls preserve the observed opportunity time and old packets cannot rewind the desk',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});const first=h.director.s.runtime.games[0].observedAt;
 h.advance(5000);await h.feed([game(),game('2','21',30)]);assert.equal(h.director.s.runtime.games[0].observedAt,first);
 h.advance(5000);await h.feed([game('1','9',4),game('2','21',30)]);assert.equal(h.director.s.runtime.games[0].observedAt,h.now());
 await h.director.packet({type:'feed',token:h.director.s.runtime.engineToken,games:[],meta:{receivedAt:first}});
 assert.equal(h.director.s.runtime.games.length,2);assert.equal(h.director.s.runtime.fetchedAt,h.now());
});
test('quiet slates retain a healthy desk heartbeat without claiming a live feed is stale',async()=>{
 const h=harness();await h.setup();await h.director.dispatch({action:'start'});
 await h.feed([game('1','3',50,{state:'post'}),game('2','21',30,{state:'post'})]);
 const count=h.messages.filter(m=>m.target==='desk').length;
 for(let i=0;i<30;i++){h.advance(1000);await h.pulse();}
 assert.equal(h.director.s.runtime.decisionCode,'no-live');assert.ok(h.messages.filter(m=>m.target==='desk').length>=count+6);
});
