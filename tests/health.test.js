import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackHealthAPI} from '../server/media.js';
const env={ESPN_LOCAL:true,ESPN_OWNER_ID:'site-owner'},catalog=[{id:'game-1'}];
const request=(data,headers={})=>new Request('http://localhost/api/playback-health',{method:'POST',headers:{Origin:'http://localhost',...headers},body:JSON.stringify(data)});

test('playback health reports only bounded catalog and readiness fields',async()=>{
 const logs=[],logger={error:value=>logs.push(JSON.parse(value)),info:value=>logs.push(JSON.parse(value))};
 const result=await playbackHealthAPI(request({event:'failed',game:'game-1',code:'TIMEOUT_PLAY',phase:'play',imported:14,readyState:1,providerInitialized:true,providerProgress:0,credentials:'must-not-log',url:'https://example.test/private-token',message:'must-not-log'}),catalog,env,logger);
 assert.equal(result.status,200);assert.deepEqual(logs,[{kind:'playback-health',build:'fantasy-stream-3',event:'failed',game:'game-1',code:'TIMEOUT_PLAY',phase:'play',imported:14,readyState:1,networkState:0,providerInitialized:true,providerProgress:0}]);
});

test('playback health rejects public requests, other origins, invalid games and oversized reports',async()=>{
 const logger={error(){assert.fail('Rejected report must not be logged');},info(){assert.fail('Rejected report must not be logged');}},data={event:'failed',game:'game-1'};
 const publicRequest=new Request('https://site.test/api/playback-health',{method:'POST',headers:{Origin:'https://site.test','oai-authenticated-user-id':'site-owner'},body:JSON.stringify(data)});
 assert.equal((await playbackHealthAPI(publicRequest,catalog,env,logger)).status,403);
 assert.equal((await playbackHealthAPI(request(data,{Origin:'https://other.test'}),catalog,env,logger)).status,403);
 assert.equal((await playbackHealthAPI(request({...data,game:'not-in-catalog'}),catalog,env,logger)).status,400);
 assert.equal((await playbackHealthAPI(request({...data,message:'x'.repeat(1100)}),catalog,env,logger)).status,413);
});
