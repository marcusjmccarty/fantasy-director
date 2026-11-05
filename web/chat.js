// The chat tab's connection: a WebSocket to the room when the site can open
// one, otherwise short polling over the same HTTP calls (the local preview,
// a proxy that blocks sockets). Messages are deduplicated by id, so a reconnect
// never shows a line twice. Rendering helpers live here too so both pages
// draw the room the same way.
const RECONNECT=[2000,4000,8000,15000,30000],POLL_VISIBLE=4000,POLL_HIDDEN=20000,SOCKET_RETRY=60000,OPEN_TIMEOUT=6000,STABLE_AFTER=10000,HEARTBEAT=45000,PONG_WAIT=10000,SEND_WAIT=8000,KEEP=300;
export class ChatClient{
 constructor({room='',fetcher=(...args)=>fetch(...args),socket=typeof WebSocket==='undefined'?null:url=>new WebSocket(url),origin='',onHistory=()=>{},onMessage=()=>{},onPresence=()=>{},onState=()=>{},timer=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),hidden=()=>false}={}){
  Object.assign(this,{room,fetcher,socket,origin,onHistory,onMessage,onPresence,onState,timer,cancel,hidden});
  this.messages=[];this.lastId=0;this.state='idle';this.ws=null;this.failures=0;this.pollTimer=null;this.retryTimer=null;this.openTimer=null;this.stableTimer=null;this.heartbeatTimer=null;this.pongTimer=null;this.socketBlockedUntil=0;this.closed=true;this.pending=new Map();this.nonce=0;this.epoch=0;this.historyLoaded=false;
 }
 setState(state,detail=''){if(this.state===state&&this.detail===detail)return;this.state=state;this.detail=detail;this.onState(state,detail);}
 // Switch rooms (a league connected, a sport changed): start over.
 setRoom(room){if(room===this.room&&!this.closed)return;this.close();this.room=room;this.messages=[];this.lastId=0;this.historyLoaded=false;this.onHistory([]);this.onPresence(0);if(room)this.connect();}
 connect(){
  // No origin (a test sandbox, a file:// preview): nothing to connect to.
  if(!this.room||!this.origin)return;this.closed=false;
  if(this.socket&&Date.now()>=this.socketBlockedUntil)this.openSocket();else this.poll(true);
 }
 url(){return `${this.origin}/api/chat?room=${encodeURIComponent(this.room)}`;}
 openSocket(){
  this.setState('connecting');
  let ws;try{ws=this.socket(this.url().replace(/^http/,'ws'));}catch{this.socketFailed();return;}
  this.ws=ws;let opened=false;
  this.openTimer=this.timer(()=>{if(!opened){try{ws.close();}catch{}}},OPEN_TIMEOUT);
  ws.onopen=()=>{if(this.ws!==ws||this.closed)return;opened=true;this.cancel(this.openTimer);this.setState('live');
   // A socket that stays up for a while clears the backoff; one that drops at once counts as a failure.
   this.stableTimer=this.timer(()=>{if(this.ws===ws)this.failures=0;},STABLE_AFTER);this.heartbeat(ws);};
  ws.onmessage=event=>{if(this.ws!==ws||this.closed)return;let data;try{data=JSON.parse(event.data);}catch{return;}if(data?.type==='pong')this.cancel(this.pongTimer);this.receive(data);};
  ws.onclose=()=>{if(this.ws!==ws)return;this.cancel(this.openTimer);this.cancel(this.stableTimer);this.cancel(this.heartbeatTimer);this.cancel(this.pongTimer);if(this.ws!==ws)return;this.ws=null;if(this.closed)return;if(!opened)this.socketFailed();else{this.failures++;if(this.failures>=4){this.socketBlockedUntil=Date.now()+SOCKET_RETRY;this.poll(true);}else this.reconnect();}};
  ws.onerror=()=>{};
 }
 // A half-open socket answers nothing: ping it now and then, and drop it when the pong is late.
 heartbeat(ws){
  this.cancel(this.heartbeatTimer);this.heartbeatTimer=this.timer(()=>{
   if(this.ws!==ws)return;try{ws.send(JSON.stringify({type:'ping'}));}catch{this.drop(ws);return;}
   this.pongTimer=this.timer(()=>{if(this.ws===ws)this.drop(ws);},PONG_WAIT);this.heartbeat(ws);
  },HEARTBEAT);
 }
 drop(ws){if(this.ws!==ws)return;this.ws=null;try{ws.close();}catch{}if(!this.closed)this.reconnect();}
 socketFailed(){
  this.failures++;
  // Two failed opens in a row: this network does not pass sockets; poll instead and try again later.
  if(this.failures>=2){this.socketBlockedUntil=Date.now()+SOCKET_RETRY;this.poll(true);return;}
  this.reconnect();
 }
 reconnect(){
  if(this.closed)return;this.setState('reconnecting');
  const wait=RECONNECT[Math.min(this.failures,RECONNECT.length-1)];
  this.cancel(this.retryTimer);this.retryTimer=this.timer(()=>{if(!this.closed)this.connect();},wait);
 }
 // Polling: the same room over plain requests, slower when the tab is hidden.
 poll(immediately=false){
  if(this.closed)return;this.setState('polling');this.cancel(this.pollTimer);
  const run=async()=>{
   if(this.closed)return;const epoch=this.epoch;
   try{const r=await this.fetcher(this.url()+'&since='+this.lastId,{cache:'no-store',signal:AbortSignal.timeout(8000)});const data=await r.json();if(this.epoch!==epoch)return;if(!r.ok)throw new Error(data.error||'Chat unavailable');this.receive({type:this.historyLoaded?'messages':'history',messages:data.messages,count:data.count,reset:data.reset});this.setState('polling');}
   catch{if(this.epoch!==epoch)return;this.setState('offline','Chat is unreachable right now. Trying again…');}
   if(this.closed||this.epoch!==epoch)return;
   if(this.socket&&Date.now()>=this.socketBlockedUntil){this.failures=0;this.openSocket();return;}
   this.pollTimer=this.timer(run,this.hidden()?POLL_HIDDEN:POLL_VISIBLE);
  };
  this.pollTimer=this.timer(run,immediately?0:POLL_VISIBLE);
 }
 receive(data){
  if(!data||typeof data!=='object')return;
  if(data.type==='removed'){const ids=new Set(data.ids||[]);this.messages=this.messages.filter(m=>!ids.has(m.id));this.onHistory(this.messages);return;}
  if(data.type==='history'||data.type==='messages'){
   const reset=data.type==='history'||data.reset===true,known=new Set(this.messages.map(m=>m.id));
   if(reset)this.messages=[];
   const fresh=this.absorb(data.messages||[]).filter(m=>!known.has(m.id));
   if(reset&&data.type!=='history'){this.onHistory(this.messages);for(const m of fresh)this.onMessage(m,false,true);if(Number.isFinite(data.count))this.onPresence(data.count);return;}
   if(data.type==='history'){this.historyLoaded=true;this.onHistory(this.messages);}else for(const m of fresh)this.onMessage(m);if(Number.isFinite(data.count))this.onPresence(data.count);return;}
  if(data.type==='message'){const sent=data.nonce&&this.pending.get(data.nonce);if(sent){this.pending.delete(data.nonce);sent.resolve({ok:true});}for(const m of this.absorb([data.message]))this.onMessage(m,!!sent);return;}
  if(data.type==='presence'||data.type==='pong'){if(Number.isFinite(data.count))this.onPresence(data.count);return;}
  if(data.type==='rejected'){const sent=data.nonce&&this.pending.get(data.nonce);if(sent){this.pending.delete(data.nonce);sent.resolve({error:data.reason||'Not sent.'});}return;}
  if(data.type==='accepted'){const sent=data.nonce&&this.pending.get(data.nonce);if(sent){this.pending.delete(data.nonce);sent.resolve({ok:true,duplicate:true});}}
 }
 absorb(list){
  const fresh=[];
  for(const m of list){if(!m||!Number.isFinite(Number(m.id))||this.messages.some(x=>x.id===m.id))continue;fresh.push(m);this.messages.push(m);this.lastId=Math.max(this.lastId,Number(m.id));}
  this.messages.sort((a,b)=>a.id-b.id);if(this.messages.length>KEEP)this.messages.splice(0,this.messages.length-KEEP);
  return fresh;
 }
 // Resolves with {ok} once the room has it, {error} when it refused, {duplicate} for a repeated event.
 async send(message){
  if(!this.room)return {error:'No room yet.'};
  if(this.ws&&this.state==='live'){
   const nonce=String(++this.nonce),ws=this.ws;
   return new Promise(resolve=>{this.pending.set(nonce,{resolve});try{ws.send(JSON.stringify({...message,nonce}));}catch{this.pending.delete(nonce);resolve({error:'Not sent. Check your connection.'});return;}
    // No answer in time: the socket is half open. Drop it and reconnect; the next Send goes out again.
    this.timer(()=>{if(!this.pending.has(nonce))return;this.pending.delete(nonce);resolve({error:'The room did not answer. Try again.'});this.drop(ws);},SEND_WAIT);});
  }
  const epoch=this.epoch;
  try{const r=await this.fetcher(this.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(8000)});const data=await r.json();if(!r.ok)return {error:data.error||'Not sent.'};if(this.epoch!==epoch)return {error:'The room changed. Try again.'};if(data.message)for(const m of this.absorb([data.message]))this.onMessage(m,true);return {ok:true,duplicate:!!data.duplicate};}
  catch{return {error:'Not sent. Check your connection.'};}
 }
 async moderate(action,key){
  const epoch=this.epoch;
  try{
   const verify=action===null;
   const response=await this.fetcher(this.url()+(verify?'&moderator=1':''),{method:verify?'GET':'DELETE',headers:{Authorization:'Bearer '+key,...(verify?{}:{'Content-Type':'application/json'})},...(verify?{}:{body:JSON.stringify(action)}),cache:'no-store',signal:AbortSignal.timeout(8000)});
   const data=await response.json();if(!response.ok)return {error:data.error||'Moderation failed.'};
   if(epoch!==this.epoch)return {error:'The room changed. Try again.'};
   if(data.removed)this.receive({type:'removed',ids:data.removed});return {ok:true};
  }catch{return {error:'The room could not be reached. Try again.'};}
 }
 close(){for(const pending of this.pending.values())pending.resolve({error:'The room changed. Try again.'});this.pending.clear();this.closed=true;this.epoch++;for(const id of [this.pollTimer,this.retryTimer,this.openTimer,this.stableTimer,this.heartbeatTimer,this.pongTimer])this.cancel(id);const ws=this.ws;this.ws=null;if(ws)try{ws.close();}catch{}this.setState('idle');}
}
const escapeChat=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Plain https links become links; everything else stays text.
export function chatText(text){
 return String(text??'').split(/(https:\/\/[^\s<>"']{4,200})/g).map((part,i)=>{
  if(i%2===0)return escapeChat(part);
  try{const u=new URL(part);if(u.protocol!=='https:')return escapeChat(part);return `<a href="${escapeChat(u.href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeChat(u.hostname+(u.pathname.length>1?u.pathname.slice(0,24)+(u.pathname.length>24?'…':''):''))}</a>`;}catch{return escapeChat(part);}
 }).join('');
}
export const chatTime=at=>{const d=new Date(at);return Number.isFinite(d.getTime())?d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';};
// One line of the room. Your own lines are marked; events (a score) are set apart.
export function chatMessageHTML(m,me='',moderator=false){
 const remove=moderator?`<button type="button" class="chat-remove link" data-remove-message="${escapeChat(m.id)}" aria-label="Remove message">Remove</button>`:'';
 if(m.kind==='event')return `<li class="chat-event" data-id="${escapeChat(m.id)}"><span class="chat-text">${chatText(m.text)}</span><time class="chat-time">${chatTime(m.at)}</time>${remove}</li>`;
 const mine=me&&m.name===me;
 return `<li class="chat-msg${mine?' mine':''}" data-id="${escapeChat(m.id)}"><span class="chat-name">${escapeChat(m.name)}</span><time class="chat-time">${chatTime(m.at)}</time><span class="chat-text">${chatText(m.text)}</span>${remove}</li>`;
}
export const chatRoomFor=(sport,leagueId)=>/^(nfl|nba|nhl|mlb)$/.test(sport)&&/^\d{1,12}$/.test(String(leagueId||''))?`${sport}:league:${leagueId}`:'';

// The Chat tab itself, shared by every league page. `$` finds elements by id;
// name/getRoom callbacks keep the page's own saved preferences in charge.
export function mountChat({$,sport,getName,setName,defaultName=()=>'',isOpen=()=>true,fetcher,socket,origin='',hidden=()=>typeof document!=='undefined'&&document.hidden,timer,cancel}){
 const log=$('chatLog'),state=$('chatState'),input=$('chatInput'),nameRow=$('chatNameRow'),nameInput=$('chatName');
 let unread=0,room=null,label='',presence=0,moderatorKey='';
 const me=()=>getName()||'';
 const badge=()=>{const count=$('chatCount');if(count)count.textContent=unread?String(Math.min(99,unread)):'';};
 const atBottom=()=>!log.scrollHeight||log.scrollTop+log.clientHeight>=log.scrollHeight-40;
 const scrollDown=()=>{if(typeof log.scrollTo==='function')log.scrollTo({top:log.scrollHeight});else log.scrollTop=log.scrollHeight;};
 const say=(text,tone='')=>{state.hidden=!text;state.textContent=text||'';state.className='chat-state'+(tone?' '+tone:'');};
 const head=()=>{$('chatRoomName').textContent=label;$('chatPresence').textContent=presence>0?`${presence} here`:'';};
 const client=new ChatClient({fetcher,socket,origin,hidden,...(timer?{timer}:{}),...(cancel?{cancel}:{}),
  onHistory:messages=>{const stay=atBottom();log.innerHTML=messages.length?messages.map(m=>chatMessageHTML(m,me(),!!moderatorKey)).join(''):'<li class="chat-empty">Nobody has said anything yet. Say hi.</li>';if(stay)scrollDown();},
  onMessage:(m,own,alreadyRendered=false)=>{const stay=atBottom()||own;if(!alreadyRendered){if(log.querySelector?.('.chat-empty'))log.innerHTML='';log.insertAdjacentHTML?.('beforeend',chatMessageHTML(m,me(),!!moderatorKey));}if(stay)scrollDown();if(!own&&!isOpen()&&m.kind!=='event'){unread++;badge();}},
  onPresence:n=>{presence=n;head();},
  onState:(s,detail)=>{say(s==='offline'?detail:s==='reconnecting'?'Reconnecting…':'',s==='offline'?'warn':'');$('chatSend').disabled=false;}
 });
 const showNameRow=(focus=true)=>{nameRow.hidden=false;nameInput.value=me();if(focus)nameInput.focus?.();};
 const saveName=()=>{const name=cleanName(nameInput.value);if(!name){say('A name needs at least one letter.','warn');nameInput.focus?.();return false;}setName(name);nameRow.hidden=true;$('chatNameButton').textContent=name;say('');if(log.innerHTML)client.onHistory(client.messages);return true;};
 const send=async text=>{
  text=String(text||'').trim();if(!text)return;
  if(!me()){showNameRow();say('Choose a name first, then send.','');return;}
  $('chatSend').disabled=true;const result=await client.send({kind:'chat',name:me(),text});$('chatSend').disabled=false;
  if(result.error){say(result.error,'warn');return;}
  say('');input.value='';input.focus?.();
 };
 $('chatForm').onsubmit=e=>{e.preventDefault?.();return send(input.value);};
 $('chatNameButton').onclick=()=>{if(nameRow.hidden)showNameRow();else nameRow.hidden=true;};
 $('chatNameSave').onclick=saveName;nameInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault?.();saveName();}};
 $('chatQuick').onclick=e=>{const b=e.target?.closest?.('[data-say]');if(b)send(b.dataset.say);};
 $('chatNameButton').textContent=me()||'Set your name';
 const moderationUI=()=>{
  const unlocked=!!moderatorKey;$('chatModeratorKey').hidden=unlocked;$('chatModeratorUnlock').hidden=unlocked;
  $('chatModeratorLock').hidden=!unlocked;$('chatClear').hidden=!unlocked;client.onHistory(client.messages);
 };
 $('chatModeratorUnlock').onclick=async()=>{
  const key=$('chatModeratorKey').value.trim();$('chatModeratorKey').value='';
  if(key.length<32){say('Enter the site owner’s moderator key.','warn');return;}
  const result=await client.moderate(null,key);
  if(result.error){say(result.error,'warn');return;}moderatorKey=key;moderationUI();say('Moderation unlocked for this tab.');
 };
 $('chatModeratorLock').onclick=()=>{moderatorKey='';moderationUI();say('Moderation locked.');};
 log.onclick=async event=>{
  const button=event.target?.closest?.('[data-remove-message]');if(!button||!moderatorKey)return;
  button.disabled=true;const result=await client.moderate({id:Number(button.dataset.removeMessage)},moderatorKey);
  button.disabled=false;if(result.error)say(result.error,'warn');
 };
 $('chatClear').onclick=()=>{
  $('chatClearConfirm').hidden=false;
 };
 $('chatClearCancel').onclick=()=>{$('chatClearConfirm').hidden=true;};
 $('chatClearYes').onclick=async()=>{
  if(!moderatorKey)return;$('chatClearYes').disabled=true;const result=await client.moderate({clear:true},moderatorKey);
  $('chatClearYes').disabled=false;$('chatClearConfirm').hidden=true;if(result.error)say(result.error,'warn');
 };
 return {
  client,
  setRoom(next,nextLabel){
   label=nextLabel;head();$('chatTab').hidden=!next;$('chatNote').hidden=!next;
   if(next!==room){room=next;unread=0;presence=0;input.value='';$('chatClearConfirm').hidden=true;badge();head();client.setRoom(next);}
  },
  // A scoring play from the channel, once per room however many viewers announce it.
  event(text,key){if(room?.includes(':league:'))client.send({kind:'event',text,key}).catch(()=>{});},
  markRead(){unread=0;badge();if(log.innerHTML)scrollDown();},
  suggestName(){if(!me()){const name=cleanName(defaultName());if(name){setName(name);$('chatNameButton').textContent=name;}}}
 };
}
const cleanName=value=>String(value??'').replace(/[\u0000-\u001f\u007f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,24);
