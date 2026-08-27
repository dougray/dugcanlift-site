# Plan format

A meal plan built in Coach and sent to one client's LIFT app. The reverse trip
of [SHARE-FORMAT.md](SHARE-FORMAT.md): that one carries a log from a client to
their coach, this one carries a week from a coach to their client.

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

Bump `v`, update this file, and change every implementation together. There are
four parsers behind this format now and they must agree; a quantity that reads
differently on one client is a bug nobody would think to look for.
