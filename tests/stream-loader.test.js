import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../web/stream-loader.js',import.meta.url),'utf8').replace("import('/hls.light.mjs')",'loadHls()').replace('export ','');
function harness({native=true,mse=true,hls=true}={}){
 const calls=[];class Hls{static isSupported(){return hls;}static Events={ERROR:'error'};static ErrorTypes={MEDIA_ERROR:'media'};on(){}loadSource(){calls.push('hlsSource');}attachMedia(){calls.push('hlsAttach');}}
 const ctx={loadHls:async()=>({default:Hls})};if(mse)ctx.MediaSource=class{};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.attach=attachMediaSource',ctx);
 const video={canPlayType:()=>native?'probably':'',load(){calls.push('nativeLoad');}};return {attach:ctx.attach,video,calls};
}
test('HLS falls back to native playback when MediaSource exists but hls.js cannot use it',async()=>{
 const h=harness({hls:false});const source={type:'application/vnd.apple.mpegurl',url:'https://example.com/game.m3u8'};assert.equal(await h.attach(h.video,source),null);assert.equal(h.video.src,source.url);assert.deepEqual(h.calls,['nativeLoad']);
});
test('HLS prefers a supported hls.js controller and reports lack of both playback paths',async()=>{
 const source={type:'application/vnd.apple.mpegurl',url:'https://example.com/game.m3u8'};const supported=harness();assert.ok(await supported.attach(supported.video,source));assert.deepEqual(supported.calls,['hlsSource','hlsAttach']);
 const unsupported=harness({native:false,hls:false});await assert.rejects(unsupported.attach(unsupported.video,source),/HLS is unavailable/);
 const native=harness({mse:false});assert.equal(await native.attach(native.video,source),null);assert.deepEqual(native.calls,['nativeLoad']);
});
