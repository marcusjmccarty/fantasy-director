import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ReplayArchive,sampleGame} from '../web/archive.js';
import {RecordingSync} from '../web/sync.js';
import {protectedReplayPlay,replayPlayBounds} from '../web/continuity.js';
import {BreakControl,nextFootball} from '../web/breaks.js';
const data=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
const archive=new ReplayArchive(data),bucs=archive.game('401873018');
const syncFor=g=>new RecordingSync(g,{types:data.types,anchors:g.anchors});
function replay(control,g,media){
 const sync=syncFor(g),at=g.start+sync.wall(media),snap=sampleGame(g,at,data.types);
 return control.update({games:[snap],at,available:new Set([g.id]),recording:()=>g,syncFor,types:data.types,currentId:g.id,media,
  protection:protectedReplayPlay(g,data.types,sync,media,[],{allAction:true})});
}
for(const score of bucs.scores)test(`Bucs replay: score ${score.i} releases the manual choice after the scoring footage`,()=>{
 const control=new BreakControl(),sync=syncFor(bucs),bounds=replayPlayBounds(bucs,data.types,sync,score.i);
 const next=nextFootball(bucs,data.types,score.i),nextMedia=sync.media(next[0]),release=Math.min(bounds.to,nextMedia);
 let first=null;
 for(let media=bounds.from+.01;media<nextMedia+1;media+=.25){
  const state=replay(control,bucs,media);
  if(state.released.has(bucs.id)&&first===null)first=media;
  if(media<release)assert.equal(state.blocked.has(bucs.id),false,'finish the scoring footage');
  if(media>=release&&media<nextMedia)assert.equal(state.blocked.has(bucs.id),true,'hold the break through timeout markers');
 }
 assert.ok(first!==null,'a short edited break must still release the choice');
 assert.ok(first>=release&&first<release+.26,`release ${first}, boundary ${release}`);
 assert.equal(replay(control,bucs,nextMedia+.1).blocked.has(bucs.id),false,'the kickoff becomes available again');
});
test('Bucs archive does not call the lead-up to a timeout live action',()=>{
 const score=bucs.scores.find(s=>s.i===14),marker=bucs.plays[15];
 const sampled=sampleGame(bucs,bucs.start+marker[0]-5,data.types);
 assert.equal(sampled.phase,'break');assert.equal(sampled.breakKind,'score');
 assert.equal(sampled.nextSnapIn,bucs.plays[16][0]-marker[0]+5);
 assert.equal(sampleGame(bucs,bucs.start+score.t+5,data.types).phase,'play');
});
test('an edited break is latched even when the next update jumps directly to the kickoff',()=>{
 const control=new BreakControl(),sync=syncFor(bucs),score=bucs.scores.find(s=>s.i===38),start=sync.media(score.t),kickoff=nextFootball(bucs,data.types,score.i);
 assert.equal(replay(control,bucs,start+.01).released.size,0);
 const state=replay(control,bucs,sync.media(kickoff[0])+.1);
 assert.equal(state.released.has(bucs.id),true);assert.equal(state.blocked.has(bucs.id),false);
 assert.equal(replay(control,bucs,sync.media(kickoff[0])+.2).released.size,0,'one release per boundary');
});
test('every archived score has a bounded break release, including compressed anchor intervals',()=>{
 let checked=0;
 for(const g of archive.games)for(const score of g.scores){
  const control=new BreakControl(),sync=syncFor(g),bounds=replayPlayBounds(g,data.types,sync,score.i),next=nextFootball(g,data.types,score.i);
  if(!bounds||!next)continue;
  const end=Math.min(bounds.to,sync.media(next[0]));
  replay(control,g,bounds.from-.25);let released=false;
  for(let media=bounds.from+.01;media<end+.5;media+=.25){
   const result=replay(control,g,media);if(result.released.has(g.id))released=true;
  }
  assert.equal(released,true,`${g.name}: ${score.text}`);checked++;
 }
 assert.ok(checked>60,'exercise the complete multi-game archive');
});
test('resetting replay break memory permits seeking back into a scoring play',()=>{
 const control=new BreakControl(),sync=syncFor(bucs),start=sync.media(bucs.scores[0].t);
 replay(control,bucs,start+.01);assert.equal(replay(control,bucs,start+35).blocked.has(bucs.id),true);
 control.reset();assert.equal(replay(control,bucs,start+1).blocked.has(bucs.id),false);
});
const live={id:'A',state:'in',phase:'live',score:[0,0],lastPlayId:'before',possession:0,down:1,period:1,clock:'10:00'};
function update(control,g){return control.update({games:[g],at:1000,available:new Set(['A'])});}
test('live score increases without timeout metadata block until fresh football resumes',()=>{
 const control=new BreakControl();assert.equal(update(control,live).blocked.size,0);
 const scored={...live,score:[6,0],lastPlayId:'td'};
 assert.equal(update(control,scored).blocked.has('A'),true);
 assert.equal(update(control,{...scored,clock:'9:59'}).blocked.has('A'),true,'a clock change is not a new play');
 const pat={...scored,score:[7,0],lastPlayId:'pat',down:0};
 assert.equal(update(control,pat).blocked.has('A'),true);
 assert.equal(update(control,{...pat,lastPlayId:'kickoff'}).blocked.has('A'),true);
 assert.equal(update(control,{...pat,lastPlayId:'first-down',down:1,possession:1}).blocked.has('A'),false);
});
test('joining on an explicit live scoring break waits through a stale normal snapshot',()=>{
 const control=new BreakControl(),scored={...live,phase:'break',breakKind:'score',score:[7,0],lastPlayId:'td'};
 assert.equal(update(control,scored).blocked.has('A'),true);
 assert.equal(update(control,{...scored,phase:'live'}).blocked.has('A'),true);
 assert.equal(update(control,{...scored,phase:'live',lastPlayId:'next',possession:1}).blocked.has('A'),false);
});
test('score corrections and the initial nonzero scoreboard do not fabricate a touchdown',()=>{
 const control=new BreakControl();assert.equal(update(control,{...live,score:[7,0]}).blocked.size,0);
 assert.equal(update(control,{...live,score:[6,0]}).blocked.size,0);
 update(control,{...live,score:[9,0]});control.reset();assert.equal(update(control,{...live,score:[9,0]}).blocked.size,0);
});
test('unavailable or finished games cannot retain old break exclusions',()=>{
 const control=new BreakControl();update(control,live);update(control,{...live,score:[7,0]});
 assert.equal(update(control,{...live,state:'post',score:[7,0]}).blocked.size,0);
 assert.equal(update(control,{...live,score:[7,0]}).blocked.size,0);
});
test('release: missing play metadata cannot reopen a known scoring break',()=>{
 const control=new BreakControl();update(control,live);
 update(control,{...live,score:[7,0],lastPlayId:'td'});
 for(const patch of [{lastPlayId:''},{lastPlayId:'',clock:'9:59'},{lastPlayId:'td',clock:'9:58'}]){
  assert.equal(update(control,{...live,score:[7,0],...patch}).blocked.has('A'),true,'wait for an identified new play');
 }
 assert.equal(update(control,{...live,score:[7,0],lastPlayId:'drive'}).blocked.size,0);
});
test('release: missing IDs on repeated scoring snapshots retain the known boundary',()=>{
 const control=new BreakControl();update(control,live);
 update(control,{...live,phase:'break',breakKind:'score',score:[7,0],lastPlayId:'td'});
 update(control,{...live,phase:'break',breakKind:'score',score:[7,0],lastPlayId:''});
 assert.equal(update(control,{...live,score:[7,0],lastPlayId:'td',clock:'9:59'}).blocked.has('A'),true);
 assert.equal(update(control,{...live,score:[7,0],lastPlayId:'drive'}).blocked.size,0);
});
test('release: an overturned touchdown restores football without needing another play ID',()=>{
 const control=new BreakControl();update(control,live);
 assert.equal(update(control,{...live,score:[6,0],lastPlayId:'review'}).blocked.has('A'),true);
 assert.equal(update(control,{...live,lastPlayId:'review',down:2}).blocked.size,0);
});
test('release: a PAT correction is not an overturned touchdown',()=>{
 const control=new BreakControl();update(control,live);
 update(control,{...live,score:[6,0],lastPlayId:'td'});
 update(control,{...live,score:[7,0],lastPlayId:'pat',down:0});
 assert.equal(update(control,{...live,score:[6,0],lastPlayId:'pat',down:1}).blocked.has('A'),true);
 assert.equal(update(control,{...live,score:[6,0],lastPlayId:'drive'}).blocked.size,0);
});
test('release: overturning a score does not reopen an explicit review timeout',()=>{
 const control=new BreakControl();update(control,live);
 update(control,{...live,score:[6,0],lastPlayId:'review'});
 assert.equal(update(control,{...live,phase:'break',breakKind:'timeout',lastPlayId:'review'}).blocked.has('A'),true);
 assert.equal(update(control,{...live,lastPlayId:'review'}).blocked.size,0);
});
test('release: incomplete team scores cannot masquerade as an overturned touchdown',()=>{
 const control=new BreakControl();update(control,live);update(control,{...live,score:[7,0],lastPlayId:'td'});
 assert.equal(update(control,{...live,scoreKnown:false,lastPlayId:'td'}).blocked.has('A'),true);
 assert.equal(update(control,{...live,score:[7,0],lastPlayId:'drive'}).blocked.size,0,'restored totals do not fabricate another score');
});
