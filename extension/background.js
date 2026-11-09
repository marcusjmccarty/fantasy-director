import './playback-background.js';
import {Coordinator,ALARM} from './coordinator.js';
const director=new Coordinator(chrome);
const failure=error=>director.enqueue(async()=>{const r=director.s.runtime;r.decision=error.message || 'Director error';r.engineError=r.decision;r.feedError=r.decision;director.log(r.decision);await director.persist();director.announce();}).catch(()=>{});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')))return;
  if(message.target==='desk' || message.target==='live-engine' || message.target==='replay-player')return;
  if(['playerState','playerEvent'].includes(message.action)){
    director.playerRequest(message,sender).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:e.message}));return true;
  }
  if(message.action==='labState'){
    director.enqueue(()=>{const r=director.s.runtime;if(!r.lab || !r.lab.tabs.some(t=>t.tabId===sender.tab?.id && t.url===sender.url))return null;return {lab:{elapsed:r.lab.elapsed,label:r.lab.label,complete:r.lab.complete},games:r.games,current:r.currentGame,running:r.running};}).then(data=>reply({ok:true,data}));return true;
  }
  if(message.action==='engine'){
    if(sender.url!==chrome.runtime.getURL('offscreen.html'))return;
    director.packet(message.packet).then(()=>reply({ok:true})).catch(error=>{failure(error);reply({ok:false,error:error.message});});return true;
  }
  director.dispatch(message).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message || 'Operation failed'}));return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM)return director.watchdog().catch(failure);});
chrome.commands.onCommand.addListener(command=>{if(command==='stop-director')return director.dispatch({action:'stop'}).catch(failure);});
chrome.tabs.onRemoved.addListener(id=>director.tabChanged(id,true).catch(failure));
chrome.tabs.onUpdated.addListener((id,changes)=>{if(changes.url || 'discarded' in changes)return director.tabChanged(id).catch(failure);});
chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('dashboard.html'),existing=(await chrome.tabs.query({})).find(t=>t.url===url);
  if(existing){await chrome.windows.update(existing.windowId,{focused:true});await chrome.tabs.update(existing.id,{active:true});}
  else await chrome.tabs.create({url});
});
for(const event of [chrome.runtime.onStartup,chrome.runtime.onInstalled])event.addListener(()=>director.enqueue(async()=>{
  await chrome.alarms.clear('fantasy-director-poll');await director.stop();director.s.runtime.bindings={};director.s.runtime.currentGame='';director.s.runtime.decision='Fantasy Stream 3.2 ready. Assign streams, then Start Auto.';await director.persist();
}).catch(failure));
