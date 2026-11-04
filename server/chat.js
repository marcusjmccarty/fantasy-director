// Room chat for people watching the same league. Each league (or, before a
// league is connected, a public lounge per sport) is one Durable Object that
// keeps its last few hundred messages in SQLite and pushes new ones over
// WebSockets. Without the binding (the local preview server) an in-memory
// room answers the same HTTP calls, so the tab still works, just by polling.
// Nothing here is private: anyone with the league ID can read the room.
import {sameSite} from './api.js';
const CHAT_ROOM=/^(nfl|nba|nhl|mlb):(league:\d{1,12}|lounge)$/;
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
 recent(limit){return this.rows.slice(-limit);}
 since(id,limit){return this.rows.filter(m=>m.id>id).slice(0,limit);}
 hasKey(key){return this.rows.some(m=>m.key===key);}
 insert(message){const row={...message,id:this.next++};this.rows.push(row);if(this.rows.length>CHAT_KEEP)this.rows.splice(0,this.rows.length-CHAT_KEEP);return row;}
}
class SqlChatStore{
 constructor(sql){this.sql=sql;sql.exec('CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,name TEXT NOT NULL,text TEXT NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL DEFAULT \'\')');sql.exec('CREATE INDEX IF NOT EXISTS messages_key ON messages(key)');}
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
 history(since=0){return since>0?this.store.since(since,CHAT_PAGE):this.store.recent(CHAT_PAGE);}
 // One client (a socket or an address) cannot flood the room.
 allowed(client,gap=RATE_GAP){
  const now=this.now(),times=(this.limits.get(client)||[]).filter(t=>now-t<RATE_WINDOW);
  if(times.length>=RATE_MAX||times.length&&now-times.at(-1)<gap){this.limits.set(client,times);return false;}
  times.push(now);this.limits.set(client,times);if(this.limits.size>2000)this.limits.delete(this.limits.keys().next().value);return true;
 }
 post(data,client='anonymous',room=''){
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
// Durable Object: one per room. Sockets hibernate between messages.
export class ChatRoom{
 constructor(state){this.state=state;this.core=new ChatRoomCore(new SqlChatStore(state.storage.sql));}
 sockets(){return this.state.getWebSockets();}
 send(ws,data){try{ws.send(JSON.stringify(data));}catch{}}
 broadcast(data){const text=JSON.stringify(data);for(const ws of this.sockets())try{ws.send(text);}catch{}}
 presence(){this.broadcast({type:'presence',count:this.sockets().length});}
 async fetch(request){
  const url=new URL(request.url);
  if(request.headers.get('Upgrade')==='websocket'){
   const pair=new WebSocketPair(),[client,server]=Object.values(pair);
   this.state.acceptWebSocket(server);server.serializeAttachment({ip:request.headers.get('cf-connecting-ip')||'anonymous',room:url.searchParams.get('room')||''});
   this.send(server,{type:'history',messages:this.core.history(0),count:this.sockets().length});this.presence();
   return new Response(null,{status:101,webSocket:client});
  }
  if(request.method==='GET')return chatJSON({messages:this.core.history(Number(url.searchParams.get('since')||0)),count:this.sockets().length});
  if(request.method==='POST'){
   let body;try{body=await readChatBody(request);}catch(error){return chatJSON({error:error.message||'Send a message.'},400);}
   const result=this.core.post(body,request.headers.get('cf-connecting-ip')||'anonymous',url.searchParams.get('room')||'');
   if(result.error)return chatJSON({error:result.error},result.error==='Slow down a little.'?429:400);
   if(result.message)this.broadcast({type:'message',message:result.message});
   return chatJSON({ok:true,...result});
  }
  return chatJSON({error:'Use GET or POST.'},405);
 }
 webSocketMessage(ws,raw){
  let data;try{data=JSON.parse(typeof raw==='string'?raw:new TextDecoder().decode(raw));}catch{return;}
  if(data?.type==='ping'){this.send(ws,{type:'pong',count:this.sockets().length});return;}
  const attached=ws.deserializeAttachment()||{};
  const result=this.core.post(data,attached.ip||'socket',attached.room||'');
  if(result.error){this.send(ws,{type:'rejected',reason:result.error,nonce:data.nonce});return;}
  if(result.message)this.broadcast({type:'message',message:result.message,nonce:data.nonce});
  else this.send(ws,{type:'accepted',nonce:data.nonce});
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
 if(env?.CHAT?.idFromName)return env.CHAT.get(env.CHAT.idFromName(room)).fetch(request);
 if(request.headers.get('Upgrade')==='websocket')return chatJSON({error:'Live sockets need the deployed site. Messages still arrive every few seconds.'},501);
 let core=memoryRooms.get(room);if(!core){core=new ChatRoomCore(new MemoryChatStore());memoryRooms.set(room,core);}
 if(request.method==='GET')return chatJSON({messages:core.history(Number(url.searchParams.get('since')||0)),count:0});
 if(request.method==='POST'){
  let body;try{body=await readChatBody(request);}catch(error){return chatJSON({error:error.message||'Send a message.'},400);}
  const result=core.post(body,request.headers.get('cf-connecting-ip')||'local',room);
  if(result.error)return chatJSON({error:result.error},result.error==='Slow down a little.'?429:400);
  return chatJSON({ok:true,...result});
 }
 return chatJSON({error:'Use GET or POST.'},405);
}
