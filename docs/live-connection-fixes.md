# Live connection and fullscreen fixes — November 2, 2026

Built on production commit a967ad7cceccd60b875ec4d81876ddfb4e2972a2.

## Fixes

- The game guide no longer sticks to the viewport while scrolling through later
  grid rows. Its game list retains its own scroll area.
- **Change fantasy team** is always visible. **Connect ESPN** opens the league
  form directly. League data loads even when no team has been selected or the
  cached franchise list is missing.
- Saved starter names remain visible while the score request is pending or
  failing, with missing points shown as dashes. Editing followed players keeps
  the league connection and official fantasy lineup separate.
- A successful roster import immediately supplies fantasy points, without waiting
  for a duplicate request. Fresh imports retire older in-flight polls. Seeds
  from another league, season or week, or outside the freshness window, cannot
  restore stale scores. Regular refresh remains every 30 seconds.
- Private-league, expired-login and missing-connection failures show a reconnect
  action. Transient errors retain the last data and expose Retry scores.
- Embedded pages may request their own session storage after a user gesture and
  may use their own video fullscreen button. Popup windows, top navigation,
  browser dialogs and downloads remain sandboxed before every navigation.
- **Open stream** opens the currently selected source in a separate tab, including
  after a backup switch. This is an explicit fallback, not an embedding fix.
- Channel fullscreen fills the viewport with the picture and a compact floating
  playback bar. Heading, status text, replay settings, director controls, toasts,
  guide, fantasy scoreboard and stream setup do not take space in that view.

## Fullscreen and provider limits

Our button expands the saved frame. When that URL is a whole third-party page,
its internal menus remain part of the frame; the browser does not let this app
reach into arbitrary cross-origin pages and isolate their video. The provider's
own fullscreen button is now enabled for that purpose, subject to the provider's
nested iframe permissions and browser support. Its fullscreen document can end
when a switch or reconnect unloads it. The existing stage fallback protects the
viewing layout, but cannot automatically re-enter the provider's video fullscreen
without a new user gesture.

The request to inspect Stream Corner live was rejected by the tool approval
system without a stated reason. No alternate request was used to bypass that
rejection. Existing captured markup and our local embedding code were inspected;
current Stream Corner startup, decoded playback and mobile behavior remain
unverified. Storage-access permission is a compatibility correction, not proof
of the cause or resolution of its playback problem. No provider scripts or
anti-embedding policies were removed or proxied.

## Validation

643 automated tests pass. Nine new regression tests cover visible setup controls,
saved roster loading/error states, restoring teams without a selection, keeping
a connection after manual edits, immediate import scores, external-source links,
fresh seed races, invalid seeds, and actionable login failures. Six new app tests
fail against the previous app source. Existing frame tests also require storage
and fullscreen permissions while retaining popup/navigation containment. Existing
recovery, pause, switching and fullscreen-transition tests remain green.

The production build passes Worker syntax, 28 exact asset comparisons, 28 HEAD
requests, four route checks and a compiled NFL metadata check. The production
ESPN endpoint returned 14 teams, their scoring rows and seven matchups from a
known public 2019 Week 2 test league. This validates the data path, not the user's
private league credentials. Browser rendering and real third-party playback were
not exercised; no claim of uninterrupted Stream Corner playback is made.
