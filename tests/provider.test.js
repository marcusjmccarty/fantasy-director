import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderPlayer,providerURL} from '../web/provider-player.js';
import {MediaDeck} from '../web/media-deck.js';
function setup(t){
 const callbacks=new Set(),frames=[];
 const events={addEventListener:(_,fn)=>callbacks.add(fn),removeEventListener:(_,fn)=>callbacks.delete(fn)};
 const createFrame=()=>{const classes=new Set(),messages=[];const frame={messages,contentWindow:{postMessage:(data,origin)=>messages.push({data,origin})},classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key),contains:key=>classes.has(key)},setAttribute(){},removeAttribute(){},remove(){}};frames.push(frame);return frame;};
 const send=(frame,data,origin='https://ok.ru')=>{for(const fn of callbacks)fn({source:frame.contentWindow,origin,data});};
 return {events,createFrame,send,frames,callbacks};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('the provider URL stays on its original embed and contains no extracted media tokens',()=>{
 assert.equal(providerURL('https://ok.ru/videoembed/123?old=1'),'https://ok.ru/videoembed/123?muted=1&silent=1');assert.throws(()=>providerURL('https://evil.example/videoembed/123'));
});
test('provider load and seek acknowledgements are not mistaken for playing footage',async t=>{
 const h=setup(t),p=new ProviderPlayer(h);t.after(()=>p.remove());p.src='https://ok.ru/videoembed/123';p.load();
 h.send(p.element,{event:'inited'});p.currentTime=15;const playing=p.play();
 assert.equal(p.readyAt(15),false);assert.ok(p.element.messages.some(m=>m.data.action==='seek'&&m.data.time===15));
 h.send(p.element,{event:'rewound',time:15});assert.equal(p.readyAt(15),false);
 h.send(p.element,{event:'timeupdate',time:15,duration:120});await playing;assert.equal(p.readyAt(15),false);
 h.send(p.element,{event:'timeupdate',time:15.2,duration:120});assert.equal(p.readyAt(15.2),true);assert.equal(p.duration,120);assert.equal(p.buffered.length,0);
});
test('messages from unrelated origins or frames cannot unlock a cut',async t=>{
 const h=setup(t),p=new ProviderPlayer(h);t.after(()=>p.remove());
 h.send(p.element,{event:'inited'},'https://evil.example');assert.equal(p.initialized,false);
 const other=h.createFrame();h.send(other,{event:'inited'});assert.equal(p.initialized,false);
 h.send(p.element,{event:'inited'});p.currentTime=30;const playing=p.play();h.send(p.element,{event:'timeupdate',time:0});h.send(p.element,{event:'timeupdate',time:1});assert.equal(p.readyAt(30),false);
 h.send(p.element,{event:'timeupdate',time:30,duration:120});await playing;h.send(p.element,{event:'timeupdate',time:30.3,duration:120});assert.equal(p.readyAt(30),true);
});
test('muting and unmuting restore provider volume, and teardown releases its listener',()=>{
 const h=setup(),p=new ProviderPlayer(h);p.muted=true;p.muted=false;assert.ok(p.element.messages.some(m=>m.data.action==='volume'&&m.data.value===1));p.remove();assert.equal(h.callbacks.size,0);
});
test('repeated stale timestamps do not keep a stalled provider ready',async t=>{
 let now=0;const h=setup(t),p=new ProviderPlayer({...h,now:()=>now});t.after(()=>p.remove());h.send(p.element,{event:'inited'});const playing=p.play();
 h.send(p.element,{event:'timeupdate',time:10});h.send(p.element,{event:'timeupdate',time:10.2});await playing;assert.equal(p.readyAt(10.2),true);
 now=4000;h.send(p.element,{event:'timeupdate',time:10.2});assert.equal(p.readyAt(10.2),false);
});
test('a provider cut waits for advancing footage and reuses the prepared iframe',async t=>{
 const h=setup(t),priorDocument=globalThis.document,priorWindow=globalThis.window;
 globalThis.window=h.events;globalThis.document={createElement:h.createFrame};const deck=new MediaDeck({append(){}},{timeouts:{poll:2}});deck.setRunning(true);
 t.after(()=>{deck.destroy();globalThis.document=priorDocument;globalThis.window=priorWindow;});
 const first=deck.request('a','https://ok.ru/videoembed/123',10,{type:'provider/ok'});h.send(h.frames[0],{event:'inited'});await flush();h.send(h.frames[0],{event:'timeupdate',time:10,duration:120});h.send(h.frames[0],{event:'timeupdate',time:10.2,duration:120});assert.equal(await first,true);
 const warm=deck.warm('b','https://ok.ru/videoembed/456',30,{type:'provider/ok'});const frame=h.frames[1];h.send(frame,{event:'inited'});await flush();h.send(frame,{event:'timeupdate',time:30,duration:120});await flush();assert.equal(deck.active,'a');
 h.send(frame,{event:'timeupdate',time:30.2,duration:120});assert.equal(await warm,true);assert.equal(await deck.request('b','https://ok.ru/videoembed/456',30,{type:'provider/ok'}),true);assert.equal(deck.activeSlot.video.element,frame);assert.equal(deck.snapshot().cuts.at(-1).bufferSeconds,null);assert.equal(deck.snapshot().cuts.at(-1).frameEvidence,'provider-playback-progress');
});

test('a user gesture can recover the original provider player after an autoplay timeout',async t=>{
 const h=setup(t),priorDocument=globalThis.document,priorWindow=globalThis.window;let recovery;
 globalThis.window=h.events;globalThis.document={createElement:h.createFrame};
 const deck=new MediaDeck({append(){}},{timeouts:{poll:2,providerPlay:20},onRecover:()=>{deck.retry();recovery=deck.request('a','https://ok.ru/videoembed/123',20,{type:'provider/ok'});}});deck.setRunning(true);
 t.after(()=>{deck.destroy();globalThis.document=priorDocument;globalThis.window=priorWindow;});
 const attempt=deck.request('a','https://ok.ru/videoembed/123',20,{type:'provider/ok'}),frame=h.frames[0];h.send(frame,{event:'inited'});assert.equal(await attempt,false);assert.equal(deck.active,null);assert.equal(deck.slots.get('a').failure.code,'TIMEOUT_PLAY');assert.equal(frame.classList.contains('interactive'),true);
 h.send(frame,{event:'started'});h.send(frame,{event:'timeupdate',time:20,duration:120});h.send(frame,{event:'timeupdate',time:20.2,duration:120});assert.equal(await recovery,true);assert.equal(deck.activeSlot.video.element,frame);assert.equal(h.frames.length,1);
});
