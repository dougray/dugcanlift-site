/* Road Food: what at this chain fits what is left of today.
 *
 * The rules that decide what a person sees, kept apart from the screen so node
 * tests them (like sides.js and nutrients.js). The screen is in app.js.
 *
 * Ranking, as the spec has it (dugcanlift-wip-backups/lift-road-food-spec.md):
 *
 *   1. Fits: calories at or under what is left today. Below those, a separate
 *      "A little over" group holds items no more than 10% over. Anything past
 *      that is not shown at all -- hidden, not greyed, so the list stays short.
 *   2. Within each group, protein per 100 kcal, highest first.
 *   3. Ties go to the lower sodium. Sodium is otherwise only shown, never
 *      scored, and nothing here colours, badges or warns about it.
 *
 * With no goal set there is nothing to fit, so every item is ranked by protein
 * per 100 kcal alone, and the screen says that is what it is doing.
 *
 * Blank stays blank. An item whose protein is not listed has no protein
 * density, not a density of zero: it ranks after every item whose protein is
 * known, and the screen says "protein not listed". Unknown sodium likewise
 * loses a tie to any known sodium rather than winning it as a zero. An item
 * with no calorie figure cannot be said to fit, so it is left out when there
 * is a goal and ranked by nothing in particular (last) when there is not.
 *
 * Zero-calorie drinks are real items (drinks are in; combos are not). With no
 * protein they rank at the bottom of the fits group, where a diet soda belongs.
 */
(function (global) {
  'use strict';

  /** A finite, non-negative number, or null. */
  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }

  /** Grams of protein per 100 kcal, or null when it cannot honestly be said.
   *  Zero calories and zero protein is 0 (a diet drink); zero calories with
   *  protein is Infinity, which ranks it first, as it should. */
  function proteinPer100(item) {
    var kcal = num(item && item.kcal);
    var protein = num(item && item.proteinG);
    if (kcal == null || protein == null) return null;
    if (kcal === 0) return protein === 0 ? 0 : Infinity;
    return (protein / kcal) * 100;
  }

  // Known before unknown, then higher density, then lower sodium, then name,
  // so the order is the same on every run and every device.
  function compare(a, b) {
    var da = proteinPer100(a);
    var db = proteinPer100(b);
    if ((da == null) !== (db == null)) return da == null ? 1 : -1;
    if (da != null && da !== db) return db - da;
    var sa = num(a.sodiumMg);
    var sb = num(b.sodiumMg);
    if ((sa == null) !== (sb == null)) return sa == null ? 1 : -1;
    if (sa != null && sa !== sb) return sa - sb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }

  /**
   * `remaining` is today's { calories, proteinG } left, or null with no goal.
   *
   * Returns { mode, fits, over }:
   *   mode 'goal'    fits = at or under remaining.calories; over = more than
   *                  that but no more than 10% over it.
   *   mode 'noGoal'  fits = every item, ranked; over is empty.
   *
   * The 10% line is compared in whole numbers (kcal x 10 <= left x 11), so
   * 704 over 640 is in and 705 is out, with no floating-point edge. With
   * nothing left, 10% of nothing is nothing: an item has to be free to fit.
   */
  function rank(items, remaining) {
    var list = (items || []).filter(Boolean);
    var left = remaining ? num(remaining.calories) : null;
    var hasGoal = !!remaining && remaining.calories != null && isFinite(Number(remaining.calories));
    if (!hasGoal) {
      return { mode: 'noGoal', fits: list.slice().sort(compare), over: [] };
    }
    // A day already past its calories has none left: `num` reads a negative
    // as unknown, and here it means zero.
    if (left == null) left = 0;
    var fits = [];
    var over = [];
    list.forEach(function (item) {
      var kcal = num(item.kcal);
      if (kcal == null) return;
      if (kcal <= left) fits.push(item);
      else if (kcal * 10 <= left * 11) over.push(item);
    });
    return { mode: 'goal', fits: fits.sort(compare), over: over.sort(compare) };
  }

  /* ---------------- how old the numbers are ---------------- */

  /** "2026-09-20" as a local date, or null for anything that is not one. */
  function parseDay(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1 ? d : null;
  }

  /**
   * Whether `checkedOn` is more than six calendar months before `today`
   * (both "YYYY-MM-DD"). Calendar months, through Date, not 182 days: "six
   * months old" is what the screen says, so it is what gets measured. Null
   * when the date is missing or not a date, which the screen also says.
   */
  function isStale(checkedOn, today) {
    var checked = parseDay(checkedOn);
    var now = parseDay(today);
    if (!checked || !now) return null;
    var limit = new Date(checked.getFullYear(), checked.getMonth() + 6, checked.getDate());
    // 31 Mar + 6 months rolls to 1 Oct; clamp it back to the month's end.
    if (limit.getDate() !== checked.getDate()) limit.setDate(0);
    return now > limit;
  }

  /* ---------------- ordering rules ---------------- */

  /**
   * The ordering tips for one chain. A rule is either a plain string, which
   * applies everywhere, or { text, kinds: [...] }, which applies to chains
   * whose `kind` is listed. The file's format allows plain strings; the kinds
   * are there for the day a rule only makes sense at a coffee counter.
   */
  function rulesFor(rules, kind) {
    return (rules || []).map(function (r) {
      if (typeof r === 'string') return r;
      if (!r || typeof r.text !== 'string') return null;
      if (!Array.isArray(r.kinds) || !r.kinds.length) return r.text;
      return kind && r.kinds.indexOf(kind) !== -1 ? r.text : null;
    }).filter(Boolean);
  }

  /* ---------------- the chain picker ---------------- */

  /** Chains with the recently used ones first, most recent first, then the
   *  rest by name. `recent` is a list of chain ids; unknown ids are ignored. */
  function orderChains(chains, recent) {
    var list = (chains || []).filter(Boolean);
    var byId = {};
    list.forEach(function (c) { byId[c.id] = c; });
    var seen = {};
    var first = [];
    (recent || []).forEach(function (id) {
      if (byId[id] && !seen[id]) { seen[id] = true; first.push(byId[id]); }
    });
    var rest = list.filter(function (c) { return !seen[c.id]; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return { recent: first, rest: rest };
  }

  /** `recent` with `id` moved to the front, kept to `max`. */
  function remember(recent, id, max) {
    var out = [id].concat((recent || []).filter(function (x) { return x !== id; }));
    return out.slice(0, max || 5);
  }

  /* ---------------- logging ---------------- */

  var MACROS = [['kcal', 'calories'], ['proteinG', 'proteinG'], ['fatG', 'fatG'],
                ['carbsG', 'carbsG'], ['fiberG', 'fiberG']];
  var DETAILS = ['saturatedFatG', 'sugarG', 'sodiumMg'];

  /**
   * An ordinary food entry for one item, in the shape every other entry has:
   * servings 1, the item's own numbers as the totals. A number the item does
   * not list is left off the entry, never written as zero, so a coach and the
   * day's nutrient coverage both see a gap as a gap. `extra` supplies id,
   * date, loggedAt and meal, which belong to the app, not to this file.
   */
  function entryFor(item, placeName, extra) {
    var entry = { name: placeName ? item.name + ' (' + placeName + ')' : item.name, servings: 1 };
    MACROS.forEach(function (pair) {
      var v = num(item[pair[0]]);
      if (v != null) entry[pair[1]] = Math.round(v);
    });
    DETAILS.forEach(function (f) {
      var v = num(item[f]);
      if (v != null) entry[f] = f === 'sodiumMg' ? Math.round(v) : Math.round(v * 10) / 10;
    });
    Object.keys(extra || {}).forEach(function (k) { entry[k] = extra[k]; });
    return entry;
  }

  global.LiftRoadFood = {
    proteinPer100: proteinPer100,
    rank: rank,
    isStale: isStale,
    rulesFor: rulesFor,
    orderChains: orderChains,
    remember: remember,
    entryFor: entryFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
