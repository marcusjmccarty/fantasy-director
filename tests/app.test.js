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
import {PlayerPool} from '../web/players.js';
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
// Point at a historical app.js to reproduce the audit cases against that revision.
const script=readFileSync(process.env.FANTASY_AUDIT_APP||new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/\ninit\(\);\s*$/,'');
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
// The real pool coordinates these media boundaries. Playback advances only
// when requested; tests can leave a clip buffering or emit provider events.
class Media{
 constructor(source){this.source=source;this.kind='native';this.element=new Element();this.listeners=new Map();this.target=null;this.currentTime=0;this.primed=true;this.advances=2;this.wantPlay=false;this.moving=true;this.inAd=false;}
 on(name,fn){this.listeners.set(name,fn);}emit(name,value){if(name==='ad')this.inAd=value;this.listeners.get(name)?.(value);}
 get progressing(){return this.wantPlay&&this.moving&&!this.inAd;}
 play(){this.wantPlay=true;}pause(){this.wantPlay=false;}seek(at){this.currentTime=at;}near(at){return this.progressing&&Math.abs(this.currentTime-at)<3;}
 destroy(){this.wantPlay=false;this.destroyed=true;}
}
function app(fetcher=async()=>Response.json({events:[]}),{media=false,stored=null,storageBlocked=false}={}){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const document={getElementById(id){assert.ok(elements.has(id),`Missing UI element: ${id}`);return elements.get(id);},querySelectorAll(){return [];},querySelector(){return new Element();},createElement(){return new Element();},addEventListener(){},body:new Element()};
 const time={now:1000};
 class MediaPool extends PlayerPool{constructor(host,options){super(host,{...options,now:()=>time.now,create:source=>new Media(source)});}}
 const storage=new Map(stored===null?[]:[['fantasy-stream-v3',JSON.stringify(stored)]]);
 const ctx={...archive,...sync,...director,...coverage,...replays,...live,...scoring,...roster,...highlights,...preferences,...liveHighlights,PlayerPool:media?MediaPool:Pool,NFLSourceCatalog:class{},document,window:{addEventListener(){}},localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(storageBlocked)throw new Error('Storage unavailable');storage.set(key,value);}},performance:{now:()=>time.now},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,fetch:fetcher,AbortSignal,Response,URL,Date,console};
 vm.createContext(ctx);vm.runInContext(script+'\n globalThis.a={S,pool,director,coverage,clock,step,advanceClock,excluded,cutTo,warm,startHighlight,updateHighlight,finishHighlight,syncFor,nudge,nfl,setMode,setPlaying,setDay,seekTo,replaySource,useRoster,importLeague,pollLive,pollLiveClips,prepareReplay,retryMissedReplays,failHighlight,render,init,roster,get saved(){return saved;}};',ctx);
 return {...ctx.a,time,storage, get saved(){return ctx.a.saved;},el:id=>elements.get(id)};
}
const player={name:'Jonathan Taylor',team:'IND',position:'RB'};
const game={id:'A',name:'IND @ MIN',kind:'live',teams:[{id:'11',abbr:'IND'},{id:'16',abbr:'MIN'}],state:'in',phase:'live',possession:0,down:1,distance:10,yardsToGoal:40,nextSnapIn:null,date:'2026-11-01T18:00:00Z',scores:[],score:[0,0]};
function ready(a){a.S.mode='live';a.useRoster([player],{teamName:'My lineup'});a.S.at=1000;a.S.games=[game];a.S.live.games=[game];a.S.live.feed.push([game],970);}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),get resolve(){return resolve;}};};
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
test('choosing a franchise cancels an older import of another league',async()=>{
 const pending=deferred(),a=app(()=>pending.promise);ready(a);a.saved.leagueId='111';a.saved.league={teams:[{id:'1',name:'Chosen team',players:[player]}]};a.el('leagueId').value='222';const importing=a.importLeague();
 a.el('franchise').onchange({target:{value:'1'}});pending.resolve(Response.json({leagueId:'222',ownedTeamId:'1',teams:[{id:'1',name:'Wrong team',players:[{name:'Joe Burrow',team:'CIN',position:'QB'}]}]}));await importing;
 assert.equal(a.saved.leagueId,'111');assert.equal(a.saved.teamName,'Chosen team');assert.equal(a.el('importLeague').disabled,false);
});
test('a team ID from another league cannot automatically select a different owner’s roster',async()=>{
 const a=app(async()=>Response.json({leagueId:'222',name:'New league',teams:[{id:'1',name:'Not my team',players:[{name:'Joe Burrow',team:'CIN',position:'QB'}]}]}));ready(a);a.saved.leagueId='111';a.saved.teamId='1';a.el('leagueId').value='222';await a.importLeague();
 assert.equal(a.saved.teamName,'My lineup');assert.equal(a.saved.teamId,'');assert.equal(a.saved.roster[0].team,'IND');assert.equal(a.el('franchise').focused,true);
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
