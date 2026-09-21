---
layout: post
title:  "Big Screens, Both Sides, and a Week of Small Fixes"
date:   2026-09-20 20:30:00 -0500
---

A weekend of work across all six apps. The two big ones: LIFT and Coach now use
the whole screen on a tablet, and a single-arm lift can finally be logged as
left and right. The rest is the sort of thing you only find by using an app on
a real device — a shopping list printing `416.66666666666663 g`, a search that
zoomed the page out, a restore that crashed.

## Everything fits the screen it is on

LIFT and Coach were phone apps that happened to run on bigger screens. Now each
of the six builds lays itself out by how much room it actually has.

**On an iPad, an Android tablet, an unfolded foldable, or a browser window,**
the tabs become a sidebar, cards sit two or three across instead of stacked, and
Cook's week shows all seven days at once instead of one long list. In Coach, the
roster sits beside the client you have open, so switching clients is a tap
rather than a trip back.

**Nothing about it checks what device you own.** It is all measured width. An
iPad in a narrow Split View window is a phone as far as the app is concerned,
and gets the phone layout. Turn an Android phone sideways and it gets the wide
one. That also means a foldable is handled without anyone having to special-case
foldables.

**Phone screens are pixel-identical to before.** Not "basically the same" —
compared screenshot against screenshot, at every view, in light and dark. The
only differences are the two bugs found doing it.

## Left and right, at last

A Bulgarian split squat is six sets, three per leg, and every app in existence
records it as six sets of nothing in particular. So you cannot answer the one
question worth asking: **is my weaker side catching up?**

Now each lift has a **Left and right separately** switch. It is already on for
the ones whose names say so — single-arm, one-leg, split squat, lunge, pistol —
and you can turn it on for anything. With it on, logging a set costs one extra
tap: `L` or `R`, already set to whichever side has fewer sets today, so it
alternates on its own. The header reads `L 3 · R 3`, so a missed side is
obvious, and the second side pre-fills from the first.

**Progression then charts each side on its own line**, with how far apart they
are and whether the gap is closing:

> **Right ahead by 5%**
> Mean estimated 1RM of the last 3 sessions each · gap closing

**What it will not do is tell you what that means.** No target, no colour, no
warning. A 10% difference is ordinary in most people, and an app that decides
what yours means is guessing about your body. It shows the number and the
direction; you and your trainer do the rest. Same rule as saturated fat, sugar
and sodium: tracked and shown, never targeted.

If you send your log to a coach, they see the same split, with the same figure
worked out the same way — the maths is one implementation ported to the other
five apps, not six apps each doing their best.

**Nothing you have already logged changes meaning.** A set with no side is a
two-sided set, forever, and a lift you have always logged normally looks and
charts exactly as it did.

## Coach: removing a client

Coach's privacy policy said you could remove a client. Only the browser version
actually could. Now iPhone and Android can too, and all three do the same
thing: ask first, name the client, and say exactly what goes — their logged
days, and the meals and sessions you planned for them.

That last part was its own bug. Removing a client used to leave their planned
meals and booked sessions behind, invisible in the app but still sitting in
every backup file you made afterwards.

## Fixes

**Typing an exercise name zoomed the page out.** On the website and the
installed app, searching for an exercise made the page wider than the phone, so
the browser shrank everything to fit and left it shrunken until you pinched it
back. Long exercise names — "Bent Over Dumbbell Rear Delt Raise With Head On
Bench" — were being drawn as one unbroken line. Coach had the same bug waiting
in its ingredient search. Both fixed.

**Restoring a backup could crash LIFT on Android.** A food logged without a
gram amount — which the browser version can write — turned into an impossible
number that killed the restore. Every number read from a backup is now checked,
not just that one.

**The shopping list did arithmetic out loud.** One serving of a three-serving
recipe asked for `416.66666666666663 g` of potatoes. It says `416.67 g` now.

**Android stopped asking for "Allow all the time" location.** Recording a run
never needed it: the recording keeps going with your phone locked because it
runs as a proper foreground service. One fewer alarming permission prompt.

**Health Connect explains itself before asking.** LIFT used to open the steps
permission box on first launch with no explanation. Now the Steps card says what
it reads and why, and you tap a button when you want it.

**Sending your steps to a coach is now a choice**, off by default, and the Send
to Coach card lists exactly what the email will contain before you send it.

**A plan from your coach asked twice.** Accepting one, then changing your
theme or display size, made the "Plan from Coach" box reappear. It asks once.

## Where to get it

- **The browser versions are live now** at [LIFT](/lift/) and
  [Coach](/coach/) — nothing to install, and the layout changes are already
  there.
- **LIFT for Android 1.9** and **Coach for Android 1.6** are on the
  [install page](/lift/install/).
- **iPhone and iPad** builds carry all of the above; they are not on the App
  Store yet.

If you already have an Android build installed, [what to do after an
update](/2026/09/14/what-to-do-after-an-update.html) still applies.
