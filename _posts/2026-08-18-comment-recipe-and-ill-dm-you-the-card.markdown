---
layout: post
title:  "Comment \"Recipe\" And I'll DM You The Card"
date:   2026-08-18 09:00:00 -0500
published: false
---

Every recipe post gets the same comment eventually: "can you send me this recipe??" I used to screenshot the card, dig up the caption, and paste it into a DM by hand — fine for one comment, not fine for the fifteenth one on the same post. So I built the annoying part away.

## How it actually works

Comment the word "recipe" on any recipe post and I'll send you a private DM asking which one you want. Reply with that recipe's keyword — something short like "bananafosters" or "carrot" — and the card lands straight in your DMs. No account to make, no link to click, no waiting on me to see the comment and reply by hand.

It runs on the actual keyword I use in the recipe's own caption, so once a post is up you already know what to type. It's the same pattern either way: comment gets you a prompt, the keyword gets you the card.

## Why I built it instead of bolting on a bot subscription

There are plenty of "auto-DM" tools you can rent by the month, but that means routing every conversation with you through someone else's server. This runs on my own infrastructure, talking straight to Instagram's own messaging API — nothing sitting in the middle logging conversations that don't need to exist outside this account.

## Five cards to start

Right now it covers the Creami rotation I've been posting: avocado, avocado toast, banana fosters, carrot cake cheesecake, and sweet potato pie. That's the whole reason this got built in the first place — I kept making weirder Creami flavors and kept manually sending the same five recipes over and over.

## Where this goes next

Creami recipes are just what happened to exist first. The keyword system doesn't care what kind of recipe it's attached to — the next batch going in will start pulling from actual meals, not just protein ice cream, starting with the ones I get asked about most in comments already. Every new recipe is just a new keyword and a new card, so the list grows with whatever I'm actually cooking, not with a separate feature to build each time.

## Where it stands right now

Built and tested end to end on my own side — the DM logic, the comment trigger, the whole path from a comment to a card in your inbox all work. It's currently going through Instagram's own approval process for messaging permissions before it can go live to everyone, which is entirely on Meta's clock, not mine. I'll post again the moment it's live — should be soon.

## Why bother

I'd rather spend the time making a sixth weird Creami flavor than retyping the same five recipes into DMs all week. If the annoying, repetitive part runs itself, there's more actual cooking getting done — which was always supposed to be the point.
