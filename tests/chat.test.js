import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatRoomCore,MemoryChatStore,validateChatMessage,cleanChatName,cleanChatText,chatAPI} from '../server/chat.js';
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
 assert.equal((await chatAPI(new Request('https://site.test/api/chat?room=nhl:lounge',{headers:{Origin:'https://other.test'}}),{})).status,403);
 const post=await chatAPI(new Request('https://site.test/api/chat?room=nhl:lounge',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test'},body:JSON.stringify({name:'Marcus',text:'hello'})}),{});
 assert.equal(post.status,200);const sent=await post.json();assert.equal(sent.message.name,'Marcus');
 const get=await (await chatAPI(new Request('https://site.test/api/chat?room=nhl:lounge&since=0'),{})).json();assert.equal(get.messages.length,1);
 assert.equal((await chatAPI(new Request('https://site.test/api/chat?room=nhl:lounge',{method:'POST',body:'x'.repeat(5000)}),{})).status,400);
 assert.equal((await chatAPI(new Request('https://site.test/api/chat?room=nhl:lounge',{headers:{Upgrade:'websocket'}}),{})).status,501);
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
 assert.equal(chatRoomFor('nfl','123'),'nfl:league:123');assert.equal(chatRoomFor('nhl',''),'nhl:lounge');assert.equal(chatRoomFor('nba','12345678901234'),'nba:lounge');
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
 chat.setRoom('nfl:lounge','NFL lounge');chat.event('TD','x');await new Promise(r=>setTimeout(r,0));assert.equal(posted.filter(p=>p.kind==='event').length,1,'the public lounge gets no scoring events');
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
 await Promise.all([first,second]);assert.deepEqual(seen,['history:league']);assert.equal(client.messages.length,1);
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
