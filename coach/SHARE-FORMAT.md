# LIFT share link — wire format v1

How a client's training log gets from their phone to their coach, with no
server anywhere in the path.

```
LIFT app (Android / iOS / web)
   └─ "Send to Coach"  →  pre-filled email  →  coach taps the link
                                                  └─ www.dugcanlift.com/coach/  reads it
```

The whole log rides in the URL **fragment** — everything after the `#`. Browsers
never transmit a fragment to the server, so although `/coach/` is served from
GitHub Pages, the training data itself goes phone → mail provider → coach's
browser and is never seen by dugcanlift.com. The coach app decodes it in the
page and keeps it in `localStorage` on the coach's own device.

## The link

```
https://www.dugcanlift.com/coach/#1z<base64url>
                                  │└─ codec: z = raw DEFLATE, u = uncompressed
                                  └── format version
```

* **base64url** — RFC 4648 §5 alphabet (`-` and `_`), padding `=` stripped.
* **raw DEFLATE** — no zlib or gzip header. This is `CompressionStream('deflate-raw')`
  in the browser, `Deflater(level, nowrap = true)` on Android, and
  `COMPRESSION_ZLIB` on iOS, which are all the same bytes.
* `u` exists so a client on a browser without `CompressionStream` (Safari < 16.4)
  can still send. Coach app must accept both.

Decoders must ignore any characters after the payload and must not assume the
fragment is the only thing in the URL.

## The payload

Minified JSON. Keys are short because every byte is a byte of email body. Any
key may be absent; absent means "not recorded", which is not the same as zero —
a day with no `ft` did not log food, a day with `ft: [0,0,0,0,0]` logged nothing
but was opened.

```jsonc
{
  "v": 1,
  "c": {                      // the client
    "i": "b7f3a1c8",          // stable id, generated once and kept forever
    "n": "Jordan Reyes",
    "s": "male",              // optional
    "a": 34,                  // age, optional
    "h": 71,                  // height in inches, optional
    "u": "lb",                // "lb" | "kg" — how THEY read weights, display only
    "p": "ios"                // "and" | "ios" | "web" — which app sent it
  },
  "g": { "c": 2400, "p": 190, "f": 70, "cb": 220, "fb": 34 },   // daily goal
  "r": "2026-06-24",          // first day covered — day 0 of the d[] offsets
  "t": "2026-08-19",          // last day covered
  "z": 1755600000,            // exported at, epoch seconds
  "x": ["Back Squat|Barbell", "Bench Press|Barbell"],  // exercise dictionary
  "fd": ["Chicken breast", "White rice"],              // food dictionary
  "d": [ /* days, see below */ ]
}
```

`x` and `fd` are dictionaries because names repeat on almost every day, and
naming a lift once instead of forty times is most of the compression win before
DEFLATE even runs. Entries in `x` are `"name|equipment"`, matching the
`matchKey` both native apps already use for history lookups — equipment is part
of the identity because a cable pulldown and a machine pulldown are not the
same lift.

### A day

Only days with something on them are included.

```jsonc
{
  "k": 12,                    // days after "r" — not a date string, they add up
  "n": "Push Day",            // session name
  "fo": "POWERLIFTING",       // training focus
  "bw": 209.4,                // bodyweight, pounds
  "st": 8421,                 // steps — absent means "not recorded", not zero
  "w": [ [3, [ /* sets */ ]] ],        // [exercise index into x, sets]
  "ft": [2410, 188, 71, 230, 33],      // food totals [kcal, protein, fat, carbs, fiber]
  "f": [ [7, 1.5, 320, 40, 8, 12, 2, 1] ]   // itemized food, optional
}
```

**Set** — `[weightLb, reps, rpe, durationSec, distanceMeters, flags]`, trailing
nulls trimmed, so an ordinary set is just `[185, 5, 8]`. `flags` is a bitfield;
bit 0 = warmup. A field that is `null` was not recorded: a sled push has no
reps, a plank has no weight.

**Itemized food** — `[foodIndex, servings, kcal, protein, fat, carbs, fiber, meal]`,
where the macro numbers are **per serving** (multiply by `servings`), matching
how both apps already store them, and `meal` is 0 breakfast, 1 lunch, 2 dinner,
3 snack. The gram-based amount (`amountGrams`) is not included in
this compact format; it appears only in the fuller BACKUP-FORMAT.

### Saturated fat, sugar and sodium

Tracked, not targeted: there is no goal for them. They travel in keys of their
own rather than as extra positions in `ft` and `f`, because decoders already in
use accept exactly five totals and exactly eight item fields and would drop a
longer tuple — and with it the day's food.

**On a day** — `fx`, present when at least one food logged that day recorded
any of the three:

```jsonc
"fx": [21.5, 48, 2310, 6, 4, 5, 6]
//     [saturatedFatG, sugarG, sodiumMg, foods, withSaturatedFat, withSugar, withSodium]
```

The first three are totals over only the foods that recorded each value —
multiplied by servings, as `ft` is. `foods` is how many foods were logged that
day, and the last three say how many of them each total covers. That is what
lets a coach read *2,310 mg sodium from 6 of 6 foods* differently from *from 2
of 6*: a partial total is a floor, not a day. A total with no food behind it is
`null`, never `0`. Grams to one decimal, sodium in whole milligrams.

**Itemized** — `fe`, sent only alongside `f`, one entry per `f` entry in the
same order:

```jsonc
"fe": [ [3.1, 2, 540], null, [null, 12] ]
//      [saturatedFatG, sugarG, sodiumMg] per serving, trailing nulls trimmed
```

`null` for a food with none of the three. Per serving, like the macros in `f`.
`fx` is still sent with an itemized day, so a decoder never has to add it up.

### Outdoor

Runs, walks and hikes a client recorded with GPS. Three optional parts, all
added without a version bump: a decoder that predates them ignores them.

**On a day** — `o`, one tuple per finished activity that started that day, in
start order. A day holding only an outdoor activity is still a day.

```jsonc
"o": [ [0, 1720, 5012, 38] ]   // [type, durationSec, distanceMeters, climbMeters]
```

`type` is 0 run, 1 walk, 2 hike. All four numbers are whole, rounded to the
nearest. `distanceMeters` and `climbMeters` are 0 when nothing was measured.

**Personal bests** — top-level `ob`, all-time rather than the window, one entry
per type with at least one finished activity, in type order:

```jsonc
"ob": [ [0, 14, 21097, 7260, 301] ]
//     [type, count, farthestMeters, longestSec, fastestSecPerKm]
```

Any of the last three is `null` when there is nothing to show — no distance
ever measured, or no activity of at least **1 km**, the shortest that may set
a pace. A best of zero is never sent. Rounded to the nearest whole number.

**Last route** — top-level `lr`, sent **only when the client has chosen to
include it**. Off by default on every sender.

```jsonc
"lr": [0, 1755590400, 1720, 5012, 38, "_p~iF~ps|U_ulLnnqC_mqNvxq`@"]
//     [type, startedAtEpochSec, durationSec, distanceMeters, climbMeters, polyline]
```

It is the newest finished activity with a route of two or more points. The
four numbers are that whole activity, untrimmed. The polyline is not:

1. **Trim.** Walk the route adding haversine distance (earth radius
   6,371,000 m). Drop every point less than **200 m** along the route from
   its first point, and every point less than 200 m from its last. A route
   usually starts and ends at someone's front door; this is what keeps it
   there. If fewer than two points survive, `lr` is not sent — the sender does
   not fall back to an older route.
2. **Thin.** More than **150** points left: keep the points at index
   `floor(i * (n - 1) / 149 + 0.5)` for `i` = 0…149, where `n` is the count.
3. **Encode** as a Google encoded polyline at precision 5, rounding each
   coordinate as `floor(value * 100000 + 0.5)`. Spelled out because the
   platforms' own `round` functions disagree on negative halves, and every
   sender must produce the same string.

A newer payload's `ob` and `lr` replace the coach's stored ones, and an absent
one clears it. A client who turns the route off expects it gone, not frozen at
the last one they sent.

A sender's shared test lives with LIFT web: `lift/fixtures/outdoor-share-input.json`
is a set of activities in the backup format's `outdoor[]` shape, and
`outdoor-share-expected.json` is exactly the `o`, `ob` and `lr` it must produce.

### Steps

Read from the platform's own health store at send time — Health Connect on
Android, HealthKit on iOS — rather than kept in the app's storage. That way a
step count logged by a watch the app never talks to still reaches the coach,
and nothing has to be synced or migrated when the two disagree.

The web app has no such store to read, so its steps are the ones typed in by
hand. All three send the same field.

Two things make a day's steps absent: the person declined the permission, or
the platform genuinely has nothing for that day. Neither is an error, and
neither should be rendered as a zero. On Android, step history older than 30
days additionally needs `READ_HEALTH_DATA_HISTORY`; without it a 12-week send
carries training and food for the full window but steps for only the last
month.

### Units

Weights are **pounds** and distances are **metres** on the wire, always, whatever
the client sees on their screen. iOS stores kilograms and converts on the way
out. `c.u` travels alongside so the coach app can render a kg client's numbers
in kg — it is a display preference, never a hint about what the numbers mean.

Picking one canonical unit is deliberate: a payload that mixed units would be
unrecoverable the moment a client changed the setting mid-block.

## Size

The reason the window is configurable. Measured, DEFLATE + base64url, for a
client training four days a week:

| Window   | Food as daily totals | Food itemized |
|----------|---------------------:|--------------:|
| 4 weeks  |               2.6 KB |        4.0 KB |
| 8 weeks  |               4.4 KB |        7.1 KB |
| 12 weeks |               6.1 KB |       10.2 KB |
| 26 weeks |              12.0 KB |       20.5 KB |

Senders default to **8 weeks, totals only**, and should show the resulting link
size before sending. Mail clients handle a few kilobytes of body text without
complaint; past roughly 16 KB some start wrapping or truncating, which corrupts
the payload silently. Above that, senders should say so rather than send
something that arrives broken.

## Merging

A client sends a new link every week or two, and the windows overlap. The coach
app merges on `c.i` and then replaces **whole days** by date — the newest
payload wins for any day it covers, and days outside its window are kept from
before. Replacing rather than union-ing per entry is what makes a deletion in
the client app propagate: an entry the client removed is simply absent from the
day the next time it is sent.

This is also why `c.i` must be stable. If a client reinstalls and gets a new id
they land in the roster as a second person, and the coach has to merge them by
hand.

## The email

What the sender composes. The coach should be able to read the gist in the
inbox and only tap through when they want the detail.

```
Subject:  LIFT log from Jordan Reyes — Aug 19

          [ Open Jordan's log ]        ← links to the fragment URL above

          Last 7 days
          Training   4 sessions · 61 sets · 38,400 lb
          Fuel       2,180 kcal · 172 g protein  (goal 2,400 · 190)
          Steps      9,140 a day  over 7 days
          Weight     209.4 lb  (−1.2 lb in 4 weeks)

          Covers 24 Jun – 19 Aug. Sent from LIFT.
          <https://www.dugcanlift.com/coach/#1z...>
```

The button is an `<a>` in an HTML body. iOS composes HTML directly;
Android sends `EXTRA_HTML_TEXT` alongside a plain-text `EXTRA_TEXT` and lets
the mail app pick. `mailto:` from the web PWA is plain-text only by
specification, so there the link stands on its own line instead — every mail
client on earth autolinks that.

The bare URL is repeated at the bottom on purpose. Some clients strip anchors
from HTML mail, and a coach who can see the raw link can always paste it into
the app's **Paste a link** box.

The summary is computed by the sender from the same data it is about to encode,
so it can never disagree with what the coach sees after tapping.
