# LIFT

A progressive web app for tracking food and training, served from `/lift/`.

## Left and right (`sides.js`)

A set may record a side. **Absent means both**, which is what every set logged
before this meant, so nothing in a browser is migrated, rewritten or asked
about on load -- and "both" is never written out, nor a side defaulted to left.
Whether an exercise is logged per side is the lifter's own choice, kept by
`matchKey` under `lift.perSide` and pre-ticked when the name reads unilateral.
It is deliberately not in the backup: it is a preference about this screen, not
a record of training, and the sets carry their own sides, so a restored log
still shows them.

`sides.js` holds the rules -- the flags bits, the grouping key, and the
imbalance maths -- so `node --test lift/` checks them rather than an eye. The
imbalance figure is `(strong - weak) / strong` on estimated 1RM, over the same
window the chart draws, and it appears only once both sides have three sessions
in it. Tracked and shown, never targeted: no goal, no threshold, no colour and
no advice, the same discipline saturated fat, sugar and sodium are held to.

On the wire: the share link's set tuple carries the side in `flags` bits 1-2
(0 both, 1 left, 2 right) beside the warmup bit, so a decoder that has never
heard of sides still reads the weight and the reps; a backup carries the named
field `side: "left" | "right"`, omitted when both; plan links are unchanged.
See `coach/SHARE-FORMAT.md` and `coach/BACKUP-FORMAT.md`.

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
file (`Object.assign(window, { KEY, uid, dateKey, addFoodEntries, goToFoodDate })`)
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
