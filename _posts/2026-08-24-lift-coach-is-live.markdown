---
layout: post
title:  "LIFT Coach Is Live, And Nothing Gets Uploaded"
date:   2026-08-24 13:00:00 -0500
---

Every time I've talked about LIFT here, it's been about one person: you, your food log, your training, your numbers on your phone. But a lot of people who track this stuff aren't tracking it alone. They've got a coach, and that coach spends Sunday night squinting at screenshots.

So I built the other half. It's called LIFT Coach, it's live at [dugcanlift.com/coach](/coach/), and it's free.

## What it actually does

LIFT Coach is a dashboard for trainers whose clients use LIFT. Your clients send their training and eating from the app; Coach collates it into a roster you can read on a Monday morning and tell at a glance who's gone quiet.

The **roster** lists everyone you coach, quietest first — sessions, sets, volume against last week, average calories against their target, and how often protein actually landed. Anyone who hasn't logged in a week floats to the top with a banner, because that's the client who needs a text, not the one who hit all their macros.

Tap someone and you get the **whole picture**: week-by-week training and fuel, volume trend, calories and protein against goal, bodyweight, estimated 1RM progression per lift, and every session expandable right down to the individual set. Not a summary of their week. Their week.

## The part I care about most

There is no server. There is no account. There's no sign-up for you and none for your client.

I want to be specific about that, because "we don't sell your data" is a thing every app says and most of them are lying by omission.

Here's the whole path a log takes. Your client taps **Send to Coach** in LIFT. Their mail app opens, already addressed and already written — they just hit Send. You get an email titled "LIFT log from …" with a button and a seven-day summary. You tap the button, and their log opens in Coach.

The trick is where the data rides: inside the link itself, in the part after the `#`. Browsers never transmit that part to a server. Ever. It's in the spec. So even though `/coach/` is served off GitHub Pages like the rest of this site, the training data goes from your client's phone, through your mail provider, to your browser — and dugcanlift.com never sees a byte of it. What lands in Coach stays in that browser's local storage, on that device.

Eight weeks of daily logs comes out around 4 KB. It fits in an email because it's small, and it's small because it was designed to survive being an email.

Two honest caveats, since I'd rather you hear them from me:

**Your roster lives in one browser.** Clearing site data wipes it. That's the direct cost of having no account to log back into. There's a *Save a backup file* button under Connect for exactly this reason, and you should use it.

**Your client has to hit Send themselves.** I can't send the mail silently — that would mean either running a mail server or asking for their email password, and I'm not doing either. So the last tap is theirs, in their own mail app, where they can see exactly what's going out.

## Setting a client up

Once per client, and then never again. Go to **Connect**, put in your name and the address logs should come to, and hit *Copy invite*. Send them the text it writes for you. They paste your address into LIFT's Coach card once, and from then on it's one tap on their end.

Right now the send button is in the **web version** of LIFT at [dugcanlift.com/lift](/lift/) — works on any phone, add it to your home screen. The Android and iOS apps have the same feature built and waiting; it ships with their next release. Coach itself needs a reasonably current browser to open links (Safari 16.4+, Chrome 103+); anything older gets a clear message instead of a blank screen.

## While I was at it: both apps finally look different

Small thing, real problem. LIFT and Coach both used the DUGCANLIFT wordmark for an icon, which meant any trainer running both ended up with two identical squares on their home screen. So LIFT says LIFT now, and Coach says COACH.

<figure style="display:flex;gap:1.25rem;justify-content:center;align-items:center;margin:2rem 0;flex-wrap:wrap;">
  <img src="/lift/icon-512.png" alt="The LIFT app icon" style="width:150px;max-width:40%;height:auto;border-radius:22%;">
  <img src="/coach/icon-512.png" alt="The LIFT Coach app icon" style="width:150px;max-width:40%;height:auto;border-radius:22%;">
</figure>

That turned out to be more work than "delete some letters." The wordmark sits *on top* of the cross, so pulling it off cut both arms of the emblem clean in half — and there's no vector original anywhere, just PNGs going back to whenever I made the thing.

What saved it is that a Maltese cross has four-fold rotational symmetry. The top arm is fully visible, and rotated ninety degrees it lands exactly where the side arms are missing. So the cross on those icons isn't a redraw or a trace — it's the original artwork, repaired with a rotated copy of itself. The wordmark font, for anyone who cares, turned out to be plain unmodified Impact; a test render matched the original to within about one percent.

The Android and iOS icons got the same treatment, keeping their crimson backgrounds. Those reach you through a store release rather than a page refresh, so give them a minute.

## Go break it

If you coach anyone, [open Coach](/coach/) and hit *Load a sample client* — you'll see the whole thing working with fake data before you ask a single real client to do anything. When you're ready to set it up properly, [the setup page](/coach/install/) has the install steps for phone and desktop and a breakdown of what each version of LIFT can send you.

If you're the one being coached, the send button is live in [the web app](/lift/) today.

And if you find something broken, tell me. It's all [open source](https://github.com/dougray), and this is the first version anyone but me has ever used.
