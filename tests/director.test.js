// The director only ever shows a game where one of your starters is on the
// field, prefers the drive closest to the end zone, waits for the whistle,
// and replays missed scores at quiet moments. These tests encode that intent
// with small hand-made game states; nothing here touches timers or the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {KICK_RANGE,RULES,involvement,rate,rank,hasRoster,rosterTeams,explain,Director} from '../web/director.js';
import {alias} from '../web/scoring.js';

// ---------- fixtures ----------
const RB={name:'Jonathan Taylor',team:'IND',position:'RB'};
const WR={name:'CeeDee Lamb',team:'DAL',position:'WR'};
const QB={name:'Dak Prescott',team:'DAL',position:'QB'};
const TE={name:'Jake Ferguson',team:'DAL',position:'TE'};
const K={name:'Brandon Aubrey',team:'DAL',position:'K'};
const DST={name:'Steelers D/ST',team:'PIT',position:'D/ST'};
const ROSTER=[RB,WR,QB,K,DST];

// A game between snaps on 1st & 10 at midfield, away team (index 0) on offense.
const game=(id,away,home,o={})=>({id,name:`${away} at ${home}`,teams:[{abbr:away},{abbr:home}],state:'in',phase:'live',
 possession:0,down:1,distance:10,yardsToGoal:50,special:false,playType:'Rush',nextSnapIn:30,scores:[],...o});
const roles=list=>list.map(x=>x.role).sort();
const names=list=>list.map(x=>x.player.name).sort();
const decide=(d,o)=>d.decide({games:[],roster:ROSTER,at:1000,current:{},...o});

// ---------- involvement() ----------
test('involvement: offensive starters count only when their team has the ball; D/ST counts on the other side',()=>{
 const ind=game('A','IND','PIT');
 assert.deepEqual(roles(involvement(ind,[RB])),['offense']);
 assert.deepEqual(roles(involvement(ind,[RB,DST])),['defense','offense']);
 assert.deepEqual(involvement(ind,[WR,QB,K]),[],'starters from teams not in the game');
 const pit=game('A','IND','PIT',{possession:1});
 assert.deepEqual(involvement(pit,[RB]),[],'your RB is on the bench while the opponent drives');
 assert.deepEqual(involvement(pit,[DST]),[],'your D/ST is off the field when its own offense has the ball');
 assert.equal(involvement(ind,[RB])[0].player,RB,'the entry carries the roster player');
});
test('involvement: nothing counts before kickoff, after the final, in a break, or without possession',()=>{
 const live=game('A','IND','PIT');
 assert.ok(involvement(live,[RB,DST]).length);
 assert.deepEqual(involvement({...live,state:'pre',phase:'pre',possession:-1},[RB,DST]),[]);
 assert.deepEqual(involvement({...live,state:'post',phase:'final',possession:-1},[RB,DST]),[]);
 assert.deepEqual(involvement({...live,phase:'break'},[RB,DST]),[],'a timeout or halftime is not involvement');
 assert.deepEqual(involvement({...live,phase:'pre'},[RB,DST]),[]);
 assert.deepEqual(involvement({...live,possession:-1},[RB,DST]),[],'unknown possession');
});
test('involvement: a kicker counts only on 4th down at or inside the opponent 42, never on special teams',()=>{
 assert.equal(KICK_RANGE,42);
 const fourth=o=>game('A','DAL','NYG',{down:4,distance:7,...o});
 assert.deepEqual(roles(involvement(fourth({yardsToGoal:KICK_RANGE}),[K])),['kicker'],'at the 42 exactly');
 assert.deepEqual(roles(involvement(fourth({yardsToGoal:12}),[K])),['kicker']);
 assert.deepEqual(involvement(fourth({yardsToGoal:KICK_RANGE+1}),[K]),[],'one yard out of range');
 assert.deepEqual(involvement(game('A','DAL','NYG',{down:3,distance:2,yardsToGoal:12}),[K]),[],'3rd down, even in the red zone');
 assert.deepEqual(involvement(fourth({yardsToGoal:30,special:true,playType:'Punt'}),[K]),[],'punt');
 assert.deepEqual(involvement(game('A','DAL','NYG',{down:0,distance:0,yardsToGoal:65,special:true,playType:'Kickoff'}),[K]),[],'kickoff');
 assert.deepEqual(involvement(game('A','DAL','NYG',{down:0,distance:0,yardsToGoal:15,special:true,playType:'Extra Point'}),[K]),[],'conversion try');
 assert.deepEqual(involvement(fourth({yardsToGoal:30,possession:1}),[K]),[],'the other team is lining up to kick');
});
test('involvement: offensive starters sit out kickoffs, punts and conversion tries',()=>{
 const dal=[WR,QB];
 assert.equal(involvement(game('A','DAL','NYG'),dal).length,2);
 assert.deepEqual(involvement(game('A','DAL','NYG',{down:0,distance:0,yardsToGoal:65,special:true,playType:'Kickoff'}),dal),[]);
 assert.deepEqual(involvement(game('A','DAL','NYG',{down:4,distance:9,yardsToGoal:70,special:true,playType:'Punt'}),dal),[]);
 assert.deepEqual(involvement(game('A','DAL','NYG',{down:0,distance:0,yardsToGoal:2,special:true,playType:'Two Point Conversion'}),dal),[]);
 assert.deepEqual(involvement(game('A','DAL','NYG',{phase:'play',down:0,distance:0,yardsToGoal:65,special:true,playType:'Kickoff'}),dal),[],'kickoff in flight');
});
test('involvement: on 4th down the offense counts only when the team is clearly going for it',()=>{
 const fourth=o=>game('A','DAL','NYG',{down:4,...o});
 // 4th & 5 at the 30: a kick is coming, so the kicker is on and the receivers are off.
 assert.deepEqual(roles(involvement(fourth({distance:5,yardsToGoal:30}),[WR,K])),['kicker']);
 // 4th & 5 at the 60: a punt is coming, nobody of yours is on the field.
 assert.deepEqual(involvement(fourth({distance:5,yardsToGoal:60}),[WR,K]),[]);
 // 4th & 1 at the 30: the offense stays on (the kicker is also within range).
 assert.deepEqual(roles(involvement(fourth({distance:1,yardsToGoal:30}),[WR,K])),['kicker','offense']);
 assert.deepEqual(roles(involvement(fourth({distance:2,yardsToGoal:60}),[WR,K])),['offense'],'4th & 2 out of range is a go');
 // Once the ball is snapped the play type settles it: a snap that is not special teams is a go.
 assert.deepEqual(roles(involvement(fourth({phase:'play',distance:8,yardsToGoal:35,playType:'Pass Reception'}),[WR])),['offense']);
 assert.deepEqual(involvement(fourth({phase:'play',distance:8,yardsToGoal:35,playType:'Field Goal Good'}),[WR]),[],'a field-goal snap');
 assert.deepEqual(roles(involvement(fourth({phase:'play',distance:8,yardsToGoal:35,playType:'Field Goal Good'}),[WR,K])),['kicker']);
 assert.deepEqual(involvement(fourth({phase:'play',distance:8,yardsToGoal:60,special:true,playType:'Punt'}),[WR]),[],'a punt snap');
});
test('involvement: team aliases (JAX/JAC, WSH/WAS, LA/LAR) match the feed abbreviations',()=>{
 assert.equal(alias('JAX'),'JAC');assert.equal(alias('WSH'),'WAS');assert.equal(alias('LA'),'LAR');
 const jaguar={name:'Brian Thomas Jr.',team:'JAX',position:'WR'},commander={name:'Commanders D/ST',team:'WSH',position:'D/ST'};
 const g=game('A','JAC','WAS');
 assert.deepEqual(roles(involvement(g,[jaguar,commander])),['defense','offense']);
 assert.deepEqual([...rosterTeams([jaguar,commander])].sort(),['JAC','WAS']);
});
test('involvement: includeDefense=false ignores D/ST entirely',()=>{
 const g=game('A','IND','PIT');
 assert.deepEqual(roles(involvement(g,[RB,DST],{includeDefense:false})),['offense']);
 assert.deepEqual(involvement(g,[DST],{includeDefense:false}),[]);
 assert.deepEqual(rank([g],[DST],{includeDefense:false}),[]);
 assert.equal(rank([g],[DST]).length,1);
});
test('involvement: a kicker does not count on 4th down when the field position is unknown',()=>{
 const g=game('A','DAL','NYG',{down:4,distance:7,yardsToGoal:null});
 assert.deepEqual(involvement(g,[K]),[]);
 assert.deepEqual(rank([g],[K]),[]);
});

// ---------- rate() ----------
test('rate: offense is tier 2, defense tier 1, nobody tier 0; the red zone (<=20) is critical',()=>{
 const g=ytg=>game('A','IND','PIT',{yardsToGoal:ytg});
 const off=rate(g(50),[{player:RB,role:'offense'}]);
 assert.deepEqual(off,{tier:2,yards:50,score:50,critical:false,imminent:false});
 assert.deepEqual(rate(g(20),[{player:RB,role:'offense'}]),{tier:2,yards:20,score:80,critical:true,imminent:false},'20 yards out is the red zone');
 assert.equal(rate(g(21),[{player:RB,role:'offense'}]).critical,false,'21 is not');
 const def=rate(g(5),[{player:DST,role:'defense'}]);
 assert.deepEqual(def,{tier:1,yards:5,score:95,critical:false,imminent:false},'a defense backed up to its goal line is still never critical');
 assert.deepEqual(rate(g(5),[]),{tier:0,yards:5,score:0,critical:false,imminent:false});
 assert.equal(rate(g(null),[{player:RB,role:'offense'}]).yards,80,'unknown field position is treated as deep in own territory');
 assert.equal(rate(g(null),[{player:RB,role:'offense'}]).score,20);
});
test('rate: kick tries and 4th-down gambles are critical and imminent; stacked starters add a little',()=>{
 const kick=rate(game('A','DAL','NYG',{down:4,distance:7,yardsToGoal:35}),[{player:K,role:'kicker'}]);
 assert.deepEqual(kick,{tier:2,yards:35,score:66,critical:true,imminent:true});
 const go=rate(game('A','DAL','NYG',{down:4,distance:1,yardsToGoal:40}),[{player:WR,role:'offense'}]);
 assert.deepEqual(go,{tier:2,yards:40,score:64,critical:true,imminent:true});
 const goWithK=rate(game('A','DAL','NYG',{down:4,distance:1,yardsToGoal:40}),[{player:WR,role:'offense'},{player:K,role:'kicker'}]);
 assert.equal(goWithK.score,66,'offense + kicker on a 4th-and-short is a gamble, not a kick try');
 assert.equal(goWithK.critical,true);
 const stack=rate(game('A','DAL','NYG',{yardsToGoal:50}),[{player:WR,role:'offense'},{player:QB,role:'offense'},{player:TE,role:'offense'}]);
 assert.deepEqual(stack,{tier:2,yards:50,score:54,critical:false,imminent:false});
 const mixed=rate(game('A','DAL','PIT',{yardsToGoal:50}),[{player:WR,role:'offense'},{player:DST,role:'defense'}]);
 assert.equal(mixed.tier,2,'offense on the field sets the tier even when your defense is also out there');
 assert.equal(mixed.score,50,'your defense does not pad the score');
});

// ---------- rank() ----------
test('rank: an offense on the field beats a defense, and among offenses the drive nearest the end zone wins',()=>{
 const defense=game('D','SEA','PIT',{yardsToGoal:3});          // Steelers D/ST backed up to the goal line
 const far=game('F','IND','KC',{yardsToGoal:60});               // Taylor driving from his own 40
 const near=game('N','DAL','NYG',{yardsToGoal:12});             // Lamb/Prescott in the red zone
 const none=game('X','SF','LAR',{yardsToGoal:1});               // no roster team, 1st and goal
 const ranked=rank([none,defense,far,near],ROSTER);
 assert.deepEqual(ranked.map(e=>e.game.id),['N','F','D']);
 assert.equal(ranked[0].critical,true);assert.equal(ranked[0].tier,2);assert.equal(ranked[2].tier,1);
 assert.deepEqual(names(ranked[0].players),['CeeDee Lamb','Dak Prescott']);
 assert.ok(!ranked.some(e=>e.game.id==='X'),'a game without any of your teams never ranks');
});
test('rank: honors the excluded set and breaks ties toward the game already on screen, then by id',()=>{
 const a=game('a','IND','KC',{yardsToGoal:40}),b=game('b','DAL','NYG',{yardsToGoal:40,possession:0});
 const bOnly=[WR];const both=[RB,WR];
 assert.deepEqual(rank([a,b],both).map(e=>e.game.id),['a','b'],'equal scores fall back to id order');
 assert.deepEqual(rank([a,b],both,{currentId:'b'}).map(e=>e.game.id),['b','a'],'the current game wins a tie');
 assert.deepEqual(rank([a,b],both,{excluded:new Set(['a'])}).map(e=>e.game.id),['b']);
 assert.deepEqual(rank([a,b],bOnly).map(e=>e.game.id),['b']);
 assert.deepEqual(rank([a,b],[]),[]);
});

// ---------- hasRoster() / explain() ----------
test('hasRoster: true when either team belongs to a starter, with aliases; false otherwise',()=>{
 assert.equal(hasRoster(game('A','IND','KC'),ROSTER),true);
 assert.equal(hasRoster(game('A','KC','IND'),ROSTER),true);
 assert.equal(hasRoster(game('A','SF','SEA'),ROSTER),false);
 assert.equal(hasRoster(game('A','JAC','KC'),[{name:'X',team:'JAX',position:'WR'}]),true);
 assert.equal(hasRoster(game('A','SF','SEA'),[]),false);
});
test('explain: names the starters on the field and why the game matters',()=>{
 const entry=(players,g)=>({game:g,players});
 assert.equal(explain(entry([{player:WR,role:'offense'}],game('A','DAL','NYG',{yardsToGoal:15}))),'Lamb · red zone, 15 yards out');
 assert.equal(explain(entry([{player:WR,role:'offense'}],game('A','DAL','NYG',{yardsToGoal:50}))),'Lamb · driving, 50 yards out');
 assert.equal(explain(entry([{player:WR,role:'offense'},{player:QB,role:'offense'}],game('A','DAL','NYG',{yardsToGoal:20}))),'Lamb & Prescott · red zone, 20 yards out');
 assert.equal(explain(entry([{player:WR,role:'offense'},{player:QB,role:'offense'},{player:TE,role:'offense'}],game('A','DAL','NYG',{yardsToGoal:50}))),'Lamb, Prescott +1 · driving, 50 yards out');
 assert.equal(explain(entry([{player:K,role:'kicker'}],game('A','DAL','NYG',{down:4,yardsToGoal:30}))),'Aubrey · field-goal range on 4th down');
 assert.equal(explain(entry([{player:DST,role:'defense'}],game('A','SEA','PIT'))),'D/ST defense on the field');
 assert.equal(explain(entry([],game('A','SEA','PIT'))),'Your matchup');
 assert.equal(explain(null),'Your matchup');
 assert.equal(explain(rank([game('A','DAL','NYG',{yardsToGoal:9})],[WR,QB])[0]),'Lamb & Prescott · red zone, 9 yards out');
});

// ---------- Director.decide(): choosing a game ----------
test('decide: from nothing, picks the roster offense nearest the end zone and never a game without your teams',()=>{
 const d=new Director();
 const games=[game('X','SF','SEA',{yardsToGoal:1}),game('D','SEA','PIT',{yardsToGoal:2}),game('F','IND','KC',{yardsToGoal:45}),game('N','DAL','NYG',{yardsToGoal:25})];
 const out=decide(d,{games});
 assert.equal(out.kind,'game');assert.equal(out.id,'N');
 assert.equal(out.reason,'Lamb & Prescott · driving, 25 yards out');
 assert.equal(out.entry.tier,2);
 assert.deepEqual(names(out.entry.players),['CeeDee Lamb','Dak Prescott']);
});
test('decide: standby when none of your starters can be on the field',()=>{
 const d=new Director();
 assert.deepEqual(decide(d,{games:[]}),{kind:'standby',id:null,reason:'None of your starters are playing right now'});
 const noRoster=[game('X','SF','SEA',{yardsToGoal:1}),game('Y','GB','CHI',{phase:'play',yardsToGoal:3})];
 assert.equal(decide(d,{games:noRoster}).kind,'standby','a red-zone snap in someone else\'s game is not worth showing');
 const notStarted=[game('A','IND','KC',{state:'pre',phase:'pre',possession:-1,nextSnapIn:900}),game('B','DAL','NYG',{state:'post',phase:'final',possession:-1})];
 assert.equal(decide(d,{games:[...noRoster,...notStarted]}).kind,'standby','your games have not started or are over');
 assert.equal(decide(d,{games:noRoster,current:{kind:'game',id:'X'}}).kind,'standby','does not linger on a game without your teams');
});
test('decide: between series it falls back to a game with a roster team, preferring one not in a break',()=>{
 const d=new Director();
 const pit=game('P','SEA','PIT',{possession:1,yardsToGoal:30});          // Steelers have the ball: D/ST off, nobody of yours on
 const ind=game('I','IND','KC',{possession:1,yardsToGoal:30});           // Chiefs have the ball: Taylor on the bench
 const other=game('X','SF','LAR',{yardsToGoal:4});
 const out=decide(d,{games:[other,pit,ind]});
 assert.equal(out.kind,'game');assert.equal(out.id,'I');assert.equal(out.reason,'Your players are off the field');
 assert.equal(out.entry.tier,0);assert.deepEqual(out.entry.players,[]);
 const indBreak={...ind,phase:'break',possession:-1};
 assert.equal(decide(d,{games:[other,indBreak,pit]}).id,'P','a game in a break ranks behind one with action');
 assert.equal(decide(d,{games:[other,indBreak,pit],excluded:new Set(['P'])}).id,'I','excluded games are skipped');
 assert.equal(decide(d,{games:[other,indBreak,pit],excluded:new Set(['P','I'])}).kind,'standby');
});
test('decide: stays on the current roster game while your players are off the field or the game is in a break',()=>{
 const d=new Director();
 const ind=game('I','IND','KC',{possession:1});
 const stay=decide(d,{games:[ind,game('P','SEA','PIT',{possession:1})],current:{kind:'game',id:'I'}});
 assert.deepEqual([stay.kind,stay.id,stay.reason],['game','I','Your players are off the field']);
 const brk=decide(d,{games:[{...ind,phase:'break',possession:-1},game('P','SEA','PIT',{possession:1})],current:{kind:'game',id:'I'}});
 assert.deepEqual([brk.kind,brk.id,brk.reason],['game','I','Break in the action']);
 // ...but leaves at once when a starter takes the field elsewhere (a break is not a live feed to debounce).
 const live=decide(d,{games:[{...ind,phase:'break',possession:-1},game('P','SEA','PIT',{possession:0,yardsToGoal:70})],current:{kind:'game',id:'I'}});
 assert.deepEqual([live.kind,live.id,live.reason],['game','P','D/ST defense on the field']);
});
test('decide: an offense on the field takes over from a defense; the current game wins ties',()=>{
 const d=new Director({debounce:0});
 const def=game('D','SEA','PIT',{yardsToGoal:3}),off=game('O','IND','KC',{yardsToGoal:75});
 const out=decide(d,{games:[def,off],current:{kind:'game',id:'D'}});
 assert.equal(out.id,'O');assert.equal(out.reason,'Taylor · driving, 75 yards out');
 const a=game('a','IND','KC',{yardsToGoal:40}),b=game('b','DAL','NYG',{yardsToGoal:40});
 assert.equal(decide(d,{games:[a,b],current:{kind:'game',id:'b'}}).id,'b');
 assert.equal(decide(d,{games:[a,b],current:{kind:'game',id:'a'}}).id,'a');
});

// ---------- Director.decide(): not cutting at the wrong moment ----------
test('decide: never cuts away while a play involving your starter is in progress',()=>{
 const d=new Director({debounce:0});
 const mine=game('A','IND','KC',{phase:'play',yardsToGoal:70,nextSnapIn:null});
 const urgent=game('B','DAL','NYG',{yardsToGoal:5,nextSnapIn:4});
 const held=decide(d,{games:[mine,urgent],current:{kind:'game',id:'A'}});
 assert.deepEqual([held.kind,held.id,held.reason],['game','A','Play in progress']);
 assert.equal(decide(d,{games:[{...mine,phase:'play',possession:0},urgent],current:{kind:'game',id:'A'},queue:[{id:'s1',queuedAt:0}]}).id,'A','not even for an overdue replay');
 // The whistle blows: now the red-zone drive wins.
 assert.equal(decide(d,{games:[{...mine,phase:'live'},urgent],current:{kind:'game',id:'A'}}).id,'B');
 // A snap your starter is not part of (the other team has the ball) does not hold the channel.
 assert.equal(decide(d,{games:[{...mine,possession:1},urgent],current:{kind:'game',id:'A'}}).id,'B');
 // Nor does a play in an excluded game.
 assert.equal(decide(d,{games:[mine,urgent],current:{kind:'game',id:'A'},excluded:new Set(['A'])}).id,'B');
});
test('decide: after a cut, dwells for RULES.dwell seconds against a same-tier challenger',()=>{
 const d=new Director({debounce:0});
 const cur=game('A','IND','KC',{yardsToGoal:50}),better=game('B','DAL','NYG',{yardsToGoal:30});   // 72 (Lamb + Prescott) vs 50: past the margin, not critical
 d.committed(1000);
 for(const at of [1000,1005,1000+RULES.dwell-.5])assert.equal(decide(d,{games:[cur,better],at,current:{kind:'game',id:'A'}}).id,'A',`still dwelling at +${at-1000}s`);
 assert.equal(decide(d,{games:[cur,better],at:1000+RULES.dwell,current:{kind:'game',id:'A'}}).id,'B','the dwell is over');
 d.reset();
 assert.equal(decide(d,{games:[cur,better],at:1000,current:{kind:'game',id:'A'}}).id,'B','reset() forgets the last cut');
});
test('decide: a critical, higher-scoring option breaks the dwell; a critical one that scores lower does not',()=>{
 const d=new Director({debounce:0});
 const cur=game('A','IND','KC',{yardsToGoal:50});
 d.committed(1000);
 const redZone=game('B','DAL','NYG',{yardsToGoal:15});
 assert.equal(decide(d,{games:[cur,redZone],at:1002,current:{kind:'game',id:'A'}}).id,'B','red zone breaks the dwell');
 const fourthDown=game('B','DAL','NYG',{down:4,distance:1,yardsToGoal:60});   // going for it: critical, score 40+2+4 = 46 < 50
 assert.equal(decide(d,{games:[cur,fourthDown],at:1002,current:{kind:'game',id:'A'}}).id,'A','critical but not better');
 const kick=game('B','DAL','NYG',{down:4,distance:7,yardsToGoal:40});          // kick try: critical, score 61 > 50
 assert.equal(decide(d,{games:[cur,kick],at:1002,current:{kind:'game',id:'A'}}).id,'B','a field-goal try you have a kicker in');
 // Already on a critical drive: another critical drive with a lower score waits out the dwell and then still needs the margin.
 const mineRZ=game('A','IND','KC',{yardsToGoal:10}),theirsRZ=game('B','DAL','NYG',{yardsToGoal:18});
 assert.equal(decide(d,{games:[mineRZ,theirsRZ],at:1002,current:{kind:'game',id:'A'}}).id,'A');
 assert.equal(decide(d,{games:[mineRZ,theirsRZ],at:1100,current:{kind:'game',id:'A'}}).id,'A');
});
test('decide: a same-tier challenger needs RULES.margin more score to take over a healthy drive',()=>{
 const d=new Director({debounce:0}),roster=[RB,WR];   // one starter per side, so score is exactly 100 - yardsToGoal
 const cur=game('A','IND','KC',{yardsToGoal:50});
 const almost=game('B','DAL','NYG',{yardsToGoal:50-(RULES.margin-1)});
 assert.equal(decide(d,{games:[cur,almost],roster,current:{kind:'game',id:'A'}}).id,'A','one yard short of the margin');
 const enough=game('B','DAL','NYG',{yardsToGoal:50-RULES.margin});
 assert.equal(decide(d,{games:[cur,enough],roster,current:{kind:'game',id:'A'}}).id,'B','exactly the margin');
 const worse=game('B','DAL','NYG',{yardsToGoal:60});
 assert.equal(decide(d,{games:[cur,worse],roster,current:{kind:'game',id:'A'}}).id,'A');
 // Stacked starters count a little: two DAL starters at the same spot add 2 and clear the margin.
 assert.equal(decide(d,{games:[cur,almost],roster:[RB,WR,QB],current:{kind:'game',id:'A'}}).id,'B');
 // An imminent play (kick try / 4th-down go) only needs to score higher to pull you off a non-critical drive.
 const gamble=game('B','DAL','NYG',{down:4,distance:1,yardsToGoal:49});   // 100-49+4 = 55 > 50
 assert.equal(decide(d,{games:[cur,gamble],roster,current:{kind:'game',id:'A'}}).id,'B');
});
test('decide: leaving a live game waits RULES.debounce seconds of the same challenger',()=>{
 const d=new Director();
 const cur=game('A','IND','KC',{yardsToGoal:50}),b=game('B','DAL','NYG',{yardsToGoal:30});
 const at=t=>decide(d,{games:[cur,b],at:t,current:{kind:'game',id:'A'}});
 assert.equal(at(1000).id,'A','first sighting of the challenger');
 assert.equal(at(1000).reason,'Taylor · driving, 50 yards out');
 assert.equal(at(1000+RULES.debounce-.1).id,'A');
 const cut=at(1000+RULES.debounce);
 assert.equal(cut.id,'B');assert.equal(cut.reason,'Lamb & Prescott · driving, 30 yards out');
});
test('decide: the debounce restarts when the challenger changes or blinks out',()=>{
 const d=new Director();
 const cur=game('A','IND','KC',{yardsToGoal:50});
 const b=game('B','DAL','NYG',{yardsToGoal:30}),c=game('C','SEA','PIT',{possession:0,yardsToGoal:20});   // c: your D/ST, tier 1, never beats an offense
 const bFar=game('B','DAL','NYG',{yardsToGoal:45});                                                  // 55: under the margin
 const bRZ=game('B','DAL','NYG',{yardsToGoal:10});
 const run=(games,at)=>decide(d,{games,at,current:{kind:'game',id:'A'}}).id;
 assert.equal(run([cur,b,c],1000),'A');
 assert.equal(run([cur,bFar,c],1001),'A','feed jitter: B briefly reads as not worth the cut');
 assert.equal(run([cur,b,c],1002),'A','the clock restarts');
 assert.equal(run([cur,b,c],1003),'A');
 assert.equal(run([cur,b,c],1002+RULES.debounce),'B');
 d.reset();
 assert.equal(run([cur,b],1000),'A');
 assert.equal(run([cur,bRZ],1001),'A','same game, now in the red zone: still the same challenger');
 assert.equal(run([cur,bRZ],1000+RULES.debounce),'B');
});
test('decide: leaving a break, a final, or an excluded game does not wait for the debounce or the dwell',()=>{
 const d=new Director();
 d.committed(1000);
 const b=game('B','DAL','NYG',{yardsToGoal:30});
 const brk=game('A','IND','KC',{phase:'break',possession:-1});
 assert.equal(decide(d,{games:[brk,b],at:1001,current:{kind:'game',id:'A'}}).id,'B');
 const fin=game('A','IND','KC',{state:'post',phase:'final',possession:-1});
 assert.equal(decide(d,{games:[fin,b],at:1001,current:{kind:'game',id:'A'}}).id,'B');
 const live=game('A','IND','KC',{yardsToGoal:50});
 assert.equal(decide(d,{games:[live,b],at:1001,current:{kind:'game',id:'A'},excluded:new Set(['A'])}).id,'B','the picture went away: cut now');
 assert.equal(decide(d,{games:[live,b],at:1001,current:{kind:'game',id:'A'}}).id,'A','...whereas a healthy live drive dwells');
});

// ---------- Director.decide(): celebrations and replays ----------
test('decide: after one of your players scores, the channel stays for the celebration unless the game goes to a break',()=>{
 const d=new Director({debounce:0});
 const mine=game('A','IND','KC',{possession:1,yardsToGoal:65});   // Chiefs now have the ball after Taylor's TD
 const urgent=game('B','DAL','NYG',{yardsToGoal:5});
 const scored=(g,at)=>g.id==='A'&&at<1000+RULES.scoreHold;
 const held=decide(d,{games:[mine,urgent],at:1005,current:{kind:'game',id:'A'},recentScore:scored});
 assert.deepEqual([held.kind,held.id,held.reason],['game','A','Your player just scored']);
 assert.equal(decide(d,{games:[mine,urgent],at:1005,current:{kind:'game',id:'A'},recentScore:scored,queue:[{id:'s1',queuedAt:0}]}).kind,'game','no replay during the celebration');
 assert.equal(decide(d,{games:[mine,urgent],at:1000+RULES.scoreHold,current:{kind:'game',id:'A'},recentScore:scored}).id,'B','the hold ends');
 assert.equal(decide(d,{games:[{...mine,phase:'break',possession:-1},urgent],at:1005,current:{kind:'game',id:'A'},recentScore:scored}).id,'B','a break after the score releases the hold');
 assert.equal(decide(d,{games:[mine,urgent],at:1005,current:{kind:'game',id:'B'},recentScore:scored}).id,'B','the hold only applies to the game on screen');
});
test('decide: a missed score waits for a quiet moment: never while any option is critical',()=>{
 const d=new Director({debounce:0});
 const queue=[{id:'s1',gameId:'A',queuedAt:900}];
 const mine=game('A','IND','KC',{yardsToGoal:50});
 const fresh=[{id:'s1',gameId:'A',queuedAt:995}];
 // Watching a drive of yours with a fresh miss: keep watching.
 assert.equal(decide(d,{games:[mine],current:{kind:'game',id:'A'},queue:fresh}).kind,'game');
 // The same miss, overdue by highlightWait: replay it.
 const late=decide(d,{games:[mine],at:995+RULES.highlightWait,current:{kind:'game',id:'A'},queue:fresh});
 assert.deepEqual(late,{kind:'highlight',id:'s1',reason:'Replaying a score you missed'});
 assert.equal(decide(d,{games:[mine],at:995+RULES.highlightWait-1,current:{kind:'game',id:'A'},queue:fresh}).kind,'game');
 // A critical option anywhere blocks the replay, however overdue.
 const redZone=game('B','DAL','NYG',{yardsToGoal:8});
 const out=decide(d,{games:[mine,redZone],at:2000,current:{kind:'game',id:'A'},queue});
 assert.equal(out.kind,'game');assert.equal(out.id,'B');
 const kick=game('B','DAL','NYG',{down:4,distance:9,yardsToGoal:30});
 assert.equal(decide(d,{games:[mine,kick],at:2000,current:{kind:'game',id:'A'},queue}).kind,'game');
 const mineRZ=game('A','IND','KC',{yardsToGoal:12});
 assert.equal(decide(d,{games:[mineRZ],at:2000,current:{kind:'game',id:'A'},queue}).id,'A','your own red-zone drive is never interrupted');
 // Replays take the first item in the queue.
 assert.equal(decide(d,{games:[mine],at:2000,current:{kind:'game',id:'A'},queue:[{id:'first',queuedAt:900},{id:'second',queuedAt:800}]}).id,'first');
});
test('decide: a missed score replays at once when nobody of yours is on the field',()=>{
 const d=new Director();
 const fresh=[{id:'s1',queuedAt:1000}];
 const idle=game('A','IND','KC',{possession:1});
 assert.equal(decide(d,{games:[idle],current:{kind:'game',id:'A'},queue:fresh}).kind,'highlight','your RB is on the bench');
 assert.equal(decide(d,{games:[{...idle,phase:'break',possession:-1}],current:{kind:'game',id:'A'},queue:fresh}).kind,'highlight','a break');
 assert.equal(decide(d,{games:[idle],current:{},queue:fresh}).kind,'highlight','nothing on screen yet');
 assert.equal(decide(d,{games:[],current:{},queue:fresh}).kind,'highlight','no games at all');
 assert.equal(decide(d,{games:[idle],current:{kind:'game',id:'A'},queue:[]}).kind,'game','an empty queue stays on the game');
});
test('decide: a running replay is only pre-empted by a critical situation whose snap is imminent',()=>{
 const d=new Director();
 const current={kind:'highlight',id:'s1'};
 const stay={kind:'highlight',id:'s1',reason:'Replaying a score you missed'};
 const calm=game('A','IND','KC',{yardsToGoal:50,nextSnapIn:3});
 assert.deepEqual(decide(d,{games:[calm],current}),stay,'a non-critical drive about to snap');
 assert.deepEqual(decide(d,{games:[{...calm,phase:'play'}],current}),stay,'even mid-play');
 const redZone=nextSnapIn=>game('B','DAL','NYG',{yardsToGoal:9,nextSnapIn});
 assert.deepEqual(decide(d,{games:[calm,redZone(25)],current}),stay,'red zone, but the snap is 25s away');
 assert.deepEqual(decide(d,{games:[calm,redZone(10)],current}),stay,'10s is not yet imminent');
 const back=decide(d,{games:[calm,redZone(9)],current});
 assert.deepEqual([back.kind,back.id,back.reason],['game','B','Back to live action']);
 assert.equal(decide(d,{games:[calm,redZone(null)],current}).id,'B','a live feed cannot say when the snap is: assume now');
 assert.equal(decide(d,{games:[calm,{...redZone(25),phase:'play'}],current}).id,'B','the snap already happened');
 assert.equal(decide(d,{games:[calm,game('B','DAL','NYG',{down:4,distance:5,yardsToGoal:33,nextSnapIn:2})],current}).id,'B','a kick try');
 assert.deepEqual(decide(d,{games:[calm,redZone(2)],current,excluded:new Set(['B'])}),stay,'an excluded game cannot pull the replay');
 assert.deepEqual(decide(d,{games:[calm,game('X','SF','SEA',{yardsToGoal:2,phase:'play'})],current}),stay,'nor can a game without your teams');
});
test('decide: honors the excluded set when choosing where to go',()=>{
 const d=new Director({debounce:0});
 const a=game('A','IND','KC',{yardsToGoal:50}),b=game('B','DAL','NYG',{yardsToGoal:20}),c=game('C','SEA','PIT',{possession:0,yardsToGoal:40});
 assert.equal(decide(d,{games:[a,b,c]}).id,'B');
 assert.equal(decide(d,{games:[a,b,c],excluded:new Set(['B'])}).id,'A');
 assert.equal(decide(d,{games:[a,b,c],excluded:new Set(['A','B'])}).id,'C');
 assert.equal(decide(d,{games:[a,b,c],excluded:new Set(['A','B','C'])}).kind,'standby');
 assert.equal(decide(d,{games:[a,b,c],current:{kind:'game',id:'B'},excluded:new Set(['B'])}).id,'A','leaves the current game once it is excluded');
});
test('decide: includeDefense=false never chooses a game for your D/ST alone',()=>{
 const d=new Director();
 const def=game('D','SEA','PIT',{possession:0,yardsToGoal:5}),idle=game('I','IND','KC',{possession:1});
 assert.equal(decide(d,{games:[def]}).id,'D');
 assert.equal(decide(d,{games:[def]}).entry.tier,1);
 const off=decide(d,{games:[def],includeDefense:false});
 assert.equal(off.kind,'game');assert.equal(off.id,'D');
 assert.equal(off.reason,'Your players are off the field','still a roster team, so it is only a fallback');
 assert.equal(off.entry.tier,0);
 assert.equal(decide(d,{games:[def,idle],includeDefense:false}).id,'D','fallback picks by id among non-break roster games');
 assert.equal(decide(d,{games:[def,idle],includeDefense:false,current:{kind:'game',id:'I'}}).id,'I','and stays put when already on one');
 assert.equal(decide(d,{games:[def,idle],includeDefense:false,queue:[{id:'s1',queuedAt:1000}]}).kind,'highlight');
});
