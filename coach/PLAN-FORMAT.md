# Plan format

A week built in Coach and sent to one client's LIFT app — meals, training, or
both in the same link. The reverse trip of [SHARE-FORMAT.md](SHARE-FORMAT.md):
that one carries a log from a client to their coach, this one carries a plan
from a coach to their client.

Implemented by Coach (encode) and the web build of LIFT (decode). The Android
and iOS builds do not read plan links yet — they have no deep-link handling.

## The link

```
https://www.dugcanlift.com/lift/#1z<base64url>
```

Identical envelope to the log format, and for the same reasons:

- `1` — format version. A client that does not recognise the version says so
  rather than guessing.
- `z` — deflate-raw, or `u` for uncompressed when the sender's browser has no
  `CompressionStream`. Decoders must handle both.
- base64url, unpadded, so nothing in the payload needs escaping in a URL.

**Everything rides after the `#`.** Browsers never transmit a fragment, so the
plan goes from the coach's browser, through their mail provider, to the
client's browser. dugcanlift.com never sees it. This is the whole reason the
format exists in this shape.

## Payload

```json
{
  "v": 1,
  "t": "plan",
  "l": "a1b2c3d4",
  "n": "Doug",
  "r": [
    {
      "n": "Beef Chilli",
      "s": 4,
      "u": [438, 36, 31, 19, 9],
      "i": ["500 g lean beef mince", "2 cloves garlic", "1 can kidney beans"],
      "t": ["Brown the mince."]
    }
  ],
  "m": [
    { "d": "2026-08-26", "s": 2, "x": 0, "q": 2 }
  ]
}
```

| Key | Meaning |
|---|---|
| `v` | format version, always `1` |
| `t` | `"plan"`. Distinguishes this from a log arriving at the same door. |
| `l` | the client's lifter id — see Addressing |
| `n` | the coach's display name, for the confirmation prompt |
| `r` | recipes used by this plan, inlined |
| `m` | the planned meals |
| `w` | workout templates used by this plan, inlined |
| `k` | the scheduled sessions |

`r`/`m` and `w`/`k` are independent. A link may carry meals, training, or both;
a coach who plans only training sends a payload with no `r` or `m` at all.

**A payload may also carry `r` or `w` with no `m` or `k`.** That is a library
send — "here is the recipe" or "here is the programme", with nothing booked
into a particular day. The receiving app files them away for the client to use
when they choose. Scheduling is a separate claim from possession, and a coach
handing over a template they want used every third week should not have to
invent dates to do it.

### Recipes (`r`)

| Key | Meaning |
|---|---|
| `n` | name |
| `s` | how many servings the recipe makes |
| `u` | `[kcal, protein, carbs, fat, fibre]` **per serving** |
| `i` | ingredient lines, exactly as typed |
| `t` | method steps |

Only recipes this plan actually uses are inlined, and only these fields. That
is what keeps a week inside a link an email client will not mangle — a plan for
two meals off one recipe comes to about 280 characters.

**`u` is omitted entirely when the coach did not enter macros.** It must never
be sent as zeros. A zero here becomes a zero-calorie dinner in the client's day
total, which is worse than an unknown they can see.

**Ingredients travel as raw text, not parsed.** Every client runs the same
parser, so parsing on the receiving side keeps one implementation of the rules
rather than freezing one sender's interpretation into the wire.

### Meals (`m`)

| Key | Meaning |
|---|---|
| `d` | day, `yyyy-MM-dd` |
| `s` | meal slot: `0` breakfast, `1` lunch, `2` dinner, `3` snack |
| `x` | index into `r` |
| `q` | servings of that recipe for this meal |

Amounts scale by `q` against the recipe's own `s`, so two servings of a
four-serving recipe buys half the ingredients and logs half the calories.

### Workouts (`w`)

```json
{
  "n": "Lower A",
  "e": [
    {
      "n": "Back Squat",
      "q": "Barbell",
      "s": [[225, 5, 8], [225, 5, 8], [245, 3, 9]],
      "c": "Belt on the last set."
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `n` | template name, e.g. "Lower A" |
| `e` | prescribed exercises, in the order they are to be done |

Within an exercise: `n` name, `q` equipment, `c` an optional coaching note, and
`s` the prescribed sets.

**A set is `[weightLb, reps, rpe, durationSec, distanceMeters]`** — the same
order and the same units as a set in SHARE-FORMAT, minus the flags byte, with
trailing nulls trimmed. Sharing the ordering is deliberate: a prescription and
the log that answers it are the same shape, so nothing has to be transposed to
compare what was asked for against what was done.

Every field is optional, because a prescription is often partial. `[null, 5]`
is "five reps, you pick the weight". `[225, 5]` is "225 for five, however it
feels". A conditioning piece is `[null, null, null, 600, 1600]`.

**Sets are listed individually rather than as "3 × 5".** Coaches ramp, and a
count-and-tuple shape cannot say 225/225/245 without special cases.

### Sessions (`k`)

| Key | Meaning |
|---|---|
| `d` | day, `yyyy-MM-dd` |
| `x` | index into `w` |

One template can be scheduled on several days; that is the normal case for a
programme that repeats a week.

## Addressing

`l` is the client's lifter id — the same one their log carries in `c.i`,
generated once by their app and never regenerated.

**A receiving client must refuse a plan whose `l` is not its own.** A plan is
addressed, not broadcast; a coach with several clients will have several links
open, and the ids are what stop one landing in the wrong person's week.

## Size

Mail clients wrap and corrupt long links. The working ceiling is **16,000
characters**, the same figure the outbound log format uses.

Inline recipes are what grows a plan. A sender approaching the limit should
send fewer days rather than truncating, because a half-imported week is worse
than a short one.

## Changing this

Bump `v` for anything a current decoder would read **wrongly**, update this
file, and change every implementation together. There are four parsers behind
this format now and they must agree; a quantity that reads differently on one
client is a bug nobody would think to look for.

Purely additive keys do not bump `v`. `w` and `k` arrived after `r` and `m` and
kept `v: 1` on purpose: bumping would have made older clients refuse the whole
link, losing the meals as well as the training they could not read. Ignoring a
key they do not know costs them only the part that is new to them.

The cost of that choice is silence — an older client drops the training without
saying so. Two things cover it: the covering email names what it contains, and
the import screen lists what it actually took in. A client reporting twelve
meals when the coach sent three sessions as well is a visible mismatch rather
than a puzzle.
