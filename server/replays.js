// Full-game replays for the NBA, NHL and MLB rooms: a listing of recent games from
// the replay sites the owner chose, and the embedded players their game pages
// carry. Public pages only, on an allowlist; no video is proxied or decoded.
import {publicPlayerURL,decodeEmbedHTML} from '../web/stream-html.js';
const listingPages=(base,count)=>Array.from({length:count},(_,i)=>i?`${base}?page${i+1}`:base);
// One network runs these sites, and each one's game pages reach an ok.ru player, the one kind we can play and drive.
const REPLAY_SITES={nba:{host:'basketball-video.com',home:'https://basketball-video.com/',only:/-nba-/,pages:listingPages('https://basketball-video.com/2026-27',6)},nhl:{host:'hockeyreplays.com',home:'https://hockeyreplays.com/',pages:listingPages('https://hockeyreplays.com/',5)},mlb:{host:'mlblive.net',home:'https://mlblive.net/',pages:listingPages('https://mlblive.net/',3)}};
const NFL_REPLAY_HOST='nfl-video.com',NFL_REPLAY_MAX_PAGE=20,nflListingPage=n=>n===1?'https://nfl-video.com/2026':'https://nfl-video.com/2026?page'+n;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const replayCache=new Map(),replayPending=new Map();
const replayJSON=(data,status=200,life=0)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':life?'private, max-age='+life:'no-store','X-Content-Type-Options':'nosniff'}});
async function replayText(url,host,fetcher){
 for(let hop=0;hop<3;hop++){
  const u=new URL(url);if(u.hostname!==host||u.protocol!=='https:'||u.port&&u.port!=='443')throw new Error('Unsupported replay site.');
  const response=await fetcher(u.href,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});
  if(response.status>=300&&response.status<400){const next=new URL(response.headers.get('Location')||'',u);if(next.hostname!==host)throw new Error('The replay site moved.');url=next.href;continue;}
  if(!response.ok)throw new Error('Replay site unavailable ('+response.status+').');
  if(Number(response.headers.get('Content-Length'))>900000)throw new Error('Replay page too large.');
  const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>900000)throw new Error('Replay page too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
 }
 throw new Error('Too many redirects.');
}
async function cachedReplay(key,fetcher,life,loader){
 if(fetcher!==fetch)return loader();const now=Date.now(),hit=replayCache.get(key);if(hit&&hit.until>now)return hit.value;if(replayPending.has(key))return replayPending.get(key);
 const task=loader().then(value=>{if(replayCache.size>=256)replayCache.delete(replayCache.keys().next().value);replayCache.set(key,{until:Date.now()+life(value)*1000,value});return value;}).finally(()=>replayPending.delete(key));replayPending.set(key,task);return task;
}
// Seconds an answer may be reused. Anything short of a full answer is asked again soon, so a failure or a video not posted yet does not stick.
// The newest listed week may still be missing a game the listing has not posted at all (Monday night's), however many it has.
const nflWeekLife=(games,newest=false)=>!games.length?60:games.some(g=>!g.embed)?300:newest||games.length<13?900:21600;
const replayListLife=games=>games.length?900:60;
const replayPageLife=sources=>sources.length?1800:60;
const edgeLife=(path,status,data)=>status>=500?30:status!==200&&status!==404?0:path==='/api/nfl-replays'?nflWeekLife(data.games||[],data.newest):path==='/api/replays'?(data.note?3600:replayListLife(data.games||[])):replayPageLife(data.sources||[]);
// Cloudflare's shared cache in front of the slow public replay routes, so one cold isolate's walk of the replay sites serves every later visitor.
// A no-op where caches.default is absent (tests, check-build, the local preview). The key holds only the named parameters and no headers,
// and a request carrying credentials skips the cache altogether. Browsers get what the route says, never the shared lifetime; X-Edge-Cache tells a hit from a miss.
export async function edgeCached(request,ctx,params,handler){
 const cache=typeof caches==='undefined'?null:caches.default;
 if(!cache||request.method!=='GET'||request.headers.has('Authorization')||request.headers.has('Cookie'))return handler();
 const url=new URL(request.url),query=new URLSearchParams();for(const name of params)if(url.searchParams.has(name))query.set(name,url.searchParams.get(name));
 const key=new Request(url.origin+url.pathname+'?'+query),hit=await cache.match(key).catch(()=>null);
 if(hit){const headers=new Headers(hit.headers);headers.set('Cache-Control',hit.headers.get('X-Browser-Cache')||'no-store');headers.delete('X-Browser-Cache');headers.set('X-Edge-Cache','hit');return new Response(hit.body,{status:hit.status,headers});}
 const response=await handler(),body=await response.clone().text();let life=0;try{life=edgeLife(url.pathname,response.status,JSON.parse(body));}catch{}
 if(life&&!response.headers.has('Set-Cookie')){const headers=new Headers(response.headers);headers.set('X-Browser-Cache',response.headers.get('Cache-Control')||'no-store');headers.set('Cache-Control','public, max-age='+life);const stored=cache.put(key,new Response(body,{status:response.status,headers})).catch(()=>{});if(ctx?.waitUntil)ctx.waitUntil(stored);else await stored;}
 response.headers.set('X-Edge-Cache','miss');return response;
}
// "Phoenix Suns vs. Golden State Warriors - NBA Regular Season - Full Game Replay - 2 November 2026"
// "Milwaukee Brewers @ Tampa Bay Rays - MLB Full Game Replay - World Series Game 5 - October 28, 2026"
export function parseReplayListing(html,sport){
 const site=REPLAY_SITES[sport];if(!site)return [];
 const games=[],seen=new Set();
 for(const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi)){
  const href=decodeEmbedHTML(m[1]),text=decodeEmbedHTML(m[2].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
  if(!/full-game-replay/i.test(href)||!text||text.length<12||site.only&&!site.only.test(href))continue;
  const url=publicPlayerURL(href,site.home);if(!url||new URL(url).hostname!==site.host||seen.has(url))continue;
  const slug=new URL(url).pathname.replace(/^\/+|\/+$/g,'');
  const dateMatch=/-([a-z]+)-(\d{1,2})-(\d{4})-*$/i.exec(slug),month=dateMatch?MONTHS.indexOf(dateMatch[1].toLowerCase()):-1;
  if(month<0)continue;
  const date=new Date(Date.UTC(Number(dateMatch[3]),month,Number(dateMatch[2]),17));
  const teams=/^(.+?)\s+(?:vs\.?|@|at)\s+(.+?)\s+-\s/i.exec(text);
  if(!teams)continue;
  const context=text.split(' - ').slice(1,-1).filter(part=>!/full game replay/i.test(part)).join(' · ');
  seen.add(url);games.push({id:slug.slice(0,120),sport,away:teams[1].trim().slice(0,60),home:teams[2].trim().slice(0,60),title:text.slice(0,160),context:context.slice(0,80),date:date.toISOString(),page:url});
 }
 return games.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.id.localeCompare(b.id)).slice(0,160);
}
// The players a game page embeds: ok.ru first (it can be driven), then any other player frame.
export function parseReplayPlayers(html,page){
 const out=[],seen=new Set();
 for(const m of html.matchAll(/<iframe\b([^>]+)>/gi)){
  const attrs=m[1],src=/\bsrc\s*=\s*(["'])(.*?)\1/i.exec(attrs)?.[2]||/\bdata-src\s*=\s*(["'])(.*?)\1/i.exec(attrs)?.[2];if(!src)continue;
  const url=publicPlayerURL(decodeEmbedHTML(src).replace(/^\/\//,'https://'),page);if(!url||seen.has(url))continue;
  const host=new URL(url).hostname;if(/doubleclick|googlesyndication|adservice|facebook|twitter|disqus/i.test(host))continue;
  seen.add(url);
  if(/^ok\.ru$/.test(host)&&/^\/videoembed\/\d+$/.test(new URL(url).pathname))out.push({url,provider:'OK',type:'provider/ok'});
  else if(/\/(?:e|embed|player|v)\//i.test(new URL(url).pathname))out.push({url,provider:host.replace(/^www\./,''),type:'embed/page'});
 }
 return [...out.filter(s=>s.type==='provider/ok'),...out.filter(s=>s.type!=='provider/ok')].slice(0,5);
}
// A game's players, ok.ru first: the page's own frames, its links, then the pages its Watch buttons open.
export async function replaySourcesFrom(html,page,fetcher=fetch){
 const sources=parseReplayPlayers(html,page.href),add=list=>{for(const s of list)if(!sources.some(x=>x.url===s.url))sources.push(s);};
 const okSource=url=>({url,provider:'OK',type:'provider/ok'}),direct=okEmbedIn(html);if(direct)add([okSource(direct)]);
 if(!sources.some(s=>s.type==='provider/ok'))for(const found of await Promise.all(parseWatchLinks(html,page.hostname).map(async link=>{try{const r=await fetcher(link,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});if(!r.ok)return [];const text=(await r.text()).slice(0,400000),ok=okEmbedIn(text);return [...(ok?[okSource(ok)]:[]),...parseReplayPlayers(text,link)];}catch{return [];}})))add(found);   // in the page's order: its first server is the full game
 return [...sources.filter(s=>s.type==='provider/ok'),...sources.filter(s=>s.type!=='provider/ok')].slice(0,5);
}
export async function replayCatalogAPI(request,fetcher=fetch){
 if(request.method!=='GET')return replayJSON({error:'Use GET.'},405);
 const sport=new URL(request.url).searchParams.get('sport');
 const site=REPLAY_SITES[sport];if(!site)return replayJSON({error:'Choose a supported sport.'},400);
 try{const games=await cachedReplay('replays:'+sport,fetcher,replayListLife,async()=>{const pages=await Promise.allSettled(site.pages.map(url=>replayText(url,site.host,fetcher)));const html=pages.filter(p=>p.status==='fulfilled').map(p=>p.value).join('\n');if(!html)throw new Error(pages[0].reason?.message||'unavailable');return parseReplayListing(html,sport);});return replayJSON({sport,games,fetchedAt:Date.now()});}
 catch(error){return replayJSON({sport,games:[],error:'Replays are unavailable right now. '+(error.message||'')},502);}
}
export async function replayResolveAPI(request,fetcher=fetch){
 if(request.method!=='GET')return replayJSON({error:'Use GET.'},405);
 const input=new URL(request.url).searchParams.get('url')||'';let page;
 try{page=new URL(input);if(input.length>2048||page.protocol!=='https:'||!Object.values(REPLAY_SITES).some(s=>s.host===page.hostname))throw new Error();}catch{return replayJSON({error:'Use a replay page from a supported site.'},400);}
 try{const sources=await cachedReplay('replay-page:'+page.href,fetcher,replayPageLife,async()=>replaySourcesFrom(await replayText(page.href,page.hostname,fetcher),page,fetcher));if(!sources.length)return replayJSON({page:page.href,sources:[],error:'No video found on that page.'},404);return replayJSON({page:page.href,sources,resolvedAt:Date.now()});}
 catch(error){return replayJSON({page:page.href,sources:[],error:'Could not read that replay page. '+(error.message||'')},502);}
}

// NFL full-game replays for one week: the listing names the game pages, each
// game page links a Watch page, and that page embeds the ok.ru player.
export function parseNFLReplayListing(html,week){
 const out=[],seen=new Set(),want=String(week).padStart(2,'0');
 for(const m of html.matchAll(/href="(?:https:\/\/nfl-video\.com)?(\/([a-z0-9-]+)-vs-([a-z0-9-]+)-full-game-replay-nfl-week-(\d{2})-[a-z0-9-]+)"/gi)){
  const [,path,away,home,w]=m;if(w!==want||seen.has(path))continue;seen.add(path);
  out.push({slug:path.slice(1),away,home,page:'https://nfl-video.com'+path});
 }
 return out;
}
// The Watch buttons on a game page. A page with a player block keeps them there; the others carry them in the article.
export function parseWatchLinks(html,host=NFL_REPLAY_HOST){
 const block=/id="video-player"[\s\S]{0,8000}/.exec(html)?.[0]||html;
 // Each button's label sits between it and the button before; a condensed game or highlights is not the replay.
 const links=[];let last=0;for(const m of block.matchAll(/<a\b[^>]*href="((?:https:)?\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){const text=m[2].replace(/<[^>]+>/g,' ').trim(),label=block.slice(last,m.index).replace(/<[^>]+>/g,' ');last=m.index+m[0].length;if(/^watch\b/i.test(text)&&!/condensed|highlight/i.test(label))links.push(decodeEmbedHTML(m[1]).replace(/^\/\//,'https://'));}
 return [...new Set(links)].filter(u=>{try{const h=new URL(u).hostname;return h!==host&&!/\.(local|test|internal)$/.test(h);}catch{return false;}}).slice(0,4);
}
export const okEmbedIn=html=>{const m=/ok\.ru\/videoembed\/(\d{6,20})/.exec(html||'');return m?`https://ok.ru/videoembed/${m[1]}`:'';};
export async function nflReplayWeekAPI(request,fetcher=fetch){
 if(request.method!=='GET')return replayJSON({error:'Use GET.'},405);
 const week=Number(new URL(request.url).searchParams.get('week'));
 if(!Number.isInteger(week)||week<1||week>18)return replayJSON({error:'Choose a week.'},400);
 try{
  const {games,newest}=await cachedReplay('nfl-week:'+week,fetcher,value=>nflWeekLife(value.games,value.newest),async()=>{
   // The listing runs newest first, about 1.3 pages a week, and every page's sidebar links a few older games.
   // So only the week most of a page is about says where the walk has reached; any one old link says nothing.
   let found=[],newest=false,start=0;
   for(let n=1;n<=NFL_REPLAY_MAX_PAGE;){
    let html;try{html=await replayText(nflListingPage(n),NFL_REPLAY_HOST,fetcher);}catch(error){if(n===1)throw error;break;}
    const here=parseNFLReplayListing(html,week),counts=new Map();for(const m of html.matchAll(/nfl-week-(\d{2})-/g))counts.set(Number(m[1]),(counts.get(Number(m[1]))||0)+1);
    if(!counts.size)break;
    const main=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
    if(n===1)newest=Math.max(...counts.keys())<=week;
    // A jump that landed past the week goes back and walks from the top.
    if(n===start&&main<week&&!here.length){start=0;n=2;continue;}
    found=found.concat(here);
    if(main<week||n>1&&found.length&&!here.length)break;
    // Skip the pages that cannot hold this week: a Worker gets a limited number of requests per visit.
    if(n===1&&main-week>1){start=Math.max(2,Math.floor(1+(main-week)*1.1));n=start;}else n++;
   }
   const unique=[...new Map(found.map(g=>[g.slug,g])).values()].slice(0,18),out=[];
   for(let i=0;i<unique.length;i+=4)await Promise.all(unique.slice(i,i+4).map(async g=>{
    let embed='';
    try{const page=await replayText(g.page,NFL_REPLAY_HOST,fetcher);embed=okEmbedIn(page);
     if(!embed)for(const link of parseWatchLinks(page)){try{const u=new URL(link);const r=await fetcher(u.href,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});if(!r.ok)continue;const text=(await r.text()).slice(0,400000);embed=okEmbedIn(text);if(embed)break;}catch{}}
    }catch{}
    out.push({...g,embed});
   }));
   return {games:out,newest};
  });
  return replayJSON({week,games,newest,fetchedAt:Date.now()},200,nflWeekLife(games,newest));
 }catch(error){return replayJSON({week,games:[],error:'The replay listing is unavailable right now. '+(error.message||'')},502);}
}
