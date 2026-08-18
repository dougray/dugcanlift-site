---
layout: post
title:  "Soon: Comment \"Recipe,\" Get The Card"
date:   2026-08-18 10:00:00 -0500
---

Every recipe post gets the same comment eventually: "can you send me this recipe??" I've been screenshotting the card, digging up the caption, and pasting it into a DM by hand — fine for one comment, not fine for the fifteenth one on the same post. So I've been building the annoying part away, and it's close.

## How it'll work

Comment the word "recipe" on any recipe post and I'll send you a private DM asking which one you want. Reply with that recipe's keyword — something short like "bananafosters" or "carrot" — and the card lands straight in your DMs. No account to make, no link to click.

It'll run on the same keyword I already put in the recipe's own caption, so once a post is up you'll already know what to type. Comment gets you a prompt, the keyword gets you the card.

## Why I'm building it myself instead of renting a bot

There are plenty of "auto-DM" tools you can subscribe to, but that means routing every conversation with you through someone else's server. This runs on my own infrastructure, talking straight to Instagram's own messaging API — nothing sitting in the middle that doesn't need to be there.

## Five cards ready to go

The Creami rotation is already loaded in: avocado, avocado toast, banana fosters, carrot cake cheesecake, and sweet potato pie. That's the whole reason this got built — I kept making weirder Creami flavors and kept manually sending the same five recipes over and over.

## Where this goes next

Creami recipes are just what happened to exist first. The keyword system doesn't care what kind of recipe it's attached to — the next batch will start pulling from actual meals, not just protein ice cream. Every new recipe is just a new keyword and a new card, so the list grows with whatever I'm actually cooking, not with a separate feature to build each time.

## Where it actually stands

Built and tested on my own side — the DM logic, the comment trigger, the whole path from a comment to a card in your inbox all work. What's left is entirely Instagram's own approval process for messaging permissions, which is on Meta's clock, not mine. Could be days, could be a few weeks. I'll post again the moment it's live.

## Why bother

I'd rather spend the time making a sixth weird Creami flavor than retyping the same five recipes into DMs all week. If the annoying, repetitive part runs itself, there's more actual cooking getting done — which was always supposed to be the point.
