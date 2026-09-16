# Licence — COOK recipe library data

**The recipe data in this directory is licensed CC BY-SA 4.0.**
<https://creativecommons.org/licenses/by-sa/4.0/>

This is **not** the licence on the rest of this repository. The site's code is
MIT (see `/LICENSE`). These two live side by side on purpose: the code stays
permissive, and the data carries the terms it came with.

## Attribution

This library contains an adaptation of:

> **UniTools World Recipes**, version 2.0.0 — UniTools — theunitools.com
> <https://theunitools.com/en/data> — licensed CC BY-SA 4.0

Adapted by reformatting into the LIFT recipe wire format: one English text
selected from the bilingual original, ingredient lines rewritten as single
strings, masses resolved to grams where the unit allowed it, and per-serving
macros renamed. No recipe text was rewritten, added to, or removed.

Every file records its own source, licence and attribution, so a recipe keeps
its credit if it is copied out of here on its own.

## What this means if you reuse it

- **Credit it.** Name the source and link the licence.
- **Share alike.** Anything built on this data goes out under CC BY-SA 4.0 too.
- **Say what you changed.** As above.
- Commercial use is allowed. Attribution and share-alike are not optional.

## Photographs are not included

Recipe entries may record a `photo` URL with its own author and licence. Those
images are **referenced, not republished** — they are not stored here and the
site does not display them. Each carries its own credit, and using one means
honouring that credit yourself.

## Macros are estimates

Every recipe seeded from UniTools carries `"estimated": true`. The macros are
computed from ingredient tables, not measured. They are a planning reference,
not nutritional or medical fact. The apps surface that flag before anything is
logged, and anything reusing this data should do the same.

## If you are the rights holder

Provenance is recorded per recipe, so any single source can be filtered or
removed wholesale. Open an issue at
<https://github.com/dougray/dugcanlift-site> and it will be.
