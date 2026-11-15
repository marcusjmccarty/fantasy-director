import {playable} from './highlights.js';
// All decisions use aligned snapshots, so live priority and spoiler offsets agree.
export function protectedLive(games,bindings) {
  return games.some(g=>g.eligible && bindings[g.id] && !bindings[g.id].unavailable && (g.rosterActive || g.redZone || !g.possession));
}
export function nextReplay(items,games,r,c,now=Date.now()) {
  if(!r.running || r.replay || r.lockGame || r.manualUntil>now || !c.highlightsEnabled || !c.autoHighlights || r.feedError)return null;
  const live=games.some(g=>g.state==='in');
  if(!r.fetchedAt || now-r.fetchedAt>(live?Math.max(20000,c.pollSeconds*3000):120000))return null;
  if(protectedLive(games,r.bindings))return null;
  if(!r.quietSince || now-r.quietSince<5000 || (r.lastReplayAt && now-r.lastReplayAt<(r.lab?8000:r.reel?2000:120000)))return null;
  return items.find(h=>h.kind==='clip' && !h.played && !h.attemptedAt &&
    (playable(h,now) || (r.lab && h.testClip)) && h.duration>0 && h.duration<=90 &&
    now-h.publishedAt<=(live&&!r.lab?1800000:48*3600000)) || null;
}
