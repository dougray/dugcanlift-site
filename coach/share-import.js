/* One day of a share link, expanded into the record this app stores.
 *
 * SHARE-FORMAT.md is the wire. Moved out of app.js so node can test what a
 * link turns into -- including saturated fat, sugar and sodium, whose rules
 * live in nutrients.js -- without a DOM (share-import.test.mjs).
 *
 * Needs CoachRoute (route.js) and CoachNutrients (nutrients.js) loaded first.
 */
(function (global) {
  'use strict';

  function expandSet(tuple) {
    const [weightLb, reps, rpe, durationSec, distanceM, flags] = tuple;
    return {
      weightLb: weightLb ?? null,
      reps: reps ?? null,
      rpe: rpe ?? null,
      durationSec: durationSec ?? null,
      distanceM: distanceM ?? null,
      warmup: !!((flags || 0) & 1),
    };
  }

  function expandDay(raw, dictExercises, dictFoods, meals) {
    const day = {};
    if (raw.n) day.name = raw.n;
    if (raw.fo) day.focus = raw.fo;
    if (raw.bw != null) day.bodyweightLb = raw.bw;
    if (raw.st != null) day.steps = raw.st;
    if (Array.isArray(raw.o)) {
      const outdoor = global.CoachRoute.readDay(raw.o);
      if (outdoor.length) day.outdoor = outdoor;
    }

    if (Array.isArray(raw.w)) {
      day.exercises = raw.w.map(([index, sets]) => {
        const [name, equipment] = String(dictExercises[index] || '').split('|');
        return {
          name: name || 'Exercise',
          equipment: equipment || '',
          sets: (sets || []).map(expandSet),
        };
      });
    }

    if (Array.isArray(raw.ft)) {
      const [calories, proteinG, fatG, carbsG, fiberG] = raw.ft;
      day.foodTotals = { calories, proteinG, fatG, carbsG, fiberG };
    }

    // Saturated fat, sugar and sodium with their coverage counts, stored
    // exactly as sent and never re-added from the foods (nutrients.js).
    const nutrientTotals = global.CoachNutrients.readDayTotals(raw.fx);
    if (nutrientTotals) day.nutrientTotals = nutrientTotals;

    if (Array.isArray(raw.f)) {
      // `fe` is per serving and aligned with `f`. Stored per serving beside the
      // macros, which this app also keeps per serving and multiplies by
      // servings on screen -- one entry never mixes the two bases.
      const items = global.CoachNutrients.readItems(raw.fe, raw.f.length);
      day.food = raw.f.map(([index, servings, calories, proteinG, fatG, carbsG, fiberG, meal], i) =>
        global.CoachNutrients.assign({
          name: dictFoods[index] || 'Food',
          servings: servings ?? 1,
          calories, proteinG, fatG, carbsG, fiberG,
          meal: meals[meal] || '',
        }, items && items[i]));
      // An itemised payload carries no totals line — it doesn't need to.
      if (!day.foodTotals) {
        day.foodTotals = day.food.reduce((acc, e) => ({
          calories: acc.calories + Math.round(e.calories * e.servings),
          proteinG: acc.proteinG + Math.round(e.proteinG * e.servings),
          fatG:     acc.fatG     + Math.round(e.fatG * e.servings),
          carbsG:   acc.carbsG   + Math.round(e.carbsG * e.servings),
          fiberG:   acc.fiberG   + Math.round(e.fiberG * e.servings),
        }), { calories: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0 });
      }
    }

    return day;
  }

  global.CoachShareImport = { expandSet: expandSet, expandDay: expandDay };
})(typeof window !== 'undefined' ? window : globalThis);
