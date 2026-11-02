# Compact scoreboard and explicit stream choice

Based on GitHub main `a7933f40b62bfd1bd52b0bc4fcc642cded561567`.

The separate Starting Lineup display is removed. The scoreboard highlights possession-based player activity using the director's existing involvement function, including defensive possessions and field-goal opportunities; it does not claim to observe individual substitutions. The Fantasy team ribbon button owns the team selector, ESPN connection and followed-player editor. Scoreboard refresh is in its header. Settings uses compact rows with optional switching details.

At desktop widths of 1280px and above, the player, game guide and scoreboard share one row. The player establishes the row height; the guide and player lists scroll inside it. Narrow layouts stack the panels with a bounded scoreboard.

Custom URLs are resolved before replacing a playing source. Saving a new primary overrides an automatic source even when the old source is still eligible as a backup. Automatic and provider choices remain separately selectable without erasing the custom URL. Pause, new saves, mode changes and schedule changes invalidate stale applications of pending resolution. Source rotation cycles through available links.

Published HTML5 video URLs, common player configuration URLs and explicit player iframes are extracted as text without executing markup. NTV and StreamCorner resolution stays within the existing restricted provider endpoints. Generic pages are inspected from the browser with CORS, omitted credentials, no referrer and no redirects; these URLs never become unrestricted Worker fetches. If extraction is blocked or ambiguous, the saved page is the fallback. Direct media and explicit player embeds bypass extraction. Some pages forbid embedding and still require Open stream.

StreamCorner lookup independently inspects published timed event metadata and HTML links, and can match alongside NTV without ambiguity across providers. Its current page is a JavaScript application, and its dynamic game data/player extraction has not been verified. Empty/blocked responses do not invent streams or replace another provider's matches. Provider buttons with no matching game remain disabled.

Validation: 704 automated tests pass, including explicit-source takeover, switching back without deleting saved URLs, late-save and Pause races, HTML5 extraction, CORS fallback, independent provider catalogs, and possession highlighting. Production build checks compare all 34 assets and exercise compiled routes. Browser and deployed verification are recorded in the release response separately.
