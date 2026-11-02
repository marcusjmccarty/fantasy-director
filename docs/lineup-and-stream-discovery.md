# Scoreboard lineup and automatic player discovery

2026-11-02; based on GitHub main `865c59df9793905f84926931dffa51be16444ac2`.

The NFL starting lineup and its editor now live inside the fantasy scoreboard. The header restores the yellow Live/Replay switch, followed by NFL/NBA/NHL/MLB navigation and a Settings button. The non-NFL Replay link opens the existing NFL archive; no historical basketball, hockey, or baseball footage is implied.

Published NTV catalogs are matched against ESPN schedules using both full team names, sport, and a start time within 90 minutes. Ambiguous matches are rejected. The public catalog's live, all and nonLive groups are supported. Continuous channels are excluded from game-specific matching. NTV watch links resolve through its public get-watch-streams endpoint to its published /embed URL. No tokens are decrypted or fabricated, and video is not proxied.

StreamCorner game pages are inspected for one explicitly identified player iframe when accessible. Ads, unsafe URLs, ambiguous players, arbitrary server fetch targets, and cross-host redirects are rejected. The provider returned HTTP 403 during this audit, so real StreamCorner extraction and browser playback remain unverified. Users can paste the provider's iframe code or a direct player URL. Only the src URL is retained; supplied markup is never executed. Known provider landing/watch pages are not loaded into the stream frame if resolution fails.

Automatic matches are kept separately from saved primary/backup overrides. Existing ESPN connections restore using the established flow. Once the saved fantasy team and a live player match are available, the app attempts playback. Explicit Pause, mode/date changes, manual selection and an already healthy player take priority over late lookup results. Browsers and provider players can still require an initial Play or sound gesture. Initial ESPN connection still requires the user's league/team selection and, for private leagues, their existing connection credentials.

Provider lookup runs independently of ESPN polling and the NFL director. Requests have bounded time/size/concurrency, short caches and restricted server destinations. ESPN cookies are never forwarded to stream providers. Existing iframe sandbox restrictions remain; referrer policy now shares only the application origin on cross-origin requests for player compatibility.

Validation:

- All 693 tests pass, including 25 added discovery and integration cases.
- The full archived Sunday rehearsal and existing pause, fullscreen, commercial, replay and source-recovery tests pass.
- Production build succeeds; 33 assets match source exactly and support HEAD. Compiled NFL, all three sports, catalog and resolver route checks pass.
- Real compiled Worker requests returned an NTV NFL catalog and a resolved /embed player with HTTP 200.
- Both HTML pages have balanced nesting and unique IDs. The lineup display and editor are descendants of the scoreboard.
- Fresh browser visual/playback QA could not run: the available browser runtime exposed no browser and local Chrome exited before producing a screenshot.

The original fantasy-stream.fantasy-hub.workers.dev deployment attempt was rejected because its Cloudflare refresh token is invalid. That host must not be reported as updated without a successful authenticated deployment. The existing private Sites publication is a separate target.
