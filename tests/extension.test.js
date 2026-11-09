import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
const box={width:800,height:450};
function video(options={}){return {paused:true,ended:false,readyState:4,currentTime:0,muted:false,plays:0,pauses:0,getBoundingClientRect:()=>box,play(){this.plays++;this.paused=false;return Promise.resolve();},pause(){this.pauses++;this.paused=true;},...options};}
async function fixture({enabled=true,top=false}={}){
 const events=new Map(),docEvents=new Map(),messages=[],runtime=[],videos=[],frames=[],timers=new Map();let time=0,button=null,listener,full=false,clicks=0;
 const parent={},window={parent,addEventListener:(n,f)=>events.set(n,f),dispatchEvent:e=>events.get(e.type)?.(e)};parent.postMessage=m=>messages.push(m);
 const stage={classList:{contains:()=>full}},toggle={click:()=>{clicks++;full=!full;}};
 const document={documentElement:{setAttribute(){}},querySelectorAll:s=>s==='video'?videos:frames,querySelector:s=>s==='.stage'?stage:button,getElementById:()=>toggle,addEventListener:(n,f)=>docEvents.set(n,f)};
 const chrome={runtime:{sendMessage:m=>{runtime.push(m);return Promise.resolve(m.type==='init'?{enabled,top}:undefined);},onMessage:{addListener:f=>listener=f}}};
 class Event{constructor(type,options={}){this.type=type;Object.assign(this,options);}}
 vm.runInNewContext(source,{window,document,chrome,Event,CustomEvent:Event,Date:{now:()=>time},setInterval:f=>{timers.set(1,f);return 1;},clearInterval:k=>timers.delete(k),console});await flush();
 let latest=null;const command=(data={},from=parent)=>{const message={channel:'fantasy-stream-playback-v1',type:'state',session:'1',playing:true,visible:true,muted:false,audioRevision:0,...data};if(from===parent)latest=message;events.get('message')?.({source:from,data:message});};
 return {events,docEvents,messages,runtime,videos,frames,timers,command,tick:async(t,{refresh=true}={})=>{time=t;if(refresh&&latest)command(latest);timers.get(1)?.();await flush();},setButton:b=>{button=b;},receive:m=>listener?.(m),get clicks(){return clicks;}};
}
test('helper does nothing on an unrelated top-level website',async()=>{
 const h=await fixture({enabled:false});assert.equal(h.events.size,0);assert.equal(h.timers.size,0);assert.equal(h.messages.length,0);
});
test('new embed autoplay starts on command and late videos start without a click',async()=>{
 const h=await fixture();assert.equal(h.messages[0].type,'ready');const v=video();h.command();h.videos.push(v);await h.tick(500);
 assert.equal(v.plays,1);assert.equal(v.muted,false);assert.equal(v.playsInline,true);await h.tick(1000);assert.equal(v.plays,1,'do not restart already playing video');
 h.command({playing:false});await flush();assert.equal(v.paused,true);assert.equal(v.muted,true);await h.tick(2000);assert.equal(v.plays,1,'Pause wins over retries');
});
test('blocked audio retries muted, then an explicit sound retry is honored',async()=>{
 const h=await fixture();let refuse=true;const v=video({play(){this.plays++;if(refuse&&!this.muted)return Promise.reject({name:'NotAllowedError'});this.paused=false;return Promise.resolve();}});h.videos.push(v);h.command();await flush();
 assert.equal(v.plays,2);assert.equal(v.muted,true);await h.tick(500);assert.equal(h.messages.at(-1).audioLocked,true);
 refuse=false;h.command({audioRevision:1});await flush();assert.equal(v.muted,false);assert.equal(h.messages.at(-1).audioLocked,false);
});
test('a pending play rejection cannot restart a paused or retired frame',async()=>{
 const h=await fixture();let reject;const v=video({play(){this.plays++;return new Promise((_,r)=>reject=r);}});h.videos.push(v);h.command();await flush();
 h.command({playing:false});reject({name:'NotAllowedError'});await flush();assert.equal(v.plays,1);assert.equal(v.paused,true);
 h.events.get('pagehide')();assert.equal(h.timers.size,0);
});
test('recognized play buttons get bounded clicks, arbitrary page controls are never selected',async()=>{
 const h=await fixture();let clicks=0;h.setButton({getBoundingClientRect:()=>({width:60,height:60}),closest:()=>null,click:()=>clicks++});h.command();await h.tick(3000);await h.tick(6000);await h.tick(9000);assert.equal(clicks,3);
 h.command({playing:false});await h.tick(12000);assert.equal(clicks,3);
 const a=await fixture();a.setButton({getBoundingClientRect:()=>box,closest:()=>({}),click:()=>{throw Error('anchor clicked');}});a.command();await a.tick(1000);
});
test('nested state is relayed only from the parent and progress only from the primary frame',async()=>{
 const h=await fixture(),posts=[];const main={contentWindow:{postMessage:m=>posts.push(m)},getBoundingClientRect:()=>box},ad={contentWindow:{postMessage(){}},getBoundingClientRect:()=>({width:90,height:50})};h.frames.push(main,ad);
 h.command({},{});assert.equal(posts.length,0);h.command();assert.equal(posts.at(-1).playing,true);
 const message=(from,time)=>h.events.get('message')({source:from,data:{channel:'fantasy-stream-playback-v1',type:'status',session:'1',playing:true,time}});
 message(ad.contentWindow,100);assert.equal(h.messages.at(-1).playing,false);message(main.contentWindow,4);assert.equal(h.messages.at(-1).time,4);
 h.command({playing:false});assert.equal(posts.at(-1).playing,false);
});
test('provider fullscreen is routed to the persistent channel and explicit exit still works',async()=>{
 const top=await fixture({top:true});top.receive({type:'fullscreen',exit:false});assert.equal(top.clicks,1);top.receive({type:'fullscreen',exit:false});assert.equal(top.clicks,1);top.receive({type:'fullscreen',exit:true});assert.equal(top.clicks,2);
 const child=await fixture();child.command();child.events.get('fantasy-stream-fullscreen')({detail:{exit:false}});assert.equal(child.runtime.at(-1).type,'fullscreen');
});
test('fullscreen shim retains activation by never entering the disposable video',()=>{
 let calls=0,event;class Element{requestFullscreen(){calls++;}}class HTMLVideoElement extends Element{webkitEnterFullscreen(){calls++;}}
 const window={dispatchEvent:e=>event=e},document={exitFullscreen(){calls++;}};
 vm.runInNewContext(readFileSync(new URL('../extension/fullscreen.js',import.meta.url),'utf8'),{window,document,Element,HTMLVideoElement,CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}}});
 new Element().requestFullscreen();assert.equal(calls,0);assert.equal(event.detail.exit,false);document.exitFullscreen();assert.equal(calls,0);assert.equal(event.detail.exit,true);
});
test('background trusts Chrome tab identity, rejects lookalike sites and targets exact documents',()=>{
 let listener;const injections=[],messages=[];const chrome={runtime:{onMessage:{addListener:f=>listener=f}},scripting:{executeScript:o=>{injections.push(o);return Promise.resolve();}},tabs:{sendMessage:(...args)=>{messages.push(args);return Promise.resolve();}}};
 vm.runInNewContext(readFileSync(new URL('../extension/playback-background.js',import.meta.url),'utf8'),{chrome,URL});
 const send=(url,type='init')=>{let result;listener({type},{tab:{id:7,url},frameId:2,documentId:'doc-2'},r=>result=r);return result;};
 for(const url of ['https://example.com/','https://fantasy-stream.fantasy-hub.workers.dev.evil.test/','http://fantasy-stream.fantasy-hub.workers.dev/'])assert.equal(send(url),undefined);
 assert.equal(injections.length,0);assert.equal(send('https://fantasy-stream.fantasy-hub.workers.dev/').enabled,true);assert.equal(injections[0].target.documentIds[0],'doc-2');assert.equal(injections[0].world,'MAIN');
 send('https://fantasy-stream.fantasy-hub.workers.dev/','fullscreen');assert.equal(messages[0][2].frameId,0);
});
test('a warming stream is muted, captions stay off, and a lost host heartbeat pauses it',async()=>{
 const h=await fixture(),events=new Map(),tracks=[{kind:'captions',mode:'showing'},{kind:'metadata',mode:'hidden'}];tracks.addEventListener=(n,f)=>events.set(n,f);
 const v=video({textTracks:tracks,addEventListener:(n,f)=>events.set(n,f),buffered:{length:1,start:()=>0,end:()=>12},currentTime:5});h.videos.push(v);h.command({visible:false});await flush();
 assert.equal(v.paused,false);assert.equal(v.muted,true);assert.equal(tracks[0].mode,'disabled');assert.equal(tracks[1].mode,'hidden');assert.equal(h.messages.at(-1).buffered,7);
 v.muted=false;events.get('volumechange')();assert.equal(v.muted,true);tracks[0].mode='showing';events.get('change')();assert.equal(tracks[0].mode,'disabled');
 await h.tick(3000,{refresh:false});assert.equal(v.paused,true);h.command({visible:true});await flush();assert.equal(v.paused,false);assert.equal(v.muted,false);
});
test('stale nested video reports expire instead of making a dead frame ready',async()=>{
 const h=await fixture(),child={contentWindow:{postMessage(){}},getBoundingClientRect:()=>box};h.frames.push(child);h.command();
 h.events.get('message')({source:child.contentWindow,data:{channel:'fantasy-stream-playback-v1',type:'status',session:'1',playing:true,time:20,buffered:3}});assert.equal(h.messages.at(-1).playing,true);
 await h.tick(1600);assert.equal(h.messages.at(-1).playing,false);
});

test('an autoplay pause caused by unmuting retries immediately instead of waiting for the next startup window',async()=>{
 const h=await fixture(),events=new Map();let quiet=true;const v=video({addEventListener:(n,f)=>events.set(n,f),play(){this.plays++;if(!quiet)return Promise.reject({name:'NotAllowedError'});this.paused=false;return Promise.resolve();}});
 Object.defineProperty(v,'muted',{get:()=>quiet,set:value=>{const changed=quiet&&!value;quiet=value;if(changed&&!v.paused){v.paused=true;queueMicrotask(()=>events.get('pause')?.());}}});
 h.videos.push(v);h.command({visible:false});await flush();assert.equal(v.paused,false);
 h.command({visible:true});await flush();await flush();assert.equal(v.paused,false);assert.equal(v.muted,true);assert.equal(v.plays,3,'unmute is retried immediately and falls back to playing muted');
});
