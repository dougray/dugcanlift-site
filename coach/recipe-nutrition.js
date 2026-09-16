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
 * Saturated fat, sugar and sodium are form fields too, passed separately as
 * `details` so a caller that shows only the five still carries them. When
 * `details` is given the form wins for those three as well: a blank field
 * removes the key -- blank stays unknown, never zero. A recipe can hold them
 * with no macros entered; the five are then placeholder zeros, the shape
 * Coach iOS and Coach Android write, and nutrients.js `hasMacros` is false for
 * it, so the editor reopens them blank and a plan link sends no `u`.
 *
 * Kept as its own script so node tests it (recipe-nutrition.test.mjs).
 */
(function (global) {
  'use strict';

  var FORM_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'];
  var DETAIL_KEYS = ['saturatedFatG', 'sugarG', 'sodiumMg'];

  var known = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0; };

  /** typed: the five form values in FORM_KEYS order, null where blank.
   *  existing: the recipe's current nutritionPerServing, or null.
   *  details: optional { saturatedFatG, sugarG, sodiumMg } from the form, null
   *  where blank. Omitted, the three are carried from `existing` like any
   *  other key the form does not show. */
  function mergeNutrition(typed, existing, details) {
    var shown = details && typeof details === 'object';
    var anyDetail = shown && DETAIL_KEYS.some(function (k) { return known(details[k]); });
    if (typed.every(function (v) { return v === null; }) && !anyDetail) return null;
    var result = {};
    FORM_KEYS.forEach(function (key, i) {
      result[key] = typed[i] || 0;
    });
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      Object.keys(existing).forEach(function (key) {
        if (FORM_KEYS.indexOf(key) !== -1) return;
        if (shown && DETAIL_KEYS.indexOf(key) !== -1) return;
        result[key] = existing[key];
      });
    }
    if (shown) {
      DETAIL_KEYS.forEach(function (key) {
        if (known(details[key])) result[key] = details[key];
      });
    }
    return result;
  }

  /** Any of the five macros non-zero. All zeros are placeholders for "not
   *  entered", never a zero-calorie dish. */
  function hasMacros(n) {
    if (!n || typeof n !== 'object') return false;
    return FORM_KEYS.some(function (k) {
      var v = Number(n[k]);
      return isFinite(v) && v !== 0;
    });
  }

  /**
   * PLAN-FORMAT's inline recipe: n, s, u, ux, i, t.
   *
   * `u` is omitted unless a macro was entered -- it must never be sent as
   * zeros, because a zero becomes a zero-calorie dinner in the client's day.
   * `ux` is [saturatedFatG, sugarG, sodiumMg] per serving, grams to one
   * decimal and sodium whole (half-up), only trailing nulls trimmed, omitted
   * when none is known. `row` is CoachNutrients.row, passed in so this file
   * stays loadable on its own.
   */
  function planRecipe(r, row) {
    var n = r.nutritionPerServing;
    var out = { n: r.name, s: r.servings };
    if (hasMacros(n)) out.u = [n.calories || 0, n.proteinG || 0, n.carbsG || 0, n.fatG || 0, n.fiberG || 0];
    var ux = n && row ? row(n) : null;
    if (ux) out.ux = ux;
    out.i = (r.ingredients || []).map(function (g) { return g.rawText; });
    out.t = r.steps || [];
    return out;
  }

  global.CoachRecipeNutrition = {
    hasMacros: hasMacros,
    planRecipe: planRecipe,
    FORM_KEYS: FORM_KEYS,
    DETAIL_KEYS: DETAIL_KEYS,
    mergeNutrition: mergeNutrition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
