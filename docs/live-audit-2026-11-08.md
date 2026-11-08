# Live audit — November 8, 2026

Production: https://fantasy-stream.fantasy-hub.workers.dev/

Cloudflare version `90c0afe3` was deployed and its HTML, app, director, live-feed,
break-control, and player-pool assets were compared byte-for-byte with the build.
The full test suite passed: 1,014 tests, zero failures. The compiled-worker checks
also passed. These checks do **not** establish reliable NTV autoplay or ad removal.

## Changes deployed

- An unrelated game yields immediately when a starter becomes active elsewhere.
- Inferred live-play timing no longer grants the same protection as an observed
  replay play. Actual replay play protection remains intact.
- A detected break can yield to another available game, including a defense or
  filler game, instead of holding an embedded stream solely to preserve its session.
- Timeout and kick breaks do not expire after 180 seconds without fresh evidence.
- Identified stoppages remain held until a fresh, settled football play appears.
- Leaving a nested fullscreen frame first preserves the channel theater view.
  A commercial cover exits nested fullscreen so the parent cover can be visible.

## Actual live-browser findings

- Reloaded an old open Fantasy Stream window. It had still been running an older
  build and showing stale fantasy scores. Fresh scores loaded after reload.
- Observed automatic selections move from Washington to Denver, then to a filler
  game and back to Cleveland when Fannin's offense became active.
- Safari's autoplay setting was changed to Allow All Auto-Play for Fantasy Stream
  and the observed NTV player host, taifood-blog.asia. Pop-up and security settings
  were left unchanged.
- NTV still presented a Play button on a fresh stream. Read-only DOM inspection of
  its inner JW Player showed autoplay=false, paused=true, and currentTime=0.
  The provider's alternate Clappr player also started paused with autoplay=false.
  A browser preference alone therefore does not solve startup.
- Clicking Play produced live footage. Cleveland playback was tested inside the
  Fantasy Stream channel fullscreen view with the application controls hidden.
- A commercial was reproduced on the Jets feed while the application still showed
  its previous fourth-down situation. This is an unresolved video/feed timing
  mismatch, not proof that the detected-break latch failed.
- An unrelated advertising redirect was blocked by automatic approval review and
  was left blocked. Temporary provider inspection tabs were closed.

## Remaining release limitations

The NTV iframe cannot currently be commanded to start, muted, or inspected for ads
by the parent application. There is no verified provider control protocol in this
integration. Loading a frame is not proof that video is playing. Switching to a new
NTV frame can still require Play, and ESPN events alone cannot guarantee that every
commercial is hidden. These limitations must not be reported as fixed.

Reliable seamless playback requires a supported controllable player integration or
a usable direct-media source. Accurate commercial suppression additionally needs
video-aligned break evidence. Do not hardcode expiring media URLs observed during
the audit or weaken browser security to obtain them.
