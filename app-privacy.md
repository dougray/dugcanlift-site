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

Last updated: 17 September 2026

Coach, the app a trainer uses to read what you send, has
[its own privacy policy](/coach/privacy/).

## The short version

Everything you enter stays on your device. There are no accounts, no analytics,
no advertising, and no cloud sync, in any version. Nothing leaves your device
unless you do something that sends it:

- **Food search** sends the words you typed, or a barcode number, to Open Food
  Facts (Android and web).
- **Importing a recipe from a link** fetches the page you pasted (iPhone).
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

On iPhone, LIFT's home-screen widget reads the same data from a storage area
shared only between the app and its widget.

## Location: recording runs, walks and hikes

LIFT uses your location for one thing — recording the route of a run, walk or
hike you started. It does not track you at any other time, and the route stays
on your device unless you send it (see Send to Coach below) or save it to
Health Connect or Apple Health.

- **Android** asks for precise location while you use the app, and never for
  background ("Allow all the time") location. GPS starts when you start a
  recording and stops when you stop it. A recording carries on if your phone
  locks or you switch apps because it runs as a foreground service, shown as
  the ongoing "Recording your route" notification — which is what the
  notifications permission is for.
- **iPhone** asks for location access including "Always", so that a recording
  keeps going with the phone locked in your pocket. GPS runs only while the
  recording screen is open: it starts when that screen opens and stops when you
  finish, cancel or leave it.
- **Apple Watch** uses location only while you are recording an outdoor
  activity on the watch, and runs a workout session during it to keep GPS on.
- **The web app** can only record while the page is on screen. It starts
  watching your location when you start a recording, stops when you finish, and
  keeps the screen awake in between. A recording in progress is kept in the
  browser's storage so a reload doesn't lose it.
- **Wear OS** does not use location.

Route maps are drawn on the device itself on Android and the web, with no map
service involved. The iPhone app draws them with Apple Maps, which fetches map
images from Apple for the area the route covers — that request is made by iOS,
under Apple's privacy policy, not to anything we run.

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
  your latest bodyweight, shown in Settings. It also asks to read workouts, but
  does not currently read them.
- *Writes:*
  - Strength sessions, as workouts, once you have connected Apple Health — when
    you end a live session, when you connect, or when you tap Sync now. A day
    logged after the fact gets an estimated time, marked as estimated.
  - Runs, walks and hikes, as a workout with its distance and GPS route, when
    you finish recording one.
- It also asks for permission to save bodyweight, calories and protein. The
  current version does not write any of those.

**Apple Watch.** Reads nothing from Apple Health. When you finish an outdoor
activity on the watch, it saves the workout, distance and route to Apple
Health. Strength sessions on the watch are not saved to Health.

**The web app and Wear OS** do not use Health Connect or Apple Health at all.
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
- **The iPhone app** declares camera access for barcode scanning, but does not
  use the camera in its current version.

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

### Importing a recipe from a link (iPhone)

When you paste a recipe page's address and import it, the iPhone app fetches
that page from the site you named and reads the recipe out of it on the phone.
The site sees an ordinary request for its page from your device, identifying
itself as LIFT. Nothing from your log is sent.

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
file containing your log — food, training, weight, goal, recipes, settings, and
your runs, walks and hikes including their routes — to wherever you choose. It
never leaves your device unless you move or send it somewhere. With routes in
it, it can show where you go, so treat the file with the same care as the log.

- **Android** turns off Android's Auto Backup, so nothing is copied to Google
  Drive. Direct phone-to-phone transfer when you set up a new handset still
  includes the app's data, and never leaves hardware you own.
- **iPhone** has no iCloud sync of its own. If your iPhone itself is backed up
  to iCloud or a computer, iOS includes app data in that backup as it does for
  every app, under Apple's terms.
- **The web app** keeps everything in your browser, which does not sync it
  anywhere. Clearing site data erases it, so keep a backup file.

## The watch apps

**Apple Watch.** Logs sets, food and outdoor activities on the watch. Food you
log there is passed to LIFT on your paired iPhone over Apple's own watch
connection, and the iPhone sends the watch your recent foods so they are quick
to pick. The watch app makes no network requests of its own. It can also show
your food log as QR codes for the web app to scan.

**Wear OS.** Asks for no permissions and makes no network requests. Food you
log is kept on the watch and shown as QR codes when you choose to export it;
the LIFT web app reads them with the camera, as described above.

## Analytics, advertising, and tracking

There are none, in any version. LIFT contains no analytics SDK, no advertising
SDK, no crash reporting service, and no third-party tracking of any kind.

## Children

LIFT is not directed at children and collects nothing that would identify
anyone.

## Deleting your data

Uninstalling the app, or clearing the web app's site data, removes all of it.
Nothing is held anywhere else, so there is no account to close and no deletion
request to make. Copies you made yourself — a backup file, an email to your
coach, activities saved to Health Connect or Apple Health — are yours to delete
where you put them.

## Changes

If an app's behaviour changes in a way that affects this policy, this page will
be updated and the date above revised.

## Contact

Questions: [{{ site.email }}](mailto:{{ site.email }})
