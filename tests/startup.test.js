import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaDeck} from '../web/media-deck.js';
class Video {
 constructor(){this.currentTime=0;this.duration=120;this.readyState=3;this.networkState=1;this.seeking=false;this.paused=true;this.videoWidth=640;this.videoHeight=360;this.error=null;this.events={};this.playCalls=0;this.pauseCalls=0;this.frames=true;this.classList={toggle(){}};this.buffered={length:1,start:()=>0,end:()=>120};}
 setAttribute(){} removeAttribute(){} load(){} remove(){} pause(){this.paused=true;this.pauseCalls++;} addEventListener(name,callback){this.events[name]=callback;}
 play(){this.paused=false;this.playCalls++;return Promise.resolve();}
 requestVideoFrameCallback(callback){if(this.frames)queueMicrotask(()=>callback(0,{mediaTime:this.currentTime}));return 1;} cancelVideoFrameCallback(){}
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup(t,options={}){
 const previous=globalThis.document;globalThis.document={createElement:()=>new Video()};
 const deck=new MediaDeck({append(){}},{attachSource:()=>null,timeouts:{attach:40,metadata:40,buffer:80,play:40,frame:80,total:200,poll:2,frameFallback:5},...options});
 t.after(()=>{deck.destroy();globalThis.document=previous;});return deck;
}
test('a play promise that never settles cannot trap startup',async t=>{
 const deck=setup(t),slot=deck.ensure('game','fixture.mp4');slot.video.play=()=>new Promise(()=>{});
 const result=await Promise.race([deck.request('game','fixture.mp4',10),delay(250).then(()=>'HUNG')]);
 assert.equal(result,false);assert.equal(deck.gate.pending,null);assert.equal(deck.active,null);assert.equal(deck.snapshot().failures.at(-1).code,'TIMEOUT_PLAY');
});
test('an unresolved source attachment has a bounded startup deadline',async t=>{
 const deck=setup(t,{attachSource:()=>new Promise(()=>{})});
 assert.equal(await deck.request('game','fixture.mp4',10),false);assert.equal(deck.snapshot().failures.at(-1).code,'TIMEOUT_SOURCE');
});
test('the buffer fills while paused without repeatedly seeking or consuming it',async t=>{
 const deck=setup(t),slot=deck.ensure('game','fixture.mp4');slot.video.buffered={length:0};
 const cut=deck.request('game','fixture.mp4',30);await delay(20);
 assert.equal(slot.video.currentTime,30);assert.equal(slot.video.paused,true);assert.equal(slot.video.playCalls,0);
 slot.video.buffered={length:1,start:()=>30,end:()=>70};assert.equal(await cut,true);assert.equal(slot.video.playCalls,1);
});
test('decoded playback can pass when a hidden video gets no compositor callback',async t=>{
 const deck=setup(t),slot=deck.ensure('game','fixture.mp4');slot.video.frames=false;
 let timer;slot.video.play=()=>{slot.video.paused=false;timer=setInterval(()=>{if(!slot.video.paused)slot.video.currentTime+=.05;},5);return Promise.resolve();};t.after(()=>clearInterval(timer));
 assert.equal(await deck.request('game','fixture.mp4',10),true);assert.equal(deck.snapshot().cuts[0].frameEvidence,'playback-progress');
});
test('metadata and buffer without a decoded or advancing picture cannot pass',async t=>{
 const deck=setup(t),slot=deck.ensure('game','fixture.mp4');slot.video.frames=false;
 assert.equal(await deck.request('game','fixture.mp4',10),false);assert.equal(deck.active,null);assert.equal(deck.snapshot().failures.at(-1).code,'TIMEOUT_FRAME');
});
test('a new request cancels a pending play promise and its late result cannot cut',async t=>{
 const deck=setup(t),old=deck.ensure('old','old.mp4');let complete;old.video.play=()=>new Promise(resolve=>{complete=resolve;});
 const stale=deck.request('old','old.mp4',10);await delay(5);assert.equal(await deck.request('new','new.mp4',20),true);assert.equal(await stale,false);complete();await delay(5);assert.equal(deck.active,'new');
});
test('already warm footage is not paused and started again on every forecast',async t=>{
 const deck=setup(t);deck.setRunning(true);await deck.warm('game','fixture.mp4',10);const slot=deck.slots.get('game'),pauses=slot.video.pauseCalls,plays=slot.video.playCalls;
 await deck.warm('game','fixture.mp4',10);assert.equal(slot.video.pauseCalls,pauses);assert.equal(slot.video.playCalls,plays);assert.equal(slot.video.paused,false);
});

test('startup accepts two seconds while a subsequent cut still requires eight',async t=>{
 const deck=setup(t),first=deck.ensure('first','first.mp4');first.video.buffered={length:1,start:()=>0,end:()=>3};
 assert.equal(await deck.request('first','first.mp4',0),true);
 const next=deck.ensure('next','next.mp4');next.video.buffered={length:1,start:()=>0,end:()=>3};
 assert.equal(await deck.request('next','next.mp4',0),false);assert.equal(deck.active,'first');assert.equal(deck.snapshot().failures.at(-1).code,'TIMEOUT_BUFFER');
});

test('a moving shared clock does not repeatedly seek while its range is loading',async t=>{
 const deck=setup(t),slot=deck.ensure('game','fixture.mp4');let target=10;slot.video.buffered={length:0};
 const cut=deck.request('game','fixture.mp4',()=>target);await delay(10);target=40;await delay(10);assert.equal(slot.video.currentTime,10);
 slot.video.buffered={length:1,start:()=>0,end:()=>120};assert.equal(await cut,true);assert.equal(slot.video.currentTime,40);
});
