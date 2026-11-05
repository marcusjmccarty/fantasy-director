# NTV playback update — November 5, 2026

NTV's official HTTPS `/embed?t=…` player now runs inside the channel without an iframe sandbox, because NTV refuses sandboxed playback. The exception is limited to the exact NTV host (normalizing `www` and a trailing dot), HTTPS, standard port, no credentials, and a nonempty token. Watch pages resolve through NTV's published API first. Unresolved pages keep the outside-player fallback. Other providers retain their sandbox across reloads and switches.

This enables the embed and removes our sandbox-related rejection; it does not prove NTV serves working video. NTV and its nested player can open pop-up ads or attempt navigation after a click. Browser popup protections may still apply. The site cannot inspect cross-origin playback or guarantee seamless starts. Reload, Pause and fullscreen remain available.

The historical verification below describes the earlier blanket sandbox policy and does not apply to the NTV exception.

# Embedded stream containment — November 1, 2026

Based on GitHub main `043f7285398343c8ecb19b535ef6ddf7c014b7f9`, including the recovered Sunday logic release. Changes are confined to the live page adapter, its reload control, and resetting recovery timing when a new game is shown. The director's ranking, commercial detection, roster import, schedule, and replay adapters are unchanged.

## Problems and changes

- Generic stream pages had no iframe sandbox. Their scripts, including nested ad players, could attempt new windows and navigate Fantasy Stream after user interaction. The sandbox is now installed before any navigation and remains present across switches, pause/resume, and reloads. Scripts, the embedded site's own storage, forms, and media/presentation remain allowed. Popup, popup escape, top navigation (including after a click), modal, and download permissions are absent.
- Stalled-player recovery persisted across game cuts. A controlled sequence of two-second switches failed on switch 12 because the incoming page inherited the outgoing player's deadline. Every committed game now starts a fresh recovery window. An individual page that never finishes loading still enters cooldown and yields to another eligible game.
- A stream can navigate or fail inside its own cross-origin document without informing the app. **Reload stream** beside Play reopens its original URL, preserving the lineup, coverage, manual choice, and other player slots. It is disabled during Pause and does not appear for direct video or highlights.
- Destroyed embeds cannot be restarted or marked ready by late load/play/visibility calls.

## Verification

- `npm test`: **553 passed**, including eight new adapter and application regressions.
- Repeated switching exercises the real app, PlayerPool and EmbedPlayer with controlled iframe load events. Sixteen manual switches preserve sandbox flags and unload outgoing pages.
- The recovery test verifies a page that never loads is closed, releases its manual choice, and yields to another game while the channel keeps playing.
- Negative controls: the pre-change app fails the repeated-switch case on switch 12; the pre-change embed adapter fails the sandbox-before-navigation assertion.
- Production build and syntax check pass. `node scripts/check-build.mjs` passes 27 exact asset comparisons, 27 HEAD checks, four route checks, and compiled NFL metadata handling.
- `git diff --check` passes.

## Browser boundary

Browser sandbox behavior follows the [HTML standard](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox). Sandbox restrictions propagate to nested frames. These tests verify configuration and application behavior; they do not simulate a browser enforcing the sandbox.

A headless Chrome verification attempt could not launch in this execution environment. The public NTV page returned HTTP 200, but actual NTV video and its popup sequence were not browser-verified here. A live check should switch between the viewer's NTV game links, interact with the players, confirm no external popup or parent-page navigation occurs, and exercise Reload stream, Pause, resume, and fullscreen.

Sandboxing does not remove overlays or commercials drawn inside a third-party page. A cross-origin iframe load event does not prove that video is playing; browsers can fire it even for a failed load. The app therefore retains its existing coverage rules and does not claim embedded page video as confirmed watched footage. Reload stream provides recovery for page-internal failures the parent cannot observe.
