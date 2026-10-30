import test from 'node:test';
import assert from 'node:assert/strict';
import {replaySourceAPI} from '../server/media.js';
import {parseNFLPublicConfig,nflSourceAPI,nflMediaURL} from '../server/nfl.js';
import {NFLSourceCatalog,rankNFLClips} from '../web/nfl-sources.js';

test('the highlight catalog keeps the global fetch receiver and recovers from synchronous failures',async t=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=function(){if(this!==globalThis)throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");calls++;return Promise.resolve(Response.json({url:'https://example.test/highlight.m3u8',expiresAt:Date.now()+300000}));};
 t.after(()=>{globalThis.fetch=original;});
 await new NFLSourceCatalog().resolve({id:'clip'});assert.equal(calls,1);
 let attempts=0,now=1000;const catalog=new NFLSourceCatalog({now:()=>now,fetcher:()=>{if(++attempts===1)throw new TypeError('Request setup failed');return Promise.resolve(Response.json({url:'https://example.test/highlight.m3u8',expiresAt:999999}));}});
 await assert.rejects(catalog.resolve({id:'one'}),/Request setup failed/);assert.equal(catalog.pending.size,0);
 now+=61000;await catalog.resolve({id:'one'});assert.equal(attempts,2);assert.ok(catalog.get('one'));
});
test('replay source rejects arbitrary embeds and unsupported request methods',async()=>{
 const games=[{id:'bad',embed:'https://attacker.example/videoembed/1234'}];
 assert.equal((await replaySourceAPI(new Request('https://site.test/api/replay-source?id=bad'),games)).status,404);
 assert.equal((await replaySourceAPI(new Request('https://site.test/api/replay-source?id=bad',{method:'POST'}),games)).status,405);
});
test('replay resolver returns the original player without issuing transferable media URLs',async t=>{
 const games=[{id:'test-source-1',embed:'https://ok.ru/videoembed/1234',page:'https://nfl-video.com/game',name:'A at B',recordingDuration:7800}];let calls=0;
 const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('Replay delivery must stay inside the provider.');};t.after(()=>{globalThis.fetch=original;});
 const response=await replaySourceAPI(new Request('https://site.test/api/replay-source?id=test-source-1'),games);assert.equal(response.status,200);const body=await response.json();assert.equal(body.sources[0].type,'provider/ok');assert.equal(body.sources[0].url,games[0].embed);assert.equal(body.duration,7800);
 assert.equal((await replaySourceAPI(new Request('https://site.test/api/replay-source?id=https://attacker.example/'),games)).status,404);assert.equal(calls,0);
});
test('NFL anonymous resolver returns only an ephemeral HLS source, without the identity token',async()=>{
 const config='desktop:{production:{nflClientId:"public-id",nflClientKey:"public-key",nflClientSecret:"public-secret"';assert.deepEqual(parseNFLPublicConfig(config),{clientKey:'public-key',clientSecret:'public-secret'});
 const clip={id:'test-nfl-id',mcpID:'12345'},calls=[];
 const fetcher=async(url,options={})=>{calls.push(url);if(url.startsWith('https://p.nfltags.com/'))return new Response(config);if(url.includes('/identity/')){assert.equal(JSON.parse(options.body).clientKey,'public-key');return Response.json({accessToken:'anonymous-test-token'});}assert.equal(options.headers.Authorization,'Bearer anonymous-test-token');assert.equal(JSON.parse(options.body).asset.mcpID,'12345');return Response.json({accessUrl:'https://dcs-vod.mp.lura.live/vod/p/master.m3u8?token=original',metadata:{event:{duration:13}}});};
 const response=await nflSourceAPI(new Request('https://site.test/api/nfl-source?id=test-nfl-id'),[clip],fetcher),body=await response.text();assert.equal(response.status,200);assert.equal(JSON.parse(body).duration,13);assert.equal(body.includes('anonymous-test-token'),false);assert.equal(calls.length,3);assert.equal(nflMediaURL('https://evil.example/master.m3u8'),null);
});
test('integrated highlight ranking prefers the selected franchise and short clips',()=>{
 const clips=[{id:'other',title:'Other highlight',teams:['SEA'],athletes:[],short:true},{id:'roster',title:'Touchdown',teams:['IND'],athletes:['Jonathan Taylor'],short:true}];
 assert.equal(rankNFLClips(clips,[{name:'Jonathan Taylor',team:'IND'}])[0].id,'roster');assert.equal(rankNFLClips(clips,[{name:'Jonathan Taylor',team:'IND'}],new Set(['roster']))[0].id,'other');
});

import {parseNFLCatalog,nflHighlightsAPI} from '../server/nfl.js';
test('current NFL catalog uses two bounded public page requests and maps roster tags',async()=>{
 const playlist=[{id:'b8840cb7-ea15-4799-a507-1baac8f334a9',mcpID:'2751404',slug:'sample-touchdown',title:'Sample touchdown',tags:[{teamId:'public-team',title:'Dallas Cowboys'},{personId:'public-player',title:'Javonte Williams'}]}];
 const page='<script type="application/json" id="video-config-example">'+JSON.stringify({playlist})+'</script>';
 assert.equal(parseNFLCatalog(page,{'Dallas Cowboys':'DAL'})[0].teams[0],'DAL');let calls=0;
 const fetcher=async url=>{calls++;return new Response(url.includes('/channel/')?'<a href="/videos/channel/skip">Skip</a><a href="/videos/sample-touchdown">Clip</a>':page);};
 const response=await nflHighlightsAPI(new Request('https://site.test/api/nfl-highlights'),{'Dallas Cowboys':'DAL'},fetcher);const data=await response.json();assert.equal(response.status,200);assert.equal(data.clips.length,1);assert.equal(data.clips[0].mcpID,'2751404');assert.equal(calls,2);
});
