import test from 'node:test';
import assert from 'node:assert/strict';
import {versionAssets} from '../scripts/version-assets.mjs';
const fixture=()=>({'/':{type:'text/html',body:'<link rel="stylesheet" href="/style.css"><link rel="modulepreload" href="/player.js"><script src="/app.js" type="module"></script><img src="https://example.test/logo.png">'},'/app.js':{type:'text/javascript',body:"import {player} from './player.js'; import('./hls.light.mjs'); fetch('/api/league');"},'/player.js':{type:'text/javascript',body:'export const player=1;'},'/style.css':{type:'text/css',body:'body{color:red}'},'/hls.light.mjs':{type:'text/javascript',body:'export default {};'}});
test('a deployment versions the HTML, stylesheet and every local module import together',()=>{
 const files=fixture(),rev=versionAssets(files);
 assert.match(rev,/^[0-9a-f]{12}$/);
 for(const path of ['style.css','player.js','app.js'])assert.ok(files['/'].body.includes('/'+path+'?v='+rev));
 for(const path of ['player.js','hls.light.mjs'])assert.ok(files['/app.js'].body.includes('./'+path+'?v='+rev));
 assert.ok(files['/app.js'].body.includes("fetch('/api/league')"));assert.ok(files['/'].body.includes('https://example.test/logo.png'));
 const changed=fixture();changed['/player.js'].body='export const player=2;';const next=versionAssets(changed);assert.notEqual(next,rev);assert.ok(changed['/'].body.includes('/app.js?v='+next));
 assert.equal(versionAssets(fixture()),rev,'unchanged builds keep the same revision');
});
