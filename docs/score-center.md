# Score center — November 1, 2026

The player now follows the masthead directly. The duplicate lineup banner and
three-step setup menu are removed; the existing first-use player overlay still
guides a new viewer. Lineup editing has one permanent button in the fantasy
scoreboard below the player.

The score center includes the current NFL slate, live/final/scheduled states,
possession, team logos, scores, a filter for games involving the viewer's
starters, and links to ESPN Gamecast. Live scores use the current ESPN feed and
are explicitly labeled as potentially ahead of the stream. Replay mode instead
uses the sampled replay timeline, avoiding future results.

For an imported ESPN team, the fantasy panel shows each starter's actual weekly
points and their sum, using ESPN's league-adjusted values. It excludes bench and
IR slots. Only actual stats with the requested scoringPeriodId and weekly split
are accepted. General playerPoolEntry.appliedStatTotal is deliberately ignored:
a live check against ESPN's public 2019 Week 2 data returned 54 there for Dalvin
Cook but 28 in the actual Week 2 stat. Odell Beckham Jr. similarly returned 43
versus 29. All 14 teams in that response had complete weekly starter totals.

Missing player points display as a dash and suppress the team total; they never
silently become zero. Manual lineups require an ESPN import for fantasy points,
because their league scoring rules are unknown. Fantasy totals remain subject
to ESPN stat corrections and do not include commissioner adjustments to a
matchup score.

Fantasy scores refresh independently every 30 seconds, with one request at a
time, timeout/abort handling, stale-response guards, and a visible retry status.
The request follows the NFL feed's season/week when available and rejects a
response for another week. Switching leagues or entering replay clears the old
result. Refreshes never apply a roster, persist preferences, change the director,
or access the media pool. Existing playback and fullscreen recovery modules are
unchanged.

Validation: 619 tests, including scoring arithmetic, negative/zero/missing
points, weekly versus cumulative stats, corrections, stale requests, week
rollover, replay isolation, filters, and an app test that refreshes points during
playback without replacing the video or roster. Production build, Worker syntax,
28 exact asset comparisons, 28 HEAD requests, route checks, and compiled NFL
metadata checks pass. Real ESPN scoreboard and public league responses were
inspected. Browser rendering and the viewer's private league were not exercised
in this environment.
