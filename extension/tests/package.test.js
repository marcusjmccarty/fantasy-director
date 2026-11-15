import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {VERSION} from '../engine.js';
const root=new URL('../',import.meta.url),read=name=>fs.readFileSync(new URL(name,root),'utf8');
test('Manifest V3 package uses local modules, scoped playback activation, and no remote scripts',()=> {
 const manifest=JSON.parse(read('manifest.json'));
 assert.equal(manifest.manifest_version,3);assert.equal(manifest.background.type,'module');assert.deepEqual(manifest.host_permissions,['https://*/*','http://localhost/*','http://127.0.0.1/*']);
 assert.ok(manifest.permissions.includes('scripting'));assert.ok(!manifest.permissions.includes('webRequest'));
 assert.equal(manifest.version,VERSION);assert.equal(JSON.parse(read('package.json')).version,VERSION);
 assert.ok(manifest.permissions.includes('offscreen'));
 for(const file of ['background.js','coordinator.js','engine.js','adapters.js','feed.js','feed-worker.js','offscreen.html','offscreen.js','tab-router.js','highlights.js','demo.js','dashboard.js','dashboard.html','styles.css','replay-policy.js','replay.html','replay.js','rehearsal.js','test-stream.html','test-stream.js','player.css']) assert.ok(read(file).length>0);
 const html=read('dashboard.html');assert.ok(html.includes('type="module" src="dashboard.js"'));
 assert.ok(!/<script[^>]+src=["']https?:/i.test(html));
});
test('runtime stays below its size budget without frameworks, fonts, or remote scripts',()=>{
 const runtime=fs.readdirSync(root).filter(name=>/\.(js|html|css)$/.test(name));
 const size=runtime.reduce((total,name)=>total+Buffer.byteLength(read(name)),0);assert.ok(size<185000,`Runtime is ${size} bytes`);
 for(const name of runtime)assert.ok(!/(https?:\/\/[^'"\s]+\.(?:woff2?|js))/.test(read(name)),`Remote runtime asset: ${name}`);
 const clip=fs.readFileSync(new URL('assets/rehearsal.webm',root));assert.ok(clip.length<70000);assert.equal(clip.subarray(0,4).toString('hex'),'1a45dfa3');
});
test('every fixed UI element referenced by the controller exists, with unique IDs',()=> {
 const html=read('dashboard.html'),js=read('dashboard.js');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id),`Missing UI element: ${id}`);
});
