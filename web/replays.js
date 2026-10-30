// Finds the footage for a missed score: the league's own clip of that play
// when one exists, otherwise the moment itself from the game's recording.
import {normalName} from './scoring.js';
const KIND={TD:/\bTDs?\b|touchdown|scores?\b|walks? in|pick.six|end zone|to the house/i,FG:/\bFG\b|field goal/i,SAF:/safety/i,D2P:/two.point|2.point|extra point|PAT/i};

export function officialClip(item,clips){
 const s=item.score,yards=/(\d+)\s+Yd/i.exec(s.text)?.[1];
 const lead=s.players.find(p=>p.role==='scorer'||p.role==='kicker');if(!lead)return null;
 const name=normalName(lead.name),last=name.split(' ').at(-1);
 let best=null,bestScore=0;
 for(const clip of clips){
  if(clip.gameId!==item.gameId||clip.short===false)continue;
  const title=normalName(clip.title),athletes=(clip.athletes||[]).map(normalName);
  const nameHit=athletes.includes(name)||title.includes(name)||title.split(' ').includes(last)&&athletes.some(a=>a.endsWith(' '+last));
  if(!nameHit)continue;
  // A clip quoting a different distance is a different play by the same player.
  const quoted=/(\d+)[- ]?(?:yard|yd)/i.exec(clip.title)?.[1];if(quoted&&yards&&quoted!==yards)continue;
  const yardHit=!!quoted,kindHit=(KIND[s.kind]||KIND.TD).test(clip.title);
  // A clip has to read like the score itself; the right distance only breaks ties.
  const score=(kindHit?2:0)+(yardHit?1:0);
  if(score>bestScore){best=clip;bestScore=score;}
 }
 return bestScore>=2?best:null;
}

// A window around the snap, in game seconds since kickoff.
export const REPLAY_WINDOW={before:12,after:14};
export function replayWindow(item,game){const rel=item.at-game.start;return {from:rel-REPLAY_WINDOW.before,to:rel+REPLAY_WINDOW.after};}
