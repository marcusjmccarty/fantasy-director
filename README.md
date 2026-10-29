# Fantasy Director

Minimal viewing room: one player and a tabbed Games / Roster / Highlights panel. Body type is 16px; setup lives in a small connection bar and a settings dialog. Nothing starts switching until the user starts the replay test.

## Run and check

- `npm test`
- `npm run build`
- `npm run dev`, then http://127.0.0.1:4173

Plain browser JavaScript, HTML and CSS. The dependency-free Cloudflare Worker serves those files and one roster-import endpoint. Build output is in `dist/server/index.js`.

## ESPN connection

POST `/api/league` with a numeric leagueId. Public leagues work without credentials. A configured owner's private league uses the server's saved ESPN connection only if both the authenticated user and league ID match. The current team is identified using ESPN ownership; other leagues present a team picker. Only starters are imported; bench and IR are excluded.

Runtime secrets: `ESPN_OWNER_ID`, `ESPN_LEAGUE_ID`, `ESPN_SWID`, `ESPN_S2`. No credentials belong in code, files, logs or browser storage. Saved cookies are never sent for another user or another league. The API returns roster fields, never league member details or cookies. Browser storage holds only the selected roster, league/team identifiers and user stream URLs.

## Replay testing

Two source pages provided by NFL-Video resolve through their listed players to OK video embeds:
- Cowboys at Eagles, October 26, 2026: https://nfl-video.com/dallas-cowboys-vs-philadelphia-eagles-full-game-replay-nfl-week-07-october-26-2026
- Colts at Vikings, October 25, 2026: https://nfl-video.com/indianapolis-colts-vs-minnesota-vikings-full-game-replay-nfl-week-07-october-25-2026

Original pages remain linked. The app uses their embedded players, without copying, extracting or proxying the game video. Only one game player is loaded. Playback, availability and autoplay are controlled by the provider; a click inside the player may be required. A cut loads a different replay and does not preserve its position. Five scripted events demonstrate roster priority, closest scoring threat, a quiet highlight window and a priority return. Those events are explicitly not synchronized to the actual footage. Published ESPN highlights for the same week populate the replay queue when available.

## Live viewing

ESPN scoreboard poll: 5 seconds during live games, 30 seconds otherwise. Summary polling adds published highlights. Live playback accepts compatible direct HTTPS MP4/WebM or browser-native HLS. Subscription watch-page URLs and DRM integrations are not supported. Player presence is inferred from possession/position, not snap tracking; data latency still depends on ESPN.

## Verification

14 automated checks cover director routing, replay scenarios, parsing, private-cookie isolation, request validation and upstream failures. A live server-side import using the supplied connection returned 10 teams and identified We Are Christian Kirk with 9 starters. Embedded replay pages resolved successfully; full browser video playback could not be verified in this environment because browser automation was unavailable and the native preview did not expose content. Provider playback still needs an interactive check.
