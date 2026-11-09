import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {packageExtension} from '../scripts/extension-package.mjs';
test('one deterministic extension ZIP includes the original desk, replay assets and playback helper',async()=>{
 const zip=await packageExtension(),files=new Map();let pos=0;
 while(zip.readUInt32LE(pos)===0x04034b50){const size=zip.readUInt32LE(pos+18),len=zip.readUInt16LE(pos+26),extra=zip.readUInt16LE(pos+28),name=zip.subarray(pos+30,pos+30+len).toString(),start=pos+30+len+extra;files.set(name,zip.subarray(start,start+size));pos=start+size;}
 for(const name of ['manifest.json','background.js','playback-background.js','content.js','fullscreen.js','media.js','coordinator.js','dashboard.html','dashboard.js','offscreen.js','replay.html','replay.js','assets/rehearsal.webm'])assert.ok(files.has('Fantasy-Stream/'+name),name);
 const manifest=JSON.parse(files.get('Fantasy-Stream/manifest.json'));assert.equal(manifest.version,'3.2.0');assert.equal(manifest.background.type,'module');assert.match(files.get('Fantasy-Stream/background.js').toString(),/import '\.\/playback-background\.js'/);
 for(const name of files.keys())assert.ok(!name.includes('/tests/'));
 assert.ok(zip.equals(await packageExtension()));assert.ok(files.get('Fantasy-Stream/assets/rehearsal.webm').equals(await readFile(new URL('../extension/assets/rehearsal.webm',import.meta.url))));
});
