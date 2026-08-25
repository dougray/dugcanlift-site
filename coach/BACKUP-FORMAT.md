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
`carbsG`, `fiberG`, `date` (`YYYY-MM-DD`), `loggedAt` (epoch ms), `meal`
(`BREAKFAST` | `LUNCH` | `DINNER` | `SNACK`).

**`workouts[]`** — `id`, `date`, `name`, `note`, `startedAt` (epoch ms), and
`exercises[]` of `id`, `name`, `equipment`, `note`, `sets[]` of `id`,
`weightLb`, `reps`, `rpe`, `durationSec`, `distanceMeters`.

**`routines[]`** — saved templates, where the client has them. Web has none yet.

**`goal`** — `calories`, `proteinG`, `fatG`, `carbsG`, `fiberG`.

**`settings`** — `focus`, `stepGoal`.

**`coach`** — `email`, `you`, `id`, `weeks`, `itemised`. The `id` is the thing
that matters: carrying it means a coach sees the same person after a restore
instead of a stranger joining their roster.

**`profile`** — `sex`, `age`, `heightIn`. **`weights`** — `{ "YYYY-MM-DD": lb }`.

Weights are **pounds** and distances **metres**, always, whatever the user sees
on screen — same rule as the share format, and for the same reason: a file that
mixed units would be unreadable the moment someone changed the setting.

Steps are absent by design. The native apps read them from Health Connect and
HealthKit when needed rather than storing them, so they have nothing of their
own to hand over.

## `ext` — what the common shape cannot hold

The clients are not a superset and a subset of each other. They overlap, and
each has fields the others have no home for. Those go under `ext.<platform>`,
keyed by the record id they belong to.

`ext.ios` currently carries, per food entry: `brand`, `servingUnit`,
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

## Known lossy conversions

iOS stores kilograms and nutrition as decimals; the file is pounds and whole
numbers. A kg → lb → kg round trip lands within 0.1 lb, and calories round to
the nearest whole. Nothing else is lost as long as `ext` is preserved.
