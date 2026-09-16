/* Saturated fat, sugar and sodium.
 *
 * Tracked and shown, never targeted: there is no goal for any of them, so
 * nothing here draws a bar or compares against a number. What matters instead
 * is honesty about coverage. A value is null when the food did not record it,
 * which is not the same as zero -- a day totalled from zeros nobody entered
 * reads as a clean day that may not have been one. So a day's total is taken
 * over only the foods that recorded each value, and says how many that was.
 *
 * Per serving wherever it sits on a food entry or a recipe, like calories. A
 * weighed entry has servings 1 and stores totals, so the same multiply works
 * for both (see food-amount.js).
 *
 * The wire shapes are coach/SHARE-FORMAT.md "Saturated fat, sugar and sodium"
 * (`fx`, `fe`) and coach/PLAN-FORMAT.md (`ux`), and the semantics match the
 * reference implementation in dugcanlift-kit-android's NutrientDetails.kt:
 * summed unrounded and rounded once, half-up, grams to one decimal and sodium
 * to whole milligrams; a recorded 0 is a value; only trailing nulls trimmed.
 *
 * Its own script, the way food-amount.js is, so node tests the rules.
 */
(function (global) {
  'use strict';

  var FIELDS = ['saturatedFatG', 'sugarG', 'sodiumMg'];

  /** A finite, non-negative number, or null. A number-looking string counts,
   *  because Open Food Facts sends both. Anything else is unrecorded. */
  function value(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v.trim()) : NaN);
    return isFinite(n) && n >= 0 ? n : null;
  }

  /** Half-up, like Java's Math.round -- which is also what JS's does. */
  function roundGrams(v) { return Math.round(v * 10) / 10; }
  function roundMilligrams(v) { return Math.round(v); }
  function roundField(field, v) { return field === 'sodiumMg' ? roundMilligrams(v) : roundGrams(v); }

  /** The three read off any object carrying them by name, null where absent. */
  function details(record) {
    var out = {};
    FIELDS.forEach(function (f) { out[f] = record ? value(record[f]) : null; });
    return out;
  }

  function isEmpty(d) {
    return !d || FIELDS.every(function (f) { return d[f] == null; });
  }

  /** `d` multiplied by `factor` and rounded once. Null fields stay null. */
  function scaled(d, factor) {
    var out = {};
    FIELDS.forEach(function (f) {
      var v = d ? value(d[f]) : null;
      out[f] = v == null ? null : roundField(f, v * factor);
    });
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
   * A day's `fx`: [saturatedFatG, sugarG, sodiumMg, foods, withSaturatedFat,
   * withSugar, withSodium]. `entries` is every food logged that day, including
   * ones that recorded none of the three -- they still count toward `foods`.
   * Null when no food recorded any, and the day then sends no `fx` at all.
   */
  function dayTotals(entries) {
    var list = (entries || []).filter(Boolean);
    var sums = [0, 0, 0];
    var counts = [0, 0, 0];
    list.forEach(function (e) {
      var servings = Number(e.servings);
      if (!(isFinite(servings) && servings > 0)) servings = 1;
      FIELDS.forEach(function (f, i) {
        var v = value(e[f]);
        if (v == null) return;
        sums[i] += v * servings;
        counts[i] += 1;
      });
    });
    if (!counts[0] && !counts[1] && !counts[2]) return null;
    return [
      counts[0] ? roundGrams(sums[0]) : null,
      counts[1] ? roundGrams(sums[1]) : null,
      counts[2] ? roundMilligrams(sums[2]) : null,
      list.length, counts[0], counts[1], counts[2],
    ];
  }

  /**
   * One `fe` entry, or a plan recipe's `ux`: [saturatedFatG, sugarG, sodiumMg]
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

  /** A day's `fe`, aligned with its `f`. Null when no entry recorded any of
   *  the three, so a day with nothing to say sends nothing. */
  function itemRows(entries) {
    var rows = (entries || []).map(row);
    return rows.some(function (r) { return r != null; }) ? rows : null;
  }

  /**
   * Reads a `ux` (or `fe`) tuple. Short tuples mean trailing nulls; slots past
   * the third are ignored. A slot holding anything but a finite non-negative
   * number or null makes the whole tuple unreadable -- a guessed-at sodium
   * figure is worse than none. Null when unreadable or all-null.
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
   * Open Food Facts nutriments on one basis (`100g` or `serving`), unrounded --
   * rounding happens once, after scaling to what was eaten.
   *
   * Open Food Facts stores `sodium_*` in GRAMS whatever the label printed, so it
   * is multiplied by 1000. A product listing only salt gets sodium from it at
   * 2.5 g of salt per 1 g of sodium, the factor EU labels and Open Food Facts
   * itself use.
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

  /** "1,840" -- whole milligrams, grouped the way the device groups them. */
  function milligramsText(v) { return roundMilligrams(v).toLocaleString(); }
  function gramsText(v) { return String(roundGrams(v)); }
  function fieldText(f, v) { return f === 'sodiumMg' ? milligramsText(v) + ' mg' : gramsText(v) + ' g'; }

  var SHORT = { saturatedFatG: 'Sat fat', sugarG: 'Sugar', sodiumMg: 'Sodium' };
  var LONG = { saturatedFatG: 'Saturated fat', sugarG: 'Sugar', sodiumMg: 'Sodium' };

  /** "Sat fat 3.1 g · Sugar 12 g · Sodium 540 mg" for what one entry counted
   *  as, naming only what is known. Empty string when none is. */
  function entryLine(entry) {
    if (!entry) return '';
    var servings = Number(entry.servings);
    if (!(isFinite(servings) && servings > 0)) servings = 1;
    var d = details(entry);
    return FIELDS.filter(function (f) { return d[f] != null; })
      .map(function (f) { return SHORT[f] + ' ' + fieldText(f, d[f] * servings); })
      .join(' · ');
  }

  /**
   * A day's rows, one per nutrient any food recorded:
   *   { label: 'Sodium', value: '1,840 mg · from 3 of 5 foods' }
   * The coverage note appears only when not every food recorded it, because a
   * total over some of the day is a floor, not the day.
   */
  function dayRows(entries) {
    var fx = dayTotals(entries);
    if (!fx) return [];
    var foods = fx[3];
    return FIELDS.map(function (f, i) {
      if (fx[i] == null) return null;
      var covered = fx[4 + i];
      return {
        label: LONG[f],
        value: fieldText(f, fx[i])
          + (covered < foods ? ' · from ' + covered + ' of ' + foods + ' food' + (foods === 1 ? '' : 's') : ''),
      };
    }).filter(Boolean);
  }

  /** A form field read back. Blank, unreadable or negative is null -- not
   *  recorded -- and never zero. */
  function parseField(text) {
    var raw = String(text == null ? '' : text).trim();
    if (raw === '') return null;
    return value(raw);
  }

  global.LiftNutrients = {
    FIELDS: FIELDS,
    value: value,
    roundGrams: roundGrams,
    roundMilligrams: roundMilligrams,
    roundField: roundField,
    details: details,
    isEmpty: isEmpty,
    scaled: scaled,
    assign: assign,
    dayTotals: dayTotals,
    row: row,
    itemRows: itemRows,
    parseRow: parseRow,
    fromOpenFoodFacts: fromOpenFoodFacts,
    entryLine: entryLine,
    dayRows: dayRows,
    parseField: parseField,
  };
})(typeof window !== 'undefined' ? window : globalThis);
