import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function player({blocked=false,failed=false}={}){
 const elements=new Map(),messages=[],timers=new Map();let timerId=0,listener,plays=0;
 const node=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',events:{},addEventListener(type,fn){this.events[type]=fn;},removeAttribute(name){delete this[name];},pause(){this.paused=true;},load(){},async play(){plays++;if(failed)throw new Error('Decode failed');if(blocked&&!this.muted)throw Object.assign(new Error('Gesture needed'),{name:'NotAllowedError'});this.paused=false;}});return elements.get(id);};
 const item={nonce:'one',title:'Fixture replay',url:'https://espnmedia-cdn.akamaized.net/test.mp4',source:'https://www.espn.com/video/clip/_/id/1',maxSeconds:100};
 const chrome={runtime:{id:'test',onMessage:{addListener:fn=>listener=fn},async sendMessage(m){messages.push(m);return {ok:true,data:m.action==='playerState'?item:m.event==='ready'?{play:true}:{ok:true}};}}};
 vm.runInNewContext(fs.readFileSync(new URL('../replay.js',import.meta.url),'utf8'),{document:{getElementById:node},chrome,setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
 await settle();return {node,messages,timers,plays:()=>plays,async loaded(){await node('video').events.loadeddata();await settle();},async message(m){listener({target:'replay-player',...m},{id:'test'},()=>{});await settle();}};
}
test('native player autoplays, reports completion, and unloads the media source',async()=>{
 const p=await player();await p.loaded();assert.equal(p.plays(),1);assert.ok(p.messages.some(m=>m.event==='playing'));
 await p.node('video').events.ended();await settle();assert.ok(p.messages.some(m=>m.event==='ended'));assert.equal(p.node('video').src,undefined);assert.equal(p.node('video').preload,'none');assert.equal(p.timers.size,0);
});
test('autoplay denial falls back to muted playback without requiring a clip click',async()=>{
 const p=await player({blocked:true});await p.loaded();assert.equal(p.plays(),2);assert.equal(p.node('video').muted,true);assert.equal(p.node('sound').hidden,false);assert.ok(p.messages.some(m=>m.event==='muted'));
});
test('decode failures return control and do not leave a muted live session waiting forever',async()=>{
 const p=await player({failed:true});await p.loaded();assert.ok(p.messages.some(m=>m.event==='error'));assert.equal(p.node('video').src,undefined);
});
test('live preemption immediately pauses and unloads playback',async()=>{
 const p=await player();await p.loaded();await p.message({type:'clear'});assert.equal(p.node('video').paused,true);assert.equal(p.node('video').src,undefined);assert.equal(p.timers.size,0);
});
