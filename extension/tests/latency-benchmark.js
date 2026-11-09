import * as old from './fixtures/legacy-2.2-engine.js';
import * as current from '../engine.js';
import {game} from './helpers.js';
import {pathToFileURL} from 'node:url';
const epoch=2000000000000;
const roster=[{id:'p1',name:'Fixture QB',teamId:'3',position:'QB',starter:true},{id:'p2',name:'Fixture RB',teamId:'14',position:'RB',starter:true}];
const windows=[{start:7,end:35,gameId:'1',name:'Roster possession'},{start:35,end:66,gameId:'2',name:'Goal-line fallback'},{start:66,end:105,gameId:'1',name:'Roster returns'},{start:105,end:125,gameId:'3',name:'Another roster red-zone drive'},{start:125,end:160,gameId:'1',name:'Leave completed touchdown'},{start:160,end:190,gameId:'2',name:'Fallback after possession loss'},{start:190,end:230,gameId:'1',name:'Next roster drive'},{start:230,end:260,gameId:'3',name:'Roster goal-line drive'},{start:260,end:300,gameId:'2',name:'Leave second completed touchdown'}];
function scenario(t){
 const a=game('1','9',70),b=game('2','21',45),c={...game('3','13',65),name:'LAR @ LV',teams:[{id:'14',abbreviation:'LAR',score:'7'},{id:'13',abbreviation:'LV',score:'7'}]};
 if(t>=7){a.possession='3';a.yardsToGoal=70;}
 if(t>=35){a.possession='9';b.yardsToGoal=3;}
 if(t>=66){a.possession='3';a.yardsToGoal=65;b.yardsToGoal=35;}
 if(t>=105){c.possession='14';c.yardsToGoal=12;}
 if(t>=125){c.phase='between-drives';c.yardsToGoal=0;}
 if(t>=160){c.phase='scrimmage';c.possession='13';c.yardsToGoal=70;a.possession='9';a.yardsToGoal=75;b.yardsToGoal=40;}
 if(t>=190){a.possession='3';a.yardsToGoal=70;}
 if(t>=230){a.possession='9';a.yardsToGoal=60;c.possession='14';c.yardsToGoal=8;}
 if(t>=260){c.phase='between-drives';c.yardsToGoal=0;}
 if(t>=300)for(const g of [a,b,c])g.state='post';
 return [a,b,c];
}
function simulate(engine,pollSeconds,pulseSeconds){
 const r={running:true,currentGame:'',fetchedAt:0,switchedAt:0,lockGame:'',lastShown:{},lastSwitchMode:'',candidate:null},selections=[],watch=[],bindings={'1':{},'2':{},'3':{}};
 let latest=[];
 for(let t=0;t<=330;t++){
  const now=epoch+t*1000;if(t%pollSeconds===0){latest=scenario(t);r.fetchedAt=now;}
  if(t%pulseSeconds===0){const ranked=engine.rankGames(latest,roster,engine.DEFAULTS),decision=engine.chooseGame(ranked,bindings,r,engine.DEFAULTS,now);r.candidate=decision.candidate;
   if(decision.game){r.currentGame=decision.game.id;r.switchedAt=now;r.lastSwitchMode=decision.game.directorMode;r.lastShown[r.currentGame]=now;selections.push({atSeconds:t,gameId:r.currentGame,phase:decision.game.phase,reason:decision.reason});}}
  watch.push({at:t,gameId:r.currentGame});
 }
 const opportunities=windows.map(w=>{const first=watch.find(x=>x.at>=w.start && x.at<w.end && x.gameId===w.gameId);return {...w,captured:!!first,latencySeconds:first?first.at-w.start:null};});
 const delays=opportunities.filter(w=>w.captured).map(w=>w.latencySeconds).sort((a,b)=>a-b);
 return {pollSeconds,pulseSeconds,opportunities,captured:delays.length,total:windows.length,maxDelaySeconds:delays.length?Math.max(...delays):null,medianDelaySeconds:delays.length?delays[Math.floor(delays.length/2)]:null,lateScoringCuts:selections.filter(c=>c.phase==='between-drives').length,selections};
}
export function runBenchmark(){return {kind:'Synthetic deterministic simulation — not measured NFL latency',assumptions:'Same scripted feed availability, zero network and browser-activation delay, zero video offset. v2.2 evaluates on 30s polls; v3 evaluates each second with 5s live polls. Nine scripted opportunity windows.',v22:simulate(old,30,30),v30:simulate(current,5,1)};}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(runBenchmark(),null,2));
