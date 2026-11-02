import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import worker from '../dist/server/index.js';
const assets=[];
for(const name of await readdir('web'))if(/\.(html|css|js|json|svg)$/.test(name))assets.push([name==='index.html'?'/':'/'+name,'web/'+name]);
assets.push(['/hls.light.mjs','node_modules/hls.js/dist/hls.light.mjs'],['/hls-LICENSE.txt','node_modules/hls.js/LICENSE']);
for(const [path,file] of assets){const response=await worker.fetch(new Request('https://site.test'+path),{});assert.equal(response.status,200);assert.equal(await response.text(),await readFile(file,'utf8'),path);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');const head=await worker.fetch(new Request('https://site.test'+path,{method:'HEAD'}),{});assert.equal(await head.text(),'');assert.equal(head.status,200);}
assert.equal((await worker.fetch(new Request('https://site.test/missing'),{})).status,404);
assert.equal((await worker.fetch(new Request('https://site.test/',{method:'POST'}),{})).status,405);
assert.equal((await worker.fetch(new Request('https://site.test/api/nfl-source',{method:'POST'}),{})).status,405);
assert.equal((await worker.fetch(new Request('https://site.test/api/nfl-highlights',{method:'POST'}),{})).status,405);
const original=globalThis.fetch,id='cccccccc-cccc-cccc-cccc-cccccccccccc',pub='2026-11-01T18:30:00Z';let requests=0;
globalThis.fetch=async url=>{requests++;assert.ok(url.startsWith('https://www.nfl.com/videos/'));return new Response('<script id="video-config-test">'+JSON.stringify({playlist:[{id,mcpID:'123',slug:'test-touchdown',title:'Jonathan Taylor touchdown',description:'Jonathan Taylor scores a 4-yard touchdown.',publishDate:pub,tags:[{teamId:'11',title:'Indianapolis Colts'}]}]})+'</script>');};
try{const response=await worker.fetch(new Request('https://site.test/api/nfl-highlights'),{}),data=await response.json();assert.equal(response.status,200);assert.equal(data.clips[0].publishedAt,Date.parse(pub));assert.equal(data.clips[0].teams[0],'IND');assert.equal(requests,1);}finally{globalThis.fetch=original;}
globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');assert.match(url,/site\.api\.espn\.com\/apis\/site\/v2\/sports\/(basketball\/nba|hockey\/nhl|baseball\/mlb)\/scoreboard\?dates=20261101&limit=100$/);return Response.json({events:[],season:{year:2026}});};
try{for(const sport of ['nba','nhl','mlb']){const response=await worker.fetch(new Request('https://site.test/api/sports?sport='+sport+'&date=2026-11-01'),{});assert.equal(response.status,200);const data=await response.json();assert.equal(data.sport,sport);assert.deepEqual(data.events,[]);}assert.equal((await worker.fetch(new Request('https://site.test/api/sports/league',{method:'POST',body:'{}'}),{})).status,400);}finally{globalThis.fetch=original;}
console.log(JSON.stringify({exactAssetComparisons:assets.length,headRequests:assets.length,routeChecks:8,compiledNFLMetadataCheck:'passed',compiledSportsCheck:'passed',network:'mocked'}));
