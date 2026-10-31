# Live highlight integration — October 31, 2026

Baseline: `f85ac2d59878a287d8ee6b565ede0744a1590ecd`.
This follow-up addresses the NFL live-catalog gap found in the
[full logic audit](full-logic-audit.md). It adds conditional matching and
recovery paths; it does not establish that every current NFL publication has
the metadata or anonymous playback permissions these paths require.

## Result for viewers

The app first looks for a matching ESPN clip from the game's summary. It now
retains the description, page URL, expiration and device restrictions that the
old polling code discarded. NFL clips can also be selected when their metadata
corroborates the game and scoring play. The original game director and its
switching priorities are unchanged.

| Situation | Result |
| --- | --- |
| Game-specific ESPN footage is usable | Prepare the matching clip, using its description as well as its title. |
| NFL metadata identifies one game and one score | Resolve its official anonymous HLS source and prepare the clip. |
| One resolver fails | Try another matching candidate, up to three per lookup. |
| A live clip fails during playback | Retire that clip for the current retry window and queue another source. Game selection continues. |
| Footage has not appeared | Show **Waiting for replay** and retry at thirty-second intervals, for up to thirty minutes after the score. |
| A matched clip cannot play inline | Offer **Watch on NFL.com** or **Watch on ESPN**, opening its publisher page in a new tab. |
| No clip can be matched | Offer **Open game on ESPN**, clearly identifying a game page rather than a specific highlight. |

The score text and publisher links use 16px type. Links have a minimum 44px
target and visible keyboard focus. Status labels sit below the text so they
do not squeeze it into a narrow column. Existing lineup and stream placement
is retained.

## Matching rules

`web/live-highlights.js` is the live-only matching boundary. Archived clips
continue to use their existing game association and recording fallback.

An unscoped NFL clip must satisfy one of two event-association paths:

1. **Publication time and team evidence.** An explicit publication timestamp
   must be within two minutes before to two hours after the scoring snap,
   within eight hours after kickoff, and no more than two minutes in the future.
   Team evidence must identify exactly one of the loaded games. With only one
   team named, quoted yardage must match whenever the scoring play has yardage.
2. **Explicit season, week and both teams.** When a timestamp is absent, the
   clip must specify the game's season and week and identify both teams. The
   matchup must still be unique.

Both paths require compatible score type and scorer/kicker identity when the
score has one. Quoted yardage cannot contradict the score. Explicit conflicting
team tags, season/week values and years reject the association. Compilations,
overturned/negated scores, touchdown-saving tackles and missed field goals are
excluded. If two known scores fit the same clip, neither is guessed. A clip
already replayed for one score cannot be used for another.

These are conservative metadata rules, not video recognition. A mislabeled
publication or incomplete play-by-play can still defeat metadata matching.
Publication time is never substituted with the time the catalog was fetched.
Date-only values without a time zone do not qualify as timestamps.

## Provider and Cloudflare changes

`server/nfl.js` preserves playlist descriptions and explicit publication
fields. It also reads standard VideoObject JSON-LD and primary-page publication
meta tags. Primary-page metadata is not copied onto an entire related playlist;
an explicitly different video URL defeats a matching headline.

The catalog can enrich up to six scoring pages per refresh, with at most eight
HTML requests on a cold load. Each HTML request has an eight-second timeout;
enrichment runs concurrently and tolerates individual failures. The catalog
cache lasts one minute per Worker instance, and individual page enrichment
attempts are spaced five minutes apart. Relevant metadata caches are bounded.
The browser polls once a minute while games are active and every five minutes
otherwise. This is selective enrichment, not exhaustive coverage of every clip.

Cloudflare can route catalog and playback requests to different instances.
The client therefore supplies a validated NFL page slug with a clip ID. A cold
resolver fetches only the fixed NFL host, verifies the requested ID belongs to
that page, and then uses the existing anonymous playback flow. It does not
accept arbitrary fetch URLs. Identity tokens remain server-side; DRM and
non-provider media URLs still reject inline playback.

Prepared sources are checked again before playback. Both client and server
avoid reusing NFL media links with ten seconds or less remaining, preventing a
refresh loop on a nearly expired cached link. Each candidate has its own player
key, so switching candidates cannot reuse a failed player accidentally.

Retry scheduling no longer depends on a successful ESPN summary refresh.
Turning highlights off clears pending retries and waiting labels. Stale mode
and lineup results retain the existing source-identity/generation guards.

## Verification

- **419 tests pass**, including 28 new matching, metadata, recovery and app
  integration cases. Provider requests and media boundaries are mocked.
- **60,000 healthy-stream decisions** still match the original pre-review
  director, with zero unexpected differences.
- The Worker builds with **25 assets**. Every bundled asset was compared with
  its source bytes, and all 25 HEAD responses were checked.
- Built-Worker routing, method rejection and NFL metadata normalization passed
  an in-process smoke check. JavaScript syntax and `git diff --check` pass.
- Tests cover wrong-game/old/reel/negated footage, ambiguous repeat scores,
  late publication, failed-source alternatives, expired links, short clips,
  cold Worker resolution, partial enrichment failure, publisher links, ESPN
  description retention, stale responses and disabling retries.

Run the committed checks with:

```sh
npm test
node scripts/audit-director.mjs
npm run build
node --check dist/server/index.js
```

## What remains unverified

Public NFL page text was inspected and contains useful player/distance details
in descriptions. However, this environment could not retrieve the current raw
NFL HTML through the application runtime. The new metadata parser is tested
against explicit synthetic contracts, not a captured current NFL response.
Actual availability of timestamp or season/week fields remains a deployment
check. If those fields are missing or ambiguous, automatic NFL matching stays
disabled for that clip; ESPN matching and publisher/game-page links remain.

No browser was available for this revision, and these changes have not been
deployed to Cloudflare here. Real HLS playback, provider permissions, mobile
sound/autoplay, and the new score layout still need a browser check on the
deployed release. The automated results do not certify Sunday's third-party
streams or guarantee that a publisher will release footage of every score.

Deploy from the user's existing checkout:

```sh
cd "/Users/marcusmccarty/Documents/Codex/2026-10-25/new-chat-2/sites/fantasy-director" &&
git pull --ff-only &&
npm run deploy
```

After deployment, use the intended phone and desktop to confirm picture and
sound, then check `/api/nfl-highlights` for real description/date/season/week
fields and exercise a matched clip plus the publisher-page fallback. Retain
the conservative matching rules if provider metadata is absent.
