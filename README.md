# Fantasy Stream

A viewing room for NFL, NBA, NHL and MLB streams, with ESPN fantasy rosters and matchup tracking. The NFL channel provides RedZone-style coverage for one fantasy roster. It follows your starters’ teams using possession and field position, favors drives near the end zone, skips detected breaks, and replays missed scores when footage is available. Plain browser JavaScript plus a small Cloudflare Worker; no framework.

## Live site

The channel runs on Cloudflare Workers at **https://fantasy-stream.fantasy-hub.workers.dev** (free plan, one Worker, no other services). Open it on any device; there is nothing to run locally. The page opens in Live games. Choose **Connect ESPN** in the fantasy scoreboard below the player, import your league, and use **Change fantasy team** to select a franchise (or use **Choose players** to enter a manual lineup), then paste and save your game links in **Game streams** below the player. Press **Start watching**. **Try a replay** opens the included Week 7 rehearsal. Your lineup takes an ESPN league ID (public leagues need nothing else; a private league needs your own SWID and espn_s2 cookies pasted under the ID).

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
4. **Leave breaks.** An active roster game fills in first. If all roster games are in breaks or unavailable, another configured game can fill the screen. In live mode, RedZone-style coverage continues among your saved streams whenever no starters are active, including before or after their games. It favors the closest scoring chance, preserves plays and manual choices, and returns to active fantasy players first. Reported provider ads hide and mute immediately, including while a replacement buffers. Inferred replay breaks wait for the scoring footage to finish and remain remembered through compressed edits. Delayed live scoreboard increases also identify a scoring break when a timeout snapshot is missing. If no eligible video is ready, a waiting screen replaces the break; replays can advance to the next known football play. **Skip this break** handles ads the player cannot report, with a ninety-second exclusion and an Undo control. Pausing preserves that timer. Add optional backup links below the player.
5. **Finish short highlights.** Once a short score clip is visible, finish it before automatic switching. Manual game choices override it. Long or unknown clips have a bounded opening protection window; failed or ad-reporting clips enter recovery. See the audit below for the exact limits and tradeoffs.

Every page has the same three parts and fits one screen with nothing to scroll: the header, a strip of game tiles under it, and the picture with your matchup beside it. Captions and alerts sit outside the video. The red dot beside the name identifies the brand; a small static dot on the Live switch marks live viewing.

## Live games through the stream's delay (`web/live.js`)

A live stream runs 20–90 s behind the real game, and ESPN runs its own way behind it, so the director never looks at the scoreboard as it is now. `LiveFeed` keeps fifteen minutes of scoreboard snapshots and hands the director the one from `delay` seconds ago (Settings → Viewing: set it so the clock below the video matches the scorebug on your stream). Everything then follows the game as the viewer sees it, and a missed score is judged by what was really on screen (with 12 s of slack for the scoreboard's own lag).

ESPN's scoreboard is read with its quirks in mind:

- **Plays.** ESPN logs a play only after the whistle, so a new entry in the delayed feed means the play just ended on screen. The next 18 s are the safe time to cut away; after that the game is treated as snapping (phase `play`, never left) until a new play is logged or 75 s pass without one (an injury or a review, not a snap). When the last three plays came less than 30 s apart the offense is in tempo and the safe window shrinks to its cadence. A synthesized play phase carries no play type, so on 4th down the director judges a kick, a punt or a go by field position, never by the previous play.
- **Timeouts.** ESPN keeps a timeout (or the end of a quarter) as "the last play" until the next whistle, which used to hide every first play after a stoppage. The break now ends the moment the game clock runs down within the same period (two seconds or more, so a settle does not count), or after 180 s without any sign of football; the first play back is protected like any other.
- **Scores.** A fresh score stays on screen for 20 s (the celebration, the replay, the try) before the game counts as a break; the one try that follows a touchdown (an extra point or two-point conversion, up to three minutes later) does not restart the celebration, and a manual choice of that game is released only when the break begins.
- **Lost possession.** A snapshot without possession is a gap in the feed for the first 12 s; the last known situation stands until it is a real stoppage.
- **Stale data.** When ESPN has not answered for 45 s, the director holds the picture it has instead of acting on a frozen snapshot. Time ESPN was silent never ages a game into a stoppage, the first snapshot after a gap of more than 90 s starts fresh instead of reporting old scores and plays as new, and a game a response leaves out stays in the feed for 60 s.

## Missed scores (`web/coverage.js`, `web/replays.js`)

Coverage records intervals confirmed by controllable players as progressing on screen. Live trackers cannot confirm watched video, and a generic page embed confirms it only after a recent click inside its current page; otherwise neither suppresses missed-score replays. Rewinding preserves the union of watched intervals. This is a playback estimate, not video recognition. Nine seconds after any scoring play by one of your starters (scorer, passer, kicker, D/ST, two-point), it checks whether the snap was on screen. If not, the score joins the replay queue. At the next quiet moment (nothing critical anywhere) the channel plays the best footage it has: a matching game-scoped clip, or in archive mode the moment cut from the game’s own recording. Live replays prefer game-specific ESPN clips and can use NFL clips when publication time or explicit season/week metadata, team evidence and score details establish a unique match. Unmatched clips are never assigned by player name alone. Missing footage is retried every thirty seconds for up to thirty minutes after the score; failed clips can fall through to another source. Scores offer a publisher-page link when a clip matches, or an ESPN game-page link when none does. Replay completion requires reaching the end and observing at least 85% of the footage. Buffering and overlapping replay segments do not count twice. Automatic urgency can interrupt a long replay after its opening protection window; an unfinished replay resumes with two seconds of context; an unfinished clip keeps moving until the replacement picture is ready. Published clips use their actual media duration instead of a guessed cutoff. Extra points alone are never replayed.

## Players (`web/players.js`, `web/provider-player.js`, `web/native-player.js`)

Live page embeds (including NTV links) run in a browser sandbox that blocks popup tabs, top-level redirects, browser dialogs, and downloads while allowing the player scripts and media to run. The restriction also applies to nested frames. **Reload stream**, next to Play, reloads only the visible page and preserves your lineup and manual choice. Each game switch starts a fresh recovery window. Third-party overlays or failures inside an embedded page cannot be inspected by Fantasy Stream; use Reload stream or another game link if that page stops working. See [embedded-stream safety](docs/embedded-stream-safety.md) for verification and limits.

**Automatic reconnect** is off by default: a healthy page is never interrupted. Turn it on in **Settings → Viewing** for a site that silently freezes; every two minutes of foreground viewing the current page is then reloaded, which may need another Play click. Save the game or channel page URL: reloading a site's homepage can return to its menu. Pages that never finish loading keep retrying after waits of 15, 20, 30, then 60 seconds per attempt, without retiring the selected stream. Reconnects wait through network loss and hidden tabs, stop during **Pause**, and never start hidden players. A restored network triggers a reconnect, limited to once per ten seconds if the connection keeps dropping. Use Fantasy Stream’s **Full screen** button beside Pause: the outer player stays in place while the embedded page reloads. Embedded sites cannot take fullscreen themselves; browsers without native fullscreen use the window-filling view. Exit full screen and Escape remain available.

**A backup for the same game** can now be saved under each game's stream link. Repeated page-loading failures or a direct video's recovery attempt can try that backup without clearing your manual choice, lineup, coverage, or fullscreen. Automatic source changes are spaced at least a minute apart. **Try backup / Try primary** lets you switch immediately when a website's video fails without reporting it. Saving a backup leaves the current source running. Duplicate links are treated as one source.

**Direct live video** uses actual media progress instead of scheduled refreshes. In automatic mode a direct link that has shown no footage for 45 s is set aside for five minutes (the backup link is tried first, then the game tracker shows the game); **Reload stream** retries it at once. A game you chose yourself keeps recovering for as long as you stay on it. A stall first tries to resume playback and, for live HLS, catch up to the live edge. Persistent stalls, source errors, and unexpected endings reopen the source with backoff or use your saved backup. A failed or hung HLS SDK download can retry without a full site reload. Replay and highlight completion keep their existing behavior. See [site-independent stream recovery](docs/site-independent-recovery.md) for checks and limitations, and [the earlier embedded-stream recovery pass](docs/automatic-stream-recovery.md).

**Embedded-page switching** detaches outgoing stream documents before opening the incoming page, including returns to an older player slot. Each new navigation gets a fresh iframe, so a delayed load event from a previous page or blank document cannot mark the new request ready. Repeatedly selecting the current game leaves its frame running. Media permissions cover redirected and nested origins, while popup/navigation restrictions and outer fullscreen remain in place. See [the embedding switch audit](docs/embedding-switch-audit.md).

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
- `GET /api/nfl-replays?week=` – the week's full-game replay videos from nfl-video.com (listing → game page → Watch page → ok.ru embed), cached twelve hours.
- `GET /api/replays?sport=` and `GET /api/replays/resolve?url=` – the NBA/MLB replay listing (three pages) and the players a listed game page embeds.
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

**November 5: first-draft pass.** Replays now play inline on every league through ok.ru: `server/replays.js` lists basketball-video.com, hockeyreplays.com and mlblive.net, follows a game page's Watch buttons in page order, and skips condensed games and highlights. Strips run oldest to newest and open on the newest. NTV answers a sandboxed frame with its own error page, and so does the player behind it, so live NTV games open in a new tab with the game tracker in the channel; a pasted direct-video link still plays inline with automatic cuts. Without the sandbox NTV's player opens a pop-up on each click, so ours stays on. The first screen plays something with one click, the Fantasy team window keeps ESPN cookies in a closed private-league step with a forget-my-login button, wording is plain, and links carry a preview image.

**Each season.** The replay listings are fixed to one season: edit the paths in `server/replays.js` (`nfl-video.com/2026`, `basketball-video.com/2026-27`) and deploy when a new season starts. Playoff games have no replays yet; their tiles follow on the game tracker.

**November 5: first draft for friends and family.** NTV answers a sandboxed frame with its own error page, so NTV games now open on NTV's site in a new tab, and our frames stay sandboxed. Live video inside the page therefore needs a pasted direct link; without one the channel follows games on the game tracker with a link to the video. Replays that never show footage on a device offer the video's own page instead of hopping from game to game.

**November 4, night: replays that play, safeguards, speed.** NFL Replay works on every week: a game's recording length is now learned from the player instead of an 11,000-second guess being kept as fact (which put seeks on the wrong footage and left the player stuck in an ad), a recording that really ends hands over to the tracker instead of looping, and a replay you started is never switched away when the latest week arrives. `/api/nfl-replays` finds all 121 games of Weeks 1–8; its walk reads the week most of a listing page is about, because every page's sidebar links older games. The latest week builds when Replay opens rather than on every Live load. MLB replays play on ok.ru. The NBA replay hosts answer 404 to a sandboxed frame, so those open on their own page in a new tab, and our player frames stay sandboxed. The audit's verified fixes also cover ESPN outages and laptop wake (no false breaks or celebrations), one-poll gaps, needless cuts between drives, false muted starts, and recovery on the league pages. Streams on NBA/NHL/MLB edit in place in each row, an empty league week shows its replays in the strip, and the arrows move a full step each click. Rendering dropped from about 25 ms to about 3 ms a frame by memoizing past tiles, and assets revalidate with ETags. Cloudflare's Cache API wraps the slow replay routes, but it does nothing on a workers.dev address, so `/api/nfl-replays` also sets a browser cache lifetime.

**November 4, later: the season in the strip, replays found for you.** The games strip runs edge to edge; the "Games · updated" heading is gone (a small refresh button sits in the strip's corner) and the strip now reaches back through the season: every earlier week's finals (NFL) or the last seven days (NBA/NHL/MLB) sit to the left of this week under a week or day label, and the page opens scrolled to today. A past NFL tile opens that week's replay at the game's kickoff; a past NBA/MLB tile opens its listed replay. Past weeks are one small record per game, cached per season in the browser (about 35 KB for eight weeks) and dropped when a new season starts. The NFL replay's Week menu lists every week of the season: a week is built from ESPN play-by-play on first use, and its videos come from `GET /api/nfl-replays?week=N`, which walks nfl-video.com's listing, follows each game's Watch page and keeps the ok.ru embed it carries (cached twelve hours; eleven of fourteen Week 8 games had a video at launch). In the matchup, player rows are taller with the name, game line and points at ESPN's weight, the starters fill the panel and the bench continues straight below with no gap. The replay Options popover opens above its button instead of pushing the controls down, and the close icons in dialogs are drawn larger in the same buttons.

**November 4: stable playback, chat, replays for every league.** The stall every few minutes was the channel itself: at every break it blanked the website player and reloaded it afterwards, and NTV's player wants a click on every fresh load. A website player now stays on screen through breaks, dimmed with a one-line reason, and the channel only leaves it for a game where one of your starters is on the field. Highlights play as a muted inset over it instead of unloading it. The load-retry loop waits 45, 60 and 90 seconds, tries another source only if the page never loaded, then stops and asks for a Reload; a click inside the page counts as proof of life and silences the loop for ten minutes; a connection blip under five seconds is ignored. The live feed now treats a kickoff or punt as a break until the clock moves (the second commercial after a score), a 75-second silence as a stoppage, and waits ten seconds of feed time before trusting a new play, so a stream running further behind than the delay setting still leaves the commercial. The periodic website-player reload is off on every page.

Every league page has three rail tabs: Matchup (starters fill the panel, the bench scrolls below in the same columns), Highlights (ESPN's clips from your players' games, playable in place on NBA/NHL/MLB) and Chat. The chat is a room per league (or a public lounge per sport before a league is connected), served by a Durable Object with its last 300 lines in SQLite and WebSocket fan-out, falling back to polling where sockets are blocked; scoring plays are posted to the league room once, however many viewers see them. Names are 24 characters, messages 400, thirty a minute per client. The Fantasy team dialog is three fields (league ID, SWID, espn_s2), your team and the players the channel follows. The games strip lost its All/Mine filter and the NBA/NHL/MLB day picker; an empty day looks ahead to the next day with games. NBA, NHL and MLB have a Replay mode fed by basketball-video.com, hockeyreplays.com and mlblive.net; the NFL Replay defaults to the latest completed week, built from ESPN play-by-play on first use and cached in the browser, running on the game tracker until you paste each game's ok.ru replay link in Streams (the sites' Watch buttons go through redirect pages this project does not follow); Week 7 stays as the calibrated archive.

**November 3: calmer and simpler.** The palette is down to gold (yours), slate (theirs), green (in play) and red (live or urgent), with fainter team tints on the tiles. The matchup shows every starter and both benches with no inner scrolling; the rail grows if a very large roster needs more room. The "Behind by" sentence is gone, and a status line appears only when something needs attention. Refresh lives with the update time in the games strip. Streams is one list with one source control per game, and My link opens the field for your own link. Fantasy team leads with your team, then a compact list for the ESPN league and the players the channel follows; before connecting it shows only the connection form. The dot on the Live switch is red only while a game in that league is in progress. ESPN bench and IR players are now returned with `bench: true` and never count toward totals.

**November 1 night: one strip, one rail, every league.** The game list beside the picture is gone; everything it did now lives in the tiles across the top. Each tile is tinted with both teams' colors and shows their logos, the score, a status tag (On air, Red zone, Driving, Defense, Break, Later, Final), the drive or game situation with a progress bar, your players in that game, and a chip that names the stream source or adds one. Tapping a tile watches it; tapping the chip opens Streams at that game. The space beside the picture holds the matchup as a scorebug: your total in gold on the left, your opponent's in violet on the right, a share bar between them, then starters slot by slot with short names in a narrow column. Highlights keep their tab. The Streams, Fantasy team and Settings dialogs open at full height in Safari (their inner layout no longer collapses), and `#streams`, `#team` and `#settings` links open them directly. NBA, NHL and MLB use the same header, tiles and rail, with the TV network on each tile, a countdown to tip-off, puck drop or first pitch, and the winning margin on finals. Their day picker is gone: an empty day shows the next day that has games.

**November 1 evening: the viewing room, rebuilt.** The header carries the Live/Replay switch (gold when selected) and the sport tabs on the left; on the right a live matchup pill (your score against your opponent's), Streams with a count of games ready to play, the Fantasy team button and settings. Under it, a league strip shows every score at a glance (All or just your games). The picture leads; beside it the guide has two tabs, Games and Highlights, and each game card says where its stream comes from, so tapping it opens Streams right at that game. Streams is a dialog instead of a long form: per game, a one-tap choice of Automatic, NTV, StreamCorner or your own link, with only games still to watch listed. The matchup below the picture is one head-to-head table (your starter against the opponent's starter in the same slot) next to a score summary with a share bar, about half the height of the old two tables; on phones names shorten to "J. Daniels". The Fantasy team dialog is three things: the ESPN league (one field that also accepts a pasted league link, with private-league cookies tucked behind a toggle), your team, and the players the channel follows. Full screen keeps its controls at the top center, clear of scorebugs and player controls. Website-player refresh, whose old default was saved in many browsers, is reset to off once.

**November 1 audit and redesign.** Four independent auditors (logic, safeguards, video, ESPN) reported 54 findings and skeptics confirmed the high-severity ones; the fixes are the live-feed rules above (timeouts, celebrations, lost possession, tempo, 4th-down inference, stale data), reconnect off by default, dead direct links set aside instead of the whole game, ESPN cookies kept only after a successful import, a sandboxed replay player frame, a per-IP rate limit and a same-site check on the API routes, a permissions policy on every page, sanitized NFL error messages, correct NBA and NHL lineup slot tables, and summaries of finished games polled every ten minutes instead of every 25 s. The page is laid out as one stylesheet: the picture with its ticker, the game guide beside it, the fantasy scoreboard below both, then lineup and highlights, with stream setup last; the Live switch carries a red dot.


See [Sunday release logic pass](docs/sunday-release-logic.md) for independent scoreboard polling, stricter scoring-break recovery, playable commercial backups, the 545-test result, baseline negative controls, and public highlight delivery checks.

See [viewing room refinement](docs/viewing-room-refinement.md) for the permanent lineup shortcut, always-visible game guide, separate starters/scores sections, compact playback controls, and validation limits.

See [commercial logic follow-up](docs/commercial-logic-follow-up.md) for the Bucs scoring-break reproduction, commercial suppression, regression checks, and remaining detection limits. The [continuity and workspace overhaul](docs/continuity-and-workspace-overhaul.md) records the preceding structural UI and playback work. Earlier audit documents describe their respective historical revisions.

See [fantasy matchups](docs/fantasy-matchups.md) for the head-to-head scoreboard, league team selector, all-game stream links, and live RedZone fallback.

See [live connection and fullscreen fixes](docs/live-connection-fixes.md) for visible
team controls, roster loading and reconnect states, non-overlapping guide layout,
and video-focused fullscreen. The embedded provider's own fullscreen button is
now permitted; it can isolate its video, whereas our button expands the entire
saved frame with compact controls. Provider fullscreen can end on a game switch
or reconnect; the channel retains a fullscreen-layout fallback.

## Basketball, hockey and baseball

Use the NBA, NHL or MLB tabs for daily game tiles, scores, a day picker,
per-game primary/backup links and ESPN fantasy connections. Open **Fantasy team**,
paste your league ID or league link (the season is read from the link when
present), then choose your team. Sport profiles and links are independent; NFL
settings are preserved.

Points leagues show official matchup totals and actual scoring-day player
points. Category/rotisserie leagues show rosters and link to ESPN for category
standings. Automatic selection follows starters' teams at reported breaks; it
does not detect individual substitutions. All sports reuse the stream recovery,
Pause and fullscreen adapters. See [multisport viewing room](docs/multisport-viewing-room.md)
for supported behavior and verification limits.
