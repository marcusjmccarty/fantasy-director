import test from 'node:test';
import assert from 'node:assert/strict';
import {liveGames,liveScores,yardsFromText} from '../web/live.js';
import {parseScoringPlay,rosterCredit,worthReplaying,describeScore,alias} from '../web/scoring.js';
import {involvement,rate,rank,KICK_RANGE} from '../web/director.js';

// ---------- fixtures (hand-built, ESPN-shaped) ----------
const team=(id,abbreviation,displayName)=>({id:String(id),abbreviation,displayName});
const IND=team(11,'IND','Indianapolis Colts'),MIN=team(16,'MIN','Minnesota Vikings');
const WSH=team(28,'WSH','Washington Commanders'),DAL=team(6,'DAL','Dallas Cowboys');
const competitor=(t,homeAway,score)=>({id:t.id,homeAway,team:t,score:String(score)});
// ESPN lists the home team first; the app wants away first.
function event({id='401',away=IND,home=MIN,score=[0,0],state='in',name='STATUS_IN_PROGRESS',completed=false,period=1,clock='15:00',shortDetail='',situation,homeFirst=true,date='2025-10-19T17:00Z',shortName,status=true,eventStatus}={}){
 const competitors=[competitor(home,'home',score[1]),competitor(away,'away',score[0])];
 if(!homeFirst)competitors.reverse();
 const statusObj={period,displayClock:clock,type:{name,state,completed,shortDetail}};
 const e={id,date,name:`${away.displayName} at ${home.displayName}`,competitions:[{competitors,...(status?{status:statusObj}:{}),...(situation?{situation}:{})}]};
 if(shortName!==undefined)e.shortName=shortName;else e.shortName=`${away.abbreviation} @ ${home.abbreviation}`;
 if(eventStatus)e.status=eventStatus;
 return e;
}
const scoreboard=(...events)=>({events});
const situation=({possession,down=1,distance=10,text,lastPlay,yardsToEndzone,shortDownDistanceText}={})=>{
 const s={};
 if(possession!==undefined)s.possession=possession;
 if(down!==undefined)s.down=down;
 if(distance!==undefined)s.distance=distance;
 if(text!==undefined)s.possessionText=text;
 if(lastPlay!==undefined)s.lastPlay=lastPlay;
 if(yardsToEndzone!==undefined)s.yardsToEndzone=yardsToEndzone;
 if(shortDownDistanceText!==undefined)s.shortDownDistanceText=shortDownDistanceText;
 return s;
};
const lastPlay=(type,extra={})=>({type:{text:type},text:`${type} play text`,...extra});
const one=(raw,now=1000)=>liveGames(raw,now)[0];
// A single in-progress game with the given situation.
const drive=(sit,extra={})=>one(scoreboard(event({situation:situation(sit),...extra})));

// Summary fixtures for liveScores.
const play=(id,wallclock,offenseId,extra={})=>({id:String(id),...(wallclock?{wallclock}:{}),...(offenseId!==undefined?{start:{team:{id:String(offenseId)}}}:{}),...extra});
const summary=({previous=[],current,scoringPlays=[]}={})=>({drives:{previous:previous.map(plays=>({plays})),...(current?{current:{plays:current}}:{})},scoringPlays});
const scoringPlay=(id,teamId,text,{type='Passing Touchdown',scoringType='touchdown',away=0,home=0,period=1,clock='10:12'}={})=>
 ({id:String(id),team:{id:String(teamId)},text,type:{text:type},scoringType:{name:scoringType},awayScore:away,homeScore:home,period:{number:period},clock:{displayValue:clock}});
const WC1='2025-10-19T17:08:31Z',WC2='2025-10-19T17:20:00Z',WC3='2025-10-19T17:40:00Z';

const roster=[
 {name:'Jonathan Taylor',team:'IND',position:'RB'},
 {name:'Spencer Shrader',team:'IND',position:'K'},
 {name:'Will Reichard',team:'MIN',position:'K'},
 {name:'Vikings D/ST',team:'MIN',position:'D/ST'},
 {name:'Colts D/ST',team:'IND',position:'D/ST'},
];
const names=list=>list.map(x=>`${x.player.name}:${x.role}`);

// ---------- liveGames: shape ----------
test('liveGames() rejects anything that is not an ESPN scoreboard and returns [] for an empty slate',()=>{
 for(const bad of [undefined,null,{},{events:{}},{events:'x'},{events:null},[]])assert.throws(()=>liveGames(bad),/Unexpected NFL scoreboard format/);
 assert.deepEqual(liveGames({events:[]}),[]);
});

test('liveGames() orders teams away then home regardless of ESPN order and carries the score with them',()=>{
 const sit=situation({possession:'11',text:'MIN 35',down:2,distance:7,shortDownDistanceText:'2nd & 7'});
 for(const homeFirst of [true,false]){
  const g=one(scoreboard(event({score:[10,7],situation:sit,homeFirst,period:2,clock:'10:12',shortDetail:'10:12 - 2nd'})),1234.5);
  assert.deepEqual(g.teams.map(t=>t.abbreviation),['IND','MIN']);
  assert.deepEqual(g.teams[0],{id:'11',abbreviation:'IND',abbr:'IND',name:'Indianapolis Colts',score:10});
  assert.deepEqual(g.teams[1],{id:'16',abbreviation:'MIN',abbr:'MIN',name:'Minnesota Vikings',score:7});
  assert.deepEqual(g.score,[10,7]);
  assert.equal(g.id,'401');assert.equal(g.name,'IND @ MIN');assert.equal(g.kind,'live');
  assert.equal(g.state,'in');assert.equal(g.phase,'live');assert.equal(g.breakKind,null);
  assert.equal(g.possession,0);assert.equal(g.down,2);assert.equal(g.distance,7);assert.equal(g.yardsToGoal,35);
  assert.equal(g.special,false);assert.equal(g.period,2);assert.equal(g.clock,'10:12');assert.equal(g.detail,'10:12 - 2nd');
  assert.equal(g.downDistance,'2nd & 7');assert.equal(g.nextSnapIn,null);assert.deepEqual(g.scores,[]);
  assert.equal(g.date,'2025-10-19T17:00Z');assert.equal(g.fetchedAt,1234.5);
 }
});

test('liveGames() stamps fetchedAt with the injected clock, falls back on names, and drops events without two teams',()=>{
 const solo={id:'9',competitions:[{competitors:[competitor(IND,'away',0)]}]};
 const trio={id:'10',competitions:[{competitors:[competitor(IND,'away',0),competitor(MIN,'home',0),competitor(DAL,'home',0)]}]};
 const games=liveGames(scoreboard(solo,event({id:'1'}),trio,event({id:'2',shortName:''}),{id:'3',competitions:[{competitors:[competitor(IND,'away',0),competitor(MIN,'home',0)]}]}),42);
 assert.deepEqual(games.map(g=>g.id),['1','2','3']);
 assert.deepEqual(games.map(g=>g.fetchedAt),[42,42,42]);
 assert.equal(games[1].name,'Indianapolis Colts at Minnesota Vikings');  // shortName empty -> name
 assert.equal(games[2].name,'NFL game');                                  // neither
 assert.equal(games[2].state,'pre');assert.equal(games[2].phase,'pre');   // no status at all
 assert.equal(games[2].teams[0].id,'11');
});

test('liveGames() aliases WSH/JAX/LA for matching but keeps ESPN abbreviations for display, and tolerates missing team fields',()=>{
 const g=one(scoreboard(event({away:WSH,home:DAL,situation:situation({possession:'28',text:'WSH 30'})})));
 assert.deepEqual(g.teams.map(t=>[t.abbreviation,t.abbr]),[['WSH','WAS'],['DAL','DAL']]);
 assert.equal(g.yardsToGoal,70);  // possession text uses ESPN's WSH; the aliased side still resolves as "own side"
 const JAX=team(30,'JAX','Jacksonville Jaguars'),LA=team(14,'LA','Los Angeles Rams');
 const h=one(scoreboard(event({away:JAX,home:LA})));
 assert.deepEqual(h.teams.map(t=>t.abbr),['JAC','LAR']);
 assert.equal(alias('WSH'),'WAS');assert.equal(alias('KC'),'KC');
 const bare={id:'7',competitions:[{competitors:[{id:'11',homeAway:'away',team:{}},{id:'16',homeAway:'home'}]}]};
 const b=one(scoreboard(bare));
 assert.deepEqual(b.teams.map(t=>[t.id,t.abbreviation,t.abbr,t.name,t.score]),[['11','?','?','',0],['16','?','?','',0]]);
});

test('liveGames() reads status from the competition first, then the event, and maps pre/in/post',()=>{
 const pre=one(scoreboard(event({state:'pre',name:'STATUS_SCHEDULED'})));
 assert.equal(pre.state,'pre');assert.equal(pre.phase,'pre');assert.equal(pre.breakKind,null);assert.equal(pre.possession,-1);
 const fin=one(scoreboard(event({state:'post',name:'STATUS_FINAL',completed:true,situation:situation({possession:'11',text:'MIN 20',lastPlay:lastPlay('End of Game')})})));
 assert.equal(fin.state,'post');assert.equal(fin.phase,'final');assert.equal(fin.breakKind,null);
 // ESPN flips `completed` before (and independently of) `state`; completed always wins.
 const done=one(scoreboard(event({state:'in',name:'STATUS_IN_PROGRESS',completed:true,situation:situation({possession:'11',text:'MIN 20'})})));
 assert.equal(done.state,'post');assert.equal(done.phase,'final');
 const postNoFlag=one(scoreboard(event({state:'post',name:'STATUS_FINAL',completed:false})));
 assert.equal(postNoFlag.state,'post');assert.equal(postNoFlag.phase,'final');
 // Status only on the event (older payloads).
 const fromEvent=one(scoreboard(event({status:false,eventStatus:{period:3,displayClock:'5:00',type:{name:'STATUS_HALFTIME',state:'in',completed:false,shortDetail:'Halftime'}}})));
 assert.equal(fromEvent.state,'in');assert.equal(fromEvent.phase,'break');assert.equal(fromEvent.breakKind,'halftime');
 assert.equal(fromEvent.period,3);assert.equal(fromEvent.clock,'5:00');assert.equal(fromEvent.detail,'Halftime');
 // Competition status wins over the event status when both exist.
 const both=one(scoreboard(event({state:'in',eventStatus:{type:{name:'STATUS_FINAL',state:'post',completed:true}}})));
 assert.equal(both.state,'in');
});

// ---------- liveGames: possession ----------
test('liveGames() resolves possession as a string id, a numeric id or an object, and -1 when unknown or absent',()=>{
 assert.equal(drive({possession:'11'}).possession,0);
 assert.equal(drive({possession:'16'}).possession,1);
 assert.equal(drive({possession:16}).possession,1);
 assert.equal(drive({possession:{id:'11'}}).possession,0);
 assert.equal(drive({possession:{id:16}}).possession,1);
 assert.equal(drive({possession:'99'}).possession,-1);
 assert.equal(drive({possession:''}).possession,-1);
 assert.equal(drive({}).possession,-1);
 assert.equal(one(scoreboard(event())).possession,-1);  // no situation block at all
});

// ---------- liveGames: yardsToGoal ----------
test('liveGames() prefers a valid yardsToEndzone and falls back to possessionText when it is missing or out of range',()=>{
 assert.equal(drive({possession:'11',yardsToEndzone:35,text:'IND 20'}).yardsToGoal,35);
 assert.equal(drive({possession:'11',yardsToEndzone:'35',text:'IND 20'}).yardsToGoal,35);
 assert.equal(drive({possession:'11',yardsToEndzone:100}).yardsToGoal,100);
 assert.equal(drive({possession:'11',yardsToEndzone:1}).yardsToGoal,1);
 for(const bad of [0,-5,101,NaN,'','x',null,undefined])assert.equal(drive({possession:'11',yardsToEndzone:bad,text:'IND 20'}).yardsToGoal,80,`yardsToEndzone=${bad}`);
 assert.equal(drive({possession:'11'}).yardsToGoal,null);
});

test('liveGames() measures possessionText from the offense: own side is 100-n, opponent side is n',()=>{
 // Colts have the ball.
 assert.equal(drive({possession:'11',text:'IND 16'}).yardsToGoal,84);
 assert.equal(drive({possession:'11',text:'MIN 16'}).yardsToGoal,16);
 assert.equal(drive({possession:'11',text:'MIN 1'}).yardsToGoal,1);
 assert.equal(drive({possession:'11',text:'IND 1'}).yardsToGoal,99);
 // Vikings have the ball: the same text means the opposite distance.
 assert.equal(drive({possession:'16',text:'IND 16'}).yardsToGoal,16);
 assert.equal(drive({possession:'16',text:'MIN 16'}).yardsToGoal,84);
 // Red zone is anything at or inside the opponent 20.
 assert.equal(drive({possession:'16',text:'IND 20'}).yardsToGoal,20);
});

test('liveGames() treats a team-prefixed midfield reading ("IND 50"/"MIN 50") as 50 yards for either offense',()=>{
 assert.equal(drive({possession:'11',text:'IND 50'}).yardsToGoal,50);
 assert.equal(drive({possession:'11',text:'MIN 50'}).yardsToGoal,50);
 assert.equal(drive({possession:'16',text:'MIN 50'}).yardsToGoal,50);
});

test('liveGames() reads ESPN\'s bare midfield possessionText "50" as 50 yards to goal',()=>{
 assert.equal(drive({possession:'11',text:'50'}).yardsToGoal,50);
 assert.equal(drive({possession:'16',text:'50'}).yardsToGoal,50);
 assert.equal(yardsFromText('50',[{abbr:'IND'},{abbr:'MIN'}],0),50);
});

test('liveGames() leaves yardsToGoal null when nobody has the ball or the text is unusable',()=>{
 assert.equal(drive({text:'MIN 16'}).yardsToGoal,null);                  // no possession: cannot orient
 assert.equal(drive({possession:'99',text:'MIN 16'}).yardsToGoal,null);
 assert.equal(drive({possession:'11',text:'KC 16'}).yardsToGoal,null);   // not one of the two teams
 assert.equal(drive({possession:'11',text:''}).yardsToGoal,null);
 assert.equal(drive({possession:'11',text:'MIN'}).yardsToGoal,null);
 assert.equal(drive({possession:'11',text:'1st & 10 at MIN 16'}).yardsToGoal,null);
});

test('yardsFromText() handles 2-4 letter abbreviations, padding and aliases, and rejects malformed readings',()=>{
 const teams=[{abbr:'KC'},{abbr:'WAS'}];
 assert.equal(yardsFromText('KC 30',teams,0),70);
 assert.equal(yardsFromText('KC 30',teams,1),30);
 assert.equal(yardsFromText('  WAS 5 ',teams,0),5);
 assert.equal(yardsFromText('WSH 5',teams,1),95);           // ESPN abbreviation aliased to the roster's
 assert.equal(yardsFromText('KC 30',teams,-1),null);
 assert.equal(yardsFromText('kc 30',teams,0),null);
 assert.equal(yardsFromText('KC 130',teams,0),null);
 assert.equal(yardsFromText('KC-30',teams,0),null);
 assert.equal(yardsFromText(undefined,teams,0),null);
 assert.equal(yardsFromText('NYG 30',teams,0),null);
 assert.equal(yardsFromText('JAX 40',[{abbr:'JAC'},{abbr:'TEN'}],0),60);
});

// ---------- liveGames: phase / breakKind ----------
test('liveGames() reports a normal in-progress drive as phase "live" with no break',()=>{
 const g=drive({possession:'11',text:'MIN 35',lastPlay:lastPlay('Pass Reception')});
 assert.equal(g.phase,'live');assert.equal(g.breakKind,null);
 assert.equal(g.lastPlay,'Pass Reception play text');assert.equal(g.playType,'Pass Reception');
 const r=drive({possession:'11',text:'MIN 35',lastPlay:lastPlay('Rush')});
 assert.equal(r.phase,'live');assert.equal(r.breakKind,null);
 const noLast=drive({possession:'11',text:'MIN 35'});
 assert.equal(noLast.phase,'live');assert.equal(noLast.lastPlay,'');assert.equal(noLast.playType,'');
});

test('liveGames() flags halftime and end-of-period from the status name, ahead of whatever the last play was',()=>{
 const half=drive({possession:'11',text:'MIN 35',lastPlay:lastPlay('Passing Touchdown',{scoringPlay:true})},{name:'STATUS_HALFTIME'});
 assert.equal(half.phase,'break');assert.equal(half.breakKind,'halftime');
 const q=drive({possession:'16',text:'MIN 35',lastPlay:lastPlay('Timeout')},{name:'STATUS_END_PERIOD'});
 assert.equal(q.phase,'break');assert.equal(q.breakKind,'quarter');
 // Possession and the situation are still reported through the break.
 assert.equal(half.possession,0);assert.equal(half.yardsToGoal,35);
});

test('liveGames() flags timeouts, period ends and the two-minute warning from the last play type',()=>{
 for(const type of ['Timeout','Official Timeout','End Period','End of Half','End of Quarter','End of Regulation','Two-minute warning','Two-Minute Warning','TIMEOUT']){
  const g=drive({possession:'11',text:'MIN 35',lastPlay:lastPlay(type)});
  assert.equal(g.phase,'break',type);assert.equal(g.breakKind,'timeout',type);
 }
 // A stoppage beats "no possession".
 const g=drive({lastPlay:lastPlay('Timeout')});
 assert.equal(g.breakKind,'timeout');
});

test('liveGames() flags the pause after a score from scoringPlay or a scoring play type, but not a missed kick',()=>{
 const flagged=drive({possession:'11',text:'MIN 35',lastPlay:lastPlay('Pass Reception',{scoringPlay:true})});
 assert.equal(flagged.phase,'break');assert.equal(flagged.breakKind,'score');
 for(const type of ['Passing Touchdown','Rushing Touchdown','Interception Return Touchdown','Field Goal Good','FIELD GOAL GOOD']){
  const g=drive({possession:'16',text:'IND 35',lastPlay:lastPlay(type)});
  assert.equal(g.phase,'break',type);assert.equal(g.breakKind,'score',type);
 }
 const missed=drive({possession:'16',text:'IND 35',lastPlay:lastPlay('Field Goal Missed')});
 assert.equal(missed.phase,'live');assert.equal(missed.breakKind,null);
 const blocked=drive({possession:'16',text:'IND 35',lastPlay:lastPlay('Blocked Field Goal')});
 assert.equal(blocked.phase,'live');
 // The score break still applies when the feed has not assigned possession for the kickoff yet.
 const noPoss=drive({lastPlay:lastPlay('Rushing Touchdown')});
 assert.equal(noPoss.breakKind,'score');
});

test('liveGames() treats an in-progress game with nobody in possession as a stoppage, but never a pre or final game',()=>{
 const g=drive({down:0,lastPlay:lastPlay('Extra Point Good')});
 assert.equal(g.phase,'break');assert.equal(g.breakKind,'stoppage');assert.equal(g.possession,-1);
 const pre=one(scoreboard(event({state:'pre',name:'STATUS_SCHEDULED'})));
 assert.equal(pre.phase,'pre');assert.equal(pre.breakKind,null);
 const fin=one(scoreboard(event({state:'post',completed:true,situation:situation({lastPlay:lastPlay('Timeout')})})));
 assert.equal(fin.phase,'final');assert.equal(fin.breakKind,null);
});

// ---------- liveGames: special / down ----------
test('liveGames() marks kickoffs, punts and conversion tries special via down<=0 and keeps a real down as a drive',()=>{
 assert.equal(drive({possession:'11',down:0}).special,true);
 assert.equal(drive({possession:'11',down:'0'}).special,true);
 assert.equal(drive({possession:'11',down:-1,lastPlay:lastPlay('Rushing Touchdown')}).special,true);  // ESPN's conversion try
 const noDown=situation({possession:'11'});delete noDown.down;
 assert.equal(one(scoreboard(event({situation:noDown}))).special,true);  // no down at all
 assert.equal(drive({possession:'11',down:0,lastPlay:lastPlay('Kickoff')}).special,true);
 assert.equal(drive({possession:'11',down:0,lastPlay:lastPlay('Punt')}).special,true);
 for(const down of [1,2,3,4,'4']){
  const g=drive({possession:'11',down,distance:'7',text:'MIN 35'});
  assert.equal(g.special,false,`down=${down}`);assert.equal(g.down,Number(down));assert.equal(g.distance,7);
 }
 // After a punt or kickoff the feed already shows the receiving team's 1st & 10: that is a drive, not a special.
 const afterPunt=drive({possession:'16',down:1,distance:10,text:'MIN 20',lastPlay:lastPlay('Punt')});
 assert.equal(afterPunt.special,false);assert.equal(afterPunt.phase,'live');assert.equal(afterPunt.yardsToGoal,80);
 const afterKick=drive({possession:'11',down:1,distance:10,text:'IND 31',lastPlay:lastPlay('Kickoff')});
 assert.equal(afterKick.special,false);assert.equal(afterKick.yardsToGoal,69);
});

// ---------- liveGames feeding the director (product intent) ----------
test('a live break or conversion try puts no offensive starter on the field; the defense still counts on the try',()=>{
 const half=drive({possession:'11',text:'MIN 35'},{name:'STATUS_HALFTIME'});
 assert.deepEqual(involvement(half,roster),[]);
 const afterTD=drive({possession:'11',text:'MIN 35',lastPlay:lastPlay('Rushing Touchdown')});
 assert.deepEqual(involvement(afterTD,roster),[]);
 const tryPlay=drive({possession:'11',down:-1,distance:2,text:'MIN 2',lastPlay:lastPlay('Penalty')});
 assert.deepEqual(names(involvement(tryPlay,roster)),['Vikings D/ST:defense']);
 const kickoffPending=drive({possession:'11',down:0,lastPlay:lastPlay('Extra Point Good')});
 assert.deepEqual(names(involvement(kickoffPending,roster)),['Vikings D/ST:defense']);
 const pre=one(scoreboard(event({state:'pre',name:'STATUS_SCHEDULED'})));
 assert.deepEqual(involvement(pre,roster),[]);
});

test('on a live 4th down the normalized yardsToGoal decides punt vs kick vs go for the kicker and the offense',()=>{
 // 4th & 8 at the MIN 35: a 52-yard try. Kicker on, running back off.
 const kick=drive({possession:'11',down:4,distance:8,text:'MIN 35'});
 assert.equal(kick.yardsToGoal,35);assert.ok(kick.yardsToGoal<=KICK_RANGE);
 assert.deepEqual(names(involvement(kick,roster)),['Spencer Shrader:kicker','Vikings D/ST:defense']);
 const r=rate(kick,involvement(kick,roster));
 assert.equal(r.tier,2);assert.equal(r.critical,true);assert.equal(r.imminent,true);
 // 4th & 8 at the IND 30: a punt. Nobody on offense counts, only the opposing D/ST.
 const punt=drive({possession:'11',down:4,distance:8,text:'IND 30'});
 assert.equal(punt.yardsToGoal,70);
 assert.deepEqual(names(involvement(punt,roster)),['Vikings D/ST:defense']);
 assert.equal(rate(punt,involvement(punt,roster)).tier,1);
 // 4th & 1 at the IND 30: going for it. The running back counts, the kicker is out of range.
 const go=drive({possession:'11',down:4,distance:1,text:'IND 30'});
 assert.deepEqual(names(involvement(go,roster)),['Jonathan Taylor:offense','Vikings D/ST:defense']);
 // 4th & 2 at the MIN 40: short enough to go, close enough to kick: both count.
 const either=drive({possession:'11',down:4,distance:2,text:'MIN 40'});
 assert.deepEqual(names(involvement(either,roster)),['Jonathan Taylor:offense','Spencer Shrader:kicker','Vikings D/ST:defense']);
 // 3rd down out of range: the kicker never counts.
 const third=drive({possession:'11',down:3,distance:8,text:'MIN 35'});
 assert.deepEqual(names(involvement(third,roster)),['Jonathan Taylor:offense','Vikings D/ST:defense']);
});

test('the drive closest to the end zone ranks first and the red zone is critical, straight from ESPN possession text',()=>{
 const redZone=one(scoreboard(event({id:'A',situation:situation({possession:'11',down:1,distance:10,text:'MIN 15'})})));
 const ownSide=one(scoreboard(event({id:'B',away:team(11,'IND','Indianapolis Colts'),home:team(12,'KC','Kansas City Chiefs'),situation:situation({possession:'11',down:1,distance:10,text:'IND 25'})})));
 const only=[{name:'Jonathan Taylor',team:'IND',position:'RB'}];
 assert.equal(redZone.yardsToGoal,15);assert.equal(ownSide.yardsToGoal,75);
 const a=rate(redZone,involvement(redZone,only)),b=rate(ownSide,involvement(ownSide,only));
 assert.equal(a.critical,true);assert.equal(b.critical,false);assert.ok(a.score>b.score);
 assert.deepEqual(rank([ownSide,redZone],only).map(e=>e.game.id),['A','B']);
 // A game with none of the roster's teams never ranks at all.
 const other=one(scoreboard(event({id:'C',away:team(1,'ATL','Atlanta Falcons'),home:team(2,'BUF','Buffalo Bills'),situation:situation({possession:'1',down:1,distance:10,text:'BUF 3'})})));
 assert.deepEqual(rank([other,ownSide],only).map(e=>e.game.id),['B']);
});

// ---------- liveScores ----------
test('liveScores() maps every scoring play to the wallclock of its snap, the scoring team index and the parsed credits',()=>{
 const game=one(scoreboard(event()));
 const s=summary({
  previous:[[play(1,WC1,11),play(2,WC2,16)]],
  current:[play(3,WC3,11)],
  scoringPlays:[
   scoringPlay(1,11,'  Josh Downs 35 Yd pass from Daniel Jones (Spencer Shrader Kick)  ',{away:7,home:0}),
   scoringPlay(2,16,'Will Reichard 48 Yd Field Goal',{type:'Field Goal Good',scoringType:'field-goal',away:7,home:3,period:2,clock:'3:00'}),
   scoringPlay(3,11,'Jonathan Taylor 4 Yd Run (Spencer Shrader Kick)',{type:'Rushing Touchdown',away:14,home:3,period:2,clock:'0:45'}),
  ]});
 const scores=liveScores(s,game);
 assert.equal(scores.length,3);
 assert.deepEqual(scores[0],{id:'401:1',at:1760893711,team:0,kind:'TD',defensive:false,text:'Josh Downs 35 Yd pass from Daniel Jones (Spencer Shrader Kick)',
  players:[{name:'Josh Downs',role:'scorer'},{name:'Daniel Jones',role:'passer'},{name:'Spencer Shrader',role:'pat'}],away:7,home:0,period:1,clock:'10:12'});
 assert.equal(scores[0].at,Date.parse(WC1)/1000);
 assert.deepEqual(scores[1],{id:'401:2',at:1760894400,team:1,kind:'FG',defensive:false,text:'Will Reichard 48 Yd Field Goal',
  players:[{name:'Will Reichard',role:'kicker'}],away:7,home:3,period:2,clock:'3:00'});
 // The current (in-progress) drive counts too.
 assert.equal(scores[2].id,'401:3');assert.equal(scores[2].at,1760895600);assert.equal(scores[2].team,0);assert.equal(scores[2].kind,'TD');
 assert.deepEqual(scores[2].players,[{name:'Jonathan Taylor',role:'scorer'},{name:'Spencer Shrader',role:'pat'}]);
 assert.ok(scores.every(x=>Number.isInteger(x.at)));
});

test('liveScores() drops scoring plays it cannot place on the clock and copes with empty summaries',()=>{
 const game=one(scoreboard(event()));
 const s=summary({
  previous:[[play(1,WC1,11),play(2,null,16),{id:'4',wallclock:WC3}]],
  scoringPlays:[
   scoringPlay(1,11,'Jonathan Taylor 4 Yd Run (Spencer Shrader Kick)'),
   scoringPlay(2,16,'Will Reichard 48 Yd Field Goal',{type:'Field Goal Good',scoringType:'field-goal'}),  // play has no wallclock
   scoringPlay(3,16,'Will Reichard 30 Yd Field Goal',{type:'Field Goal Good',scoringType:'field-goal'}),  // play not in the drives
   scoringPlay(4,16,'Will Reichard 20 Yd Field Goal',{type:'Field Goal Good',scoringType:'field-goal'}),  // play without a start team
  ]});
 const scores=liveScores(s,game);
 assert.deepEqual(scores.map(x=>x.id),['401:1','401:4']);
 assert.equal(scores[1].defensive,false);assert.equal(scores[1].team,1);
 assert.deepEqual(liveScores({},game),[]);
 assert.deepEqual(liveScores({drives:{},scoringPlays:[]},game),[]);
 assert.deepEqual(liveScores({drives:{previous:[{}],current:{}},scoringPlays:[scoringPlay(1,11,'x')]},game),[]);
 assert.deepEqual(liveScores({drives:{previous:[{plays:[play(1,WC1,11)]}]}},game),[]);
});

test('liveScores() flags defensive scores from the text or from the scoring team not being the offense',()=>{
 const game=one(scoreboard(event()));
 const s=summary({
  previous:[[play(1,WC1,16),play(2,WC1,16),play(3,WC1,11),play(4,WC1,16),play(5,WC1,16),play(6,WC1,11)]],
  scoringPlays:[
   scoringPlay(1,11,'Kenny Moore II 40 Yd Interception Return (Spencer Shrader Kick)',{type:'Interception Return Touchdown'}),  // text says return
   scoringPlay(2,11,'Kenny Moore II 1 Yd Run (Spencer Shrader Kick)',{type:'Rushing Touchdown'}),                            // only the offense/defense mismatch says so
   scoringPlay(3,11,'Jonathan Taylor 4 Yd Run (Spencer Shrader Kick)',{type:'Rushing Touchdown'}),                            // the offense scored
   scoringPlay(4,11,'Safety',{type:'Safety',scoringType:'safety',away:2}),
   scoringPlay(5,99,'Somebody 4 Yd Run (Spencer Shrader Kick)',{type:'Rushing Touchdown'}),                                   // unknown team: no mismatch to go on
   scoringPlay(6,11,'Will Reichard 48 Yd Field Goal',{type:'Field Goal Good',scoringType:'field-goal'}),
  ]});
 const scores=liveScores(s,game);
 assert.deepEqual(scores.map(x=>[x.team,x.kind,x.defensive]),[[0,'TD',true],[0,'TD',true],[0,'TD',false],[0,'SAF',true],[-1,'TD',false],[0,'FG',false]]);
 assert.deepEqual(scores[0].players,[{name:'Kenny Moore II',role:'scorer'},{name:'Spencer Shrader',role:'pat'}]);
 assert.deepEqual(scores[3].players,[]);
});

test('liveScores() matches ids whether ESPN sends them as strings or numbers',()=>{
 const game=one(scoreboard(event()));
 const s={drives:{previous:[{plays:[{id:1,wallclock:WC1,start:{team:{id:16}}}]}]},scoringPlays:[{id:1,team:{id:11},text:'Kenny Moore II 40 Yd Interception Return (Spencer Shrader Kick)',type:{text:'Interception Return Touchdown'},awayScore:7,homeScore:0}]};
 const [x]=liveScores(s,game);
 assert.equal(x.id,'401:1');assert.equal(x.team,0);assert.equal(x.defensive,true);assert.equal(x.period,0);assert.equal(x.clock,'');
 assert.equal(x.away,7);assert.equal(x.home,0);
});

test('live scores feed roster credit: only scorer/passer/kicker/defense/two-point credits are worth replaying, an extra point alone is not',()=>{
 const game=one(scoreboard(event({score:[14,3]})));
 const s=summary({
  previous:[[play(1,WC1,11),play(2,WC2,16),play(3,WC3,11),play(4,WC3,16)]],
  scoringPlays:[
   scoringPlay(1,11,'Josh Downs 35 Yd pass from Daniel Jones (Spencer Shrader Kick)',{away:7,home:0}),
   scoringPlay(2,16,'Will Reichard 48 Yd Field Goal',{type:'Field Goal Good',scoringType:'field-goal',away:7,home:3}),
   scoringPlay(3,11,'Jonathan Taylor 4 Yd Run (Spencer Shrader Kick)',{type:'Rushing Touchdown',away:14,home:3}),
   scoringPlay(4,11,'Kenny Moore II 40 Yd Interception Return (Spencer Shrader Kick)',{type:'Interception Return Touchdown',away:21,home:3}),
  ]});
 const [downs,fg,taylor,pick]=liveScores(s,game);
 const credit=x=>rosterCredit(x,game,roster).map(c=>`${c.player.name}:${c.role}`);
 assert.deepEqual(credit(downs),['Spencer Shrader:pat']);assert.equal(worthReplaying(rosterCredit(downs,game,roster)),false);
 assert.deepEqual(credit(fg),['Will Reichard:kicker']);assert.equal(worthReplaying(rosterCredit(fg,game,roster)),true);
 assert.deepEqual(credit(taylor),['Jonathan Taylor:scorer','Spencer Shrader:pat']);assert.equal(worthReplaying(rosterCredit(taylor,game,roster)),true);
 assert.deepEqual(credit(pick),['Spencer Shrader:pat','Colts D/ST:defense']);assert.equal(worthReplaying(rosterCredit(pick,game,roster)),true);
 assert.deepEqual(describeScore(taylor,game),{label:'Touchdown',team:'IND',line:'IND 14 – MIN 3',text:'Jonathan Taylor 4 Yd Run'});
 assert.deepEqual(describeScore(fg,game),{label:'Field goal',team:'MIN',line:'IND 7 – MIN 3',text:'Will Reichard 48 Yd Field Goal'});
});

// ---------- scoring.js: ESPN summary variants ----------
test('parseScoringPlay() keys the kind off ESPN scoringType names and credits two-point tries and defensive conversions',()=>{
 assert.deepEqual(parseScoringPlay('Will Reichard 48 Yd Field Goal','Field Goal Good','field-goal'),{kind:'FG',defensive:false,players:[{name:'Will Reichard',role:'kicker'}]});
 assert.deepEqual(parseScoringPlay('Safety','Safety','safety'),{kind:'SAF',defensive:true,players:[]});
 assert.deepEqual(parseScoringPlay('Kenny Moore II Defensive PAT Conversion','Defensive PAT Conversion','two-point-conversion'),{kind:'D2P',defensive:true,players:[{name:'Kenny Moore II',role:'scorer'}]});
 assert.deepEqual(parseScoringPlay('Jonathan Taylor 4 Yd Rush (Jonathan Taylor Run for Two-Point Conversion)','Rushing Touchdown','touchdown'),
  {kind:'TD',defensive:false,players:[{name:'Jonathan Taylor',role:'scorer'},{name:'Jonathan Taylor',role:'two-point'}]});
 assert.deepEqual(parseScoringPlay('Josh Downs 35 Yd pass from Daniel Jones (Daniel Jones Pass to Michael Pittman Jr. for Two-Point Conversion)','Passing Touchdown','touchdown').players,
  [{name:'Josh Downs',role:'scorer'},{name:'Daniel Jones',role:'passer'},{name:'Daniel Jones',role:'two-point'},{name:'Michael Pittman Jr.',role:'two-point'}]);
 assert.deepEqual(parseScoringPlay('Josh Downs 35 Yd pass from Daniel Jones (Two-Point Pass Conversion Failed)','Passing Touchdown','touchdown').players,
  [{name:'Josh Downs',role:'scorer'},{name:'Daniel Jones',role:'passer'}]);
 assert.deepEqual(parseScoringPlay('Jonathan Taylor 4 Yd Run (Spencer Shrader PAT failed)','Rushing Touchdown','touchdown').players,[{name:'Jonathan Taylor',role:'scorer'}]);
 assert.deepEqual(parseScoringPlay('Jonathan Taylor 4 Yd Run (Spencer Shrader Kick Blocked)','Rushing Touchdown','touchdown').players,[{name:'Jonathan Taylor',role:'scorer'}]);
});

test('parseScoringPlay() marks returns, blocked kicks and takeaway touchdowns defensive, but not an ordinary offensive touchdown',()=>{
 assert.equal(parseScoringPlay('Devin Duvernay 100 Yd Kickoff Return (Will Reichard Kick)','Kickoff Return Touchdown','touchdown').defensive,true);
 assert.deepEqual(parseScoringPlay('Devin Duvernay 100 Yd Kickoff Return (Will Reichard Kick)').players,[{name:'Devin Duvernay',role:'scorer'},{name:'Will Reichard',role:'pat'}]);
 assert.equal(parseScoringPlay('Kenny Moore II 1 Yd Run (Spencer Shrader Kick)','Fumble Recovery (Opponent)','touchdown').defensive,true);
 assert.equal(parseScoringPlay('Kenny Moore II 1 Yd Run (Spencer Shrader Kick)','Blocked Punt Touchdown','touchdown').defensive,true);
 assert.equal(parseScoringPlay('Jonathan Taylor 4 Yd Run (Spencer Shrader Kick)','Rushing Touchdown','touchdown').defensive,false);
 assert.equal(parseScoringPlay('Will Reichard 48 Yd Field Goal','Blocked Field Goal','field-goal').defensive,false);  // blocked only matters for touchdowns
});
