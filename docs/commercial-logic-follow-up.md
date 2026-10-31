# Commercial logic follow-up — October 31, 2026

Baseline: `c2adf9013bef851aa884b241fdd409d682f15cc6`.

The Bucs report exposed a reproducible transition defect. This revision remembers
break evidence until the scoring footage finishes, then releases the viewer's
manual selection. It also removes detected commercial video and audio while
the next game or highlight loads. The word “Stream” is yellow again; the red
brand dot remains.

## Evidence

In TB–CAR (`401873018`), the field goal at archive row 38 maps to approximately
video 1653. The timeout and kickoff map to approximately 1659 and 1665. The old
selection logic only released when the sampled phase was a break AND the media
protection had ended. Here the break appeared and disappeared while the score
was still protected; the kickoff then supplied another protected play. The
manual choice could outlive the break without ever observing a release point.
The field goal at row 109 presents the same class of short edited interval.

The archive sampler also used the next row, even an Official Timeout marker,
as its next-snap deadline. Before the timeout following Bucky Irving's first
touchdown (row 14), it incorrectly changed from break back to live in the
lead-up to the marker. The sampler now looks through stoppages to the football
play, including its `nextSnapIn` value. Same-timestamp score/marker groups use
the actual football row when identifying a score.

A wider trace found KC–SEA's 50-yard Butker field goal (row 123), timeout, and
kickoff all map to the same media position. The playhead can skip the score
row entirely. Crossed scoring events are now remembered from archive history;
historical scores at initial startup do not count as new breaks.

## Resulting behavior

| Situation | Behavior |
| --- | --- |
| Manually selected replay scores | Keep the existing media-time play protection. Remember the scoring boundary and release the choice at its end, bounded by the next actual football play. A subsequent kickoff cannot extend the old selection indefinitely. |
| Inferred replay timeout | Finish the protected action, then exclude the recording until its next football play. Do not reopen it in a misleading pre-timeout “live” window. |
| Provider reports an ad | Hide and mute immediately in the event callback. Exclusion takes priority over selection and celebration holds. A reported highlight ad still enters clip recovery. |
| Another game buffers | Keep the outgoing commercial hidden and muted. Healthy outgoing game/highlight footage retains its existing transition behavior. |
| No eligible replacement | Show a waiting screen. If all available replay choices are in known breaks, advance to the earliest known return to football without claiming skipped scores were watched. |
| Live score rises without a timeout snapshot | Infer a scoring break from the delayed scoreboard. Wait for a fresh play and a normal down/possession before returning. A clock change alone cannot release a hold when play IDs are available. PAT updates do not bring the game back prematurely. |
| Click on a known video break | Exclude it immediately; the previous ten-second display grace is removed. The game becomes selectable again after its break clears. |
| Viewer reports an in-band commercial | “Skip this break” hides/mutes even if no alternate is ready. The existing 90-second timer and Undo control remain. Pausing preserves the timer. |
| Add stream links or edit the lineup | Preserve known game-break evidence; these edits must not make a commercial eligible again. |
| Seek, change replay day/mode, adjust sync, or change live delay | Reset evidence tied to the old timeline. Pending seeks use the requested media position, not the player's old pre-seek time. A sustained scrub inside the provider resets evidence when the shared clock follows it. |

`web/breaks.js` owns the break state. The director's ranking policy is unchanged.
The app supplies exclusions before coverage accounting and selection, and
suppresses the visible player before loading a replacement. The existing
player pool mutes controlled players and unloads hidden unobservable page
embeds. Provider mute delivery still depends on the provider honoring commands.

## Verification

- `npm test`: **529 passing tests**, 33 added since the baseline.
- All nine TB–CAR scores have media-time boundary tests. Seven Bucs scoring
  events also run through the real app, director, clock, archive and player
  pool with a controllable media boundary.
- A trace checks all **112 scoring boundaries with a following football play**
  across the **14-game archive**. Three game-ending scores have no following
  play and are handled by final-state behavior.
- Regression cases cover immediate muting, replacement buffering, no alternate,
  background ads, manual choices, live score/PAT changes, lineup and link edits,
  seek races, delayed feed changes, replay time advancement and short highlights.
- Existing whole-Sunday director and coverage simulations pass.
- `node scripts/audit-director.mjs`: 60,000 comparisons with the original
  director, 476 previously intentional break recoveries, zero unexplained
  differences. This is a ranking-policy comparison; it does not certify ad
  detection or real playback.
- Production build and JavaScript syntax checks pass.
- `node scripts/check-build.mjs`: 27 exact bundled-asset comparisons, 27 HEAD
  responses, four route checks and a compiled NFL metadata check with mocked
  upstream responses.
- Git whitespace checks pass.

The older test that required a lone commercial to stay visible was deliberately
replaced with a waiting-screen test. The ten-second known-break grace test was
replaced with immediate exclusion. A highlight sequence now expects standby
while its only game is in a break, then verifies return after action resumes.
The continuity test's alternative game now uses an actually active archive
game instead of overriding a real timeout row to look urgent.

## Detection and release limits

This is not visual ad recognition. Commercials baked into a video without a
provider event or matching game-feed evidence can still appear. “Skip this
break” is the explicit recovery for those cases; its 90-second exclusion is
a fallback estimate, not proof the commercial has ended. Stream-delay errors,
late scoreboard updates, provider behavior, and imperfect replay anchors can
still cause early or late transitions. Finishing an inferred scoring window
is an estimate, not an observed whistle.

No real-browser playback pass was possible in this environment: the available
Chrome process exits before rendering. The tests use real domain/app/pool code
with simulated media and do not establish zero commercials on actual Sunday
streams. After deployment, replay the Bucs scores and check live stream timing,
sound, a reported break with no alternate, and one healthy highlight to its end.

This change is prepared for the existing GitHub/Cloudflare deployment workflow;
the audit does not deploy Cloudflare production.
