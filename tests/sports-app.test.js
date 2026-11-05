import {StreamFinder,refusesFrame} from '../web/stream-finder.js';
import {stripEnds,stripTabStop,stripKeys} from '../web/strip.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as data from '../web/sports-data.js';
import {safeVideo,streamType,teamColor,teamLogo,forgetESPN} from '../web/roster.js';
import {headToHead,benchRows,matchupColumns,nearStart} from '../web/scoreboard.js';
import {mountChat,chatRoomFor} from '../web/chat.js';
import {normalizeHighlights,mergeHighlights,highlightView,playable} from '../web/highlights.js';
const html=readFileSync(new URL('../web/sports.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../web/sports-app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').split("for(const a of document.querySelectorAll('[data-sport]'))")[0];
class Element{addEventListener(name,fn){(this.listeners??={})[name]=fn;}constructor(){this.dataset={};this.value='';this.textContent='';this.innerHTML='';const classes=new Set();this.classList={add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle:(n,v)=>v?classes.add(n):classes.delete(n)};}setAttribute(n,v){this[n]=v;}showModal(){this.open=true;}close(){this.open=false;}}
class Pool{constructor(host,options){this.options=options;this.slots=new Map();this.opened=0;this.visible=null;this.muted=false;}open(id,source){this.opened++;const player={kind:source.type==='embed/page'?'embed':'native',element:new Element(),wantPlay:false,reloads:0,reload(){this.reloads++;},checkHealth(options){this.health=options;}};this.slots.set(id,{url:source.url,source,player});}get(id){return this.slots.get(id);}get current(){return this.get(this.visible)?.player;}setMuted(v){this.muted=v;}setRunning(on){this.running=on;for(const slot of this.slots.values())slot.player.wantPlay=on;}show(id){this.visible=id;this.current.wantPlay=this.running;}close(id){this.slots.delete(id);if(this.visible===id)this.visible=null;}destroy(){this.slots.clear();this.visible=null;}retryAudio(){}}
function app(fetcher,{sport='nba',stored={}}={}){const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()])),stage=new Element(),events=new Map(),storage=new Map(Object.entries(stored)),timers=new Map();let timer=0;
 elements.get('games').addEventListener=function(name,fn){(this.listeners??={})[name]=fn;};
 const document={getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id);},querySelector:()=>stage,addEventListener:(n,fn)=>events.set(n,fn),visibilityState:'visible'};
 const ctx={StreamFinder,refusesFrame,stripEnds,stripTabStop,stripKeys,forgetESPN,...data,esc:data.escapeHTML,safeVideo,streamType,teamColor,teamLogo,headToHead,benchRows,matchupColumns,nearStart,mountChat,chatRoomFor,normalizeHighlights,mergeHighlights,highlightView,playable,PlayerPool:Pool,document,location:{search:'?sport='+sport},URLSearchParams,AbortController,AbortSignal,Response,Date,console,fetch:fetcher,window:{addEventListener(){}},navigator:{onLine:true},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(ctx);vm.runInContext(source+'\nglobalThis.app={S,pool,streamFinder,refreshStreamLinks,loadGames,loadLeague,renderGuide,renderFantasy,renderTransport,selectGame,setPlaying,direct,changeDate,rotateSource,tick,saveStreamLink,openStream,selectReplay,setMode,playClip,leaveClip,get saved(){return saved;}};',ctx);return {...ctx.app,el:id=>elements.get(id),stage,document,events,storage,timers};}
const event=(id='1')=>({id,date:'2026-11-01T22:00Z',shortName:'ATL @ BOS',competitions:[{status:{type:{state:'in',name:'STATUS_IN_PROGRESS',shortDetail:'3rd 2:00'}},competitors:[{homeAway:'away',team:{id:'1',abbreviation:'ATL',displayName:'Atlanta'},score:'80'},{homeAway:'home',team:{id:'2',abbreviation:'BOS',displayName:'Boston'},score:'81'}]}]});
const games=(sport='nba',date=data.localDate())=>({sport,date,season:2027,events:[event()]});
const league=(id='123')=>({leagueId:id,sport:'nba',season:2027,name:'League',isPoints:true,scoringType:'H2H_POINTS',scoringPeriod:13,ownedTeamId:'1',teams:[{id:'1',name:'My team',players:[{id:'1',name:'Starter one',team:'ATL',teamId:'1',active:true,points:10}]},{id:'2',name:'Other team',players:[{id:'2',name:'Starter two',team:'BOS',teamId:'2',active:true,points:20}]}],matchups:[{id:'2',home:{teamId:'1',points:50},away:{teamId:'2',points:60}}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const input={leagueId:'123',swid:'',s2:'',season:2027};
async function ready(a){await a.loadGames();a.saved.streams['nba:1']={primary:'https://example.test/live.m3u8',backup:'https://example.test/embed/backup'};a.selectGame('1');}
test('sports UI requests its selected sport and renders scores and game links',async()=>{for(const sport of ['nba','nhl','mlb']){let url;const a=app(async u=>{url=u;return Response.json(games(sport));},{sport});await a.loadGames();assert.match(url,new RegExp('sport='+sport));assert.match(a.el('games').innerHTML,/Atlanta/);assert.match(a.el('games').innerHTML,/>80</);assert.equal(a.S.gamesError,false);}});
test('sports UI distinguishes a failed feed from a genuinely empty day',async()=>{const a=app(async()=>Response.json({error:'Unavailable'},{status:502}));await a.loadGames();assert.match(a.el('games').innerHTML,/unavailable/);assert.doesNotMatch(a.el('games').innerHTML,/No NBA games scheduled/);assert.equal(a.el('ovTitle').textContent,'Game updates are unavailable.');const b=app(async url=>Response.json({...games('nba',/date=([\d-]+)/.exec(url)[1]),events:[]}));await b.loadGames();assert.match(b.el('games').innerHTML,/No NBA games in the next week/);});
test('a late day response cannot overwrite the newly selected schedule',async()=>{const pending=deferred();let count=0;const a=app(async()=>++count===1?pending.promise:Response.json(games('nba','2026-11-02')));const old=a.loadGames();a.changeDate('2026-11-02');await new Promise(r=>setTimeout(r,0));pending.resolve(Response.json(games('nba','2026-11-01')));await old;await new Promise(r=>setTimeout(r,5));assert.equal(a.S.date,'2026-11-02');assert.equal(a.S.games.length,1);assert.equal(a.S.gameGeneration,2);});
test('fantasy requests and team changes cannot reload the playing source',async()=>{const a=app(async url=>Response.json(url.startsWith('/api/sports?')?games():league()));await ready(a);const p=a.pool.current;await a.loadLeague(input);assert.equal(a.pool.current,p);assert.match(a.el('fantasyPlayers').innerHTML,/Starter one/);assert.equal(a.el('fantasyTotal').textContent,'50.00');assert.equal(a.el('opponentTotal').textContent,'60.00');assert.equal(a.el('matchupStatus').textContent,'Behind by 10.00');a.el('scoreTeam').onchange({target:{value:'2'}});assert.equal(a.saved.teamId,'2');assert.equal(a.el('fantasyTitle').textContent,'Other team');assert.match(a.el('fantasyPlayers').innerHTML,/Starter two/);assert.equal(a.pool.current,p);assert.equal(a.pool.opened,1);});
test('a failed refresh keeps the last fantasy data and labels its stale state',async()=>{let fail=false;const a=app(async()=>fail?Response.json({error:'Reconnect ESPN'},{status:401}):Response.json(league()));await a.loadLeague(input);fail=true;await a.loadLeague();assert.match(a.el('fantasyPlayers').innerHTML,/Starter one/);assert.match(a.el('fantasyStatus').textContent,/Last good update.*Reconnect ESPN/);assert.equal(a.el('retryFantasy').hidden,false);assert.equal(a.el('leagueImport').open,true);});
test('the newest explicit fantasy import wins and old responses cannot change the league',async()=>{const pending=deferred();let count=0;const a=app(async()=>++count===1?pending.promise:Response.json(league('456')));const old=a.loadLeague(input);await a.loadLeague({...input,leagueId:'456'});pending.resolve(Response.json(league()));await old;assert.equal(a.saved.leagueId,'456');assert.equal(a.S.league.leagueId,'456');});
test('Pause stops source rotation and automatic viewing while retaining fullscreen',async()=>{const a=app(async()=>Response.json(games()));await ready(a);a.stage.classList.add('theater');a.setPlaying(false);a.rotateSource('1',true);a.direct();assert.equal(a.pool.opened,1);assert.equal(a.pool.current.wantPlay,false);assert.equal(a.stage.classList.contains('theater'),true);a.setPlaying(true);a.rotateSource('1',true);assert.equal(a.pool.opened,2);assert.equal(a.el('openStream').href,'https://example.test/embed/backup');});
test('media errors leave retry timing to the proven adapter instead of reloading immediately',async()=>{const a=app(async()=>Response.json(games()));await ready(a);const p=a.pool.current;a.pool.options.onError('1',new Error('failed'));assert.equal(p.reloads,0);assert.equal(a.pool.current,p);});
test('automatic failover rotates only the active game and respects its retry spacing',async()=>{const a=app(async()=>Response.json(games()));await ready(a);a.pool.options.onReconnect('other',{failover:true});assert.equal(a.pool.opened,1);a.pool.options.onReconnect('1',{failover:true});assert.equal(a.pool.opened,2);a.pool.options.onReconnect('1',{failover:true});assert.equal(a.pool.opened,2);assert.equal(a.S.current,'1');});
test('changing the schedule date preserves the current source and NFL preferences',async()=>{const nfl=JSON.stringify({leagueId:'456',roster:[{name:'NFL starter'}]});const a=app(async()=>Response.json(games()),{stored:{'fantasy-stream-v3':nfl}});await ready(a);const p=a.pool.current;a.changeDate('2026-11-02');assert.equal(a.pool.current,p);assert.equal(a.storage.get('fantasy-stream-v3'),nfl);});

test('health checks activate direct-video recovery and honor Pause and background visibility',async()=>{const a=app(async()=>Response.json(games()));await ready(a);const p=a.pool.current;a.tick();assert.equal(p.health.active,true);assert.equal(p.health.foreground,true);a.document.visibilityState='hidden';a.tick();assert.equal(p.health.foreground,false);a.setPlaying(false);p.health=null;a.tick();assert.equal(p.health,null);});
test('sports discovery resumes a saved team with a player embed and leaves manual overrides untouched',async()=>{
 const a=app(async url=>url.startsWith('/api/sports?')?Response.json(games()):url.startsWith('/api/streams?')?Response.json({sport:'nba',entries:[{sport:'nba',title:'Atlanta vs Boston',start:Date.parse(event().date),sources:['https://streamcorner.st/watch/nba?source=0']}]}):Response.json({page:'https://streamcorner.st/watch/nba?source=0',url:'https://player.example/embed?t=nba'}));await a.loadGames();a.saved.leagueId='123';a.saved.teamId='1';await a.refreshStreamLinks();assert.equal(a.S.playing,true);assert.equal(a.pool.get('1').url,'https://player.example/embed?t=nba');assert.equal(Object.keys(a.saved.streams).length,0);assert.equal(a.el('openStream').href,'https://streamcorner.st/watch/nba?source=0');
 a.setPlaying(false);a.S.autoAttempted=true;await a.refreshStreamLinks();assert.equal(a.S.playing,false);
});
test('sports saved provider override resolves before replacing the current player',async()=>{
 const pending=deferred(),a=app(async url=>url.includes('/resolve?')?pending.promise:Response.json(games()));await ready(a);const old=a.pool.current;const save=a.saveStreamLink(a.S.games[0],{primary:'https://streamcorner.st/game',backup:''});assert.equal(a.pool.current,old);a.setPlaying(false);pending.resolve(Response.json({page:'https://streamcorner.st/game',url:'https://provider.example/embed/live'}));await save;assert.equal(a.S.playing,false);assert.equal(a.pool.visible,null);assert.equal(a.saved.streams['nba:1'].primary,'https://streamcorner.st/game');
});

test('every sport renders tiles with team colors, logos and a stream chip',async()=>{
 for(const sport of ['nba','nhl','mlb']){const raw=games(sport);raw.events[0].competitions[0].competitors[0].team={...raw.events[0].competitions[0].competitors[0].team,color:'e03a3e',logo:'https://a.espncdn.com/i/teamlogos/'+sport+'/500/atl.png',shortDisplayName:'Hawks'};raw.events[0].competitions[0].broadcasts=[{names:['TNT']}];
  const a=app(async()=>Response.json(raw),{sport});await a.loadGames();const html=a.el('games').innerHTML;
  assert.match(html,/--away:#e03a3e/);assert.match(html,new RegExp('teamlogos/'+sport+'/500/atl.png'));assert.match(html,/>Hawks</);assert.match(html,/data-add-stream="1"/);assert.match(html,/TNT/);
  assert.equal(a.el('dayLabel').textContent,'');}
});
test('the matchup rail fills from ESPN, lists the bench under the starters and labels the header score',async()=>{
 const data=league();data.teams[0].players.push({id:'3',name:'Bench guy',team:'NYK',teamId:'18',active:false,slot:'BE',position:'C',points:4});
 const a=app(async url=>Response.json(url.startsWith('/api/sports?')?games():data));await a.loadGames();a.renderFantasy();assert.equal(a.el('scoreboard').dataset.connect,'true');
 await a.loadLeague(input);assert.equal(a.el('scoreboard').dataset.connect,'false');assert.equal(a.el('scoreboard').dataset.state,'behind');assert.match(a.el('fantasyPlayers').innerHTML,/Starter one/);assert.doesNotMatch(a.el('fantasyPlayers').innerHTML,/Bench guy/);assert.match(a.el('fantasyBench').innerHTML,/Bench guy/);assert.match(a.el('fantasyBench').innerHTML,/4\.00/);assert.equal(a.el('benchTable').hidden,false);assert.equal(a.el('fantasyStatus').hidden,true);
 assert.equal(a.el('headerScore').hidden,false);assert.match(a.el('headerScore').innerHTML,/<b>50<\/b>.*<b>60<\/b>/);assert.match(a.el('fantasyPlayers').innerHTML,/player-live-dot/);
});
test('the league form accepts a pasted league link and Done closes without reloading',async()=>{
 let calls=0;const a=app(async url=>{if(!url.startsWith('/api/sports?'))calls++;return Response.json(url.startsWith('/api/sports?')?games():league());});
 a.el('leagueId').value='https://fantasy.espn.com/basketball/league?leagueId=123&seasonId=2027';a.el('leagueSeason').value='2027';await a.el('leagueForm').onsubmit({preventDefault(){}});assert.equal(a.saved.leagueId,'123');assert.equal(calls,1);
 a.el('leagueDialog').showModal();await a.el('leagueForm').onsubmit({preventDefault(){}});assert.equal(calls,1);assert.equal(a.el('leagueDialog').open,false);
 a.el('leagueId').value='not a league';await a.el('leagueForm').onsubmit({preventDefault(){}});assert.match(a.el('leagueError').textContent,/league ID/);
});

test('the Live dot is red only while a game in this league is in progress',async()=>{
 const a=app(async()=>Response.json(games()));await a.loadGames();assert.equal(a.el('liveDot').classList.contains('on'),true);
 const final=games();final.events[0].competitions[0].status.type={state:'post',name:'STATUS_FINAL',shortDetail:'Final'};const b=app(async()=>Response.json(final));await b.loadGames();assert.equal(b.el('liveDot').classList.contains('on'),false);
});

test('browsing another day or a failed feed cannot claim no games are live',async()=>{
 let fail=false;const a=app(async()=>fail?Response.json({error:'x'},{status:502}):Response.json(games()));await a.loadGames();assert.equal(a.el('liveDot').classList.contains('on'),true);
 fail=true;await a.loadGames();assert.equal(a.el('liveDot').classList.contains('on'),true);
});

test('an empty day looks ahead to the next day with games and says so',async()=>{
 const asked=[];const a=app(async url=>{const date=/date=([\d-]+)/.exec(url)[1];asked.push(date);return Response.json(date===data.localDate()?{...games(),events:[]}:date>data.localDate()&&asked.length>=3?games('nba',date):{...games('nba',date),events:[]});});
 await a.loadGames();assert.equal(asked[0],data.localDate());assert.ok(asked.length>=3);assert.equal(a.S.games.length,1);assert.notEqual(a.S.date,data.localDate());assert.match(a.el('dayLabel').textContent,/next games/);assert.equal(a.el('liveDot').classList.contains('on'),false);
 const b=app(async url=>Response.json({...games('nba',/date=([\d-]+)/.exec(url)[1]),events:[]}));await b.loadGames();assert.equal(b.S.games.length,0);assert.match(b.el('games').innerHTML,/No NBA games in the next week/);
});

const replayGame={id:'g',sport:'nba',away:'Atlanta Hawks',home:'Indiana Pacers',title:'Atlanta Hawks vs. Indiana Pacers',date:'2026-11-02T17:00:00Z',page:'https://basketballreplays.net/g'};
const replayApp=sources=>app(async url=>url.startsWith('/api/replays/resolve')?Response.json({sources}):url.startsWith('/api/replays')?Response.json({games:[replayGame]}):Response.json(games()));
test('a replay host that refuses sandboxed frames opens on its own page and never loads in a frame',async()=>{
 const a=replayApp([{url:'https://gobsao8u.com/e/a',provider:'gobsao8u.com',type:'embed/page'},{url:'https://bysesukior.com/e/b',provider:'bysesukior.com',type:'embed/page'}]);
 a.setMode('replay');await new Promise(r=>setTimeout(r,5));await a.selectReplay('g');
 assert.equal(a.pool.opened,0,'no frame for these hosts');assert.equal(a.el('overlay').hidden,false);assert.equal(a.el('ovOpen').hidden,false);assert.equal(a.el('ovOpen').href,'https://gobsao8u.com/e/a');assert.match(a.el('ovTitle').textContent,/its own page/);
});
test('a replay with an ok.ru player plays it first, whatever order the page listed them',async()=>{
 const a=replayApp([{url:'https://bysesukior.com/e/b',provider:'bysesukior.com',type:'embed/page'},{url:'https://ok.ru/videoembed/123',provider:'OK',type:'provider/ok'}]);
 a.setMode('replay');await new Promise(r=>setTimeout(r,5));await a.selectReplay('g');
 assert.equal(a.pool.opened,1);assert.equal(a.pool.get('rp:g').url,'https://ok.ru/videoembed/123');assert.equal(a.el('ovOpen').hidden,true);
});

test('the schedule polls faster around a listed start, and falls back when a game stays pre',async()=>{
 const delayFor=async date=>{const day=games();day.events[0].date=date;day.events[0].competitions[0].status.type={state:'pre',name:'STATUS_SCHEDULED',shortDetail:''};const a=app(async()=>Response.json(day));a.timers.clear();await a.loadGames();return a.timers.get(Math.max(...[...a.timers.keys()].filter(k=>[15000,60000].includes(a.timers.get(k).ms)))).ms;};
 const from=minutes=>new Date(Date.now()+minutes*60000).toISOString();
 assert.equal(await delayFor(from(2)),15000);assert.equal(await delayFor(from(-5)),15000);assert.equal(await delayFor(from(300)),60000);assert.equal(await delayFor(from(-300)),60000);
});

// ---------- a scripted Worker for the strip, replay and resume tests ----------
const settle=()=>new Promise(r=>setTimeout(r,5));
const shift=n=>{const d=new Date();d.setDate(d.getDate()+n);return data.localDate(d);};
const dayOf=url=>/date=([\d-]+)/.exec(url)?.[1];
const finalEvent=(id,date)=>{const e=event(id);e.date=date+'T22:00Z';e.competitions[0].status.type={state:'post',name:'STATUS_FINAL',shortDetail:'Final'};return e;};
const listed=(id,date)=>({id,away:'Atlanta',home:'Boston',title:'Atlanta vs. Boston',date:date+'T22:00:00Z',page:'https://basketballreplays.net/'+id});
function worker({sport='nba',day=()=>[],catalog=()=>({sport,games:[]}),resolve=()=>({sources:[]})}={}){
 const calls=[],answer=async url=>{const value=url.startsWith('/api/replays/resolve')?await resolve():url.startsWith('/api/replays')?await catalog():url.startsWith('/api/sports?')?await day(dayOf(url)):{};return value instanceof Response?value:Array.isArray(value)?Response.json({sport,date:dayOf(url),season:2026,events:value}):Response.json(value);};
 const fetcher=(url,options)=>{calls.push({url,signal:options?.signal});return answer(url);};
 return {fetcher,calls,days:()=>calls.filter(c=>c.url.startsWith('/api/sports?')).map(c=>dayOf(c.url)),catalogs:()=>calls.filter(c=>c.url.startsWith('/api/replays?')).length,clear(){calls.length=0;}};
}
const down=()=>Response.json({error:'Unavailable'},{status:502});
const gateway=(status=502)=>new Response('<!DOCTYPE html><html><body>Worker exceeded resource limits</body></html>',{status,headers:{'Content-Type':'text/html'}});

test('a clip that fails hands the picture back to the game on its own',async()=>{
 const a=app(async()=>Response.json(games()));await ready(a);a.S.highlights=[{id:'c1',gameId:'1',title:'Clip',mediaUrl:'https://media.video-cdn.espn.com/motion/clip.mp4',players:[],discoveredAt:0,publishedAt:0}];
 a.playClip('c1');assert.equal(a.pool.visible,'hl:c1');
 a.pool.options.onError('hl:c1',new Error('bad media'));assert.equal(a.S.clip,null);assert.equal(a.pool.visible,'1');assert.equal(a.pool.get('hl:c1'),undefined);
});

test('the strip arrows chain only while their own scroll is moving, and a stale target cannot move the strip',async()=>{
 const a=app(async()=>Response.json(games())),list=a.el('games');Object.assign(list,{scrollWidth:5000,clientWidth:1000,scrollLeft:0,scrollTo(o){this.went=o.left;}});
 a.el('stripNext').onclick();assert.equal(list.went,800);list.scrollLeft=200;a.el('stripNext').onclick();assert.equal(list.went,1600,'a quick second click carries on from the first target');
 a.S.stripStartedAt-=701;list.scrollLeft=100;a.el('stripNext').onclick();assert.equal(list.went,900,'with no scrollend the target expires by time');
 a.S.stripStartedAt-=701;list.scrollLeft=4000;a.el('stripPrev').onclick();assert.equal(list.went,3200,'one click back from where the viewer actually is');
 a.S.stripTarget=800;a.S.stripStartedAt=Date.now();list.scrollLeft=800;a.el('stripNext').onclick();assert.equal(list.went,1600,'a scroll that has landed starts from where it landed');
 a.S.stripTarget=3000;a.S.stripStartedAt=Date.now();list.scrollLeft=100;list.scrollWidth=2000;a.el('stripPrev').onclick();assert.equal(list.went,200,'a strip that shrank clamps the old target first');list.scrollWidth=5000;
 for(const name of ['scrollend','pointerdown','touchstart']){a.S.stripTarget=3000;list.listeners[name]();assert.equal(a.S.stripTarget,null,name);}
 a.S.stripTarget=3000;list.listeners.wheel({deltaX:5,deltaY:0,preventDefault(){}});assert.equal(a.S.stripTarget,null,'a sideways swipe counts as well');
});

test('an empty past week is asked once, in parallel, with its own timeout that a poll cannot abort',async()=>{
 const w=worker(),a=app(w.fetcher);await a.loadGames();await settle();
 const past=()=>w.calls.filter(c=>dayOf(c.url)<data.localDate());assert.equal(past().length,7);const signals=past().map(c=>c.signal);assert.ok(signals.every(s=>s instanceof AbortSignal));
 assert.equal(a.S.pastLoading,false);await a.loadGames();await settle();assert.equal(past().length,7,'the next poll does not walk it again');assert.ok(signals.every(s=>!s.aborted));
 a.S.pastRetryAt=Date.now()-1;await a.loadGames();await settle();assert.equal(past().length,14,'it is asked again after ten minutes');
});
test('past days keep their order and a malformed day cannot leave the loader stuck',async()=>{
 const w=worker({day:date=>date===shift(-1)?[finalEvent('11',date)]:date===shift(-3)?[finalEvent('13',date)]:date===shift(-2)?{sport:'nba',date,season:2026,events:[null]}:[]}),a=app(w.fetcher);await a.loadGames();await settle();
 assert.equal(a.S.pastLoading,false);assert.equal(a.S.pastDays.map(d=>d.date).join(),[shift(-3),shift(-1)].join());
 assert.ok(a.S.pastRetryAt-Date.now()<=120000,'a failed day is asked again in two minutes');
});
test('a past day that failed fills in by itself, keeps the good days, and does not move the strip',async()=>{
 let fail=true;const w=worker({day:date=>{if(date===shift(0))return [event('1')];if(date===shift(-2)&&fail)return down();if(date===shift(-1))return fail?[finalEvent('11',date)]:down();return date===shift(-2)?[finalEvent('12',date)]:[];}}),a=app(w.fetcher),list=a.el('games');
 Object.defineProperty(list,'scrollWidth',{get(){return this.innerHTML.length;}});list.scrollLeft=0;
 await a.loadGames();await settle();assert.equal(a.S.pastDays.length,1);a.S.stripScrolled=true;list.scrollLeft=40;const before=list.innerHTML.length;
 fail=false;await a.loadGames();await settle();assert.equal(a.S.pastDays.length,1,'still inside the two-minute wait');
 a.S.pastRetryAt=Date.now()-1;await a.loadGames();await settle();
 assert.equal(a.S.pastDays.map(d=>d.date).join(),[shift(-2),shift(-1)].join(),'the filled-in day joins, and the day that failed this time is kept');
 assert.equal(a.S.stripScrolled,true);assert.equal(list.scrollLeft,40+list.innerHTML.length-before,'what the viewer was looking at stays put');
});

test('one bad lookahead day does not sink the schedule: the nearest day with games still shows',async()=>{
 const w=worker({day:date=>date===shift(1)?down():date===shift(3)?[event('1')]:[]}),a=app(w.fetcher);await a.loadGames();
 assert.equal(a.S.gamesError,false);assert.equal(a.S.date,shift(3));assert.equal(a.S.lookahead.at,0,'the failed earlier day is asked again next poll');
 w.clear();await a.loadGames();assert.ok(w.days().includes(shift(1)));
});
test('an empty week is remembered for ten minutes, then walked again, and Refresh rechecks it now',async()=>{
 const w=worker(),a=app(w.fetcher);await a.loadGames();await settle();assert.equal(a.S.lookahead.date,null);const at=a.S.lookahead.at;assert.match(a.el('games').innerHTML,/No NBA games in the next week/);
 w.clear();await a.loadGames();await settle();assert.equal(w.days().join(),data.localDate(),'the next poll asks only for today');assert.equal(a.S.lookahead.at,at,'and does not extend the memo');
 a.S.lookahead.at=Date.now()-600001;w.clear();await a.loadGames();assert.equal(w.days().length,8);
 w.clear();a.el('refreshGames').onclick();await settle();assert.ok(w.days().filter(d=>d>data.localDate()).length===7);
});
test('a week with a failed day is not remembered as empty',async()=>{
 const w=worker({day:date=>date===shift(4)?down():[]}),a=app(w.fetcher);await a.loadGames();assert.equal(a.S.gamesError,false);assert.equal(a.S.lookahead,null);
 w.clear();await a.loadGames();assert.equal(w.days().length,8);
});
test('a failed day cannot empty a strip that is already showing the next games',async()=>{
 let fail=false;const w=worker({day:date=>date===shift(2)?(fail?down():[event('1')]):[]}),a=app(w.fetcher);await a.loadGames();assert.equal(a.S.games.length,1);
 fail=true;a.S.lookahead.at=0;await a.loadGames();assert.equal(a.S.games.length,1);assert.equal(a.S.date,shift(2));
});
test('a total outage reports itself and comes back without a click',async()=>{
 let fail=true;const w=worker({day:date=>fail&&date>data.localDate()?down():date===shift(2)?[event('1')]:[]}),a=app(w.fetcher);a.timers.clear();await a.loadGames();
 assert.equal(a.S.gamesError,true);assert.match(a.el('games').innerHTML,/unavailable/);assert.equal(a.el('ovTitle').textContent,'Game updates are unavailable.');
 const retry=[...a.timers.values()].find(t=>t.ms===15000);assert.ok(retry,'it retries in fifteen seconds');
 fail=false;await retry.fn();assert.equal(a.S.gamesError,false);assert.equal(a.S.games.length,1);
});
test('an outage keeps its message up through a retry instead of flickering back to loading',async()=>{
 const gate=deferred();let calls=0;const a=app(async url=>{if(!url.startsWith('/api/sports?'))return Response.json({games:[]});if(++calls===1)return down();await gate.promise;return Response.json(games());});
 await a.loadGames();const retry=a.loadGames();assert.equal(a.el('ovTitle').textContent,'Game updates are unavailable.');a.renderGuide();assert.match(a.el('games').innerHTML,/unavailable/);
 gate.resolve();await retry;assert.equal(a.S.gamesError,false);assert.equal(a.S.games.length,1);
});

test('the MLB off-season strip fills with past finals and replay tiles and keeps them through a bad poll',async()=>{
 const yesterday=shift(-1);let fail=false;const w=worker({sport:'mlb',day:date=>fail?down():date===yesterday?[finalEvent('11',date)]:[],catalog:()=>({sport:'mlb',games:[listed('r',yesterday),listed('o',shift(-20))]})}),a=app(w.fetcher,{sport:'mlb'});
 await a.loadGames();await settle();const full=a.el('games').innerHTML;assert.match(full,/data-past-replay="r"/);assert.match(full,/class="tile past/);assert.match(full,/class="tile replay/);assert.doesNotMatch(full,/No MLB games/);
 fail=true;await a.loadGames();assert.equal(a.S.gamesError,true);assert.equal(a.el('games').innerHTML,full,'a failed poll leaves every tile in place');
 fail=false;const again=a.loadGames();a.renderGuide();assert.equal(a.el('games').innerHTML,full,'and so does a render during the retry');await again;assert.equal(a.S.gamesError,false);assert.equal(a.el('games').innerHTML,full);
});
test('with the game feed down from the start the replay tiles still load',async()=>{
 const yesterday=shift(-1);const w=worker({sport:'mlb',day:()=>down(),catalog:()=>({sport:'mlb',games:[listed('r',yesterday)]})}),a=app(w.fetcher,{sport:'mlb'});
 await a.loadGames();await settle();assert.equal(a.S.gamesError,true);assert.equal(w.catalogs(),1);assert.match(a.el('games').innerHTML,/data-past-replay="r"/);
});

for(const [name,failure] of [['a 502 from the Worker',()=>Response.json({sport:'nba',games:[],error:'Replays are unavailable right now. timeout'},{status:502})],['a dropped connection',()=>{throw new TypeError('Failed to fetch');}],['a gateway page',()=>gateway()]])
test('in Live mode the replay listing recovers from '+name+' after a minute',async()=>{
 const yesterday=shift(-1);let fail=true;const w=worker({day:date=>date===yesterday?[finalEvent('11',date)]:[],catalog:()=>fail?failure():{sport:'nba',games:[listed('r',yesterday)]}}),a=app(w.fetcher);
 await a.loadGames();await settle();assert.equal(w.catalogs(),1);assert.match(a.el('games').innerHTML,/Replay unavailable/);assert.doesNotMatch(a.el('games').innerHTML,/data-past-replay/);
 a.tick();await settle();assert.equal(w.catalogs(),1,'not before the minute is up');
 a.S.replaysAt=Date.now()-60001;fail=false;a.tick();await settle();assert.equal(w.catalogs(),2);assert.equal(a.S.replayError,'');assert.match(a.el('games').innerHTML,/data-past-replay="r"/);assert.doesNotMatch(a.el('games').innerHTML,/Replay unavailable/);
});
test('an empty strip says replays are down and comes back when they are',async()=>{
 let fail=true;const w=worker({catalog:()=>fail?down():{sport:'nba',games:[listed('r',shift(-1))]}}),a=app(w.fetcher);await a.loadGames();await settle();
 assert.match(a.el('games').innerHTML,/replays are unavailable, trying again/);
 a.S.replaysAt=Date.now()-60001;fail=false;a.tick();await settle();assert.match(a.el('games').innerHTML,/class="tile replay/);
});
test('the past tile label holds steady while a replay retry is in flight',async()=>{
 const yesterday=shift(-1),gate=deferred();let calls=0;const w=worker({day:date=>date===yesterday?[finalEvent('11',date)]:[],catalog:()=>++calls===1?down():gate.promise}),a=app(w.fetcher);
 await a.loadGames();await settle();const before=a.el('games').innerHTML;assert.match(before,/Replay unavailable/);
 a.S.replaysAt=Date.now()-60001;a.tick();assert.equal(a.S.replayLoading,true);assert.equal(a.el('games').innerHTML,before);
 gate.resolve({sport:'nba',games:[]});await settle();
});
test('the NHL note is an answer, not a failure: Live mode does not poll it',async()=>{
 const w=worker({sport:'nhl',catalog:()=>({sport:'nhl',games:[],note:'No replay source for the NHL yet.'})}),a=app(w.fetcher,{sport:'nhl'});await a.loadGames();await settle();assert.equal(w.catalogs(),1);
 a.S.replaysAt=Date.now()-3600000;a.tick();await settle();assert.equal(w.catalogs(),1);
});
test('the first tick starts no catalog fetch, and a healthy listing refreshes in Live only every fifteen minutes',async()=>{
 const w=worker({catalog:()=>({sport:'nba',games:[listed('r',shift(-1))]})}),a=app(w.fetcher);a.tick();await settle();assert.equal(w.catalogs(),0);
 await a.loadGames();await settle();assert.equal(w.catalogs(),1);a.S.replaysAt=Date.now()-60001;a.tick();await settle();assert.equal(w.catalogs(),1);
 a.S.replaysAt=Date.now()-900001;a.tick();await settle();assert.equal(w.catalogs(),2);
});
test('a failed listing refresh keeps the tiles already showing, and Refresh retries it from Live',async()=>{
 let fail=false;const w=worker({catalog:()=>fail?Response.json({sport:'nba',games:[],error:'Replays are unavailable right now. x'},{status:502}):{sport:'nba',games:[listed('r',shift(-1))]}}),a=app(w.fetcher);await a.loadGames();await settle();const full=a.el('games').innerHTML;
 fail=true;a.S.replaysAt=Date.now()-900001;a.tick();await settle();assert.equal(a.S.replays.games.length,1);assert.equal(a.el('games').innerHTML,full);assert.ok(a.S.replayError);
 fail=false;w.clear();a.el('refreshGames').onclick();await settle();assert.equal(w.catalogs(),1);assert.equal(a.S.replayError,'');
});

const replayWorker=(resolve,extra={})=>worker({day:()=>[event('1'),event('2')],catalog:()=>({sport:'nba',games:[listed('r',shift(-1)),listed('s',shift(-2))]}),resolve,...extra});
const tile=(a,id)=>a.el('games').innerHTML.split('<li').find(x=>x.includes(`data-replay="${id}"`));
test('a replay that will not open says Retry, not On screen, and a second tap plays it',async()=>{
 let fail=true;const a=app(replayWorker(()=>fail?Response.json({error:'That page has no player we can embed.'},{status:404}):{sources:[{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]}).fetcher);
 a.setMode('replay');await settle();await a.selectReplay('r');assert.equal(a.pool.visible,null);
 let html=tile(a,'r');assert.doesNotMatch(html,/ON AIR|On screen/);assert.match(html,/Retry/);assert.match(html,/aria-pressed="false"/);assert.doesNotMatch(html,/watching/);assert.equal(a.el('ovTitle').textContent,'That replay won’t open right now.');
 fail=false;await a.selectReplay('r');assert.equal(a.pool.visible,'rp:r');html=tile(a,'r');assert.match(html,/ON AIR/);assert.match(html,/On screen/);assert.match(html,/aria-pressed="true"/);
});
test('a replay tile says Opening while it loads and new tab for a host that refuses frames',async()=>{
 const gate=deferred(),a=app(replayWorker(()=>gate.promise).fetcher);a.setMode('replay');await settle();const opening=a.selectReplay('r');let html=tile(a,'r');assert.doesNotMatch(html,/ON AIR|On screen/);assert.match(html,/Opening/);
 gate.resolve({sources:[{url:'https://gobsao8u.com/e/a',provider:'gobsao8u.com',type:'embed/page'}]});await opening;html=tile(a,'r');assert.doesNotMatch(html,/ON AIR|On screen/);assert.match(html,/new tab/);assert.equal(a.el('ovOpen').hidden,false);
});
test('overlapping taps cannot leave an old failure on the replay that is playing',async()=>{
 const answers=[deferred(),deferred(),deferred()],ok={sources:[{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]};let n=0;const w=replayWorker(()=>answers[n++].promise),a=app(w.fetcher);a.setMode('replay');await settle();
 const first=a.selectReplay('r'),again=a.selectReplay('r');assert.equal(n,1,'a second tap while it loads starts nothing');await again;
 const other=a.selectReplay('s'),back=a.selectReplay('r');assert.equal(n,3);
 answers[0].resolve(Response.json({error:'old attempt'},{status:404}));await first;assert.equal(a.S.replay.error,'','the abandoned attempt writes nothing');
 answers[1].resolve(ok);await other;assert.equal(a.pool.visible,null,'and the one for the other game does not play');assert.equal(a.S.replay.id,'r');assert.equal(a.S.replay.loading,true);
 answers[2].resolve(ok);await back;assert.equal(a.pool.visible,'rp:r');assert.equal(a.S.replay.error,'');assert.match(tile(a,'r'),/ON AIR/);
});

const resumeApp=async(extra={})=>{const w=replayWorker(()=>({sources:[{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]}),extra),a=app(w.fetcher);await a.loadGames();await settle();for(const id of ['1','2'])a.saved.streams['nba:'+id]={primary:'https://example.test/'+id+'.m3u8',mode:'custom'};return a;};
test('Replay and back returns a manual pick as a manual pick',async()=>{
 const a=await resumeApp();let shown=0;a.selectGame('2');a.el('games').querySelectorAll=()=>[{dataset:{watch:'2'},scrollIntoView(){shown++;}}];a.setMode('replay');assert.equal(a.S.current,null);assert.equal(a.pool.visible,null);
 a.setMode('live');assert.equal(a.S.current,'2');assert.equal(a.S.manual,true);assert.equal(a.pool.visible,'2');assert.equal(a.S.playing,true);assert.equal(a.el('overlay').hidden,true);assert.equal(shown,1,'the strip brings it back into view');a.tick();assert.equal(a.S.current,'2');
});
test('Replay and back returns an automatic pick as automatic, after a replay played too',async()=>{
 const a=await resumeApp();a.selectGame('2',{manual:false});a.setMode('replay');await settle();await a.selectReplay('r');assert.equal(a.pool.visible,'rp:r');a.setMode('live');assert.equal(a.S.current,'2');assert.equal(a.S.manual,false);assert.equal(a.pool.get('rp:r'),undefined);assert.equal(a.pool.visible,'2');
});
test('a paused viewer comes back paused',async()=>{
 const a=await resumeApp();a.selectGame('2');a.setPlaying(false);a.setMode('replay');a.setMode('live');assert.equal(a.S.current,'2');assert.equal(a.S.playing,false);assert.equal(a.pool.running,false);assert.equal(a.pool.current.wantPlay,false);
});
test('a viewer who had nothing on is not started by a trip to Replay',async()=>{
 const a=await resumeApp();a.setMode('replay');await settle();await a.selectReplay('r');assert.equal(a.S.playing,true);a.setMode('live');assert.equal(a.S.playing,false);assert.equal(a.S.current,null);a.tick();assert.equal(a.S.current,null);assert.equal(a.el('overlay').hidden,false);assert.equal(a.S.manual,false);
});
test('a pick whose link went away does not open the Streams dialog on the way back',async()=>{
 const a=await resumeApp();a.selectGame('2');a.setMode('replay');delete a.saved.streams['nba:2'];a.setMode('live');assert.ok(!a.el('streamsDetails').open);assert.notEqual(a.S.current,'2');assert.equal(a.S.manual,false);
});
test('a game that ended during the replay is not reopened',async()=>{
 const a=await resumeApp();a.selectGame('2');a.setMode('replay');a.S.games.find(g=>g.id==='2').state='post';a.setMode('live');assert.notEqual(a.S.current,'2');assert.equal(a.pool.get('2'),undefined);assert.equal(a.S.manual,false);
});
test('the saved team auto-start waits for Live instead of being spent in Replay',async()=>{
 const a=await resumeApp();a.saved.leagueId='123';a.saved.teamId='1';a.setMode('replay');await a.refreshStreamLinks();assert.equal(a.S.playing,false);assert.ok(!a.S.autoAttempted);
 a.setMode('live');await a.refreshStreamLinks();assert.equal(a.S.playing,true);assert.ok(a.S.current);
});

test('gateway pages and dropped connections read as plain words, and a replay in progress survives them',async()=>{
 for(const failure of [()=>gateway(502),()=>gateway(200),()=>{throw new TypeError('Failed to fetch');}]){
  let fail=false;const a=app(replayWorker(()=>({sources:[{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]}),{catalog:()=>fail?failure():{sport:'nba',games:[listed('r',shift(-1))]}}).fetcher);
  a.setMode('replay');await settle();await a.selectReplay('r');fail=true;a.S.replaysAt=0;a.tick();await settle();
  assert.equal(a.S.replays.games.length,1);assert.doesNotThrow(()=>a.renderTransport());assert.doesNotMatch(a.S.replayError,/Unexpected token|Failed to fetch/);assert.match(a.el('games').innerHTML,/data-replay="r"/);
  const b=app(worker({catalog:failure}).fetcher);b.setMode('replay');await settle();assert.doesNotMatch(b.el('games').innerHTML,/Unexpected token|Failed to fetch/);assert.match(b.el('games').innerHTML,/unavailable/);assert.doesNotMatch(b.el('ovText').textContent,/Unexpected token|Failed to fetch/);
 }
});
test('a replay page behind a gateway error gives a plain reason and an escaped strip message',async()=>{
 const a=app(replayWorker(()=>gateway()).fetcher);a.setMode('replay');await settle();await a.selectReplay('r');assert.equal(a.S.replay.error,'That replay could not be reached.');assert.doesNotMatch(a.el('watchStatus').textContent,/Unexpected token/);
 const b=app(worker({catalog:()=>Response.json({sport:'nba',games:[],note:'<b>soon</b>'})}).fetcher);b.setMode('replay');await settle();assert.doesNotMatch(b.el('games').innerHTML,/<b>soon/);
});
test('a league behind a gateway error says so in plain words; a server reason still shows',async()=>{
 const a=app(async()=>gateway());await a.loadLeague(input);assert.equal(a.S.leagueError,'Could not reach your league. Try again in a moment.');assert.doesNotMatch(a.el('fantasyStatus').textContent,/Unexpected token/);
 const b=app(async()=>{throw new TypeError('Failed to fetch');});await b.loadLeague(input);assert.equal(b.S.leagueError,'Could not reach your league. Try again in a moment.');
 const c=app(async()=>Response.json({error:'Reconnect ESPN'},{status:401}));await c.loadLeague(input);assert.equal(c.S.leagueError,'Reconnect ESPN');
});

// ---------- render cost: past tiles built once, the strip patched ----------
test('strip: past tiles are built once per set of days, replay list and team, and survive a change to today',async()=>{
 const yesterday=shift(-1),a=app(worker({day:date=>date===shift(0)?[event('1')]:date===yesterday?[finalEvent('11',date)]:[]}).fetcher),list=a.el('games');
 await a.loadGames();await settle();assert.match(list.innerHTML,/class="tile past/);
 const realDate=Date.prototype.toLocaleDateString;let built=0;Date.prototype.toLocaleDateString=function(...args){built++;return realDate.apply(this,args);};
 try{
  const days=a.S.pastDays,count=()=>{const before=built;a.renderGuide();return built-before;};
  assert.equal(count(),0,'rendering again builds nothing');assert.equal(count(),0);
  a.S.replays={games:[{id:'r',away:'Atlanta',home:'Boston',date:yesterday+'T17:00:00.000Z',page:'https://x.test/r',title:'t'}]};assert.ok(count()>0,'a new replay list changes the tiles');assert.match(list.innerHTML,/data-past-replay="r"/);assert.equal(count(),0);
  a.S.pastDays=[...days];assert.ok(count()>0,'so do new days');
  a.S.replayError='down';a.S.replays=null;assert.ok(count()>0,'and so does a failed list');assert.match(list.innerHTML,/Replay unavailable/);a.S.replayError='';
 }finally{Date.prototype.toLocaleDateString=realDate;}
 // A changed game today leaves the past in the page.
 let items=[];const writes=[];Object.defineProperty(list,'innerHTML',{configurable:true,set(value){writes.push(value);items=value.split(/(?=<li )/);},get(){return items.join('');}});Object.defineProperty(list,'children',{configurable:true,get(){return items;}});Object.defineProperty(list,'lastElementChild',{configurable:true,get(){return {remove(){items.pop();}};}});list.insertAdjacentHTML=(_,html)=>{items.push(...html.split(/(?=<li )/));};
 a.S.pastDays=[...a.S.pastDays];a.renderGuide();assert.equal(writes.length,1);const past=items.slice(0,3);
 a.S.games=a.S.games.map(g=>({...g,teams:g.teams.map((t,i)=>i?t:{...t,score:'99'})}));a.renderGuide();
 assert.equal(writes.length,1,'only today was replaced');assert.deepEqual(items.slice(0,3),past);assert.equal(items.length,4);assert.match(list.innerHTML,/>99</);
});

// ---------- the Streams dialog: rows that keep their place, in both modes ----------
// The dialog's rows as far as these tests look: one box per game, whose buttons exist once it has been written, and the time and state lines.
function dialog(a){
 const list=a.el('savedStreams'),boxes=new Map(),lines=new Map();let rowWrites=0,boxWrites=0;
 const box=id=>{if(!boxes.has(id)){let buttons=[],html='';const e=new Element();Object.defineProperty(e,'innerHTML',{get:()=>html,set(value){html=value;boxWrites++;buttons=[...value.matchAll(/data-source-game="([^"]*)" data-source-mode="([^"]*)"[^>]*aria-pressed="(true|false)"/g)].map(m=>{const b=new Element();b.dataset.sourceGame=m[1];b.dataset.sourceMode=m[2];b['aria-pressed']=m[3];b.removeAttribute=n=>{delete b[n];};b.focus=()=>{b.focused=true;};return b;});}});e.querySelectorAll=()=>buttons;boxes.set(id,e);}return boxes.get(id);};
 const line=key=>{if(!lines.has(key)){const e=new Element();lines.set(key,e);}return lines.get(key);};
 const descriptor=Object.getOwnPropertyDescriptor(list,'innerHTML');let rows=descriptor?.value||'';
 Object.defineProperty(list,'innerHTML',{configurable:true,get:()=>rows,set(value){rows=value;rowWrites++;boxes.clear();}});
 const inputs=new Map();
 list.querySelector=selector=>{let m=/^\[data-sources="(.+)"\]$/.exec(selector);if(m)return rows.includes(`data-sources="${m[1]}"`)?box(m[1]):null;m=/^\[data-fields="(.+)"\] input$/.exec(selector);if(m){if(!inputs.has(m[1])){const e=new Element();e.focus=()=>{e.focused=rows.includes(`data-fields="${m[1]}" `+'>')||rows.includes(`data-fields="${m[1]}">`);};inputs.set(m[1],e);}return inputs.get(m[1]);}m=/^\[data-fields="(.+)"\]$/.exec(selector);if(m)return new Element();m=/data-source-game="(.+?)"\]\[data-source-mode="(.+?)"/.exec(selector);if(m)return boxes.get(m[1])?.querySelectorAll().find(b=>b.dataset.sourceMode===m[2])||null;return null;};
 list.querySelectorAll=selector=>{const m=/^\[data-(stream-time|source-state)="(.+)"\]$/.exec(selector);return m&&rows.includes(`data-${m[1]}="${m[2]}"`)?[line(m[1]+m[2])]:[];};
 return {box,rows:()=>rowWrites,boxes:()=>boxWrites,time:id=>line('stream-time'+id).textContent,html:()=>rows,input:id=>inputs.get(id),reset(){rowWrites=0;boxWrites=0;}};
}
// A source button holding focus inside the dialog, as a clicked button does in Chrome.
const heldButton=mode=>({matches:()=>false,closest:()=>({}),dataset:{sourceGame:'1',sourceMode:mode}});
const liveAt=(detail,id='1')=>{const day=games();day.events=[{...event(id),competitions:[{...event(id).competitions[0],status:{type:{state:'in',name:'STATUS_IN_PROGRESS',shortDetail:detail}}}]}];return day;};
test('Streams: a live game\'s clock moves in its row, with no rebuild of the row',async()=>{
 let detail='1st 12:00';const a=app(async()=>Response.json(liveAt(detail))),d=dialog(a);await a.loadGames();assert.match(d.html(),/1st 12:00/);d.reset();
 detail='Halftime';await a.loadGames();assert.equal(d.time('1'),'Halftime');assert.equal(d.rows(),0,'nothing under the viewer was replaced');
 detail='3rd 2:00';a.setMode('replay');await a.loadGames();assert.equal(d.time('1'),'3rd 2:00','and it keeps moving in Replay');
});
test('Streams: rendering again leaves the source buttons in place, and a change of source updates them where they stand',async()=>{
 const a=app(async()=>Response.json(games())),d=dialog(a);await a.loadGames();assert.ok(d.boxes()>0);d.reset();const buttons=d.box('1').querySelectorAll();assert.equal(buttons.length,2,'Auto and My link: a site with no match offers no button');
 a.renderGuide();a.renderGuide();assert.equal(d.boxes(),0,'a discovery poll cannot take a focused button away');assert.equal(d.box('1').querySelectorAll()[0],buttons[0]);assert.equal(buttons.find(b=>b.dataset.sourceMode==='auto')['aria-pressed'],'true');
 a.saved.streams['nba:1']={primary:'https://example.test/live.m3u8',backup:'',mode:'custom'};a.renderGuide();const mine=d.box('1').querySelectorAll();assert.equal(mine.find(b=>b.dataset.sourceMode==='custom')['aria-pressed'],'true');assert.equal(mine.find(b=>b.dataset.sourceMode==='auto')['aria-pressed'],'false');
 const writes=d.boxes();await a.el('savedStreams').onclick({target:{closest:()=>({dataset:{sourceGame:'1',sourceMode:'auto'}})}});assert.equal(d.boxes(),writes,'updated where they stand');assert.equal(d.box('1').querySelectorAll()[0],mine[0]);assert.equal(mine.find(b=>b.dataset.sourceMode==='auto')['aria-pressed'],'true');assert.equal(mine.find(b=>b.dataset.sourceMode==='custom')['aria-pressed'],'false');
 assert.equal(mine.some(b=>b.dataset.sourceMode==='NTV'),false);
});
test('Streams: choosing a source does not rebuild the rows, so the row keeps its focus',async()=>{
 const a=app(async()=>Response.json(games())),d=dialog(a);await a.loadGames();d.reset();
 await a.el('savedStreams').onclick({target:{closest:()=>({dataset:{sourceGame:'1',sourceMode:'auto'}})}});a.renderGuide();assert.equal(d.rows(),0);
});
test('Streams: a change of link waits for a held button, then rebuilds, so the press lands',async()=>{
 const a=app(async()=>Response.json(games())),d=dialog(a);await a.loadGames();d.reset();
 a.el('savedStreams').listeners.pointerdown();a.saved.streams['nba:1']={primary:'https://example.test/a.m3u8',backup:''};a.renderGuide();assert.equal(d.rows(),0,'the row under the pointer stays until the release');assert.equal(a.S.streamsDirty,true);
 a.events.get('pointerup')();for(const t of a.timers.values())if(t.ms===0)t.fn?.();await new Promise(r=>setTimeout(r,2));a.renderGuide();assert.equal(d.rows(),1);assert.equal(a.S.streamsDirty,false);
});
test('Streams: only a text field holds a rebuild back; a focused button gets its focus back after one',async()=>{
 const a=app(async()=>Response.json(games())),d=dialog(a);await a.loadGames();d.reset();
 a.document.activeElement={matches:s=>s==='#savedStreams input',closest:()=>({}),dataset:{}};a.saved.streams['nba:1']={primary:'https://example.test/a.m3u8',backup:''};a.renderGuide();assert.equal(d.rows(),0,'never under a field being typed in');assert.equal(a.S.streamsDirty,true);
 a.document.activeElement=heldButton('auto');a.renderGuide();assert.equal(d.rows(),1);assert.equal(a.S.streamsDirty,false);assert.equal(d.box('1').querySelectorAll().find(b=>b.dataset.sourceMode==='auto').focused,true);
});
test('Streams: My link opens the row\'s fields and focuses the field, in Chrome where the button holds focus',async()=>{
 const a=app(async()=>Response.json(games())),d=dialog(a);await a.loadGames();assert.match(d.html(),/data-fields="1" hidden/);
 a.document.activeElement=heldButton('custom');await a.el('savedStreams').onclick({target:{closest:()=>({dataset:{sourceGame:'1',sourceMode:'custom'}})}});
 assert.doesNotMatch(d.html(),/data-fields="1" hidden/,'the row was rebuilt with its fields open');assert.equal(d.input('1').focused,true);
});
test('Streams: the rows answer in Replay mode too',async()=>{
 const a=app(async url=>url.startsWith('/api/replays')?Response.json({games:[]}):Response.json(games())),d=dialog(a);a.setMode('replay');assert.match(a.el('savedStreams').innerHTML,/No games to add/);await a.loadGames();await settle();
 assert.match(d.html(),/data-stream-game="1"/,'a full slate is listed once it arrives');assert.equal(a.el('streamSummary').textContent,'0 of 1 game today has a stream ready');
 a.document.activeElement=heldButton('custom');await a.el('savedStreams').onclick({target:{closest:()=>({dataset:{sourceGame:'1',sourceMode:'custom'}})}});assert.doesNotMatch(d.html(),/data-fields="1" hidden/,'My link works there');assert.equal(d.input('1').focused,true);
});
test('Streams: saving a link on one game cannot cancel the swap of another',async()=>{
 const two=games();two.events=[event('1'),{...event('2'),shortName:'NYK @ MIA',competitions:[{...event('2').competitions[0],competitors:[{homeAway:'away',team:{id:'3',abbreviation:'NYK',displayName:'New York'},score:'1'},{homeAway:'home',team:{id:'4',abbreviation:'MIA',displayName:'Miami'},score:'2'}]}]}];
 const pending=deferred(),a=app(async url=>url.includes('/resolve?')?pending.promise:Response.json(two));await a.loadGames();a.saved.streams[a.S.games.find(g=>g.id==='1').key]={primary:'https://example.test/old.m3u8',backup:''};a.selectGame('1');
 const x=a.S.games.find(g=>g.id==='1'),y=a.S.games.find(g=>g.id==='2'),save=a.saveStreamLink(x,{primary:'https://streamcorner.st/game',backup:''});
 await a.saveStreamLink(y,{primary:'https://example.test/y.m3u8',backup:''});pending.resolve(Response.json({page:'https://streamcorner.st/game',url:'https://provider.example/embed/live'}));await save;
 assert.equal(a.pool.get('1').url,'https://provider.example/embed/live','the game on screen moved to its new link');
 const again=deferred();let first=true;const b=app(async url=>{if(url.includes('/resolve?')){if(first){first=false;return again.promise;}return Response.json({page:'https://streamcorner.st/b',url:'https://provider.example/embed/b'});}return Response.json(two);});await b.loadGames();b.saved.streams[b.S.games.find(g=>g.id==='1').key]={primary:'https://example.test/old.m3u8',backup:''};b.selectGame('1');
 const g=b.S.games.find(g=>g.id==='1'),older=b.saveStreamLink(g,{primary:'https://streamcorner.st/a',backup:''});await b.saveStreamLink(g,{primary:'https://streamcorner.st/b',backup:''});assert.equal(b.pool.get('1').url,'https://provider.example/embed/b');const open=b.pool.get('1');again.resolve(Response.json({page:'https://streamcorner.st/a',url:'https://provider.example/embed/a'}));await older;assert.equal(b.pool.get('1'),open,'a newer save on the same game still wins');
});
test('strip: past midnight, the week is built again, so last night\'s finals join the run without a reload',async()=>{
 let endOfWeek=shift(-1);const w=worker({day:date=>date<=endOfWeek?[finalEvent(date.replaceAll('-',''),date)]:date===data.localDate()?[event('1')]:[]}),a=app(w.fetcher);
 endOfWeek=shift(-2);await a.loadGames();await settle();assert.equal(a.S.pastComplete,true);assert.equal(a.S.pastFor,data.localDate());assert.ok(!a.S.pastDays.some(d=>d.date===shift(-1)));const shown=a.S.pastDays;
 w.clear();await a.loadGames();await settle();assert.deepEqual(w.days(),[data.localDate()],'a settled week is not asked again the same day');assert.equal(a.S.pastDays,shown);
 // The run was built for an earlier day, as a tab left open overnight finds it. Yesterday's games are final now.
 endOfWeek=shift(-1);a.S.pastFor=shift(-1);w.clear();await a.loadGames();await settle();assert.ok(a.S.pastDays.some(d=>d.date===shift(-1)),'last night is in the run');assert.equal(a.S.pastFor,data.localDate());assert.notEqual(a.S.pastDays,shown);
});

const pastGame=(id,date,away,home)=>({id,sport:'mlb',away,home,title:away+' @ '+home,date:date+'T17:00:00Z',page:'https://mlblive.net/'+id});
test('an empty week lists replays oldest first, so the strip runs the same way as every other strip',async()=>{
 const list=[pastGame('c','2026-10-28','Milwaukee Brewers','Tampa Bay Rays'),pastGame('b','2026-10-27','Milwaukee Brewers','Tampa Bay Rays'),pastGame('a','2026-10-26','Tampa Bay Rays','Milwaukee Brewers')];
 const a=app(async url=>url.startsWith('/api/replays')?Response.json({games:list}):Response.json({sport:'mlb',date:'2026-11-05',events:[]}),{sport:'mlb'});
 await a.loadGames();await new Promise(r=>setTimeout(r,5));a.S.stripScrolled=false;a.renderGuide();
 const html=a.el('games').innerHTML,at=id=>html.indexOf(`data-past-replay="${id}"`);assert.ok(at('a')>=0&&at('a')<at('b')&&at('b')<at('c'),'oldest on the left');
 a.setMode('replay');await new Promise(r=>setTimeout(r,5));const guide=a.el('games').innerHTML,on=id=>guide.indexOf(`data-replay="${id}"`);assert.ok(on('a')>=0&&on('a')<on('b')&&on('b')<on('c'),'Replay mode too');
});
// ---------- first-draft pass ----------
const inProgress=(id='1')=>event(id);
const pregame=(id='1')=>{const e=event(id);e.date=new Date(Date.now()+3*3600000).toISOString();e.competitions[0].status.type={state:'pre',name:'STATUS_SCHEDULED',shortDetail:''};e.competitions[0].competitors.forEach(c=>delete c.score);return e;};
const WATCH='https://ntv.st/watch/raptor/nba?source=0';
const withNTV=(a,id='1')=>a.streamFinder.matches.set(id,{sources:[WATCH],options:[{provider:'NTV',url:WATCH}]});
test('an NTV game loads no frame, picked or chosen automatically, and shows a real link to its watch page',async()=>{
 const a=app(async()=>Response.json(games()));await a.loadGames();withNTV(a);a.renderGuide();
 assert.match(a.el('games').innerHTML,/Opens in new tab/);assert.doesNotMatch(a.el('games').innerHTML,/>Watch</);
 a.setPlaying(true);assert.equal(a.pool.opened,0,'automatic never opens it');assert.equal(a.S.playing,false,'and Play does not pretend to be playing');
 a.selectGame('1');assert.equal(a.pool.opened,0,'picking it opens no frame');assert.equal(a.S.current,'1');assert.doesNotMatch(a.el('games').innerHTML,/ON AIR|On screen/,'nothing is on screen to say so');assert.equal(a.el('overlay').hidden,false);assert.equal(a.el('ovOpen').hidden,false);assert.equal(a.el('ovOpen').href,WATCH);assert.match(a.el('ovTitle').textContent,/opens in a new tab/);
 assert.equal(a.el('playButton').hidden,true);assert.equal(a.el('reloadStream').hidden,true);assert.equal(a.el('nextStream').hidden,true);
 a.direct();a.tick();assert.equal(a.pool.opened,0);assert.equal(a.S.current,'1','the channel stays on the chosen tile');
 a.saved.streams['nba:1']={primary:'https://ntv.st/embed?t=pasted',backup:''};a.selectGame('1');assert.equal(a.pool.opened,0,'a pasted NTV link is the same host');
 a.el('ovBack').onclick();assert.equal(a.S.current,null);
});
test('a game not started loads nothing and says when; the stream can be opened early, and a game that starts takes over by itself',async()=>{
 let day={...games(),events:[pregame()]};const a=app(async()=>Response.json(day));await a.loadGames();a.saved.streams['nba:1']={primary:'https://example.test/live.m3u8',backup:''};a.renderGuide();assert.doesNotMatch(a.el('games').innerHTML,/>Watch</);
 a.selectGame('1');assert.equal(a.pool.opened,0);assert.match(a.el('ovTitle').textContent,/Tip-off/);assert.match(a.el('watchStatus').textContent,/hasn’t started/);assert.equal(a.el('watchFirst').hidden,false);assert.equal(a.el('watchFirst').textContent,'Open the stream early');
 day=games();await a.loadGames();assert.equal(a.pool.opened,1,'now it has started, it goes on');
 day={...games(),events:[pregame()]};const b=app(async()=>Response.json(day));await b.loadGames();b.saved.streams['nba:1']={primary:'https://example.test/live.m3u8',backup:''};b.selectGame('1');b.el('watchFirst').onclick();assert.equal(b.pool.opened,1,'asked for early');
});
test('Pause shows its icon, and Play with nothing to play stays on Play with the status line saying what to do',async()=>{
 const a=app(async()=>Response.json(games()));await ready(a);assert.equal(a.el('playButton').dataset.playing,'true');a.setPlaying(false);assert.equal(a.el('playButton').dataset.playing,'false');
 const b=app(async()=>Response.json({...games(),events:[]}));await b.loadGames();b.setPlaying(true);assert.equal(b.S.playing,false);assert.equal(b.el('playButton').textContent,'Play');assert.equal(b.el('watchStatus').textContent,'Pick a game above.');
 const c=app(async()=>Response.json({...games(),events:[pregame()]}));await c.loadGames();c.saved.streams['nba:1']={primary:'https://example.test/live.m3u8',backup:''};c.setPlaying(true);assert.equal(c.S.playing,true,'a game is coming that the page can show');assert.match(c.el('watchStatus').textContent,/start when a game goes live/);
 const off=replayApp([{url:'https://gobsao8u.com/e/a',provider:'gobsao8u.com',type:'embed/page'}]);off.setMode('replay');await settle();await off.selectReplay('g');off.el('playButton').onclick;assert.equal(off.el('playButton').hidden,true,'on the new-tab screen the link is the action');
});
test('the mute button goes away on a website stream, whose sound it cannot touch, and its key does nothing either',async()=>{
 const a=app(async()=>Response.json(games()));await a.loadGames();a.saved.streams['nba:1']={primary:'https://example.test/embed/x',backup:''};a.selectGame('1');assert.equal(a.pool.current.kind,'embed');assert.equal(a.el('muteButton').hidden,true);
 let pressed=0;a.el('muteButton').click=()=>pressed++;a.events.get('keydown')({key:'m',target:{closest:()=>null}});assert.equal(pressed,0);
 a.pool.close('1');a.saved.streams['nba:1']={primary:'https://example.test/live.m3u8',backup:''};a.selectGame('1');assert.equal(a.el('muteButton').hidden,false);
});
test('a replay on a host that refuses frames, listed or not, opens outside, and no host name or provider code reaches the viewer',async()=>{
 for(const host of ['vidara.so','luluvido.com','somewhere.example']){const a=replayApp([{url:'https://'+host+'/e/a',provider:host,type:'embed/page'},{url:'https://bysesukior.com/e/b',provider:'bysesukior.com',type:'embed/page'}]);a.setMode('replay');await settle();await a.selectReplay('g');
  assert.equal(a.pool.opened,0,host);assert.equal(a.el('ovOpen').hidden,false);assert.doesNotMatch(a.el('ovText').textContent+a.el('watchStatus').textContent,/vidara|luluvido|somewhere|bysesukior/);assert.match(a.el('watchStatus').textContent,/link 1 of 2/);assert.match(a.el('ovText').textContent,/another link/);}
 const b=replayApp([{url:'https://ok.ru/videoembed/123',provider:'OK',type:'provider/ok'}]);b.setMode('replay');await settle();await b.selectReplay('g');assert.equal(b.el('watchStatus').textContent,'Full game replay','one source, no count and no provider code');
});
test('a removed replay shows why, tries the next link once, and the tile retries',async()=>{
 const one=replayApp([{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]);one.setMode('replay');await settle();await one.selectReplay('g');assert.equal(one.pool.opened,1);
 one.pool.options.onError('rp:g',{message:'This game’s video isn’t available.'});assert.equal(one.pool.get('rp:g'),undefined);assert.equal(one.el('overlay').hidden,false);assert.equal(one.S.replay.error,'This game’s video isn’t available.');assert.match(one.el('ovTitle').textContent,/won’t open/);assert.match(one.el('games').innerHTML,/Retry/);assert.equal(one.el('replayNews').textContent,'This game’s video isn’t available.');
 await one.selectReplay('g');assert.equal(one.pool.opened,2,'tapping it resolves again');assert.equal(one.S.replay.error,'');
 const two=replayApp([{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'},{url:'https://ok.ru/videoembed/2',provider:'OK',type:'provider/ok'}]);two.setMode('replay');await settle();await two.selectReplay('g');
 two.pool.options.onError('rp:g',{message:'Gone'});assert.equal(two.pool.get('rp:g').url,'https://ok.ru/videoembed/2');assert.equal(two.S.replay.index,1);
 two.pool.options.onError('rp:g',{message:'Gone'});assert.equal(two.S.replay.index,1,'never wraps round to a link already dead');assert.equal(two.S.replay.error,'Gone');
 two.pool.options.onError('rp:other',{message:'Late'});assert.equal(two.S.replay.error,'Gone','an old frame cannot touch the current replay');
});
test('a replay frame waiting on a tap is not killed at 20 seconds; one that never answers is, and footage once moved never trips it',async()=>{
 const start=async()=>{const a=replayApp([{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]);a.setMode('replay');await settle();await a.selectReplay('g');const p=a.pool.current;p.kind='provider';p.initialized=true;p.played=false;p.advances=0;a.S.replay.started=false;a.renderGuide();return {a,p};};
 const {a,p}=await start();assert.match(a.el('games').innerHTML,/Opening…/);a.renderTransport();assert.equal(a.el('switching').hidden,false);assert.equal(a.el('switching').textContent,'Loading the replay video…');
 a.S.replay.waited=13000;a.tick();assert.match(a.el('switching').textContent,/Still loading/);assert.equal(a.el('frameHelp').hidden,true);
 a.S.replay.waited=20000;a.tick();assert.ok(a.pool.get('rp:g'),'a tap can still start it');assert.equal(a.el('frameHelp').hidden,false);assert.equal(a.el('frameOpen').href,'https://ok.ru/videoembed/1');assert.equal(a.S.replay.error,'');
 a.S.replay.waited=46000;a.tick();assert.equal(a.el('switching').hidden,true,'the word gives way after a while');assert.equal(a.el('frameHelp').hidden,false);
 a.S.replay.waited=90000;a.tick();assert.equal(a.pool.get('rp:g'),undefined,'ninety seconds is the end of the wait');assert.equal(a.el('ovOpen').href,'https://ok.ru/videoembed/1');assert.match(a.el('ovTitle').textContent,/won’t play inside the page/);assert.equal(a.el('frameHelp').hidden,true);
 const silent=await start();silent.p.initialized=false;silent.a.S.replay.waited=20000;silent.a.tick();assert.equal(silent.a.pool.get('rp:g'),undefined);assert.equal(silent.a.S.replay.link,'https://ok.ru/videoembed/1');
 const ran=await start();ran.p.played=true;ran.a.S.replay.waited=200000;ran.a.tick();assert.ok(ran.a.pool.get('rp:g'));
 const ad=await start();ad.p.inAd=true;const before=ad.a.S.replay.waited=19500;ad.p.initialized=false;ad.a.tick();assert.equal(ad.a.S.replay.waited,before,'an ad is moving picture, not a stall');
 const hid=await start();hid.a.document.visibilityState='hidden';hid.p.initialized=false;hid.a.S.replay.waited=20000;hid.a.tick();assert.ok(hid.a.pool.get('rp:g'),'a hidden tab is not a failure');
 const moved=await start();moved.p.advances=1;moved.a.tick();assert.equal(moved.a.S.replay.started,true);assert.equal(moved.a.el('switching').hidden,true);assert.match(moved.a.el('games').innerHTML,/On screen/);
});
test('the first screen plays something: a game on now if one has a stream, else the newest replay, in every league',async()=>{
 const a=app(async url=>url.startsWith('/api/replays')?Response.json({games:[]}):Response.json(games()));await a.loadGames();a.saved.streams['nba:1']={primary:'https://example.test/live.m3u8',backup:''};a.renderTransport();assert.equal(a.el('watchFirst').hidden,false);assert.equal(a.el('watchFirst').textContent,'Watch Atlanta at Boston');a.el('watchFirst').onclick();assert.equal(a.pool.opened,1);
 const newest={...replayGame,id:'new'},older={...replayGame,id:'old'},w=worker({sport:'mlb',day:()=>[],catalog:()=>({sport:'mlb',games:[newest,older]}),resolve:()=>({sources:[{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]})});
 const m=app(w.fetcher,{sport:'mlb'});await m.loadGames();await settle();assert.equal(m.el('watchFirst').hidden,false);assert.equal(m.el('watchFirst').textContent,'Watch the latest replay');assert.equal(m.el('addFirstStream'),undefined);m.el('watchFirst').onclick();await settle();assert.equal(m.S.mode,'replay');assert.equal(m.S.replay.id,'new');assert.equal(m.pool.opened,1);
 const r=replayApp([{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]);r.setMode('replay');await settle();assert.equal(r.el('watchFirst').hidden,false,'Replay opens with something to press too');r.el('playButton').onclick();await settle();assert.equal(r.S.replay.id,'g','and Play with nothing chosen plays it');
});
test('first-visit copy promises nothing that was never saved, and does not flash an empty answer while replays load',async()=>{
 const none=app(async url=>url.startsWith('/api/replays')?Response.json({games:[]}):Response.json({...games('nba',/date=([\d-]+)/.exec(url)?.[1]),events:[]}));await none.loadGames();await settle();assert.doesNotMatch(none.el('ovText').textContent,/saved/);assert.match(none.el('ovTitle').textContent,/No NBA games this week/);
 const kept=app(async url=>url.startsWith('/api/replays')?Response.json({games:[]}):Response.json({...games('nba',/date=([\d-]+)/.exec(url)?.[1]),events:[]}),{stored:{'fantasy-stream-nba-v1':JSON.stringify({leagueId:'5'})}});kept.loadLeague=async()=>{};await kept.loadGames();await settle();assert.match(kept.el('ovText').textContent,/saved/);
 const held=deferred(),slow=app(url=>url.startsWith('/api/replays')?held.promise:Promise.resolve(Response.json({...games('nba',/date=([\d-]+)/.exec(url)?.[1]),events:[]})));await slow.loadGames();assert.equal(slow.el('ovTitle').textContent,'Finding replays…');held.resolve(Response.json({games:[]}));await settle();
 const down=app(async()=>Response.json({error:'x'},{status:502}));await down.loadGames();assert.doesNotMatch(down.el('ovText').textContent,/saved/);
});
test('Disconnect forgets the login on every league page, stops the timer, and a late answer cannot bring it back',async()=>{
 const stored={'fantasy-stream-v3':JSON.stringify({espn:{swid:'{a}',s2:'b'},leagueId:'9',league:{name:'L'},teamId:'1',chatName:'Sam'}),'fantasy-stream-nhl-v1':JSON.stringify({swid:'{a}',s2:'b',leagueId:'8'})};
 const pending=deferred();let held=false;const a=app(async url=>url.startsWith('/api/sports?')?Response.json(games()):held?pending.promise:Response.json(league()),{stored});
 await a.loadLeague({...input,swid:'',s2:''});assert.equal(a.el('forgetESPN').hidden,false);held=true;const late=a.loadLeague();a.el('forgetESPN').onclick();
 assert.equal(a.saved.leagueId,'');assert.equal(a.saved.s2,'');assert.equal(a.S.league,null);assert.equal(a.el('forgetESPN').hidden,true);assert.match(a.el('leagueSummary').innerHTML,/forgotten/);
 const nfl=JSON.parse(a.storage.get('fantasy-stream-v3'));assert.deepEqual(nfl.espn,{swid:'',s2:''});assert.equal(nfl.leagueId,'');assert.equal(nfl.league,null);assert.equal(nfl.chatName,'Sam');assert.equal(JSON.parse(a.storage.get('fantasy-stream-nhl-v1')).s2,'');
 const timers=a.timers.size;pending.resolve(Response.json(league()));await late;assert.equal(a.saved.leagueId,'','the late answer is dropped');assert.equal(a.timers.size,timers,'and asks for nothing more');
});
test('a private league opens the private step before focusing inside it',async()=>{
 const a=app(async url=>url.startsWith('/api/sports?')?Response.json(games()):Response.json({error:'That league is private. Follow the steps below to connect it.'},{status:401}));a.el('privateLeague').open=false;await a.loadLeague(input);assert.equal(a.el('privateLeague').open,true);assert.match(a.el('leagueError').textContent,/private/);
 const b=app(async()=>Response.json(games()));b.el('fantasyTeamButton').onclick();assert.equal(b.el('privateLeague').open,false,'nobody without a saved login is shown the cookie steps');
 const c=app(async()=>Response.json(games()),{stored:{'fantasy-stream-nba-v1':JSON.stringify({swid:'{a}',s2:'b'})}});c.el('fantasyTeamButton').onclick();assert.equal(c.el('privateLeague').open,true);
});
test('polls stay silent for screen readers; a refresh someone pressed is answered, and a failure is said once',async()=>{
 let fail=false;const a=app(async()=>fail?Response.json({error:'x'},{status:502}):Response.json(games()));await a.loadGames();assert.equal(a.el('scheduleStatus').textContent,'');
 const pending=a.el('refreshGames').onclick();await settle();assert.match(a.el('scheduleStatus').textContent,/Updated/);void pending;
 fail=true;await a.loadGames();const said=a.el('scheduleStatus').textContent;assert.match(said,/retrying/);let writes=0;Object.defineProperty(a.el('scheduleStatus'),'textContent',{get(){return said;},set(){writes++;}});await a.loadGames();assert.equal(writes,0,'the same outage is not announced again');
});
test('a hidden tab asks for no stream links, and catches up when it comes back',async()=>{
 const asked=[],a=app(async url=>{asked.push(url);return url.startsWith('/api/streams')?Response.json({sport:'nba',entries:[]}):Response.json(games());});await a.loadGames();await settle();a.document.hidden=true;asked.length=0;a.streamFinder.catalogs.clear();await a.refreshStreamLinks();assert.equal(asked.length,0);
 a.document.hidden=false;a.events.get('visibilitychange')();await settle();assert.ok(asked.some(u=>u.startsWith('/api/streams')));
});
test('tiles say their teams, scores and state out loud, and a past tile takes no tab stop unless nothing else can',async()=>{
 const a=app(async()=>Response.json(games()));await a.loadGames();assert.match(a.el('games').innerHTML,/aria-label="Atlanta 80 at Boston 81, live\. /);
 const f=finalEvent('9','2026-11-01'),w=worker({day:d=>d===data.localDate()?[event()]:d===shift(-1)?[f]:[]}),b=app(w.fetcher);await b.loadGames();await settle();const html=b.el('games').innerHTML;assert.match(html,/<button class="game" tabindex="-1"[^>]*aria-label="Atlanta 80 at Boston 81, final, /);assert.match(html,/aria-disabled="true"/,'a final with no replay can still be reached and read');assert.doesNotMatch(html,/class="game" tabindex="-1" disabled/);
});
test('a tile focused when the strip is rebuilt gets its focus back, across the swap from past tile to replay tile, without moving the page',async()=>{
 const a=app(async()=>Response.json(games()));await a.loadGames();let focused=null;const tile={dataset:{replay:'g'},focus(o){focused=o;}},list=a.el('games');list.querySelectorAll=()=>[{dataset:{watch:'x'},focus(){throw new Error('wrong tile');}},tile];a.document.activeElement={dataset:{pastReplay:'g'}};
 a.S.replays={games:[replayGame]};a.setMode('replay');assert.deepEqual({...focused},{preventScroll:true});
});
test('replay controls show only what works: no reload on a player that has none, and no channel chip while a replay is up',async()=>{
 const a=replayApp([{url:'https://ok.ru/videoembed/1',provider:'OK',type:'provider/ok'}]);a.setMode('replay');await settle();await a.selectReplay('g');a.pool.current.reload=undefined;a.renderTransport();assert.equal(a.el('reloadStream').hidden,true);assert.equal(a.el('autoChip').hidden,true);
 a.setMode('live');assert.equal(a.el('autoChip').hidden,false);
});
