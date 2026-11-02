import {StreamFinder} from '../web/stream-finder.js';
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
import * as preferences from '../web/preferences.js';
import * as liveHighlights from '../web/live-highlights.js';
import * as continuity from '../web/continuity.js';
import * as breaks from '../web/breaks.js';
import * as scoreboard from '../web/scoreboard.js';
const {PlayerPool}=await import(process.env.FANTASY_AUDIT_POOL||'../web/players.js');
import {EmbedPlayer} from '../web/embed-player.js';
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
// Point at a historical app.js to reproduce the audit cases against that revision.
const script=readFileSync(process.env.FANTASY_AUDIT_APP||new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/\ninit\(\);\s*$/,'');
const archiveData=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
class Element{
 constructor(){this.children=[];this.style={};this.dataset={};this.value='';const classes=new Set();this.classList={add(name){classes.add(name);},remove(name){classes.delete(name);},toggle(name,on){if(on??!classes.has(name))classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}};this.parentElement={hidden:false};}
 set innerHTML(value){this.html=value;this.children=[];for(const m of value.matchAll(/<(input|select|button)\b([^>]*)(?:>([\s\S]*?)<\/\1>)?/g)){
  const e=new Element();e.tag=m[1];e.value=/value="([^"]*)"/.exec(m[2])?.[1]||'';e.dataset.key=/data-key="([^"]*)"/.exec(m[2])?.[1];e.dataset.backup=/data-backup="([^"]*)"/.exec(m[2])?.[1];
  if(e.tag==='select')e.value=/<option selected>([^<]*)/.exec(m[3]||'')?.[1]||'';this.children.push(e);
 }}
 get innerHTML(){return this.html||'';}
 querySelectorAll(selector){return this.children.filter(e=>selector==='input,select'?['input','select'].includes(e.tag):selector==='.roster-entry'?e.className==='roster-entry':e.tag===selector);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||new Element();}
 append(e){this.children.push(e);e.parentNode=this;}replaceWith(e){const parent=this.parentNode;if(parent){const i=parent.children.indexOf(this);parent.children[i]=e;e.parentNode=parent;this.parentNode=null;}this.removed=true;}replaceChildren(){this.children=[];}setAttribute(n,v){this[n]=v;}removeAttribute(n){delete this[n];}addEventListener(){}focus(){this.focused=true;}showModal(){this.open=true;}close(){this.open=false;}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(e=>e!==this);this.parentNode=null;this.removed=true;}
}
class Video extends Element{
 constructor(){super();this.events=new Map();this.paused=true;this.currentTime=0;this.duration=NaN;this.readyState=4;this.seeking=false;this.calls=[];}
 addEventListener(name,callback){this.events.set(name,callback);}emit(name){this.events.get(name)?.();}
 play(){this.calls.push('play');this.paused=false;return Promise.resolve();}pause(){this.calls.push('pause');this.paused=true;}load(){}
}
class Pool{
 constructor(host){this.host=host;this.slots=new Map();this.visible=null;this.current=null;this.closed=[];}
 destroy(){this.slots.clear();this.visible=null;this.current=null;this.destroyed=true;}close(id){this.closed.push(id);this.slots.delete(id);if(this.visible===id){this.visible=null;this.current=null;}}
 hide(){this.visible=null;}setRunning(value){this.running=value;}setMuted(){}keep(){}get(){return null;}open(){throw new Error('Unexpected video load');}
}
// The real pool coordinates these media boundaries. Playback advances only
// when requested; tests can leave a clip buffering or emit provider events.
class Media{
 constructor(source){this.source=source;this.kind='native';this.element=new Element();this.listeners=new Map();this.target=null;this.currentTime=0;this.primed=true;this.advances=2;this.wantPlay=false;this.moving=true;this.inAd=false;this.muted=true;}
 on(name,fn){this.listeners.set(name,fn);}emit(name,value){if(name==='ad')this.inAd=value;this.listeners.get(name)?.(value);}
 get progressing(){return this.wantPlay&&this.moving&&!this.inAd;}
 play(){this.wantPlay=true;}pause(){this.wantPlay=false;}seek(at){this.currentTime=at;}near(at,tolerance=2.5){return this.progressing&&Math.abs(this.currentTime-at)<=tolerance;}
 destroy(){this.wantPlay=false;this.destroyed=true;}
}
function app(fetcher=async()=>Response.json({events:[]}),{media=false,native=false,embeds=false,scores=false,stored=null,storageBlocked=false}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const pageEvents=new Map(),stage=new Element(),document={getElementById(id){assert.ok(elements.has(id),`Missing UI element: ${id}`);return elements.get(id);},querySelectorAll(){return [];},querySelector(selector){return selector==='.stage'?stage:new Element();},createElement(tag){return tag==='video'?new Video():new Element();},addEventListener(name,fn){if(!pageEvents.has(name))pageEvents.set(name,[]);pageEvents.get(name).push(fn);},body:new Element()};
 const time={now:1000},timers=new Map();let timerId=0;
 const frameEvents={};
 const frameFactory=()=>{const navigations=[];return ()=>{const f=new Video();let src;f.navigations=navigations;Object.defineProperty(f,'src',{get(){return src;},set(url){src=url;navigations.push(url);frameEvents.onNavigate?.(url,f);}});return f;};};
 class MediaPool extends PlayerPool{constructor(host,options){super(host,{...options,now:()=>time.now,create:source=>embeds&&source.type==='embed/page'?new EmbedPlayer(source.url,{now:()=>time.now,createFrame:frameFactory(),autoReconnect:source.autoReconnect}):native?new ctx.Native(source):new Media(source)});}}
 const storage=new Map(stored===null?[]:[['fantasy-stream-v3',JSON.stringify(stored)]]);
 const ctx={StreamFinder,...archive,...sync,...director,...coverage,...replays,...live,...scoring,...roster,...highlights,...preferences,...liveHighlights,...continuity,...breaks,...scoreboard,FantasyScoreFeed:class extends scoreboard.FantasyScoreFeed{constructor(){super({fetcher});}sync(connection,seed){this.connection=connection;if(scores)return super.sync(connection,seed);}},PlayerPool:media?MediaPool:Pool,NFLSourceCatalog:class{},document,window:{navigator:{onLine:true},addEventListener(){}},localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(storageBlocked)throw new Error('Storage unavailable');storage.set(key,value);}},performance:{now:()=>time.now},setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},setInterval:()=>0,fetch:fetcher,AbortSignal,AbortController,Response,URL,URLSearchParams,Date,console};
 vm.createContext(ctx);
 if(native){ctx.attachMediaSource=async()=>null;const code=readFileSync(new URL('../web/native-player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class NativePlayer','class NativePlayer');vm.runInContext(code+'\nglobalThis.Native=NativePlayer;',ctx);}
 vm.runInContext(script+'\n globalThis.a={S,pool,streamFinder,refreshStreamLinks,fantasyFeed,director,coverage,clock,step,updateBreaks,advanceClock,skipBreak,selectGame,excluded,cutTo,warm,startHighlight,updateHighlight,finishHighlight,syncFor,nudge,nfl,setMode,setPlaying,setDay,seekTo,replaySource,useRoster,importLeague,pollLive,pollLiveClips,prepareReplay,retryMissedReplays,failHighlight,render,init,roster,get saved(){return saved;}};',ctx);
 return {...ctx.a,time,timers,storage,page:document,stage,frameEvents,emitPage(name,event={}){for(const fn of pageEvents.get(name)||[])fn(event);},network:ctx.window.navigator, get saved(){return ctx.a.saved;},el:id=>elements.get(id)};
}
const player={name:'Jonathan Taylor',team:'IND',position:'RB'};
const game={id:'A',name:'IND @ MIN',kind:'live',teams:[{id:'11',abbr:'IND'},{id:'16',abbr:'MIN'}],state:'in',phase:'live',possession:0,down:1,distance:10,yardsToGoal:40,nextSnapIn:null,date:'2026-11-01T18:00:00Z',scores:[],score:[0,0]};
function ready(a){a.S.mode='live';a.useRoster([player],{teamName:'My lineup'});a.S.at=1000;a.S.games=[game];a.S.live.games=[game];a.S.live.feed.push([game],970);}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),get resolve(){return resolve;}};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const feedEvent=(id,abbr='IND',situation={})=>({id,competitions:[{status:{type:{state:'in'}},situation,competitors:[{homeAway:'away',team:{id:'11',abbreviation:abbr}},{homeAway:'home',team:{id:'16',abbreviation:'MIN'}}]}]});
test('release: incomplete scoreboard responses cannot reopen a scoring commercial',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;a.setPlaying(true);
 const push=(scores,id,at=1000)=>{const event=feedEvent('A','IND',{possession:'11',down:1,lastPlay:{id,type:{text:'Rush'}}});if(scores)event.competitions[0].competitors.forEach((team,i)=>team.score=String(scores[i]));a.S.live.feed.push(live.liveGames({events:[event]}),at);a.S.at=at;a.step(a.time.now+=250);};
 push([0,0],'before');assert.equal(a.pool.visible,'A');push([7,0],'td');assert.equal(a.pool.visible,'A','the score stays on screen for the celebration');
 push([7,0],'td',1030);assert.equal(a.pool.visible,null,'then the commercial');
 push(null,'td',1035);assert.equal(a.pool.visible,null,'missing scores are not an authoritative overturn');
 push([7,0],'next-drive',1040);assert.equal(a.pool.visible,'A');
});
test('release: slow summaries cannot delay scoreboard polling or commercial detection',async()=>{
 const summary=deferred();let requests=0;
 const a=app(url=>String(url).includes('scoreboard')?Promise.resolve(Response.json({events:[feedEvent('A','IND',{possession:'11',down:1,lastPlay:{id:String(++requests),type:{text:requests===1?'Rush':'Timeout'}}})]})):summary.promise,{media:true});
 ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;a.setPlaying(true);
 const pending=a.pollLive(0);await flush();
 const next=[...a.timers.values()].find(t=>t.delay===5000);assert.ok(next,'schedule the next scoreboard while the summary is unresolved');
 a.S.at=Date.now()/1000+1;a.step(1000);assert.equal(a.pool.visible,'A');
 await next.fn();a.S.at=Date.now()/1000+1;a.step(1250);
 assert.equal(requests,2);assert.equal(a.pool.visible,null,'the timeout hides video even while highlights are loading');
 summary.resolve(Response.json({scoringPlays:[],videos:[]}));await pending;
});
test('release: overlapping polls bound summary requests and give later games a turn',async()=>{
 const summaries=[],names=['IND','DAL','BUF','SEA','KC'];
 const a=app(url=>{if(String(url).includes('scoreboard'))return Promise.resolve(Response.json({events:names.map((name,i)=>feedEvent(String(i),name))}));const request=deferred();summaries.push({id:String(url).split('event=')[1],...request});return request.promise;});
 a.useRoster(names.map(team=>({name:'Player '+team,team,position:'RB'})),{teamName:'Five games'});
 const first=a.pollLive(0);await flush();assert.equal(summaries.length,4);
 const second=a.pollLive(0);await flush();assert.equal(summaries.length,4,'at most four summaries may be in flight');
 for(const request of summaries)request.resolve(Response.json({scoringPlays:[],videos:[]}));await Promise.all([first,second]);
 const third=a.pollLive(0);await flush();assert.equal(summaries.length,5);assert.equal(summaries[4].id,'4');
 summaries[4].resolve(Response.json({scoringPlays:[],videos:[]}));await third;
});
test('release: a slow obsolete summary cannot change a refreshed schedule',async()=>{
 const old=deferred();let summaryCount=0;
 const a=app(url=>String(url).includes('scoreboard')?Promise.resolve(Response.json({events:[feedEvent('A')]})):++summaryCount===1?old.promise:Promise.resolve(Response.json({videos:[{id:'102',headline:'New video',links:{source:{href:'https://espnmedia-cdn.akamaized.net/new.mp4'}}}]})));
 ready(a);const first=a.pollLive(0);await flush();a.S.live.generation=1;a.S.live.summaryAt={};await a.pollLive(1);
 old.resolve(Response.json({videos:[{id:'101',headline:'Old video',links:{source:{href:'https://espnmedia-cdn.akamaized.net/old.mp4'}}}]}));await first;
 assert.equal(a.S.liveClips.some(c=>c.id==='clip:101'),false);assert.equal(a.S.liveClips.some(c=>c.id==='clip:102'),true);
});
function liveReplay(a){
 ready(a);a.S.at=Date.now()/1000;
 const score={id:'A:td',at:a.S.at-60,kind:'TD',text:'Jonathan Taylor 4 Yd Rush',players:[{name:'Jonathan Taylor',role:'scorer'}]},g={...game,date:new Date(Date.now()-3600000).toISOString(),season:2026,week:8,scores:[score]};
 a.S.games=[g];a.S.live.games=[g];a.S.live.scores.set(g.id,[score]);
 const item={id:score.id,gameId:g.id,gameName:g.name,score,at:score.at,credits:[{player,role:'scorer'}],seen:false,queuedAt:a.S.at};a.coverage.log.push(item);a.coverage.queue.push(item);
 const clip={id:'nfl-1',kind:'nfl',title:'Taylor scores',description:'Jonathan Taylor scores a 4-yard touchdown.',teams:['IND'],publishedAt:Date.now()-30000,url:'https://www.nfl.com/videos/taylor-touchdown',duration:12};
 return {item,clip};
}
test('integration: a published unscoped NFL clip prepares for its corroborated live game',async()=>{
 const a=app(),{item,clip}=liveReplay(a);a.S.liveClips=[clip];let resolved;
 a.nfl.resolve=async c=>{resolved=c;return {url:'https://dcs-vod.mp.lura.live/vod/master.m3u8',duration:12,expiresAt:Date.now()+240000};};
 await a.prepareReplay(item);assert.equal(resolved.gameId,'A');assert.equal(resolved.association,'time-team-score');assert.equal(a.S.sources.get(item.id).status,'ready');assert.equal(item.watchUrl,clip.url);
});
test('integration: one failed resolver does not hide another matching source',async()=>{
 const a=app(),{item,clip}=liveReplay(a);a.S.liveClips=[clip,{...clip,id:'nfl-2'}];const calls=[];
 a.nfl.resolve=async c=>{calls.push(c.id);if(c.id==='nfl-1')throw new Error('Unavailable');return {url:'https://dcs-vod.mp.lura.live/vod/second.m3u8',duration:12};};
 await a.prepareReplay(item);assert.deepEqual(calls,['nfl-1','nfl-2']);assert.equal(a.S.sources.get(item.id).clipId,'nfl-2');assert.ok(a.S.failedClips.get('nfl-1')>Date.now());
});
test('integration: a failed playing clip tries a different player without interrupting the game',async()=>{
 const a=app(undefined,{media:true}),{item,clip}=liveReplay(a);a.S.liveClips=[clip,{...clip,id:'nfl-2'}];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/master.m3u8',duration:12});
 a.pool.open('A',{url:'https://example.test/live.mp4'});a.pool.show('A');a.S.program={kind:'game',id:'A'};const gamePlayer=a.pool.current;
 await a.prepareReplay(item);a.startHighlight(item.id);a.failHighlight('player failed');assert.equal(item.status,'waiting');assert.equal(a.pool.current,gamePlayer);assert.equal(gamePlayer.destroyed,undefined);
 a.retryMissedReplays();await a.prepareReplay(item);assert.equal(a.S.sources.get(item.id).clipId,'nfl-2');assert.equal(a.coverage.queue.length,1);
});
test('integration: late publication retries on its own deadline and stops after thirty minutes',async()=>{
 const a=app(),{item,clip}=liveReplay(a);await a.prepareReplay(item);assert.equal(item.status,'waiting');assert.equal(item.unavailable,false);assert.equal(a.coverage.queue.length,0);
 a.retryMissedReplays();assert.equal(a.coverage.queue.length,0,'no retry on each animation frame');
 a.S.sources.get(item.id).retryAt=0;a.saved.highlights=false;a.retryMissedReplays();assert.equal(a.coverage.queue.length,0);a.saved.highlights=true;
 a.S.liveClips=[clip];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/master.m3u8',duration:12});a.retryMissedReplays();await a.prepareReplay(item);assert.equal(a.S.sources.get(item.id).status,'ready');
 a.coverage.queue.length=0;a.S.sources.set(item.id,{status:'none',retryAt:0});a.S.at=item.at+1801;a.retryMissedReplays();assert.equal(item.status,'missed');assert.equal(item.unavailable,true);assert.equal(a.coverage.queue.length,0);
});
test('integration: an expired prepared source is renewed before a player is opened',async()=>{
 const a=app(),{item,clip}=liveReplay(a);a.S.liveClips=[clip];const pending=deferred();a.nfl.resolve=()=>pending.promise;
 a.S.sources.set(item.id,{status:'ready',key:'old',expiresAt:Date.now()-1});a.startHighlight(item.id);assert.equal(a.S.highlight,null);assert.equal(a.coverage.queue.length,1);assert.equal(a.S.sources.get(item.id).status,'pending');
 pending.resolve({url:'https://dcs-vod.mp.lura.live/vod/new.m3u8',expiresAt:Date.now()+240000});await new Promise(resolve=>setImmediate(resolve));assert.equal(a.S.sources.get(item.id).status,'ready');assert.notEqual(a.S.sources.get(item.id).key,'old');
});
test('integration: a publisher page remains available when inline playback is unavailable',async()=>{
 const a=app(),{item,clip}=liveReplay(a);a.S.liveClips=[{...clip,kind:'clip',gameId:'A',inlinePlayable:false,url:'https://www.espn.com/video/clip/_/id/123'}];
 await a.prepareReplay(item);a.render();assert.equal(item.status,'waiting');assert.match(a.el('scores').html,/Watch on ESPN/);assert.match(a.el('scores').html,/rel="noopener noreferrer"/);assert.match(a.el('scores').html,/opens a new tab/);
});
test('integration: an unmatched score offers the game page without claiming a matched highlight',async()=>{
 const a=app(),{item}=liveReplay(a);item.gameId='401234567';await a.prepareReplay(item);a.render();
 assert.match(a.el('scores').html,/Open game on ESPN/);assert.match(a.el('scores').html,/https:\/\/www.espn.com\/nfl\/game\/_\/gameId\/401234567/);assert.doesNotMatch(a.el('scores').html,/Watch on/);
});
test('integration: a two-second scoring clip can become visible and complete from media progress',async()=>{
 const a=app(undefined,{media:true}),{item,clip}=liveReplay(a);a.S.liveClips=[clip];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/short.m3u8',duration:2});
 await a.prepareReplay(item);a.startHighlight(item.id);a.updateHighlight(1000);assert.equal(a.S.highlight.playing,true);const p=a.pool.current;p.currentTime=2;a.time.now=3000;a.updateHighlight(3000);assert.equal(item.status,'replayed');assert.equal(a.S.usedClips.get(clip.id),item.id);
});
test('integration: ESPN polling retains descriptions and can prepare their game-specific clip',async()=>{
 const now=Date.now(),text='Jonathan Taylor 4 Yd Rush',event={id:'401',date:new Date(now-3600000).toISOString(),competitions:[{status:{type:{state:'in'}},competitors:[{homeAway:'away',team:{id:'11',abbreviation:'IND',displayName:'Indianapolis Colts'}},{homeAway:'home',team:{id:'16',abbreviation:'MIN',displayName:'Minnesota Vikings'}}]}]};
 const summary={drives:{previous:[{plays:[{id:'1',wallclock:new Date(now-60000).toISOString(),start:{team:{id:'11'}}}]}]},scoringPlays:[{id:'1',team:{id:'11'},text,scoringType:{name:'touchdown'}}],videos:[{id:'123',headline:'A big moment',description:'Jonathan Taylor scores a 4-yard touchdown.',duration:12,links:{source:{href:'https://espnmedia-cdn.akamaized.net/clip.mp4'}},timeRestrictions:{expirationDate:new Date(now+3600000).toISOString()}}]};
 const a=app(async u=>Response.json(String(u).includes('scoreboard')?{events:[event],season:{year:2026},week:{number:8}}:summary));ready(a);a.S.at=now/1000;await a.pollLive(0);
 assert.equal(a.S.live.games[0].season,2026);assert.equal(a.S.live.games[0].week,8);assert.equal(a.S.liveClips[0].description,summary.videos[0].description);assert.equal(a.S.liveClips[0].expiresAt,now+3600000);
 const score=a.S.live.scores.get('401')[0],source=await a.replaySource({id:score.id,gameId:'401',at:score.at,score});assert.equal(source.clipId,'clip:123');assert.equal(source.label,'ESPN highlight');
});
test('integration: an obsolete NFL catalog cannot populate another viewing mode',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);ready(a);const request=a.pollLiveClips(0);a.S.live.generation++;a.S.mode='replay';pending.resolve(Response.json({clips:[{id:'stale'}]}));await request;assert.equal(a.S.liveClips.length,0);
});
test('integration: switching highlights off clears waiting labels and pending retries',async()=>{
 const a=app(),{item}=liveReplay(a);await a.prepareReplay(item);a.el('optHighlights').checked=false;a.el('optHighlights').onchange();
 assert.equal(item.status,'skipped');assert.equal(a.S.sources.size,0);assert.equal(a.coverage.queue.length,0);a.render();assert.doesNotMatch(a.el('scores').html,/Waiting for replay/);
});
test('family: a partially entered private-league connection is validated instead of silently discarded',async()=>{
 let payload;const a=app(async(url,options)=>{payload=JSON.parse(options.body);return Response.json({error:'Paste both SWID and espn_s2, or leave both blank for a public league.'},{status:400});});
 a.el('leagueId').value='123';a.el('espnSwid').value='{12345678-1234-1234-1234-123456789012}';await a.importLeague();
 assert.equal(payload.swid,a.el('espnSwid').value);assert.equal(payload.s2,'');assert.match(a.el('leagueStatus').textContent,/Paste both SWID/);assert.equal(a.el('importLeague').disabled,false);
});
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
 const a=app();a.S.archive=new archive.ReplayArchive(archiveData);a.S.day=1;const start=a.S.archive.sessions[1].start;a.S.replayAt=start;a.clock.seek(start,0);a.S.at=Date.now()/1000;
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
 assert.equal(a.saved.teamName,'Sample lineup');assert.equal(a.el('scoreTeam').focused,true);assert.match(a.el('leagueStatus').textContent,/choose your team/);
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
test('viewing room: the first-visit replay shortcut enters replay without starting playback',async()=>{
 const a=app(async url=>Response.json(url==='/week7.json'?archiveData:String(url).includes('scoreboard')?{events:[]}:{clips:[]}));a.render();assert.equal(a.el('previewReplay').hidden,true);await a.init();assert.equal(a.el('previewReplay').hidden,false);
 await a.el('previewReplay').onclick();assert.equal(a.S.mode,'replay');assert.equal(a.S.playing,false);assert.equal(a.el('replayControls').hidden,false);assert.match(a.el('streamsHelp').textContent,/No stream links needed/);assert.equal(a.el('previewReplay').hidden,true);
});
test('viewing room: switching back to live hides replay-only settings and restores stream instructions',async()=>{
 const a=app();replayReady(a);await a.setMode('replay');a.saved.dataOnly=true;a.render();assert.equal(a.el('speedControl').hidden,false);
 await a.setMode('live');assert.equal(a.el('replayControls').hidden,true);assert.equal(a.el('speedControl').hidden,true);assert.equal(a.el('channelMode').textContent,'Live games');assert.match(a.el('streamsHelp').textContent,/player URL/);
});
test('viewing room: the fullscreen fallback has a working named exit',async()=>{
 const a=app();ready(a);await a.el('fullButton').onclick();assert.equal(a.el('fullButton').textContent,'Exit full screen');assert.equal(a.el('fullButton')['aria-label'],'Exit full screen');
 await a.el('fullButton').onclick();assert.equal(a.el('fullButton').textContent,'Full screen');
});
test('viewing room: selecting a game and returning to automatic switching have explicit labels',()=>{
 const a=app();ready(a);a.render();assert.match(a.el('games').html,/Jonathan Taylor/);assert.match(a.el('games').html,/Open the game tracker · add a stream for video/);
 a.el('games').onclick({target:{closest:()=>({dataset:{game:'A'}})}});assert.equal(a.S.pinned,'A');assert.equal(a.el('autoChip').textContent,'Your choice');assert.equal(a.el('resumeAuto').hidden,false);assert.match(a.el('games').html,/Your choice until a break · select again/);
 a.el('resumeAuto').onclick();assert.equal(a.S.pinned,null);assert.equal(a.el('autoChip').textContent,'Automatic');assert.equal(a.el('resumeAuto').hidden,true);
 a.S.cooldown.set('A',Infinity);a.render();assert.match(a.el('games').html,/<button[^>]* disabled>/);assert.match(a.el('games').html,/Try another stream for this game/);
});
test('saving an unchanged imported lineup retains its ESPN connection',()=>{
 const a=app();ready(a);a.saved.leagueId='123';a.saved.league={teams:[{id:'1',name:'My ESPN team',players:[player]}]};a.saved.teamId='1';
 a.el('lineupButton').onclick();a.el('saveRoster').onclick();assert.equal(a.saved.leagueId,'123');assert.equal(a.saved.teamId,'1');assert.equal(a.el('lineupDialog').open,false);
});
test('audit: pausing before a cut cannot start a hidden stream',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.com/a.mp4'};a.setPlaying(true);a.setPlaying(false);
 a.step(2000);assert.equal(a.pool.slots.size,0,'no player should open until the viewer resumes');
 a.setPlaying(true);a.step(3000);assert.equal(a.pool.visible,'A');assert.equal(a.pool.current.wantPlay,true);
});
test('audit: replacement stream reaches the screen on the next decision',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.com/old.mp4'};a.setPlaying(true);a.step(1000);const old=a.pool.current;
 const input=new Element();input.tag='input';input.dataset.key='IND-MIN';input.value='https://example.com/new.mp4';a.el('streamInputs').children=[input];a.el('saveStreams').onclick();a.step(2000);
 assert.equal(a.pool.current.source.url,input.value);assert.equal(old.destroyed,true);assert.equal(a.pool.current.wantPlay,true);
});
test('audit: saving a manual lineup cancels an in-flight league import through the UI',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);ready(a);a.el('leagueId').value='123';const importing=a.importLeague();
 a.el('manualRoster').value=roster.formatRoster([player]);
 const row=new Element();row.className='roster-entry';row.innerHTML='<input value="Jonathan Taylor"><input value="IND"><input value="RB">';a.el('rosterRows').children=[row];a.el('saveRoster').onclick();
 pending.resolve(Response.json({leagueId:'123',name:'Old league',ownedTeamId:'1',teams:[{id:'1',name:'Old team',players:[{name:'Joe Burrow',team:'CIN',position:'QB'}]}]}));await importing;
 assert.equal(a.saved.teamName,'My lineup');assert.equal(a.saved.leagueId,'');assert.equal(a.saved.roster[0].team,'IND');
});
test('audit: entering replay does not mark its future scores as intentionally skipped',async()=>{
 const a=app();ready(a);a.S.archive=new archive.ReplayArchive(archiveData);a.S.day=1;const day=a.S.archive.sessions[1];a.S.replayAt=day.start;a.clock.end=day.end;a.clock.seek(day.start,0);a.S.at=Date.now()/1000;
 await a.setMode('replay');a.advanceClock(2000);
 assert.equal(a.S.at,day.start,'the replay clock is correct in both revisions after a frame');
 const future=a.S.archive.games.filter(g=>day.gameIds.includes(g.id)).flatMap(g=>g.scores).filter(s=>s.at>day.start);
 assert.ok(future.length>0);assert.equal(future.filter(s=>a.coverage.judged.has(s.id)).length,0,'future scores must remain eligible for missed-score replays');
});
test('audit: unrelated or unavailable video links do not suppress a roster game tracker',()=>{
 const a=app();ready(a);const other={...game,id:'B',teams:[{abbr:'DAL'},{abbr:'NYG'}]};a.S.games.push(other);a.saved.streams={'DAL-NYG':'https://example.com/b.mp4'};
 assert.equal(a.excluded().has('A'),false,'a stream without a roster player cannot displace the tracker');
 a.useRoster([player,{name:'CeeDee Lamb',team:'DAL',position:'WR'}],{teamName:'My lineup'});a.S.cooldown.set('B',999999);
 assert.equal(a.excluded().has('A'),false,'a failed roster stream cannot displace the tracker');
 a.S.cooldown.clear();assert.equal(a.excluded().has('A'),true,'a playable roster stream still takes priority');
});
test('audit: a failed pinned stream waits for its cooldown before retrying',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.com/a.mp4'};a.setPlaying(true);a.S.pinned='A';a.S.cooldown.set('A',61000);a.step(1000);
 assert.equal(a.pool.slots.size,0);a.time.now=62000;a.step(62000);assert.equal(a.pool.visible,'A');
});
test('pause during highlight loading resumes the hidden clip and preserves its timeout',()=>{
 const a=app(undefined,{media:true});ready(a);a.setPlaying(true);
 const item={id:'score',gameId:'A',score:{text:'Taylor TD'}};a.coverage.queue.push(item);a.S.sources.set(item.id,{key:'hl:score',source:{url:'https://example.com/clip.mp4'},start:10,duration:30});a.startHighlight(item.id);
 const clip=a.pool.get('hl:score').player;clip.moving=false;a.setPlaying(false);a.time.now=61000;a.setPlaying(true);
 assert.equal(clip.wantPlay,true,'the loading clip is hidden, so resuming only the visible player is insufficient');
 clip.moving=true;a.step(61000);assert.equal(a.pool.visible,'hl:score');assert.equal(a.S.highlight.playing,true);assert.equal(a.S.highlight.done,false);
});
test('closing an ad player removes its exclusion and ignores late events from the retired player',()=>{
 const a=app(undefined,{media:true});ready(a);const old=a.pool.open('A',{url:'https://example.com/old.mp4'}).player;old.emit('ad',true);assert.equal(a.excluded().has('A'),true);
 a.pool.close('A');assert.equal(a.excluded().has('A'),false);
 const replacement=a.pool.open('A',{url:'https://example.com/new.mp4'}).player;old.emit('ad',true);old.emit('error',{message:'late old error'});
 assert.equal(a.excluded().has('A'),false);assert.equal(a.pool.get('A').player,replacement);
});
test('refreshing the same lineup preserves current playback and coverage',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.com/a.mp4'};a.setPlaying(true);a.step(1000);const video=a.pool.current;a.coverage.watch('A',998,1000);
 a.useRoster([player],{teamName:'Updated team name',teamId:'1'});
 assert.equal(a.pool.current,video);assert.equal(video.wantPlay,true);assert.equal(a.coverage.intervals.get('A').length,1);assert.equal(a.saved.teamName,'Updated team name');
});
test('a scoreboard outage does not suspend stalled-video recovery',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.com/a.mp4'};a.setPlaying(true);a.step(1000);const video=a.pool.current;video.moving=false;
 a.S.live.error='unavailable';a.S.live.fetched=Date.now()-60000;a.S.stall={since:1000,step:2};a.time.now=25000;a.step(25000);
 assert.equal(video.destroyed,true);assert.equal(a.S.cooldown.has('A'),true);
});
test('embed safety: reloading a stream preserves manual choice, lineup, coverage and the other player',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://ntv.st/embed/a'};a.selectGame('A');
 const p=a.pool.current;a.time.now=2000;p.element.emit('load');a.time.now=4000;assert.equal(p.progressing,true);
 const spare=a.pool.open('spare',{url:'https://ntv.st/embed/b',type:'embed/page'}).player;
 a.coverage.watch('A',998,1000);const lineup=JSON.stringify(a.saved),cuts=a.S.cuts,choice=a.S.selection;
 a.S.stall={since:0,step:2};a.render();assert.equal(a.el('reloadStream').hidden,false);a.el('reloadStream').onclick();
 assert.equal(a.pool.current,p);assert.equal(p.loadedAt,null);assert.equal(a.S.stall,null);assert.equal(a.S.pinned,'A');assert.equal(a.S.selection,choice);assert.equal(a.S.cuts,cuts);
 assert.equal(JSON.stringify(a.saved),lineup);assert.equal(a.coverage.intervals.get('A').length,1);assert.equal(a.pool.get('spare').player,spare);assert.equal(spare.element.src,undefined);
 a.setPlaying(false);a.render();assert.equal(a.el('reloadStream').disabled,true);a.el('reloadStream').onclick();assert.equal(p.element.src,'about:blank');assert.equal(a.S.playing,false);
});
test('embed safety: repeated switches unload the outgoing page and retain the sandbox on return',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);
 const other={...game,id:'B',teams:[{abbr:'SEA'},{abbr:'SF'}]};a.S.games.push(other);a.S.live.games.push(other);a.S.live.feed.push(a.S.games,970);
 a.saved.streams={'IND-MIN':'https://ntv.st/embed/a','SEA-SF':'https://ntv.st/embed/b'};
 for(let i=0;i<16;i++){
  const id=i%2?'B':'A';a.selectGame(id);const current=a.pool.current;assert.equal(a.pool.visible,id,`switch ${i}: the new page must get its own load/recovery window`);assert.match(current.element.sandbox,/allow-scripts/);assert.equal(current.element.sandbox.includes('allow-popups'),false);
  for(const slot of a.pool.slots.values())if(slot.key!==id)assert.ok(!slot.player.element.src||slot.player.element.src==='about:blank');
  current.element.emit('load');a.time.now+=2000;assert.equal(current.progressing,true);
 }
});
test('embed recovery: a page that never loads retains the selected game through a long outage',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);const other={...game,id:'B',teams:[{abbr:'SEA'},{abbr:'SF'}]};
 a.useRoster([player,{name:'Other starter',team:'SEA',position:'WR'}],{teamName:'Two games'});a.S.games=[game,other];a.S.live.games=a.S.games;a.S.live.feed.push(a.S.games,970);
 a.saved.streams={'IND-MIN':'https://ntv.st/embed/a','SEA-SF':'https://example.test/b.mp4'};a.selectGame('A');const p=a.pool.current;
 for(const now of [16000,36000,66000,...Array.from({length:180},(_,i)=>126000+i*60000)]){
  a.time.now=now;a.step(now);assert.equal(a.pool.visible,'A','keep reconnecting the selected game');assert.equal(a.pool.current,p);
  assert.equal(a.S.cooldown.size,0);assert.equal(a.S.pinned,'A');assert.equal(a.S.started,true);assert.equal(a.S.playing,true);assert.equal(p.destroyed,false);
 }
 assert.equal(p.element.navigations.length,184);p.element.emit('load');a.time.now+=2000;a.step(a.time.now);assert.equal(p.progressing,true);assert.equal(a.pool.visible,'A');
});
test('embed safety: reload is unavailable for direct video and highlights',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.selectGame('A');a.render();assert.equal(a.el('reloadStream').hidden,true);
 const p=a.pool.current;a.el('reloadStream').onclick();assert.equal(a.pool.current,p);assert.equal(p.wantPlay,true);
});
test('embed recovery: the real app reconnects a loaded but unobservable stream without losing the manual choice',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.autoReconnect=true;a.saved.streams={'IND-MIN':'https://ntv.st/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 const choice=a.S.selection,lineup=JSON.stringify(a.saved),cuts=a.S.cuts;
 a.time.now=120999;a.step(a.time.now);assert.equal(p.element.navigations.length,1);
 a.time.now=121000;a.step(a.time.now);a.render();assert.equal(p.element.navigations.length,2);assert.match(a.el('pictureNote').textContent,/Refreshing stream connection/);
 assert.equal(a.pool.current,p);assert.equal(a.S.pinned,'A');assert.equal(a.S.selection,choice);assert.equal(a.S.cuts,cuts);assert.equal(JSON.stringify(a.saved),lineup);assert.equal(a.S.cooldown.size,0);assert.equal(a.coverage.intervals.size,0);
 p.element.emit('load');a.time.now=123000;a.step(a.time.now);assert.equal(p.progressing,true);assert.equal(a.S.pinned,'A');
});
test('embed recovery: Pause and hidden tabs suppress reconnects and resume gets a fresh deadline',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://ntv.st/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 a.setPlaying(false);const paused=p.element.navigations.length;a.time.now=1000000;a.step(a.time.now);assert.equal(p.element.navigations.length,paused);assert.equal(p.element.src,'about:blank');
 a.setPlaying(true);p.element.emit('load');a.step(a.time.now);assert.equal(p.element.navigations.length,paused+1);
 a.page.hidden=true;a.time.now+=1000;a.step(a.time.now);const hidden=p.element.navigations.length;a.time.now+=600000;a.step(a.time.now);assert.equal(p.element.navigations.length,hidden);
 a.page.hidden=false;a.step(a.time.now);assert.equal(p.element.navigations.length,hidden,'no burst of overdue refreshes');
});
test('embed recovery: network loss waits without exhausting retries and reconnects on restoration',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://ntv.st/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 a.network.onLine=false;a.time.now=2000;a.step(a.time.now);a.time.now=302000;a.step(a.time.now);assert.equal(p.element.navigations.length,1);assert.equal(a.S.cooldown.size,0);
 a.network.onLine=true;a.step(a.time.now);assert.equal(p.element.navigations.length,2);assert.equal(a.S.pinned,'A');assert.match(p.recoveryMessage,/Connection restored/);
});
test('embed recovery: the saved setting updates existing and newly opened players without an immediate reload',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://ntv.st/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 a.el('optReconnect').onchange({target:{checked:false}});assert.equal(a.saved.autoReconnect,false);assert.equal(p.autoReconnect,false);assert.equal(JSON.parse(a.storage.get('fantasy-stream-v3')).autoReconnect,false);
 a.time.now=500000;a.step(a.time.now);assert.equal(p.element.navigations.length,1);
 a.pool.close('A');a.S.program={kind:'standby'};a.selectGame('A');const replacement=a.pool.current;assert.equal(replacement.autoReconnect,false);replacement.element.emit('load');
 a.el('optReconnect').onchange({target:{checked:true}});a.step(a.time.now);assert.equal(replacement.element.navigations.length,1);a.time.now+=120000;a.step(a.time.now);assert.equal(replacement.element.navigations.length,2);
});
function embeddedGame(){const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://ntv.st/embed?t=a'};a.selectGame('A');return a;}
function nativeFullscreen(a){
 a.stage.requestFullscreen=async()=>{a.page.fullscreenElement=a.stage;a.emitPage('fullscreenchange');};
 a.page.exitFullscreen=async()=>{a.page.fullscreenElement=null;a.emitPage('fullscreenchange');};
}
test('embed fullscreen: outer fullscreen and yellow Pause survive periodic and repeated loading retries',async()=>{
 const a=embeddedGame(),p=a.pool.current;nativeFullscreen(a);p.element.emit('load');await a.el('fullButton').onclick();
 assert.equal(a.page.fullscreenElement,a.stage);
 for(const now of [121000,136000,156000,186000,246000,306000]){
  a.time.now=now;a.step(now);assert.equal(a.page.fullscreenElement,a.stage);assert.equal(a.stage.classList.contains('theater'),false);assert.equal(a.pool.current,p);assert.equal(a.el('playButton').textContent,'Pause');
 }
 a.el('playButton').onclick();const paused=p.element.navigations.length;a.time.now=1000000;a.step(a.time.now);
 assert.equal(a.S.playing,false);assert.equal(p.element.navigations.length,paused);assert.equal(p.element.src,'about:blank');assert.equal(a.page.fullscreenElement,a.stage);
});
test('embed fullscreen: browser fullscreen exit after a reconnect stays exited while playback continues',async()=>{
 const a=embeddedGame();nativeFullscreen(a);a.pool.current.element.emit('load');await a.el('fullButton').onclick();
 a.time.now=121000;a.step(a.time.now);await a.page.exitFullscreen();
 assert.equal(a.stage.classList.contains('theater'),false);assert.equal(a.S.fullscreenWanted,false);assert.equal(a.S.playing,true);
 a.time.now=136000;a.step(a.time.now);assert.equal(a.page.fullscreenElement,null);assert.equal(a.stage.classList.contains('theater'),false);
});
test('embed fullscreen: theater fallback remains open through failures and Escape prevents re-entry',async()=>{
 const a=embeddedGame();await a.el('fullButton').onclick();
 for(const now of [16000,36000,66000,126000,186000]){a.time.now=now;a.step(now);assert.equal(a.stage.classList.contains('theater'),true);assert.equal(a.pool.visible,'A');}
 a.emitPage('keydown',{key:'Escape'});assert.equal(a.stage.classList.contains('theater'),false);assert.equal(a.el('fullButton').focused,true);
 a.time.now=246000;a.step(a.time.now);assert.equal(a.stage.classList.contains('theater'),false);assert.equal(a.S.playing,true);
});
test('embed fullscreen: legacy nested fullscreen gets a parent fallback before its document reloads',async()=>{
 const a=embeddedGame(),p=a.pool.current;p.setAutoReconnect(true);a.page.fullscreenElement=p.element;a.emitPage('fullscreenchange');p.element.emit('load');
 a.frameEvents.onNavigate=()=>{assert.equal(a.stage.classList.contains('theater'),true,'fallback exists before the old document disappears');a.page.fullscreenElement=null;a.emitPage('fullscreenchange');};
 a.time.now=121000;a.step(a.time.now);assert.equal(a.stage.classList.contains('theater'),true);assert.equal(a.el('fullButton').textContent,'Exit full screen');
 a.frameEvents.onNavigate=null;await a.el('fullButton').onclick();a.time.now=136000;a.step(a.time.now);assert.equal(a.stage.classList.contains('theater'),false);assert.equal(a.S.playing,true);
});
test('embed fullscreen: late failure or success of a fullscreen request cannot undo an explicit exit',async()=>{
 for(const outcome of ['failure','success','late-success']){
  const a=embeddedGame(),pending=deferred();nativeFullscreen(a);a.stage.requestFullscreen=()=>pending.promise;
  const entering=a.el('fullButton').onclick();assert.equal(a.stage.classList.contains('theater'),true,'show the fallback while permission is unresolved');
  if(outcome==='late-success'){[...a.timers.values()].find(t=>t.delay===800).fn();await entering;}
  await a.el('fullButton').onclick();assert.equal(a.stage.classList.contains('theater'),false);
  if(outcome!=='failure'){a.page.fullscreenElement=a.stage;a.emitPage('fullscreenchange');}
  pending.resolve();await entering;await flush();
  assert.equal(!!a.page.fullscreenElement,false);assert.equal(a.stage.classList.contains('theater'),false);assert.equal(a.S.fullscreenWanted,false);
 }
});
test('embed fullscreen: stale reconnect events from a retired player cannot change the new view',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/one.mp4'};a.selectGame('A');const old=a.pool.current;
 a.pool.close('A');a.selectGame('A');a.page.fullscreenElement=old.element;old.emit('reconnect');
 assert.equal(a.stage.classList.contains('theater'),false);assert.notEqual(a.pool.current,old);
});
test('site recovery: failed pages rotate same-game backups across arbitrary hosts without losing fullscreen or selection',async()=>{
 for(const host of ['streamcorner.st','ntv.st','sports.example']){
  const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':`https://${host}/embed/game`};a.saved.streamBackups={'IND-MIN':'https://backup.example/embed/game'};a.selectGame('A');nativeFullscreen(a);await a.el('fullButton').onclick();
  const selection=a.S.selection,cuts=a.S.cuts;let last=a.pool.current,changes=0;
  for(let now=1000;now<=600000;now+=250){
   a.time.now=now;a.step(now);assert.equal(a.pool.visible,'A');assert.equal(a.S.pinned,'A');assert.equal(a.S.selection,selection);assert.equal(a.S.cuts,cuts);assert.equal(a.S.cooldown.size,0);assert.equal(a.page.fullscreenElement,a.stage);
   if(a.pool.current!==last){assert.equal(last.destroyed,true);assert.equal(last.element.src,'about:blank');last=a.pool.current;changes++;}
  }
  assert.equal(changes,9,'rotate only after spaced failed loads, not every tick');a.el('playButton').onclick();const p=a.pool.current,count=p.element.navigations.length;a.time.now+=600000;a.step(a.time.now);assert.equal(p.element.navigations.length,count);assert.equal(a.S.playing,false);
 }
});
test('site recovery: scheduled refresh does not rotate an unobservable loaded page to another source',()=>{
 const a=embeddedGame(),p=a.pool.current;a.saved.streamBackups={'IND-MIN':'https://backup.example/embed/game'};p.element.emit('load');a.time.now=121000;a.step(a.time.now);
 assert.equal(a.pool.current,p);assert.equal(p.destroyed,false);p.element.emit('load');a.time.now=123000;a.step(a.time.now);assert.equal(a.pool.current,p);assert.equal(a.S.streamChoices.size,0);
});
test('site recovery: manual backup switches retain lineup, coverage and selection and obey Pause',()=>{
 const a=embeddedGame();a.saved.streamBackups={'IND-MIN':'https://backup.example/embed/game'};a.coverage.watch('A',998,1000);const selection=a.S.selection,roster=JSON.stringify(a.saved.roster),first=a.pool.current;a.render();
 assert.equal(a.el('nextStream').hidden,false);a.el('nextStream').onclick();assert.equal(first.destroyed,true);assert.equal(a.pool.get('A').url,a.saved.streamBackups['IND-MIN']);assert.equal(a.el('nextStream').textContent,'Try primary');assert.equal(a.S.selection,selection);assert.equal(JSON.stringify(a.saved.roster),roster);assert.equal(a.coverage.intervals.get('A').length,1);
 a.setPlaying(false);const paused=a.pool.current;a.el('nextStream').onclick();assert.equal(a.pool.current,paused);assert.equal(a.el('nextStream').disabled,true);
});
async function nativeGame({backup=false}={}){
 const a=app(undefined,{media:true,native:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://video.example/live.m3u8'};if(backup)a.saved.streamBackups={'IND-MIN':'https://streamcorner.st/embed/test'};a.selectGame('A');const p=a.pool.get('A').player;await p.ready;p.element.currentTime=1;p.element.emit('timeupdate');a.step(a.time.now);return {a,p};
}
test('site recovery: a direct live error retries the same player without dropping the game to standby',async()=>{
 const {a,p}=await nativeGame();nativeFullscreen(a);await a.el('fullButton').onclick();p.element.error={code:2};p.element.emit('error');assert.equal(a.pool.current,p);assert.equal(a.S.cooldown.size,0);
 a.time.now=4000;a.step(a.time.now);await p.ready;assert.equal(p.recoveryAttempts,1);assert.equal(a.pool.current,p);assert.equal(a.S.pinned,'A');assert.equal(a.S.program.kind,'game');assert.equal(a.page.fullscreenElement,a.stage);assert.equal(a.el('reloadStream').hidden,false);
 p.element.error=null;p.element.currentTime=2;p.element.emit('timeupdate');a.time.now=4250;a.step(a.time.now);assert.equal(p.progressing,true);assert.equal(a.S.playing,true);
});
test('site recovery: a live ending can fall back from direct HLS to a page without changing games',async()=>{
 const {a,p}=await nativeGame({backup:true});p.element.emit('ended');assert.equal(a.S.pinned,'A');assert.equal(a.S.cooldown.size,0);
 a.time.now=4000;a.step(a.time.now);assert.equal(p.destroyed,true);assert.equal(a.pool.current.kind,'embed');assert.equal(a.pool.visible,'A');assert.equal(a.S.pinned,'A');assert.equal(a.pool.get('A').url,a.saved.streamBackups['IND-MIN']);
 p.element.error={code:2};p.element.emit('error');assert.equal(a.S.cooldown.size,0,'retired callbacks cannot discard the backup');
});
test('site recovery: a direct source that never starts keeps recovering instead of exhausting the pending load limit',async()=>{
 const a=app(undefined,{media:true,native:true});ready(a);a.saved.streams={'IND-MIN':'https://video.example/live.m3u8'};a.selectGame('A');const p=a.pool.get('A').player;await p.ready;
 for(let now=1000;now<=300000;now+=250){a.time.now=now;a.step(now);await p.ready;assert.equal(p.destroyed,false);assert.equal(a.S.pinned,'A');assert.equal(a.S.cooldown.size,0);}
 assert.equal(a.pool.visible,'A');assert.ok(p.recoveryAttempts>=6);assert.equal(a.S.playing,true);
});
test('site recovery: saving a backup does not reload the healthy primary and both links survive storage',async()=>{
 const a=embeddedGame(),p=a.pool.current;a.render();const fields=a.el('streamInputs').querySelectorAll('input'),backup=fields.find(i=>i.dataset.backup==='true');assert.ok(backup);
 backup.value='https://backup.example/watch';await a.el('saveStreams').onclick();assert.equal(a.pool.current,p);assert.equal(p.destroyed,false);assert.equal(a.saved.streamBackups['IND-MIN'],backup.value);assert.equal(a.saved.streams['IND-MIN'],p.url);
 const stored=JSON.parse(a.storage.get('fantasy-stream-v3'));assert.equal(stored.streamBackups['IND-MIN'],backup.value);assert.equal(a.el('nextStream').hidden,false);
});
test('site recovery: a long sleep during initial direct loading still reveals the player for interaction',async()=>{
 const a=app(undefined,{media:true,native:true});ready(a);a.saved.streams={'IND-MIN':'https://video.example/live.m3u8'};a.selectGame('A');const p=a.pool.get('A').player;await p.ready;
 a.time.now=61000;a.step(a.time.now);assert.equal(a.pool.current,p);assert.equal(a.pool.visible,'A');assert.equal(a.S.program.kind,'game');assert.equal(a.S.pinned,'A');assert.equal(a.S.cooldown.size,0);
});
test('site recovery: a failed homepage extraction preserves the explicit URL as a page fallback',async()=>{
 const a=embeddedGame(),field=a.el('streamInputs').querySelectorAll('input').find(i=>!i.dataset.backup);field.value='https://streamcorner.st/';await a.el('saveStreams').onclick();
 assert.equal(a.streamFinder.resolved.get(field.value).kind,'page');assert.equal(a.streamFinder.playable(field.value),field.value);assert.equal(a.saved.streams['IND-MIN'],field.value);
});
test('site recovery: duplicate and absent backups never create an automatic source-switch loop',()=>{
 const a=embeddedGame(),p=a.pool.current;a.saved.streamBackups={'IND-MIN':p.url};a.render();assert.equal(a.el('nextStream').hidden,true);a.el('nextStream').onclick();assert.equal(a.pool.current,p);
 for(const now of [16000,36000,66000,126000]){a.time.now=now;a.step(now);}assert.equal(a.pool.current,p);assert.equal(p.destroyed,false);
});
test('embed switching: returning to older slots retires the outgoing context before opening the next site',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);const other={...game,id:'B',teams:[{abbr:'SEA'},{abbr:'SF'}]};a.S.games.push(other);a.S.live.games.push(other);a.S.live.feed.push(a.S.games,970);
 a.saved.streams={'IND-MIN':'https://streamcorner.st/embed/a','SEA-SF':'https://streamcorner.st/embed/b'};a.saved.autoReconnect=false;
 let outgoing=null,previousPlayer=null;
 a.frameEvents.onNavigate=url=>{if(url!=='about:blank'&&outgoing)assert.equal(outgoing.removed,true,'the old browsing context must be detached before the new source begins');};
 for(let i=0;i<100;i++){
  a.selectGame(i%2?'B':'A');const p=a.pool.current;
  if(previousPlayer){assert.equal(previousPlayer.loadedAt,null);outgoing.emit('load');assert.equal(previousPlayer.loadedAt,null);}
  assert.equal(a.el('layers').children.filter(f=>f.src&&f.src!=='about:blank').length,1);
  assert.equal(p.element.parentNode,a.el('layers'));assert.equal(p.element.classList.contains('on'),true);assert.equal(p.element.tabIndex,0);assert.equal(p.element['aria-hidden'],'false');
  p.element.emit('load');a.time.now+=2000;assert.equal(p.progressing,true);outgoing=p.element;previousPlayer=p;
 }
 a.frameEvents.onNavigate=null;
});
test('embed switching: selecting the same loaded game does not replace its frame or restart its page',()=>{
 const a=embeddedGame(),p=a.pool.current,frame=p.element;frame.emit('load');a.time.now+=2000;
 for(let i=0;i<10;i++){a.selectGame('A');a.pool.show('A');}
 assert.equal(p.element,frame);assert.equal(frame.removed,undefined);assert.equal(p.loadedAt,1000);assert.equal(a.pool.current,p);
});
test('choosing a franchise cancels an older import of another league',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);ready(a);a.saved.leagueId='111';a.saved.league={teams:[{id:'1',name:'Chosen team',players:[player]}]};a.el('leagueId').value='222';const importing=a.importLeague();
 a.el('scoreTeam').onchange({target:{value:'1'}});pending.resolve(Response.json({leagueId:'222',ownedTeamId:'1',teams:[{id:'1',name:'Wrong team',players:[{name:'Joe Burrow',team:'CIN',position:'QB'}]}]}));await importing;
 assert.equal(a.saved.leagueId,'111');assert.equal(a.saved.teamName,'Chosen team');assert.equal(a.el('importLeague').disabled,false);
});
test('a team ID from another league cannot automatically select a different owner’s roster',async()=>{
 const a=app(async()=>Response.json({leagueId:'222',name:'New league',teams:[{id:'1',name:'Not my team',players:[{name:'Joe Burrow',team:'CIN',position:'QB'}]}]}));ready(a);a.saved.leagueId='111';a.saved.teamId='1';a.el('leagueId').value='222';await a.importLeague();
 assert.equal(a.saved.teamName,'My lineup');assert.equal(a.saved.teamId,'');assert.equal(a.saved.roster[0].team,'IND');assert.equal(a.el('scoreTeam').focused,true);
});
test('the newest league import wins when responses arrive in reverse order',async()=>{
 const first=deferred(),second=deferred();let calls=0;const a=app(()=>++calls===1?first.promise:second.promise);ready(a);
 a.el('leagueId').value='111';const p1=a.importLeague();a.el('leagueId').value='222';const p2=a.importLeague();
 const league=(id,name)=>({leagueId:id,name,ownedTeamId:'1',teams:[{id:'1',name,players:[player]}]});
 second.resolve(Response.json(league('222','New team')));await p2;first.resolve(Response.json(league('111','Old team')));await p1;
 assert.equal(a.saved.leagueId,'222');assert.equal(a.saved.teamName,'New team');assert.equal(a.el('importLeague').disabled,false);
});
test('an obsolete highlight lookup cannot replace the newer source for the same score',async()=>{
 const a=app();ready(a);const pending=deferred();a.nfl.resolve=()=>pending.promise;
 const item={id:'score',gameId:'A',score:{kind:'TD',text:'Jonathan Taylor touchdown',players:[{name:'Jonathan Taylor',role:'scorer'}]}};
 a.S.liveClips=[{id:'clip',gameId:'A',title:'Jonathan Taylor touchdown',athletes:['Jonathan Taylor']}];const lookup=a.prepareReplay(item);
 const current={status:'ready',key:'new-source'};a.S.sources.clear();a.S.sources.set(item.id,current);pending.resolve({url:'https://example.com/old.m3u8',duration:30});await lookup;
 assert.equal(a.S.sources.get(item.id),current);
});
function replayReady(a){ready(a);a.S.archive=new archive.ReplayArchive(archiveData);a.S.day=1;const day=a.S.archive.sessions[1];a.clock.end=day.end;a.clock.seek(day.start,0);return day;}
test('release: the real app completes the Sunday slate with manual cuts, ads, pauses and broadcast highlights',async t=>{
 const a=app(undefined,{media:true}),day=replayReady(a);a.S.mode='replay';a.useRoster(roster.SAMPLE,{teamName:'Sunday rehearsal'});a.saved.muted=false;
 const teams=director.rosterTeams(a.roster()),games=a.S.archive.games.filter(g=>day.gameIds.includes(g.id)&&g.teams.some(t=>teams.has(scoring.alias(t.abbreviation))));assert.ok(games.length>=7);
 const end=Math.max(...games.map(g=>g.end))+30;a.seekTo(Math.min(...games.map(g=>g.start)));a.setPlaying(true);a.step(a.time.now);
 let frames=0,choices=0,ads=0,pauses=0;const highlights=new Set(),shown=new Set();
 while(a.S.at<end&&frames<60000){
  frames++;a.time.now+=500;
  for(const slot of a.pool.slots.values()){
   // The provider boundary advances when asked and lands seeks immediately.
   // Actual browser decoding and provider latency are covered separately.
   slot.player.kind='provider';if(slot.player.progressing)slot.player.currentTime+=.5;
  }
  a.advanceClock(a.time.now);a.step(a.time.now);
  if(frames%20===0)await flush();
  if(frames%2000===0){
   const next=a.S.games.find(g=>g.state==='in'&&g.id!==a.pool.visible&&!a.excluded().has(g.id));
   if(next){a.selectGame(next.id);choices++;assert.equal(a.S.pinned,next.id);assert.equal(a.S.pending?.id||a.pool.visible,next.id);}
  }
  if(frames%4500===0&&a.S.program.kind==='game'&&a.pool.current){
   const p=a.pool.current;p.emit('ad',true);assert.equal(a.pool.visible,null);assert.equal(p.muted,true);a.step(a.time.now);p.emit('ad',false);ads++;
  }
  if(frames%5000===0){
   a.setPlaying(false);const at=a.S.at;a.time.now+=30000;a.advanceClock(a.time.now);assert.equal(a.S.at,at);a.setPlaying(true);pauses++;
  }
  assert.ok(a.pool.slots.size<=3,'bounded player pool');
  const audible=[...a.pool.slots.values()].filter(slot=>!slot.player.muted);
  assert.ok(audible.length<=1,'at most one audible player');if(audible.length)assert.equal(audible[0].key,a.pool.visible);
  if(a.pool.visible){assert.equal(a.excluded().has(a.pool.visible),false,'a known commercial cannot be on screen');shown.add(a.pool.visible);}
  for(const entry of a.coverage.log)if(entry.status==='replayed')highlights.add(entry.id);
 }
 assert.ok(a.S.at>=end,'the complete roster slate must finish without a playback deadlock');
 assert.ok(choices>2&&ads>0&&pauses>0);assert.ok(highlights.size>1,'missed scores finish their broadcast highlights');
 t.diagnostic(JSON.stringify({frames,simulatedPlaybackSeconds:frames/2,manualChoices:choices,providerAds:ads,pauses,completedHighlights:highlights.size,distinctPictures:shown.size}));
});
test('family: first replay visit starts near the selected lineup’s first action',async()=>{
 const a=app(),day=replayReady(a);await a.setMode('replay');const mine=a.S.archive.games.find(g=>day.gameIds.includes(g.id)&&g.teams.some(t=>t.abbreviation==='IND'));
 assert.ok(a.S.at>=mine.start-60,'do not make a newcomer wait through unrelated morning games');assert.ok(a.S.at<mine.start+900);
});
test('family: historical lineup changes cannot replace the live lineup in storage or on return',async()=>{
 const a=app();replayReady(a);await a.setMode('replay');a.useRoster([{name:'Joe Burrow',team:'CIN',position:'QB'}],{teamName:'Week 7 team'});
 const stored=JSON.parse(a.storage.get('fantasy-stream-v3'));assert.equal(stored.roster[0].team,'IND');assert.equal(stored.teamName,'My lineup');
 await a.setMode('live');assert.equal(a.saved.roster[0].team,'IND');assert.equal(a.saved.teamName,'My lineup');
 await a.setMode('replay');assert.equal(a.saved.teamName,'Week 7 team','replay edits survive a mode round trip in this session');
});
test('family: changing replay days releases the previous day’s player and pin',()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.S.day=0;const old=a.S.archive.games.find(g=>a.S.archive.sessions[0].gameIds.includes(g.id));
 a.S.started=true;a.S.playing=true;a.S.program={kind:'game',id:old.id};a.S.pinned=old.id;a.pool.open(old.id,{url:'https://example.com/old.mp4'});a.pool.show(old.id);a.setDay(1);
 assert.equal(a.pool.slots.size,0);assert.equal(a.S.pinned,null);assert.notEqual(a.S.program.id,old.id);const at=a.S.at;a.advanceClock(1000);assert.ok(a.S.at>=at&&a.S.at<a.S.archive.sessions[1].end);
});
test('family: data-only highlights never resolve or load a video clip',async()=>{
 const a=app();replayReady(a);a.S.mode='replay';a.saved.dataOnly=true;
 const item={id:'score',gameId:'A',score:{kind:'TD',text:'Jonathan Taylor touchdown',players:[{name:'Jonathan Taylor',role:'scorer'}]}};
 a.S.clips=[{id:'clip',gameId:'A',title:'Jonathan Taylor touchdown',athletes:['Jonathan Taylor'],mediaUrl:'https://example.com/clip.mp4'}];
 assert.equal((await a.replaySource(item)).data,true);
});
test('family: changing picture mode cancels the active highlight and invalidates prepared sources',()=>{
 const a=app();replayReady(a);a.S.mode='replay';a.S.started=true;a.S.program={kind:'highlight',id:'score'};a.S.highlight={item:{id:'score',gameId:'A'},src:{key:'hl:score'},playing:true};a.S.sources.set('score',{status:'ready'});
 a.el('optDefense').checked=true;a.el('optHighlights').checked=true;a.el('optData').checked=true;a.el('optData').onchange();
 assert.equal(a.S.highlight,null);assert.equal(a.S.sources.size,0);assert.equal(a.S.program.kind,'standby');
});
test('family: turning off missed-score replays closes the active highlight and clears its queue',()=>{
 const a=app();ready(a);a.S.started=true;a.S.highlight={item:{id:'score',gameId:'A'},src:{key:'hl:score'},playing:true};a.S.program={kind:'highlight',id:'score'};a.coverage.queue.push({id:'next'});
 a.el('optDefense').checked=true;a.el('optHighlights').checked=false;a.el('optData').checked=false;a.el('optHighlights').onchange();
 assert.equal(a.S.highlight,null);assert.equal(a.coverage.queue.length,0);assert.equal(a.S.program.kind,'standby');
});
test('family: loading and failed streams do not say that the day’s games are finished',()=>{
 const a=app();ready(a);a.S.started=true;a.S.playing=true;a.S.program={kind:'standby'};a.S.pending={id:'A',since:1000};a.render();assert.match(a.el('ovTitle').innerHTML,/Opening/);
 a.S.pending=null;a.S.cooldown.set('A',61000);a.render();assert.match(a.el('ovTitle').innerHTML,/video.*unavailable/i);assert.equal(a.el('ovButton').dataset.action,'retry');
});
test('family: malformed saved preferences recover without breaking the live screen',()=>{
 const a=app(undefined,{stored:{roster:[player],teamName:'My lineup',streams:null,marks:null,league:{teams:'bad'},delay:'oops'}});
 assert.doesNotThrow(()=>ready(a));assert.doesNotThrow(()=>a.render());assert.equal(a.saved.delay,30);assert.equal(a.saved.league,null);assert.deepEqual(Object.keys(a.saved.streams),[]);
});
test('family: rewinding before the visible game releases that player instead of following its later clock',()=>{
 const a=app(undefined,{media:true}),day=replayReady(a);a.S.mode='replay';const mine=a.S.archive.games.find(g=>day.gameIds.includes(g.id)&&g.teams.some(t=>t.abbreviation==='IND'));
 a.S.started=true;a.S.playing=true;a.S.program={kind:'game',id:mine.id};a.pool.open(mine.id,{url:'https://example.com/replay.mp4'});a.pool.show(mine.id);a.seekTo(day.start);
 assert.equal(a.pool.visible,null);assert.equal(a.S.program.kind,'standby');assert.equal(a.S.at,day.start);
});
test('family: video settings changed in live mode do not interrupt live playback',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.com/a.mp4'};a.setPlaying(true);a.step(1000);const video=a.pool.current;
 a.el('optDefense').checked=true;a.el('optHighlights').checked=true;a.el('optData').checked=true;a.el('optData').onchange();assert.equal(a.pool.current,video);
});
test('family: unsaved stream text survives a live/replay round trip',async()=>{
 const a=app();replayReady(a);a.render();const field=a.el('streamInputs').querySelectorAll('input')[0];field.value='https://example.com/unsaved.mp4';await a.setMode('replay');await a.setMode('live');
 a.S.live.games=[game];a.render();assert.equal(a.el('streamInputs').querySelectorAll('input')[0].value,field.value);assert.equal(a.saved.streams['IND-MIN'],undefined);
});
test('family: a slow stream exposed for a Play click still times out if it never starts',()=>{
 const a=app(undefined,{media:true});ready(a);const url='https://example.com/slow.mp4';a.saved.streams={'IND-MIN':url};a.pool.open('A',{url}).player.moving=false;a.setPlaying(true);a.step(1000);
 a.time.now=10000;a.step(10000);assert.equal(a.pool.visible,'A');assert.ok(a.S.pending,'showing a player is not proof that it started');
 a.time.now=22000;a.step(22000);assert.equal(a.pool.visible,null);assert.equal(a.S.cooldown.has('A'),true);
});
test('family: slow-stream confirmation commits a cut exactly once',()=>{
 const a=app(undefined,{media:true});ready(a);const url='https://example.com/slow.mp4';a.saved.streams={'IND-MIN':url};const video=a.pool.open('A',{url}).player;video.moving=false;a.setPlaying(true);a.step(1000);
 a.time.now=10000;a.step(10000);video.moving=true;a.S.at=1001;a.step(11000);assert.equal(a.S.pending,null);assert.equal(a.S.cuts,1);assert.equal(a.director.lastCut,1001);a.step(12000);assert.equal(a.S.cuts,1);
});
test('family: live coverage does not count a long gap as watched after a fast replay',()=>{
 const a=app();ready(a);a.S.started=true;a.S.playing=true;a.S.program={kind:'game',id:'A'};a.S.lastAt=990;a.S.at=1000;a.clock.rate=60;a.step(1000);assert.equal(a.coverage.intervals.size,0);
});
test('family: unavailable browser storage is visible while the lineup remains usable for this session',()=>{
 const a=app(undefined,{storageBlocked:true});ready(a);assert.equal(a.saved.roster[0].team,'IND');assert.equal(a.el('storageNotice').hidden,false);assert.doesNotThrow(()=>a.setPlaying(true));
});

test('logic: abandoning a pending switch clears it and a later attempt gets a fresh deadline',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.com/a.mp4'};a.setPlaying(true);a.step(1000);
 a.S.pending={id:'B',since:1000};a.cutTo('A',19000);assert.equal(a.S.pending,null);assert.equal(a.pool.visible,'A');
 const b={...game,id:'B',name:'DAL @ NYG',teams:[{abbr:'DAL'},{abbr:'NYG'}]};a.S.games.push(b);a.saved.streams['DAL-NYG']='https://example.com/b.mp4';const p=a.pool.open('B',{url:a.saved.streams['DAL-NYG']}).player;p.moving=false;
 a.time.now=25000;a.cutTo('B',25000);assert.equal(a.S.pending.since,25000);assert.equal(a.S.cooldown.has('B'),false);
});
test('logic: an unanswered seek on the visible replay recovers or times out',()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';const mine=a.S.archive.games.find(g=>g.teams.some(t=>t.abbreviation==='IND'));
 a.S.at=mine.start+300;a.S.games=a.S.archive.sample(a.S.at);a.S.program={kind:'game',id:mine.id};a.setPlaying(true);const p=a.pool.open(mine.id,{url:mine.embed}).player;a.pool.show(mine.id);p.target=999;p.moving=false;
 a.nudge(1000);a.nudge(5000);a.nudge(12000);a.time.now=24000;a.nudge(24000);
 assert.equal(p.destroyed,true);assert.equal(a.S.cooldown.has(mine.id),true);assert.equal(a.S.program.kind,'standby');
});
function playingHighlight(){
 const a=app(undefined,{media:true});ready(a);a.setPlaying(true);const entry={id:'highlight-test',gameId:'A',score:{kind:'TD',text:'Jonathan Taylor 1 Yd Rush',team:0,players:[]},credits:[{player,role:'scorer'}],status:'queued'};
 a.coverage.log.push(entry);a.coverage.queue.push(entry);a.S.sources.set(entry.id,{key:'hl:test',source:{url:'https://example.com/clip.mp4'},start:0,duration:10,label:'Official highlight'});a.startHighlight(entry.id);a.updateHighlight(1000);
 return {a,entry,p:a.pool.current};
}
test('continuity: cancelled urgency clears the pending return deadline while a highlight continues',()=>{
 const {a,p}=playingHighlight();a.saved.streams={'IND-MIN':'https://example.test/slow.mp4'};const back=a.pool.open('A',{url:a.saved.streams['IND-MIN']}).player;back.moving=false;a.S.highlight.returnTo='A';
 let urgent=true;a.director.decide=()=>urgent?{kind:'game',id:'A'}:{kind:'highlight',id:a.S.highlight.item.id};a.step(1000);assert.equal(a.S.pending.id,'A');urgent=false;a.time.now=2000;p.currentTime=1;a.step(2000);assert.equal(a.S.pending,null);
 urgent=true;a.time.now=5000;p.currentTime=4;a.step(5000);assert.equal(a.S.pending.since,5000);assert.equal(a.S.cooldown.has('A'),false);
});
test('continuity: failed summaries do not starve the fifth roster game',async()=>{
 const names=['IND','DAL','BUF','SEA','KC'],calls=[],events=names.map((abbr,i)=>({id:String(i+1),date:'2026-11-01T18:00:00Z',competitions:[{status:{type:{state:'in'}},competitors:[{homeAway:'away',team:{id:String(i+1),abbreviation:abbr}},{homeAway:'home',team:{id:'100',abbreviation:'MIN'}}]}]}));
 const a=app(async url=>{if(String(url).includes('scoreboard'))return Response.json({events});const id=String(url).split('event=')[1];calls.push(id);if(id!=='5')throw new Error('Summary unavailable');return Response.json({scoringPlays:[],videos:[]});});
 a.useRoster(names.map((team,i)=>({name:'Player '+String.fromCharCode(65+i),team,position:'RB'})),{teamName:'Five games'});await a.pollLive(0);await a.pollLive(0);assert.ok(calls.includes('5'));assert.equal(calls.filter(id=>id==='1').length,1);
});
test('continuity: long polling cycles still give the least recently attempted game its turn',async()=>{
 const names=['IND','DAL','BUF','SEA','KC'],calls=[],events=names.map((abbr,i)=>({id:String(i+1),competitions:[{status:{type:{state:'in'}},competitors:[{homeAway:'away',team:{id:String(i+1),abbreviation:abbr}},{homeAway:'home',team:{id:'100',abbreviation:'MIN'}}]}]}));
 const a=app(async url=>{if(String(url).includes('scoreboard'))return Response.json({events});calls.push(String(url).split('event=')[1]);throw new Error('Slow summary failure');});
 a.useRoster(names.map((team,i)=>({name:'Player '+String.fromCharCode(65+i),team,position:'RB'})),{teamName:'Five games'});
 a.S.live.summaryAt=Object.fromEntries(['1','2','3','4'].map(id=>[id,Date.now()-30000]));await a.pollLive(0);assert.equal(calls[0],'5');assert.equal(calls.length,4);
});
async function correctionFixture(){
 const now=Date.now(),event={id:'A',date:new Date(now-3600000).toISOString(),competitions:[{status:{type:{state:'in'}},competitors:[{homeAway:'away',team:{id:'11',abbreviation:'IND'}},{homeAway:'home',team:{id:'16',abbreviation:'MIN'}}]}]};
 let summary={drives:{previous:[{plays:[{id:'td',wallclock:new Date(now-60000).toISOString(),start:{team:{id:'11'}}}]}]},scoringPlays:[{id:'td',team:{id:'11'},text:'Jonathan Taylor 4 Yd Rush',scoringType:{name:'touchdown'}}],videos:[]};
 const a=app(async url=>Response.json(String(url).includes('scoreboard')?{events:[event]}:summary),{media:true});ready(a);a.S.at=now/1000;a.S.coverageStart=a.S.at-120;await a.pollLive(0);
 const g=a.S.live.games[0];a.S.games=[g];a.coverage.update([g],a.roster(),a.S.at,0);const entry=a.coverage.log[0];
 a.S.sources.set(entry.id,{status:'ready',key:'hl:correction',source:{url:'https://example.test/score.mp4'},start:0,duration:12,label:'ESPN highlight'});
 const poll=async next=>{summary=next;a.S.live.summaryAt={};await a.pollLive(0);};
 return {a,entry,poll,summary};
}
test('corrections: removing a score closes its visible replay and prevents it from returning',async()=>{
 const {a,entry,poll}=await correctionFixture();a.setPlaying(true);a.startHighlight(entry.id);a.updateHighlight(1000);const p=a.pool.current;assert.ok(p);
 await poll({scoringPlays:[],videos:[]});assert.equal(p.destroyed,true);assert.equal(a.S.highlight,null);assert.equal(a.S.sources.has(entry.id),false);assert.equal(a.coverage.log.length,0);assert.equal(a.coverage.queue.length,0);
 a.step(1250);assert.equal(a.coverage.log.length,0);assert.equal(a.coverage.queue.length,0);
});
test('corrections: an incomplete summary keeps the active replay and known score',async()=>{
 const {a,entry,poll}=await correctionFixture();a.setPlaying(true);a.startHighlight(entry.id);a.updateHighlight(1000);const h=a.S.highlight,p=a.pool.current;
 await poll({videos:[]});assert.equal(a.S.highlight,h);assert.equal(a.pool.current,p);assert.equal(a.S.live.scores.get('A')[0].id,entry.id);
});
test('corrections: scoreboard and PAT edits update labels without interrupting footage',async()=>{
 const {a,entry,poll,summary}=await correctionFixture();a.setPlaying(true);a.startHighlight(entry.id);a.updateHighlight(1000);const h=a.S.highlight,p=a.pool.current;
 await poll({...summary,scoringPlays:[{...summary.scoringPlays[0],awayScore:7,text:'Jonathan Taylor 4 Yd Rush (Spencer Shrader Kick)'}]});
 assert.equal(a.S.highlight,h);assert.equal(a.pool.current,p);assert.equal(entry.score.away,7);assert.match(entry.score.text,/Shrader/);assert.equal(a.S.sources.get(entry.id),h.src);
});
test('corrections: removing an outgoing replay preserves the next replay that is loading',async()=>{
 const {a,entry,poll}=await correctionFixture();a.setPlaying(true);a.startHighlight(entry.id);a.updateHighlight(1000);const old=a.pool.current;a.S.highlight.done=true;entry.status='replayed';
 const next={...entry,id:'B:next',gameId:'B',score:{...entry.score,id:'B:next'}};a.coverage.log.push(next);a.coverage.queue.push(next);a.S.sources.set(next.id,{status:'ready',key:'hl:next',source:{url:'https://example.test/next.mp4'},start:0,duration:12});a.startHighlight(next.id);const h=a.S.highlight,p=a.pool.get(h.src.key).player;p.moving=false;
 await poll({scoringPlays:[],videos:[]});assert.equal(old.destroyed,true);assert.equal(a.S.highlight,h);assert.equal(p.destroyed,undefined);assert.equal(h.previousView,null);
 p.moving=true;a.updateHighlight(1250);assert.equal(a.pool.current,p);assert.equal(a.S.program.id,next.id);
});
test('corrections: a late resolver cannot restore a removed score',async()=>{
 const {a,entry,poll}=await correctionFixture(),pending=deferred();a.S.sources.delete(entry.id);a.S.liveClips=[{id:'nfl-correction',kind:'nfl',title:'Taylor scores',description:'Jonathan Taylor scores a 4-yard touchdown.',teams:['IND'],publishedAt:Date.now()-30000,url:'https://www.nfl.com/videos/taylor-touchdown'}];let resolving=false;a.nfl.resolve=()=>{resolving=true;return pending.promise;};
 const work=a.prepareReplay(entry);assert.equal(resolving,true);assert.equal(a.S.sources.get(entry.id).status,'pending');
 await poll({scoringPlays:[],videos:[]});pending.resolve({url:'https://example.test/stale.m3u8',duration:12});await work;assert.equal(a.S.sources.has(entry.id),false);assert.equal(a.coverage.queue.length,0);assert.equal(a.coverage.log.length,0);
});
test('corrections: a reassignment to a different player cannot keep the original replay',async()=>{
 const {a,entry,poll,summary}=await correctionFixture();a.setPlaying(true);a.startHighlight(entry.id);a.updateHighlight(1000);const p=a.pool.current;
 await poll({...summary,scoringPlays:[{...summary.scoringPlays[0],text:'Josh Downs 4 Yd Rush'}]});a.step(1250);
 assert.equal(p.destroyed,true);assert.equal(a.S.highlight,null);assert.equal(a.coverage.log.length,0);assert.equal(a.coverage.queue.length,0);
});
test('watchability: a half-watched interruption stays queued and resumes near the interruption',()=>{
 const {a,entry,p}=playingHighlight();for(let second=1;second<=6;second++){a.time.now=1000+second*1000;p.currentTime=second;a.updateHighlight(a.time.now);}
 a.finishHighlight();assert.equal(entry.status,'queued');assert.equal(a.coverage.queue[0].id,entry.id);
 a.startHighlight(entry.id);const next=a.pool.get(a.S.highlight.src.key).player;assert.ok(next.currentTime>=4&&next.currentTime<=6,'resume with context, instead of repeating the whole opening');
 a.updateHighlight(a.time.now);for(let pos=next.currentTime+1;pos<=10;pos++){a.time.now+=1000;next.currentTime=pos;a.updateHighlight(a.time.now);}assert.equal(entry.status,'replayed');
});
test('watchability: replaying after a jump to the end cannot reuse an ended player at its end',()=>{
 const {a,entry,p}=playingHighlight();a.S.highlight.returnTo='A';p.currentTime=10;a.time.now=1250;a.updateHighlight(1250);assert.equal(entry.status,'queued');a.startHighlight(entry.id);
 assert.ok(a.pool.get(a.S.highlight.src.key).player.currentTime<1);a.updateHighlight(1250);assert.equal(a.S.highlight.playing,true);
});
test('watchability: back-to-back highlights keep the incoming player inside a full pool',()=>{
 const {a}=playingHighlight();a.useRoster([player,{name:'CeeDee Lamb',team:'DAL',position:'WR'}],{teamName:'Two games'});
 // Install the transition after the intentional lineup reset.
 const b={...game,id:'B',teams:[{abbr:'DAL'},{abbr:'NYG'}]};a.S.games=[game,b];a.saved.streams={'IND-MIN':'https://example.test/a.mp4','DAL-NYG':'https://example.test/b.mp4'};a.S.started=true;a.S.playing=true;
 a.pool.open('hl:old',{url:'https://example.test/old.mp4'});a.pool.show('hl:old');a.pool.open('A',{url:a.saved.streams['IND-MIN']});a.pool.open('B',{url:a.saved.streams['DAL-NYG']});a.S.program={kind:'highlight',id:'old'};
 a.S.highlight={item:{id:'old'},src:{key:'hl:old'},returnTo:'A',playing:true,done:true};
 const entry={id:'next',gameId:'A',score:{text:'Next score'}};a.coverage.queue.push(entry);a.S.sources.set('next',{key:'hl:next',source:{url:'https://example.test/next.mp4'},start:0,duration:10});a.startHighlight('next');a.warm(new Set());
 assert.ok(a.pool.get('hl:next'),'warming games must not evict the incoming clip');assert.equal(a.pool.visible,'hl:old');a.updateHighlight(2000);assert.equal(a.pool.visible,'hl:next');assert.ok(a.pool.get('A'),'return game stays warm');assert.equal(a.pool.get('hl:old'),null);
});
test('watchability: completed highlights remain paused while a return stream is loading',()=>{
 const {a,p}=playingHighlight();a.S.highlight.returnTo='A';for(let second=1;second<=10;second++){a.time.now=1000+second*1000;p.currentTime=second;a.updateHighlight(a.time.now);}
 assert.equal(a.S.highlight.done,true);assert.equal(p.wantPlay,false);a.warm(new Set());assert.equal(p.wantPlay,false);a.setPlaying(false);a.setPlaying(true);assert.equal(p.wantPlay,false);
});
test('watchability: an unfinished clip keeps moving until the urgent return stream is actually ready',()=>{
 const {a,entry,p}=playingHighlight();a.saved.streams={'IND-MIN':'https://example.test/slow-return.mp4'};const back=a.pool.open('A',{url:a.saved.streams['IND-MIN']}).player;back.moving=false;a.S.highlight.returnTo='A';a.director.decide=()=>({kind:'game',id:'A'});
 p.currentTime=1;a.time.now=2000;a.step(2000);assert.equal(a.S.highlight.done,false);assert.equal(p.wantPlay,true);assert.equal(a.pool.current,p);assert.equal(a.S.pending.id,'A');
 back.moving=true;p.currentTime=2;a.time.now=3000;a.step(3000);assert.equal(a.pool.current,back);assert.equal(p.destroyed,true);assert.equal(entry.status,'queued');
});
test('watchability: a newly urgent game prevents a loading highlight from flashing on screen',()=>{
 const a=app(undefined,{media:true});ready(a);a.setPlaying(true);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.S.program={kind:'game',id:'A'};a.pool.open('A',{url:a.saved.streams['IND-MIN']});a.pool.show('A');
 const entry={id:'clip',gameId:'A',score:{text:'Score'}};a.coverage.queue.push(entry);a.S.sources.set(entry.id,{key:'hl:clip',source:{url:'https://example.test/clip.mp4'},start:0,duration:10});a.startHighlight(entry.id);
 const shown=[],show=a.pool.show.bind(a.pool);a.pool.show=id=>{shown.push(id);return show(id);};a.director.decide=()=>({kind:'game',id:'A'});a.step(2000);
 assert.equal(shown.includes('hl:clip'),false);assert.equal(a.pool.visible,'A');assert.equal(a.S.highlight,null);assert.equal(a.coverage.queue[0].id,entry.id);
});
test('watchability: a native clip uses its actual duration instead of ending at a guessed thirty seconds',async()=>{
 const a=app(undefined,{media:true}),{item,clip}=liveReplay(a);a.S.liveClips=[clip];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/full.m3u8'});await a.prepareReplay(item);a.startHighlight(item.id);
 const p=a.pool.get(a.S.highlight.src.key).player;p.duration=60;a.updateHighlight(1000);for(let second=1;second<=31;second++){a.time.now=1000+second*1000;p.currentTime=second;a.updateHighlight(a.time.now);}
 assert.equal(a.S.highlight?.done,false);assert.notEqual(item.status,'replayed');for(let second=32;second<=60;second++){a.time.now=1000+second*1000;p.currentTime=second;a.updateHighlight(a.time.now);}assert.equal(item.status,'replayed');
});
test('watchability: a real native player reveals the opening and returns to the game after ended',async()=>{
 const a=app(undefined,{media:true,native:true}),{item,clip}=liveReplay(a);a.saved.streams={'IND-MIN':'https://example.test/live.mp4'};a.setPlaying(true);
 const livePlayer=a.pool.open('A',{url:a.saved.streams['IND-MIN']}).player;await livePlayer.ready;livePlayer.play();livePlayer.element.currentTime=1;livePlayer.element.emit('timeupdate');a.cutTo('A',1000);assert.equal(a.pool.visible,'A');
 a.S.liveClips=[clip];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/tiny.m3u8',duration:2});await a.prepareReplay(item);a.startHighlight(item.id);const p=a.pool.get(a.S.highlight.src.key).player;await p.ready;p.element.duration=2;
 a.time.now=1250;p.element.currentTime=0;p.element.emit('timeupdate');a.updateHighlight(1250);assert.equal(a.pool.current,livePlayer,'a landing frame alone must not replace moving game footage');
 a.time.now=1500;p.element.currentTime=.5;p.element.emit('timeupdate');a.updateHighlight(1500);assert.equal(a.pool.current,p);assert.equal(p.currentTime,0,'the hidden half-second must not be skipped');
 for(let i=1;i<=8;i++){a.time.now+=250;p.element.currentTime=i/4;p.element.emit('timeupdate');if(i<8)a.updateHighlight(a.time.now);}
 p.element.emit('ended');assert.equal(item.status,'replayed');assert.equal(p.wantPlay,false);const playCalls=p.element.calls.filter(c=>c==='play').length;a.setPlaying(false);a.setPlaying(true);assert.equal(p.element.calls.filter(c=>c==='play').length,playCalls,'resuming the channel must not restart an ended native clip');livePlayer.element.currentTime=4;livePlayer.element.emit('timeupdate');a.cutTo('A',a.time.now);assert.equal(a.pool.current,livePlayer);assert.equal(p.destroyed,true);assert.equal(livePlayer.wantPlay,true);
});
test('watchability: an unknown-duration clip waits for ended instead of an invented cutoff',async()=>{
 const a=app(undefined,{media:true}),{item,clip}=liveReplay(a);a.S.liveClips=[{...clip,duration:0}];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/unknown.m3u8'});await a.prepareReplay(item);a.startHighlight(item.id);a.updateHighlight(1000);const p=a.pool.current;
 for(let second=1;second<=47;second++){a.time.now=1000+second*1000;p.currentTime=second;a.updateHighlight(a.time.now);}assert.equal(a.S.highlight.done,false);p.emit('ended');assert.equal(item.status,'replayed');
});
test('watchability: new ambiguity invalidates a prepared clip and its old publisher link',async()=>{
 const a=app(undefined,{media:true}),{item,clip}=liveReplay(a);a.S.liveClips=[clip];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/clip.m3u8',duration:12});await a.prepareReplay(item);assert.equal(item.watchUrl,clip.url);
 a.S.live.scores.set('A',[item.score,{...item.score,id:'A:another',at:item.at+10}]);a.startHighlight(item.id);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(a.S.highlight,null);assert.equal(a.pool.slots.size,0);assert.equal(item.watchUrl,null);assert.equal(item.status,'waiting');
});
test('watchability: refreshed links retain progress only when they identify the same clip',async()=>{
 const a=app(),{item,clip}=liveReplay(a);a.S.liveClips=[clip];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/clip.m3u8',duration:12,expiresAt:Date.now()+240000});await a.prepareReplay(item);
 const old=a.S.sources.get(item.id);old.ranges=[[0,6]];old.resumeAt=4;old.expiresAt=Date.now()-1;a.startHighlight(item.id);await new Promise(resolve=>setImmediate(resolve));assert.equal(a.S.sources.get(item.id).resumeAt,4);assert.equal(a.S.sources.get(item.id).ranges[0][1],6);
 a.S.sources.get(item.id).expiresAt=Date.now()-1;a.S.liveClips=[{...clip,id:'replacement'}];a.S.failedClips.set(clip.id,Date.now()+60000);a.startHighlight(item.id);await new Promise(resolve=>setImmediate(resolve));assert.equal(a.S.sources.get(item.id).clipId,'replacement');assert.equal(a.S.sources.get(item.id).resumeAt,undefined);
});
test('watchability: repeat interruptions do not count overlapping footage twice',()=>{
 const {a,entry,p}=playingHighlight();for(let second=1;second<=4;second++){a.time.now+=1000;p.currentTime=second;a.updateHighlight(a.time.now);}a.finishHighlight();a.startHighlight(entry.id);a.updateHighlight(a.time.now);const next=a.pool.current;
 for(let second=3;second<=4;second++){a.time.now+=1000;next.currentTime=second;a.updateHighlight(a.time.now);}assert.equal(a.S.highlight.watched,4);a.finishHighlight();assert.equal(entry.status,'queued');
});
test('watchability: repeated incomplete endings retire the clip instead of replaying forever',async()=>{
 const a=app(undefined,{media:true}),{item,clip}=liveReplay(a);a.S.liveClips=[clip];a.nfl.resolve=async()=>({url:'https://dcs-vod.mp.lura.live/vod/broken.m3u8',duration:12});await a.prepareReplay(item);
 for(let attempt=0;attempt<2;attempt++){a.startHighlight(item.id);a.updateHighlight(a.time.now);const p=a.pool.current;a.time.now+=250;p.currentTime=12;p.emit('ended');}
 assert.equal(a.S.highlight,null);assert.equal(a.coverage.queue.length,0);assert.equal(item.status,'waiting');assert.ok(a.S.failedClips.get(clip.id)>Date.now());assert.equal(a.S.sources.get(item.id).status,'none');
});
test('watchability: back-to-back loading keeps the outgoing score label until the new clip appears',()=>{
 const {a,entry}=playingHighlight();a.S.highlight.returnTo='A';a.S.highlight.done=true;entry.status='replayed';const previousText=entry.score.text;
 const next={...entry,id:'next-label',score:{...entry.score,text:'Jonathan Taylor 9 Yd Rush'},status:'queued'};a.coverage.log.push(next);a.coverage.queue.push(next);a.S.sources.set(next.id,{key:'hl:next-label',source:{url:'https://example.test/next.mp4'},start:0,duration:10,label:'Official highlight'});
 a.startHighlight(next.id);a.render();assert.equal(a.el('bugTag').textContent,'REPLAY');assert.equal(a.el('lowerMain').textContent,previousText);assert.match(a.el('scores').html,/Loading replay/);
 a.updateHighlight(1000);assert.equal(a.el('lowerMain').textContent,next.score.text);
});
test('watchability: the real director finishes short highlights before urgent action and consecutive clips',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.delay=0;a.S.coverageStart=990;a.saved.streams={'IND-MIN':'https://example.test/live.mp4'};a.setPlaying(true);
 const entries=Array.from({length:3},(_,i)=>({id:'sequence-'+i,gameId:'A',gameName:game.name,score:{kind:'TD',text:'Jonathan Taylor '+(i+1)+' Yd Rush',players:[]},credits:[{player,role:'scorer'}],at:999,queuedAt:999,status:'queued'}));
 for(const entry of entries){a.coverage.log.push(entry);a.coverage.queue.push(entry);a.S.sources.set(entry.id,{status:'ready',key:'hl:'+entry.id,source:{url:'https://example.test/'+entry.id+'.mp4'},start:0,duration:8,label:'Official highlight'});}
 let returned=false,resumed=false;
 for(let frame=0;frame<180;frame++){
  a.time.now=1000+frame*250;a.S.at=1000+frame/4;const urgent=frame>=20&&frame<36,g={...game,phase:urgent?'play':'break',yardsToGoal:urgent?5:40};a.S.live.feed.push([g],a.S.at);
  for(const {player:p} of a.pool.slots.values())if(p.wantPlay)p.currentTime+=.25;
  a.step(a.time.now);if(urgent&&a.pool.visible==='A'){returned=true;assert.equal(entries[0].status,'replayed','finish the visible short clip before returning');}if(frame>=36&&a.S.highlight?.item.id===entries[0].id&&a.S.highlight.playStart>0)resumed=true;
  if(a.S.highlight&&!a.S.highlight.src.data)assert.ok(a.pool.get(a.S.highlight.src.key),'active highlight stays in its player slot');
 }
 assert.equal(returned,true);assert.equal(resumed,false);assert.ok(entries.every(e=>e.status==='replayed'));assert.equal(a.coverage.queue.length,0);assert.equal(a.pool.visible,null);assert.equal(a.S.program.kind,'standby');
 a.S.live.feed.push([{...game,phase:'live'}],a.S.at);a.step(a.time.now+250);assert.equal(a.pool.visible,'A');
});
test('logic: buffering footage cannot be marked replayed by elapsed wall time',()=>{
 const {a,entry,p}=playingHighlight();p.moving=false;a.time.now=12000;a.updateHighlight(12000);
 assert.notEqual(entry.status,'replayed');assert.equal(a.S.highlight?.done,false);
 a.time.now=17000;a.updateHighlight(17000);assert.equal(entry.status,'missed');assert.equal(p.destroyed,true);
});
test('logic: a progressing highlight finishes from its media position and records it as replayed',()=>{
 const {a,entry,p}=playingHighlight();for(let second=1;second<=10;second++){a.time.now=1000+second*1000;p.currentTime=second;a.updateHighlight(a.time.now);}
 assert.equal(entry.status,'replayed');assert.equal(a.coverage.queue.length,0);
});
test('logic: skipping to a highlight’s end cannot claim the skipped footage was watched',()=>{
 const {a,entry,p}=playingHighlight();p.currentTime=10;a.time.now=1250;a.updateHighlight(1250);
 assert.notEqual(entry.status,'replayed');assert.equal(a.coverage.queue[0]?.id,entry.id);
});
test('logic: buffering recovery and Pause preserve the highlight instead of consuming its deadline',()=>{
 const {a,entry,p}=playingHighlight();a.time.now=2000;p.currentTime=1;a.updateHighlight(2000);a.setPlaying(false);a.time.now=62000;a.setPlaying(true);a.updateHighlight(62000);
 assert.equal(a.S.highlight.done,false);for(let second=2;second<=10;second++){a.time.now=61000+second*1000;p.currentTime=second;a.updateHighlight(a.time.now);}assert.equal(entry.status,'replayed');
});
test('logic: a user sync mark overrides a conflicting built-in anchor',()=>{
 const a=app();replayReady(a);const g=a.S.archive.games[0],anchor=g.anchors.find(x=>x.media>30&&x.media<g.recordingDuration-60);assert.ok(anchor);
 a.saved.marks[g.id]=[{wall:anchor.wall,media:anchor.media+20}];const synced=a.syncFor(g);assert.ok(Math.abs(synced.media(anchor.wall)-(anchor.media+20))<.001);
});
test('logic: live trackers and unobservable page embeds cannot certify that video was watched',()=>{
 for(const kind of ['tracker','embed']){
  const a=app(undefined,{media:true});ready(a);a.S.program={kind:'game',id:'A'};a.S.started=true;a.S.playing=true;a.S.lastAt=999;
  if(kind==='embed'){a.saved.streams={'IND-MIN':'https://example.com/watch'};const p=a.pool.open('A',{url:a.saved.streams['IND-MIN']}).player;p.kind='embed';a.pool.setRunning(true);a.pool.show('A');}
  a.step(1000);assert.equal(a.coverage.intervals.size,0,kind+' cannot confirm moving game footage');
 }
});
test('logic: replay league imports request the archive season and week while live imports use the current season',async()=>{
 const requests=[];const a=app(async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({leagueId:'123',name:'League',teams:[{id:'1',name:'Team',players:[player]}]});});
 a.S.archive=new archive.ReplayArchive(archiveData);a.S.mode='replay';a.el('leagueId').value='123';await a.importLeague();assert.equal(requests[0].season,archiveData.season);assert.equal(requests[0].week,archiveData.week);
 a.S.mode='live';await a.importLeague();assert.equal(requests[1].season,undefined);assert.equal(requests[1].week,undefined);
});

test('break recovery: an in-band commercial can be skipped to a configured non-roster game and later return',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4','SEA-SF':'https://example.test/x.mp4'};
 const other={...game,id:'X',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}]};a.S.games=[game,other];a.S.live.games=[game,other];a.S.live.feed.push([game,other],970);
 a.setPlaying(true);a.cutTo('A',1000);a.S.pinned='A';a.skipBreak();
 assert.equal(a.S.pinned,null);assert.equal(a.S.program.id,'X');assert.equal(a.excluded().has('A'),true);
 a.S.at+=10000;assert.equal(a.excluded().has('A'),true,'edited replay/feed time does not expire the break');
 a.time.now=91001;assert.equal(a.excluded().has('A'),false);
 a.step(91001);assert.equal(a.S.program.id,'A');
});
test('break recovery: no alternative video hides and mutes the commercial until a stream is available',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.setPlaying(true);a.cutTo('A',1000);const p=a.pool.current;a.pool.setMuted(false);a.skipBreak();
 assert.equal(a.S.breaks.size,1);assert.equal(a.S.program.kind,'standby');assert.equal(a.pool.visible,null);assert.equal(p.muted,true);assert.match(a.el('toast').textContent,/break is hidden/);
 a.time.now=91001;a.step(a.time.now);assert.equal(a.pool.visible,'A');
});
test('break recovery: a provider ad yields to a non-roster stream without counting ad coverage',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4','SEA-SF':'https://example.test/x.mp4'};
 const other={...game,id:'X',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}]};a.S.games=[game,other];a.S.live.feed.push([game,other],970);
 a.setPlaying(true);a.cutTo('A',1000);a.S.lastAt=999;a.pool.current.emit('ad',true);a.step(1000);
 assert.equal(a.S.program.id,'X');assert.equal(a.coverage.intervals.size,0);
});
for(const reason of ['provider ad','feed break','reported break'])test(`release: ${reason} uses a watchable backup before a roster tracker`,()=>{
 const a=app(undefined,{media:true});ready(a);a.useRoster([player,{name:'Puka Nacua',team:'LAR',position:'WR'}],{teamName:'Two games'});
 const tracker={...game,id:'B',teams:[{abbr:'LAR'},{abbr:'LV'}],yardsToGoal:1},backup={...game,id:'X',teams:[{abbr:'SEA'},{abbr:'SF'}]};
 a.saved.streams={'IND-MIN':'https://example.test/a.mp4','SEA-SF':'https://example.test/x.mp4'};a.S.games=[game,tracker,backup];a.S.live.feed.push(a.S.games,970);
 a.setPlaying(true);a.step(1000);assert.equal(a.pool.visible,'A');
 const p=a.pool.current;
 if(reason==='provider ad')p.emit('ad',true);
 else if(reason==='feed break')a.S.live.feed.push([{...game,phase:'break'},tracker,backup],970);
 else a.skipBreak();
 a.step(1250);assert.equal(a.pool.visible,'X');assert.equal(a.S.program.id,'X');assert.equal(p.muted,true);
 a.pool.current.emit('error',new Error('Backup unavailable'));a.step(1500);
 assert.equal(a.S.program.id,'B','retain the roster tracker when no replacement video works');assert.equal(a.pool.visible,null);
});
test('release: a manually selected non-roster stream also yields to backup football during its ad',()=>{
 const a=app(undefined,{media:true});ready(a);
 const selected={...game,id:'X',teams:[{abbr:'SEA'},{abbr:'SF'}]},backup={...game,id:'Y',teams:[{abbr:'BUF'},{abbr:'MIA'}]};
 a.saved.streams={'SEA-SF':'https://example.test/x.mp4','BUF-MIA':'https://example.test/y.mp4'};a.S.games=[game,selected,backup];a.S.live.feed.push(a.S.games,970);
 a.selectGame('X');assert.equal(a.pool.visible,'X');a.pool.current.emit('ad',true);
 for(const now of [1250,1500,1750]){a.step(now);assert.equal(a.pool.visible,'Y');assert.equal(a.S.pinned,null);}
});
test('interface: the single lineup editor stays available without touching playback',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/live.mp4'};a.render();
 a.setPlaying(true);a.cutTo('A',1000);const video=a.pool.current;a.el('lineupButton').onclick();assert.equal(a.el('lineupDialog').open,true);assert.equal(a.pool.current,video);assert.equal(video.destroyed,undefined);
 assert.equal(a.el('setupSteps'),undefined);assert.equal(a.el('editLineup'),undefined);assert.equal(a.el('lineupSummary'),undefined);
});
test('interface: start watching leaves the streams dialog closed and lineup remains available',()=>{
 const a=app();ready(a);a.render();a.setPlaying(true);
 assert.ok(!a.el('streamsDetails').open,'the streams dialog is not open');a.el('lineupButton').onclick();assert.equal(a.el('lineupDialog').open,true);
});
test('game tiles: the All/Mine filter and live score updates leave the active stream intact',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/live.mp4'};a.setPlaying(true);a.cutTo('A',1000);
 const video=a.pool.current;a.S.live.games.push({...game,id:'B',name:'Other game',teams:[{abbr:'SEA'},{abbr:'SF'}]});a.S.games=a.S.live.games;a.render();
 assert.match(a.el('games').innerHTML,/Other game/);a.el('myScores').onclick();assert.doesNotMatch(a.el('games').innerHTML,/Other game/);
 a.S.live.games=[{...game,score:[24,17]}];a.S.games=a.S.live.games;a.render();assert.match(a.el('games').innerHTML,/>24</);assert.equal(a.pool.current,video);assert.equal(video.destroyed,undefined);
 assert.equal(a.el('myScores')['aria-pressed'],'true');
});
test('game tiles: replay scores use the replay timeline, never future live results',()=>{
 const a=app();replayReady(a);a.S.mode='replay';a.S.games=[{...game,score:[7,0]}];a.S.live.games=[{...game,score:[49,42]}];a.render();
 assert.match(a.el('games').innerHTML,/>7</);assert.doesNotMatch(a.el('games').innerHTML,/>49</);assert.match(a.el('fantasyStatus').textContent,/available in Live games/);
});
test('interface: optional backup stream links save and unsaved edits survive schedule changes',()=>{
 const a=app();ready(a);const other={...game,id:'X',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}]};a.S.games.push(other);a.S.live.games.push(other);a.render();
 const input=a.el('backupInputs').querySelector('input');input.value='https://example.test/backup.mp4';a.S.live.games.push({...other,id:'Y',teams:[{abbr:'DAL'},{abbr:'NYG'}]});a.render();
 assert.equal(a.el('backupInputs').querySelector('input').value,'https://example.test/backup.mp4');a.el('saveStreams').onclick();assert.equal(a.saved.streams['SEA-SF'],'https://example.test/backup.mp4');
});
test('interface: returning from a short highlight is explicit and does not immediately replay it again',()=>{
 const {a,entry,p}=playingHighlight();a.S.highlight.returnTo='A';a.el('leaveHighlight').onclick();assert.equal(entry.status,'skipped');assert.equal(a.coverage.queue.length,0);assert.equal(p.destroyed,true);
});

test('break recovery: pausing preserves a manual break timer and changing modes clears it',async()=>{
 const a=app();replayReady(a);a.S.playing=true;a.S.breaks.set('A',91000);a.setPlaying(false);a.time.now=200000;a.render();assert.equal(a.excluded().has('A'),true);
 a.setPlaying(true);a.time.now=250000;assert.equal(a.excluded().has('A'),true);a.time.now=291000;assert.equal(a.excluded().has('A'),false);
 a.S.breaks.set('A',400000);await a.setMode('replay');assert.equal(a.S.breaks.size,0);
});
test('break recovery: a lone provider ad is explained as a break instead of a broken stream',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.setPlaying(true);a.cutTo('A',1000);a.pool.current.emit('ad',true);a.step(1000);a.render();
 assert.equal(a.el('ovEyebrow').textContent,'COMMERCIAL BREAK');assert.equal(a.el('ovButton').dataset.action,'streams');a.el('ovButton').onclick();assert.equal(a.el('streamsDetails').open,true);
});

test('break recovery: reported in-band commercials are not watched coverage while another stream loads',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.setPlaying(true);a.cutTo('A',1000);a.S.breaks.set('A',91000);a.S.lastAt=999;
 a.step(1000);assert.equal(a.coverage.intervals.size,0);
});

test('replay continuity: the app passes media protection to the director, but an ad releases it',()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.useRoster([{name:'Zay Flowers',team:'BAL',position:'WR'},{name:'Tyrone Tracy',team:'NYG',position:'RB'}],{teamName:'Replay team'});a.saved.highlights=false;
 const g=a.S.archive.game('401873012'),p=g.plays[136],other=a.S.archive.game('401873016');a.S.at=g.start+p[0]+15;
 const current=archive.sampleGame(g,a.S.at,a.S.archive.types),urgent={...archive.sampleGame(other,a.S.at,a.S.archive.types),state:'in',phase:'play',possession:0,down:1,special:false,yardsToGoal:3};
 a.S.archive.sample=()=>[current,urgent];a.S.games=[current,urgent];a.setPlaying(true);const video=a.pool.open(g.id,{url:g.embed}).player;video.currentTime=a.syncFor(g).media(p[0])+10;a.pool.show(g.id);a.S.program={kind:'game',id:g.id};
 a.step(1000);assert.equal(a.S.program.id,g.id);assert.equal(a.S.decision.reason,'Finishing the play');
 video.emit('ad',true);a.step(1250);assert.equal(a.S.decision.id,other.id);assert.equal(a.S.program.id,other.id);
});

test('interface: the replay lineup editor shows the sample players that are actually being followed',()=>{
 const a=app();a.S.mode='replay';a.el('lineupButton').onclick();assert.equal(a.el('rosterRows').children.length,a.roster().length);assert.ok(a.roster().length>1);assert.match(a.el('lineupStatus').textContent,/Replay changes do not change your live lineup/);
});
test('manual choice: a detected break ends the selection and returns control to the director',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4','SEA-SF':'https://example.test/x.mp4'};
 const other={...game,id:'X',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}]};a.S.games=[game,other];a.S.live.feed.push([game,other],970);a.selectGame('A');a.step(1250);
 a.S.live.feed.push([{...game,phase:'break'},other],970);a.step(1500);assert.equal(a.S.program.id,'X');assert.equal(a.S.pinned,null);
});

test('break recovery: an accidental skip can be undone without waiting for its timer',()=>{
 const a=app();ready(a);a.S.breaks.set('A',91000);a.render();assert.equal(a.el('undoBreak').hidden,false);a.el('undoBreak').onclick();assert.equal(a.S.breaks.size,0);assert.equal(a.el('undoBreak').hidden,true);
});

function manualStreams(a){
 ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4','SEA-SF':'https://example.test/x.mp4','BUF-MIA':'https://example.test/y.mp4'};
 const urgent={...game,phase:'play',yardsToGoal:1},x={...game,id:'X',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}]},y={...game,id:'Y',name:'BUF at MIA',teams:[{abbr:'BUF'},{abbr:'MIA'}]};
 const push=(gx=x,gy=y,ga=urgent)=>{a.S.games=[ga,gx,gy];a.S.live.games=[ga,gx,gy];a.S.live.feed.push([ga,gx,gy],970);};push();return {urgent,x,y,push};
}
test('manual choice: any configured stream is listed and overrides a roster red-zone play until its next break',()=>{
 const a=app(undefined,{media:true}),{x,push}=manualStreams(a);a.render();assert.match(a.el('games').html,/data-game="X"/);a.selectGame('A');a.selectGame('X');
 for(let i=0;i<20;i++){a.time.now+=250;a.step(a.time.now);assert.equal(a.S.program.id,'X');assert.equal(a.S.pinned,'X');}
 push({...x,phase:'break'});a.step(a.time.now+250);assert.equal(a.S.program.id,'A');assert.equal(a.S.pinned,null);assert.equal(a.S.selection,null);
});
test('manual choice: the latest selection wins even while an earlier choice is buffering',()=>{
 const a=app(undefined,{media:true});manualStreams(a);a.selectGame('A');const x=a.pool.open('X',{url:a.saved.streams['SEA-SF']}).player;x.moving=false;
 a.selectGame('X');assert.equal(a.S.pending.id,'X');assert.equal(a.S.program.id,'A');a.selectGame('Y');assert.equal(a.S.program.id,'Y');assert.equal(a.S.pinned,'Y');
 x.moving=true;a.step(2000);assert.equal(a.S.program.id,'Y');assert.equal(a.S.pending,null);
});
test('manual choice: selecting during a highlight holds its last picture until the chosen stream is ready',()=>{
 const {a,entry,p}=playingHighlight();const x={...game,id:'X',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}]};a.saved.streams['SEA-SF']='https://example.test/x.mp4';a.S.games=[game,x];a.S.live.feed.push([game,x],970);
 const target=a.pool.open('X',{url:a.saved.streams['SEA-SF']}).player;target.moving=false;a.selectGame('X');
 assert.equal(entry.status,'skipped');assert.equal(a.pool.current,p);assert.equal(p.wantPlay,false);assert.equal(p.destroyed,undefined);assert.equal(a.S.pending.id,'X');
 target.moving=true;a.step(2000);assert.equal(a.S.program.id,'X');assert.equal(p.destroyed,true);assert.equal(a.coverage.queue.length,0);
});
test('manual choice: a game already in a detected break is not revealed even by a manual click',()=>{
 const a=app(undefined,{media:true}),{x,push}=manualStreams(a);push({...x,phase:'break'});const target=a.pool.open('X',{url:a.saved.streams['SEA-SF']}).player;target.moving=false;
 a.selectGame('X');a.time.now=9000;a.step(9000);assert.equal(a.S.pinned,null);assert.equal(a.pool.visible,'A');
 target.moving=true;a.step(9250);assert.equal(a.pool.visible,'A');push(x);a.selectGame('X');assert.equal(a.pool.visible,'X');assert.equal(a.S.pinned,'X');
});
test('manual choice: a provider ad, a stream failure, or the end of the game releases the choice',()=>{
 for(const reason of ['ad','error','final','ended']){
  const a=app(undefined,{media:true}),{x,push}=manualStreams(a);a.selectGame('X');a.step(1250);
  if(reason==='final')push({...x,state:'post',phase:'final'});else a.pool.current.emit(reason,reason==='error'?new Error('Broken stream'):true);
  a.step(1500);assert.equal(a.S.pinned,null,reason);assert.equal(a.S.program.id,'A',reason);
 }
});
test('manual choice: Watch works from Pause and on a configured pregame stream',()=>{
 const a=app(undefined,{media:true}),{x,push}=manualStreams(a);a.selectGame('A');a.setPlaying(false);push({...x,state:'pre',phase:'pre'});a.selectGame('X');
 assert.equal(a.S.playing,true);assert.equal(a.S.program.id,'X');a.step(1500);assert.equal(a.S.pinned,'X');
 push(x);a.step(1750);push({...x,phase:'break'});a.step(2000);assert.equal(a.S.pinned,null);assert.equal(a.S.program.id,'A');
});
test('manual choice: selecting a later replay opens that exact recording instead of an automatically ranked game',()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';const d=a.S.archive.sessions[a.S.day],g=a.S.archive.games.find(g=>d.gameIds.includes(g.id)&&!g.teams.some(t=>t.abbreviation==='IND'));
 a.S.at=g.start-30;a.S.games=a.S.archive.sample(a.S.at,d.gameIds);a.selectGame(g.id);assert.equal(a.S.at,g.start);assert.equal(a.S.pinned,g.id);assert.equal(a.S.program.id,g.id);
});

test('highlight recovery: a reported provider ad releases the replay instead of protecting the advertisement',()=>{
 const {a,entry,p}=playingHighlight();a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.S.highlight.returnTo='A';p.emit('ad',true);assert.equal(p.destroyed,true);assert.notEqual(entry.status,'replayed');a.step(1250);assert.equal(a.S.program.id,'A');
});

for(const index of [14,38,46,64,83,109,137])test(`Bucs integration: a manual selection releases after score row ${index}`,()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.saved.highlights=false;
 const g=a.S.archive.game('401873018'),mapping=a.syncFor(g),start=mapping.media(g.plays[index][0]),next=breaks.nextFootball(g,a.S.archive.types,index);
 const end=Math.min(continuity.replayPlayBounds(g,a.S.archive.types,mapping,index).to,mapping.media(next[0]));
 a.S.at=g.start+mapping.wall(start+.01);a.clock.seek(a.S.at,1000);a.S.games=a.S.archive.sample(a.S.at,a.S.archive.sessions[a.S.day].gameIds);a.selectGame(g.id);
 assert.equal(a.pool.visible,g.id);assert.equal(a.S.pinned,g.id);const video=a.pool.current;
 for(let media=start+.25;media<end;media+=.25){
  video.currentTime=media;a.time.now+=250;a.advanceClock(a.time.now);a.step(a.time.now);
  assert.equal(a.S.pinned,g.id,'do not cut the scoring footage short');assert.equal(a.pool.visible,g.id);
 }
 video.currentTime=end+.01;a.time.now+=250;a.advanceClock(a.time.now);a.step(a.time.now);
 assert.equal(a.S.pinned,null,'even a fully edited commercial ends the manual selection');
 if(a.S.detectedBreaks.has(g.id)){assert.notEqual(a.pool.visible,g.id);assert.equal(video.muted,true);}
});
test('commercial suppression is immediate even while the replacement stream buffers',()=>{
 const a=app(undefined,{media:true}),{y,push}=manualStreams(a);push(undefined,{...y,phase:'break'});a.selectGame('A');a.pool.setMuted(false);const outgoing=a.pool.current;
 const backup=a.pool.open('X',{url:a.saved.streams['SEA-SF']}).player;backup.moving=false;
 outgoing.emit('ad',true);assert.equal(a.pool.visible,null,'hide without waiting for a director tick');assert.equal(outgoing.muted,true);
 a.step(1250);assert.equal(a.S.pending.id,'X');assert.equal(a.pool.visible,null);assert.equal(a.S.program.kind,'standby');
 backup.moving=true;a.step(1500);assert.equal(a.pool.visible,'X');assert.equal(outgoing.muted,true);
});
test('a background player ad cannot hide a healthy game or visible highlight',()=>{
 for(const highlight of [false,true]){
  const a=highlight?playingHighlight().a:app(undefined,{media:true});if(!highlight){manualStreams(a);a.selectGame('A');}
  const shown=a.pool.visible,p=a.pool.current,background=a.pool.open('other',{url:'https://example.test/other.mp4'}).player;
  background.emit('ad',true);assert.equal(a.pool.visible,shown);assert.equal(a.pool.current,p);
 }
});
test('a delayed live scoreboard increase ends a manual choice even when timeout metadata is missing',()=>{
 const a=app(undefined,{media:true}),{x,push}=manualStreams(a);a.selectGame('X');
 push({...x,score:[7,0],lastPlayId:'td'});a.step(1250);assert.equal(a.S.pinned,'X','the score stays on screen for the celebration');assert.equal(a.pool.visible,'X');
 a.S.at=1021;a.step(1500);assert.equal(a.S.pinned,null);assert.equal(a.pool.visible,'A');assert.equal(a.excluded().has('X'),true);
 push({...x,score:[7,0],lastPlayId:'next-drive',possession:1});a.S.at=1022;a.step(1750);assert.equal(a.excluded().has('X'),false);
});
test('when the only replay is in a break, the channel skips to its next football play',()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.saved.highlights=false;a.useRoster([{name:'Bucky Irving',team:'TB',position:'RB'}],{teamName:'Bucs'});
 const g=a.S.archive.game('401873018');a.S.archive.sessions[a.S.day].gameIds=[g.id];const mapping=a.syncFor(g),start=mapping.media(g.plays[14][0]);
 a.S.at=g.start+mapping.wall(start+.01);a.clock.seek(a.S.at,1000);a.S.games=a.S.archive.sample(a.S.at,[g.id]);a.selectGame(g.id);const video=a.pool.current;
 video.currentTime=start+33;a.time.now=34000;a.advanceClock(a.time.now);a.step(a.time.now);
 assert.equal(a.pool.visible,null);assert.equal(video.muted,true);assert.equal(a.S.at,g.start+g.plays[16][0]);
 a.time.now+=250;a.step(a.time.now);assert.equal(a.pool.visible,g.id);assert.equal(a.S.pinned,null);
});

test('adding a backup stream does not erase a known scoring break',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.selectGame('A');
 const scored={...game,score:[7,0],lastPlayId:'td'};a.S.live.feed.push([scored],970);a.step(1250);assert.equal(a.pool.visible,'A','the celebration stays on screen');a.S.at=1021;a.step(1300);assert.equal(a.pool.visible,null);
 a.render();a.el('saveStreams').onclick();a.step(1500);assert.equal(a.excluded().has('A'),true);assert.equal(a.pool.visible,null);
});
test('seeking back to the scoring play uses the requested position while the player seek is pending',()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.saved.highlights=false;const g=a.S.archive.game('401873018'),mapping=a.syncFor(g),start=mapping.media(g.plays[14][0]);
 a.S.at=g.start+g.plays[14][0]+1;a.S.games=a.S.archive.sample(a.S.at,a.S.archive.sessions[a.S.day].gameIds);a.selectGame(g.id);const p=a.pool.current;
 a.seekTo(g.start+g.plays[14][0]+1);p.currentTime=start+50;a.updateBreaks();
 assert.equal(a.S.detectedBreaks.has(g.id),false,'stale pre-seek media cannot finish the scoring guard');assert.equal(a.S.pinned,g.id);
});
test('scrubbing inside the provider discards future break evidence after the clock follows the seek',()=>{
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.saved.highlights=false;const g=a.S.archive.game('401873018'),mapping=a.syncFor(g),start=mapping.media(g.plays[14][0]);
 a.S.at=g.start+g.plays[14][0]+1;a.clock.seek(a.S.at,1000);a.S.games=a.S.archive.sample(a.S.at,a.S.archive.sessions[a.S.day].gameIds);a.selectGame(g.id);const p=a.pool.current;
 p.currentTime=start+35;a.S.at=g.start+mapping.wall(p.currentTime);a.clock.seek(a.S.at,1000);a.updateBreaks();assert.equal(a.S.detectedBreaks.has(g.id),true);
 // Model a provider scrub on a subsequently selected picture, with the old
 // future break evidence still present until the discontinuity is accepted.
 a.pool.show(g.id);a.S.program={kind:'game',id:g.id};p.currentTime=start+1;a.advanceClock(1100);a.advanceClock(4000);
 a.S.games=a.S.archive.sample(a.S.at,a.S.archive.sessions[a.S.day].gameIds);a.updateBreaks();assert.equal(a.S.detectedBreaks.has(g.id),false);
});

test('editing the lineup retains game-level break evidence and user-reported commercial timers',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.selectGame('A');a.S.breaks.set('other',91000);
 a.S.live.feed.push([{...game,score:[7,0]}],970);a.step(1250);assert.equal(a.pool.visible,'A','the celebration stays on screen');a.S.at=1021;a.step(1300);assert.equal(a.pool.visible,null);
 a.useRoster([{name:'Daniel Jones',team:'IND',position:'QB'}],{teamName:'Updated'});a.step(1500);
 assert.equal(a.excluded().has('A'),true);assert.equal(a.excluded().has('other'),true);assert.equal(a.pool.visible,null);
});
test('changing live delay discards break evidence from the old point in the feed',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.selectGame('A');
 a.S.live.feed.push([{...game,score:[7,0]}],980);a.saved.delay=0;a.step(1250);assert.equal(a.pool.visible,null);
 a.el('optDelay').onchange({target:{value:60}});a.step(1500);assert.equal(a.excluded().has('A'),false);assert.equal(a.pool.visible,'A');
});

test('score center: a slow fantasy refresh cannot reload video or replace the viewer roster',async()=>{
 const pending=deferred();let calls=0;
 const a=app(async url=>{assert.equal(url,'/api/league');calls++;return pending.promise;},{media:true,scores:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/live.mp4'};a.setPlaying(true);a.cutTo('A',1000);const video=a.pool.current;
 a.saved.leagueId='123';a.saved.teamId='1';a.render();a.render();assert.equal(calls,1);assert.equal(a.pool.current,video);
 pending.resolve(Response.json({leagueId:'123',teams:[{id:'1',players:[{name:'Other player'}]}],scoring:{week:8,teams:[{id:'1',points:22.34,complete:true,players:[{...player,points:22.34}]}]}}));await flush();a.render();
 assert.equal(a.el('fantasyTotal').textContent,'22.34');assert.match(a.el('fantasyPlayers').innerHTML,/Jonathan Taylor/);assert.equal(a.saved.roster[0].name,'Jonathan Taylor');assert.equal(a.pool.current,video);assert.equal(video.destroyed,undefined);
});

test('matchup picker changes followed roster and opponent while rejecting an obsolete import',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);ready(a);
 const other={name:'Justin Jefferson',team:'MIN',position:'WR'};
 const league={leagueId:'123',name:'Our league',week:8,teams:[{id:'1',name:'First team',players:[player]},{id:'2',name:'Second team',players:[other]}],scoring:{week:8,matchupWeeks:[8],teams:[{id:'1',points:20,complete:true,players:[{...player,points:20}]},{id:'2',points:30,complete:true,players:[{...other,points:30}]}],matchups:[{id:'8',home:{teamId:'1',points:20},away:{teamId:'2',points:30}}]}};
 a.saved.leagueId='123';a.saved.teamId='1';a.saved.league=league;a.fantasyFeed.data=league;a.render();
 assert.equal(a.el('opponentTitle').textContent,'Second team');assert.equal(a.el('opponentTotal').textContent,'30.00');
 const importing=a.importLeague({refresh:true,quiet:true});a.el('scoreTeam').onchange({target:{value:'2'}});
 assert.equal(a.saved.teamId,'2');assert.equal(a.saved.roster[0].name,'Justin Jefferson');assert.equal(a.el('fantasyTotal').textContent,'30.00');assert.equal(a.el('opponentTitle').textContent,'First team');assert.equal(a.el('scoreTeam').value,'2');
 pending.resolve(Response.json({...league,ownedTeamId:'1'}));await importing;assert.equal(a.saved.teamId,'2');assert.equal(a.saved.roster[0].name,'Justin Jefferson');
 assert.equal(JSON.parse(a.storage.get('fantasy-stream-v3')).teamId,'2');
});
test('stream links cover the entire slate even with no lineup or no lineup games',()=>{
 const other={...game,id:'B',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}]};
 for(const withLineup of [false,true]){
  const a=app();if(withLineup)ready(a);a.saved.streams={'IND-MIN':'https://example.test/mine.mp4'};
  a.S.games=[other];a.S.live.games=[other];a.render();assert.equal(a.el('backupStreams').hidden,false);assert.equal(a.el('saveStreams').hidden,false);
  const input=a.el('backupInputs').querySelector('input');assert.ok(input);input.value='https://example.test/other.mp4';a.el('saveStreams').onclick();
  assert.equal(a.saved.streams['SEA-SF'],'https://example.test/other.mp4');assert.equal(a.saved.streams['IND-MIN'],'https://example.test/mine.mp4');
 }
});
test('live RedZone mode plays a saved non-roster game after all starters finish and returns to roster action',()=>{
 const a=app(undefined,{media:true});ready(a);const mine={...game,state:'post',phase:'final'},other={...game,id:'B',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}],yardsToGoal:8};
 a.saved.streams={'IND-MIN':'https://example.test/mine.mp4','SEA-SF':'https://example.test/other.mp4'};a.S.games=[mine,other];a.S.live.games=[mine,other];a.S.live.feed.push([mine,other],970);a.setPlaying(true);a.step(1000);
 assert.equal(a.pool.visible,'B');assert.match(a.S.decision.reason,/RedZone mode/);
 a.S.live.feed.push([game,other],970);a.step(1250);assert.equal(a.pool.visible,'A');
});
test('manual choice remains authoritative in RedZone mode until its natural break',()=>{
 const a=app(undefined,{media:true});ready(a);const mine={...game,state:'post',phase:'final'},selected={...game,id:'B',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}],yardsToGoal:70},near={...game,id:'C',name:'BUF at MIA',teams:[{abbr:'BUF'},{abbr:'MIA'}],yardsToGoal:3};
 a.saved.streams={'SEA-SF':'https://example.test/selected.mp4','BUF-MIA':'https://example.test/near.mp4'};a.S.games=[mine,selected,near];a.S.live.feed.push(a.S.games,970);a.selectGame('B');a.step(1000);assert.equal(a.pool.visible,'B');assert.equal(a.S.pinned,'B');
 a.pool.current.emit('ad',true);a.step(1250);assert.equal(a.pool.visible,'C');assert.equal(a.S.pinned,null);
});


test('fantasy connection: the team selector stays visible and ESPN setup is directly reachable',()=>{
 const a=app();a.render();assert.equal(a.el('scoreTeamPicker').hidden,false);assert.equal(a.el('scoreTeam').disabled,true);
 a.el('lineupButton').onclick();assert.equal(a.el('lineupDialog').open,true);assert.equal(a.el('leagueImport').open,true);assert.equal(a.el('manualEditor').open,true);
});
test('fantasy connection: saved players remain visible during loading and an expired-login response',async()=>{
 const pending=deferred(),a=app(()=>pending.promise,{scores:true});ready(a);a.saved.leagueId='123';a.saved.teamId='1';a.render();
 assert.equal(a.el('fantasyTable').hidden,false);assert.match(a.el('fantasyPlayers').innerHTML,/Jonathan Taylor/);assert.equal(a.el('fantasyTotal').textContent,'—');
 pending.resolve(Response.json({error:'Copy fresh ESPN cookies.',code:'ESPN_DENIED'},{status:401}));await flush();a.render();
 assert.match(a.el('fantasyPlayers').innerHTML,/Jonathan Taylor/);assert.match(a.el('fantasyStatus').textContent,/Reconnect ESPN/);assert.equal(a.el('retryFantasy').hidden,false);
 a.el('retryFantasy').onclick();assert.equal(a.el('lineupDialog').open,true);assert.equal(a.el('leagueImport').open,true);assert.equal(a.el('cookieDetails').open,true);
});
test('fantasy connection: a league without a selected team can fetch franchises and load a matchup',async()=>{
 let calls=0;const other={name:'Justin Jefferson',team:'MIN',position:'WR'};
 const data={leagueId:'123',name:'Our league',teams:[{id:'1',name:'Team One',players:[player]},{id:'2',name:'Team Two',players:[other]}],scoring:{week:8,matchupWeeks:[8],teams:[{id:'1',players:[{...player,points:18}],points:18},{id:'2',players:[{...other,points:24}],points:24}],matchups:[{id:'8',home:{teamId:'1',points:18},away:{teamId:'2',points:24}}]}};
 const a=app(async()=>{calls++;return Response.json(data);},{scores:true});a.saved.leagueId='123';a.saved.teamId='';a.render();await flush();a.render();
 assert.equal(calls,1);assert.equal(a.el('scoreTeam').disabled,false);assert.match(a.el('scoreTeam').innerHTML,/Team Two/);
 a.el('scoreTeam').onchange({target:{value:'2'}});assert.equal(a.saved.roster[0].name,'Justin Jefferson');assert.equal(a.el('fantasyTotal').textContent,'24.00');assert.equal(a.el('opponentTotal').textContent,'18.00');assert.equal(calls,1);
});
test('fantasy connection: editing followed players preserves league selection and official roster',()=>{
 const a=app();ready(a);a.saved.leagueId='123';a.saved.teamId='1';a.saved.league={leagueId:'123',teams:[{id:'1',name:'My ESPN team',players:[player]}]};
 a.el('lineupButton').onclick();a.el('rosterRows').children[0].querySelector('input').value='Other player';a.el('saveRoster').onclick();
 assert.equal(a.saved.leagueId,'123');assert.equal(a.saved.teamId,'1');assert.equal(a.saved.roster[0].name,'Other player');assert.equal(a.saved.league.teams[0].players[0].name,'Jonathan Taylor');
 assert.equal(JSON.parse(a.storage.get('fantasy-stream-v3')).leagueId,'123');assert.match(a.el('fantasyPlayers').innerHTML,/Jonathan Taylor/);
});
test('fantasy connection: a successful import displays players and points without a second request',async()=>{
 let calls=0;const a=app(async()=>{calls++;return Response.json({leagueId:'123',name:'League',ownedTeamId:'1',teams:[{id:'1',name:'My team',players:[player]}],scoring:{week:8,teams:[{id:'1',players:[{...player,points:18.5}],points:18.5}]}});},{scores:true});
 a.el('lineupButton').onclick();a.el('leagueId').value='123';await a.importLeague();a.render();
 assert.equal(calls,1);assert.equal(a.el('fantasyTotal').textContent,'18.50');assert.match(a.el('fantasyPlayers').innerHTML,/Jonathan Taylor/);assert.equal(a.el('scoreTeam').value,'1');
});
test('embed fallback: opening the original page follows the selected source and hides for native video',async()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/watch/primary'};a.saved.streamBackups={'IND-MIN':'https://example.test/watch/backup'};await Promise.all([...Object.values(a.saved.streams),...Object.values(a.saved.streamBackups)].map(u=>a.streamFinder.resolve(u)));a.selectGame('A');a.render();
 assert.equal(a.el('openStream').hidden,false);assert.equal(a.el('openStream').href,'https://example.test/watch/primary');assert.equal(a.el('embedHelp').hidden,false);
 a.el('nextStream').onclick();a.render();assert.equal(a.el('openStream').href,'https://example.test/watch/backup');
 a.pool.destroy();a.saved.streams={'IND-MIN':'https://example.test/live.mp4'};a.saved.streamBackups={};a.selectGame('A');a.render();assert.equal(a.el('openStream').hidden,true);assert.equal(a.el('embedHelp').hidden,true);
});

function discoveryReady(a){ready(a);const g={...game,teams:game.teams.map((t,i)=>({...t,name:i?'Minnesota Vikings':'Indianapolis Colts'}))};a.S.games=[g];a.S.live.games=[g];a.S.live.feed=new live.LiveFeed();a.S.live.feed.push([g],970);a.saved.leagueId='123';a.saved.teamId='1';return g;}
function discoveryResponse(url,token='published'){
 if(url.startsWith('/api/streams?'))return Response.json({sport:'nfl',entries:[{id:'match',sport:'nfl',title:'Indianapolis Colts vs Minnesota Vikings',start:Date.parse(game.date),sources:['https://ntv.st/watch/raptor/match?source=0']}]});
 return Response.json({page:new URL(url,'https://app.example').searchParams.get('url'),url:'https://ntv.st/embed?t='+token});
}
test('discovery: saved ESPN team starts with the published player and never frames the provider webpage',async()=>{
 const a=app(async u=>discoveryResponse(u),{media:true,embeds:true});discoveryReady(a);await a.refreshStreamLinks();a.step(a.time.now);assert.equal(a.S.playing,true);assert.equal(a.pool.get('A').url,'https://ntv.st/embed?t=published');assert.deepEqual(Object.keys(a.saved.streams),[]);assert.equal(a.el('openStream').href,'https://ntv.st/watch/raptor/match?source=0');
});
test('discovery: a late player lookup cannot override Pause',async()=>{
 const pending=deferred(),a=app(u=>u.startsWith('/api/streams?')?Promise.resolve(discoveryResponse(u)):pending.promise,{media:true,embeds:true});discoveryReady(a);const lookup=a.refreshStreamLinks();await flush();a.setPlaying(false);pending.resolve(discoveryResponse('/api/streams/resolve?url='+encodeURIComponent('https://ntv.st/watch/raptor/match?source=0')));await lookup;a.step(a.time.now);assert.equal(a.S.playing,false);assert.equal(a.pool.visible,null);
});
test('discovery: renewing the official embed token leaves a healthy fullscreen stream and manual choice intact',async()=>{
 let token='first';const a=app(async u=>discoveryResponse(u,token),{media:true,embeds:true});discoveryReady(a);await a.refreshStreamLinks();a.selectGame('A');const p=a.pool.current;p.element.emit('load');nativeFullscreen(a);await a.el('fullButton').onclick();const selection=a.S.selection;token='second';a.streamFinder.resolved.clear();a.streamFinder.catalogs.clear();await a.refreshStreamLinks();a.step(a.time.now);assert.equal(a.pool.current,p);assert.equal(a.S.selection,selection);assert.equal(a.page.fullscreenElement,a.stage);assert.equal(a.pool.get('A').url,'https://ntv.st/embed?t=first');
});
test('discovery: switching to replay while lookup is pending cannot reopen live playback',async()=>{
 const pending=deferred(),a=app(()=>pending.promise,{media:true,embeds:true});discoveryReady(a);const lookup=a.refreshStreamLinks();a.S.archive=new archive.ReplayArchive(archiveData);a.setMode('replay');pending.resolve(discoveryResponse('/api/streams?sport=nfl'));await lookup;assert.equal(a.S.mode,'replay');assert.equal(a.S.playing,false);assert.equal(a.pool.visible,null);
});
test('team dialog opens from the ribbon and closes after saving without losing ESPN connection',()=>{
 const a=app();ready(a);a.saved.leagueId='123';a.saved.teamId='1';a.saved.league={teams:[{id:'1',name:'My ESPN team',players:[player]}]};a.el('lineupButton').onclick();assert.equal(a.el('lineupDialog').open,true);assert.equal(a.el('lineupButton')['aria-expanded'],'true');a.el('saveRoster').onclick();assert.equal(a.el('lineupDialog').open,false);assert.equal(a.el('lineupButton')['aria-expanded'],'false');assert.equal(a.saved.leagueId,'123');assert.equal(a.saved.teamId,'1');
});

test('custom save replaces the playing automatic source even when it remains available as a backup',async()=>{
 const a=app(async u=>discoveryResponse(u),{media:true,embeds:true});discoveryReady(a);await a.refreshStreamLinks();a.selectGame('A');a.render();const old=a.pool.current;
 const fields=a.el('streamInputs').querySelectorAll('input');fields.find(i=>!i.dataset.backup).value='https://custom.example/embed/live';
 await a.el('saveStreams').onclick();a.step(a.time.now);
 assert.equal(old.destroyed,true);assert.equal(a.pool.get('A').url,'https://custom.example/embed/live');assert.ok(a.streamFinder.options(a.S.games[0]).length);assert.equal(a.S.pinned,'A');
 // Explicit automatic selection keeps the custom URL saved for later.
 a.el('streamsPanel').onclick({target:{closest:()=>({dataset:{sourceGame:'A',sourceMode:'auto'}})}});a.step(a.time.now);
 assert.equal(a.pool.get('A').url,'https://ntv.st/embed?t=published');assert.equal(a.saved.streams['IND-MIN'],'https://custom.example/embed/live');
});
test('a late custom page extraction respects Pause and a newer saved primary',async()=>{
 const pending=deferred(),a=app(url=>String(url).includes('/resolve?')?pending.promise:Promise.resolve(Response.json({events:[]})),{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://custom.example/embed/old'};a.selectGame('A');a.render();
 const field=a.el('streamInputs').querySelectorAll('input').find(i=>!i.dataset.backup);field.value='https://streamcorner.st/game';const older=a.el('saveStreams').onclick();const old=a.pool.current;
 a.setPlaying(false);field.value='https://custom.example/embed/new';await a.el('saveStreams').onclick();pending.resolve(Response.json({page:'https://streamcorner.st/game',url:'https://provider.example/embed/stale'}));await older;
 assert.equal(a.saved.streams['IND-MIN'],'https://custom.example/embed/new');assert.equal(a.S.playing,false);assert.equal(a.pool.visible,null);assert.equal(old.destroyed,true);
});
