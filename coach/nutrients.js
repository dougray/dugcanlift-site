/* Saturated fat, sugar and sodium, for LIFT Coach.
 *
 * Tracked and shown, never targeted: there is no goal for any of them, so
 * nothing here draws a bar or compares against a number. A nutrient nobody
 * recorded produces no line at all rather than a zero or a dash.
 *
 * What matters instead is honesty about coverage. A value is null when a food
 * did not record it, which is not zero. A day's total covers only the foods
 * that recorded it and says how many that was, because a partial total is a
 * floor, not a day.
 *
 * Wire shapes: SHARE-FORMAT.md "Saturated fat, sugar and sodium" (`fx`, `fe`)
 * and PLAN-FORMAT.md (`ux`). The rounding, trimming and Open Food Facts rules
 * are LIFT web's lift/nutrients.js; the display strings and the averaging rule
 * are Coach Android's ui/NutrientDisplay.kt and Stats.nutrientAverages. Where
 * those change, change this to match rather than the other way round.
 *
 * Stored shapes in this app:
 *   day.nutrientTotals  { saturatedFatG, sugarG, sodiumMg, foods,
 *                         withSaturatedFat, withSugar, withSodium }
 *                       -- a day's `fx` exactly as sent (Coach Android's
 *                       names). Absent when nothing was recorded.
 *   day.food[i]         saturatedFatG / sugarG / sodiumMg PER SERVING, each
 *                       key absent when unknown -- the same basis as that
 *                       entry's own calories, which this app also stores per
 *                       serving and multiplies by `servings` on screen.
 *   recipe.nutritionPerServing  the three, per serving, absent when unknown.
 *
 * Its own script, like route.js, so node tests it (nutrients.test.mjs).
 */
(function (global) {
  'use strict';

  var FIELDS = ['saturatedFatG', 'sugarG', 'sodiumMg'];
  var COVERAGE = { saturatedFatG: 'withSaturatedFat', sugarG: 'withSugar', sodiumMg: 'withSodium' };
  var LABEL = { saturatedFatG: 'Saturated fat', sugarG: 'Sugar', sodiumMg: 'Sodium' };
  var SHORT = { saturatedFatG: 'Sat fat', sugarG: 'Sugar', sodiumMg: 'Sodium' };

  /** A finite, non-negative number, or null. A number-looking string counts,
   *  because Open Food Facts sends both. Anything else is unrecorded. */
  function value(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v.trim()) : NaN);
    return isFinite(n) && n >= 0 ? n : null;
  }

  /** Half-up: grams to one decimal, sodium to whole milligrams. */
  function roundGrams(v) { return Math.round(v * 10) / 10; }
  function roundMilligrams(v) { return Math.round(v); }
  function roundField(field, v) { return field === 'sodiumMg' ? roundMilligrams(v) : roundGrams(v); }

  function count(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  }

  /* ---------------- reading the wire ---------------- */

  /**
   * A day's `fx` -> the stored totals object, or null. Kept exactly as sent:
   * the totals are already as eaten and rounded by the sender, and nothing is
   * re-added from the foods, not even on an itemised day. A total that is not
   * a finite non-negative number is unknown; a tuple with no known total is
   * no totals at all.
   */
  function readDayTotals(fx) {
    if (!Array.isArray(fx)) return null;
    var out = {
      saturatedFatG: value(typeof fx[0] === 'number' ? fx[0] : null),
      sugarG: value(typeof fx[1] === 'number' ? fx[1] : null),
      sodiumMg: value(typeof fx[2] === 'number' ? fx[2] : null),
      foods: count(fx[3]),
      withSaturatedFat: count(fx[4]),
      withSugar: count(fx[5]),
      withSodium: count(fx[6]),
    };
    return isEmpty(out) ? null : out;
  }

  /**
   * Reads one `fe` entry, or a plan recipe's `ux`. Short tuples mean trailing
   * nulls; slots past the third are ignored. A slot holding anything but a
   * finite non-negative number or null makes the whole tuple unreadable -- a
   * guessed-at sodium figure is worse than none. Null when unreadable or
   * all-null.
   */
  function parseRow(tuple) {
    if (!Array.isArray(tuple)) return null;
    var out = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var slot = tuple[i];
      if (slot === null || slot === undefined) { out[FIELDS[i]] = null; continue; }
      if (typeof slot !== 'number' || !isFinite(slot) || slot < 0) return null;
      out[FIELDS[i]] = slot;
    }
    return isEmpty(out) ? null : out;
  }

  /**
   * A day's `fe`, one details object (or null) per `f` entry. `fe` is sent
   * aligned with `f`; one whose length does not match cannot say which food a
   * value belongs to, and putting sodium on the wrong food is worse than
   * dropping it, so it is ignored whole.
   */
  function readItems(fe, foodCount) {
    if (!Array.isArray(fe) || fe.length !== foodCount) return null;
    return fe.map(parseRow);
  }

  /* ---------------- records ---------------- */

  function isEmpty(d) {
    return !d || FIELDS.every(function (f) { return value(d[f]) == null; });
  }

  /** The three read off any object carrying them by name, null where absent. */
  function details(record) {
    var out = {};
    FIELDS.forEach(function (f) { out[f] = record ? value(record[f]) : null; });
    return out;
  }

  /** Writes the known fields onto `target` and deletes the unknown ones, so a
   *  stored record never carries a null or a zero it did not have. */
  function assign(target, d) {
    FIELDS.forEach(function (f) {
      var v = d ? value(d[f]) : null;
      if (v == null) delete target[f];
      else target[f] = v;
    });
    return target;
  }

  /**
   * PLAN-FORMAT's `ux` (and one `fe` entry): [saturatedFatG, sugarG, sodiumMg]
   * per serving, rounded, trailing nulls trimmed. Null when none is known.
   * Only trailing nulls go -- a leading null holds its slot, or sugar would
   * slide into saturated fat.
   */
  function row(record) {
    var d = details(record);
    if (isEmpty(d)) return null;
    var out = FIELDS.map(function (f) { return d[f] == null ? null : roundField(f, d[f]); });
    while (out.length && out[out.length - 1] == null) out.pop();
    return out;
  }

  /**
   * Open Food Facts nutriments on one basis (`100g` or `serving`), unrounded.
   * Open Food Facts stores `sodium_*` in GRAMS whatever the label printed, so
   * it is multiplied by 1000. A product listing only salt gets sodium from it
   * at 2.5 g of salt per 1 g of sodium.
   */
  function fromOpenFoodFacts(nutriments, suffix) {
    var n = nutriments || {};
    var sodium = value(n['sodium_' + suffix]);
    if (sodium == null) {
      var salt = value(n['salt_' + suffix]);
      if (salt != null) sodium = salt / 2.5;
    }
    return {
      saturatedFatG: value(n['saturated-fat_' + suffix]),
      sugarG: value(n['sugars_' + suffix]),
      sodiumMg: sodium == null ? null : sodium * 1000,
    };
  }

  /** A form field read back. Blank, unreadable or negative is null -- not
   *  recorded -- and never zero. */
  function parseField(text) {
    var raw = String(text == null ? '' : text).trim();
    return raw === '' ? null : value(raw);
  }

  /* ---------------- ingredient tally ---------------- */

  function emptyTally() {
    return { lines: 0, sums: { saturatedFatG: 0, sugarG: 0, sodiumMg: 0 },
      recorded: { saturatedFatG: 0, sugarG: 0, sodiumMg: 0 } };
  }

  /** Adds one looked-up ingredient's contribution (null where the source did
   *  not record a value). */
  function addToTally(tally, contribution) {
    FIELDS.forEach(function (f) {
      var v = contribution ? value(contribution[f]) : null;
      if (v == null) return;
      tally.sums[f] += v;
      tally.recorded[f] += 1;
    });
    tally.lines += 1;
    return tally;
  }

  /**
   * Per serving, rounded, for each nutrient EVERY looked-up ingredient
   * recorded; null for the rest (LIFT web's rule). A sodium figure from two of
   * five ingredients is a floor, and written into a recipe's per-serving field
   * it would read as the whole dish.
   */
  function tallyPerServing(tally, servings) {
    var s = Number(servings);
    if (!(isFinite(s) && s > 0)) s = 1;
    var out = {};
    FIELDS.forEach(function (f) {
      out[f] = tally && tally.lines && tally.recorded[f] === tally.lines
        ? roundField(f, tally.sums[f] / s)
        : null;
    });
    return out;
  }

  /* ---------------- display ---------------- */

  /** "21.5 g", "12 g", "1,840 mg". Grams to one decimal with ".0" dropped,
   *  milligrams whole and grouped. `locale` is for tests; the screen uses the
   *  device's, as every other number in this app does. */
  function amountText(field, v, locale) {
    if (field === 'sodiumMg') return roundMilligrams(v).toLocaleString(locale) + ' mg';
    return String(roundGrams(v)) + ' g';
  }

  /**
   * One day's lines, one per recorded nutrient:
   *   { label: 'Sodium', value: '1,840 mg · from 3 of 5 foods',
   *     text: 'Sodium 1,840 mg · from 3 of 5 foods' }
   * The coverage note appears only when the total covers fewer than all of the
   * day's foods.
   */
  function dayLines(totals, locale) {
    if (!totals) return [];
    return FIELDS.map(function (f) {
      var total = value(totals[f]);
      if (total == null) return null;
      var covered = count(totals[COVERAGE[f]]);
      var foods = count(totals.foods);
      var v = amountText(f, total, locale)
        + (covered < foods ? ' · from ' + covered + ' of ' + foods + ' foods' : '');
      return { label: LABEL[f], value: v, text: LABEL[f] + ' ' + v };
    }).filter(Boolean);
  }

  /**
   * The mean daily total of each nutrient over `totalsList` (the stored totals
   * of the days in a window, missing days simply absent), counting ONLY days
   * that recorded that nutrient -- a day with no sodium is not a zero-sodium
   * day. A nutrient no day recorded is left out, not averaged to zero. A
   * partial day still counts, as the floor it is, and `partialDays` says how
   * many there were.
   */
  function averages(totalsList) {
    var list = (totalsList || []).filter(Boolean);
    return FIELDS.map(function (f) {
      var recorded = list.filter(function (t) { return value(t[f]) != null; });
      if (!recorded.length) return null;
      var sum = recorded.reduce(function (acc, t) { return acc + value(t[f]); }, 0);
      return {
        field: f,
        perDay: sum / recorded.length,
        days: recorded.length,
        partialDays: recorded.filter(function (t) { return count(t[COVERAGE[f]]) < count(t.foods); }).length,
      };
    }).filter(Boolean);
  }

  /** "Sodium 2,105 mg a day · 4 days, 1 from only some foods" -- how many days
   *  is always said, because an average of two days and of seven otherwise
   *  read the same. */
  function averageLine(average, locale) {
    var days = average.days === 1 ? '1 day' : average.days + ' days';
    var partial = average.partialDays > 0 ? ', ' + average.partialDays + ' from only some foods' : '';
    var v = amountText(average.field, average.perDay, locale) + ' a day · ' + days + partial;
    return { label: LABEL[average.field], value: v, text: LABEL[average.field] + ' ' + v };
  }

  /** "Sat fat 3.1 g · Sugar 12 g · Sodium 540 mg" for what one stored food
   *  entry counted as (per serving × servings). Empty when none is known. */
  function foodLine(entry, locale) {
    if (!entry) return '';
    var servings = Number(entry.servings);
    if (!(isFinite(servings) && servings > 0)) servings = 1;
    var d = details(entry);
    return FIELDS.filter(function (f) { return d[f] != null; })
      .map(function (f) { return SHORT[f] + ' ' + amountText(f, d[f] * servings, locale); })
      .join(' · ');
  }

  global.CoachNutrients = {
    FIELDS: FIELDS,
    LABEL: LABEL,
    value: value,
    roundField: roundField,
    readDayTotals: readDayTotals,
    parseRow: parseRow,
    readItems: readItems,
    isEmpty: isEmpty,
    details: details,
    assign: assign,
    row: row,
    fromOpenFoodFacts: fromOpenFoodFacts,
    parseField: parseField,
    emptyTally: emptyTally,
    addToTally: addToTally,
    tallyPerServing: tallyPerServing,
    amountText: amountText,
    dayLines: dayLines,
    averages: averages,
    averageLine: averageLine,
    foodLine: foodLine,
  };
})(typeof window !== 'undefined' ? window : globalThis);
