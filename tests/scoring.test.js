import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alias,normalName,HIGHLIGHT_ROLES,parseScoringPlay,rosterCredit,worthReplaying,describeScore} from '../web/scoring.js';
import {SAMPLE} from '../web/roster.js';

const week7=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
const allScores=week7.games.flatMap(g=>g.scores.map(s=>({game:g,score:s})));

// Helpers: a score object the way the archive/live feeds hand it to rosterCredit.
const game=(away,home)=>({teams:[{id:'1',abbreviation:away,name:away},{id:'2',abbreviation:home,name:home}]});
const score=(text,team,extra={})=>({...parseScoringPlay(text,extra.typeText,extra.scoringType),team,text,away:extra.away??0,home:extra.home??0});
const roles=credits=>credits.map(c=>`${c.player.name}:${c.role}`);
const players=parsed=>parsed.players.map(p=>`${p.role}:${p.name}`);

// --- alias / normalName -----------------------------------------------------

test('alias maps ESPN team variants to the roster spellings and passes others through',()=>{
 assert.equal(alias('WSH'),'WAS');assert.equal(alias('JAX'),'JAC');assert.equal(alias('LA'),'LAR');
 for(const t of ['WAS','JAC','LAR','TB','KC','NE'])assert.equal(alias(t),t);
 assert.equal(alias(''),'');
});

test('normalName strips generational suffixes and punctuation so roster and feed spellings agree',()=>{
 assert.equal(normalName('Kyle Pitts Sr.'),'kyle pitts');
 assert.equal(normalName('Kyle Pitts'),'kyle pitts');
 assert.equal(normalName('Marvin Harrison Jr.'),'marvin harrison');
 assert.equal(normalName('Luther Burden III'),'luther burden');
 assert.equal(normalName('Ollie Gordon II'),'ollie gordon');
 assert.equal(normalName('Kenneth Walker IV'),'kenneth walker');
 assert.equal(normalName('John Doe V'),'john doe');
 assert.equal(normalName('T.J. Hockenson'),'tj hockenson');
 assert.equal(normalName('TJ Hockenson'),'tj hockenson');
 assert.equal(normalName('C.J. Stroud'),'cj stroud');
 assert.equal(normalName('Amon-Ra St. Brown'),'amon ra st brown');
});

test('normalName folds case, accents, hyphens, apostrophes and whitespace; non-strings become empty',()=>{
 assert.equal(normalName("Ja'Marr Chase"),'jamarr chase');
 assert.equal(normalName('Ja’Marr Chase'),'jamarr chase');      // curly apostrophe
 assert.equal(normalName("Ka'imi Fairbairn"),'kaimi fairbairn');
 assert.equal(normalName("D'Andre Swift"),'dandre swift');
 assert.equal(normalName('Jaxon Smith-Njigba'),'jaxon smith njigba');
 assert.equal(normalName('Eddy Piñeiro'),'eddy pineiro');
 assert.equal(normalName('José Ramírez'),'jose ramirez');
 assert.equal(normalName('  Drake   Maye '),'drake maye');
 assert.equal(normalName('DRAKE MAYE'),'drake maye');
 assert.equal(normalName(null),'');assert.equal(normalName(undefined),'');assert.equal(normalName(''),'');assert.equal(normalName(42),'');
});

// --- parseScoringPlay: every form in the Week 7 archive ----------------------

test('parseScoringPlay: passing touchdown with a good PAT credits scorer, passer and PAT kicker',()=>{
 const p=parseScoringPlay('CeeDee Lamb 9 Yd pass from Dak Prescott (Brandon Aubrey Kick)','Passing Touchdown','touchdown');
 assert.equal(p.kind,'TD');assert.equal(p.defensive,false);
 assert.deepEqual(players(p),['scorer:CeeDee Lamb','passer:Dak Prescott','pat:Brandon Aubrey']);
 // Suffixes and initials survive parsing untouched; normalisation is rosterCredit's job.
 const q=parseScoringPlay('Marvin Harrison Jr. 6 Yd pass from C.J. Stroud (Ka\'imi Fairbairn Kick)');
 assert.deepEqual(players(q),['scorer:Marvin Harrison Jr.','passer:C.J. Stroud',"pat:Ka'imi Fairbairn"]);
});

test('parseScoringPlay: rushing touchdowns ("Rush" and "Run") credit the runner and the PAT kicker',()=>{
 const rush=parseScoringPlay("D'Andre Swift 4 Yd Rush (Cairo Santos Kick)",'Rushing Touchdown','touchdown');
 assert.equal(rush.kind,'TD');assert.equal(rush.defensive,false);
 assert.deepEqual(players(rush),["scorer:D'Andre Swift",'pat:Cairo Santos']);
 const run=parseScoringPlay('Ollie Gordon II 1 Yd Run (Zane Gonzalez Kick)','Rushing Touchdown','touchdown');
 assert.deepEqual(players(run),['scorer:Ollie Gordon II','pat:Zane Gonzalez']);
 // A touchdown with no conversion note (end of game) still credits the scorer.
 const bare=parseScoringPlay('Devin Singletary 30 Yd Rush');
 assert.deepEqual(players(bare),['scorer:Devin Singletary']);
 // A QB scrambling in is a scorer, not a passer.
 assert.deepEqual(players(parseScoringPlay('Bo Nix 62 Yd Rush (Wil Lutz Kick)')),['scorer:Bo Nix','pat:Wil Lutz']);
});

test('parseScoringPlay: field goals credit only the kicker, from the text or from the ESPN scoringType',()=>{
 const fg=parseScoringPlay('Cairo Santos 43 Yd Field Goal','Field Goal Good','field-goal');
 assert.equal(fg.kind,'FG');assert.equal(fg.defensive,false);
 assert.deepEqual(players(fg),['kicker:Cairo Santos']);
 // Text alone is enough; no scoringType needed.
 assert.deepEqual(players(parseScoringPlay("Ka'imi Fairbairn 58 Yd Field Goal")),["kicker:Ka'imi Fairbairn"]);
 assert.equal(parseScoringPlay("Ka'imi Fairbairn 58 Yd Field Goal").kind,'FG');
 // scoringType alone also fixes the kind.
 assert.equal(parseScoringPlay('Cairo Santos 43 Yd FG','Field Goal Good','field-goal').kind,'FG');
});

test('parseScoringPlay: fumble and interception return touchdowns are defensive and credit the returner',()=>{
 const fum=parseScoringPlay('Calijah Kancey 32 Yd Fumble Return (Chase McLaughlin Kick)','Sack Opp Fumble Recovery','touchdown');
 assert.equal(fum.kind,'TD');assert.equal(fum.defensive,true);
 assert.deepEqual(players(fum),['scorer:Calijah Kancey','pat:Chase McLaughlin']);
 const int=parseScoringPlay('Xavier McKinney 34 Yd Interception Return (Brandon McManus Kick)','Interception Return Touchdown','touchdown');
 assert.equal(int.kind,'TD');assert.equal(int.defensive,true);
 assert.deepEqual(players(int),['scorer:Xavier McKinney','pat:Brandon McManus']);
 // Without any ESPN type hints the text still tells us it was a return.
 assert.equal(parseScoringPlay('Xavier McKinney 34 Yd Interception Return (Brandon McManus Kick)').defensive,true);
 // An ordinary offensive touchdown is never defensive, whatever the hints say about the kick.
 assert.equal(parseScoringPlay('Jonathan Taylor 38 Yd Rush (Spencer Shrader Kick)','Rushing Touchdown','touchdown').defensive,false);
});

test('parseScoringPlay: punt and kickoff return touchdowns count as defensive (special teams) and credit the returner',()=>{
 const punt=parseScoringPlay('Tez Johnson 70 Yd Punt Return (Chase McLaughlin Kick)','Punt Return Touchdown','touchdown');
 assert.equal(punt.kind,'TD');assert.equal(punt.defensive,true);
 assert.deepEqual(players(punt),['scorer:Tez Johnson','pat:Chase McLaughlin']);
 const ko=parseScoringPlay('KaVontae Turpin 98 Yd Kickoff Return (Brandon Aubrey Kick)','Kickoff Return Touchdown','touchdown');
 assert.equal(ko.defensive,true);
 assert.deepEqual(players(ko),['scorer:KaVontae Turpin','pat:Brandon Aubrey']);
});

test('parseScoringPlay: an ESPN turnover play type marks a touchdown defensive even when the text has no "Return"',()=>{
 const text='Devon Witherspoon 3 Yd Rush (Jason Myers Kick)';
 assert.equal(parseScoringPlay(text,'Rushing Touchdown','touchdown').defensive,false);
 assert.equal(parseScoringPlay(text,'Fumble Recovery (Opponent)','touchdown').defensive,true);
 assert.equal(parseScoringPlay(text,'Pass Interception Return','touchdown').defensive,true);
 assert.equal(parseScoringPlay(text,'Blocked Punt Touchdown','touchdown').defensive,true);
 // ...but only for touchdowns: a field goal after a turnover is still an offensive kick.
 const fg=parseScoringPlay('Will Reichard 28 Yd Field Goal','Fumble Recovery (Opponent)','field-goal');
 assert.equal(fg.kind,'FG');assert.equal(fg.defensive,false);
});

test('parseScoringPlay: failed and blocked PATs credit nobody for the extra point',()=>{
 const failed=parseScoringPlay('Nick Muse 1 Yd pass from Michael Penix Jr. (Nick Folk PAT Failed)','Passing Touchdown','touchdown');
 assert.deepEqual(players(failed),['scorer:Nick Muse','passer:Michael Penix Jr.']);
 const blocked=parseScoringPlay('Darren Waller 50 Yd pass from Bryce Young (Ryan Fitzgerald PAT blocked)','Passing Touchdown','touchdown');
 assert.deepEqual(players(blocked),['scorer:Darren Waller','passer:Bryce Young']);
 assert.equal(blocked.defensive,false,'a blocked PAT does not make the touchdown itself defensive');
 // Case-insensitive: ESPN mixes "Failed"/"failed" and "Blocked"/"blocked".
 assert.deepEqual(players(parseScoringPlay('Kyle Juszczyk 1 Yd pass from Brock Purdy (Eddy Pineiro PAT failed)')),['scorer:Kyle Juszczyk','passer:Brock Purdy']);
 assert.deepEqual(players(parseScoringPlay('Kyle Juszczyk 1 Yd pass from Brock Purdy (Eddy Pineiro Kick Blocked)')),['scorer:Kyle Juszczyk','passer:Brock Purdy']);
 // "PAT" is accepted as a synonym of "Kick" when it is good.
 assert.deepEqual(players(parseScoringPlay('Kyle Juszczyk 1 Yd pass from Brock Purdy (Eddy Pineiro PAT)')),['scorer:Kyle Juszczyk','passer:Brock Purdy','pat:Eddy Pineiro']);
});

test('parseScoringPlay: a two-point pass credits passer and receiver, a two-point run credits the runner',()=>{
 const pass=parseScoringPlay('Marvin Harrison Jr. 6 Yd pass from C.J. Stroud (C.J. Stroud Pass to Cade Stover for Two-Point Conversion)','Passing Touchdown','touchdown');
 assert.deepEqual(players(pass),['scorer:Marvin Harrison Jr.','passer:C.J. Stroud','two-point:C.J. Stroud','two-point:Cade Stover']);
 const run=parseScoringPlay('CeeDee Lamb 16 Yd pass from Dak Prescott (Dak Prescott Run for Two-Point Conversion)','Passing Touchdown','touchdown');
 assert.deepEqual(players(run),['scorer:CeeDee Lamb','passer:Dak Prescott','two-point:Dak Prescott']);
 assert.deepEqual(players(parseScoringPlay('Bucky Irving 4 Yd Rush (Bucky Irving Rush for Two-Point Conversion)')),['scorer:Bucky Irving','two-point:Bucky Irving']);
 // Neither form is a PAT, so nobody earns pat credit.
 assert.ok(!pass.players.some(p=>p.role==='pat'));assert.ok(!run.players.some(p=>p.role==='pat'));
});

test('parseScoringPlay: failed two-point tries credit nobody and never produce a "Two" or "Team" player',()=>{
 const passFail=parseScoringPlay('Tre Tucker 37 Yd pass from Kirk Cousins (Two-Point Pass Conversion Failed)','Passing Touchdown','touchdown');
 assert.deepEqual(players(passFail),['scorer:Tre Tucker','passer:Kirk Cousins']);
 const runFail=parseScoringPlay('Ashton Jeanty 15 Yd Rush (Two-Point Run Conversion Failed)','Rushing Touchdown','touchdown');
 assert.deepEqual(players(runFail),['scorer:Ashton Jeanty']);
 for(const p of [...passFail.players,...runFail.players])assert.doesNotMatch(p.name,/^(two|team)\b/i);
 assert.equal(passFail.kind,'TD');assert.equal(passFail.defensive,false,'a failed two-point try must not read as a defensive score');
});

test('parseScoringPlay: a defensive two-point conversion is kind D2P, defensive, and credits the defender',()=>{
 for(const scoringType of ['two-point-conversion','defensive-two-point','Two Point']){
  const p=parseScoringPlay('Bobby Okereke Defensive PAT Conversion','Defensive 2pt Conversion',scoringType);
  assert.equal(p.kind,'D2P');assert.equal(p.defensive,true);
  assert.deepEqual(players(p),['scorer:Bobby Okereke']);
 }
 // Even with no scoringType the text alone marks it defensive (no kicker, no passer).
 const p=parseScoringPlay('Bobby Okereke Defensive PAT Conversion');
 assert.equal(p.defensive,true);assert.deepEqual(players(p),['scorer:Bobby Okereke']);
});

test('parseScoringPlay: a safety is kind SAF and defensive, with no phantom "Team" player',()=>{
 for(const text of ['Safety','Team Safety','Joe Burrow Sacked in End Zone for a Safety']){
  const p=parseScoringPlay(text,'Safety','safety');
  assert.equal(p.kind,'SAF',text);assert.equal(p.defensive,true,text);
  assert.ok(!p.players.some(x=>/^team\b/i.test(x.name)),text);
 }
 assert.equal(parseScoringPlay('Safety').kind,'SAF','text alone identifies a safety');
 assert.equal(parseScoringPlay('Safety').defensive,true);
});

test('parseScoringPlay: empty or unrecognised text yields no players and never throws',()=>{
 for(const v of ['',null,undefined,'   ','Penalty on NE','Two-minute warning']){
  const p=parseScoringPlay(v);
  assert.deepEqual(p.players,[]);assert.equal(p.kind,'TD');assert.equal(p.defensive,false);
 }
 assert.deepEqual(parseScoringPlay('   Cairo Santos 43 Yd Field Goal  ').players,[{name:'Cairo Santos',role:'kicker'}],'surrounding whitespace is ignored');
});

test('parseScoringPlay: a blocked field goal returned for a touchdown is a TD, not a field goal',()=>{
 const p=parseScoringPlay('Marcus Jones 33 Yd Blocked Field Goal Return (Nick Folk Kick)','Blocked Field Goal Touchdown','touchdown');
 assert.equal(p.kind,'TD');assert.equal(p.defensive,true);
 assert.deepEqual(players(p),['scorer:Marcus Jones','pat:Nick Folk']);
});

// --- rosterCredit ------------------------------------------------------------

test('rosterCredit: offensive starters are credited by role, and only when they play for the scoring team',()=>{
 const g=game('CIN','BAL');
 const s=score('Mike Gesicki 6 Yd pass from Joe Burrow (Evan McPherson Kick)',0);
 const roster=[
  {name:'Joe Burrow',team:'CIN',position:'QB'},{name:'Mike Gesicki',team:'CIN',position:'TE'},
  {name:'Evan McPherson',team:'CIN',position:'K'},{name:'Zay Flowers',team:'BAL',position:'WR'},
  {name:'Joe Burrow',team:'BAL',position:'QB'},             // wrong team: not credited
  {name:'Ravens D/ST',team:'BAL',position:'D/ST'},{name:'Bengals D/ST',team:'CIN',position:'D/ST'}];
 assert.deepEqual(roles(rosterCredit(s,g,roster)),['Joe Burrow:passer','Mike Gesicki:scorer','Evan McPherson:pat']);
 // Same text, but credited to the home side: nobody from CIN gets anything, only the BAL namesake.
 const flipped=rosterCredit({...s,team:1},g,roster);
 assert.deepEqual(roles(flipped),['Joe Burrow:passer']);assert.equal(flipped[0].player.team,'BAL');
 assert.deepEqual(rosterCredit({...s,team:1},g,roster.filter(p=>p.team==='CIN')),[]);
});

test('rosterCredit: kickers earn kicker credit on field goals and pat credit on extra points',()=>{
 const g=game('IND','MIN'),roster=[{name:'Will Reichard',team:'MIN',position:'K'},{name:'Spencer Shrader',team:'IND',position:'K'}];
 assert.deepEqual(roles(rosterCredit(score('Will Reichard 28 Yd Field Goal',1,{scoringType:'field-goal'}),g,roster)),['Will Reichard:kicker']);
 assert.deepEqual(roles(rosterCredit(score('T.J. Hockenson 5 Yd pass from Kyler Murray (Will Reichard Kick)',1),g,roster)),['Will Reichard:pat']);
 assert.deepEqual(rosterCredit(score('T.J. Hockenson 5 Yd pass from Kyler Murray (Will Reichard PAT Failed)',1),g,roster),[]);
 // The other team's kicker never gets credit for this team's kick.
 assert.deepEqual(roles(rosterCredit(score('Spencer Shrader 43 Yd Field Goal',0),g,roster)),['Spencer Shrader:kicker']);
});

test('rosterCredit: D/ST earns defense credit on return touchdowns only, and only for the scoring side',()=>{
 const g=game('TB','CAR');
 const roster=[{name:'Buccaneers D/ST',team:'TB',position:'D/ST'},{name:'Panthers D/ST',team:'CAR',position:'D/ST'},{name:'Chase McLaughlin',team:'TB',position:'K'}];
 const fum=score('Calijah Kancey 32 Yd Fumble Return (Chase McLaughlin Kick)',0,{typeText:'Sack Opp Fumble Recovery',scoringType:'touchdown'});
 assert.deepEqual(roles(rosterCredit(fum,g,roster)),['Buccaneers D/ST:defense','Chase McLaughlin:pat']);
 // Offensive scores by the same team never credit its D/ST.
 assert.deepEqual(roles(rosterCredit(score('Bucky Irving 4 Yd Rush (Chase McLaughlin Kick)',0),g,roster)),['Chase McLaughlin:pat']);
 assert.deepEqual(roles(rosterCredit(score('Chase McLaughlin 22 Yd Field Goal',0),g,roster)),['Chase McLaughlin:kicker']);
 // The feed may flag `defensive` itself (scoring team != offense); D/ST honours that flag too.
 const flagged={...score('Tez Johnson 14 Yd pass from Baker Mayfield (Chase McLaughlin Kick)',0),defensive:true};
 assert.deepEqual(roles(rosterCredit(flagged,g,roster)),['Buccaneers D/ST:defense','Chase McLaughlin:pat']);
 // A D/ST is credited as a unit: individual defenders listed by name are not looked up.
 assert.deepEqual(roles(rosterCredit(fum,g,[{name:'Calijah Kancey',team:'CAR',position:'D/ST'}])),[]);
});

test('rosterCredit: D/ST earns defense credit for safeties and defensive two-point conversions',()=>{
 const g=game('CIN','BAL'),roster=[{name:'Ravens D/ST',team:'BAL',position:'D/ST'},{name:'Bengals D/ST',team:'CIN',position:'D/ST'},{name:'Joe Burrow',team:'CIN',position:'QB'}];
 const saf=score('Safety',1,{typeText:'Safety',scoringType:'safety'});
 assert.deepEqual(roles(rosterCredit(saf,g,roster)),['Ravens D/ST:defense']);
 const d2p=score('Kyle Hamilton Defensive PAT Conversion',1,{typeText:'Defensive 2pt Conversion',scoringType:'two-point-conversion'});
 assert.deepEqual(roles(rosterCredit(d2p,g,roster)),['Ravens D/ST:defense']);
 // Even when the feed only tagged the kind and lost the defensive flag.
 assert.deepEqual(roles(rosterCredit({...saf,defensive:false},g,roster)),['Ravens D/ST:defense']);
 assert.deepEqual(roles(rosterCredit({...d2p,defensive:false},g,roster)),['Ravens D/ST:defense']);
});

test('rosterCredit: a returner who is an offensive starter and his D/ST are both credited on a punt return touchdown',()=>{
 const g=game('TB','CAR'),roster=[{name:'Tez Johnson',team:'TB',position:'WR'},{name:'Buccaneers D/ST',team:'TB',position:'D/ST'},{name:'Panthers D/ST',team:'CAR',position:'D/ST'}];
 const s=score('Tez Johnson 70 Yd Punt Return (Chase McLaughlin Kick)',0,{typeText:'Punt Return Touchdown',scoringType:'touchdown'});
 assert.deepEqual(roles(rosterCredit(s,g,roster)),['Tez Johnson:scorer','Buccaneers D/ST:defense']);
 assert.equal(worthReplaying(rosterCredit(s,g,roster)),true);
});

test('rosterCredit: tolerates suffix, punctuation and middle-token name variants (Kyle Pitts Sr. vs Kyle Pitts)',()=>{
 const g=game('SF','ATL');
 const s=score('Kyle Pitts Sr. 5 Yd pass from Michael Penix Jr. (Nick Folk Kick)',1);
 const credit=p=>roles(rosterCredit(s,g,[p]));
 assert.deepEqual(credit({name:'Kyle Pitts',team:'ATL',position:'TE'}),['Kyle Pitts:scorer']);
 assert.deepEqual(credit({name:'Kyle Pitts Sr.',team:'ATL',position:'TE'}),['Kyle Pitts Sr.:scorer']);
 assert.deepEqual(credit({name:'kyle pitts sr',team:'ATL',position:'TE'}),['kyle pitts sr:scorer']);
 assert.deepEqual(credit({name:'Kyle J. Pitts',team:'ATL',position:'TE'}),['Kyle J. Pitts:scorer'],'a dropped middle token still matches');
 assert.deepEqual(credit({name:'Michael Penix',team:'ATL',position:'QB'}),['Michael Penix:passer']);
 assert.deepEqual(credit({name:'Michael Penix Jr.',team:'ATL',position:'QB'}),['Michael Penix Jr.:passer']);
 // The reverse direction: feed drops the suffix, roster keeps it.
 const plain=score('Kyle Pitts 5 Yd pass from Michael Penix (Nick Folk Kick)',1);
 assert.deepEqual(roles(rosterCredit(plain,g,[{name:'Kyle Pitts Sr.',team:'ATL',position:'TE'},{name:'Michael Penix Jr.',team:'ATL',position:'QB'}])),['Kyle Pitts Sr.:scorer','Michael Penix Jr.:passer']);
 // Initials, apostrophes and hyphens.
 assert.deepEqual(roles(rosterCredit(score('T.J. Hockenson 5 Yd pass from Kyler Murray (Will Reichard Kick)',1),game('IND','MIN'),[{name:'TJ Hockenson',team:'MIN',position:'TE'}])),['TJ Hockenson:scorer']);
 assert.deepEqual(roles(rosterCredit(score("Ja'Marr Chase 2 Yd pass from Joe Burrow (Evan McPherson Kick)",0),game('CIN','BAL'),[{name:'Ja’Marr Chase',team:'CIN',position:'WR'},{name:'JaMarr Chase',team:'CIN',position:'WR'}])),['Ja’Marr Chase:scorer','JaMarr Chase:scorer']);
 assert.deepEqual(roles(rosterCredit(score('Jaxon Smith-Njigba 28 Yd pass from Sam Darnold (Jason Myers Kick)',1),game('KC','SEA'),[{name:'Jaxon Smith Njigba',team:'SEA',position:'WR'}])),['Jaxon Smith Njigba:scorer']);
});

test('rosterCredit: never matches on surname alone or across different first names on the same team',()=>{
 const g=game('LAR','LV');
 const s=score('Kyren Williams 17 Yd Rush (Brandon McManus Kick)',0);
 const roster=[{name:'Williams',team:'LAR',position:'RB'},{name:'Kyren',team:'LAR',position:'RB'},{name:'Darius Williams',team:'LAR',position:'RB'},{name:'Kyren Williamson',team:'LAR',position:'RB'},{name:'Kyren Williams',team:'LAR',position:'RB'}];
 assert.deepEqual(roles(rosterCredit(s,g,roster)),['Kyren Williams:scorer']);
});

test('rosterCredit: team aliases (WSH/WAS, JAX/JAC, LA/LAR) match in both directions; unknown team or empty roster yields nothing',()=>{
 const s=score('Terry McLaurin 20 Yd pass from Jayden Daniels (Matt Gay Kick)',0);
 for(const [feed,roster] of [['WSH','WAS'],['WAS','WSH'],['JAX','JAC'],['JAC','JAX'],['LA','LAR'],['LAR','LA']]){
  const credits=rosterCredit(s,game(feed,'DAL'),[{name:'Terry McLaurin',team:roster,position:'WR'},{name:'Commanders D/ST',team:roster,position:'D/ST'}]);
  assert.deepEqual(roles(credits),['Terry McLaurin:scorer'],`${feed} feed vs ${roster} roster`);
 }
 assert.deepEqual(rosterCredit({...s,team:-1},game('WAS','DAL'),[{name:'Terry McLaurin',team:'WAS',position:'WR'},{name:'Commanders D/ST',team:'WAS',position:'D/ST'}]),[]);
 assert.deepEqual(rosterCredit(s,game('WAS','DAL'),[]),[]);
});

test('rosterCredit: two-point conversions credit the receiver as two-point while the TD passer keeps passer credit',()=>{
 const g=game('NYG','HOU');
 const s=score('Marvin Harrison Jr. 6 Yd pass from C.J. Stroud (C.J. Stroud Pass to Cade Stover for Two-Point Conversion)',1);
 const roster=[{name:'Cade Stover',team:'HOU',position:'TE'},{name:'CJ Stroud',team:'HOU',position:'QB'},{name:'Marvin Harrison',team:'HOU',position:'WR'}];
 assert.deepEqual(roles(rosterCredit(s,g,roster)),['Cade Stover:two-point','CJ Stroud:passer','Marvin Harrison:scorer']);
 const run=score('CeeDee Lamb 16 Yd pass from Dak Prescott (Dak Prescott Run for Two-Point Conversion)',0);
 assert.deepEqual(roles(rosterCredit(run,game('DAL','PHI'),[{name:'Dak Prescott',team:'DAL',position:'QB'}])),['Dak Prescott:passer']);
 // Each roster entry is credited at most once, even if the feed repeats a name.
 const doubled=score('Anthony Tyus III 12 Yd Rush (Ryan Fitzgerald Kick) (Ryan Fitzgerald Kick)',1);
 assert.deepEqual(roles(rosterCredit(doubled,game('TB','CAR'),[{name:'Ryan Fitzgerald',team:'CAR',position:'K'}])),['Ryan Fitzgerald:pat']);
});

// --- worthReplaying ------------------------------------------------------------

test('worthReplaying: an extra point alone is not worth a replay; every highlight role and a two-point credit is',()=>{
 const p={name:'x',team:'TB',position:'K'};
 assert.equal(worthReplaying([]),false);
 assert.equal(worthReplaying([{player:p,role:'pat'}]),false);
 assert.equal(worthReplaying([{player:p,role:'pat'},{player:p,role:'pat'}]),false);
 for(const role of ['scorer','passer','kicker','defense','two-point'])assert.equal(worthReplaying([{player:p,role}]),true,role);
 assert.equal(worthReplaying([{player:p,role:'pat'},{player:p,role:'scorer'}]),true,'a PAT alongside a real score is still replayable');
 assert.deepEqual([...HIGHLIGHT_ROLES].sort(),['defense','kicker','passer','scorer']);
 assert.equal(HIGHLIGHT_ROLES.has('pat'),false);
});

// --- describeScore --------------------------------------------------------------

test('describeScore: labels the kind, names the scoring team, shows the line and drops the conversion note',()=>{
 const g=game('CIN','BAL');
 const td=describeScore(score('Mike Gesicki 6 Yd pass from Joe Burrow (Evan McPherson Kick)',0,{away:7,home:14}),g);
 assert.deepEqual(td,{label:'Touchdown',team:'CIN',line:'CIN 7 – BAL 14',text:'Mike Gesicki 6 Yd pass from Joe Burrow'});
 const fg=describeScore(score('Tyler Loop 34 Yd Field Goal',1,{away:7,home:17}),g);
 assert.deepEqual(fg,{label:'Field goal',team:'BAL',line:'CIN 7 – BAL 17',text:'Tyler Loop 34 Yd Field Goal'});
 assert.equal(describeScore(score('Safety',1,{scoringType:'safety'}),g).label,'Safety');
 assert.equal(describeScore(score('Kyle Hamilton Defensive PAT Conversion',1,{scoringType:'two-point-conversion'}),g).label,'Defensive 2-pt');
 assert.equal(describeScore({kind:'???',team:0,text:'x',away:0,home:0},g).label,'Score');
 // The two-point note is stripped like a PAT note; the headline is the play itself.
 assert.equal(describeScore(score('CeeDee Lamb 16 Yd pass from Dak Prescott (Dak Prescott Run for Two-Point Conversion)',0),game('DAL','PHI')).text,'CeeDee Lamb 16 Yd pass from Dak Prescott');
 assert.equal(describeScore(score('Devin Singletary 30 Yd Rush',0),game('NYG','HOU')).text,'Devin Singletary 30 Yd Rush');
 // An unknown scoring side degrades to an empty team rather than throwing.
 assert.equal(describeScore({kind:'TD',team:-1,text:'x',away:0,home:0},g).team,'');
});

test('describeScore: the headline never carries a conversion note, even when ESPN doubled it (TB at CAR, week 7)',()=>{
 for(const {game:g,score:s} of allScores){
  const d=describeScore(s,g);
  assert.doesNotMatch(d.text,/\(/,`${g.name}: ${s.text}`);
  assert.equal(d.text,s.text.replace(/\s*\(.*$/,''),`${g.name}: ${s.text}`);
 }
});

// --- the whole Week 7 archive ------------------------------------------------------

test('week7.json: every scoring play re-parses to at least one player and matches the archived credits',()=>{
 assert.equal(allScores.length,week7.coverage.scores);
 assert.ok(allScores.length>=100,'the archive carries a full slate of scoring plays');
 for(const {game:g,score:s} of allScores){
  const p=parseScoringPlay(s.text);
  assert.ok(p.players.length>=1,`${g.name}: "${s.text}" parsed to nobody`);
  assert.equal(p.kind,s.kind,`${g.name}: "${s.text}" kind`);
  assert.deepEqual(p.players,s.players,`${g.name}: "${s.text}" players`);
  for(const x of p.players){
   assert.ok(['scorer','passer','pat','kicker','two-point'].includes(x.role),`${g.name}: unknown role ${x.role}`);
   assert.doesNotMatch(x.name,/^(two|team)\b/i,`${g.name}: pseudo-player "${x.name}"`);
   assert.ok(normalName(x.name).length>0,`${g.name}: "${x.name}" normalises to nothing`);
  }
 }
});

test('week7.json: every touchdown has exactly one scorer, every field goal exactly one kicker, every "pass from" a passer',()=>{
 const count=(s,role)=>s.players.filter(p=>p.role===role).length;
 let defensive=0,twoPoint=0,noPat=0;
 for(const {game:g,score:s} of allScores){
  const label=`${g.name}: "${s.text}"`;
  if(s.kind==='FG'){
   assert.equal(count(s,'kicker'),1,label);assert.equal(s.players.length,1,label);assert.equal(s.defensive,false,label);
  }else{
   assert.equal(s.kind,'TD',label);
   assert.equal(count(s,'scorer'),1,label);assert.equal(count(s,'kicker'),0,label);
   assert.equal(count(s,'passer'),/pass from/i.test(s.text)?1:0,label);
   assert.equal(count(s,'pat'),/\((?:[^)]*)(?:Kick|PAT)\)/.test(s.text)?count(s,'pat'):0,label);
   if(/Failed|blocked/i.test(s.text))assert.equal(count(s,'pat'),0,label);
   if(s.defensive)defensive++;if(count(s,'two-point'))twoPoint++;if(!count(s,'pat'))noPat++;
  }
 }
 // The slate exercises every form the parser must handle.
 assert.equal(defensive,1,'one turnover-return touchdown (Calijah Kancey)');
 assert.equal(twoPoint,3,'two two-point passes and one two-point run');
 assert.ok(noPat>=5,'failed/blocked PATs, two-point tries and a bare TD leave no pat credit');
 const kancey=allScores.find(x=>/Kancey/.test(x.score.text));
 assert.equal(kancey.game.teams[kancey.score.team].abbreviation,'TB');assert.equal(kancey.score.defensive,true);
});

test('week7.json: the sample roster earns exactly the expected credits across the whole slate',()=>{
 const tally={};let replayable=0,total=0;
 for(const {game:g,score:s} of allScores){
  const credits=rosterCredit(s,g,SAMPLE);if(!credits.length)continue;
  total++;if(worthReplaying(credits))replayable++;
  for(const c of credits){const k=`${c.player.name}:${c.role}`;tally[k]=(tally[k]||0)+1;}
 }
 assert.deepEqual(tally,{
  'Joe Burrow:passer':4,'Jonathan Taylor:scorer':1,'Tony Pollard:scorer':3,'Zay Flowers:scorer':1,
  'Jameson Williams:scorer':2,'Puka Nacua:scorer':1,'Trey McBride:scorer':1,
  'Will Reichard:kicker':3,'Will Reichard:pat':1,'Buccaneers D/ST:defense':1});
 assert.equal(total,18);
 assert.equal(replayable,17,'only the lone Reichard extra point is not worth a replay');
 // Nobody on the sample roster is credited for the other side's scores.
 for(const {game:g,score:s} of allScores)for(const c of rosterCredit(s,g,SAMPLE))assert.equal(alias(g.teams[s.team].abbreviation),alias(c.player.team),`${g.name}: ${s.text}`);
});

test('an offensive fumble-recovery touchdown credits its scorer without crediting D/ST',()=>{
 const parsed=parseScoringPlay('Example Player 0 Yd Fumble Recovery (Example Kicker Kick)','Fumble Recovery (Own)','touchdown');
 assert.equal(parsed.defensive,false);assert.ok(parsed.players.some(p=>p.name==='Example Player'&&p.role==='scorer'));
 const game={teams:[{abbreviation:'IND'},{abbreviation:'MIN'}]};const credited=rosterCredit({...parsed,team:0},game,[{name:'Example Player',team:'IND',position:'RB'},{name:'Colts D/ST',team:'IND',position:'D/ST'}]);
 assert.deepEqual(credited.map(c=>c.role),['scorer']);
});
