# Site-independent stream recovery — November 1, 2026

Based on GitHub main `ff0746003fb52e797bc6bc99804c4f9c5f0b14e5`. The release extends the existing stream adapters, while preserving the audited director, commercial detection, scoring, lineup import, and highlight logic.

## What changed

| Source or failure | Recovery |
| --- | --- |
| Any HTTPS stream page, including Stream Corner and NTV | Retain the sandbox, stable outer fullscreen, network/visibility gates, optional two-minute refresh, and indefinite page-loading retries. No hostname-specific recovery branch is required. |
| A page does not finish loading through the first three retry windows | Try the optional saved backup for the same game. With no distinct backup, keep retrying the current URL. |
| Direct live HLS or video stops advancing | Attempt playback resume after a sustained stall; a live HLS timeline can move to its live sync position. Persistent failure then reopens the source or tries the saved backup. Healthy direct video is never periodically reloaded. |
| Direct live video reports an error or ends unexpectedly | Keep the game selected and recover instead of cooling down the game or reporting replay completion. |
| Repeated direct-video failures | Back off retries to waits of 15, 30, then 60 seconds. Sustained progress for 15 seconds clears the failure count; a single moving frame does not. |
| A backup also fails | Keep recovering, with automatic changes between the two saved sources at least 60 seconds apart. Preserve the game selection and fullscreen. |
| Hidden tab or reported network outage | Suspend recovery deadlines. Network restoration reconnects once, with a ten-second minimum interval during repeated connectivity drops. |
| Yellow Pause, game retirement, or source replacement | Stop recovery for the retired playback request; late SDK attachments, fatal callbacks, and reconnect callbacks cannot revive it. |
| Failed or hung HLS SDK download | Clear the rejected promise, time out an unanswered download after 15 seconds, and use a fresh module URL on retry. Once downloaded, share the successful module. |
| Viewer notices an unreported failure inside a website | Reload stream or Try backup / Try primary is available beside Pause. These controls retain the game and lineup. |

The player pool no longer sends redundant play/pause commands on every live hold tick. A recovering direct-live player remains in its slot, so a stored error cannot cause the pool to recreate it every 250 ms. Pending direct-live loading also survives the old 20-second timeout and long browser sleeps. Existing replay loading limits remain in place.

## Saving sources

Existing primary links remain in `streams`; optional backup links are stored separately in `streamBackups` and validated with the same HTTPS URL rules. Invalid backups cannot erase valid primary links. Primary and backup drafts remain distinct. Editing an inactive backup does not interrupt the active source. Saving a plain homepage displays a reminder to use the game's or channel's page URL when possible.

A backup is supplied by the viewer. The app does not discover or scrape replacement broadcasts. Source rotation is distinct from the director choosing another game: it neither increments game cuts nor releases the manual pin. Normal commercial exits, finished games, highlights, and intentional game switches still apply.

## Stream Corner inspection and limits

The public homepage at `https://streamcorner.st/` and its referenced `/assets/kygYsx60.js` app bundle were readable during this audit. The app embeds nested players and has game/channel routes under `/stream/...`. Its public bundle did not expose a verified parent-facing playback-progress channel; the observed `postMessage` was framework scheduling. This is evidence about that public integration surface, not proof about every provider nested inside it.

Fantasy Stream cannot inspect cross-origin video playback inside arbitrary websites. A completed iframe load can still contain an error page. Periodic refresh is a blind fallback, can interrupt healthy video, and may require another Play click. It does not automatically choose a source inside Stream Corner's own interface or preserve an internal selection that is absent from the saved URL. The optional backup control provides a way to switch when such failures are invisible to the parent app.

Direct-video progress and full browser playback are different verification boundaries. Tests simulate media events and fullscreen state; no actual Stream Corner video, browser decoding, autoplay gesture, or mobile fullscreen behavior is certified by these tests. Browser automation remains unavailable in this workspace. Source uptime and seamless continuity during an upstream outage cannot be guaranteed.

Implementation references: [HLS API](https://hlsjs.video-dev.org/api-docs/hls.js.hls), [live sync position](https://hlsjs.video-dev.org/api-docs/hls.js.hls.livesyncposition), and [dynamic import caching](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import).

## Verification

- **598 tests pass**, including the full archived Sunday rehearsal.
- Twenty-five additional tests cover three hours of healthy direct playback without reloads; sustained failure backoff; fatal errors/endings; live-edge recovery; offline, hidden, paused, and retired states; stale attachment callbacks; HLS download failure/timeout; preference migration; same-game fallback across three independent hostnames; manual switching; saving backups; and long initial sleeps.
- Repeated page failures run through ten simulated minutes per host and nine source changes, preserving the pin, game, fullscreen, and zero cooldown entries throughout.
- Seven selected negative controls fail against the previous app/loader source: source fallback, retaining a direct-live game after error, live ending recovery, backup input availability, SDK retry, cancelled attachment, and stale fatal callback rejection.
- Production build, Worker syntax, and whitespace checks pass. The compiled Worker serves 27 exact assets, 27 HEAD responses, four expected route responses, normalized NFL metadata, and the exact HLS SDK through a retry query URL. Live asset and active-deployment verification follow upload.
