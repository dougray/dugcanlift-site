---
layout: post
title:  "Road Food, and a Day of Polish"
date:   2026-09-21 23:30:00 -0500
---

One new feature and a long list of small things. The new feature is for the
days you are eating off an interstate exit. The small things are the kind you
only notice by living with an app: a question asked every time you open it, a
screen that ignored your phone going dark, a percentage that came out one
tenth different on one app out of six.

## Road Food

LIFT already knows how many calories and how much protein you have left today.
Road Food answers the question you actually have in a drive-thru line: *what
can I get here that fits?*

Open **Food**, tap **Road Food**, and pick where you are stopping — one of the
chains, or **Gas station** for the snacks by the register.

<figure style="margin:1.5rem 0;text-align:center;">
  <img src="/assets/images/blog/2026-09-21/road-food-picker.png" alt="The Road Food screen in LIFT on an iPhone: a Gas station entry listing jerky, protein bars and Greek yogurt, then a list of chains, each showing how many items it has and the date its numbers were checked" style="width:100%;max-width:360px;height:auto;border-radius:10px;">
  <figcaption style="font-size:0.9rem;opacity:0.75;margin-top:0.4rem;">Pick where you are stopping. Every chain shows the date its numbers were checked.</figcaption>
</figure>

Each chain's list is **ranked against what you have left**: the items that fit,
with the most protein per calorie first and lower sodium breaking a tie. Anything
more than 10% over what is left is left off the list, and the few that are only
a little over get a short list of their own, because at 9 pm "a little over" is
often the honest choice. One tap logs it as breakfast, lunch, dinner or a snack.

<figure style="margin:1.5rem 0;text-align:center;">
  <img src="/assets/images/blog/2026-09-21/road-food-chick-fil-a.png" alt="Chick-fil-A in Road Food: a line reading Fits your remaining 2760 kcal and 148 g protein, then grilled nuggets and a grilled filet at the top of the list, each with its calories, protein per 100 kcal and sodium, and a Log it button" style="width:100%;max-width:360px;height:auto;border-radius:10px;">
  <figcaption style="font-size:0.9rem;opacity:0.75;margin-top:0.4rem;">Ranked against today, with the numbers you need to decide and a one-tap log.</figcaption>
</figure>

What it covers today: **Wendy's, Sonic, Chick-fil-A, Popeyes, Subway,
Starbucks, Panera and QuikTrip**, plus gas station staples — jerky and meat
sticks, protein bars, Greek yogurt, string cheese, hard-boiled eggs, tuna and
chicken pouches, nuts and protein shakes — and a short list of ordering rules
that stay true when a menu changes: grilled over fried, sauces on the side,
double the protein instead of a bigger bun.

A few rules it holds to:

- **The numbers are each chain's own published nutrition**, entered by hand,
  with the date they were checked on screen. A chain whose numbers are more than
  six months old says so in words.
- **It works with no signal.** The whole list ships inside the app, because the
  interstate is exactly where signal drops.
- **It never asks where you are.** You pick the chain; LIFT does not watch where
  you drive. No new permission, and nothing leaves your phone.
- **Sodium is shown, not scored.** Road food is salty and the number is worth
  seeing, but it only breaks ties — the same "tracked and shown, never targeted"
  rule saturated fat and sugar follow everywhere else in LIFT.

Numbers go stale when menus change, so every quarter a script checks each
chain's published nutrition against what the app carries and reports anything
that moved. It never edits the list on its own. A person reads the report and
updates it, because a wrong number in your day is worse than an old one you can
see is old.

## The same words in every app

When the last update added left-and-right logging, LIFT said "7% —
right stronger" while Coach said "Right ahead by 7%". Same number, worked out
the same way, described two different ways — which is exactly the kind of thing
that makes a lifter and their coach wonder whether they are looking at the same
thing.

Now all six apps use one sentence: **"Right ahead by 5%"**, or **"Sides
level"**, and underneath, what it was measured over and which way it is going.

<figure style="margin:1.5rem 0;text-align:center;">
  <img src="/assets/images/blog/2026-09-21/sides-wording.png" alt="A lift's progression in LIFT on an iPhone: two lines, left and right, and under them a card reading Left ahead by 5.6%, Mean estimated 1RM of the last 3 sessions each, gap closing" style="width:100%;max-width:360px;height:auto;border-radius:10px;">
  <figcaption style="font-size:0.9rem;opacity:0.75;margin-top:0.4rem;">The same sentence you see here is the one your coach sees.</figcaption>
</figure>

Getting there turned up one real disagreement. On a figure that landed exactly
on a half — 150 against 160 is 6.25% — Coach for Android printed 6.2% and every
other app printed 6.3%, because two programming languages round a half in
different directions. It prints 6.3% now. And on Android, a lift without enough
sessions yet no longer tells you the per-side counts twice.

## Small fixes

**LIFT on iPhone stopped asking for Apple Health every time it opened.** It asks
once. After that, the Apple Health row in Settings tells you where to change
your answer, and nothing else asks again. Saving a run to Health no longer
ends in a "Couldn't save" alert when you have said no.

<figure style="margin:1.5rem 0;text-align:center;">
  <img src="/assets/images/blog/2026-09-21/health-asked-once.png" alt="LIFT's Settings on an iPhone: the Apple Health section says Lift has asked already, so iOS won't ask again, and explains where to turn access on in Settings, with an Open Settings button" style="width:100%;max-width:360px;height:auto;border-radius:10px;">
  <figcaption style="font-size:0.9rem;opacity:0.75;margin-top:0.4rem;">Asked once, then out of the way.</figcaption>
</figure>

**An iPad no longer calls itself an iPhone.** "Everything you log stays on this
iPhone" is now "this device", along with the restore messages and the email
error.

**Train finally matches the other tabs.** It was the one screen drawn on plain
system white — or black — instead of LIFT's own cream and charcoal. You could
see the seam on an iPad, where the sidebar sits right beside it.

<figure style="margin:1.5rem 0;">
  <img src="/assets/images/blog/2026-09-21/ipad-train.png" alt="LIFT's Train tab on an iPad in landscape: the sidebar and the workout share the same cream background, with the day's lifts on the left and Outdoor and Personal bests on the right" style="width:100%;height:auto;border-radius:10px;">
  <figcaption style="font-size:0.9rem;opacity:0.75;margin-top:0.4rem;">Train on an iPad, on the same background as the sidebar beside it.</figcaption>
</figure>

**Screens opened from Train now follow light and dark.** Switch your iPhone to
dark with a lift's progression open — or open one afterwards — and it used to
stay light until you quit LIFT. It follows the switch now, chart and all.

<figure style="margin:1.5rem 0;text-align:center;">
  <img src="/assets/images/blog/2026-09-21/progression-dark.png" alt="The same lift's progression in LIFT on an iPhone in dark mode, with both lines and the Left ahead by 5.6% card on a charcoal background" style="width:100%;max-width:360px;height:auto;border-radius:10px;">
  <figcaption style="font-size:0.9rem;opacity:0.75;margin-top:0.4rem;">The same screen in dark, which it now switches to and from while open.</figcaption>
</figure>

## Where to get it

- **The browser version of LIFT is live now** at [LIFT](/lift/), Road Food
  included, with the new wording.
- **LIFT for Android 1.11** and **Coach for Android 1.7** are on the
  [install page](/lift/install/). Road Food arrived in LIFT 1.10 earlier today;
  1.11 brings the new wording. The Android counts fix is in the next release.
- **iPhone and iPad** builds carry everything above; they are not on the App
  Store yet.
