# Sunday release logic pass — October 31, 2026

Baseline: `3e9c376a2acee77dcc66317d3d4f2d7e088fa529`.

This pass addresses live commercial recovery and polling latency. Changes are
in `web/app.js`, `web/breaks.js`, and `web/live.js`, with the rebuilt Worker.
The existing director, replay alignment, highlight matching and player
implementations retain their behavior.

## Reproduced failures and resulting behavior

| Trigger | Previous behavior | Correction |
| --- | --- | --- |
| A game summary takes ten seconds to return | The next scoreboard request waits for that summary and then another five seconds. Commercial decisions keep using the older snapshot. | Schedule the next scoreboard request after the scoreboard completes, independently of summary completion. Summary work remains capped at four requests per polling generation, with the existing retry spacing and least-recently-attempted ordering. |
| A scoring break has a known play ID, then a snapshot omits that ID | The missing ID changes the situation key and can be mistaken for a new football play. | Missing IDs cannot release a break with a known ID. Repeated scoring snapshots preserve the last known boundary ID. |
| A touchdown is overturned but retains its play ID | The score hold can keep the stream excluded even after the feed reports football again. | Remember the total before the score. Returning to that total can release the hold when the feed reports normal possession/down and no explicit break. |
| A PAT changes 7 to 6, or a review timeout remains explicit | A naive score-decrease fix would reopen the commercial. | Preserve the pre-touchdown total across PAT updates. An extra-point correction does not overturn the touchdown, and an explicit timeout remains excluded. |
| A snapshot omits one or both team totals | Display defaults of zero can resemble an overturn; restoring the totals can resemble another score. | Normalized games carry `scoreKnown`. Break inference retains the last complete totals through incomplete responses and only uses complete, valid totals for score changes. |
| A roster stream enters an ad while another starter has only a tracker and a backup game has video | The tracker can outrank the playable backup, leaving no football picture. | During a known video break, eligible video takes priority over trackers. This also covers a manually selected non-roster stream. If the replacement fails and no video is available, the roster tracker remains the fallback. |

Manual selections still override automatic ranking until a break, failure, or
game end. The replay scoring-play protections from the Bucs fix remain in
place. A healthy short highlight still finishes before automatic direction
resumes. Summary responses from obsolete polling generations cannot restore
old scores or clips, and their cleanup cannot remove a newer request's slot.

## Verification

- `npm test`: **545 tests passed**, including 16 added in this pass.
- Negative control: the same 16 new tests were run against copies of the three
  baseline source files. **13 failed and three passed**. The passing controls
  cover stale-generation rejection, PAT protection and the long replay
  rehearsal; those are preserved behaviors, not newly claimed fixes.
- A rehearsal runs the actual app, director, clock, archive, coverage, break
  control and player pool through the full Sunday roster slate. Its controlled
  media boundary completes **42,134 half-second steps** (21,067 simulated
  playback seconds), **15 manual choices**, **nine provider-ad events**,
  **eight pauses**, and **five completed broadcast highlights**. Assertions
  check progress to the end, at most three players, at most one audible player,
  manual-choice handling, and no visible player with a known break exclusion.
  The media boundary lands seeks immediately; this is not browser playback.
- Existing tests still cover all nine Bucs scoring boundaries and 112 scoring
  boundaries with a following football play across the 14-game archive.
- `node scripts/audit-director.mjs`: **60,000 comparisons**, zero unexplained
  differences; 476 intentionally different break recoveries from earlier work.
- `npm run build`, Worker syntax validation and `node scripts/check-build.mjs`
  pass: **27 exact asset comparisons, 27 HEAD requests, four route checks**,
  and compiled NFL metadata handling with mocked upstream responses.
- `git diff --check` passes.

The app test boundary now captures scheduled timers and models the player's
initial muted state and requested readiness tolerance. This lets the polling
tests keep summaries unresolved while advancing the next scoreboard request,
and lets the long rehearsal exercise the real pool's provider seek lead.

## Public integration spot check

Read-only checks against the deployed endpoints returned:

- ESPN scoreboard: HTTP 200, 14 events.
- Cloudflare `/api/nfl-highlights`: HTTP 200, 48 catalog entries.
- One published NFL clip: `/api/nfl-source` returned HTTP 200, a 15-second
  source, and approximately 240 seconds of source validity.
- Its HLS master and variant playlists returned HTTP 200; the master listed
  eight variants. A 512-byte segment range returned HTTP 206. All three media
  responses advertised `Access-Control-Allow-Origin: *`.

This checks catalog, resolution, media access and CORS at the time of the
request. It does not prove browser decoding, correct matching of future Sunday
scores, timely publication, or the availability of every clip. `/api/health`
returned 404 because this project has no such route; no health endpoint was
added or inferred from that probe.

## Release boundary

The source and built Worker are ready for deployment and a final test with the
actual live sources. This pass does not deploy Cloudflare. In the normal local
checkout, run `git pull --ff-only` followed by `npm run deploy`.

The browser could not launch in this work environment, so this pass does not
claim fresh visual, audio, autoplay or real-provider playback verification.
The remaining meaningful check is to use the actual streams in a browser:
confirm sound, switch manually, pause/resume, observe a score and commercial
transition, and allow a missed-score highlight to complete and return.

Commercial avoidance still depends on provider ad events and delayed game-feed
evidence. Arbitrary ads inside an unobservable page or recording cannot be
recognized visually. The manual Skip this break fallback remains a 90-second
exclusion, not proof that an ad has ended. Different stream delays and stale
upstream metadata can still put the feed and picture out of alignment. No
zero-commercial or zero-missed-play guarantee is supported by these tests.
