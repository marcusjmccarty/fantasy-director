import http from 'node:http';import {stat,mkdir,writeFile} from 'node:fs/promises';
// Serves the built Worker locally and picks up each new `npm run build` without a restart.
// Dev-only extras: POST /dev/frame?game=<id>&t=<media seconds> stores a PNG (scorebug calibration),
// and an optional .sites-runtime/env.json supplies Worker secrets such as ESPN cookies.
const bundle=new URL('../dist/server/index.js',import.meta.url);let worker,loaded=0;
async function current(){const {mtimeMs}=await stat(bundle);if(mtimeMs!==loaded){worker=(await import(bundle.href+'?v='+mtimeMs)).default;loaded=mtimeMs;}return worker;}
async function env(){try{return JSON.parse(await import('node:fs/promises').then(fs=>fs.readFile(new URL('../.sites-runtime/env.json',import.meta.url),'utf8')));}catch{return {};}}
const FRAMES=process.env.FRAME_DIR||new URL('../.sites-runtime/frames/',import.meta.url).pathname;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Private-Network':'true'};
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://x');
 if(url.pathname==='/dev/relay'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(`<!doctype html><meta charset="utf-8"><script>addEventListener('message',async e=>{const d=e.data;if(!d||d.type!=='frame')return;const r=await fetch('/dev/frame?game='+encodeURIComponent(d.game)+'&t='+encodeURIComponent(d.t),{method:'POST',body:d.png}).then(r=>r.status).catch(()=>0);e.source.postMessage({type:'frame-ack',t:d.t,status:r},'*');});</script>relay`);}
 if(url.pathname==='/dev/frame'){
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
  const game=url.searchParams.get('game')||'',t=url.searchParams.get('t')||'';
  if(req.method!=='POST'||!/^\d+$/.test(game)||!/^\d+$/.test(t)){res.writeHead(400,cors);return res.end();}
  const chunks=[];for await(const c of req)chunks.push(c);const b64=Buffer.concat(chunks).toString().replace(/^data:image\/\w+;base64,/,'');
  await mkdir(FRAMES+game,{recursive:true});await writeFile(`${FRAMES}${game}/${t.padStart(6,'0')}.png`,Buffer.from(b64,'base64'));
  res.writeHead(200,cors);return res.end('ok');
 }
 const buffers=[];for await(const chunk of req)buffers.push(chunk);const init={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method))init.body=Buffer.concat(buffers);
 const response=await (await current()).fetch(new Request('http://'+(req.headers.host||'127.0.0.1:4187')+req.url,init),await env());
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(error){res.writeHead(500);res.end('Preview error: '+error.message);}}).listen(4187,'127.0.0.1',()=>console.log('http://127.0.0.1:4187'));
