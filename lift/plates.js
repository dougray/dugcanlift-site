/* Plate math: what to put on each end of the bar for a set. A port of LIFT
 * iOS's `PlateMath.swift` (`BarKind`, `PlateSetup`, `PlateMath`), rule for rule
 * and word for word, so a lifter reads "Per side: 45 · 25" on every build.
 *
 * - **Which bar** comes from the name as well as the equipment, because the
 *   exercise data files every Smith machine lift under "machine" (and one under
 *   "barbell"), some EZ-bar curls under "barbell", and has no trap bar at all. A
 *   landmine, a T-bar row, a long-bar row and a linear jammer have one end in
 *   the floor, so "per side" means nothing for them and they get no line.
 * - **The rack** is the plates someone owns and what their bars weigh, in one
 *   unit. Unread or unreadable is the standard commercial gym, never an empty
 *   rack: an empty one would answer every set with "your plates make the bar".
 * - **The load** is the fewest plates a side that reach the weight from what
 *   is owned, then the heavier plates first. Not greedy: greedy takes the
 *   biggest plate first, and with a limited rack that can miss a load the rack
 *   can make (45 + 15 from no 15s, when two 30s were right there). When nothing
 *   owned reaches it exactly, the heaviest load under it, and how far short.
 *
 * What differs from iOS, because this build's data does: **pounds only.** This
 * build weighs everything in pounds (`weightLb`, no unit setting), so it keeps
 * one rack, the pound one, under `lift.plateSetup.pounds`. `standard('kg')` is
 * iOS's kilogram rack, kept so the rule's tests are the same tests, and never
 * reached from the screen. Like iOS, the rack is the one weight stored in the
 * unit stamped on the plate: a 45 stays 45. It is a preference about this
 * device, like `lift.perSide`, and is not in the backup.
 */
(function (global) {
  'use strict';

  var BARS = [
    { id: 'barbell', displayName: 'Barbell' },
    { id: 'ezBar', displayName: 'EZ bar' },
    { id: 'trapBar', displayName: 'Trap bar' },
    { id: 'smith', displayName: 'Smith machine' },
  ];
  var MOST_PAIRS = 20;
  /** Every plate is a whole number of these, in either unit (1.25, 0.5). */
  var STEP = 0.25;

  /* ---------------- which bar ---------------- */

  /** Lowercased, punctuation to spaces, padded so a phrase matches whole words
   *  only: "EZ-Bar" and "e-z curl bar" both become " ez bar ". */
  function normalised(text) {
    var out = String(text || '').toLowerCase()
      .split('e-z').join('ez')
      .split('ezbar').join('ez bar')
      .replace(/[^\p{L}\p{N}]/gu, ' ');
    out = out.split(' ').filter(Boolean).join(' ');
    return ' ' + out + ' ';
  }

  /** The bar a lift is loaded on: "barbell", "ezBar", "trapBar", "smith", or
   *  null for anything not loaded with plates on both ends of a bar. */
  function barOf(name, equipment) {
    var words = normalised(String(name || '') + ' ' + String(equipment || ''));
    var oneEnded = [' landmine ', ' t bar ', ' long bar ', ' linear jammer '];
    if (oneEnded.some(function (w) { return words.indexOf(w) >= 0; })) return null;
    if (words.indexOf(' smith ') >= 0) return 'smith';
    if (words.indexOf(' trap bar ') >= 0 || words.indexOf(' hex bar ') >= 0) return 'trapBar';
    if (words.indexOf(' ez bar ') >= 0 || words.indexOf(' ez curl ') >= 0) return 'ezBar';
    if (normalised(equipment).indexOf(' barbell ') >= 0) return 'barbell';
    return null;
  }

  function barName(bar) {
    var found = BARS.filter(function (b) { return b.id === bar; })[0];
    return found ? found.displayName : '';
  }

  /* ---------------- the rack ---------------- */

  /** A commercial gym: plenty of every common plate, none of the fractional
   *  ones, which are there to be switched on. Plates heaviest first. */
  function standard(unit) {
    var plenty = 10;
    var plate = function (pairs) { return function (w) { return { weight: w, pairs: pairs }; }; };
    if (unit === 'kg') {
      return {
        plates: [25, 20, 15, 10, 5, 2.5, 1.25].map(plate(plenty)).concat([{ weight: 0.5, pairs: 0 }]),
        bars: { barbell: 20, ezBar: 10, trapBar: 20, smith: 7 },
      };
    }
    return {
      plates: [45, 35, 25, 10, 5, 2.5].map(plate(plenty)).concat([{ weight: 1.25, pairs: 0 }]),
      bars: { barbell: 45, ezBar: 25, trapBar: 45, smith: 15 },
    };
  }

  function barWeight(setup, bar) {
    var w = setup && setup.bars ? setup.bars[bar] : null;
    return typeof w === 'number' && isFinite(w) ? w : 0;
  }

  function setBar(setup, bar, weight) {
    var w = Number(weight);
    setup.bars[bar] = isFinite(w) ? Math.max(0, w) : 0;
  }

  function pairsOf(setup, weight) {
    var found = setup.plates.filter(function (p) { return p.weight === weight; })[0];
    return found ? found.pairs : 0;
  }

  /** A weight not on the rack yet is added to it, in order. */
  function setPairs(setup, pairs, weight) {
    var n = Math.min(Math.max(0, Math.round(Number(pairs) || 0)), MOST_PAIRS);
    var found = setup.plates.filter(function (p) { return p.weight === weight; })[0];
    if (found) {
      found.pairs = n;
    } else if (weight > 0) {
      setup.plates.push({ weight: weight, pairs: n });
      setup.plates.sort(function (a, b) { return b.weight - a.weight; });
    }
  }

  function key(unit) { return 'lift.plateSetup.' + (unit === 'kg' ? 'kilograms' : 'pounds'); }

  /** A setup read back from storage, or null when it is not one. */
  function valid(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.plates)
        || !raw.bars || typeof raw.bars !== 'object') return null;
    var plates = [];
    for (var i = 0; i < raw.plates.length; i++) {
      var p = raw.plates[i];
      if (!p || typeof p.weight !== 'number' || !isFinite(p.weight)
          || typeof p.pairs !== 'number' || !isFinite(p.pairs)) return null;
      plates.push({ weight: p.weight, pairs: p.pairs });
    }
    var bars = {};
    Object.keys(raw.bars).forEach(function (k) {
      if (typeof raw.bars[k] === 'number' && isFinite(raw.bars[k])) bars[k] = raw.bars[k];
    });
    return { plates: plates, bars: bars };
  }

  /** Unread or unreadable is the standard rack, never an empty one. */
  function load(unit, storage) {
    try {
      var raw = storage.getItem(key(unit));
      var setup = raw ? valid(JSON.parse(raw)) : null;
      return setup || standard(unit);
    } catch (e) {
      return standard(unit);
    }
  }

  function save(setup, unit, storage) {
    try { storage.setItem(key(unit), JSON.stringify(setup)); } catch (e) { /* full: keep going */ }
  }

  /* ---------------- the load ---------------- */

  /** Fewer plates, then the heavier plates first. */
  function better(candidate, current) {
    if (!current) return true;
    if (candidate.length !== current.length) return candidate.length < current.length;
    var a = candidate.slice().sort(function (x, y) { return y - x; });
    var b = current.slice().sort(function (x, y) { return y - x; });
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
  }

  /**
   * What `total` (in the setup's own unit, bar included) loads:
   *   { kind: 'nothing' }             no weight
   *   { kind: 'lighterThanTheBar' }
   *   { kind: 'justTheBar' }
   *   { kind: 'plates', perSide, total, shortBy }   perSide heaviest first;
   *                                   total is what that loads, bar included.
   */
  function loadFor(totalIn, bar, setup) {
    var total = Math.round(Number(totalIn) * 100) / 100;
    if (!(total > 0)) return { kind: 'nothing' };
    var barW = barWeight(setup, bar);
    if (total < barW) return { kind: 'lighterThanTheBar' };
    if (total === barW) return { kind: 'justTheBar' };

    var owned = setup.plates
      .filter(function (p) { return p.pairs > 0 && p.weight > 0; })
      .map(function (p) { return { units: Math.round(p.weight / STEP), pairs: p.pairs }; });
    // No more than the rack holds, so the search is sized by the plates and
    // not by whatever was typed: 100000000 lb is still a few thousand steps.
    var capacity = owned.reduce(function (sum, p) { return sum + p.units * p.pairs; }, 0);
    var wanted = (total - barW) / 2 / STEP + 1e-6;
    var target = wanted >= capacity ? capacity : Math.floor(wanted);

    // fewest[v]: the fewest plates making exactly v steps a side, with the
    // list that does it. Bounded by the pairs owned.
    var fewest = new Array(target + 1).fill(null);
    fewest[0] = [];
    owned.forEach(function (plate) {
      if (plate.units > target) return;
      var next = fewest.slice();
      for (var value = 0; value <= target; value++) {
        var base = fewest[value];
        if (!base) continue;
        for (var count = 1; count <= plate.pairs; count++) {
          var reached = value + count * plate.units;
          if (reached > target) break;
          var candidate = base.concat(new Array(count).fill(plate.units));
          if (better(candidate, next[reached])) next[reached] = candidate;
        }
      }
      fewest = next;
    });

    // Something is always reachable: nothing at all, which is the bar.
    var got = 0;
    for (var v = target; v >= 0; v--) { if (fewest[v]) { got = v; break; } }
    var perSide = (fewest[got] || []).slice().sort(function (x, y) { return y - x; })
      .map(function (u) { return u * STEP; });
    var loaded = barW + 2 * got * STEP;
    return { kind: 'plates', perSide: perSide, total: loaded,
             shortBy: Math.round((total - loaded) * 100) / 100 };
  }

  /** "45", "2.5", "1.25": whole numbers bare, otherwise trailing zeros off. */
  function text(value) {
    if (value === Math.round(value)) return String(Math.round(value));
    var t = value.toFixed(2);
    while (t.charAt(t.length - 1) === '0') t = t.slice(0, -1);
    return t;
  }

  /** The line under a set, or null for nothing to say. `unit` is the
   *  abbreviation, "lb" or "kg". */
  function line(load, unit) {
    switch (load && load.kind) {
      case 'lighterThanTheBar': return 'Lighter than the bar';
      case 'justTheBar': return 'Just the bar';
      case 'plates': {
        var plates = load.perSide.length
          ? 'Per side: ' + load.perSide.map(text).join(' · ') : 'Just the bar';
        if (!(load.shortBy > 0)) return plates;
        return 'Your plates make ' + text(load.total) + ' ' + unit + ', '
          + text(load.shortBy) + ' short. ' + plates;
      }
      default: return null;
    }
  }

  /** "Per side: 45 · 25" for a set of `weightLb` on a lift called `name` on
   *  `equipment`, from the pound rack `setup`; null when it is not a bar lift
   *  or has no weight. */
  function setLine(name, equipment, weightLb, setup) {
    var bar = barOf(name, equipment);
    if (!bar || weightLb == null || !isFinite(weightLb)) return null;
    return line(loadFor(weightLb, bar, setup), 'lb');
  }

  global.LiftPlates = {
    BARS: BARS,
    MOST_PAIRS: MOST_PAIRS,
    barOf: barOf,
    barName: barName,
    standard: standard,
    barWeight: barWeight,
    setBar: setBar,
    pairsOf: pairsOf,
    setPairs: setPairs,
    key: key,
    load: load,
    save: save,
    loadFor: loadFor,
    text: text,
    line: line,
    setLine: setLine,
  };
})(typeof window !== 'undefined' ? window : globalThis);
