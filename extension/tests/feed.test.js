import test from 'node:test';
import assert from 'node:assert/strict';
import {FeedLoop,requestJSON,retryDelay,pollInterval,scoreboardHighlights} from '../feed.js';
import {normalizeScoreboard} from '../engine.js';
import {rawBoard,game,deferred} from './helpers.js';
function clock(){let t=2000000000000,id=0;const timers=new Map();return {now:()=>t,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:t+ms});return id;},clearTimer:i=>timers.delete(i),timers,async advance(ms){const end=t+ms;while(true){const due=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!due || due[1].at>end)break;t=due[1].at;timers.delete(due[0]);await due[1].fn();}t=end;}};}
test('live loop polls start-to-start every five seconds and emits normalized snapshots',async()=>{
 const c=clock(),packets=[];let requests=0;
 const loop=new FeedLoop({...c,emit:p=>packets.push(p),request:async()=>{requests++;return {raw:rawBoard(),meta:{receivedAt:c.now(),networkMs:0}};}});
 await loop.start({token:'session',pollSeconds:5});await c.advance(20000);assert.equal(requests,5);assert.equal(packets.length,5);assert.equal(packets[0].games[0].possession,'3');assert.equal(packets[0].token,'session');loop.stop();
});
test('a pending fetch cannot overlap another fetch; Stop aborts it and ignores late completion',async()=>{
 const c=clock(),pending=deferred(),packets=[];let requests=0,signal;
 const loop=new FeedLoop({...c,emit:p=>packets.push(p),request:async(u,o)=>{requests++;signal=o.signal;return pending.promise;}});
 const running=loop.start({token:'old'});await loop.poke();assert.equal(requests,1);loop.stop();assert.equal(signal.aborted,true);
 pending.resolve({raw:rawBoard(),meta:{receivedAt:c.now(),networkMs:1}});await running;assert.equal(packets.length,0);assert.equal(c.timers.size,0);
});
test('429 honors Retry-After and manual refresh cannot bypass the backoff',async()=>{
 const c=clock(),packets=[];let count=0;
 const loop=new FeedLoop({...c,emit:p=>packets.push(p),request:async()=>{count++;if(count===1)throw Object.assign(new Error('rate limited'),{status:429,retryAfterMs:90000});return {raw:rawBoard(),meta:{receivedAt:c.now(),networkMs:0}};}});
 await loop.start({token:'a'});await loop.poke();await c.advance(89999);assert.equal(count,1);assert.equal(packets[0].type,'feedError');await c.advance(1);assert.equal(count,2);assert.equal(packets[1].failures,0);loop.stop();
});
test('network and invalid-payload errors back off without emitting a false healthy snapshot',async()=>{
 const c=clock(),packets=[];let count=0;
 const loop=new FeedLoop({...c,emit:p=>packets.push(p),request:async()=>{count++;return {raw:{bad:'shape'},meta:{receivedAt:c.now()}};}});
 await loop.start({token:'a'});await c.advance(9999);assert.equal(count,1);await c.advance(1);assert.equal(count,2);assert.ok(packets.every(p=>p.type==='feedError'));loop.stop();
});
test('restart cancels the previous generation and its results cannot overwrite the new session',async()=>{
 const c=clock(),old=deferred(),packets=[];let n=0;
 const loop=new FeedLoop({...c,emit:p=>packets.push(p),request:async()=>++n===1?old.promise:{raw:rawBoard(),meta:{receivedAt:c.now()}}});
 const first=loop.start({token:'old'});await loop.start({token:'new'});old.resolve({raw:rawBoard([game('99')]),meta:{receivedAt:c.now()}});await first;assert.deepEqual(packets.map(p=>p.token),['new']);loop.stop();
});
test('scheduled and finished slates use slower polling',()=>{
 assert.equal(pollInterval([game()],5),5000);assert.equal(pollInterval([game('1','3',50,{state:'post'})],5),60000);
 assert.equal(pollInterval([game('1','3',50,{state:'pre',date:new Date(Date.now()+60000).toISOString()})],5),15000);
});
test('HTTP instrumentation records RTT and available cache metadata without inventing publication latency',async()=>{
 let t=1000;const {meta}=await requestJSON('https://site.api.espn.com/test',{now:()=>t,fetchImpl:async()=>{t=1025;return {ok:true,headers:new Headers({age:'20','cache-control':'max-age=30',date:'Sun, 25 Oct 2026 20:00:00 GMT'}),async json(){t=1040;return {};}};}});
 assert.equal(meta.networkMs,40);assert.equal(meta.cacheAgeSeconds,20);assert.equal(meta.publicationLatencyMs,undefined);
 const missing=await requestJSON('https://site.api.espn.com/test',{fetchImpl:async()=>({ok:true,headers:new Headers(),async json(){return {};}})});assert.equal(missing.meta.cacheAgeSeconds,null);
});
test('HTTP failures propagate status and Retry-After; requests never manually set Cookie headers',async()=>{
 await assert.rejects(requestJSON('https://site.api.espn.com/test',{fetchImpl:async(u,o)=>{assert.equal(o.headers.Cookie,undefined);assert.equal(o.credentials,'omit');return {ok:false,status:429,headers:new Headers({'retry-after':'30'})};}}),e=>e.status===429 && e.retryAfterMs===30000);
 assert.equal(retryDelay('120',0),120000);assert.equal(retryDelay('Thu, 01 Jan 1970 00:02:00 GMT',0),120000);
});
test('scoreboard clip array observed on ESPN is collected without waiting for game summaries',()=>{
 const raw=rawBoard();raw.events[0].competitions[0].highlights=[{id:50277973,headline:'Pittsburgh Steelers vs. New Orleans Saints: Full Game Highlight',originalPublishDate:'2026-10-25T17:01:09Z',duration:73,links:{web:{href:'https://www.espn.com/video/clip/_/id/50277973/full-game-highlight'}}}];
 const clips=scoreboardHighlights(raw,normalizeScoreboard(raw),Date.now());assert.equal(clips.length,1);assert.equal(clips[0].id,'clip:50277973');assert.match(clips[0].url,/50277973/);
});
test('fast polling continues through the maximum video buffer after the final live game ends',async()=>{
 const c=clock(),packets=[];let live=true;
 const loop=new FeedLoop({...c,emit:p=>packets.push(p),request:async()=>({raw:rawBoard([game('1','3',50,{state:live?'in':'post'})]),meta:{receivedAt:c.now()}})});
 await loop.start({token:'a'});live=false;await c.advance(5000);assert.equal(packets.at(-1).nextPollAt-c.now(),5000);
 await c.advance(115000);assert.equal(packets.at(-1).nextPollAt-c.now(),60000);loop.stop();
});
test('long Retry-After values do not overflow browser timers or trigger an early request',async()=>{
 const c=clock();let calls=0;
 const loop=new FeedLoop({...c,request:async()=>{calls++;throw Object.assign(new Error('rate limited'),{status:429,retryAfterMs:3000000000});}});
 await loop.start({token:'a'});assert.equal([...c.timers.values()][0].at-c.now(),2147483647);
 await c.advance(2147483647);assert.equal(calls,1);await c.advance(852516352);assert.equal(calls,1);await c.advance(1);assert.equal(calls,2);loop.stop();
});
test('request timeout aborts transport and reports a useful error',async()=>{
 await assert.rejects(requestJSON('https://site.api.espn.com/test',{timeout:5,fetchImpl:async(u,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))}),/timed out/);
 await assert.rejects(requestJSON('https://site.api.espn.com/test',{fetchImpl:async()=>({ok:true,async json(){throw new SyntaxError('private raw payload');}})}),/unreadable JSON/);
});
