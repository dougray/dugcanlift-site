---
layout: post
title:  "Websmith Is Live, And Nobody Pays Rent For A Website"
date:   2026-09-02 10:00:00 -0500
---

For a while now there's been a line in the footer of a few sites I've built that says *Built by Websmith*. It wasn't a link. It went nowhere, because there was nothing behind it. It was a name I'd given the thing I kept doing on weekends, mostly for people at church.

There's a page behind it now: [websmith](https://dougray.github.io/websmith/). Presence and defense, for small business and non-profits.

## An old name, back in service

Websmith isn't new. It's a handle I used a long time ago, back when building sites and picking apart how they break was most of what I did with my time. Then life went other directions, and I set it down.

What I didn't expect is how little of it went stale. DNS is still DNS. Mail records still work the way they worked. Permissions are still the thing everybody gets wrong, and the instinct for *how does someone actually get into this* doesn't expire — it just sits there waiting.

So when people around me started running into exactly those problems, I found out I still had the tools. Old work, quietly still useful, and worth considerably more to a church with a broken newsletter than it ever was to me sitting on a shelf.

Same handle. Pointed at people who need it this time.

## The two ways this usually goes wrong

I've watched small organizations land in one of two ditches, and never really anywhere in between.

The first is getting quoted five figures for a brochure website. Four pages. Service times, an address, a photo, a contact form. There is no version of that job that costs five thousand dollars, let alone fifteen, and the quote is almost always followed by a monthly fee to keep the thing you already paid for online.

The second is the opposite ditch, and it's more common. The entire online presence is a Facebook page that a member's cousin set up in 2016, and the cousin moved to Oklahoma, and nobody has the password. The domain, if there is one, is registered to a personal Gmail account belonging to someone who left the board two years ago. Everything still works right up until the day it doesn't.

Websmith is the middle. Hand-built sites, no page builder, no template shared with ten thousand other churches, and hosting that costs nothing to run because a static site doesn't need a server.

## The half nobody sells you

Presence is the part people know to ask for. Defense is the part that actually bites them.

Here's the one I run into most: an organization sends its newsletter, and half of it goes to spam. They assume the content is the problem. It isn't. Nobody ever set up SPF, DKIM, or DMARC on the domain — the three records that tell the rest of the internet which servers are allowed to send mail as you. Without them your mail is suspicious by default, and worse, anyone in the world can send a fundraising appeal with your name on it and it'll land looking legitimate.

That's a thirty-minute fix that no one had ever offered them.

The rest of it is the same flavor. Multi-factor on the accounts that matter. Backups that somebody has actually restored once, rather than backups that are merely scheduled. Permission audits. And a written inventory of what you own — domains, registrars, logins, renewal dates — so nothing walks out the door when a volunteer moves away.

That last one isn't technical at all, and it's the one that saves organizations the most grief.

## And Discord

A lot of communities don't live on a website anymore. They live in a Discord server that got set up in an afternoon and then never touched again, which is how it becomes both a maze and a liability.

So that's on the page too: building and redesigning servers — structure, roles, permissions, onboarding, branding that matches the website — and managing them afterward. Auto-moderation and raid protection, permission audits, scam-link filtering, and a written playbook so volunteer mods handle problems consistently instead of improvising at midnight.

Same two halves. Different surface.

## How the page itself is built

Same way as everything else I put out, and for the same reasons.

One HTML file. All the CSS inline. No JavaScript, no build step, no dependencies, no database, no framework. The whole thing is smaller than one of the photos on most agency sites. It loads instantly on a bad rural connection, which matters more than it sounds like it does when your congregation is spread across a county.

There's nothing to patch, so there's nothing to break at two in the morning. That's not minimalism for its own sake — a site with no plugins has close to zero attack surface, and the cheapest security posture available is *not having the thing that gets exploited*.

If that sounds familiar, it's the same argument as [Coach](/coach/) having no server. The safest place to not leak your data is a place that never had it.

The logo's an anvil built out of falling binary, which is about as on-the-nose as I'm capable of being, and I like it.

## The honest part

Two things, because I'd rather you hear them from me.

**Security work reduces risk. It does not eliminate it.** Anyone who tells you a website is "secure" full stop is selling something. What I'll do is tell you plainly what each change protects against and what it doesn't, in writing, in words you can hand to a board.

**Websmith is one person.** This is not a firm and there's no 24/7 monitoring desk behind it. If you need an incident response retainer, I'll tell you that and point you elsewhere. What I'm good at is the gap between "nothing" and "an agency that won't return your calls" — which is where most small organizations actually live.

And a third one, at my own expense: Websmith sells email authentication and currently runs off a Gmail address. That's fine for a contact address, but the domain-and-DMARC treatment is on my own list too. Physician, heal thyself.

## What it costs

Quoted per job. No published tiers, because every organization starts somewhere different — some need a first website, some need a rescue, some just need the newsletter to stop landing in spam. Tell me what you've got and what isn't working, and you get a flat number before any work starts. No hourly surprises.

Non-profits and ministries get non-profit rates. That's the whole reason the thing exists.

## Go look

[websmith](https://dougray.github.io/websmith/) — services, the work so far, and how to reach me. The sites on it are all live and all real: a rural Methodist church, a devotional podcast with a searchable archive of 1,400-plus episodes, and this one you're reading right now.

If you know a small organization stuck in either ditch, send them the link. Or send them my email — **websmithtx@gmail.com** — and tell them a few sentences is plenty.
