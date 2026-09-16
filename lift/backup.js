/* The rules for writing and restoring a LIFT backup file.
 *
 * The file format is coach/BACKUP-FORMAT.md, shared by every LIFT client. This
 * is the browser build's half of it, kept as its own script the way
 * food-amount.js is so the rules are tested by node rather than by eye. A
 * backup is the only way someone's log survives a cleared browser; a merge
 * that quietly drops or duplicates records is the worst bug this app can have.
 *
 * Three rules live here because the format says so and app.js broke two of
 * them before this file existed:
 *
 *   1. Ids compare case-insensitively. iOS writes UUIDs upper case and the
 *      browser generates them lower case, so the same record arrives spelled
 *      both ways. Comparing strings exactly duplicated food and workouts on
 *      every round trip between a phone and this app.
 *
 *   2. A `data` section this build does not store is kept and written back out
 *      unchanged, exactly like `ext`. That is what lets the format grow without
 *      a version bump -- and what stops a future section being lost the moment
 *      this build re-saves a file from a newer client.
 *
 *   3. A planned meal whose recipe is on neither side is skipped. It would
 *      render as a meal with nothing behind it.
 *
 *   4. Sugar and sodium come from `ext.ios` when the common field is missing.
 *      Before BACKUP-FORMAT gave saturatedFatG, sugarG and sodiumMg common
 *      names, an iPhone wrote sugar and sodium only there -- keyed by record
 *      id, upper case -- so an older phone file restored here would otherwise
 *      arrive with none. The common field wins whenever both exist. iOS never
 *      recorded saturated fat, so there is nothing to fall back to for it.
 */
(function (global) {
  'use strict';

  /** Sections this build stores and writes from its own data. Everything else
   *  it reads is preserved. Order is the order they appear in the file. */
  var STORED = ['goal', 'food', 'workouts', 'settings', 'steps', 'coach', 'profile',
                'weights', 'recipes', 'plan', 'routines', 'outdoor'];

  /** Deliberately not stored, by the format: ticks mark one week's shop, and
   *  restoring last month's would show this week's list as already bought. */
  var NEVER_BACKED_UP = ['shopping'];

  var idKey = function (id) { return String(id).toLowerCase(); };

  /**
   * Adds the arriving records whose id this list does not already have.
   * Returns how many were added. `current` is changed in place, matching how
   * app.js holds its arrays.
   */
  function addMissing(current, arriving) {
    var seen = new Set(current.filter(Boolean).map(function (r) { return idKey(r.id); }));
    var added = 0;
    (arriving || []).forEach(function (r) {
      if (!r || r.id == null || r.id === '') return;
      var key = idKey(r.id);
      if (seen.has(key)) return;
      seen.add(key); // a file listing the same record twice adds it once
      current.push(r);
      added += 1;
    });
    return added;
  }

  /**
   * Planned meals, restored after recipes so the check sees both sides.
   * A meal pointing at a recipe that exists nowhere is left out.
   */
  function addMissingPlan(currentPlan, arrivingPlan, recipes) {
    var known = new Set((recipes || []).filter(Boolean).map(function (r) { return idKey(r.id); }));
    var usable = (arrivingPlan || []).filter(function (m) {
      return m && m.recipeId != null && known.has(idKey(m.recipeId));
    });
    return addMissing(currentPlan, usable);
  }

  /** The `data` sections a file carries that this build does not store. */
  function unknownSections(data) {
    var out = {};
    Object.keys(data || {}).forEach(function (k) {
      if (STORED.indexOf(k) === -1 && NEVER_BACKED_UP.indexOf(k) === -1) out[k] = data[k];
    });
    return out;
  }

  /**
   * Builds the file's `data`. Stored sections come from this device; preserved
   * unknown sections go back out as they came in, and can never overwrite a
   * section this build owns.
   */
  function buildData(stored, preserved) {
    var data = {};
    Object.keys(preserved || {}).forEach(function (k) {
      if (STORED.indexOf(k) === -1 && NEVER_BACKED_UP.indexOf(k) === -1) data[k] = preserved[k];
    });
    STORED.forEach(function (k) { data[k] = stored[k] === undefined ? null : stored[k]; });
    return data;
  }

  var IOS_DETAILS = ['sugarG', 'sodiumMg'];

  /** A finite, non-negative number, or null. */
  function nutrient(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
  }

  /** `section[id]`, matching the id case-insensitively. */
  function extrasFor(section, id) {
    if (!section || typeof section !== 'object' || id == null) return null;
    if (section[id] && typeof section[id] === 'object') return section[id];
    var want = idKey(id);
    var key = Object.keys(section).find(function (k) { return idKey(k) === want; });
    return key && section[key] && typeof section[key] === 'object' ? section[key] : null;
  }

  function fillFrom(target, extras) {
    var out = target;
    IOS_DETAILS.forEach(function (f) {
      if (nutrient(out[f]) != null) return;
      var v = nutrient(extras[f]);
      if (v == null) return;
      if (out === target) out = Object.assign({}, target);
      out[f] = v;
    });
    return out;
  }

  /**
   * Food entries with sugar and sodium filled from `ext.ios.food` where the
   * common field is missing (rule 4). Returns new records; the file's own
   * objects are left as they were.
   */
  function foodWithIosDetails(food, ext) {
    var section = ext && ext.ios && ext.ios.food;
    return (food || []).map(function (e) {
      var extras = e && extrasFor(section, e.id);
      return extras ? fillFrom(e, extras) : e;
    });
  }

  /**
   * The same for recipes, from `ext.ios.recipes`, into nutritionPerServing. A
   * recipe with no macros has nowhere to hold them -- nutrition cannot exist
   * without calories -- so it is left as it is.
   */
  function recipesWithIosDetails(recipes, ext) {
    var section = ext && ext.ios && ext.ios.recipes;
    return (recipes || []).map(function (r) {
      var extras = r && extrasFor(section, r.id);
      if (!extras || !r.nutritionPerServing || typeof r.nutritionPerServing !== 'object') return r;
      var nutrition = fillFrom(r.nutritionPerServing, extras);
      return nutrition === r.nutritionPerServing ? r : Object.assign({}, r, { nutritionPerServing: nutrition });
    });
  }

  global.LiftBackup = {
    STORED: STORED,
    NEVER_BACKED_UP: NEVER_BACKED_UP,
    addMissing: addMissing,
    addMissingPlan: addMissingPlan,
    unknownSections: unknownSections,
    buildData: buildData,
    foodWithIosDetails: foodWithIosDetails,
    recipesWithIosDetails: recipesWithIosDetails,
  };
})(typeof window !== 'undefined' ? window : globalThis);
