export class NFLSourceCatalog{
 constructor({fetcher=fetch,now=()=>Date.now()}={}){this.fetcher=fetcher.bind(globalThis);this.now=now;this.records=new Map();this.pending=new Map();this.failures=new Map();}
 get(id){const record=this.records.get(id);return record?.expiresAt>this.now()+10000?record:null;}
 async resolve(clip){
  const record=this.get(clip.id);if(record)return record;if(this.pending.has(clip.id))return this.pending.get(clip.id);
  if(this.failures.get(clip.id)>this.now())throw new Error('Highlight temporarily unavailable.');
  const promise=Promise.resolve().then(async()=>{try{
   let slug='';try{const u=new URL(clip.url);if(u.origin==='https://www.nfl.com'&&/^\/videos\/[-a-z\d]+$/i.test(u.pathname))slug=u.pathname.split('/').at(-1);}catch{}
   const response=await this.fetcher('/api/nfl-source?id='+encodeURIComponent(clip.id)+(slug?'&slug='+encodeURIComponent(slug):''),{cache:'no-store',signal:AbortSignal.timeout(35000)});const data=await response.json();
   if(!response.ok||!data.url)throw new Error(data.error||'Highlight unavailable.');this.records.set(clip.id,data);return data;
  }catch(error){this.failures.set(clip.id,this.now()+60000);throw error;}finally{this.pending.delete(clip.id);}});this.pending.set(clip.id,promise);return promise;
 }
}
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function rankNFLClips(clips,roster,played=new Set()){
 return clips.filter(c=>!played.has(c.id)).map(clip=>{
  const names=clip.athletes?.map(normalize)||[],title=normalize(clip.title);
  const players=roster.filter(p=>names.includes(normalize(p.name))||title.includes(normalize(p.name)));
  const team=roster.some(p=>clip.teams?.includes(p.team));
  return {clip,score:(players.length?1000:team?100:0)+(clip.short?20:0),players};
 }).sort((a,b)=>b.score-a.score||a.clip.id.localeCompare(b.clip.id)).map(x=>x.clip);
}
