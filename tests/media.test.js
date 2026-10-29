import test from 'node:test';
import assert from 'node:assert/strict';
import {readyToCut,bufferedAhead,CutGate} from '../web/media-deck.js';
const video=(changes={})=>({currentTime:30,duration:120,seeking:false,readyState:3,buffered:{length:2,start:i=>[0,28][i],end:i=>[8,37][i]},...changes});
test('a loaded page/metadata or unbuffered seek cannot pass the cut gate',()=>{
 assert.equal(readyToCut(video({readyState:1}),30),false);
 assert.equal(readyToCut(video({seeking:true}),30),false);
 assert.equal(readyToCut(video(),18),false);
 assert.equal(readyToCut(video(),30),true);
 assert.equal(bufferedAhead(video(),30),7);
});
test('short clips can finish without requiring buffer past their duration',()=>{
 assert.equal(readyToCut(video({currentTime:118,duration:120,buffered:{length:1,start:()=>115,end:()=>120}}),118),true);
});
test('slow and failed candidates leave the previous source visible',()=>{
 const gate=new CutGate(),a=gate.request('game-A');assert.equal(gate.commit(a,true),true);
 const b=gate.request('game-B');assert.equal(gate.commit(b,false),false);assert.equal(gate.current,'game-A');
 gate.cancel();assert.equal(gate.commit(b,true),false);assert.equal(gate.current,'game-A');
});
test('a late loading callback cannot override a newer seek or source choice',()=>{
 const gate=new CutGate(),old=gate.request('game-A'),latest=gate.request('game-C');assert.equal(gate.commit(latest,true),true);assert.equal(gate.commit(old,true),false);assert.equal(gate.current,'game-C');
});

// Exercise the asynchronous player handoff with controllable media events, not only its predicate.
import {MediaDeck} from '../web/media-deck.js';
class FakeVideo {
 constructor(){this.currentTime=0;this.duration=120;this.readyState=3;this.seeking=false;this.paused=true;this.buffered={length:1,start:()=>0,end:()=>120};this.events={};this.classes=new Set();this.classList={toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};this.frames=[];this.autoFrame=true;}
 setAttribute(){} removeAttribute(){} load(){} remove(){} canPlayType(){return 'probably';}
 addEventListener(name,fn){this.events[name]=fn;}
 pause(){this.paused=true;} async play(){this.paused=false;}
 requestVideoFrameCallback(fn){if(this.autoFrame)queueMicrotask(fn);else this.frames.push(fn);}
 decoded(){for(const fn of this.frames.splice(0))fn();}
}
function harness(t){const prior=globalThis.document;globalThis.document={createElement:()=>new FakeVideo()};t.after(()=>{globalThis.document=prior;});return new MediaDeck({append(){}},{onCommit:()=>{}});}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('a buffered candidate stays hidden until its decoded-frame callback',async t=>{
 const deck=harness(t);await deck.request('a','a.mp4',0);
 const b=deck.ensure('b','b.mp4');b.video.autoFrame=false;const cut=deck.request('b','b.mp4',30);await flush();
 assert.equal(deck.active,'a');assert.equal(b.video.classes.has('active'),false);
 b.video.decoded();assert.equal(await cut,true);assert.equal(deck.active,'b');assert.equal(b.video.currentTime,30);assert.equal(deck.slots.get('a').video.paused,true);deck.destroy();
});
test('warm preparation cannot pause or replace a newer committed request',async t=>{
 const deck=harness(t),b=deck.ensure('b','b.mp4');b.video.autoFrame=false;
 deck.warm('b','b.mp4',10);await flush();deck.setRunning(true);const cut=deck.request('b','b.mp4',30);await flush();b.video.decoded();
 assert.equal(await cut,true);await flush();assert.equal(deck.active,'b');assert.equal(b.video.currentTime,30);assert.equal(b.video.paused,false);deck.destroy();
});
test('a cancelled delayed frame cannot cut over the latest requested source',async t=>{
 const deck=harness(t);await deck.request('a','a.mp4',0);const b=deck.ensure('b','b.mp4');b.video.autoFrame=false;
 const late=deck.request('b','b.mp4',30);await flush();await deck.request('c','c.mp4',20);b.video.decoded();assert.equal(await late,false);assert.equal(deck.active,'c');deck.destroy();
});
test('a failed source is held on cooldown instead of retried every director tick',async t=>{
 const deck=harness(t);await deck.request('a','a.mp4',0);const bad=deck.ensure('b','b.mp4');bad.video.play=async()=>{throw new Error('denied');};
 assert.equal(await deck.request('b','b.mp4',30),false);assert.equal(deck.active,'a');const operation=bad.operation;
 await deck.request('b','b.mp4',30);assert.equal(bad.operation,operation);deck.retry();await deck.request('b','b.mp4',30);assert.ok(bad.operation>operation);deck.destroy();
});
test('the warm pool stays bounded to the current player and two candidates',async t=>{
 const deck=harness(t);await deck.request('a','a.mp4',0);
 for(const key of ['b','c','d','e'])deck.ensure(key,key+'.mp4');assert.equal(deck.slots.size,3);assert.ok(deck.slots.has('a'));deck.destroy();
});
