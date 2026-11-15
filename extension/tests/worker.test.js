import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Worker} from 'node:worker_threads';
import {rawBoard} from './helpers.js';

test('offscreen host acknowledges commands without blocking on network and forwards worker failures',async()=>{
 const messages=[],commands=[];let listener,worker;
 const chrome={runtime:{id:'test',sendMessage:async m=>messages.push(m),onMessage:{addListener:fn=>listener=fn}}};
 class HostWorker{constructor(url,options){assert.equal(url,'feed-worker.js');assert.equal(options.type,'module');worker=this;}postMessage(m){commands.push(m);}}
 vm.runInNewContext(fs.readFileSync(new URL('../offscreen.js',import.meta.url),'utf8'),{chrome,Worker:HostWorker});
 let reply;
 listener({target:'live-engine',type:'start',token:'session'},{id:'foreign'},r=>reply=r);assert.equal(commands.length,0);
 listener({target:'live-engine',type:'start',token:'session'},{id:'test'},r=>reply=r);assert.equal(reply.ok,true);assert.equal(commands.length,1);
 await worker.onmessage({data:{type:'feed',token:'session'}});assert.equal(messages[0].action,'engine');
 await worker.onerror();assert.equal(messages[1].packet.type,'engineError');assert.equal(messages[1].packet.token,'session');
});

test('dedicated worker emits feed and one-second pulses without a dashboard, then stops cleanly',{timeout:8000},async()=>{
 // Exercise the actual worker module in a real thread. Only its browser globals
 // and HTTP response are supplied by the harness; Chrome lifecycle is separate.
 const source=`
  import {parentPort} from 'node:worker_threads';
  globalThis.self=globalThis;
  globalThis.postMessage=packet=>parentPort.postMessage(packet);
  globalThis.fetch=async()=>new Response(JSON.stringify(${JSON.stringify(rawBoard())}),{headers:{'content-type':'application/json'}});
  await import(${JSON.stringify(new URL('../feed-worker.js',import.meta.url).href)});
  parentPort.on('message',data=>{self.onmessage({data});if(data.type==='stop')parentPort.postMessage({type:'test-stopped'});});
 `;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source))),messages=[];
 worker.on('message',m=>messages.push(m));
 const waitFor=type=>new Promise((resolve,reject)=>{
   const existing=messages.find(m=>m.type===type);if(existing){resolve(existing);return;}
   const timer=setTimeout(()=>{cleanup();reject(new Error('Missing worker packet: '+type));},5000);
   const listener=m=>{if(m.type===type){cleanup();resolve(m);}},error=e=>{cleanup();reject(e);};
   function cleanup(){clearTimeout(timer);worker.off('message',listener);worker.off('error',error);}
   worker.on('message',listener);worker.on('error',error);
 });
 try{
   worker.postMessage({type:'start',token:'thread-session',pollSeconds:5});
   const feed=await waitFor('feed');assert.equal(feed.token,'thread-session');assert.equal(feed.games.length,2);
   const pulse=await waitFor('pulse');assert.equal(pulse.token,'thread-session');assert.ok(pulse.nextPollAt>pulse.at);
   worker.postMessage({type:'stop'});await waitFor('test-stopped');const count=messages.length;
   await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(messages.length,count);
 }finally{await worker.terminate();}
});
test('actual worker rehearsal branch emits fictional packets without a network request',{timeout:5000},async()=>{
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(`
  import {parentPort} from 'node:worker_threads';
  globalThis.self=globalThis;globalThis.postMessage=p=>parentPort.postMessage(p);
  globalThis.fetch=async()=>{throw new Error('Unexpected network request');};
  await import(${JSON.stringify(new URL('../feed-worker.js',import.meta.url).href)});
  parentPort.on('message',data=>self.onmessage({data}));
 `)));
 try{
   const result=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
   worker.postMessage({type:'start',token:'offline',lab:{startedAt:Date.now()}});
   const packet=await result;assert.equal(packet.type,'feed');assert.equal(packet.lab,true);assert.equal(packet.games.length,4);assert.equal(packet.meta.networkMs,0);
 }finally{await worker.terminate();}
});
