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

  /* Editing a logged entry.
   *
   * A weighed entry stores totals, and the form reads per 100 g, so opening
   * one for editing has to run the arithmetic backwards -- and the stored
   * totals are already rounded, so going back and forth is not exact. 175 g of
   * chicken at 125 kcal per 100 g is stored as 219; 219 back to per 100 g is
   * 125.1, shown as 125, which is 219 again here but is not always.
   *
   * So a field left as it was prefilled is scaled from the entry's own stored
   * total, never from the rounded per-100 g figure on screen: pressing Save on
   * an untouched entry changes nothing, and changing only the amount scales
   * each total by exactly the ratio of the weights. A field the person actually
   * changed is read as per 100 g, the same as the add form.
   *
   * Blank stays blank. A macro the entry never had -- fibre is the usual one,
   * from a food whose label did not say -- prefills blank and saves absent,
   * not as a zero nobody measured. A field that had a value and was cleared
   * saves as 0, which is what a blank means on the add form. Calories blank
   * refuses the save, also as the add form does.
   */

  function isNumber(value) {
    return value !== null && value !== undefined && value !== ''
      && isFinite(Number(value));
  }

  /** Per-100 g values to prefill for a weighed entry, whole numbers the way
   *  the form reads them, null where the entry has no value. Null for an
   *  entry that was not logged by weight. */
  function per100From(entry) {
    if (!entry || !(Number(entry.amountGrams) > 0)) return null;
    var out = {};
    FIELDS.forEach(function (field) {
      out[field] = isNumber(entry[field])
        ? Math.round(Number(entry[field]) * 100 / Number(entry.amountGrams))
        : null;
    });
    return out;
  }

  /** The macro fields to write back for a weighed entry. `typed` holds the
   *  form's per-100 g values, null where blank. Null when the save must be
   *  refused. */
  function editWeighed(entry, typed, grams) {
    var before = per100From(entry);
    if (!before || !typed || typed.calories == null
        || !isFinite(grams) || grams <= 0) return null;
    var ratio = grams / Number(entry.amountGrams);
    var out = {};
    FIELDS.forEach(function (field) {
      var value = typed[field];
      var stored = entry[field];
      if (value == null) {
        out[field] = isNumber(stored) ? 0 : stored;
      } else if (isNumber(stored) && value === before[field]) {
        out[field] = Math.round(Number(stored) * ratio);
      } else {
        out[field] = Math.round(value * grams / 100);
      }
    });
    return out;
  }

  /** The weight an edit form's amount means, in grams. Amounts show at one
   *  decimal, so 350 g reads as 12.3 oz, and 12.3 oz is 348.7 g: an ounce
   *  user who opens an entry and saves it untouched would quietly lose two
   *  calories. So while the amount still reads exactly as the entry's own
   *  weight would in that unit, it IS the entry's weight. Null when the text
   *  is not a positive number. */
  function editedGrams(entry, text, unitKey) {
    var unit = UNITS[unitKey] || UNITS.g;
    var entered = parseFloat(text);
    if (!isFinite(entered) || entered <= 0) return null;
    var stored = entry ? Number(entry.amountGrams) : NaN;
    if (stored > 0 && String(text).trim() === trim(unit.fromGrams(stored))) return stored;
    return unit.toGrams(entered);
  }

  /** The same for an older serving-based entry, whose fields are already per
   *  serving and whose amount is a count of servings, not a weight. Nothing
   *  is converted; there is no honest way to turn a serving into grams. */
  function editServings(entry, typed, servings) {
    if (!entry || !typed || typed.calories == null
        || !isFinite(servings) || servings <= 0) return null;
    var out = { servings: servings };
    FIELDS.forEach(function (field) {
      var value = typed[field];
      var stored = entry[field];
      if (value == null) out[field] = isNumber(stored) ? 0 : stored;
      else out[field] = value;
    });
    return out;
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
    per100From: per100From,
    editWeighed: editWeighed,
    editedGrams: editedGrams,
    editServings: editServings,
    trim: trim,
  };
})(typeof window !== 'undefined' ? window : globalThis);
