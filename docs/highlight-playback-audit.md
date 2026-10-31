# Highlight playback audit — October 31, 2026

Baseline: `0165fb2d8a726e37e2f5774ccb928cc6ebaf2696`.
This pass follows a score through discovery, preparation, player loading,
presentation, interruption, completion, source failure and return to the game.
The previous integration pass improved matching and fallback, but missed
reproducible playback transition defects. Its passing tests did not establish
that the complete viewing sequence was correct.

## Findings and corrections

| Finding | Previous behavior | Corrected behavior |
| --- | --- | --- |
| Player eviction during consecutive replays | The outgoing clip, incoming clip, return game and speculative warm game competed for three slots. Warming could evict the incoming clip and leave it waiting until timeout. | During a highlight transition, keep the clip(s) and the return or pending game. Do not open a fourth speculative player. |
| Premature completion | Watching half a clip could mark it replayed when urgent action interrupted it. | Require reaching the end and observing at least 85% of its duration. This remains a playback estimate, not recognition of the scoring moment. |
| Repeating the opening after interruptions | Requeued clips started again without retained progress; repeated openings could dominate the viewing experience. | Resume with two seconds of context before the end of the continuously watched opening. Merge watched intervals so overlap is counted once. |
| Reusing an ended player | A retry with the same player key could inherit its end position instead of restarting. | Start each attempt with a fresh player at the intended resume position. |
| Finished clip restarting or continuing | Warming and channel Resume could restart a held clip. Calling native `play()` after an ended video can restart it. | Pause a completed clip and suppress visible-player resume while that frame is held. Loading and active clips still resume normally. |
| Loading clip flashes over urgent action | The app revealed a ready highlight before asking the director whether live action had become urgent. | Make that decision before revealing a loading clip. An unfinished visible clip keeps moving until the replacement picture is ready; interruption bookkeeping happens at the committed switch. |
| Guessed highlight cutoff | Published clips were capped at 45 seconds or defaulted to 30 seconds, even if the video was longer. | Use the actual media duration when known, then supplied duration, then a natural ended event. Archived broadcast excerpts retain their deliberately bounded replay window. |
| Hidden startup consumes a short clip's opening | Native video progressed silently before it was revealed. | Rewind the already buffered native opening to the intended start before revealing it. A real NativePlayer test covers a two-second clip. |
| Stale prepared match | New scoring information could make a prepared clip ambiguous; its prior publisher link could remain displayed. | Revalidate before opening and before revealing the clip. Clear obsolete links. The unique matched score must have the requested score ID. |
| Repeated incomplete endings | A clip that repeatedly ended without enough observed footage could keep requeuing itself. | After two incomplete natural endings, retire that source through the existing alternate-source/recording fallback. Ordinary urgent interruptions do not consume this allowance. |
| Wrong labels during consecutive loading | The old clip could be labeled LIVE or show the next score before the next picture appeared. | Keep the outgoing replay's label until the incoming picture is shown; identify loading and return waits explicitly. |
| Null provider configuration | Valid JSON containing `null` threw while accessing its playlist. | Ignore a null configuration and continue parsing other entries. |

Signed-link renewal retains watched intervals, resume position and incomplete
ending count only when the renewed source is the same clip ID. A different
candidate starts with fresh playback history. Conservative game/score matching,
device restrictions, expiry checks, publisher links and bounded late-publication
retries from the preceding pass remain in place.

## Verification

- **435 tests pass**, up from 419. Fifteen new app transition/rehearsal tests
  and one new matcher test were added; the null-configuration assertion extends
  an existing parser test.
- All fifteen `watchability:` tests fail against the prior app implementation
  and pass against this revision. This comparison uses the current domain
  modules/player pool with the previous app, isolating the orchestration changes.
- The real NativePlayer and PlayerPool run together in an app test with a
  simulated browser video element. It exercises hidden startup, seek, playback
  progress, ended, Pause/Resume and returning to the game. It is not a browser
  rendering or network playback test.
- A separate rehearsal uses the real Director, PlayerPool and Coverage with
  advancing simulated media: play a queue, interrupt it for urgent action,
  resume, play consecutive clips, and return to the game. Every queued item
  completes without losing an active player slot.
- **60,000 healthy-stream director comparisons** still have zero unexpected
  differences from the original implementation. No director rules were changed.
- The Worker builds with **25 assets**. All source-to-bundle comparisons and
  HEAD requests pass, along with method/routing checks and compiled NFL metadata
  normalization using mocked provider requests. Syntax and diff checks pass.

A first attempt to pause completed/interrupted clips in this pass froze an
unfinished replay while the replacement stream was still loading. A new test
exposed that regression before publication. The final implementation pauses at
completion or at a committed switch, preserving moving footage while waiting.

Reproduce the previous app failures without replacing working files:

```sh
git show 0165fb2d8a726e37e2f5774ccb928cc6ebaf2696:web/app.js > /tmp/fantasy-before-watchability.js
FANTASY_AUDIT_APP=/tmp/fantasy-before-watchability.js node --test --test-name-pattern='watchability:' tests/app.test.js
```

Run the release checks:

```sh
npm test
node scripts/audit-director.mjs
npm run build
node --check dist/server/index.js
```

## Remaining verification boundary

This revision has not been deployed or observed in a real browser here. The
tests do not verify actual NFL publication metadata, HLS/CDN access, sound,
autoplay or the performance of the family's supplied streams. Those remain
the live checks described in the [integration report](live-highlight-integration.md).
The player can keep existing footage moving while a replacement loads, but it
cannot guarantee an instantaneous cut to a source that has not become playable.
Provider restrictions and unavailable footage still use the documented fallbacks.

Browser behavior reference: [WHATWG media element specification](https://html.spec.whatwg.org/dev/media.html),
including native `play()` restarting an ended resource.
