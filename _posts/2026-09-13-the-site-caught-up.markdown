---
layout: post
title:  "The Site Finally Caught Up With The Apps"
date:   2026-09-13 13:00:00 -0500
---

I spend nearly all of my time on the apps and almost none on the site that explains them. That gap got wide enough this week that the site was quietly lying to people, so I stopped and fixed it. This is a boring post about menus and headings. It's also the kind of thing that decides whether someone finds what they came for or gives up.

## The site was describing an app I no longer have

The worst of it: **there was nothing anywhere about the watch apps.** Not a word. LIFT has run on an Apple Watch for a while and now runs on Wear OS too, and if you'd come to this site looking for that, you'd have concluded it didn't exist.

The Coach page was worse in a subtler way. It described Coach as a thing you run in a browser tab — which was true when I wrote it, and is now about a third of the story. There's a native Android Coach and a native iPhone Coach. The page also told you, flatly, that your roster "lives in your browser" and that clearing your browser data would wipe it. Still true in a browser. Not true in the apps, which keep their own storage and don't care what you clear.

And under a section headed "Coming: meal plans you send back," it said the Coach half of that wasn't built yet. It's been live in the browser version this whole time. My own COOK page said so. Two pages on the same site disagreeing about whether a feature exists is not a great look.

All of that is fixed. There's a section on the watch apps that explains how getting the log off a watch actually works — it draws a QR code and you scan it with the web app, which sounds primitive and is, deliberately. There's a section on each native Coach. And there's a table at the bottom of the Coach page comparing all three side by side, because "which one should I use" turned out to be a question the page never answered.

I'll say the uncomfortable part plainly: **the two native Coach apps aren't installable.** No signing for the iPhone one, and the Android one only just got its release key today. They're written and they run and you can't have them yet. The table says "No" in those cells rather than something softer, because you should be able to tell in three seconds which one you can actually use, and it's the browser one.

## The menu was chaos

The header carried eight items. Among them: "Join," "For Coaches," "Macro Calculator," "Supplement Price Tracker." Some were products, some were actions, some were descriptions, and the order came from a config file I'd appended to every time I added a page.

It's five now, and they're all the same kind of thing:

> LIFT · Coach · COOK · Calculator · About

Every link lives in the footer instead, grouped so you can scan it. The footer wasn't a superset of the header before — it was a *different* list, missing COOK and both install pages while carrying links the header didn't have. So depending on where you looked, the site had two different maps of itself.

Coach sits second because it's the thing I most want a trainer to find.

## Every page had two titles

This one I'd been walking past for months without seeing it.

The theme prints the page's title as a heading at the top. Most of my pages also open with their own big heading. So the Coach page said "For Coaches" in small text, and then immediately said "SET UP LIFT COACH" underneath it. Nine pages did some version of this, including both privacy policies, which had been doubled up since the day I wrote them.

It looks like a breadcrumb, which is why I never questioned it. It isn't one. It's a second top-level heading, and a screen reader announces it as one, and search engines read it as the page's real title. Every page has exactly one now.

## A table that didn't fit a phone

The new comparison table overflowed its box by thirteen pixels on a phone screen.

Thirteen is the worst possible number. Enough to clip the last column and make you drag sideways, not enough to look like it was meant to scroll. My first instinct was to cut the wording down, so I did — and it changed nothing, because the width wasn't coming from the words. It was coming from the padding inside each cell: about sixteen pixels a side, times four columns, times two sides, is roughly a third of the usable width of a phone gone before a single character is drawn.

Tightened the padding on small screens and it fits exactly. The table also went from about 1,270 pixels tall to 840, so it's a third less scrolling. I kept the shorter wording too — a comparison table reads better when the row labels are short anyway.

## Every product page has the same table now

The Coach page got a comparison table first, then the LIFT page, and COOK was the one still describing itself in paragraphs. It has two now — one for using COOK inside LIFT, one for using it inside Coach — because five different things run COOK and a single table would have needed six columns and been half empty. A coach never logs a cooked meal. Someone eating never sends a week to a client.

The rows are the boring ones on purpose: can you install it today, can you write recipes, does the shopping list scale, can you open a plan a coach sent you. That last row is the one that caused trouble.

## The table caught the site lying

Both the COOK page and the LIFT page said the phone apps could open a coach's plan link. The LIFT page had it as three ticks in a row — browser, Android, iPhone, all yes.

The code agreed with them. The Android app has the whole import path written: the link is registered, the app decodes it, you get a preview, you accept, it lands. I could have stopped there and shipped the table.

Then I pulled apart the actual APK the install page hands out. It was cut on the 2nd. The intent filter landed on the 8th. The file people were downloading had no idea plan links existed — the classes weren't even in it.

The iPhone one is worse and quieter. It has the code too, but a universal link needs a file served from this site vouching for the app, and this site serves no such file. The free Apple signing the app is built with couldn't register one if it did. So that column was never going to be a tick, no matter what the source said.

Two pages, three cells, all confidently wrong. Nobody had complained, because the people who'd have noticed are the ones who tapped a link, watched it open a browser tab, and assumed that was how it worked.

## So I shipped the build instead of softening the row

The honest fix was to write "no" in the Android cell. The better fix was to make it a yes, which meant cutting **LIFT 1.3** — the first Android build that can take a plan link.

It's on the install page now. Same signing key as 1.2, so it installs straight over the top and your log stays put. It also carries everything else that piled up since September 2nd: GPS runs and hikes that export to Health Connect, gram-based food entry, and the shared code the watch and the phone now both use.

I tested it the way I should have tested the claim in the first place — installed it on a phone, asked the system whether it really trusted the app with dugcanlift.com links (it did), and fired a real plan at it. Two recipes, four meals, two workouts. It previewed them, I accepted, and they were sitting in the Cook tab. The iPhone cell still says no, and now it says no for a reason I can point at.

While I was in there I found the unit tests hadn't compiled in days — a type had moved into the shared kit and two test files never got the memo. Nothing was broken in the app. The safety net just wasn't plugged in, and I didn't know because I'd stopped looking at it.

## Why bother writing this up

Because it's the unglamorous half of the work and it's easy to skip. Nobody opens a changelog hoping to read about heading levels. But a site that says an app doesn't exist when it does, or contradicts itself two pages apart, costs more than a missing feature does — the person just leaves, and you never find out why.

The rest of the app work this week is a separate post. This one was mostly me admitting the front door needed painting — and finding, while painting it, that one of the signs on it was pointing the wrong way.
