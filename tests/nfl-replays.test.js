import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNFLReplayListing,parseWatchLinks,okEmbedIn,nflReplayWeekAPI,edgeCached} from '../server/replays.js';

const listing=`<a href="/chicago-bears-vs-seattle-seahawks-full-game-replay-nfl-week-08-november-2-2026">CHI vs SEA</a>
<a href="https://nfl-video.com/miami-dolphins-vs-baltimore-ravens-full-game-replay-nfl-week-08-october-30-2026">MIA vs BAL</a>
<a href="/chicago-bears-vs-seattle-seahawks-full-game-replay-nfl-week-08-november-2-2026">again</a>
<a href="/green-bay-packers-vs-pittsburgh-steelers-full-game-replay-nfl-week-07-october-26-2026">week 7</a>`;
const gamePage=`<h1>Replay</h1><div id="video-player"><p>Pick a source</p><a href="https://nhlgamestoday.com/go/abc"><span>Watch</span></a><a href="https://nfl-video.com/other-week-08-x">Watch</a><a href="https://example.test/x">Watch</a><a href="https://nbaontv.com/go/def">Watch now</a></div>`;
const watchPage=`<html><body><iframe src="https://ok.ru/videoembed/1234567890?nochat=1"></iframe></body></html>`;

test('parseNFLReplayListing keeps one game page per matchup for the padded week',()=>{
 const games=parseNFLReplayListing(listing,8);
 assert.deepEqual(games.map(g=>[g.away,g.home]),[['chicago-bears','seattle-seahawks'],['miami-dolphins','baltimore-ravens']]);
 assert.equal(games[0].page,'https://nfl-video.com/chicago-bears-vs-seattle-seahawks-full-game-replay-nfl-week-08-november-2-2026');
 assert.deepEqual(parseNFLReplayListing(listing,7).map(g=>g.away),['green-bay-packers']);
});
test('parseWatchLinks takes the Watch anchors inside the player block, off the listing site',()=>{
 assert.deepEqual(parseWatchLinks(gamePage),['https://nhlgamestoday.com/go/abc','https://nbaontv.com/go/def']);
 assert.deepEqual(parseWatchLinks('<a href="https://nhlgamestoday.com/x">Watch</a>'),[],'links outside the player block are ignored');
});
test('okEmbedIn finds the ok.ru player wherever the page carries it',()=>{
 assert.equal(okEmbedIn(watchPage),'https://ok.ru/videoembed/1234567890');
 assert.equal(okEmbedIn('<iframe src="https://ok.ru/video/12"></iframe>'),'');assert.equal(okEmbedIn(''),'');
});
test('nflReplayWeekAPI walks the listing, the game page and its Watch page to the embed',async()=>{
 const calls=[];
 const fetcher=async(url)=>{calls.push(url);
  if(url==='https://nfl-video.com/2026')return new Response(listing,{status:200});
  if(url.startsWith('https://nfl-video.com/2026?page'))return new Response('<a href="/x-vs-y-full-game-replay-nfl-week-01-september-7-2026">old</a>',{status:200});
  if(url.includes('chicago-bears-vs-seattle'))return new Response(gamePage,{status:200});
  if(url.includes('miami-dolphins-vs-baltimore'))return new Response('<div id="video-player"></div>',{status:200});
  if(url==='https://nhlgamestoday.com/go/abc')return new Response(watchPage,{status:200});
  return new Response('nope',{status:404});
 };
 const r=await nflReplayWeekAPI(new Request('https://fantasy.example/api/nfl-replays?week=8'),fetcher);
 const data=await r.json();
 assert.equal(data.week,8);assert.equal(data.games.length,2);
 assert.equal(data.games.find(g=>g.away==='chicago-bears').embed,'https://ok.ru/videoembed/1234567890');
 assert.equal(data.games.find(g=>g.away==='miami-dolphins').embed,'','a game without a Watch page has no video');
 assert.ok(calls.includes('https://nfl-video.com/2026?page2'),'one older link does not end the walk');assert.ok(!calls.includes('https://nfl-video.com/2026?page3'),'a page mostly about an older week does');
 const r1=await nflReplayWeekAPI(new Request('https://fantasy.example/api/nfl-replays?week=1'),fetcher);assert.equal((await r1.json()).games.length,1);assert.ok(calls.includes('https://nfl-video.com/2026?page8'),'a week further back jumps down the listing');
 const bad=await nflReplayWeekAPI(new Request('https://fantasy.example/api/nfl-replays?week=99'),fetcher);assert.equal(bad.status,400);
});

// ---------- the shared cache in front of the slow routes, and how long an answer may be reused ----------
const fakeEdge=()=>{const stored=new Map(),puts=[];return {stored,puts,default:{async match(key){const hit=stored.get(key.url);return hit?hit.clone():undefined;},async put(key,response){puts.push(key.url);stored.set(key.url,response);}}};};
const withEdge=async(fn)=>{const edge=fakeEdge(),had=Object.getOwnPropertyDescriptor(globalThis,'caches');Object.defineProperty(globalThis,'caches',{value:edge,configurable:true});try{await fn(edge);}finally{if(had)Object.defineProperty(globalThis,'caches',had);else delete globalThis.caches;}};
const route=(path,init)=>new Request('https://site.test'+path,init);
const answer=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const life=edge=>Number(/max-age=(\d+)/.exec([...edge.stored.values()].at(-1).headers.get('Cache-Control'))?.[1]);

test('edgeCached does nothing where caches.default is absent',async()=>{
 const had=Object.getOwnPropertyDescriptor(globalThis,'caches');delete globalThis.caches;let calls=0;
 try{for(let i=0;i<2;i++){const r=await edgeCached(route('/api/replays?sport=nba'),{},['sport'],()=>{calls++;return answer({games:[{id:'a'}]});});assert.equal(r.status,200);assert.equal(r.headers.get('X-Edge-Cache'),null);}assert.equal(calls,2);}
 finally{if(had)Object.defineProperty(globalThis,'caches',had);}
 Object.defineProperty(globalThis,'caches',{value:{},configurable:true});
 try{const r=await edgeCached(route('/api/replays?sport=nba'),{},['sport'],()=>answer({games:[]}));assert.equal(r.status,200);}finally{if(had)Object.defineProperty(globalThis,'caches',had);else delete globalThis.caches;}
});
test('edgeCached answers later visitors from the cache, keyed on the named parameters alone',async()=>{await withEdge(async edge=>{
 let calls=0,waited=null;const handler=()=>{calls++;return answer({games:[{id:'a'}]});},ctx={waitUntil(p){waited=p;}};
 const first=await edgeCached(route('/api/replays?sport=nba'),ctx,['sport'],handler);assert.equal(first.headers.get('X-Edge-Cache'),'miss');assert.equal(first.headers.get('Cache-Control'),'no-store');await waited;assert.deepEqual((await first.json()).games,[{id:'a'}]);
 assert.deepEqual(edge.puts,['https://site.test/api/replays?sport=nba']);assert.equal(life(edge),900);
 const second=await edgeCached(route('/api/replays?sport=nba&bust=1',{headers:{'X-Anything':'x'}}),ctx,['sport'],handler);
 assert.equal(calls,1,'a junk parameter cannot force another walk of the replay sites');assert.equal(second.headers.get('X-Edge-Cache'),'hit');assert.equal(second.headers.get('Cache-Control'),'no-store','the shared lifetime never reaches a browser');assert.deepEqual((await second.json()).games,[{id:'a'}]);
 await edgeCached(route('/api/replays?sport=mlb'),ctx,['sport'],handler);assert.equal(calls,2,'another sport is another entry');
});});
test('edgeCached gives failures and missing videos short lives and stores nothing for a bad request',async()=>{
 const full=Array.from({length:14},(_,i)=>({slug:'g'+i,embed:'https://ok.ru/videoembed/'+i}));
 for(const [path,params,status,data,seconds] of [
  ['/api/nfl-replays?week=8',['week'],200,{games:full},21600],
  ['/api/nfl-replays?week=8',['week'],200,{games:full.slice(0,5)},900],
  ['/api/nfl-replays?week=8',['week'],200,{games:[...full,{slug:'late',embed:''}]},300],
  ['/api/nfl-replays?week=8',['week'],200,{games:[]},60],
  ['/api/nfl-replays?week=8',['week'],502,{games:[],error:'down'},30],
  ['/api/replays?sport=nba',['sport'],200,{games:[]},60],
  ['/api/replays?sport=nba',['sport'],502,{games:[],error:'down'},30],
  ['/api/replays?sport=nhl',['sport'],200,{games:[],note:'none'},3600],
  ['/api/replays/resolve?url=x',['url'],200,{sources:[{url:'a'}]},1800],
  ['/api/replays/resolve?url=x',['url'],404,{sources:[],error:'none'},60],
  ['/api/replays/resolve?url=x',['url'],502,{sources:[],error:'down'},30],
 ])await withEdge(async edge=>{const r=await edgeCached(route(path),{},params,()=>answer(data,status));assert.equal(r.status,status);assert.equal(life(edge),seconds,path+' '+status+' '+JSON.stringify(data).slice(0,40));});
 await withEdge(async edge=>{await edgeCached(route('/api/nfl-replays?week=99'),{},['week'],()=>answer({error:'Choose a week.'},400));assert.equal(edge.puts.length,0);});
});
test('edgeCached never stores or serves a request or response carrying credentials',async()=>{await withEdge(async edge=>{
 let calls=0;const handler=()=>{calls++;return answer({games:[{id:'a'}]});};
 await edgeCached(route('/api/replays?sport=nba'),{},['sport'],handler);assert.equal(calls,1);
 for(const headers of [{Cookie:'espn_s2=secret'},{Authorization:'Bearer x'}]){const r=await edgeCached(route('/api/replays?sport=nba',{headers}),{},['sport'],handler);assert.equal(r.headers.get('X-Edge-Cache'),null);}
 assert.equal(calls,3,'neither was answered from the cache');assert.equal(edge.puts.length,1,'and neither was stored');
 await edgeCached(route('/api/replays?sport=mlb'),{},['sport'],()=>answer({games:[{id:'b'}]},200,{'Set-Cookie':'a=b'}));assert.equal(edge.puts.length,1,'a response that sets a cookie stays out');
 await edgeCached(route('/api/replays?sport=nba',{method:'POST',body:'{}'}),{},['sport'],handler);assert.equal(calls,4,'only GET is cached');
 const key=[...edge.stored.keys()][0];assert.doesNotMatch(key,/secret/);
});});
test('a browser may keep a week as long as the server says, and the cache hands the same answer back',async()=>{await withEdge(async()=>{
 const fetcher=async url=>new Response(url.includes('week-08')?watchPage:url.endsWith('/2026')?listing:'<p></p>');
 const direct=await nflReplayWeekAPI(route('/api/nfl-replays?week=8'),fetcher);assert.match(direct.headers.get('Cache-Control'),/^private, max-age=(900|300)$/);
 const handler=()=>nflReplayWeekAPI(route('/api/nfl-replays?week=8'),fetcher);
 const miss=await edgeCached(route('/api/nfl-replays?week=8'),{},['week'],handler),hit=await edgeCached(route('/api/nfl-replays?week=8'),{},['week'],handler);
 assert.equal(hit.headers.get('X-Edge-Cache'),'hit');assert.equal(hit.headers.get('Cache-Control'),miss.headers.get('Cache-Control'));assert.equal(hit.headers.get('X-Browser-Cache'),null);
 const broken=await nflReplayWeekAPI(route('/api/nfl-replays?week=8'),async()=>{throw new Error('down');});assert.equal(broken.status,502);assert.equal(broken.headers.get('Cache-Control'),'no-store');
});});
test('a week with a video still missing is asked again within minutes, even from the isolate\'s memory',async()=>{
 const original=globalThis.fetch,now=Date.now;let pages=0,embed='';let at=now();Date.now=()=>at;
 globalThis.fetch=async url=>{pages++;return new Response(String(url).includes('week-03')?embed:String(url).endsWith('/2026')?'<a href="/a-team-vs-b-team-full-game-replay-nfl-week-03-october-1-2026">x</a><a href="/old-team-vs-past-team-full-game-replay-nfl-week-02-september-1-2026">y</a>':'');};
 try{
  const first=await (await nflReplayWeekAPI(route('/api/nfl-replays?week=3'))).json();assert.equal(first.games[0].embed,'');const asked=pages;
  await nflReplayWeekAPI(route('/api/nfl-replays?week=3'));assert.equal(pages,asked,'answered from memory at first');
  embed=watchPage;at+=301000;const later=await (await nflReplayWeekAPI(route('/api/nfl-replays?week=3'))).json();assert.ok(pages>asked);assert.match(later.games[0].embed,/videoembed\/1234567890/);
 }finally{globalThis.fetch=original;Date.now=now;}
});

test('the newest listed week is never a full answer, however many games it has: Monday night\'s may not be posted yet',async()=>{await withEdge(async edge=>{
 const row=(i,w)=>`<a href="/t${i}-team-vs-u${i}-team-full-game-replay-nfl-week-${w}-november-2-2026">g</a>`,page=[...Array.from({length:14},(_,i)=>row(i,'08')),...Array.from({length:14},(_,i)=>row(i,'07'))].join('');
 const fetcher=async url=>new Response(url.endsWith('/2026')?page:url.includes('?page')?'':watchPage);
 const newest=await nflReplayWeekAPI(route('/api/nfl-replays?week=8'),fetcher),data=await newest.json();assert.equal(data.games.length,14);assert.ok(data.games.every(g=>g.embed));assert.equal(data.newest,true);assert.equal(newest.headers.get('Cache-Control'),'private, max-age=900');
 const older=await nflReplayWeekAPI(route('/api/nfl-replays?week=7'),fetcher);assert.equal((await older.json()).newest,false);assert.equal(older.headers.get('Cache-Control'),'private, max-age=21600');
 await edgeCached(route('/api/nfl-replays?week=8'),{},['week'],()=>nflReplayWeekAPI(route('/api/nfl-replays?week=8'),fetcher));assert.equal(life(edge),900,'the shared cache agrees');
 await edgeCached(route('/api/nfl-replays?week=7'),{},['week'],()=>nflReplayWeekAPI(route('/api/nfl-replays?week=7'),fetcher));assert.equal(life(edge),21600);
});});

// Three links per listed game, two per sidebar game, as the site prints them.
const listed=(week,n,tag='g')=>Array.from({length:n},(_,i)=>{const a=`<a href="/${tag}${week}a${i}-vs-${tag}${week}h${i}-full-game-replay-nfl-week-${String(week).padStart(2,'0')}-november-1-2026">x</a>`;return a+a+a;}).join('');
const sidebar=`<a href="/s5a-vs-s5h-full-game-replay-nfl-week-05-october-5-2026">s</a><a href="/s5a-vs-s5h-full-game-replay-nfl-week-05-october-5-2026">s</a>`;
const walk=pages=>{const asked=[];return {asked,fetcher:async url=>{const m=/^https:\/\/nfl-video\.com\/2026(?:\?page(\d+))?$/.exec(url);if(!m)return new Response('<div id="video-player"></div>',{status:200});const n=Number(m[1]||1);asked.push(n);return new Response(pages[n]??'',{status:200});}};};
test('the sidebar\'s older games do not end the walk: a week split across two pages is found whole',async()=>{
 const {fetcher,asked}=walk({1:listed(8,11)+sidebar,2:listed(8,3,'p')+listed(7,9)+sidebar,3:listed(7,5,'p')+listed(6,7)+sidebar});
 const data=await (await nflReplayWeekAPI(new Request('https://x.test/api/nfl-replays?week=8'),fetcher)).json();
 assert.equal(data.games.length,14);assert.deepEqual(asked,[1,2]);assert.equal(data.newest,true);
 const seven=walk({1:listed(8,11)+sidebar,2:listed(8,3,'p')+listed(7,9)+sidebar,3:listed(7,5,'p')+listed(6,7)+sidebar,4:listed(6,9)+sidebar});
 const week7=await (await nflReplayWeekAPI(new Request('https://x.test/api/nfl-replays?week=7'),seven.fetcher)).json();
 assert.equal(week7.games.length,14);assert.deepEqual(seven.asked,[1,2,3]);assert.equal(week7.newest,false);
});
test('an old week jumps past the pages that cannot hold it and stops when the week is done',async()=>{
 const pages={1:listed(8,11)+sidebar,12:sidebar};for(let n=2;n<=7;n++)pages[n]=listed(4,12)+sidebar;pages[8]=listed(3,12)+sidebar;pages[9]=listed(2,12)+sidebar;pages[10]=listed(1,8)+sidebar;pages[11]=listed(1,8,'k')+sidebar;
 const {fetcher,asked}=walk(pages);const data=await (await nflReplayWeekAPI(new Request('https://x.test/api/nfl-replays?week=1'),fetcher)).json();
 assert.equal(data.games.length,16);assert.deepEqual(asked,[1,8,9,10,11,12]);
});
test('a jump that lands past the week walks back from the top',async()=>{
 const {fetcher,asked}=walk({1:listed(9,11)+sidebar,2:listed(7,12)+sidebar,3:listed(6,12)+sidebar});
 const data=await (await nflReplayWeekAPI(new Request('https://x.test/api/nfl-replays?week=7'),fetcher)).json();
 assert.equal(data.games.length,12);assert.deepEqual(asked,[1,3,2,3]);
});
