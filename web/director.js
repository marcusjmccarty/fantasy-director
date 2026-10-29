export const TEAMS = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAC KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
export const alias = t => ({WSH:'WAS',JAX:'JAC',LA:'LAR'}[t] || t);
export function involved(game, roster) {
 if(game.state!=='in'||!game.possession||game.phase==='between-drives'||/HALFTIME|END_PERIOD/.test(game.statusName||'')) return [];
 const offense=alias(game.teams.find(t=>t.id===game.possession)?.abbreviation);
 const opponents=game.teams.filter(t=>t.id!==game.possession).map(t=>alias(t.abbreviation));
 return roster.filter(p=>p.position==='D/ST'?opponents.includes(p.team):p.team===offense&&(p.position!=='K'||(game.down===4&&game.yardsToGoal!==null&&game.yardsToGoal<=35)));
}
export function rankGames(games,roster){
 return games.filter(g=>g.state==='in'&&g.phase!=='between-drives'&&!/HALFTIME|END_PERIOD/.test(g.statusName||'')).map(g=>{
  const players=involved(g,roster),distance=g.yardsToGoal;
  return {game:g,players,score:(players.length?1000:0)+(distance===null?0:100-distance),urgent:players.length>0||distance!==null&&distance<=20};
 }).sort((a,b)=>b.score-a.score||a.game.id.localeCompare(b.game.id));
}
export function chooseGame(games,roster,currentId,changedAt,now){
 const ranked=rankGames(games,roster),best=ranked[0];if(!best)return null;
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
