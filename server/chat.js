// Open league rooms, with bounded retention and owner-key moderation.
// League IDs select rooms; they do not authenticate league membership.
import {sameSite} from './api.js';
const CHAT_ROOM=/^(nfl|nba|nhl|mlb):(league:\d{1,12}|lounge)$/;
export const CHAT_TTL=60*60*1000;
const CHAT_KEEP=300,CHAT_PAGE=120,NAME_MAX=24,TEXT_MAX=400,KEY_MAX=80;
const RATE_WINDOW=60000,RATE_MAX=30,RATE_GAP=1000;
const chatJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export const cleanChatName=value=>String(value??'').replace(/[\u0000-\u001f\u007f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,NAME_MAX);
export const cleanChatText=value=>String(value??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').replace(/[ \t]*\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,TEXT_MAX);
// A message as the room accepts it, or the reason it does not.
export function validateChatMessage(data,room=''){
 if(!data||typeof data!=='object'||Array.isArray(data))return {error:'Send a message.'};
 const kind=data.kind==='event'?'event':'chat',name=cleanChatName(data.name),text=cleanChatText(data.text);
 // Scoring events belong to a league's room; the public lounges carry only what people type.
 if(kind==='event'&&!/:league:\d/.test(room))return {error:'Only a league room carries events.'};
 if(!text)return {error:'Write something first.'};
 if(kind==='chat'&&!name)return {error:'Choose a name first.'};
 const key=kind==='event'?String(data.key||'').replace(/[^\w:.-]/g,'').slice(0,KEY_MAX):'';
 if(kind==='event'&&!key)return {error:'An event needs a key.'};
 return {kind,name:kind==='event'?'':name,text,key};
}
// Storage behind a room: the newest messages, lookups by id and by event key.
export class MemoryChatStore{
 constructor(){this.rows=[];this.next=1;}
 oldest(){return this.rows[0]?.at??null;}
 remove(id){const removed=this.rows.filter(m=>id===null||m.id===id).map(m=>m.id);this.rows=this.rows.filter(m=>!removed.includes(m.id));return removed;}
 expire(before){const removed=this.rows.filter(m=>m.at<=before).map(m=>m.id);this.rows=this.rows.filter(m=>m.at>before);return removed;}
 recent(limit){return this.rows.slice(-limit);}
 since(id,limit){return this.rows.filter(m=>m.id>id).slice(0,limit);}
 hasKey(key){return this.rows.some(m=>m.key===key);}
 insert(message){const row={...message,id:this.next++};this.rows.push(row);if(this.rows.length>CHAT_KEEP)this.rows.splice(0,this.rows.length-CHAT_KEEP);return row;}
}
export class SqlChatStore{
 constructor(sql){this.sql=sql;sql.exec('CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,name TEXT NOT NULL,text TEXT NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL DEFAULT \'\')');sql.exec('CREATE INDEX IF NOT EXISTS messages_key ON messages(key)');}
 oldest(){return this.sql.exec('SELECT MIN(at) AS at FROM messages').one().at;}
 remove(id){return (id===null?this.sql.exec('DELETE FROM messages RETURNING id'):this.sql.exec('DELETE FROM messages WHERE id=? RETURNING id',id)).toArray().map(m=>m.id);}
 expire(before){return this.sql.exec('DELETE FROM messages WHERE at<=? RETURNING id',before).toArray().map(m=>m.id);}
 recent(limit){return this.sql.exec('SELECT id,at,name,text,kind,key FROM messages ORDER BY id DESC LIMIT ?',limit).toArray().reverse();}
 since(id,limit){return this.sql.exec('SELECT id,at,name,text,kind,key FROM messages WHERE id>? ORDER BY id ASC LIMIT ?',id,limit).toArray();}
 hasKey(key){return this.sql.exec('SELECT 1 FROM messages WHERE key=? AND key<>\'\' LIMIT 1',key).toArray().length>0;}
 insert(message){
  this.sql.exec('INSERT INTO messages(at,name,text,kind,key) VALUES(?,?,?,?,?)',message.at,message.name,message.text,message.kind,message.key);
  const id=Number(this.sql.exec('SELECT last_insert_rowid() AS id').one().id);
  this.sql.exec('DELETE FROM messages WHERE id<=(SELECT id FROM messages ORDER BY id DESC LIMIT 1 OFFSET ?)',CHAT_KEEP);
  return {...message,id};
 }
}
// The room's rules, independent of how messages travel.
export class ChatRoomCore{
 constructor(store,{now=()=>Date.now()}={}){this.store=store;this.now=now;this.limits=new Map();}
 prune(){return this.store.expire(this.now()-CHAT_TTL);}
 history(since=0){this.prune();return since>0?this.store.since(since,CHAT_PAGE):this.store.recent(CHAT_PAGE);}
 // One client (a socket or an address) cannot flood the room.
 allowed(client,gap=RATE_GAP){
  const now=this.now(),times=(this.limits.get(client)||[]).filter(t=>now-t<RATE_WINDOW);
  if(times.length>=RATE_MAX||times.length&&now-times.at(-1)<gap){this.limits.set(client,times);return false;}
  times.push(now);this.limits.set(client,times);if(this.limits.size>2000)this.limits.delete(this.limits.keys().next().value);return true;
 }
 post(data,client='anonymous',room=''){
  this.prune();
  const checked=validateChatMessage(data,room);if(checked.error)return checked;
  if(checked.kind==='event'&&this.store.hasKey(checked.key))return {duplicate:true};
  // Events (two scores in one tick) have their own bucket with no gap; the key dedup and the minute cap still bound them.
  if(!this.allowed(checked.kind==='event'?client+'#event':client,checked.kind==='event'?0:RATE_GAP))return {error:'Slow down a little.'};
  return {message:this.store.insert({at:this.now(),...checked})};
 }
}
async function readChatBody(request){
 if(Number(request.headers.get('Content-Length')||0)>4096)throw new Error('Message too long.');
 const text=await request.text();if(text.length>4096)throw new Error('Message too long.');
 return JSON.parse(text);
}
// A moderator key is a Worker secret, never a URL, cookie, or saved browser preference.
export function chatModerator(request,env={}){
 const key=env.CHAT_MODERATOR_KEY,provided=request.headers.get('Authorization')||'';
 if(typeof key!=='string'||key.length<32||key.length>256)return false;
 const expected='Bearer '+key;if(provided.length!==expected.length)return false;
 let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^provided.charCodeAt(i);
 return difference===0;
}
async function moderateChat(request,core){
 let body;try{body=await readChatBody(request);}catch{return chatJSON({error:'Choose a message or clear the room.'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||!(body.clear===true&&body.id===undefined||Number.isSafeInteger(body.id)&&body.id>0&&body.clear===undefined))return chatJSON({error:'Choose a message or clear the room.'},400);
 const removed=core.store.remove(body.clear===true?null:body.id);
 return chatJSON({ok:true,removed});
}
const retiredRoom=room=>room.endsWith(':lounge');
const chatClosed=()=>chatJSON({error:'Public lounges are closed. Connect a league to use Chat.'},410);
// Durable Object: one per room. Alarms remove expired rows even without viewers.
export class ChatRoom{
 constructor(state,env={}){this.state=state;this.env=env;this.core=new ChatRoomCore(new SqlChatStore(state.storage.sql));}
 async scheduleExpiry(){
  const oldest=this.core.store.oldest(),next=oldest===null?null:Math.max(Date.now()+1000,oldest+CHAT_TTL);
  const scheduled=await this.state.storage.getAlarm();
  if(next===null){if(scheduled!==null)await this.state.storage.deleteAlarm();}
  else if(scheduled===null||scheduled>next)await this.state.storage.setAlarm(next);
 }
 async alarm(){const removed=this.core.prune();if(removed.length)this.broadcast({type:'removed',ids:removed});await this.scheduleExpiry();}
 sockets(){return this.state.getWebSockets();}
 send(ws,data){try{ws.send(JSON.stringify(data));}catch{}}
 broadcast(data,except=null){const text=JSON.stringify(data);for(const ws of this.sockets())if(ws!==except)try{ws.send(text);}catch{}}
 presence(){this.broadcast({type:'presence',count:this.sockets().length});}
 async fetch(request){
  const url=new URL(request.url),room=url.searchParams.get('room')||'';
  if(!CHAT_ROOM.test(room))return chatJSON({error:'Choose a room.'},400);
  if(request.method==='DELETE'||url.searchParams.has('moderator')){
   if(!chatModerator(request,this.env))return chatJSON({error:'Moderator key required.'},403);
   if(request.method==='GET')return chatJSON({ok:true});
   if(request.method!=='DELETE')return chatJSON({error:'Use GET or DELETE.'},405);
   const response=await moderateChat(request,this.core),data=await response.clone().json();
   if(data.removed)this.broadcast({type:'removed',ids:data.removed});
   if(retiredRoom(room))for(const ws of this.sockets())try{ws.close(1008,'Public lounge closed');}catch{}
   await this.scheduleExpiry();return response;
  }
  if(retiredRoom(room))return chatClosed();
  const removed=this.core.prune();if(removed.length)this.broadcast({type:'removed',ids:removed});await this.scheduleExpiry();
  if(request.headers.get('Upgrade')==='websocket'){
   const pair=new WebSocketPair(),[client,server]=Object.values(pair);
   this.state.acceptWebSocket(server);server.serializeAttachment({ip:request.headers.get('cf-connecting-ip')||'anonymous',room:url.searchParams.get('room')||''});
   this.send(server,{type:'history',messages:this.core.history(0),count:this.sockets().length});this.presence();
   return new Response(null,{status:101,webSocket:client});
  }
  if(request.method==='GET')return chatJSON({messages:this.core.history(0),reset:true,count:this.sockets().length});
  if(request.method==='POST'){
   let body;try{body=await readChatBody(request);}catch(error){return chatJSON({error:error.message||'Send a message.'},400);}
   const result=this.core.post(body,request.headers.get('cf-connecting-ip')||'anonymous',url.searchParams.get('room')||'');
   if(result.error)return chatJSON({error:result.error},result.error==='Slow down a little.'?429:400);
   if(result.message){this.broadcast({type:'message',message:result.message});await this.scheduleExpiry();}
   return chatJSON({ok:true,...result});
  }
  return chatJSON({error:'Use GET or POST.'},405);
 }
 async webSocketMessage(ws,raw){
  if((typeof raw==='string'?raw.length:raw.byteLength)>4096){this.send(ws,{type:'rejected',reason:'Message too long.'});return;}
  let data;try{data=JSON.parse(typeof raw==='string'?raw:new TextDecoder().decode(raw));}catch{return;}
  const attached=ws.deserializeAttachment()||{};
  if(!CHAT_ROOM.test(attached.room||'')||retiredRoom(attached.room||'')){this.send(ws,{type:'history',messages:[]});try{ws.close(1008,'Public lounge closed');}catch{}return;}
  const removed=this.core.prune();if(removed.length)this.broadcast({type:'removed',ids:removed});
  if(data?.type==='ping'){this.send(ws,{type:'pong',count:this.sockets().length});return;}
  const result=this.core.post(data,attached.ip||'socket',attached.room||'');
  if(result.error){this.send(ws,{type:'rejected',reason:result.error,nonce:data?.nonce});return;}
  if(result.message){this.send(ws,{type:'message',message:result.message,nonce:data?.nonce});this.broadcast({type:'message',message:result.message},ws);await this.scheduleExpiry();}
  else this.send(ws,{type:'accepted',nonce:data?.nonce});
 }
 webSocketClose(ws){try{ws.close();}catch{}this.presence();}
 webSocketError(ws){try{ws.close();}catch{}this.presence();}
}
// Rooms for the local preview, which has no Durable Objects.
const memoryRooms=new Map();
export async function chatAPI(request,env={}){
 const url=new URL(request.url),room=url.searchParams.get('room')||'';
 if(!CHAT_ROOM.test(room))return chatJSON({error:'Choose a room.'},400);
 const origin=request.headers.get('Origin');if(origin&&!sameSite(origin,request.url))return chatJSON({error:'Invalid request origin.'},403);
 const moderation=request.method==='DELETE'||url.searchParams.has('moderator');
 if(moderation&&!chatModerator(request,env))return chatJSON({error:'Moderator key required.'},403);
 if(retiredRoom(room)&&!moderation)return chatClosed();
 if(env?.CHAT?.idFromName)return env.CHAT.get(env.CHAT.idFromName(room)).fetch(request);
 if(request.headers.get('Upgrade')==='websocket')return chatJSON({error:'Live sockets need the deployed site. Messages still arrive every few seconds.'},501);
 let core=memoryRooms.get(room);if(!core){core=new ChatRoomCore(new MemoryChatStore());memoryRooms.set(room,core);}
 if(moderation){
  if(request.method==='GET')return chatJSON({ok:true});
  if(request.method==='DELETE')return moderateChat(request,core);
  return chatJSON({error:'Use GET or DELETE.'},405);
 }
 if(request.method==='GET')return chatJSON({messages:core.history(0),reset:true,count:0});
 if(request.method==='POST'){
  let body;try{body=await readChatBody(request);}catch(error){return chatJSON({error:error.message||'Send a message.'},400);}
  const result=core.post(body,request.headers.get('cf-connecting-ip')||'local',room);
  if(result.error)return chatJSON({error:result.error},result.error==='Slow down a little.'?429:400);
  return chatJSON({ok:true,...result});
 }
 return chatJSON({error:'Use GET or POST.'},405);
}
