import {alias} from './scoring.js';
import {involvement} from './director.js';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatPoints=value=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(2):'—';
const kickoff=g=>{
 const date=new Date(g.date||g.start*1000);
 return Number.isFinite(date.getTime())?date.toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'}):'Time TBD';
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
  const status=involved?(involved.role==='defense'?'Defending':involved.role==='kicker'?'In FG range':'On offense'):game?(game.state==='pre'?kickoff(game):game.state==='post'?'Final':game.detail||'In progress'):'No game';
  return {slot:p.slot||p.position,name:p.name,team:p.team,status,active:!!involved,points:p.points};
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
export function headToHead(yours,opponent){
 const mine=yours?.players||[],theirs=opponent?.players||[],used=new Set();
 const pairs=mine.map(p=>{const i=theirs.findIndex((q,k)=>!used.has(k)&&q.slot===p.slot);if(i>=0)used.add(i);return [p,i>=0?theirs[i]:null];});
 theirs.forEach((q,k)=>{if(!used.has(k))pairs.push([null,q]);});
 const number=v=>typeof v==='number'&&Number.isFinite(v);
 // Phones show "J. Daniels"; team defenses and one-word names stay whole.
 const short=n=>{const words=String(n||'').trim().split(/\s+/);return words.length<2||/D\/ST$/i.test(n)?n:words[0][0]+'. '+words.slice(1).join(' ');};
 const label=n=>`<span class="full">${escape(n)}</span><span class="short" aria-hidden="true">${escape(short(n))}</span>`;
 const name=(p,side)=>p?`<td class="h2h-name ${side}"><span class="h2h-player${p.active?' on':''}"><b>${label(p.name)}</b><small>${p.active?'<i class="player-live-dot" aria-hidden="true"></i>':''}${escape(p.team)} · ${escape(p.status)}</small></span></td>`:`<td class="h2h-name ${side} empty"><span class="h2h-player"><b>${opponent?'Empty':''}</b></span></td>`;
 const points=(p,other,side)=>{const v=p?.points,lead=number(v)&&number(other?.points)&&v>other.points;return `<td class="h2h-pts ${side}${lead?' lead':''}${number(v)&&v<0?' sb-negative':''}">${p?formatPoints(v):''}</td>`;};
 const slot=(a,b)=>`<td class="h2h-slot"><span>${escape(a?.slot||b?.slot||'')}</span></td>`;
 // Alone, the list reads slot, name, points.
 if(!opponent)return pairs.map(([a])=>`<tr>${slot(a)}${name(a,'mine')}${points(a,null,'mine')}</tr>`).join('');
 return pairs.map(([a,b])=>`<tr>${name(a,'mine')}${points(a,b,'mine')}${slot(a,b)}${points(b,a,'theirs')}${name(b,'theirs')}</tr>`).join('');
}

// Score updates have no access to the player, director, roster or saved state.
// An old request can never replace a newly selected league or replay mode.
export class FantasyScoreFeed{
 constructor({fetcher=fetch,now=()=>Date.now()}={}){this.fetcher=fetcher;this.now=now;this.key='';this.data=null;this.updated=0;this.error='';this.needsConnection=false;this.next=0;this.pending=null;}
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
   const data=await response.json();
   if(this.key!==key||this.pending!==controller||controller.signal.aborted)return;
   if(!response.ok)throw Object.assign(new Error(data.error||'ESPN scores are unavailable'),{reconnect:[400,401,403,404,422].includes(response.status)||['ESPN_REDIRECT','CONNECTION_MISSING'].includes(data.code)});
   if(!this.valid(data,connection))throw new Error('ESPN did not return scores for the selected team and week.');
   this.data=data;this.updated=this.now();this.error='';this.needsConnection=false;
  }catch(error){if(this.key===key&&this.pending===controller){this.needsConnection=!!error.reconnect;this.error=this.needsConnection?'Reconnect ESPN to restore league teams and fantasy scores. '+error.message:'Could not refresh fantasy points. Retrying automatically.';}}
  finally{clearTimeout(timer);if(this.pending===controller){this.pending=null;this.next=this.now()+30000;}}
 }
}
