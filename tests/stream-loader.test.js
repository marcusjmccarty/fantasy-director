import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(process.env.FANTASY_AUDIT_LOADER||new URL('../web/stream-loader.js',import.meta.url),'utf8').replace(/import\(([^)]+)\)/,'loadHls($1)').replace('export ','');
function harness({native=true,mse=true,hls=true,load}={}){
 const calls=[];class Hls{static isSupported(){return hls;}static Events={ERROR:'error'};static ErrorTypes={MEDIA_ERROR:'media'};on(name,fn){this[name]=fn;}recoverMediaError(){calls.push('recover');}loadSource(){calls.push('hlsSource');}attachMedia(){calls.push('hlsAttach');}}
 const timers=new Map();let timerId=0;
 const ctx={loadHls:url=>load?load(Hls,url):Promise.resolve({default:Hls}),setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};if(mse)ctx.MediaSource=class{};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.attach=attachMediaSource',ctx);
 const video={canPlayType:()=>native?'probably':'',load(){calls.push('nativeLoad');}};return {attach:ctx.attach,video,calls,timers};
}
test('HLS falls back to native playback when MediaSource exists but hls.js cannot use it',async()=>{
 const h=harness({hls:false});const source={type:'application/vnd.apple.mpegurl',url:'https://example.com/game.m3u8'};assert.equal(await h.attach(h.video,source),null);assert.equal(h.video.src,source.url);assert.deepEqual(h.calls,['nativeLoad']);
});
test('HLS retries a transient SDK download failure instead of caching the rejected import forever',async()=>{
 const urls=[];const h=harness({load:(Hls,url)=>{urls.push(url);return urls.length===1?Promise.reject(new Error('Offline')):Promise.resolve({default:Hls});}}),source={url:'https://example.test/a.m3u8'};
 await assert.rejects(h.attach(h.video,source),/Offline/);assert.ok(await h.attach(h.video,source));assert.ok(await h.attach(h.video,source));assert.deepEqual(urls,['/hls.light.mjs','/hls.light.mjs?retry=1']);
});
test('HLS attachment aborted during SDK download cannot attach or load into a retired video',async()=>{
 let finish;const h=harness({load:Hls=>new Promise(resolve=>{finish=()=>resolve({default:Hls});})}),abort=new AbortController();
 const attaching=h.attach(h.video,{url:'https://example.test/a.m3u8'},()=>{}, {signal:abort.signal});abort.abort();finish();
 assert.equal(await attaching,null);assert.deepEqual(h.calls,[]);
});
test('HLS a hung SDK request times out and a later download can start without reloading the app',async()=>{
 let calls=0;const h=harness({load:Hls=>++calls===1?new Promise(()=>{}):Promise.resolve({default:Hls})});
 const first=h.attach(h.video,{url:'https://example.test/a.m3u8'}),rejected=assert.rejects(first,/too long/);[...h.timers.values()][0]();await rejected;
 assert.ok(await h.attach(h.video,{url:'https://example.test/a.m3u8'}));assert.equal(calls,2);assert.equal(h.timers.size,0);
});
test('HLS media recovery is bounded and obsolete fatal callbacks are ignored after cancellation',async()=>{
 const h=harness(),abort=new AbortController();let fatal=0;const controller=await h.attach(h.video,{url:'https://example.test/a.m3u8'},()=>fatal++,{signal:abort.signal});
 controller.error(null,{fatal:true,type:'media'});assert.equal(h.calls.filter(x=>x==='recover').length,1);assert.equal(fatal,0);
 controller.error(null,{fatal:true,type:'media'});assert.equal(fatal,1);abort.abort();controller.error(null,{fatal:true,type:'network'});assert.equal(fatal,1);
});
test('HLS prefers a supported hls.js controller and reports lack of both playback paths',async()=>{
 const source={type:'application/vnd.apple.mpegurl',url:'https://example.com/game.m3u8'};const supported=harness();assert.ok(await supported.attach(supported.video,source));assert.deepEqual(supported.calls,['hlsSource','hlsAttach']);
 const unsupported=harness({native:false,hls:false});await assert.rejects(unsupported.attach(unsupported.video,source),/HLS is unavailable/);
 const native=harness({mse:false});assert.equal(await native.attach(native.video,source),null);assert.deepEqual(native.calls,['nativeLoad']);
});
