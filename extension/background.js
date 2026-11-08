// Provider frames can move between domains. Host access is needed for those
// frames, but activation is checked against Chrome's top-tab URL, not a value
// supplied by the website. No browsing data is stored or sent anywhere.
const SITES=new Set(['https://fantasy-stream.fantasy-hub.workers.dev','https://fantasy-director.soraclipse.chatgpt.site']);
function allowed(url){try{const u=new URL(url);return SITES.has(u.origin)||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)&&['3000','4173'].includes(u.port));}catch{return false;}}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(!allowed(sender.tab?.url))return;
 if(message?.type==='init'){
  if(sender.frameId!==0&&sender.documentId){
   chrome.scripting.executeScript({target:{tabId:sender.tab.id,documentIds:[sender.documentId]},world:'MAIN',files:['fullscreen.js']}).catch(()=>{});
  }
  reply({enabled:true,top:sender.frameId===0});return;
 }
 if(message?.type==='fullscreen'&&sender.frameId!==0){
  chrome.tabs.sendMessage(sender.tab.id,{type:'fullscreen',exit:message.exit===true,toggle:message.toggle===true},{frameId:0}).catch(()=>{});
 }
});
