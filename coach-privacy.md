---
layout: page
title: LIFT Coach Privacy Policy
permalink: /coach/privacy/
hide_title: true
---

# Privacy Policy

**LIFT Coach** — the web app at [dugcanlift.com/coach](/coach/), the Android
app, and the iPhone app

Last updated: 16 September 2026

LIFT itself, the app your clients log in, has
[its own privacy policy](/app/privacy/).

## The short version

There is no server behind Coach and no account, for you or for your clients.
A client's log reaches you inside a link they send you, and it is stored only
on the device you open it on. Nothing you or your clients put into Coach is
uploaded anywhere, and there are no analytics, advertising or tracking in any
version.

The only network requests Coach makes are recipe and ingredient lookups you
start yourself, and they differ by platform — the Android app makes none at
all. They are listed below.

## Your clients' logs

A client uses **Send to Coach** in LIFT, which writes their log into a link and
puts it in an email they address to you and send themselves. The log rides in
the part of the link after the `#`, which browsers never send to a web server,
so opening the link sends nothing about your client to dugcanlift.com — the page
is loaded, and the log is read out of the link on your device.

What a link can hold is whatever the client chose to send: their name and an id,
goal, sex, age and height if set, training down to the set, food totals or
items, steps, bodyweight, and their runs, walks and hikes with personal bests.
A GPS route is included only if the client turned that on, and even then it is
their newest activity alone with the first and last 200 m removed by their app
before it was sent. Coach draws what arrives and never tries to fill that in.

How a link gets into Coach:

- **Web:** tap it, or paste it in.
- **Android:** tap it (it opens straight into the app), share it into Coach from
  the app it arrived in, or paste it in.
- **iPhone:** paste it in.

## Where Coach stores things

Your roster, your clients' logs, your recipes, meal plans, workouts and
schedule, and your own name and email address are stored only on your device:

- **Web:** in your browser's storage for dugcanlift.com. Clearing site data
  erases it.
- **Android:** in the app's private storage. Android's Auto Backup is turned off
  deliberately, so none of it is copied to Google Drive.
- **iPhone:** in the app's own container. Coach has no iCloud sync. If your
  iPhone itself is backed up to iCloud or a computer, iOS includes app data in
  that backup as it does for every app, under Apple's terms.

Uninstalling the app, or clearing the web app's site data, removes it all.

## What leaves your device

Only things you do:

- **Plan links.** When you send a client a meal plan or training plan, Coach
  builds a link and hands it to you — by opening your email app or copying it
  (web), or through the share sheet (Android and iPhone). You choose the
  recipient and send it yourself. The Android app sends meal plans; training
  plans are sent from the web and iPhone apps.
- **Invite text** for a new client, which you copy or share yourself.
- **Backup files.** Save a backup writes your roster and library to a file you
  choose where to keep. It contains your clients' logs, including any routes
  they sent, so keep it as carefully as the roster itself.

## Network requests, by platform

### Web

- **TheMealDB** (`www.themealdb.com`) — when you search it for a dish to import,
  the name you typed is sent to TheMealDB.
- **Open Food Facts, through our relay** — when you look up an ingredient for a
  recipe, the ingredient you typed is sent to
  `https://lift-proxy.dugcanlift.workers.dev`, a small Cloudflare Worker that
  passes it on to Open Food Facts and hands back the answer. It stores nothing
  of its own; how it works is described in [LIFT's policy](/app/privacy/).
- **Pasting a recipe** reads the text you paste. It fetches nothing.

Nothing else. The app's own files come from dugcanlift.com, and client route
maps are drawn in the page with no map service.

### iPhone

- **TheMealDB** — when you search it for a dish, the name you typed is sent.
- **A recipe page you paste** — when you import a recipe from a link, Coach
  fetches that page from the site you named, identifying itself as Coach, and
  reads the recipe out of it on the phone.
- **Apple Maps** — a client's route card is drawn with Apple Maps, which fetches
  map images from Apple for the area of the route. That request is made by iOS,
  under Apple's privacy policy, not to anything we run.

Ingredient lookups use a food database built into the app and send nothing.

### Android

None. The Android app has no internet permission and makes no network requests
of any kind. Every number it shows came out of a link or a backup file you gave
it.

## Third parties

TheMealDB (<https://www.themealdb.com>), Open Food Facts
(<https://world.openfoodfacts.org/privacy>), Cloudflare
(<https://www.cloudflare.com/privacypolicy/>) and Apple each have their own
privacy terms. We have no affiliation with TheMealDB or Open Food Facts and no
access to any of their logs. None of them receives anything from your roster or
your clients' logs.

## Analytics, advertising, and tracking

There are none, in any version. Coach contains no analytics SDK, no advertising
SDK, no crash reporting service, and no third-party tracking of any kind.

## Children

Coach is a tool for trainers. It is not directed at children.

## Deleting data

Remove a client from the roster to delete their log from that device, or
uninstall the app or clear the web app's site data to remove everything. Nothing
is held anywhere else. Emails and backup files are wherever you or your clients
put them.

## Changes

If Coach's behaviour changes in a way that affects this policy, this page will
be updated and the date above revised.

## Contact

Questions: privacy@dugcanlift.com
