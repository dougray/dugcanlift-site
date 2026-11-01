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
 * Fiber is the fifth form field and follows the three, not the four: blank
 * saves no `fiberG` key at all -- unknown, never 0 g -- and a typed 0 is a
 * figure and saved as 0. Coach iPhone's `NutritionFacts.fiberG` is optional
 * for the same reason, and Coach Android holds it the same way. Every recipe
 * an earlier build saved carries `fiberG: 0` for a blank field; nobody can
 * tell now which of those were unknown, so a stored zero reopens as 0 and
 * stays 0 (`storedFiber`).
 *
 * Kept as its own script so node tests it (recipe-nutrition.test.mjs).
 */
(function (global) {
  'use strict';

  var FORM_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'];
  var DETAIL_KEYS = ['saturatedFatG', 'sugarG', 'sodiumMg'];
  // The four that are always numbers on a recipe with nutrition: zeros when
  // not entered, the shape every build writes. Fiber is the fifth form key
  // and may be absent.
  var MACRO_KEYS = FORM_KEYS.slice(0, 4);

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
    MACRO_KEYS.forEach(function (key, i) {
      result[key] = typed[i] || 0;
    });
    // Blank fiber is unknown: no key, never a measured 0 g.
    if (known(typed[4])) result.fiberG = typed[4];
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

  /** The fiber the recipe editor opens with: the stored figure when the
   *  recipe has macros and states one (0 included -- a stored zero stays a
   *  zero), null otherwise, so unknown fiber reopens blank. A recipe holding
   *  only saturated fat, sugar or sodium has placeholder macros and reopens
   *  blank, as its four macros do. */
  function storedFiber(n) {
    if (!hasMacros(n)) return null;
    return known(n.fiberG) ? n.fiberG : null;
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
   *
   * `u[4]` is 0 for unknown fiber. `u` is five plain numbers, and the iPhone
   * decoders reject a null in it and drop the whole plan; Coach iPhone writes
   * `fiberG ?? 0` and Coach Android `fiberG ?: 0.0` for the same reason.
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

  /* Whether a recipe's macros are an estimate: `estimated` on its
   * nutritionPerServing (BACKUP-FORMAT's spelling), set by a catalogue copy
   * or carried in from another build's backup. Only a literal true counts. */
  function isEstimated(n) {
    return !!n && typeof n === 'object' && n.estimated === true;
  }

  /* The library card's macro line, Coach iPhone's CookView.macroLine: the
   * four macros, " · estimated" after them when they are an estimate, and
   * "Macros not set" -- never an estimate of nothing -- when none was
   * entered. `trim` is app.js's trimNum, passed in so this file stays
   * loadable on its own. */
  var ESTIMATED_SUFFIX = ' · estimated';

  function cardMacroLine(n, trim) {
    if (!hasMacros(n)) return 'Macros not set';
    var line = trim(n.calories) + ' kcal  P ' + trim(n.proteinG)
      + '  C ' + trim(n.carbsG) + '  F ' + trim(n.fatG);
    return isEstimated(n) ? line + ESTIMATED_SUFFIX : line;
  }

  /* The recipe editor's line under the macros, Coach iPhone's
   * RecipeEditorView word for word, with the source's own note (the
   * catalogue's attribution, licence and costing caveat, `sourceTranscript`)
   * under it when the recipe has one. Null for a recipe whose macros are not
   * an estimate, so the editor shows nothing new for it. */
  var ESTIMATED_NOTE = 'Estimated from an import — check these before sending.';

  function estimatedNote(r) {
    if (!r || !isEstimated(r.nutritionPerServing)) return null;
    var source = typeof r.sourceTranscript === 'string' && r.sourceTranscript.trim()
      ? r.sourceTranscript : null;
    return { note: ESTIMATED_NOTE, source: source };
  }

  global.CoachRecipeNutrition = {
    isEstimated: isEstimated,
    ESTIMATED_SUFFIX: ESTIMATED_SUFFIX,
    ESTIMATED_NOTE: ESTIMATED_NOTE,
    cardMacroLine: cardMacroLine,
    estimatedNote: estimatedNote,
    hasMacros: hasMacros,
    storedFiber: storedFiber,
    planRecipe: planRecipe,
    FORM_KEYS: FORM_KEYS,
    DETAIL_KEYS: DETAIL_KEYS,
    mergeNutrition: mergeNutrition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
