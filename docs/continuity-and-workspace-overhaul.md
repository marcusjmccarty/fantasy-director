# Continuity, manual control, and workspace overhaul — October 31, 2026

Baseline: `7ac7dc38b2279e4783e3d7d17ef145916a3dc178`.

This revision responds to the reported Zay Flowers cutaway, a commercial that
stayed on screen, the request for a structural interface overhaul, and the
requirement that a viewer's game choice takes priority over automatic ranking.

## Findings and changes

| Finding | Change | Boundary |
| --- | --- | --- |
| With no ranked involvement, the director returned the current roster game even when it was on a break and another roster game had action. | Try an active roster game first; then a configured non-roster stream when roster games are in breaks or unavailable. | No automatic unrelated channel after the roster slate ends. Unavailable, ad-reporting, pregame and final games cannot be automatic backups. |
| The original manual-selection path rejected non-roster games and could not reliably choose a particular future replay. | Every configured stream is listed in the guide. A separate selection state takes precedence over ranking and highlights. Selecting a future/completed replay opens that recording from kickoff. | A click does not make an unavailable stream playable. Known failures/ads still use recovery. |
| A permanent pin and unrestricted automatic ranking both miss the requested interaction. | Stay with the selected game through its action. Its next detected break, final transition, player end, or failure releases control to automatic selection. | The choice does not automatically re-pin itself when that game returns. “Let the channel choose” releases it immediately. |
| Existing break metadata could immediately reverse a user's click. | The choice must reach the screen before that metadata can release it. An already-reported break gets ten seconds after display; a newly detected break releases the choice. | Supported provider ads and failures still release immediately. Replay media protection can defer an inferred break until the estimated action finishes. |
| Replay wall time can stretch or compress inside anchor intervals. A guessed play window can therefore be too short in video time. | `web/continuity.js` protects the visible replay using media positions: a 20-second minimum, extra time for longer plays, 32 seconds for scoring plays, and the mapped end plus eight seconds when the segment expands. | A single protected interval is capped at 60 seconds. These are estimates, not visual detection of the whistle. Manual choices protect action even outside the fantasy lineup. |
| Short score clips could be interrupted mid-play by a newly urgent game. | Visible clips up to 90 seconds finish before automatic switching. Long/unknown clips protect their first 30 media seconds. User choices override either. | Loading clips can still yield. Buffering watchdogs, actual-duration handling, score correction, and watched-footage accounting remain active. |
| Recording fallback used a mapped start but a wall-time duration. | Both ends are now in media time, with 15–45 seconds of lead-in and 32 seconds after the estimated score. Both normal resolution and failed-official-clip fallback use this helper. | Wider windows can include additional setup/replays; they cannot repair a completely wrong anchor or identify every baked-in ad. |
| Ads embedded in the broadcast cannot always be reported by the player. | “Skip this break” temporarily excludes the current game for 90 seconds of unpaused time. “Undo break skip” restores eligibility immediately. Ad footage is not counted as watched coverage. | If no other video is available, the current game stays and the interface explains the available recovery. |
| A provider ad during a highlight could remain on screen under highlight rules. | A reported highlight ad enters clip recovery immediately. | Ordinary commercials inside a video without a provider ad event remain unobservable. |

Changing choices while a stream buffers makes the latest choice authoritative.
Choosing Watch from Pause starts the chosen stream. When leaving a highlight,
its last frame remains until the replacement is ready; it is marked Skipped,
not Replayed, and is not immediately queued again by that action. The player
pool remains capped at three and still warms only one likely next game.

### What the Flowers evidence establishes

The archive's Q4 Flowers reception at 11:08 (CIN–BAL row 136) has an estimated
9.32-second play window. Its existing mapping reduces that to about 5.47 video
seconds, from approximately 6208.85 to 6214.32. A regression test reproduces
that compression and verifies the new media-time protection.

The opening 48-yard Flowers touchdown (row 4, Q1 13:36) maps to video 538.
The previously generated local OCR log already shows Baltimore's touchdown
score at video 525, and scorebug readings around 501–510 describe the preceding
clock transition. That is evidence of alignment uncertainty, not a verified
frame-by-frame snap/whistle annotation. The expanded-interval guard and wider
broadcast fallback now cover that earlier footage. No built-in anchor was
silently rewritten based on an assumed exact snap.

The user's exact incident could have involved automatic game selection,
highlight pre-emption, or alignment. The corresponding vulnerable paths are
reproduced in tests; this audit does not claim to have watched that incident.

## Structural interface changes

- The red-dot brand and favicon return. The nearby mode label distinguishes
  Live games from Week 7 replay.
- A three-step setup path handles lineup, streams, and Watch. It disappears
  after playback starts. There is no separate large page hero above the room.
- Lineup remains in the header, including on phones. Manual player entry is
  immediately accessible; ESPN import is a disclosure. The replay editor
  shows the actual sample players instead of opening an empty form.
- The picture is reserved for video, loading/recovery states, and sound help.
  Scores, player context, and alerts move outside the picture.
- Play, sound, and fullscreen form the primary transport row. Seeking belongs
  to the replay area. Replay day/range settings are disclosed on demand.
- Stay with this game, automatic selection, Skip this break, Undo, and Return
  to games have explicit labels tied to the current state.
- Games, My players, and Scores share an accessible tabbed guide with arrow,
  Home/End, and focus handling. Available non-roster streams are selectable.
- Stream entry is a separate section below the player, folded after starting.
  Optional other-game links provide commercial-break alternatives. Draft URLs
  survive schedule changes and invalid URLs reveal their field before focus.
- Fullscreen reserves space for controls instead of placing them over the
  play. Exit stays visible. Small landscape layouts retain the main transport.
- Team-possession labels replace claims about individual players being on the
  field. Score counts say how many plays were watched; an explicit skip is
  labeled Skipped.

## Verification

- **496 tests pass** (`npm test`), including existing whole-Sunday simulations
  and 32 additional regression cases in this revision.
- **60,000 director comparisons** against the original `22d3d1d` revision:
  **476 intentional break recoveries**, **zero unexplained differences**.
  The comparison uses identical input/history for each decision; full-day
  simulations exercise resulting trajectories. Manual selection and media
  protection are separately exercised through the real app and domain modules.
- The comparison still reproduces the original two excluded-stream defects.
- Production Worker build and JavaScript syntax checks pass.
- `node scripts/check-build.mjs` verifies **26 exact bundled assets**, 26 HEAD
  responses, four route checks, and compiled highlight metadata handling with
  mocked upstream requests. It does not contact live broadcasters.
- CSS parses without warnings. HTML nesting, unique IDs, associated labels,
  and tab-panel references were checked with an HTML parser. The player,
  caption, and stream section boundaries were checked separately.
- Git whitespace checks pass.

Commands:

```sh
npm test
node scripts/audit-director.mjs
npm run build
node --check dist/server/index.js
node scripts/check-build.mjs
git diff --check
```

## Remaining release checks

The local Chrome process exits before it can render. A browser script was
prepared for desktop and phone layout checks, but it did not run successfully.
No screenshot review, actual provider playback pass, or Sunday live-broadcast
certification is claimed. Source and simulation tests do not replace those.

After deploying, test the Flowers drive, one short highlight through its finish,
a manual choice outside the lineup while a roster game is near the end zone,
a second choice while the first buffers, and a commercial followed by a return
to automatic selection. Also check a phone, lineup entry, sound, and fullscreen
exit. A live stream's delay and a recording's alignment remain separate timing
problems; successful replay testing alone cannot certify live timing.

The patch is prepared for the existing GitHub/Cloudflare workflow. Cloudflare
production is not deployed by this audit. From the original checkout, pull the
new commit and run `npm run deploy` with the existing Cloudflare authorization.
