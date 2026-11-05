# League chat operations

Chat appears only after a league has been connected. Public lounges return HTTP 410 for reading, posting, and WebSocket upgrades. League rooms remain open to anyone who knows the league ID; ESPN membership and names are not verified.

Rooms keep at most 300 messages. Messages expire one hour after posting. SQLite rows are pruned before reads/posts and by a Durable Object alarm, including when nobody is watching. Live clients receive removal notices; polling and reconnects replace their history with the server snapshot.

## Enable moderation

Set a random, unique moderator key of 32–256 characters as the Cloudflare Worker secret `CHAT_MODERATOR_KEY` with `npx wrangler secret put CHAT_MODERATOR_KEY`. Keep the key in your password manager. Do not put it in source control, a URL, chat, or a published configuration file.

Connect a league, open Chat → Moderate, and paste that key. Unlock is verified by the server. Remove deletes one message; Clear room requires a second click and deletes the room's messages for everyone. Lock or reload the tab to discard the browser's in-memory key. Nothing stores it in localStorage. Without the Worker secret, moderation fails closed.

For local testing only, the preview server accepts the same secret in its ignored `.sites-runtime/env.json`. Do not reuse the production key for testing.

## Remove the old test lounges

After deployment and secret setup, run `node scripts/moderate-chat.mjs --purge-lounges`, supplying the key through stdin or the `CHAT_MODERATOR_KEY` environment variable. It clears the four retired sport lounges and closes their sockets. It does not clear league rooms. A successful result prints each room and its removed count, never the key.

Use `--room nfl:league:123 --id 42` for one message, or `--room nfl:league:123 --clear` for a league room. The command defaults to the existing Cloudflare site. An explicit `--url` supports another HTTPS deployment or a loopback preview.

Public lounge closure takes effect on deployment even before this cleanup is run; physical deletion of existing dormant lounge data needs the cleanup command. Old dormant league rooms get the retention policy on their first request after deployment. Already connected legacy lounge clients are closed on their next message/heartbeat or by cleanup.

## Verification

Tests cover the memory store, real SQLite queries, expiry alarms, authorization failures, cross-site requests, invalid delete payloads, retired lounges, live removals, polling snapshots, reconnects and room changes. The GitHub verification workflow runs the whole suite and builds/checks the production Worker. Device audio/fullscreen playback still needs an actual iPhone check.
