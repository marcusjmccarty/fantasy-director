import {alias,normalName} from './scoring.js';

const SCORE_WORDS={TD:/\btd\b|touchdown|pick.six|to the house|walks? in/i,FG:/\bfg\b|field.goal/i,SAF:/safety/i,D2P:/two.point|2.point|defensive.pat/i};
const REEL=/highlights|best (?:plays|catches|throws)|every .*|all .*plays|top \d|throwback|on this day|career (?:plays|highlights)/i;
const NEGATED=/overturned|negated|called back|no touchdown|touchdown.*(?:doesn.t count|nullified)|(?:td|touchdown)[- ]saving|(?:short of|shy of) (?:the )?(?:goal line|end zone)|(?:almost|nearly) (?:scores|a touchdown)|sets? up.*(?:touchdown|\btd\b)/i;
const words=value=>' '+normalName(value)+' ';
const contains=(text,name)=>!!name&&words(text).includes(words(name));
const distance=score=>Number(/\b(\d+)\s+Yd\b/i.exec(score.text||'')?.[1]??NaN);
const lead=score=>(score.players||[]).find(p=>p.role==='scorer'||p.role==='kicker');

export function highlightPage(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(['nfl.com','www.nfl.com','espn.com','www.espn.com'].includes(u.hostname))?u.href:null;}catch{return null;}
}

function clipMatchesScore(clip,score,{requireDistance=false}={}){
 const text=[clip.title,clip.description].filter(Boolean).join(' '),person=lead(score);
 if(clip.short===false||REEL.test(clip.title||'')||NEGATED.test(text)||!(SCORE_WORDS[score.kind]||SCORE_WORDS.TD).test(text))return false;
 if(score.kind==='FG'&&/miss(?:es|ed)?|no good|blocked|wide (?:left|right)/i.test(text))return false;
 if(person){
  if(!contains(text,person.name)&&!(clip.athletes||[]).some(n=>normalName(n)===normalName(person.name)))return false;
 }else if(!['SAF','D2P'].includes(score.kind))return false;
 const yards=distance(score),quoted=[...text.matchAll(/\b(\d+)[-\s]?(?:yards?|yds?)\b/gi)].map(m=>Number(m[1]));
 if(Number.isFinite(yards)&&quoted.length&&!quoted.includes(yards))return false;
 if(requireDistance&&Number.isFinite(yards)&&!quoted.includes(yards))return false;
 return true;
}

function mentionedTeams(clip,game){
 const text=[clip.title,clip.description].filter(Boolean).join(' '),tagged=new Set((clip.teams||[]).map(alias));
 return game.teams.filter(t=>tagged.has(alias(t.abbr||t.abbreviation))||t.name&&(contains(text,t.name)||contains(text,t.name.split(' ').at(-1))));
}

// A catalog's discovery time is never used as its publication time. Unscoped
// NFL clips need a genuine timestamp or explicit season/week and both teams,
// plus a unique matchup and score.
export function liveClipCandidates(item,clips,games,{now=Date.now(),used=new Map(),failed=new Map(),allowUnavailable=false}={}){
 const game=games.find(g=>g.id===item.gameId);if(!game)return [];
 const scores=[...(game.scores||[])];if(!scores.some(s=>s===item.score||item.score.id&&s.id===item.score.id))scores.push(item.score);
 const result=[];
 for(const clip of clips){
  if(used.has(clip.id)&&used.get(clip.id)!==item.id||!allowUnavailable&&failed.get(clip.id)>now)continue;
  if(clip.embargoAt>now||!allowUnavailable&&(clip.expiresAt&&clip.expiresAt<=now+10000||clip.desktopAllowed===false||clip.inlinePlayable===false))continue;
  if(clip.gameId&&clip.gameId!==game.id)continue;
  const unscoped=!clip.gameId;
  if(unscoped){
   const pub=clip.publishedAt,at=Number(item.score.at??item.at)*1000;
   const timed=Number.isFinite(pub)&&pub>0;
   if(clip.kind!=='nfl'||!Number.isFinite(at)||timed&&(pub>now+120000||pub<at-120000||pub>at+2*3600000))continue;
   const matches=games.filter(g=>{
    const start=Date.parse(g.date);if(!Number.isFinite(start)||timed&&(pub<start||pub>start+8*3600000))return false;
    const teams=new Set(g.teams.map(t=>alias(t.abbr||t.abbreviation)));if((clip.teams||[]).some(t=>!teams.has(alias(t))))return false;
    if(!timed&&!(clip.season&&clip.week&&clip.season===g.season&&clip.week===g.week&&mentionedTeams(clip,g).length===2))return false;
    if(clip.season&&g.season&&clip.season!==g.season||clip.week&&g.week&&clip.week!==g.week)return false;
    const years=[...(clip.title+' '+(clip.description||'')).matchAll(/\b(20\d{2})\b/g)].map(m=>Number(m[1]));
    if(g.season&&years.some(year=>year!==g.season))return false;
    return mentionedTeams(clip,g).length>0;
   });
   if(matches.length!==1||matches[0].id!==game.id)continue;
   // Text without yardage needs both teams, or an unusual score such as a safety.
   if(!clipMatchesScore(clip,item.score,{requireDistance:mentionedTeams(clip,game).length<2}))continue;
  }else if(!clipMatchesScore(clip,item.score))continue;
  // Same-player, same-distance repeat scores cannot be distinguished without
  // additional evidence. Do not turn one clip into two different replays.
  const possible=scores.filter(s=>clipMatchesScore(clip,s,{requireDistance:unscoped&&mentionedTeams(clip,game).length<2}));
  if(possible.length!==1||item.score.id&&possible[0].id!==item.score.id)continue;
  result.push({...clip,gameId:game.id,association:unscoped?(clip.publishedAt?'time-team-score':'season-week-teams-score'):'provider-game'});
 }
 return result.sort((a,b)=>Number(!!b.mediaUrl)-Number(!!a.mediaUrl)||Number(!!b.description)-Number(!!a.description)||String(a.id).localeCompare(String(b.id)));
}

export const REPLAY_RETRY_MS=30000,REPLAY_WAIT_SECONDS=1800;
export function canRetryReplay(item,at){return !item.seen&&item.status!=='replayed'&&Number.isFinite(item.at)&&at>=item.at&&at-item.at<=REPLAY_WAIT_SECONDS;}
