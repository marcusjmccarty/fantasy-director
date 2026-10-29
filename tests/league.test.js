import test from 'node:test';
import assert from 'node:assert/strict';
import {leagueAPI,normalizedLeague,sessionAPI} from '../server/api.js';
const raw={settings:{name:'Test league'},teams:[{id:1,name:'My Team',owners:['{OWNER}'],roster:{entries:[{lineupSlotId:0,playerPoolEntry:{player:{id:1,fullName:'Starter',proTeamId:21,defaultPositionId:1}}},{lineupSlotId:20,playerPoolEntry:{player:{id:2,fullName:'Bench',proTeamId:3,defaultPositionId:3}}}]}}]};
const env={ESPN_OWNER_ID:'site-scoped-owner',ESPN_LEAGUE_ID:'123',ESPN_SWID:'{OWNER}',ESPN_S2:'private-cookie'};
const req=(id,owner='site-scoped-owner')=>new Request('https://test.example/api/league',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{})},body:JSON.stringify({leagueId:id,season:2026})});

test('imports only starters and matches the owner team without exposing ownership',()=>{
 const d=normalizedLeague(raw,'{OWNER}');assert.equal(d.ownedTeamId,'1');assert.equal(d.teams[0].players.length,1);assert.equal(d.teams[0].players[0].team,'PHI');assert.equal(JSON.stringify(d).includes('{OWNER}'),false);
});
test('private cookies are confined to the exact ESPN host and configured league',async()=>{
 for(const [id,wanted] of [['123',true],['456',false]]){
  let cookie;const r=await leagueAPI(req(id),env,async(url,options)=>{
   assert.equal(new URL(url).hostname,'lm-api-reads.fantasy.espn.com');cookie=options.headers.Cookie;return Response.json(raw);
  });
  assert.equal(r.status,200);assert.equal(Boolean(cookie),wanted);assert.equal((await r.text()).includes('private-cookie'),false);
 }
});
test('Workers-compatible manual redirect mode imports successfully',async()=>{
 const r=await leagueAPI(req('123'),env,async(url,options)=>{
  // Cloudflare Workers rejects redirect:error before sending any request.
  if(options.redirect==='error')throw new TypeError('Unsupported redirect mode');
  assert.equal(options.redirect,'manual');return Response.json(raw);
 });
 assert.equal(r.status,200);assert.equal((await r.json()).ownedTeamId,'1');
});
test('upstream redirects are never followed with private cookies',async()=>{
 let calls=0;const r=await leagueAPI(req('123'),env,async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://unrelated.example'}});});
 assert.equal(calls,1);assert.equal(r.status,502);assert.equal((await r.json()).code,'ESPN_REDIRECT');
});
test('account UUID, another Site identity, and service access cannot use the saved connection',async()=>{
 for(const user of ['account-uuid','different-site-owner',null]){
  const r=await leagueAPI(req('123',user),env,()=>{throw new Error('Must not fetch');});
  assert.equal(r.status,403);assert.equal((await r.json()).code,'CONNECTION_IDENTITY');
 }
});
test('session discovery advertises the configured league only to its Site-scoped owner',async()=>{
 for(const user of ['site-scoped-owner','account-uuid',null]){
  const request=new Request('https://test.example/api/session',{headers:user?{'oai-authenticated-user-id':user}:{}});
  const r=sessionAPI(request,env);assert.equal(r.headers.get('cache-control'),'no-store');
  const data=await r.json();assert.equal(data.userId,user);assert.equal(data.savedLeagueId,user==='site-scoped-owner'?'123':null);assert.equal(JSON.stringify(data).includes('private-cookie'),false);
 }
});
test('missing credentials surface as configuration failure, not a misleading private-league error',async()=>{
 const r=await leagueAPI(req('123'),{...env,ESPN_S2:''},()=>{throw new Error('Must not fetch');});
 assert.equal(r.status,503);assert.equal((await r.json()).code,'CONNECTION_MISSING');
});
test('rejects invalid ID without contacting upstream',async()=>{
 const r=await leagueAPI(req('../secret'),env,()=>{throw new Error('Must not fetch');});assert.equal(r.status,400);
});
test('upstream access denial, network failure and timeout are distinct',async()=>{
 assert.equal((await leagueAPI(req('123'),env,async()=>new Response('',{status:401}))).status,401);
 assert.equal((await leagueAPI(req('123'),env,async()=>{throw new Error('network');})).status,502);
 const timeout=await leagueAPI(req('123'),env,async()=>{throw new DOMException('Timeout','TimeoutError');});
 assert.equal(timeout.status,504);assert.equal((await timeout.json()).code,'ESPN_TIMEOUT');
});
test('cross-origin posts cannot consume the saved connection',async()=>{
 const r=req('123');r.headers.set('Origin','https://unrelated.example');assert.equal((await leagueAPI(r,env)).status,403);
});
