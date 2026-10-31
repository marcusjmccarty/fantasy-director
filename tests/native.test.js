// Real NativePlayer lifecycle with a deferred media attachment / play promise.
// The boundary is the browser video element, not the player's state machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../web/native-player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class NativePlayer','class NativePlayer');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(attachment,play=()=>Promise.resolve()){
 const video={paused:true,calls:[],listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},play(){this.calls.push('play');return play();},pause(){this.paused=true;this.calls.push('pause');},load(){},remove(){},removeAttribute(){}};
 const ctx={document:{createElement:()=>video},attachMediaSource:()=>attachment,clearTimeout(){},performance:{now:()=>0}};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.Player=NativePlayer;',ctx);
 return {player:new ctx.Player({url:'https://example.com/clip.mp4'}),video};
}
test('a native player destroyed while attaching disposes the late controller without restarting video',async()=>{
 const pending=deferred(),h=harness(pending.promise);let disposed=0;h.player.play();h.player.destroy();pending.resolve({destroy(){disposed++;}});await h.player.ready;
 assert.equal(disposed,1);assert.equal(h.player.attached,false);assert.equal(h.video.calls.includes('play'),false);h.player.play();assert.equal(h.video.calls.includes('play'),false);
});
for(const action of ['pause','destroy'])test(`an autoplay rejection arriving after ${action} cannot restart a native video`,async()=>{
 const pending=deferred(),h=harness(Promise.resolve(null),()=>pending.promise);await h.player.ready;h.player.play();h.player[action]();pending.reject(Object.assign(new Error('gesture needed'),{name:'NotAllowedError'}));await Promise.resolve();await Promise.resolve();
 assert.equal(h.video.calls.filter(c=>c==='play').length,1);assert.equal(h.player.wantPlay,false);
});
