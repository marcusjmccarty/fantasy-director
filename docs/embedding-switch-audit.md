# Embedding switch audit — November 1, 2026

Baseline: `329abba94e9b36d50803d57687c539f43a49e053`. The user reports that Stream Corner works directly but freezes during switches in Fantasy Stream. This pass audits iframe lifecycle and media permissions. It does not treat an iframe load event as proof of video playback or claim the user's exact freeze was reproduced in a browser.

## Confirmed defects and changes

- **Return-switch ordering:** the pool previously handled players in insertion order. Switching from a newer slot back to an older slot started the incoming page before retiring the outgoing page. The pool now hides all outgoing players before activating the selected slot.
- **Stale load events:** the same iframe was reused for the stream, `about:blank`, and subsequent reloads. Its `src` attribute already contained the newest URL when an older queued load callback ran, so the callback could incorrectly clear the new load deadline. Every navigation now uses a freshly configured iframe. Load callbacks must belong to the current element and an active playback request.
- **Context retirement:** hiding or pausing an active page replaces and detaches its iframe, retiring its nested browsing contexts. Showing or reconnecting opens a new context. The player slot and outer fullscreen stage remain stable. Returning to the same already visible game does not replace its iframe.
- **Pause enforcement:** showing a paused embed no longer starts its source before Play is requested.
- **Media delegation:** autoplay, encrypted media, and picture-in-picture are explicitly allowed across origins used by nested or redirected players. Fullscreen remains denied inside the frame, so our stable stage owns it. Sandbox restrictions on popups, top navigation, dialogs, and downloads are preserved before every navigation.

Only the embed adapter and player-pool activation order change in production source. Director decisions, commercial detection, roster import, direct-video recovery, and source-rotation logic are unchanged. The existing optional two-minute refresh setting is retained; it is still a blind fallback that can interrupt healthy embedded video.

## Evidence and limits

The current public Stream Corner homepage returned HTTP 200 without an `X-Frame-Options` or `Content-Security-Policy` header in this audit. Its previously inspected app bundle contains nested iframe players. The homepage also loads popup and anti-debug scripts. These observations do not establish the behavior or headers of every watch page or nested media provider. No provider script was stripped, proxied, or modified.

References: [iframe lifecycle and attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), [permissions policy and origin navigation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Permissions_Policy), and [autoplay delegation](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay). Browser autoplay preferences and the embedded site's own policies can still require a click inside its player.

## Validation

- **604 tests pass**, including the archived Sunday rehearsal and existing live-source recovery tests.
- Six new tests cover stale page/blank/reload events, paused visibility, media permission configuration, unchanged-frame selection, and 100 alternating Stream Corner-shaped game switches.
- The switch rehearsal checks outgoing detachment before incoming navigation, one active page in the layer host, current-frame attachment, accessible visibility, and readiness after each fresh load.
- Five negative controls fail against the previous embed or pool source: paused-show behavior, stale page/blank load handling, stale reload handling, explicit media delegation, and return-switch ordering.
- The test DOM now models iframe replacement/removal and distinct frame identities. Navigation history is aggregated per player for the existing retry-count tests.

Actual browser decoding, Stream Corner's internal player startup, user-gesture requirements, and mobile fullscreen remain unverified because browser automation is unavailable in this workspace. These fixes address demonstrated problems in Fantasy Stream's switching machinery; they are not proof of uninterrupted third-party playback.
