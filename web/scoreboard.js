import {alias} from './scoring.js';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatPoints=value=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(2):'—';
const kickoff=g=>{
 const date=new Date(g.date||g.start*1000);
 return Number.isFinite(date.getTime())?date.toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'}):'Time TBD';
};

export function scoreCards(games,roster=[],{mine=false,watching=null}={}){
 const teams=new Set(roster.map(p=>alias(p.team)));
 const follows=g=>g.teams.some(t=>teams.has(t.abbr));
 const order=g=>g.state==='in'?0:g.state==='pre'?1:2;
 return games.filter(g=>!mine||follows(g)).slice().sort((a,b)=>order(a)-order(b)||(Date.parse(a.date)||a.start*1000||0)-(Date.parse(b.date)||b.start*1000||0)).map(g=>{
  const active=g.state==='in',final=g.state==='post',known=g.scoreKnown!==false;
  const status=final?'Final':active?(g.detail||'In progress'):kickoff(g);
  const names=roster.filter(p=>g.teams.some(t=>t.abbr===alias(p.team))).map(p=>p.name);
  const rows=g.teams.map((t,i)=>{
   const value=g.state==='pre'||!known?'—':g.score?.[i]??'—';
   const leader=final&&known&&Number(g.score?.[i])>Number(g.score?.[1-i]);
   const code=String(t.abbr||'').toLowerCase();
   const logo=/^[a-z]{2,3}$/.test(code)?`<img src="https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png" alt="" width="32" height="32" loading="lazy" referrerpolicy="no-referrer">`:'';
   return `<div class="sb-team ${leader?'sb-winner':''}"><span class="sb-logo">${logo}</span><span class="sb-team-name">${escape(t.name||t.abbr)}<small>${escape(t.abbr)}${active&&g.possession===i?' · Ball':''}</small></span><strong>${escape(value)}</strong></div>`;
  }).join('');
  const situation=active?[g.downDistance,g.possession>=0?`${g.teams[g.possession]?.abbr} possession`:''].filter(Boolean).join(' · '):'';
  const link=/^\d+$/.test(g.id)?`<a data-score-link="${g.id}" href="https://www.espn.com/nfl/game/_/gameId/${g.id}" target="_blank" rel="noopener noreferrer" aria-label="${escape(g.name)} on ESPN (opens a new tab)">Gamecast ↗</a>`:'';
  return `<article class="sb-game ${active?'sb-live':''}" aria-label="${escape(g.name)}"><div class="sb-game-top"><span>${active?'<i aria-hidden="true"></i>':''}${escape(status)}</span>${watching===g.id?'<b>ON SCREEN</b>':follows(g)?'<b>YOUR LINEUP</b>':''}</div>${rows}<div class="sb-situation">${escape(situation|| (final?'Game complete':'Upcoming'))}</div><div class="sb-game-footer"><span>${escape(names.join(' · ')||'NFL')}</span>${link}</div></article>`;
 }).join('')||`<p class="sb-empty">${mine?'No games for your starters in this slate. Switch to All games to see the rest of the NFL.':'The schedule is loading. Scores will appear here when ESPN responds.'}</p>`;
}

export function fantasyBoard(data,teamId,games=[]){
 const team=data?.scoring?.teams?.find(t=>t.id===teamId);
 if(!team)return null;
 const rows=team.players.map(p=>{
  const game=games.find(g=>g.teams.some(t=>t.abbr===alias(p.team)));
  const status=game?(game.state==='pre'?kickoff(game):game.state==='post'?'Final':game.detail||'In progress'):'No game in this slate';
  return `<tr><td><span class="sb-position">${escape(p.slot||p.position)}</span></td><th scope="row">${escape(p.name)}<small>${escape(p.team)} · ${escape(status)}</small></th><td class="sb-points ${typeof p.points==='number'&&p.points<0?'sb-negative':''}">${formatPoints(p.points)}</td></tr>`;
 }).join('');
 return {points:formatPoints(team.points),complete:team.complete,rows,week:data.scoring.week};
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

// Score updates have no access to the player, director, roster or saved state.
// An old request can never replace a newly selected league or replay mode.
export class FantasyScoreFeed{
 constructor({fetcher=fetch,now=()=>Date.now()}={}){this.fetcher=fetcher;this.now=now;this.key='';this.data=null;this.updated=0;this.error='';this.next=0;this.pending=null;}
 sync(connection){
  // Every response contains all teams. Changing franchises can reuse the same
  // league snapshot immediately; changing credentials/week still retires it.
  const key=connection?JSON.stringify({...connection,teamId:undefined}):'';
  if(key!==this.key){this.pending?.abort();this.pending=null;this.key=key;this.data=null;this.updated=0;this.error='';this.next=0;}
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
   if(!response.ok)throw new Error('ESPN scores are unavailable');
   if(data.leagueId!==connection.leagueId||!data.scoring?.teams?.some(t=>t.id===connection.teamId))throw new Error('No team scores returned');
   if(connection.week&&data.scoring.week!==connection.week||connection.season&&data.season!==connection.season)throw new Error('Scores are for a different week');
   this.data=data;this.updated=this.now();this.error='';
  }catch{if(this.key===key&&this.pending===controller)this.error='Could not refresh fantasy points. Retrying automatically.';}
  finally{clearTimeout(timer);if(this.pending===controller){this.pending=null;this.next=this.now()+30000;}}
 }
}
