---
layout: post
title:  "COOK Is Next, And It Starts In My DMs"
date:   2026-08-26 10:00:00 -0500
---

Three times now I've posted a recipe card. That's a way to hand someone a recipe. It's also the only way I had, because a picture of a recipe is where the recipe stops. You can't eat a PNG. You can't shop from it. And you certainly can't tell LIFT about it without typing every ingredient in by hand.

So the next thing I'm building is called COOK.

## The gap it fills

LIFT tells you what you ate. Coach shows your trainer what you ate. Neither one helps with the part that actually decides your week, which is standing in a kitchen on Sunday wondering what you're making.

COOK is that part. Recipes go in. A meal plan and a shopping list come out.

That's the whole pitch. Pick what you're eating this week, and COOK tells you what to buy and, when you cook it, logs it to LIFT with the macros already attached — because it knew the recipe before you ate it.

## The bit I'm actually excited about

COOK isn't only for you. It's for your trainer too.

Same tool, opposite ends. You can plan your own week in LIFT. Or your coach can build the week *for* you in Coach, and send it over — and it lands in your app as a plan you can shop from and cook from, not as a PDF you'll open once and never find again.

It travels the same way a log does today: inside the link, after the `#`, the part browsers never send to a server. Nothing gets uploaded going out, and nothing gets uploaded coming back. Coach never needed a server, and neither does this.

The plan is small enough to survive being an email for the same reason your log is — it doesn't carry the recipes, it points at them. A month of dinners is about a kilobyte.

And because LIFT stamps what it logs, the loop closes on its own: your coach can see which of the meals they planned you actually cooked. Not "did you hit your protein." Did you make the thing.

## Where the recipes come from

Three places, and I want to be straight about all three.

**Ones I write.** A recipe library on the site — free, open, no app required. The Creami cards are the obvious starting stock, because they already exist and people already ask for them, and they deserve to be real recipes with real numbers instead of PNGs I paste into DMs.

**Ones you write.** Type your own in. Your grandmother's thing that isn't on the internet and shouldn't be.

**Ones you already own.** If you've got a shelf of cookbooks as PDFs, getting them into your own kitchen app is a reasonable thing to want, and COOK will help you do it on your own machine. What it won't do is turn into a pipe for republishing other people's work — those stay yours, on your device, the same as everything else in LIFT. I'm not building a place to launder somebody's cookbook into a shopping list for strangers.

## The honest part

COOK does not exist yet…. YET!

Right now it's a data model and a plan. Recipes, meal plans, shopping lists — the shapes are written and being built into both apps. The format this plan travels in is written down. That's genuinely all there is. No screens, no beta, no TestFlight. Yet! I am actively building it out right now. Testing will be available this weekend… maybe.

I'm telling you now because I'd rather show a thing being built than announce it finished.

No date, and no roadmap. I've been wrong about dates before and I'd rather not add to the list. Nothing here is a promise — it's what I'm working on. It turns up when it turns up, and you'll know because it'll just be there.

Two things I already know will annoy people:

**It won't rip recipes off Instagram for you.** Because that would mean I would have to be running a scraper against platforms whose terms say don't, on infrastructure someone has to pay for. That part stays personal, do that on your own if you choose. What ships is the part I can stand behind as a tool to help you in your journey.

**The macros will sometimes be estimated, and it will say so.** A recipe with no nutrition data attached will show as unknown rather than quietly logging zero calories into your day. Zero is a lie that adds up.

## Meanwhile

Nothing here changes what already works. [LIFT](/lift/) tracks, [Coach](/coach/) collates, and both are free.

One thing did change this week: all four repos are public and licensed now — the apps and Coach under AGPL-3.0, this site under MIT, so you can check the calculator's math against what the app computes if you ever wondered whether they agreed. It's all at [github.com/dougray](https://github.com/dougray).

No more waiting on a DM'd recipe card — sorry. That's kind of the point. I am building to equip you with the tools to succeed. Let's make some progress together!
