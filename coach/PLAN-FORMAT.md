# Plan format

A week built in Coach and sent to one client's LIFT app — meals, training, or
both in the same link. The reverse trip of [SHARE-FORMAT.md](SHARE-FORMAT.md):
that one carries a log from a client to their coach, this one carries a plan
from a coach to their client.

Implemented by Coach (encode) and the web build of LIFT (decode). The Android
and iOS builds do not read plan links yet — they have no deep-link handling.

**This file lives in the `dugcanlift-coach` repo.** The copy at
`dugcanlift-site/coach/PLAN-FORMAT.md` is a deploy artefact, overwritten by the
next `./deploy.sh`; edit this one.

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
| `rf` | road picks: Road Food item ids this coach is happy with |

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
| `ux` | `[saturatedFatG, sugarG, sodiumMg]` **per serving**, trailing nulls trimmed; omitted when none is known |
| `i` | ingredient lines, exactly as typed |
| `t` | method steps |

Only recipes this plan actually uses are inlined, and only these fields. That
is what keeps a week inside a link an email client will not mangle — a plan for
two meals off one recipe comes to about 280 characters.

`ux` is a key of its own rather than more positions in `u`, because a decoder
already in use reads `u` by position and would take a sixth number for
something else. A receiver that doesn't know `ux` ignores it.

`u` is always five numbers. Unknown fiber is sent as `0` in `u[4]`, because
the iPhone decoders read `u` as numbers and reject a `null` in it; a receiver
stores the number as sent. A recipe's stored fiber stays unknown on the
sending side (BACKUP-FORMAT.md `nutritionPerServing`).

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
    },
    {
      "n": "Bulgarian Split Squat",
      "q": "Dumbbell",
      "b": 1,
      "s": [[40, 8], [40, 8], [40, 8], [40, 8, null, null, null, 2]]
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `n` | template name, e.g. "Lower A" |
| `e` | prescribed exercises, in the order they are to be done |

Within an exercise: `n` name, `q` equipment, `b` each side (see Sides), `g`
its group (see Set types), `s` the prescribed sets, and `c` an optional
coaching note. Coach writes the keys in that order: `n q b g s c`.

**A set is `[weightLb, reps, rpe, durationSec, distanceMeters, flags]`** — the
same order and the same units as a set in SHARE-FORMAT. `flags` is present
only on a set that names a side (see Sides) or a kind (see Set types); every
other set is the five-field tuple it has always been. Only trailing nulls are trimmed. Sharing the
ordering is deliberate: a prescription and the log that answers it are the
same shape, so nothing has to be transposed to compare what was asked for
against what was done.

#### Sides

**Symmetric work is not written as per-side rows.** A coach writing "3 × 8
left, 3 × 8 right" for a split squat would be prescribing bookkeeping, and a
plan that doubled every single-limb set would be twice as long to say the same
thing. The lifter records which side each logged set was, on their own phone,
when they do it (SHARE-FORMAT's `flags` bits 1-2). Two small rules cover what
that leaves out, and neither turns one set into two rows:

1. **An exercise can be each side: `b: 1`.** Every prescribed set is done on
   both sides. "3 × 8, each side" stays three tuples; LIFT expects six sets,
   three a side, and turns per-side logging on for that lift when the plan is
   accepted. `b` is omitted when the exercise is not each side — never sent as
   `0` — and anything other than `1` reads as not.
2. **A set can name a side: a sixth position, `flags`.** The same bits as
   SHARE-FORMAT: bits 1-2 are `0` both, `1` left, `2` right. For the asymmetric
   cases only — an extra set on the left, rehab side only. A set that names a
   side is done on that side once, whether or not its exercise is each side.
   Bit 0 (SHARE-FORMAT's warmup bit) is unused here and written `0`: a coach
   does not prescribe warmups as flagged sets.

Combined, each side with one extra set marked left is "3 × 8 each side, plus
one more on the left": seven sets, three right and four left.

```json
{ "n": "Bulgarian Split Squat", "q": "Dumbbell", "b": 1,
  "s": [[40, 8], [40, 8], [40, 8], [40, 8, null, null, null, 2]] }
```

- **Mask, never compare.** Read the side as `(flags >> 1) & 3`. `3` in those
  bits is never written and reads as both, and so does a missing, non-numeric
  or zero `flags`. A reader that tests `flags === 2` would misread a set the
  day bit 0 means something.
- **A both-sides set writes no sixth position at all.** Only trailing nulls are
  trimmed, so a left-side conditioning piece is
  `[null, null, null, 600, 1600, 2]` — trimming the leading nulls would slide
  the distance into the weight slot.
- **Every plan written before this is byte-for-byte unchanged**, and `v` stays
  `1`: both additions are optional, and absent means what it always meant.
- **Old decoders degrade correctly, and this is checked.** A LIFT build that
  has never heard of `b` or a sixth position ignores both and shows the sets
  as ordinary two-sided sets, with the right weights, reps and count.
  `lift/plan-sides.test.mjs` in the site repo pins that for LIFT web, against
  `coach/fixtures/web-plan-per-side.txt`, a link Coach web's own encoder
  wrote. The iOS and Android decoders check the same fixture.
- **Tracked and prescribed, never judged.** A coach writing an extra left set
  is making a coaching decision. The apps carry it and show whether it was
  done — LIFT's header reads `L 3/4 · R 3/3`, and `L 5/4` when over, never
  capped — and nothing comments on it. Progression, the imbalance figure and
  volume read the log, never the plan.

#### Set types

Three common prescriptions a plan could not say until now: "do these two back
to back, then rest", "straight after this set, strip the weight and keep
going", and "rest a few breaths, then go again". A pyramid needs nothing new —
a ramp of weights, set by set, is already what a set list says.

1. **Exercises can be grouped: `g`, a positive integer.** *Adjacent* exercises
   with the same `g` are one group, done round by round: one set of each in
   order, then the rest. Two exercises make a superset and three or more a
   circuit; the format does not distinguish the two. Sets in a group may
   differ in count — the round goes on while any exercise still has sets, and
   one that has run out is skipped.
2. **A set can have a kind: `flags` bits 3-4.** The same sixth position the
   side uses, OR'd with it:

   | bits 3-4 | kind | means |
   |---|---|---|
   | `0` | straight | as always |
   | `1` | drop | done straight after the set before it, with no rest; normally lighter |
   | `2` | rest-pause | done after a short pause, about 15 seconds; normally the same weight |
   | `3` | — | never written; reads as straight |

```json
{ "n": "Upper B", "e": [
  { "n": "Dumbbell Bench Press", "q": "Dumbbell", "g": 1, "s": [[60, 10], [60, 10], [60, 10]] },
  { "n": "Seated Cable Rows", "q": "Cable", "g": 1, "s": [[120, 12], [120, 12], [120, 12]] },
  { "n": "Triceps Pushdown", "q": "Cable",
    "s": [[70, 12], [70, 12], [50, 10, null, null, null, 8], [35, 10, null, null, null, 8]] },
  { "n": "Barbell Curl", "q": "Barbell", "s": [[65, 8], [65, 4, null, null, null, 16]] }
]}
```

A superset of bench and rows, three rounds. The pushdown is two straight sets,
then two drops: `8` is kind 1 in bits 3-4. The curl is a set of eight, then a
rest-pause set of four: `16` is kind 2. A left-side drop set is `10`, side 1 and
kind 1 together.

- **Adjacency makes a group, not the number.** `g: 1` on exercises one and
  three, with a different exercise between them, is two groups of one, and a
  group of one is an ordinary exercise. So the number only has to differ from
  its neighbours. Coach writes 1, 2, 3… in order of appearance and never writes
  `g` on an exercise that is not grouped, but a reader must not depend on
  either. `g` is never `0`, and anything that is not a positive integer — `0`,
  a fraction, a negative, a string — reads as not grouped.
- **Mask, never compare.** Read the kind as `(flags >> 3) & 3` and the side as
  `(flags >> 1) & 3`. A reader testing `flags === 2` breaks the day a set is
  left *and* drop, which is `10`. A missing, non-numeric or zero `flags` is a
  straight set on both sides.
- **The first set of an exercise is always straight.** There is no set before
  it to drop from or pause after. An encoder never writes a kind on it, and a
  reader shows one as straight.
- **A straight set on both sides still writes no sixth position.** A set with a
  kind writes one, keeping every position up to it, because only trailing
  nulls are trimmed. Bit 0 stays unused in a plan, and is written `0`.
- **Every plan written before this is byte-for-byte unchanged**, and `v` stays
  `1`: both additions are optional, and absent means what it always meant.
- **Old decoders degrade correctly, and this is checked.** A decoder that does
  not know `g` leaves the exercises in the order they were written — the right
  order, just without grouping. A decoder that masks bits 1-2 reads the side
  correctly whatever is in bits 3-4, and reads a drop or rest-pause set as an
  ordinary set with the right weight and reps. `coach/set-types.test.mjs` pins
  that against `coach/fixtures/web-plan-set-types.txt`, a link Coach web's own
  encoder wrote: a superset, a circuit of three, a drop set, a rest-pause set, a
  left-side drop set (`10`), an each-side exercise and an ordinary one. The
  LIFT web, iOS and Android decoders check the same fixture, and Coach iOS's
  and Android's encoders must reproduce its payload from the same input. Never
  regenerate it from a decoder, or from Swift or Kotlin.
- **Counted and shown, never graded.** Whether a superset was done as one is
  not scored anywhere. Progression, the imbalance figure and volume read the
  log, never the plan, as they do for sides, and a drop set logged in LIFT
  reaches the coach as an ordinary set with its real weight and reps.

Every field is optional, because a prescription is often partial. `[null, 5]`
is "five reps, you pick the weight". `[225, 5]` is "225 for five, however it
feels". A conditioning piece is `[null, null, null, 600, 1600]`, and the same
piece on the left side only is `[null, null, null, 600, 1600, 2]`.

**Sets are listed individually rather than as "3 × 5".** Coaches ramp, and a
count-and-tuple shape cannot say 225/225/245 without special cases.

### Sessions (`k`)

| Key | Meaning |
|---|---|
| `d` | day, `yyyy-MM-dd` |
| `x` | index into `w` |

One template can be scheduled on several days; that is the normal case for a
programme that repeats a week.

### Road picks (`rf`)

```json
{ "rf": ["wendys-large-chili", "chickfila-8-ct-grilled-nuggets",
         "snack-jack-links-original-beef-jerky"] }
```

A flat list of Road Food item ids: the items at the chains and the gas station
a coach is happy with for this client. Road Food is the curated file every
client bundles (`road-food.json`, from `dugcanlift-kit/data/`), and its item
ids are stable for exactly this.

A pick says "this fits how I want you eating on the road". It says nothing
about calories or macros — LIFT already ranks Road Food against what is left of
the day, and a pick must not put a tick in front of that arithmetic.

- **Ids, and items only.** There is no chain id and no "all of Wendy's" on the
  wire. Coach's "Pick all" ticks the items a coach could see when they ticked
  them, so a chain that gains an item next quarter does not gain a pick nobody
  looked at.
- **Omitted when there are none.** Never `[]`, and never `null`.
- **Nothing is filtered on the way out.** The coach's copy of the file and the
  client's are two builds of two apps, updated at different times, so only the
  receiver can say what it has. It **silently skips an id it does not know** —
  an item withdrawn since the plan was sent shows no row, no gap and no error.
- **What arrives replaces what the client holds; a plan with no `rf` changes
  nothing.** A link carrying picks is the coach's current answer, whole. A link
  without the key is silent about picks rather than a retraction, because
  "absent" is also what every older Coach and every library send says. The
  client's own app is where picks are cleared.
- **At the client's end** the picks sort to the top of that place's list,
  named as the coach's. Nothing is re-ranked underneath them, nothing that fits
  is hidden, and nothing anywhere judges what was eaten against them — the same
  discipline saturated fat, sugar and the imbalance figure are held to.
- **Old decoders degrade correctly, and this is checked.** `rf` is purely
  additive, so `v` stays `1`: a LIFT build that has never heard of it reads the
  meals and the training exactly as before and ignores the key.
  `lift/plan-road-picks.test.mjs` in the site repo pins that against
  `coach/fixtures/web-plan-road-picks.txt`, a link Coach web's own encoder
  wrote, and `coach/road-picks.test.mjs` pins the encoding side here.

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
