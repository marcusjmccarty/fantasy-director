import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbedPlayer} from '../web/embed-player.js';
import {PlayerPool} from '../web/players.js';

const CHANNEL='fantasy-stream-playback-v1';
function fixture({helper=false}={}){
 let now=0,listener;const messages=[];
 const events={addEventListener:(n,f)=>listener=f,removeEventListener:()=>listener=null};
 const frames=[];const createFrame=()=>{const f={classList:{add(){},remove(){},toggle(){}},contentWindow:{postMessage:m=>messages.push(m)},setAttribute(){},addEventListener(){},replaceWith(){},remove(){}};frames.push(f);return f;};
 const p=new EmbedPlayer('https://ntv.st/embed?t=test',{events,createFrame,now:()=>now,helperAvailable:()=>helper});
 const receive=(data,source=p.element.contentWindow)=>listener?.({source,data:{channel:CHANNEL,session:p.control.session,...data}});
 return {p,messages,frames,receive,tick:t=>{now=t;}};
}
test('helper handshake starts a newly mounted embed and sends the wanted sound state',()=>{
 const {p,messages,receive}=fixture();p.muted=false;p.setVisible(true);p.play();receive({type:'ready'});
 assert.deepEqual(messages.at(-1),{channel:CHANNEL,type:'state',session:p.control.session,playing:true,visible:true,muted:false,captions:false,audioRevision:1});p.destroy();
});
test('only advancing video from the current frame and session proves helper playback',()=>{
 const h=fixture(),{p,receive}=h;p.setVisible(true);p.play();
 receive({type:'status',playing:true,time:1},{});assert.equal(p.control.connected,false);
 receive({type:'status',session:'retired',playing:true,time:1});assert.equal(p.control.connected,false);
 receive({type:'status',playing:false,time:0});assert.equal(p.progressing,false);
 h.tick(500);receive({type:'status',playing:true,time:1});assert.equal(p.progressing,false);h.tick(750);receive({type:'status',playing:true,time:1.25});assert.equal(p.progressing,true);assert.equal(p.viewerConfirmed,true);
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
 h.tick(119000);receive({type:'status',playing:true,time:119});h.tick(119500);receive({type:'status',playing:true,time:119.5});h.tick(120001);receive({type:'status',playing:true,time:120});p.checkHealth();assert.equal(frames.length,count);assert.equal(p.recoveryMessage,'');p.destroy();
});
test('a sound retry has its own revision without replacing the stream',()=>{
 const {p,receive,messages,frames}=fixture();p.setVisible(true);p.play();receive({type:'status',playing:true,time:1,audioLocked:true});assert.equal(p.audioLocked,true);
 const count=frames.length,revision=p.control.audioRevision;p.muted=false;assert.equal(p.audioLocked,false);assert.equal(frames.length,count);assert.equal(messages.at(-1).audioRevision,revision+1);p.destroy();
});
test('prewarming requires advancing buffered video and reveals the existing frame without another load',()=>{
 const h=fixture({helper:true}),{p,receive,messages}=h;
 p.play();const frame=p.element,session=p.control.session;assert.equal(frame.src,p.url);assert.equal(p.visible,false);assert.equal(messages.at(-1).playing,true);assert.equal(messages.at(-1).muted,true);
 const sample=(at,time,buffered=2)=>{h.tick(at);receive({type:'status',playing:true,time,buffered});};
 sample(0,100);sample(250,100.25);assert.equal(p.readyToShow,false);sample(500,100.5,.1);assert.equal(p.progressing,true);assert.equal(p.readyToShow,false,'moving without enough buffer must still wait');
 sample(750,100.75);assert.equal(p.readyToShow,true);
 p.setVisible(true);p.muted=false;assert.equal(p.element,frame);assert.equal(p.control.session,session);assert.equal(messages.at(-1).muted,false);
 p.muted=true;p.setVisible(false);assert.equal(p.element,frame);assert.equal(frame.src,p.url);assert.equal(messages.at(-1).playing,true);assert.equal(messages.at(-1).muted,true);
 sample(3000,100.75);assert.equal(p.readyToShow,false,'a frozen video loses readiness');
 p.pause();assert.equal(messages.at(-1).playing,false);assert.equal(p.element,frame);p.destroy();
});
test('pool cuts between warm frames without replacing either document and mutes before revealing',()=>{
 const a=fixture({helper:true}),b=fixture({helper:true});let next=a.p;
 const pool=new PlayerPool({append(){}},{create:()=>next,now:()=>0});pool.setRunning(true);pool.setMuted(false);
 pool.open('a',{url:'a'});next=b.p;pool.open('b',{url:'b'});
 for(const [id,h] of [['a',a],['b',b]]){pool.hold(id,null);for(let i=0;i<3;i++){h.tick(i*250);h.receive({type:'status',playing:true,time:i*.25,buffered:3});}assert.equal(pool.ready(id,null),true);}
 const af=a.p.element,bf=b.p.element;pool.show('a');pool.show('b');
 assert.equal(a.p.element,af);assert.equal(b.p.element,bf);assert.equal(a.messages.at(-1).muted,true);assert.equal(a.messages.at(-1).playing,true);assert.equal(b.messages.at(-1).muted,false);
 pool.show('a');assert.equal(a.p.element,af);assert.equal(b.p.element,bf);pool.setRunning(false);assert.equal(a.messages.at(-1).playing,false);assert.equal(b.messages.at(-1).playing,false);pool.destroy();
});
