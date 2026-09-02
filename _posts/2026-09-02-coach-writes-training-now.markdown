---
layout: post
title:  "Coach Writes Training Now, And Stopped Making You Type Macros"
date:   2026-09-02 17:00:00 -0500
---

When I posted about COOK I said the interesting part wasn't the shopping list, it was that your coach could build your week and send it over. That shipped. What shipped with it is the half I hadn't talked about yet: Coach can write your *training* now, not just your food. And both halves stopped expecting you to know things off the top of your head.

It's live at [dugcanlift.com/coach](/coach/), same as before. Still free, still no account, still nothing uploaded.

## Coach programs now

There's a **Train** tab. You build a workout — call it Lower A — and prescribe it: three sets of squats at 225 for 5, then a top set at 245 for 3 at RPE 9. Then you drop Lower A onto whichever days of your client's week you want it on, as many times as you want it.

Every field is optional, and that's deliberate. `225 x 5` is a prescription. So is "5 reps, you pick the weight." So is a ten-minute row with no reps at all. A blank stays blank — it does not quietly become a zero on your client's phone.

Sets are listed one by one instead of "3 x 5", because coaches ramp, and there's no way to say 225/225/245 in a format that only counts.

On the client's end it shows up in Train, on the day, above their own log. They tap **Start this session** and it drops in as a normal workout they can edit — because what gets logged has to be what actually happened. A session you can't correct is either a lie or it doesn't get logged at all. The prescription stays as its own record, so "did they actually do the week" is still a question with an answer.

One link carries the meals and the training together. Sending from Cook or from Train gives you the same link.

## You can send one thing now

You don't have to book a day to hand something over. Every recipe and every workout has a **Send** button. That sends just that — a recipe to keep, or a programme to run when they like — and it lands in their app as something reusable instead of something scheduled. Starting a saved workout doesn't use it up.

Turns out "here's the plan" and "here's a thing you own now" are different sentences, and the app should be able to say both.

## The part that actually saves time

Here's what I was tired of: writing a recipe and then guessing at the macros, or opening a calculator, or just leaving them blank and losing the day's numbers.

So both apps now ship with two databases, and they work with no signal at all:

**873 exercises**, from the free-exercise-db project. That's the same library the iPhone build has always had, now in Coach and in the web app. Adding an exercise used to be two typing prompts. Now you search it. And when I prescribe "Barbell Squat" and you log "Barbell Squat," they're the same lift, which is the whole reason your history lines up.

**7,793 foods**, from USDA FoodData Central. Type an ingredient, give it a weight, and the macros total themselves. 600 g of chicken breast, four servings, and the per-serving numbers fill in. Change the serving count and they re-divide.

Both files live on your device. The food database is 634 KB, so it doesn't download until the first time you actually use it — no reason to spend that on someone who only tracks training.

Open Food Facts is still there for branded stuff and barcodes. It's better at a tub of yoghurt; USDA is better at a chicken breast. There's a toggle.

## Importing a recipe, and what it can't do

You can search a dish by name and pull it in — name, ingredients, method, all of it.

Now the honest part, because this one has a real limit and I'd rather say it than let you find it.

There is no open recipe database that carries nutrition. I looked properly. The ones with recipes have no macros; the one with macros has products, not recipes; the ones with both want a paid API key. So an import takes the *shape* of the dish from one place and prices it against USDA.

Which means it only prices what it can actually weigh. Grams, kilos, ounces, pounds — fine. "2 tbsp olive oil" and "a handful of spinach" are not weights, and turning them into weights means inventing a density and handing you a confident wrong number.

So it doesn't. It tells you. Import a chilli with seventeen ingredients and it'll say it costed two of them and the total is short. Look the rest up in the same box, or type the macros in yourself. A gap you can see beats a total you can't trust.

## What I'd check if you're already using it

If you're a coach: open [Coach](/coach/), hit **Train**, and build one workout. That'll tell you in about ninety seconds whether the prescribing flow makes sense to you, and I want to know if it doesn't.

If you're being coached: nothing to do. Next plan that lands will just have training in it, and your app will say what it took in when it arrives.

If you're on an older version of LIFT, a plan with training in it still opens — you'll get the meals and the app will tell you what it actually imported. That's on purpose. I'd rather an old build take what it understands and say so than refuse the whole thing and lose the food too.

All of it's [open source](https://github.com/dougray), and the setup steps are still on [the install page](/coach/install/). Break it and tell me.
