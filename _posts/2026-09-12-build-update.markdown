---
layout: post
title:  "Build Update: What Shipped This Week"
date:   2026-09-12 21:00:00 -0500
---

I've been heads-down building for a week straight, and enough landed that it deserves a proper write-up instead of me trying to remember it all in a month. This is the first of these. If people find it useful I'll keep doing them.

Quick orientation for anyone new here: **LIFT** is the app I built to track my own training and food. It runs on iPhone, Android, Apple Watch, and in the browser. **COACH** is the other half — the tool a trainer uses to see what their clients are actually doing and send them a plan back. Nothing in either app talks to a server. Your data lives on your device, full stop.

Here's what's new, app by app.

## LIFT on iPhone

**You can finally log a food you've never eaten before.** I'm a little embarrassed about this one. Until this week the iPhone app could only re-log something from your history — there was no way to search for a new food at all. Now there's a real search over about 7,900 foods from the USDA database, bundled inside the app so it works with no signal. You type "chicken breast," you get chicken breast, not a breaded tender.

**Everything is in grams (or ounces) now, not "servings."** A serving of oats means nothing. 80 grams of oats means something. You pick the unit once and the whole app follows. Old entries were converted where the app could figure it out.

**Recipes got the same treatment.** Weigh the finished dish once, and from then on you log "220 grams of the chili" and the macros come out right. No more guessing what fraction of the pot you ate.

**Run and hike tracking with a GPS route.** It's in the Train tab, it records in the background, and it exports to Apple Health when you're done. The map is deliberately plain — just your route — because I'm not trying to be Strava.

**The tab bar got redone and you can swipe between tabs.** Small thing, feels a lot better.

**The phone now listens for the watch.** More on that below.

## LIFT on Android

**Run and hike tracking landed here too**, with a live recording screen, the route drawn as you go, and export to Health Connect. It keeps recording if you switch apps or the screen goes dark, and the notification can pull a stuck session back if Android gets aggressive about killing things.

**Coach plan links work.** When your coach sends you a week — meals, workouts, or both — you tap the link, the app shows you exactly what's in it, and you accept or decline. Accepted sessions show up in Train on the days they were scheduled for. Nothing gets added to your phone without you seeing it first.

**Conditioning prescriptions.** A routine can now say "row 10 minutes for 2,000 meters at RPE 7," not just sets and reps. Coaches asked for this the first day.

## LIFT on Apple Watch

**Log food from your wrist.** Your recent foods are right there, you set the amount with the Digital Crown, and it syncs to your phone. Built for the moment you're eating and your phone is in the other room.

**And if your phone isn't around at all**, the watch now works on its own. The whole food library is on the watch, so you can search and log with nothing else nearby. When you're back at a computer, the watch shows your log as a series of QR codes, and the web app scans them straight in. That sounds like a strange way to move data around until you remember there's no server to sync through. The QR codes are the sync. I measured it: compressed, a code carries about 80 entries.

## LIFT on the web

**It scans the watch codes.** Open your data on the web app, point your camera at the watch, and your log comes across. It handles multi-code sequences, knows if you're mid-way through when you switch tabs, and shuts the camera off when you leave. If a code is damaged it tells you which one rather than quietly importing half your week.

## COACH on iPhone — this is new

COACH used to be web-only. **This week it became a real iPhone app.**

**The roster and client view.** Paste the link a client sends you and their training and nutrition log lands in your roster. Tap a client and you get training volume, fuel against their goal, bodyweight trend, and per-lift progression — charts, not spreadsheets. Clients who've gone quiet are flagged so you notice.

**The Train tab.** Build a workout from a library of 873 exercises, all offline. Prescribe each set individually — because 225, 225, 245 is a real prescription and "3×5" can't say it. Schedule workouts across a client's week, then send the whole week as a single link. Their LIFT app already knows how to read it.

**The Cook tab.** Write a recipe, or look up its ingredients from the same offline food database LIFT uses — type "chicken breast," pick it, say how many grams, and the macros tally themselves per serving. Type a number yourself and the app never overwrites it; leave a field blank and it stays blank rather than becoming a zero, because a zero would log as a real zero-calorie meal on a client's phone. Plan recipes onto a client's week, flip forward to next week (the Train tab got that too), and the shopping list builds itself from what you planned. You can also pull a dish in by name from TheMealDB and let the app cost what it can weigh — it tells you plainly how many ingredients it couldn't, instead of showing a confident number built from half the recipe. Then send the week as one link, meals and workouts together.

**Backups now carry your whole library**, not just the roster. This was a real bug: every workout template you'd built was missing from every backup the app had ever written, while the app told you a backup was enough. Fixed, and the same fix now reads the web app's backup file too, so if you've been building recipes in the browser you can bring them onto the phone.

## COACH on the web

**Same backup fix, same reason.** The web app's backups now include your recipes, meal plans, workouts, and scheduled sessions. If you use the web version, save a fresh backup — the old ones don't have your library in them.

## Under the hood

LIFT and COACH on iPhone now share one codebase for the things they have to agree on: what a recipe is, what a workout is, what "today" means in your time zone. Before this, each app had its own copy, and a bug we found on the 10th came from exactly that — two apps that each looked right on their own and disagreed with each other about whether a food's macros were per serving. An Android client's two-serving meal was importing at half its calories, silently. Sharing the definitions makes that class of bug a compile error instead of a mystery.

## What's next

Wear OS is the one platform on the list that's still empty. COACH on Android doesn't exist yet. And I own a Garmin now, which turned out to be a genuinely useful way to feed step and weight data into LIFT through Apple Health without writing a line of code — but that's a separate post.

<div class="card" style="border-left:3px solid var(--dcl-accent);">
  <p><strong>Update, 13 September.</strong> Both of those landed the next day, so the paragraph above is out of date and I'm leaving it rather than quietly rewriting it.</p>
  <p><a href="{{ '/coach/install/' | relative_url }}">COACH for Android</a> shipped as 1.0 — the full client roster, plan sending and log import, same as the web version.</p>
  <p><a href="{{ '/lift/wear-install/' | relative_url }}">LIFT for Wear OS</a> also shipped as 1.0, but be warned: it installs by sideload over adb, not by tapping a link. Wear OS has exactly one route onto a watch — the Play Store — and LIFT isn't there yet. You'll need a computer and about five minutes.</p>
  <p>The Garmin post is still owed.</p>
</div>

If you're using any of this and something's wrong, tell me. Everything above was built by one person in a week, and I'd rather hear about it from you than find it in a month.
