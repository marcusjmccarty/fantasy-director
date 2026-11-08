import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbedPlayer} from '../web/embed-player.js';

const CHANNEL='fantasy-stream-playback-v1';
function fixture(){
 let now=0,listener;const messages=[];
 const events={addEventListener:(n,f)=>listener=f,removeEventListener:()=>listener=null};
 const frames=[];const createFrame=()=>{const f={contentWindow:{postMessage:m=>messages.push(m)},setAttribute(){},addEventListener(){},replaceWith(){},remove(){}};frames.push(f);return f;};
 const p=new EmbedPlayer('https://ntv.st/embed?t=test',{events,createFrame,now:()=>now});
 const receive=(data,source=p.element.contentWindow)=>listener?.({source,data:{channel:CHANNEL,session:p.control.session,...data}});
 return {p,messages,frames,receive,tick:t=>{now=t;}};
}
test('helper handshake starts a newly mounted embed and sends the wanted sound state',()=>{
 const {p,messages,receive}=fixture();p.muted=false;p.setVisible(true);p.play();receive({type:'ready'});
 assert.deepEqual(messages.at(-1),{channel:CHANNEL,type:'state',session:p.control.session,playing:true,muted:false,audioRevision:1});p.destroy();
});
test('only advancing video from the current frame and session proves helper playback',()=>{
 const h=fixture(),{p,receive}=h;p.setVisible(true);p.play();
 receive({type:'status',playing:true,time:1},{});assert.equal(p.control.connected,false);
 receive({type:'status',session:'retired',playing:true,time:1});assert.equal(p.control.connected,false);
 receive({type:'status',playing:false,time:0});assert.equal(p.progressing,false);
 h.tick(500);receive({type:'status',playing:true,time:1});assert.equal(p.progressing,true);assert.equal(p.viewerConfirmed,true);
 h.tick(3000);receive({type:'status',playing:true,time:1});assert.equal(p.progressing,false,'a frozen timestamp cannot masquerade as video');p.destroy();
});
test('switch, Pause, reload and destruction revoke the old playback session',()=>{
 const h=fixture(),{p,receive,messages}=h;p.setVisible(true);p.play();const old=p.element.contentWindow,session=p.control.session;
 p.setVisible(false);assert.equal(messages.at(-1).playing,false);p.setVisible(true);
 assert.notEqual(p.control.session,session);receive({type:'status',session,playing:true,time:10},old);assert.equal(p.control.connected,false);
 p.pause();assert.equal(messages.at(-1).playing,false);p.play();p.reload();receive({type:'ready'});assert.equal(messages.at(-1).playing,true);
 p.destroy();assert.equal(messages.at(-1).playing,false);receive({type:'ready'});assert.equal(messages.at(-1).playing,false);
});
test('healthy helper video prevents periodic reload from interrupting playback',()=>{
 const h=fixture(),{p,receive,frames}=h;p.setVisible(true);p.play();const count=frames.length;
 h.tick(120001);receive({type:'status',playing:true,time:120});p.checkHealth();assert.equal(frames.length,count);assert.equal(p.recoveryMessage,'');p.destroy();
});
test('a sound retry has its own revision without replacing the stream',()=>{
 const {p,receive,messages,frames}=fixture();p.setVisible(true);p.play();receive({type:'status',playing:true,time:1,audioLocked:true});assert.equal(p.audioLocked,true);
 const count=frames.length,revision=p.control.audioRevision;p.muted=false;assert.equal(p.audioLocked,false);assert.equal(frames.length,count);assert.equal(messages.at(-1).audioRevision,revision+1);p.destroy();
});
