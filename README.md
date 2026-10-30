# Fantasy Stream

A RedZone-style channel for one fantasy roster. It watches every game your starters are in, keeps the picture on whoever is closest to the end zone, skips the breaks, and replays any score you missed. Plain browser JavaScript plus a small Cloudflare Worker; no framework.

## Run

```bash
npm ci          # pins hls.js (loaded only for HLS live streams)
npm test        # node --test tests/*.test.js
npm run build   # dist/server/index.js + hosting manifest
npm run dev     # http://127.0.0.1:4187 (reloads the bundle after each build)
```

Local preview has no ESPN secrets; public leagues import with just the league ID.

## Modes

- **Week 7 replay** – the full 2026 Week 7 slate (14 games, 2,493 timestamped plays, 115 scoring plays) with the original full-game recordings. A deterministic rehearsal of the director: pick a day, press Start, and watch it work.
- **Live** – ESPN's public scoreboard, polled every 5 s during games. The viewer supplies a stream URL (MP4/WebM/HLS) per game; without one the game is still tracked and its scores still produce alerts and replays, but there is no picture for it.

## How the channel decides (`web/director.js`)

1. **Only your players.** A game is a candidate only while one of your starters is on the field. Offensive starters count when their team has the ball on a scrimmage down; kickers only on 4th down at or inside the opponent 42; D/ST when the opponent has the ball. The channel never shows a game that contains none of your roster's teams; between series it stays on a game you have players in, and with nothing on it shows a standby card with the next kickoff.
2. **Closest to the end zone wins.** Offense outranks D/ST; among offenses, fewer yards to goal wins. Inside the 20, or a kick/go-for-it on 4th, is *critical*.
3. **No twitchy cuts.** Never cut while a play is live in a game you care about. Stay 12 s after a cut unless something critical appears. A rival drive must be 10 yards closer to take over. Leaving a live game waits 1.5 s of the same challenger, which absorbs feed jitter. After one of your players scores, stay for the celebration.
4. **Breaks and ads.** Timeouts, quarter ends, halftime and the dead time after a score are *breaks*; the director leaves them. When the visible provider player reports an ad, that game is excluded until the ad ends and the overlay says so.

## Missed scores (`web/coverage.js`, `web/replays.js`)

Coverage records exactly which seconds of which game were on screen. Nine seconds after any scoring play by one of your starters (scorer, passer, kicker, D/ST, two-point), it checks whether the snap was on screen. If not, the score joins the replay queue. At the next quiet moment (nothing critical anywhere) the channel plays the best footage it has: the official NFL.com clip of that play when one matches, otherwise the moment itself cut from the game's own recording. A critical snap elsewhere preempts the replay and re-queues it. Extra points alone are never replayed.

## Players (`web/players.js`, `web/provider-player.js`, `web/native-player.js`)

A pool of up to three stacked players: the one on screen plus the next likely game warming silently at the right moment (one at a time, so the picture on screen is never starved of bandwidth). A cut is a swap between players that are already showing footage, never a fresh load in front of the viewer. Recordings play inside the provider's own embedded player and are driven through the postMessage interface its public player ships (`play`, `pause`, `seek`, `mute`, `volume`; events `inited`, `started`, `resumed`, `timeupdate`, `rewound`, `adShown`, `ended`, `error`). The provider ignores a `play` sent before it is ready and restarts from its own remembered position, so `ProviderPlayer` keeps asking (`bootstrap()`) until two advancing time reports prove the footage is moving at our target; a seek on a moving target is led by the measured seek latency, and a player that goes quiet is nudged (play, then pause/play, then a re-seek) before the channel gives up on that game for a minute. No provider code is bundled; media never leaves the provider.

### Sound

Browsers only let a player go audible inside a user gesture, and the provider's embedded player wedges (footage stops, commands are ignored) when it is unmuted outside one. Every player therefore watches its own unmute: if footage stops within a few seconds it re-mutes itself, keeps the picture moving, and the screen shows **Tap for sound**. Tapping retries inside that gesture, which works for native clips; the provider's player only accepts the unmute from a click inside its own controls (hover the video and use its speaker button). This is a browser/provider constraint, not a setting.

## Scrubbing

The timeline spans the game on screen by default (a few hours), a 15-minute window for fine scrubbing, or the whole day. Dragging shows the exact time and that game's quarter and clock; ticks mark scores (yours highlighted). −30/+30, Next drive, and ←/→ (10 s, Shift for 60 s) step the clock. A replay pauses while the page is hidden and resumes when it is visible again.

## Replay alignment (`web/sync.js`, `scripts/scorebug-anchors.json`)

The recordings have commercials and halftime edited out, so a straight duration ratio drifts by minutes. `RecordingSync` maps game time to recording time by keeping ordinary snap-to-snap gaps one-to-one and giving each break (timeout, quarter end, after a score, before a kickoff) a solved retention. Every recording is pinned by 8–13 scorebug readings taken from the footage (`scripts/scorebug-anchors.json`); between two readings the break retention is solved so both are hit exactly. Readings taken while the game clock was stopped are placed within that stoppage by the running-clock alignment. Leave-one-out error is roughly 30–90 s RMS per game, so a cut can land up to a minute from the snap in the worst stretches; the viewer can add their own marks in Settings → Replay sync (pause on a snap, enter the quarter and clock), which take priority.

## Data (`scripts/build-archive.mjs`)

`node scripts/build-archive.mjs [summaryDir]` rebuilds `web/week7.json` from ESPN game summaries (fetched live, or read from a directory of `<eventId>.json`). Each play carries its wallclock offset, period, clock, type, offense, down, distance, yards to goal (from ESPN's possession text, which is reliable where `yardsToEndzone` is not), score and text. Scoring plays carry the credited players parsed from ESPN's scoring summaries (`web/scoring.js`).

## Server (`server/`)

- `POST /api/league` – ESPN fantasy roster import (starters only; private leagues need the owner's saved credentials, never forwarded elsewhere).
- `GET /api/session` – which saved league the signed-in Site owner may use.
- `GET /api/nfl-source?id=` – resolves an official NFL.com clip to its short-lived HLS URL through NFL's normal anonymous playback flow; tokens stay in memory.
- `GET /api/nfl-highlights` – the current NFL.com highlight playlist, refreshed every five minutes in live mode.
- `GET /api/replay-source?id=` – the original provider embed for a catalog game.
- `POST /api/playback-health` – owner-only, bounded diagnostics.

## Tests

`npm test` runs 303 tests covering the director, coverage, alignment, scoring parser, archive sampling, replay matching, live normalization, the provider handshake and player pool, a full-Sunday rehearsal, and the server endpoints. They are deterministic simulations; real playback still needs a browser with the page in view (the provider's player stops reporting while the page is hidden).
