import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
class Element {
 constructor(){this.value='';this.textContent='';this.innerHTML='';this.hidden=false;this.checked=true;this.style={};this.dataset={};this.attributes={};this.classes=new Set();this.children=[];this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),contains:c=>this.classes.has(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
 setAttribute(k,v){this.attributes[k]=v;} hasAttribute(k){return k in this.attributes;} removeAttribute(k){delete this.attributes[k];}
 focus(){} append(child){if(child.parent)child.parent.children=child.parent.children.filter(c=>c!==child);this.children.push(child);child.parent=this;} remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);} replaceChildren(){this.children=[];} querySelectorAll(){return [];} showModal(){this.open=true;} close(){this.open=false;this.onclose?.();}
}
let holdFrames=false,denyPlayback=false,providerMode=false;
const messageListeners=new Set();
class Frame extends Element {
 constructor(){super();this.messages=[];this.contentWindow={postMessage:(data,origin)=>this.messages.push({data,origin})};}
 send(data){for(const callback of messageListeners)callback({origin:'https://ok.ru',source:this.contentWindow,data});}
}
class Video extends Element {
 constructor(){super();this.currentTime=0;this.duration=12000;this.readyState=3;this.seeking=false;this.paused=true;this.events={};this.frames=[];this.hold=holdFrames;this.buffered={length:1,start:()=>0,end:()=>this.duration};}
 set src(value){this.source=value;this.duration=value.includes('highlight')?13:12000;} get src(){return this.source;}
 load(){} canPlayType(){return 'probably';} addEventListener(name,fn){this.events[name]=fn;} pause(){this.paused=true;} async play(){if(denyPlayback)throw new DOMException('Blocked','NotAllowedError');this.paused=false;}
 requestVideoFrameCallback(fn){if(this.hold)this.frames.push(fn);else queueMicrotask(()=>fn(0,{mediaTime:this.currentTime}));}
 decoded(){for(const fn of this.frames.splice(0))fn(0,{mediaTime:this.currentTime});}
}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const archive=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url)));
const catalog=JSON.parse(readFileSync(new URL('../web/nfl-highlights.json',import.meta.url)));
const league={leagueId:'28375786',season:2026,week:7,ownedTeamId:'1',teams:[{id:'1',name:'Owner franchise',players:[{name:'Taylor',team:'IND',position:'RB'}]},{id:'2',name:'Other franchise',players:[{name:'Flowers',team:'BAL',position:'WR'}]}]};
const storage=new Map(),listeners={};
globalThis.document={getElementById:el,createElement:tag=>tag==='video'?new Video():tag==='iframe'?new Frame():new Element(),addEventListener(){},hidden:false,body:new Element()};
globalThis.window={addEventListener:(name,fn)=>{if(name==='message')messageListeners.add(fn);else listeners[name]=fn;},removeEventListener:(name,fn)=>{if(name==='message')messageListeners.delete(fn);}};
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
let animation;globalThis.requestAnimationFrame=callback=>{animation=callback;};
globalThis.fetch=async url=>{
 let data=url==='/week7.json'?archive:url==='/nfl-highlights.json'?catalog:url==='/api/session'?{savedLeagueId:league.leagueId}:league;
 if(url.startsWith('/api/replay-source')){const id=new URL('https://x'+url).searchParams.get('id'),game=archive.games.find(g=>g.id===id);data={id,duration:providerMode?game.recordingDuration:(game.end-game.start)*.7,expiresAt:Date.now()+300000,sources:[providerMode?{quality:'provider',url:game.embed,type:'provider/ok'}:{quality:'sd',url:'https://a.vkuser.net/replay-'+id+'.mp4',type:'video/mp4'}]};}
 if(url.startsWith('/api/nfl-source'))data={url:'https://dcs-vod.mp.lura.live/highlight.m3u8',type:'application/vnd.apple.mpegurl',duration:13,expiresAt:Date.now()+300000};
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settled=async()=>{for(let i=0;i<5;i++)await flush();};
const visible=()=>el('mediaDeck').children.find(v=>v.classes.has('active'));
test('franchise, shared footage seek, and prepared highlight return work through the application controls',async()=>{
 await import('../web/app.js');await settled();
 assert.ok(el('franchiseSelect').innerHTML.includes('Other franchise'));assert.equal(el('franchiseSelect').value,'1');assert.ok(el('rosterList').innerHTML.includes('Taylor'));
 el('franchiseSelect').onchange({target:{value:'2'}});assert.equal(el('franchiseSelect').value,'2');assert.ok(el('rosterList').innerHTML.includes('Flowers'));assert.equal(JSON.parse(storage.get('fd-simple-v2')).teamId,'2');
 await el('refreshRoster').onclick();await settled();assert.equal(el('franchiseSelect').value,'2');assert.equal(el('gameCount').textContent,14);
 const firstTime=el('timeline').value;el('nextSwitch').onclick();await settled();assert.notEqual(el('timeline').value,firstTime);assert.ok(visible());
 el('playButton').onclick();await settled();assert.equal(el('playButton').textContent,'Pause');assert.equal(visible().paused,false);
 // Rapid seeks retain the prior frame and only commit the final shared position.
 const before=visible(),beforeTime=before.currentTime,last=Number(firstTime)+1200;
 el('timeline').onchange({target:{value:String(last-200)}});el('timeline').onchange({target:{value:String(last)}});assert.equal(before.currentTime,beforeTime);await settled();
 assert.equal(Number(el('timeline').value),last);assert.ok(visible().currentTime>0);assert.equal(el('mediaDeck').children.filter(v=>v.classes.has('active')).length,1);
 // A story is prepared while the game stays visible; its end returns to that game.
 const gameVideo=visible(),clip=catalog.clips[0];holdFrames=true;
 el('clipList').onclick({target:{closest:()=>({dataset:{clip:clip.id}})}});await settled();assert.equal(visible(),gameVideo);
 const clipVideo=el('mediaDeck').children.find(v=>v.source?.includes('highlight'));assert.ok(clipVideo);
 clipVideo.decoded();await settled();clipVideo.decoded();await settled();holdFrames=false;
 assert.equal(visible(),clipVideo);assert.equal(el('gameTitle').textContent,clip.title);assert.equal(el('returnGame').hidden,false);
 clipVideo.events.ended();await settled();assert.equal(visible(),gameVideo);assert.equal(el('returnGame').hidden,true);
 // Calibration uses the same physical player inside the dialog, so controls remain accessible.
 el('settingsButton').onclick();el('syncDetails').open=true;el('syncDetails').ontoggle();
 assert.equal(el('mediaDeck').parent,el('syncPreview'));assert.equal(gameVideo.controls,true);
 const game=archive.games.find(g=>g.id===gameVideo.attributes['aria-label']),play=game.plays.find(p=>p[0]>100);
 el('syncQuarter').value=String(play[1]);el('syncGameClock').value=play[2];gameVideo.currentTime=73.25;el('addSync').onclick();
 assert.equal(JSON.parse(storage.get('fd-simple-v2')).recordings[game.id].marks[0].media,73.25);
 el('closeSettings').onclick();assert.equal(el('mediaDeck').parent,el('player'));assert.equal(gameVideo.controls,false);
 listeners.pagehide();
});

test('startup failure replaces the preparing screen and a user retry can recover',async()=>{
 elements.clear();denyPlayback=true;await import('../web/app.js?startup-failure');await settled();
 el('splashPlay').onclick();await settled();
 assert.equal(el('splashTitle').textContent,'Couldn’t start this replay');assert.match(el('splashDetail').textContent,/AUTOPLAY/);assert.equal(el('splashPlay').hidden,false);assert.equal(visible(),undefined);
 const count=el('mediaDeck').children.length;animation(performance.now()+1000);await settled();assert.equal(el('mediaDeck').children.length,count);assert.equal(count,1);
 denyPlayback=false;el('retryVideo').onclick();await settled();assert.ok(visible());assert.equal(el('playerSplash').hidden,true);assert.equal(el('playButton').textContent,'Pause');listeners.pagehide();
});

test('provider playback exposes the first player, drives shared seeks, and keeps the old picture until progress',async t=>{
 elements.clear();providerMode=true;await import('../web/app.js?provider-controls');await settled();
 t.after(()=>{listeners.pagehide();providerMode=false;});
 const until=async predicate=>{const deadline=Date.now()+1500;while(!predicate()){assert.ok(Date.now()<deadline,'application did not reach the expected playback state');await new Promise(r=>setTimeout(r,10));}};
 const confirm=async frame=>{frame.send({event:'inited'});await until(()=>frame.messages.some(m=>m.data.action==='seek'));const at=frame.messages.findLast(m=>m.data.action==='seek').data.time;frame.send({event:'started'});frame.send({event:'timeupdate',time:at,duration:12000});frame.send({event:'timeupdate',time:at+.2,duration:12000});};
 el('splashPlay').onclick();await settled();const first=el('mediaDeck').children[0];assert.ok(first instanceof Frame);assert.equal(el('playerSplash').hidden,true);assert.ok(first.classes.has('interactive'));assert.equal(visible(),undefined);
 await confirm(first);await until(()=>visible()===first);assert.equal(el('playButton').textContent,'Pause');
 const next=Number(el('timeline').value)+900;el('timeline').onchange({target:{value:String(next)}});await settled();
 const second=el('mediaDeck').children.find(frame=>frame!==first);assert.ok(second instanceof Frame);assert.equal(visible(),first);assert.equal(first.messages.at(-1).data.action,'pause');assert.equal(second.classes.has('interactive'),false);
 await confirm(second);await until(()=>visible()===second);assert.equal(el('mediaDeck').children.filter(v=>v.classes.has('active')).length,1);assert.ok(second.messages.some(m=>m.data.action==='seek'&&m.data.time>0));assert.equal(Number(el('timeline').value),next);
 el('playButton').onclick();assert.ok(second.messages.some(m=>m.data.action==='pause'));assert.equal(el('playButton').textContent,'Play replay');
});
