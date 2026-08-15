---
layout: post
title:  "A Whole CTF In A Bag"
date:   2026-08-15 09:00:00 -0500
---

I've got a little handheld PC I bought on a whim — a Higole mini PC, about the size of a paperback, with a touchscreen on the front and a battery inside. I've mostly used it as a bad tablet. I played a lot of chess on it in airports.

Last week I looked at it again and thought: that's a server. That's a whole server with a screen and a battery, and it's sitting in a drawer.

So now I'm turning it into a portable capture-the-flag competition.

## What I'm actually building

The idea is that I can walk into a tech meetup or a conference with one bag and run a real CTF out of it. Not a link to something hosted in the cloud — the whole thing. Scoreboard, challenges, wifi, all of it, running on a box I can hold in one hand.

You plug it in, it boots straight into the scoreboard, and people join a wifi network I brought with me and start solving things. No internet required at any point. That last part isn't me being dramatic; venue wifi is a coin flip on a good day, and the moment your CTF depends on it you've built a demo that fails in front of an audience.

The scoreboard is [CTFd](https://ctfd.io/), which is the open-source platform most CTFs already run on. Everything else — the challenges, the deployment, the backups, the network setup — is what I'm putting together around it.

## The decisions that actually mattered

My first instinct was to build it the way I build everything in my homelab: Proxmox on the bottom, a VM on top, Docker inside that. It's a good pattern and I use it constantly.

It's the wrong pattern here, and the reason is storage. This thing stores everything on eMMC — the same kind of flash memory that's in a phone, not a real SSD. It's slow at exactly the kind of writing a database does, and it wears out. Proxmox writes to its config database constantly, all day, forever. Running it on eMMC is a good way to have a dead computer in six months. So it's Ubuntu Server straight on the metal, and I get my rollback safety by taking a disk image to a USB drive instead.

The other big one: I'm designing most of the challenges to be **files**, not running services. Crypto puzzles, forensics images, things to reverse-engineer. A file costs nothing to serve. A running service costs a piece of a CPU, and this thing only has four slow ones. Every live challenge is also something that can crash at hour two with a room watching. So the ones I do run are locked down hard — read-only, no privileges, capped memory and CPU, on their own isolated network — because on a box this small, one person's runaway process takes down the entire event.

And the boring one that matters most: it backs up the scoreboard every thirty minutes, automatically, and I carry a copy on a USB stick. Losing the standings an hour before the end is the single most reliable way to ruin one of these.

## Where it stands

Honestly? It's a repository right now. Nothing has touched the actual hardware yet.

Everything's written — the stack, the challenge templates, the setup scripts, the whole event-day runbook including what to do when each specific thing breaks. The next step is the unglamorous one: boot a Linux USB stick on the thing, find out whether the wifi chip is one of the friendly ones, find out whether that little screen comes up sideways, and then wipe Windows off it.

Then I have to actually write the puzzles, which is the part I'm looking forward to and also the part that's genuinely hard. Fifteen challenges where nobody solves everything and everybody solves *something* is a much narrower target than it sounds like.

## Why bother

I keep building tools to teach things I had to learn the annoying way. HashLab was that — a hashcat frontend that shows you the real command it's running instead of hiding it, because that's the part I wanted when I was starting out. This is the same impulse pointed at a room instead of one person.

A CTF is the best on-ramp into security I know of. It's a puzzle, so nobody has to admit they don't know something before they're allowed to start, and about twenty minutes in someone who swore they weren't technical is fully locked in and refusing to leave. I've watched it happen. I'd like to be the guy who can make that happen at a meetup with fifteen minutes of setup.

Same thing that got me through losing 180 pounds, really — the work is easier when it stops feeling like work and starts feeling like a game you're trying to beat.

More once it's running on actual hardware instead of just in my head and a git repo.
