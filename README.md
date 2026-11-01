# Fantasy Stream

A RedZone-style channel for one fantasy roster. It follows your starters’ teams using possession and field position, favors drives near the end zone, skips detected breaks, and replays missed scores when footage is available. Plain browser JavaScript plus a small Cloudflare Worker; no framework.

## Live site

The channel runs on Cloudflare Workers at **https://fantasy-stream.fantasy-hub.workers.dev** (free plan, one Worker, no other services). Open it on any device; there is nothing to run locally. The page opens in Live games. Choose **Your lineup** in the header, import your ESPN league and select your team (or enter players with the name/team/position form), then paste and save your game links in **Game streams** below the player. Press **Start watching**. **Try a replay** opens the included Week 7 rehearsal. Your lineup takes an ESPN league ID (public leagues need nothing else; a private league needs your own SWID and espn_s2 cookies pasted under the ID).

Redeploy after a change with `npm run deploy` (builds `dist/` and uploads it with the Cloudflare account that `npx wrangler login` authorized; `wrangler.toml` names the Worker).

## Run locally

```bash
npm ci          # pins hls.js (loaded only for HLS live streams)
npm test        # node --test tests/*.test.js
npm run build   # dist/server/index.js + hosting manifest
node scripts/check-build.mjs  # compiled assets/routes; mocked upstream requests
npm run dev     # http://127.0.0.1:4187 (reloads the bundle after each build)
```

Public leagues import with just the league ID. For private leagues, viewers paste their own SWID and espn_s2 under the ID in **Your lineup**. These values are saved in that browser’s local storage and sent to this site’s roster endpoint, which forwards them only to ESPN for the import; the Worker does not persist them. Shared Cloudflare ESPN secrets and caller-supplied identity headers do not authorize public visitors. For an explicitly enabled local preview only, `.sites-runtime/env.json` can provide `ESPN_LEAGUE_ID`, `ESPN_SWID`, `ESPN_S2` and the boolean `"ESPN_LOCAL": true`. Do not commit that file.

## Modes

- **Week 7 replay** – the full 2026 Week 7 slate (14 games, 2,493 timestamped plays, 115 scoring plays) with the original full-game recordings. A deterministic rehearsal of the director: pick a day, press Start, and watch it work. The first visit starts near your lineup’s first action. Historical roster imports and replay lineup edits are kept separate from your saved live lineup; replay-only edits last for the current page session.
- **Live** – ESPN's public scoreboard, polled every 5 s during games, seen through the stream's delay (below). The viewer supplies a stream link per game: a direct MP4/WebM/HLS link (warmed in the background, switched to when ready, muted and unmuted by the channel) or any https page (embedded as-is and loaded only while on screen, since a hidden page would play its own sound; each cut to it reloads the page). Without a link the game is still tracked and its scores still produce alerts and can have replays when matching footage is available, but there is no live picture for it.

## How the channel decides (`web/director.js`)

1. **Your choice comes first.** Select any configured stream in Games & streams, including a game without a fantasy starter. That choice takes priority over ranking and queued highlights until its next detected break, game end, or stream failure. Choose another game at any time; the latest choice wins while loading. A detected video break is never intentionally revealed for a grace period; choose that stream again when it becomes available. Selecting Watch resumes playback from Pause. You can return to automatic switching explicitly.
2. **Roster action in automatic mode.** Rank games using inferred involvement of your starters’ teams; individual substitutions are not tracked. Offensive starters count when their team has the ball on a scrimmage down; kickers only on 4th down at or inside the opponent 42; D/ST when the opponent has the ball. Offense outranks D/ST, then proximity to the end zone wins.
3. **Protect the action.** Avoid cutting during a reported live play or just before the next snap. The existing dwell, margin, debounce and celebration holds remain. Replay video gets additional protection in media seconds through `web/continuity.js`: compressed or expanded alignment segments must not create a tiny viewing window. These are bounded timing estimates, not visual whistle detection.
4. **Leave breaks.** An active roster game fills in first. If all roster games are in breaks or unavailable, another configured game can fill the screen. It does not continue after the roster slate ends. Reported provider ads hide and mute immediately, including while a replacement buffers. Inferred replay breaks wait for the scoring footage to finish and remain remembered through compressed edits. Delayed live scoreboard increases also identify a scoring break when a timeout snapshot is missing. If no eligible video is ready, a waiting screen replaces the break; replays can advance to the next known football play. **Skip this break** handles ads the player cannot report, with a ninety-second exclusion and an Undo control. Pausing preserves that timer. Add optional backup links below the player.
5. **Finish short highlights.** Once a short score clip is visible, finish it before automatic switching. Manual game choices override it. Long or unknown clips have a bounded opening protection window; failed or ad-reporting clips enter recovery. See the audit below for the exact limits and tradeoffs.

The layout separates initial setup, the player, the always-visible game guide, and stream entry. Captions and alerts sit outside the video. The red dot identifies the brand in both modes; the mode label indicates live versus recorded viewing.

## Live games through the stream's delay (`web/live.js`)

A live stream runs 20–90 s behind the real game, and ESPN runs its own way behind it, so the director never looks at the scoreboard as it is now. `LiveFeed` keeps fifteen minutes of scoreboard snapshots and hands the director the one from `delay` seconds ago (Settings → Viewing: set it so the clock below the video matches the scorebug on your stream). Everything then follows the game as the viewer sees it: the rail follows delayed snapshots once the delay buffer has filled, a celebration hold starts when the score is on screen, and a missed score is judged by what was really on screen (with 12 s of slack for the scoreboard's own lag). ESPN logs a play only after the whistle, so a new entry in the delayed feed means the play just ended on screen; the next 18 s are the only safe time to cut away, after which the game is treated as snapping (phase `play`, never left) until a new play is logged or 75 s pass without one (an injury or a review: not a snap).

## Missed scores (`web/coverage.js`, `web/replays.js`)

Coverage records intervals confirmed by controllable players as progressing on screen. Live trackers and generic page embeds cannot confirm watched video, so they do not suppress missed-score replays. Rewinding preserves the union of watched intervals. This is a playback estimate, not video recognition. Nine seconds after any scoring play by one of your starters (scorer, passer, kicker, D/ST, two-point), it checks whether the snap was on screen. If not, the score joins the replay queue. At the next quiet moment (nothing critical anywhere) the channel plays the best footage it has: a matching game-scoped clip, or in archive mode the moment cut from the game’s own recording. Live replays prefer game-specific ESPN clips and can use NFL clips when publication time or explicit season/week metadata, team evidence and score details establish a unique match. Unmatched clips are never assigned by player name alone. Missing footage is retried every thirty seconds for up to thirty minutes after the score; failed clips can fall through to another source. Scores offer a publisher-page link when a clip matches, or an ESPN game-page link when none does. Replay completion requires reaching the end and observing at least 85% of the footage. Buffering and overlapping replay segments do not count twice. Automatic urgency can interrupt a long replay after its opening protection window; an unfinished replay resumes with two seconds of context; an unfinished clip keeps moving until the replacement picture is ready. Published clips use their actual media duration instead of a guessed cutoff. Extra points alone are never replayed.

## Players (`web/players.js`, `web/provider-player.js`, `web/native-player.js`)

Live page embeds (including NTV links) run in a browser sandbox that blocks popup tabs, top-level redirects, browser dialogs, and downloads while allowing the player scripts and media to run. The restriction also applies to nested frames. **Reload stream**, next to Play, reloads only the visible page and preserves your lineup and manual choice. Each game switch starts a fresh recovery window. Third-party overlays or failures inside an embedded page cannot be inspected by Fantasy Stream; use Reload stream or another game link if that page stops working. See [embedded-stream safety](docs/embedded-stream-safety.md) for verification and limits.

**Automatic reconnect** applies to live page embeds from any host, including Stream Corner and NTV. Every two minutes of foreground viewing, the current page is reloaded to recover freezes it cannot report. This also interrupts healthy video; turn it off in **Settings → Viewing** if your source needs another Play click after a refresh. Save the game or channel page URL: reloading a site's homepage can return to its menu. Pages that never finish loading keep retrying after waits of 15, 20, 30, then 60 seconds per attempt, without retiring the selected stream. Reconnects wait through network loss and hidden tabs, stop during **Pause**, and never start hidden players. A restored network triggers a reconnect, limited to once per ten seconds if the connection keeps dropping. Use Fantasy Stream’s **Full screen** button beside Pause: the outer player stays in place while the embedded page reloads. Embedded sites cannot take fullscreen themselves; browsers without native fullscreen use the window-filling view. Exit full screen and Escape remain available.

**A backup for the same game** can now be saved under each game's stream link. Repeated page-loading failures or a direct video's recovery attempt can try that backup without clearing your manual choice, lineup, coverage, or fullscreen. Automatic source changes are spaced at least a minute apart. **Try backup / Try primary** lets you switch immediately when a website's video fails without reporting it. Saving a backup leaves the current source running. Duplicate links are treated as one source.

**Direct live video** uses actual media progress instead of scheduled refreshes. A stall first tries to resume playback and, for live HLS, catch up to the live edge. Persistent stalls, source errors, and unexpected endings reopen the source with backoff or use your saved backup. A failed or hung HLS SDK download can retry without a full site reload. Replay and highlight completion keep their existing behavior. See [site-independent stream recovery](docs/site-independent-recovery.md) for checks and limitations, and [the earlier embedded-stream recovery pass](docs/automatic-stream-recovery.md).

A pool of up to three stacked players: the one on screen plus the next likely game warming silently at the right moment (one at a time, so the picture on screen is never starved of bandwidth). A normal cut swaps to a player confirmed ready. If the first video needs a Play click, it becomes visible after eight seconds while the twenty-second startup deadline remains enforced. Recordings play inside the provider's own embedded player and are driven through the postMessage interface its public player ships (`play`, `pause`, `seek`, `mute`, `volume`; events `inited`, `started`, `resumed`, `timeupdate`, `rewound`, `adShown`, `ended`, `error`). The provider ignores a `play` sent before it is ready and restarts from its own remembered position, so `ProviderPlayer` keeps asking (`bootstrap()`) until two advancing time reports prove the footage is moving at our target; a seek on a moving target is led by the measured seek latency, and a player that goes quiet is nudged (play, then pause/play, then a re-seek) before the channel gives up on that game for a minute. No provider code is bundled; media never leaves the provider.

### Sound

Browsers only let a player go audible inside a user gesture, and the provider's embedded player wedges (footage stops, commands are ignored) when it is unmuted outside one. Every player therefore watches its own unmute: if footage stops within a few seconds it re-mutes itself, keeps the picture moving, and the screen asks for one click. For native clips, **Tap for sound** retries inside that gesture. For the provider, the only gesture its player accepts is a click inside its own frame, so the screen says **Click the video once for sound**: that click pauses the provider's player, the channel asks it to play again, and sends the unmute only once footage is moving (an unmute during that transition is what wedges it). After that one click the channel stays audible across cuts. This is a browser/provider constraint, not a setting.

## Scrubbing

The timeline spans the game on screen by default (a few hours), a 15-minute window for fine scrubbing, or the whole day. Dragging shows the exact time and that game's quarter and clock; ticks mark scores (yours highlighted). −30/+30, Next drive, and ←/→ (10 s, Shift for 60 s) step the clock. A replay pauses while the page is hidden and resumes when it is visible again.

## Replay alignment (`web/sync.js`, `scripts/scorebug-anchors.json`)

The recordings have commercials and halftime edited out, so a straight duration ratio drifts by minutes. `RecordingSync` maps game time to recording time by keeping ordinary snap-to-snap gaps one-to-one and giving each break (timeout, quarter end, after a score, before a kickoff) a solved retention. Every recording is pinned by about two hundred scorebug readings read off its own footage (a frame every 15 s, Vision OCR of the bug; `scripts/scorebug-anchors.json`, one `[seconds, quarter, clock, kind]` per reading). A reading with the clock running pins the second the clock reached that value; a run of identical readings is a stopped clock, and the moment it resumed (the clock difference before the next reading) pins the snap; a lone stopped-clock reading is placed inside its stoppage by the alignment of the pinned ones. OCR slips are rejected three ways: the longest chain of readings whose game clock never runs backwards or faster than the footage, a neighbour test (footage never outruns the game), and a worst-first pass that drops any anchor more than 45 s from what its neighbours predict. Leave-one-out error is under a second at the median and 5–25 s at the 90th percentile per game, which improves approximate snap alignment; the viewer can still add marks in Settings → Replay sync (pause on a snap, enter the quarter and clock), which take priority.

## Data (`scripts/build-archive.mjs`)

Calibrating a recording is automatic: `node scripts/scorebug-ocr/jobs.mjs` resolves each replay's provider embed to its MP4 (signed links that last a day), `swiftc -O -o scripts/scorebug-ocr/frames scripts/scorebug-ocr/frames.swift` builds the sampler (AVFoundation + Vision, macOS), `scripts/scorebug-ocr/run-all.sh` reads the scorebug off a frame every 15 s of every game in parallel (about ten minutes), and `node scripts/scorebug-ocr/parse.mjs` turns the readings into `scripts/scorebug-anchors.json`. Then rebuild the archive:

`node scripts/build-archive.mjs [summaryDir]` rebuilds `web/week7.json` from ESPN game summaries (fetched live, or read from a directory of `<eventId>.json`). Each play carries its wallclock offset, period, clock, type, offense, down, distance, yards to goal (from ESPN's possession text, which is reliable where `yardsToEndzone` is not), score and text. Scoring plays carry the credited players parsed from ESPN's scoring summaries (`web/scoring.js`).

## Server (`server/`)

- `POST /api/league` – ESPN fantasy roster import (starters only; public visitors supply their own cookies for a private league).
- `GET /api/session` – no authenticated account or saved league on the public Worker; an explicitly enabled local preview may return its configured league.
- `GET /api/nfl-source?id=&slug=` – resolves an official NFL.com clip to its short-lived HLS URL through NFL's normal anonymous playback flow; tokens stay in memory.
- `GET /api/nfl-highlights` – the current NFL.com highlight playlist with bounded scoring-page metadata enrichment; polled once a minute during active games and every five minutes otherwise.
- `GET /api/replay-source?id=` – the original provider embed for a catalog game.
- `POST /api/playback-health` – bounded diagnostics, enabled only in the explicit local preview.

## Tests

`npm test` runs 545 tests covering the director, coverage, alignment, scoring parser, archive sampling and play windows, replay matching, live normalization and the delayed live feed, the provider handshake, page embeds and the player pool, full-Sunday rehearsals through the director and the app, and the server endpoints. They are deterministic simulations; real playback still needs a browser with the page in view (the provider's player stops reporting while the page is hidden).

## Reliability checks and live limits

The app-level regression suite covers live startup without the replay archive,
lineup and stream replacement, pause/resume, preserving an imported league,
explicit public-league team selection, and responses arriving after a mode or
lineup change. Director tests also cover excluded streams during a celebration
hold and standby. Import requests accept the supported ESPN cookie lengths and
reject malformed JSON without a server error.

[The highlight playback audit](docs/highlight-playback-audit.md) records reproduced transition failures, their corrections, an interruption/queue rehearsal, and the remaining browser verification boundary.

[The viewing room redesign](docs/viewing-room-redesign.md) describes the NTV-inspired interface, simpler controls, and verification limits.

[The continuity and score-correction audit](docs/continuity-and-score-corrections.md) covers playback races, fair summary polling, corrected/overturned scores, and 25 additional regression checks.
[The live-highlight integration follow-up](docs/live-highlight-integration.md) records the new matching, retry and publisher-page fallbacks, including the provider metadata and real-browser checks still needed.
[The full logic audit](docs/full-logic-audit.md) records the decision order and preceding reproduced defects, fixes, and verification limits.
[The earlier family-readiness audit](docs/family-readiness-audit.md) records the preceding fixes and deployed-baseline browser evidence.
[The earlier logic audit](docs/logic-audit.md) records the original failures, corrections
to the first review, and reproducible comparisons with the pre-review commit.
`node scripts/audit-director.mjs` compares 60,000 eligible-stream decisions with
that original director, including successive decisions and debounce state.

Live decisions infer team possession from a polled scoreboard, not player-level
on-field tracking or video analysis. A single delay setting cannot perfectly
align streams with different delays. Direct MP4/HLS sources must permit browser
playback and, for HLS, cross-origin segment requests. Some website URLs prohibit
embedding, require another Play click after a cut, or show undetectable ads.
The channel cannot bypass those provider restrictions or guarantee every snap.
Before Sunday, use your actual streams in Live games and check picture, sound,
and the stream-delay setting. Automated tests rehearse decision/state behavior;
they do not verify the availability of third-party live broadcasts.

## Latest audit and interface changes

See [Sunday release logic pass](docs/sunday-release-logic.md) for independent scoreboard polling, stricter scoring-break recovery, playable commercial backups, the 545-test result, baseline negative controls, and public highlight delivery checks.

See [viewing room refinement](docs/viewing-room-refinement.md) for the permanent lineup shortcut, always-visible game guide, separate starters/scores sections, compact playback controls, and validation limits.

See [commercial logic follow-up](docs/commercial-logic-follow-up.md) for the Bucs scoring-break reproduction, commercial suppression, regression checks, and remaining detection limits. The [continuity and workspace overhaul](docs/continuity-and-workspace-overhaul.md) records the preceding structural UI and playback work. Earlier audit documents describe their respective historical revisions.
