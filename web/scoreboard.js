import {alias} from './scoring.js';
import {involvement} from './director.js';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// A snapshot without totals shows the last tally the feed carried (live.js shownScore), so a blank poll does not read as 0-0.
export const tallyOf=(g,i)=>g.scoreKnown===false?g.shownScore?.[i]??'—':g.score?.[i]??0;
// Near its listed start (from 5 minutes before until an hour after, for a late start or a delay), a game still 'pre' is worth polling fast.
export const nearStart=(g,now=Date.now())=>{const until=Date.parse(g.date)-now;return g.state==='pre'&&until<300000&&until>-3600000;};
export const formatPoints=value=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(2):'—';
const KICKOFF_TIME=new Intl.DateTimeFormat([],{weekday:'short',hour:'numeric',minute:'2-digit'});
const kickoff=g=>{
 const date=new Date(g.date||g.start*1000);
 return Number.isFinite(date.getTime())?KICKOFF_TIME.format(date):'Time TBD';
};

// Compact chips for the league strip under the header: status, both teams with
// logos and scores, the ball, and a Gamecast link. Your games and the game on
// screen are marked; roster names travel in the tooltip.
export function scoreCards(games,roster=[],{mine=false,watching=null}={}){
 const teams=new Set(roster.map(p=>alias(p.team)));
 const follows=g=>g.teams.some(t=>teams.has(t.abbr));
 const order=g=>g.id===watching?-1:g.state==='in'?0:g.state==='pre'?1:2;
 return games.filter(g=>!mine||follows(g)).slice().sort((a,b)=>order(a)-order(b)||(Date.parse(a.date)||a.start*1000||0)-(Date.parse(b.date)||b.start*1000||0)).map(g=>{
  const active=g.state==='in',final=g.state==='post',known=g.scoreKnown!==false,yours=follows(g),onAir=watching===g.id;
  const status=final?(/OT/i.test(g.detail||'')?'Final/OT':'Final'):active?(g.detail||'Live'):kickoff(g);
  const names=roster.filter(p=>g.teams.some(t=>t.abbr===alias(p.team))).map(p=>p.name);
  const rows=g.teams.map((t,i)=>{
   const value=g.state==='pre'||!known?'—':g.score?.[i]??'—';
   const leader=final&&known&&Number(g.score?.[i])>Number(g.score?.[1-i]),trailer=final&&known&&Number(g.score?.[i])<Number(g.score?.[1-i]);
   const code=String(t.abbr||'').toLowerCase();
   const logo=/^[a-z]{2,3}$/.test(code)?`<img src="https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png" alt="" width="20" height="20" loading="lazy" referrerpolicy="no-referrer">`:'';
   const ball=active&&g.possession===i?`<i class="sb-ball" title="${escape(t.abbr)} · Ball"><span class="sr-only">${escape(t.abbr)} · Ball</span></i>`:'';
   return `<div class="sb-team${leader?' sb-winner':''}${trailer?' sb-loser':''}"><span class="sb-logo">${logo}</span><span class="sb-abbr">${escape(t.abbr)}</span>${ball}<strong>${escape(value)}</strong></div>`;
  }).join('');
  const link=/^\d+$/.test(g.id)?`<a class="sb-link" data-score-link="${g.id}" href="https://www.espn.com/nfl/game/_/gameId/${g.id}" target="_blank" rel="noopener noreferrer" title="Gamecast" aria-label="${escape(g.name)} on ESPN (opens a new tab)">↗</a>`:'';
  const mark=onAir?'<span class="sr-only">On screen. </span>':yours?'<span class="sr-only">Your lineup. </span>':'';
  return `<article class="sb-game${active?' sb-live':''}${yours?' sb-mine':''}${onAir?' sb-onair':''}" data-strip-game="${escape(g.id)}" aria-label="${escape(g.name)}"${names.length?` title="${escape(names.join(', '))}"`:''}><div class="sb-game-top">${mark}<span class="sb-status">${active?'<i class="sb-live-dot" aria-hidden="true"></i>':''}${escape(status)}</span>${link}</div>${rows}</article>`;
 }).join('')||`<p class="sb-empty">${mine?'No games for your starters in this slate. Switch to All to see the rest of the league.':'The schedule is loading. Scores appear here when ESPN responds.'}</p>`;
}

// ESPN actual scoring-period stat IDs (not projected or season aggregates).
// Mapping reference: github.com/cwendt94/espn-api/blob/master/espn_api/football/constant.py
export function nflStatLine(stats,position){
 if(!stats||typeof stats!=='object')return '';
 const has=id=>typeof stats[id]==='number'&&Number.isFinite(stats[id]);
 const n=id=>has(id)?stats[id]:0,parts=[];
 const add=(id,label,zero=false)=>{if(has(id)&&(zero||n(id)!==0))parts.push(`${n(id)} ${label}`);};
 if(position==='K'){
  if(has(83)||has(84))parts.push(`${n(83)}${has(84)?'/'+n(84):''} FG`);
  if(has(86)||has(87))parts.push(`${n(86)}${has(87)?'/'+n(87):''} XP`);
 }else if(position==='D/ST'){
  add(99,'SACK');add(95,'INT');add(96,'FR');add(has(105)?105:94,'TD');add(97,'BLK');add(98,'SAF');add(120,'PA',true);
 }else{
  if(position==='QB'||n(0)>0){add(3,'PASS YDS',true);add(4,'PASS TD');add(20,'INT');add(24,'RUSH YDS');add(25,'RUSH TD');add(41,'REC');add(42,'REC YDS');add(43,'REC TD');}
  else{
   add(41,'REC');
   if(has(24)||has(42))parts.push(`${n(24)+n(42)} YDS`);
   const td=n(25)+n(43);if(td)parts.push(`${td} TD`);
   if(n(3)){add(3,'PASS YDS');add(4,'PASS TD');add(20,'INT');}
  }
  add(72,'FUM LOST');add(62,'2PT');
 }
 return parts.join(', ');
}

export function fantasyBoard(data,teamId,games=[]){
 const team=data?.scoring?.teams?.find(t=>t.id===teamId);
 if(!team)return null;
 const rows=team.players.map(p=>{
  const game=games.find(g=>g.teams.some(t=>t.abbr===alias(p.team)));
  const involved=game&&involvement(game,[p])[0],active=!!involved;
  const status=active?(involved.role==='defense'?'Team defending':involved.role==='kicker'?'Field-goal opportunity':'Team on offense'):game?(game.state==='pre'?kickoff(game):game.state==='post'?'Final':game.detail||'In progress'):'No game in this slate';
  return `<tr${active?' class="sb-active"':''}><td><span class="sb-position">${escape(p.slot||p.position)}</span></td><th scope="row">${escape(p.name)}<small>${active?'<i class="player-live-dot" aria-hidden="true"></i>':''}${escape(p.team)} · ${escape(status)}</small></th><td class="sb-points ${typeof p.points==='number'&&p.points<0?'sb-negative':''}">${formatPoints(p.points)}</td></tr>`;
 }).join('');
 const players=team.players.map(p=>{
  const game=games.find(g=>g.teams.some(t=>t.abbr===alias(p.team)));
  const involved=game&&involvement(game,[p])[0];
  const side=game?game.teams.findIndex(t=>t.abbr===alias(p.team)):-1,other=side>=0?game.teams[1-side]:null;
  const line=!game?'No game':game.state==='pre'?kickoff(game):`${side===0?'@':'vs'} ${other?.abbr||''} ${tallyOf(game,side)}-${tallyOf(game,1-side)} · ${game.state==='post'?'Final':game.detail||'In progress'}`;
  const status=involved?(involved.role==='defense'?'Defending':involved.role==='kicker'?'In FG range':'On offense')+' · '+line:line;
  return {slot:p.slot||p.position,name:p.name,team:p.team,status,active:!!involved&&!p.bench,points:p.points,statLine:game?.state==='pre'?'':nflStatLine(p.stats,p.position),...(p.bench?{bench:true}:{})};
 });
 return {points:formatPoints(team.points),complete:team.complete,rows,players,week:data.scoring.week};
}

export function fantasyMatchup(data,teamId,games=[],matchupId=null){
 if(!data?.scoring)return null;
 const matches=(data?.scoring?.matchups||[]).filter(m=>m.home?.teamId===teamId||m.away?.teamId===teamId);
 const match=matches.find(m=>m.id===matchupId)||matches[0];
 const mine=match?.home?.teamId===teamId?match.home:match?.away;
 const other=match?.home?.teamId===teamId?match.away:match?.home;
 const build=side=>{
  if(!side)return null;
  const board=fantasyBoard(data,side.teamId,games);
  const official=typeof side.points==='number'&&Number.isFinite(side.points);
  const multi=(data.scoring.matchupWeeks||[]).length>1;
  const value=official?side.points:!multi?data.scoring.teams.find(t=>t.id===side.teamId)?.points:null;
  return {...board,id:side.teamId,name:data.teams?.find(t=>t.id===side.teamId)?.name||'Team '+side.teamId,points:formatPoints(value),value,official};
 };
 const yours=build(mine||{teamId}),opponent=build(other);
 const known=Number.isFinite(yours?.value)&&Number.isFinite(opponent?.value);
 const difference=known?Math.round((yours.value-opponent.value)*100)/100:null;
 const status=!match?'Opponent not available for this week':!opponent?'Bye week':!known?'Waiting for matchup points':difference===0?'Tied':difference>0?'Ahead by '+formatPoints(difference):'Behind by '+formatPoints(-difference);
 return {yours,opponent,status,matches,matchupId:match?.id||null,weeks:data?.scoring?.matchupWeeks||[]};
}

// One table, two lineups: each of your starters faces the opponent's starter in
// the same slot (the k-th RB against the k-th RB), the way a matchup is read.
// Without an opponent the opponent columns are left empty (the table is "solo").
// Phones show "J. Daniels"; team defenses and one-word names stay whole.
const shortName=n=>{const words=String(n||'').trim().split(/\s+/);return words.length<2||/D\/ST$/i.test(n)?n:words[0][0]+'. '+words.slice(1).join(' ');};
const number=v=>typeof v==='number'&&Number.isFinite(v);
const nameLabel=n=>`<span class="full">${escape(n)}</span><span class="short" aria-hidden="true">${escape(shortName(n))}</span>`;
const nameCell=(p,side,emptyWord)=>p?`<td class="h2h-name ${side}"><span class="h2h-player${p.active?' on':''}"><b>${nameLabel(p.name)}</b><small>${p.active?'<i class="player-live-dot" aria-hidden="true"></i>':''}${escape(p.team)} · ${escape(p.status)}</small>${p.statLine?`<small class="h2h-stats" title="${escape(p.statLine)}">${escape(p.statLine)}</small>`:''}</span></td>`:`<td class="h2h-name ${side} empty"><span class="h2h-player"><b>${emptyWord}</b></span></td>`;
const pointsCell=(p,other,side)=>{const v=p?.points,lead=number(v)&&number(other?.points)&&v>other.points;return `<td class="h2h-pts ${side}${lead?' lead':''}${number(v)&&v<0?' sb-negative':''}">${p?formatPoints(v):''}</td>`;};
const slotCell=(a,b)=>`<td class="h2h-slot"><span>${escape(a?.slot||b?.slot||'')}</span></td>`;
const row=(a,b,opponent,cls='')=>opponent?`<tr${cls?` class="${cls}"`:''}>${nameCell(a,'mine','Empty')}${pointsCell(a,b,'mine')}${slotCell(a,b)}${pointsCell(b,a,'theirs')}${nameCell(b,'theirs','Empty')}</tr>`:`<tr${cls?` class="${cls}"`:''}>${slotCell(a)}${nameCell(a,'mine','')}${pointsCell(a,null,'mine')}</tr>`;
// Starters slot by slot: yours on the left, the opponent's on the right. Alone, the list reads slot, name, points.
export function headToHead(yours,opponent){
 const mine=(yours?.players||[]).filter(p=>!p.bench),theirs=(opponent?.players||[]).filter(p=>!p.bench),used=new Set();
 const pairs=mine.map(p=>{const i=theirs.findIndex((q,k)=>!used.has(k)&&q.slot===p.slot);if(i>=0)used.add(i);return [p,i>=0?theirs[i]:null];});
 theirs.forEach((q,k)=>{if(!used.has(k))pairs.push([null,q]);});
 return pairs.map(([a,b])=>row(a,b,!!opponent)).join('');
}
// The benches (and IR) in the same columns, after a divider, for the part of the
// rail you scroll down to. Bench points never count toward the matchup.
export function benchRows(yours,opponent){
 const mine=(yours?.players||[]).filter(p=>p.bench),theirs=opponent?(opponent.players||[]).filter(p=>p.bench):[];
 if(!mine.length&&!theirs.length)return '';
 const rows=[];for(let i=0;i<Math.max(mine.length,theirs.length);i++)rows.push(row(mine[i]||null,theirs[i]||null,!!opponent,'bench'));
 return `<tr class="h2h-divider"><td colspan="${opponent?5:3}"><span>Bench</span></td></tr>`+rows.join('');
}
// Column widths for both tables, so the bench lines up under the starters.
export const matchupColumns=opponent=>opponent?'<col class="c-name"><col class="c-pts"><col class="c-slot"><col class="c-pts"><col class="c-name">':'<col class="c-slot"><col class="c-name"><col class="c-pts">';

// One row size for starters and bench. Hiding the guide reveals more of the
// same list instead of compressing the bench to fit it onto the first screen.
export function mountMatchupRows({$,view=globalThis}){
 if(!view.ResizeObserver||!view.MutationObserver)return;
 const panel=$('matchupPanel'),board=$('scoreboard'),rows=$('fantasyPlayers'),guide=$('gameTiles');
 let frame=0;
 const update=()=>{
  frame=0;
  if(panel.hidden||!panel.clientHeight||!rows.rows.length||!view.matchMedia('(min-width:961px)').matches)return;
  const style=view.getComputedStyle(panel),padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);
  const heading=board.getBoundingClientRect().height-rows.getBoundingClientRect().height;
  const revealed=guide.hidden?guide.getBoundingClientRect().height:0;
  const minimum=parseFloat(style.getPropertyValue('--matchup-min-row-height'))||40;
  const height=Math.max(minimum,(panel.clientHeight-padding-heading-revealed)/rows.rows.length);
  const value=height.toFixed(2)+'px';
  if(panel.style.getPropertyValue('--matchup-row-height')!==value)panel.style.setProperty('--matchup-row-height',value);
 };
 const schedule=()=>{if(!frame)frame=view.requestAnimationFrame(update);};
 const resize=new view.ResizeObserver(schedule);
 for(const element of [panel,board,guide])resize.observe(element);
 const changes=new view.MutationObserver(schedule);
 changes.observe(rows,{childList:true});changes.observe(guide,{attributes:true,attributeFilter:['hidden']});
 schedule();
 return ()=>{resize.disconnect();changes.disconnect();if(frame)view.cancelAnimationFrame(frame);};
}

// Score updates have no access to the player, director, roster or saved state.
// An old request can never replace a newly selected league or replay mode.
export class FantasyScoreFeed{
 constructor({fetcher=fetch,now=()=>Date.now()}={}){this.fetcher=fetcher.bind(globalThis);this.now=now;this.key='';this.data=null;this.updated=0;this.error='';this.needsConnection=false;this.next=0;this.pending=null;}
 valid(data,connection){return data?.leagueId===connection.leagueId&&Array.isArray(data.scoring?.teams)&&data.scoring.teams.length>0&&(!connection.teamId||data.scoring.teams.some(t=>t.id===connection.teamId))&&(!connection.week||data.scoring.week===connection.week)&&(!connection.season||data.season===connection.season);}
 sync(connection,seed=null){
  // Every response contains all teams. Changing franchises can reuse the same
  // league snapshot immediately; changing credentials/week still retires it.
  const key=connection?JSON.stringify({...connection,teamId:undefined}):'';
  if(key!==this.key){this.pending?.abort();this.pending=null;this.key=key;this.data=null;this.updated=0;this.error='';this.needsConnection=false;this.next=0;}
  // A successful import already contains all scores. Display it immediately;
  // do not require a second request before revealing players and points.
  if(key&&seed&&seed.fetchedAt>this.updated&&seed.fetchedAt<=this.now()&&this.now()-seed.fetchedAt<30000&&this.valid(seed,connection)){
   this.pending?.abort();this.pending=null;
   this.data=seed;this.updated=seed.fetchedAt;this.error='';this.needsConnection=false;this.next=seed.fetchedAt+30000;
  }
  if(!key||this.pending||this.now()<this.next)return;
  const controller=new AbortController();this.pending=controller;
  return this.read(connection,key,controller);
 }
 async read(connection,key,controller){
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await this.fetcher('/api/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(connection),signal:controller.signal,cache:'no-store'});
   let data;try{data=await response.json();}catch{throw new Error(`The score service returned an unreadable response (HTTP ${response.status}).`);}
   if(this.key!==key||this.pending!==controller||controller.signal.aborted)return;
   if(!response.ok)throw Object.assign(new Error(data.error||'ESPN scores are unavailable'),{reconnect:[400,401,403,404,422].includes(response.status)||['ESPN_REDIRECT','CONNECTION_MISSING'].includes(data.code)});
   if(!this.valid(data,connection))throw new Error('ESPN did not return scores for the selected team and week.');
   this.data=data;this.updated=this.now();this.error='';this.needsConnection=false;
  }catch(error){if(this.key===key&&this.pending===controller){this.needsConnection=!!error.reconnect;const detail=error.name==='AbortError'?'ESPN took too long to respond.':error.message||'Could not refresh fantasy points.';this.error=this.needsConnection?'Reconnect ESPN to bring back your teams and fantasy scores.':detail+' Retrying automatically.';}}
  finally{clearTimeout(timer);if(this.pending===controller){this.pending=null;this.next=this.now()+30000;}}
 }
}
