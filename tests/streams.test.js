import test from 'node:test';
import assert from 'node:assert/strict';
import {ntvCatalog,publicPlayerURL,embeddedPlayerFromHTML,streamsCatalogAPI,streamsResolveAPI} from '../server/streams.js';
import {StreamFinder,matchStream,needsPlayerResolution} from '../web/stream-finder.js';
import {safeVideo} from '../web/roster.js';
import {normalizePreferences} from '../web/preferences.js';
import {normalizeSportPreferences} from '../web/sports-data.js';
const page='https://ntv.st/watch/raptor/game-1?source=0',embed='https://ntv.st/embed?t=published';
const game={id:'1',state:'in',date:'2026-11-01T18:00:00Z',teams:[{name:'Indianapolis Colts'},{name:'Minnesota Vikings'}]};
const entry={id:'game-1',sport:'nfl',title:'Indianapolis Colts at Minnesota Vikings',start:Date.parse(game.date),sources:[page,page.replace('source=0','source=1')]};
const request=url=>new Request('https://app.example/api/streams/resolve?url='+encodeURIComponent(url));
const raw={success:true,live:[{id:'game-1',title:entry.title,tournament:'NFL',date:entry.start,sources:[{},{}]}],upcoming:[]};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const finderFetch=async url=>url.startsWith('/api/streams?')?Response.json({sport:'nfl',entries:[entry]}):Response.json({page:new URL(url,'https://app.example').searchParams.get('url'),url:embed+(url.includes('source%3D1')?'2':'')});
test('catalog uses published source indexes and excludes continuous channels, malformed entries and duplicates',()=>{
 const entries=ntvCatalog({...raw,upcoming:[null,...raw.live,{...raw.live[0],id:'always',date:0,tournament:'24/7'},{...raw.live[0],id:'../bad'},{...raw.live[0],id:'basketball',tournament:'NBA'}]});
 assert.equal(entries.length,2);assert.deepEqual(entries[0].sources,entry.sources);assert.equal(entries[1].sport,'nba');assert.equal(ntvCatalog({nonLive:raw.live,all:raw.live}).length,1);assert.deepEqual(ntvCatalog(null),[]);
});
test('catalog fetch is restricted to public NTV metadata and does not forward private credentials',async()=>{
 let calls=0;const response=await streamsCatalogAPI(new Request('https://app.example/api/streams?sport=nfl',{headers:{Cookie:'private-espn',Authorization:'private'}}),async(url,options)=>{calls++;assert.equal(url,'https://ntv.st/api/get-matches?server=raptor&type=both');assert.equal(options.redirect,'manual');assert.deepEqual(Object.keys(options.headers),['Accept']);return Response.json(raw);});
 assert.equal(response.status,200);assert.equal((await response.json()).entries.length,1);assert.equal(calls,1);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('unsupported sports and methods never contact a provider',async()=>{
 const no=()=>{throw Error('unexpected fetch');};assert.equal((await streamsCatalogAPI(new Request('https://app.example/api/streams?sport=bad'),no)).status,400);assert.equal((await streamsCatalogAPI(new Request('https://app.example/api/streams?sport=nfl',{method:'POST'}),no)).status,405);assert.equal((await streamsResolveAPI(new Request('https://app.example/api/streams/resolve',{method:'POST'}),no)).status,405);
});
test('NTV watch URLs resolve through its official API to the published embed',async()=>{
 const response=await streamsResolveAPI(request(page),async(url,options)=>{assert.equal(url,'https://ntv.st/api/get-watch-streams?server=raptor&match=game-1&source=0');assert.equal(options.redirect,'manual');return Response.json({success:true,embedUrl:'/embed?t=published'});});assert.equal(response.status,200);assert.equal((await response.json()).url,embed);
 assert.equal((await streamsResolveAPI(request(embed),()=>{throw Error('unnecessary fetch');})).status,200);
});
test('resolver rejects arbitrary upstreams, credentials, alternate ports and unsupported NTV routes',async()=>{
 let calls=0;const fetcher=()=>{calls++;throw Error('unexpected');};for(const url of ['http://ntv.st/watch/raptor/a','https://127.0.0.1/','https://ntv.st.evil.example/watch/raptor/a','https://user:pass@ntv.st/','https://ntv.st:8443/'])assert.equal((await streamsResolveAPI(request(url),fetcher)).status,400);
 for(const url of ['https://ntv.st/','https://ntv.st/watch/private/a','https://ntv.st/watch/raptor/a?source=-1'])assert.equal((await streamsResolveAPI(request(url),fetcher)).status,502);assert.equal(calls,0);
});
test('provider redirects cannot escape the allowlist and oversized responses are rejected',async()=>{
 for(const response of [new Response('',{status:302,headers:{Location:'https://other.example/'}}),new Response('small',{headers:{'Content-Length':'600001'}}),new Response('x'.repeat(600001))]){let calls=0;assert.equal((await streamsResolveAPI(request('https://streamcorner.st/game'),async()=>{calls++;return response;})).status,502);assert.equal(calls,1);}
});
test('resolver does not accept a homepage or arbitrary URL as an NTV player',async()=>{
 for(const embedUrl of ['https://other.example/embed?t=a','https://ntv.st/','/embed',null])assert.equal((await streamsResolveAPI(request(page),async()=>Response.json({success:true,embedUrl}))).status,502);
});
test('StreamCorner extracts a single explicit player, ignoring ads and ambiguous alternatives',async()=>{
 const html='<iframe title="ad" src="https://ad.example/embed"></iframe><iframe id="stream-player" src="https://player.example/embed?x=1&amp;y=2"></iframe>';
 assert.equal(embeddedPlayerFromHTML(html,'https://streamcorner.st/game'),'https://player.example/embed?x=1&y=2');
 assert.equal(embeddedPlayerFromHTML(html+'<iframe src="https://another.example/player/2"></iframe>','https://streamcorner.st/game'),null);
 assert.equal(embeddedPlayerFromHTML('<iframe src="https://example.com/home"></iframe>','https://streamcorner.st/game'),null);
 const r=await streamsResolveAPI(request('https://streamcorner.st/game'),async()=>new Response(html));assert.equal(r.status,200);assert.match((await r.json()).url,/player.example\/embed/);
 const denied=await streamsResolveAPI(request('https://streamcorner.st/game'),async()=>new Response('',{status:403}));assert.equal(denied.status,502);assert.match((await denied.json()).error,/iframe embed code/);
});
test('extracted players must use public HTTPS URLs',()=>{
 for(const value of [undefined,null,'','javascript:alert(1)','http://player.example/embed','https://user:pass@example.com/embed','https://127.0.0.1/embed','https://[::1]/embed','https://foo.local/embed'])assert.equal(publicPlayerURL(value),null,String(value));
 assert.equal(publicPlayerURL('/embed?t=abc'), 'https://ntv.st/embed?t=abc');
});
test('pasting iframe code stores only its src and discards all executable markup',()=>{
 assert.equal(safeVideo('<iframe src="https://ntv.st/embed?t=one&amp;source=2" onload="bad()"></iframe><script>bad()</script>'),'https://ntv.st/embed?t=one&source=2');
 assert.throws(()=>safeVideo('<iframe src="javascript:alert(1)"></iframe>'),/https/);assert.throws(()=>safeVideo('<iframe srcdoc="bad"></iframe>'),/src URL/);assert.throws(()=>safeVideo('x'.repeat(8193)),/too long/);
});
test('discovery matches both full teams, sport and start time without guessing ambiguous matches',()=>{
 assert.equal(matchStream(game,[entry],'nfl'),entry);for(const other of [{...entry,sport:'nba'},{...entry,start:entry.start-7*86400000},{...entry,title:'Indianapolis Colts at Chicago Bears'},{...entry,start:entry.start+91*60000}])assert.equal(matchStream(game,[other],'nfl'),null);
 assert.equal(matchStream(game,[entry,{...entry,id:'duplicate'}],'nfl'),null);assert.equal(matchStream({...game,date:'bad'},[entry],'nfl'),null);assert.equal(matchStream(game,[null,{...entry,sources:null}],'nfl'),null);
});
test('LA naming and baseball doubleheaders match only their own scheduled start',()=>{
 const g={...game,teams:[{name:'Los Angeles Dodgers'},{name:'New York Mets'}]};const first={...entry,sport:'mlb',title:'LA Dodgers vs. New York Mets'},second={...first,id:'second',start:first.start+4*3600000};assert.equal(matchStream(g,[first,second],'mlb'),first);assert.equal(matchStream({...g,date:new Date(second.start).toISOString()},[first,second],'mlb'),second);
});
test('known provider pages are never sent directly to an iframe',()=>{
 const f=new StreamFinder();assert.equal(needsPlayerResolution(page),true);assert.equal(needsPlayerResolution(embed),false);assert.equal(needsPlayerResolution('https://streamcorner.st/game'),true);assert.equal(f.playable(page),null);assert.equal(f.playable('https://player.example/embed'), 'https://player.example/embed');
});
test('discovery resolves automatic links and gives saved primary and backup links priority',async()=>{
 const f=new StreamFinder({fetcher:finderFetch});await f.refresh([game],'nfl');assert.deepEqual(f.urls(game),[embed,embed+'2']);assert.deepEqual(f.urls(game,['https://video.example/manual.m3u8','https://video.example/backup.m3u8']),['https://video.example/manual.m3u8','https://video.example/backup.m3u8']);assert.equal(f.original(embed),page);
 f.enabled=false;assert.deepEqual(f.urls(game),[]);assert.deepEqual(f.urls(game,[embed]),[embed]);
});
test('catalog failure still resolves saved provider links and keeps last good automatic links',async()=>{
 const f=new StreamFinder({fetcher:finderFetch,now:()=>0});await f.refresh([game],'nfl');f.now=()=>100000;f.fetcher=async url=>url.includes('/resolve?')?finderFetch(url):new Response('',{status:502});assert.equal(await f.refresh([game],'nfl',[page]),false);assert.deepEqual(f.urls(game),[embed,embed+'2']);assert.match(f.status,/Retrying/);
});
test('lookup cancellation cannot install matches for a previous mode or day',async()=>{
 const pending=deferred(),f=new StreamFinder({fetcher:()=>pending.promise});const old=f.refresh([game],'nfl');f.cancel();pending.resolve(Response.json({sport:'nfl',entries:[entry]}));await old;assert.deepEqual(f.urls(game),[]);assert.equal(f.pending,false);
});
test('concurrent player resolutions share a request and a failed renewal retains the working link',async()=>{
 const pending=deferred();let calls=0,now=0;const f=new StreamFinder({fetcher:()=>{calls++;return pending.promise;},now:()=>now});const one=f.resolve(page),two=f.resolve(page);pending.resolve(Response.json({page,url:embed}));assert.deepEqual(await Promise.all([one,two]),[embed,embed]);assert.equal(calls,1);now=100000;f.fetcher=async()=>{throw Error('offline');};assert.equal(await f.resolve(page),embed);assert.equal(f.playable(page),embed);
});
test('ESPN restoration preferences keep automatic discovery on unless explicitly disabled',()=>{
 for(const normalize of [normalizePreferences,normalizeSportPreferences]){assert.equal(normalize({}).autoDiscover,true);assert.equal(normalize({autoDiscover:false}).autoDiscover,false);assert.equal(normalize({autoDiscover:'false'}).autoDiscover,true);}
});
