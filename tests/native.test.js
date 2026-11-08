import {disableCaptions} from '../web/captions.js';
// Real NativePlayer lifecycle with a deferred media attachment / play promise.
// The boundary is the browser video element, not the player's state machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(process.env.FANTASY_AUDIT_NATIVE||new URL('../web/native-player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class NativePlayer','class NativePlayer');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(attachment,play=()=>Promise.resolve(),source={url:'https://example.com/clip.mp4'}){
 const video={paused:true,calls:[],listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},play(){this.calls.push('play');return play();},pause(){this.paused=true;this.calls.push('pause');},load(){},remove(){},removeAttribute(){}};
 const timers=new Map();let sequence=0;
 const time={now:0},attachments=[];
 const ctx={disableCaptions,document:{createElement:()=>video},attachMediaSource:(...args)=>{attachments.push(args);return typeof attachment==='function'?attachment(...args):attachment;},setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),performance:{now:()=>time.now},AbortController};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.Player=NativePlayer;',ctx);
 return {player:new ctx.Player(source),video,timers,time,attachments};
}
test('a native player destroyed while attaching disposes the late controller without restarting video',async()=>{
 const pending=deferred(),h=harness(pending.promise);let disposed=0;h.player.play();await Promise.resolve();h.player.destroy();pending.resolve({destroy(){disposed++;}});await h.player.ready;
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
test('sound: a source still loading is not an audio refusal, so a stream shown before it starts keeps its sound',async()=>{
 const h=harness(Promise.resolve(null));await h.player.ready;Object.assign(h.video,{readyState:0,currentTime:0,paused:false,muted:true});h.player.play();h.player.muted=false;
 assert.equal(h.timers.size,0,'no footage yet, nothing to judge');assert.equal(h.video.muted,false);assert.equal(h.player.audioLocked,false);
 const pending=harness(new Promise(()=>{}));pending.player.play();pending.player.muted=false;await Promise.resolve();
 assert.equal(pending.timers.size,0,'nor while the source is attaching');assert.equal(pending.video.muted,false);assert.equal(pending.player.audioLocked,false);
});
test('sound: a real refusal of a source still loading still locks, through play()',async()=>{
 let calls=0;const h=harness(Promise.resolve(null),()=>++calls===1?Promise.reject(Object.assign(new Error('gesture needed'),{name:'NotAllowedError'})):Promise.resolve());await h.player.ready;h.video.readyState=0;let notices=0;h.player.on('audiolocked',()=>notices++);h.player.muted=false;h.player.wantPlay=true;h.player.play();await Promise.resolve();
 assert.equal(h.player.audioLocked,true);assert.equal(h.video.muted,true);assert.equal(notices,1);
});
test('sound: footage moving with sound on clears a stale lock, and a stalled one still locks',async()=>{
 const h=harness(Promise.resolve(null));await h.player.ready;Object.assign(h.video,{readyState:4,currentTime:10,paused:false});h.player.play();h.player.audioLocked=true;h.player.muted=false;h.video.currentTime=12;[...h.timers.values()].at(-1)();
 assert.equal(h.player.audioLocked,false,'the button goes once sound is really playing');assert.equal(h.video.muted,false);
 h.player.muted=false;[...h.timers.values()].at(-1)();assert.equal(h.player.audioLocked,true,'no footage moved after a started stream: still a refusal');assert.equal(h.video.muted,true);
});
const liveSource={url:'https://video.example/live.m3u8',type:'application/vnd.apple.mpegurl',live:true};
const check=(h,at,options={})=>{h.time.now=at;h.player.checkHealth({active:true,...options});};
test('live recovery: uninterrupted advancing video never reloads during a three-hour session',async()=>{
 const h=harness(Promise.resolve(null),undefined,liveSource);h.player.play();await h.player.ready;h.video.paused=false;h.video.currentTime=0;
 for(let at=0;at<=10800000;at+=1000){h.time.now=at;h.video.currentTime+=1;h.video.listeners.timeupdate();h.player.checkHealth({active:true});}
 assert.equal(h.attachments.length,1);assert.equal(h.player.recoveryAttempts,0);assert.equal(h.player.reconnecting,false);h.player.destroy();
});
test('live recovery: a stalled HLS source resumes at its live edge before a spaced reload',async()=>{
 let starts=0;const h=harness(Promise.resolve({liveSyncPosition:120,startLoad(){starts++;}}),undefined,liveSource);h.player.play();await h.player.ready;h.video.currentTime=40;
 check(h,0);check(h,3000);assert.equal(starts,1);assert.equal(h.video.currentTime,120);assert.equal(h.attachments.length,1);
 check(h,9999);assert.equal(h.attachments.length,1);check(h,10000);await h.player.ready;assert.equal(h.attachments.length,2);assert.equal(h.player.wantPlay,true);h.player.destroy();
});
test('live recovery: fatal errors and unexpected endings retry without emitting replay completion',async()=>{
 for(const event of ['error','ended']){
  const h=harness(Promise.resolve(null),undefined,liveSource);let ended=0;h.player.on('ended',()=>ended++);h.player.play();await h.player.ready;
  h.video.error={code:2};h.video.listeners[event]();assert.ok(h.player.error);assert.equal(ended,0);
  check(h,2999);assert.equal(h.attachments.length,1);check(h,3000);await h.player.ready;assert.equal(h.attachments.length,2);assert.equal(h.player.error,null);h.player.destroy();
 }
});
test('live recovery: repeated failures back off to one reload per minute without giving up',async()=>{
 const h=harness(Promise.resolve(null),undefined,liveSource),restarts=[];h.player.on('reconnect',()=>restarts.push(h.time.now));h.player.play();await h.player.ready;
 for(let at=0;at<=300000;at+=250){check(h,at);await h.player.ready;}
 assert.deepEqual(restarts,[10000,25000,55000,115000,175000,235000,295000]);assert.equal(h.player.wantPlay,true);assert.equal(h.player.error,null);h.player.destroy();
});
test('live recovery: one moving frame cannot reset the repeated-failure backoff',async()=>{
 const h=harness(Promise.resolve(null),undefined,liveSource);h.player.play();await h.player.ready;
 for(let at=0;at<=55000;at+=250){check(h,at);await h.player.ready;}
 h.time.now=56000;h.video.paused=false;h.video.currentTime=1;h.video.listeners.timeupdate();h.player.checkHealth({active:true});
 h.video.error={code:2};h.video.listeners.error();check(h,60000);assert.equal(h.attachments.length,4,'brief progress cannot produce another rapid reconnect');
 check(h,115000);await h.player.ready;assert.equal(h.attachments.length,5);h.player.destroy();
});
test('live recovery: offline and hidden time do not consume retries; restoration reconnects once',async()=>{
 const h=harness(Promise.resolve(null),undefined,liveSource);h.player.play();await h.player.ready;check(h,0);check(h,2000,{online:false});check(h,302000,{online:false});assert.equal(h.attachments.length,1);
 check(h,302000);await h.player.ready;assert.equal(h.attachments.length,2);
 check(h,303000,{foreground:false});check(h,903000,{foreground:false});check(h,903000);assert.equal(h.attachments.length,2);
 for(let at=904000;at<=929000;at+=1000){check(h,at,{online:false});check(h,at);await h.player.ready;}
 assert.ok(h.attachments.length<=5,'flapping connectivity cannot create a tight reconnect loop');h.player.destroy();
});
test('live recovery: Pause, hidden inactive games and retired players cannot be restarted by health checks',async()=>{
 const h=harness(Promise.resolve(null),undefined,liveSource);h.player.play();await h.player.ready;check(h,0,{active:false});check(h,600000,{active:false});assert.equal(h.attachments.length,1);
 h.player.pause();check(h,700000);assert.equal(h.attachments.length,1);assert.equal(h.player.reload(),false);
 h.player.destroy();h.video.error={code:2};h.video.listeners.error();h.video.listeners.ended();check(h,900000);assert.equal(h.attachments.length,1);assert.equal(h.player.wantPlay,false);
});
test('live recovery: an obsolete attachment and its fatal callback cannot replace a newer source controller',async()=>{
 const old=deferred();let calls=0,disposed=0;const current={destroy(){}};
 const h=harness(()=>++calls===1?old.promise:Promise.resolve(current),undefined,liveSource);h.player.setVisible(true);h.player.play();await Promise.resolve();const oldReady=h.player.ready;
 h.player.reload();await h.player.ready;assert.equal(h.player.controller,current);assert.equal(h.attachments[0][3].signal.aborted,true);
 h.attachments[0][2]();assert.equal(h.player.error,null);old.resolve({destroy(){disposed++;}});await oldReady;
 assert.equal(disposed,1);assert.equal(h.player.controller,current);h.player.destroy();
});
test('live recovery: a synchronous Pause during reconnect cancels the new attachment',async()=>{
 const h=harness(Promise.resolve(null),undefined,liveSource);h.player.play();await h.player.ready;h.player.on('reconnect',()=>h.player.pause());
 check(h,0);check(h,3000);check(h,10000);await h.player.ready;assert.equal(h.attachments.length,1);assert.equal(h.player.wantPlay,false);h.player.destroy();
});
test('live recovery: finite replay playback keeps its existing end and error behavior',async()=>{
 const h=harness(Promise.resolve(null));h.player.play();await h.player.ready;let ended=0;h.player.on('ended',()=>ended++);h.video.listeners.ended();check(h,900000);
 assert.equal(ended,1);assert.equal(h.attachments.length,1);assert.equal(h.player.reload(),false);h.player.destroy();
});
