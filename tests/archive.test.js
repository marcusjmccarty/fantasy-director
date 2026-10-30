// The recorded Week 7 slate (web/archive.js + web/week7.json): sessions,
// what a live feed would report at any moment, and the playback clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sampleGame,findPlay,timeLabel,ReplayArchive,Clock,F,PLAY_SECONDS,AFTER_WHISTLE,LONGEST_PLAY,playWindow} from '../web/archive.js';

const week7=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
const archive=new ReplayArchive(week7);
const TYPES=week7.types;
const NE_CHI=archive.game('401873010');   // Thursday night, 8:15 PM ET kickoff
const at=(game,rel)=>sampleGame(game,game.start+rel,TYPES);
const eastern=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'short',day:'numeric'});
const dayOf=seconds=>eastern.format(new Date(seconds*1000));

// Synthetic games: row(t,type,{...fields}) in the archive's column order.
const T=Object.fromEntries(TYPES.map((t,i)=>[t,i]));
const row=(t,type,{period=1,clock='10:00',offense=0,down=1,distance=10,ytg=50,away=0,home=0,text=type}={})=>[t,period,clock,T[type],offense,down,distance,ytg,away,home,text];
const fixture=(plays,scores=[],start=1792947744)=>({id:'synthetic',name:'WSH at B',teams:[{id:'1',abbreviation:'WSH',name:'Washington'},{id:'2',abbreviation:'B',name:'Bees'}],start,end:start+plays.at(-1)[F.T]+30,plays,scores});

// ---------------------------------------------------------------- ReplayArchive

test('ReplayArchive only accepts version 2 archives',()=>{
 assert.throws(()=>new ReplayArchive({version:1,types:[],games:[]}),/Unsupported archive/);
 assert.throws(()=>new ReplayArchive({types:[],games:[]}),/Unsupported archive/);
 assert.doesNotThrow(()=>new ReplayArchive({version:2,types:[],games:[]}));
});

test('week7 archive loads every game and its coverage counts match the data',()=>{
 assert.equal(week7.version,2);
 assert.equal(archive.games.length,14);
 assert.equal(archive.games.length,week7.coverage.games);
 assert.equal(archive.games.reduce((n,g)=>n+g.plays.length,0),week7.coverage.plays);
 assert.equal(archive.games.reduce((n,g)=>n+g.scores.length,0),week7.coverage.scores);
 assert.equal(archive.types,week7.types);
 assert.equal(archive.data,week7);
});

test('sessions group the slate into three Eastern-time days, in archive order',()=>{
 assert.deepEqual(archive.sessions.map(s=>s.label),['Thursday, Oct 22','Sunday, Oct 25','Monday, Oct 26']);
 assert.deepEqual(archive.sessions.map(s=>s.gameIds.length),[1,12,1]);
 // Every game lands in exactly one session, and the session's label is the game's Eastern day.
 assert.deepEqual(archive.sessions.flatMap(s=>s.gameIds),archive.games.map(g=>g.id));
 for(const s of archive.sessions)for(const id of s.gameIds)assert.equal(dayOf(archive.game(id).start),s.label);
 // Sunday runs from the London morning game to the night game whose UTC date is already Monday.
 const sunday=archive.sessions[1];
 assert.ok(sunday.gameIds.includes('401873011'));   // PIT vs NO, 9:32 AM ET
 assert.ok(sunday.gameIds.includes('401873022'));   // KC at SEA, 8:22 PM ET
 assert.equal(new Date(archive.game('401873022').start*1000).toISOString().slice(0,10),'2026-10-26');
 assert.equal(timeLabel(archive.game('401873022').start),'8:22 PM');
});

test('session bounds open a minute before the first kickoff and close at the last final, without overlapping',()=>{
 for(const s of archive.sessions){
  const games=s.gameIds.map(id=>archive.game(id));
  assert.equal(s.start,Math.min(...games.map(g=>g.start))-60);
  assert.equal(s.end,Math.max(...games.map(g=>g.end)));
  assert.ok(s.end>s.start);
 }
 for(let i=1;i<archive.sessions.length;i++)assert.ok(archive.sessions[i].start>archive.sessions[i-1].end,'sessions are chronological and disjoint');
 assert.deepEqual(archive.sessions[0],{label:'Thursday, Oct 22',start:NE_CHI.start-60,end:NE_CHI.end,gameIds:['401873010']});
});

test('session(at) finds the day that contains a moment and null between days',()=>{
 const [thu,sun,mon]=archive.sessions;
 assert.equal(archive.session(thu.start),thu);
 assert.equal(archive.session(NE_CHI.start+3000),thu);
 assert.equal(archive.session(thu.end),thu);
 assert.equal(archive.session(thu.end+1),null);
 assert.equal(archive.session(sun.start-1),null);
 assert.equal(archive.session(sun.start),sun);
 assert.equal(archive.session(archive.game('401873014').start+5000),sun);
 assert.equal(archive.session(archive.game('401873022').end),sun);
 assert.equal(archive.session(archive.game('401873009').start+100),mon);
 assert.equal(archive.session(mon.end+1),null);
 assert.equal(archive.session(0),null);
});

test('scores get stable ids and absolute timestamps without mutating the source data',()=>{
 for(const g of archive.games)for(const s of g.scores){
  assert.equal(s.id,`${g.id}:${s.i}`);
  assert.equal(s.at,g.start+s.t);
  assert.equal(g.plays[s.i][F.T],s.t,'a score sits on the play that produced it');
 }
 const ids=archive.games.flatMap(g=>g.scores.map(s=>s.id));
 assert.equal(new Set(ids).size,ids.length,'ids are unique across the slate');
 const first=NE_CHI.scores[0];
 assert.equal(first.id,'401873010:13');
 assert.equal(first.at,NE_CHI.start+669);
 assert.equal(first.text,'Cairo Santos 43 Yd Field Goal');
 assert.equal(week7.games[0].scores[0].id,undefined);
 assert.equal(week7.games[0].scores[0].at,undefined);
 assert.notEqual(archive.games[0],week7.games[0]);
});

test('game(id) and sample(at, ids) address games by id',()=>{
 assert.equal(archive.game('401873010').name,'NE at CHI');
 assert.equal(archive.game('nope'),undefined);
 const all=archive.sample(NE_CHI.start+100);
 assert.equal(all.length,14);
 assert.deepEqual(all.map(g=>g.id),archive.games.map(g=>g.id));
 const some=archive.sample(NE_CHI.start+100,['401873010','401873009']);
 assert.deepEqual(some.map(g=>g.id),['401873010','401873009']);
 assert.equal(some[0].state,'in');
 assert.equal(some[1].state,'pre','the Monday game has not kicked off on Thursday');
 assert.deepEqual(archive.sample(NE_CHI.start,[]),[]);
 for(const s of all){assert.equal(s.kind,'replay');assert.ok(['pre','in','post'].includes(s.state));}
});

// ---------------------------------------------------------------- week7.json invariants

test('every recorded game runs from a kickoff at t=0 to End of Game, in order, and ends 30s after the last row',()=>{
 for(const g of week7.games){
  const plays=g.plays;
  assert.equal(plays[0][F.T],0,g.id);
  assert.equal(TYPES[plays[0][F.TYPE]],'Kickoff',g.id);
  assert.equal(TYPES[plays.at(-1)[F.TYPE]],'End of Game',g.id);
  assert.equal(g.end,g.start+plays.at(-1)[F.T]+30,g.id);
  assert.equal(g.teams.length,2,g.id);
  for(let i=0;i<plays.length;i++){
   const r=plays[i];
   assert.equal(r.length,week7.fields.length,g.id);
   assert.ok(Number.isInteger(r[F.TYPE])&&r[F.TYPE]>=0&&r[F.TYPE]<TYPES.length,g.id);
   assert.ok([-1,0,1].includes(r[F.OFFENSE]),g.id);
   if(i)assert.ok(r[F.T]>=plays[i-1][F.T],`${g.id} play ${i} is out of order`);
  }
 }
});

test('scoring summaries point at the play that produced them, are chronological, and each adds points',()=>{
 for(const g of week7.games){
  const plays=g.plays;
  for(let k=0;k<g.scores.length;k++){
   const s=g.scores[k],r=plays[s.i];
   assert.ok(r,`${g.id} score ${k} points at a play`);
   assert.equal(s.t,r[F.T]);
   assert.deepEqual([s.away,s.home],[r[F.AWAY],r[F.HOME]],`${g.id} score ${k} tally`);
   assert.equal(s.period,r[F.PERIOD]);
   assert.ok([0,1].includes(s.team));
   assert.ok(['TD','FG','SAF','D2P'].includes(s.kind));
   assert.ok(Array.isArray(s.players));
   if(k)assert.ok(s.t>g.scores[k-1].t,`${g.id} scores are chronological`);
   if(k)assert.ok(s.away+s.home>g.scores[k-1].away+g.scores[k-1].home,`${g.id} every score adds points`);
  }
  assert.equal(plays.at(-1)[F.AWAY],g.scores.at(-1)?.away??0,`${g.id} final away score`);
  assert.equal(plays.at(-1)[F.HOME],g.scores.at(-1)?.home??0,`${g.id} final home score`);
 }
});

test('the play-by-play tally never goes backwards and agrees with the scoring summary',()=>{
 for(const g of week7.games){
  const plays=g.plays;
  for(let i=1;i<plays.length;i++)assert.ok(plays[i][F.AWAY]>=plays[i-1][F.AWAY]&&plays[i][F.HOME]>=plays[i-1][F.HOME],`${g.id} tally dropped at play ${i}`);
 }
 // Between the NYJ touchdown (t=9599, 28-25 including the two-point try) and the kickoff (t=9911) the scorebug must not read 28-23.
 const nyj=archive.game('401873015'),mid=at(nyj,9700);
 assert.deepEqual(mid.score,[28,25]);
 assert.deepEqual(mid.score,[mid.scores.at(-1).away,mid.scores.at(-1).home]);
 const sea=archive.game('401873022');
 assert.deepEqual(at(sea,3848).score,[0,10]);
 // Everywhere, the sampled tally never undercuts the last recorded score.
 for(const g of archive.games)for(const s of g.scores){const x=at(g,s.t+40);assert.ok(x.score[0]>=s.away&&x.score[1]>=s.home,`${s.id} tally undercut 40s after the score`);}
});

// ---------------------------------------------------------------- sampleGame on the recording

test('before kickoff the game is pre with a countdown to the snap and nothing scored',()=>{
 const s=at(NE_CHI,-60);
 assert.equal(s.state,'pre');assert.equal(s.phase,'pre');
 assert.deepEqual(s.score,[0,0]);assert.deepEqual(s.scores,[]);
 assert.equal(s.possession,-1);
 assert.equal(s.nextSnapIn,60);
 assert.equal(s.detail,'Kickoff 8:15 PM');
 assert.equal(s.id,'401873010');assert.equal(s.name,'NE at CHI');assert.equal(s.kind,'replay');
 assert.equal(s.start,NE_CHI.start);assert.equal(s.end,NE_CHI.end);
 assert.deepEqual(s.teams.map(t=>t.abbr),['NE','CHI']);
 assert.equal(at(NE_CHI,-1).nextSnapIn,1);
 assert.equal(at(NE_CHI,-100000).state,'pre');
 assert.equal(at(NE_CHI,0).state,'in','the kickoff row at t=0 is already in progress');
});

test('playWindow: a quick play is PLAY_SECONDS plus the whistle; yards gained stretch it, up to LONGEST_PLAY; markers have none',()=>{
 const W=PLAY_SECONDS+AFTER_WHISTLE;
 assert.equal(playWindow('Pass Incompletion','D.Maye pass incomplete deep right to K.Boutte.'),W);
 assert.equal(playWindow('Field Goal Good','C.Boswell 47 yard field goal is GOOD.'),W);
 assert.ok(Math.abs(playWindow('Rush','R.Harvey up the middle to ARZ 38 for 2 yards (D.Robinson).')-(W+2*.12))<1e-9);
 assert.ok(Math.abs(playWindow('Pass Reception','L.Jackson pass deep left to Z.Flowers to CIN 2 for 51 yards (J.Battle).')-(W+51*.12))<1e-9);
 assert.ok(Math.abs(playWindow('Rushing Touchdown','J.Taylor right end for 80 yards, TOUCHDOWN.')-(W+80*.12))<1e-9);
 assert.equal(playWindow('Pass Interception Return','D.Maye pass intercepted by T.Edmunds at CHI 1. T.Edmunds for 75 yards, lateral to J.Johnson for 40 yards, TOUCHDOWN.'),LONGEST_PLAY);
 assert.ok(playWindow('Kickoff','C.Boswell kicks 65 yards from PIT 35 to end zone, Touchback.')>playWindow('Field Goal Good','x'));
 assert.ok(playWindow('Punt','C.Wishnowsky punts 52 yards to NE 12, Center-T.Stevens. M.Hollins to NE 20 for 8 yards.')>playWindow('Rush','a for 3 yards'));
 for(const type of ['Penalty','Timeout','Official Timeout','End Period','Two-minute warning','End of Half','End of Game',''])assert.equal(playWindow(type,'for 40 yards'),0,type);
});
test('a snap is phase play for its window and shows that play, not the next situation',()=>{
 // Row 1: D.Maye incomplete on 1st & 10 from the NE 31, t=47.
 const W=playWindow('Pass Incompletion');assert.equal(W,PLAY_SECONDS+AFTER_WHISTLE);
 for(const rel of [47,50,47+W-0.1]){
  const s=at(NE_CHI,rel);
  assert.equal(s.state,'in');assert.equal(s.phase,'play');assert.equal(s.breakKind,null);
  assert.equal(s.playIndex,1);assert.equal(s.playType,'Pass Incompletion');
  assert.equal(s.possession,0);assert.equal(s.down,1);assert.equal(s.distance,10);assert.equal(s.yardsToGoal,69);
  assert.equal(s.downDistance,'1st & 10');assert.equal(s.special,false);
  assert.equal(s.period,1);assert.equal(s.clock,'14:53');assert.equal(s.detail,'Q1 14:53');
  assert.match(s.lastPlay,/^D\.Maye pass incomplete/);
  assert.ok(Math.abs(s.playAge-(rel-47))<1e-6);assert.ok(Math.abs(s.playEndsIn-(47+W-rel))<1e-6);
  assert.ok(Math.abs(s.nextSnapIn-(87-rel))<1e-6);
 }
 const after=at(NE_CHI,47+W);
 assert.equal(after.phase,'live','the whistle ends the play window');assert.equal(after.playEndsIn,0);
 assert.equal(after.playIndex,1);
 assert.equal(after.downDistance,'2nd & 10','between snaps the feed already shows the next situation');
 assert.equal(after.clock,'14:49');assert.equal(after.detail,'Q1 14:49');
});

test('between snaps the feed shows the upcoming situation and skips stoppage rows',()=>{
 // Row 7: NE sacked on 4th & 5 (t=319); row 8 is an Official Timeout (t=342); row 9 is CHI 1st & 10 (t=505).
 const s=at(NE_CHI,329);
 assert.equal(s.phase,'live');assert.equal(s.breakKind,null);
 assert.equal(s.playIndex,7);assert.equal(s.playType,'Sack');assert.equal(s.playAge,10);
 assert.equal(s.possession,1,'the ball has changed hands');
 assert.equal(s.down,1);assert.equal(s.distance,10);assert.equal(s.yardsToGoal,54);
 assert.equal(s.downDistance,'1st & 10');assert.equal(s.special,false);
 assert.equal(s.nextSnapIn,13);
 assert.deepEqual(s.score,[0,0]);
 assert.match(s.lastPlay,/^D\.Maye sacked/);
});

test('a TV timeout is a break until SETTLE seconds before the next snap, then live again',()=>{
 const brk=at(NE_CHI,400);   // Official Timeout row 8 at t=342, next snap at t=505
 assert.equal(brk.state,'in');assert.equal(brk.phase,'break');assert.equal(brk.breakKind,'timeout');
 assert.equal(brk.detail,'Timeout');assert.equal(brk.playType,'Official Timeout');
 assert.equal(brk.possession,1);assert.equal(brk.downDistance,'1st & 10');
 assert.equal(brk.nextSnapIn,105);
 const settled=at(NE_CHI,495);
 assert.equal(settled.phase,'live');assert.equal(settled.breakKind,null);
 assert.equal(settled.nextSnapIn,10);assert.equal(settled.detail,'Q1 11:30');
 // A team timeout reads the same way (row 36: Timeout #1 by CHI at 1:43, next snap 61s later).
 const team=at(NE_CHI,1922+20);
 assert.equal(team.phase,'break');assert.equal(team.breakKind,'timeout');assert.equal(team.playType,'Timeout');
});

test('the end of a quarter is a quarter break labelled for the quarter that ended',()=>{
 const brk=at(NE_CHI,2400);   // END QUARTER 1 at t=2330, Q2 snap at t=2531
 assert.equal(brk.phase,'break');assert.equal(brk.breakKind,'quarter');
 assert.equal(brk.detail,'End of Q1');
 assert.equal(brk.period,2);assert.equal(brk.clock,'15:00');
 assert.deepEqual(brk.score,[0,10]);
 assert.equal(brk.playType,'End Period');
 const settled=at(NE_CHI,2520);
 assert.equal(settled.phase,'live');assert.equal(settled.detail,'Q2 15:00');
 assert.equal(settled.downDistance,'1st & 10');assert.equal(settled.possession,0);
 assert.equal(settled.nextSnapIn,11);
});

test('halftime is a break from the End of Half row until the second-half kickoff',()=>{
 for(const rel of [5400,5800,6213]){
  const s=at(NE_CHI,rel);
  assert.equal(s.phase,'break',`rel ${rel}`);assert.equal(s.breakKind,'halftime');
  assert.equal(s.detail,'Halftime');assert.equal(s.period,3);
  assert.deepEqual(s.score,[14,20]);
  assert.equal(s.scores.length,6);
  assert.equal(s.special,true,'the upcoming snap is the kickoff');
 }
 const kick=at(NE_CHI,6214);
 assert.equal(kick.phase,'play');assert.equal(kick.playType,'Kickoff');assert.equal(kick.special,true);
 assert.equal(kick.detail,'Q3 15:00');
});

test('the two-minute warning is its own break kind',()=>{
 const s=at(NE_CHI,4760);   // Two-Minute Warning row 77 at t=4709, next snap at t=4886
 assert.equal(s.phase,'break');assert.equal(s.breakKind,'two-minute');
 assert.equal(s.detail,'Two-minute warning');
 assert.deepEqual(s.score,[7,13]);assert.equal(s.period,2);assert.equal(s.clock,'2:00');
 assert.equal(s.possession,1);assert.equal(s.downDistance,'1st & 10');
});

test('a touchdown is live for the play, then a score break with the kickoff queued as special',()=>{
 // Row 50: D.Maye 7-yd TD rush at t=2766, followed directly by the kickoff at t=3100.
 const before=at(NE_CHI,2765);
 assert.equal(before.phase,'live');assert.deepEqual(before.score,[0,10]);
 assert.equal(before.scores.length,2);assert.ok(!before.scores.some(x=>x.id==='401873010:50'));
 assert.equal(before.downDistance,'2nd & Goal');
 const play=at(NE_CHI,2769);
 assert.equal(play.phase,'play');assert.equal(play.playIndex,50);assert.equal(play.playType,'Rushing Touchdown');
 assert.deepEqual(play.score,[7,10],'the tally updates with the play');
 assert.equal(play.scores.length,3);
 assert.equal(play.scores.at(-1).id,'401873010:50');
 assert.equal(play.scores.at(-1).at,NE_CHI.start+2766);
 assert.equal(play.special,false);assert.equal(play.downDistance,'2nd & Goal');
 const celebrate=at(NE_CHI,2796);
 assert.equal(celebrate.phase,'break');assert.equal(celebrate.breakKind,'score');
 assert.equal(celebrate.detail,'After the score');
 assert.equal(celebrate.special,true);assert.equal(celebrate.down,0);assert.equal(celebrate.downDistance,'');
 assert.deepEqual(celebrate.score,[7,10]);
 const settled=at(NE_CHI,3095);
 assert.equal(settled.phase,'live');assert.equal(settled.special,true);assert.equal(settled.nextSnapIn,5);
 const kick=at(NE_CHI,3102);
 assert.equal(kick.phase,'play');assert.equal(kick.playType,'Kickoff');assert.equal(kick.special,true);
});

test('kickoffs and punts are special and carry no down & distance',()=>{
 const kick=at(NE_CHI,2);
 assert.equal(kick.phase,'play');assert.equal(kick.playType,'Kickoff');
 assert.equal(kick.special,true);assert.equal(kick.down,0);assert.equal(kick.downDistance,'');
 assert.equal(kick.possession,1,'the kicking team is listed as the offense');
 const punt=at(NE_CHI,1007);   // Row 19: Wishnowsky punts on 4th & 4 at t=1005
 assert.equal(punt.phase,'play');assert.equal(punt.playType,'Punt');
 assert.equal(punt.special,true);assert.equal(punt.down,4);assert.equal(punt.distance,4);assert.equal(punt.downDistance,'');
 const beforePunt=at(NE_CHI,968+LONGEST_PLAY+1);   // between the 3rd-down incompletion and the punt
 assert.equal(beforePunt.phase,'live');assert.equal(beforePunt.special,true,'the upcoming punt is already special');
});

test('the game is final from the archive end timestamp onward',()=>{
 for(const rel of [11211,NE_CHI.end-NE_CHI.start,NE_CHI.end-NE_CHI.start+86400]){
  const s=at(NE_CHI,rel);
  assert.equal(s.state,'post',`rel ${rel}`);assert.equal(s.phase,'final');
  assert.deepEqual(s.score,[24,30]);assert.equal(s.possession,-1);
  assert.equal(s.detail,'Final');assert.equal(s.period,4);
  assert.equal(s.scores.length,10);assert.equal(s.lastPlay,'END GAME');
  assert.equal(s.breakKind,undefined);
 }
 assert.equal(at(NE_CHI,11190-30).state,'in','the closing kneel-downs are still in progress');
});

test('score arrays accumulate: each scoring play adds exactly one entry at its own timestamp',()=>{
 for(const g of archive.games)for(let k=0;k<g.scores.length;k++){
  const s=g.scores[k];
  const before=at(g,s.t-0.5),after=at(g,s.t);
  assert.equal(before.scores.length,k,`${s.id} is not yet counted`);
  assert.equal(after.scores.length,k+1,`${s.id} counts from its play`);
  assert.equal(after.scores.at(-1).id,s.id);
  assert.deepEqual(after.scores.map(x=>x.id),g.scores.slice(0,k+1).map(x=>x.id),'earlier scores stay in order');
  assert.deepEqual(after.score,[s.away,s.home],`${s.id} tally`);
  assert.ok(before.score[0]+before.score[1]<s.away+s.home,`${s.id} was not already on the board`);
 }
});

test('downDistance reads "& Goal" when the distance reaches the end zone',()=>{
 assert.equal(at(NE_CHI,1985).downDistance,'1st & Goal');   // D.Swift 4-yd TD from the 4
 assert.equal(at(NE_CHI,2765).downDistance,'2nd & Goal');   // 2nd & 7 from the 7, upcoming
 assert.equal(at(NE_CHI,50).downDistance,'1st & 10');
 assert.equal(at(NE_CHI,329).downDistance,'1st & 10');
});

test('timeLabel and findPlay',()=>{
 assert.equal(timeLabel(NE_CHI.start),'8:15 PM');
 assert.equal(timeLabel(archive.game('401873011').start),'9:32 AM');
 const plays=[[0],[47],[87],[300]];
 assert.equal(findPlay([],5),-1);
 assert.equal(findPlay(plays,-1),-1);
 assert.equal(findPlay(plays,0),0);
 assert.equal(findPlay(plays,46.9),0);
 assert.equal(findPlay(plays,47),1);
 assert.equal(findPlay(plays,100),2);
 assert.equal(findPlay(plays,300),3);
 assert.equal(findPlay(plays,1e9),3);
});

// ---------------------------------------------------------------- sampleGame on synthetic games

test('a long stoppage after an ordinary play is a generic break; a long gap before a kickoff reads as a score break',()=>{
 const game=fixture([
  row(0,'Kickoff',{offense:1,down:0,distance:0,ytg:65}),
  row(40,'Rush'),
  row(80,'Penalty',{down:1,distance:15,ytg:55,text:'PENALTY on WSH, holding'}),
  row(250,'Rush',{down:1,distance:15,ytg:55}),
  row(300,'Rush',{down:2,distance:11,ytg:51}),
  row(600,'Kickoff',{offense:1,down:0,distance:0,ytg:65}),
  row(640,'Rush',{offense:1}),
  row(700,'End of Game',{period:4,clock:'0:00',down:0,distance:0,ytg:null,text:'END GAME'}),
 ]);
 const penalty=at(game,82);
 assert.equal(penalty.phase,'live','a penalty row is never a play in progress');
 assert.equal(penalty.playIndex,2);assert.equal(penalty.playType,'Penalty');
 const brk=at(game,110);   // 30s into the penalty, 140s before the next snap
 assert.equal(brk.phase,'break');assert.equal(brk.breakKind,'stoppage');assert.equal(brk.detail,'Break');
 assert.equal(brk.downDistance,'1st & 15');assert.equal(brk.special,false);
 assert.equal(at(game,240).phase,'live','settled again before the snap');
 assert.equal(at(game,310).phase,'live','a short while after an ordinary play is just between snaps');
 const gap=at(game,330);   // 30s after a plain rush, 270s before a kickoff: a score the feed did not record
 assert.equal(gap.phase,'break');assert.equal(gap.breakKind,'score');assert.equal(gap.detail,'After the score');
 assert.equal(gap.special,true,'the upcoming kickoff is special');
 assert.equal(at(game,40+LONGEST_PLAY+10).phase,'live','a normal 40s gap between snaps is not a break');
});

test('conversion tries (down -1) are special whether on the field or upcoming',()=>{
 const game=fixture([
  row(0,'Kickoff',{offense:1,down:0,distance:0,ytg:65}),
  row(40,'Rushing Touchdown',{down:1,distance:3,ytg:3,home:0,away:6,text:'J.Doe up the middle for 3 yards, TOUCHDOWN.'}),
  row(100,'Rush',{down:-1,distance:2,ytg:2,away:8,text:'J.Doe rushes for the two-point conversion, GOOD.'}),
  row(160,'Kickoff',{down:0,distance:0,ytg:65,away:8}),
  row(200,'Rush',{offense:1,away:8}),
  row(300,'End of Game',{period:4,clock:'0:00',down:0,distance:0,ytg:null,away:8,text:'END GAME'}),
 ],[{i:1,t:40,team:0,kind:'TD',defensive:false,text:'J Doe 3 Yd Rush',players:[{name:'J Doe',role:'scorer'}],away:6,home:0,period:1,clock:'10:00'}]);
 const td=at(game,43);
 assert.equal(td.phase,'play');assert.equal(td.special,false);assert.equal(td.downDistance,'1st & Goal');
 assert.deepEqual(td.score,[6,0]);
 const upcomingTry=at(game,40+playWindow('Rushing Touchdown','J.Doe up the middle for 3 yards, TOUCHDOWN.')+2);
 assert.equal(upcomingTry.phase,'live');assert.equal(upcomingTry.down,-1);
 assert.equal(upcomingTry.special,true,'an upcoming conversion try is not a drive');
 const tryPlay=at(game,103);
 assert.equal(tryPlay.phase,'play');assert.equal(tryPlay.playIndex,2);
 assert.equal(tryPlay.special,true,'the conversion try on the field is not a drive');
 assert.deepEqual(tryPlay.score,[8,0]);
 const afterTry=at(game,130);
 assert.equal(afterTry.special,true,'the kickoff after the try is special');
 assert.equal(afterTry.down,0);
});

test('overtime periods read as OT and team abbreviations are normalised',()=>{
 const game=fixture([
  row(0,'Kickoff',{period:5,clock:'10:00',offense:1,down:0,distance:0,ytg:65}),
  row(40,'Rush',{period:5,clock:'9:55',down:1,distance:10,ytg:70}),
  row(80,'Rush',{period:5,clock:'9:20',down:2,distance:6,ytg:66}),
  row(200,'End of Game',{period:5,clock:'0:00',down:0,distance:0,ytg:null,text:'END GAME'}),
 ]);
 assert.equal(at(game,42).detail,'QOT 9:55');
 assert.equal(at(game,42).period,5);
 assert.equal(at(game,60).detail,'QOT 9:20');
 const s=at(game,-5);
 assert.deepEqual(s.teams.map(t=>t.abbr),['WAS','B']);
 assert.deepEqual(s.teams.map(t=>t.abbreviation),['WSH','B'],'the raw abbreviation is kept beside the alias');
});

test('stoppage rows never register as a play in progress',()=>{
 const game=fixture([
  row(0,'Kickoff',{offense:1,down:0,distance:0,ytg:65}),
  row(40,'Rush'),
  row(70,'Timeout',{down:2,distance:6,ytg:46,text:'Timeout #1 by WSH'}),
  row(140,'Rush',{down:2,distance:6,ytg:46}),
  row(180,'End Period',{clock:'0:00',down:3,distance:2,ytg:42,text:'END QUARTER 1'}),
  row(400,'Rush',{period:2,clock:'15:00',down:3,distance:2,ytg:42}),
  row(450,'End of Game',{period:4,clock:'0:00',down:0,distance:0,ytg:null,text:'END GAME'}),
 ]);
 for(const [rel,type] of [[71,'Timeout'],[181,'End Period']]){
  const s=at(game,rel);
  assert.notEqual(s.phase,'play',`${type} at age 1`);
  assert.equal(s.playType,type);
 }
 assert.equal(at(game,100).breakKind,'timeout');
 assert.equal(at(game,130).phase,'live','settled before the snap after the timeout');
 const quarter=at(game,250);
 assert.equal(quarter.breakKind,'quarter');assert.equal(quarter.detail,'End of Q1');
 assert.equal(quarter.period,2);assert.equal(quarter.clock,'15:00');assert.equal(quarter.downDistance,'3rd & 2');
 assert.equal(at(game,142).phase,'play','the snap after a timeout is a play again');
});

test('a play that shares its timestamp with the following stoppage marker still gets its play window',()=>{
 // Real data: PIT vs NO, play 90 is C.Boswell's 47-yd FG at t=5405 and play 91 is END QUARTER 2, also at t=5405.
 const game=archive.game('401873011');
 assert.equal(TYPES[game.plays[90][F.TYPE]],'Field Goal Good');
 assert.equal(TYPES[game.plays[91][F.TYPE]],'End of Half');
 assert.equal(game.plays[90][F.T],game.plays[91][F.T]);
 const s=at(game,5405+3);
 assert.equal(s.phase,'play');
 assert.equal(s.playIndex,90);
 assert.equal(s.playType,'Field Goal Good');
 assert.equal(at(game,5405+LONGEST_PLAY+1).breakKind,'halftime');
 // Synthetic: a rush and the quarter-end marker at the same t.
 const synthetic=fixture([
  row(0,'Kickoff',{offense:1,down:0,distance:0,ytg:65}),
  row(100,'Rush',{clock:'0:04'}),
  row(100,'End Period',{clock:'0:00',down:2,distance:7,ytg:47,text:'END QUARTER 1'}),
  row(300,'Rush',{period:2,clock:'15:00',down:2,distance:7,ytg:47}),
  row(400,'End of Game',{period:4,clock:'0:00',down:0,distance:0,ytg:null,text:'END GAME'}),
 ]);
 assert.equal(at(synthetic,102).phase,'play');
 assert.equal(at(synthetic,102).playIndex,1);
 assert.equal(at(synthetic,150).breakKind,'quarter');
});

// ---------------------------------------------------------------- Clock

test('a clock that is not running holds its position while ticks pass',()=>{
 const c=new Clock(100);
 assert.equal(c.at,100);assert.equal(c.running,false);assert.equal(c.rate,1);assert.equal(c.end,Infinity);assert.equal(c.last,null);
 assert.equal(c.tick(1000),100);
 assert.equal(c.tick(5000),100);
 assert.equal(c.last,5000);
 assert.equal(new Clock().at,0);
});

test('set(true) starts advancing from the next tick at the playback rate',()=>{
 const c=new Clock(0);
 c.set(true,1000);
 assert.equal(c.running,true);assert.equal(c.at,0,'starting does not count time before the start');
 assert.equal(c.tick(2500),1.5);
 c.rate=2;
 assert.equal(c.tick(3500),3.5);
 c.rate=0.5;
 assert.equal(c.tick(5500),4.5);
 assert.equal(c.tick(5500),4.5,'a repeated tick adds nothing');
});

test('pausing keeps the time elapsed up to the pause and resuming skips the paused gap',()=>{
 const c=new Clock(10);
 c.set(true,0);
 assert.equal(c.tick(1000),11);
 c.set(false,1500);
 assert.equal(c.at,11.5,'the pause itself accounts for the elapsed half second');
 assert.equal(c.running,false);
 assert.equal(c.tick(9000),11.5);
 c.set(true,20000);
 assert.equal(c.at,11.5);
 assert.equal(c.tick(21000),12.5);
});

test('seek jumps without counting the wall time before the seek and clamps to the end',()=>{
 const c=new Clock(0);
 c.set(true,0);
 c.tick(1000);
 c.seek(500,1000);
 assert.equal(c.at,500);assert.equal(c.running,true,'seeking does not pause');
 assert.equal(c.tick(1000),500);
 assert.equal(c.tick(2000),501);
 const p=new Clock(0);
 p.seek(42,7000);
 assert.equal(p.at,42);assert.equal(p.running,false,'seeking does not start a paused clock');
 p.set(true,10000);
 assert.equal(p.at,42,'the gap between the seek and the start is not counted');
 assert.equal(p.tick(11000),43);
 c.end=600;
 c.seek(10000,3000);
 assert.equal(c.at,600);
 assert.equal(c.tick(4000),600);
 assert.equal(c.running,false,'reaching the end stops playback');
});

test('reaching the end stops the clock and pins it there',()=>{
 const c=new Clock(95);
 c.end=100;
 c.set(true,0);
 assert.equal(c.tick(3000),98);assert.equal(c.running,true);
 assert.equal(c.tick(6000),100,'the clock never overshoots the end');
 assert.equal(c.running,false);
 assert.equal(c.tick(9000),100);
 c.set(true,10000);
 assert.equal(c.tick(11000),100,'restarting at the end does not run past it');
 assert.equal(c.running,false);
 c.seek(50,12000);
 c.set(true,12000);
 assert.equal(c.tick(13000),51,'seeking back from the end makes the clock usable again');
 assert.equal(c.running,true);
});

test('wall time running backwards never rewinds the clock',()=>{
 const c=new Clock(0);
 c.set(true,5000);
 assert.equal(c.tick(6000),1);
 assert.equal(c.tick(4000),1);
 assert.equal(c.tick(5000),2,'the backwards tick becomes the new reference');
 c.set(false,3000);
 assert.equal(c.at,2);
});
