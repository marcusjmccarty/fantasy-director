# Viewing room refinement — October 31, 2026

Baseline: `d26296d41ba2fe07a6edc62f90d1718165b8cbf9`.

The previous room hid games, starters and scores behind one tabbed panel and
split playback into too many full-width bands. This revision gives each task
a stable location, keeps the yellow “Stream” wordmark and red dot, and tightens
the navy-and-yellow visual treatment.

## Layout and interaction

- A persistent lineup summary above the player shows the selected team and
  starter count, with a large Choose/Edit button. Desktop also previews names.
  It stays after the temporary setup steps disappear. On phones this replaces
  the duplicate header lineup button, keeping the masthead from crowding.
- Play, sound and fullscreen sit directly below the picture. Playback state,
  manual-selection controls and break recovery share a more compact area.
  Replay seeking is grouped separately, with timing repair inside the replay
  options disclosure.
- The game guide always shows games. Full team names, aligned score columns,
  possession information and an explicit Watch label replace the repeated
  instruction sentence on every card. A tracker-only choice says Game tracker.
  A returning game is not labeled On screen while a highlight is playing.
- The lineup and score history have separate, permanently visible sections.
  The guide's navigation uses ordinary in-page links, not tabs that hide the
  other content or rebuild the player.
- Stream links remain a separate disclosure beneath the viewing area. Mobile
  order is lineup summary, setup if needed, player, game guide, stream links,
  starters and scores. DOM order follows that sequence for keyboard users.
- Long game and score lists scroll in their own areas, with keyboard focus
  available. Keyboard shortcuts do not steal Space or arrows inside those
  areas. Named buttons, focus indicators, reduced motion, fullscreen exit and
  the lineup editor's persistent Save button remain.
- The welcome/recovery overlay grows with its content on small screens, so
  instructions and buttons do not clip inside a fixed video ratio. Fullscreen
  overlays scroll within their available space.

No external fonts, image requests or UI dependencies were added. The director,
break controller, highlight selection and player lifecycle were not changed.
The obsolete tab-navigation test now checks the permanent lineup summary and
verifies that opening its editor preserves the active player.

## Verification

- 529 tests pass, including commercial, selection, highlight, pause and
  full-Sunday simulations.
- Production Worker builds; compiled JavaScript syntax passes. The build check
  compares 27 exact assets and 27 HEAD responses, four routes and compiled NFL
  metadata behavior with mocked upstream requests.
- HTML nesting is balanced, all 148 IDs are unique, all 28 label/ARIA/anchor
  references resolve, and the page has one main heading.
- CSS compilation reports no warnings. Four main text/background combinations
  measure 8.29:1–15.46:1 contrast. This is a palette check, not an accessibility
  conformance claim.
- Git whitespace checks pass.

The attempted local Chrome run exited before rendering. No screenshot review,
real-browser responsive pass or live playback verification is claimed. Review
desktop and phone layouts after deploying through the existing Cloudflare
workflow. GitHub publication does not itself deploy that Worker.
