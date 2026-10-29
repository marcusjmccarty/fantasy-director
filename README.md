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

**Replay video** imports all 14 catalog records automatically. The server returns the original OK embed URL and the observed recording duration; it makes no upstream media request. The provider loads and plays its own recording in an iframe. The app sends play, pause, seek, mute and volume commands using the interface shipped in the provider’s public player. Messages must match both the exact provider origin and the expected iframe. Optional user-supplied native recordings override imported replays. Quality is chosen inside the provider player.

One shared clock controls day selection, play/pause, seeking, 30-second rewind, next director transition, and 1× provider playback (up to 4× for user-supplied native video). Rapid seeks retain the previous picture and only the latest request can commit. The visible player’s reported playhead drives the clock between seeks, preventing timer drift from repeatedly seeking the active video. The data-only mode reconstructs possessions without video and supports up to 60×.

### Alignment is explicit

The full-game recordings have 35–55 minutes of breaks edited out. They expose no useful chapter or play timestamps. Duration mapping is therefore **estimated**, not proof of exact play alignment. Sources & sync provides the actual player inside the calibration panel: pause on a snap, enter its quarter/game clock, and save the observed video position. Multiple points interpolate across edited sections. Add points after edits to improve accuracy. No fabricated sync anchors are supplied.

## Prepared player handoff

`MediaDeck` holds at most three physical players: the visible picture and two candidates. Replay forecasting looks 75 seconds ahead; live mode warms the next ranked configured sources. A warmed element becomes visible without reloading at the cut. Same-game seeks also use a second physical player so the previous picture remains visible. Generation tickets reject stale requests.

For imported OK replays, readiness requires two advancing `timeupdate` messages close to the shared target, with recent progress. Page load, `inited`, `started`, and seek acknowledgements alone do not pass. `ProviderPlayer` uses `muted=1&silent=1`, parameters recognized by the provider’s shipped player. Commands and playback events come from these public scripts, inspected on October 29, 2026:

- `https://st-ok.cdn-vk.ru/res/js/VideoEmbed_e81omh0a.js`: inbound `play`, `pause`, `seek`, `mute`, `unmute`, `volume` actions.
- `https://st-ok.cdn-vk.ru/res/js/classic_guzj8gbs.js`: parent events with `event`, `time`, `duration`, and error codes.
- `https://st.okcdn.ru/static/one-video-player/0-3-65/one-video-player.js`: cross-origin embed playback events and URL flags.

These versioned implementation interfaces may change and require maintenance. No provider code is bundled or copied into the app. The provider does not expose buffered ranges or decoded-frame callbacks to the parent, so diagnostics report those values as unavailable. Advancing playback is evidence of provider playback, not a guarantee of eight seconds of buffered footage.

The initial provider iframe is visible and clickable while preparing. If autoplay requires a gesture, the viewer can press Play inside it; the shared clock starts only after confirmed progress. A startup timeout preserves that same player and can recover when the viewer starts it. Provider access, deletion, embedding and regional errors are surfaced without attempting to bypass them. Provider preparation has a 45-second ceiling; the complete source attempt has a 50-second watchdog.

Native MP4 and HLS sources retain stronger readiness checks: two seconds of playable buffer for startup and eight seconds for subsequent cuts at the current rate (or the remaining duration of a short clip), completed seeking, usable readyState, and a decoded frame callback or measured video-frame/playhead progress with valid dimensions. Native preparation is capped at 25 seconds. The currently playing picture stays visible when an incoming candidate fails.

These checks reduce empty cuts. They cannot guarantee that a third-party player or network never stalls. Real browser footage acceptance is still required; event simulations and public player source inspection do not establish successful end-to-end playback.

## Integrated NFL highlights

The replay catalog contains **79 official NFL.com clips covering all 14 games**, including short scoring highlights. The source adapter follows NFL.com's normal anonymous playback flow using its public player configuration and returns its short-lived HLS URL unchanged. Anonymous identity tokens remain in server memory. No subscription, DRM, regional, or payment checks are bypassed; restricted clips fail without replacing the current picture.

Short clips are ranked by roster player and team, prepared through the same media deck, and inserted automatically at quiet moments. Urgent roster/red-zone action preempts automatic clips. Manual clips return on completion, Return to game, or the two-minute limit. Incoming games prepare while a highlight plays, and the highlight's last frame stays until the return is ready. Replay highlights are a week-wide test catalog, not timestamp-matched historical inserts.

Live mode refreshes the current NFL.com highlight playlist every five minutes through two bounded public page requests, and checks ESPN summaries independently. A failure at one provider does not suppress the other. These are official NFL.com clips; access to a separately branded NFL Stories collection has not been verified.

## Live, fullscreen, and footprint

Live ESPN scoreboard polling runs every five seconds during games and every 30 seconds otherwise. Stale feed data holds decisions. Users supply their own compatible live stream URLs. Data-feed timing and broadcast delay remain distinct; the app cannot promise to predict televised action.

Fullscreen contains the player, franchise selector, timeline, source settings, and highlights. A theater fallback supports browsers without native fullscreen. Backgrounding pauses replay playback; teardown releases media and polling. HLS uses bounded adaptive buffers and the three-player limit. No heavyweight UI framework is loaded. Imported replay iframes load their provider’s player; native HLS loads HLS.js only when required.

## Verification and limits

64 automated checks cover inventory, clock mapping, observed anchors, franchise persistence, shared footage seek, delayed decoding, same-game frame retention, warm-player reuse, bounded pools, source expiry, NFL adapter flow, and private-cookie isolation. Provider regressions cover origin/frame validation, actual advancing progress, stale timestamps, shared seek commands, clickable first-player startup, prepared iframe reuse, and user-gesture recovery after timeout. Application integration tests exercise the actual control handlers with controlled native media and provider message events. These are deterministic simulations, not real video browser tests.

Real public source resolution was checked for all 14 replay metadata pages, an official 13-second NFL clip, and the current 25-item NFL playlist. That verified the earlier adapters, not complete replay playback. The current replay adapter returns original embeds and no longer extracts signed media URLs. End-to-end browser video verification remains blocked by a computer-use URL restriction; the Codex preview-opening tool also failed. No restricted CDN URL was fetched through an alternate tool. Network buffering, precise historical alignment before calibration, and commercial-scale third-party provider support remain acceptance/dependency limits.
