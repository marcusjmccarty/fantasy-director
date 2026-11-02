import {safeVideo} from './roster.js';
const words=s=>String(s||'').toLowerCase().replace(/\bla\b/g,'los angeles').replace(/\bn\.y\.\b/g,'new york').replace(/[^a-z0-9]+/g,' ').trim();
export function matchStream(game,entries,sport){
 const start=Date.parse(game.date);if(!Number.isFinite(start)||game.teams?.length!==2)return null;
 const names=game.teams.map(t=>words(t.name||t.displayName));if(names.some(n=>!n||n.length<5))return null;
 const matches=entries.filter(e=>e&&Array.isArray(e.sources)&&e.sources.length&&e.sport===sport&&Number.isFinite(e.start)&&Math.abs(e.start-start)<=90*60000&&names.every(n=>(' '+words(e.title)+' ').includes(' '+n+' ')));
 // Avoid the wrong team, repeated fixture or doubleheader. Uncertain means manual setup.
 return matches.length===1?matches[0]:null;
}
export function needsPlayerResolution(url){try{const u=new URL(url);return (u.hostname==='ntv.st'||u.hostname==='streamcorner.st')&&!/\/(?:embed|player)(?:\/|$)/i.test(u.pathname);}catch{return false;}}
export class StreamFinder{
 constructor({fetcher=fetch,now=()=>Date.now()}={}){this.fetcher=fetcher;this.now=now;this.matches=new Map();this.resolved=new Map();this.catalogs=new Map();this.generation=0;this.status='';this.enabled=true;this.pending=false;this.resolving=new Map();}
 cancel(){this.generation++;this.pending=false;this.matches.clear();}
 playable(url){try{url=safeVideo(url);}catch{return null;}if(!url)return null;if(!needsPlayerResolution(url))return url;const item=this.resolved.get(url);return item?.url||null;}
 urls(game,manual=[]){const auto=this.enabled?this.matches.get(String(game.id))?.sources||[]:[];return [...new Set([manual[0]||auto[0],manual[1]||auto.find(u=>u!==manual[0]&&u!==(manual[0]||auto[0]))].filter(Boolean).map(u=>this.playable(u)).filter(Boolean))];}
 original(url){for(const [page,value] of this.resolved)if(value.url===url)return page;return url;}
 async resolve(page){
  if(this.resolving.has(page))return this.resolving.get(page);
  const request=this.resolveOnce(page).finally(()=>this.resolving.delete(page));this.resolving.set(page,request);return request;
 }
 async resolveOnce(page){
  if(this.resolved.size>=256&&!this.resolved.has(page))this.resolved.delete(this.resolved.keys().next().value);
  const cached=this.resolved.get(page);if(cached&&cached.until>this.now())return cached.url;
  try{const response=await this.fetcher('/api/streams/resolve?url='+encodeURIComponent(page),{signal:AbortSignal.timeout(12000),cache:'no-store'}),data=await response.json();if(!response.ok||data.page!==page)throw new Error();const url=safeVideo(data.url);if(!url||needsPlayerResolution(url))throw new Error();this.resolved.set(page,{url,until:this.now()+90000});return url;}
  catch{this.resolved.set(page,{url:cached?.url||null,until:this.now()+30000});return cached?.url||null;}
 }
 async refresh(games,sport,manual=[]){
  if(this.pending)return false;const generation=++this.generation;this.pending=true;
  try{
   let entries=[];if(this.enabled){let catalog=this.catalogs.get(sport);if(!catalog||catalog.until<=this.now()){const r=await this.fetcher('/api/streams?sport='+sport,{signal:AbortSignal.timeout(12000),cache:'no-store'}),data=await r.json();if(!r.ok||data.sport!==sport||!Array.isArray(data.entries))throw new Error('Automatic lookup unavailable');catalog={entries:data.entries,until:this.now()+90000};this.catalogs.set(sport,catalog);}entries=catalog.entries;}
   const next=new Map();for(const g of games){if(g.state==='post')continue;const match=matchStream(g,entries,sport);if(match)next.set(String(g.id),match);}
   const pages=[...new Set([...manual,...[...next.values()].flatMap(e=>e.sources.slice(0,2))].filter(needsPlayerResolution))].slice(0,48);
   for(let i=0;i<pages.length;i+=3){await Promise.allSettled(pages.slice(i,i+3).map(page=>this.resolve(page)));if(generation!==this.generation)return false;}
   if(generation!==this.generation)return false;this.matches=next;
   const count=games.filter(g=>this.urls(g).length).length,unresolved=manual.filter(needsPlayerResolution).some(url=>!this.playable(url));
   this.status=unresolved?'A saved page needs its player embed link. Edit it below.':this.enabled?(count?'Streams found for '+count+' game'+(count===1?'':'s')+'. Your links take priority.':'No exact stream matches yet. You can add a player link below.'):'Automatic lookup is off. Your saved links still work.';return true;
  }catch{if(generation===this.generation){this.status='Automatic stream lookup is unavailable. Retrying; your links are kept.';await Promise.allSettled(manual.filter(needsPlayerResolution).slice(0,24).map(page=>this.resolve(page)));}return false;}
  finally{if(generation===this.generation)this.pending=false;}
 }
}
