# Fantasy Director

A minimal fantasy-football viewing room with franchise selection, synchronized replay controls, prepared video cuts, and integrated official NFL clips. Plain browser JavaScript and a Cloudflare Worker. No framework, fonts, analytics, or player SDK in the initial page. HLS.js loads only for adaptive sources on browsers without native HLS.

## Run

- `npm ci` installs the pinned HLS dependency.
- `npm test` checks the director, archive, media concurrency, source adapters, roster endpoint, and application controls.
- `npm run build` generates `dist/server/index.js` and the hosting manifest.
- `npm run dev` starts http://127.0.0.1:4187. Local preview has no private ESPN secrets.

## League and franchise selection

POST `/api/league` with a numeric `leagueId` returns every franchise and its starters, without member/contact data. Selection persists across refreshes. Replay lab requests ESPN scoring period 7; Live requests the current period. Bench and IR are excluded. Involvement is inferred from team possession and position, not individual snap tracking.

Public leagues need no credentials. The configured private league is available only when the Sites-scoped visitor identity and league ID both match the owner settings. Runtime secrets: `ESPN_OWNER_ID`, `ESPN_LEAGUE_ID`, `ESPN_SWID`, `ESPN_S2`. `ESPN_OWNER_ID` is the dispatch identity, never the account UUID. GET `/api/session` advertises the authorized saved league ID with no-store caching. Credentials never reach browser storage, logs, other providers, or upstream redirects. Browser storage contains roster preferences, manually configured source URLs, and calibration points. Automatically resolved playback URLs remain in memory.

## Replay lab

The repeatable archive is **2026 Week 7, October 22–26**: 14 games and 2,493 timestamped ESPN plays in about 120 KB. One untimed play is omitted. Every game retains its ESPN summary and NFL-Video/OK page provenance. The archive remains fixed as the current NFL calendar advances.

**Replay video** imports all 14 public source records automatically with three concurrent metadata requests. The server reads the catalog's exact public OK embed pages, extracts their normal native playback sources, and preserves signatures unchanged. It does not fetch, proxy, or host footage. The browser plays provider media directly. Expiring sources refresh on use or retry. Optional user-supplied recordings override the imported source. Balanced quality defaults to 480p; 360p and 720p are available.

One shared clock controls day selection, play/pause, seeking, 30-second rewind, next director transition, and up to 4× video speed. Rapid seeks retain the previous picture and only the latest request can commit. The visible native playhead drives the clock between seeks, preventing timer drift from repeatedly seeking the active video. The data-only mode reconstructs possessions without video and supports up to 60×.

### Alignment is explicit

The full-game recordings have 35–55 minutes of breaks edited out. They expose no useful chapter or play timestamps. Duration mapping is therefore **estimated**, not proof of exact play alignment. Sources & sync provides the actual player inside the calibration panel: pause on a snap, enter its quarter/game clock, and save the observed video position. Multiple points interpolate across edited sections. Add points after edits to improve accuracy. No fabricated sync anchors are supplied.

## Prepared player handoff

`MediaDeck` holds at most three physical players: the visible picture and two candidates. Replay forecasting looks 75 seconds ahead; live mode warms the next ranked configured sources. Candidates are muted, sought to the shared target, and checked for at least eight seconds of playable buffer at the current rate (or the remaining duration of a short clip), completed seeking, usable readyState, and a decoded frame. The warmed element becomes visible only after those checks; it is not reloaded at the cut.

A same-game seek also uses a second physical player, retaining the old picture until the new position is decoded. Generation tickets reject late callbacks. Failures back off, and explicit retry renews the source. A stalled active game can yield to a prepared alternative. Diagnostics report cuts, waiting time, buffered seconds, stalls, and calibration points without credentials or source tokens.

These checks avoid cutting to an unready player. They cannot guarantee that third-party hosts or an active network connection never stall. Actual cross-network playback of the OK-issued URLs still needs a user-browser acceptance test; resolving public metadata alone does not establish it.

## Integrated NFL highlights

The replay catalog contains **79 official NFL.com clips covering all 14 games**, including short scoring highlights. The source adapter follows NFL.com's normal anonymous playback flow using its public player configuration and returns its short-lived HLS URL unchanged. Anonymous identity tokens remain in server memory. No subscription, DRM, regional, or payment checks are bypassed; restricted clips fail without replacing the current picture.

Short clips are ranked by roster player and team, prepared through the same media deck, and inserted automatically at quiet moments. Urgent roster/red-zone action preempts automatic clips. Manual clips return on completion, Return to game, or the two-minute limit. Incoming games prepare while a highlight plays, and the highlight's last frame stays until the return is ready. Replay highlights are a week-wide test catalog, not timestamp-matched historical inserts.

Live mode refreshes the current NFL.com highlight playlist every five minutes through two bounded public page requests, and checks ESPN summaries independently. A failure at one provider does not suppress the other. These are official NFL.com clips; access to a separately branded NFL Stories collection has not been verified.

## Live, fullscreen, and footprint

Live ESPN scoreboard polling runs every five seconds during games and every 30 seconds otherwise. Stale feed data holds decisions. Users supply their own compatible live stream URLs. Data-feed timing and broadcast delay remain distinct; the app cannot promise to predict televised action.

Fullscreen contains the player, franchise selector, timeline, source settings, and highlights. A theater fallback supports browsers without native fullscreen. Backgrounding pauses replay playback; teardown releases media and polling. HLS uses bounded adaptive buffers and the three-player limit. No heavyweight UI framework or hidden external player SDK is loaded.

## Verification and limits

46 automated checks cover inventory, clock mapping, observed anchors, franchise persistence, shared footage seek, delayed decoding, same-game frame retention, warm-player reuse, bounded pools, source expiry, NFL adapter flow, and private-cookie isolation. The application integration test uses controlled media events, including actual control handlers and calibration-player placement.

Real public source resolution was checked for all 14 replay metadata pages, an official 13-second NFL clip, and the current 25-item NFL playlist. This verifies the adapters, not complete replay playback in a browser. Browser video verification was blocked by a computer-use URL restriction; the Codex preview-opening tool also failed. No restricted CDN URL was fetched through an alternate tool. Network buffering, precise historical alignment before calibration, and commercial-scale third-party provider support remain acceptance/dependency limits.
