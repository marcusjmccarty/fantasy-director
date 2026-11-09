import {demoData} from './demo.js';
export const REHEARSAL_SECONDS=72;
export function rehearsalFrame(seconds,now=Date.now()) {
  const step=seconds<8?0:seconds<16?1:seconds<24?3:seconds<40?4:2;
  const data=demoData(step,now);
  let label=seconds<8?'Roster possession':seconds<16?'New roster drive':seconds<24?'Goal-line fallback':seconds<40?'Quiet stretch → automatic replay':seconds<50?'Roster returns → live coverage':seconds<58?'Feed outage → hold current stream':'Feed recovered → resume cuts';
  if(seconds>=24 && seconds<40)data.games=data.games.map(g=>({...g,yardsToGoal:70,redZone:false}));
  if(seconds>=58)data.games=demoData(0,now).games;
  data.games=data.games.map(g=>({...g,phase:'scrimmage',lastPlayId:`test-${Math.floor(seconds/8)}`,lastPlay:'FICTIONAL TEST · '+label}));
  return {...data,label,elapsed:Math.min(REHEARSAL_SECONDS,Math.floor(seconds)),offline:seconds>=50 && seconds<58,done:seconds>=REHEARSAL_SECONDS,
    highlights:seconds>=24?[{id:'test-replay',kind:'clip',gameId:'demo-1',gameName:'Practice channel',title:'Offline replay test',description:'Original synthetic test animation. No NFL footage or network needed.',athleteIds:['a'],teamIds:['3'],duration:6,publishedAt:now-10000,discoveredAt:now-10000,url:null,testClip:true}]:[]};
}
