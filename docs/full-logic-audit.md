# Full logic audit — October 31, 2026

Follow-up: [Live highlight integration](live-highlight-integration.md) adds
conditional NFL game matching, alternate sources, late-publication retries and
publisher-page fallbacks. The open finding below records this audit's baseline;
the follow-up documents the new behavior and remaining verification limits.

Audit baseline: `829cea62b704f1a57a3782fd6673568f64a6214f`.
Scope: all browser logic modules, Worker endpoints, build/deploy path, and their
tests. This is a further source and state-machine audit, not a repetition of
the earlier mobile/browser check. The corrections in this commit have not been
deployed to Cloudflare or exercised against actual Sunday broadcasts.

## Assessment

The original director has a coherent decision model, and its ordinary decisions
remain preserved. However, the preceding audit was not exhaustive: this pass
found additional reproducible defects in the orchestration, watched-coverage,
sync override, stream fallback, and scoring paths. One pending-switch defect
was introduced by the preceding timeout correction; the others identified here
were already present in the preceding baseline. Tests that pass do not prove
that third-party media or every state transition is correct.

The ten corrected finding groups are below. One confirmed integration gap
remains: unscoped NFL.com live clips cannot be matched to games reliably.
Game-specific ESPN live highlights and archived replay sources remain usable.
The release still requires deployment and a browser smoke check with the actual
devices, ESPN account, and live stream URLs intended for family testing.

## What the application actually does

1. **Choose a lineup.** Browser preferences are normalized. Live mode requires
   an explicit lineup; replay can use the sample. ESPN imports include starters
   and exclude bench/IR slots. The viewer selects a franchise unless their
   supplied ESPN identity matches an owner. Manual edits invalidate older import
   responses. Live and replay lineups have separate in-memory snapshots, and
   persistent storage keeps the live lineup canonical.
2. **Construct game state.** Live mode polls ESPN's scoreboard and relevant
   game summaries. A fifteen-minute buffer provides delayed snapshots. Replay
   samples the fixed 2026 Week 7 archive. Both expose the same possession,
   down, field-position, game-state, and play/break fields to the director.
3. **Choose a game.** The director ranks inferred roster involvement, then
   applies play protection, celebration, dwell, margin, and debounce rules.
   Missing, cooling-down, or advertised sources affect eligibility separately.
4. **Prepare and commit video.** A player pool keeps up to three slots, with
   one likely next game warming when the current stream is healthy. A normal
   cut waits for readiness; a first player can be revealed for a required Play
   click after eight seconds, while its twenty-second startup deadline remains.
5. **Estimate watched scores.** Confirmed playback intervals are compared with
   a scoring-play window. Missed roster scores enter a queue. Replay sources
   are resolved asynchronously; outdated results cannot replace newer sources.
6. **Recover or fall back.** Stalled controllable game video is nudged, re-seeked,
   then cooled down. A failed source is excluded for sixty seconds. Live games
   without links can show the tracker; failed supplied links offer Retry video.

## Decision precedence

The channel is not a simple “always choose the nearest end zone” sorter.

| Order | Rule and practical effect |
| --- | --- |
| App-level override | An active, roster-relevant, nonexcluded pinned game takes precedence. An unavailable pin cannot bypass cooldown. |
| Active highlight | A critical candidate can preempt it when a play is happening or imminent; otherwise the highlight continues. |
| Current play | If the current game has inferred roster involvement, protect a play already in progress and a known next snap within five seconds. This can temporarily retain D/ST over another game's offense. |
| Recent score | Hold a current roster score for up to eighteen seconds unless the game is in a break. |
| Missed-score queue | Play an eligible prepared replay when there is no critical game and the queue/break conditions allow it. The seventy-five-second wait is not a hard guarantee: critical action can continue to block highlights. |
| No ranked game | Retain or select an active roster matchup, even between series; otherwise use standby. No unrelated team's game is a valid fallback. |
| Dwell and urgency | Normally keep a committed game for twelve seconds. Higher-priority involvement and urgent upgrades can override that hold. |
| Challenger | Require sufficient improvement and normally 1.5 seconds of the same challenger before leaving a watchable game. Breaks/finals do not need that debounce. |

Offensive players and kickers are tier 2; D/ST is tier 1. The tier-2 score is
`100 − yardsToGoal + 2 × additional attackers`, plus one for a kicker-only
candidate or four for a fourth-down offensive attempt. Thus the ten-point
switching margin is not always exactly ten field-position yards. Kickers are
inferred from fourth down inside the opponent's 42, not observed personnel.
The app does not know whether an individual starter is substituted out.

## Reproduced defects corrected in this pass

P1 means a core playback/replay flow can fail or falsely claim success. P2 means
an incorrect result or capability failure in a narrower situation. P3 means a
validation or future-use defect. These labels describe this project's impact,
not a formal security severity system.

| Priority | Finding, cause, and correction | Regression evidence |
| --- | --- | --- |
| P1 | **Abandoned cut remains pending.** The previous timeout fix stopped clearing a pending switch to B when the director stayed on visible A. Its stale deadline could later reject B prematurely. Clear a different pending target while retaining a still-loading current target. | `logic: abandoning a pending switch…` fails on the baseline and passes now. This is a regression in my preceding change. |
| P1 | **Visible seek can freeze indefinitely.** Recovery returned early whenever `player.target` was non-null. A failed seek could therefore freeze the replay clock beyond the provider's own retry window. Unanswered seeks now participate in bounded game recovery and cooldown. | `logic: an unanswered seek…` reproduces the permanent pending seek and verifies eventual release. |
| P1 | **Highlight completion used elapsed wall time.** A stalled clip could be labeled replayed without footage advancing. Conversely, seeking to its end lacked a coherent watched-progress outcome. Track bounded media advancement, use media position to finish, preserve Pause timing, and fail a clip after fifteen seconds without progress. A replay interrupted before half its usable duration is watched is requeued. | Buffering, seek-to-end, normal progress, and Pause tests. The two failure cases fail on the baseline; normal playback/Pause are positive controls. |
| P1 | **Unverified live pictures suppress replays.** The tracker and generic iframe readiness could count as watched video, despite having no evidence of moving footage. Only controllable live video now certifies watched intervals. Replay's explicit data-only simulation retains its tracker coverage behavior. | `logic: live trackers and unobservable page embeds…` fails on the baseline. Generic embeds may now produce a duplicate highlight because their playback cannot be observed reliably. |
| P2 | **Rewinding loses watched intervals.** The interval append/merge assumed chronological viewing. Earlier footage merged into a later interval without preserving its start. Rewound intervals now form an ordered union with overlaps merged once. | Earlier intervals and an overlapping bridge are retained; `seen()` remains correct. The old implementation fails this test. |
| P2 | **Manual timing marks lose to OCR anchors.** Concatenating automatic anchors first let equal-time or conflicting readings displace the viewer's mark. Manual marks now displace only incompatible automatic readings before the existing interpolation runs. | An actual catalog anchor is overridden, compatible automatic anchors survive, and the resulting curve remains monotonic. |
| P2 | **Native HLS fallback missing.** Some browser configurations expose MediaSource but cannot use hls.js while supporting native HLS. Check native capability before reporting HLS unavailable when hls.js is unsupported. | Native fallback, supported hls.js preference, and neither-path-available tests. The fallback case fails before correction. |
| P2 | **Own fumble recovery credits D/ST.** The parser treated every fumble-recovery touchdown as defensive and omitted the offensive recoverer. Recognize explicit `Fumble Recovery (Own)` and credit the scorer without D/ST. | The prior parser returns defensive=true for the fixture; the new test checks both scorer and absence of D/ST credit. Existing return/defensive-score tests still pass. |
| P3 | **Historical import changes with the calendar.** Replay requested week 7 but omitted season, so a later year would import the wrong historical roster. Use the archive's season and week; live imports retain the server's current-season behavior. | `logic: replay league imports…` checks both request payloads. |
| P3 | **Impossible clock readings accepted.** A sync input such as 99:59 passed format validation and extrapolated an invalid game time. Reject values above 15:00. | 15:01, 16:00, and 99:59 now fail; valid clock interpolation tests remain passing. |

## Confirmed open finding

**P2 — NFL.com live catalog lacks a game association.** `server/nfl.js`
`parseNFLCatalog()` emits clip IDs, team/athlete tags, titles, and durations,
but no `gameId`. `pollLiveClips()` merges those entries without adding one.
`officialClip()` requires `clip.gameId === item.gameId`. Therefore these live
NFL entries cannot be selected, even with a perfect player/title match.

The audit reproduced that path from parser output through the real matcher.
I did not relax game matching to player/team alone: that could replay an older
score as the current one. A reliable event/date association must be established
before enabling this path. Current live replay coverage depends on available,
matching ESPN clips from the specific game's summary. Archived NFL clips already
have their catalog game association and are a separate path. README now states
this limitation instead of implying the live NFL fallback is connected.

## Remaining behavior and external limits

- **Delay is approximate.** Polling and scoreboard publication lag are separate
  from video delay. Before the delay buffer fills, the oldest available snapshot
  is used, so the full configured delay is not yet available. One global delay
  cannot align streams with different latency.
- **Snap safety is inferred.** A new logged live play creates an eighteen-second
  presumed safe window; from then until seventy-five seconds without another
  play, the feed treats the game as potentially snapping. This is a heuristic,
  not frame-level video or player tracking.
- **Feed outages retain last-known state.** The app shows an update warning and
  continues video recovery, but subsequent choices can use stale possession or
  field position. It does not manufacture fresh game state.
- **Coverage is an estimate.** Replay requires 70% of the seven-second snap
  window. Live widens that window by twelve seconds and uses the configured
  delay. A 0.6-second interval tolerance bridges short sampling gaps. Highlight
  completion tracks media progress; it does not recognize a touchdown visually.
- **Score and clip matching are textual.** Name normalization tolerates common
  punctuation/suffix differences. Exact game, player, score wording, and distance
  help select clips, but two similar scores by the same player can be ambiguous.
  Unfamiliar ESPN text formats can still fail to identify a scorer.
- **Generic embeds are not controllable players.** Loading an iframe does not
  establish playable video. Sound, playback, ads, framing restrictions, and
  additional Play clicks depend on that site. Pause unloads such a page; Resume
  reloads it. Direct HLS/MP4 also requires usable URLs and browser/CORS support.
- **Scope of footage.** Included full-game video is the fixed 2026 Week 7
  archive. Live mode needs viewer-supplied stream links and separately published
  highlights; it is not a broadcast-discovery or subscription service.

## API, persistence, and concurrency review

- Imports validate method, origin, request length, league/year/week, and cookie
  format. Cookies go to a fixed ESPN endpoint with redirects disabled. No
  arbitrary user-supplied URL is fetched by the league endpoint.
- Public session requests cannot unlock shared environment credentials through
  a claimed identity header. The shared local connection and diagnostics require
  an explicitly enabled loopback preview. Viewer-pasted private cookies persist
  in that viewer's browser; the Worker does not persist them.
- NFL playback URLs are validated against HTTPS Lura HLS hosts, DRM responses
  are rejected, and anonymous identity tokens stay server-side. This review
  checks the code boundary; it does not establish present provider availability.
- League request counters and live-feed generations reject stale responses.
  Source resolution compares the pending-record identity before installing a
  result. Closed player callbacks cannot control a replacement slot of the same ID.
- Saving the same imported lineup preserves playback; changing actual players
  resets dependent coverage and players. Stream replacement releases only
  affected current sources. Unsaved stream text survives a mode round trip.
- Preferences normalize independently, and failed persistence shows a warning.
  Replay edits are session-local; reload preserves the live lineup.

## Verification and exact scope

- **391 tests pass**, including fifteen added in this pass.
- Nine new `logic:` app cases: **seven fail against the audit baseline**, while
  normal highlight progress and Pause remain passing positive controls. All
  nine pass after correction. The historical harness uses the old app with
  current domain modules and simulated browser/media/network boundaries.
- The rewind-coverage, native-HLS fallback, own-fumble scoring, and invalid-clock
  tests were each observed failing before their corresponding correction.
- **60,000 sequential eligible-stream director decisions** still match the
  original pre-review director. The two original excluded-stream negative
  controls remain reproduced. Equivalence does not establish correctness of
  every original rule; the rule order above was reviewed separately.
- Full Sunday simulation, all fourteen recordings' monotonic alignment tests,
  provider protocol/lifecycle tests, live-feed tests, and API tests pass.
- Worker build, JavaScript syntax, source-to-served-asset comparisons, session
  credential isolation, HEAD, 404, and 405 checks pass. `git diff --check` passes.

The director, archive sampler, delayed-feed algorithm, player provider handshake,
and clip matcher are unchanged in this pass. Coverage interval insertion and
score parsing have narrow corrections; sync adds anchor-priority merging and
clock validation without rewriting its interpolation. No archive, recording,
or OCR calibration data was rebuilt.

```sh
npm test
node scripts/audit-director.mjs
npm run build
node --check dist/server/index.js
```

Reproduce the app comparison (seven failures are expected):

```sh
git show 829cea62b704f1a57a3782fd6673568f64a6214f:web/app.js > /tmp/fantasy-before-full-logic.js
FANTASY_AUDIT_APP=/tmp/fantasy-before-full-logic.js node --test --test-name-pattern='logic:' tests/app.test.js
```

Prior browser evidence is in the [family-readiness audit](family-readiness-audit.md).
It does not verify this commit. This environment previously blocked local server
binding and file-based browser preview, so no new browser result is claimed.
Deploy, reload, and test actual picture/sound, failed-source recovery, seeking,
lineup mode switching, a private league import, and the mobile lineup footer
before calling the production release verified for friends and family.
