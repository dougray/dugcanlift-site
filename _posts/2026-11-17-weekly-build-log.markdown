---
layout: post
title:  "Weekly Build Log: Ham Radio, Twenty Levels and an Open Door for Android Testers"
date:   2026-11-17 00:30:00 -0600
---

A lot shipped this week, across a survival app, three pirate games and a wardriving tool.
Here's the whole week in one place: what's out, what's in testing, and what I haven't
proven yet.

## Pocket Nomad: ham radio

A user asked for ham radio in **[Pocket Nomad](https://www.pocketnomad.us/)**, so that's the
headline. The Radio tab now has two sides, **Mesh** and **Ham**. Pair a Bluetooth KISS TNC, or
a radio with one built in, and the phone becomes a small packet station.

**If you don't have a licence, it only listens.** You still see everything the radio hears:

- APRS stations, objects and weather reports, with distance and bearing
- APRS messages and bulletins
- Stations on the offline map
- A live packet monitor

**If you're a licensed ham,** add your callsign in Station settings and it unlocks:

- **Winlink email** through an RMS packet gateway, with no internet on your end
- **APRS messaging** with acknowledgements and retries, plus position beacons
- A **packet terminal** for BBSes, nodes and keyboard-to-keyboard connects

Without a callsign the app refuses to transmit. That rule lives in the code, not just in a
hidden button.

**The honest part:** this is tested against the protocol references, including a byte-for-byte
match on Winlink's compression, and against simulated radios and a scripted gateway. It has
**not** been on the air with a real radio yet. That's the next test, and if you own a TNC and
want to beat me to it, I'd love the bug reports.

Also in Pocket Nomad this week:

- **Your own radios stay off the map.** The map now shows the radios and repeaters you hear,
  not a trail of where you drove. Tap any radio and mark it as yours to hide it for good.
- **The big radio list no longer eats memory.** One community map grew to 56 MB. Both apps now
  read it a piece at a time and keep only what's near you.

Android 0.6.0 beta is out now. The iPhone build is uploaded and heads to TestFlight once
Apple's beta review clears it.

## Jolly Rogue: twenty levels and rope swings

**[Jolly Rogue](https://reefrunner.us/)** grew from eight levels to **twenty**, and the pirate
can now swing across gaps on ropes. It's live to play in the browser. The iPhone version in
review is still the older eight-level build; the big one follows.

## Cloud Dancer: reasons to come back

Cloud Dancer is live on iPhone and Apple TV. Behind the scenes, the next update is built:
Game Center leaderboards, a **Daily Flight** that's the same for everyone each day, and a
trophy case of feats to chase. It isn't released yet. The same kit is now being fitted to
Jolly Rogue and Reef Runner.

## WarWalker: iPhone app and a pocket scanner

WarWalker, the walk-around Wi-Fi survey tool, picked up an iPhone app and a small
Raspberry Pi scanner that feeds it. That work is merged, and the Android version is in closed
testing on Google Play. Parts for the scanner are on order, so the hardware test comes next.

## Android: one link to test everything

This is the one I'd most like help with. Every Android app I make is now in closed testing on
Google Play, and **one free group opens all of them**:

**[Join DugCanLift App Testers](https://groups.google.com/g/dugcanlift-app-testers)**

Join the group, and you can install any or all of them from Google Play: Pocket Nomad,
Reef Runner, Jolly Rogue, Cloud Dancer, WarWalker, LIFT and Coach. Google requires a dozen
testers for two weeks before an app can go public, so every person who joins and keeps an app
installed moves these closer to a real release. Bug reports and feature requests go right in
the group. The ham radio feature started as exactly that kind of request.

## Under the hood

Every project now builds and tests itself automatically on each change, with checks for
leaked secrets and known-vulnerable dependencies. It's invisible when it works, which is the
point: this week it caught a vulnerable image library before it shipped.

## Next week

- Put Pocket Nomad's ham radio on the air with a real radio
- Finish the leaderboard-and-daily kit for Jolly Rogue and Reef Runner
- Recruit testers (that's you, if you have an Android phone)

Fair winds.
