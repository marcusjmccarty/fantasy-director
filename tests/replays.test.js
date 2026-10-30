// Missed-score replays: which official clip (or which slice of the recording)
// stands in for a score the viewer did not see, and who earned the points.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {officialClip,replayWindow,REPLAY_WINDOW} from '../web/replays.js';
import {alias,normalName,HIGHLIGHT_ROLES,parseScoringPlay,rosterCredit,worthReplaying,describeScore} from '../web/scoring.js';
import {ReplayArchive,PLAY_SECONDS} from '../web/archive.js';
import {Coverage} from '../web/coverage.js';

const week=JSON.parse(readFileSync(new URL('../web/week7.json',import.meta.url),'utf8'));
const catalog=JSON.parse(readFileSync(new URL('../web/nfl-highlights.json',import.meta.url),'utf8'));
const CLIPS=catalog.clips;
const archive=new ReplayArchive(week);
const DAL_PHI='401873009',GB_DET='401873020',CLE_TEN='401873013',KC_SEA='401873022',TB_CAR='401873018',DEN_ARI='401873019',NYG_HOU='401873016';
const game=id=>archive.game(id);
// A queue item the way Coverage builds one from an archived score.
function itemFor(gameId,prefix){
 const g=game(gameId),s=g.scores.find(x=>x.text.startsWith(prefix));
 assert.ok(s,`no score starting "${prefix}" in ${g.name}`);
 return {id:s.id,gameId:g.id,gameName:g.name,score:s,at:s.at};
}
const titleOf=clip=>clip?clip.title:null;
const JAVONTE_2YD='b8840cb7-ea15-4799-a507-1baac8f334a9';

// ---------- officialClip: real catalog, real scores ----------
test('Javonte Williams 2 Yd Rush (DAL at PHI) matches the "walks in a 2-yard TD" clip, not his 34- or 15-yard runs or his long reel',()=>{
 const clip=officialClip(itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush'),CLIPS);
 assert.ok(clip,'expected an official clip');
 assert.equal(clip.id,JAVONTE_2YD);
 assert.match(clip.title,/walks in a 2-yard TD/);
 assert.equal(clip.short,true);
 assert.equal(clip.gameId,DAL_PHI);
});

test('CeeDee Lamb 16 Yd TD matches the 16-yard clip, not the 9-7 back-shoulder clip or the 30-yard catch',()=>{
 const clip=officialClip(itemFor(DAL_PHI,'CeeDee Lamb 16 Yd'),CLIPS);
 assert.match(titleOf(clip),/16-yard TD dime/);
 assert.doesNotMatch(clip.title,/9-7|30-yard/);
});

test('CeeDee Lamb 9 Yd TD falls back to his only unquoted TD clip (the back-shoulder 9-7 lead), never the 16- or 30-yard clips',()=>{
 const clip=officialClip(itemFor(DAL_PHI,'CeeDee Lamb 9 Yd'),CLIPS);
 assert.match(titleOf(clip),/back-shoulder TD pass to CeeDee Lamb/);
 assert.doesNotMatch(clip.title,/16-yard|30-yard/);
});

test('Brandon Aubrey 55 Yd Field Goal matches the 55-yard FG clip through the kicker role and FG vocabulary',()=>{
 const clip=officialClip(itemFor(DAL_PHI,'Brandon Aubrey 55 Yd'),CLIPS);
 assert.match(titleOf(clip),/55-yard FG/);
 assert.deepEqual(clip.athletes,['Brandon Aubrey']);
});

test('a clip quoting a different distance is a different play: Aubrey 27 and 24 Yd field goals get no clip rather than the 55-yarder',()=>{
 assert.equal(officialClip(itemFor(DAL_PHI,'Brandon Aubrey 27 Yd'),CLIPS),null);
 assert.equal(officialClip(itemFor(DAL_PHI,'Brandon Aubrey 24 Yd'),CLIPS),null);
});

test('yardage is compared whole: Trey McBride 7 Yd TD is not matched to his 27-yard catch-and-run clip',()=>{
 assert.equal(officialClip(itemFor(DEN_ARI,'Trey McBride 7 Yd'),CLIPS),null);
});

test('long clips (short:false) never stand in for a play: Jameson Williams TDs have only a full-game reel',()=>{
 for(const prefix of ['Jameson Williams 16 Yd','Jameson Williams 10 Yd'])assert.equal(officialClip(itemFor(GB_DET,prefix),CLIPS),null,prefix);
 // The reel is rejected for its length alone: as a short clip it would have matched on name and TD vocabulary.
 const reel=CLIPS.find(c=>c.gameId===GB_DET&&c.athletes.includes('Jameson Williams'));
 assert.equal(reel.short,false);
 assert.equal(officialClip(itemFor(GB_DET,'Jameson Williams 16 Yd'),[{...reel,short:true}])?.id,reel.id);
 const {short,...unflagged}=reel;
 assert.equal(officialClip(itemFor(GB_DET,'Jameson Williams 16 Yd'),[unflagged])?.id,reel.id,'a clip without a short flag is not treated as long');
});

test('a name hit is required: same game, same yardage, same kind, other player is ignored',()=>{
 const g=game(DAL_PHI),parsed=parseScoringPlay('Rico Dowdle 2 Yd Rush (Brandon Aubrey Kick)');
 const score={...g.scores.find(s=>s.text.startsWith('Javonte Williams 2 Yd')),text:'Rico Dowdle 2 Yd Rush (Brandon Aubrey Kick)',players:parsed.players};
 assert.equal(officialClip({id:'x',gameId:DAL_PHI,score,at:score.at},CLIPS),null);
 // Renaming the real 2-yard clip so it no longer names Williams anywhere loses the match too.
 const anonymous=CLIPS.map(c=>c.id===JAVONTE_2YD?{...c,title:'Cowboys walk in a 2-yard TD vs. Eagles',athletes:[]}:c);
 assert.equal(officialClip(itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush'),anonymous),null);
});

test('a surname-only title counts when an athlete tag confirms the surname (Skattebo, Singletary), not from the title alone',()=>{
 assert.match(titleOf(officialClip(itemFor(NYG_HOU,'Cam Skattebo 16 Yd'),CLIPS)),/Skattebo's BEAST MODE-style TD run/);
 assert.match(titleOf(officialClip(itemFor(NYG_HOU,'Devin Singletary 30 Yd'),CLIPS)),/Singletary's 30-yard TD/);
 const item=itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush');
 const surnameOnly={id:'s',gameId:DAL_PHI,title:'Williams walks in a 2-yard TD vs. Eagles',athletes:[],short:true};
 assert.equal(officialClip(item,[surnameOnly]),null);
 assert.equal(officialClip(item,[{...surnameOnly,athletes:['Javonte Williams']}])?.id,'s');
});

test('clips are matched only within the scoring game, even when they name the scorer with the right yardage',()=>{
 const item=itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush');
 assert.equal(officialClip({...item,gameId:KC_SEA},CLIPS),null);
 const moved=CLIPS.map(c=>c.id===JAVONTE_2YD?{...c,gameId:KC_SEA}:c);
 assert.equal(officialClip(item,moved),null);
});

test('a yardage+kind match beats a kind-only or yardage-only match regardless of catalog order',()=>{
 const item=itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush');
 const kindOnly={id:'kind',gameId:DAL_PHI,title:'Javonte Williams punches in the go-ahead TD',athletes:['Javonte Williams'],short:true};
 const yardsOnly={id:'yards',gameId:DAL_PHI,title:'Javonte Williams 2-yard run up the middle',athletes:['Javonte Williams'],short:true};
 const both={id:'both',gameId:DAL_PHI,title:'Javonte Williams walks in a 2-yard TD',athletes:['Javonte Williams'],short:true};
 assert.equal(officialClip(item,[kindOnly,yardsOnly,both]).id,'both');
 assert.equal(officialClip(item,[both,yardsOnly,kindOnly]).id,'both');
 assert.equal(officialClip(item,[kindOnly]).id,'kind','kind alone is enough when nothing better exists');
 for(const prefix of ['Javonte Williams 2 Yd Rush','CeeDee Lamb 16 Yd','Brandon Aubrey 55 Yd'])
  assert.equal(officialClip(itemFor(DAL_PHI,prefix),[...CLIPS].reverse()).id,officialClip(itemFor(DAL_PHI,prefix),CLIPS).id,prefix);
});

test('a clip naming the scorer with neither the yardage nor any scoring vocabulary is not a match',()=>{
 const item=itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush');
 assert.equal(officialClip(item,[{id:'n',gameId:DAL_PHI,title:'Javonte Williams finishes a rush in brutal fashion',athletes:['Javonte Williams'],short:true}]),null);
 // Without the 2-yard clip, the Quinnen Williams sack/TFL clips share the surname but describe no score.
 assert.equal(officialClip(item,CLIPS.filter(c=>c.id!==JAVONTE_2YD)),null);
});

test('hyphens and suffixes normalize: Smith-Njigba 28 Yd and Marvin Harrison Jr. 6 Yd find their clips',()=>{
 assert.match(titleOf(officialClip(itemFor(KC_SEA,'Jaxon Smith-Njigba 28 Yd'),CLIPS)),/28-yard TD dime locates Smith-Njigba/);
 assert.match(titleOf(officialClip(itemFor(NYG_HOU,'Marvin Harrison Jr. 6 Yd'),CLIPS)),/Marvin Harrison Jr\.'s first TD as a Texan/);
});

test('the scorer, not a teammate in the tags, picks the clip: Bo Nix 62 Yd rush vs RJ Harvey 52 Yd pass from Bo Nix',()=>{
 assert.match(titleOf(officialClip(itemFor(DEN_ARI,'Bo Nix 62 Yd'),CLIPS)),/62-yard TD run! Bo Nix/);
 assert.match(titleOf(officialClip(itemFor(DEN_ARI,'RJ Harvey 52 Yd'),CLIPS)),/52-yard TD!.*RJ Harvey/);
});

test('a defensive touchdown (Kancey 32 Yd fumble return) resolves to his first-NFL-TD clip',()=>{
 assert.match(titleOf(officialClip(itemFor(TB_CAR,'Calijah Kancey 32 Yd'),CLIPS)),/Calijah Kancey's first NFL TD/);
});

test('a score whose only credited players are extra-point or passer roles has no lead and gets no clip',()=>{
 const base=itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush');
 const pat={...base,score:{...base.score,players:[{name:'Brandon Aubrey',role:'pat'}]}};
 assert.equal(officialClip(pat,CLIPS),null);
 const passer={...base,score:{...base.score,text:'CeeDee Lamb 16 Yd pass from Dak Prescott',players:[{name:'Dak Prescott',role:'passer'}]}};
 assert.equal(officialClip(passer,CLIPS),null);
 assert.equal(officialClip({...base,score:{...base.score,players:[]}},CLIPS),null);
});

test('George Pickens 21 Yd TD prefers the TD clip over the same-yardage non-scoring hurdle clip',
 ()=>{
  const clip=officialClip(itemFor(DAL_PHI,'George Pickens 21 Yd'),CLIPS);
  assert.match(titleOf(clip),/corner-pocket TD dime to toe-tapping Pickens/);
  assert.doesNotMatch(clip.title,/21-yard gain/);
 });

// ---------- replayWindow ----------
test('REPLAY_WINDOW brackets the snap with room for the whole play',()=>{
 assert.deepEqual(REPLAY_WINDOW,{before:12,after:14});
 assert.ok(REPLAY_WINDOW.before>0);
 assert.ok(REPLAY_WINDOW.after>PLAY_SECONDS,'the window must outlast snap-to-whistle');
});

test('replayWindow is measured in game seconds since kickoff from the item wall-clock',()=>{
 const g=game(DAL_PHI),item=itemFor(DAL_PHI,'Javonte Williams 2 Yd Rush');
 assert.equal(item.at-g.start,10400);
 assert.deepEqual(replayWindow(item,g),{from:10388,to:10414});
 assert.deepEqual(replayWindow({at:1500},{start:1000}),{from:488,to:514});
 const w=replayWindow({at:1500},{start:1000});
 assert.equal(w.to-w.from,REPLAY_WINDOW.before+REPLAY_WINDOW.after);
 assert.ok(w.from<500&&500<w.to,'the snap sits inside the window');
});

test('every real Week 7 score has a window inside its own game',()=>{
 let checked=0;
 for(const g of archive.games){
  const lastPlay=g.plays.at(-1)[0];
  for(const s of g.scores){
   const w=replayWindow({id:s.id,gameId:g.id,score:s,at:s.at},g),rel=s.at-g.start;
   assert.ok(w.from>=0,`${g.name} ${s.text}: starts before kickoff`);
   assert.ok(w.to<=lastPlay+60&&w.to<=g.end-g.start,`${g.name} ${s.text}: runs past the game`);
   assert.ok(w.from<rel&&rel<w.to);
   checked++;
  }
 }
 assert.equal(checked,week.coverage.scores);
});

// ---------- scoring.js ----------
test('parseScoringPlay credits scorer, passer and extra-point kicker on a passing touchdown',()=>{
 assert.deepEqual(parseScoringPlay('CeeDee Lamb 9 Yd pass from Dak Prescott (Brandon Aubrey Kick)'),
  {kind:'TD',defensive:false,players:[{name:'CeeDee Lamb',role:'scorer'},{name:'Dak Prescott',role:'passer'},{name:'Brandon Aubrey',role:'pat'}]});
 assert.deepEqual(parseScoringPlay('Javonte Williams 2 Yd Rush (Brandon Aubrey Kick)').players,[{name:'Javonte Williams',role:'scorer'},{name:'Brandon Aubrey',role:'pat'}]);
 assert.deepEqual(parseScoringPlay('Drake Maye 6 Yd Run (Andy Borregales Kick)').players[0],{name:'Drake Maye',role:'scorer'});
});

test('parseScoringPlay credits the kicker on a field goal and nobody else',()=>{
 assert.deepEqual(parseScoringPlay('Brandon Aubrey 55 Yd Field Goal'),{kind:'FG',defensive:false,players:[{name:'Brandon Aubrey',role:'kicker'}]});
 assert.equal(parseScoringPlay('Jake Bates 40 Yd Field Goal','Field Goal Good','field-goal').kind,'FG');
});

test('parseScoringPlay drops failed or blocked extra points and failed two-point tries',()=>{
 assert.deepEqual(parseScoringPlay('Darren Waller 50 Yd pass from Bryce Young (Ryan Fitzgerald PAT blocked)').players,[{name:'Darren Waller',role:'scorer'},{name:'Bryce Young',role:'passer'}]);
 assert.deepEqual(parseScoringPlay('Nick Muse 1 Yd pass from Michael Penix Jr. (Nick Folk PAT Failed)').players,[{name:'Nick Muse',role:'scorer'},{name:'Michael Penix Jr.',role:'passer'}]);
 assert.deepEqual(parseScoringPlay('Tre Tucker 37 Yd pass from Kirk Cousins (Two-Point Pass Conversion Failed)').players,[{name:'Tre Tucker',role:'scorer'},{name:'Kirk Cousins',role:'passer'}]);
});

test('parseScoringPlay credits two-point conversions to the runner, or to passer and receiver',()=>{
 assert.deepEqual(parseScoringPlay('CeeDee Lamb 16 Yd pass from Dak Prescott (Dak Prescott Run for Two-Point Conversion)').players,
  [{name:'CeeDee Lamb',role:'scorer'},{name:'Dak Prescott',role:'passer'},{name:'Dak Prescott',role:'two-point'}]);
 assert.deepEqual(parseScoringPlay('Marvin Harrison Jr. 6 Yd pass from C.J. Stroud (C.J. Stroud Pass to Cade Stover for Two-Point Conversion)').players,
  [{name:'Marvin Harrison Jr.',role:'scorer'},{name:'C.J. Stroud',role:'passer'},{name:'C.J. Stroud',role:'two-point'},{name:'Cade Stover',role:'two-point'}]);
});

test('parseScoringPlay flags returns, safeties and defensive conversions as defensive',()=>{
 const fumble=parseScoringPlay('Calijah Kancey 32 Yd Fumble Return (Chase McLaughlin Kick)');
 assert.equal(fumble.defensive,true);assert.deepEqual(fumble.players[0],{name:'Calijah Kancey',role:'scorer'});
 const pick=parseScoringPlay('Nohl Williams 64 Yd Interception Return (Harrison Butker Kick)','Interception Return Touchdown');
 assert.equal(pick.kind,'TD');assert.equal(pick.defensive,true);assert.equal(pick.players[0].name,'Nohl Williams');
 assert.equal(parseScoringPlay('Tyler Goodson 99 Yd Kickoff Return (Jake Elliott Kick)').defensive,true);
 assert.equal(parseScoringPlay('Mason Taylor 12 Yd pass from Geno Smith (Geno Smith Pass to Mason Taylor for Two-Point Conversion)').defensive,false);
 assert.deepEqual(parseScoringPlay('Safety','Safety','safety'),{kind:'SAF',defensive:true,players:[]});
 const d2p=parseScoringPlay('Zyon McCollum Defensive PAT Conversion','Defensive PAT Conversion','two-point-conversion');
 assert.equal(d2p.kind,'D2P');assert.equal(d2p.defensive,true);assert.deepEqual(d2p.players,[{name:'Zyon McCollum',role:'scorer'}]);
 assert.equal(parseScoringPlay('Team Safety','','safety').players.length,0,'a team is not a player');
});

test('every archived Week 7 score parses back to the players and kind it lists',()=>{
 let checked=0;
 for(const g of archive.games)for(const s of g.scores){
  const parsed=parseScoringPlay(s.text);
  assert.equal(parsed.kind,s.kind,`${g.name}: ${s.text}`);
  assert.deepEqual(parsed.players,s.players,`${g.name}: ${s.text}`);
  const row=g.plays[s.i];
  assert.equal(row[0],s.t,`${g.name}: score ${s.i} sits on a play at a different time`);
  assert.deepEqual([row[8],row[9]],[s.away,s.home],`${g.name}: ${s.text} scoreboard`);
  assert.ok(s.players.some(p=>p.role==='scorer'||p.role==='kicker'),`${g.name}: ${s.text} has no lead`);
  assert.match(s.text,/\d+ Yd/);
  assert.equal(s.id,`${g.id}:${s.i}`);assert.equal(s.at,g.start+s.t);
  checked++;
 }
 assert.equal(checked,week.coverage.scores);
 assert.equal(new Set(archive.games.flatMap(g=>g.scores.map(s=>s.id))).size,checked,'score ids are unique');
});

test('rosterCredit credits only the roster starters on the scoring team, by role',()=>{
 const g=game(DAL_PHI),score=g.scores.find(s=>s.text.startsWith('CeeDee Lamb 16 Yd'));
 const roster=[{name:'CeeDee Lamb',team:'DAL',position:'WR'},{name:'Dak Prescott',team:'DAL',position:'QB'},{name:'George Pickens',team:'DAL',position:'WR'},
  {name:'Cowboys D/ST',team:'DAL',position:'D/ST'},{name:'Eagles D/ST',team:'PHI',position:'D/ST'},{name:'Jalen Hurts',team:'PHI',position:'QB'}];
 assert.deepEqual(rosterCredit(score,g,roster).map(c=>[c.player.name,c.role]),[['CeeDee Lamb','scorer'],['Dak Prescott','passer']]);
 assert.deepEqual(rosterCredit(score,g,[{name:'Javonte Williams',team:'PHI',position:'RB'}]),[],'a same-named player on the other team is not credited');
 assert.deepEqual(rosterCredit(score,g,[]),[]);
});

test('D/ST earns credit on defensive scores by its own team only, never on offensive ones',()=>{
 const g=game(TB_CAR),fumble=g.scores.find(s=>s.text.startsWith('Calijah Kancey')),rush=g.scores.find(s=>s.text.startsWith('Bucky Irving 4 Yd'));
 const roster=[{name:'Buccaneers D/ST',team:'TB',position:'D/ST'},{name:'Panthers D/ST',team:'CAR',position:'D/ST'},{name:'Baker Mayfield',team:'TB',position:'QB'}];
 assert.deepEqual(rosterCredit(fumble,g,roster).map(c=>[c.player.name,c.role]),[['Buccaneers D/ST','defense']]);
 assert.deepEqual(rosterCredit(rush,g,roster),[]);
 const safety={team:1,kind:'SAF',defensive:true,text:'Safety',players:[]};
 assert.deepEqual(rosterCredit(safety,g,roster).map(c=>c.player.name),['Panthers D/ST']);
});

test('team aliases and name suffixes line up (WSH/WAS, Kyle Pitts vs Kyle Pitts Sr., Michael Penix vs Jr.)',()=>{
 const g={teams:[{abbreviation:'WSH'},{abbreviation:'ATL'}]};
 const roster=[{name:'Kyle Pitts',team:'ATL',position:'TE'},{name:'Michael Penix',team:'ATL',position:'QB'},{name:'Terry McLaurin',team:'WAS',position:'WR'},{name:'Ray McCloud',team:'ATL',position:'WR'}];
 const atl={team:1,kind:'TD',defensive:false,text:'Kyle Pitts Sr. 5 Yd pass from Michael Penix Jr. (Younghoe Koo Kick)',players:parseScoringPlay('Kyle Pitts Sr. 5 Yd pass from Michael Penix Jr. (Younghoe Koo Kick)').players};
 assert.deepEqual(rosterCredit(atl,g,roster).map(c=>[c.player.name,c.role]),[['Kyle Pitts','scorer'],['Michael Penix','passer']]);
 const was={team:0,kind:'TD',defensive:false,text:'Terry McLaurin 20 Yd pass from Jayden Daniels (Matt Gay Kick)',players:parseScoringPlay('Terry McLaurin 20 Yd pass from Jayden Daniels (Matt Gay Kick)').players};
 assert.deepEqual(rosterCredit(was,g,roster).map(c=>c.player.name),['Terry McLaurin']);
 const middle={team:1,kind:'TD',defensive:false,text:'Ray-Ray McCloud 30 Yd Rush',players:[{name:'Ray-Ray McCloud',role:'scorer'}]};
 assert.deepEqual(rosterCredit(middle,g,roster).map(c=>c.player.name),['Ray McCloud'],'a dropped middle token still matches');
 assert.deepEqual(['WSH','JAX','LA','DAL'].map(alias),['WAS','JAC','LAR','DAL']);
});

test('an extra point alone is never worth a replay; scorer, passer, kicker, defense and two-point credits are',()=>{
 assert.deepEqual(HIGHLIGHT_ROLES,new Set(['scorer','passer','kicker','defense']));
 assert.equal(worthReplaying([{role:'pat'}]),false);
 assert.equal(worthReplaying([]),false);
 for(const role of ['scorer','passer','kicker','defense','two-point'])assert.equal(worthReplaying([{role}]),true,role);
 assert.equal(worthReplaying([{role:'pat'},{role:'scorer'}]),true);
});

test('a missed Javonte Williams TD is queued by Coverage and resolves to the official 2-yard clip; one seen live is not queued',()=>{
 const g=game(DAL_PHI),s=g.scores.find(x=>x.text.startsWith('Javonte Williams 2 Yd')),roster=[{name:'Javonte Williams',team:'DAL',position:'RB'}];
 const missed=new Coverage();missed.skipTo([g],s.at-1);
 assert.deepEqual(missed.update([g],roster,s.at+8),[],'a score is judged only once the play is over');
 const fresh=missed.update([g],roster,s.at+9);
 assert.equal(fresh.length,1);assert.equal(fresh[0].seen,false);assert.equal(fresh[0].queued,true);
 assert.equal(missed.queue.length,1);assert.equal(missed.queue[0].id,s.id);
 assert.equal(officialClip(missed.queue[0],CLIPS).id,JAVONTE_2YD);
 assert.deepEqual(replayWindow(missed.queue[0],g),{from:10388,to:10414});
 const watched=new Coverage();watched.skipTo([g],s.at-1);watched.watch(g.id,s.at-4,s.at);watched.watch(g.id,s.at,s.at+5);
 const seen=watched.update([g],roster,s.at+9);
 assert.equal(seen[0].seen,true);assert.equal(seen[0].queued,false);assert.equal(watched.queue.length,0);
 const patOnly=new Coverage();patOnly.skipTo([g],s.at-1);
 const logged=patOnly.update([g],[{name:'Brandon Aubrey',team:'DAL',position:'K'}],s.at+9);
 assert.deepEqual(logged.map(x=>x.credits.map(c=>c.role)),[['pat']]);
 assert.equal(patOnly.queue.length,0,'an extra point alone is logged but never replayed');
});

test('describeScore strips the conversion note and prints the running score',()=>{
 const g=game(DAL_PHI);
 assert.deepEqual(describeScore(g.scores.find(s=>s.text.startsWith('CeeDee Lamb 16 Yd')),g),{label:'Touchdown',team:'DAL',line:'DAL 28 – PHI 21',text:'CeeDee Lamb 16 Yd pass from Dak Prescott'});
 assert.deepEqual(describeScore(g.scores.find(s=>s.text.startsWith('Brandon Aubrey 55 Yd')),g),{label:'Field goal',team:'DAL',line:'DAL 3 – PHI 0',text:'Brandon Aubrey 55 Yd Field Goal'});
 const tb=game(TB_CAR);
 assert.equal(describeScore(tb.scores.find(s=>s.text.startsWith('Calijah Kancey')),tb).team,'TB');
});

test('normalName folds accents, punctuation, hyphens and generational suffixes',()=>{
 assert.equal(normalName('Amon-Ra St. Brown'),'amon ra st brown');
 assert.equal(normalName('Kyle Pitts Sr.'),'kyle pitts');
 assert.equal(normalName('Marvin Harrison Jr.'),'marvin harrison');
 assert.equal(normalName('Anthony Tyus III'),'anthony tyus');
 assert.equal(normalName("Ja'Marr Chase"),'jamarr chase');
 assert.equal(normalName('José Ramírez'),'jose ramirez');
 assert.equal(normalName('Jaxon Smith-Njigba'),'jaxon smith njigba');
 assert.equal(normalName('C.J. Stroud'),'cj stroud');
 assert.equal(normalName(null),'');
 assert.equal(normalName('  Dak   Prescott  '),'dak prescott');
});

// ---------- catalog integrity ----------
test('every catalog clip points at a Week 7 game, tags only that game\'s teams and carries a boolean short flag',()=>{
 assert.equal(catalog.season,week.season);assert.equal(catalog.week,week.week);
 assert.ok(CLIPS.length>0);
 assert.equal(new Set(CLIPS.map(c=>c.id)).size,CLIPS.length,'clip ids are unique');
 for(const c of CLIPS){
  const g=game(c.gameId);
  assert.ok(g,`${c.title}: unknown game ${c.gameId}`);
  const teams=g.teams.map(t=>alias(t.abbreviation));
  for(const t of c.teams)assert.ok(teams.includes(alias(t)),`${c.title}: ${t} is not in ${g.name}`);
  assert.equal(typeof c.short,'boolean',c.title);
  assert.ok(Array.isArray(c.athletes),c.title);
  assert.match(c.url,/^https:\/\/www\.nfl\.com\//,c.title);
  assert.match(c.mcpID,/^\d+$/,c.title);
 }
 assert.ok(CLIPS.some(c=>c.short===false),'the catalog includes long reels the matcher must skip');
});
