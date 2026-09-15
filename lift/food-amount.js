/* Logging food by weight.
 *
 * The native apps switched to gram-based logging; this is the browser build
 * catching up, and the contract is theirs rather than a new one:
 *
 *   When `amountGrams` is set, `servings` is always 1 and the stored
 *   calories/proteinG/etc are already the TOTALS for that amount.
 *
 * That matters because `totals()` multiplies every entry by its servings. An
 * entry logged by weight has servings 1, so its stored totals pass through
 * untouched — which is exactly why the two representations can live in one
 * list without a flag anywhere else in the app.
 *
 * Kept as its own script, the way watch-scan.js is, so the arithmetic can be
 * tested by node instead of only by eye. Someone's calorie log is the output.
 */
(function (global) {
  'use strict';

  var GRAMS_PER_OUNCE = 28.3495;

  /** Mirrors ServingUnit in LIFT iOS and LIFT Android. Grams are canonical. */
  var UNITS = {
    g: { abbreviation: 'g', toGrams: function (v) { return v; },
         fromGrams: function (g) { return g; } },
    oz: { abbreviation: 'oz', toGrams: function (v) { return v * GRAMS_PER_OUNCE; },
          fromGrams: function (g) { return g / GRAMS_PER_OUNCE; } },
  };

  var FIELDS = ['calories', 'proteinG', 'fatG', 'carbsG', 'fiberG'];

  /**
   * Totals for `grams` of a food whose macros are given per 100 g.
   *
   * Rounded once, at the end, the way a label would read. Rounding each
   * field's per-gram value first and multiplying after drifts by enough to
   * matter over a day of entries.
   *
   * A non-finite or non-positive amount returns null rather than zeroes: a
   * zero nobody entered is worse than no entry at all, and the caller's job
   * is to refuse to save.
   */
  function scaleFrom100g(per100, grams) {
    if (!per100 || !isFinite(grams) || grams <= 0) return null;
    var factor = grams / 100;
    var out = {};
    FIELDS.forEach(function (field) {
      var value = Number(per100[field]);
      out[field] = Math.round((isFinite(value) ? value : 0) * factor);
    });
    return out;
  }

  /**
   * What a logged entry's amount reads as. Entries logged by weight show the
   * weight; older serving-based ones keep showing their multiplier, because
   * there is no honest way to turn a serving into grams after the fact.
   */
  function amountText(entry, unitKey) {
    if (!entry) return '';
    var unit = UNITS[unitKey] || UNITS.g;
    if (entry.amountGrams == null) {
      return entry.servings === 1 ? '' : 'x' + trim(entry.servings);
    }
    return trim(unit.fromGrams(entry.amountGrams)) + ' ' + unit.abbreviation;
  }

  /** One decimal at most, and never a trailing ".0". */
  function trim(value) {
    var n = Number(value);
    if (!isFinite(n)) return '0';
    var rounded = Math.round(n * 10) / 10;
    return String(rounded);
  }

  global.FoodAmount = {
    GRAMS_PER_OUNCE: GRAMS_PER_OUNCE,
    UNITS: UNITS,
    FIELDS: FIELDS,
    scaleFrom100g: scaleFrom100g,
    amountText: amountText,
    trim: trim,
  };
})(typeof window !== 'undefined' ? window : globalThis);
