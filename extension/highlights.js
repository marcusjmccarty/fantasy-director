// Published ESPN clips and text play events stay distinct throughout the app.
const clean=s=>String(s || '').slice(0,1200);
export function mediaURL(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:' && !u.username && !u.password && !u.port &&
      (u.hostname==='espnmedia-cdn.akamaized.net' || u.hostname==='media.video-cdn.espn.com') &&
      /\.mp4$/i.test(u.pathname)?u.href:null;
  } catch{return null;}
}
export function playable(item,now=Date.now()) {
  return !!mediaURL(item.mediaUrl) && (!item.embargoAt || item.embargoAt<=now) && (!item.expiresAt || item.expiresAt>now) && item.desktopAllowed!==false;
}
export function espnURL(value) {
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && (u.hostname==='espn.com' || u.hostname.endsWith('.espn.com'))?u.href:null;} catch {return null;}
}
const norm=s=>String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function relevance(item,roster) {
  const text=` ${norm(item.title+' '+item.description)} `;
  const players=roster.filter(p=>item.athleteIds.includes(p.id) || (norm(p.name).split(' ').length>=2 && text.includes(` ${norm(p.name)} `)));
  const team=roster.some(p=>item.teamIds.includes(p.teamId));
  return {players:players.map(p=>p.name),tier:players.length?'player':team?'team':'league'};
}
export function normalizeHighlights(raw,game,now=Date.now()) {
  if (!raw || typeof raw!=='object' || (!Array.isArray(raw.videos) && !Array.isArray(raw.scoringPlays) && !Array.isArray(raw.plays) && !raw.header)) throw new Error('Unexpected game-summary format');
  const items=[];
  for(const v of raw.videos || []) {
    const videoId=String(v.id || '');
    const url=espnURL(v.links?.web?.href) || (/^\d+$/.test(videoId)?espnURL(`https://www.espn.com/video/clip/_/id/${videoId}`):null);
    if(!url)continue;
    const tags=v.categories || [];
    const mediaUrl=[v.links?.source?.href,v.links?.source?.SD?.href,v.links?.mobile?.source?.href,v.links?.source?.HD?.href].map(mediaURL).find(Boolean) || null;
    const devices=v.deviceRestrictions,desktopAllowed=!devices || (devices.type==='whitelist'?Array.isArray(devices.devices)&&devices.devices.includes('desktop'):devices.type==='blacklist'?!devices.devices?.includes('desktop'):false);
    items.push({id:`clip:${/^\d+$/.test(videoId)?videoId:url}`,kind:'clip',gameId:game.id,gameName:game.name,title:clean(v.headline || v.title || 'ESPN game highlight'),description:clean(v.description),url,mediaUrl,desktopAllowed,
      embargoAt:Date.parse(v.timeRestrictions?.embargoDate)||0,expiresAt:Date.parse(v.timeRestrictions?.expirationDate)||0,
      athleteIds:tags.filter(t=>t.type==='athlete').map(t=>String(t.athlete?.id || t.athleteId || t.id || '')).filter(Boolean),
      teamIds:tags.filter(t=>t.type==='team').map(t=>String(t.team?.id || t.teamId || t.id || '')).filter(Boolean),
      publishedAt:Number.isFinite(Date.parse(v.originalPublishDate))?Date.parse(v.originalPublishDate):now,discoveredAt:now,duration:Number(v.duration)||0});
  }
  const plays=new Map();
  const playURL=espnURL(raw.header?.links?.find(l=>l.rel?.includes('pbp'))?.href) || (/^\d+$/.test(game.id)?`https://www.espn.com/nfl/playbyplay/_/gameId/${game.id}`:null);
  for(const p of raw.scoringPlays || []) if(p.id) plays.set(String(p.id),{...p,scoringPlay:true});
  const drivePlays=[...(raw.drives?.previous || []),raw.drives?.current].flatMap(d=>d?.plays || []);
  for(const p of [...(raw.plays || []),...drivePlays]) if(p.id && (p.scoringPlay || p.isTurnover || /interception|fumble recovery/i.test(p.type?.text || '') || Number(p.statYardage)>=20)) plays.set(String(p.id),{...plays.get(String(p.id)),...p});
  for(const [playId,p] of plays) items.push({id:`play:${game.id}:${playId}`,kind:'play',gameId:game.id,gameName:game.name,title:clean(p.type?.text || 'Scoring play'),description:clean(p.text),
    athleteIds:[...(p.participants || []).map(x=>String(x.athlete?.id || '')),...(p.athletesInvolved || []).map(x=>String(x.id || ''))].filter(Boolean),teamIds:[p.team?.id,...(p.teamParticipants || []).map(t=>t.team?.id || t.id)].filter(Boolean).map(String),
    url:playURL,publishedAt:Number.isFinite(Date.parse(p.wallclock))?Date.parse(p.wallclock):now,discoveredAt:now,duration:0,period:p.period?.number || 0,clock:p.clock?.displayValue || ''});
  return items;
}
export function mergeHighlights(previous,incoming,now=Date.now()) {
  const map=new Map(previous.map(h=>[h.id,h]));
  for(const h of incoming) {
    const old=map.get(h.id);
    map.set(h.id,{...h,publishedAt:old?.publishedAt || h.publishedAt,discoveredAt:old?.discoveredAt || h.discoveredAt,opened:!!old?.opened,played:!!old?.played,attemptedAt:old?.attemptedAt || 0,playbackError:old?.playbackError || ''});
  }
  return [...map.values()].filter(h=>now-h.discoveredAt<48*3600000).sort((a,b)=>b.discoveredAt-a.discoveredAt || a.id.localeCompare(b.id)).slice(0,160);
}
export function highlightView(items,roster,delaySeconds,now=Date.now()) {
  return items.filter(h=>h.discoveredAt<=now-delaySeconds*1000).map(h=>({...h,...relevance(h,roster)})).sort((a,b)=>({player:0,team:1,league:2}[a.tier]-{player:0,team:1,league:2}[b.tier]) || b.publishedAt-a.publishedAt);
}
