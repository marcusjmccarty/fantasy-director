# Fantasy Director — Web Foundation

A dependency-free static site: native JavaScript, CSS, HTML and one original 6-second sample WebM. No build step, remote fonts, framework, analytics, or embedded credentials.

## Run

`python3 -m http.server 4173 --directory dist`

Visit http://localhost:4173. `npm test` runs director policy tests.

## Included

- A 72-second Test Sunday: three roster possessions, a RedZone fallback, a replay window, then priority action. Pause, step, restart, or pin a game.
- Public ESPN scoreboard polling, every 5 seconds during active games, 30 seconds otherwise; background throttling and stale-data hold.
- Rotating ESPN summaries for published highlights, with direct MP4 validation and expiration/device restrictions. Playable clips queue during quiet periods; urgent live events preempt automatic replays. ESPN links remain available.
- A single live video element plus a replay element. Direct HTTPS MP4/WebM and browser-native HLS. Browser autoplay rejection exposes a Play control. Replay errors and timeout return to the selected game.
- Setup for manual starters, per-matchup stream URLs and an optional custom replay. Stored on this browser only; sample roster clearly labeled. Test Sunday always uses its own sample roster.
- Responsive keyboard-accessible interface, native fullscreen, default muted playback, reduced-motion support.

## Boundaries

No subscription television feeds are provided. Ordinary watch-page URLs are not embeddable video files. Provider login, DRM integration and ESPN private roster import are not implemented in this foundation. Browser-native HLS depends on browser capabilities. Games are switched by possession/team inference; actual per-snap participation is unknown. Public ESPN data has no latency guarantee. A fresh source can buffer on a cut; no claim of seamless broadcast switching is made.

## Verification

Seven automated tests cover scenario routing, urgent switching, fallback, score transitions, position roles, input validation and scoreboard parsing. Browser QA checked simulation routing, replay playback/return and real public scoreboard fetching. Live subscription footage remains unverified until a compatible source is configured.
