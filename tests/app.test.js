// Exercise app-level state transitions with the real domain modules and a small
// DOM/player boundary. No network, browser automation or production credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as archive from '../web/archive.js';
import * as sync from '../web/sync.js';
import * as director from '../web/director.js';
import * as coverage from '../web/coverage.js';
import * as replays from '../web/replays.js';
import * as live from '../web/live.js';
import * as scoring from '../web/scoring.js';
import * as roster from '../web/roster.js';
import * as highlights from '../web/highlights.js';
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/\ninit\(\);\s*$/,'');
const archiveData=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
class Element{
 constructor(){this.children=[];this.style={};this.dataset={};this.value='';this.classList={add(){},remove(){},toggle(){},contains(){return false;}};this.parentElement={hidden:false};}
 set innerHTML(value){this.html=value;this.children=[];for(const m of value.matchAll(/<(input|select|button)\b([^>]*)(?:>([\s\S]*?)<\/\1>)?/g)){
  const e=new Element();e.tag=m[1];e.value=/value="([^"]*)"/.exec(m[2])?.[1]||'';e.dataset.key=/data-key="([^"]*)"/.exec(m[2])?.[1];
  if(e.tag==='select')e.value=/<option selected>([^<]*)/.exec(m[3]||'')?.[1]||'';this.children.push(e);
 }}
 get innerHTML(){return this.html||'';}
 querySelectorAll(selector){return this.children.filter(e=>selector==='input,select'?['input','select'].includes(e.tag):selector==='.roster-entry'?e.className==='roster-entry':e.tag===selector);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||new Element();}
 append(e){this.children.push(e);}replaceChildren(){this.children=[];}setAttribute(n,v){this[n]=v;}removeAttribute(n){delete this[n];}addEventListener(){}focus(){this.focused=true;}showModal(){this.open=true;}close(){this.open=false;}remove(){}
}
class Pool{
 constructor(host){this.host=host;this.slots=new Map();this.visible=null;this.current=null;this.closed=[];}
 destroy(){this.slots.clear();this.visible=null;this.current=null;this.destroyed=true;}close(id){this.closed.push(id);this.slots.delete(id);if(this.visible===id){this.visible=null;this.current=null;}}
 hide(){this.visible=null;}setRunning(value){this.running=value;}setMuted(){}keep(){}get(){return null;}open(){throw new Error('Unexpected video load');}
}
function app(fetcher=async()=>Response.json({events:[]})){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const document={getElementById(id){assert.ok(elements.has(id),`Missing UI element: ${id}`);return elements.get(id);},querySelectorAll(){return [];},querySelector(){return new Element();},createElement(){return new Element();},addEventListener(){},body:new Element()};
 const time={now:1000};
 const ctx={...archive,...sync,...director,...coverage,...replays,...live,...scoring,...roster,...highlights,PlayerPool:Pool,NFLSourceCatalog:class{},document,window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},performance:{now:()=>time.now},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,fetch:fetcher,AbortSignal,Response,URL,Date,console};
 vm.createContext(ctx);vm.runInContext(script+'\n globalThis.a={S,pool,director,coverage,clock,step,setMode,setPlaying,useRoster,importLeague,pollLive,pollLiveClips,prepareReplay,render,init,roster,get saved(){return saved;}};',ctx);
 return {...ctx.a,time, get saved(){return ctx.a.saved;},el:id=>elements.get(id)};
}
const player={name:'Jonathan Taylor',team:'IND',position:'RB'};
const game={id:'A',name:'IND @ MIN',kind:'live',teams:[{id:'11',abbr:'IND'},{id:'16',abbr:'MIN'}],state:'in',phase:'live',possession:0,down:1,distance:10,yardsToGoal:40,nextSnapIn:null,date:'2026-11-01T18:00:00Z',scores:[],score:[0,0]};
function ready(a){a.useRoster([player],{teamName:'My lineup'});a.S.at=1000;a.S.games=[game];a.S.live.games=[game];a.S.live.feed.push([game],970);}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),get resolve(){return resolve;}};};
test('new viewers start in live mode and must choose their own players',()=>{
 const a=app();a.render();assert.equal(a.S.mode,'live');assert.equal(a.roster().length,0);
 a.el('ovButton').onclick();assert.equal(a.el('lineupDialog').open,true);assert.equal(a.S.started,false);
 assert.equal(a.el('rosterRows').children.length,1);
});
test('pause prevents director decisions and stops recording coverage',()=>{
 const a=app();ready(a);a.S.started=true;a.S.playing=false;a.S.program={kind:'game',id:'A'};a.S.lastAt=999;
 a.director.decide=()=>{throw new Error('director ran while paused');};a.step(1000);assert.equal(a.coverage.intervals.size,0);assert.equal(a.S.program.id,'A');
});
test('changing lineup clears the old video, pending cut, pin and highlight',()=>{
 const a=app();ready(a);a.S.started=true;a.S.program={kind:'game',id:'A'};a.S.pending={id:'B'};a.S.pinned='A';a.S.highlight={src:{key:'hl:old'},done:true};
 a.useRoster([{name:'Zay Flowers',team:'BAL',position:'WR'}],{teamName:'Another team'});
 assert.equal(a.S.program.kind,'standby');assert.equal(a.S.pending,null);assert.equal(a.S.pinned,null);assert.equal(a.S.highlight,null);assert.equal(a.pool.destroyed,true);
});
test('replacement stream clears the active player and failed-stream cooldown',()=>{
 const a=app();ready(a);a.saved.streams={'IND-MIN':'https://old.example/a.mp4'};a.S.program={kind:'game',id:'A'};a.pool.visible='A';a.S.cooldown.set('A',999999);
 const input=new Element();input.tag='input';input.dataset.key='IND-MIN';input.value='https://new.example/b.mp4';a.el('streamInputs').children=[input];a.el('saveStreams').onclick();
 assert.equal(a.saved.streams['IND-MIN'],input.value);assert.ok(a.pool.closed.includes('A'));assert.equal(a.S.program.kind,'standby');assert.equal(a.S.cooldown.has('A'),false);
});
test('an invalid stream leaves all saved streams unchanged and points at the bad field',()=>{
 const a=app();ready(a);const input=new Element();input.tag='input';input.dataset.key='IND-MIN';input.value='javascript:bad';a.el('streamInputs').children=[input];a.el('saveStreams').onclick();
 assert.equal(Object.keys(a.saved.streams).length,0);assert.equal(input.focused,true);assert.equal(input['aria-invalid'],'true');
});
test('live to replay restores the archived clock instead of sampling the live timestamp',async()=>{
 const a=app();a.S.archive=new archive.ReplayArchive(archiveData);a.S.day=1;const start=a.S.archive.sessions[1].start;a.clock.seek(start,0);a.S.at=Date.now()/1000;
 await a.setMode('replay');assert.equal(a.S.at,start);assert.ok(a.S.games.some(g=>g.state!=='post'));
 const saved=start+100;a.S.at=saved;await a.setMode('live');await a.setMode('replay');assert.equal(a.S.at,saved);
});
test('obsolete live response cannot populate a newer mode or restart polling',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);const poll=a.pollLive(0);a.S.live.generation++;a.S.mode='replay';pending.resolve(Response.json({events:[]}));await poll;
 assert.equal(a.S.live.feed.snapshots.length,0);assert.equal(a.S.live.fetched,0);
});
test('an old ESPN import cannot overwrite a newly selected manual lineup',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);a.el('leagueId').value='123';const importing=a.importLeague();a.S.leagueRequest++;a.useRoster([player],{teamName:'My lineup'});
 pending.resolve(Response.json({leagueId:'123',teams:[{id:'1',name:'Old team',players:[{name:'Joe Burrow',team:'CIN',position:'QB'}]}]}));await importing;assert.equal(a.saved.teamName,'My lineup');
});
test('public league import waits for an explicit team selection',async()=>{
 const a=app(async()=>Response.json({leagueId:'123',name:'Test league',teams:[{id:'1',name:'Somebody else',players:[player]}]}));a.el('leagueId').value='123';await a.importLeague();
 assert.equal(a.saved.teamName,'Sample lineup');assert.equal(a.el('franchise').focused,true);assert.match(a.el('leagueStatus').textContent,/choose your team/);
});
test('live initialization survives a missing archive',async()=>{
 const a=app(async url=>{if(url==='/week7.json')return new Response('',{status:404});return Response.json(String(url).includes('scoreboard')?{events:[]}:{clips:[]});});await a.init();
 assert.equal(a.S.mode,'live');assert.equal(a.el('replayMode').disabled,true);assert.equal(a.el('ovButton').hidden,false);
});
test('paused highlights retain their remaining playback time after resuming',()=>{
 const a=app();ready(a);a.S.playing=true;a.S.highlight={until:5000,since:800,item:{gameId:'A'},src:{}};a.setPlaying(false);assert.equal(a.S.pausedAt,1000);a.time.now=11000;a.setPlaying(true);assert.equal(a.S.highlight.until,15000);assert.equal(a.S.highlight.since,10800);
});
test('successful archive loading leaves live mode intact and prepares a valid replay clock',async()=>{
 const a=app(async url=>Response.json(url==='/week7.json'?archiveData:String(url).includes('scoreboard')?{events:[]}:{clips:[]}));await a.init();
 assert.equal(a.S.mode,'live');assert.ok(a.S.archive);assert.ok(a.clock.at>=a.S.archive.sessions[a.S.day].start);
});
test('saving an unchanged imported lineup retains its ESPN connection',()=>{
 const a=app();ready(a);a.saved.leagueId='123';a.saved.league={teams:[{id:'1',name:'My ESPN team',players:[player]}]};a.saved.teamId='1';
 a.el('editLineup').onclick();a.el('saveRoster').onclick();assert.equal(a.saved.leagueId,'123');assert.equal(a.saved.teamId,'1');assert.equal(a.el('lineupDialog').open,false);
});
