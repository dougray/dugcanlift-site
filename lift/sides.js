/* Left and right, for lifts that have two of them.
 *
 * A set may record a side: left, right, or both. **Absent means both**, which
 * is what every set logged before this file already meant, so nothing stored
 * today changes meaning and nothing is rewritten on load. "both" is never
 * written out and a side is never defaulted to left -- an unmarked set is an
 * unmarked set.
 *
 * A lift's identity becomes name + equipment + side wherever sets are grouped
 * or charted, for the same reason equipment is already in it: a left-arm row
 * and a right-arm row are not the same lift, and averaging them hides the one
 * thing you are looking at them for.
 *
 * Kept as its own script, like backup.js and routines.js, so node tests the
 * rules instead of an eye -- the imbalance maths especially, which decides a
 * number a person will read about their own body.
 *
 * Tracked and shown, never targeted. Nothing here says what a gap means; that
 * is a trainer's job, and a 10% difference is ordinary in most people.
 *
 * The wire rules (coach/SHARE-FORMAT.md, coach/BACKUP-FORMAT.md):
 *
 *   share link   the set tuple's `flags` field, bits 1-2: 0 both, 1 left,
 *                2 right, alongside bit 0 = warmup. No new positions, so a
 *                decoder that has never heard of sides still reads the weight
 *                and the reps -- it just cannot say which side they were. That
 *                is the correct way for this to degrade.
 *   backup file  a named field, `side: "left" | "right"`, omitted when both.
 *                Named rather than packed because a backup is read by humans
 *                and by three platforms, and has to survive a reader that does
 *                not know the field.
 *   plan link    unchanged in v1: a coach prescribes as before and the lifter
 *                chooses sides when logging.
 */
(function (global) {
  'use strict';

  var LEFT = 'left';
  var RIGHT = 'right';

  /* Bits 1-2 of the set tuple's flags. Bit 0 is warmup and is not ours. */
  var WARMUP_BIT = 1;
  var SIDE_SHIFT = 1;
  var SIDE_MASK = 6;          // 0b110
  var SIDE_BITS = { left: 1, right: 2 };

  /**
   * The side a set records, or null for both. Anything that is not exactly
   * "left" or "right" -- absent, empty, "both", a stray "L", junk from a file
   * another app wrote -- is both, because both is the only safe reading of a
   * set whose side nobody stated.
   */
  function of(set) {
    var raw = set && typeof set === 'object' ? set.side : set;
    if (typeof raw !== 'string') return null;
    var v = raw.trim().toLowerCase();
    return v === LEFT || v === RIGHT ? v : null;
  }

  /** "L", "R", or "" for a set with no side. */
  function label(side) {
    var v = of(side);
    return v === LEFT ? 'L' : v === RIGHT ? 'R' : '';
  }

  /* Names that usually mean one limb at a time, as LIFT for Android's
   * `PerSideLogging.UNILATERAL_TERMS` lists them, term for term.
   *
   * Matched as whole words against a name with everything that is not a letter
   * or a digit turned into a space, so "Single-Arm", "Single Arm", "single_arm"
   * and "1-Arm" are one term. Both the singular and the plural are listed
   * rather than matched by prefix, because a plain substring rule fires on the
   * inside of a longer word: "lunge" ticks a cold plunge, and "step" would tick
   * a stepmill. */
  var UNILATERAL_TERMS = [
    'single arm', 'one arm', '1 arm', 'single handed',
    'single leg', 'one leg', '1 leg', 'single limb',
    // "One-Legged Deadlift" is the same lift as "One-Leg Deadlift"; whole-word
    // matching does not see the shorter term inside the longer word, so both
    // spellings are listed. Android's list carries these too.
    'one legged', 'single legged', 'one armed', 'single armed',
    'bulgarian', 'split squat', 'split squats',
    'pistol', 'pistols', 'lunge', 'lunges',
    'step up', 'step ups', 'stepup', 'stepups',
    'unilateral',
  ];

  /** Letters and digits only, single-spaced, padded so a term matches as whole words. */
  function normaliseName(name) {
    var cleaned = String(name == null ? '' : name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
    return ' ' + cleaned.trim() + ' ';
  }

  /**
   * Whether a name reads as a lift with a side to it. A guess, and only ever
   * used to pre-tick the per-exercise toggle: the bundled exercise list has no
   * "unilateral" field, plenty of one-armed work is not named for it ("Dumbbell
   * Row"), and plenty of people do a lunge with a barbell on their back and
   * count it as one set. The lifter's own choice is what sticks.
   *
   * It is allowed to be wrong in both directions. It decides where a toggle
   * starts and nothing else, and it never reads or writes a set.
   */
  function looksUnilateral(name) {
    var padded = normaliseName(name);
    return UNILATERAL_TERMS.some(function (term) { return padded.indexOf(' ' + term + ' ') !== -1; });
  }

  /** How many of these sets are left, right and unmarked. */
  function countsIn(sets) {
    var out = { left: 0, right: 0, both: 0 };
    (sets || []).forEach(function (s) {
      var side = of(s);
      if (side === LEFT) out.left += 1;
      else if (side === RIGHT) out.right += 1;
      else out.both += 1;
    });
    return out;
  }

  /** Whether any of these sets records a side at all. */
  function anySided(sets) {
    return (sets || []).some(function (s) { return of(s) !== null; });
  }

  /**
   * Which side to offer next: whichever has fewer sets logged so far, so
   * tapping Add set repeatedly alternates on its own. A tie goes left, which
   * makes the first set of the day left and the second right.
   */
  function nextSide(sets) {
    var c = countsIn(sets);
    return c.left <= c.right ? LEFT : RIGHT;
  }

  /** "L 3 · R 2", so a missed side is obvious. Empty when nothing is sided. */
  function countsLabel(sets) {
    if (!anySided(sets)) return '';
    var c = countsIn(sets);
    var text = 'L ' + c.left + ' · R ' + c.right;
    // Sets logged before the toggle went on are still in this exercise and
    // still real. Saying so beats quietly leaving them out of the count.
    return c.both ? text + ' · ' + c.both + ' both' : text;
  }

  /**
   * The grouping key: name, equipment and side. `matchKey` in app.js is the
   * first two, and this is that plus the third -- the whole point being that
   * L and R never land in the same series.
   */
  function key(name, equipment, side) {
    var base = String(name == null ? '' : name).trim()
      + '|' + String(equipment == null ? '' : equipment).trim();
    return (base + '|' + (of(side) || '')).toLowerCase();
  }

  /** Just the sets on one side. `null` asks for the unmarked ones. */
  function onSide(sets, side) {
    var want = of(side);
    return (sets || []).filter(function (s) { return of(s) === want; });
  }

  /* ---------------- the wire ---------------- */

  /** The `flags` field for a set: warmup in bit 0, side in bits 1-2. */
  function flagsOf(set) {
    var side = of(set);
    var flags = set && set.warmup ? WARMUP_BIT : 0;
    return flags | ((SIDE_BITS[side] || 0) << SIDE_SHIFT);
  }

  /** The side bits 1-2 of a flags field say, or null for both. */
  function sideFromFlags(flags) {
    var bits = ((Number(flags) || 0) & SIDE_MASK) >> SIDE_SHIFT;
    if (bits === SIDE_BITS.left) return LEFT;
    if (bits === SIDE_BITS.right) return RIGHT;
    // 3 is not a side. A reader inventing one from a bit pattern nobody
    // defined would be worse than reading it as an ordinary set.
    return null;
  }

  /**
   * One set as SHARE-FORMAT's tuple:
   * `[weightLb, reps, rpe, durationSec, distanceMeters, flags]`, trailing
   * nulls (and a zero flags field) trimmed, so an ordinary set is `[185, 5]`
   * exactly as it has always been.
   */
  function encodeSet(set) {
    var s = set || {};
    var tuple = [
      s.weightLb == null ? null : s.weightLb,
      s.reps == null ? null : s.reps,
      s.rpe == null ? null : s.rpe,
      s.durationSec == null ? null : s.durationSec,
      s.distanceMeters == null ? null : s.distanceMeters,
      flagsOf(s),
    ];
    while (tuple.length && !tuple[tuple.length - 1]) tuple.pop();
    return tuple;
  }

  /**
   * The other half of the contract, and what the round-trip tests decode with.
   * Matches the Coach web decoder field for field, plus the side.
   */
  function decodeSet(tuple) {
    var t = tuple || [];
    var flags = t[5] || 0;
    var set = {
      weightLb: t[0] == null ? null : t[0],
      reps: t[1] == null ? null : t[1],
      rpe: t[2] == null ? null : t[2],
      durationSec: t[3] == null ? null : t[3],
      distanceMeters: t[4] == null ? null : t[4],
      warmup: !!(flags & WARMUP_BIT),
    };
    var side = sideFromFlags(flags);
    if (side) set.side = side;      // both is absent, never written out
    return set;
  }

  /* ---------------- imbalance ---------------- */

  /** Epley, best set: reliable to about five reps, optimistic past ten. */
  function e1rm(sets) {
    var vals = (sets || [])
      .filter(function (s) { return s && s.weightLb != null && s.reps > 0; })
      .map(function (s) { return s.weightLb * (1 + s.reps / 30); });
    return vals.length ? Math.max.apply(null, vals) : null;
  }

  var mean = function (xs) {
    return xs.reduce(function (t, v) { return t + v; }, 0) / xs.length;
  };

  var recorded = function (values) {
    return (values || []).filter(function (v) {
      return typeof v === 'number' && isFinite(v) && v > 0;
    });
  };

  /** (strong - weak) / strong, as a fraction, or null if there is no strong. */
  function gap(left, right) {
    var strong = Math.max(left, right);
    var weak = Math.min(left, right);
    if (!(strong > 0)) return null;
    return (strong - weak) / strong;
  }

  var MIN_SESSIONS = 3;         // below this there is no figure to show
  var MIN_FOR_TREND = 4;        // and no honest first half to compare against

  /**
   * The imbalance between two sides, given each side's estimated 1RM per
   * session across the window the chart is already showing -- the chart's
   * window, on purpose, so the number and the lines tell one story.
   *
   * Returns `{ enough: false }` until both sides have three sessions in it. A
   * figure drawn from one session each would move ten points on a day someone
   * went in tired, and be read as a finding.
   *
   * The figure itself averages each side's last three sessions rather than
   * taking the latest, for the same reason. `trend` compares that against the
   * first three, and is null until there are four sessions to compare with --
   * with exactly three, the two windows are the same sessions and "steady"
   * would be arithmetic, not an observation.
   */
  function imbalance(left, right) {
    var l = recorded(left);
    var r = recorded(right);
    var sessions = { left: l.length, right: r.length };
    if (l.length < MIN_SESSIONS || r.length < MIN_SESSIONS) {
      return { enough: false, sessions: sessions };
    }

    var lastThree = function (xs) { return mean(xs.slice(-MIN_SESSIONS)); };
    var firstThree = function (xs) { return mean(xs.slice(0, MIN_SESSIONS)); };

    var nowLeft = lastThree(l);
    var nowRight = lastThree(r);
    var percent = gap(nowLeft, nowRight);
    if (percent == null) return { enough: false, sessions: sessions };

    var out = {
      enough: true,
      sessions: sessions,
      percent: percent,
      strong: nowLeft === nowRight ? null : (nowLeft > nowRight ? LEFT : RIGHT),
      weak: nowLeft === nowRight ? null : (nowLeft > nowRight ? RIGHT : LEFT),
      trend: null,
      was: null,
    };

    if (l.length >= MIN_FOR_TREND && r.length >= MIN_FOR_TREND) {
      var before = gap(firstThree(l), firstThree(r));
      if (before != null) {
        out.was = before;
        // Half a percentage point of movement is noise in an estimate built
        // out of an estimate. Below it, the gap has not done anything.
        var moved = percent - before;
        out.trend = moved > 0.005 ? 'widening' : moved < -0.005 ? 'closing' : 'steady';
      }
    }
    return out;
  }

  global.LiftSides = {
    LEFT: LEFT,
    RIGHT: RIGHT,
    MIN_SESSIONS: MIN_SESSIONS,
    of: of,
    label: label,
    looksUnilateral: looksUnilateral,
    countsIn: countsIn,
    anySided: anySided,
    nextSide: nextSide,
    countsLabel: countsLabel,
    key: key,
    onSide: onSide,
    flagsOf: flagsOf,
    sideFromFlags: sideFromFlags,
    encodeSet: encodeSet,
    decodeSet: decodeSet,
    e1rm: e1rm,
    imbalance: imbalance,
  };
})(typeof window !== 'undefined' ? window : globalThis);
