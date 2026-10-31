const nflJSON=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Normal anonymous NFL.com playback flow. Public app configuration is fetched from
// NFL's own shipped player. Access tokens remain in isolate memory and never leave this endpoint.
let nflPublicConfig,nflIdentity,nflIdentityPending;
const nflMediaCache=new Map(),nflMediaPending=new Map();
export function parseNFLPublicConfig(bundle){
 const match=bundle.match(/desktop:\{production:\{nflClientId:"([^"]+)",nflClientKey:"([^"]+)",nflClientSecret:"([^"]+)"/);
 if(!match)throw new Error('NFL updated its public player configuration.');
 return {clientKey:match[2],clientSecret:match[3]};
}
export function nflMediaURL(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname.endsWith('.lura.live')&&/\.m3u8$/.test(url.pathname)?value:null;}catch{return null;}}
async function nflAnonymousToken(fetcher=fetch,renew=false){
 if(!renew&&nflIdentity?.expiresAt>Date.now()+60000)return nflIdentity.token;
 if(nflIdentityPending)return nflIdentityPending;
 const task=(async()=>{
  if(!nflPublicConfig){const response=await fetcher('https://p.nfltags.com/nfl/live/NflRnUmdComponents.Video.js',{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('NFL player configuration is unavailable.');nflPublicConfig=parseNFLPublicConfig(await response.text());}
  const response=await fetcher('https://api.nfl.com/identity/v3/token',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({...nflPublicConfig,deviceId:crypto.randomUUID()}),credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok){nflPublicConfig=null;throw new Error('NFL anonymous playback is temporarily unavailable.');}
  const data=await response.json(),token=data.accessToken;if(typeof token!=='string')throw new Error('NFL did not return a playback session.');
  let expiresAt=Date.now()+5*60*1000;try{const encoded=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const payload=JSON.parse(atob(encoded));if(Number.isFinite(payload.exp))expiresAt=payload.exp*1000;}catch{}
  nflIdentity={token,expiresAt};return token;
 })();nflIdentityPending=task;try{return await task;}finally{nflIdentityPending=null;}
}
export async function nflSourceAPI(request,catalog,fetcher=fetch,teamMap={}){
 if(request.method!=='GET')return nflJSON({error:'Use GET.'},405);
 const params=new URL(request.url).searchParams,id=params.get('id'),slug=params.get('slug');let clip=catalog.find(clip=>clip.id===id)||nflLiveCatalog?.clips.find(clip=>clip.id===id)||nflPageMetadata.get(id);
 // A different Worker isolate may not have discovered this clip. Revalidate
 // its public NFL page instead of depending on a previous request's memory.
 if(!clip&&/^[a-f\d-]{36}$/i.test(id||'')&&/^[-a-z\d]{1,240}$/i.test(slug||''))try{const url='https://www.nfl.com/videos/'+slug;clip=(await loadNFLPage(url,teamMap,fetcher)).find(c=>c.id===id&&c.url===url);}catch{}
 if(!clip&&/^[a-f\d-]{36}$/i.test(id||'')){try{clip=(await loadNFLLiveCatalog(teamMap,fetcher)).clips.find(clip=>clip.id===id);}catch{}}
 if(!clip||!/^\d+$/.test(clip.mcpID))return nflJSON({error:'Unknown NFL highlight.'},404);
 const cached=nflMediaCache.get(id);if(cached?.expiresAt>Date.now()+10000)return nflJSON(cached);
 if(!nflMediaPending.has(id))nflMediaPending.set(id,(async()=>{
  let response;
  for(let attempt=0;attempt<2;attempt++){
   const token=await nflAnonymousToken(fetcher,attempt>0);
   response=await fetcher('https://api.nfl.com/play/v1/asset/'+clip.mcpID,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({asset:{mcpID:clip.mcpID,id:clip.id,provider:'lura',videoSource:'nfl.com'},init:true,live:false}),credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(12000)});
   if(response.status!==401)break;
  }
  if(!response.ok)throw new Error('This NFL highlight is not available for anonymous playback.');
  const asset=await response.json(),url=nflMediaURL(asset.accessUrl);
  if(!url||asset.licenseUrl||asset.drm?.licenseUrl)throw new Error('This highlight requires its official player.');
  const record={id:clip.id,url,type:'application/vnd.apple.mpegurl',duration:Number(asset.metadata?.event?.duration)||clip.duration||0,expiresAt:Date.now()+4*60*1000,provider:'NFL.com'};
  nflMediaCache.set(id,record);return record;
 })().finally(()=>nflMediaPending.delete(id)));
 try{return nflJSON(await nflMediaPending.get(id));}catch(error){return nflJSON({id,error:error.name==='TimeoutError'?'NFL took too long to respond.':error.message,retryable:true},502);}
}
let nflLiveCatalog,nflLivePending;
const nflPageMetadata=new Map(),nflPageAttempts=new Map();
const nflText=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|quot|apos|lt|gt);/g,m=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[m])).replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/\s+/g,' ').trim();
function nflPublished(value){
 if(typeof value==='number'&&Number.isFinite(value)){const at=value<1e12?value*1000:value;return at>=946684800000&&at<=4102444800000?at:0;}
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value))return 0;
 const at=Date.parse(value);return Number.isFinite(at)?at:0;
}
function nflPageURL(value){try{const u=new URL(value,'https://www.nfl.com');return u.origin==='https://www.nfl.com'&&/^\/videos\/[-a-z\d]+$/i.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}}
function nflMetadata(page){
 const videos=[];
 const visit=(value,depth=0)=>{if(!value||depth>8)return;if(Array.isArray(value)){for(const v of value)visit(v,depth+1);return;}if(typeof value!=='object')return;if([value['@type']].flat().includes('VideoObject'))videos.push(value);for(const key of ['@graph','mainEntity','video'])visit(value[key],depth+1);};
 for(const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(/type=["']application\/ld\+json["']/i.test(m[1]))try{visit(JSON.parse(m[2]));}catch{}
 return videos;
}
function nflPageFields(page){
 const fields={};
 for(const m of page.matchAll(/<meta\b[^>]*>/gi)){
  const attrs=Object.fromEntries([...m[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(a=>[a[1].toLowerCase(),nflText(a[3])]));
  const key=(attrs.itemprop||attrs.property||attrs.name||'').toLowerCase();if(attrs.content)fields[key]=attrs.content;
 }
 return fields;
}
export function parseNFLCatalog(page,teamMap={},pageURL=''){
 const clips=new Map(),metadata=nflMetadata(page),fields=nflPageFields(page);
 for(const script of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/\bid=["']video-config-/.test(script[1]))continue;
  let data;try{data=JSON.parse(script[2]);}catch{continue;}
  for(const item of Array.isArray(data.playlist)?data.playlist:[]){
   if(!item||!/^[a-f\d-]{36}$/i.test(item.id||'')||!/^\d+$/.test(item.mcpID||'')||!/^[-a-z\d]+$/i.test(item.slug||''))continue;
   const tags=Array.isArray(item.tags)?item.tags.filter(t=>t&&typeof t==='object'):[],title=nflText(item.title||'NFL highlight').slice(0,250),url='https://www.nfl.com/videos/'+item.slug;
   const matches=metadata.filter(v=>nflPageURL(v.url||v['@id'])===url||!nflPageURL(v.url||v['@id'])&&nflText(v.name)===title),meta=matches.length===1?matches[0]:!matches.length&&url===pageURL&&metadata.length===1&&!nflPageURL(metadata[0].url||metadata[0]['@id'])?metadata[0]:null;
   const publishedAt=[item.publishedAt,item.publishDate,item.publishedDate,item.datePublished,item.uploadDate,meta?.uploadDate,meta?.datePublished,...(url===pageURL?[fields.uploaddate,fields.datepublished,fields['article:published_time']]:[])].map(nflPublished).find(Boolean)||0;
   const record={id:item.id,kind:'nfl',mcpID:String(item.mcpID),title,description:nflText(item.description||meta?.description||(url===pageURL?(fields['og:description']||fields.description):'')).slice(0,1200),publishedAt,url,
    teams:tags.filter(t=>t.teamId).map(t=>teamMap[t.title]).filter(Boolean),athletes:tags.filter(t=>t.personId).map(t=>nflText(t.title)).filter(Boolean),duration:Number(item.duration)||0,short:!/(?:highlights|best plays|best catches|best throws|every|all .*plays)/i.test(title)};
   if(Number.isInteger(item.season)&&item.season>=2018)record.season=item.season;
   if(Number.isInteger(item.week)&&item.week>=1&&item.week<=25)record.week=item.week;
   record.season??=Number(/\b(20\d{2})\s+NFL\s+season\b/i.exec(record.description)?.[1])||undefined;
   record.week??=Number(/\bWeek\s+(\d{1,2})\b/i.exec(record.title+' '+record.description)?.[1])||undefined;
   // Metadata belongs to its exact named video, never the entire related playlist.
   if(url===pageURL&&publishedAt){nflPageMetadata.set(record.id,record);if(nflPageMetadata.size>500)nflPageMetadata.delete(nflPageMetadata.keys().next().value);}
   clips.set(item.id,record);
  }
 }
 return [...clips.values()];
}
async function loadNFLPage(url,teamMap,fetcher){
 nflPageAttempts.set(url,Date.now()+300000);
 if(nflPageAttempts.size>500)nflPageAttempts.delete(nflPageAttempts.keys().next().value);
 const response=await fetcher(url,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('NFL highlights are temporarily unavailable.');
 return parseNFLCatalog(await response.text(),teamMap,url);
}
async function loadNFLLiveCatalog(teamMap={},fetcher=fetch){
 if(nflLiveCatalog?.expiresAt>Date.now())return nflLiveCatalog;
 if(nflLivePending)return nflLivePending;
 const task=(async()=>{
  const response=await fetcher('https://www.nfl.com/videos/channel/game-highlights-vc',{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('NFL highlights are temporarily unavailable.');
  const html=await response.text(),urls=[...new Set([...html.matchAll(/href=["']([^"']+)["']/g)].map(m=>nflPageURL(m[1])).filter(Boolean))].slice(0,100);
  let clips=parseNFLCatalog(html,teamMap);
  if(!clips.length){if(!urls.length)throw new Error('NFL did not publish a current highlight page.');clips=await loadNFLPage(urls[0],teamMap,fetcher);}
  const byId=new Map(clips.map(c=>[c.id,c]));
  for(const [id,c] of byId){const known=nflPageMetadata.get(id);if(!c.publishedAt&&known)byId.set(id,{...c,publishedAt:known.publishedAt,description:c.description||known.description});}
  // Bounded enrichment of actual scoring pages. Cold starts use at most eight
  // HTML requests; subsequent viewers share a one-minute isolate cache.
  const candidates=[...byId.values()].filter(c=>!c.publishedAt&&c.short&&/\btd\b|touchdown|\bfg\b|field.goal|safety|two.point/i.test(c.title)).map(c=>c.url);
  const pages=[...new Set([...candidates,...urls.filter(u=>/(?:-td-|touchdown|-fg-|field-goal|safety|two-point)/i.test(u))])].filter(u=>!(nflPageAttempts.get(u)>Date.now())).slice(0,6);
  for(const u of pages)nflPageAttempts.set(u,Date.now()+300000);
  const enriched=await Promise.allSettled(pages.map(u=>loadNFLPage(u,teamMap,fetcher)));
  for(const result of enriched)if(result.status==='fulfilled')for(const c of result.value){const old=byId.get(c.id);byId.set(c.id,{...old,...c,publishedAt:c.publishedAt||old?.publishedAt||0,description:c.description||old?.description||''});}
  clips=[...byId.values()].slice(0,160);if(!clips.length)throw new Error('NFL did not return a playable highlight catalog.');
  for(const cache of [nflPageMetadata,nflPageAttempts,nflMediaCache])while(cache.size>500)cache.delete(cache.keys().next().value);
  nflLiveCatalog={provider:'NFL.com',clips,expiresAt:Date.now()+60000};return nflLiveCatalog;
 })();nflLivePending=task;try{return await task;}finally{nflLivePending=null;}
}
export async function nflHighlightsAPI(request,teamMap,fetcher=fetch){
 if(request.method!=='GET')return nflJSON({error:'Use GET.'},405);
 try{return nflJSON(await loadNFLLiveCatalog(teamMap,fetcher));}catch(error){return nflJSON({error:error.message},502);}
}
