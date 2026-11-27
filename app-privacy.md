---
layout: page
title: LIFT Privacy Policy
permalink: /app/privacy/
hide_title: true
---

# Privacy Policy

**LIFT** — the Android app (`com.dugcanlift.macrocalc`), the iPhone app and its
Apple Watch app, the Wear OS watch app, and the web app at
[dugcanlift.com/lift](/lift/)

Last updated: 12 November 2026

Coach, the app a trainer uses to read what you send, has
[its own privacy policy](/coach/privacy/).

## The short version

Everything you enter stays on your device. There are no accounts, no analytics,
no advertising, and no cloud sync, in any version. Nothing leaves your device
unless you do something that sends it:

- **Food search** sends the words you typed, or a barcode number, to Open Food
  Facts (Android and web).
- **Downloading streets for a map** asks OpenFreeMap for the streets in an area
  you chose, when you tap Download. Nothing is sent while you look at a map.
- **Send to Coach** puts your log into an email that you address and send
  yourself.
- **A backup file** goes wherever you choose to save it.

The rest of this page is the detail, platform by platform, because the versions
do not all do the same things.

## What LIFT stores, and where

All of this is written to storage that belongs to LIFT on your device — the
app's private storage on Android and Wear OS, the app's own container on iPhone
and Apple Watch, and your browser's storage for the web app. It is never
uploaded.

- Your calorie and macro goal, and the profile figures used to work it out
- Your food log: what you ate, how much, which meal, and when
- Your training log: exercises, equipment, sets, weight, reps, RPE, time,
  distance, and dates
- Saved routines, recipes, and your meal plan
- Bodyweight entries and your settings
- Your runs, walks and hikes: start and end time, distance, climb, and the GPS
  route recorded for each one (latitude, longitude, altitude, time and
  accuracy for each point)
- Your coach's name and email address, if you add them
- The streets you downloaded for maps (see Street maps, below)

On iPhone, LIFT's home-screen widget reads the same data from a storage area
shared only between the app and its widget.

## Location: recording runs, walks and hikes

LIFT uses your location to record the route of a run, walk or hike you started.
It does not track you at any other time, and the route stays on your device
unless you send it (see Send to Coach below) or save it to Health Connect or
Apple Health.

There is one other use, and it only happens when you tap: **Download streets
around here** uses your position to choose which area of streets to download
(see Street maps, below).

- **Android** asks for precise location while you use the app, and never for
  background ("Allow all the time") location. GPS starts when you start a
  recording and stops when you stop it. A recording carries on if your phone
  locks or you switch apps because it runs as a foreground service, shown as
  the ongoing "Recording your route" notification. That is one of the two
  things the notifications permission is for; the other is the rest timer
  (see Notifications, below).
- **iPhone** asks for location only while you use the app, and never for
  "Always". A recording you start keeps going with the phone locked in your
  pocket, and iOS shows that LIFT is using your location while it does. GPS
  runs only while the recording screen is open: it starts when that screen
  opens and stops when you finish, cancel or leave it.
- **Apple Watch** uses location only while you are recording an outdoor
  activity on the watch, and runs a workout session during it to keep GPS on.
- **The web app** can only record while the page is on screen. It starts
  watching your location when you start a recording, stops when you finish, and
  keeps the screen awake in between. A recording in progress is kept in the
  browser's storage so a reload doesn't lose it.
- **Wear OS** does not use location.

## Street maps

A run, walk or hike is drawn over a street map. The map is drawn on your device,
from streets you downloaded. Looking at a map, whether in the recording screen,
a summary or the Train tab, makes no request to anyone. If you have not
downloaded streets for the place, the route is drawn as a line on its own.

- **Downloading is your choice.** You pick an area and tap Download. Before
  anything is sent, LIFT says what it will download, where from ("OpenStreetMap
  data from OpenFreeMap"), what that service learns ("which area you asked
  for, once") and about how large it is. A 10 km area is about 35 MB; larger
  areas are much larger. What is sent is described under Street map downloads,
  below.
- **Where the streets are kept.** On iPhone and Android, in LIFT's own storage on
  your phone. On the web, in your browser's storage for dugcanlift.com. You can
  update or delete an area at any time; nothing updates on its own.
- **Backups.** Downloaded streets are not in a backup file, because you can
  download them again. On Android they are also left out of Android's backup
  and of phone-to-phone transfer.
- **Your position.** On iPhone and Android, **Download streets around here** uses
  the last position the phone already has, and only if you have already allowed
  LIFT to use your location. It never asks for permission itself. On the web it
  reads your location only when you tap that button, and your browser asks
  first. The position is not stored for this and is not sent as a point: only
  the area chosen from it is asked for. You can also download streets around
  the start of your last run instead.
- **The map software.** Maps are drawn with MapLibre, open-source software. On
  the web, it and the fonts it needs are served from dugcanlift.com and kept in
  your browser, like the rest of the app; none comes from another company's
  server. The Apple Watch and Wear OS apps draw no map.
- **Credits.** Maps show "© OpenStreetMap contributors" (the data is open, under
  the Open Database License), with OpenFreeMap, MapLibre and Noto Sans credited
  beside it.

## Health Connect and Apple Health

**Android — Health Connect.**

- *Reads:* your step count only — today's total for the dashboard, and daily
  totals for the weeks you send to a coach. It asks for permission to read
  history older than 30 days so those weeks are complete.
- *Writes:* a finished run, walk or hike, as an exercise session with its GPS
  route, distance and elevation gain — **only when you tap Export to Health
  Connect** on that activity. Nothing else is ever written, and write
  permission is only asked for at that moment.

**iPhone — Apple Health.**

- *Reads:* your step count (today's, and daily totals for Send to Coach) and
  your latest bodyweight, shown in Settings. Nothing else.
- *Writes:*
  - Strength sessions, as workouts, once you have connected Apple Health — when
    you end a live session, when you connect, or when you tap Sync now. A day
    logged after the fact gets an estimated time, marked as estimated.
  - Runs, walks and hikes, as a workout with its distance and GPS route, when
    you finish recording one.

**Apple Watch.**

- *Reads:* your heart rate and active energy, only while a strength session is
  running on the watch, to show your heart rate there. The watch also keeps
  the highest heart rate around each set, with the set. When the session ends,
  those figures and the session's average and highest heart rate are passed to
  LIFT on your paired iPhone with the session, where they stay.
- *Writes:* a strength session, as a workout, when you finish it on the watch;
  an outdoor activity, as a workout with its distance and route, when you
  finish recording one.

**The web app and Wear OS** do not use Health Connect or Apple Health at all.
The Wear OS watch's heart rate comes from its own sensor, as described under
The watch apps.
The web app's steps are the numbers you type in.

Health data LIFT reads stays on your device and is never used for advertising.
It leaves only as the step and bodyweight numbers inside a Send to Coach email
you choose to send.

## Camera

- **Android** uses the camera only to read a food barcode when you tap Scan.
  The barcode is decoded on the phone; no image or video is kept or sent.
- **The web app** uses the camera only to scan the QR codes a LIFT watch shows
  when you move its food log across. They are decoded in the page, and the
  camera stops when you close the scanner or leave the tab.
- **The iPhone app** uses the camera only to read a food barcode when you tap
  Scan a barcode. The barcode is read on the phone; no image or video is kept
  or sent. Only the digits are kept, and only if you enter a food against
  them: those remembered foods stay on your phone. LIFT doesn't send them
  anywhere; they go into a backup file only when you save one.

## Notifications

- **iPhone** asks to send notifications the first time a rest between sets
  starts in a live session, and uses them for one thing: telling you the rest
  is over, including with your phone locked. The notification is scheduled on
  the phone, for a time on the phone; nothing is sent to or from anywhere. Say
  no and the rest timer still counts down on screen and on the lock screen;
  only the alert at the end is missing.
- **Android** never asks for notifications for the rest timer. If you have
  already allowed them, for recording a route, a rest between sets in a live
  session shows its countdown as an ongoing notification, and a second one
  says the rest is over when LIFT is not on screen. Both are made on the phone,
  for a time on the phone; nothing is sent to or from anywhere. If you have not
  allowed notifications, the countdown still runs on screen.
- **The web app** never asks to send notifications. When a rest ends, the page
  says so and, where the browser allows it, vibrates the phone.

## Progress photos

You can keep progress photos in LIFT on iPhone, Android and the web. In every
build, LIFT saves a smaller copy of each photo you choose, without the
original's location data or any other metadata. Progress photos are never
uploaded, never included in a backup file, and never sent to a coach. Deleting
a photo in LIFT, or deleting LIFT, removes them.

- **iPhone** uses the system photo picker, which shows LIFT only the picture
  you pick and gives it no access to the rest of your library. The copies are
  kept in LIFT's own storage on your phone, and left out of iCloud and computer
  backups of the phone.
- **Android** uses the system photo picker too, which needs no permission. The
  copies are kept in LIFT's private storage on your phone, which Android's
  cloud backup leaves out. A direct phone-to-phone transfer when you set up a
  new handset carries them, as it carries the rest of your log.
- **The web app** uses your browser's file picker, which on a phone may also
  offer the camera. The page asks for no permission. The copies are kept in
  your browser's storage on this device; clearing the site's data erases them.

## What leaves your device

### Food search (Android and web)

When you search for a food or look up a barcode, that search term or barcode
number is sent to Open Food Facts, an open, volunteer-maintained food database.
The web app does the same when you look up an ingredient for a recipe.

What is sent: the text you typed, or the barcode number. What is **not** sent:
your food log, your workouts, your goal, your weight, any identifier for you or
your device, or anything else.

**The Android app** talks to Open Food Facts directly:

- Name search: `https://search.openfoodfacts.org`
- Barcode lookup: `https://world.openfoodfacts.org`

**The web app takes one extra hop.** Browsers refuse to let a web page call
Open Food Facts directly, so the web app sends your search term to a small
relay we run instead:

- `https://lift-proxy.dugcanlift.workers.dev`

It is a Cloudflare Worker whose only job is to pass a food search or barcode
lookup on to Open Food Facts and hand back the answer; it refuses anything
else. Its source is `worker.js` in this site's repository. It has no database
and no storage of its own. Cloudflare keeps a copy of each answer for five
minutes so a repeated search is quicker — a copy of the answer, not of who
asked. Cloudflare operates the relay, and its own logging and privacy terms
apply, at <https://www.cloudflare.com/privacypolicy/>. Because the relay calls
Open Food Facts on your behalf, Open Food Facts sees the relay rather than your
device.

Open Food Facts has its own privacy policy, at
<https://world.openfoodfacts.org/privacy>. We have no affiliation with them and
no access to their logs.

**The iPhone app** searches a food database built into the app, so a food search
there sends nothing at all.

### Street map downloads

When you tap Download for an area, LIFT asks `https://tiles.openfreemap.org`
for the map streets in that area. OpenFreeMap is a free service built on
OpenStreetMap data. It is not a server we run: the request goes there directly,
never to dugcanlift.com. It is the only time maps make a request, and it
happens only because you tapped Download.

What OpenFreeMap can see: **the area you asked for**, as a list of map tiles;
for Download streets around here, that is a place known to about a kilometer,
and for the start of your last run, the area around where that run began; and
**your IP address**, as with any request on the internet. A browser also adds
its usual details to a request, such as which browser it is. On iPhone and
Android the app names itself `LIFT-maps/1` and sends nothing else about you.
There is no key, no account, no cookie and no identifier in the request.

What is **not** sent: your runs, your routes, your heart rate, your log, your
goal, or your position as a point. Nothing is sent to us at all. We never learn
which areas you download or that you downloaded one.

On Android, LIFT already holds the internet permission for food search (above);
the download is the second thing it is used for.

OpenFreeMap has its own privacy policy, at <https://openfreemap.org/privacy/>,
which covers what it logs and how long it keeps it. We have no affiliation with
them and no access to their logs.

### Importing a recipe from a web page

Two ways bring a recipe from a website into LIFT, and in both the browser hands
over the recipe it already has on screen. LIFT reads it on your device and
makes no request of its own, so the site sees nothing from LIFT.

- **Share from Safari (iPhone):** share a recipe page to LIFT.
- **Send recipes from your browser (iPhone, Android and the web):** a bookmark
  you save once. Tapped on a recipe page, it reads the recipe the page already
  contains and opens LIFT with it inside the link. You check the recipe before
  anything is saved.

### Send to Coach

Send to Coach builds a link holding your log and opens your own email app with
it written out, addressed to the coach you entered. You can read it, change the
recipient, or not send it; LIFT uploads nothing itself. The log rides in the
part of the link after the `#`, which browsers never send to a web server.

For the weeks you choose, the link carries: your name and an id for you, your
goal, sex, age and height if you set them, your training down to the set, your
food as daily totals (or item by item if you turn that on), steps, bodyweight,
and your runs, walks and hikes — each one's date, time, distance and climb —
plus your personal bests.

It carries **no GPS route** unless you turn on sending your last route, which is
off until you do. With it on, the link includes the route of your newest
activity only, with the **first and last 200 m removed** so it does not show
where you started or finished, and thinned to at most 150 points.

### Backups

There is no cloud backup, on purpose. Instead, **Save a backup file** writes a
file containing your log — food, training, weight, goal, recipes, settings,
remembered barcode foods, and your runs, walks and hikes including their
routes — to wherever you choose. It
never leaves your device unless you move or send it somewhere. With routes in
it, it can show where you go, so treat the file with the same care as the log.

- **Android** turns off Android's Auto Backup, so nothing is copied to Google
  Drive. Direct phone-to-phone transfer when you set up a new handset still
  includes the app's data, except downloaded map streets, and never leaves
  hardware you own.
- **iPhone** has no iCloud sync of its own. If your iPhone itself is backed up
  to iCloud or a computer, iOS includes app data in that backup as it does for
  every app, under Apple's terms, except progress photos, which LIFT leaves
  out.
- **The web app** keeps everything in your browser, which does not sync it
  anywhere. Clearing site data erases it, so keep a backup file.
- **Every LIFT app** (iPhone, Android and the web) can also export your
  training as a spreadsheet (a CSV file) and import a training history
  exported from Strong, Hevy or FitNotes. Both are files you choose and handle
  yourself, through the system's own file picker (no storage permission on
  Android): LIFT reads an import on your device and writes an export only where
  you save or send it.

## The watch apps

**Apple Watch.** Logs sets, food and outdoor activities on the watch. Food you
log there is passed to LIFT on your paired iPhone over Apple's own watch
connection, and the iPhone sends the watch your recent foods so they are quick
to pick. The watch app makes no network requests of its own. It can also show
your food log as QR codes for the web app to scan.

**Wear OS.** Makes no network requests: the watch app has no internet
permission at all.

- **Food** you log is kept on the watch and shown as QR codes when you choose to
  export it; the LIFT web app reads them with the camera, as described above.
- **LIFT Link** pairs the watch with LIFT for Android, if you choose to, from
  the Watch card on the phone's Home screen. The two then talk directly over an
  encrypted Bluetooth connection, with no server, no account and nothing else:
  the day's workout goes to the watch (exercises, sets, target weights and your
  last numbers for each), and sessions you finish on the watch come back into
  your log on the phone. For this, both ask for the Nearby devices (Bluetooth)
  permission. The watch never searches for other devices; it only waits for
  your phone. The phone searches once, for LIFT's own watch app, to pair, and
  that search is declared never to be used to work out where you are. On
  Android 11 and older, Android itself requires location permission for any
  Bluetooth search; LIFT asks for nothing new there, because route recording
  already uses that permission.
- **Heart rate** is read from the watch's own sensor during a session you run
  on the watch, to show it on screen. The watch keeps only the highest heart
  rate around each set and the session's average and highest, and if you use
  LIFT Link they go to LIFT on your phone with the session. The watch asks for the Body sensors permission, or Heart rate on Wear
  OS 6 and later; say no and the session runs without it.
- **Vibrate** is the buzz at the end of a rest. Android grants it when you
  install; it asks you nothing.

## Analytics, advertising, and tracking

There are none, in any version. LIFT contains no analytics SDK, no advertising
SDK, no crash reporting service, and no third-party tracking of any kind.

## Children

LIFT is not directed at children and collects nothing that would identify
anyone.

## Deleting your data

Uninstalling the app, or clearing the web app's site data, removes all of it.
Nothing is held anywhere else, so there is no account to close and no deletion
request to make. Downloaded map streets can also be deleted one area at a time.
Copies you made yourself — a backup file, an email to your coach, activities
saved to Health Connect or Apple Health — are yours to delete where you put
them. OpenFreeMap, which answers a map download, is a separate service (see
Street map downloads, above); what it does with a request is under its own
policy.

## Changes

If an app's behavior changes in a way that affects this policy, this page will
be updated and the date above revised.

## Contact

Questions: [{{ site.email }}](mailto:{{ site.email }})
