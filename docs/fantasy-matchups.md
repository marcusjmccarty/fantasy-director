# Fantasy matchups and live RedZone fallback — November 1, 2026

The primary scoreboard below the player now compares the followed fantasy team
with its actual ESPN opponent. It displays both starting lineups, slot order,
individual weekly points, matchup totals and the points difference. NFL game
scores remain available in a collapsed section beneath the fantasy matchup.

ESPN's league schedule maps scoring weeks to matchup periods. This mapping,
rather than a guessed week/period equivalence or the league's current status,
selects the opponent. Matchup totals prefer ESPN's live total, then its reported
total, preserving league adjustments and multi-week playoff scores. Player rows
remain explicitly labeled for the selected scoring week. A single week's player
sum cannot stand in for a missing multi-week total. Bye weeks, missing opponents
and doubleheaders have explicit handling; multiple opponents get a selector.

The permanent **Follow a team** selector uses all franchises in the imported
league. Selection updates the followed roster, saved franchise and matchup,
retiring obsolete roster imports. It can reuse the latest league score snapshot
immediately. Routine score polling never applies roster changes or touches the
player. Stream links survive franchise changes.

Stream entry shows every game in the current NFL slate. Other games are no
longer behind a collapsed backup section, and saving links works even without a
lineup or when none of the lineup's games appear in the slate. Same-game backup
URLs remain separate from these additional game streams.

Live automatic mode now enters RedZone-style coverage when no fantasy starters
are involved. It selects a configured, non-excluded, active game by proximity to
the end zone; it also works before and after the roster's games. A current play,
imminent snap, dwell, switching margin and debounce protect continuity. Detected
breaks and reported ads remain excluded. Active fantasy players take priority
again when they return. Manual selection still lasts until a natural break.
This is automatic coverage among the viewer's supplied links, not a supplied
NFL RedZone broadcast. Replay behavior retains its previous rules.

Validation: 634 automated tests, production build, Worker syntax and 28 exact
asset/HEAD checks. New tests cover team selection with an obsolete import,
opponent reversal, league period mapping, authoritative totals, bye weeks,
doubleheaders, lineup slot order, all-game URL saving, and RedZone selection,
return to roster action, manual choice and transition protection. Real ESPN
public-league data verified seven matchups from all 14 team perspectives.
Browser rendering and private-league authentication were not exercised here.
