// Resolve only the public replay pages already present in the week catalog.
// No cookie forwarding, arbitrary URL proxy, media download, or signature rewriting.
const replaySourceCache=new Map();
const replaySourcePending=new Map();
function mediaJSON(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function decodeAttribute(value){return value.replace(/&(#x[\da-f]+|#\d+|quot|apos|amp|lt|gt);/gi,(_,entity)=>{const key=entity.toLowerCase();if(key.startsWith('#x'))return String.fromCodePoint(parseInt(key.slice(2),16));if(key.startsWith('#'))return String.fromCodePoint(Number(key.slice(1)));return {quot:'"',apos:"'",amp:'&',lt:'<',gt:'>'}[key];});}
export function publicReplayURL(value){
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(!['vkuser.net','okcdn.ru','mycdn.me'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))return null;
  return value; // Keep the supplied signature/query byte-for-byte.
 }catch{return null;}
}
export function parseReplayMetadata(page,now=Date.now()){
 for(const match of page.matchAll(/\bdata-options\s*=\s*(["'])(.*?)\1/gs)){
  let metadata;try{const options=JSON.parse(decodeAttribute(match[2]));metadata=options.flashvars?.metadata;if(typeof metadata==='string')metadata=JSON.parse(metadata);}catch{continue;}
  if(!metadata?.videos?.length)continue;
  const duration=Number(metadata.movie?.duration);
  const sources=metadata.videos.map(video=>({quality:String(video.name),url:publicReplayURL(video.url),type:'video/mp4'})).filter(source=>source.url);
  if(!sources.length)continue;
  const expirations=sources.map(s=>Number(new URL(s.url).searchParams.get('expires'))).filter(Number.isFinite).filter(t=>t>0).map(t=>t<1e12?t*1000:t);
  const expiresAt=Math.min(now+5*60*1000,...expirations.map(t=>t-60000));
  if(expiresAt<=now)throw new Error('The provider returned expired sources.');
  return {duration:Number.isFinite(duration)?duration:0,sources,expiresAt,provider:'OK',sync:'uncalibrated'};
 }
 throw new Error('The public replay player did not provide a playable source.');
}
export async function replaySourceAPI(request,catalog,fetcher=fetch,now=Date.now()){
 if(request.method!=='GET')return mediaJSON({error:'Use GET.'},405);
 const id=new URL(request.url).searchParams.get('id');const game=catalog.find(game=>game.id===id);
 if(!game||!/^https:\/\/ok\.ru\/videoembed\/\d+$/.test(game.embed))return mediaJSON({error:'Unknown replay.'},404);
 const cached=replaySourceCache.get(id);if(cached?.expiresAt>now&&new URL(request.url).searchParams.get('refresh')!=='1')return mediaJSON(cached);
 let pending=replaySourcePending.get(id);
 if(!pending){pending=(async()=>{
  const response=await fetcher(game.embed,{headers:{Accept:'text/html'},credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('The replay provider is unavailable.');
  const page=await response.text();if(page.length>2500000)throw new Error('The provider returned an unexpected response.');
  const metadata=parseReplayMetadata(page,now);const result={id:game.id,name:game.name,page:game.page,...metadata};replaySourceCache.set(id,result);return result;
 })().finally(()=>replaySourcePending.delete(id));replaySourcePending.set(id,pending);}
 try{return mediaJSON(await pending);}catch(error){return mediaJSON({id,error:error.name==='TimeoutError'?'The replay provider took too long.':error.message,retryable:true},502);}
}
