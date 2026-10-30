// Who earned fantasy points on a scoring play, parsed from ESPN's scoring
// summaries ("CeeDee Lamb 9 Yd pass from Dak Prescott (Brandon Aubrey Kick)").
export const alias=t=>({WSH:'WAS',JAX:'JAC',LA:'LAR'}[t]||t);
export function normalName(value){
 return String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
  .replace(/[.'’]/g,'').replace(/-/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,'').replace(/[^a-z ]+/g,' ').replace(/\s+/g,' ').trim();
}

// Roles that are worth replaying when missed. Extra points alone are not.
export const HIGHLIGHT_ROLES=new Set(['scorer','passer','kicker','defense']);

export function parseScoringPlay(text,typeText='',scoringType=''){
 const t=String(text||'').trim(),players=[];
 const add=(name,role)=>{name=String(name||'').trim();if(name&&!/^(two|team)\b/i.test(name))players.push({name,role});};
 const st=String(scoringType||'');
 let kind=/field.goal/i.test(st)?'FG':/safety/i.test(st)?'SAF':/two.point/i.test(st)?'D2P':st?'TD':/field goal/i.test(t)&&!/return/i.test(t)?'FG':/safety/i.test(t)?'SAF':'TD';
 const main=t.replace(/\s*\(.*$/,'');
 let m;
 if(kind==='FG'&&(m=/^(.+?)\s+\d+\s+Yd\s+Field Goal/i.exec(main)))add(m[1],'kicker');
 else if((m=/^(.+?)\s+\d+\s+Yd\s+pass from\s+(.+)$/i.exec(main))){add(m[1],'scorer');add(m[2],'passer');}
 else if((m=/^(.+?)\s+\d+\s+Yd\s+(?:Rush|Run)\b/i.exec(main)))add(m[1],'scorer');
 else if((m=/^(.+?)\s+\d+\s+Yd\s+.*Return/i.exec(main)))add(m[1],'scorer');
 else if((m=/^(.+?)\s+Defensive PAT Conversion/i.exec(main)))add(m[1],'scorer');
 const defensive=/return|defensive|safety/i.test(main)||/fumble recovery|interception|blocked/i.test(typeText)&&kind==='TD'||kind==='SAF'||kind==='D2P';
 for(const extra of t.matchAll(/\(([^)]*)\)/g)){
  const x=extra[1];
  if((m=/^(.+?)\s+(?:Kick|PAT)\b(?!.*(?:Failed|blocked))/i.exec(x)))add(m[1],'pat');
  else if((m=/^(.+?)\s+Pass to\s+(.+?)\s+for Two-Point/i.exec(x))){add(m[1],'two-point');add(m[2],'two-point');}
  else if((m=/^(.+?)\s+(?:Run|Rush)\s+for Two-Point/i.exec(x)))add(m[1],'two-point');
 }
 return {kind,defensive,players};
}

// Which of the roster's starters earned points on this score, and how.
export function rosterCredit(score,game,roster){
 const team=alias(game.teams[score.team]?.abbreviation||'');
 const credits=[];
 for(const p of roster){
  const pTeam=alias(p.team);
  if(p.position==='D/ST'){if(pTeam===team&&(score.defensive||score.kind==='SAF'||score.kind==='D2P'))credits.push({player:p,role:'defense'});continue;}
  if(pTeam!==team)continue;
  const name=normalName(p.name),hit=score.players.find(x=>samePlayer(normalName(x.name),name));
  if(hit)credits.push({player:p,role:hit.role});
 }
 return credits;
}
// Full-name match, tolerating a dropped middle token ("Kyle Pitts Sr." vs "Kyle Pitts").
function samePlayer(a,b){
 if(a===b)return true;
 const x=a.split(' '),y=b.split(' ');
 return x.length>=2&&y.length>=2&&x[0]===y[0]&&x.at(-1)===y.at(-1);
}
export const worthReplaying=credits=>credits.some(c=>HIGHLIGHT_ROLES.has(c.role)||c.role==='two-point');

export function describeScore(score,game){
 const team=game.teams[score.team]?.abbreviation||'';
 const label={TD:'Touchdown',FG:'Field goal',SAF:'Safety',D2P:'Defensive 2-pt'}[score.kind]||'Score';
 const [a,h]=game.teams;
 return {label,team,line:`${a.abbreviation} ${score.away} – ${h.abbreviation} ${score.home}`,text:score.text.replace(/\s*\(.*$/,'').trim()};
}
