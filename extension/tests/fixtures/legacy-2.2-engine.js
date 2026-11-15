// Frozen 2.2 policy for reproducible synthetic before/after testing only.
// Pure feed adapters and editorial policy. No browser dependencies.
export const DEFAULTS = {leagueId:'28375786', season:new Date().getFullYear(), teamId:'', focusMode:'fantasy', includeBench:false, holdSeconds:45, maxDwellSeconds:120, delaySeconds:0, muteOthers:true, highlightsEnabled:true};
const POSITIONS = {1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'};
const INACTIVE_SLOTS = new Set([20,21]); // ESPN bench and IR
const id = value => value == null ? '' : String(value);
export function normalizeLeague(raw) {
  if (!Array.isArray(raw?.teams) || !raw.teams.length) throw new Error('ESPN returned no teams. Check league, season, and login.');
  return {week:Number(raw.scoringPeriodId || raw.status?.currentMatchupPeriod || 0), teams:raw.teams.map(t => ({
    id:id(t.id), name:t.name || [t.location,t.nickname].filter(Boolean).join(' ') || t.abbrev || `Team ${t.id}`,
    players:(t.roster?.entries || []).map(e => {
      const p=e.playerPoolEntry?.player || e.player || {};
      return {id:id(p.id), name:p.fullName || 'Unknown player', teamId:id(p.proTeamId), position:POSITIONS[p.defaultPositionId] || 'OTHER', starter:!INACTIVE_SLOTS.has(Number(e.lineupSlotId)), slot:Number(e.lineupSlotId), injury:p.injuryStatus || ''};
    }).filter(p=>p.id)
  }))};
}
export function normalizeScoreboard(raw, fetchedAt=Date.now()) {
  if (!Array.isArray(raw?.events)) throw new Error('Unexpected NFL scoreboard format.');
  return raw.events.map(e => {
    const c=e.competitions?.[0] || {}, s=c.situation || {}, status=c.status || e.status || {};
    const teams=(c.competitors || []).map(t=>({id:id(t.team?.id || t.id), abbreviation:t.team?.abbreviation || '?', score:String(t.score ?? '0'), homeAway:t.homeAway}));
    const rawPossession=id(s.possession?.id ?? s.possession);
    // Never infer possession from lastPlay.team: that can be the scoring team,
    // the team before a turnover, or an arbitrary timeout participant.
    const possession=teams.some(t=>t.id===rawPossession) ? rawPossession : '';
    return {id:id(e.id), name:e.shortName || e.name || 'NFL game', teams, date:e.date,
      state:status.type?.completed ? 'post' : status.type?.state || 'pre', statusName:status.type?.name || '',
      detail:status.type?.shortDetail || status.type?.detail || 'Scheduled', period:Number(status.period || 0),
      clock:status.displayClock || '', possession, redZone:s.isRedZone===true,
      down:Number(s.down || 0), downDistance:s.downDistanceText || '',
      lastPlay:s.lastPlay?.text || '', yardsToGoal:scoringDistance(s,teams,possession), fetchedAt};
  }).filter(g=>g.id && g.teams.length===2);
}
export function scoringDistance(situation, teams, possession) {
  // ESPN's raw yardLine has an orientation-dependent origin. Do not guess it.
  if (!possession) return null;
  const explicit=situation.yardsToEndzone;
  if (explicit!==null && explicit!==undefined && explicit!=='' && Number.isFinite(Number(explicit)) && Number(explicit)>=0 && Number(explicit)<=100) return Number(explicit);
  const text=String(situation.possessionText || situation.downDistanceText || '').toUpperCase();
  const match=text.match(/(?:^|\bAT\s+)([A-Z]{2,4})\s+(\d{1,2})(?:\b|$)/);
  if (!match || Number(match[2])>50) return null;
  const alias=x=>({WSH:'WAS',JAX:'JAC',LA:'LAR'})[x] || x;
  const side=teams.find(t=>alias(t.abbreviation)===alias(match[1]));
  if (!side) return null;
  return side.id===possession ? 100-Number(match[2]) : Number(match[2]);
}
export function rankGames(games, roster, config={}) {
  const selected=config.focusMode==='nfl'?[]:roster.filter(p=>config.includeBench || p.starter);
  return games.map(g=> {
    const players=selected.filter(p=>g.teams.some(t=>t.id===p.teamId));
    const active=g.state==='in' && !/HALFTIME|DELAY|SUSPEND|END_PERIOD/i.test(g.statusName);
    const available=players.filter(p=>!['OUT','INJURY_RESERVE','SUSPENSION','IR'].includes(p.injury));
    const offense=available.filter(p=>['QB','RB','WR','TE'].includes(p.position) && p.teamId===g.possession);
    const defense=available.filter(p=>p.position==='D/ST' && g.possession && p.teamId!==g.possession);
    const kickers=available.filter(p=>p.position==='K' && p.teamId===g.possession && g.down===4);
    const involved=active?[...offense,...defense,...kickers]:[];
    const yards=Number.isFinite(g.yardsToGoal)?g.yardsToGoal:null;
    const redZone=!!g.possession && (yards!==null?yards<=20:g.redZone);
    const close=g.period>=4 && Math.abs(Number(g.teams[0].score)-Number(g.teams[1].score))<=8;
    // Distance dominates the fallback. Tiebreakers cannot outweigh a yard.
    const threat=!g.possession?0:yards!==null?100-yards:redZone?80:1;
    let score=active?10+threat+(close?0.3:0):0;
    let reason=active?(yards!==null?`${yards} yards to goal`:redZone?'Red zone · exact field position unavailable':g.possession?'Field position unavailable':'Possession unavailable'):
      g.state==='in'?'Game break / delayed':g.state==='post'?'Game finished':'Not started';
    if (involved.length) {
      score+=1000+Math.min(involved.length,4)*4;
      reason=(offense.length?(redZone?'Your offense is in the red zone':'Your offense has possession'):defense.length?'Your defense faces the opposing possession':'Your kicker: fourth-down opportunity')+' · '+reason;
    } else if(active) reason='Around the league · '+reason;
    return {...g,redZone,players,involved,rosterActive:involved.length>0,score,reason,eligible:active,directorMode:involved.length?'roster':'redzone'};
  }).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
}
export function chooseGame(ranked, bindings, runtime, config, now=Date.now()) {
  if (!runtime.running) return {game:null, reason:'Director stopped'};
  if (runtime.replay) return {game:null,reason:'Highlight break · Return to live to resume cuts'};
  if (runtime.feedError || !runtime.fetchedAt || now-runtime.fetchedAt>90000) return {game:null, reason:'Feed unavailable or stale; switching suspended'};
  const available=ranked.filter(g=>g.eligible && bindings[g.id]);
  const current=available.find(g=>g.id===runtime.currentGame);
  if (runtime.lockGame) return {game:null, reason:'Manual lock; resume Auto to switch'};
  if (current && runtime.manualUntil>now) return {game:null,mode:current.directorMode,reason:`Watch preview · Auto resumes in ${Math.ceil((runtime.manualUntil-now)/1000)}s`};
  const next=available[0];
  if (!next) return {game:null, reason:'No live game has an assigned stream. Highlights remain available.'};
  const mode=next.rosterActive?'Roster focus':'RedZone fallback';
  // Missing possession and tied feeds used to hold the first game indefinitely.
  // Rotate comparable coverage only; never abandon a red-zone drive or a
  // materially better opportunity merely to make the screen move.
  if(current && !current.redZone && now-runtime.switchedAt>=Math.max(config.holdSeconds,config.maxDwellSeconds ?? 120)*1000 && next.rosterActive===current.rosterActive && next.score-current.score<=(current.rosterActive?12:0.5)) {
    const alternate=available.filter(g=>g.id!==current.id && g.rosterActive===current.rosterActive && Math.abs(g.score-next.score)<=(current.rosterActive?12:0.5))
      .sort((a,b)=>(runtime.lastShown?.[a.id] || 0)-(runtime.lastShown?.[b.id] || 0) || b.score-a.score)[0];
    if(alternate)return {game:alternate,mode:alternate.directorMode,reason:`Coverage rotation · comparable priority · ${alternate.reason}`};
  }
  if(available.length===1 && current)return {game:null,mode:current.directorMode,reason:`Only one assigned live stream · add another to enable cuts. ${current.reason}`};
  if (next.id===current?.id) return {game:null, mode:next.directorMode,reason:`${mode} · ${next.reason}`};
  // Returning to your players bypasses a fallback hold. Falling back after a
  // possession loss waits only eight seconds; normal cuts honor the shot hold.
  const transition=current && (current.rosterActive!==next.rosterActive || (runtime.lastSwitchMode==='roster' && !next.rosterActive));
  const hold=transition?(next.rosterActive?0:8000):config.holdSeconds*1000;
  if (current && now-runtime.switchedAt<hold) return {game:null, mode:current.directorMode,reason:'Holding the current shot briefly before the next cut'};
  const margin=current?.rosterActive && next.rosterActive ? 12 : 0.5;
  if (current && !transition && next.score<current.score+margin) return {game:null, mode:current.directorMode,reason:'Waiting for a meaningful priority change'};
  return {game:next, mode:next.directorMode,reason:`${mode} · ${next.reason}`};
}
export function delayedGames(history, seconds, now=Date.now()) {
  return [...history].reverse().find(s=>s.at<=now-seconds*1000)?.games || null;
}
export function validateConfig(input, old=DEFAULTS) {
  const c={...DEFAULTS,...old,...input};
  if (!/^\d{1,12}$/.test(String(c.leagueId))) throw new Error('Enter a numeric league ID.');
  if (!Number.isInteger(Number(c.season)) || c.season<2000 || c.season>2100) throw new Error('Enter a valid season year.');
  for (const [k,min,max] of [['holdSeconds',15,180],['maxDwellSeconds',60,600],['delaySeconds',0,120]]) {
    c[k]=Number(c[k]); if (!Number.isFinite(c[k]) || c[k]<min || c[k]>max) throw new Error(`${k} must be between ${min} and ${max}.`);
  }
  if(!['fantasy','nfl'].includes(c.focusMode))throw new Error('Choose Fantasy roster or NFL RedZone.');
  return {leagueId:String(c.leagueId),season:Number(c.season),teamId:id(c.teamId),focusMode:c.focusMode,includeBench:!!c.includeBench,holdSeconds:c.holdSeconds,maxDwellSeconds:c.maxDwellSeconds,delaySeconds:c.delaySeconds,muteOthers:!!c.muteOthers,highlightsEnabled:c.highlightsEnabled!==false};
}
// Fragments often change inside players. A different path or query may be a
// different game, and must be explicitly reassigned.
export function sameStreamURL(a,b) {
  try {const x=new URL(a),y=new URL(b);x.hash='';y.hash='';return x.href===y.href;}catch{return false;}
}
