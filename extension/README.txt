Fantasy Stream Playback — Chrome

Install once:
1. Extract Fantasy-Stream-Playback.zip and keep its folder somewhere permanent.
2. Open chrome://extensions in Chrome and turn on Developer mode.
3. Click Load unpacked and select the folder containing manifest.json.
4. Reload https://fantasy-stream.fantasy-hub.workers.dev/ in Chrome.
5. Start watching and enter Full screen once. Subsequent switches use that same
   channel container. Embedded player fullscreen controls route there too.

The helper starts HTML video and recognized JW Player, Video.js, Plyr and
Clappr play controls inside embedded frames. It retries players that load late,
relays mute/pause state, and reports actual media progress to Fantasy Stream.
It does not click arbitrary advertisements, links, consent prompts or CAPTCHAs.

Permission explanation:
Chrome shows access to websites because embedded players use changing domains.
The extension activates ONLY when Chrome confirms the top-level tab is the
Fantasy Stream workers.dev site or its existing chatgpt.site address. Local
development is also allowed on localhost/127.0.0.1 ports 3000 and 4173.
It does nothing on other tabs, sends no network requests, stores no browsing
history, and does not read cookies, fantasy credentials, or account details.

Browser autoplay rules still apply. If Chrome refuses sound, playback retries
muted and Fantasy Stream offers its sound control. This is not a guarantee of
compatibility with every provider, DRM system, or provider interstitial.
It does not detect commercials by inspecting video.

Remove or disable the extension from chrome://extensions to stop the helper.
