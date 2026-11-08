// Roster action comes first. During a break, another available game can fill
// the screen until a roster game returns. Availability belongs to the caller.
import {alias} from './scoring.js';

export const KICK_RANGE=42;       // 4th down at or inside the opponent 42 (a 59-yard try)
export const RULES={
 dwell:12,        // seconds to stay after a cut unless something more urgent appears
 margin:10,       // yards closer a rival drive must be to take over a healthy one
 debounce:1.5,    // a challenger must stay best this long (absorbs feed jitter)
 preSnap:5,       // never leave a game you care about this close to its next snap
 scoreHold:18,    // stay for the celebration after one of your players scores
 highlightWait:75 // longest a missed score waits for a natural break
};
const OFFENSE=new Set(['QB','RB','WR','TE']);

function fourthDownPlan(game){
 if(game.down!==4||game.yardsToGoal===null||game.yardsToGoal===undefined)return null;
 // A live feed's play phase is inferred from timing and says nothing about what the play is.
 if(game.phase==='play'&&!game.synthesized&&/Field Goal/i.test(game.playType||''))return 'kick';
 if(game.phase==='play'&&!game.synthesized&&!game.special)return 'go';
 if(game.distance<=2)return 'go';
 return game.yardsToGoal<=KICK_RANGE?'kick':'punt';
}

// Which starters are on the field right now, and in what capacity.
export function involvement(game,roster,{includeDefense=true}={}){
 if(game.state!=='in'||!(game.possession>=0)||game.phase==='break'||game.phase==='pre')return [];
 const offense=game.teams[game.possession]?.abbr,defense=game.teams[1-game.possession]?.abbr,plan=fourthDownPlan(game);
 const out=[];
 for(const p of roster){
  const team=alias(p.team);
  if(p.position==='D/ST'){if(includeDefense&&team===defense)out.push({player:p,role:'defense'});continue;}
  if(team!==offense)continue;
  if(p.position==='K'){if(game.down===4&&!game.special&&Number.isFinite(game.yardsToGoal)&&game.yardsToGoal<=KICK_RANGE)out.push({player:p,role:'kicker'});continue;}
  if(!OFFENSE.has(p.position)||game.special||plan==='kick'||plan==='punt')continue;
  out.push({player:p,role:'offense'});
 }
 return out;
}

export function rate(game,involved){
 const ytg=Number.isFinite(game.yardsToGoal)?game.yardsToGoal:80;
 const attackers=involved.filter(x=>x.role!=='defense');
 if(attackers.length){
  const kickTry=attackers.every(x=>x.role==='kicker');
  const goingForIt=!kickTry&&game.down===4;
  return {tier:2,yards:ytg,score:100-ytg+(attackers.length-1)*2+(kickTry?1:0)+(goingForIt?4:0),
   critical:ytg<=20||kickTry||goingForIt,imminent:kickTry||goingForIt};
 }
 if(involved.length)return {tier:1,yards:ytg,score:100-ytg,critical:false,imminent:false};
 return {tier:0,yards:ytg,score:0,critical:false,imminent:false};
}

export function rank(games,roster,{excluded=new Set(),includeDefense=true,currentId=null}={}){
 return games.filter(g=>!excluded.has(g.id)).map(game=>{const players=involvement(game,roster,{includeDefense});return {game,players,...rate(game,players)};})
  .filter(e=>e.tier>0)
  .sort((a,b)=>b.tier-a.tier||b.score-a.score||(b.game.id===currentId)-(a.game.id===currentId)||a.game.id.localeCompare(b.game.id));
}
export function rosterTeams(roster){return new Set(roster.map(p=>alias(p.team)));}
export function hasRoster(game,roster){const teams=rosterTeams(roster);return game.teams.some(t=>teams.has(t.abbr));}

export class Director{
 constructor(rules={}){this.rules={...RULES,...rules};this.reset();}
 reset(){this.lastCut=-Infinity;this.challenger=null;}
 committed(at){this.lastCut=at;this.challenger=null;}
 // current: {kind:'game'|'highlight'|'standby', id}
 // stayThrough: the picture on screen cannot be paused and resumed (a website player), so a break
 // is not worth leaving for a filler; only a game with one of the viewer's starters on the field takes over.
 decide({games,roster,at,current={},excluded=new Set(),queue=[],includeDefense=true,recentScore=()=>false,backups=new Set(),redzone=false,stayThrough=false}){
  const r=this.rules,ranked=rank(games,roster,{excluded,includeDefense,currentId:current.id}),best=ranked[0];
  const curGame=current.kind==='game'?games.find(g=>g.id===current.id&&!excluded.has(g.id)&&(hasRoster(g,roster)||stayThrough)):null;
  const cur=curGame?(ranked.find(e=>e.game.id===curGame.id)||{game:curGame,players:[],...rate(curGame,[])}):null;
  const stay=reason=>({kind:'game',id:curGame.id,entry:cur,reason});
  // Leaving a watchable game waits out feed jitter; leaving a break or a final does not.
  const go=(entry,reason)=>{
   const leaving=curGame&&entry.game.id!==curGame.id&&curGame.phase!=='final'&&curGame.phase!=='break'&&!excluded.has(curGame.id);
   if(leaving&&r.debounce>0){
    if(this.challenger?.id!==entry.game.id)this.challenger={id:entry.game.id,since:at};
    if(at-this.challenger.since<r.debounce)return stay(explain(cur));
   }
   return {kind:'game',id:entry.game.id,entry,reason};
  };
  if(current.kind==='highlight'){
   if(current.protected)return {kind:'highlight',id:current.id,reason:'Finishing your score replay'};
   const urgent=ranked.find(e=>e.critical&&(e.game.phase==='play'||e.game.nextSnapIn===null||e.game.nextSnapIn<10));
   if(urgent)return {kind:'game',id:urgent.game.id,entry:urgent,reason:'Back to live action'};
   return {kind:'highlight',id:current.id,reason:'Replaying a score you missed'};
  }
  if(curGame&&curGame.state==='in'&&current.protected){this.challenger=null;return stay('Finishing the play');}
  // Never cut away from a live snap in a game you care about, nor in the seconds before one.
  if(cur&&cur.tier>0&&curGame.phase==='play'&&!curGame.synthesized){this.challenger=null;return stay('Play in progress');}
  if(cur&&cur.tier>0&&curGame.phase==='live'&&curGame.nextSnapIn!==null&&curGame.nextSnapIn<=r.preSnap){this.challenger=null;return stay('Snap coming');}
  const held=curGame&&curGame.state==='in'&&curGame.phase!=='break'?recentScore(curGame,at):false;
  if(held)return stay(typeof held==='string'?held:'Your player just scored');
  if(queue.length&&!ranked.some(e=>e.critical)&&(!cur||cur.tier===0||curGame.phase!=='play'&&(at-queue[0].queuedAt>=r.highlightWait||!best)))
   return {kind:'highlight',id:queue[0].id,reason:'Replaying a score you missed'};
  if(!best){
   if(redzone){
    const filler=this.redzoneChoice({games,at,current,excluded,backups});
    if(filler)return filler;
   }
   if(stayThrough&&curGame&&curGame.state==='in'){this.challenger=null;return stay(curGame.phase==='break'?'Break · staying with this stream':'Your players are off the field');}
   this.challenger=null;
   if(curGame&&curGame.state==='in'&&curGame.phase!=='break')return stay('Your players are off the field');
   const fallback=games.filter(g=>g.state==='in'&&hasRoster(g,roster)&&!excluded.has(g.id)).sort((a,b)=>(a.phase==='break')-(b.phase==='break')||a.id.localeCompare(b.id))[0];
   if(!fallback||fallback.phase==='break'){
    // Never start an unrelated channel when the viewer's slate has ended.
    const active=games.some(g=>g.state==='in'&&hasRoster(g,roster));
    const filler=active&&games.filter(g=>g.state==='in'&&g.phase!=='break'&&backups.has(g.id)&&!excluded.has(g.id))
     .sort((a,b)=>(b.id===current.id)-(a.id===current.id)||a.id.localeCompare(b.id))[0];
    if(filler)return {kind:'game',id:filler.id,entry:{game:filler,players:[],...rate(filler,[])},reason:'Another game while your games take a break'};
   }
   if(curGame&&fallback?.phase==='break'&&curGame.state==='in')return stay('Break in the action');
   if(fallback)return {kind:'game',id:fallback.id,entry:{game:fallback,players:[],...rate(fallback,[])},reason:'Your players are off the field'};
   return {kind:'standby',id:null,reason:'None of your starters are playing right now'};
  }
  if(!cur||excluded.has(curGame.id))return {kind:'game',id:best.game.id,entry:best,reason:explain(best)};
  if(best.game.id===curGame.id){this.challenger=null;return stay(explain(cur));}
  if(cur.tier===0){this.challenger=null;return {kind:'game',id:best.game.id,entry:best,reason:explain(best)};}
  // A drive must clear the current one by a few yards: one hovering around the 20 does not trade places with its neighbour.
  const urgentUpgrade=best.critical&&!cur.critical&&best.score>=cur.score+Math.min(r.margin,5);
  if(at-this.lastCut<r.dwell&&best.tier<=cur.tier&&!urgentUpgrade){this.challenger=null;return stay(explain(cur));}
  const better=best.tier>cur.tier||best.score>=cur.score+r.margin||urgentUpgrade||best.imminent&&!cur.critical&&best.score>cur.score;
  if(!better){this.challenger=null;return stay(explain(cur));}
  return go(best,explain(best));
 }
 // Live fallback only: available streams compete for the closest scoring
 // chance. Roster involvement above always takes priority. Dwell, margin and
 // debounce prevent feed jitter from cycling embedded pages.
 redzoneChoice({games,at,current,excluded,backups}){
  const distance=g=>Number.isFinite(g.yardsToGoal)&&g.possession>=0&&!g.special?g.yardsToGoal:100;
  const candidates=games.filter(g=>g.state==='in'&&g.phase!=='break'&&backups.has(g.id)&&!excluded.has(g.id))
   .sort((a,b)=>distance(a)-distance(b)||(b.id===current.id)-(a.id===current.id)||a.id.localeCompare(b.id));
  const best=candidates[0];if(!best)return null;
  const cur=candidates.find(g=>g.id===current.id),r=this.rules;
  const choose=g=>({kind:'game',id:g.id,entry:{game:g,players:[],...rate(g,[])},reason:distance(g)<100?`Best chance to score · ${g.name}, ${distance(g)} yards out`:'Best available game'});
  if(!cur){this.challenger=null;return choose(best);}
  if(cur.id===best.id||current.protected||cur.phase==='play'||cur.nextSnapIn!=null&&cur.nextSnapIn<=r.preSnap||at-this.lastCut<r.dwell||distance(cur)-distance(best)<r.margin){this.challenger=null;return choose(cur);}
  if(this.challenger?.id!==best.id)this.challenger={id:best.id,since:at};
  return choose(at-this.challenger.since>=r.debounce?best:cur);
 }
}

export function explain(entry){
 if(!entry?.players?.length)return 'Your matchup';
 const g=entry.game,ytg=g.yardsToGoal;
 const names=entry.players.map(x=>x.player.name.split(' ').slice(-1)[0]);
 const list=names.length>2?`${names.slice(0,2).join(', ')} +${names.length-2}`:names.join(' & ');
 const roles=new Set(entry.players.map(x=>x.role));
 if(roles.has('offense'))return `${list} · ${ytg<=20?'red zone':'driving'}, ${ytg} yards out`;
 if(roles.has('kicker'))return `${list} · field-goal range on 4th down`;
 return `${list} defense on the field`;
}
