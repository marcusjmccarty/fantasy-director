import {normalizeScoreboard} from './adapters.js';
import {normalizeHighlights} from './highlights.js';
export const SCOREBOARD='https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
export function retryDelay(value,now=Date.now()) {
  if(value==null)return 0;
  const seconds=Number(value);
  return Math.max(0,Number.isFinite(seconds)?seconds*1000:(Date.parse(value)-now || 0));
}
export async function requestJSON(url,{credentials='omit',signal,timeout=6000,fetchImpl=fetch,now=Date.now}={}) {
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeout),startedAt=now();
  try {
    const response=await fetchImpl(url,{credentials,cache:'no-cache',headers:{Accept:'application/json'},signal:controller.signal});
    if(!response.ok) {
      const error=new Error(response.status===429?'ESPN rate limit · waiting before retry':response.status===401 || response.status===403?'ESPN denied access. Sign in to ESPN in this browser profile.':`ESPN returned HTTP ${response.status}`);
      error.status=response.status;error.retryAfterMs=retryDelay(response.headers?.get('retry-after'),now());throw error;
    }
    const raw=await response.json(),receivedAt=now(),age=response.headers?.get('age');
    return {raw,meta:{startedAt,receivedAt,networkMs:receivedAt-startedAt,cacheAgeSeconds:age!=null && Number.isFinite(Number(age))?Number(age):null,serverDate:response.headers?.get('date') || null,cacheControl:response.headers?.get('cache-control') || null}};
  } catch(error) {
    if(controller.signal.aborted){const e=new Error(signal?.aborted?'Request cancelled':'ESPN request timed out');e.name='AbortError';throw e;}
    if(error instanceof SyntaxError)throw new Error('ESPN returned an unreadable JSON response');
    throw error;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function pollInterval(games,seconds,now=Date.now()) {
  if(games.some(g=>g.state==='in'))return seconds*1000;
  if(games.some(g=>g.state==='pre' && Date.parse(g.date)-now<15*60000))return 15000;
  return 60000;
}
export function scoreboardHighlights(raw,games,now) {
  return (raw.events || []).flatMap(event=>{
    const game=games.find(g=>g.id===String(event.id));if(!game)return [];
    return normalizeHighlights({videos:(event.competitions || []).flatMap(c=>c.highlights || [])},game,now);
  });
}
// One request at a time, start-to-start cadence, explicit cancellation and
// Retry-After. No cache-busting URLs and no simultaneous duplicate pollers.
export class FeedLoop {
  constructor({request=requestJSON,emit=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    Object.assign(this,{request,emit,now,setTimer,clearTimer});this.generation=0;this.active=false;this.nextAt=0;this.failures=0;this.lastLiveAt=0;
  }
  start({pollSeconds=5,token}={}) {
    this.stop();this.active=true;this.pollSeconds=pollSeconds;this.token=token;this.failures=0;this.nextAt=0;this.lastLiveAt=0;
    return this.cycle(this.generation);
  }
  stop() {this.active=false;this.generation++;this.clearTimer(this.timer);this.controller?.abort();this.busy=false;}
  poke() {
    if(!this.active || this.busy || this.now()<this.nextAt)return;
    this.clearTimer(this.timer);return this.cycle(this.generation);
  }
  async cycle(generation) {
    if(!this.active || generation!==this.generation || this.busy)return;
    if(this.now()<this.nextAt){this.timer=this.setTimer(()=>this.cycle(generation),Math.min(2147483647,this.nextAt-this.now()));return;}
    this.busy=true;const startedAt=this.now();this.controller=new AbortController();
    let packet,interval;
    try {
      const {raw,meta}=await this.request(SCOREBOARD,{signal:this.controller.signal});
      const games=normalizeScoreboard(raw,meta.receivedAt);
      this.failures=0;if(games.some(g=>g.state==='in'))this.lastLiveAt=this.now();
      interval=this.lastLiveAt && this.now()-this.lastLiveAt<120000?this.pollSeconds*1000:pollInterval(games,this.pollSeconds,this.now());
      packet={type:'feed',games,highlights:scoreboardHighlights(raw,games,meta.receivedAt),meta};
    } catch(error) {
      if(generation!==this.generation || !this.active)return;
      this.failures++;
      interval=Math.max(error.retryAfterMs || 0,error.status===429?60000:0,Math.min(120000,this.pollSeconds*1000*2**Math.min(this.failures,5)));
      packet={type:'feedError',error:error.message || 'ESPN connection failed',status:error.status || 0};
    }
    if(generation!==this.generation || !this.active)return;
    this.busy=false;
    // Errors back off from completion; successful requests keep a target
    // start-to-start interval but always leave at least 1s after completion.
    this.nextAt=packet.type==='feed'?Math.max(startedAt+interval,this.now()+1000):this.now()+interval;
    this.emit({...packet,token:this.token,nextPollAt:this.nextAt,failures:this.failures});
    this.timer=this.setTimer(()=>this.cycle(generation),Math.min(2147483647,this.nextAt-this.now()));
  }
}
