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
 const id=new URL(request.url).searchParams.get('id');let clip=catalog.find(clip=>clip.id===id)||nflLiveCatalog?.clips.find(clip=>clip.id===id);
 if(!clip&&/^[a-f\d-]{36}$/i.test(id||'')){try{clip=(await loadNFLLiveCatalog(teamMap,fetcher)).clips.find(clip=>clip.id===id);}catch{}}
 if(!clip||!/^\d+$/.test(clip.mcpID))return nflJSON({error:'Unknown NFL highlight.'},404);
 const cached=nflMediaCache.get(id);if(cached?.expiresAt>Date.now())return nflJSON(cached);
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
export function parseNFLCatalog(page,teamMap={}){
 const clips=new Map();
 for(const script of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/\bid=["']video-config-/.test(script[1]))continue;
  let data;try{data=JSON.parse(script[2]);}catch{continue;}
  for(const item of data.playlist||[]){
   if(!/^[a-f\d-]{36}$/i.test(item.id||'')||!/^\d+$/.test(item.mcpID||'')||!/^[-a-z\d]+$/i.test(item.slug||''))continue;
   const tags=item.tags||[];
   clips.set(item.id,{id:item.id,kind:'nfl',mcpID:String(item.mcpID),title:String(item.title||'NFL highlight').slice(0,250),url:'https://www.nfl.com/videos/'+item.slug,teams:tags.filter(t=>t.teamId).map(t=>teamMap[t.title]).filter(Boolean),athletes:tags.filter(t=>t.personId).map(t=>t.title),duration:Number(item.duration)||0,short:!/(?:highlights|best plays|every|all .*plays)/i.test(item.title||'')});
  }
 }
 return [...clips.values()];
}
async function loadNFLLiveCatalog(teamMap={},fetcher=fetch){
 if(nflLiveCatalog?.expiresAt>Date.now())return nflLiveCatalog;
 if(nflLivePending)return nflLivePending;
 const task=(async()=>{
  const options={credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(12000)};
  const channel=await fetcher('https://www.nfl.com/videos/channel/game-highlights-vc',options);if(!channel.ok)throw new Error('NFL highlights are temporarily unavailable.');
  const html=await channel.text();let clipURL;
  for(const match of html.matchAll(/href=["']([^"']+)["']/g)){try{const u=new URL(match[1],'https://www.nfl.com');if(u.origin==='https://www.nfl.com'&&/^\/videos\/[-a-z\d]+$/i.test(u.pathname)){clipURL=u.origin+u.pathname;break;}}catch{}}
  if(!clipURL)throw new Error('NFL did not publish a current highlight page.');
  const response=await fetcher(clipURL,{...options,signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('NFL highlights are temporarily unavailable.');
  const clips=parseNFLCatalog(await response.text(),teamMap);if(!clips.length)throw new Error('NFL did not return a playable highlight catalog.');
  nflLiveCatalog={provider:'NFL.com',clips,expiresAt:Date.now()+300000};return nflLiveCatalog;
 })();nflLivePending=task;try{return await task;}finally{nflLivePending=null;}
}
export async function nflHighlightsAPI(request,teamMap,fetcher=fetch){
 if(request.method!=='GET')return nflJSON({error:'Use GET.'},405);
 try{return nflJSON(await loadNFLLiveCatalog(teamMap,fetcher));}catch(error){return nflJSON({error:error.message},502);}
}
