# StreamCorner integration status — 2026-11-15

The `.cloud` domain resolver and native-video preference are implemented, but
StreamCorner is **not yet a working automatic primary provider**. Keep PR #7 in
draft until actual StreamCorner playback and switching pass browser checks.

## Confirmed cause of the NTV-only result

`server/streams.js` parses HTML for published sports events. The current
`https://streamcorner.cloud/` response is a React app shell, without its game list
or player URLs. A successful HTTP response therefore does not mean StreamCorner
discovery succeeded. The API now reports `no_published_schedule` when the parsed
catalog is empty, and the client identifies NTV as the fallback.

This affects every browser using our server-side discovery, including Safari.
Changing autoplay settings does not repair the missing catalog.

## Provider investigation

The public entry module observed on this date was `/assets/CQJqMf5z.js`. Its
shared data module, `/assets/CIkQBTYL.js`, defines a separate worker-based data
service. Asset filenames can change; these are diagnostic observations, not
stable integration dependencies.

- Published schedule requests use `/corner?p=nfl` on a provider-configured
  `data.*.workers.dev` host. Detail requests add `id=<published stream_id>`.
- The inspected host was `data.gigav.workers.dev`. A plain GET returned HTTP 405
  and advertised POST/OPTIONS. It did not return a JSON schedule.
- The browser worker (`/assets/Cp8qs7nj.js`) imports a custom binary request and
  response protocol (`/assets/qSw7AWFW.js`). That protocol includes request
  nonces, time-dependent encoding, response decoding, and browser-context checks.
- The site's frontend uses `/stream/:source/:streamId` routes and reads
  `streams[].embed_url` from the detail result. It requires a source selection;
  the game route itself is not a direct video URL.

Do not invent game slugs, label an opaque page as native video, or promote a page
merely because its iframe loaded. The site needs an accessible schedule/player
integration and real advancing video before StreamCorner can satisfy automatic
switching without an extension. No provider code or binary protocol is bundled
in this application.

## Validation and release state

The fallback-reporting change passes all 1,153 tests. The build verifier passes
40 exact asset comparisons, 40 HEAD checks, 13 route checks, compiled discovery
and resolution checks, and the packaged extension comparison. These are local
checks with mocked network responses; they do not prove provider playback.

The last confirmed production release was PR head
`cfb6a48261dad62c2b300de04e43d976bf8de7fc` at
`https://fantasy-stream.fantasy-hub.workers.dev/`. This follow-up has not been
deployed. The earlier live checks reported provider media errors. Actual
extension-free StreamCorner autoplay, prebuffered cuts, captions off, and
persistent fullscreen remain unverified.
