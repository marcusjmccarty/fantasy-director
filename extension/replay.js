const $=id=>document.getElementById(id),video=$('video');
let item=null,loadTimer,stallTimer,limitTimer,generation=0,loading=false;
const call=async(action,extra={})=>{const r=await chrome.runtime.sendMessage({action,...extra});if(!r?.ok)throw new Error(r?.error || 'Director unavailable');return r.data;};
function clear(){generation++;clearTimeout(loadTimer);clearTimeout(stallTimer);clearTimeout(limitTimer);item=null;loading=false;video.pause();video.removeAttribute('src');video.preload='none';video.load();$('sound').hidden=true;$('status').textContent='Replay finished. Waiting for the next clip or live coverage.';}
async function event(type){if(!item)return;await call('playerEvent',{nonce:item.nonce,event:type});}
async function finish(type){if(!item)return;try{await event(type);}catch(e){$('status').textContent=e.message;}finally{clear();}}
async function load(){
  try{
    const next=await call('playerState');if(!next){clear();return;}if(item?.nonce===next.nonce)return;
    clear();item=next;const current=generation;loading=true;video.muted=true;
    $('title').textContent=item.title;$('kind').textContent=item.test?'FICTIONAL / OFFLINE TEST':'ESPN / PUBLISHED VIDEO';$('status').textContent='Loading replay; live coverage continues.';
    $('source').hidden=!item.source;if(item.source)$('source').href=item.source;
    loadTimer=setTimeout(()=>{if(generation===current)void finish('error');},10000);
    video.src=item.url;video.preload='auto';video.load();
  }catch(e){$('status').textContent=e.message;}
}
video.addEventListener('loadeddata',async()=>{
  if(!item || !loading)return;loading=false;const current=generation;clearTimeout(loadTimer);
  try{
    const response=await call('playerEvent',{nonce:item.nonce,event:'ready'});if(generation!==current || !response?.play)return;
    video.muted=false;let muted=false;
    try{await video.play();}catch(e){if(e.name!=='NotAllowedError')throw e;video.muted=true;muted=true;await video.play();}
    if(generation!==current)return;
    $('sound').hidden=!muted;$('status').textContent=muted?'Playing automatically, muted. Enable sound once for this player.':'Playing. Live roster action and red-zone threats take priority.';
    await event(muted?'muted':'playing');limitTimer=setTimeout(()=>void finish('ended'),(item.maxSeconds || 100)*1000);
  }catch{if(generation===current)await finish('error');}
});
video.addEventListener('ended',()=>void finish('ended'));
video.addEventListener('error',()=>{if(item)void finish('error');});
video.addEventListener('waiting',()=>{clearTimeout(stallTimer);if(item&&!loading)stallTimer=setTimeout(()=>void finish('stalled'),8000);});
video.addEventListener('playing',()=>clearTimeout(stallTimer));
$('sound').addEventListener('click',async()=>{try{video.muted=false;await video.play();$('sound').hidden=true;$('status').textContent='Playing with sound.';await event('playing');}catch{video.muted=true;$('status').textContent='Sound could not start. The clip will continue muted.';}});
$('skip').addEventListener('click',()=>void finish('skip'));
$('return').addEventListener('click',async()=>{video.pause();try{await call('returnLive');clear();}catch(e){$('status').textContent=e.message;}});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || m.target!=='replay-player')return;
  if(m.type==='clear'){clear();reply({ok:true});}else if(m.type==='load'){void load();reply({ok:true});}
});
void load();
