import {StreamFinder,refusesFrame} from '../web/stream-finder.js';
import * as strip from '../web/strip.js';
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
import * as chat from '../web/chat.js';
import * as archiveBuild from '../web/archive-build.js';
const {PlayerPool}=await import(process.env.FANTASY_AUDIT_POOL||'../web/players.js');
import {EmbedPlayer} from '../web/embed-player.js';
import {ProviderPlayer} from '../web/provider-player.js';
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
function app(fetcher=async()=>Response.json({events:[]}),{media=false,native=false,embeds=false,scores=false,stored=null,storageBlocked=false,provider=null}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 elements.get('games').addEventListener=function(name,fn){(this.listeners??={})[name]=fn;};
 const pageEvents=new Map(),stage=new Element(),document={getElementById(id){assert.ok(elements.has(id),`Missing UI element: ${id}`);return elements.get(id);},querySelectorAll(){return [];},querySelector(selector){return selector==='.stage'?stage:new Element();},createElement(tag){return tag==='video'?new Video():new Element();},addEventListener(name,fn){if(!pageEvents.has(name))pageEvents.set(name,[]);pageEvents.get(name).push(fn);},body:new Element()};
 const time={now:1000},timers=new Map();let timerId=0;
 const frameEvents={};
 const frameFactory=()=>{const navigations=[];return ()=>{const f=new Video();let src;f.navigations=navigations;Object.defineProperty(f,'src',{get(){return src;},set(url){src=url;navigations.push(url);frameEvents.onNavigate?.(url,f);}});return f;};};
 class MediaPool extends PlayerPool{constructor(host,options){super(host,{...options,now:()=>time.now,create:source=>provider&&source.type==='provider/ok'?provider(source,time):embeds&&source.type==='embed/page'?new EmbedPlayer(source.url,{now:()=>time.now,createFrame:frameFactory(),autoReconnect:source.autoReconnect}):native?new ctx.Native(source):new Media(source)});}}
 const storage=new Map(stored===null?[]:[['fantasy-stream-v3',JSON.stringify(stored)]]);
 const ctx={StreamFinder,refusesFrame,...strip,...archive,...sync,...director,...coverage,...replays,...live,...scoring,...roster,...highlights,...preferences,...liveHighlights,...continuity,...breaks,...scoreboard,...chat,...archiveBuild,FantasyScoreFeed:class extends scoreboard.FantasyScoreFeed{constructor(){super({fetcher});}sync(connection,seed){this.connection=connection;if(scores)return super.sync(connection,seed);}},PlayerPool:media?MediaPool:Pool,NFLSourceCatalog:class{},document,window:{navigator:{onLine:true},addEventListener(){}},localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(storageBlocked)throw new Error('Storage unavailable');storage.set(key,value);}},performance:{now:()=>time.now},setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},setInterval:()=>0,fetch:fetcher,CSS:{escape:value=>String(value)},AbortSignal,AbortController,Response,URL,URLSearchParams,Date,console};
 vm.createContext(ctx);
 if(native){ctx.attachMediaSource=async()=>null;const code=readFileSync(new URL('../web/native-player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class NativePlayer','class NativePlayer');vm.runInContext(code+'\nglobalThis.Native=NativePlayer;',ctx);}
 vm.runInContext(script+'\n globalThis.a={S,pool,streamFinder,refreshStreamLinks,fantasyFeed,director,coverage,clock,step,frame,picture,target,openPastReplay,selectWeek,applyReplayLinks,loadReplayArchive,updateBreaks,advanceClock,skipBreak,selectGame,excluded,cutTo,warm,startHighlight,updateHighlight,finishHighlight,syncFor,nudge,nfl,setMode,setPlaying,setDay,seekTo,replaySource,useRoster,importLeague,pollLive,pollLiveClips,prepareReplay,retryMissedReplays,failHighlight,render,init,roster,get saved(){return saved;}};',ctx);
 return {...ctx.a,window:ctx.window,time,timers,storage,page:document,stage,frameEvents,emitPage(name,event={}){for(const fn of pageEvents.get(name)||[])fn(event);},network:ctx.window.navigator, get saved(){return ctx.a.saved;},el:id=>elements.get(id)};
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
 push([7,0],'next-drive',1040);assert.equal(a.pool.visible,null,'a brand-new play is not trusted until it has settled (the stream may run further behind than the delay)');
 push([7,0],'next-drive',1052);assert.equal(a.pool.visible,'A');
});
test('corrections: an overturned touchdown restores the live drive without releasing the viewer’s game',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;a.setPlaying(true);a.selectGame('A');
 const push=(score,at)=>{a.S.live.feed.push([{...game,score,lastPlayId:'td',down:3,yardsToGoal:4}],at);a.S.at=at;a.step(a.time.now+=250);};
 push([6,0],1005);assert.equal(a.S.games[0].celebrating,true);assert.equal(a.pool.visible,'A');
 push([0,0],1010);assert.equal(a.S.games[0].celebrating,undefined);assert.equal(a.S.games[0].possession,0);
 assert.equal(a.S.detectedBreaks.has('A'),false);assert.equal(a.S.pinned,'A');assert.equal(a.pool.visible,'A');
 push([0,0],1030);assert.equal(a.S.detectedBreaks.has('A'),false,'the cancelled score cannot create a commercial later');
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
// The archive is here and no lineup has been chosen: a first visit a moment after the page opens.
function sampleReady(a){a.S.archive=new archive.ReplayArchive(archiveData);a.S.day=1;const day=a.S.archive.sessions[1];a.clock.end=day.end;a.clock.seek(day.start,0);}
test('new viewers start in live mode, and the main button plays something instead of asking for a league',async()=>{
 const a=app(undefined,{media:true});sampleReady(a);a.render();assert.equal(a.S.mode,'live');assert.equal(a.roster().length,0);
 assert.equal(a.el('ovButton').textContent,'Watch the latest replay');assert.equal(a.el('ovGhost').textContent,'Connect ESPN');assert.equal(a.el('ovGhost').hidden,false);
 await a.el('ovButton').onclick();assert.equal(a.el('lineupDialog').open,undefined);assert.equal(a.S.mode,'replay');assert.equal(a.S.startOnLanding,true);
 a.frame(a.time.now);assert.equal(a.S.playing,true,'one click: no second button once the replay has landed');assert.equal(a.S.startOnLanding,false);
 const b=app();b.render();b.el('ovGhost').onclick();assert.equal(b.el('lineupDialog').open,true);assert.equal(b.S.started,false);assert.equal(b.el('rosterRows').children.length,1);
});
test('the first screen names a live game with a stream, and Play with no lineup plays it instead of opening the league form',()=>{
 const a=app(undefined,{media:true});a.S.live.games=[game];a.S.games=[game];a.S.live.feed.push([game],970);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.render();
 assert.equal(a.el('ovButton').textContent,'Watch IND @ MIN');a.setPlaying(true);assert.equal(a.S.pinned,'A');assert.equal(a.el('lineupDialog').open,undefined);
});
test('a first-click replay is dropped if the viewer presses Live before it lands',async()=>{
 const a=app();sampleReady(a);await a.el('ovButton').onclick();assert.equal(a.S.startOnLanding,true);await a.setMode('live');assert.equal(a.S.startOnLanding,false);a.frame(a.time.now);assert.equal(a.S.playing,false);
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
 const a=app(async url=>{if(url==='/week7.json')return new Response('',{status:404});return Response.json(String(url).includes('scoreboard')?{events:[]}:{clips:[]});});await a.init();await a.loadReplayArchive();
 assert.equal(a.S.mode,'live');assert.equal(a.el('replayMode').disabled,true);assert.equal(a.el('ovButton').hidden,false);
});
test('paused highlights retain their remaining playback time after resuming',()=>{
 const a=app();ready(a);a.S.playing=true;a.S.highlight={until:5000,since:800,item:{gameId:'A'},src:{}};a.setPlaying(false);assert.equal(a.S.pausedAt,1000);a.time.now=11000;a.setPlaying(true);assert.equal(a.S.highlight.until,15000);assert.equal(a.S.highlight.since,10800);
});
test('successful archive loading leaves live mode intact and prepares a valid replay clock',async()=>{
 const a=app(async url=>Response.json(url==='/week7.json'?archiveData:String(url).includes('scoreboard')?{events:[]}:{clips:[]}));await a.init();assert.ok([...a.timers.values()].some(t=>t.delay===1200),'the archive is scheduled after the live page is up');await a.loadReplayArchive();
 assert.equal(a.S.mode,'live');assert.ok(a.S.archive);assert.ok(a.clock.at>=a.S.archive.sessions[a.S.day].start);
});
test('viewing room: the first-visit replay shortcut enters replay and waits for the week to land',async()=>{
 const a=app(async url=>Response.json(url==='/week7.json'?archiveData:String(url).includes('scoreboard')?{events:[]}:{clips:[]}));a.saved.lineupReady=true;a.saved.teamName='My lineup';a.render();assert.equal(a.el('ovGhost').hidden,false,'the shortcut is there at once: it waits for the archive itself');await a.init();await a.loadReplayArchive();assert.equal(a.el('ovGhost').textContent,'Try a replay first');
 await a.el('ovGhost').onclick();assert.equal(a.S.mode,'replay');assert.equal(a.S.playing,false,'it starts once the week has landed');assert.equal(a.S.startOnLanding,true);assert.equal(a.el('replayControls').hidden,false);assert.match(a.el('streamsHelp').textContent,/No stream links needed/);assert.equal(a.el('ovGhost').hidden,true);
});
test('viewing room: switching back to live hides replay-only settings and restores stream instructions',async()=>{
 const a=app();replayReady(a);await a.setMode('replay');a.saved.dataOnly=true;a.render();assert.equal(a.el('speedControl').hidden,false);
 await a.setMode('live');assert.equal(a.el('replayControls').hidden,true);assert.equal(a.el('speedControl').hidden,true);assert.equal(a.el('channelMode').textContent,'Live games');assert.match(a.el('streamsHelp').textContent,/My link/);
});
test('viewing room: the fullscreen fallback has a working named exit',async()=>{
 const a=app();ready(a);await a.el('fullButton').onclick();assert.equal(a.el('fullButton').textContent,'Exit full screen');assert.equal(a.el('fullButton')['aria-label'],'Exit full screen');
 await a.el('fullButton').onclick();assert.equal(a.el('fullButton').textContent,'Full screen');
});
test('viewing room: selecting a game and returning to automatic switching have explicit labels',()=>{
 const a=app();ready(a);a.render();assert.match(a.el('games').html,/Jonathan Taylor/);assert.match(a.el('games').html,/Open the game tracker · add a stream for video/);
 a.el('games').onclick({target:{closest:()=>({dataset:{game:'A'}})}});assert.equal(a.S.pinned,'A');assert.equal(a.el('autoChip').textContent,'Your choice');assert.equal(a.el('pinCurrent').textContent,'Back to automatic');assert.match(a.el('games').html,/Your choice until a break · select again/);
 a.el('pinCurrent').onclick();assert.equal(a.S.pinned,null);assert.equal(a.el('autoChip').textContent,'Automatic');
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
test('audit: a tracker the viewer pinned holds when another roster game gains a stream, until its own break',()=>{
 const a=app(undefined,{media:true});ready(a);const other={...game,id:'B',name:'DAL @ NYG',teams:[{abbr:'DAL'},{abbr:'NYG'}]};
 a.useRoster([player,{name:'CeeDee Lamb',team:'DAL',position:'WR'}],{teamName:'My lineup'});a.saved.delay=0;a.S.live.feed.push([game,other],990);a.setPlaying(true);a.S.at=1000;a.step(a.time.now);a.selectGame('B');a.step(a.time.now);
 assert.equal(a.S.pinned,'B');assert.equal(a.S.program.id,'B');
 a.saved.streams={'IND-MIN':'https://example.com/a.mp4'};a.S.at=1001;a.step(a.time.now);
 assert.equal(a.excluded().has('B'),false,'the choice holds');assert.equal(a.S.pinned,'B');assert.equal(a.S.program.id,'B');assert.equal(a.pool.visible,null);
 a.S.live.feed.push([game,{...other,phase:'break',breakKind:'halftime'}],1002);a.S.at=1003;a.step(a.time.now);a.step(a.time.now);
 assert.equal(a.S.pinned,null,'its own break releases it');assert.equal(a.S.program.id,'A');assert.equal(a.excluded().has('B'),true,'unpinned, a tracker yields to the roster video again');
});
test('audit: the pinned tracker exemption also covers a video break elsewhere, and ends with the game',()=>{
 const a=app(undefined,{media:true});ready(a);const x={...game,id:'X',teams:[{abbr:'DAL'},{abbr:'NYG'}]},y={...game,id:'Y',teams:[{abbr:'SEA'},{abbr:'LAR'}]};
 a.S.games=[game,x,y];a.saved.streams={'DAL-NYG':'https://example.com/x.mp4','LAR-SEA':'https://example.com/y.mp4'};a.S.breaks.set('X',1e12);
 assert.equal(a.excluded().has('A'),true,'unpinned, a tracker yields to the backup video');
 a.S.pinned='A';assert.equal(a.excluded().has('A'),false,'a choice the viewer made holds');
 a.S.games=[{...game,state:'post',phase:'final'},x,y];assert.equal(a.excluded().has('A'),true,'a final is not worth holding a tracker for');
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
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://player.example/embed/a'};a.selectGame('A');
 const p=a.pool.current;a.time.now=2000;p.element.emit('load');a.time.now=4000;assert.equal(p.progressing,true);
 const spare=a.pool.open('spare',{url:'https://player.example/embed/b',type:'embed/page'}).player;
 a.coverage.watch('A',998,1000);const lineup=JSON.stringify(a.saved),cuts=a.S.cuts,choice=a.S.selection;
 a.S.stall={since:0,step:2};a.render();assert.equal(a.el('reloadStream').hidden,false);a.el('reloadStream').onclick();
 assert.equal(a.pool.current,p);assert.equal(p.loadedAt,null);assert.equal(a.S.stall,null);assert.equal(a.S.pinned,'A');assert.equal(a.S.selection,choice);assert.equal(a.S.cuts,cuts);
 assert.equal(JSON.stringify(a.saved),lineup);assert.equal(a.coverage.intervals.get('A').length,1);assert.equal(a.pool.get('spare').player,spare);assert.equal(spare.element.src,undefined);
 a.setPlaying(false);a.render();assert.equal(a.el('reloadStream').disabled,true);a.el('reloadStream').onclick();assert.equal(p.element.src,'about:blank');assert.equal(a.S.playing,false);
});
test('embed safety: repeated switches unload the outgoing page and retain the sandbox on return',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);
 const other={...game,id:'B',teams:[{abbr:'SEA'},{abbr:'SF'}]};a.S.games.push(other);a.S.live.games.push(other);a.S.live.feed.push(a.S.games,970);
 a.saved.streams={'IND-MIN':'https://player.example/embed/a','SEA-SF':'https://player.example/embed/b'};
 for(let i=0;i<16;i++){
  const id=i%2?'B':'A';a.selectGame(id);const current=a.pool.current;assert.equal(a.pool.visible,id,`switch ${i}: the new page must get its own load/recovery window`);assert.match(current.element.sandbox,/allow-scripts/);assert.equal(current.element.sandbox.includes('allow-popups'),false);
  for(const slot of a.pool.slots.values())if(slot.key!==id)assert.ok(!slot.player.element.src||slot.player.element.src==='about:blank');
  current.element.emit('load');a.time.now+=2000;assert.equal(current.progressing,true);
 }
});
test('embed recovery: a page that never loads retains the selected game through a long outage',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);const other={...game,id:'B',teams:[{abbr:'SEA'},{abbr:'SF'}]};
 a.useRoster([player,{name:'Other starter',team:'SEA',position:'WR'}],{teamName:'Two games'});a.S.games=[game,other];a.S.live.games=a.S.games;a.S.live.feed.push(a.S.games,970);
 a.saved.streams={'IND-MIN':'https://player.example/embed/a','SEA-SF':'https://example.test/b.mp4'};a.selectGame('A');const p=a.pool.current;
 for(const now of [16000,36000,66000,...Array.from({length:180},(_,i)=>126000+i*60000)]){
  a.time.now=now;a.step(now);assert.equal(a.pool.visible,'A','keep reconnecting the selected game');assert.equal(a.pool.current,p);
  assert.equal(a.S.cooldown.size,0);assert.equal(a.S.pinned,'A');assert.equal(a.S.started,true);assert.equal(a.S.playing,true);assert.equal(p.destroyed,false);
 }
 assert.equal(p.element.navigations.length,4,'three long retries, then the viewer is asked instead of an endless loop');assert.equal(p.gaveUp,true);a.render();assert.match(a.el('pictureNote').textContent,/Reload stream/);p.element.emit('load');a.time.now+=2000;a.step(a.time.now);assert.equal(p.progressing,true);assert.equal(a.pool.visible,'A');
});
test('embed safety: reload is unavailable for direct video and highlights',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.selectGame('A');a.render();assert.equal(a.el('reloadStream').hidden,true);
 const p=a.pool.current;a.el('reloadStream').onclick();assert.equal(a.pool.current,p);assert.equal(p.wantPlay,true);
});
test('embed recovery: the real app reconnects a loaded but unobservable stream without losing the manual choice',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.autoReconnect=true;a.saved.streams={'IND-MIN':'https://player.example/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 const choice=a.S.selection,lineup=JSON.stringify(a.saved),cuts=a.S.cuts;
 a.time.now=120999;a.step(a.time.now);assert.equal(p.element.navigations.length,1);
 a.time.now=121000;a.step(a.time.now);a.render();assert.equal(p.element.navigations.length,2);assert.match(a.el('pictureNote').textContent,/Refreshing stream connection/);
 assert.equal(a.pool.current,p);assert.equal(a.S.pinned,'A');assert.equal(a.S.selection,choice);assert.equal(a.S.cuts,cuts);assert.equal(JSON.stringify(a.saved),lineup);assert.equal(a.S.cooldown.size,0);assert.equal(a.coverage.intervals.size,0);
 p.element.emit('load');a.time.now=123000;a.step(a.time.now);assert.equal(p.progressing,true);assert.equal(a.S.pinned,'A');
});
test('embed recovery: Pause and hidden tabs suppress reconnects and resume gets a fresh deadline',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://player.example/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 a.setPlaying(false);const paused=p.element.navigations.length;a.time.now=1000000;a.step(a.time.now);assert.equal(p.element.navigations.length,paused);assert.equal(p.element.src,'about:blank');
 a.setPlaying(true);p.element.emit('load');a.step(a.time.now);assert.equal(p.element.navigations.length,paused+1);
 a.page.hidden=true;a.time.now+=1000;a.step(a.time.now);const hidden=p.element.navigations.length;a.time.now+=600000;a.step(a.time.now);assert.equal(p.element.navigations.length,hidden);
 a.page.hidden=false;a.step(a.time.now);assert.equal(p.element.navigations.length,hidden,'no burst of overdue refreshes');
});
test('embed recovery: network loss waits without exhausting retries and reconnects on restoration',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://player.example/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 a.network.onLine=false;a.time.now=2000;a.step(a.time.now);a.time.now=302000;a.step(a.time.now);assert.equal(p.element.navigations.length,1);assert.equal(a.S.cooldown.size,0);
 a.network.onLine=true;a.step(a.time.now);assert.equal(p.element.navigations.length,2);assert.equal(a.S.pinned,'A');assert.match(p.recoveryMessage,/Connection restored/);
});
test('embed recovery: the saved setting updates existing and newly opened players without an immediate reload',()=>{
 const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://player.example/embed?t=a'};a.selectGame('A');const p=a.pool.current;p.element.emit('load');
 a.el('optReconnect').onchange({target:{checked:false}});assert.equal(a.saved.autoReconnect,false);assert.equal(p.autoReconnect,false);assert.equal(JSON.parse(a.storage.get('fantasy-stream-v3')).autoReconnect,false);
 a.time.now=500000;a.step(a.time.now);assert.equal(p.element.navigations.length,1);
 a.pool.close('A');a.S.program={kind:'standby'};a.selectGame('A');const replacement=a.pool.current;assert.equal(replacement.autoReconnect,false);replacement.element.emit('load');
 a.el('optReconnect').onchange({target:{checked:true}});a.step(a.time.now);assert.equal(replacement.element.navigations.length,1);a.time.now+=120000;a.step(a.time.now);assert.equal(replacement.element.navigations.length,2);
});
function embeddedGame(){const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://player.example/embed?t=a'};a.selectGame('A');return a;}
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
 for(const host of ['streamcorner.st','sports.example']){
  const a=app(undefined,{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':`https://${host}/embed/game`};a.saved.streamBackups={'IND-MIN':'https://backup.example/embed/game'};a.selectGame('A');nativeFullscreen(a);await a.el('fullButton').onclick();
  const selection=a.S.selection,cuts=a.S.cuts;let last=a.pool.current,changes=0;const times=[];
  for(let now=1000;now<=600000;now+=250){
   a.time.now=now;a.step(now);assert.equal(a.pool.visible,'A');assert.equal(a.S.pinned,'A');assert.equal(a.S.selection,selection);assert.equal(a.S.cuts,cuts);assert.equal(a.S.cooldown.size,0);assert.equal(a.page.fullscreenElement,a.stage);
   if(a.pool.current!==last){assert.equal(last.destroyed,true);assert.equal(last.element.src,'about:blank');last=a.pool.current;changes++;times.push(now);}
  }
  assert.ok(changes>=4&&changes<=6,'rotate only after two long failed load windows, not every tick: '+changes);assert.ok(times.slice(1).every((t,i)=>t-times[i]>=100000),'rotations are spaced by the load windows');a.el('playButton').onclick();const p=a.pool.current,count=p.element.navigations.length;a.time.now+=600000;a.step(a.time.now);assert.equal(p.element.navigations.length,count);assert.equal(a.S.playing,false);
 }
});
test('site recovery: scheduled refresh does not rotate an unobservable loaded page to another source',()=>{
 const a=embeddedGame(),p=a.pool.current;a.saved.streamBackups={'IND-MIN':'https://backup.example/embed/game'};p.element.emit('load');a.time.now=121000;a.step(a.time.now);
 assert.equal(a.pool.current,p);assert.equal(p.destroyed,false);p.element.emit('load');a.time.now=123000;a.step(a.time.now);assert.equal(a.pool.current,p);assert.equal(a.S.streamChoices.size,0);
});
test('site recovery: manual backup switches retain lineup, coverage and selection and obey Pause',()=>{
 const a=embeddedGame();a.saved.streamBackups={'IND-MIN':'https://backup.example/embed/game'};a.coverage.watch('A',998,1000);const selection=a.S.selection,roster=JSON.stringify(a.saved.roster),first=a.pool.current;a.render();
 assert.equal(a.el('nextStream').hidden,false);a.el('nextStream').onclick();assert.equal(first.destroyed,true);assert.equal(a.pool.get('A').url,a.saved.streamBackups['IND-MIN']);assert.equal(a.el('nextStream').hidden,false);assert.equal(a.S.selection,selection);assert.equal(JSON.stringify(a.saved.roster),roster);assert.equal(a.coverage.intervals.get('A').length,1);
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
test('switching keeps the outgoing live stream playing until incoming footage is moving',()=>{
 const a=app(undefined,{media:true});ready(a);
 const b={...game,id:'B',name:'DAL @ NYG',teams:[{abbr:'DAL'},{abbr:'NYG'}]};a.S.games.push(b);
 a.saved.streams={'IND-MIN':'https://example.test/a.mp4','DAL-NYG':'https://example.test/b.mp4'};
 a.setPlaying(true);a.cutTo('A',1000);const outgoing=a.pool.current;
 const incoming=a.pool.open('B',{url:a.saved.streams['DAL-NYG']}).player;incoming.moving=false;
 a.cutTo('B',2000);assert.equal(a.pool.visible,'A');assert.equal(outgoing.progressing,true);assert.equal(incoming.wantPlay,true);
 a.cutTo('B',6000);assert.equal(a.pool.visible,'A');assert.equal(outgoing.progressing,true);
 incoming.moving=true;a.cutTo('B',6500);
 assert.equal(a.pool.visible,'B');assert.equal(incoming.progressing,true);assert.equal(outgoing.wantPlay,true);assert.equal(a.S.playing,true);assert.equal(a.S.pending,null);
 a.pool.destroy();
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
 assert.equal(a.S.breaks.size,1);assert.equal(a.S.program.kind,'standby');assert.equal(a.pool.visible,null);assert.equal(p.muted,true);assert.match(a.el('toast').textContent,/comes back in 90 seconds/);
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
test('game tiles: every game is listed, yours first, and live score updates leave the active stream intact',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/live.mp4'};a.setPlaying(true);a.cutTo('A',1000);
 const video=a.pool.current;a.S.live.games.push({...game,id:'B',name:'Other game',teams:[{abbr:'SEA'},{abbr:'SF'}]});a.S.games=a.S.live.games;a.render();
 const html=a.el('games').innerHTML;assert.match(html,/Other game/);assert.ok(html.indexOf('data-game="A"')<html.indexOf('data-game="B"'));
 a.S.live.games=[{...game,score:[24,17]}];a.S.games=a.S.live.games;a.render();assert.match(a.el('games').innerHTML,/>24</);assert.equal(a.pool.current,video);assert.equal(video.destroyed,undefined);
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
 const a=app();a.S.mode='replay';a.el('lineupButton').onclick();assert.equal(a.el('rosterRows').children.length,a.roster().length);assert.ok(a.roster().length>1);assert.match(a.el('lineupStatus').textContent,/sample team/);assert.match(a.el('playersState').textContent,/sample team/i);a.saved.lineupReady=true;a.saved.teamName='My lineup';a.el('lineupButton').onclick();assert.match(a.el('lineupStatus').textContent,/apply to replays only, not your live team/);
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
 assert.equal(a.pool.visible,'B');assert.match(a.S.decision.reason,/Best chance to score/);
 a.S.live.feed.push([game,other],970);a.step(1250);assert.equal(a.pool.visible,'A');
});
test('manual choice remains authoritative in RedZone mode until its natural break',()=>{
 const a=app(undefined,{media:true});ready(a);const mine={...game,state:'post',phase:'final'},selected={...game,id:'B',name:'SF at SEA',teams:[{abbr:'SF'},{abbr:'SEA'}],yardsToGoal:70},near={...game,id:'C',name:'BUF at MIA',teams:[{abbr:'BUF'},{abbr:'MIA'}],yardsToGoal:3};
 a.saved.streams={'SEA-SF':'https://example.test/selected.mp4','BUF-MIA':'https://example.test/near.mp4'};a.S.games=[mine,selected,near];a.S.live.feed.push(a.S.games,970);a.selectGame('B');a.step(1000);assert.equal(a.pool.visible,'B');assert.equal(a.S.pinned,'B');
 a.pool.current.emit('ad',true);a.step(1250);assert.equal(a.pool.visible,'C');assert.equal(a.S.pinned,null);
});


test('fantasy connection: the team selector stays visible and ESPN setup is directly reachable',()=>{
 const a=app();a.render();assert.equal(a.el('scoreTeamPicker').hidden,false);assert.equal(a.el('scoreTeam').disabled,true);
 a.el('lineupButton').onclick();assert.equal(a.el('lineupDialog').open,true);assert.equal(a.el('leagueImport').open,true);assert.equal(a.el('lineupDialog').dataset.connected,'false');
});
test('fantasy connection: saved players remain visible during loading and an expired-login response',async()=>{
 const pending=deferred(),a=app(()=>pending.promise,{scores:true});ready(a);a.saved.leagueId='123';a.saved.teamId='1';a.render();
 assert.equal(a.el('fantasyTable').hidden,false);assert.match(a.el('fantasyPlayers').innerHTML,/Jonathan Taylor/);assert.equal(a.el('fantasyTotal').textContent,'—');
 pending.resolve(Response.json({error:'Copy fresh ESPN cookies.',code:'ESPN_DENIED'},{status:401}));await flush();a.render();
 assert.match(a.el('fantasyPlayers').innerHTML,/Jonathan Taylor/);assert.match(a.el('fantasyStatus').textContent,/Reconnect ESPN/);assert.equal(a.el('retryFantasy').hidden,false);
 a.el('retryFantasy').onclick();assert.equal(a.el('lineupDialog').open,true);assert.equal(a.el('leagueImport').open,true);assert.equal(a.el('espnSwid').focused,true);
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
 if(url.startsWith('/api/streams?'))return Response.json({sport:'nfl',entries:[{id:'match',sport:'nfl',title:'Indianapolis Colts vs Minnesota Vikings',start:Date.parse(game.date),sources:['https://streamcorner.st/watch/match?source=0']}]});
 return Response.json({page:new URL(url,'https://app.example').searchParams.get('url'),url:'https://player.example/embed?t='+token});
}
test('discovery: saved ESPN team starts with the published player and never frames the provider webpage',async()=>{
 const a=app(async u=>discoveryResponse(u),{media:true,embeds:true});discoveryReady(a);await a.refreshStreamLinks();a.step(a.time.now);assert.equal(a.S.playing,true);assert.equal(a.pool.get('A').url,'https://player.example/embed?t=published');assert.deepEqual(Object.keys(a.saved.streams),[]);assert.equal(a.el('openStream').href,'https://streamcorner.st/watch/match?source=0');
});
test('discovery: a late player lookup cannot override Pause',async()=>{
 const pending=deferred(),a=app(u=>u.startsWith('/api/streams?')?Promise.resolve(discoveryResponse(u)):pending.promise,{media:true,embeds:true});discoveryReady(a);const lookup=a.refreshStreamLinks();await flush();a.setPlaying(false);pending.resolve(discoveryResponse('/api/streams/resolve?url='+encodeURIComponent('https://streamcorner.st/watch/match?source=0')));await lookup;a.step(a.time.now);assert.equal(a.S.playing,false);assert.equal(a.pool.visible,null);
});
test('discovery: renewing the official embed token leaves a healthy fullscreen stream and manual choice intact',async()=>{
 let token='first';const a=app(async u=>discoveryResponse(u,token),{media:true,embeds:true});discoveryReady(a);await a.refreshStreamLinks();a.selectGame('A');const p=a.pool.current;p.element.emit('load');nativeFullscreen(a);await a.el('fullButton').onclick();const selection=a.S.selection;token='second';a.streamFinder.resolved.clear();a.streamFinder.catalogs.clear();await a.refreshStreamLinks();a.step(a.time.now);assert.equal(a.pool.current,p);assert.equal(a.S.selection,selection);assert.equal(a.page.fullscreenElement,a.stage);assert.equal(a.pool.get('A').url,'https://player.example/embed?t=first');
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
 assert.equal(a.pool.get('A').url,'https://player.example/embed?t=published');assert.equal(a.saved.streams['IND-MIN'],'https://custom.example/embed/live');
});
test('a late custom page extraction respects Pause and a newer saved primary',async()=>{
 const pending=deferred(),a=app(url=>String(url).includes('/resolve?')?pending.promise:Promise.resolve(Response.json({events:[]})),{media:true,embeds:true});ready(a);a.saved.streams={'IND-MIN':'https://custom.example/embed/old'};a.selectGame('A');a.render();
 const field=a.el('streamInputs').querySelectorAll('input').find(i=>!i.dataset.backup);field.value='https://streamcorner.st/game';const older=a.el('saveStreams').onclick();const old=a.pool.current;
 a.setPlaying(false);field.value='https://custom.example/embed/new';await a.el('saveStreams').onclick();pending.resolve(Response.json({page:'https://streamcorner.st/game',url:'https://provider.example/embed/stale'}));await older;
 assert.equal(a.saved.streams['IND-MIN'],'https://custom.example/embed/new');assert.equal(a.S.playing,false);assert.equal(a.pool.visible,null);assert.equal(old.destroyed,true);
});

test('the Live dot is red only while an NFL game is in progress',()=>{
 const a=app();a.S.live.games=[];a.render();assert.equal(a.el('liveDot').classList.contains('on'),false);assert.match(a.el('liveMode').title,/Checking/);a.S.live.fetched=Date.now();a.render();assert.match(a.el('liveMode').title,/No NFL games/);
 a.S.live.games=[{id:'X',state:'in',name:'A @ B',teams:[{abbr:'IND'},{abbr:'MIN'}],score:[0,0],detail:'Q1'}];a.S.games=a.S.live.games;a.render();assert.equal(a.el('liveDot').classList.contains('on'),true);assert.match(a.el('liveMode').title,/1 NFL game live/);
});

test('Done in Streams leaves untouched games alone: no mode change, no saved blanks, no toast',()=>{
 const a=app();ready(a);a.render();a.saved.streamModes['IND-MIN']='NTV';
 const blank=new Element();blank.tag='input';blank.dataset.key='IND-MIN';blank.value='';a.el('streamInputs').children=[blank];a.el('backupInputs').children=[];
 a.el('saveStreams').onclick();assert.equal(a.saved.streamModes['IND-MIN'],'NTV');assert.equal(a.el('toast').hidden===false&&/Links saved/.test(a.el('toast').innerHTML),false);
});
test('Done in Fantasy team acts on a typed league ID instead of discarding it',()=>{
 let imported=0;const a=app(async()=>{imported++;return Response.json({error:'nope'},{status:400});});a.el('lineupButton').onclick();a.el('leagueId').value='123';a.el('saveRoster').onclick();assert.equal(imported,1);assert.equal(a.el('lineupDialog').open,true);
 a.el('leagueId').value='';a.el('saveRoster').onclick();assert.equal(a.el('lineupDialog').open,false);
 a.el('lineupButton').onclick();assert.equal(a.el('leagueImport').open,true);a.el('leagueAction').onclick();assert.equal(a.el('leagueImport').open,false);
});

// ---------- NFL replay: a game outside the calibrated week ----------
// A simulated ok.ru: real ProviderPlayers talk to it over the postMessage boundary the browser uses.
// Real ok.ru behaviour (when it reports, what an over-the-end seek does) is not exercised by any of this.
function okru(t,{length=8000,preroll=0,prerollLength=15,flagged=true}={}){
 const bus=new EventTarget(),sims=[];
 const realInterval=globalThis.setInterval;globalThis.setInterval=()=>({unref(){}});t.after(()=>{globalThis.setInterval=realInterval;});   // the test drives time
 const create=(source,time)=>{
  const element=new Element(),sim={source,element,time:0,moving:false,inited:false,ad:preroll,adTime:0,adFlagged:false,seeks:[],since:0};
  const send=data=>{const e=new Event('message');Object.assign(e,{origin:'https://ok.ru',source:element.contentWindow,data});bus.dispatchEvent(e);};
  sim.send=send;
  element.contentWindow={postMessage(m){
   if(m.action==='play')sim.moving=true;else if(m.action==='pause')sim.moving=false;
   else if(m.action==='seek'){sim.seeks.push(m.time);if(sim.ad<=0&&m.time<length)sim.time=m.time;}
  }};
  sim.tick=ms=>{
   if(!sim.inited){sim.inited=true;send({event:'inited'});return;}
   if(sim.player.error||!sim.moving)return;
   sim.since+=ms;if(sim.since<250)return;sim.since-=250;
   if(sim.ad>0){
    if(flagged&&!sim.adFlagged){sim.adFlagged=true;send({event:'adShown'});}
    sim.adTime+=.25;sim.ad-=.25;send({event:'timeupdate',time:sim.adTime,duration:prerollLength});return;
   }
   sim.time=Math.min(length,sim.time+.25);send({event:'timeupdate',time:sim.time,duration:length});
   if(sim.time>=length){sim.moving=false;send({event:'ended'});}
  };
  sim.player=new ProviderPlayer(source.url,{events:bus,now:()=>time.now,createFrame:()=>element,duration:source.duration});
  sims.push(sim);return sim.player;
 };
 const open=()=>sims.filter(sim=>!sim.element.removed);
 return {create,sims,open,bus,tick:ms=>{for(const sim of open())sim.tick(ms);}};
}
// Week 7's games with everything calibrated taken away: only the chosen game has a video, as a past-week game found on the listing would.
function uncalibrated(a,{id='401873014',team='IND',withVideo=true}={}){
 const data=structuredClone(archiveData);data.calibrated=false;
 for(const g of data.games){g.recordingDuration=0;g.anchors=[];if(g.id!==id||!withVideo)delete g.embed;}
 ready(a);a.S.mode='replay';a.S.archive=new archive.ReplayArchive(data);
 const g=a.S.archive.game(id);a.S.day=a.S.archive.sessions.findIndex(s=>s.gameIds.includes(id));
 a.useRoster([{name:'Jonathan Taylor',team,position:'RB'}],{teamName:'Replay'});a.clock.end=a.S.archive.sessions[a.S.day].end;a.clock.seek(g.start,0);
 return g;
}
const run=(a,sim,ms,each=null)=>{for(let left=ms;left>0;left-=100){a.time.now+=100;sim?.tick(100);a.frame(a.time.now);each?.();}};
const midGame=(g,share=.5)=>{const p=g.plays[Math.floor(g.plays.length*share)];return g.start+p[0];};

test('NFL replay: an uncalibrated game goes from a guessed length, through a pre-roll, to its real length with the sync rebuilt',t=>{
 const sim=okru(t,{length:8000,preroll:15,prerollLength:15}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a),at=midGame(g);
 a.saved.highlights=false;a.seekTo(at);a.setPlaying(true);run(a,sim,100);
 const guessed=a.syncFor(g).media(a.S.at-g.start);
 assert.equal(g.recordingDuration,11000);assert.equal(g.durationGuessed,true);assert.equal(sim.sims.length,1);
 const p=sim.sims[0].player;assert.equal(sim.sims[0].source.duration,undefined,'a guess is not handed over as a known length');assert.equal(p.knownDuration,false);assert.equal(Number.isNaN(p.duration),true);
 // The pre-roll: nothing is learned from it, the game is hidden and the clock keeps its place.
 run(a,sim,1000);assert.equal(a.S.ads.has(g.id),true);assert.equal(p.inAd,true);assert.equal(a.pool.visible,null);
 run(a,sim,12000);assert.equal(Number.isNaN(p.duration),true);assert.equal(g.durationGuessed,true);assert.equal(a.saved.replayDurations[g.id],undefined);assert.ok(Math.abs(a.S.at-at)<2,'the clock waits for the game to come back');
 // The recording itself reports: the real length replaces the guess and the sync is built on it.
 const before=sim.sims[0].seeks.length;run(a,sim,3000);
 assert.equal(p.inAd,false);assert.equal(a.S.ads.has(g.id),false);assert.equal(p.duration,8000);assert.equal(g.recordingDuration,8000);assert.equal(g.durationGuessed,false);assert.equal(a.saved.replayDurations[g.id],8000);
 assert.match(a.storage.get('fantasy-stream-v3'),/"replayDurations":\{"401873014":8000\}/);
 const real=a.syncFor(g),expected=real.media(a.S.at-g.start);assert.ok(Math.abs(expected-guessed)>300,`the guessed curve was ${guessed}, the real one ${expected}`);
 assert.ok(sim.sims[0].seeks.slice(before).some(time=>Math.abs(time-expected)<15),'the seek made on the guess is aimed again');
 // And it comes on screen, at the right footage, with no jump in game time.
 run(a,sim,4000);assert.equal(a.pool.visible,g.id);assert.equal(a.S.program.id,g.id);assert.equal(a.S.seekHold,false);assert.ok(Math.abs(p.currentTime-a.target(g.id))<5);assert.ok(Math.abs(a.S.at-at)<30,`the clock moved ${a.S.at-at}s`);
 assert.equal(sim.sims.length,1,'the pre-roll is not reloaded');assert.equal(a.S.cooldown.size,0);
 const clock=a.S.at;run(a,sim,5000);assert.ok(a.S.at>clock+3,'the picture drives the clock from here');assert.equal(a.pool.visible,g.id);
 a.pool.destroy();
});
test('NFL replay: a game whose real length is already known is told it, and learns nothing further',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);g.recordingDuration=7990;a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,sim,6000);
 assert.equal(sim.sims[0].source.duration,7990);assert.equal(sim.sims[0].player.knownDuration,true);assert.equal(g.recordingDuration,7990);assert.equal(a.saved.replayDurations[g.id],undefined);assert.equal(a.pool.visible,g.id);a.pool.destroy();
});
test('NFL replay: no provider source is told a guessed length: the game, its broadcast replay and the replay fallback',async t=>{
 const sim=okru(t),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.syncFor(g);assert.equal(g.durationGuessed,true);
 const score=g.scores[0],item={id:'x',gameId:g.id,score:{...score,text:'td'},at:g.start+score.t,credits:[]};
 const broadcast=await a.replaySource(item);assert.equal(broadcast.source.duration,undefined);
 a.coverage.log.push(item);const h={item,src:{key:'hl:x',label:'NFL.com highlight'},playing:false};a.S.highlight=h;a.failHighlight('no clip');assert.equal(a.S.sources.get('x').source.duration,undefined);
});
test('NFL replay: a length saved by an earlier release as the guess is dropped on load, a real one is kept',()=>{
 const a=app(undefined,{stored:{replayDurations:{'401873013':11000,'401873014':7400}}});
 assert.deepEqual({...a.saved.replayDurations},{'401873014':7400});
});
test('NFL replay: a guessed seek past the real end learns and lands instead of timing out',t=>{
 const sim=okru(t,{length:7000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a),at=midGame(g,.92);
 a.saved.highlights=false;a.seekTo(at);a.setPlaying(true);run(a,sim,100);assert.ok(a.syncFor(g).media(a.S.at-g.start)>7000,'the guess aims past the real end');
 run(a,sim,5000);assert.equal(g.recordingDuration,7000);assert.equal(a.pool.visible,g.id);assert.equal(a.S.cooldown.size,0);assert.ok(sim.sims[0].player.currentTime<7000);a.pool.destroy();
});
test('NFL replay: a player given the guess as its length teaches nothing',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.syncFor(g);
 a.pool.open(g.id,{url:g.embed,type:'provider/ok',duration:11000});run(a,sim,1000);assert.equal(g.durationGuessed,true);assert.equal(a.saved.replayDurations[g.id],undefined);a.pool.destroy();
});
test('NFL replay: a player that learned its length also teaches a game warming behind the one on air',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.syncFor(g);
 const slot=a.pool.open(g.id,{url:g.embed,type:'provider/ok'});a.pool.hold(g.id,a.target(g.id),{play:true});assert.equal(a.pool.visible,null);
 run(a,sim,1000);assert.equal(g.recordingDuration,8000);assert.equal(slot.player.duration,8000);a.pool.destroy();
});
test('NFL replay: learning one game keeps another game in its commercial, and re-cuts the replays queued on the guess',t=>{
 const sim=okru(t),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.syncFor(g);
 a.pool.open(g.id,{url:g.embed,type:'provider/ok'});a.pool.hold(g.id,a.target(g.id),{play:true});
 a.S.detectedBreaks.set('other',{kind:'timeout'});a.S.detectedBreaks.set(g.id,{kind:'timeout'});
 a.coverage.queue.push({id:'mine',gameId:g.id},{id:'theirs',gameId:'other'});a.S.sources.set('mine',{status:'ready',label:'Broadcast replay'});a.S.sources.set('theirs',{status:'ready',label:'Broadcast replay'});
 run(a,sim,600);assert.equal(g.durationGuessed,false);assert.equal(a.S.detectedBreaks.has('other'),true);assert.equal(a.S.detectedBreaks.has(g.id),false);assert.equal(a.S.sources.has('theirs'),true);assert.notEqual(a.S.sources.get('mine')?.status,'ready','prepared again on the real curve');a.coverage.queue.length=0;a.pool.destroy();
});
test('NFL replay: an ended report in the same breath as the length re-seeks instead of retiring the recording',t=>{
 const sim=okru(t,{length:7000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a),at=midGame(g,.92);a.saved.highlights=false;a.seekTo(at);a.setPlaying(true);a.time.now+=100;a.frame(a.time.now);
 const s=sim.sims[0];s.send({event:'inited'});s.inited=true;
 s.send({event:'timeupdate',time:0,duration:7000});s.send({event:'ended'});
 assert.equal(g.recordingDuration,7000);assert.equal(a.S.recordingEnds.size,0);assert.equal(s.player.element.removed,undefined);assert.ok(s.seeks.at(-1)<7000);a.pool.destroy();
});
test('NFL replay: an ended report left over from before a seek inside the file is ignored',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);g.recordingDuration=8000;a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,sim,5000);
 const s=sim.sims[0];assert.equal(a.pool.visible,g.id);s.player.seek(4000);s.send({event:'ended'});assert.equal(a.S.recordingEnds.size,0);assert.equal(a.pool.visible,g.id);a.pool.destroy();
});
// One game on the slate and one starter in it, with a player the test moves by hand.
function thursday(){
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.saved.highlights=false;a.useRoster([{name:'Drake Maye',team:'NE',position:'QB'}],{teamName:'Thursday'});
 a.setDay(0);const g=a.S.archive.game(a.S.archive.sessions[0].gameIds[0]);a.seekTo(g.start+Math.round((g.end-g.start)*.3));a.setPlaying(true);
 const move=ms=>{for(let left=ms;left>0;left-=250){a.time.now+=250;for(const slot of a.pool.slots.values())if(slot.player.progressing)slot.player.currentTime+=.25;a.advanceClock(a.time.now);a.step(a.time.now);}};
 for(let i=0;i<8&&a.pool.visible!==g.id;i++)move(250);
 assert.equal(a.pool.visible,g.id);
 return {a,g,move};
}
test('NFL replay: a recording that ends mid-game hands over to the tracker, with no cooldown and no reopening',()=>{
 const {a,g,move}=thursday();move(1000);const p=a.pool.current,at=a.S.at;
 p.emit('ended');assert.equal(a.S.cooldown.size,0);assert.equal(a.S.recordingEnds.get(g.id),at);assert.equal(p.destroyed,true);assert.equal(a.pool.visible,null);
 assert.match(a.el('toast').textContent,/recording ends here/);assert.equal(a.picture(g.id),'data');
 move(1000);assert.equal(a.S.program.kind,'game');assert.equal(a.S.program.id,g.id);assert.equal(a.pool.slots.size,0,'the same last frame is never opened again');
 move(120000);assert.equal(a.pool.slots.size,0);assert.equal(a.S.cooldown.size,0);assert.ok(a.S.at>at+100,'the tracker carries on');
});
test('NFL replay: seeking back before the end of a recording brings its video back',()=>{
 // Some of these land in a break and some on a play: the tracker has to give way to video from either.
 for(const back of [100,200,300,500,700,900,1100,1300]){
  const {a,g,move}=thursday();move(1000);const at=a.S.at;a.pool.current.emit('ended');move(2000);assert.equal(a.picture(g.id),'data');
  a.seekTo(at-back);assert.equal(a.picture(g.id),'video');move(3000);assert.equal(a.pool.visible,g.id,`${back}s back`);assert.ok(a.pool.current.progressing);assert.equal(a.S.program.id,g.id);assert.equal(a.S.seekHold,false);
 }
});
test('NFL replay: after the recording ends at the final whistle, Watch from kickoff still works',()=>{
 const {a,g,move}=thursday();a.seekTo(g.end-5);move(2000);const p=a.pool.current;if(p)p.emit('ended');move(10000);
 a.selectGame(g.id);assert.ok(Math.abs(a.S.at-g.start)<1);move(1000);assert.equal(a.pool.visible,g.id);assert.equal(a.S.program.id,g.id);
});
test('NFL replay: an ended report during an ad retires nothing',()=>{
 const {a,g,move}=thursday();move(1000);const p=a.pool.current;p.emit('ad',true);p.emit('ended');assert.equal(a.S.recordingEnds.size,0);assert.equal(p.destroyed,undefined);assert.equal(a.S.ads.has(g.id),true);
});
test('NFL replay: a score after the recording ended is shown as the play itself, not from the dead file',async()=>{
 const {a,g,move}=thursday();move(1000);const at=a.S.at;a.pool.current.emit('ended');const later=g.scores.find(s=>g.start+s.t>at);assert.ok(later);
 const src=await a.replaySource({id:'x',gameId:g.id,score:{...later,text:'td'},at:g.start+later.t,credits:[]});assert.equal(src.data,true);assert.equal(src.source,undefined);
});
test('NFL replay: changing the sync or the length forgets where the recording ended',()=>{
 const {a,g,move}=thursday();move(1000);a.pool.current.emit('ended');assert.equal(a.S.recordingEnds.size,1);a.el('syncGame').value=g.id;a.el('clearSync').onclick();assert.equal(a.S.recordingEnds.size,0);
});
test('NFL replay: the clock waits for a roster game coming back from a failure, so its plays are not skipped',()=>{
 const {a,g,move}=thursday();move(1000);const p=a.pool.current;p.emit('error',new Error('Broken'));assert.equal(a.S.program.kind,'standby');assert.equal(a.S.cooldown.has(g.id),true);const at=a.S.at;
 move(30000);assert.ok(Math.abs(a.S.at-at)<1,`the clock moved ${a.S.at-at}s during the cooldown`);
 move(32000);assert.equal(a.pool.visible,g.id,'the game came back');assert.ok(Math.abs(a.S.at-at)<3,`it came back ${a.S.at-at}s on`);
});
test('NFL replay: a video that never recovers cannot freeze the day: the hold has a cap',()=>{
 const {a,move}=thursday();move(1000);const at=a.S.at;
 for(let i=0;i<40;i++){for(const slot of [...a.pool.slots.values()])slot.player.emit('error',new Error('Dead'));move(10000);}
 assert.ok(a.S.at-at>=250,`the clock moved ${a.S.at-at}s in 400s`);
});
test('NFL replay: Skip break still lets the clock run past the commercial',()=>{
 const {a,g,move}=thursday();move(1000);a.skipBreak();assert.equal(a.S.program.kind,'standby');a.S.cooldown.set(g.id,a.time.now+60000);const at=a.S.at;move(10000);assert.ok(a.S.at-at>8,`the clock moved ${a.S.at-at}s`);
});
test('NFL replay: a hidden player in a long pre-roll is left to finish it, within a limit',t=>{
 const sim=okru(t,{length:8000,preroll:30,prerollLength:30}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);
 run(a,sim,45000);assert.equal(sim.sims.length,1,'not reloaded into another pre-roll');assert.equal(a.pool.visible,g.id);assert.equal(g.recordingDuration,8000);a.pool.destroy();
});
test('NFL replay: an ad that never ends is eventually given up on',t=>{
 const sim=okru(t,{length:8000,preroll:100000,prerollLength:30}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);
 run(a,sim,80000);assert.equal(sim.sims.length,1);run(a,sim,40000);assert.ok(sim.sims.length>1,'the wedged player was replaced');a.pool.destroy();
});
// ---------- a frame waiting for a click ----------
function waitingFrame(){
 const a=app(undefined,{media:true});replayReady(a);a.S.mode='replay';a.saved.highlights=false;a.useRoster([{name:'Drake Maye',team:'NE',position:'QB'}],{teamName:'Thursday'});a.setDay(0);
 const g=a.S.archive.game(a.S.archive.sessions[0].gameIds[0]);a.seekTo(g.start+Math.round((g.end-g.start)*.3));a.setPlaying(true);
 const p=a.pool.open(g.id,{url:g.embed,type:'provider/ok'}).player;p.kind='provider';p.initialized=true;p.moving=false;p.advances=0;
 const to=at=>{a.time.now=at;a.advanceClock(at);a.step(at);};
 for(let at=1250;!a.S.pending&&at<20000;at+=250)to(at);assert.equal(a.S.pending?.id,g.id);
 return {a,g,p,to,since:a.S.pending.since};
}
test('NFL replay: a frame waiting for a click stays up with its cue past the load limit, then gives up after CLICK_LIMIT',()=>{
 const {a,g,p,to,since}=waitingFrame();
 to(since+8250);assert.equal(a.pool.visible,g.id,'shown after 8s');assert.ok(a.S.pending);a.render();assert.match(a.el('switching').textContent,/press play inside it/);assert.equal(a.el('switching').hidden,false);
 for(const after of [14000,21000,31000,40000,60000,89000]){to(since+after);assert.equal(a.pool.visible,g.id,`still up after ${after}`);assert.equal(a.S.cooldown.has(g.id),false,`not cooled after ${after}`);}
 assert.equal(p.destroyed,undefined);
 to(since+91000);assert.equal(a.pool.visible,null);assert.equal(a.S.cooldown.has(g.id),true);assert.equal(a.S.unmuteHint,false);
});
test('NFL replay: the click starts the footage and commits one cut',()=>{
 const {a,g,p,to,since}=waitingFrame();
 to(since+8250);to(since+40000);assert.equal(a.pool.visible,g.id);assert.equal(a.S.cuts,0);
 p.moving=true;to(since+40250);assert.equal(a.S.pending,null);assert.equal(a.S.cuts,1);assert.equal(a.S.unmuteHint,false);to(since+40500);assert.equal(a.S.cuts,1);
});
test('NFL replay: a frame that never said it is ready keeps the short limit, and an error ends the wait at once',()=>{
 const silent=waitingFrame();silent.p.initialized=false;silent.to(silent.since+8250);assert.equal(silent.a.pool.visible,silent.g.id);silent.to(silent.since+21000);assert.equal(silent.a.pool.visible,null);assert.equal(silent.a.S.cooldown.has(silent.g.id),true);
 const broken=waitingFrame();broken.to(broken.since+8250);broken.to(broken.since+30000);assert.equal(broken.a.pool.visible,broken.g.id);broken.p.emit('error',new Error('Removed'));assert.equal(broken.a.pool.visible,null);assert.equal(broken.a.S.cooldown.has(broken.g.id),true);
});
// ---------- the hold after a scrub ----------
test('NFL replay: a scrub landing a few seconds off releases the hold once the footage moves',()=>{
 const {a,move}=thursday();move(1000);const p=a.pool.current,to=a.S.at+200;a.seekTo(to);assert.equal(a.S.seekHold,true);
 p.currentTime=to-a.S.archive.game(a.S.program.id).start;const mapped=a.target(a.S.program.id);
 p.target=mapped;p.currentTime=mapped+4;a.time.now+=100;a.advanceClock(a.time.now);assert.equal(a.S.seekHold,true,'the seek has not landed');
 p.target=null;p.inAd=true;a.time.now+=100;a.advanceClock(a.time.now);assert.equal(a.S.seekHold,true,'an ad is not footage');p.inAd=false;
 p.moving=false;a.time.now+=100;a.advanceClock(a.time.now);assert.equal(a.S.seekHold,true,'stopped is not moving');
 p.moving=true;a.time.now+=100;a.advanceClock(a.time.now);assert.equal(a.S.seekHold,false);assert.ok(a.S.at>to,'the clock follows the picture');
});
test('NFL replay: a cut opened during the hold is not led against the stopped clock',t=>{
 const sim=okru(t),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);g.recordingDuration=8000;a.saved.highlights=false;a.seekTo(midGame(g));a.S.seekHold=true;a.S.started=true;a.S.playing=true;a.S.program={kind:'standby'};
 a.cutTo(g.id,a.time.now);const want=a.target(g.id);assert.equal(sim.sims[0].player.target,want);a.pool.destroy();
});
// ---------- which week Replay opens on ----------
function weekFetcher({board=async()=>({season:{year:2026},week:{number:9},events:[]}),replays=async()=>({games:[]}),weekBoard=async()=>({events:[]})}={}){
 const calls=[];
 const fetcher=async url=>{url=String(url);calls.push(url);
  if(url==='/week7.json')return Response.json(archiveData);if(url==='/nfl-highlights.json')return Response.json({clips:[]});
  if(url.startsWith('/api/nfl-replays'))return Response.json(await replays());
  if(url.includes('scoreboard?dates='))return Response.json(await weekBoard(url));
  if(url.includes('scoreboard'))return Response.json(await board());
  return Response.json({events:[]});};
 return {fetcher,calls,built:()=>calls.filter(u=>u.startsWith('/api/nfl-replays')||u.includes('summary?event='))};
}
const week8=()=>JSON.stringify({...structuredClone(archiveData),week:8,title:'Week 8',version:2});
const settle=async()=>{for(let i=0;i<8;i++)await flush();};
test('Replay week: a Live page lists the weeks and builds no week until someone comes for it',async()=>{
 const f=weekFetcher(),a=app(f.fetcher);await a.loadReplayArchive();await settle();
 assert.equal(a.S.weeks.latest,8);assert.equal(a.S.archiveKey,'w7');assert.equal(f.built().length,0);assert.equal(a.S.archives.has('w8'),false);assert.match(a.el('weekSelect').innerHTML,/Week 8 · latest/);
 assert.ok(f.calls.some(u=>u.includes('scoreboard?dates=')),'the past-week tiles still load');
});
test('Replay week: entering Replay says the latest week is loading, then lands on it',async()=>{
 const held=deferred(),f=weekFetcher({replays:()=>held.promise}),a=app(f.fetcher);a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 await a.setMode('replay');await settle();
 assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.weeks.landing,8);assert.match(a.el('ovTitle').innerHTML,/Getting Week 8 ready/);assert.equal(a.el('overlay').hidden,false);assert.match(a.el('games').innerHTML,/Getting Week 8 ready/);assert.equal(a.el('weekSelect').value,'w8');assert.match(a.el('ovButton').textContent,/Week 7 instead/);
 held.resolve({games:[]});await settle();
 assert.equal(a.S.archiveKey,'w8');assert.equal(a.S.weeks.landing,0);assert.equal(a.el('weekSelect').value,'w8');assert.match(a.el('ovEyebrow').textContent,/WEEK 8 REPLAY/);assert.equal(a.el('ovButton').textContent,'Watch replay');assert.equal(a.S.playing,false);
});
test('Replay week: opened before ESPN answers, the page says so and lands as soon as the week is known',async()=>{
 const list=deferred(),f=weekFetcher({board:()=>list.promise}),a=app(f.fetcher);a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await a.setMode('replay');await flush();
 assert.equal(a.S.weeks.landing,-1);assert.match(a.el('ovTitle').innerHTML,/Finding the latest week/);
 list.resolve({season:{year:2026},week:{number:9},events:[]});await settle();assert.equal(a.S.archiveKey,'w8');assert.equal(a.S.weeks.landing,0);
});
test('Replay week: if the latest week fails, the calibrated Week 7 is the replay, and the next visit tries again',async()=>{
 let fail=true;const f=weekFetcher({weekBoard:async()=>{if(fail)throw new Error('ESPN unavailable');return {events:[]};}}),a=app(async url=>{if(fail&&String(url).includes('scoreboard?dates='))return new Response('',{status:503});return f.fetcher(url);});await a.loadReplayArchive();await settle();
 await a.setMode('replay');await settle();
 assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.weeks.landing,0);assert.equal(a.el('ovButton').textContent,'Watch replay');assert.match(a.el('toast').textContent,/Week 8 isn’t available/);assert.equal(a.el('weekSelect').value,'w7');assert.match(a.el('weekSelect').innerHTML,/Week 8 · latest · unavailable/);
 fail=false;a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.setMode('live');await a.setMode('replay');await settle();assert.equal(a.S.archiveKey,'w8');
});
test('Replay week: a replay started while the latest week loads stays on screen, and the week joins the list',async()=>{
 const held=deferred(),f=weekFetcher({replays:()=>held.promise}),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 await a.setMode('replay');await settle();a.useRoster(roster.SAMPLE,{teamName:'Replay'});a.el('ovButton').onclick();const id=a.S.games.find(g=>g.state==='in')?.id||a.S.archive.sessions[a.S.day].gameIds[0];a.selectGame(id);assert.equal(a.S.weeks.landing,0);const program={...a.S.program},at=a.S.at;
 held.resolve({games:[]});await settle();
 assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.pinned,id);assert.equal(a.S.playing,true);assert.deepEqual({...a.S.program},program);assert.equal(a.S.at,at);assert.equal(a.S.archives.has('w8'),true);assert.equal(a.pool.destroyed,undefined);
});
test('Replay week: a replay started before the week list answers is left alone too',async()=>{
 const list=deferred(),f=weekFetcher({board:()=>list.promise}),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await a.setMode('replay');await flush();
 a.el('ovButton').onclick();assert.equal(a.S.playing,true);
 list.resolve({season:{year:2026},week:{number:9},events:[]});await settle();assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.playing,true);assert.equal(f.built().length,0,'nothing is built for a viewer who chose');
});
test('Replay week: watching Week 7, a trip to Live and back keeps the week and the place',async()=>{
 const f=weekFetcher(),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 await a.setMode('replay');a.el('ovButton').onclick();await settle();assert.equal(a.S.archiveKey,'w7');const at=a.S.at;
 await a.setMode('live');await settle();await a.setMode('replay');await settle();assert.equal(a.S.archiveKey,'w7');assert.ok(Math.abs(a.S.at-at)<1);
});
test('Replay week: choosing a week in the list still switches, even mid-play',async()=>{
 const f=weekFetcher(),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();await a.setMode('replay');a.el('ovButton').onclick();await settle();assert.equal(a.S.archiveKey,'w7');
 a.el('weekSelect').onchange({target:{value:'w8'}});await settle();assert.equal(a.S.archiveKey,'w8');
});
test('Replay week: picking a day while the latest week loads is a choice too',async()=>{
 const held=deferred(),f=weekFetcher({replays:()=>held.promise}),a=app(f.fetcher);a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();await a.setMode('replay');await settle();assert.equal(a.S.weeks.landing,8);
 a.el('daySelect').onchange({target:{value:'0'}});assert.equal(a.S.day,0);assert.equal(a.S.weeks.landing,0);held.resolve({games:[]});await settle();assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.day,0);
});
test('Replay week: a past tile opens its own week, with a loading cue, and never lands on the latest afterwards',async()=>{
 const held=deferred(),f=weekFetcher({replays:()=>held.promise}),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 const opening=a.openPastReplay(8,archiveData.games[0].id);await settle();assert.equal(a.S.mode,'replay');assert.equal(a.S.weeks.landing,8);assert.match(a.el('ovTitle').innerHTML,/Getting Week 8 ready/);assert.equal(a.el('ovButton').hidden,true);
 held.resolve({games:[]});await opening;await settle();assert.equal(a.S.archiveKey,'w8');assert.equal(a.S.pinned,archiveData.games[0].id);assert.equal(a.S.weekChosen,true);assert.equal(a.S.weeks.landing,0);
});
test('Replay week: a past tile that cannot load says so and leaves no loading cue behind',async()=>{
 const f=weekFetcher(),a=app(async url=>{if(String(url).includes('scoreboard?dates='))return new Response('',{status:503});return f.fetcher(url);},{media:true});await a.loadReplayArchive();await settle();
 await a.openPastReplay(3,'nope');await settle();assert.equal(a.S.weeks.landing,0);assert.match(a.el('toast').textContent,/Week 3's replay is unavailable/);assert.equal(a.S.archiveKey,'w7');assert.equal(a.el('ovButton').hidden,false);
});

// ---------- the live feed: outages, waking up, gaps, late tries ----------
const quietFeed=(a,o={},until=1000)=>{const g=extra=>({...game,lastPlayId:'p1',clock:'10:00',period:1,score:[7,0],scoreKnown:true,...o,...extra});a.S.live.feed=new live.LiveFeed();a.S.live.feed.push([g({lastPlayId:'p0'})],955);for(let t=960;t<=until;t+=5)a.S.live.feed.push([g()],t);return g;};
const stepTo=(a,at)=>{a.S.at=at;a.time.now=(at-1000)*1000+1000;a.S.lastAt=at-1;a.step(a.time.now);};
test('outage: a frozen scoreboard leaves a direct stream and a manual choice on screen, through the delay after ESPN returns',()=>{
 for(const delay of [0,30])for(const back of [1085,1125]){
  const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=delay;const g=quietFeed(a);a.setPlaying(true);a.S.at=1000;a.selectGame('A');a.S.live.fetched=Date.now();const video=a.pool.current,on=at=>`delay ${delay}, back ${back}, at ${at}`;
  for(let at=1005;at<back;at+=5){a.S.live.fetched=Date.now()-(at-1000)*1000;stepTo(a,at);assert.equal(a.pool.visible,'A',on(at));assert.equal(a.S.program.kind,'game');assert.equal(a.S.pinned,'A');assert.equal(a.S.detectedBreaks.has('A'),false);}
  a.S.live.fetched=Date.now();a.S.live.feed.push([g({lastPlayId:'p2'})],back);
  for(let at=back;at<=back+delay+10;at+=5){a.S.live.feed.push([g({lastPlayId:'p2'})],at);stepTo(a,at);assert.equal(a.pool.visible,'A',on(at));assert.equal(a.S.pinned,'A');}
  assert.equal(a.pool.current,video,'never reopened');assert.equal(video.destroyed,undefined);
 }
});
test('outage: a website embed is not dimmed as a break while the scoreboard is frozen',()=>{
 const a=embeddedGame();a.saved.delay=0;quietFeed(a,{score:[0,0]});a.S.at=1000;a.pool.current.element.emit('load');
 for(let t=1005;t<=1120;t+=5){stepTo(a,t);assert.equal(a.S.dimmed,null,`t=${t}`);assert.equal(a.pool.visible,'A');}
});
test('waking: a score from the gap is not a Score on the field, and a quiet game is not a stoppage',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;const g=quietFeed(a);a.setPlaying(true);stepTo(a,1000);assert.equal(a.pool.visible,'A');
 a.S.live.fetched=Date.now();a.S.live.feed.push([g()],1300);for(const t of [1300,1305,1330,1400]){stepTo(a,t);assert.equal(a.pool.visible,'A',`no score, t=${t}`);}
 const b=app(undefined,{media:true});ready(b);b.saved.streams={'IND-MIN':'https://example.test/a.mp4'};b.saved.delay=0;const h=quietFeed(b);b.setPlaying(true);stepTo(b,1000);
 b.S.live.fetched=Date.now();b.S.live.feed.push([h({lastPlayId:'late',score:[14,0]})],1300);for(const t of [1300,1305,1320]){stepTo(b,t);assert.doesNotMatch(b.S.decision.reason||'',/Score on the field/);assert.equal(b.S.games[0].celebrating,undefined);}
 b.S.live.feed.push([h({lastPlayId:'next',score:[14,0]})],1330);stepTo(b,1345);assert.equal(b.pool.visible,'A','the next settled play brings it back');
});
test('tries: a late extra point cannot bring the commercial back on screen',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;const g=quietFeed(a,{score:[0,0]},1000);a.setPlaying(true);stepTo(a,1000);
 const at=(t,o)=>{a.S.live.feed.push([g(o)],t);stepTo(a,t);};
 at(1005,{lastPlayId:'td',score:[6,0]});assert.equal(a.pool.visible,'A','the score stays on screen');assert.equal(a.S.games[0].celebrating,true);
 for(let t=1010;t<=1025;t+=5)at(t,{lastPlayId:'td',score:[6,0]});assert.equal(a.pool.visible,null,'then the commercial');
 for(let t=1030;t<=1060;t+=5)at(t,{lastPlayId:'td',score:[6,0]});
 for(let t=1065;t<=1090;t+=5){at(t,{lastPlayId:'td',score:[7,0]});assert.equal(a.pool.visible,null,`t=${t}`);assert.equal(a.S.games[0].celebrating,undefined);}
});
test('gaps: one response without the chosen game keeps the choice and the picture',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;a.selectGame('A');const video=a.pool.current;
 a.S.live.feed.push([],1005);stepTo(a,1005);assert.equal(a.S.pinned,'A');assert.equal(a.pool.visible,'A');
 a.S.live.feed.push([game],1010);stepTo(a,1010);assert.equal(a.S.pinned,'A');assert.equal(a.pool.visible,'A');assert.equal(a.pool.current,video);
});
test('gaps: the guide and the 5 s poll survive a response that leaves the game out',async()=>{
 let events=[feedEvent('A')];const a=app(async()=>Response.json({events}));ready(a);await a.pollLive(0);events=[];a.timers.clear();await a.pollLive(0);
 assert.deepEqual(a.S.live.games.map(g=>g.id),['A']);assert.ok([...a.timers.values()].some(t=>t.delay===5000));
});
function liveScore(a,at){a.S.live.feed.push([{...game,teams:[{id:'11',abbr:'IND',abbreviation:'IND'},{id:'16',abbr:'MIN',abbreviation:'MIN'}]}],a.S.at);a.S.live.scores.set('A',[{id:'A:td',at,team:0,kind:'TD',text:'Jonathan Taylor 4 Yd Rush',players:[{name:'Jonathan Taylor',role:'scorer'}]}]);}
test('logic: a page embed counts as watched only on a recent click inside the document on screen',()=>{
 const run=before=>{const a=embeddedGame();a.saved.delay=0;a.S.at=1000;a.S.coverageStart=999;const p=a.pool.current;p.element.emit('load');a.time.now+=2000;before(p,a);liveScore(a,1005);for(let t=1001;t<=1030;t++){a.S.at=t;a.time.now+=1000;a.step(a.time.now);}return a.coverage.log[0];};
 const clicked=run(p=>p.noteInteraction());assert.equal(clicked.seen,true);assert.equal(clicked.queued,false);
 const untouched=run(()=>{});assert.equal(untouched.seen,false);assert.equal(untouched.queued,true);
 const reloaded=run((p,a)=>{p.noteInteraction();p.reload();p.element.emit('load');a.time.now+=2000;});assert.equal(reloaded.seen,false);assert.equal(reloaded.queued,true);
 const stale=run((p,a)=>{p.noteInteraction();a.time.now+=600000;});assert.equal(stale.seen,false);assert.equal(stale.queued,true);
});
test('corrections: a yardage edit lets the replay on air finish, without restarting or re-announcing it',async()=>{
 const {a,entry,poll,summary}=await correctionFixture();a.setPlaying(true);a.startHighlight(entry.id);a.updateHighlight(1000);const h=a.S.highlight,p=a.pool.current;entry.watchUrl='https://www.espn.com/nfl/video/clip/_/id/1';
 await poll({...summary,scoringPlays:[{...summary.scoringPlays[0],text:'Jonathan Taylor 5 Yd Rush'}]});
 assert.equal(a.S.highlight,h);assert.equal(a.pool.current,p);assert.equal(p.destroyed,undefined);assert.equal(h.done,false);assert.equal(a.S.sources.get(entry.id),h.src);assert.match(entry.score.text,/5 Yd/);assert.equal(entry.watchUrl,'https://www.espn.com/nfl/video/clip/_/id/1');
 const log=a.coverage.log.length;a.step(1250);assert.equal(a.S.highlight,h);assert.equal(a.coverage.queue.length,0);assert.equal(a.coverage.log.length,log);
});
test('corrections: an edit that changes the play still closes the replay on air',async()=>{
 const {a,entry,poll,summary}=await correctionFixture();a.setPlaying(true);a.startHighlight(entry.id);a.updateHighlight(1000);
 await poll({...summary,scoringPlays:[{...summary.scoringPlays[0],text:'Josh Downs 4 Yd Pass From Daniel Jones'}]});
 assert.equal(a.S.highlight,null);assert.equal(a.S.sources.has(entry.id),false);
});
test('kickoff: the scoreboard polls every 5 s around a listed kickoff, and falls back when a game stays pre',async()=>{
 const delay=async(date,failing=false)=>{const event={...feedEvent('A'),date};event.competitions[0].status.type.state='pre';let calls=0;const a=app(async()=>{if(failing&&++calls>1)throw new Error('down');return Response.json({events:[event]});});ready(a);a.S.live.games=[];a.S.live.feed=new live.LiveFeed();await a.pollLive(0);a.timers.clear();if(failing)await a.pollLive(0);else await a.pollLive(0);return [...a.timers.values()].map(t=>t.delay).filter(d=>[5000,30000].includes(d));};
 const from=minutes=>new Date(Date.now()+minutes*60000).toISOString();
 assert.deepEqual(await delay(from(2)),[5000]);assert.deepEqual(await delay(from(-5)),[5000],'a late start');
 assert.deepEqual(await delay(from(300)),[30000]);assert.deepEqual(await delay(from(-300)),[30000],'stuck in pre');assert.deepEqual(await delay(undefined),[30000],'no listed time');
 assert.deepEqual(await delay(from(2),true),[5000],'a failed poll near kickoff retries fast');
});
test('score display: a blank scoreboard poll keeps the last tally in the bug and the tracker',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;a.S.live.feed=new live.LiveFeed();const g=o=>({...game,scoreKnown:true,score:[14,3],...o});a.S.live.feed.push([g()],1000);a.setPlaying(true);stepTo(a,1000);a.render();assert.match(a.el('bugGame').innerHTML,/<b>14<\/b>.*<b>3<\/b>/);
 a.S.live.feed.push([g({score:[0,0],scoreKnown:false})],1005);stepTo(a,1005);a.render();assert.equal(a.S.games[0].scoreKnown,false);assert.match(a.el('bugGame').innerHTML,/<b>14<\/b>.*<b>3<\/b>/);
});

test('the strip arrows chain only while their own scroll is moving, and a stale target cannot move the strip',()=>{
 const a=app(),list=a.el('games');Object.assign(list,{scrollWidth:5000,clientWidth:1000,scrollLeft:0,scrollTo(o){this.went=o.left;}});
 a.el('stripNext').onclick();assert.equal(list.went,800);list.scrollLeft=200;a.el('stripNext').onclick();assert.equal(list.went,1600,'a quick second click carries on from the first target');
 a.S.stripStartedAt-=701;list.scrollLeft=100;a.el('stripNext').onclick();assert.equal(list.went,900,'with no scrollend the target expires by time');
 a.S.stripStartedAt-=701;list.scrollLeft=4000;a.el('stripPrev').onclick();assert.equal(list.went,3200);
 for(const name of ['scrollend','pointerdown','touchstart']){a.S.stripTarget=3000;list.listeners[name]();assert.equal(a.S.stripTarget,null,name);}
 a.S.stripTarget=3000;list.listeners.wheel({deltaX:5,deltaY:0,preventDefault(){}});assert.equal(a.S.stripTarget,null,'a sideways swipe counts as well');
});

// ---------- render cost: past tiles built once, the strip patched, text and requests not repeated ----------
const stripDOM=list=>{let items=[];const writes=[];Object.defineProperty(list,'innerHTML',{configurable:true,set(value){writes.push(value);items=value.split(/(?=<li )/);},get(){return items.join('');}});Object.defineProperty(list,'children',{configurable:true,get(){return items;}});Object.defineProperty(list,'lastElementChild',{configurable:true,get(){return {remove(){items.pop();}};}});list.insertAdjacentHTML=(_,html)=>{items.push(...html.split(/(?=<li )/));};return writes;};
const pastGame=(id='P',counter={n:0})=>({id,date:'2026-09-13T17:00Z',name:'IND at MIN',get detail(){counter.n++;return 'Final';},teams:[{abbr:'IND',name:'Indianapolis Colts',score:'24'},{abbr:'MIN',name:'Minnesota Vikings',score:'17'}]});
test('strip: past tiles are built once per set of weeks and lineup, and rendering again leaves them alone',()=>{
 const a=app();ready(a);const built={n:0},weeks=[{week:1,games:[pastGame('P',built)]}];a.S.pastWeeks=weeks;a.S.weeks.current=2;
 a.render();assert.equal(built.n,1);assert.match(a.el('games').innerHTML,/data-past-week="1"/);assert.match(a.el('games').innerHTML,/Week 2</);
 for(let i=0;i<5;i++)a.render();assert.equal(built.n,1,'five more renders built nothing');
 a.S.live.games=[...a.S.live.games];a.S.games=a.S.live.games;a.render();assert.equal(built.n,1,'a new poll is not a new season');
 a.useRoster([{name:'Justin Jefferson',team:'MIN',position:'WR'}],{teamName:'Other',teamId:'2'});a.render();assert.equal(built.n,2,'a new lineup marks different tiles');assert.match(a.el('games').innerHTML,/Justin Jefferson/);
 a.S.pastWeeks=[...weeks,{week:2,games:[pastGame('Q',built)]}];a.S.weeks.current=3;a.render();assert.equal(built.n,4,'a new week rebuilds the run');assert.match(a.el('games').innerHTML,/data-past-week="2"/);assert.match(a.el('games').innerHTML,/Week 3</);
});
test('strip: when only this week changes, the past tiles stay in the page and this week is replaced after them',()=>{
 const a=app();ready(a);const writes=stripDOM(a.el('games'));a.S.pastWeeks=[{week:1,games:[pastGame()]}];a.S.weeks.current=2;
 a.render();assert.equal(writes.length,1,'the first render writes the whole strip');const past=a.el('games').children.slice(0,3);
 a.S.live.games=[{...game,score:[24,17]}];a.S.games=a.S.live.games;a.render();
 assert.equal(writes.length,1,'the past tiles were not written again');assert.deepEqual(a.el('games').children.slice(0,3),past);assert.equal(a.el('games').children.length,4);assert.match(a.el('games').innerHTML,/>24</);
 a.render();assert.equal(a.el('games').children.length,4,'nothing changed, nothing moved');
 a.S.pastWeeks=[{week:1,games:[pastGame('Q')]}];a.render();assert.equal(writes.length,2,'a changed past is a full write');assert.equal(a.el('games').children.length,4);
});
test('render: text that did not change is not written again, so the browser has nothing to lay out',()=>{
 const a=app();ready(a);const note=a.el('gamesNote');let value='',writes=0;Object.defineProperty(note,'textContent',{get(){return value;},set(next){writes++;value=String(next);}});
 a.render();assert.equal(writes,1);a.render();a.render();assert.equal(writes,1);a.S.pinned='A';a.render();assert.equal(writes,2);assert.equal(value,'Your choice');
});
test('load: a saved league asks ESPN once, and the import fills the fantasy feed',async()=>{
 const data={leagueId:'123',name:'Our league',teams:[{id:'1',name:'Team One',players:[player]}],scoring:{week:8,matchupWeeks:[8],teams:[{id:'1',players:[{...player,points:18}],points:18}],matchups:[]}};let leagues=0;
 const a=app(async url=>{if(url==='/api/league'){leagues++;return Response.json(data);}return Response.json({events:[],clips:[]});},{scores:true});a.saved.leagueId='123';a.saved.teamId='1';
 await a.init();await flush();await flush();a.render();await flush();a.render();
 assert.equal(leagues,1);assert.equal(a.el('fantasyTotal').textContent,'18.00');
});
test('load: the strip learns the week from the live poll\'s own scoreboard, without waiting for the replay archive',async()=>{
 const asked=[];const a=app(async url=>{asked.push(String(url));return Response.json(String(url).includes('scoreboard')?{events:[],season:{year:2026},week:{number:3}}:{clips:[]});});
 await a.init();for(let i=0;i<8;i++)await flush();
 assert.equal(a.S.weeks.current,3,'known before the archive is even asked for');assert.equal(asked.includes('/week7.json'),false);
 assert.equal(asked.filter(u=>u.endsWith('/scoreboard')).length,1);assert.equal(asked.filter(u=>u.includes('dates=2026')).length,2,'and the earlier weeks still fill in');
});
test('Replay week: a week asks for its videos and its play-by-play together',async()=>{
 const started=[];let release;const hold=new Promise(r=>{release=r;});
 const a=app(async url=>{url=String(url);started.push(url);if(url==='/week7.json')return Response.json(archiveData);if(url.includes('seasontype=2&week=3')){await hold;return Response.json({events:[]});}if(url.endsWith('/scoreboard'))return Response.json({events:[],season:{year:2026},week:{number:2}});if(url.startsWith('/api/nfl-replays'))return Response.json({games:[]});return Response.json({events:[],clips:[]});});
 await a.loadReplayArchive();for(let i=0;i<8;i++)await flush();
 const opening=a.openPastReplay(3,'X');for(let i=0;i<8;i++)await flush();
 assert.ok(started.some(u=>u.includes('seasontype=2&week=3')),'the play-by-play is on its way');assert.ok(started.includes('/api/nfl-replays?week=3'),'and the videos did not wait for it');
 release();await opening;assert.equal(started.filter(u=>u==='/api/nfl-replays?week=3').length,1);
});

// ---------- review: a choice survives its pre-roll, a saved length its video, and a tab its week ----------
// A game with none of the viewer's starters on the slate, as a past tile or a Watch tile opens it.
const stranger=(t,options={})=>{const sim=okru(t,{length:8000,...options}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a,{team:'NE'});a.saved.highlights=false;a.seekTo(midGame(g));return {sim,a,g};};
test('NFL replay: a pre-roll suspends the choice of a game with none of your starters, and the game comes back when it ends',t=>{
 const {sim,a,g}=stranger(t,{preroll:15}),at=a.S.at;a.selectGame(g.id);
 run(a,sim,3000);assert.equal(a.S.ads.has(g.id),true);assert.equal(a.S.pinned,g.id,'the ad does not cancel the choice');assert.match(a.el('ovTitle').innerHTML,/Commercial Break in Progress/);assert.ok(Math.abs(a.S.at-at)<2,'the clock holds its place, starter or not');
 run(a,sim,25000);assert.equal(a.S.ads.size,0);assert.equal(a.S.pinned,g.id);assert.equal(a.S.program.id,g.id);assert.equal(a.pool.visible,g.id);assert.equal(sim.sims.length,1,'the finished player is the one on screen');assert.doesNotMatch(a.el('ovTitle').innerHTML,/None of your starters/);a.pool.destroy();
});
test('NFL replay: a past tile\'s game with none of your starters comes back after its breaks; a Watch tile still goes automatic',t=>{
 const held=stranger(t);held.a.selectGame(held.g.id,{hold:true});let hidden=0;run(held.a,held.sim,700000,()=>{if(held.a.pool.visible!==held.g.id)hidden++;});
 assert.ok(hidden>0,'a break hid it along the way');assert.equal(held.a.S.pinned,held.g.id);assert.equal(held.a.pool.visible,held.g.id);held.a.pool.destroy();
 const watch=stranger(t);watch.a.selectGame(watch.g.id);run(watch.a,watch.sim,700000);assert.equal(watch.a.S.pinned,null,'a Watch tile is your choice until a break');watch.a.pool.destroy();
});
test('NFL replay: a past tile holds its choice through the lineup answer for that week',async()=>{
 const league=deferred(),f=weekFetcher(),a=app(async(url,options)=>String(url)==='/api/league'?league.promise:f.fetcher(url,options),{media:true,stored:{leagueId:'123',teamId:'1',teamName:'Mine',lineupReady:true,roster:[{name:'Drake Maye',team:'NE',position:'QB'}]}});
 a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 const id=archiveData.games.find(g=>!g.teams.some(t=>['NE','BUF'].includes(t.abbreviation))).id;await a.openPastReplay(8,id);await settle();assert.equal(a.S.pinned,id);assert.equal(a.S.selection.hold,true);
 league.resolve(Response.json({leagueId:'123',ownedTeamId:'1',teams:[{id:'1',name:'Mine',players:[{name:'Josh Allen',team:'BUF',position:'QB'}]}]}));await settle();
 assert.equal(a.saved.roster[0].name,'Josh Allen');assert.equal(a.S.pinned,id,'the new lineup does not cancel the tile');a.pool.destroy();
});
test('NFL replay: pausing during a pre-roll leaves it to finish on resume, without a fresh ad',t=>{
 const sim=okru(t,{length:8000,preroll:15}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);
 run(a,sim,5000);assert.equal(a.S.ads.has(g.id),true);const s=sim.sims[0],left=s.ad;
 a.setPlaying(false);run(a,sim,120000);assert.equal(s.ad,left,'paused, the ad waits');assert.equal(s.player.wantPlay,false);
 a.setPlaying(true);assert.equal(s.player.wantPlay,true,'resumed by hand: nothing else plays a blocked, hidden slot');run(a,sim,1000);assert.ok(s.ad<left);
 run(a,sim,20000);assert.equal(a.S.ads.size,0);assert.equal(a.pool.visible,g.id);assert.equal(sim.sims.length,1,'the paused time does not age the ad into a reload');a.pool.destroy();
});
test('NFL replay: the visibility auto-pause during a pre-roll resumes it too',t=>{
 const sim=okru(t,{length:8000,preroll:15}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,sim,5000);
 a.page.hidden=true;a.emitPage('visibilitychange');assert.equal(a.S.playing,false);run(a,sim,30000);a.page.hidden=false;a.emitPage('visibilitychange');assert.equal(a.S.playing,true);
 run(a,sim,20000);assert.equal(a.pool.visible,g.id);assert.equal(sim.sims.length,1);a.pool.destroy();
});
test('NFL replay: a saved length counts only for the video it was measured on',()=>{
 const a=app(),data={games:[{id:'1',embed:'https://ok.ru/videoembed/new',recordingDuration:0},{id:'2',embed:'https://ok.ru/videoembed/same',recordingDuration:0},{id:'3',embed:'https://ok.ru/videoembed/older',recordingDuration:0}]};
 Object.assign(a.saved.replayDurations,{1:10000,2:8000,3:7000});Object.assign(a.saved.replayDurationEmbeds,{1:'https://ok.ru/videoembed/old',2:'https://ok.ru/videoembed/same'});a.applyReplayLinks(data);
 assert.deepEqual(data.games.map(g=>g.recordingDuration),[0,8000,0],'a reposted video and a length saved with no video on record both find out again');
});
test('NFL replay: learning a length records its video, so a reload trusts it',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.syncFor(g);a.pool.open(g.id,{url:g.embed,type:'provider/ok'});a.pool.hold(g.id,a.target(g.id),{play:true});run(a,sim,1000);
 assert.equal(a.saved.replayDurations[g.id],8000);assert.equal(a.saved.replayDurationEmbeds[g.id],g.embed);
 assert.equal(JSON.parse(a.storage.get('fantasy-stream-v3')).replayDurationEmbeds[g.id],g.embed);const b=app(undefined,{stored:JSON.parse(a.storage.get('fantasy-stream-v3'))});assert.equal(b.saved.replayDurationEmbeds[g.id],g.embed);a.pool.destroy();
});
test('NFL replay: a wrong told length gives way to what the footage keeps reporting, through a pre-roll and without one',t=>{
 const ad=okru(t,{length:8000,preroll:15}),a=app(undefined,{media:true,provider:ad.create}),g=uncalibrated(a);g.recordingDuration=10000;a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,ad,40000);
 assert.equal(ad.sims[0].source.duration,10000);assert.equal(a.S.ads.size,0,'footage of another length is not an ad forever');assert.equal(g.recordingDuration,8000);assert.equal(a.saved.replayDurations[g.id],8000);assert.equal(a.pool.visible,g.id);assert.equal(ad.sims.length,1);a.pool.destroy();
 const plain=okru(t,{length:7000}),b=app(undefined,{media:true,provider:plain.create}),h=uncalibrated(b);h.recordingDuration=10000;b.saved.highlights=false;b.seekTo(midGame(h,.92));b.setPlaying(true);run(b,plain,10000);
 assert.equal(h.recordingDuration,7000);assert.equal(b.pool.visible,h.id,'it lands inside the real file');assert.equal(b.S.cooldown.size,0);assert.equal(plain.sims.length,1);b.pool.destroy();
});
test('NFL replay: a calibrated game\'s sync is left alone when its player corrects a told length',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.S.archive.data.calibrated=true;g.recordingDuration=10000;a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,sim,5000);
 assert.equal(sim.sims[0].player.duration,8000);assert.equal(g.recordingDuration,10000);assert.equal(a.saved.replayDurations[g.id],undefined);a.pool.destroy();
});
test('NFL replay: a recording the provider removed goes to the tracker for good, with no reload loop',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,sim,5000);assert.equal(a.pool.visible,g.id);const at=a.S.at;
 sim.sims[0].send({event:'error',code:101});assert.equal(a.picture(g.id),'data');assert.equal(a.S.cooldown.size,0);assert.match(a.el('toast').textContent,/isn’t available.*game tracker/);
 run(a,sim,120000);assert.equal(sim.sims.length,1,'never opened again');assert.equal(a.S.program.id,g.id);assert.equal(a.pool.slots.size,0);assert.ok(a.S.at>at+60,'the clock runs on the tracker');
 for(const code of [102,103,150,151,152,153]){const other=okru(t,{length:8000}),b=app(undefined,{media:true,provider:other.create}),h=uncalibrated(b);b.saved.highlights=false;b.seekTo(midGame(h));b.setPlaying(true);run(b,other,5000);other.sims[0].send({event:'error',code});assert.equal(b.picture(h.id),'data',String(code));}
});
test('NFL replay: a game whose video is gone offers the replay-video shortcut, and the summary counts it out',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,sim,5000);assert.equal(a.el('streamSummary').textContent,'1 of '+a.S.archive.games.length+' games has a replay video');
 sim.sims[0].send({event:'error',code:101});a.render();assert.equal(a.el('streamSummary').textContent,'0 of '+a.S.archive.games.length+' games have a replay video');assert.match(a.el('games').innerHTML,new RegExp('data-add-stream="'+g.id+'"'));
});
test('NFL replay: a recording still processing keeps its retry',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);run(a,sim,5000);
 sim.sims[0].send({event:'error',code:100});assert.equal(a.picture(g.id),'video');assert.equal(a.S.cooldown.has(g.id),true);run(a,sim,65000);assert.equal(sim.sims.length,2,'tried again after the cooldown');a.pool.destroy();
});
test('NFL replay: an ended report before any length is known counts as a leftover, not the end of the recording',t=>{
 const sim=okru(t,{length:8000}),a=app(undefined,{media:true,provider:sim.create}),g=uncalibrated(a);a.saved.highlights=false;a.seekTo(midGame(g));a.setPlaying(true);a.time.now+=100;a.frame(a.time.now);
 const s=sim.sims[0];s.send({event:'inited'});s.inited=true;assert.equal(Number.isNaN(s.player.duration),true);assert.notEqual(s.player.target,null);
 s.send({event:'ended'});assert.equal(a.S.recordingEnds.size,0);assert.equal(a.picture(g.id),'video');assert.equal(s.player.element.removed,undefined);a.pool.destroy();
});
// A latest-week build from ESPN: two final games, one of whose summaries the test can fail.
const summaryOf=(id,away,home,awayName,homeName,hour)=>{const at=m=>`2026-11-01T${hour}:${String(m).padStart(2,'0')}:00Z`,one=(pid,seq,m)=>({id:pid,sequenceNumber:String(seq),wallclock:at(m),period:{number:1},clock:{displayValue:'14:55'},type:{text:'Rush'},start:{team:{id:'1'},down:1,distance:10,possessionText:away+' 25'},awayScore:0,homeScore:0,text:'A run for 5 yards.'});
 return {header:{id,competitions:[{date:at(0),competitors:[{homeAway:'away',team:{id:'1',abbreviation:away,displayName:awayName}},{homeAway:'home',team:{id:'2',abbreviation:home,displayName:homeName}}]}]},drives:{previous:[{plays:[one('a',1,2),one('b',2,5),one('c',3,9)]}]},scoringPlays:[]};};
function builtWeek({summaryFails=()=>false,replays=async()=>({games:[]})}={}){
 const finals=[{id:'901',competitions:[{status:{type:{completed:true}}}]},{id:'902',competitions:[{status:{type:{completed:true}}}]}],calls=[];
 const fetcher=async url=>{url=String(url);calls.push(url);
  if(url==='/week7.json')return Response.json(archiveData);if(url==='/nfl-highlights.json')return Response.json({clips:[]});
  if(url.startsWith('/api/nfl-replays'))return Response.json(await replays());
  if(url.includes('scoreboard?dates='))return Response.json(url.includes('week=8')?{events:finals}:{events:[]});
  if(url.includes('scoreboard'))return Response.json({season:{year:2026},week:{number:9},events:[]});
  const id=/summary\?event=(\d+)/.exec(url)?.[1];if(id){if(summaryFails(id))return new Response('',{status:503});return Response.json(id==='901'?summaryOf('901','BUF','MIA','Buffalo Bills','Miami Dolphins','18'):summaryOf('902','SEA','SF','Seattle Seahawks','San Francisco 49ers','21'));}
  return Response.json({events:[]});};
 return {fetcher,calls,summaries:()=>calls.filter(u=>u.includes('summary?event=')).length,listings:()=>calls.filter(u=>u.startsWith('/api/nfl-replays')).length};
}
test('Replay week: a week short of a game is not cached, and the next visit builds it again',async()=>{
 let down=true;const f=builtWeek({summaryFails:id=>down&&id==='902'}),a=app(f.fetcher,{media:true});await a.loadReplayArchive();await settle();await a.setMode('replay');await settle();
 assert.equal(a.S.archiveKey,'w8');assert.equal(a.S.archive.games.length,1,'what answered is on the stage');assert.equal(a.storage.has('fantasy-stream-archive-2026-w8'),false,'but it is not kept');
 down=false;await a.openPastReplay(8,'902');await settle();assert.equal(a.S.archive.games.length,2);assert.equal(a.S.pinned,'902');assert.equal(JSON.parse(a.storage.get('fantasy-stream-archive-2026-w8')).games.length,2,'the whole week is kept');assert.equal(a.S.archives.get('w8').partial,false);
 const asked=f.summaries();await a.setMode('live');await a.setMode('replay');await settle();assert.equal(f.summaries(),asked,'and not asked for again');a.pool.destroy();
});
test('Replay week: a cached week short of a game the strip knows about is built again',async()=>{
 const tile=id=>({id,name:'Game '+id,detail:'Final',teams:[{abbr:'AAA',name:'Away',score:1},{abbr:'BBB',name:'Home',score:2}]}),knownWeek=[{week:8,games:[tile('901'),tile('902')]}];
 const f=builtWeek(),a=app(f.fetcher,{media:true});await a.loadReplayArchive();await settle();const whole=(await a.selectWeek(8),a.S.archives.get('w8'));assert.equal(whole.games.length,2);
 const short={...JSON.parse(JSON.stringify(whole)),games:[JSON.parse(JSON.stringify(whole.games[0]))]},b=app(f.fetcher,{media:true});b.storage.set('fantasy-stream-archive-2026-w8',JSON.stringify(short));await b.loadReplayArchive();await settle();
 b.S.pastWeeks=knownWeek;await b.setMode('replay');await settle();assert.equal(b.S.archive.games.length,2);assert.equal(JSON.parse(b.storage.get('fantasy-stream-archive-2026-w8')).games.length,2);
 const c=app(f.fetcher,{media:true}),asked=f.summaries();c.storage.set('fantasy-stream-archive-2026-w8',JSON.stringify(whole));await c.loadReplayArchive();await settle();c.S.pastWeeks=knownWeek;await c.setMode('replay');await settle();assert.equal(f.summaries(),asked,'a whole copy is used as it is');
});
test('Replay week: a rebuild that fails falls back on the copy already here',async()=>{
 let down=true;const f=builtWeek({summaryFails:id=>down&&id==='902'}),a=app(async url=>!down&&String(url).includes('scoreboard?dates=')?new Response('',{status:503}):f.fetcher(url),{media:true});await a.loadReplayArchive();await settle();await a.setMode('replay');await settle();assert.equal(a.S.archive.games.length,1);
 down=false;await a.openPastReplay(8,'901');await settle();assert.equal(a.S.pinned,'901');assert.doesNotMatch(String(a.el('toast').textContent||''),/unavailable/);a.pool.destroy();
});
const listingFor=id=>{const g=archiveData.games.find(x=>x.id===id),slug=t=>t.name.toLowerCase().replace(/[^a-z0-9]+/g,'-');return {away:slug(g.teams[0]),home:slug(g.teams[1]),embed:'https://ok.ru/videoembed/777',page:'https://nfl-video.com/x'};};
const week8Bare=()=>{const data=structuredClone(archiveData);data.week=8;data.title='Week 8';for(const g of data.games){delete g.embed;g.recordingDuration=0;g.anchors=[];}return JSON.stringify(data);};
test('Replay week: a listing that failed is asked again on the way back, says so, and never asks twice within minutes',async()=>{
 const id=archiveData.games[0].id;let answer={games:[],error:'The replay listing is unavailable right now.'};const f=weekFetcher({replays:async()=>answer}),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8Bare());await a.loadReplayArchive();await settle();
 await a.setMode('replay');await settle();assert.equal(a.S.archiveKey,'w8');assert.equal(a.S.archive.game(id).embed,undefined);assert.match(a.el('toast').textContent,/replay videos for Week 8/);
 const asked=()=>f.calls.filter(u=>u.startsWith('/api/nfl-replays')).length;assert.equal(asked(),1);
 await a.setMode('live');await a.setMode('replay');await settle();assert.equal(asked(),1,'not again straight away');
 a.S.weekVideos.get(8).at-=121000;answer={games:[]};await a.setMode('live');await a.setMode('replay');await settle();assert.equal(asked(),2,'a failure is asked again within minutes');
 await a.setMode('live');await a.setMode('replay');await settle();assert.equal(asked(),2);
 a.S.weekVideos.get(8).at-=121000;await a.setMode('live');await a.setMode('replay');await settle();assert.equal(asked(),2,'an answer with games still missing waits longer');
 a.S.weekVideos.get(8).at-=180000;answer={games:[listingFor(id)]};a.el('weekSelect').onchange({target:{value:'w7'}});await settle();a.el('weekSelect').onchange({target:{value:'w8'}});await settle();
 assert.equal(asked(),3,'choosing the week asks too');assert.equal(a.S.archiveKey,'w8');assert.equal(a.S.archive.game(id).embed,'https://ok.ru/videoembed/777');assert.equal(a.S.archives.get('w8').games.find(g=>g.id===id).embed,'https://ok.ru/videoembed/777');assert.equal(a.picture(id),'video','the game gets its video back');a.pool.destroy();
});
test('Replay week: a week with every video has nothing to ask again',async()=>{
 const f=weekFetcher(),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();await a.setMode('replay');await settle();assert.equal(a.S.archiveKey,'w8');
 a.S.weekVideos.get(8).at=0;await a.setMode('live');await a.setMode('replay');await settle();assert.equal(f.calls.filter(u=>u.startsWith('/api/nfl-replays')).length,1);a.pool.destroy();
});
test('Replay week: a video removed for good is replaced when the listing has another',async()=>{
 const id=archiveData.games[0].id,f=weekFetcher({replays:async()=>({games:[listingFor(id)]})}),a=app(f.fetcher,{media:true});const data=JSON.parse(week8Bare());data.games[0].embed='https://ok.ru/videoembed/111';a.storage.set('fantasy-stream-archive-2026-w8',JSON.stringify(data));await a.loadReplayArchive();await settle();await a.setMode('replay');await settle();
 a.S.deadEmbeds.add('https://ok.ru/videoembed/111');assert.equal(a.picture(id),'data');a.S.weekVideos.get(8).at=0;a.el('weekSelect').onchange({target:{value:'w7'}});await settle();a.el('weekSelect').onchange({target:{value:'w8'}});await settle();
 assert.equal(a.S.archive.game(id).embed,'https://ok.ru/videoembed/777');assert.equal(a.picture(id),'video');a.pool.destroy();
});
test('Replay week: changing week while playing keeps playing, and nothing says the video failed',async()=>{
 const f=weekFetcher(),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();await a.setMode('replay');a.el('ovButton').onclick();await settle();assert.equal(a.S.playing,true);
 a.el('weekSelect').onchange({target:{value:'w8'}});await settle();a.render();assert.equal(a.S.archiveKey,'w8');assert.equal(a.S.playing,true);assert.equal(a.S.program.kind,'game','straight to the next picture, in the same breath');assert.equal(a.el('overlay').hidden,true);a.pool.destroy();
});
test('Replay week: paused on standby is a ready state with a Watch button, not a failure',async()=>{
 const f=weekFetcher(),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();await a.setMode('replay');a.useRoster(roster.SAMPLE,{teamName:'Replay'});a.el('ovButton').onclick();await settle();
 a.setPlaying(false);a.el('weekSelect').onchange({target:{value:'w8'}});await settle();a.render();assert.equal(a.S.playing,false);assert.equal(a.S.program.kind,'standby');assert.ok(a.S.games.some(g=>g.state==='in'));
 assert.equal(a.el('ovButton').textContent,'Watch');assert.notEqual(a.el('ovEyebrow').textContent,'VIDEO UNAVAILABLE');assert.equal(a.el('ovButton').dataset.action,'start');a.el('ovButton').onclick();assert.equal(a.S.playing,true);a.pool.destroy();
});
test('Replay week: a week that cannot load says so, whenever it is chosen',async()=>{
 const f=weekFetcher(),a=app(async url=>{if(String(url).includes('scoreboard?dates='))return new Response('',{status:503});return f.fetcher(url);},{media:true});await a.loadReplayArchive();await settle();await a.setMode('replay');a.el('ovButton').onclick();await settle();
 a.el('weekSelect').onchange({target:{value:'w3'}});await settle();assert.match(a.el('toast').textContent,/Week 3 isn’t available/);assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.playing,true);a.pool.destroy();
});
test('Replay week: clicking Live while a past tile loads stays on Live',async()=>{
 const held=deferred(),f=weekFetcher({replays:()=>held.promise}),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 const thursday=archiveData.games.find(g=>new archive.ReplayArchive(archiveData).sessions[0].gameIds.includes(g.id)).id,opening=a.openPastReplay(8,thursday);await settle();assert.equal(a.S.mode,'replay');
 await a.setMode('live');held.resolve({games:[]});await opening;await settle();
 assert.equal(a.S.mode,'live');assert.equal(a.S.started,false);assert.equal(a.S.playing,false);assert.equal(a.S.pinned,null);assert.equal(a.S.seekHold,false);assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.weekChosen,false,'the week was never reached');a.pool.destroy();
});
test('Replay week: the later of two past tiles wins, whichever week loads last',async()=>{
 const first=deferred(),f=weekFetcher({replays:()=>first.promise}),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 const days=new archive.ReplayArchive(archiveData).sessions,early=days[0].gameIds[0],late=days[1].gameIds[0],older=a.openPastReplay(8,early);await settle();
 await a.openPastReplay(7,late);await settle();assert.equal(a.S.archiveKey,'w7');assert.equal(a.S.pinned,late);
 first.resolve({games:[]});await older;await settle();assert.equal(a.S.archiveKey,'w7','the older load cannot take the stage');assert.equal(a.S.pinned,late);assert.equal(a.S.weekChosen,true);a.pool.destroy();
});
test('Replay week: a past tile that failed does not stop Replay landing on the latest week',async()=>{
 let down=true;const f=weekFetcher(),a=app(async url=>{if(down&&String(url).includes('week=3'))return new Response('',{status:503});return f.fetcher(url);},{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 await a.openPastReplay(3,'nope');await settle();assert.equal(a.S.mode,'replay');assert.match(a.el('toast').textContent,/Week 3's replay is unavailable/);assert.equal(a.S.weekChosen,false);
 await a.setMode('live');await a.setMode('replay');await settle();assert.equal(a.S.archiveKey,'w8');a.pool.destroy();
});
test('Replay week: a past tile refused because the archive is down leaves the choice open too',async()=>{
 const a=app(async url=>String(url).includes('week7')?new Response('',{status:503}):Response.json({events:[]}),{media:true});await a.openPastReplay(3,'nope');await settle();assert.equal(a.S.mode,'live');assert.equal(a.S.weekChosen,false);
});
// An ESPN-connected viewer: the lineup answer depends on the week asked for.
function connected(f,{slow=null}={}){
 const asked=[],stored={leagueId:'123',teamId:'1',teamName:'Mine',lineupReady:true,roster:[{name:'Stale Week Seven',team:'CIN',position:'QB'}]};
 const a=app(async(url,options)=>{if(String(url)!=='/api/league')return f.fetcher(url,options);const week=JSON.parse(options.body).week;asked.push(week);if(slow)await slow;return Response.json({leagueId:'123',ownedTeamId:'1',teams:[{id:'1',name:'Mine',players:[week===8?{name:'Jonathan Taylor',team:'IND',position:'RB'}:{name:'Joe Burrow',team:'CIN',position:'QB'}]}]});},{media:true,stored});
 return {a,asked};
}
test('Replay week: landing on the latest week asks for that week\'s lineup, once',async()=>{
 const f=weekFetcher(),{a,asked}=connected(f);a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 await a.setMode('replay');await settle();assert.equal(a.S.archiveKey,'w8');assert.deepEqual(asked,[8],'Week 7 is never asked for on the way');assert.equal(a.saved.roster[0].name,'Jonathan Taylor');
 const d=a.S.archive.sessions[a.S.day],first=team=>{for(let at=d.start;at<d.end;at+=30)if(director.rank(a.S.archive.sample(at,d.gameIds),[{name:'x',team,position:'RB'}],{includeDefense:false}).length)return at-20;return null;};
 assert.equal(a.S.at,first('IND'),'and it opens where that lineup first plays');assert.notEqual(first('IND'),first('CIN'));a.pool.destroy();
});
test('Replay week: a landing that fails, or has nothing to do, still asks for the lineup of the week on stage',async()=>{
 const f=weekFetcher(),down=app;const failing={fetcher:async url=>String(url).includes('scoreboard?dates=')?new Response('',{status:503}):f.fetcher(url)},{a,asked}=connected(failing);await a.loadReplayArchive();await settle();
 await a.setMode('replay');await settle();assert.equal(a.S.archiveKey,'w7');assert.deepEqual(asked,[7]);assert.equal(a.saved.roster[0].name,'Joe Burrow');
 const list=deferred(),g=weekFetcher({board:()=>list.promise}),b=connected(g);await b.a.loadReplayArchive();await b.a.setMode('replay');await flush();assert.equal(b.a.S.weeks.landing,-1);assert.deepEqual(b.asked,[]);
 list.resolve({season:{year:2026},week:{number:7},events:[{competitions:[{status:{type:{completed:true}}}]}]});await settle();assert.equal(b.a.S.archiveKey,'w7');assert.deepEqual(b.asked,[7],'the latest week is the one on stage');
});
test('Replay week: Watch this week, during a landing, asks for this week\'s lineup at once',async()=>{
 const held=deferred(),f=weekFetcher({replays:()=>held.promise}),{a,asked}=connected(f);a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 await a.setMode('replay');await settle();assert.equal(a.S.weeks.landing,8);assert.deepEqual(asked,[]);a.el('ovButton').onclick();await settle();assert.deepEqual(asked,[7]);assert.equal(a.saved.roster[0].name,'Joe Burrow');
 held.resolve({games:[]});await settle();assert.equal(a.S.archiveKey,'w7');assert.deepEqual(asked,[7]);a.pool.destroy();
});
test('Replay week: a past tile on the week already on stage, or one that fails, still asks for that week\'s lineup',async()=>{
 const f=weekFetcher(),{a,asked}=connected(f);a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();
 await a.openPastReplay(7,archiveData.games[0].id);await settle();assert.equal(a.S.archiveKey,'w7');assert.deepEqual(asked,[7]);a.pool.destroy();
 const g=weekFetcher(),b=connected({fetcher:async url=>String(url).includes('week=3')?new Response('',{status:503}):g.fetcher(url)});await b.a.loadReplayArchive();await settle();
 await b.a.openPastReplay(3,'nope');await settle();assert.equal(b.a.S.archiveKey,'w7');assert.deepEqual(b.asked,[7]);b.a.pool.destroy();
});
test('Replay week: a past tile mid-play goes straight to its game, with no other game opened on the way',async()=>{
 const opened=[],f=weekFetcher(),a=app(f.fetcher,{media:true});a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();await a.setMode('replay');a.useRoster(roster.SAMPLE,{teamName:'Replay'});a.el('ovButton').onclick();await settle();assert.equal(a.S.playing,true);
 const open=a.pool.open.bind(a.pool);a.pool.open=(key,source)=>{opened.push(key);return open(key,source);};const id=new archive.ReplayArchive(archiveData).sessions[0].gameIds[0];await a.openPastReplay(8,id);
 assert.deepEqual([...new Set(opened)],[id]);assert.equal(a.S.pinned,id);assert.equal(a.S.playing,true);a.pool.destroy();
});
test('Replay week: choosing a week follows its lineup too',async()=>{
 const f=weekFetcher(),{a,asked}=connected(f);a.storage.set('fantasy-stream-archive-2026-w8',week8());await a.loadReplayArchive();await settle();await a.setMode('replay');await settle();assert.deepEqual(asked,[8]);
 a.el('weekSelect').onchange({target:{value:'w7'}});await settle();assert.deepEqual(asked,[8,7]);assert.equal(a.saved.roster[0].name,'Joe Burrow');a.pool.destroy();
});
test('Replay week: a tab left open across a week change moves the strip and the list on',async()=>{
 let week=9;const asked=[],a=app(async url=>{url=String(url);asked.push(url);if(url==='/week7.json')return Response.json(archiveData);if(url==='/nfl-highlights.json')return Response.json({clips:[]});if(url.includes('scoreboard?dates='))return Response.json({events:[]});if(url.includes('scoreboard'))return Response.json({season:{year:2026},week:{number:week},events:[]});return Response.json({events:[]});});
 await a.loadReplayArchive();await settle();assert.equal(a.S.weeks.current,9);assert.equal(a.S.weeks.latest,8);
 week=10;await a.pollLive(a.S.live.generation);await settle();assert.equal(a.S.weeks.current,10);assert.equal(a.S.weeks.latest,9);assert.match(a.el('weekSelect').innerHTML,/Week 9 · latest/);assert.ok(asked.some(u=>u.includes('week=9')),'the finished week joins the strip');
 const lists=asked.length;await a.pollLive(a.S.live.generation);await settle();assert.equal(asked.filter(u=>u.includes('dates=')).length,asked.slice(0,lists).filter(u=>u.includes('dates=')).length,'and a steady week asks for nothing more');
});
// ---------- first-draft pass: streams that refuse a frame ----------
const NTV='https://ntv.st/watch/raptor/match?source=0';
test('an unresolved NTV watch page retains its tracker fallback while a published embed plays inline',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':NTV};a.streamFinder.resolved.set(NTV,{url:NTV,kind:'page'});a.saved.delay=0;a.render();assert.match(a.el('games').html,/Opens in new tab/);a.setPlaying(true);a.step(a.time.now);
 assert.equal(a.pool.get('A'),null,'the channel found the game and opened no frame');assert.equal(a.S.program.id,'A');assert.equal(a.picture('A'),'data');
 a.render();assert.equal(a.el('fieldView').hidden,false);assert.equal(a.el('fvOpen').hidden,false);assert.equal(a.el('fvOpen').href,NTV);assert.match(a.el('fvNote').textContent,/opens in a new tab/);
 a.selectGame('A');a.step(a.time.now);assert.equal(a.pool.get('A'),null,'a viewer picking it opens no frame either');assert.equal(a.el('fvOpen').hidden,false);assert.equal(a.el('nextStream').hidden,true,'no backup on the same host to try');
 a.saved.streams={'IND-MIN':'https://ntv.st/embed?t=pasted'};a.step(a.time.now);assert.equal(a.pool.get('A').url,'https://ntv.st/embed?t=pasted','the published player is loaded inline');
 a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.step(a.time.now);assert.ok(a.pool.get('A'),'a link that can play here still does');
});
// ---------- a game that hasn't started ----------
const preGame={...game,id:'P',name:'CIN @ ATL',state:'pre',phase:'pre',possession:-1,yardsToGoal:null,date:'2026-11-08T18:00:00Z',teams:[{id:'4',abbr:'CIN'},{id:'1',abbr:'ATL'}],detail:'11/8 - 1:00 PM EST',score:[0,0]};
const onScreen=(a,g)=>{a.S.games=[g];a.S.live.games=[g];a.S.live.feed=new a.S.live.feed.constructor();a.S.live.feed.push([g],970);a.saved.delay=0;a.S.at=Date.now()/1000;};
test('a game that has not started is not called LIVE, loads nothing, and offers the stream early or the way back',()=>{
 const a=app(undefined,{media:true});ready(a);onScreen(a,preGame);a.saved.streams={'ATL-CIN':'https://example.test/embed/cin'};a.selectGame('P');a.step(a.time.now);
 assert.equal(a.pool.get('P'),null,'no frame until someone asks');a.render();assert.equal(a.el('overlay').hidden,false);assert.match(a.el('ovTitle').innerHTML,/Kickoff/);assert.equal(a.el('ovButton').dataset.action,'early');assert.equal(a.el('ovGhost').textContent,'Back to the channel');
 a.el('ovGhost').onclick();assert.equal(a.S.pinned,null,'back to the channel lets go of the game');
 a.selectGame('P');a.step(a.time.now);a.el('ovButton').onclick();a.step(a.time.now);assert.ok(a.pool.get('P'),'asked for early: now it opens');
});
test('the bar under the video says what state the game is in, and only then what the score is',()=>{
 const a=app(undefined,{media:true});ready(a);const see=(g,tag)=>{onScreen(a,g);a.S.started=true;a.S.program={kind:'game',id:g.id};a.S.earlyOpen.add(g.id);a.S.overlayOff=true;a.render();assert.equal(a.el('bugTag').textContent,tag,g.state);assert.equal(a.el('bugTag').dataset.state,g.state);};
 see(preGame,'LATER');assert.match(a.el('bugGame').innerHTML,/CIN <span class="at">@<\/span> ATL/);assert.match(a.el('bugClock').textContent,/Kickoff/);assert.doesNotMatch(a.el('bugClock').textContent,/EST/);assert.match(a.el('lowerKicker').textContent,/KICKOFF/);assert.equal(a.el('skipBreak').hidden,true,'no break to skip');
 see({...game,state:'post',phase:'final',detail:'Final',score:[20,17]},'FINAL');see({...game},'LIVE');see({...game,phase:'break'},'BREAK');
});
test('tiles stay in kickoff order whatever is on air, with ties settled the same way every time',()=>{
 const later={...game,id:'L',teams:[{id:'9',abbr:'GB'},{id:'3',abbr:'CHI'}],date:'2026-11-08T21:00:00Z'},tie={...game,id:'T',teams:[{id:'2',abbr:'BUF'},{id:'15',abbr:'MIA'}],date:'2026-11-08T21:00:00Z'};
 const a=app(undefined,{media:true});ready(a);const order=()=>[...a.el('games').html.matchAll(/data-game="(\w+)"/g)].map(m=>m[1]);
 a.S.games=[later,tie,{...game}];a.S.live.games=a.S.games;a.render();assert.deepEqual(order(),['A','L','T']);
 a.S.started=true;a.S.program={kind:'game',id:'T'};a.S.pinned='T';a.render();assert.deepEqual(order(),['A','L','T'],'picking a tile does not move it');
});
test('shortcuts leave the browser\'s own keys alone, and arrows on a tab do not seek the replay',()=>{
 const a=app();replayReady(a);a.S.mode='replay';let full=0,mute=0;a.el('fullButton').click=()=>full++;a.el('muteButton').click=()=>mute++;const target={closest:()=>null};
 a.emitPage('keydown',{key:'f',metaKey:true,target});a.emitPage('keydown',{key:'f',ctrlKey:true,target});a.emitPage('keydown',{key:'m',metaKey:true,target});assert.equal(full,0);assert.equal(mute,0);
 const at=a.S.at;a.emitPage('keydown',{key:'ArrowLeft',metaKey:true,target,preventDefault(){}});a.emitPage('keydown',{key:'ArrowRight',defaultPrevented:true,target,preventDefault(){}});assert.equal(a.S.at,at);
 a.emitPage('keydown',{key:'f',target});assert.equal(full,1,'the plain key still works');
 a.el('muteButton').hidden=true;a.emitPage('keydown',{key:'m',target});assert.equal(mute,0,'a hidden mute button is not pressed by its key');
});
// ---------- a recording that never shows footage here ----------
test('a replay that never shows footage stops hopping: it holds a link to the video, offers a way out at 20 seconds, and Play tries again',()=>{
 const {a,g,p,to,since}=waitingFrame();p.played=false;to(since+8250);assert.equal(a.pool.visible,g.id);
 to(since+21000);a.render();assert.equal(a.pool.visible,g.id,'a tap may still start it');assert.equal(a.el('frameHelp').hidden,false);assert.equal(a.el('frameOpen').href,g.embed);
 to(since+91000);assert.equal(a.pool.get(g.id),null);assert.equal(a.S.cooldown.has(g.id),false,'not cooled: nothing to come back to');assert.equal(a.S.playing,false);a.render();
 assert.match(a.el('ovTitle').innerHTML,/won’t play inside the page/);assert.equal(a.el('ovOpen').hidden,false);assert.equal(a.el('ovOpen').href,g.embed);assert.equal(a.el('frameHelp').hidden,true);
 a.el('ovButton').onclick();assert.equal(a.S.wontPlay,null);assert.equal(a.S.playing,true);
});
test('a replay frame that never says anything gets the short limit and the same way out; one that once played still hops',()=>{
 const silent=waitingFrame();silent.p.played=false;silent.p.initialized=false;silent.to(silent.since+8250);silent.to(silent.since+21000);assert.equal(silent.a.S.wontPlay?.id,silent.g.id);
 const played=waitingFrame();played.p.played=true;played.to(played.since+8250);played.to(played.since+91000);assert.equal(played.a.S.wontPlay,null);assert.equal(played.a.S.cooldown.has(played.g.id),true);
});
// ---------- ESPN: disconnecting, private leagues, the sample team ----------
test('Disconnect forgets the login on every league page and in the lineup kept for the other mode, and nothing still on its way brings it back',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);ready(a);const sports=JSON.stringify({swid:'{a}',s2:'b',leagueId:'7',teamId:'1',leagueSeason:2027,chatName:'Sam'});for(const s of ['nba','nhl','mlb'])a.storage.set('fantasy-stream-'+s+'-v1',sports);
 a.saved.espn={swid:'{a}',s2:'b'};a.saved.leagueId='123';a.saved.teamId='1';a.saved.league={name:'L',teams:[]};a.S.replayLineup={espn:{swid:'{a}',s2:'b'},leagueId:'123'};a.S.liveLineup={espn:{swid:'{a}',s2:'b'},leagueId:'123'};
 a.el('leagueId').value='123';const late=a.importLeague();a.el('forgetESPN').onclick();
 assert.equal(JSON.stringify(a.saved.espn),'{"swid":"","s2":""}');assert.equal(a.saved.leagueId,'');assert.equal(a.saved.league,null);assert.equal(a.S.liveLineup.espn.s2,'');assert.equal(a.S.replayLineup.leagueId,'');assert.equal(a.el('espnS2').value,'');assert.equal(a.el('forgetESPN').hidden,true);
 assert.doesNotThrow(()=>a.render(),'the scoreboard reads saved.espn whenever a league is connected, and copes when none is');
 for(const s of ['nba','nhl','mlb']){const kept=JSON.parse(a.storage.get('fantasy-stream-'+s+'-v1'));assert.equal(kept.s2,'');assert.equal(kept.swid,'');assert.equal(kept.leagueId,'');assert.equal(kept.chatName,'Sam','only the login goes');}
 assert.equal(JSON.parse(a.storage.get('fantasy-stream-v3')).espn.s2,'');
 pending.resolve(Response.json({leagueId:'123',name:'L',teams:[{id:'1',name:'T',players:[player]}]},{headers:{'Content-Type':'application/json'}}));await late;assert.equal(a.saved.leagueId,'','a late answer cannot re-save the league');
});
test('a private league opens the private step before asking for its fields, so focus never lands on a hidden input',async()=>{
 const a=app(async()=>Response.json({error:'That league is private. Follow the steps below to connect it.',code:'LEAGUE_PRIVATE'},{status:401}));a.el('privateLeague').open=false;a.el('leagueId').value='123';await a.importLeague();assert.equal(a.el('privateLeague').open,true);assert.match(a.el('leagueStatus').textContent,/private/);
 const b=app();b.el('lineupButton').onclick();assert.equal(b.el('privateLeague').open,false,'nobody with no league saved is shown the cookie steps');assert.equal(b.el('leagueImport').open,true);
 const c=app();c.saved.espn={swid:'{a}',s2:'b'};c.el('lineupButton').onclick();assert.equal(c.el('privateLeague').open,true,'saved values are shown so they can be changed');
});
test('in a replay with no lineup the team is named as a sample, and a choice made there carries over to Live',async()=>{
 const a=app();sampleReady(a);a.saved.liveLineupMarker=1;await a.setMode('replay');a.render();assert.match(a.el('fantasyStatus').textContent,/sample team/);assert.equal(a.el('fantasyStatus').hidden,false);assert.equal(a.el('retryFantasy').hidden,false);assert.equal(a.el('retryFantasy').textContent,'Connect ESPN');assert.equal(a.el('youHeader').textContent,'Sample team');assert.equal(a.el('fantasyTitle').textContent,'Sample team');assert.doesNotMatch(a.el('ovText').textContent,/Sample lineup/);
 a.useRoster([player],{teamName:'My lineup'});await a.setMode('live');assert.equal(a.saved.teamName,'My lineup','Live does not put the sample back');assert.equal(a.roster().length,1);
});
test('someone with a lineup of their own keeps it apart from replay changes',async()=>{
 const a=app();replayReady(a);await a.setMode('replay');a.useRoster([{name:'Justin Jefferson',team:'MIN',position:'WR'}],{teamName:'Replay only'});await a.setMode('live');assert.equal(a.saved.teamName,'My lineup');
});
// ---------- wording under failure ----------
test('with ESPN down on a first visit the strip and the screen say so, instead of looking like they are still loading',()=>{
 const a=app();a.S.live.error='unavailable';a.render();assert.match(a.el('games').html,/Game updates are unavailable/);assert.doesNotMatch(a.el('games').html,/Loading the NFL schedule/);assert.match(a.el('ovText').textContent,/can’t reach the game schedule/);
 a.S.live.error='';a.render();assert.match(a.el('games').html,/Loading the NFL schedule/);
});
test('Streams says this week for a week of games, and counts agree in number',()=>{
 const a=app();ready(a);a.render();assert.equal(a.el('streamSummary').textContent,'0 of 1 game this week has a stream ready');a.S.live.games=[game,{...game,id:'B',teams:[{id:'9',abbr:'GB'},{id:'3',abbr:'CHI'}]}];a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.render();assert.equal(a.el('streamSummary').textContent,'1 of 2 games this week has a stream ready');a.S.live.games=[];a.render();assert.equal(a.el('streamSummary').textContent,'No games left this week');
});
test('the footer names the week being landed on, not the one being replaced',async()=>{
 const a=app();replayReady(a);a.S.mode='replay';a.S.weeks.landing=8;a.render();assert.equal(a.el('channelMode').textContent,'Week 8 replay');a.S.weeks.landing=-1;a.render();assert.equal(a.el('channelMode').textContent,'Replay');a.S.weeks.landing=0;a.render();assert.equal(a.el('channelMode').textContent,'Week '+a.S.archive.data.week+' replay');
});
test('the week run survives the end of the regular season: all 18 weeks stay, and this week is labelled by name',async()=>{
 const asked=[],a=app(async url=>{asked.push(String(url));return Response.json(String(url).includes('dates=')?{events:[]}:{season:{year:2026,type:3},week:{number:1,text:'Wild Card'},events:[]});});await a.init();await flush();await flush();await flush();
 assert.equal(a.S.weeks.current,19);assert.equal(a.S.weeks.label,'Wild Card');assert.ok(asked.some(u=>u.includes('seasontype=2&week=18')),'week 18 is still fetched');
});
test('a hidden tab asks for no stream links, and catches up when it comes back',async()=>{
 const asked=[],a=app(async url=>{asked.push(String(url));return Response.json(String(url).startsWith('/api/streams')?{sport:'nfl',entries:[]}:{events:[]});});ready(a);a.page.hidden=true;await a.refreshStreamLinks();assert.equal(asked.length,0);
 a.page.hidden=false;a.emitPage('visibilitychange');await flush();assert.ok(asked.some(u=>u.startsWith('/api/streams')));
});
test('the way out of a replay that won\'t play is the main button, and trying again the second',()=>{
 const {a,g,p,to,since}=waitingFrame();p.played=false;to(since+8250);to(since+91000);a.render();assert.match(a.el('ovButton').className,/ghost/);a.S.wontPlay=null;a.S.program={kind:'standby'};a.S.pending=null;a.render();assert.doesNotMatch(a.el('ovButton').className||'',/ghost/);void g;
});

test('touch replay users get the external-player link immediately',()=>{
 const {a,g,p,to,since}=waitingFrame();a.window.matchMedia=()=>({matches:true});p.played=false;
 to(since+1000);a.render();assert.equal(a.el('frameHelp').hidden,false);assert.equal(a.el('frameOpen').href,g.embed);
});
test('hidden Chat is skipped by keyboard navigation and cannot be selected',()=>{
 const a=app();a.el('chatTab').hidden=true;
 a.el('scoresTab').onkeydown({key:'ArrowRight',preventDefault(){}});
 assert.equal(a.el('matchupPanel').hidden,false);assert.equal(a.el('chatPanel').hidden,true);
 a.el('chatTab').onclick();assert.equal(a.el('chatPanel').hidden,true);
});

test('hiding the game tiles preserves the playing source and restores the guide',()=>{
 const a=app(undefined,{media:true});ready(a);a.saved.streams={'IND-MIN':'https://example.test/a.mp4'};a.saved.delay=0;a.setPlaying(true);a.step(a.time.now);const before=a.pool.get('A');
 a.el('gameTilesToggle').onclick();assert.equal(a.el('gameTiles').hidden,true);assert.equal(a.el('gameTilesToggle')['aria-expanded'],'false');assert.equal(a.storage.get('fantasy-stream-hide-tiles'),'true');assert.equal(a.pool.get('A'),before);
 a.el('gameTilesToggle').onclick();assert.equal(a.el('gameTiles').hidden,false);assert.equal(a.el('gameTilesToggle')['aria-label'],'Hide game tiles');assert.equal(a.pool.get('A'),before);
});

 test('website commercial cover preserves the frame and returns without reopening',()=>{
 const a=embeddedGame();a.pool.current.element.emit('load');const frame=a.pool.current,element=frame.element;
 a.skipBreak();a.render();assert.equal(a.pool.current,frame);assert.equal(frame.element,element);assert.equal(a.pool.visible,'A');assert.equal(a.S.program.kind,'game');assert.equal(a.el('ovTitle').innerHTML,'Commercial Break in Progress');
 a.S.breaks.clear();a.S.detectedBreaks.clear();a.updateBreaks();a.render();assert.equal(a.pool.current,frame);assert.equal(frame.element,element);assert.equal(a.S.dimmed,null);
 });

test('an unrelated live website stays loaded across a manual break and automatic return',()=>{
 const a=embeddedGame();a.useRoster([{name:'Other player',team:'DAL',position:'QB'}],{teamName:'Other lineup'});a.selectGame('A');
 const p=a.pool.current,frame=p.element;frame.emit('load');
 a.skipBreak();a.step(a.time.now);a.render();
 assert.equal(a.pool.current,p);assert.equal(p.element,frame);assert.equal(a.el('ovTitle').innerHTML,'Commercial Break in Progress');
 a.S.breaks.clear();a.S.detectedBreaks.clear();a.step(a.time.now);a.render();
 assert.equal(a.pool.current,p);assert.equal(p.element,frame);assert.equal(frame.navigations.length,1);assert.equal(p.wantPlay,true);assert.equal(a.S.dimmed,null);
});

test('Show stream corrects a detected timeout without reloading and a new break is covered again',()=>{
 const a=embeddedGame();const frame=a.pool.current.element;frame.emit('load');
 const stopped={...game,phase:'break',breakKind:'timeout',lastPlayId:'timeout-1'};
 a.S.games=[stopped];a.S.live.feed.view=()=>a.S.games;a.updateBreaks();a.render();
 assert.equal(a.el('ovButton').textContent,'Show stream');assert.match(a.el('games').innerHTML,/Show this stream/);
 assert.doesNotMatch(a.el('games').innerHTML,/data-game="A"[^>]*disabled/);
 a.el('ovButton').onclick();assert.equal(a.S.dimmed,null);assert.equal(a.el('overlay').hidden,true);assert.equal(a.pool.current.element,frame);assert.equal(frame.navigations.length,1);
 a.time.now+=15000;a.step(a.time.now);assert.equal(a.S.dimmed,null);assert.equal(a.S.pinned,'A','the same timeout cannot immediately undo the viewer’s correction');
 a.S.games=[{...game,lastPlayId:'next-play'}];a.step(a.time.now+500);assert.equal(a.S.revealedBreaks.size,0);
 a.S.games=[{...stopped,lastPlayId:'timeout-2'}];a.step(a.time.now+1000);a.render();assert.equal(a.el('ovTitle').innerHTML,'Commercial Break in Progress');assert.equal(a.pool.current.element,frame);
 a.pool.destroy();
});
test('a selected replay waiting for Play is revealed over the outgoing player after eight seconds',()=>{
 const {a,g,p,to,since}=waitingFrame();p.played=false;
 const old=a.pool.open('old',{url:'https://example.test/old.mp4'}).player;old.play();a.pool.show('old');a.S.program={kind:'game',id:'old'};a.S.pinned=g.id;
 a.time.now=since+4000;a.cutTo(g.id,a.time.now);assert.equal(a.pool.visible,'old');assert.equal(old.wantPlay,true);
 a.time.now=since+8250;a.cutTo(g.id,a.time.now);assert.equal(a.pool.visible,g.id);assert.equal(p.wantPlay,true);assert.equal(a.S.unmuteHint,true);
 a.time.now=since+21000;p.advances=1;a.render();assert.equal(a.el('frameHelp').hidden,false);assert.equal(a.el('frameOpen').href,g.embed,'one unconfirmed report cannot hide the way out');
 p.moving=true;a.cutTo(g.id,a.time.now+100);assert.equal(a.S.pending,null);assert.equal(a.pool.visible,g.id);assert.equal(p.wantPlay,true);a.pool.destroy();
});
test('an automatic switch keeps healthy outgoing footage while the next replay buffers',()=>{
 const {a,g,p,since}=waitingFrame();
 const old=a.pool.open('old',{url:'https://example.test/old.mp4'}).player;old.play();a.pool.show('old');a.S.program={kind:'game',id:'old'};a.S.pinned=null;
 a.time.now=since+8250;a.cutTo(g.id,a.time.now);assert.equal(a.pool.visible,'old');assert.equal(old.wantPlay,true);
 old.moving=false;a.cutTo(g.id,a.time.now+100);assert.equal(a.pool.visible,g.id,'a stalled outgoing player must not hide the incoming controls');a.pool.destroy();
});

test('a nested provider fullscreen cannot hide a detected commercial cover',async()=>{
 const a=embeddedGame();nativeFullscreen(a);const p=a.pool.current;p.element.emit('load');
 a.page.fullscreenElement=p.element;a.emitPage('fullscreenchange');
 a.S.games=[{...game,phase:'break',breakKind:'timeout',lastPlayId:'timeout'}];a.S.live.feed.view=()=>a.S.games;
 a.updateBreaks();a.render();await flush();
 assert.equal(a.page.fullscreenElement,null);assert.equal(a.stage.classList.contains('theater'),true);assert.equal(a.el('ovTitle').innerHTML,'Commercial Break in Progress');assert.equal(a.pool.current,p);assert.equal(p.wantPlay,true);
 a.pool.destroy();
});
test('switching away from a nested fullscreen frame preserves the channel view before retiring it',()=>{
 const a=embeddedGame(),old=a.pool.current;old.element.emit('load');a.page.fullscreenElement=old.element;
 const other={...game,id:'B',teams:[{abbr:'CLE'},{abbr:'NO'}]};a.S.games.push(other);a.S.live.feed.view=()=>[game,other];a.saved.streams['CLE-NO']='https://ntv.st/embed?t=next';
 a.frameEvents.onNavigate=()=>{assert.equal(a.stage.classList.contains('theater'),true);a.page.fullscreenElement=null;a.emitPage('fullscreenchange');};
 a.selectGame('B');assert.equal(a.pool.visible,'B');assert.equal(a.stage.classList.contains('theater'),true);assert.equal(a.S.playing,true);a.frameEvents.onNavigate=null;a.pool.destroy();
});
