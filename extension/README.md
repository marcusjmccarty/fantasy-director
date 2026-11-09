# Fantasy Stream 3.2

See [README.txt](README.txt) for the unified extension and update instructions.

## Original desk reference

### Fantasy Director desk

A local Chrome extension that follows your fantasy roster, switches to scoring threats between possessions, and inserts published highlights during quiet stretches.

## Start here

**Update:** Stop the old director. Unzip this package, replace the files in your installed Fantasy-Director folder, click **Reload** at `chrome://extensions`, and reopen the desk. Confirm **3.2.0**. Keep only one copy enabled. This download does not replace your installed files automatically.

**Test now:** Click **Rehearse now · no games needed** near the top of the desk. No league, stream subscriptions, or network connection is required for the rehearsal itself.

**Watch games:** Sign in to ESPN in the same Chrome profile, connect and select your fantasy team, or choose **NFL RedZone**. Start your subscribed game streams, assign their tabs, test a switch, then **Start Auto**. Include non-roster games for fallback coverage. Leave offsets at zero if switching is late.

Chrome 120+ is required. There is no server, build step, package installation, analytics service, or runtime framework.

## Automatic highlights

**Automatically play highlights during quiet stretches** is enabled by default. After five seconds without a protected live opportunity, Auto can prepare one eligible clip. Your live stream continues while the clip loads. The director then switches to its small replay player, mutes managed live streams, plays the clip, and returns to coverage when it ends.

- Roster involvement, red-zone threats, unknown possession in an active assigned game, Watch previews, and manual locks protect live coverage.
- A new roster or scoring opportunity interrupts an **automatic** replay. A clip you explicitly select remains your manual viewing choice.
- Automatic clips are at most 90 seconds, with a two-minute interval between replays during live viewing. Old, expired, embargoed, restricted, attempted, and already-played clips are excluded. Live viewing uses clips published within 30 minutes; off-hours queue mode can use recent clips from the last 48 hours.
- Only MP4 sources actually published in ESPN's feed and accepted by the media allowlist are loaded. Unsupported clips retain their ESPN links; no media URL is guessed.
- One replay tab is reused. No clip is prefetched while idle. Ending, skipping, or interrupting a clip unloads its media source. Failures and stalls return control instead of leaving you on an empty player.
- Browser autoplay with sound may be blocked. The player retries muted and offers **Enable sound**. That is a browser interaction requirement, not a click required for each highlight. Browser settings may still require another interaction later.
- **Play highlight queue** runs available playable clips without a league or assigned streams. It waits for more when the queue is empty; **Stop** ends it.
- **Watch on ESPN** and source links remain available for clips without supported inline playback.

Published clips can lag the actual play. The player does not bypass expired links, authentication, geographic restrictions, or protected media. It provides no NFL broadcasts.

## Rehearse any day

The 72-second rehearsal opens four **local test channels** and uses the same worker messages, ranking engine, tab router, replay player, and Stop controls as live operation.

| Time | Scripted situation |
| --- | --- |
| 0–8 seconds | Chicago roster possession |
| 8–16 | A new Philadelphia roster drive |
| 16–24 | No roster involvement; San Francisco goal-line fallback |
| 24–40 | Quiet coverage; an original six-second local test video enters the replay queue |
| 40–50 | Indianapolis roster action returns |
| 50–58 | Simulated feed outage; cuts hold |
| 58–72 | Feed recovery and another roster drive |
| 72 | Test stops; results remain visible in the activity log |

This is fictional data and original synthetic video, clearly labeled. It does not contact ESPN or control your existing game tabs. The local channels test actual browser tab activation when you run it; they are not NFL video streams. The test video is silent, so it does not validate audible commentary.

**Run again** restarts the scenario. **Exit rehearsal** closes only test tabs that still belong to the test, restores your previous league and assignments, and leaves Auto stopped. A test tab you navigate elsewhere is left alone. Settings are unavailable during rehearsal to preserve the live setup.

## Lightweight by design

The application uses plain JavaScript, system fonts, native video, and no third-party runtime packages. The desk itself contains no embedded stream players.

- Unchanged game, roster, highlight, and activity panels are not rebuilt.
- Hidden desks do not repaint. Detailed diagnostics update their contents when expanded.
- Routine desk messages include only the selected roster's player details and the latest timing sample/cut.
- Zero-offset viewing retains no game-history buffer. Positive offsets retain a bounded buffer only while needed.
- Steady-state session checkpoints occur about every 30 seconds; cuts and important transitions persist immediately.
- Detailed highlight queries run separately, one game per pass, with slower checks after games finish.
- An idle stopped desk does not poll periodically. Initial opening or explicit refresh still fetches the current board.
- The replay player loads one selected clip and releases it afterward.

The runtime HTML/CSS/JavaScript is about **129 KB uncompressed**, plus a **61 KB offline test video**. Tests and documentation are not loaded by Chrome.

In a deterministic three-minute workload, serialized session writes fell from **4,829,685 to 197,124 bytes**, and the desk payload fell from **35,052 to 12,437 bytes**. These are data-volume measurements, not CPU, memory, or battery benchmarks. The subscribed provider tabs still have their own video-decoding and page costs. See `PERFORMANCE.json`.

## Controls and limits

**Watch** is temporary. **Lock** lasts until **Resume Auto now**. **Stop** restores captured mute and tab-discard settings. Emergency shortcut: **Option/Alt + Shift + S**; Chrome's shortcuts page can change it.

Auto infers roster involvement from team possession and player position. It does not know whether a specific WR/RB/TE is on the field for an individual snap. Only assigned, available streams participate in live cuts. Five-second polling is a target; ESPN publication, network errors, rate limits, browser suspension, provider buffering, and fullscreen behavior can add delay.

The extension does not inject scripts into or reload streaming-provider pages. Start each provider's playback yourself. Use a dedicated viewing window if automatic focus changes would interrupt other work.

Keep stream offsets at **0** when cuts are late. Positive offsets help only when data leads that stream's video; they cannot make a late source earlier. More detail is in [TIMING.md](TIMING.md).

## Credentials and permissions

Existing ESPN sign-in cookies are used in your browser. Optional cookie import writes only to Chrome's ESPN cookie store and clears the form. Credentials are not included in this package, local extension settings, or exported timing reports. Forgetting league data does not sign out of ESPN.

Permissions remain tabs, storage, alarms, cookies, and offscreen, with ESPN-only host access. Native media sources are limited by the extension's content security policy. No new content-script or all-sites permission is added.

## Validation

**91 checks passed**, including actual worker-thread execution with mocked HTTP, automatic replay selection, muted fallback, completion and failure cleanup, live preemption, off-hours queue mode, full rehearsal sequencing, setup restoration, storage budgets, and previous timing regressions. The WebM test asset's container and all 60 VP8 frames were checked.

```sh
npm test
node tests/performance-benchmark.js
node tests/latency-benchmark.js
```

Node.js 22+ runs the tests. Pillow is needed only to regenerate the original test video with `python3 tests/generate-test-clip.py`; the included video needs no Python.

The Chrome APIs and media element are mocked in integration tests; the worker-thread tests execute the actual worker module. This package has not been installed or tested against actual provider playback here. Running the included rehearsal is the next browser-level acceptance check. Live NFL source latency still needs a live session.

The published ESPN feed was inspected for MP4 source links and expiry/device metadata. Chrome's [autoplay documentation](https://developer.chrome.com/blog/autoplay/) informs the sound fallback. No autoplay protections are disabled.

## Source layout

| Files | Responsibility |
| --- | --- |
| `engine.js`, `adapters.js` | Pure ranking, cut decisions, ESPN normalization |
| `feed.js`, `feed-worker.js`, `offscreen.*` | Cancellable feed, timing, worker host |
| `coordinator.js`, `background.js`, `tab-router.js` | Session coordination and browser control |
| `highlights.js`, `replay-policy.js` | Published media, relevance, replay eligibility |
| `replay.html`, `replay.js`, `player.css` | Native player and playback lifecycle |
| `rehearsal.js`, `test-stream.*`, `assets/rehearsal.webm` | Offline browser rehearsal |
| `dashboard.*`, `styles.css` | Lightweight viewing desk |
