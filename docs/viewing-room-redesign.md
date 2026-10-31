# Viewing room redesign — October 31, 2026

> Historical first pass. The later [workspace overhaul](continuity-and-workspace-overhaul.md) restores the red-dot logo and replaces this layout and several interaction policies.

Baseline: `73e6d560ac7a3696f236124bf188a5a77bdd73c1`.

The brief was to take inspiration from NTV.st while keeping Fantasy Stream
usable for someone with very little website experience. The direct page reader
could not render NTV.st. A saved September 26 capture supplied the visual
reference: dark navy surfaces, yellow selected controls, rounded navigation
and a clearly ordered sports list. This is an adaptation of that direction,
not a pixel-for-pixel copy or a verification of its current live appearance.

Reference: [saved NTV.st capture](https://scanner.pcrisk.com/screenshots/ntv.st?t=1790445735326&w=1100).

## What changed

- A navy and warm-yellow theme, a new original play-mark logo, matching favicon,
  consistent panel borders and simpler typography.
- A prominent lineup panel above the player, plus desktop header and guide
  shortcuts. On small screens the large lineup panel replaces the duplicate
  header button to prevent crowding.
- A viewing frame that groups the channel label, picture, transport and status.
  Stream entry remains directly below it.
- Live/replay navigation stays explicit. A first-visit replay shortcut appears
  only after the archive is ready and enters replay without starting playback.
- Replay day, timeline range and tracker speed have visible labels. The entire
  replay-options area disappears in live mode. Stream instructions explain that
  replay videos are included.
- Game rows show full starter names, selection instructions and the automatic
  switching escape route. Pregame/final and temporarily blocked actions are
  disabled, with an explanation of waiting or replacing the stream.
- Play, Pause, sound and fullscreen use words. Fullscreen controls remain visible
  without hovering, and the fullscreen button changes to Exit full screen.
- Lineup entry distinguishes ESPN import from manual entry, with persistent
  Close and Save controls. Existing private-league and timing workflows remain.
- Responsive layouts, 44–54 pixel primary control heights, a keyboard skip link,
  visible focus indicators, reduced-motion support and brighter secondary text.
  Introductory overlays grow with their content instead of clipping it to the
  video's aspect ratio.

This pass changes presentation and UI event wiring. Director rankings, source
resolution, player lifecycle and coverage algorithms are unchanged.

## Verification and limits

- **464 tests pass**, including four added checks for the first-visit replay
  shortcut, live/replay controls, fullscreen fallback exit, and selecting a game
  then returning to automatic switching.
- Static HTML validation checks balanced nesting, unique IDs, one page-level
  heading, and all 25 label/anchor/ARIA references resolving to existing IDs.
- CSS compilation, production Worker build, syntax and whitespace checks pass.
  All 25 bundled assets match source, with HEAD and route checks passing.
- The four main solid text/background pairings measure 7.94:1 to 15.37:1
  contrast. This is a palette check, not a claim of complete accessibility
  conformance.
- The original 60,000 healthy-stream director comparisons remain unchanged.

A local Chrome rendering attempt exited before producing a screenshot. No
visual browser pass or real streaming playback pass is claimed for this build.
It has been prepared for the user's replay rehearsal, not deployed to Cloudflare
here. During that rehearsal, check desktop and phone widths, the long lineup
dialog, fullscreen entry/exit, sound, and a highlight returning to the game.
