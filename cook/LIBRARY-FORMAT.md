# COOK recipe library — format v1

A public, static catalogue of recipes that LIFT, Coach and a plan link can all
read without an account, a server, or a request that says who is asking.

```
https://www.dugcanlift.com/cook/library/
  ├─ index.json              every recipe, in short — browse and search read this
  ├─ recipes/<id>.json       one recipe in full — fetched when it is opened
  └─ LICENSE.md              the data licence, which is not the site's licence
```

Both files are plain JSON on GitHub Pages. There is no API, nothing to sign up
for, and no rate limit beyond what a CDN imposes on anyone.

## Why it exists

A coach builds a client's week and sends it as a link. The link carries the
plan, not the recipes:

```jsonc
{"d": "2026-09-01", "m": "D", "r": "cook:unitools-spaghetti-carbonara", "s": 2}
```

Ten recipes inline is 6-9 KB compressed and a four-week plan does not fit in a
URL that survives being emailed. A reference into this library is a few dozen
bytes, so the client's app resolves `recipes/<id>.json` itself and the plan
stays small enough to send. That is what makes the library load-bearing rather
than decorative.

## index.json

One row per recipe, holding what a list needs and nothing more, so search works
offline against a single fetch instead of 501 of them.

```jsonc
{
  "schemaVersion": 1,
  "license": "CC BY-SA 4.0",
  "recipeFormat": "https://www.dugcanlift.com/schema/recipe-1.json",
  "recipePath": "recipes/{id}.json",
  "sources": [ /* provenance, one per upstream dataset */ ],
  "count": 501,
  "recipes": [
    {
      "id": "unitools-spaghetti-carbonara",
      "name": "Spaghetti carbonara",
      "nativeName": "Spaghetti alla carbonara",
      "summary": "Pasta from four ingredients…",
      "country": "IT",            // ISO 3166-1 alpha-2
      "category": "main",
      "diets": ["vegetarian"],    // absent when it suits none
      "difficulty": "medium",
      "servings": 2,
      "prepMinutes": 10,
      "cookMinutes": 15,
      "nutritionPerServing": { "calories": 690, "proteinG": 32, "carbsG": 62, "fatG": 34, "estimated": true },
      "ingredientCount": 7,
      "stepCount": 6,
      "source": "unitools"
    }
  ]
}
```

Resolve a full recipe by substituting into `recipePath`. Do not hardcode the
path — it is published so it can change without breaking a client.

## recipes/&lt;id&gt;.json

```jsonc
{
  "schemaVersion": 1,
  "id": "unitools-spaghetti-carbonara",
  "source":    { /* name, url, licence, attribution, version */ },
  "catalogue": { /* country, summary, diets, stepMinutes, ingredientScaling, photo */ },
  "recipe":    { /* the wire format, untouched */ }
}
```

**`recipe` is exactly the LIFT recipe wire format** —
[`schema/recipe-1.json`](https://www.dugcanlift.com/schema/recipe-1.json), the
same payload the ingest service returns and both apps already import. An
importer can hand that object straight to the code it already has and ignore
everything around it. Every file published here is validated against that
schema at build time.

`catalogue` is where things live that a catalogue needs and a single recipe
import does not:

| Field | Why it is here and not in `recipe` |
|---|---|
| `country`, `nativeName`, `summary`, `category`, `diets`, `difficulty` | Browse and filter. The wire format describes a recipe, not a shelf to file it on. |
| `stepMinutes` | Per-step timings, parallel to `recipe.steps`. Upstream measured them; the wire format has nowhere to put them, and dropping data because a schema lacks a field is how data gets lost. |
| `ingredientScaling` | `linear`, `damped` or `fixed`, parallel to `recipe.ingredients`. Meat doubles with servings; salt does not. |
| `photo` | The URL, author and licence of the upstream image. **Recorded, not downloaded and not displayed.** Photographs carry their own credit and their own share-alike terms, and republishing them is a separate decision from republishing the text. |

## Rules that matter

- **Nutrition is per serving.** Never per recipe, never pre-scaled. Both apps
  scale at log time, and only a per-serving value survives that without
  ambiguity.
- **`estimated: true` means estimated.** Everything seeded so far has macros
  computed from ingredient tables rather than measured in a lab. Both apps must
  surface that before anything is logged.
- **Absent is not zero.** A recipe whose macros are unknown omits
  `nutritionPerServing` entirely. A zero would enter someone's daily total as
  fact, and a confident wrong number is worse than an obvious gap.
- **`rawText` is always present on an ingredient.** It is what a person checks
  a parse against, and what the shopping list falls back to when a quantity
  could not be resolved.
- **`grams` only where it is real.** Set for `g` and `kg`. Absent for volumes,
  counts and vague units, because a tablespoon of oil and a tablespoon of
  flour are not the same mass and guessing a density would quietly invent
  calories.
- **Masses in grams, volumes in millilitres, doubles.** Clients round at their
  own boundary; nothing is pre-rounded here.

## Ids

`<source>-<slug>`: `unitools-spaghetti-carbonara`. Readable on purpose, so a
plan link can be debugged by eye and a bad reference is obvious in a log.

They are stable. An id that has been published is never reused for a different
recipe, because a plan someone was sent last month still points at it.

## Adding to it

The library is built, not hand-edited. `scripts/build_cook_library.py` converts
an upstream dataset and writes both files; it is deterministic, so rebuilding
without an upstream change produces an empty diff.

```bash
python3 scripts/build_cook_library.py            # fetch upstream, rebuild
python3 scripts/build_cook_library.py --check    # verify only, write nothing
```

A recipe that fails validation fails the build rather than being published.

## Licence

**The data here is CC BY-SA 4.0 and the site's MIT licence does not cover it.**
See [`library/LICENSE.md`](library/LICENSE.md). Anything that reuses these
recipes has to carry the attribution and share alike; anything built from a
different source can be licensed differently, which is why provenance is
recorded per recipe rather than once for the whole library.
