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
3 snack.

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
