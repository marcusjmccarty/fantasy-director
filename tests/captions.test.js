import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {disableCaptions} from '../web/captions.js';

test('captions are off initially, after track changes and late arrivals; metadata remains available',()=>{
 const events=new Map(),tracks=[{kind:'captions',mode:'showing'},{kind:'metadata',mode:'hidden'}];tracks.addEventListener=(n,f)=>events.set(n,f);tracks.removeEventListener=n=>events.delete(n);
 const video={textTracks:tracks,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)},stop=disableCaptions(video);
 assert.equal(tracks[0].mode,'disabled');assert.equal(tracks[1].mode,'hidden');tracks.push({kind:'subtitles',mode:'showing'});events.get('addtrack')();assert.equal(tracks[2].mode,'disabled');tracks[0].mode='showing';events.get('change')();assert.equal(tracks[0].mode,'disabled');stop();assert.equal(events.size,0);
});
test('provider main-world guard prevents background unmute and clears custom captions without blocking visible video',async()=>{
 const events=new Map(),timers=new Map();let now=0,jw=2,plyr=true;
 class Media{constructor(){this.quiet=false;this.paused=true;this.plays=0;this.textTracks=[{kind:'subtitles',mode:'showing'}];}get muted(){return this.quiet;}set muted(v){this.quiet=v;}play(){this.plays++;this.paused=false;return Promise.resolve();}pause(){this.paused=true;}}
 const video=new Media();video.plyr={captions:{active:true},toggleCaptions:value=>plyr=value};
 const window={addEventListener:(n,f)=>events.set(n,f),jwplayer:()=>({getCurrentCaptions:()=>jw,setCurrentCaptions:value=>jw=value})};
 const document={querySelectorAll:s=>s==='video'?[video]:[{id:'player'}],createElement:()=>({}),documentElement:{append(){}},addEventListener(){}};
 vm.runInNewContext(readFileSync(new URL('../extension/media.js',import.meta.url),'utf8'),{window,document,HTMLMediaElement:Media,Date:{now:()=>now},setInterval:f=>{timers.set(1,f);return 1;},clearInterval:id=>timers.delete(id)});
 const state=v=>events.get('fantasy-stream-media-state')({detail:JSON.stringify({playing:true,visible:false,muted:false,...v})});
 state({});video.muted=false;assert.equal(video.muted,true);await video.play();assert.equal(video.paused,false);assert.equal(jw,0);assert.equal(plyr,false);assert.equal(video.textTracks[0].mode,'disabled');
 state({visible:true});video.muted=false;assert.equal(video.muted,false);state({playing:false});await video.play();assert.equal(video.paused,true);assert.equal(video.plays,1);
 state({visible:true});now=3000;video.muted=false;assert.equal(video.muted,true);await video.play();assert.equal(video.plays,1);events.get('pagehide')();assert.equal(timers.size,0);
});
