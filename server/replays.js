// Full-game replays for the NBA and MLB rooms: a listing of recent games from
// the replay sites the owner chose, and the embedded players their game pages
// carry. Public pages only, on an allowlist; no video is proxied or decoded.
import {publicPlayerURL,decodeEmbedHTML} from '../web/stream-html.js';
const REPLAY_SITES={nba:{host:'basketballreplays.net',home:'https://basketballreplays.net/',pages:['https://basketballreplays.net/','https://basketballreplays.net/?page2','https://basketballreplays.net/?page3']},mlb:{host:'mlblive.net',home:'https://mlblive.net/',pages:['https://mlblive.net/','https://mlblive.net/?page2','https://mlblive.net/?page3']}};
const NFL_REPLAY_HOST='nfl-video.com',NFL_REPLAY_PAGES=['https://nfl-video.com/2026','https://nfl-video.com/2026?page2','https://nfl-video.com/2026?page3','https://nfl-video.com/2026?page4','https://nfl-video.com/2026?page5','https://nfl-video.com/2026?page6'];
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const replayCache=new Map(),replayPending=new Map();
const replayJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
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
async function cachedReplay(key,fetcher,ttl,loader){
 if(fetcher!==fetch)return loader();const now=Date.now(),hit=replayCache.get(key);if(hit&&hit.until>now)return hit.value;if(replayPending.has(key))return replayPending.get(key);
 const task=loader().then(value=>{if(replayCache.size>=256)replayCache.delete(replayCache.keys().next().value);replayCache.set(key,{until:Date.now()+ttl,value});return value;}).finally(()=>replayPending.delete(key));replayPending.set(key,task);return task;
}
// "Phoenix Suns vs. Golden State Warriors - NBA Regular Season - Full Game Replay - 2 November 2026"
// "Milwaukee Brewers @ Tampa Bay Rays - MLB Full Game Replay - World Series Game 5 - October 28, 2026"
export function parseReplayListing(html,sport){
 const site=REPLAY_SITES[sport];if(!site)return [];
 const games=[],seen=new Set();
 for(const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi)){
  const href=decodeEmbedHTML(m[1]),text=decodeEmbedHTML(m[2].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
  if(!/full-game-replay/i.test(href)||!text||text.length<12)continue;
  const url=publicPlayerURL(href,site.home);if(!url||new URL(url).hostname!==site.host||seen.has(url))continue;
  const slug=new URL(url).pathname.replace(/^\/+|\/+$/g,'');
  const dateMatch=/-([a-z]+)-(\d{1,2})-(\d{4})$/i.exec(slug),month=dateMatch?MONTHS.indexOf(dateMatch[1].toLowerCase()):-1;
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
export async function replayCatalogAPI(request,fetcher=fetch){
 if(request.method!=='GET')return replayJSON({error:'Use GET.'},405);
 const sport=new URL(request.url).searchParams.get('sport');
 if(sport==='nhl')return replayJSON({sport,games:[],note:'No replay source for the NHL yet.'});
 const site=REPLAY_SITES[sport];if(!site)return replayJSON({error:'Choose a supported sport.'},400);
 try{const games=await cachedReplay('replays:'+sport,fetcher,900000,async()=>{const pages=await Promise.allSettled(site.pages.map(url=>replayText(url,site.host,fetcher)));const html=pages.filter(p=>p.status==='fulfilled').map(p=>p.value).join('\n');if(!html)throw new Error(pages[0].reason?.message||'unavailable');return parseReplayListing(html,sport);});return replayJSON({sport,games,fetchedAt:Date.now()});}
 catch(error){return replayJSON({sport,games:[],error:'Replays are unavailable right now. '+(error.message||'')},502);}
}
export async function replayResolveAPI(request,fetcher=fetch){
 if(request.method!=='GET')return replayJSON({error:'Use GET.'},405);
 const input=new URL(request.url).searchParams.get('url')||'';let page;
 try{page=new URL(input);if(input.length>2048||page.protocol!=='https:'||!Object.values(REPLAY_SITES).some(s=>s.host===page.hostname))throw new Error();}catch{return replayJSON({error:'Use a replay page from a supported site.'},400);}
 try{const sources=await cachedReplay('replay-page:'+page.href,fetcher,1800000,async()=>parseReplayPlayers(await replayText(page.href,page.hostname,fetcher),page.href));if(!sources.length)return replayJSON({page:page.href,sources:[],error:'That page has no player we can embed.'},404);return replayJSON({page:page.href,sources,resolvedAt:Date.now()});}
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
export function parseWatchLinks(html){
 const block=/id="video-player"[\s\S]{0,8000}/.exec(html)?.[0]||'';
 const links=[];for(const m of block.matchAll(/<a\b[^>]*href="(https:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){const text=m[2].replace(/<[^>]+>/g,' ').trim();if(/watch/i.test(text))links.push(decodeEmbedHTML(m[1]));}
 return links.filter(u=>{try{const h=new URL(u).hostname;return h!==NFL_REPLAY_HOST&&!/\.(local|test|internal)$/.test(h);}catch{return false;}}).slice(0,3);
}
export const okEmbedIn=html=>{const m=/ok\.ru\/videoembed\/(\d{6,20})/.exec(html||'');return m?`https://ok.ru/videoembed/${m[1]}`:'';};
export async function nflReplayWeekAPI(request,fetcher=fetch){
 if(request.method!=='GET')return replayJSON({error:'Use GET.'},405);
 const week=Number(new URL(request.url).searchParams.get('week'));
 if(!Number.isInteger(week)||week<1||week>18)return replayJSON({error:'Choose a week.'},400);
 try{
  const games=await cachedReplay('nfl-week:'+week,fetcher,43200000,async()=>{
   let found=[];
   // Later listing pages are a bonus: one that fails ends the walk with what the earlier pages gave.
   for(const url of NFL_REPLAY_PAGES){let html;try{html=await replayText(url,NFL_REPLAY_HOST,fetcher);}catch(error){if(url===NFL_REPLAY_PAGES[0])throw error;break;}found=found.concat(parseNFLReplayListing(html,week));const weeks=[...html.matchAll(/nfl-week-(\d{2})-/g)].map(m=>Number(m[1]));if(weeks.length&&Math.min(...weeks)<week)break;}
   const unique=[...new Map(found.map(g=>[g.slug,g])).values()].slice(0,18),out=[];
   for(let i=0;i<unique.length;i+=4)await Promise.all(unique.slice(i,i+4).map(async g=>{
    let embed='';
    try{const page=await replayText(g.page,NFL_REPLAY_HOST,fetcher);embed=okEmbedIn(page);
     if(!embed)for(const link of parseWatchLinks(page)){try{const u=new URL(link);const r=await fetcher(u.href,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});if(!r.ok)continue;const text=(await r.text()).slice(0,400000);embed=okEmbedIn(text);if(embed)break;}catch{}}
    }catch{}
    out.push({...g,embed});
   }));
   return out;
  });
  return replayJSON({week,games,fetchedAt:Date.now()});
 }catch(error){return replayJSON({week,games:[],error:'The replay listing is unavailable right now. '+(error.message||'')},502);}
}
