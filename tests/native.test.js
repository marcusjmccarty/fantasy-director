// Real NativePlayer lifecycle with a deferred media attachment / play promise.
// The boundary is the browser video element, not the player's state machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(process.env.FANTASY_AUDIT_NATIVE||new URL('../web/native-player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class NativePlayer','class NativePlayer');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(attachment,play=()=>Promise.resolve()){
 const video={paused:true,calls:[],listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},play(){this.calls.push('play');return play();},pause(){this.paused=true;this.calls.push('pause');},load(){},remove(){},removeAttribute(){}};
 const timers=new Map();let sequence=0;
 const ctx={document:{createElement:()=>video},attachMediaSource:()=>attachment,setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),performance:{now:()=>0}};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.Player=NativePlayer;',ctx);
 return {player:new ctx.Player({url:'https://example.com/clip.mp4'}),video,timers};
}
test('a native player destroyed while attaching disposes the late controller without restarting video',async()=>{
 const pending=deferred(),h=harness(pending.promise);let disposed=0;h.player.play();h.player.destroy();pending.resolve({destroy(){disposed++;}});await h.player.ready;
 assert.equal(disposed,1);assert.equal(h.player.attached,false);assert.equal(h.video.calls.includes('play'),false);h.player.play();assert.equal(h.video.calls.includes('play'),false);
});
for(const action of ['pause','destroy'])test(`an autoplay rejection arriving after ${action} cannot restart a native video`,async()=>{
 const pending=deferred(),h=harness(Promise.resolve(null),()=>pending.promise);await h.player.ready;h.player.play();h.player[action]();pending.reject(Object.assign(new Error('gesture needed'),{name:'NotAllowedError'}));await Promise.resolve();await Promise.resolve();
 assert.equal(h.video.calls.filter(c=>c==='play').length,1);assert.equal(h.player.wantPlay,false);
});
test('pausing cancels native sound recovery, including an already queued callback',async()=>{
 const h=harness(Promise.resolve(null));await h.player.ready;h.player.play();h.player.muted=false;assert.equal(h.timers.size,1);const callback=[...h.timers.values()][0];h.player.pause();assert.equal(h.timers.size,0);callback();
 assert.equal(h.video.calls.filter(c=>c==='play').length,1);assert.equal(h.player.audioLocked,false);assert.equal(h.player.wantPlay,false);
});
test('an audible autoplay rejection exposes the gesture hint while retrying muted',async()=>{
 let calls=0;const h=harness(Promise.resolve(null),()=>++calls===1?Promise.reject(Object.assign(new Error('gesture needed'),{name:'NotAllowedError'})):Promise.resolve());await h.player.ready;let notices=0;h.player.on('audiolocked',()=>notices++);h.player.muted=false;h.player.play();await Promise.resolve();
 assert.equal(h.player.audioLocked,true);assert.equal(h.video.muted,true);assert.equal(notices,1);assert.equal(calls,2);
});
test('continuity: a seek landing is not evidence that native video is advancing',async()=>{
 const h=harness(Promise.resolve(null));await h.player.ready;Object.assign(h.video,{duration:120,currentTime:0,readyState:4,seeking:false,paused:false});h.player.play();h.player.seek(60);h.video.listeners.timeupdate();
 assert.equal(h.player.progressing,false);assert.equal(h.player.near(60),false);h.video.currentTime=60.25;h.video.listeners.timeupdate();assert.equal(h.player.progressing,true);assert.equal(h.player.near(60),true);
});
test('continuity: an imprecise seek landing also waits for a subsequent advancing frame',async()=>{
 const h=harness(Promise.resolve(null));await h.player.ready;Object.assign(h.video,{duration:120,currentTime:0,readyState:4,seeking:false,paused:false});h.player.play();h.player.seek(60);h.video.currentTime=60.75;h.video.listeners.timeupdate();
 assert.equal(h.player.progressing,false);assert.equal(h.player.near(60),false);h.video.currentTime=61;h.video.listeners.timeupdate();assert.equal(h.player.progressing,true);
});
test('continuity: a canplay retry exposes an autoplay lock and recovers muted',async()=>{
 let calls=0;const h=harness(Promise.resolve(null),()=>++calls===2?Promise.reject(Object.assign(new Error('Gesture needed'),{name:'NotAllowedError'})):Promise.resolve());await h.player.ready;
 h.player.play();h.player.muted=false;h.video.listeners.canplay();await Promise.resolve();await Promise.resolve();assert.equal(h.player.audioLocked,true);assert.equal(h.video.muted,true);assert.equal(calls,3);
});
test('continuity: an old play rejection cannot mute a successful newer resume',async()=>{
 const pending=deferred();let calls=0;const h=harness(Promise.resolve(null),()=>++calls===1?pending.promise:Promise.resolve());await h.player.ready;h.player.play();h.player.pause();h.player.play();h.video.muted=false;
 pending.reject(Object.assign(new Error('Old gesture restriction'),{name:'NotAllowedError'}));await Promise.resolve();await Promise.resolve();assert.equal(h.player.audioLocked,false);assert.equal(h.video.muted,false);assert.equal(calls,2);
});
test('continuity: a queued old sound-recovery callback cannot remute resumed video',async()=>{
 const h=harness(Promise.resolve(null));await h.player.ready;h.video.currentTime=4;h.player.play();h.player.muted=false;const old=[...h.timers.values()][0];h.player.pause();h.player.play();h.player.muted=false;
 const newest=[...h.timers.values()][0];old();assert.equal(h.player.audioLocked,false);assert.equal(h.video.muted,false);assert.equal(h.timers.size,1);newest();assert.equal(h.player.audioLocked,true,'the current recovery still works');
});
