// ESPN adapters keep provider data separate from directing policy.
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
    const teams=(c.competitors || []).map(t=>({id:id(t.team?.id || t.id), abbreviation:t.team?.abbreviation || '?', score:String(t.score ?? '0'), homeAway:t.homeAway})).sort((a,b)=>(a.homeAway==='away'?0:1)-(b.homeAway==='away'?0:1));
    const rawPossession=id(s.possession?.id ?? s.possession);
    // Never infer possession from lastPlay.team: that can be the scoring team,
    // the team before a turnover, or an arbitrary timeout participant.
    const possession=teams.some(t=>t.id===rawPossession) ? rawPossession : '';
    return {id:id(e.id), name:e.shortName || e.name || 'NFL game', teams, date:e.date,
      state:status.type?.completed ? 'post' : status.type?.state || 'pre', statusName:status.type?.name || '',
      detail:status.type?.shortDetail || status.type?.detail || 'Scheduled', period:Number(status.period || 0),
      clock:status.displayClock || '', possession, redZone:s.isRedZone===true,
      down:Number(s.down || 0), downDistance:s.downDistanceText || '',
      lastPlay:s.lastPlay?.text || '', lastPlayId:id(s.lastPlay?.id), playType:s.lastPlay?.type?.text || '', playWallclock:Date.parse(s.lastPlay?.wallclock) || null, phase:playPhase(s.lastPlay), yardsToGoal:scoringDistance(s,teams,possession), fetchedAt};
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

export function playPhase(play={}) {
  if(/no play|reversed|overturned/i.test(play.text || ''))return 'scrimmage';
  if(play.scoringPlay || /touchdown|field goal good|extra point|two.point (pass|rush|conversion)/i.test(play.type?.text || '') || /\bTOUCHDOWN\b/.test(play.text || ''))return 'between-drives';
  return 'scrimmage';
}
