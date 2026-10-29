export const QUALITY_ORDER=['sd','low','hd','full','lowest','mobile'];
export function chooseSource(record,quality='auto'){
 const sources=record?.sources||[];
 if(quality!=='auto'){const exact=sources.find(s=>s.quality===quality);if(exact)return exact;}
 return QUALITY_ORDER.map(q=>sources.find(s=>s.quality===q)).find(Boolean)||sources[0]||null;
}
export class SourceCatalog{
 // Native browser fetch must retain its Window receiver, not the catalog instance.
 constructor({fetcher=fetch,onUpdate=()=>{},now=()=>Date.now()}={}){this.fetcher=fetcher.bind(globalThis);this.onUpdate=onUpdate;this.now=now;this.records=new Map();this.pending=new Map();this.errors=new Map();this.generation=0;this.invalidated=new Set();}
 get(id){const record=this.records.get(id);return record?.expiresAt>this.now()?record:null;}
 invalidate(id){const record=this.records.get(id);if(record)record.expiresAt=0;this.invalidated.add(id);this.errors.delete(id);}
 async resolve(game,{retry=false}={}){
  retry=retry||this.invalidated.has(game.id);
  const cached=this.get(game.id);if(cached&&!retry)return cached;
  if(this.pending.has(game.id))return this.pending.get(game.id);
  const last=this.errors.get(game.id);if(last&&this.now()-last.at<15000&&!retry)throw new Error(last.message);
  // Install the pending entry before executing code that can throw synchronously.
  const promise=Promise.resolve().then(async()=>{
   try{
    const response=await this.fetcher('/api/replay-source?id='+encodeURIComponent(game.id)+(retry?'&refresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(16000)});
    if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Refresh your signed-in session to load replays.');
    const record=await response.json();if(!response.ok||!record.sources?.length)throw new Error(record.error||'No playback source available.');
    this.records.set(game.id,record);this.invalidated.delete(game.id);this.errors.delete(game.id);return record;
   }catch(error){this.errors.set(game.id,{at:this.now(),message:error.name==='TimeoutError'?'The replay provider took too long.':error.message});throw error;}
   finally{this.pending.delete(game.id);this.onUpdate(game.id);}
  });this.pending.set(game.id,promise);this.onUpdate(game.id);return promise;
 }
 async importAll(games,priority=[]){
  const generation=++this.generation,order=[...new Set([...priority,...games.map(g=>g.id)])],queue=order.map(id=>games.find(g=>g.id===id)).filter(Boolean);
  await Promise.all(Array.from({length:3},async()=>{while(queue.length&&generation===this.generation){const game=queue.shift();try{await this.resolve(game);}catch{}}}));
 }
 status(id){if(this.pending.has(id))return 'Importing';if(this.get(id))return 'Imported';if(this.errors.has(id))return 'Retry needed';if(this.records.has(id))return 'Refresh on use';return 'Queued';}
 cancel(){this.generation++;}
}
