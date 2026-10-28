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
 *
 * A coach's road picks (`withPicks`) sort to the top of a group and change
 * nothing else: not the order underneath them, not which items fit, not what
 * is hidden. A pick is an opinion sitting beside the numbers, never in front
 * of them, and a pick that is "a little over" stays in the little-over group
 * where the arithmetic put it. See coach/PLAN-FORMAT.md "Road picks".
 *
 * LIFT iOS's RoadFoodRanking is a port of the ranking above, so the two must
 * keep agreeing. Two later parts go the other way: avoiding allergens and
 * putting a meal together (`allergens`, `meal`, near the end) are ports of LIFT
 * iOS's RoadFoodAllergens and RoadFoodMeal, which are the reference for them.
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

  /* ---------------- a coach's picks ---------------- */

  /**
   * `ids` as a lookup, keeping only what this copy of the data has.
   *
   * An id nothing here knows is **skipped, silently**: the coach's Road Food
   * file and this one are two builds updated at different times, and an item
   * withdrawn since the plan was sent must leave no row, no gap and no error.
   */
  function pickedIn(items, ids) {
    var wanted = {};
    (ids || []).forEach(function (id) { if (typeof id === 'string' && id) wanted[id] = true; });
    var found = {};
    (items || []).forEach(function (item) {
      if (item && wanted[item.id]) found[item.id] = true;
    });
    return found;
  }

  /** A stable partition: the picked ones first, each part in the order it
   *  already had. Sorting by a "picked" key would have done the same thing
   *  and is not written that way on purpose -- Array.prototype.sort is stable
   *  in every engine that matters, but the promise here is that the nutrition
   *  order is untouched, and a partition cannot quietly stop keeping it. */
  function pickedFirst(list, picked) {
    var first = [];
    var rest = [];
    (list || []).forEach(function (item) {
      (item && picked[item.id] ? first : rest).push(item);
    });
    return first.concat(rest);
  }

  /**
   * A ranked result with the coach's picks floated to the top of each group.
   *
   * Returns the same { mode, fits, over } plus `picked`, the ids of the picks
   * actually on screen, and `count`, how many that is. Nothing is added to a
   * group and nothing is taken out: an item hidden for being more than 10%
   * over is still hidden, picked or not, because the pick says nothing about
   * calories and the fit rule is the client's own day talking.
   */
  function withPicks(ranked, ids) {
    var all = (ranked.fits || []).concat(ranked.over || []);
    var picked = pickedIn(all, ids);
    return {
      mode: ranked.mode,
      fits: pickedFirst(ranked.fits, picked),
      over: pickedFirst(ranked.over, picked),
      picked: picked,
      count: Object.keys(picked).length,
    };
  }

  /** How many of `items` are picked -- for a chain card, which shows no list. */
  function pickCount(items, ids) {
    return Object.keys(pickedIn(items, ids)).length;
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
   * A document's own date as a local date, or null. `publishedOn` is only as
   * precise as the document is, so it may be "2022-11" where the chart says
   * only "NOVEMBER 2022"; a month-only date is read as the first of that
   * month, which can only make a document look older, never fresher.
   */
  function parseDocDay(text) {
    var s = String(text || '');
    return parseDay(/^\d{4}-\d{2}$/.test(s) ? s + '-01' : s);
  }

  /**
   * The date the "these numbers are old" warning keys off: the document's own
   * date when the chain states one, and the day a person read it when it does
   * not. Different facts -- `publishedOn` is when the chain wrote the chart,
   * `checkedOn` is when someone read it -- and only the first can say a chart
   * is from 2021.
   */
  function ageDate(chain) {
    if (!chain) return null;
    return chain.publishedOn || chain.checkedOn || null;
  }

  /**
   * Whether `day` is more than six calendar months before `today`. Calendar
   * months, through Date, not 182 days: "six months old" is what the screen
   * says, so it is what gets measured. `day` is "YYYY-MM-DD", or "YYYY-MM"
   * for a document that names only a month. Null when the date is missing or
   * not a date, which the screen also says.
   */
  function isStale(day, today) {
    var checked = parseDocDay(day);
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

  /* ---------------- allergens ---------------- */

  /*
   * Avoiding allergens at a place: what is hidden, what is shown, and what is
   * said about an item the chart is silent on. A port of LIFT iOS's
   * `RoadFoodAllergens`, which is the reference for this part (as this file is
   * the reference for the ranking), so the words and rules are its own.
   *
   * The data is what the chain's own allergen chart says an item **contains**
   * (dugcanlift-kit/data/README.md "Allergens"); "may contain" and
   * shared-fryer notes are not in it. So the rules are deliberately one-sided:
   *
   *  - An item that contains something avoided is **hidden**, and counted, so
   *    a short list is never mistaken for a short menu.
   *  - An item is **never claimed free** of an allergen the chart does not
   *    cover (`allergensCovered`; absent covers nothing) or does not state for
   *    it (no `allergens`). It stays on the list and its row says "Milk not
   *    stated" in words. A filter that hid only what it knew about and implied
   *    the rest was safe would be worse than no filter.
   *  - Nothing here says "safe". The screen says the chart is the chain's, and
   *    that cross-contact is not covered.
   */

  /** The US major allergens, in display order. */
  var ALLERGENS = ['milk', 'egg', 'fish', 'shellfish', 'tree-nuts', 'peanuts', 'wheat', 'soy', 'sesame'];

  function allergenLabel(allergen) {
    if (allergen === 'tree-nuts') return 'Tree nuts';
    var s = String(allergen || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Known strings only, in display order, once each. Anything that is not a
   *  list is nothing. */
  function knownAllergens(list) {
    if (!Array.isArray(list)) return [];
    var set = {};
    list.forEach(function (a) { if (typeof a === 'string') set[a.toLowerCase()] = true; });
    return ALLERGENS.filter(function (a) { return set[a]; });
  }

  /** An item's stated allergens, cleaned, or null when the chart says nothing
   *  about it -- which is not the same thing as `[]`. */
  function statedAllergens(item) {
    return item && Array.isArray(item.allergens) ? knownAllergens(item.allergens) : null;
  }

  // "milk, wheat, and soy": English, like the sentence it sits in.
  function joinList(list) {
    try {
      if (typeof Intl !== 'undefined' && Intl.ListFormat) {
        return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(list);
      }
    } catch (e) { /* the plain join below says the same */ }
    if (list.length < 2) return list.join('');
    if (list.length === 2) return list[0] + ' and ' + list[1];
    return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
  }

  /**
   * { kind: 'contains', list }  -- contains at least one avoided allergen: hidden.
   * { kind: 'notStated', list } -- shown; these avoided ones are not stated for it.
   * { kind: 'clear', list: [] } -- shown; the chart covers every avoided
   *                                allergen and lists none of them for it.
   * `covered` is the chain's `allergensCovered` (absent is []); `avoiding` a list.
   */
  function allergenVerdict(item, covered, avoiding) {
    var avoided = knownAllergens(avoiding);
    if (!avoided.length) return { kind: 'clear', list: [] };
    var stated = statedAllergens(item);
    if (stated) {
      var hit = avoided.filter(function (a) { return stated.indexOf(a) !== -1; });
      if (hit.length) return { kind: 'contains', list: hit };
      var cov = knownAllergens(covered);
      var unknown = avoided.filter(function (a) { return cov.indexOf(a) === -1; });
      return unknown.length ? { kind: 'notStated', list: unknown } : { kind: 'clear', list: [] };
    }
    return { kind: 'notStated', list: avoided };
  }

  /** { shown, hiddenCount }: the items left on screen, and how many were hidden. */
  function filterAllergens(items, covered, avoiding) {
    var list = (items || []).filter(Boolean);
    var shown = list.filter(function (item) {
      return allergenVerdict(item, covered, avoiding).kind !== 'contains';
    });
    return { shown: shown, hiddenCount: list.length - shown.length };
  }

  /** "Contains milk, wheat, and soy" / "Contains none of the allergens its
   *  chart lists" / null when the chart says nothing about the item. */
  function containsLine(item) {
    var stated = statedAllergens(item);
    if (!stated) return null;
    if (!stated.length) return 'Contains none of the allergens its chart lists';
    return 'Contains ' + joinList(stated.map(function (a) { return allergenLabel(a).toLowerCase(); }));
  }

  /** "Milk and egg not stated", for a shown row while something is avoided. */
  function notStatedLine(verdict) {
    if (!verdict || verdict.kind !== 'notStated' || !verdict.list.length) return null;
    var names = joinList(verdict.list.map(function (a) { return allergenLabel(a).toLowerCase(); }));
    return names.charAt(0).toUpperCase() + names.slice(1) + ' not stated';
  }

  /** The sentence under the Avoid row while something is avoided. */
  function avoidNote(hiddenCount, covered, placeName) {
    var lead = hiddenCount === 0 ? 'Nothing here is listed as containing what you avoid. '
      : hiddenCount === 1 ? '1 item is hidden because its chart says it contains something you avoid. '
        : hiddenCount + ' items are hidden because their chart says they contain something you avoid. ';
    return lead + (knownAllergens(covered).length === 0
      ? 'This place publishes no allergen chart LIFT can read, so nothing is marked either way.'
      : 'From ' + (placeName || 'the chain') + '’s own allergen chart, which doesn’t cover '
        + 'cross-contact. Check with the restaurant.');
  }

  /* What is avoided, shared by every place, on this device only: a preference
   * about this screen, like the recent chains, and not in the backup. */
  var AVOID_KEY = 'lift.roadAvoid';

  function loadAvoid(storage) {
    try {
      var raw = storage.getItem(AVOID_KEY);
      return raw ? knownAllergens(JSON.parse(raw)) : [];
    } catch (e) {
      return [];
    }
  }

  /** Avoiding nothing removes the key. Returns the list as kept. */
  function saveAvoid(avoiding, storage) {
    var list = knownAllergens(avoiding);
    try {
      if (list.length) storage.setItem(AVOID_KEY, JSON.stringify(list));
      else storage.removeItem(AVOID_KEY);
    } catch (e) { /* storage unavailable: the chips still work for this visit */ }
    return list;
  }

  /* ---------------- a meal before it is ordered ---------------- */

  /*
   * A sandwich, a side and a milk, put together at one place and totalled
   * against what is left of today. A port of LIFT iOS's `RoadFoodMeal`.
   *
   * Only an item with a calorie and a protein figure can be added: the total
   * states both, and a sum missing one item's protein would be a smaller
   * number passed off as the whole. Each item is rounded as its entry is
   * logged (`entryFor`), so the tray and the day it lands in agree. Logging
   * the meal logs each item as its own entry, so the day reads the same either
   * way and one item can be removed from it later on its own.
   *
   * A meal is a plain value, { lines: [{ id, count }] }, in the order items
   * were first added. Every function returns a new one rather than changing
   * the one it was given.
   */

  function mealEmpty() { return { lines: [] }; }

  function mealCanAdd(item) {
    return !!item && typeof item.id === 'string' && !!item.id
      && num(item.kcal) != null && num(item.proteinG) != null;
  }

  function mealLines(meal) { return meal && Array.isArray(meal.lines) ? meal.lines : []; }

  function mealAdd(meal, item) {
    var lines = mealLines(meal).map(function (l) { return { id: l.id, count: l.count }; });
    if (!mealCanAdd(item)) return { lines: lines };
    var line = lines.filter(function (l) { return l.id === item.id; })[0];
    if (line) line.count += 1;
    else lines.push({ id: item.id, count: 1 });
    return { lines: lines };
  }

  function mealRemove(meal, item) {
    var id = item && item.id;
    var lines = mealLines(meal).map(function (l) {
      return { id: l.id, count: l.id === id ? l.count - 1 : l.count };
    }).filter(function (l) { return l.count > 0; });
    return { lines: lines };
  }

  function mealCount(meal, id) {
    var line = mealLines(meal).filter(function (l) { return l.id === id; })[0];
    return line ? line.count : 0;
  }

  function mealItemCount(meal) {
    return mealLines(meal).reduce(function (t, l) { return t + l.count; }, 0);
  }

  function mealIsEmpty(meal) { return mealLines(meal).length === 0; }

  /** The items to log, one per serving, in the order they were added. An id
   *  `menu` no longer lists is dropped rather than logged as nothing. */
  function mealItems(meal, menu) {
    var out = [];
    mealLines(meal).forEach(function (l) {
      var item = (menu || []).filter(function (i) { return i && i.id === l.id; })[0];
      if (!item) return;
      for (var n = 0; n < l.count; n++) out.push(item);
    });
    return out;
  }

  /** { kcal, proteinG }, each item rounded as it is logged. */
  function mealTotal(meal, menu) {
    return mealItems(meal, menu).reduce(function (t, item) {
      return { kcal: t.kcal + Math.round(num(item.kcal) || 0),
               proteinG: t.proteinG + Math.round(num(item.proteinG) || 0) };
    }, { kcal: 0, proteinG: 0 });
  }

  /**
   * "2 items · 520 kcal · 40 g protein · fits, 380 kcal to spare", or
   * "... · 120 kcal over what is left", or "... · uses exactly what is left".
   * Said, never coloured. `remaining` is what `rank` is given, or null with no
   * goal, which leaves the last clause off. What is left is counted in whole
   * calories, truncated, as LIFT iOS's `RemainingMacros.wholeCalories` is.
   */
  function mealLine(meal, menu, remaining) {
    var total = mealTotal(meal, menu);
    var count = mealItems(meal, menu).length;
    var parts = [count === 1 ? '1 item' : count + ' items',
                 total.kcal + ' kcal', total.proteinG + ' g protein'];
    var cal = remaining && remaining.calories != null ? Number(remaining.calories) : NaN;
    if (isFinite(cal)) {
      var left = Math.trunc(cal) - total.kcal;
      if (left >= 0) parts.push(left === 0 ? 'uses exactly what is left' : 'fits, ' + left + ' kcal to spare');
      else parts.push(-left + ' kcal over what is left');
    }
    return parts.join(' · ');
  }

  global.LiftRoadFood = {
    proteinPer100: proteinPer100,
    rank: rank,
    isStale: isStale,
    parseDocDay: parseDocDay,
    ageDate: ageDate,
    withPicks: withPicks,
    pickCount: pickCount,
    rulesFor: rulesFor,
    orderChains: orderChains,
    remember: remember,
    entryFor: entryFor,
    allergens: {
      all: ALLERGENS.slice(),
      storageKey: AVOID_KEY,
      label: allergenLabel,
      known: knownAllergens,
      verdict: allergenVerdict,
      filter: filterAllergens,
      containsLine: containsLine,
      notStatedLine: notStatedLine,
      avoidNote: avoidNote,
      load: loadAvoid,
      save: saveAvoid,
    },
    meal: {
      empty: mealEmpty,
      canAdd: mealCanAdd,
      add: mealAdd,
      remove: mealRemove,
      count: mealCount,
      itemCount: mealItemCount,
      isEmpty: mealIsEmpty,
      items: mealItems,
      total: mealTotal,
      line: mealLine,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
