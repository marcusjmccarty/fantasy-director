# Viewing room and NBA / NHL / MLB support

Built from GitHub production commit 1002468d43a4da96c06e637cb27742214cdd8c50.

The refreshed viewing room shares a compact dark interface across NFL, NBA,
NHL and MLB. Sport navigation stays separate from roster setup. The NFL guide
lists the entire slate before a roster is connected; empty fantasy panels stay
compact, stream setup collapses, and the guide uses its own scroll area. Phone
layouts stack the player, guide and matchup without horizontal overflow.

NBA, NHL and MLB have daily schedules, live scores, date navigation, Gamecast
links, per-game primary/backup URLs, manual viewing and automatic selection at
reported breaks. URLs are keyed by sport and event ID, preserving baseball
 doubleheaders and isolating sports. Local calendar dates are explicitly sent
to ESPN; an empty day is never replaced by the last available game. Loading,
connection failure, delayed results and empty schedules have distinct states.

The new fantasy connection imports every franchise and its roster, allows team
and opponent selection, and refreshes every 30 seconds independently of video.
Points leagues display ESPN's official matchup total and dated actual player
points for the current scoring day. Bench players are labeled and cannot inflate
the official total. Category and rotisserie leagues display rosters with an ESPN
link for full category standings; this release does not compute category totals
or convert those formats into points. Connections and saved streams remain
separate from NFL's existing storage. Private leagues use the viewer's own ESPN
cookies, sent only to the configured ESPN origin with redirects disabled.

NFL's director, break handling, highlights and replay behavior are unchanged.
The new sports use a conservative selector: prioritize followed starters' teams,
then close late games and (for baseball) runners in scoring position. Do not cut
away from a healthy active game until a reported break or game end. This follows
team involvement, not individual substitutions or visual whistle detection.

All sports reuse the existing native/HLS and embedded-page adapters. Health
checks enable native recovery, respect Pause/background/offline states, and
rotate same-game backups with spacing. Source errors retain the adapter's retry
limits instead of triggering an immediate reload loop. Fullscreen uses the
stable picture area with compact controls. A third-party page's own fullscreen
button is enabled; the app cannot isolate video inside arbitrary cross-origin
pages or guarantee their startup, advertisements or decoding.

Validation: 667 automated tests, including 24 new tests for sports data, actual
and missing points, category formats, date isolation, stale requests, manual
choices, source recovery, Pause, fullscreen retention and connection isolation.
The compiled Worker serves 32 exact assets with HEAD/route checks. Real ESPN
NBA, NHL and MLB schedules and fantasy pro-team metadata were fetched, including
the correct season-ending year for basketball and hockey.

Browser QA inspected the production site before changes and the revised desktop
and 390px phone layouts. The preview server cannot resolve ESPN (EAI_AGAIN),
although the compiled Worker returns live ESPN responses from the test runtime.
This limits populated preview interaction until deployment. No private fantasy
credentials or third-party live-stream decoding were verified in this pass.
