# Playback continuity and score corrections — October 31, 2026

Baseline: `07edf35b869aca6e4b511d9abe0dda29a41e3a15`.
This pass covers overlapping playback requests, summary failures, and changes to
previously reported scoring plays. The director's ranking and switching rules
are unchanged.

## Findings and corrections

| Finding | Corrected behavior |
| --- | --- |
| Urgent action disappears while its return stream is loading | Clear the abandoned pending switch when the director keeps the highlight. A later switch gets a new loading deadline. |
| Four failing summaries repeatedly exclude the fifth roster game | Timestamp failed attempts too and prioritize the least recently attempted eligible games. This remains fair even when a polling cycle outlasts the retry interval. |
| Seeking appears to be video progress | Clear earlier progress on seek. Use the landing frame as a baseline and wait for subsequent advancing footage, including when the landing is slightly different from the requested time. |
| A rejected play promise arrives after Pause and a successful Resume | Ignore promises from earlier playback requests. They cannot mute or restart the newer session. |
| An old sound-recovery callback runs after Pause/Resume | Invalidate old callbacks independently of playback requests, including callbacks already queued when their timer was cancelled. |
| A canplay retry silently ignores an autoplay restriction | Route it through the same guarded play/recovery path so the sound hint and muted retry still work. |
| A removed or reassigned scoring play retains its replay | Reconcile the score history and queue, invalidate prepared/in-flight sources, and close affected active footage. A late resolver cannot restore the old score. |
| Missing summary fields erase known scores | Preserve the prior scoring list when the field is absent or malformed. An explicit empty scoring list is treated as removal. |
| Missing drives erase retained scores or invalid dates settle immediately | Reuse the timestamp only from the same previously known play; reject new plays without a finite timestamp. Coverage also rejects nonfinite times. |
| Routine score/PAT updates interrupt a replay | Update the existing item's label and credits while keeping its player. Main-play identity and replay text distinguish corrections that can change the clip match. |
| Yardage edits replay an already watched touchdown | Retain seen/replayed status when the play identity is unchanged. Update its description and retire any stale publisher link. Unwatched matches are prepared again. |
| An outgoing score is removed while another replay loads | Close the affected outgoing player and label while preserving the incoming replay. |

Corrections to the scoring player, scoring team, play type, defensive attribution,
snap time, or non-PAT participants cause fresh coverage judgment. Changed main
play text invalidates an unwatched match; scoreboard totals, clock labels and
extra-point annotation alone do not. Clips already claimed by a score remain
claimed, preventing their accidental reuse for a different score.

## Verification

- **460 tests pass**, including 25 added cases: 14 app/player transitions and
  11 live-normalization/coverage checks.
- All 14 new app/player cases fail against the previous app/player files and
  pass against the patch. This comparison uses the current domain modules.
  The 11 domain checks were also run before implementation and failed there.
- The existing two-second native replay rehearsal now explicitly delivers a
  seek-landing event, verifies that the live picture remains visible, then
  delivers advancing footage. It still verifies the opening rewind, completion,
  Pause/Resume and return to the game.
- **60,000 healthy-stream director comparisons** have zero unexpected changes.
- The Worker builds with **25 assets**; source/bundle byte comparisons, HEAD
  responses, route/method checks, compiled provider-normalization checks, Worker
  syntax and whitespace checks pass.

Reproduce the app/player comparison:

```sh
git show 07edf35b869aca6e4b511d9abe0dda29a41e3a15:web/app.js > /tmp/fantasy-before-continuity-app.js
git show 07edf35b869aca6e4b511d9abe0dda29a41e3a15:web/native-player.js > /tmp/fantasy-before-continuity-native.js
FANTASY_AUDIT_APP=/tmp/fantasy-before-continuity-app.js FANTASY_AUDIT_NATIVE=/tmp/fantasy-before-continuity-native.js node --test --test-name-pattern='continuity:|corrections:' tests/app.test.js tests/native.test.js
```

Release checks:

```sh
npm test
node scripts/audit-director.mjs
npm run build
node --check dist/server/index.js
git diff --check
```

## Limits

These are deterministic logic and simulated-media checks, not real browser or
provider-network playback verification. Treating an explicit scoring list as
authoritative is a feed contract assumption: a provider returning a mistakenly
empty list would temporarily remove those scores. Missing fields retain prior
data. New scoring plays without a known timestamp wait for a later summary.

This patch has not been deployed to Cloudflare or observed on a real device
here. Actual publication delay, clip availability, CDN access, browser autoplay
and supplied-stream performance remain the live checks documented in the
[integration audit](live-highlight-integration.md).
