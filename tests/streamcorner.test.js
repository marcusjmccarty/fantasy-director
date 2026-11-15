import test from 'node:test';
import assert from 'node:assert/strict';
import {streamcornerURL} from '../web/stream-policy.js';
import {streamsResolveAPI,streamcornerCatalog} from '../server/streams.js';
import {StreamFinder} from '../web/stream-finder.js';

const cloud='https://streamcorner.cloud/watch/colts-vikings';
const native='https://media.example/colts-vikings.m3u8';
const ntv='https://ntv.st/embed?t=backup';
const game={id:'1',state:'in',date:'2026-11-15T18:00:00Z',teams:[{name:'Indianapolis Colts'},{name:'Minnesota Vikings'}]};
const entry={sport:'nfl',title:'Indianapolis Colts vs Minnesota Vikings',start:Date.parse(game.date)};
const request=url=>new Request('https://site.example/api/streams/resolve?url='+encodeURIComponent(url));

test('StreamCorner accepts cloud and legacy links, rejecting lookalikes and credentials',async()=>{
 for(const host of ['streamcorner.cloud','streamcorner.st'])assert.ok(streamcornerURL('https://'+host+'/watch/game'));
 for(const url of ['http://streamcorner.cloud/game','https://user:pass@streamcorner.cloud/game','https://streamcorner.cloud:8443/game','https://streamcorner.cloud.evil.example/game','https://streamcorner-cloud.example/game']){
  assert.equal(streamcornerURL(url),null);let calls=0;
  assert.equal((await streamsResolveAPI(request(url),async()=>{calls++;throw Error();})).status,400);assert.equal(calls,0);
 }
});

test('legacy redirects resolve relative players against cloud and inspect published wrappers',async()=>{
 const calls=[];
 const response=await streamsResolveAPI(request('https://streamcorner.st/watch/colts-vikings'),async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'manual');assert.deepEqual(Object.keys(options.headers),['Accept']);
  if(url.startsWith('https://streamcorner.st/'))return new Response('',{status:302,headers:{Location:cloud}});
  if(url===cloud)return new Response('<iframe id="player" src="/embed/game"></iframe>');
  assert.equal(url,'https://streamcorner.cloud/embed/game');return new Response(`<video src="${native}"></video>`);
 });
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.url,native);assert.equal(data.playback,'native');assert.equal(calls.length,3);
 assert.equal(data.page,'https://streamcorner.st/watch/colts-vikings');
});

test('unknown third-party players are returned as embeds without fetching their pages',async()=>{
 let calls=0;const response=await streamsResolveAPI(request(cloud),async()=>{calls++;return new Response('<iframe id="player" src="https://external.example/embed/game"></iframe>');});
 assert.equal(calls,1);const data=await response.json();assert.equal(data.playback,'embed');assert.equal(data.url,'https://external.example/embed/game');
});

test('provider redirects never fetch NTV, private targets or credential-bearing URLs',async()=>{
 for(const url of ['https://ntv.st/embed?t=x','https://127.0.0.1/','https://user:pass@streamcorner.cloud/embed/game']){
  let calls=0;const response=await streamsResolveAPI(request(cloud),async()=>{calls++;return new Response('',{status:302,headers:{Location:url}});});
  assert.equal(response.status,502);assert.equal(calls,1);
 }
});

test('automatic preference promotes native StreamCorner and retains NTV as backup',async()=>{
 const calls=[];const f=new StreamFinder({fetcher:async url=>{
  calls.push(url);
  if(url.startsWith('/api/streams?'))return Response.json({sport:'nfl',entries:[{...entry,provider:'NTV',sources:[ntv]},{...entry,provider:'StreamCorner',sources:[cloud]}]});
  if(url.includes('ntv.st'))return Response.json({page:ntv,url:ntv});
  assert.ok(url.startsWith('/api/streams/resolve?'));assert.equal(new URL(url,'https://site.example').searchParams.get('url'),cloud);
  return Response.json({page:cloud,url:native,playback:'native'});
 }});
 await f.refresh([game],'nfl');assert.deepEqual(f.urls(game,[],'auto'),[native,ntv]);assert.deepEqual(f.urls(game),[native,ntv]);
 assert.equal(f.options(game)[0].provider,'StreamCorner');assert.equal(f.original(native),cloud);
 assert.deepEqual(f.urls(game,['https://media.example/manual.mp4']),['https://media.example/manual.mp4',native,ntv]);
 assert.deepEqual(f.urls(game,[],'NTV'),[ntv]);assert.equal(calls.length,3);
});

test('opaque or unavailable StreamCorner never displaces NTV in Auto',async()=>{
 for(const result of [Response.json({page:cloud,url:'https://external.example/embed/game'}),new Response('',{status:502})]){
  const f=new StreamFinder({fetcher:async url=>url.startsWith('/api/streams?')?Response.json({sport:'nfl',entries:[{...entry,provider:'StreamCorner',sources:[cloud]},{...entry,provider:'NTV',sources:[ntv]}]}):result});
  await f.refresh([game],'nfl');assert.deepEqual(f.urls(game,[],'auto'),[ntv]);assert.equal(f.options(game)[0].provider,'NTV');
  assert.equal(f.urls(game,[],'StreamCorner').length,1,'explicit provider selection remains available');
 }
});

test('cloud embed URLs also resolve to native video through the server',async()=>{
 const page='https://streamcorner.cloud/embed/game';let calls=0;
 const f=new StreamFinder({fetcher:async url=>{calls++;assert.equal(new URL(url,'https://site.example').searchParams.get('url'),page);return Response.json({page,url:native});}});
 assert.equal(await f.resolve(page),native);assert.equal(f.playable(page),native);assert.equal(calls,1);
});

test('catalog keeps exact published event paths under the final provider origin',()=>{
 const event={'@type':'SportsEvent',name:entry.title,sport:'NFL',startDate:game.date,url:'/watch/exact-published-path'};
 const html='<script type="application/ld+json">'+JSON.stringify(event)+'</script>';
 assert.equal(streamcornerCatalog(html)[0].sources[0],'https://streamcorner.cloud/watch/exact-published-path');
 assert.equal(streamcornerCatalog(html,'https://streamcorner.st/')[0].sources[0],'https://streamcorner.st/watch/exact-published-path');
});
