// ProviderPlayer drives OK's embedded player over postMessage; PlayerPool keeps
// a few of them (or native players) stacked so a cut is a swap between players
// already showing the right moment. Both are exercised here with fakes: an
// iframe whose contentWindow records what was posted, an EventTarget standing
// in for window, an injected clock that also drives a fake setInterval (the
// player's bootstrap polls with one, and no real timer may run in a test), and
// (for the pool) scripted fake players.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderPlayer,providerURL} from '../web/provider-player.js';
import {PlayerPool,TOLERANCE,createPlayer} from '../web/players.js';

const ORIGIN='https://ok.ru';
const EMBED='https://ok.ru/videoembed/1234';
const CANONICAL='https://ok.ru/videoembed/1234?autoplay=1&muted=1&silent=1';

// ---- fakes -----------------------------------------------------------------
function fakeClassList(){
 const set=new Set();
 return {add(...c){for(const x of c)set.add(x);},remove(...c){for(const x of c)set.delete(x);},toggle(c,force){const on=force===undefined?!set.has(c):!!force;on?set.add(c):set.delete(c);return on;},contains(c){return set.has(c);},get size(){return set.size;}};
}
// Minimal element: enough of an iframe/video for the player and the pool.
function fakeElement(){
 const el={attrs:new Map(),classList:fakeClassList(),parent:null,removed:false};
 el.setAttribute=(k,v)=>{el.attrs.set(k,String(v));};
 el.getAttribute=k=>el.attrs.has(k)?el.attrs.get(k):null;
 el.removeAttribute=k=>{el.attrs.delete(k);if(k==='src')delete el.src;};
 el.remove=()=>{el.removed=true;if(el.parent){el.parent.children=el.parent.children.filter(c=>c!==el);el.parent=null;}};
 return el;
}
function fakeFrame(){
 const el=fakeElement();el.posted=[];
 el.contentWindow={postMessage(message,targetOrigin){el.posted.push({message,targetOrigin});}};
 return el;
}
function fakeHost(){const host={children:[]};host.append=(...els)=>{for(const el of els){el.parent=host;host.children.push(el);}};return host;}
// An EventTarget that counts live listeners so leaks are visible.
class Bus extends EventTarget{
 constructor(){super();this.count=0;}
 addEventListener(...a){this.count++;return super.addEventListener(...a);}
 removeEventListener(...a){this.count--;return super.removeEventListener(...a);}
}

// ---- fake timers -----------------------------------------------------------
// ProviderPlayer.bootstrap() polls the provider with setInterval. Outside a
// harness, setInterval throws, so no test can start a real interval by
// accident; inside one, the harness owns setInterval/clearInterval for the
// test's duration and fires due ticks, each at its own moment, as the injected
// clock advances.
globalThis.setInterval=()=>{throw new Error('a real interval would have started: build ProviderPlayers through harness(t)');};
function fakeTimers(t,start=0){
 assert.equal(typeof t?.after,'function','fakeTimers needs the test context so the stubs are restored');
 const outer={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const clock={now:start,timers:new Map(),seq:0};
 globalThis.setInterval=(fn,ms,...args)=>{
  const period=Math.max(1,Number(ms)||1);
  const timer={id:++clock.seq,fn,args,period,due:clock.now+period,refed:true,unref(){timer.refed=false;return timer;},ref(){timer.refed=true;return timer;},hasRef(){return timer.refed;}};
  clock.timers.set(timer.id,timer);return timer;
 };
 globalThis.clearInterval=timer=>{clock.timers.delete(timer?.id);};
 t.after(()=>{globalThis.setInterval=outer.setInterval;globalThis.clearInterval=outer.clearInterval;});
 // Advance the clock, running every due tick in order at its own time.
 clock.advance=ms=>{
  const end=clock.now+ms;
  for(;;){
   let next=null;
   for(const timer of clock.timers.values())if(timer.due<=end&&(!next||timer.due<next.due))next=timer;
   if(!next)break;
   clock.now=next.due;next.due+=next.period;next.fn(...next.args);
  }
  clock.now=end;
 };
 return clock;
}

// Test harness around ProviderPlayer: injected clock (shared with the fake
// timers), bus, frame factory, and a `msg` helper that delivers a provider
// message the way window would.
function harness(t,{start=0}={}){
 const clock=fakeTimers(t,start);const bus=new Bus(),frames=[];
 const createFrame=()=>{const f=fakeFrame();frames.push(f);return f;};
 const make=(url=EMBED,extra={})=>new ProviderPlayer(url,{events:bus,now:()=>clock.now,createFrame,...extra});
 const msg=(p,data,{origin=ORIGIN,source=p.element.contentWindow}={})=>{const e=new Event('message');Object.assign(e,{origin,source,data});bus.dispatchEvent(e);};
 const h={bus,frames,clock,make,msg,tick:ms=>clock.advance(ms),intervals:()=>clock.timers.size,get now(){return clock.now;}};
 // Bring a player through the handshake and drop the handshake traffic.
 h.init=p=>{msg(p,{event:'inited'});p.element.posted.length=0;return p;};
 // A couple of advancing reports: primes the player at `time` (+1s).
 h.prime=(p,time,duration)=>{msg(p,{event:'timeupdate',time,duration});h.tick(1000);msg(p,{event:'timeupdate',time:time+1,duration});};
 return h;
}
const actions=p=>p.element.posted.map(x=>x.message.action);
const posted=p=>p.element.posted.map(x=>x.message);
const seeks=p=>posted(p).filter(m=>m.action==='seek').map(m=>m.time);
// Each action once, in first-seen order: the bootstrap repeats `play`.
const distinct=p=>[...new Set(actions(p))];
const clear=p=>{p.element.posted.length=0;};

// Scripted stand-in for a player inside the pool. `kind` matters to the pool
// (native players are paused when ahead or unwanted, providers never are).
class FakePlayer{
 constructor(source){
  this.kind=source.kind||'fake';this.source=source;this.element=fakeElement();this.listeners=new Map();this.calls=[];
  this.target=null;this.primed=false;this.wantPlay=false;this.advances=0;this.seekLatency=source.seekLatency??3000;this.error=null;this.inAd=false;this.time=0;this.progressing=false;this.nearResult=null;this.isMuted=true;this.destroyed=false;
 }
 on(name,cb){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(cb);}
 emit(name,detail){for(const cb of this.listeners.get(name)||[])cb(detail);}
 get currentTime(){return this.time;}
 play(){this.wantPlay=true;this.calls.push(['play']);}
 pause(){this.wantPlay=false;this.calls.push(['pause']);}
 seek(t){this.target=t;this.primed=false;this.advances=0;this.calls.push(['seek',t]);}
 near(target,tolerance){this.calls.push(['near',target,tolerance]);if(this.nearResult!==null)return this.nearResult;return this.primed&&this.target===null&&Math.abs(this.time-target)<=tolerance;}
 set muted(v){this.isMuted=!!v;this.calls.push(['muted',!!v]);}
 get muted(){return this.isMuted;}
 destroy(){this.destroyed=true;this.wantPlay=false;this.element.remove();this.calls.push(['destroy']);}
 // Scripting helpers: the seek landed and footage is moving at `time`.
 settle(time){this.target=null;this.primed=true;this.advances=2;this.time=time;this.progressing=this.wantPlay;return this;}
 names(){return this.calls.map(c=>c[0]);}
 reset(){this.calls.length=0;return this;}
}
function poolHarness({start=0,capacity=4}={}){
 let now=start;const host=fakeHost(),players=new Map(),events=[];
 const create=source=>{const p=new FakePlayer(source);players.set(source.url,p);return p;};
 const pool=new PlayerPool(host,{capacity,create,now:()=>now,onAd:(k,on)=>events.push(['ad',k,on]),onEnded:k=>events.push(['ended',k]),onError:(k,e)=>events.push(['error',k,e])});
 const src=(key,kind,extra={})=>({type:'fake',kind,url:`fake://${key}`,...extra});
 const open=(key,kind,extra)=>pool.open(key,src(key,kind,extra));
 const player=key=>pool.get(key).player;
 return {pool,host,players,events,src,open,player,tick:ms=>{now+=ms;},get now(){return now;}};
}

// ---- providerURL ------------------------------------------------------------
test('providerURL accepts only ok.ru videoembed links and normalizes the query to a silent autoplay embed',()=>{
 assert.equal(providerURL(EMBED),CANONICAL);
 assert.equal(providerURL('https://ok.ru/videoembed/1234?foo=bar&autoplay=0#frag'),CANONICAL,'existing query and hash are replaced');
 assert.equal(providerURL('https://OK.RU:443/videoembed/98765'),'https://ok.ru/videoembed/98765?autoplay=1&muted=1&silent=1','host case and default port normalize');
 for(const bad of [
  'https://attacker.example/videoembed/1234',
  'https://ok.ru.evil.example/videoembed/1234',
  'https://evil.example/https://ok.ru/videoembed/1234',
  'http://ok.ru/videoembed/1234',
  'https://ok.ru/video/1234',
  'https://ok.ru/videoembed/abc',
  'https://ok.ru/videoembed/',
  'https://ok.ru/videoembed/1234/extra',
  'https://ok.ru/videoembed/1234/',
  'https://ok.ru//videoembed/1234',
  'https://ok.ru/prefix/videoembed/1234',
  'javascript:alert(1)',
 ])assert.throws(()=>providerURL(bad),/Unknown replay provider/,bad);
 assert.throws(()=>providerURL('not a url'),TypeError,'garbage is rejected by URL parsing');
});

// ---- construction -----------------------------------------------------------
test('constructor loads the canonical embed into an injected frame with autoplay permissions and listens on the injected events target',t=>{
 const h=harness(t);const p=h.make();
 assert.equal(p.kind,'provider');
 assert.equal(h.frames.length,1);assert.equal(p.element,h.frames[0]);
 assert.equal(p.element.src,CANONICAL);
 assert.equal(p.element.className,'layer');assert.equal(p.element.title,'Game replay');
 assert.match(p.element.allow,/autoplay/);assert.equal(p.element.referrerPolicy,'strict-origin-when-cross-origin');
 assert.equal(h.bus.count,1,'one message listener on the injected target');
 assert.equal(p.element.posted.length,0,'nothing is posted before the player reports inited');
 assert.equal(p.initialized,false);assert.equal(p.primed,false);assert.equal(p.progressing,false);assert.equal(p.muted,true);assert.equal(p.error,null);
 assert.ok(Number.isNaN(p.duration),'duration is unknown until the provider reports it');
 assert.equal(p.currentTime,0);
 assert.equal(p.seekLatency,3000,'a seek is assumed to take 3s until one is measured');
 assert.equal(h.intervals(),0,'no bootstrap until play is wanted and the player is inited');
 assert.throws(()=>h.make('https://attacker.example/videoembed/1234'),/Unknown replay provider/);
});

test('constructor leaves no message listener behind when the URL is rejected',t=>{
 const h=harness(t);
 assert.throws(()=>h.make('https://attacker.example/videoembed/1234'),/Unknown replay provider/);
 assert.equal(h.bus.count,0,'a player that failed to construct must not stay subscribed to window messages');
});

// ---- handshake -------------------------------------------------------------
test('commands issued before inited are queued and replayed by the handshake: unmute, volume, seek, then the bootstrap\'s play, all addressed to the provider origin',t=>{
 const h=harness(t);const p=h.make();
 p.play();p.seek(615);p.muted=false;
 assert.equal(p.element.posted.length,0,'nothing is sent to a player that has not reported inited');
 assert.equal(p.wantPlay,true);assert.equal(p.target,615);assert.equal(p.muted,false);
 assert.equal(h.intervals(),0,'no bootstrap before inited');
 h.msg(p,{event:'inited'});
 assert.equal(p.initialized,true);
 assert.deepEqual(posted(p),[{action:'unmute'},{action:'volume',value:1},{action:'seek',time:615},{action:'play'}],'volume state, the pending seek, then the bootstrap\'s first play (which does not repeat the volume just applied)');
 assert.ok(p.element.posted.every(x=>x.targetOrigin===ORIGIN),'every message is posted to https://ok.ru, never *');
 assert.equal(h.intervals(),1,'inited with play wanted starts the bootstrap');
 clear(p);
 h.tick(500);
 assert.deepEqual(actions(p),['play'],'...which keeps asking for play');
 assert.deepEqual(seeks(p),[],'...without repeating a seek that is not yet 3s old');
});

test('the default handshake mutes the player at volume 0 and pauses it; seek/play/mute are sent immediately afterwards, and pause() stops the bootstrap',t=>{
 const h=harness(t);const p=h.make();
 h.msg(p,{event:'inited'});
 assert.deepEqual(posted(p),[{action:'mute'},{action:'volume',value:0},{action:'pause'}]);
 assert.equal(h.intervals(),0,'play not wanted: no bootstrap');
 clear(p);
 p.seek(42);assert.deepEqual(posted(p),[{action:'seek',time:42}]);clear(p);
 p.play();assert.deepEqual(posted(p),[{action:'play'}],'play asks for play at once; it repeats neither the volume state already applied nor a seek sent just now');clear(p);
 assert.equal(h.intervals(),1);
 p.muted=false;assert.deepEqual(posted(p),[{action:'unmute'},{action:'volume',value:1}]);clear(p);
 p.muted=true;assert.deepEqual(posted(p),[{action:'mute'},{action:'volume',value:0}]);clear(p);
 p.pause();assert.deepEqual(posted(p),[{action:'pause'}]);assert.equal(p.wantPlay,false);
 assert.equal(h.intervals(),0,'pause() stops the bootstrap');
 clear(p);h.tick(3000);
 assert.deepEqual(posted(p),[],'no more play requests after pause()');
});

test('seek sanitizes its argument: negatives and non-numbers become 0, and targets are clamped to a second before the known duration',t=>{
 const h=harness(t);const p=h.init(h.make());
 p.seek(-12);assert.equal(p.target,0);
 p.seek('17.5');assert.equal(p.target,17.5);
 p.seek(NaN);assert.equal(p.target,0);
 p.seek(undefined);assert.equal(p.target,0);
 assert.deepEqual(posted(p).map(m=>m.time),[0,17.5,0,0]);
 clear(p);
 h.msg(p,{event:'timeupdate',time:5,duration:7800});
 assert.equal(p.duration,7800);
 p.seek(9999);assert.equal(p.target,7799);assert.deepEqual(posted(p),[{action:'seek',time:7799}]);
 h.msg(p,{event:'timeupdate',time:7799,duration:9000});
 assert.equal(p.duration,7800,'the first reported duration is the recording length; later values do not overwrite it');
});

// ---- bootstrap -------------------------------------------------------------
test('bootstrap: play() asks for play at once and every 500ms, skips ticks during an ad, is not restarted by a second play(), stops once footage moves, and gives up after 120 ticks',t=>{
 const h=harness(t);const p=h.init(h.make());
 p.play();
 assert.deepEqual(actions(p),['play'],'tick 1 runs at once');
 assert.equal(h.intervals(),1);
 p.play();
 assert.deepEqual(actions(p),['play'],'play() while the bootstrap runs is a no-op');
 assert.equal(h.intervals(),1);
 clear(p);
 h.tick(499);assert.deepEqual(actions(p),[]);
 h.tick(1);assert.deepEqual(actions(p),['play'],'tick 2 at 500ms');
 h.tick(1000);assert.deepEqual(actions(p),['play','play','play'],'ticks 3 and 4');
 h.tick(2500);assert.deepEqual(actions(p),Array(8).fill('play'),'ticks 5-9: one play per tick, the applied volume state is never repeated');
 clear(p);
 h.msg(p,{event:'adShown'});
 h.tick(2000);assert.deepEqual(actions(p),[],'ticks 10-13: nothing is asked of a player showing an ad');
 assert.equal(h.intervals(),1,'...but the bootstrap keeps waiting');
 h.msg(p,{event:'timeupdate',time:1,duration:7800});
 assert.equal(p.inAd,false);
 h.tick(500);assert.deepEqual(actions(p),['play'],'tick 14: content is back, ask again');
 clear(p);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:2,duration:7800});
 assert.equal(p.primed,true);assert.equal(h.intervals(),0,'two advancing reports: the footage moves, the bootstrap is over');
 clear(p);h.tick(5000);assert.deepEqual(actions(p),[],'nothing more is asked');
 // A player that keeps reporting but never advances is asked 120 times, then left alone.
 const q=h.init(h.make());q.play();
 for(let i=0;i<11;i++){h.tick(5000);h.msg(q,{event:'timeupdate',time:0,duration:7800});}
 h.tick(4500);
 assert.equal(q.advances,1,'reports at the same position are not progress');
 assert.deepEqual(distinct(q),['play']);assert.equal(actions(q).length,120);assert.equal(h.intervals(),1);
 h.tick(500);
 assert.equal(actions(q).length,120,'tick 121 gives up');assert.equal(h.intervals(),0);assert.equal(q.timer,null);
 assert.equal(q.wantPlay,true,'play is still wanted');
 clear(q);q.seek(10);
 assert.deepEqual(posted(q),[{action:'seek',time:10},{action:'play'}],'a seek starts a fresh bootstrap run');
 assert.equal(h.intervals(),1);
});

test('bootstrap kick: a provider silent for more than 6s while being asked to play is sent a pause instead of a play, at most once per 6s; any report resets the silence clock',t=>{
 const h=harness(t,{start:0});const p=h.init(h.make());p.play();clear(p);   // last report: inited at 0
 h.tick(6000);
 assert.deepEqual(actions(p),Array(12).fill('play'),'6s of silence is tolerated');
 clear(p);h.tick(500);
 assert.deepEqual(actions(p),['pause'],'silent for more than 6s: a pause breaks the spell');
 assert.equal(p.wantPlay,true,'...without changing what is wanted');
 clear(p);h.tick(500);
 assert.deepEqual(actions(p),['play'],'the next tick asks for play again');
 clear(p);h.tick(5500);                                                   // 12500
 assert.deepEqual(distinct(p),['play'],'no second kick within 6s of the first');
 clear(p);h.tick(500);                                                    // 13000
 assert.deepEqual(actions(p),['pause'],'still silent 6s after the kick: kick again');
 clear(p);
 h.msg(p,{event:'timeupdate',time:40,duration:7800});                    // not progress (one report), but a sign of life
 h.tick(6000);                                                            // 19000
 assert.deepEqual(distinct(p),['play'],'a report resets the silence clock');
 clear(p);h.tick(500);                                                    // 19500: 6.5s silent, 6.5s since the kick
 assert.deepEqual(actions(p),['pause']);
 assert.equal(h.intervals(),1,'the bootstrap goes on until footage moves');
});

test('kick() forgets the progress seen so far and bootstraps again until footage moves',t=>{
 const h=harness(t,{start:0});const p=h.init(h.make());p.play();h.prime(p,100,7800);clear(p);
 assert.equal(h.intervals(),0);assert.equal(p.near(101),true);
 p.kick();
 assert.equal(p.advances,0);assert.equal(p.primed,false);assert.equal(p.stalled,true);assert.equal(p.near(101),false,'no longer ready');
 assert.deepEqual(actions(p),['play'],'asks for play at once...');
 h.tick(1000);assert.deepEqual(actions(p),['play','play','play'],'...and keeps asking');
 h.msg(p,{event:'timeupdate',time:101,duration:7800});h.tick(1000);h.msg(p,{event:'timeupdate',time:102,duration:7800});
 assert.equal(p.primed,true);assert.equal(p.stalled,false);assert.equal(h.intervals(),0,'footage moves again: done');
 const q=h.make();q.play();q.kick();
 assert.equal(h.intervals(),0,'not inited: nothing to ask yet');
 h.msg(q,{event:'inited'});
 assert.equal(h.intervals(),1,'...the handshake starts the bootstrap');
});

test('volume commands go out only when the wanted state changes; inited and started/resumed always re-send them',t=>{
 const h=harness(t);const p=h.make();
 p.muted=false;
 assert.deepEqual(posted(p),[],'not inited: nothing is sent yet');
 h.msg(p,{event:'inited'});
 assert.deepEqual(posted(p),[{action:'unmute'},{action:'volume',value:1},{action:'pause'}]);clear(p);
 p.muted=false;
 assert.deepEqual(posted(p),[],'already unmuted: not repeated (repeating audibly stutters the provider)');
 p.muted=true;
 assert.deepEqual(posted(p),[{action:'mute'},{action:'volume',value:0}]);clear(p);
 p.muted=true;assert.deepEqual(posted(p),[]);
 p.play();
 assert.deepEqual(posted(p),[{action:'play'}],'the bootstrap does not repeat an applied volume state');
 clear(p);h.tick(2000);
 assert.deepEqual(distinct(p),['play'],'...on any tick');
 clear(p);
 h.msg(p,{event:'started'});
 assert.deepEqual(posted(p),[{action:'mute'},{action:'volume',value:0}],'started re-asserts the volume state (the provider restarted)');
 clear(p);
 h.msg(p,{event:'resumed'});
 assert.deepEqual(posted(p),[{action:'mute'},{action:'volume',value:0}]);
 clear(p);
 h.msg(p,{event:'inited'});
 assert.deepEqual(posted(p),[{action:'mute'},{action:'volume',value:0}],'a re-initialized player is told again');
});

// ---- progress --------------------------------------------------------------
test('timeupdate progress: two advancing reports prime the player, mark it progressing and end the bootstrap; stalls and repeats do not count',t=>{
 const h=harness(t,{start:10000});const p=h.init(h.make());p.play();clear(p);
 h.msg(p,{event:'timeupdate',time:100,duration:7800});
 assert.equal(p.advances,1);assert.equal(p.primed,false);assert.equal(p.progressing,false);assert.equal(p.lastTime,100);
 h.tick(500);h.msg(p,{event:'timeupdate',time:100,duration:7800});
 assert.equal(p.advances,1,'a report at the same position is not an advance');
 h.tick(500);h.msg(p,{event:'timeupdate',time:100.01,duration:7800});
 assert.equal(p.advances,1,'sub-20ms jitter is not an advance');
 assert.equal(h.intervals(),1,'still bootstrapping');
 h.tick(500);h.msg(p,{event:'timeupdate',time:101.5,duration:7800});
 assert.equal(p.advances,2);assert.equal(p.primed,true);assert.equal(p.progressing,true);
 assert.equal(h.intervals(),0,'primed: the bootstrap stops');
 assert.deepEqual(distinct(p),['play'],'until then the bootstrap only asked for play; progress reports trigger no seek or pause');
 clear(p);
 h.tick(1499);assert.equal(p.progressing,true,'still progressing just under 1.5s after the last advance');
 h.tick(2);assert.equal(p.progressing,false,'a 1.5s silence means the footage stalled');
 h.tick(5000);h.msg(p,{event:'timeupdate',time:102,duration:7800});
 assert.equal(p.progressing,true,'progress resumes on the next advancing report');
 assert.deepEqual(actions(p),[],'a primed player that stalls is not bootstrapped again');
});

test('currentTime extrapolates at most one second past the last report, and only while the footage is actually moving',t=>{
 const h=harness(t,{start:5000});const p=h.init(h.make());
 h.prime(p,200,7800);
 assert.equal(p.currentTime,201,'paused player (wantPlay false) reports the last position exactly');
 h.tick(700);assert.equal(p.currentTime,201,'no extrapolation while not asked to play');
 p.play();
 assert.equal(p.currentTime,201.7,'wantPlay with a recent advance extrapolates by elapsed time');
 h.tick(600);assert.equal(p.currentTime,202,'extrapolation caps at +1s');
 h.tick(1000);assert.equal(p.currentTime,201,'after 1.5s without an advance the footage is treated as stalled');
 h.msg(p,{event:'timeupdate',time:203,duration:7800});
 assert.equal(p.currentTime,203);
 h.tick(250);assert.equal(p.currentTime,203.25);
 h.msg(p,{event:'adShown'});
 assert.equal(p.currentTime,203,'no extrapolation while an ad is showing');
});

test('near() is true only when primed at the target since the last seek, with footage moving or deliberately paused there',t=>{
 const h=harness(t,{start:1000});const p=h.init(h.make());p.play();
 assert.equal(p.near(100),false,'nothing has played yet');
 h.msg(p,{event:'timeupdate',time:100,duration:7800});
 assert.equal(p.near(100),false,'one report is not enough');
 h.tick(1000);h.msg(p,{event:'timeupdate',time:101,duration:7800});
 assert.equal(p.near(101),true);
 assert.equal(p.near(103.5),true,'default tolerance is 2.5s');
 assert.equal(p.near(103.6),false);
 assert.equal(p.near(98.5),true);assert.equal(p.near(98.4),false);
 assert.equal(p.near(102,1),true);assert.equal(p.near(102.5,1),false,'explicit tolerance');
 h.tick(1600);assert.equal(p.near(101),false,'stalled while asked to play: not ready');
 p.pause();
 assert.equal(p.near(101),true,'paused at the position: ready (deliberately paused there)');
 p.seek(500);
 assert.equal(p.near(101),false,'a pending seek invalidates readiness');
 assert.equal(p.near(500),false,'...even at the new target, until footage has played there');
 h.msg(p,{event:'timeupdate',time:500,duration:7800});h.tick(1000);h.msg(p,{event:'timeupdate',time:501,duration:7800});
 assert.equal(p.near(501),true);
 h.msg(p,{event:'adShown'});
 assert.equal(p.near(501),false,'not ready while an ad is on');
 h.msg(p,{event:'timeupdate',time:502,duration:7800});h.tick(1000);h.msg(p,{event:'timeupdate',time:503,duration:7800});
 assert.equal(p.near(503),true);
 h.msg(p,{event:'error',code:102});
 assert.equal(p.near(503),false,'never ready after an error');
});

// ---- seeking ---------------------------------------------------------------
test('an unanswered seek is re-sent after 3s: by the bootstrap tick while playing, by a stale report while paused, and at once by a rewind elsewhere; a report within 3s lands it and records the latency',t=>{
 const h=harness(t,{start:0});const p=h.init(h.make());p.play();
 h.prime(p,10,7800);clear(p);                                          // now 1000: primed, bootstrap over
 p.seek(600);
 assert.equal(p.target,600);assert.equal(p.primed,false);assert.equal(p.advances,0);
 assert.deepEqual(posted(p),[{action:'seek',time:600},{action:'play'}],'the seek goes out first, then the bootstrap starts asking for play');
 assert.equal(h.intervals(),1);clear(p);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:12,duration:7800});    // 2000
 assert.deepEqual(seeks(p),[],'a stale report 1s after the seek is ignored, not re-sent');
 assert.equal(p.target,600);assert.equal(p.lastTime,11,'stale reports do not move the position');
 h.tick(1000);h.msg(p,{event:'timeupdate',time:13,duration:7800});    // 3000
 assert.deepEqual(seeks(p),[],'2s: still waiting');
 h.tick(1000);                                                        // 4000: a seek exactly 3s old is not yet overdue
 assert.deepEqual(seeks(p),[]);
 h.tick(500);                                                         // 4500: overdue
 assert.deepEqual(seeks(p),[600],'the bootstrap tick re-sends a seek that has gone more than 3s unanswered');
 assert.ok(actions(p).filter(a=>a==='play').length>=6,'...while asking for play every tick');
 clear(p);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:15,duration:7800});    // 5500
 assert.deepEqual(seeks(p),[],'the resend clock restarts from the resend');
 h.tick(2500);                                                        // 8000: 3.5s since the resend
 assert.deepEqual(seeks(p),[600]);clear(p);
 h.msg(p,{event:'timeupdate',time:603.1,duration:7800});
 assert.equal(p.target,600,'3.1s away is still not acknowledged');
 h.msg(p,{event:'timeupdate',time:602.9,duration:7800});
 assert.equal(p.target,null,'within 3s: acknowledged');
 assert.equal(p.seekLatency,5000,'7s from the first seek of this run to landing, averaged 50/50 with the previous 3s');
 assert.equal(p.advances,1);assert.equal(p.primed,false);assert.equal(p.lastTime,602.9);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:603.9,duration:7800}); // 9000
 assert.equal(p.primed,true);assert.equal(p.near(604),true);
 assert.deepEqual(seeks(p),[],'no more seeks once acknowledged');
 clear(p);h.tick(2000);                                               // 11000
 assert.deepEqual(actions(p),[],'primed: the bootstrap has stopped asking for play');
 // Paused there is no bootstrap tick: a stale report itself re-sends after 3s, a rewind elsewhere at once.
 p.pause();clear(p);
 p.seek(300);
 assert.deepEqual(posted(p),[{action:'seek',time:300}],'paused: the seek goes out alone');
 assert.equal(h.intervals(),0,'no bootstrap while play is not wanted');clear(p);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:605,duration:7800});
 assert.deepEqual(posted(p),[]);
 h.tick(2000);h.msg(p,{event:'timeupdate',time:607,duration:7800});   // 3s since the seek: not yet
 assert.deepEqual(posted(p),[]);
 h.tick(1);h.msg(p,{event:'timeupdate',time:607,duration:7800});      // 3.001s
 assert.deepEqual(posted(p),[{action:'seek',time:300}],'a stale report more than 3s after the last seek re-sends it');clear(p);
 h.tick(999);h.msg(p,{event:'rewound',time:50,duration:7800});        // 1s since the resend
 assert.deepEqual(posted(p),[{action:'seek',time:300}],'a rewind far from the target means the provider moved us: re-seek immediately');clear(p);
 h.msg(p,{event:'timeupdate',time:302,duration:7800});
 assert.equal(p.target,null);assert.equal(p.seekLatency,4500,'4s from the first seek of the run, averaged with the previous 5s');
 assert.deepEqual(posted(p),[],'landed while paused: nothing more is asked of the player');
 assert.equal(h.intervals(),0);
});

test('seekLatency: landing averages the time since the first seek of the run (re-sends do not restart it, 15s cap) 50/50 into the previous estimate',t=>{
 const h=harness(t,{start:0});const p=h.init(h.make());
 assert.equal(p.seekLatency,3000,'assumed 3s until measured');
 p.seek(100);h.tick(2000);h.msg(p,{event:'timeupdate',time:101,duration:7800});
 assert.equal(p.target,null);assert.equal(p.seekLatency,2500);
 p.seek(500);clear(p);
 h.tick(4000);h.msg(p,{event:'timeupdate',time:102,duration:7800});
 assert.deepEqual(seeks(p),[500],'re-sent after 4s unanswered');
 h.tick(2000);h.msg(p,{event:'timeupdate',time:500,duration:7800});
 assert.equal(p.seekLatency,4250,'6s from the first seek of the run, not 2s from the re-send');
 p.seek(900);h.tick(40000);h.msg(p,{event:'timeupdate',time:900,duration:7800});
 assert.equal(p.seekLatency,9625,'a 40s wait counts as 15s');
});

test('a rewound report near the target acknowledges the seek without counting as progress; started/resumed re-issue a pending seek at once and restart its resend clock',t=>{
 const h=harness(t,{start:0});const p=h.init(h.make());p.play();
 h.prime(p,900,7800);clear(p);
 p.seek(30);
 h.tick(2000);clear(p);
 h.msg(p,{event:'started'});
 assert.deepEqual(actions(p),['seek','mute','volume'],'started while a seek is pending resends the seek');
 assert.equal(posted(p)[0].time,30);clear(p);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:903,duration:7800});
 assert.deepEqual(seeks(p),[],'the resend clock restarted when started re-sent the seek');
 clear(p);
 h.msg(p,{event:'rewound',time:31});
 assert.equal(p.target,null,'rewound within 3s of the target acknowledges it');
 assert.equal(p.advances,0,'...but is not an advance');assert.equal(p.primed,false);
 assert.equal(p.lastTime,901,'rewound does not update the last reported position');
 assert.deepEqual(seeks(p),[],'acknowledged: no further seek');
 clear(p);
 h.msg(p,{event:'resumed'});
 assert.deepEqual(actions(p),['mute','volume'],'resumed with no pending seek only re-applies volume');
});

test('seeking far from a pending target replaces it; seeking while initialized but in an ad is deferred until the ad clears',t=>{
 const h=harness(t);const p=h.init(h.make());p.play();h.prime(p,0,7800);clear(p);
 h.msg(p,{event:'adShown'});
 p.seek(1200);
 assert.equal(p.target,1200);
 assert.deepEqual(posted(p),[],'no seek is sent to a player that is showing an ad');
 h.msg(p,{event:'timeupdate',time:1,duration:7800});
 assert.equal(p.inAd,false);
 assert.deepEqual(posted(p),[{action:'seek',time:1200}],'the deferred seek goes out as soon as content resumes');
});

// ---- ads -------------------------------------------------------------------
test('adShown latches the ad state, resets readiness, and is only cleared by a timeupdate carrying the recording\'s own duration',t=>{
 const h=harness(t,{start:0});const p=h.init(h.make());p.play();
 h.prime(p,300,7800);
 const ads=[];p.on('ad',on=>ads.push(on));
 h.msg(p,{event:'adShown'});
 assert.equal(p.inAd,true);assert.deepEqual(ads,[true]);
 assert.equal(p.primed,false);assert.equal(p.advances,0);assert.equal(p.progressing,false);
 h.msg(p,{event:'adShown'});
 assert.deepEqual(ads,[true],'repeated adShown does not re-emit');
 h.tick(1000);h.msg(p,{event:'timeupdate',time:1});
 assert.equal(p.inAd,true,'a report with no duration (ad progress) does not end the ad');
 assert.equal(p.lastTime,301,'...and does not move the position');
 h.tick(1000);h.msg(p,{event:'timeupdate',time:2,duration:15});
 assert.equal(p.inAd,true,'a 15s duration is the ad, not the 7800s recording');
 assert.equal(p.lastTime,301);assert.equal(p.duration,7800);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:3,duration:7794});
 assert.equal(p.inAd,true,'more than 5s off the recording length is still not the recording');
 h.tick(1000);h.msg(p,{event:'timeupdate',time:302,duration:7796});
 assert.equal(p.inAd,false,'within 5s of the recording length: content is back');
 assert.deepEqual(ads,[true,false]);
 assert.equal(p.lastTime,302);assert.equal(p.advances,1);
 h.tick(1000);h.msg(p,{event:'timeupdate',time:303,duration:7800});
 assert.equal(p.progressing,true);assert.equal(p.near(303),true);
});

test('a pre-roll ad that reports its own duration before the recording length is known must not become the recording length',t=>{
 const h=harness(t);const p=h.init(h.make());p.play();clear(p);
 h.msg(p,{event:'adShown'});
 h.msg(p,{event:'timeupdate',time:2,duration:15});
 assert.equal(p.inAd,true,'an ad-length duration cannot prove content is playing');
 assert.ok(Number.isNaN(p.duration),'the ad length is not the recording length');
 p.seek(3000);
 assert.equal(p.target,3000,'a later seek is not clamped to the ad length');
});

// ---- message hygiene -------------------------------------------------------
test('messages from another origin, another window, or with malformed payloads are ignored entirely',t=>{
 const h=harness(t);const p=h.make();
 h.msg(p,{event:'inited'},{origin:'https://attacker.example'});
 assert.equal(p.initialized,false,'wrong origin');
 h.msg(p,{event:'inited'},{origin:'https://ok.ru.evil.example'});
 assert.equal(p.initialized,false,'look-alike origin');
 h.msg(p,{event:'inited'},{source:{postMessage(){}}});
 assert.equal(p.initialized,false,'right origin, wrong window');
 const other=h.make('https://ok.ru/videoembed/5678');
 h.msg(p,{event:'inited'},{source:other.element.contentWindow});
 assert.equal(p.initialized,false,'another player\'s frame');assert.equal(other.initialized,true,'...which is routed to the player owning that frame');
 h.msg(p,'inited');h.msg(p,null);h.msg(p,42);
 assert.equal(p.initialized,false,'non-object payloads');
 h.msg(p,{event:'inited'});
 assert.equal(p.initialized,true,'the genuine message still gets through');
 clear(p);
 for(const bad of [{event:'timeupdate',time:'12',duration:7800},{event:'timeupdate',time:-1,duration:7800},{event:'timeupdate',time:NaN,duration:7800},{event:'timeupdate',time:Infinity,duration:7800},{event:'timeupdate',duration:7800},{event:'somethingElse',time:12,duration:7800},{time:12,duration:7800}])h.msg(p,bad);
 assert.equal(p.advances,0);assert.equal(p.lastTime,0);assert.ok(Number.isNaN(p.duration));assert.deepEqual(posted(p),[]);
 assert.equal(h.bus.count,2,'both players stay subscribed');
});

// ---- errors ----------------------------------------------------------------
test('error messages map provider codes to PROVIDER_<code> with a human message, are emitted once, and disable readiness',t=>{
 const h=harness(t);const p=h.init(h.make());p.play();h.prime(p,10,7800);
 const errors=[];p.on('error',e=>errors.push(e));
 h.msg(p,{event:'error',code:101});
 assert.deepEqual(p.error,{code:'PROVIDER_101',message:'This recording was removed.'});
 assert.deepEqual(errors,[p.error]);
 assert.equal(p.progressing,false);assert.equal(p.near(11),false);
 const cases={100:/still processing/,102:/blocked/,103:/could not find/,150:/restricted/,151:/denied access/,152:/disabled embedded playback/,153:/unavailable in your region/};
 for(const [code,re] of Object.entries(cases)){const q=h.init(h.make());h.msg(q,{event:'error',code:Number(code)});assert.equal(q.error.code,'PROVIDER_'+code);assert.match(q.error.message,re);}
 const unknown=h.init(h.make());h.msg(unknown,{event:'error',code:999});
 assert.deepEqual(unknown.error,{code:'PROVIDER_999',message:'The replay provider could not start this recording.'});
 const missing=h.init(h.make());h.msg(missing,{event:'error'});
 assert.equal(missing.error.code,'PROVIDER_0');
});

test('ended is forwarded, and on() supports several listeners per event',t=>{
 const h=harness(t);const p=h.init(h.make());
 const seen=[];p.on('ended',()=>seen.push('a'));p.on('ended',()=>seen.push('b'));
 h.msg(p,{event:'ended'});
 assert.deepEqual(seen,['a','b']);
});

// ---- unwanted play ---------------------------------------------------------
test('a player that starts or keeps advancing without being asked to play is told to pause',t=>{
 const h=harness(t,{start:0});const p=h.init(h.make());
 assert.equal(p.wantPlay,false);
 h.msg(p,{event:'started'});
 assert.deepEqual(actions(p),['pause','mute','volume'],'autoplay started: pause immediately');clear(p);
 h.msg(p,{event:'resumed'});
 assert.deepEqual(actions(p),['pause','mute','volume']);clear(p);
 h.msg(p,{event:'timeupdate',time:1,duration:7800});h.tick(500);
 h.msg(p,{event:'timeupdate',time:1.5,duration:7800});h.tick(500);
 assert.deepEqual(actions(p),[],'two reports could be the tail of a pause');
 h.msg(p,{event:'timeupdate',time:2,duration:7800});
 assert.deepEqual(actions(p),['pause'],'a third advancing report means it is really playing: pause again');clear(p);
 assert.equal(p.primed,true,'footage did play here, so a paused player can still be "near" this position');
 p.play();clear(p);
 h.msg(p,{event:'started'});
 assert.deepEqual(actions(p),['mute','volume'],'wanted play: no pause');clear(p);
 for(let i=0;i<4;i++){h.tick(500);h.msg(p,{event:'timeupdate',time:3+i,duration:7800});}
 assert.deepEqual(actions(p),[],'advancing while wanted never pauses');
});

// ---- destroy ---------------------------------------------------------------
test('destroy unsubscribes from messages, unloads the frame, removes it, stops the bootstrap and drops listeners',t=>{
 const h=harness(t);const p=h.init(h.make());p.play();
 assert.equal(h.intervals(),1,'playing: the bootstrap is running');
 const seen=[];p.on('ended',()=>seen.push(1));
 clear(p);p.destroy();
 assert.equal(h.bus.count,0);
 assert.equal(p.element.src,undefined,'src attribute removed so the provider stops loading');
 assert.equal(p.element.removed,true);
 assert.equal(p.wantPlay,false);
 assert.equal(h.intervals(),0,'the bootstrap is stopped');
 h.tick(3000);
 assert.deepEqual(posted(p),[],'nothing is sent after destroy');
 h.msg(p,{event:'ended'});h.msg(p,{event:'timeupdate',time:50,duration:7800});
 assert.deepEqual(seen,[]);assert.equal(p.lastTime,0,'messages after destroy are not received');
 p.emit('ended');assert.deepEqual(seen,[],'listeners were cleared');
});

// ---- PlayerPool: open / close / trim ---------------------------------------
test('open() creates a hidden layer per key through the injected factory, wires ad/ended/error callbacks with the key, and reuses a slot for the same URL',()=>{
 const ph=poolHarness();const {pool,host,events}=ph;
 const slot=ph.open('A');
 assert.equal(slot.key,'A');assert.equal(slot.url,'fake://A');assert.equal(slot.player.source.url,'fake://A');
 assert.equal(pool.get('A'),slot);assert.equal(pool.get('missing'),null);
 const el=slot.player.element;
 assert.ok(el.classList.contains('layer'));assert.equal(el.getAttribute('aria-hidden'),'true');assert.equal(el.tabIndex,-1);
 assert.deepEqual(host.children,[el],'appended to the host');
 assert.equal(pool.visible,null);assert.equal(pool.current,null,'opening does not show');
 slot.player.emit('ad',true);slot.player.emit('ended');const err={code:'X'};slot.player.emit('error',err);
 assert.deepEqual(events,[['ad','A',true],['ended','A'],['error','A',err]]);
 const again=pool.open('A',{type:'fake',url:'fake://A'});
 assert.equal(again,slot,'same key and URL: the slot is reused');
 assert.equal(ph.players.size,1,'no second player was created');
 assert.equal(again.used,2,'reuse marks the slot as recently used');
 const replaced=pool.open('A',{type:'fake',url:'fake://A2'});
 assert.notEqual(replaced,slot,'a new URL replaces the player');
 assert.equal(slot.player.destroyed,true);assert.deepEqual(host.children,[replaced.player.element]);
 replaced.player.error={code:'PROVIDER_101'};
 const healed=pool.open('A',{type:'fake',url:'fake://A2'});
 assert.notEqual(healed,replaced,'an errored player is rebuilt even for the same URL');
 assert.equal(replaced.player.destroyed,true);assert.equal(pool.slots.size,1);
});

test('capacity: opening beyond it closes the least recently used hidden slot, never the visible one; close() of the visible slot clears it',()=>{
 const ph=poolHarness({capacity:2});const {pool,host}=ph;
 ph.open('A');ph.open('B');
 assert.ok(pool.show('A'));
 ph.open('C');
 assert.deepEqual([...pool.slots.keys()],['A','C'],'B (hidden, least used) was closed');
 assert.equal(ph.players.get('fake://B').destroyed,true);
 assert.equal(host.children.length,2);
 pool.hold('C',10);
 ph.open('D');
 assert.deepEqual([...pool.slots.keys()],['A','D'],'C was the only hidden candidate');
 pool.close('A');
 assert.equal(pool.visible,null);assert.equal(pool.current,null);assert.equal(pool.get('A'),null);
 assert.equal(ph.players.get('fake://A').destroyed,true);
 pool.close('nope');
 assert.deepEqual([...pool.slots.keys()],['D']);
});

// ---- PlayerPool: hold ------------------------------------------------------
test('hold() seeks a fresh player right away, even one already reporting the target, and plays it only when the pool is running (or play is forced)',()=>{
 const ph=poolHarness();const {pool}=ph;
 ph.open('A');
 pool.hold('A',120);
 assert.deepEqual(ph.player('A').calls,[['seek',120]],'not running: seek only');
 pool.setRunning(true);
 ph.open('B');ph.player('B').time=300;
 pool.hold('B',300);
 assert.deepEqual(ph.player('B').calls,[['seek',300],['play']],'fresh: seeked although it reports the target already (nothing has played there yet)');
 ph.open('C');
 pool.hold('C',50,{play:false});
 assert.deepEqual(ph.player('C').calls,[['seek',50]],'explicit play:false overrides running');
 pool.hold('missing',1);
 assert.equal(pool.slots.size,3,'unknown keys are ignored');
});

test('hold() leads a moving target by the provider\'s seek latency, clamped to 1-12s; a fixed target, a paused hold, and a native player get no lead',()=>{
 const ph=poolHarness({capacity:8});const {pool}=ph;pool.setRunning(true);
 ph.open('P','provider');ph.open('N','native');ph.open('Q','provider',{seekLatency:500});ph.open('S','provider',{seekLatency:20000});
 assert.equal(pool.lead('P'),3,'default latency 3000ms');assert.equal(pool.lead('N'),0);assert.equal(pool.lead('Q'),1,'floor 1s');assert.equal(pool.lead('S'),12,'cap 12s');assert.equal(pool.lead('missing'),0);
 pool.hold('P',100);assert.deepEqual(ph.player('P').calls,[['seek',103],['play']]);
 pool.hold('N',100);assert.deepEqual(ph.player('N').calls,[['seek',100],['play']]);
 pool.hold('Q',100);assert.deepEqual(ph.player('Q').calls,[['seek',101],['play']]);
 pool.hold('S',100);assert.deepEqual(ph.player('S').calls,[['seek',112],['play']]);
 ph.open('F','provider');pool.hold('F',100,{fixed:true});assert.deepEqual(ph.player('F').calls,[['seek',100],['play']],'fixed: no lead');
 ph.open('H','provider');pool.hold('H',100,{play:false});assert.deepEqual(ph.player('H').calls,[['seek',100]],'not playing: nothing to lead');
 ph.player('P').seekLatency=0;assert.equal(pool.lead('P'),3,'an unknown latency falls back to 3s');
});

test('hold() with a pending seek leaves it alone, whatever the new target, until it looks stuck (15s); it only starts a player that is not already asked to play',()=>{
 const ph=poolHarness({start:0});const {pool}=ph;pool.setRunning(true);
 ph.open('A');pool.hold('A',100);
 const p=ph.player('A').reset();
 pool.hold('A',103.9);
 assert.deepEqual(p.calls,[],'seek pending and already playing: wait for it to land');
 pool.hold('A',500);
 assert.deepEqual(p.calls,[],'even a target far from the pending seek does not re-seek: a provider re-seeked every poll never delivers a frame');
 p.wantPlay=false;
 pool.hold('A',500);
 assert.deepEqual(p.calls,[['play']],'...but a paused player is started so it will be moving when the seek lands');
 p.reset();
 pool.hold('A',500,{play:false});
 assert.deepEqual(p.calls,[],'play not wanted: nothing is sent while the seek is pending, not even a pause');
 ph.tick(15000);pool.hold('A',500);
 assert.deepEqual(p.calls,[],'15s is not yet stuck');
 ph.tick(1);pool.hold('A',500);
 assert.deepEqual(p.calls,[['seek',500],['play']],'more than 15s unanswered: the seek is sent again');
 assert.equal(p.target,500);
 p.reset();ph.tick(14000);pool.hold('A',600);
 assert.deepEqual(p.calls,[],'the stuck clock restarts from the re-seek');
});

test('hold() drift: re-seek when more than 8s behind or 30s ahead; a hidden native player more than 1.2s ahead is paused and resumed once the target catches up; providers are never paused for running ahead',()=>{
 const ph=poolHarness();const {pool}=ph;pool.setRunning(true);
 ph.open('A','native');pool.hold('A',100);
 const p=ph.player('A').settle(100).reset();
 pool.hold('A',100);
 assert.deepEqual(p.calls,[],'aligned and playing: nothing to do');
 p.time=92;pool.hold('A',100);
 assert.deepEqual(p.calls,[],'8s behind is within BEHIND');
 p.time=91.9;pool.hold('A',100);
 assert.deepEqual(p.calls,[['seek',100],['play']],'more than 8s behind: re-seek');
 p.settle(100).reset();
 p.time=129;pool.hold('A',100);
 assert.deepEqual(p.calls,[['pause']],'hidden native player ahead: wait for the target');
 assert.equal(p.wantPlay,false);
 p.reset();p.time=131;p.wantPlay=true;pool.hold('A',100);
 assert.deepEqual(p.calls,[['seek',100],['play']],'more than 30s ahead: re-seek rather than wait');
 p.settle(100).reset();
 p.time=101.5;pool.hold('A',100);
 assert.deepEqual(p.calls,[['pause']],'ahead by more than AHEAD (1.2s): pause');
 p.reset();pool.hold('A',100.2);
 assert.deepEqual(p.calls,[['pause']],'still 1.3s ahead: keep waiting');
 p.reset();pool.hold('A',100.5);
 assert.deepEqual(p.calls,[['play']],'within 1.2s: resume');
 p.reset();p.time=100;
 pool.hold('A',100,{play:false});
 assert.deepEqual(p.calls,[['pause']],'play:false pauses a playing player');
 p.reset();pool.hold('A',100,{play:false});
 assert.deepEqual(p.calls,[],'already paused');
 p.reset();p.time=92.5;pool.hold('A',100);
 assert.deepEqual(p.calls,[['play']],'paused and behind, but within 8s: play');
 // A hidden provider keeps rolling when ahead: paused, it would restart from its own remembered position.
 ph.open('B','provider');pool.hold('B',100);
 const q=ph.player('B').settle(100).reset();
 q.time=129;pool.hold('B',100);
 assert.deepEqual(q.calls,[],'provider 29s ahead: never paused');
 q.wantPlay=false;pool.hold('B',100);
 assert.deepEqual(q.calls,[['play']],'...and is started if it is not playing');
 q.reset();q.time=131;pool.hold('B',100);
 assert.deepEqual(q.calls,[['seek',103],['play']],'more than 30s ahead: re-seek, led by the seek latency');
 q.settle(103).reset();q.time=91.9;pool.hold('B',100);
 assert.deepEqual(q.calls,[['seek',103],['play']],'more than 8s behind: re-seek, led');
});

test('hold() never pauses the visible player for running ahead, and a null target only toggles play/pause',()=>{
 const ph=poolHarness();const {pool}=ph;pool.setRunning(true);
 ph.open('A','native');pool.hold('A',100);
 const p=ph.player('A').settle(100);
 pool.show('A');p.reset();
 p.time=105;pool.hold('A',100);
 assert.deepEqual(p.calls,[],'visible native player 5s ahead: keep rolling, never freeze the screen');
 p.time=140;pool.hold('A',100);
 assert.deepEqual(p.calls,[['seek',100],['play']],'...unless wildly ahead');
 p.settle(100).reset();p.wantPlay=false;
 pool.hold('A',null);
 assert.deepEqual(p.calls,[['play']],'null target while running: play');
 p.reset();
 pool.hold('A',undefined,{play:false});
 assert.deepEqual(p.calls,[['pause']],'null target without play: pause');
 p.reset();
 pool.setRunning(false);p.reset();
 pool.hold('A',null);
 assert.deepEqual(p.calls,[['pause']],'null target while stopped: pause');
});

// ---- PlayerPool: ready / show / hide / mute / running ----------------------
test('ready() reports false for unknown slots, uses progressing for a null target, and near() with TOLERANCE (8s) unless given otherwise',()=>{
 const ph=poolHarness();const {pool}=ph;
 assert.equal(TOLERANCE,8);
 assert.equal(pool.ready('A',10),false);
 ph.open('A');const p=ph.player('A');
 assert.equal(pool.ready('A',null),false);
 p.progressing=true;assert.equal(pool.ready('A',null),true);assert.equal(pool.ready('A',undefined),true);
 assert.equal(pool.ready('A',10),false,'not primed');
 p.settle(10);p.progressing=false;
 assert.equal(pool.ready('A',12),true);
 assert.equal(pool.ready('A',18),true,'8s away is still within TOLERANCE');
 assert.equal(pool.ready('A',18.1),false);assert.equal(pool.ready('A',1.9),false);
 assert.deepEqual(p.calls.filter(c=>c[0]==='near').at(-1),['near',1.9,8],'the default tolerance is passed to near()');
 assert.equal(pool.ready('A',13,2),false,'explicit tolerance is passed through');
 assert.deepEqual(p.calls.filter(c=>c[0]==='near').at(-1),['near',13,2]);
 p.nearResult=false;
 assert.equal(pool.ready('A',10),false,'whatever near() says, ready says');
});

test('show() puts one slot on screen and mutes every other player; the visible one follows the pool mute state; hide() mutes all',()=>{
 const ph=poolHarness();const {pool}=ph;
 ph.open('A');ph.open('B');ph.open('C');
 const [a,b,c]=['A','B','C'].map(k=>ph.player(k));
 assert.equal(pool.show('missing'),false);assert.equal(pool.visible,null);
 assert.equal(pool.show('B'),true);
 assert.equal(pool.visible,'B');assert.equal(pool.current,b);
 assert.equal(b.element.classList.contains('on'),true);assert.equal(b.element.getAttribute('aria-hidden'),'false');
 assert.equal(a.element.classList.contains('on'),false);assert.equal(a.element.getAttribute('aria-hidden'),'true');
 assert.deepEqual([a.muted,b.muted,c.muted],[true,true,true],'pool starts muted, so even the visible player is muted');
 assert.deepEqual(b.names(),['muted'],'not running: show does not play');
 pool.setMuted(false);
 assert.deepEqual([a.muted,b.muted,c.muted],[true,false,true],'unmuting the pool unmutes only the visible player');
 pool.setRunning(true);
 assert.deepEqual(b.names(),['muted','muted','play'],'setRunning(true) plays the visible player');
 assert.deepEqual(a.names(),['muted'],'...and only the visible player; hidden players were muted once by show()');
 pool.show('C');
 assert.deepEqual([a.muted,b.muted,c.muted],[true,true,false],'switching mutes the old visible player');
 assert.equal(c.element.classList.contains('on'),true);assert.equal(b.element.classList.contains('on'),false);
 assert.deepEqual(c.names().slice(-2),['muted','play'],'running: the newly shown player is played');
 pool.setMuted(true);
 assert.equal(c.muted,true);
 pool.setMuted(false);
 pool.hide();
 assert.equal(pool.visible,null);assert.equal(pool.current,null);
 assert.deepEqual([a.muted,b.muted,c.muted],[true,true,true]);
 assert.equal(c.element.classList.contains('on'),false);
 pool.setMuted(false);
 assert.deepEqual([a.muted,b.muted,c.muted],[true,true,true],'no visible slot: nothing to unmute');
});

test('setRunning(false) pauses every player; setRunning(true) resumes only the visible one',()=>{
 const ph=poolHarness();const {pool}=ph;pool.setRunning(true);
 ph.open('A');ph.open('B');pool.hold('A',10);pool.hold('B',20);pool.show('A');
 const a=ph.player('A').reset(),b=ph.player('B').reset();
 assert.equal(a.wantPlay,true);assert.equal(b.wantPlay,true);
 pool.setRunning(false);
 assert.equal(pool.running,false);
 assert.deepEqual(a.names(),['pause']);assert.deepEqual(b.names(),['pause']);
 a.reset();b.reset();
 pool.setRunning(true);
 assert.deepEqual(a.names(),['play']);assert.deepEqual(b.names(),[],'hidden players wait for their next hold()');
 pool.hold('B',20);
 assert.deepEqual(b.names(),['play'],'hold() with a pending seek resumes it now that the pool runs');
});

// ---- PlayerPool: keep ------------------------------------------------------
test('keep() pauses unwanted hidden native players at once, lets unwanted providers keep playing muted, closes an unwanted hidden slot after 20s without use, and never touches the visible one',()=>{
 const ph=poolHarness({start:0});const {pool,host}=ph;pool.setRunning(true);
 ph.open('A','native');ph.open('B','native');ph.open('C','provider');ph.open('D','native');
 pool.hold('A',1);pool.hold('B',2);pool.hold('C',3);pool.hold('D',4);pool.show('A');
 const [a,b,c,d]=['A','B','C','D'].map(k=>ph.player(k).reset());
 ph.tick(1000);
 pool.keep(new Set(['B']));
 assert.deepEqual([...pool.slots.keys()],['A','B','C','D'],'players used a second ago are kept warm');
 assert.deepEqual(a.names(),[],'visible: never paused by keep');
 assert.deepEqual(b.names(),[],'wanted: untouched');
 assert.deepEqual(c.names(),[],'unwanted provider: keeps playing (paused, it would restart from its own position)');
 assert.equal(c.wantPlay,true);
 assert.deepEqual(d.names(),['pause'],'unwanted native: paused');
 ph.tick(19000);pool.keep(new Set());
 assert.deepEqual([...pool.slots.keys()],['A','B','C','D'],'exactly 20s since use is not yet stale');
 ph.tick(1);pool.keep(new Set());
 assert.deepEqual([...pool.slots.keys()],['A'],'more than 20s without use: the unwanted players are closed');
 assert.ok(b.destroyed&&c.destroyed&&d.destroyed);assert.equal(a.destroyed,false);
 assert.deepEqual(a.names(),[],'the visible player is never closed or paused, even when not in the keep set');
 assert.deepEqual(host.children,[a.element]);
 assert.equal(pool.visible,'A');
});

test('keep() measures staleness from the last use (open/hold/show refresh it), not from how many pool operations have happened',()=>{
 const ph=poolHarness({start:90000});const {pool}=ph;pool.setRunning(true);
 ph.open('A');ph.open('B');ph.open('C');pool.show('A');
 pool.hold('B',50);pool.hold('C',60);
 pool.keep(new Set());
 assert.deepEqual([...pool.slots.keys()],['A','B','C'],'used 0ms ago: not closed, although the clock reads 90s');
 assert.equal(ph.player('B').destroyed,false);
 ph.tick(15000);pool.hold('C',75);
 ph.tick(4000);pool.keep(new Set());
 assert.deepEqual([...pool.slots.keys()],['A','B','C'],'19s is not yet stale');
 ph.tick(2000);pool.keep(new Set());
 assert.deepEqual([...pool.slots.keys()],['A','C'],'B: 21s without use, closed; C: held 6s ago, kept');
 ph.tick(14000);pool.keep(new Set());
 assert.deepEqual([...pool.slots.keys()],['A','C'],'C: exactly 20s since its hold, kept');
 ph.tick(1);pool.keep(new Set());
 assert.deepEqual([...pool.slots.keys()],['A']);
});

test('destroy() closes every slot and empties the host; the pool can be reused afterwards',()=>{
 const ph=poolHarness();const {pool,host}=ph;
 ph.open('A');ph.open('B');pool.show('A');
 pool.destroy();
 assert.equal(pool.slots.size,0);assert.equal(pool.visible,null);assert.equal(pool.current,null);
 assert.deepEqual(host.children,[]);
 assert.ok([...ph.players.values()].every(p=>p.destroyed));
 ph.open('C');assert.equal(pool.slots.size,1);
});

// ---- integration: a pool of real provider players --------------------------
test('a pool of real ProviderPlayers: hold() seeks (led) through the handshake, ready() turns true after footage plays at the target, show() unmutes only the screen, a hidden provider is never paused, keep() closes a stale one and destroy() silences everything',t=>{
 const h=harness(t,{start:0});
 const host=fakeHost();
 const pool=new PlayerPool(host,{capacity:3,create:source=>h.make(source.url),now:()=>h.now});
 pool.setRunning(true);
 pool.open('g1',{type:'provider/ok',url:'https://ok.ru/videoembed/1'});
 pool.open('g2',{type:'provider/ok',url:'https://ok.ru/videoembed/2'});
 const g1=pool.get('g1').player,g2=pool.get('g2').player;
 assert.equal(host.children.length,2);assert.equal(g1.element.src,'https://ok.ru/videoembed/1?autoplay=1&muted=1&silent=1');
 assert.equal(pool.lead('g1'),3,'a provider seek is assumed to take 3s until measured');
 pool.hold('g1',1500);pool.hold('g2',2400);
 assert.deepEqual(posted(g1),[],'frames have not reported inited: commands wait');
 assert.equal(g1.target,1503,'the moving target is led by 3s');assert.equal(g1.wantPlay,true);
 h.msg(g1,{event:'inited'});h.msg(g2,{event:'inited'});
 assert.deepEqual(posted(g1),[{action:'mute'},{action:'volume',value:0},{action:'seek',time:1503},{action:'play'}]);
 assert.deepEqual(seeks(g2),[2403]);
 assert.equal(pool.ready('g1',1500),false);
 h.tick(2000);
 assert.deepEqual(seeks(g1),[1503],'2s after the seek the bootstrap is still only asking for play');
 assert.ok(actions(g1).filter(a=>a==='play').length>=3,'...repeatedly');
 h.msg(g1,{event:'timeupdate',time:1500,duration:7800});
 assert.equal(g1.target,null,'1500 is within 3s of the led 1503: landed');
 assert.equal(g1.seekLatency,2500,'measured 2s, averaged with the 3s assumption');
 assert.equal(pool.lead('g1'),2.5,'the next moving target is led by the measured latency');
 h.tick(1000);h.msg(g1,{event:'timeupdate',time:1501,duration:7800});
 assert.equal(pool.ready('g1',1501),true);assert.equal(pool.ready('g1',1509),true,'within TOLERANCE');assert.equal(pool.ready('g1',1509.1),false);assert.equal(pool.ready('g2',2400),false);
 assert.equal(g1.timer,null,'primed: g1 stopped bootstrapping');
 clear(g1);clear(g2);
 pool.show('g1');
 assert.equal(g1.muted,true,'pool is muted by default');
 pool.setMuted(false);
 assert.equal(g1.muted,false);assert.equal(g2.muted,true);
 assert.deepEqual(actions(g1).slice(-2),['unmute','volume']);
 assert.deepEqual(actions(g2).filter(a=>a==='unmute'),[],'the hidden player is never unmuted');
 assert.equal(g1.element.classList.contains('on'),true);assert.equal(g2.element.classList.contains('on'),false);
 // g2 lands, then runs 4s ahead while hidden: a provider is left rolling.
 h.msg(g2,{event:'timeupdate',time:2400,duration:7800});h.tick(1000);h.msg(g2,{event:'timeupdate',time:2401,duration:7800});
 assert.equal(pool.ready('g2',2401),true);
 clear(g2);
 h.tick(200);h.msg(g2,{event:'timeupdate',time:2404,duration:7800});
 pool.hold('g2',2400);
 assert.deepEqual(actions(g2),[],'hidden provider ahead of its target keeps playing: paused, it would restart from its own position');
 assert.equal(g2.wantPlay,true);
 // The target moves far ahead of it: re-seek, led by g2's measured latency.
 pool.hold('g2',2420);
 assert.equal(g2.target,2420+pool.lead('g2'));
 assert.deepEqual(posted(g2),[{action:'seek',time:g2.target},{action:'play'}],'seek first, then the bootstrap asks for play again');
 pool.keep(new Set(['g2']));
 assert.equal(pool.slots.size,2,'wanted: kept');
 pool.keep(new Set());
 assert.equal(pool.slots.size,2,'unwanted but used just now: kept, still playing');assert.equal(g2.wantPlay,true);
 h.tick(20001);
 pool.keep(new Set());
 assert.equal(pool.slots.size,1,'unwanted for more than 20s: closed');
 assert.equal(g2.element.removed,true);assert.equal(h.bus.count,1);
 clear(g1);
 pool.destroy();
 assert.equal(h.bus.count,0,'every player unsubscribed');assert.deepEqual(host.children,[]);
 assert.equal(h.intervals(),0,'no bootstrap survives destroy');
 h.tick(5000);
 assert.deepEqual(posted(g1),[],'nothing is sent after destroy');
});

test('createPlayer builds a ProviderPlayer for provider/ok sources',t=>{
 const frame=fakeFrame();
 const saved={window:globalThis.window,document:globalThis.document};
 globalThis.window=new Bus();globalThis.document={createElement:tag=>{assert.equal(tag,'iframe');return frame;}};
 t.after(()=>{if(saved.window===undefined)delete globalThis.window;else globalThis.window=saved.window;if(saved.document===undefined)delete globalThis.document;else globalThis.document=saved.document;});
 const p=createPlayer({type:'provider/ok',url:EMBED});
 assert.ok(p instanceof ProviderPlayer);assert.equal(p.element,frame);assert.equal(frame.src,CANONICAL);
 assert.equal(globalThis.window.count,1,'listens on window by default');
 p.destroy();assert.equal(globalThis.window.count,0);
});

// ---- EmbedPlayer: a page embed loads only while it is on screen ------------
import {EmbedPlayer} from '../web/embed-player.js';
test('EmbedPlayer: hidden it has no page and counts as ready; shown it loads the page and is ready 1.5 s after load; hidden again it goes blank',()=>{
 const saved=globalThis.document;let frame;
 globalThis.document={createElement(){frame=fakeFrame();frame.listeners={};frame.addEventListener=(n,fn)=>{frame.listeners[n]=fn;};return frame;}};
 try{
  let now=0;const p=new EmbedPlayer('https://stream.example/game',{now:()=>now});
  assert.equal(p.kind,'embed');assert.equal(frame.src,undefined,'nothing loads until shown');
  assert.equal(p.progressing,true,'hidden: nothing to wait for');assert.equal(p.near(),true);
  p.setVisible(true);
  assert.equal(frame.src,'https://stream.example/game');assert.equal(p.progressing,false,'shown: not until the page has loaded');
  now=1000;frame.listeners.load();assert.equal(p.progressing,false);
  now=2600;assert.equal(p.progressing,true);
  p.setVisible(true);assert.equal(p.loadedAt,1000,'showing it again does not reload');
  p.setVisible(false);assert.equal(frame.src,'about:blank');assert.equal(p.progressing,true);
  now=3000;frame.listeners.load();assert.equal(p.loadedAt,null,'a hidden load (the blank page) is ignored');
  p.setVisible(true);assert.equal(frame.src,'https://stream.example/game');assert.equal(p.progressing,false);
  p.destroy();assert.equal(frame.src,'about:blank');assert.equal(frame.removed,true);
 }finally{globalThis.document=saved;}
});
test('PlayerPool.show()/hide() tell players whether they are on screen',()=>{
 const host=fakeHost(),shown=[];
 const make=key=>({kind:'embed',element:fakeElement(),listeners:new Map(),on(){},play(){},pause(){},seek(){},destroy(){},near(){return true;},progressing:true,target:null,primed:true,advances:2,wantPlay:false,error:null,set muted(v){},get muted(){return true;},setVisible(on){shown.push([key,on]);}});
 const pool=new PlayerPool(host,{capacity:3,create:s=>make(s.url),now:()=>0});
 pool.open('a',{url:'a',type:'embed/page'});pool.open('b',{url:'b',type:'embed/page'});
 pool.show('a');assert.deepEqual(shown.splice(0),[['a',true],['b',false]]);
 pool.show('b');assert.deepEqual(shown.splice(0),[['a',false],['b',true]]);
 pool.hide();assert.deepEqual(shown.splice(0),[['a',false],['b',false]]);
});

test('ProviderPlayer.resume(): after the viewer\'s click paused the provider, asks it straight to play without restarting the bootstrap',t=>{
 const h=harness(t);const p=h.init(h.make());
 p.play();h.prime(p,100);assert.equal(p.progressing,true);assert.equal(h.intervals(),0,'the bootstrap has finished');
 p.element.posted.length=0;
 h.msg(p,{event:'paused',time:101});
 p.resume();
 assert.deepEqual(actions(p),['play'],'one plain play, no seek or volume traffic');
 assert.equal(h.intervals(),0,'no bootstrap interval was started');
 assert.equal(p.wantPlay,true);
 // A player that is not initialized remembers the wish and sends nothing.
 const q=h.make();q.resume();assert.equal(q.wantPlay,true);assert.deepEqual(actions(q),[]);
});
