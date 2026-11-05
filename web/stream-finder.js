import {safeVideo,streamType} from './roster.js';
import {publicPlayerURL,embeddedPlayerFromHTML,boundedStreamText} from './stream-html.js';
const words=s=>String(s||'').toLowerCase().replace(/\bla\b/g,'los angeles').replace(/\bn\.y\.\b/g,'new york').replace(/[^a-z0-9]+/g,' ').trim();
export function matchStream(game,entries,sport){
 const start=Date.parse(game.date);if(!Number.isFinite(start)||game.teams?.length!==2)return null;
 const names=game.teams.map(t=>words(t.name||t.displayName));if(names.some(n=>!n||n.length<5))return null;
 const matches=entries.filter(e=>e&&Array.isArray(e.sources)&&e.sources.length&&e.sport===sport&&Number.isFinite(e.start)&&Math.abs(e.start-start)<=90*60000&&names.every(n=>(' '+words(e.title)+' ').includes(' '+n+' ')));
 return matches.length===1?matches[0]:null;
}
const providerPage=url=>['ntv.st','streamcorner.st'].includes(new URL(url).hostname);
export function needsPlayerResolution(url){try{const u=new URL(url);return streamType(url)==='embed/page'&&!/\/(?:embed|player|videoembed)(?:[/.]|$)/i.test(u.pathname);}catch{return false;}}
export class StreamFinder{
 constructor({fetcher=fetch,now=()=>Date.now()}={}){this.fetcher=fetcher;this.now=now;this.matches=new Map();this.resolved=new Map();this.catalogs=new Map();this.generation=0;this.status='';this.enabled=true;this.pending=false;this.resolving=new Map();}
 cancel(){this.generation++;this.pending=false;this.matches.clear();}
 playable(url){try{url=safeVideo(url);}catch{return null;}if(!url)return null;if(!needsPlayerResolution(url))return url;return this.resolved.get(url)?.url||null;}
 options(game){return this.matches.get(String(game.id))?.options||[];}
 urls(game,manual=[],preference='custom'){
  const match=this.enabled?this.matches.get(String(game.id)):null;
  const auto=preference==='NTV'||preference==='StreamCorner'?(match?.options||[]).filter(x=>x.provider===preference).map(x=>x.url):match?.sources||[];
  const chosen=preference!=='custom'?auto:manual[0]&&manual[1]?manual:[manual[0],manual[1],...auto];
  // Don't silently promote an automatic source while the custom primary is being inspected.
  if(preference==='custom'&&manual[0]&&!this.playable(manual[0]))return [];
  return [...new Set(chosen.filter(Boolean).map(u=>this.playable(u)).filter(Boolean))];
 }
 original(url){for(const [page,value] of this.resolved)if(value.url===url)return page;return url;}
 async resolve(page){
  if(!page)return null;if(!needsPlayerResolution(page))return this.playable(page);
  if(this.resolving.has(page))return this.resolving.get(page);
  const request=this.resolveOnce(page).finally(()=>this.resolving.delete(page));this.resolving.set(page,request);return request;
 }
 async resolveOnce(page){
  if(this.resolved.size>=256&&!this.resolved.has(page))this.resolved.delete(this.resolved.keys().next().value);
  const cached=this.resolved.get(page);if(cached&&cached.until>this.now())return cached.url;
  try{
   let url;
   if(providerPage(page)){
    const response=await this.fetcher('/api/streams/resolve?url='+encodeURIComponent(page),{signal:AbortSignal.timeout(12000),cache:'no-store'}),data=await response.json();
    if(!response.ok||data.page!==page)throw new Error();url=safeVideo(data.url);if(!url||url===page)throw new Error();
   }else{
    // Generic pages are inspected in the visitor's browser under normal CORS rules.
    // They never become arbitrary upstream fetches on our Worker and receive no cookies.
    if(!publicPlayerURL(page))throw new Error();
    const response=await this.fetcher(page,{mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error();url=embeddedPlayerFromHTML(await boundedStreamText(response),page);if(!url)throw new Error();
   }
   this.resolved.set(page,{url,kind:streamType(url)==='embed/page'?'player':'video',until:this.now()+90000});return url;
  }catch{
   // Extraction is best effort; an unavailable catalog must not defeat an explicit URL.
   let url;try{url=cached?.url||safeVideo(page);}catch{return null;}
   this.resolved.set(page,{url,kind:cached?.kind||'page',until:this.now()+30000});return url;
  }
 }
 async refresh(games,sport,manual=[]){
  if(this.pending)return false;const generation=++this.generation;this.pending=true;
  const savedPages=[...new Set(manual.filter(needsPlayerResolution))].slice(0,48);
  const resolvePages=async pages=>{for(let i=0;i<pages.length;i+=6){await Promise.allSettled(pages.slice(i,i+6).map(page=>this.resolve(page)));if(generation!==this.generation)return false;}return true;};
  try{
   if(!await resolvePages(savedPages))return false;
   let entries=[],providers=[];
   if(this.enabled){let catalog=this.catalogs.get(sport);if(!catalog||catalog.until<=this.now()){
    const r=await this.fetcher('/api/streams?sport='+sport,{signal:AbortSignal.timeout(12000),cache:'no-store'}),data=await r.json();if(!r.ok||data.sport!==sport||!Array.isArray(data.entries))throw new Error('Automatic lookup unavailable');catalog={entries:data.entries,providers:data.providers||[],until:this.now()+90000};this.catalogs.set(sport,catalog);
   }entries=catalog.entries;providers=catalog.providers||[];}
   const next=new Map();for(const g of games){if(g.state==='post')continue;
    const matches=[...new Set(entries.filter(Boolean).map(e=>e.provider||'NTV'))].map(provider=>matchStream(g,entries.filter(e=>(e?.provider||'NTV')===provider),sport)).filter(Boolean);
    if(matches.length)next.set(String(g.id),{sources:matches.flatMap(e=>e.sources.slice(0,2)),options:matches.flatMap(e=>e.sources.slice(0,2).map(url=>({provider:e.provider||'NTV',url})))});
   }
   if(!await resolvePages([...new Set([...next.values()].flatMap(e=>e.sources).filter(needsPlayerResolution))].slice(0,48)))return false;
   if(generation!==this.generation)return false;this.matches=next;
   const count=games.filter(g=>this.urls(g).length).length,fallback=manual.some(url=>this.resolved.get(url)?.kind==='page');
   this.status=this.enabled?(count?'Streams found for '+count+' game'+(count===1?'':'s')+'.':'No exact automatic matches yet.'):'Automatic lookup is off.';
   if(providers.some(p=>p.name==='StreamCorner'&&!p.available))this.status+=' StreamCorner is unavailable; you can still add its game link.';
   if(fallback)this.status+=' A custom link uses its webpage because no accessible player was found.';
   return true;
  }catch{if(generation===this.generation)this.status='Automatic stream lookup is unavailable. Retrying; your links are kept.';return false;}
  finally{if(generation===this.generation)this.pending=false;}
 }
}
