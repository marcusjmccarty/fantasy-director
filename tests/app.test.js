import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
class Element {
 constructor(){this.value='';this.textContent='';this.innerHTML='';this.hidden=false;this.checked=true;this.style={};this.dataset={};this.attributes={};this.classList={add(){},remove(){},contains(){return false;}};}
 setAttribute(k,v){this.attributes[k]=v;} hasAttribute(k){return k in this.attributes;} removeAttribute(k){delete this.attributes[k];}
 focus(){} append(){} replaceChildren(){} querySelectorAll(){return [];} showModal(){this.open=true;} close(){this.open=false;}
}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const archive=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url)));
const league={leagueId:'28375786',season:2026,week:7,ownedTeamId:'1',teams:[{id:'1',name:'Owner franchise',players:[{name:'Taylor',team:'IND',position:'RB'}]},{id:'2',name:'Other franchise',players:[{name:'Flowers',team:'BAL',position:'WR'}]}]};
const storage=new Map();const listeners={};
globalThis.document={getElementById:el,addEventListener(){},hidden:false,body:new Element()};
globalThis.window={addEventListener:(name,fn)=>{listeners[name]=fn;}};
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
globalThis.requestAnimationFrame=()=>{};
globalThis.fetch=async url=>new Response(JSON.stringify(url==='/week7.json'?archive:url==='/nfl-highlights.json'?{embeds:[],stories:[]}:url==='/api/session'?{savedLeagueId:league.leagueId}:league),{headers:{'Content-Type':'application/json'}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('league import exposes every franchise; switching persists its roster and survives refresh',async()=>{
 await import('../web/app.js');await flush();await flush();
 assert.ok(el('franchiseSelect').innerHTML.includes('Other franchise'));
 assert.equal(el('franchiseSelect').value,'1');assert.ok(el('rosterList').innerHTML.includes('Taylor'));
 el('franchiseSelect').onchange({target:{value:'2'}});
 assert.equal(el('franchiseSelect').value,'2');assert.ok(el('rosterList').innerHTML.includes('Flowers'));
 assert.equal(JSON.parse(storage.get('fd-simple-v2')).teamId,'2');
 await el('refreshRoster').onclick();await flush();
 assert.equal(el('franchiseSelect').value,'2');assert.ok(el('rosterList').innerHTML.includes('Flowers'));
 assert.equal(el('gameCount').textContent,14);
 const firstTime=el('timeline').value,firstTitle=el('gameTitle').textContent;
 el('nextSwitch').onclick();assert.notEqual(el('timeline').value,firstTime);assert.notEqual(el('gameTitle').textContent,firstTitle);
 el('timeline').onchange({target:{value:firstTime}});assert.equal(el('timeline').value,firstTime);assert.equal(el('gameTitle').textContent,firstTitle);
 listeners.pagehide();
});
