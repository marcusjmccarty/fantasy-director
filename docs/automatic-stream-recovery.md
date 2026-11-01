# Automatic embedded-stream recovery — November 1, 2026

Based on GitHub main `c00372329509f2291c3c133b01d2fd95a05eef0f`, retaining popup containment and the previously audited director logic.

The previous embed watchdog treated a completed iframe load as perpetual progress. A video could freeze inside NTV while Fantasy Stream continued to see the page as ready. The parent cannot inspect the cross-origin video. Public NTV watch/player modules were inspected; the existing integration has no verified playback-progress channel. This change does not invent one.

The user explicitly selected the two-minute reconnect fallback, including its tradeoff: a healthy page also briefly reloads. This preference defaults on for live page embeds and can be disabled in Settings → Viewing. Native video and replay players are unaffected.

## Behavior

| Condition | Action |
| --- | --- |
| Loaded embedded page reaches its two-minute deadline | Reload the original URL once; retain the current manual selection, lineup, coverage, and other player slots. |
| Initial page never finishes loading | Retry after 15 seconds; retry again 20 seconds later; after a further 30 seconds, report one terminal error and let the existing cooldown/backup logic choose another eligible game. |
| Page loads during recovery | Cancel that load failure sequence. Page readiness remains distinct from verified video progress. |
| Network is reported offline | Suspend retries and their deadlines. When the network returns, reconnect once. Repeated drops cannot trigger reconnects more often than once per ten seconds. |
| Tab is hidden | Suspend recovery deadlines. Returning does not trigger a burst of overdue refreshes. |
| Pause, a game switch, a highlight, or destruction hides the page | Unload it and stop its recovery work. There are no independent reconnect timers that could revive retired players. |
| Manual Reload stream | Reload immediately and give the new attempt a fresh periodic deadline. |
| Periodic reconnect setting is disabled | Stop scheduled refreshes while retaining bounded page-load and network recovery. |

The visible player shows a reconnect status while its document reloads. The control and safety sandbox remain in place across every navigation. Each automatic tick checks current visibility and requested playback first.

## Validation

Thirteen new tests cover periodic fallback, load retry spacing and exhaustion, successful recovery, manual refresh timing, network restoration/flapping, background tabs, Pause, destroyed frames, preference persistence, and integration with the app's actual player pool and selection state. The prior never-loading-page test now checks both retries before backup selection.

`npm test` passes **566 tests**. The production build, Worker syntax check, and compiled checks pass: 27 exact assets, 27 HEAD responses, four route checks, and NFL metadata normalization. `git diff --check` also passes.

Negative controls against the previous app fail the periodic-reconnect and restored-network cases: neither reopens the iframe. Tests use controlled iframe load events and a controllable clock; they do not prove video playback inside NTV. Browser automation remains unavailable in this environment.

An iframe can fire load for an error page, and the remote player can require another Play click after reloading. The periodic fallback limits how long an unobservable freeze is left alone; it does not diagnose a frozen picture, guarantee upstream availability, or remove commercials/overlays within the embedded site. Watched-coverage rules remain unchanged.
