# LIFT

A progressive web app for tracking food and training, served from `/lift/`.

## Watch import (`watch-scan.js`)

`watch-scan.js` reads food logs off an Apple Watch by QR code. The watch has
no other way to reach this browser: WatchConnectivity only ever talks to a
paired iPhone, and LIFT has no backend. A QR code is the only transport
available to a watch app with no network link of its own and no shared
identifiers with this app's food data.

Decoding happens entirely in the browser — nothing is uploaded, and no
request leaves the device — the same property share links already have.
Large exports split across multiple codes; `watch-scan.js` reassembles them
out of scan order, rejecting a partial or mixed-export set rather than
silently importing a broken log.

`jsqr.js` is vendored rather than loaded from a CDN because the PWA is
offline-capable, and a scanner that stops working the moment there is no
signal would defeat the point of scanning a watch log at the gym.

Both `jsqr.js` and `watch-scan.js` are in `sw.js`'s `SHELL` list so they are
available offline. **Bump `sw.js`'s `CACHE` name whenever either file
changes** — otherwise browsers keep serving the old cached copy and a fix
never reaches anyone who already installed the app.

`app.js` publishes a handful of things to `window` at the very end of the
file (`Object.assign(window, { KEY, uid, dateKey, addFoodEntries })`)
specifically for `watch-scan.js` to use. This is necessary because
`watch-scan.js` loads as a separate `<script>` rather than more lines added
to `app.js`, and top-level `const`/`let` declarations in a classic script
never become properties of `window` on their own — only an explicit
assignment does that.

Note that `food` itself is never published by value — it is a `let` app.js
can rebind, and a snapshot taken once at load time would go stale the moment
that happened, while `watch-scan.js` kept writing into the abandoned array.
`addFoodEntries` closes over the live binding and does the whole write
(push, save, render) itself instead.
