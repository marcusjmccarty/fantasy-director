Fantasy Stream 3.2.0 — unified Chrome extension

This replaces Fantasy Director 3.1 and the separate Fantasy Stream Playback
helper. It preserves the original desk, ESPN connection, roster, tab director,
replay lab and highlights, and adds automatic embedded playback, caption
suppression and fullscreen routing inside approved Fantasy Stream website tabs.

UPDATING THE ORIGINAL EXTENSION
1. Stop Auto in the existing desk.
2. Copy this package's contents into the SAME folder that Chrome already loads.
   Keep that folder path; loading a different folder creates a different identity.
3. Open chrome://extensions and click Reload on Fantasy Director's card.
4. It becomes Fantasy Stream 3.2.0. Reopen the desk. Existing league settings
   remain in the same extension storage. Running Auto stops safely on update.
5. Disable the standalone Fantasy Stream Playback helper if present.
6. Reload the Fantasy Stream website and use its Full screen button once.

NEW INSTALLATION
Enable Developer mode at chrome://extensions, choose Load unpacked, and select
this folder containing manifest.json. Use the toolbar icon for the original desk.

The site works without an extension for accessible HLS/MP4 streams. Browser
sound policy may require Turn sound on once; muted video continues automatically.
A provider-only cross-origin player may still require Play without the extension.
The helper does not bypass sign-in, consent or DRM or remove burned-in captions.

ACCESS
The original desk keeps tabs, storage, alarms, cookies (ESPN) and offscreen.
Scripting and HTTPS host access support players hosted on changing domains.
Playback activation is checked against Chrome's top-level tab URL and is limited
to fantasy-stream.fantasy-hub.workers.dev, fantasy-director.soraclipse.chatgpt.site
and local development ports 3000/4173. Other browsing is not controlled.
