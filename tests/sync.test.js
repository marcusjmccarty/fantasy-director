// RecordingSync maps seconds since kickoff to seconds into an edited full-game
// recording and back. These tests run it over every real game in week7.json
// (with its built-in scorebug anchors, and again with the anchors stripped so
// the uncalibrated curve is exercised too) and over small synthetic games where
// an exact answer can be worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RecordingSync,addMark,wallForClock,clockSpan} from '../web/sync.js';

const data=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
const {types}=data;
const game=name=>{const g=data.games.find(g=>g.name===name);assert.ok(g,`week7.json has ${name}`);return g;};
const lastSnap=g=>g.plays.at(-1)[0];
// build(g) uses the archive's own anchors; build(g,{anchors:[]}) is the uncalibrated recording.
const build=(g,options={})=>new RecordingSync(g,{types,anchors:g.anchors||[],...options});
const EPS=1e-6;
// A small synthetic game: field order is [t,period,clock,type,...]; type ids are looked up by name.
const T=name=>{const i=types.indexOf(name);assert.ok(i>=0,`type ${name}`);return i;};
const row=(t,period,clock,type)=>[t,period,clock,T(type),0,1,10,50,0,0,''];

test('week7.json: every one of the 14 games carries built-in scorebug anchors and a recording length',()=>{
 assert.equal(data.games.length,14);
 for(const g of data.games){
  assert.ok(g.recordingDuration>0,g.name);assert.ok(g.plays.length>100,g.name);assert.ok(Array.isArray(g.scores)&&g.scores.length>0,g.name);
  assert.ok(Array.isArray(g.anchors)&&g.anchors.length>=30&&g.anchors.length<=600,`${g.name} has ${g.anchors?.length} anchors`);
  g.anchors.forEach((a,k)=>{
   assert.ok(Number.isFinite(a.wall)&&Number.isFinite(a.media)&&a.media>=0&&a.media<g.recordingDuration,`${g.name} anchor ${JSON.stringify(a)}`);
   if(k)assert.ok(a.wall>g.anchors[k-1].wall&&a.media>g.anchors[k-1].media,`${g.name} anchors advance in both game time and footage`);
  });
 }
 assert.equal(data.games.filter(g=>!g.anchors?.length).length,0,'no game is left uncalibrated');
});

test('media() is monotonic non-decreasing and clamped to [0,duration-0.5] over the whole game, with and without anchors',()=>{
 for(const g of data.games)for(const options of [{},{anchors:[]}]){
  const s=build(g,options),end=lastSnap(g),top=s.duration-.5;
  let prev=-Infinity;
  for(let x=-900;x<=end+900;x+=1){
   const m=s.media(x);
   assert.ok(Number.isFinite(m),`${g.name} media(${x}) finite`);
   assert.ok(m>=prev-1e-9,`${g.name} media(${x})=${m} dropped below media(${x-1})=${prev}`);
   assert.ok(m>=0&&m<=top+1e-9,`${g.name} media(${x})=${m} outside [0,${top}]`);
   prev=m;
  }
  assert.equal(s.media(-1e6),0,`${g.name} long before kickoff`);
  assert.equal(s.media(end+1e6),top,`${g.name} long after the final play`);
  // The post-game footage keeps running one-to-one until the clamp.
  assert.ok(Math.abs((s.media(end+5)-s.media(end+2))-3)<EPS||s.media(end+2)===top,`${g.name} post-game runs 1:1`);
 }
});

test('media() never jumps: each game second adds at most one scaled second of footage',()=>{
 for(const g of data.games){
  const s=build(g),end=lastSnap(g),bound=Math.max(1,...s.segments.map(x=>x.factor))+EPS;
  for(let x=-300;x<=end+300;x+=0.5){
   const d=s.media(x+.5)-s.media(x);
   assert.ok(d<=bound/2,`${g.name} media jumped by ${d} at ${x}`);
  }
 }
});

test('without anchors a recording starts at the kickoff and leaves `tail` seconds of footage after the last snap',()=>{
 for(const g of data.games){
  const s=build(g,{anchors:[]}),end=lastSnap(g);
  assert.equal(s.calibrated,false);assert.deepEqual(s.anchors,[]);assert.deepEqual(s.segments,[]);
  assert.equal(s.media(0),0,`${g.name} kickoff is the start of the recording`);
  assert.ok(Math.abs(s.media(end)-(s.duration-20))<EPS,`${g.name} default tail of 20s: media(${end})=${s.media(end)} vs ${s.duration-20}`);
  assert.ok(Math.abs(build(g,{anchors:[],tail:60}).media(end)-(s.duration-60))<EPS,`${g.name} tail=60`);
  assert.equal(build(g,{anchors:[],tail:0}).media(end),s.duration-.5,`${g.name} tail=0 is clamped just inside the end`);
  assert.equal(s.base.factor,1,`${g.name} fits without uniform scaling`);
  assert.ok(s.base.keep>0&&s.base.keep<1200,`${g.name} solved keep ${s.base.keep}`);
  assert.equal(s.edgeKeep,s.base.keep,`${g.name}: with no segments the edge retention is the base one`);
 }
 // An explicit duration overrides the archive's recordingDuration.
 const g=game('NE at CHI'),s=build(g,{anchors:[],duration:5000});
 assert.equal(s.duration,5000);assert.ok(Math.abs(s.media(lastSnap(g))-4980)<EPS);
 // The constructor only sees the anchors it is handed; it does not read game.anchors itself.
 assert.equal(build(g).calibrated,true);
 assert.equal(new RecordingSync(g,{types}).calibrated,false);
});

test('snap-to-snap gaps map one-to-one, long huddles cap at 100s and breaks keep only `keep` seconds',()=>{
 const g=game('NE at CHI'),s=build(g,{anchors:[]}),t=s.times;
 assert.equal(s.base.factor,1);
 for(let i=0;i+1<t.length;i++){
  const gap=t[i+1]-t[i],d=s.media(t[i+1])-s.media(t[i]);
  if(gap===0){assert.equal(d,0,`play ${i}`);continue;}
  const expected=s.breaks[i]?Math.min(gap,s.base.keep):Math.min(gap,100);
  assert.ok(Math.abs(d-expected)<EPS,`play ${i} (${types[g.plays[i][3]]}, gap ${gap}, break ${s.breaks[i]}): footage ${d} vs ${expected}`);
 }
 // Hand-checked examples from the play-by-play.
 assert.ok(Math.abs((s.media(87)-s.media(47))-40)<EPS,'ordinary 40s snap-to-snap gap keeps all 40s');
 assert.ok(Math.abs((s.media(3399)-s.media(3253))-100)<EPS,'a 146s huddle between two live plays keeps only 100s');
 assert.ok(Math.abs((s.media(690)-s.media(669))-21)<EPS,'a 21s break after a field goal fits inside keep and is kept whole');
 assert.ok(Math.abs((s.media(6214)-s.media(5377))-s.base.keep)<EPS,'halftime (837s) keeps exactly `keep` seconds');
 // Half the retained break follows the play, half leads into the next snap.
 const half=s.base.keep/2;
 assert.ok(Math.abs((s.media(5377+half)-s.media(5377))-half)<EPS,'first half of the break is kept at real speed');
 assert.ok(Math.abs(s.media(5377+half+200)-s.media(5377+half))<EPS,'the middle of the break is cut');
 assert.ok(Math.abs((s.media(6214)-s.media(6214-half))-half)<EPS,'the lead-in to the next snap is kept');
});

test('breaks are classified from stoppage types, scores, kickoffs and long gaps',()=>{
 const g=game('NE at CHI'),withTypes=build(g),withoutTypes=new RecordingSync(g,{anchors:[]});
 const type=i=>types[g.plays[i][3]];
 assert.equal(type(31),'Official Timeout');assert.equal(withTypes.breaks[31],true,'an official timeout is a break even with a short gap');
 assert.equal(type(36),'Timeout');assert.equal(withTypes.breaks[36],true,'a team timeout is a break');
 assert.equal(type(43),'End Period');assert.equal(withTypes.breaks[43],true,'end of quarter is a break');
 assert.equal(type(88),'End of Half');assert.equal(withTypes.breaks[88],true,'halftime is a break');
 assert.equal(type(13),'Field Goal Good');assert.equal(withTypes.breaks[13],true,'a scoring play is followed by a break');
 assert.equal(withTypes.breaks[1],false,'incompletion to the next snap is live football');
 assert.equal(withTypes.breaks[54],false,'a 146s gap between two live plays is a long huddle, not a break');
 assert.equal(withTypes.breaks.at(-1),false,'the last play has nothing after it');
 assert.equal(withTypes.breaks.length,g.plays.length);
 // Without the type table, stoppages can no longer be recognised by name, but scores and long gaps still are.
 assert.equal(withoutTypes.breaks[31],false);assert.equal(withoutTypes.breaks[36],false);
 assert.equal(withoutTypes.breaks[13],true);assert.equal(withoutTypes.breaks[88],true);
 // Kickoff and gap thresholds on a synthetic drive.
 const synthetic={recordingDuration:2000,scores:[],plays:[
  row(0,1,'15:00','Rush'),row(70,1,'14:30','Kickoff'),       // 70s before a kickoff: break
  row(120,1,'14:00','Rush'),row(170,1,'13:30','Kickoff'),    // 50s before a kickoff: not a break
  row(220,1,'13:00','Rush'),row(371,1,'12:00','Rush'),       // 151s gap: break
  row(400,1,'11:30','Rush'),row(550,1,'11:00','Rush'),       // 150s gap: long huddle
  row(600,1,'10:30','Rush'),row(640,1,'10:00','Rush'),
 ]};
 const s=new RecordingSync(synthetic,{types});
 assert.deepEqual(s.breaks,[true,false,false,false,true,false,false,false,false,false]);
 assert.deepEqual(new RecordingSync({...synthetic,scores:[{i:8}]},{types}).breaks[8],true,'a score marks the gap after the scoring play');
});

test('span() is antisymmetric, zero at a point, additive, and counts pre-kickoff seconds one-to-one',()=>{
 const g=game('PIT VS NO'),s=build(g),end=lastSnap(g);
 for(const keep of [0,30,s.base.keep,400])for(const [a,b,c] of [[-30,0,100],[0,500,2000],[123.5,2330,2531],[5000,5377,6300],[end-10,end,end+40],[-100,-50,20]]){
  assert.equal(s.span(a,a,keep),0);assert.equal(s.span(b,b,keep),0);
  assert.ok(Math.abs(s.span(a,b,keep)+s.span(b,a,keep))<EPS,`span(${a},${b}) is the negative of span(${b},${a})`);
  assert.ok(Math.abs(s.span(a,c,keep)-(s.span(a,b,keep)+s.span(b,c,keep)))<EPS,`span(${a},${c}) splits at ${b}`);
  assert.ok(s.span(a,c,keep)>0,'forward spans are positive');
 }
 assert.equal(s.span(-30,0,10),30,'pre-game footage is real time');
 assert.equal(s.span(-100,-40,10),60);
 assert.equal(s.span(end,end+45,10),45,'post-game footage is real time');
 // Over a stretch with no breaks the retention does not matter; over a break it is everything.
 assert.equal(s.span(47,87,0),s.span(47,87,1200));
 const half=s.breaks.findIndex((b,i)=>b&&s.times[i+1]-s.times[i]>700),from=s.times[half],to=s.times[half+1];
 assert.ok(half>0,'found a long break');
 assert.equal(s.span(from,to,0),0,'keep=0 drops the whole break');
 assert.equal(s.span(from,to,2*(to-from)),to-from,'a keep larger than the break keeps it all');
 assert.ok(Math.abs(s.span(from,to,90)-90)<EPS,'otherwise exactly keep seconds survive');
});

test('wall() inverts media() within a second wherever the recording is moving, for every game',()=>{
 let checked=0;
 for(const g of data.games)for(const options of [{},{anchors:[]}]){
  const s=build(g,options),end=lastSnap(g),top=s.duration-.5;
  for(let x=-120;x<=end+60;x+=2.5){
   const m=s.media(x);
   if(!(s.media(x-.1)<m-1e-9&&m+1e-9<s.media(x+.1)))continue;   // flat (cut) or clamped: no unique inverse
   if(!(m>0&&m<top))continue;
   const w=s.wall(m);
   assert.ok(Math.abs(w-x)<1,`${g.name}${options.anchors?' (no anchors)':''}: wall(media(${x})=${m}) = ${w}`);
   checked++;
  }
 }
 assert.ok(checked>20000,`checked ${checked} points`);
});

test('wall() collapses a cut break to its edges',()=>{
 const g=game('NE at CHI'),s=build(g,{anchors:[]});
 const from=5377,to=6214,half=s.base.keep/2;   // End of Half -> second-half kickoff
 assert.equal(s.breaks[s.times.indexOf(from)],true);
 const m=s.media(from+400);
 assert.equal(m,s.media(from+half),'inside the cut, the recording does not move');
 assert.ok(Math.abs(s.wall(m)-(from+half))<1e-3,'the cut maps back to its left edge');
 assert.ok(Math.abs(s.wall(s.media(to-10))-(to-10))<1e-3,'the lead-in to the kickoff inverts normally');
 assert.ok(Math.abs(s.wall(s.media(from+10))-(from+10))<1e-3,'the tail of the play inverts normally');
});

test('every built-in scorebug anchor is reproduced exactly, and its inverse lands on the same footage',()=>{
 for(const g of data.games){
  const s=build(g);
  assert.equal(s.calibrated,true,g.name);
  assert.equal(s.anchors.length,g.anchors.length,`${g.name} keeps all ${g.anchors.length} archive anchors`);
  assert.equal(s.segments.length,g.anchors.length-1);
  for(const a of g.anchors){
   const m=s.media(a.wall);
   assert.ok(Math.abs(m-a.media)<1e-3,`${g.name} anchor wall ${a.wall}: media ${m} vs ${a.media} is hit to the millisecond`);
   // A stopped-clock anchor is resolved inside its stoppage, which may be a cut break: wall() then lands on
   // the break's edge, earlier than a.wall, but the recording is at the same place there.
   const w=s.wall(a.media);
   assert.ok(w<=a.wall+1e-6,`${g.name} wall(${a.media}) = ${w} is never later than the anchor at ${a.wall}`);
   assert.ok(Math.abs(s.media(w)-a.media)<1,`${g.name} media(wall(${a.media})) = ${s.media(w)}`);
  }
 }
});

test('between two anchors the break retention is solved so both ends are hit; a segment that cannot fit is scaled instead',()=>{
 for(const g of data.games){
  const s=build(g);
  for(const seg of s.segments){
   const where=`${g.name} segment ${seg.a.wall}-${seg.b.wall}`;
   assert.ok(seg.keep>=0&&seg.keep<=1200,`${where} keep ${seg.keep}`);assert.ok(seg.factor>0,`${where} factor ${seg.factor}`);
   assert.ok(seg.factor===1||seg.keep===0||seg.keep===1200,`${where}: only a segment at a keep limit is scaled`);
   assert.ok(Math.abs(s.media(seg.a.wall)-seg.a.media)<1e-3,`${where} starts on its anchor`);
   assert.ok(Math.abs(s.media(seg.b.wall)-seg.b.media)<1e-3,`${where} ends on its anchor`);
   const mid=(seg.a.wall+seg.b.wall)/2,m=s.media(mid);
   assert.ok(m>=seg.a.media-1e-9&&m<=seg.b.media+1e-9,`${where} midpoint ${m} lies between ${seg.a.media} and ${seg.b.media}`);
   assert.ok(Math.abs(s.span(seg.a.wall,seg.b.wall,seg.keep)*seg.factor-(seg.b.media-seg.a.media))<1e-3,`${where} fills its footage`);
  }
  // The edge retention averages only the fairly solved segments.
  const fair=s.segments.filter(x=>x.factor===1);
  if(fair.length)assert.ok(Math.abs(s.edgeKeep-fair.reduce((sum,x)=>sum+x.keep,0)/fair.length)<EPS,g.name);
  else assert.equal(s.edgeKeep,s.base.keep);
 }
 // Synthetic anchors on NE at CHI: game time 1000-2000 holds at most 1000s of footage even keeping every break,
 // so asking for 1500s keeps everything and stretches.
 const g=game('NE at CHI'),plain=build(g,{anchors:[]});
 assert.equal(plain.span(1000,2000,1200),1000);
 const stretch=build(g,{anchors:[{wall:1000,media:1000},{wall:2000,media:2500}]}),[up]=stretch.segments;
 assert.equal(stretch.segments.length,1);
 assert.equal(up.keep,1200);assert.ok(Math.abs(up.factor-1.5)<EPS,'1000s of game into 1500s of footage: factor 1.5');
 assert.equal(stretch.media(1000),1000);assert.ok(Math.abs(stretch.media(2000)-2500)<1e-3);
 assert.ok(Math.abs(stretch.media(1500)-(1000+plain.span(1000,1500,1200)*1.5))<EPS,'the stretched segment scales uniformly');
 assert.equal(stretch.edgeKeep,plain.base.keep,'a scaled segment does not feed the edge retention');
 // Dropping every break still leaves more football than 100s of footage can hold: scale down.
 const squeeze=build(g,{anchors:[{wall:1000,media:1000},{wall:3000,media:1100}]}),[down]=squeeze.segments;
 assert.ok(plain.span(1000,3000,0)>100);
 assert.equal(down.keep,0);assert.ok(down.factor>0&&down.factor<1,`factor ${down.factor}`);
 assert.ok(Math.abs(down.factor-100/plain.span(1000,3000,0))<EPS);
 assert.equal(squeeze.media(1000),1000);assert.ok(Math.abs(squeeze.media(3000)-1100)<1e-3);
 assert.ok(squeeze.media(2000)>1000&&squeeze.media(2000)<1100);
 assert.equal(squeeze.edgeKeep,plain.base.keep);
 // A fairly solved neighbour is the only segment averaged into the edge retention.
 const mixed=build(g,{anchors:[{wall:1000,media:1000},{wall:2000,media:2500},{wall:4000,media:4000}]});
 assert.equal(mixed.segments.length,2);
 assert.ok(Math.abs(mixed.segments[0].factor-1.5)<EPS);assert.equal(mixed.segments[1].factor,1);
 assert.equal(mixed.edgeKeep,mixed.segments[1].keep);
 assert.ok(Math.abs(plain.span(2000,4000,mixed.edgeKeep)-1500)<1e-3,'the fair segment fills its 1500s exactly');
});

test('outside the anchored stretch the curve continues with the edge retention, pinned to the nearest anchor',()=>{
 for(const g of data.games){
  const s=build(g),first=s.anchors[0],last=s.anchors.at(-1),end=lastSnap(g);
  for(const x of [first.wall-30,first.wall-200,0,-60]){
   const expected=first.media-s.span(x,first.wall,s.edgeKeep);
   assert.ok(Math.abs(s.media(x)-Math.max(0,expected))<EPS,`${g.name} before the first anchor at ${x}`);
  }
  for(const x of [last.wall+30,last.wall+300,end,end+30]){
   const expected=last.media+s.span(last.wall,x,s.edgeKeep);
   assert.ok(Math.abs(s.media(x)-Math.min(s.duration-.5,expected))<EPS,`${g.name} after the last anchor at ${x}`);
  }
 }
});

test('a single anchor pins the curve and reuses the uncalibrated break retention on both sides',()=>{
 const g=game('NE at CHI'),plain=build(g,{anchors:[]});
 // t=3130 is during the kickoff return that follows the 2766 touchdown (live football, 3100 -> 3171).
 const s=build(g,{anchors:[{wall:3130,media:2400}]});
 assert.equal(s.breaks[s.times.indexOf(3100)],false);
 assert.equal(s.calibrated,true);assert.equal(s.segments.length,0);assert.equal(s.edgeKeep,plain.base.keep);
 assert.equal(s.media(3130),2400);
 assert.ok(Math.abs((s.media(3400)-s.media(3130))-plain.span(3130,3400,plain.base.keep))<EPS);
 assert.ok(Math.abs((s.media(3130)-s.media(2000))-plain.span(2000,3130,plain.base.keep))<EPS);
 assert.ok(Math.abs(s.wall(2400)-3130)<1e-3);
 // Pinning a moment inside a cut still hits it, but the inverse lands on the cut's edge.
 const cut=build(g,{anchors:[{wall:3000,media:2400}]});   // 2766 touchdown -> 3100 kickoff is a 334s break
 assert.equal(cut.media(3000),2400);
 assert.ok(Math.abs(cut.wall(2400)-(2766+cut.edgeKeep/2))<1e-3);
});

test('misread anchors (non-monotonic, duplicated or non-numeric) are dropped and the rest are still hit exactly',()=>{
 const g=game('NE at CHI');
 let s=build(g,{anchors:[{wall:3000,media:2200},{wall:1000,media:1000},{wall:2000,media:500}]});   // unsorted, middle one misread low
 assert.deepEqual(s.anchors,[{wall:1000,media:1000},{wall:3000,media:2200}]);
 assert.equal(s.calibrated,true);assert.equal(s.segments.length,1);
 assert.equal(s.media(1000),1000);assert.equal(s.media(3000),2200);
 assert.ok(s.media(2000)>1000&&s.media(2000)<2200);
 s=build(g,{anchors:[{wall:1000,media:1000},{wall:1000,media:1100},{wall:NaN,media:1},{wall:1500,media:Infinity},{wall:'1500',media:1300},{wall:2000,media:1800},{media:2500}]});
 assert.deepEqual(s.anchors,[{wall:1000,media:1000},{wall:2000,media:1800}],'same wall, non-finite and string readings are ignored');
 for(let k=1;k<s.anchors.length;k++){assert.ok(s.anchors[k].wall>s.anchors[k-1].wall);assert.ok(s.anchors[k].media>s.anchors[k-1].media);}
 let prev=-1;for(let x=-100;x<=lastSnap(g)+100;x+=1){const m=s.media(x);assert.ok(m>=prev-1e-9,`monotonic at ${x}`);prev=m;}
});

test('dropping one misread anchor must not let a later reading slip below the last kept one',()=>{
 // Each candidate is compared with the last anchor actually kept, not its unfiltered predecessor:
 // 2000->500 is behind 1000->1000, and so is 3000->800, so both go.
 const g=game('NE at CHI'),s=build(g,{anchors:[{wall:1000,media:1000},{wall:2000,media:500},{wall:3000,media:800}]});
 assert.deepEqual(s.anchors,[{wall:1000,media:1000}]);
 for(let k=1;k<s.anchors.length;k++)assert.ok(s.anchors[k].media>s.anchors[k-1].media,`kept anchors must move forward in the recording: ${JSON.stringify(s.anchors)}`);
 for(const seg of s.segments)assert.ok(seg.factor>0,'no segment may run backwards');
 let prev=-1;for(let x=-100;x<=lastSnap(g)+100;x+=1){const m=s.media(x);assert.ok(m>=prev-1e-9,`media(${x})=${m} < media(${x-1})=${prev}`);prev=m;}
 // A later reading that does advance past the last kept anchor is kept even though its unfiltered predecessor was misread.
 const t=build(g,{anchors:[{wall:1000,media:1000},{wall:2000,media:500},{wall:3000,media:1500}]});
 assert.deepEqual(t.anchors,[{wall:1000,media:1000},{wall:3000,media:1500}]);
 assert.equal(t.segments.length,1);assert.ok(t.segments[0].factor>0);
 assert.equal(t.media(1000),1000);assert.ok(Math.abs(t.media(3000)-1500)<1e-3);
});

test('an unknown recording duration still honours anchors and only clamps at zero',()=>{
 const g=game('NE at CHI'),bare={plays:g.plays,scores:g.scores},end=lastSnap(g);
 const s=new RecordingSync(bare,{types,anchors:[{wall:1000,media:900},{wall:5000,media:3900}]});
 assert.equal(s.duration,0);assert.equal(s.media(1000),900);assert.equal(s.media(5000),3900);
 assert.ok(s.media(end)>3900,'nothing clamps the end when the length is unknown');
 assert.equal(s.media(-5000),0);
 let prev=-1;for(let x=-100;x<=end+100;x+=1){const m=s.media(x);assert.ok(Number.isFinite(m)&&m>=prev-1e-9,`media(${x})`);prev=m;}
 const unknown=new RecordingSync(bare,{types});
 for(const x of [-10,0,100,end,end+100]){const m=unknown.media(x);assert.ok(Number.isFinite(m)&&m>=0,`no duration, no anchors: media(${x})=${m}`);}
});

test('addMark rejects non-finite or negative times without touching the existing marks',()=>{
 const marks=Object.freeze([Object.freeze({wall:100,media:50})]);
 for(const [wall,media] of [[NaN,10],[Infinity,10],[undefined,10],['120',10],[120,NaN],[120,-1],[120,-Infinity],[120,'60'],[120,null]])
  assert.throws(()=>addMark(marks,wall,media),/valid video time/,`wall=${wall} media=${media}`);
 assert.deepEqual(marks,[{wall:100,media:50}]);
 assert.deepEqual(addMark([],0,0),[{wall:0,media:0}],'the kickoff at the very start of the file is a valid mark');
 assert.deepEqual(addMark([],-30,5),[{wall:-30,media:5}],'a pre-kickoff reading is allowed');
});

test('addMark keeps marks sorted by game time and replaces a mark within 5 seconds',()=>{
 const one=addMark([],100,50);
 assert.deepEqual(one,[{wall:100,media:50}]);
 const two=addMark(one,300,200);assert.deepEqual(two,[{wall:100,media:50},{wall:300,media:200}]);
 assert.deepEqual(one,[{wall:100,media:50}],'input is not mutated');
 assert.deepEqual(addMark(two,50,10),[{wall:50,media:10},{wall:100,media:50},{wall:300,media:200}],'earlier marks sort first');
 assert.deepEqual(addMark(two,103,60),[{wall:103,media:60},{wall:300,media:200}],'a re-reading 3s away replaces the old mark');
 assert.deepEqual(addMark(two,105,60),[{wall:105,media:60},{wall:300,media:200}],'exactly 5s away still counts as the same moment');
 assert.deepEqual(addMark(two,106,56),[{wall:100,media:50},{wall:106,media:56},{wall:300,media:200}],'6s away is a new mark');
 assert.deepEqual(addMark(two,100,55),[{wall:100,media:55},{wall:300,media:200}],'the same wall time overwrites');
});

test('addMark refuses a mark that would make the recording run backwards',()=>{
 const marks=[{wall:100,media:50},{wall:300,media:200}];
 assert.throws(()=>addMark(marks,200,50),/move forward/,'equal media is not forward');
 assert.throws(()=>addMark(marks,200,20),/move forward/);
 assert.throws(()=>addMark(marks,200,200),/move forward/);
 assert.throws(()=>addMark(marks,50,150),/move forward/,'an earlier moment cannot be later in the file');
 assert.throws(()=>addMark(marks,400,199),/move forward/);
 assert.deepEqual(marks,[{wall:100,media:50},{wall:300,media:200}],'nothing changed after a refusal');
 assert.deepEqual(addMark(marks,301,100),[{wall:100,media:50},{wall:301,media:100}],'replacing the offending mark resolves the order');
 assert.deepEqual(addMark(marks,200,120),[{wall:100,media:50},{wall:200,media:120},{wall:300,media:200}]);
});

test('clockSpan: a running clock pins a single second counted from the snap that started it',()=>{
 const g=game('NE at CHI');   // Q1: 15:00 kickoff at t=0, 14:53 snap at 47, 14:49 at 87, 14:16 at 127, 13:44 at 191, 13:04 at 231
 assert.deepEqual(clockSpan(g,1,'14:51'),{lo:49,hi:49});
 assert.deepEqual(clockSpan(g,1,'14:50'),{lo:50,hi:50});
 assert.deepEqual(clockSpan(g,1,'13:30'),{lo:205,hi:205});
 assert.deepEqual(clockSpan(g,'1','14:51'),{lo:49,hi:49},'the period may arrive as a string from a form');
 for(const clock of ['14:52','14:51','14:50','13:43','13:30','13:05']){
  const {lo,hi}=clockSpan(g,1,clock);
  assert.equal(lo,hi,`${clock} is an exact second`);
  assert.ok(lo>47&&lo<231,`${clock} -> ${lo} lies between its snaps`);
 }
 assert.equal(wallForClock(g,1,'14:51'),49);
 assert.equal(wallForClock(g,1,'13:30'),205);
 assert.equal(wallForClock(g,'1','14:51'),49);
});

test('clockSpan: a stopped clock spans from the end of the previous play to the snap that restarts it',()=>{
 const g=game('NE at CHI');
 // 14:53 at t=47 -> 14:49 at t=87: the clock reached 14:49 four seconds after the 14:53 snap and showed it until the next snap.
 assert.deepEqual(clockSpan(g,1,'14:49'),{lo:51,hi:87});
 assert.deepEqual(clockSpan(g,1,'14:53'),{lo:7,hi:47},'the opening kickoff ran 7s before the clock stopped');
 assert.deepEqual(clockSpan(g,1,'13:44'),{lo:159,hi:191});
 for(const clock of ['14:53','14:49','14:16','13:44','11:35']){
  const {lo,hi}=clockSpan(g,1,clock),snap=g.plays.find(p=>p[1]===1&&p[2]===clock)[0];
  assert.ok(hi>lo,`${clock} is a window`);
  assert.equal(hi,snap,`${clock} ends at its snap`);
 }
 // The app's manual sync marks are taken at a snap, so wallForClock resolves to the end of the window.
 assert.equal(wallForClock(g,1,'14:49'),87);
 assert.equal(wallForClock(g,1,'14:53'),47);
 assert.equal(wallForClock(g,1,'13:44'),191);
 assert.equal(wallForClock(g,1,'14:48'),88,'and the next second is running again');
});

test('clockSpan: consecutive rows with the same clock extend the window to the last of them',()=>{
 const g=game('NE at CHI');
 // 11:35 sack at 319 -> 11:30 official timeout at 342 -> 11:30 snap at 505: the clock stopped at 324.
 assert.deepEqual(g.plays.filter(p=>p[1]===1&&p[2]==='11:30').map(p=>p[0]),[342,505]);
 assert.deepEqual(clockSpan(g,1,'11:30'),{lo:324,hi:505});
 assert.equal(wallForClock(g,1,'11:30'),505,'the snap out of the timeout');
 assert.deepEqual(clockSpan(g,1,'11:29'),{lo:506,hi:506});
 // 10:02 incompletion at 630 -> 9:53 field goal at 669, official timeout at 690, kickoff at 851.
 assert.deepEqual(g.plays.filter(p=>p[1]===1&&p[2]==='9:53').map(p=>p[0]),[669,690,851]);
 assert.deepEqual(clockSpan(g,1,'9:53'),{lo:639,hi:851});
 assert.equal(wallForClock(g,1,'9:53'),851,'the kickoff after the field goal');
 assert.deepEqual(clockSpan(g,1,'9:52'),{lo:852,hi:852},'the clock runs again from the kickoff');
 // Overtime opens with a touchback: the kickoff (t=11484) and the first scrimmage snap (t=11535) both read 10:00.
 const ot=game('NYG at HOU'),otRows=ot.plays.filter(p=>p[1]===5);
 assert.deepEqual(otRows.slice(0,2).map(p=>[p[0],p[2]]),[[11484,'10:00'],[11535,'10:00']]);
 assert.deepEqual(clockSpan(ot,5,'10:00'),{lo:11484,hi:11535});
 assert.equal(wallForClock(ot,5,'10:00'),11535,'the clock only starts running at the scrimmage snap');
 assert.equal(wallForClock(ot,5,'9:59'),11536);assert.equal(wallForClock(ot,5,'9:58'),11537);
});

test('clockSpan: every snap row of every game lies inside the window of its own reading, which ends on a snap',()=>{
 let rows=0,windows=0;
 for(const g of data.games)for(const period of new Set(g.plays.map(p=>p[1]))){
  const quarter=g.plays.filter(p=>p[1]===period);
  for(const p of quarter){
   const {lo,hi}=clockSpan(g,period,p[2]);
   assert.ok(Number.isFinite(lo)&&Number.isFinite(hi)&&lo<=hi,`${g.name} Q${period} ${p[2]}: ${lo}..${hi}`);
   assert.ok(lo<=p[0]&&p[0]<=hi,`${g.name} Q${period} ${p[2]} at t=${p[0]} lies in ${lo}..${hi}`);
   assert.ok(quarter.some(q=>q[0]===hi),`${g.name} Q${period} ${p[2]} ends on a snap`);
   assert.equal(wallForClock(g,period,p[2]),hi,`${g.name} Q${period} ${p[2]}: wallForClock is the end of the window`);
   rows++;if(hi>lo)windows++;
  }
 }
 assert.ok(rows>2000,`checked ${rows} rows`);
 assert.ok(windows>rows/2,`most readings taken from a play-by-play row are stopped clocks (${windows} of ${rows})`);
});

test('wallForClock: a stopped reading is capped at the next snap even when the play-by-play clock outran wall time',()=>{
 const g=game('NE at CHI');   // 13:04 at t=231 then 12:16 at t=276: 48 clock seconds in 45 real seconds
 assert.deepEqual(clockSpan(g,1,'12:16'),{lo:276,hi:276},'the stop is capped at the snap instead of landing 3s past it');
 assert.equal(wallForClock(g,1,'12:16'),276);
 assert.equal(wallForClock(g,1,'12:30'),231+34,'a running reading counts from the snap that started the clock');
 assert.equal(wallForClock(g,1,'13:04'),231);
 const synthetic={plays:[row(100,1,'10:00','Rush'),row(130,1,'9:00','Rush')]};   // 60 clock seconds in 30 real seconds
 assert.deepEqual(clockSpan(synthetic,1,'9:00'),{lo:130,hi:130});
 assert.equal(wallForClock(synthetic,1,'9:59'),101);
 assert.equal(wallForClock(synthetic,1,'9:45'),115);
 assert.equal(wallForClock(synthetic,1,'9:00'),130);
 assert.equal(wallForClock(synthetic,1,'8:59'),131,'after the last row the clock runs on');
});

test('clockSpan: a reading before the first snap of a quarter extrapolates back from that snap',()=>{
 const sf=game('SF at ATL');   // Q2 opens with a 14:54 touchdown at t=2194 and the kickoff at 2319 still reads 14:54; Q4 opens at 14:55 (t=7620)
 assert.deepEqual(sf.plays.filter(p=>p[1]===2).slice(0,2).map(p=>[p[0],p[2]]),[[2194,'14:54'],[2319,'14:54']]);
 assert.deepEqual(clockSpan(sf,2,'15:00'),{lo:2188,hi:2188});
 assert.deepEqual(clockSpan(sf,2,'14:57'),{lo:2191,hi:2191});
 assert.deepEqual(clockSpan(sf,2,'14:54'),{lo:2194,hi:2319},'the first row opens the window and the kickoff closes it');
 assert.equal(wallForClock(sf,2,'15:00'),2188);assert.equal(wallForClock(sf,2,'14:57'),2191);assert.equal(wallForClock(sf,2,'14:54'),2319);
 assert.equal(sf.plays.find(p=>p[1]===4)[2],'14:55');assert.equal(wallForClock(sf,4,'15:00'),7620-5);
 const lv=game('LAR at LV');assert.equal(lv.plays.find(p=>p[1]===4)[2],'14:51');assert.equal(wallForClock(lv,4,'15:00'),8736-9);
 const synthetic={plays:[row(100,2,'14:55','Rush'),row(140,2,'14:20','Rush')]};
 assert.equal(wallForClock(synthetic,2,'15:00'),95);
 assert.equal(wallForClock(synthetic,2,'14:56'),99);
 assert.deepEqual(clockSpan(synthetic,2,'14:55'),{lo:100,hi:100},'the first snap itself is a point');
 assert.deepEqual(clockSpan(synthetic,2,'14:20'),{lo:135,hi:140});
});

test('wallForClock: quarter boundaries and readings after the last row',()=>{
 const g=game('NE at CHI');
 assert.equal(wallForClock(g,1,'15:00'),0,'the opening kickoff');
 assert.equal(wallForClock(g,2,'15:00'),2531);assert.equal(wallForClock(g,2,'14:59'),2532);
 assert.equal(wallForClock(g,3,'15:00'),6214);
 assert.deepEqual(g.plays.filter(p=>p[1]===1).slice(-2).map(p=>[p[0],p[2]]),[[2330,'0:14'],[2330,'0:00']]);
 assert.deepEqual(clockSpan(g,1,'0:00'),{lo:2330,hi:2330},'the End Period row shares the last snap time, so the window is a point');
 assert.equal(wallForClock(g,1,'0:00'),2330);
 assert.equal(wallForClock(g,4,'0:00'),11190,'final whistle');
 const synthetic={plays:[row(400,3,'0:30','Rush'),row(500,3,'0:05','Rush')]};
 assert.deepEqual(clockSpan(synthetic,3,'0:02'),{lo:503,hi:503},'after the last row the clock keeps running');
 assert.equal(wallForClock(synthetic,3,'0:02'),503);
 assert.deepEqual(clockSpan(synthetic,3,'0:05'),{lo:425,hi:500},'the clock first reads 0:05 when it stops, 25s after the 0:30 snap, and shows it until the snap at 500');
 assert.equal(wallForClock(synthetic,3,'0:05'),500);
 assert.equal(wallForClock(synthetic,3,'0:10'),420);
 assert.deepEqual(clockSpan(synthetic,3,'0:30'),{lo:400,hi:400});
});

test('wallForClock and clockSpan: invalid clock formats are rejected, padded ones are accepted',()=>{
 const g=game('NE at CHI');
 for(const clock of ['','abc','15','15:60','1:5','-1:00','15:00:00','100:00','15:0','1:00pm','9.53','9;53',null,undefined,900,NaN]){
  assert.throws(()=>wallForClock(g,1,clock),/m:ss/,`clock ${JSON.stringify(clock)}`);
  assert.throws(()=>clockSpan(g,1,clock),/m:ss/,`clock ${JSON.stringify(clock)}`);
 }
 assert.deepEqual(clockSpan(g,1,'9:53'),clockSpan(g,1,' 09:53 '));
 assert.equal(wallForClock(g,1,'9:53'),wallForClock(g,1,' 09:53 '));
 assert.equal(wallForClock(g,1,'09:53'),851);
 assert.equal(wallForClock(g,1,' 0:00'),2330);
});

test('quarters with no plays are rejected, but the clock format is checked first',()=>{
 const g=game('NE at CHI');
 assert.deepEqual([...new Set(g.plays.map(p=>p[1]))],[1,2,3,4],'a regulation game');
 for(const period of [5,0,-1,'OT','5',null,undefined,NaN]){
  assert.throws(()=>wallForClock(g,period,'15:00'),/No plays/,`period ${JSON.stringify(period)}`);
  assert.throws(()=>clockSpan(g,period,'15:00'),/No plays/,`period ${JSON.stringify(period)}`);
 }
 assert.throws(()=>wallForClock({plays:[]},1,'15:00'),/No plays/);
 assert.throws(()=>wallForClock(g,5,'bad'),/m:ss/,'a garbage clock on an empty quarter reports the clock error');
 assert.throws(()=>clockSpan({plays:[]},1,'15:60'),/m:ss/);
 const ot=game('NYG at HOU');
 assert.equal(wallForClock(ot,5,'10:00'),11535,'overtime exists for the one game that played it');
 assert.equal(wallForClock(ot,'5','10:00'),11535,'the overtime period may arrive as a string');
});

import {mergeAnchors} from '../web/sync.js';
test('manual sync anchors displace conflicting automatic readings while preserving a monotonic curve',()=>{
 const automatic=[{wall:0,media:0},{wall:10,media:10},{wall:20,media:20},{wall:30,media:30},{wall:40,media:40}];
 const manual=[{wall:20,media:35}];assert.deepEqual(mergeAnchors(automatic,manual),[automatic[0],automatic[1],manual[0],automatic[4]]);
 assert.deepEqual(mergeAnchors(automatic,[]),automatic);assert.equal(automatic.length,5);
 const g=game('NE at CHI'),s=build(g,{anchors:mergeAnchors(g.anchors,[{wall:500,media:400}])});assert.ok(Math.abs(s.media(500)-400)<EPS);
 let prior=-Infinity;for(let t=0;t<lastSnap(g);t+=5){const m=s.media(t);assert.ok(m>=prior);prior=m;}
});
test('sync clock input rejects impossible regulation clock readings',()=>{
 for(const clock of ['15:01','16:00','99:59'])assert.throws(()=>wallForClock(game('NE at CHI'),1,clock),/15:00/);
});
