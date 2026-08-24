---
layout: post
title:  "LIFT Is Coming To Your Phone"
date:   2026-08-12 20:00:00 -0500
---

I built the macro calculator on this site because I needed it — a way to turn "I think I'm overeating" into an actual number I could act on. What I didn't expect was how fast "just the calculator" turned into "the whole thing I actually use every day."

That whole thing is called LIFT, and it's time I talked about it here properly.

## What LIFT actually is

LIFT is the nutrition and training tracker I built for myself, then decided to give away. Same calculator that's on this site, but wired into an actual food log, a workout log, and a dashboard that opens on today instead of making you dig for it.

Log what you ate — scan a barcode, search by name, or type it in by hand — and it groups by meal and totals against your goal automatically. Log what you trained — weight, reps, RPE, time, distance, whatever your training actually looks like — and it shows you what you lifted last time, right under the exercise, so you're never guessing whether to add five pounds. Pick a focus (bodybuilding, powerlifting, CrossFit, Hyrox, endurance) and it only shows you the fields that matter for that.

Steps come from Health Connect automatically on Android — no manual entry, no separate app to check.

And your data is yours. No account, no cloud sync, no ads, no analytics. The only thing that ever leaves your phone is a food search term, sent to Open Food Facts so it can tell you what's in the can. (On the web version that search term hops through a small relay I run first — browsers won't call Open Food Facts directly. It keeps nothing, and the [privacy policy](/app/privacy/) spells out exactly what it does.) Your log, your weight, your workouts — none of it goes anywhere. It's all open source too, so that's not a claim you have to take my word for.

## Where you can get it right now

**iPhone: try it today.** There's a web version of LIFT running right on this site at [dugcanlift.com/lift](/lift/) — add it to your home screen from Safari and it behaves like a real app: full screen, works offline, no browser chrome. It's the sneak peek while the native iOS app finishes cooking. The one real gap is steps — browsers can't read HealthKit, so that part's manual entry for now on the web version.

**Android: available now, direct.** The native Android app is out and working — I'm using it every day, which is the only QA process that's ever mattered to me. It's not on Google Play or F-Droid yet, so right now you install it the old-school way: grab the APK straight from [the GitHub releases page](https://github.com/dougray/dugcanlift-macrocalc/releases). Android will warn you about installing from outside the Play Store — that's normal, not a red flag, it's just what happens with any app that isn't distributed through a store yet.

## What's coming

I'm actively working through what it takes to get LIFT into the actual stores instead of just a releases page:

- **Google Play** — coming soon
- **F-Droid** — coming soon, and honestly the one I care most about getting right, since it's the store built around exactly the "no ads, no tracking, open source" promise LIFT is already making
- **Apple App Store** — the native iOS app is in active development right now, past the "does it work" stage and into the "does it work on someone else's phone" stage. The PWA is the placeholder until it lands.

None of these are far-off someday plans — they're the actual next thing I'm doing, in order. I'll post here the moment any of them go live.

## Why I'm doing this the slow way

I could've thrown LIFT on the Play Store the day it compiled. I didn't, because I wanted to actually use it under real conditions first — the same reason none of my training numbers in these posts come from a spreadsheet I filled in once and forgot about. An app I built to help me be honest about my own numbers should have to survive being used by the person who built it before I hand it to anyone else.

It has. Now it's your turn.

If you're on iPhone, [go try the web version](/lift/) — that link works right now, no waiting. If you're on Android, [grab the release](https://github.com/dougray/dugcanlift-macrocalc/releases). And if you want the full picture of what it does and doesn't do with your data, [the app page](/app/) and [privacy policy](/app/privacy/) lay all of it out.

More soon — both on the training side of this blog and on LIFT itself.
