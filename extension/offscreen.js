// The offscreen document hosts an actual dedicated worker. Its reason is
// WORKERS; no silent audio, fake media activity, or provider DOM injection.
const worker=new Worker('feed-worker.js',{type:'module'});
let token='';
worker.onmessage=({data})=>chrome.runtime.sendMessage({target:'coordinator',action:'engine',packet:data}).catch(()=>{});
worker.onerror=()=>chrome.runtime.sendMessage({target:'coordinator',action:'engine',packet:{type:'engineError',token,error:'Live worker failed. The watchdog will restart it.'}}).catch(()=>{});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || message.target!=='live-engine')return;
  if(message.type==='start')token=message.token;
  worker.postMessage(message);reply({ok:true});
});
