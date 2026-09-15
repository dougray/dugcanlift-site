---
layout: post
title:  "What To Do After An Update"
date:   2026-09-14 16:45:00 -0500
---

Short answer for the browser version: **open it twice.** Don't reinstall it — on a phone that deletes your log.

The longer answer is that LIFT reaches you four different ways depending on what you're using, and they update on four different schedules. This is the page to check when something I've written about doesn't seem to be there yet.

## The browser version: open it twice

LIFT in a browser keeps a copy of itself on your phone so it opens in a gym with no signal. That copy is what updates, and it does it on its own — but not instantly, and the way it lags is confusing enough to be worth spelling out.

**First time you open it after I've shipped something,** your phone quietly notices there's a new version, downloads it in the background, and puts it in place. Meanwhile it shows you the one it already had. So the first open looks like nothing happened.

**Second time you open it,** you get the new one.

That's it. Close it and open it again. On an iPhone, swipe it away from the app switcher first — iOS is lazy about this and a proper quit makes it reliable.

### Please don't delete it and add it back

This is the important part. It looks like the obvious fix and it's the one thing that actually costs you something.

The browser version has no server behind it. Your food log, your workouts, your weight history — all of it lives in your phone's own storage, attached to that installed app. Deleting it deletes them. There's no account to log back into and nothing to sync down, because there's nothing up there.

If you've been meaning to save a backup anyway, Connect → **Save a backup file** takes a second and is worth doing regardless. But you shouldn't need it to get an update.

### How to tell you're on the new one

Look for the thing I said changed. If I've written that food is now logged in grams and your Add food form still says Servings, you're on the old copy — open it again.

## The Android apps: download and tap it

LIFT and Coach for Android don't update themselves. They're not in the Play Store, so nothing is watching for a new version on your behalf. When I ship one, you go back to [the install page](/lift/install/) or [the Coach page](/coach/install/) and download it again.

**It installs straight over the top.** Same signing key every time, which is the thing that lets Android treat it as the same app rather than a different one. You don't uninstall first, and you don't lose your log or your roster. Android will warn you about installing a file it can't vet, same as the first time.

If Android ever refuses the install and says something about a conflicting package, that means the signing key didn't match — that would be my mistake, not yours. Tell me and don't force it by uninstalling.

## The Apple Watch and Wear OS

The watch apps come from their phone app, not from here. Update the phone app first and the watch follows.

Wear OS is the exception: it's a separate sideload from [its own page](/lift/wear-install/), because a Wear app can't be delivered inside an Android app the way an Apple Watch app is delivered inside an iPhone one. Same rule as the phone — download, tap, it goes over the top.

## The iPhone app

Nothing to do, because you almost certainly don't have it.

The iPhone app is real and it runs, but it's signed with a free Apple account, which means it installs on my phone and nowhere else. It has never been near App Store review. Everyone else on an iPhone is using the browser version, which is the one this post opens with.

## Why none of this is automatic

All of it comes down to the same decision: none of these are in an app store yet. That's deliberate while the apps are still being built — a fix I write in the morning is on your phone by lunchtime instead of sitting in a review queue for a week. Two opens of a browser tab is the price of that, and it's a price I'll keep paying for now.

When they do go to the stores, updates become somebody else's problem and this page becomes history.
