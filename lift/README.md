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
field `side: "left" | "right"`, omitted when both. See `coach/SHARE-FORMAT.md`
and `coach/BACKUP-FORMAT.md`.

A coach's plan can carry sides too (`coach/PLAN-FORMAT.md` "Sides"): `b: 1` on
an exercise done each side, and the same flags bits in a sixth set position for
a set on one side. Accepting an each-side exercise turns per-side logging on for
that lift. A started session keeps the prescription on the exercise
(`prescribed`, `eachSide`): the header counts against it -- `L 0/3 · R 0/3`,
and `L 4/3` when over, never capped -- the L / R offer starts on the side the
next unfilled prescribed set names, and Add set prefills from that set. Sided
sets are logged as they are done rather than pre-filled; two-sided sets are
copied in as before. A named set on a lift not logged per side shows L / R
(with Both) only until it is logged, without touching the per-side preference.
Progression, imbalance and volume read the log, never the plan.
`plan-sides.test.mjs` also pins how a build without any of this reads such a
plan: as ordinary two-sided sets, weights and reps intact.

## What you were asked to do, and what you did (`plan-log.js`)

A coach's plan and your log have always been two separate claims -- `training`
is what was sent, `workouts` is what happened -- and they were shown side by
side nowhere. Train is one day at a time, so a booked Wednesday is invisible on
Thursday, and **Next is disabled past today**, so a Friday that has not happened
could not be looked at at all. That is why the card is a **week** rather than a
marker on a day: the days a lifter cannot reach are the ones they most need to
see mid-week.

It sits on Train under the coach's own card for the day, runs **Monday to
Sunday** around the day on screen (a fixed constant -- a rolling seven days
would move a booked Tuesday out of "this week" overnight and describe the same
plan two ways on two days), and has its own `‹ ›` to read the week either side.
One day is open at a time, and by default it is the day Train is showing;
tapping a row opens it, and moves Train to it when Train can show it.

Four verdicts. `logged`, `not logged` and `not booked` are **Coach web's words,
unchanged** (`coach/plan-log.js`), so a lifter and their coach describe the same
week the same way. `to do` is this side's own, because only the person living
the week has a day that has not happened yet, and calling one an absence would
invent a failure out of a Wednesday. Coach's fourth state, `outside the log they
sent`, cannot arise here -- the log is on the device -- and Coach's footer is a
sentence about somebody else, so this card has its own.

The join is the same as Coach's: days on date, exercises on `name|equipment`
and then on name alone (the substitution, labelled), sets counted and never
paired one to one. One thing this side has that Coach's does not is
`startedSessionId`, which says which session a booking was started as -- used
only to pick the right session out of a day that holds two, never to claim a
session logged on one day answers a booking on another. A session lifted the day
after the one it was booked for is a booked day with nothing logged **and** a
session of its own, adjacent on screen, with nothing claimed about the two.

Sides are `LiftSides.targetsLabel` -- the same `L 3/3 · R 2/3` the session
header has shown since per-side prescriptions shipped, called with the same two
arguments, so the card and the session cannot disagree. A day still ahead shows
`Each side · L 4 · R 3` instead, the prescribed card's own sentence: `L 0/3` is
true during a session and a nought nobody has had the chance to earn on a
Friday.

**Nothing new travels, nothing new is stored and nothing new is asked for.** No
wire change, no new key, no new permission; the card reads `training` and
`workouts` exactly as they already are.

**You are not being graded.** No score, no percentage, no streak, no colour on a
day nothing was logged against, nothing carried between weeks and nothing
comparing anything. `lines()` flattens every sentence the card can produce so
`plan-log.test.mjs` can hold the whole screen to that list rather than an eye
holding one render of it. A week that books nothing is **no card at all** --
never an empty frame explaining itself.

`plan-log.js` is in `sw.js`'s `SHELL`, so **bump `CACHE` when it changes.**

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

## Road Food (`road-food.js`, `road-food.json`)

Macro-friendly picks at fast-food chains and gas stations, ranked against what
is left of today. The rules -- fits at or under what is left, a separate "A
little over" group up to 10% over, protein per 100 kcal, lower sodium on a tie,
no-goal mode, six-month staleness -- are in `road-food.js` and tested by
`road-food.test.mjs`. What is left comes from `remainingFor(day)` in `app.js`,
the same function Home and Food use for "kcal left".

Each chain carries two dates. `checkedOn` is the day a person read its chart;
`publishedOn` is the date **the document states about itself**, optional and
only as precise as the document is -- `"2021-03-29"` where Whataburger's chart
says "as of March 29, 2021", `"2022-11"` where Burger King's says only
"NOVEMBER 2022". Both are on screen ("Published Nov 2022 · checked Sep 23,
2026"), because what a chain published and when someone read it are different
facts. The staleness warning keys off `publishedOn` when a chain has one and
`checkedOn` when it does not, still at six calendar months, and says which
chart is old: "These numbers are from the chain's chart dated Nov 2022." A
chain with no `publishedOn` reads exactly as it did before the field existed.

`road-food.json` is the curated file from `dugcanlift-kit/data/road-food.json`,
copied here unchanged. It is fetched when Road Food first opens and then kept by
the service worker, cache-first -- so **replacing it needs a `CACHE` bump in
`sw.js`**, or installed copies keep the old menus. It is deliberately not in
`SHELL`: install would fail outright while the file is absent.

`road-food.sha256` is the kit's checksum of those bytes, copied across with the
JSON, and `road-food.test.mjs` hashes the file and asserts it matches. That is
the only thing standing between this copy and the four others: the shape checks
pass just as happily on a copy three chains behind, so nothing else here would
ever say the file had fallen behind.

**When that test fails**, copy `road-food.json` *and* `road-food.sha256` from
`dugcanlift-kit/data/` together, and bump `CACHE` in `sw.js`. Never edit either
file here, and never re-write the checksum by hand to make the test pass -- the
kit writes it (`node data/validate-road-food.mjs --write-checksum`) and the
other four app repos pin the same one, so a hand-written hash only moves the
failure somewhere further away.

`fixtures/road-food-sample.json` is a hand-made fixture with fake names ("Sample
Burger Co") for development only; it is excluded from the Jekyll build. It is
shared too -- `dugcanlift-lift`'s debug asset, `lift-ios`'s `Tests/Fixtures`
copy and the inline copy in `RoadFoodSample.swift` are meant to be these exact
bytes -- so `road-food-sample.sha256` pins it the same way. Changing the fixture
means changing it in all three repos and re-writing all three checksums:

```sh
shasum -a 256 lift/fixtures/road-food-sample.json | cut -d' ' -f1 > lift/fixtures/road-food-sample.sha256
```

Rules may be plain strings (every chain) or `{ "text", "kinds": [...] }`,
matched against a chain's optional `kind`; the gas-station screen shows only
rules whose kinds include `"snacks"`. No location of any kind: you pick the
chain. Recently used chains are kept on this device under `lift.roadRecent`,
not in the backup.

### A coach's picks

A plan link can carry `rf`, a flat list of Road Food item ids a coach is happy
with (`coach/PLAN-FORMAT.md` "Road picks"). They are stored under
`lift.roadPicks` with the coach's name, replaced whole by the next plan that
carries any; a plan with no `rf` says nothing about picks rather than
retracting them, because that is also what every older Coach and every "here
is a recipe" send looks like. Clearing them is done here, on the Road Food
screen.

What they do is **sort to the top of the list they are in, marked**
(`withPicks` in `road-food.js`). Nothing else moves: the same items fit, in
the same order among themselves, and an item more than 10% over what is left
stays hidden whether or not it was picked -- the pick is about the food, and
what is left of the day is your own arithmetic. A pick whose item this build's
`road-food.json` does not have is **skipped silently**: an item withdrawn since
the plan was sent is not a broken row, and it reappears if the item does.

Shown, never targeted, like saturated fat and the imbalance figure: a label in
words, no colour, no score, and nothing anywhere about what you ate instead.
