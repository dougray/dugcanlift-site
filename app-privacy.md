---
layout: page
title: LIFT Privacy Policy
permalink: /app/privacy/
---

# Privacy Policy

**LIFT** — the Android app (`com.dugcanlift.macrocalc`) and the web app at
[dugcanlift.com/lift](/lift/)

Last updated: 24 August 2026

## The short version

Everything you enter stays on your phone. There are no accounts, no analytics,
no advertising, and no cloud sync. The only thing that ever leaves your device
is a food search term or barcode, and only when you choose to use that feature.
On the web app that search term passes through a small relay we run before it
reaches Open Food Facts — described in full below.

## What the app stores, and where

All of the following is written to the app's private storage on your device.
Other apps cannot read it. It is never uploaded.

- Your calculated calorie and macro goal
- Your food log: what you ate, how much, which meal, and on what date
- Your workout log: exercises, equipment, sets, weight, reps, RPE, time,
  distance, and dates
- Saved workout routines
- Your training focus preference

The figures you enter into the calculator — sex, age, weight, height, activity
level — are used to compute your goal and are not retained beyond the resulting
numbers.

Your daily step goal is stored the same way as your training focus. Today's
step count itself is **not** stored by the app — it's read live from Health
Connect each time you open the dashboard and is never written anywhere,
including back to Health Connect.

## What leaves your device

**Food search and barcode scanning only.**

When you search for a food or scan a barcode, that search term or barcode number
is sent to Open Food Facts, an open, volunteer-maintained food database.

What is sent: the text you typed, or the barcode you scanned.

What is **not** sent: your food log, your workouts, your goal, your weight, any
identifier for you or your device, or anything else at all.

### The Android app

Talks to Open Food Facts directly, with nothing in between:

- Name search: `https://search.openfoodfacts.org`
- Barcode lookup: `https://world.openfoodfacts.org`

### The web app takes one extra hop

Browsers refuse to make those calls from a web page, because Open Food Facts
does not send the cross-origin header a browser requires. So the web app sends
your search term to a small relay we run instead:

- `https://lift-proxy.dugcanlift.workers.dev`

It is a Cloudflare Worker whose entire job is to pass the search on to Open
Food Facts and hand the answer back. Its source is `worker.js` in this site's
repository, so you can read exactly what it does.

It receives only what you typed — a search term or a barcode. It has no
database, no storage of any kind attached to it, and it keeps nothing. It will
only answer requests coming from dugcanlift.com. Cloudflare operates it and
its own logging and privacy terms apply, at
<https://www.cloudflare.com/privacypolicy/>.

One consequence is worth stating plainly, because it cuts in your favour: since
the relay makes the call to Open Food Facts on your behalf, Open Food Facts
sees the relay rather than your device. Your IP address never reaches them from
the web app.

### Either way

Open Food Facts operates its own servers and has its own privacy policy, at
<https://world.openfoodfacts.org/privacy>. We have no affiliation with them and
no access to their logs.

This feature is optional. If you enter foods manually, neither version makes
any network request whatsoever.

## Permissions

- **Internet** — used solely for the food lookups described above.
- **Camera** — used solely to read a barcode when you tap Scan. No image or
  video is stored or transmitted; the camera feed is decoded on the device and
  discarded.
- **Health Connect (step count, read-only)** — used to show today's steps on
  the dashboard. The app cannot write to Health Connect and never sends step
  data anywhere; it stays between Health Connect and the app, on your device.

## Analytics, advertising, and tracking

There are none. The app contains no analytics SDK, no advertising SDK, no crash
reporting service, and no third-party tracking of any kind.

## Children

The app is not directed at children and collects nothing that would identify
anyone.

## Deleting your data

Uninstalling the app removes all of it. There is nothing held anywhere else,
so there is no account to close and no deletion request to make.

## Changes

If the app's behaviour changes in a way that affects this policy, this document
will be updated in the same commit as the change, and the date above revised.

## Contact

Questions: <https://www.dugcanlift.com>
