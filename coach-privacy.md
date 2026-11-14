---
layout: page
title: LIFT Coach Privacy Policy
permalink: /coach/privacy/
hide_title: true
---

# Privacy Policy

**LIFT Coach** — the web app at [dugcanlift.com/coach](/coach/), the Android
app, and the iPhone app

Last updated: 12 November 2026

LIFT itself, the app your clients log in, has
[its own privacy policy](/app/privacy/).

## The short version

There is no server behind Coach and no account, for you or for your clients.
A client's log reaches you inside a link they send you, and it is stored only
on the device you open it on. Nothing you or your clients put into Coach is
uploaded anywhere, and there are no analytics, advertising or tracking in any
version.

The only network requests Coach makes are ones you start yourself: recipe and
ingredient lookups in the web app, and downloading street maps for a client's
route in all three apps. They are listed below.

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
It draws the route over a street map when you have downloaded the streets for
that area (see Street maps, below), and as a line on its own when you have not.

How a link gets into Coach:

- **Web:** tap it, or paste it in.
- **Android:** tap it (it opens straight into the app), share it into Coach from
  the app it arrived in, or paste it in.
- **iPhone:** paste it in.

## Street maps

A client's last route is drawn over a street map. The map is drawn on your
device, from streets you downloaded. Looking at a client's page makes no
request to anyone, and Coach never downloads on its own, including when a new
link arrives with a route somewhere new.

- **Downloading is your choice.** On a client's route card, or in Coach's
  settings, you pick an area and tap Download. Before anything is sent, Coach
  says what it will download, where from ("OpenStreetMap data from
  OpenFreeMap"), what that service learns, and about how large it is. A 10 km
  area is about 35 MB; larger areas are much larger. What is sent is described
  under Street map downloads, below.
- **The area is your client's.** Coach has no location of its own. The area you
  download is centered on your client's route, so it is roughly where that
  client runs. It is not their name, and it is not their log.
- **Areas belong to you, not to a client.** One downloaded area can cover
  several clients. Removing a client does not delete an area; you can delete
  or update areas yourself, and nothing updates on its own.
- **Where the streets are kept.** On iPhone and Android, in Coach's own storage on
  your device. On the web, in your browser's storage for dugcanlift.com. They are
  not in a backup file, because you can download them again.
- **The map software.** Maps are drawn with MapLibre, open-source software. On
  the web, it and the fonts it needs are served from dugcanlift.com and kept in
  your browser; none comes from another company's server.
- **Credits.** Maps show "© OpenStreetMap contributors" (the data is open, under
  the Open Database License), with OpenFreeMap, MapLibre and Noto Sans credited
  beside it.

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

- **Street map downloads.** When you tap Download for an area, Coach asks
  OpenFreeMap for the streets there (see Street map downloads, below).
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

- **Open Food Facts, through our relay** — when you look up an ingredient for a
  recipe, the ingredient you typed is sent to
  `https://lift-proxy.dugcanlift.workers.dev`, a small Cloudflare Worker that
  passes it on to Open Food Facts and hands back the answer. It stores nothing
  of its own; how it works is described in [LIFT's policy](/app/privacy/).
- **Pasting a recipe** reads the text you paste. It fetches nothing.

- **OpenFreeMap** — when you download streets for a client's route, described
  under Street map downloads, below.

Nothing else. The app's own files come from dugcanlift.com, including the map
software and fonts, which your browser keeps. Client route maps are drawn in the
page from streets you downloaded, and nothing is requested while you look at one.

### iPhone

Coach on iPhone makes one kind of network request: a street map download you
start, described under Street map downloads, below. A recipe page reaches it
through Safari's share sheet: Safari hands over the recipe it already has on
screen, and Coach reads it on the phone without contacting the site. A client's
route card is drawn on the device from streets you downloaded. Ingredient
lookups use a food database built into the app.

### Android

One kind: a street map download you start, described under Street map
downloads, below. The Android app holds the internet permission for that and for
nothing else, and makes no other network request. Every number it shows came out
of a link or a backup file you gave it.

### Street map downloads

On all three apps, when you tap Download for an area, Coach asks
`https://tiles.openfreemap.org` for the map streets in that area. OpenFreeMap is
a free service built on OpenStreetMap data. It is not a server we run: the
request goes there directly, never to dugcanlift.com. It is the only time maps
make a request, and it happens only because you tapped Download.

What OpenFreeMap can see: **the area you asked for**, as a list of map tiles,
which is the area around a client's route, roughly where that client runs; and
**your IP address**, as with any request on the internet. A browser also adds
its usual details to a request, such as which browser it is. On iPhone and
Android the app names itself `LIFT-maps/1` and sends nothing else about you.
There is no key, no account, no cookie and no identifier in the request.

What is **not** sent: your roster, a client's name or log, their route as a
line, or anything about you or them beyond the area. Nothing is sent to us at
all.

OpenFreeMap has its own privacy policy, at <https://openfreemap.org/privacy/>,
which covers what it logs and how long it keeps it. We have no affiliation with
them and no access to their logs.

## Third parties

Open Food Facts (<https://world.openfoodfacts.org/privacy>), Cloudflare
(<https://www.cloudflare.com/privacypolicy/>) and OpenFreeMap
(<https://openfreemap.org/privacy/>) each have their own privacy terms. We have
no affiliation with any of them and no access to their logs. None of them
receives your roster or your clients' logs. OpenFreeMap receives the area of a
map you ask to download, and only that.

## Analytics, advertising, and tracking

There are none, in any version. Coach contains no analytics SDK, no advertising
SDK, no crash reporting service, and no third-party tracking of any kind.

## Children

Coach is a tool for trainers. It is not directed at children.

## Deleting data

Remove a client from the roster to delete their log from that device, or
uninstall the app or clear the web app's site data to remove everything. Nothing
is held anywhere else by us. Downloaded map areas are yours, not a client's, so
removing a client does not delete one; delete an area in Coach's map settings.
Emails and backup files are wherever you or your clients put them. OpenFreeMap,
which answers a map download, is a separate service; what it does with a
request is under its own policy.

## Changes

If Coach's behavior changes in a way that affects this policy, this page will
be updated and the date above revised.

## Contact

Questions: [{{ site.email }}](mailto:{{ site.email }})
