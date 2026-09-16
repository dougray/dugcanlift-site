/* A recipe's per-serving nutrition, rebuilt from the recipe form.
 *
 * The form shows five macros. A recipe can carry more -- recipe-import.js
 * reads sugarG and sodiumMg off a publisher's page, and a backup from Coach
 * iOS or Android may hold keys this app has never heard of. Save used to
 * rebuild the object from the five fields alone, so opening an imported
 * recipe and pressing Save quietly threw the rest away.
 *
 * The rule is the one LIFT iOS (RecipeMacroEntry) and Coach Android
 * (Recipe.nutritionUnknownKeys) already follow: every key the form does not
 * show is carried from the recipe's existing nutrition, whatever the five
 * shown fields became. A form left entirely blank still means "no nutrition",
 * as it always has.
 *
 * Kept as its own script so node tests it (recipe-nutrition.test.mjs).
 */
(function (global) {
  'use strict';

  var FORM_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'];

  /** typed: the five form values in FORM_KEYS order, null where blank.
   *  existing: the recipe's current nutritionPerServing, or null. */
  function mergeNutrition(typed, existing) {
    if (typed.every(function (v) { return v === null; })) return null;
    var result = {};
    FORM_KEYS.forEach(function (key, i) {
      result[key] = typed[i] || 0;
    });
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      Object.keys(existing).forEach(function (key) {
        if (FORM_KEYS.indexOf(key) === -1) result[key] = existing[key];
      });
    }
    return result;
  }

  global.CoachRecipeNutrition = {
    FORM_KEYS: FORM_KEYS,
    mergeNutrition: mergeNutrition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
