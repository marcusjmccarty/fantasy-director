# Fantasy Stream

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

## Roster-first direction and breaks

The default **Roster + RedZone fallback** preserves the original behavior: roster possession outranks every unrelated scoring threat. A six-second quiet grace avoids jumping away for a brief pause. Comparable games must offer a meaningful improvement after a 15-second dwell; a new roster possession or roster red-zone opportunity can override that dwell after one second of stability. Fallback candidates settle for three seconds. Dwell starts when the new picture commits. Team aliases and numeric/string team IDs are normalized for possession matching.

**Only my roster’s games** limits automatic choices to games containing the selected starters, including while their team is defending. A day without their games shows an explicit standby; manually pinning any game is still available. Selection persists across reloads. Switching franchises cancels outdated pending choices and re-evaluates the selected starters. The main caption explains roster, defense/kicker, manual-pin, and fallback choices.

Provider `adShown` events exclude that player from cut readiness and freeze its contribution to the shared clock. Ad timestamps/durations cannot overwrite recording position. The latch clears only when content progress with the recording duration resumes. If an active player enters an ad, the director prepares other eligible football or a roster highlight. A player left during an ad finishes the break muted, then pauses once content returns; this keeps it eligible for later selection without restarting its session. This does not remove the provider’s initial preroll or guarantee ad-free playback; a commercial edited into a recording has no ad event. **+30s** advances the shared position by 30 seconds of the visible recording. **Sync this play** opens calibration around the current physical player for observed quarter/clock alignment.

A full 13.7-hour Sunday data rehearsal at two-second intervals with IND/BAL/CHI starters produced 317 decisions that changed the watched game versus 526 with the previous selector, with zero fallback cuts while roster action was eligible. This is a deterministic scheduling comparison, not a measurement of real video cuts or proof of exact footage alignment.

## Prepared player handoff

`MediaDeck` holds at most three physical players: the visible picture, one candidate game, and space for an integrated highlight. Replay forecasting looks 45 seconds ahead and warms one roster-prioritized game every four seconds; live mode also warms one candidate. A warmed element becomes visible without reloading at the cut. Native same-game seeks use a replacement video element, while provider seeks reuse the existing iframe to avoid opening a new provider/ad session. Generation tickets and current-selection guards reject stale requests, including a franchise change during loading. Resuming playback does not resume every hidden player.

For imported OK replays, readiness requires two advancing `timeupdate` messages close to the shared target, with recent progress. Page load, `inited`, `started`, and seek acknowledgements alone do not pass. `ProviderPlayer` uses `muted=1&silent=1`, parameters recognized by the provider’s shipped player. Commands and playback events come from these public scripts, inspected on October 29, 2026:

- `https://st-ok.cdn-vk.ru/res/js/VideoEmbed_e81omh0a.js`: inbound `play`, `pause`, `seek`, `mute`, `unmute`, `volume` actions.
- `https://st-ok.cdn-vk.ru/res/js/classic_guzj8gbs.js`: parent events with `event`, `time`, `duration`, and error codes.
- `https://st.okcdn.ru/static/one-video-player/0-3-65/one-video-player.js`: cross-origin embed playback events and URL flags.

These versioned implementation interfaces may change and require maintenance. No provider code is bundled or copied into the app. The provider does not expose buffered ranges or decoded-frame callbacks to the parent, so diagnostics report those values as unavailable. Advancing playback is evidence of provider playback, not a guarantee of eight seconds of buffered footage.

The initial provider iframe is visible and clickable while preparing. If autoplay requires a gesture, the viewer can press Play inside it; the shared clock starts only after confirmed progress. A startup timeout preserves that same player and can recover when the viewer starts it. Provider access, deletion, embedding and regional errors are surfaced without attempting to bypass them. Provider preparation has a 90-second ceiling to accommodate an initial provider ad; the complete source attempt has a 95-second watchdog. A moving shared timeline is corrected after actual playback arrives, with up to three bounded seek attempts, rather than restarting a load on every poll.

Native MP4 and HLS sources retain stronger readiness checks: two seconds of playable buffer for startup and eight seconds for subsequent cuts at the current rate (or the remaining duration of a short clip), completed seeking, usable readyState, and a decoded frame callback or measured video-frame/playhead progress with valid dimensions. Native preparation is capped at 25 seconds. The currently playing picture stays visible when an incoming candidate fails.

These checks reduce empty cuts. They cannot guarantee that a third-party player or network never stalls. Real browser footage acceptance is still required; event simulations and public player source inspection do not establish successful end-to-end playback.

## Integrated NFL highlights

The replay catalog contains **79 official NFL.com clips covering all 14 games**, including short scoring highlights. The source adapter follows NFL.com's normal anonymous playback flow using its public player configuration and returns its short-lived HLS URL unchanged. Anonymous identity tokens remain in server memory. No subscription, DRM, regional, or payment checks are bypassed; restricted clips fail without replacing the current picture.

Short clips are ranked by roster player and team, prepared through the same media deck, and inserted automatically at quiet moments. Automatic inserts are limited to clips tagged with a selected roster team; other official clips remain available manually. Urgent roster/red-zone action preempts automatic clips. Manual clips return on completion, Return to game, or the two-minute limit. Incoming games prepare while a highlight plays, and the highlight's last frame stays until the return is ready. Replay highlights are a week-wide test catalog, not timestamp-matched historical inserts.

Live mode refreshes the current NFL.com highlight playlist every five minutes through two bounded public page requests, and checks ESPN summaries independently. A failure at one provider does not suppress the other. These are official NFL.com clips; access to a separately branded NFL Stories collection has not been verified.

## Live, fullscreen, and footprint

Live ESPN scoreboard polling runs every five seconds during games and every 30 seconds otherwise. Stale feed data holds decisions. Users supply their own compatible live stream URLs. Data-feed timing and broadcast delay remain distinct; the app cannot promise to predict televised action.

Fullscreen contains the player, franchise selector, timeline, source settings, and highlights. A theater fallback supports browsers without native fullscreen. Backgrounding pauses replay playback; teardown releases media and polling. HLS uses bounded adaptive buffers and the three-player limit. No heavyweight UI framework is loaded. Imported replay iframes load their provider’s player; native HLS loads HLS.js only when required.

## Verification and limits

81 automated checks cover inventory, clock mapping, observed anchors, franchise persistence, shared footage seek, delayed decoding, native same-game frame retention, provider seek reuse, ad-aware readiness, moving-target catch-up, warm-player reuse, bounded pools, source expiry, NFL adapter flow, and private-cookie isolation. Provider regressions cover origin/frame validation, actual advancing progress, stale timestamps, shared seek commands, clickable first-player startup, prepared iframe reuse, and user-gesture recovery after timeout. Application integration tests exercise the actual control handlers with controlled native media and provider message events. These are deterministic simulations, not real video browser tests. Browser request tests enforce the native fetch receiver and verify recovery after a synchronous request failure; both failed against the previous deployed source. Application tests now enforce that receiver rule too.

Real public source resolution was checked for all 14 replay metadata pages, an official 13-second NFL clip, and the current 25-item NFL playlist. That verified the earlier adapters, not complete replay playback. The current replay adapter returns original embeds and no longer extracts signed media URLs. End-to-end browser video verification remains blocked by a computer-use URL restriction; the Codex preview-opening tool also failed. No restricted CDN URL was fetched through an alternate tool. Network buffering, precise historical alignment before calibration, and commercial-scale third-party provider support remain acceptance/dependency limits.

## Browser startup diagnosis

The October 29 browser-request fix binds both source catalogs’ fetch functions to `globalThis`. Previously they invoked native fetch as a catalog method, which browsers can reject before sending a request. Synchronous failures also left a rejected promise in the pending map, preventing Retry from making a fresh attempt. Request execution now starts after the pending entry is installed, so every failure clears it.

Owner-only `/api/playback-health` accepts bounded first-party startup/cut outcomes for troubleshooting (maximum 20 deduplicated reports per page visit). Server-side validation retains only catalog game IDs, stage codes, import counts and player readiness counters. It excludes source URLs, credentials, roster data and free-form messages. The downloadable report additionally includes local source errors and pending source IDs.
