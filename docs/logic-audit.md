# Logic audit — 2026-10-31

Baseline: `22d3d1d031fa3adf9b9b61e658c387271cbc31bf` (before the review).
First review: `daf5d176eb2e8c0403c5b448b52a58807e8b4aa7`.

The five claimed fixes have reproducible failure cases in the original code.
The second audit also found omissions and regressions in the first review;
those corrections are included with this document. Automated results establish
the behavior of the tested state transitions. They do not establish that a
particular third-party broadcast will play in a particular browser on Sunday.

## What the original logic does

The director ranks roster involvement by possession and field position, treats
kickers and defense separately, and protects plays, imminent snaps and recent
scores. Dwell, margin and challenger debounce prevent noisy switching. It uses
quiet periods for missed-score highlights. The player pool prepares the next
video before cutting. Replay time follows the visible recording through the
OCR-based alignment; live decisions use delayed scoreboard snapshots.

The review preserves those rules and the provider handshake. `archive.js`,
`sync.js`, `scoring.js`, `coverage.js`, `live.js`, `replays.js` and
`provider-player.js` remain unchanged from the baseline. The director change
only removes an excluded or no-longer-rostered current game from hold/fallback
eligibility. Coverage and player orchestration call sites have changed.

## Evidence for each claim

| Claim | Reproduction in original code | Verified behavior after correction |
| --- | --- | --- |
| Pause | Start, then pause before the next decision. `step()` still reaches `cutTo()`, which calls `pool.hold(..., {play:true})` and starts a hidden player. | Paused steps make no cuts or playback requests and record no watched coverage. Resuming a loading highlight explicitly resumes its hidden player. Pause time does not consume its loading/playback deadline. |
| Stale lineup response | Begin a league import, save a manual lineup, then complete the old import. The old response changes the saved lineup to the imported team. | Manual saves and franchise selections invalidate older requests. Reversed response order preserves the newest import. Team IDs are matched within their own league. |
| Replacement stream | While game A is visible, save a different URL for A. `cutTo(A)` returns early because A is already current, leaving the old video visible. | The old player closes and its cooldown/ad state clears. The next decision opens the saved replacement URL. Invalid input leaves all saved links unchanged. |
| Failed-stream selection | An excluded current game survives the original celebration and no-ranked-game fallback branches. A pinned game also bypasses cooldown. An unrelated saved video can suppress a roster game's tracker. | Exclusions apply to current-game holds and pins. Cooldown expiry permits a retry. Only an eligible, active roster stream takes priority over a tracker. Closing an ad player clears its ad flag. |
| Live/replay switching | Switch from current live time to the historical replay. The original switch samples the archive with the live timestamp and calls `coverage.skipTo()` before restoring replay time. | Restore replay time before sampling or marking skipped scores. Future archive scores remain eligible for missed-score replays. |

The mode-switch explanation needs precision: **the original replay clock fixes
itself on the next frame**. The persistent damage is in coverage. The Sunday
fixture had **95 future scores marked as intentionally skipped**, even after
the clock corrected itself. The regression checks that exact effect.

## Corrections made during this second audit

- A paused, loading highlight stayed hidden and stopped; the pool's ordinary
  resume only starts its visible player. Resume now restarts that loading clip.
- The first review destroyed video and cleared coverage even when a refreshed
  lineup contained the same players. Identical-lineup refreshes now preserve
  playback and coverage while allowing the team name/connection to update.
- The first review's early return on a stale scoreboard also disabled stalled
  video recovery. That early return is removed; the feed error remains visible
  while the existing recovery path continues.
- Closing an ad player left an exclusion behind. The pool now reports closure,
  and callbacks from a retired player cannot affect a replacement with the same
  game ID.
- A delayed native-video autoplay rejection could restart a paused/destroyed
  video. The rejection handler now checks whether playback is still wanted.
  Tests also cover a controller arriving after its player was destroyed.
- An iframe's `about:blank` load after pausing could count as loaded video. That
  load is ignored. Generic page embeds stop by unloading; resuming reloads the
  page because their internal player is not controllable.
- Selecting a franchise now cancels an older import, and importing a different
  league cannot silently reuse the previous league's numeric team ID.

## Verification

- **350 tests pass**, including the existing Sunday rehearsal and provider,
  alignment, director, feed and coverage tests.
- Six `audit:` app regressions fail against the original app and pass against
  the updated app. These use real domain modules and the real player pool with
  simulated media elements and network responses.
- **60,000 sequential simulated director decisions** match the original when
  the current stream remains eligible. The comparison includes challenger
  state and uses two negative controls that reproduce the original excluded
  celebration/fallback failures.
- The rebuilt Worker passes syntax and asset-serving smoke checks.

Reproduce the current checks:

```sh
npm test
node scripts/audit-director.mjs
npm run build
```

Reproduce the six original app failures (this command is expected to fail):

```sh
git show 22d3d1d031fa3adf9b9b61e658c387271cbc31bf:web/app.js > /tmp/fantasy-stream-original-app.js
FANTASY_AUDIT_APP=/tmp/fantasy-stream-original-app.js node --test --test-name-pattern='audit:' tests/app.test.js
```

The app comparison loads the historical orchestration code with the current
test harness/domain modules. The separate director comparison imports the
historical director itself. Neither substitutes for playback verification with
the user's actual streams, browser sound permissions and configured delay.
Cloudflare deployment was not completed from this environment.
