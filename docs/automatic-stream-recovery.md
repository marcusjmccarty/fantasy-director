# Automatic embedded-stream recovery — November 1, 2026

This records the embedded-stream release. The subsequent [site-independent recovery pass](site-independent-recovery.md) adds same-game backup sources and direct live-video recovery; its validation supersedes the totals below.

Continuous-retry and fullscreen follow-up based on GitHub main `ffb7b8bc9388c9b0b86d75c771132c77023ce2d2`, retaining popup containment, the two-minute reconnect preference, and the previously audited director logic.

The previous embed watchdog treated a completed iframe load as perpetual progress. A video could freeze inside NTV while Fantasy Stream continued to see the page as ready. The parent cannot inspect the cross-origin video. Public NTV watch/player modules were inspected; the existing integration has no verified playback-progress channel. This change does not invent one.

The user explicitly selected the two-minute reconnect fallback, including its tradeoff: a healthy page also briefly reloads. This preference defaults on for live page embeds and can be disabled in Settings → Viewing. Native video and replay players are unaffected.

## Behavior

| Condition | Action |
| --- | --- |
| Loaded embedded page reaches its two-minute deadline | Reload the original URL once; retain the current manual selection, lineup, coverage, and other player slots. |
| Initial or reloaded page never finishes loading | Retry after waits of 15, 20, 30, then 60 seconds per attempt for as long as the selected stream is visible and playback is requested. Do not emit a terminal timeout, clear the manual selection, or send the channel to standby because of page-loading failure. |
| Page loads during recovery | Reset the retry backoff. Page readiness remains distinct from verified video progress. |
| Network is reported offline | Suspend retries and their deadlines. When the network returns, reconnect once. Repeated drops cannot trigger reconnects more often than once per ten seconds. |
| Tab is hidden | Suspend recovery deadlines. Returning does not trigger a burst of overdue refreshes. |
| Pause, a game switch, a highlight, or destruction hides the page | Unload it and stop its recovery work. There are no independent reconnect timers that could revive retired players. |
| Manual Reload stream | Reload immediately and give the new attempt a fresh periodic deadline. |
| Periodic reconnect setting is disabled | Stop scheduled refreshes while retaining page-load and network recovery. |
| Viewer uses Fantasy Stream’s Full screen button | The stable outer stage owns fullscreen; reloading the iframe does not replace that stage. The iframe explicitly denies nested fullscreen permission. Unsupported or refused browser requests use the window-filling theater view. |
| A legacy browser lets an embedded player own fullscreen | Before a reconnect unloads that document, install the theater fallback. This preserves the viewing area without trying to request native fullscreen outside a user gesture. |
| Viewer chooses Exit full screen or presses Escape | Respect the exit. A delayed fullscreen request cannot restore the fallback or leave a late native fullscreen grant active. |

The visible player shows a reconnect status while its document reloads. The controls and safety sandbox remain in place across every navigation. Each automatic tick checks current visibility and requested playback first. Reconnect callbacks run before navigation and recheck playback/visibility afterward, so a synchronous Pause or destruction cannot be undone. Player-pool callbacks reject events from retired slots.

Fullscreen recovery does not re-enter native fullscreen after the viewer deliberately exits it. Native fullscreen requires a user gesture; see [MDN’s fullscreen guide](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API/Guide) and [fullscreen permissions policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/fullscreen). Existing game decisions, commercial exits, highlights, and ended-game handling remain in force; this changes page failure recovery, not which game the director chooses.

## Validation

Seven additional tests cover outer fullscreen during retries and Pause, browser fullscreen exit, theater fallback and Escape, legacy nested fullscreen loss, delayed fullscreen responses, retired-player events, and interruption during reconnect callbacks. The previous timeout tests now simulate three hours of continued loading failures with no retirement or standby, followed by successful loading or Pause. Existing periodic refresh, network restoration/flapping, background-tab, preference, popup, switching, and replay tests remain in the suite.

`npm test` passes **573 tests**, including the archived Sunday rehearsal. The production build, Worker syntax check, and compiled checks pass: 27 exact assets, 27 HEAD responses, four route checks, and NFL metadata normalization. `git diff --check` also passes.

Five negative controls fail against the previous source: denied nested fullscreen, indefinite loading retries, pre-navigation reconnect notification, legacy fullscreen fallback, and pending fullscreen exit. Tests use controlled iframe load events, a controllable clock, and simulated fullscreen boundaries; they do not prove browser fullscreen behavior or video playback inside NTV. Browser automation remains unavailable in this environment.

An iframe can fire load for an error page, and the remote player can require another Play click after reloading. The periodic fallback limits how long an unobservable freeze is left alone; it does not diagnose a frozen picture, guarantee upstream availability, or remove commercials/overlays within the embedded site. Watched-coverage rules remain unchanged.
