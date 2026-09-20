# LIFT backup file — format v1

What `Save a backup file` writes, in all four LIFT clients. Not to be confused
with [SHARE-FORMAT.md](SHARE-FORMAT.md), which is the compact thing that rides
inside a coach link. That one is built to survive an email and is deliberately
lossy. This one is built to be restored, and tries not to lose anything.

There is no account and no server, so this file is the only way a log survives
a cleared browser, a reinstall, or a new phone. It is also the only migration
path between platforms.

## Envelope

```json
{
  "v": 1,
  "app": "lift",
  "saved": "2026-08-24",
  "data": { ... },
  "ext": { "ios": { ... } }
}
```

A reader must reject any file whose `app` is not `"lift"` — a LIFT Coach
backup is a different thing and will otherwise half-import.

## `data` — the common shape

Every client reads and writes these, and the field names match what each
platform already stores, which is why a browser backup restores on a phone.

**`food[]`** — `id`, `name`, `servings`, `calories`, `proteinG`, `fatG`,
`carbsG`, `fiberG`, `saturatedFatG`, `sugarG`, `sodiumMg`, `amountGrams`, `date` (`YYYY-MM-DD`), `loggedAt` (epoch ms), `meal`
(`BREAKFAST` | `LUNCH` | `DINNER` | `SNACK`).

**`workouts[]`** — `id`, `date`, `name`, `note`, `startedAt` (epoch ms), and
`exercises[]` of `id`, `name`, `equipment`, `note`, `sets[]` of `id`,
`weightLb`, `reps`, `rpe`, `durationSec`, `distanceMeters`, `side`.

**`side` is `"left"` or `"right"`, and is omitted entirely when both.** Not
`"both"`, not `null`, not a bit — absent. A set with no `side` was performed
with both limbs, which is what every set written before per-limb logging
means, so an older file restores correctly with no migration and no guessing.
A reader that does not know the field ignores it and still restores the weight
and the reps; a reader that does must treat an unrecognised string as both
rather than failing the import, the same leniency this file asks for
everywhere else.

Named rather than packed into a number, unlike SHARE-FORMAT's `flags` bits,
and for the same reason `outdoor[]`'s bests are objects here: a share link is
squeezed into a URL that has to fit in a text message, and a backup is a file
a person opens, three platforms read, and a fourth may carry through without
understanding (see **A client MUST preserve an `ext` block it does not
understand**). A field you can read with your eyes survives that; a bitfield
survives it only as long as someone remembers to document it.

`side` is part of the identity of a lift for grouping and charting — name,
equipment *and* side, since a left-arm row and a right-arm row are no more the
same lift than a cable pulldown and a machine pulldown are. It is not part of
the identity of a *record*: sets still match on `id` when restoring.

**`routines[]`** — saved templates: `id`, `name`, `folder`, `createdAt` (epoch
ms), and `exercises[]` of `id`, `name`, `equipment`, `targetSets`, `targetReps`,
`targetWeightLb`, `targetRpe`, `targetDurationSec`, `targetDistanceMeters`,
`note`. Written by LIFT for Android and the browser build. Every `target*` field
is optional, and absent means not prescribed, never zero.

**`outdoor[]`** — finished GPS runs, walks and hikes: `id`, `activityType`
(`RUN` | `WALK` | `HIKE`), `startedAtEpochMs`, `endedAtEpochMs`,
`distanceMeters`, `elevationGainMeters`, and `routePoints[]` of `latitude`,
`longitude`, `altitudeMeters` (`null` when the device reported none),
`recordedAtEpochMs`, `horizontalAccuracyMeters`. Field names are LIFT for
Android's own storage. All three LIFT builds write and restore it. Restore
adds activities whose `id` the device does not already have, compared
case-insensitively; an activity with no end or an unknown type is skipped. A
recording still in progress is never written, and a Health Connect or HealthKit
export record is never carried: a restored activity was not exported from the
phone it lands on. An `id` that is not a UUID may be given a stable UUID by a
client that needs one.

Saturated fat and sugar are grams and sodium is milligrams, **per serving**
like the other macros, on food and on a recipe. Absent or `null` means the
source did not say — never `0`. They have no goal. Files written before these
existed carried an iPhone's sugar and sodium under `ext.ios`; a reader should
still take them from there when the common field is missing.

**`goal`** — `calories`, `proteinG`, `fatG`, `carbsG`, `fiberG`.

**`settings`** — `focus`, `stepGoal`.

**`coach`** — `email`, `you`, `id`, `weeks`, `itemised`. The `id` is the thing
that matters: carrying it means a coach sees the same person after a restore
instead of a stranger joining their roster.

**`profile`** — `sex`, `age`, `heightIn`. **`weights`** — `{ "YYYY-MM-DD": lb }`.

**`recipes[]`** — `id`, `name`, `servings`, `totalWeightGrams`, `ingredients[]`
of `{ rawText, item, qty, unit, grams, optional, note }`, `steps[]` (strings),
`nutritionPerServing` of `{ calories, proteinG, carbsG, fatG, fiberG,
saturatedFatG, sugarG, sodiumMg, estimated }`, `sourceUrl`, `sourceAuthor`, `sourceTranscript`, `prepMinutes`,
`cookMinutes`, `importedAt` (epoch ms).

Only `id`, `name` and `servings` are required. `rawText` is the contract for an
ingredient: every client runs the same parser, so a reader may reparse it and
treat `item`/`qty`/`unit`/`grams` as a cache. `ingredients[]` is in the order
the recipe lists them. `nutritionPerServing` is **per serving and never
pre-scaled**, and `null` means unknown — never write zeros for macros nobody
entered. `totalWeightGrams` is the whole finished dish, in grams whatever the
screen showed; absent or `null` means not weighed.

**`plan[]`** — planned meals: `id`, `recipeId`, `recipeName`, `date`
(`YYYY-MM-DD`), `meal` (`BREAKFAST` | `LUNCH` | `DINNER` | `SNACK`), `servings`,
`amountGrams`, `snapshotNutrition`, `snapshotNutritionPerGram`,
`loggedFoodEntryId`.

`snapshotNutrition` is the recipe's per-serving figure at the moment the meal was
planned, **not scaled by `servings`** — scaling happens where it is used.
`amountGrams` and `snapshotNutritionPerGram` exist only for a meal planned by
weight. `loggedFoodEntryId` is the `food[]` id the meal became when eaten, or
`null`. `recipeName` is kept so a meal still reads sensibly if its recipe is
later deleted.

Weights are **pounds** and distances **metres**, always, whatever the user sees
on screen — same rule as the share format, and for the same reason: a file that
mixed units would be unreadable the moment someone changed the setting. When a
food entry has `amountGrams`, it is the authoritative gram amount.
Display-unit preference (grams vs. ounces) is a device-local setting never
included in the exported record, so there is nothing to reconcile across devices
for that preference.

Steps are absent by design. The native apps read them from Health Connect and
HealthKit when needed rather than storing them, so they have nothing of their
own to hand over.

**Shopping-list ticks are absent by design too.** They mark items bought for one
week's shop, keyed by item name, and restoring last month's ticks would show
this week's list as already bought. The list itself is not stored anywhere; it
is derived from `plan[]` and `recipes[]`, so it rebuilds on restore.

## Unknown sections

**A client MUST preserve a `data` section it does not understand**, exactly as it
must preserve an `ext` block. Read the file, keep the section, write it back out
unchanged on the next save.

This is what lets a section be added without bumping `v`. `recipes[]` and
`plan[]` were added to v1 on 2026-09-16, and a client older than that still
reads the file fine — but without this rule, restoring a new backup into an old
client and saving again would silently throw away every recipe. The sections a
client stores go out from its own data; everything else it read goes back out
as it came in.

## `ext` — what the common shape cannot hold

The clients are not a superset and a subset of each other. They overlap, and
each has fields the others have no home for. Those go under `ext.<platform>`,
keyed by the record id they belong to.

`ext.ios.recipes` carries, per recipe: `sugarG`, `sodiumMg`, and
`ingredientFoodRefIDs` — the position of an ingredient in `ingredients[]`, as a
string, mapped to its food-database reference. `ext.ios.plan` carries, per
planned meal: `plannedFor` (epoch ms). iOS's own `createdAt` is written as the
common `importedAt` rather than duplicated here. `ext.ios` also carries, per
food entry: `brand`, `servingUnit`,
`servingGrams`, `sugarG`, `sodiumMg`, `foodRefID`, `healthKitUUID`. Per workout
day: `focus`, `liveStartedAt`, `liveEndedAt`, `healthKitUUID`. Per exercise:
`exerciseRefID`, `primaryMuscle`, `orderIndex`. Per set: `orderIndex`,
`isWarmup`, `completedAt`. Plus `measurements[]`, which is richer than the flat
`weights` map the common shape uses.

**A client MUST preserve an `ext` block it does not understand.** Read the file,
keep the block, write it back out unchanged on the next save. Without that rule,
restoring an iPhone backup into the web app and exporting it again silently
throws away every warmup flag and every gram of sodium the phone had recorded.
Preserving what you cannot read is the only thing that makes this file safe to
carry between platforms.

## Restoring

Additive, everywhere. Match on `id`, add what is missing, never overwrite what
is already there. Restoring last month's file onto a working phone must not cost
someone today's session. The trade is that a restore cannot undo a deletion,
which is the safer way round.

**Compare ids case-insensitively.** iOS writes UUIDs in upper case and the
browser generates them in lower case, so the same record can arrive spelled
both ways. An exact string comparison treats them as two records and duplicates
the entry on every round trip between a phone and a browser. This applies to
every section — `food`, `workouts`, `recipes`, `plan` — and to references such
as `recipeId` and `loggedFoodEntryId`.

**A record whose id is not a UUID is still a record.** Web falls back to a
non-UUID id where `crypto.randomUUID` is unavailable. A client that stores UUIDs
must derive a stable one from the string rather than skip the record — skipping
a recipe orphans every planned meal that points at it. Stable matters: the same
string must give the same UUID on every restore, or the additive rule stops
recognising what it already has. Every reference to that record — a planned
meal's `recipeId` — goes through the same derivation, so the link survives.

The limit, stated rather than discovered: the derived UUID is what that client
writes back out, so the record returning to the browser it came from is a new id
there and restores as a second copy. It is rare — `crypto.randomUUID` exists in
every browser serving over HTTPS — and duplicating a record is recoverable where
skipping it is not.

**A planned meal whose recipe is in neither the file nor the device is
skipped.** It would render as a meal with nothing behind it.

## Known lossy conversions

iOS stores kilograms and nutrition as decimals; the file is pounds and whole
numbers. A kg → lb → kg round trip lands within 0.1 lb, and calories round to
the nearest whole. Nothing else is lost as long as `ext` is preserved.
