import {publicPlayerURL,embeddedPlayerFromHTML,decodeEmbedHTML} from '../web/stream-html.js';
export {publicPlayerURL,embeddedPlayerFromHTML} from '../web/stream-html.js';
// Public provider metadata only. No ESPN credentials, video proxying, or arbitrary upstream fetches.
const STREAM_HOSTS=new Set(['ntv.st','streamcorner.st']);
const STREAM_SERVERS=new Set(['raptor','falcon','phoenix','titan']);
const streamCache=new Map(),streamPending=new Map();
const streamJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function providerText(url,fetcher){
 // Following a provider redirect must never turn this into an open URL proxy.
 for(let hop=0;hop<3;hop++){
  const u=new URL(url);if(!STREAM_HOSTS.has(u.hostname)||u.protocol!=='https:'||u.port&&u.port!=='443')throw new Error('Unsupported provider redirect.');
  const response=await fetcher(u.href,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json, text/html'}});
  if(response.status>=300&&response.status<400){const next=new URL(response.headers.get('Location')||'',u);if(next.hostname!==u.hostname)throw new Error('Provider moved to another site.');url=next.href;continue;}
  if(!response.ok)throw new Error('Provider unavailable ('+response.status+').');
  if(Number(response.headers.get('Content-Length'))>600000)throw new Error('Provider response too large.');
  const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>600000)throw new Error('Provider response too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
 }
 throw new Error('Too many provider redirects.');
}
async function cachedStream(key,fetcher,loader){
 if(fetcher!==fetch)return loader();const now=Date.now(),hit=streamCache.get(key);if(hit&&hit.until>now)return hit.value;if(streamPending.has(key))return streamPending.get(key);
 const task=loader().then(value=>{if(streamCache.size>=128)streamCache.delete(streamCache.keys().next().value);streamCache.set(key,{until:Date.now()+90000,value});return value;}).finally(()=>streamPending.delete(key));streamPending.set(key,task);return task;
}
export function ntvCatalog(raw){
 if(!raw||typeof raw!=='object')return [];
 const sportFor={NFL:'nfl',NBA:'nba',NHL:'nhl',MLB:'mlb'},seen=new Set(),entries=[];
 for(const item of [...(Array.isArray(raw.live)?raw.live:[]),...(Array.isArray(raw.all)?raw.all:[]),...(Array.isArray(raw.nonLive)?raw.nonLive:[]),...(Array.isArray(raw.upcoming)?raw.upcoming:[]),...(Array.isArray(raw.matches)?raw.matches:[])]){
  if(!item||typeof item!=='object')continue;const sport=sportFor[String(item.tournament||'').toUpperCase()],id=String(item.id||''),start=Number(item.date);
  if(!sport||!Number.isFinite(start)||start<=0||!/^[-\w]{1,120}$/.test(id)||seen.has(id))continue;seen.add(id);
  const sources=(Array.isArray(item.sources)?item.sources:[]).slice(0,3).map((_,index)=>'https://ntv.st/watch/raptor/'+id+'?source='+index);
  if(sources.length)entries.push({id,provider:'NTV',sport,title:String(item.title||'').slice(0,200),start,sources});
 }
 return entries.slice(0,250);
}
export async function streamsCatalogAPI(request,fetcher=fetch){
 if(request.method!=='GET')return streamJSON({error:'Use GET.'},405);const sport=new URL(request.url).searchParams.get('sport');if(!['nfl','nba','nhl','mlb'].includes(sport))return streamJSON({error:'Choose a supported sport.'},400);
 const results=await Promise.allSettled([
  cachedStream('ntv-catalog',fetcher,async()=>{const raw=JSON.parse(await providerText('https://ntv.st/api/get-matches?server=raptor&type=both',fetcher));if(!raw.success)throw new Error('Catalog unavailable.');return ntvCatalog(raw);}),
  cachedStream('streamcorner-catalog',fetcher,async()=>streamcornerCatalog(await providerText('https://streamcorner.st/',fetcher)))
 ]);
 const entries=results.flatMap(r=>r.status==='fulfilled'?r.value:[]).filter(e=>e.sport===sport);
 const providers=results.map((r,i)=>({name:i?'StreamCorner':'NTV',available:r.status==='fulfilled',count:r.status==='fulfilled'?r.value.filter(e=>e.sport===sport).length:0}));
 return streamJSON({sport,entries,providers,fetchedAt:Date.now(),...(results.every(r=>r.status==='rejected')?{error:'Automatic stream lookup is unavailable. Your saved links still work.'}:{})},results.every(r=>r.status==='rejected')?502:200);
}
export async function streamsResolveAPI(request,fetcher=fetch){
 if(request.method!=='GET')return streamJSON({error:'Use GET.'},405);const input=new URL(request.url).searchParams.get('url');let page;try{page=new URL(input);if(input.length>4096||!STREAM_HOSTS.has(page.hostname)||page.protocol!=='https:'||page.username||page.password||page.port&&page.port!=='443')throw new Error();}catch{return streamJSON({error:'Use an NTV or StreamCorner game link.'},400);}
 try{const url=await cachedStream(page.href,fetcher,async()=>{
  if(page.hostname==='ntv.st'){
   if(page.pathname==='/embed'&&page.searchParams.get('t'))return page.href;
   const match=/^\/watch\/([^/]+)\/([-\w]{1,120})\/?$/.exec(page.pathname),index=Number(page.searchParams.get('source')||0);
   if(!match||!STREAM_SERVERS.has(match[1])||!Number.isInteger(index)||index<0||index>20)throw new Error('Use an NTV game or embed link.');
   const raw=JSON.parse(await providerText('https://ntv.st/api/get-watch-streams?'+new URLSearchParams({server:match[1],match:match[2],source:String(index)}),fetcher));
   const embed=raw.success&&raw.embedUrl&&publicPlayerURL(raw.embedUrl,'https://ntv.st');if(!embed||new URL(embed).hostname!=='ntv.st'||new URL(embed).pathname!=='/embed'||!new URL(embed).searchParams.get('t'))throw new Error('Player not published.');return embed;
  }
  const embed=embeddedPlayerFromHTML(await providerText(page.href,fetcher),page.href);if(!embed)throw new Error('No unambiguous published player.');return embed;
 });return streamJSON({url,page:page.href,provider:page.hostname==='ntv.st'?'NTV':'StreamCorner',resolvedAt:Date.now()});}
 catch{return streamJSON({error:'The provider did not expose an accessible player. Paste its iframe embed code or direct player URL instead.',page:page.href},502);}
}

// Read only explicitly published event URLs and times. Never invent game slugs.
export function streamcornerCatalog(html){
 const entries=[],seen=new Set();
 const add=item=>{
  const sport=String(item.sport||item.tournament||item.competition?.name||'').match(/\b(NFL|NBA|NHL|MLB)\b/i)?.[1]?.toLowerCase();
  const title=String(item.name||item.title||''),url=publicPlayerURL(item.url,'https://streamcorner.st');
  const raw=item.startDate??item.start??item.date,start=typeof raw==='number'?(raw<1e12?raw*1000:raw):Date.parse(raw);
  if(!sport||!title||!Number.isFinite(start)||!url||new URL(url).hostname!=='streamcorner.st'||new URL(url).pathname==='/'||seen.has(url))return;
  seen.add(url);entries.push({id:url,provider:'StreamCorner',sport,title:title.slice(0,200),start,sources:[url]});
 };
 const visit=(value,depth=0)=>{if(depth>12||!value||typeof value!=='object')return;if(Array.isArray(value)){for(const v of value.slice(0,500))visit(v,depth+1);return;}if(value['@type']==='SportsEvent'||value.startDate||value.start&&value.url)add(value);for(const key of ['@graph','itemListElement','item','events','matches','props','pageProps','data'])if(value[key])visit(value[key],depth+1);};
 for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(m[1]));}catch{}
 for(const m of html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi)){
  const attr=name=>new RegExp('\\b'+name+'\\s*=\\s*(["\'])(.*?)\\1','i').exec(m[1])?.[2];
  const startDate=attr('data-start')||attr('data-date')||/datetime\s*=\s*["']([^"']+)/i.exec(m[2])?.[1];
  if(startDate)add({url:decodeEmbedHTML(attr('href')||''),startDate,sport:attr('data-sport')||m[2].replace(/<[^>]+>/g,' '),name:decodeEmbedHTML((attr('data-title')||m[2].replace(/<[^>]+>/g,' ')).trim())});
 }
 return entries.slice(0,250);
}
