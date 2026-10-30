// Writes jobs.tsv (game id, embed id, recording length, signed MP4 url) for
// every replay in web/week7.json, resolving each provider embed page to its
// HD rendition. The signed urls expire within a day: run this right before
// run-all.sh.
//   node scripts/scorebug-ocr/jobs.mjs
import {readFile,writeFile} from 'node:fs/promises';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const archive=JSON.parse(await readFile(new URL('../../web/week7.json',import.meta.url),'utf8'));
const rows=[];
for(const g of archive.games){
 const id=String(g.embed||'').split('/').pop();if(!id){console.error(`${g.name}: no embed`);continue;}
 const html=await (await fetch('https://ok.ru/videoembed/'+id,{headers:{'User-Agent':UA}})).text();
 const m=/data-options="([^"]*)"/.exec(html);if(!m){console.error(`${g.name}: no player options`);continue;}
 const opts=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
 let md=opts.flashvars?.metadata;if(typeof md==='string')md=JSON.parse(md);
 const videos=Object.fromEntries((md?.videos||[]).map(v=>[v.name,v.url]));
 const url=videos.hd||videos.sd||videos.low;if(!url){console.error(`${g.name}: no rendition`);continue;}
 rows.push([g.id,id,Math.round(g.recordingDuration),url].join('\t'));
}
await writeFile(new URL('./jobs.tsv',import.meta.url),rows.join('\n')+'\n');
console.log(`${rows.length} jobs`);
