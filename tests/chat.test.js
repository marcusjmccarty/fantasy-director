import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_TTL,ChatRoom,SqlChatStore,ChatRoomCore,MemoryChatStore,validateChatMessage,cleanChatName,cleanChatText,chatAPI} from '../server/chat.js';
import {ChatClient,chatMessageHTML,chatText,chatRoomFor,mountChat} from '../web/chat.js';

test('chat rules: names and text are trimmed, bounded and free of control characters; events need a key',()=>{
 assert.equal(cleanChatName('  Mar\u0000cus  <b>  '),'Marcus b');
 assert.equal(cleanChatName('x'.repeat(40)).length,24);
 assert.equal(cleanChatText('  hi \n\n\n\n there\u0007 '),'hi\n\nthere');
 assert.deepEqual(validateChatMessage({name:'M',text:'Go!'}),{kind:'chat',name:'M',text:'Go!',key:''});
 assert.equal(validateChatMessage({name:'',text:'Go!'}).error,'Choose a name first.');
 assert.equal(validateChatMessage({name:'M',text:'   '}).error,'Write something first.');
 assert.equal(validateChatMessage({kind:'event',text:'TD'},'nfl:league:1').error,'An event needs a key.');
 assert.deepEqual(validateChatMessage({kind:'event',text:'TD · Taylor',key:'401:12 <x>'},'nfl:league:5'),{kind:'event',name:'',text:'TD · Taylor',key:'401:12x'});
 assert.equal(validateChatMessage({kind:'event',text:'TD',key:'k'},'nfl:lounge').error,'Only a league room carries events.');
 assert.equal(validateChatMessage(null).error,'Send a message.');
});
test('chat room: messages get ids in order, history pages by id, the room keeps its last 300 and events post once',()=>{
 let now=1000;const core=new ChatRoomCore(new MemoryChatStore(),{now:()=>now});
 const a=core.post({name:'A',text:'one'},'a');now+=2000;const b=core.post({name:'B',text:'two'},'b');
 assert.equal(a.message.id,1);assert.equal(b.message.id,2);assert.equal(b.message.at,3000);
 assert.deepEqual(core.history(0).map(m=>m.text),['one','two']);assert.deepEqual(core.history(1).map(m=>m.text),['two']);
 now+=2000;assert.ok(core.post({kind:'event',text:'TD · Taylor',key:'g:1'},'a','nfl:league:1').message);assert.deepEqual(core.post({kind:'event',text:'TD · Taylor',key:'g:1'},'c','nfl:league:1'),{duplicate:true});
 assert.ok(core.post({kind:'event',text:'FG · Gay',key:'g:2'},'a','nfl:league:1').message,'two scores in one tick both post');assert.ok(core.post({name:'A',text:'wow'},'a','nfl:league:1').message,'and a word right after is not refused');
 for(let i=0;i<400;i++){now+=2000;core.post({name:'A',text:'m'+i},'x'+(i%50));}
 assert.equal(core.history(0).length,120);assert.equal(core.store.rows.length,300);assert.equal(core.store.rows[0].text,'m100');
});
test('chat room: one client cannot flood it',()=>{
 let now=0;const core=new ChatRoomCore(new MemoryChatStore(),{now:()=>now});
 assert.ok(core.post({name:'A',text:'1'},'a').message);assert.equal(core.post({name:'A',text:'2'},'a').error,'Slow down a little.');
 now=1500;assert.ok(core.post({name:'A',text:'3'},'a').message);assert.ok(core.post({name:'B',text:'4'},'b').message,'another client is unaffected');
 for(let i=0;i<40;i++){now+=1500;core.post({name:'A',text:'x'+i},'a');}
 assert.equal(core.post({name:'A',text:'too many'},'a').error,'Slow down a little.');now+=61000;assert.ok(core.post({name:'A',text:'later'},'a').message);
});
test('chat API: rooms are validated, cross-site origins refused, and the memory fallback serves plain requests',async()=>{
 assert.equal((await chatAPI(new Request('https://site.test/api/chat?room=nfl:league:12;drop'),{})).status,400);
 assert.equal((await chatAPI(new Request('https://site.test/api/chat?room=nhl:league:120',{headers:{Origin:'https://other.test'}}),{})).status,403);
 const post=await chatAPI(new Request('https://site.test/api/chat?room=nhl:league:120',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test'},body:JSON.stringify({name:'Marcus',text:'hello'})}),{});
 assert.equal(post.status,200);const sent=await post.json();assert.equal(sent.message.name,'Marcus');
 const get=await (await chatAPI(new Request('https://site.test/api/chat?room=nhl:league:120&since=0'),{})).json();assert.equal(get.messages.length,1);
 assert.equal((await chatAPI(new Request('https://site.test/api/chat?room=nhl:league:120',{method:'POST',body:'x'.repeat(5000)}),{})).status,400);
 assert.equal((await chatAPI(new Request('https://site.test/api/chat?room=nhl:league:120',{headers:{Upgrade:'websocket'}}),{})).status,501);
 // With the binding present the request goes to the room's object.
 let got=null;const env={CHAT:{idFromName:name=>'id:'+name,get:id=>({fetch:async request=>{got=id+' '+request.url;return new Response('ok');}})}};
 await chatAPI(new Request('https://site.test/api/chat?room=mlb:league:7'),env);assert.equal(got,'id:mlb:league:7 https://site.test/api/chat?room=mlb:league:7');
});
function fakeSockets(){
 const sockets=[];const factory=url=>{const ws={url,sent:[],closed:false,send(s){this.sent.push(JSON.parse(s));},close(){this.closed=true;setTimeout(()=>ws.onclose?.(),0);}};sockets.push(ws);return ws;};
 return {sockets,factory};
}
test('chat client: history then live messages over a socket, deduplicated, with send acknowledgements',async()=>{
 const {sockets,factory}=fakeSockets(),seen=[],states=[];let history=null;
 const client=new ChatClient({room:'nfl:league:1',origin:'https://site.test',socket:factory,fetcher:async()=>{throw new Error('no fetch expected');},onHistory:m=>{history=m.slice();},onMessage:m=>seen.push(m.text),onState:s=>states.push(s)});
 client.connect();const ws=sockets[0];assert.equal(ws.url,'wss://site.test/api/chat?room=nfl%3Aleague%3A1');ws.onopen();
 ws.onmessage({data:JSON.stringify({type:'history',messages:[{id:1,at:1,name:'A',text:'one',kind:'chat'},{id:2,at:2,name:'B',text:'two',kind:'chat'}],count:2})});
 assert.deepEqual(history.map(m=>m.text),['one','two']);
 ws.onmessage({data:JSON.stringify({type:'message',message:{id:3,at:3,name:'C',text:'three',kind:'chat'}})});
 ws.onmessage({data:JSON.stringify({type:'message',message:{id:3,at:3,name:'C',text:'three',kind:'chat'}})});
 assert.deepEqual(seen,['three']);assert.equal(client.lastId,3);
 const sending=client.send({kind:'chat',name:'Me',text:'four'});const nonce=ws.sent.at(-1).nonce;assert.ok(nonce);
 ws.onmessage({data:JSON.stringify({type:'message',message:{id:4,at:4,name:'Me',text:'four',kind:'chat'},nonce})});
 assert.deepEqual(await sending,{ok:true});assert.deepEqual(seen,['three','four']);
 const refused=client.send({kind:'chat',name:'Me',text:'spam'});ws.onmessage({data:JSON.stringify({type:'rejected',reason:'Slow down a little.',nonce:ws.sent.at(-1).nonce})});
 assert.deepEqual(await refused,{error:'Slow down a little.'});
 assert.deepEqual(states,['connecting','live']);client.close();assert.equal(ws.closed,true);
});
test('chat client: when sockets never open it polls over plain requests, and sends by POST',async()=>{
 const calls=[];const fetcher=async(url,init={})=>{calls.push((init.method||'GET')+' '+url);if(init.method==='POST')return Response.json({ok:true,message:{id:9,at:9,name:'Me',text:JSON.parse(init.body).text,kind:'chat'}});return Response.json({messages:[{id:5,at:5,name:'A',text:'polled',kind:'chat'}],count:0});};
 const timers=[];let auto=1;const timer=(fn,ms)=>{if(auto-->0){fn();return 0;}timers.push({fn,ms});return timers.length;},cancel=()=>{};
 const seen=[],states=[];const client=new ChatClient({room:'nba:lounge',origin:'https://site.test',socket:()=>{throw new Error('blocked');},fetcher,timer,cancel,onMessage:m=>seen.push(m.text),onHistory:m=>seen.push('history:'+m.length),onState:s=>states.push(s)});
 client.connect();
 assert.equal(states.at(-1),'polling','two failed socket opens fall back to polling');assert.ok(states.includes('reconnecting'));
 const poll=timers.find(t=>t.ms===0);await poll.fn();assert.deepEqual(seen,['history:1']);assert.match(calls[0],/GET https:\/\/site\.test\/api\/chat\?room=nba%3Alounge&since=0/);
 const result=await client.send({kind:'chat',name:'Me',text:'hi'});assert.deepEqual(result,{ok:true,duplicate:false});assert.deepEqual(seen,['history:1','hi']);assert.match(calls.at(-1),/^POST /);
 client.close();
});
test('chat rendering: text is escaped, https links become links, events read differently, and rooms are named by league',()=>{
 assert.equal(chatText('<b>hi</b> https://example.com/path/that/is/long?x=1 http://nope'),'&lt;b&gt;hi&lt;/b&gt; <a href="https://example.com/path/that/is/long?x=1" target="_blank" rel="noopener noreferrer nofollow">example.com/path/that/is/long</a> http://nope');
 assert.equal(chatText('see https://www.youtube.com/watch?v=abc&t=10s "quoted"'),'see <a href="https://www.youtube.com/watch?v=abc&amp;t=10s" target="_blank" rel="noopener noreferrer nofollow">www.youtube.com/watch</a> &quot;quoted&quot;');
 assert.match(chatMessageHTML({id:1,at:0,name:'A<',text:'x',kind:'chat'},'B'),/^<li class="chat-msg" data-id="1"><span class="chat-name">A&lt;<\/span>/);
 assert.match(chatMessageHTML({id:1,at:0,name:'B',text:'x',kind:'chat'},'B'),/class="chat-msg mine"/);
 assert.match(chatMessageHTML({id:2,at:0,name:'',text:'TD · Taylor',kind:'event'}),/^<li class="chat-event"/);
 assert.equal(chatRoomFor('nfl','123'),'nfl:league:123');assert.equal(chatRoomFor('nhl',''),'');assert.equal(chatRoomFor('nba','12345678901234'),'');
});
test('chat tab: the controller asks for a name before the first message, counts unread lines while hidden and posts league events once',async()=>{
 const els=new Map();const el=id=>{if(!els.has(id)){const e={id,hidden:false,value:'',textContent:'',innerHTML:'',className:'',disabled:false,scrollTop:0,scrollHeight:0,clientHeight:0,insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelector(){return null;},focus(){this.focused=true;}};els.set(id,e);}return els.get(id);};
 const posted=[];const fetcher=async(url,init={})=>{if(init.method==='POST'){const body=JSON.parse(init.body);posted.push(body);return Response.json({ok:true,message:{id:posted.length,at:1,...body}});}return Response.json({messages:[],count:3});};
 let name='',open=false;const timers=[];
 const chat=mountChat({$:el,sport:'nfl',origin:'https://site.test',getName:()=>name,setName:v=>{name=v;},defaultName:()=>'',isOpen:()=>open,fetcher,socket:null,timer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},cancel:()=>{}});
 chat.setRoom('nfl:league:5','Fantasy Fam chat');assert.equal(el('chatRoomName').textContent,'Fantasy Fam chat');
 await timers.find(t=>t.ms===0).fn();assert.equal(el('chatPresence').textContent,'3 here');
 el('chatInput').value='hello';await el('chatForm').onsubmit({preventDefault(){}});assert.equal(el('chatNameRow').hidden,false);assert.equal(posted.length,0);assert.match(el('chatState').textContent,/Choose a name/);
 el('chatName').value='  Marcus ';el('chatNameSave').onclick();assert.equal(name,'Marcus');assert.equal(el('chatNameButton').textContent,'Marcus');
 await el('chatForm').onsubmit({preventDefault(){}});assert.equal(posted.length,1);assert.equal(posted[0].text,'hello');assert.equal(el('chatInput').value,'');assert.match(el('chatLog').innerHTML,/chat-msg mine/);
 chat.client.receive({type:'message',message:{id:50,at:1,name:'Other',text:'yo',kind:'chat'}});assert.equal(el('chatCount').textContent,'1');
 open=true;chat.markRead();assert.equal(el('chatCount').textContent,'');
 chat.event('TD · Taylor · 12 yd run','401:7');await new Promise(r=>setTimeout(r,0));assert.equal(posted.at(-1).kind,'event');assert.equal(posted.at(-1).key,'401:7');
 chat.setRoom('','');assert.equal(el('chatTab').hidden,true);assert.equal(chat.client.messages.length,0);chat.event('TD','x');await new Promise(r=>setTimeout(r,0));assert.equal(posted.filter(p=>p.kind==='event').length,1,'the public lounge gets no scoring events');
});

test('chat client: with no page origin (a sandbox) it never connects or polls',()=>{
 let calls=0;const client=new ChatClient({room:'nfl:lounge',fetcher:async()=>{calls++;return Response.json({messages:[]});},socket:()=>{calls++;throw new Error('x');},timer:fn=>{calls++;fn();return 1;}});
 client.connect();client.setRoom('nfl:league:9');assert.equal(calls,0);assert.equal(client.state,'idle');
});

test('chat client: a room switch while a poll is in flight ignores the old room’s answer and keeps one poll chain',async()=>{
 const pending=[];const fetcher=(url)=>new Promise(resolve=>pending.push({url,resolve}));
 const timers=[];const timer=(fn,ms)=>{timers.push({fn,ms});return timers.length;},cancel=id=>{if(timers[id-1])timers[id-1].cancelled=true;};
 const seen=[];const client=new ChatClient({room:'nfl:lounge',origin:'https://site.test',socket:null,fetcher,timer,cancel,onHistory:m=>seen.push('history:'+m.map(x=>x.text).join(',')),onMessage:m=>seen.push('msg:'+m.text)});
 client.connect();const first=timers.find(t=>t.ms===0&&!t.cancelled).fn();await new Promise(r=>setTimeout(r,0));assert.equal(pending.length,1);
 client.setRoom('nfl:league:7');const second=timers.filter(t=>t.ms===0&&!t.cancelled).at(-1).fn();await new Promise(r=>setTimeout(r,0));assert.equal(pending.length,2);
 pending[1].resolve(Response.json({messages:[{id:1,at:1,name:'L',text:'league',kind:'chat'}],count:1}));await new Promise(r=>setTimeout(r,0));
 pending[0].resolve(Response.json({messages:[{id:3,at:1,name:'Lounge',text:'lounge line',kind:'chat'}],count:9}));await new Promise(r=>setTimeout(r,0));
 await Promise.all([first,second]);assert.deepEqual(seen,['history:','history:league']);assert.equal(client.messages.length,1);
 assert.equal(timers.filter(t=>t.ms===4000&&!t.cancelled).length,1,'only the live room re-arms a poll');client.close();
});
test('chat client: a socket that drops right after opening counts as a failure, and a late send answer drops the socket',async()=>{
 const {sockets,factory}=fakeSockets();const timers=[];const timer=(fn,ms)=>{timers.push({fn,ms});return timers.length;},cancel=id=>{if(timers[id-1])timers[id-1].cancelled=true;};
 const states=[];const client=new ChatClient({room:'nfl:league:1',origin:'https://site.test',socket:factory,fetcher:async()=>Response.json({messages:[]}),timer,cancel,onState:s=>states.push(s)});
 client.connect();sockets[0].onopen();assert.equal(client.failures,0);sockets[0].onclose();assert.equal(client.failures,1,'an immediate close is a failure');assert.equal(states.at(-1),'reconnecting');
 const retry=timers.filter(t=>!t.cancelled&&t.ms>=2000).at(-1);retry.fn();const ws=sockets.at(-1);ws.onopen();
 const sending=client.send({kind:'chat',name:'Me',text:'hi'});const wait=timers.filter(t=>t.ms===8000).at(-1);wait.fn();
 assert.deepEqual(await sending,{error:'The room did not answer. Try again.'});assert.equal(client.ws,null);assert.equal(ws.closed,true);client.close();
});


test('public lounges are closed over GET, POST and WebSocket, even with a Durable Object binding',async()=>{
 let routed=0;const env={CHAT:{idFromName(){routed++;throw Error('must not route');}}};
 for(const sport of ['nfl','nba','nhl','mlb'])for(const init of [{},{method:'POST',body:'{}'},{headers:{Upgrade:'websocket'}}]){
  const response=await chatAPI(new Request('https://site.test/api/chat?room='+sport+':lounge',init),env);
  assert.equal(response.status,410);assert.match((await response.json()).error,/closed/);
 }
 assert.equal(routed,0);
});
test('retention deletes at 24 hours, even before a new post, without resetting message IDs',()=>{
 let now=1000;const store=new MemoryChatStore(),core=new ChatRoomCore(store,{now:()=>now});
 const first=core.post({name:'A',text:'old'},'a').message;now+=5000;
 const second=core.post({name:'B',text:'recent'},'b').message;
 now=first.at+CHAT_TTL;assert.deepEqual(core.history().map(m=>m.id),[second.id]);assert.equal(store.rows.length,1);
 now=second.at+CHAT_TTL;assert.deepEqual(core.history(),[]);
 assert.ok(core.post({name:'C',text:'new'},'c').message.id>second.id);
});
test('moderation fails closed, rejects cross-site and ambiguous deletes, and removes or clears the actual room',async()=>{
 const key='k'.repeat(48),env={CHAT_MODERATOR_KEY:key},url='https://site.test/api/chat?room=nfl:league:992';
 const call=(method,body,auth,origin='https://site.test')=>chatAPI(new Request(url,{method,headers:{Origin:origin,...(auth?{Authorization:'Bearer '+auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 await call('POST',{name:'Test',text:'remove me'});
 for(const bad of [undefined,'wrong','k'.repeat(47)+'x']){
  assert.equal((await call('DELETE',{id:1},bad)).status,403);
  assert.equal((await (await call('GET')).json()).messages.length,1);
 }
 assert.equal((await call('DELETE',{clear:true},key,'https://evil.test')).status,403);
 for(const body of [{id:0},{id:'1'},{id:1,clear:true},null,[]])assert.equal((await call('DELETE',body,key)).status,400);
 assert.equal((await chatAPI(new Request(url+'&moderator=1',{headers:{Authorization:'Bearer '+key}}),env)).status,200);
 assert.equal((await chatAPI(new Request(url+'&moderator=1',{headers:{Authorization:'Bearer '+key}}),{})).status,403);
 assert.deepEqual((await (await call('DELETE',{id:1},key)).json()).removed,[1]);
 assert.deepEqual((await (await call('GET')).json()).messages,[]);
 assert.equal((await call('DELETE',{clear:true},key)).status,200);
 for(const sport of ['nfl','nba','nhl','mlb'])assert.equal((await chatAPI(new Request('https://site.test/api/chat?room='+sport+':lounge',{method:'DELETE',headers:{Authorization:'Bearer '+key},body:'{"clear":true}'}),env)).status,200);
});
test('snapshots and reconnects replace deleted history; live removals clear it too',()=>{
 const client=new ChatClient(),history=[],fresh=[];client.onHistory=m=>history.push(m.map(x=>x.id));client.onMessage=(m,own,rendered)=>fresh.push([m.id,rendered]);
 const a={id:1,text:'old'},b={id:2,text:'new'};
 client.receive({type:'history',messages:[a]});
 client.receive({type:'messages',reset:true,messages:[b]});
 assert.deepEqual(client.messages,[b]);assert.deepEqual(fresh,[[2,true]]);
 client.receive({type:'history',messages:[]});assert.deepEqual(client.messages,[]);
 client.receive({type:'message',message:b});client.receive({type:'removed',ids:[2]});assert.deepEqual(client.messages,[]);
 assert.deepEqual(history,[[1],[2],[],[]]);
});
test('switching leagues clears immediately, resolves pending sends and ignores stale socket callbacks',async()=>{
 const {sockets,factory}=fakeSockets(),timers=[];
 const client=new ChatClient({origin:'https://site.test',socket:factory,timer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},cancel:()=>{}});
 client.setRoom('nfl:league:1');const old=sockets[0];old.onopen();
 old.onmessage({data:JSON.stringify({type:'message',message:{id:1,text:'old room'}})});
 const pending=client.send({name:'Me',text:'waiting'});
 client.setRoom('nfl:league:2');assert.deepEqual(client.messages,[]);assert.match((await pending).error,/room changed/);
 old.onopen();old.onmessage({data:JSON.stringify({type:'message',message:{id:9,text:'late'}})});
 assert.deepEqual(client.messages,[]);assert.equal(client.state,'connecting');
 client.setRoom('');assert.equal(client.closed,true);client.close();
});
test('moderator requests use authorization headers, never URL or message bodies',async()=>{
 const key='secret'.repeat(8),calls=[];
 const client=new ChatClient({room:'nfl:league:1',origin:'https://site.test',fetcher:async(url,options)=>{calls.push({url,options});return Response.json({ok:true,removed:[1]});}});
 client.messages=[{id:1,text:'bad'}];
 assert.deepEqual(await client.moderate(null,key),{ok:true});
 assert.deepEqual(await client.moderate({id:1},key),{ok:true});assert.deepEqual(client.messages,[]);
 for(const {url,options} of calls){assert.ok(!url.includes(key));assert.equal(options.headers.Authorization,'Bearer '+key);assert.ok(!String(options.body).includes(key));}
 assert.match(chatMessageHTML({id:1,text:'bad',kind:'chat'},'',true),/data-remove-message="1"/);
 assert.doesNotMatch(chatMessageHTML({id:1,text:'bad',kind:'chat'}),/data-remove-message/);
});
test('SQLite retention, alarms, moderation broadcasts and old-lounge cleanup work together',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(':memory:');
 const sql={exec(query,...args){const rows=db.prepare(query).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}};
 let next=null;const seen=[],ws={send:text=>seen.push(JSON.parse(text)),close(){this.closed=true;},deserializeAttachment:()=>({room:'nfl:lounge',ip:'a'})};
 const state={storage:{sql,getAlarm:async()=>next,setAlarm:async value=>{next=value;},deleteAlarm:async()=>{next=null;}},getWebSockets:()=>[ws]};
 const key='s'.repeat(48),room=new ChatRoom(state,{CHAT_MODERATOR_KEY:key}),now=Date.now();
 room.core.store.insert({at:now-CHAT_TTL-1,name:'Old',text:'expired',kind:'chat',key:''});
 const fresh=room.core.store.insert({at:now,name:'A',text:'fresh',kind:'chat',key:''});
 const response=await room.fetch(new Request('https://site.test/api/chat?room=nfl:league:12'));assert.equal(response.status,200);
 assert.deepEqual((await response.json()).messages.map(m=>m.id),[fresh.id]);assert.ok(next>=now+CHAT_TTL);
 assert.deepEqual(seen[0],{type:'removed',ids:[1]});
 room.core.now=()=>now+CHAT_TTL+1;next=null;await room.alarm();assert.deepEqual(room.core.history(),[]);assert.equal(next,null);
 const legacy=room.core.store.insert({at:now,name:'Test',text:'legacy test',kind:'chat',key:''});
 assert.equal((await room.fetch(new Request('https://site.test/api/chat?room=nfl:lounge'))).status,410);
 const cleared=await room.fetch(new Request('https://site.test/api/chat?room=nfl:lounge',{method:'DELETE',headers:{Authorization:'Bearer '+key},body:'{"clear":true}'}));
 assert.deepEqual((await cleared.json()).removed,[legacy.id]);assert.equal(ws.closed,true);assert.equal(room.core.store.oldest(),null);
 db.close();
});

test('late polls and socket messages cannot resurrect a locally acknowledged removal',()=>{
 const client=new ChatClient({socket:null}),message={id:1,text:'removed'};
 client.receive({type:'history',messages:[message]});client.receive({type:'removed',ids:[1]});
 client.receive({type:'messages',reset:true,messages:[message]});client.receive({type:'message',message});
 assert.deepEqual(client.messages,[]);
 client.setRoom('nfl:league:2');client.receive({type:'history',messages:[message]});
 assert.deepEqual(client.messages,[message],'IDs in another room are independent');client.close();
});
