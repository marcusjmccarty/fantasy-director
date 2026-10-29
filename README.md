# Fantasy Director

A minimal fantasy-football viewing room with franchise selection, a full-week replay lab, and fullscreen controls. Plain browser JavaScript and a dependency-free Cloudflare Worker. No framework, player SDK, fonts, or analytics in the initial page. The YouTube SDK loads only when a playable highlight is requested.

## Run

- `npm test` — director, archive, player concurrency, roster endpoint, and application interaction checks.
- `npm run build` — generates `dist/server/index.js` with the app's assets.
- `npm run dev` — http://127.0.0.1:4187 (local preview has no private ESPN secrets).

## League and franchise selection

POST `/api/league` with a numeric `leagueId`. The response contains all franchises and their starters, without member/contact data. The persistent selector chooses any franchise; refreshing keeps that selection. Replay lab requests ESPN scoring period 7; Live requests the current period. The returned period is shown in the roster panel. Bench and IR are excluded. Player involvement is inferred from team possession and position, not individual snap tracking.

Public leagues work without credentials. The owner's configured private league uses saved credentials only when the Site-scoped identity and league ID both match. Runtime secrets: `ESPN_OWNER_ID`, `ESPN_LEAGUE_ID`, `ESPN_SWID`, `ESPN_S2`. `ESPN_OWNER_ID` must be the identity supplied by Sites dispatch, never the account UUID. GET `/api/session` exposes only the current visitor identity and authorized saved league ID, with no-store caching. Cookies are never sent to the browser, logged, or followed through upstream redirects. Browser storage contains franchise rosters, preferences and source URLs; no ESPN cookies.

## Replay lab

The fixed archive is **2026 Week 7, October 22–26**, the previous completed week when this feature was built. It deliberately stays fixed for repeatable regression testing. `web/week7.json` contains 14 games, their original NFL-Video pages/OK embed URLs, and 2,493 timestamped ESPN plays in about 120 KB. One play without a timestamp is omitted. Each game retains its ESPN summary provenance URL. No game footage is copied or hosted.

Three picture modes make source capabilities explicit:

- **Timeline test:** reconstructs all 14 game states from archived wallclock events. Works without live games or external video. Choose Thursday, Sunday, or Monday; play/pause, seek backward or forward, skip 30 seconds, advance to the next director switch, or run at up to 60×. The field display is visibly labeled as recorded play-by-play, not footage.
- **NFL-Video replay:** all 14 full-game embeds are imported. Pin a game to watch it. These opaque external players provide no verified parent API for seeking, buffered readiness, or decoded frames. Automatic cuts and shared video seeking are therefore disabled in this mode. Provider availability and player controls remain external.
- **Synced recordings:** accepts direct HTTPS MP4/WebM or browser-native HLS sources. A shared wallclock maps each recording to kickoff; optional sync marks correct offsets and edited breaks. The active source and at most two candidate players load. Speed is capped at 4×. Pausing permits manual player calibration; Sources & sync records the matching media time.

`replay-engine.js` reconstructs possession, down, distance, and scoring threats with binary search. Play boundaries and breaks are inferred from the recorded feed (including an eight-second transition window); they are not measured broadcast timestamps. Native video alignment still requires calibration against the actual recording. Selecting a different franchise reroutes immediately. When no roster player is involved, the director favors the nearest end zone; small differences get hysteresis to avoid thrashing.

## Native player handoff

`MediaDeck` prepares a candidate muted, seeks to the shared clock, waits for at least three seconds buffered (or the remaining clip duration), checks usable readyState and seek completion, then waits for a decoded frame. Only then does it reveal the candidate and mute/pause the old source. Generation tickets prevent stale preparation from overriding a newer seek. Warm and requested preparation cannot race on a slot. Failed sources back off; retries also occur on an explicit play/seek. The prior picture remains visible while the next source prepares.

This reduces avoidable cut-time buffering, but cannot guarantee uninterrupted playback when the active host or network stalls. External iframes and YouTube cannot use this native buffering gate. No HLS JavaScript library is shipped; HLS is limited to browsers with native support.

## Highlights

The replay catalog includes official NFL YouTube embeds and NFL.com story links. Playable embeds can enter automatically at quiet moments and return to the game on urgent roster/red-zone action. Manually selected highlights play until completion, Return to game, or the two-minute queue limit. Automatic clips are disabled at replay speeds above 4×. YouTube is visible before scripted playback; it is never secretly autoplayed or prebuffered. Provider restrictions, ads, loading and autoplay still apply.

NFL.com story pages inspected for this build do not publish a usable direct media source. Those stories remain honest source links, separate from the playable queue. A licensed publisher media feed would be needed for dependable automatic NFL Stories playback. Live mode discovers playable direct ESPN summary clips and applies the native handoff gate.

## Live and fullscreen

ESPN scoreboard polls every five seconds during live games and every 30 seconds otherwise. Stale feed data holds automatic decisions. Highlights use bounded summary polling. Feed and broadcast latency are separate, and the feed cannot guarantee prediction before the televised play.

The entire viewing room enters fullscreen: video, franchise, day/seek/speed controls, roster, highlights and source calibration. A theater fallback covers browsers that cannot enter native fullscreen. Backgrounding pauses replay playback; page teardown releases players and polling.

## Verification

36 automated checks cover historical inventory, deterministic seek, franchise persistence across refresh, roster-dependent decisions, sync-mark interpolation, bounded player pools, decoded-frame gating, delayed callbacks, warm/request races, retry backoff, private-cookie isolation and upstream failures. Browser QA observed all 14 games and a real Next switch jump. The previously deployed private league import was observed signed in. Final native-video and fullscreen browser verification was interrupted by a computer-use URL restriction, so it is not certified here. Test doubles verify asynchronous player logic; they cannot certify third-party host playback or eliminate network buffering.
