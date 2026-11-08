# Embedded playback and fullscreen

Production: https://fantasy-stream.fantasy-hub.workers.dev/

The site now exchanges playback state with the optional Chrome extension in
`extension/`. The extension is required to start providers such as NTV that do
not expose a parent-page playback API. Merely adding `allow="autoplay"` does not
start their players.

The extension checks Chrome's top-tab URL before it activates. In provider
frames it starts HTML video, retries recognized player Play controls, relays
commands through nested frames, and reports actual media timestamps. Pause,
switch, reload and destruction revoke the outgoing session. Sound refusal
falls back to muted playback with the app's sound control available for retry.
Fullscreen requests inside provider frames are routed to the stable `.stage`
element before the provider can consume the user's activation. Native browser
fullscreen still requires the viewer's initial gesture.

Without the extension, existing embed behavior remains available. The website
alone cannot promise automatic playback or retain native fullscreen owned by
a disposable cross-origin provider frame; it retains the channel theater view
as a fallback. It does not synthesize trusted browser input or weaken browser
security. The helper does not inspect video for commercials or promise to
bypass a provider's consent screen, DRM, or browser audio restrictions.

Verification: 1,028 tests passed, including 14 helper and bridge regressions;
the extension tests passed again after correcting the play-button hitbox for
small player controls. Build checks verified 38 assets and 13 routes. Six live
HTML/module responses matched the tested deployment byte for byte. The
browser verification session could not open (session routing failure).
Installation and live Chrome playback verification remain outstanding.

Cloudflare deployment: `bea29079-43ba-4d59-8c5d-f9ce855d2b33`.
