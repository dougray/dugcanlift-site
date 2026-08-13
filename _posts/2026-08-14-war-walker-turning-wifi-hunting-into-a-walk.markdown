---
layout: post
title:  "WarWalker: Turning Wi-Fi Hunting Into A Walk"
date:   2026-08-14 09:00:00 -0500
---

Every step tracker I've ever used has the same problem: the walk itself has to be its own reward. Some days that's enough. Some days I need an actual reason to leave the house, not just a ring that wants closing.

So I built myself one: WarWalker.

## What it actually is

WarWalker is a wardriving app disguised as a fitness app, or maybe the other way around — I'm honestly not sure which came first anymore. You start a walk, and it scans the Wi-Fi and Bluetooth networks around you as you go, tagging each one with your location. When you stop, it checks your step count against Health Connect — so the walk has to be real, not just your phone sitting on a desk — and uploads the whole session straight to WiGLE, the crowdsourced wireless-network mapping project that's been running since long before "wardriving" needed explaining to anyone.

Points are steps times access points discovered, so standing still gets you nothing and neither does driving. You have to actually walk, and the more networks in the area, the more it's worth doing on foot instead of rushing through. It turns "I should get my steps in" into "how much of this neighborhood haven't I mapped yet," which is a much easier sell to myself at 6am.

## Same rules as LIFT

If you read my post about LIFT, this is going to sound familiar, because I built it the same way and for the same reasons:

- **No account beyond what you already have.** WarWalker isn't a platform — it's a client. You bring your own WiGLE account (free, same one wardrivers have used for years) and WarWalker talks straight to WiGLE's API. There's no WarWalker server sitting in between, logging anything.
- **Nothing leaves your phone except what you're actually trying to upload.** Your credentials are encrypted on-device. No ads, no analytics, no crash reporting, no tracking of any kind.
- **Open source, GPL-3.0.** Every claim in this post is checkable in the actual code, not just something I'm asserting.

Full breakdown of what's collected and what's sent to WiGLE (and it's worth reading before you start uploading network data anywhere) is in the [privacy policy](/war-walker/privacy/).

## Where it stands right now

This one's earlier in its rollout than LIFT. Right now the source is public and the app builds and runs — I've walked real routes with it, mapped real networks, watched the streak counter tick up. It's not on Google Play or F-Droid yet; that's the active work right now, not a someday-plan. Android and Android Wear only for the foreseeable future — no iPhone version, since Wi-Fi/BLE scanning access on iOS doesn't really allow for what this app needs to do.

A couple of things are deliberately not built yet rather than broken: there's no time-limited community events board, and no neighborhood-level leaderboard beyond WiGLE's own global stats. Both are on the list. Neither was worth blocking a real release over.

## Why bother

I lost 180 pounds the unglamorous way — showing up, most days, whether or not I felt like it. WarWalker isn't a replacement for that; it's a side quest that happens to require the same thing training does: leave the house and move for a while. Some days the motivation is the workout. Some days it's "I wonder what's three streets over that I haven't scanned yet." I'll take either one, as long as I'm walking.

More here once it's actually in a store instead of just a repo.
