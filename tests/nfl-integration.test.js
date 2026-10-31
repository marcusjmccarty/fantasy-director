import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {NFLSourceCatalog} from '../web/nfl-sources.js';
const script=readFileSync(new URL('../server/nfl.js',import.meta.url),'utf8').replaceAll('export ','');
function server(){const ctx={Response,Request,URL,AbortSignal,Date,crypto:webcrypto,atob};vm.createContext(ctx);vm.runInContext(script+'\nglobalThis.api={parseNFLCatalog,nflHighlightsAPI,nflSourceAPI};',ctx);return ctx.api;}
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',relatedId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const url='https://www.nfl.com/videos/taylor-touchdown';
const clip={id,mcpID:'123',slug:'taylor-touchdown',title:'Taylor touchdown',tags:[{teamId:'team',title:'Indianapolis Colts'},{personId:'person',title:'Jonathan Taylor'}]};
const related={...clip,id:relatedId,mcpID:'124',slug:'another-touchdown',title:'Another touchdown'};
const playlist=clips=>'<script id="video-config-test" type="application/json">'+JSON.stringify({playlist:clips})+'</script>';
const metadata=value=>'<script type="application/ld+json">'+JSON.stringify(value)+'</script>';
const pub='2026-11-01T18:30:00Z';
const primary={ '@type':'VideoObject',url,name:clip.title,description:'Jonathan Taylor scores a 4-yard touchdown for the Indianapolis Colts.',uploadDate:pub };

test('NFL metadata enriches its exact video without dating the related playlist',()=>{
 const s=server(),page=playlist([clip,related])+metadata({'@graph':[primary]}),clips=s.parseNFLCatalog(page,{'Indianapolis Colts':'IND'},url);
 assert.equal(clips[0].publishedAt,Date.parse(pub));assert.match(clips[0].description,/4-yard/);assert.equal(clips[0].teams[0],'IND');assert.equal(clips[0].athletes[0],'Jonathan Taylor');
 assert.equal(clips[1].publishedAt,0);assert.equal(clips[1].description,'');
 const different=s.parseNFLCatalog(playlist([clip,related])+metadata({...primary,url:'https://www.nfl.com/videos/'+related.slug}),{},url);
 assert.equal(different[0].publishedAt,0,'an explicitly different URL defeats even an identical headline');assert.equal(different[1].publishedAt,Date.parse(pub));
});
test('primary-page metadata supports expanded titles and attribute order without trusting discovery time',()=>{
 const s=server(),page=playlist([clip,related])+metadata({...primary,url:undefined,name:'An expanded primary headline'});
 assert.equal(s.parseNFLCatalog(page,{},url)[0].publishedAt,Date.parse(pub));
 const meta=playlist([clip,related])+`<meta content="${pub}" itemprop="uploadDate"><meta content="A 4-yard touchdown &amp; celebration" property="og:description">`;
 const rows=s.parseNFLCatalog(meta,{},url);assert.equal(rows[0].publishedAt,Date.parse(pub));assert.equal(rows[0].description,'A 4-yard touchdown & celebration');assert.equal(rows[1].publishedAt,0);
 assert.equal(s.parseNFLCatalog(meta)[0].publishedAt,0,'channel metadata cannot date a related clip');
 for(const publishDate of [undefined,'2026-11-01','2026-11-01T18:30:00','yesterday'])assert.equal(s.parseNFLCatalog(playlist([{...clip,publishDate}]))[0].publishedAt,0);
});
test('explicit publication and season/week fields survive while malformed entries are ignored',()=>{
 const s=server(),page=playlist([null,{}, {...clip,publishDate:Date.parse(pub)/1000,description:'Week 8 of the 2026 NFL season',tags:[null,'bad',...clip.tags]}]);
 const rows=s.parseNFLCatalog(page);assert.equal(rows.length,1);assert.equal(rows[0].publishedAt,Date.parse(pub));assert.equal(rows[0].season,2026);assert.equal(rows[0].week,8);
 assert.equal(s.parseNFLCatalog('<script id="video-config-bad">bad JSON</script>').length,0);
 assert.equal(s.parseNFLCatalog('<script id="video-config-null">null</script>').length,0);
});
test('live catalog enrichment is bounded, tolerates page failures and shares its pending request/cache',async()=>{
 const s=server(),clips=Array.from({length:12},(_,i)=>({...clip,id:`aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12,'0')}`,slug:`touchdown-${i}`,title:`Touchdown ${i}`})),calls=[];
 const fetcher=async u=>{calls.push(u);if(u.includes('/channel/'))return new Response(playlist(clips));if(u.endsWith('-1'))throw new Error('one provider page failed');const c=clips.find(c=>u.endsWith('/'+c.slug));return new Response(playlist([c])+metadata({...primary,url:u,name:c.title}));};
 const request=new Request('https://site.test/api/nfl-highlights');
 const responses=await Promise.all([s.nflHighlightsAPI(request,{},fetcher),s.nflHighlightsAPI(request,{},fetcher)]);
 for(const response of responses){assert.equal(response.status,200);const data=await response.json();assert.equal(data.clips.length,12);assert.equal(data.clips.filter(c=>c.publishedAt).length,5);}
 assert.equal(calls.length,7,'one channel plus six enrichment requests shared across callers');
 await s.nflHighlightsAPI(request,{},fetcher);assert.equal(calls.length,7,'warm catalog needs no more requests');
});
test('a cold Worker resolves a validated clip page without requiring a previous catalog request',async()=>{
 const s=server(),calls=[];
 const fetcher=async(u,options={})=>{calls.push(u);if(u===url)return new Response(playlist([clip]));if(u.startsWith('https://p.nfltags.com/'))return new Response('desktop:{production:{nflClientId:"public",nflClientKey:"key",nflClientSecret:"secret"');if(u.includes('/identity/'))return Response.json({accessToken:'anonymous-token'});assert.equal(u,'https://api.nfl.com/play/v1/asset/123');assert.equal(JSON.parse(options.body).asset.id,id);return Response.json({accessUrl:'https://dcs-vod.mp.lura.live/vod/master.m3u8',metadata:{event:{duration:12}}});};
 const response=await s.nflSourceAPI(new Request(`https://site.test/api/nfl-source?id=${id}&slug=taylor-touchdown`),[],fetcher);
 assert.equal(response.status,200);const body=await response.text();assert.equal(JSON.parse(body).duration,12);assert.equal(body.includes('anonymous-token'),false);assert.equal(calls.length,4);assert.equal(calls[0],url);
});
test('cold resolution never trusts a mismatched primary ID or a caller-supplied fetch target',async()=>{
 for(const slug of ['taylor-touchdown','https://attacker.test/video','../identity']){
  const s=server(),calls=[];const fetcher=async u=>{calls.push(u);assert.ok(u.startsWith('https://www.nfl.com/videos/'));return u===url?new Response(playlist([related])):new Response('',{status:404});};
  const response=await s.nflSourceAPI(new Request(`https://site.test/api/nfl-source?id=${id}&slug=${encodeURIComponent(slug)}`),[],fetcher);assert.equal(response.status,404);assert.equal(calls.some(u=>u.includes('api.nfl.com')),false);
 }
});
test('the cold resolver keeps DRM and non-provider media inside the official player',async()=>{
 for(const asset of [{accessUrl:'https://attacker.test/master.m3u8'},{accessUrl:'https://dcs-vod.mp.lura.live/vod/master.m3u8',licenseUrl:'https://license.test'}]){
  const s=server(),fetcher=async u=>u===url?new Response(playlist([clip])):u.includes('nfltags')?new Response('desktop:{production:{nflClientId:"public",nflClientKey:"key",nflClientSecret:"secret"'):u.includes('/identity/')?Response.json({accessToken:'anonymous'}):Response.json(asset);
  const response=await s.nflSourceAPI(new Request(`https://site.test/api/nfl-source?id=${id}&slug=taylor-touchdown`),[],fetcher);assert.equal(response.status,502);assert.match((await response.json()).error,/official player/);
 }
});
test('client sends only a validated NFL slug and renews a nearly expired playback URL',async()=>{
 let now=100000,calls=[];const catalog=new NFLSourceCatalog({now:()=>now,fetcher:async u=>{calls.push(u);return Response.json({url:'https://dcs-vod.mp.lura.live/vod/master.m3u8',expiresAt:now+20000});}});
 await catalog.resolve({...clip,url});assert.match(calls[0],/&slug=taylor-touchdown$/);now+=11000;await catalog.resolve({...clip,url});assert.equal(calls.length,2);
 await catalog.resolve({...related,url:'https://attacker.test/videos/evil'});assert.equal(calls[2].includes('slug='),false);
});
