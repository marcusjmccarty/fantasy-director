import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGame,buildArchive,latestCompletedWeek,PlayTypes,yardsToGoal} from '../web/archive-build.js';
import {ReplayArchive} from '../web/archive.js';

const play=(id,seq,wall,extra={})=>({id,sequenceNumber:String(seq),wallclock:wall,period:{number:1},clock:{displayValue:'14:55'},type:{text:'Rush'},start:{team:{id:'11'},down:1,distance:10,possessionText:'IND 25'},awayScore:0,homeScore:0,text:'(Shotgun) J.Taylor right guard to IND 30 for 5 yards (D.Hunter).',...extra});
const summary=()=>({header:{id:'401',competitions:[{date:'2026-11-01T18:00Z',competitors:[{homeAway:'away',team:{id:'11',abbreviation:'IND',displayName:'Indianapolis Colts'}},{homeAway:'home',team:{id:'16',abbreviation:'MIN',displayName:'Minnesota Vikings'}}]}]},
 drives:{previous:[{plays:[play('p1',1,'2026-11-01T18:02:00Z',{type:{text:'Kickoff'},start:{team:{id:'16'},down:0,distance:0,possessionText:'MIN 35'}}),play('p2',2,'2026-11-01T18:02:40Z'),play('p3',3,'2026-11-01T18:03:30Z',{type:{text:'Pass Reception'},text:'J.Taylor 70 yard run for a TOUCHDOWN.',awayScore:6,homeScore:0,start:{team:{id:'11'},down:2,distance:5,possessionText:'MIN 30'}})]}]},
 scoringPlays:[{id:'p3',team:{id:'11'},type:{text:'Rushing Touchdown'},scoringType:{name:'touchdown'},text:'Jonathan Taylor 70 Yd Run (Matt Gay Kick)',awayScore:7,homeScore:0,period:{number:1},clock:{displayValue:'13:40'}}]});

test('buildGame turns an ESPN summary into archive rows the replay engine accepts',()=>{
 const types=new PlayTypes(),game=buildGame(summary(),{id:'401',name:'IND at MIN',embed:'https://ok.ru/videoembed/1',recordingDuration:9000},types);
 assert.equal(game.id,'401');assert.deepEqual(game.teams.map(t=>t.abbreviation),['IND','MIN']);
 assert.equal(game.start,Date.parse('2026-11-01T18:02:00Z')/1000);assert.equal(game.plays.length,3);assert.deepEqual(game.plays.map(r=>r[0]),[0,40,90]);
 assert.equal(game.plays[1][7],75,'yards to goal from the offense’s own 25');assert.equal(game.plays[2][7],30);
 assert.equal(game.plays[1][10],'J.Taylor right guard to IND 30 for 5 yards (D.Hunter).','formation prefixes are tidied away');
 assert.equal(game.scores.length,1);assert.equal(game.scores[0].i,2);assert.equal(game.scores[0].kind,'TD');assert.equal(game.scores[0].players[0].name,'Jonathan Taylor');
 assert.deepEqual(types.names,['Kickoff','Rush','Pass Reception']);assert.equal(game.end,game.start+90+30);
 const archive=new ReplayArchive(buildArchive([{raw:summary(),meta:{id:'401',name:'IND at MIN'}}],{season:2026,week:8}));
 assert.equal(archive.data.week,8);assert.equal(archive.games[0].scores[0].at,game.start+90);assert.equal(archive.sessions.length,1);
});
test('buildArchive skips summaries without plays and never throws for one bad game',()=>{
 const data=buildArchive([{raw:{header:summary().header,drives:{previous:[]}},meta:{id:'x'}},{raw:summary(),meta:{id:'401'}}],{season:2026,week:8});
 assert.equal(data.games.length,1);assert.equal(data.coverage.games,1);assert.equal(data.version,2);assert.equal(data.title,'Week 8');
});
test('latestCompletedWeek: the current week once every game is final, otherwise the week before',()=>{
 const done=c=>({competitions:[{status:{type:{completed:c}}}]});
 assert.equal(latestCompletedWeek({week:{number:9},events:[done(false),done(true)]}),8);
 assert.equal(latestCompletedWeek({week:{number:8},events:[done(true),done(true)]}),8);
 assert.equal(latestCompletedWeek({week:{number:1},events:[done(false)]}),0);
 assert.equal(latestCompletedWeek({week:{number:3},events:[]}),2);assert.equal(latestCompletedWeek(null),0);
 assert.equal(latestCompletedWeek({season:{type:3},week:{number:2},events:[done(true)]}),18,'the playoffs keep the last regular-season week');assert.equal(latestCompletedWeek({season:{type:1},week:{number:3},events:[done(true)]}),0);
});
test('yardsToGoal reads the possession text from the offense’s point of view',()=>{
 const abbr={11:'IND',16:'MIN'};
 assert.equal(yardsToGoal({team:{id:'11'},possessionText:'IND 25'},abbr),75);assert.equal(yardsToGoal({team:{id:'11'},possessionText:'MIN 8'},abbr),8);
 assert.equal(yardsToGoal({team:{id:'11'},possessionText:'50'},abbr),50);assert.equal(yardsToGoal({team:{id:'11'},possessionText:'',yardsToEndzone:140},abbr),null);
});
