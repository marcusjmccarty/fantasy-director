export const TEAMS = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAC KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
export const alias = t => ({WSH:'WAS',JAX:'JAC',LA:'LAR'}[t] || t);
export function rosterForGame(game,roster){const teams=new Set(game.teams.map(t=>alias(t.abbreviation)));return roster.filter(p=>teams.has(alias(p.team)));}
export function involved(game, roster) {
 if(game.state!=='in'||!game.possession||game.phase==='between-drives'||/HALFTIME|END_PERIOD/.test(game.statusName||'')) return [];
 const offense=alias(game.teams.find(t=>String(t.id)===String(game.possession))?.abbreviation);
 const opponents=game.teams.filter(t=>String(t.id)!==String(game.possession)).map(t=>alias(t.abbreviation));
 return roster.filter(p=>p.position==='D/ST'?opponents.includes(alias(p.team)):alias(p.team)===offense&&(p.position!=='K'||(game.down===4&&game.yardsToGoal!==null&&game.yardsToGoal<=35)));
}
export function rankGames(games,roster,{rosterOnly=false,excluded=new Set()}={}){
 return games.filter(g=>g.state==='in'&&!excluded.has(g.id)&&(!rosterOnly||rosterForGame(g,roster).length)&&g.phase!=='between-drives'&&!/HALFTIME|END_PERIOD/.test(g.statusName||'')).map(g=>{
  const players=involved(g,roster),distance=g.yardsToGoal;
  return {game:g,players,rosterPlayers:rosterForGame(g,roster),score:(players.length?1000:0)+(distance===null?0:100-distance),urgent:players.length>0||distance!==null&&distance<=20};
 }).sort((a,b)=>b.score-a.score||a.game.id.localeCompare(b.game.id));
}
// Decisions settle before a cut. The dwell clock starts when footage commits,
// not when a candidate begins loading. Roster action always outranks fallback.
export class StreamDirector{
 constructor(){this.reset();}
 reset(){this.candidate=null;this.since=0;this.lastCut=-Infinity;this.quietSince=null;}
 commit(now){this.lastCut=now;this.candidate=null;}
 choose(games,roster,{currentId=null,now=0,force=false,...options}={}){
  const ranked=rankGames(games,roster,options),best=ranked[0];
  const current=ranked.find(x=>x.game.id===currentId),old=games.find(g=>g.id===currentId);
  if(ranked.some(x=>x.players.length))this.quietSince=null;else this.quietSince??=now;
  if(!best){this.candidate=null;return null;}
  if(force||!old||options.excluded?.has(currentId)||old.state!=='in'){this.candidate=null;return best;}
  if(best.game.id===currentId){this.candidate=null;return best;}
  if(!best.players.length&&rosterForGame(old,roster).length&&now-this.quietSince<6000){this.candidate=null;return current||{game:old,players:[],rosterPlayers:rosterForGame(old,roster),score:0,urgent:false};}
  if(current){
   if(current.players.length&&!best.players.length)return current;
   const newRoster=best.players.length&&!current.players.length;
   const redZoneUpgrade=best.players.length&&best.game.yardsToGoal<=20&&current.game.yardsToGoal>20;
   if(!newRoster&&!redZoneUpgrade&&(now-this.lastCut<15000||best.score-current.score<20)){this.candidate=null;return current;}
  }
  if(!current){this.candidate=null;return best;}
  if(this.candidate!==best.game.id){this.candidate=best.game.id;this.since=now;}
  const delay=best.players.length?1000:3000;
  return now-this.since>=delay?best:current;
 }
}
export function chooseGame(games,roster,currentId,changedAt,now,options={}){
 const ranked=rankGames(games,roster,options),best=ranked[0];if(!best)return null;
 const current=ranked.find(x=>x.game.id===currentId);
 if(current&&best.game.id!==currentId&&best.score-current.score<12&&now-changedAt<6000)return current;
 return best;
}
export function parseRoster(value){
 const lines=value.split('\n').map(x=>x.trim()).filter(Boolean);
 if(lines.length>20)throw new Error('Use up to 20 starters.');
 return lines.map((line,index)=>{
  const [name,rawTeam,rawPosition,...rest]=line.split(',').map(x=>x.trim());
  const team=alias(rawTeam?.toUpperCase()),position=rawPosition?.toUpperCase();
  if(!name||name.length>60||!TEAMS.includes(team)||!['QB','RB','WR','TE','K','D/ST'].includes(position)||rest.length)throw new Error(`Line ${index+1}: use name, NFL team, position.`);
  return {name,team,position};
 });
}
export function safeVideo(value){
 if(!value)return '';
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||!(/\.(mp4|webm|m3u8)$/i.test(u.pathname)))throw new Error('Use a direct HTTPS .mp4, .webm or .m3u8 video URL.');
 return u.href;
}
export function gameKey(game){return game.teams.map(t=>alias(t.abbreviation)).sort().join('-');}
