/* Left and right, for lifts that have two of them — the reading half.
 *
 * A port of LIFT web's `lift/sides.js`, which is the reference implementation
 * (coach/SHARE-FORMAT.md "The imbalance figure" names it as such). Same
 * function shapes, same thresholds, so the two apps print the same number from
 * the same log. What is missing from this copy is only the half Coach has no
 * use for: Coach never logs a set, so it never picks the next side, never
 * guesses whether a name reads as unilateral, and never writes side bits into
 * a share link. It reads them.
 *
 * A set may record a side: left, right, or both. **Absent means both**, which
 * is what every set logged before this existed already meant, so nothing
 * stored today changes meaning and nothing is rewritten on load. "both" is
 * never written out, and a side is never inferred from an exercise name.
 *
 * A lift's identity becomes name + equipment + side wherever sets are grouped
 * or charted, for the same reason equipment is already in it: a left-arm row
 * and a right-arm row are not the same lift, and averaging them hides the one
 * thing you are looking at them for. Tolerating the bits without grouping on
 * them is worse than ignoring them, because the two limbs then interleave and
 * the estimated-1RM line zig-zags set for set.
 *
 * Kept as its own script, like route.js and nutrients.js, so node tests the
 * rules instead of an eye — the imbalance maths especially, which decides a
 * number a person will read about their own body.
 *
 * Tracked and shown, never targeted. Nothing here says what a gap means; that
 * is a trainer's job, and a 10% difference is ordinary in most people.
 *
 * The wire rules (SHARE-FORMAT.md, BACKUP-FORMAT.md):
 *
 *   share link   the set tuple's `flags` field, bits 1-2: 0 both, 1 left,
 *                2 right, alongside bit 0 = warmup. Mask, never compare: a
 *                left-side warmup is 3, and `flags === 1` calls it a working
 *                set. 3 in bits 1-2 is never written and reads as both.
 *   backup file  a named field, `side: "left" | "right"`, omitted when both.
 *                An unrecognised value reads as both rather than failing the
 *                import, which is the leniency that file asks for everywhere.
 *   plan link    unchanged in v1: a coach prescribes as before and the lifter
 *                chooses sides when logging.
 */
(function (global) {
  'use strict';

  var LEFT = 'left';
  var RIGHT = 'right';

  /* Bits 1-2 of the set tuple's flags. Bit 0 is warmup and is not ours. */
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

  /** "Left", "Right", "Both" — for a chart legend and a table cell. */
  function longLabel(side) {
    var v = of(side);
    return v === LEFT ? 'Left' : v === RIGHT ? 'Right' : 'Both';
  }

  /**
   * The grouping key: name, equipment and side. `exerciseIndex` in app.js
   * keys a lift on the first two, and this is that plus the third -- the whole
   * point being that L and R never land in the same series.
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

  /** "L 3 · R 2", so a missed side is obvious. Empty when nothing is sided. */
  function countsLabel(sets) {
    if (!anySided(sets)) return '';
    var c = countsIn(sets);
    var text = 'L ' + c.left + ' · R ' + c.right;
    // Sets logged before the client switched the toggle on are still in this
    // exercise and still real. Saying so beats quietly leaving them out.
    return c.both ? text + ' · ' + c.both + ' both' : text;
  }

  /* ---------------- the wire ---------------- */

  /**
   * The side bits 1-2 of a flags field say, or null for both.
   *
   * Masked, never compared. Bit 0 is warmup, so a left-side warmup arrives as
   * 3 and a right-side warmup as 5; a decoder that compares reads the first as
   * an ordinary set by luck and the second as one by mistake.
   */
  function sideFromFlags(flags) {
    var bits = ((Number(flags) || 0) & SIDE_MASK) >> SIDE_SHIFT;
    if (bits === SIDE_BITS.left) return LEFT;
    if (bits === SIDE_BITS.right) return RIGHT;
    // 3 is not a side. A reader inventing one from a bit pattern nobody
    // defined would be worse than reading it as an ordinary set.
    return null;
  }

  /* ---------------- the backup file ---------------- */

  /**
   * Normalise one stored set in place: a recognised side is kept lowercased,
   * anything else is removed outright, because absent is how "both" is spelt.
   *
   * Used on the way in and on the way out, so a file this app writes never
   * carries a side it would not read back, and a file another app wrote --
   * with "Both", with null, with a spelling nobody here knows -- restores as a
   * two-sided set rather than failing the import.
   */
  function normaliseSet(set) {
    if (!set || typeof set !== 'object') return set;
    var side = of(set);
    if (side) set.side = side;
    else if ('side' in set) delete set.side;
    return set;
  }

  /** The same, over a client's whole `days` map: every set of every exercise. */
  function normaliseClient(client) {
    if (!client || typeof client !== 'object') return client;
    var days = client.days;
    if (!days || typeof days !== 'object') return client;
    Object.keys(days).forEach(function (dayKey) {
      var day = days[dayKey];
      if (!day || !Array.isArray(day.exercises)) return;
      day.exercises.forEach(function (ex) {
        if (ex && Array.isArray(ex.sets)) ex.sets.forEach(normaliseSet);
      });
    });
    return client;
  }

  /* ---------------- grouping ---------------- */

  var SERIES_ORDER = [LEFT, RIGHT, null];

  /**
   * A lift's sessions split into one series per side, which is the whole point
   * of reading the bits at all.
   *
   * `days` is `[{ key, sets }]` in date order, `summarise` turns one session's
   * sets into whatever the caller wants to plot. A session contributes to a
   * side only when it has sets on it, so a day someone trained the left side
   * alone leaves a gap in the right line rather than a zero.
   *
   * Left and right come first and unmarked last: a lift logged two-sided for a
   * year and per-side since has all three, and the old sets are real. A lift
   * with no sided sets at all comes back as the single unmarked series it has
   * always been.
   */
  function splitSessions(name, equipment, days, summarise) {
    var series = [];
    SERIES_ORDER.forEach(function (side) {
      var points = [];
      (days || []).forEach(function (day) {
        var sets = onSide(day.sets, side);
        if (!sets.length) return;
        var point = summarise(sets, day);
        if (point) points.push(Object.assign({ key: day.key, side: side }, point));
      });
      if (points.length) {
        series.push({
          side: side,
          id: key(name, equipment, side),
          label: longLabel(side),
          points: points,
        });
      }
    });
    return series;
  }

  /* ---------------- imbalance ---------------- */

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

  /**
   * What the client page prints: a short headline for the statline's value and
   * a quieter line saying what it was measured over. Two pieces rather than
   * one sentence so the headline stays short enough not to widen a 375px
   * screen, and so "not enough yet" says what is missing instead of nothing.
   *
   * Stated and nothing more: no threshold, no colour, no advice about what to
   * do with it. A gap of a few per cent is ordinary in most people, an app is
   * not qualified to say what one person's means, and a trainer is.
   */
  function imbalanceLines(result) {
    if (!result) return null;
    if (!result.enough) {
      return {
        headline: '—',
        detail: 'Needs ' + MIN_SESSIONS + ' sessions a side · '
          + result.sessions.left + ' left, ' + result.sessions.right + ' right so far',
      };
    }
    var pct = Math.round(result.percent * 1000) / 10;
    return {
      headline: result.strong ? longLabel(result.strong) + ' ahead by ' + pct + '%' : 'Sides level',
      detail: 'Mean estimated 1RM of the last ' + MIN_SESSIONS + ' sessions each'
        + (result.trend ? ' · gap ' + result.trend : ''),
    };
  }

  global.CoachSides = {
    LEFT: LEFT,
    RIGHT: RIGHT,
    MIN_SESSIONS: MIN_SESSIONS,
    MIN_FOR_TREND: MIN_FOR_TREND,
    of: of,
    label: label,
    longLabel: longLabel,
    key: key,
    onSide: onSide,
    countsIn: countsIn,
    anySided: anySided,
    countsLabel: countsLabel,
    sideFromFlags: sideFromFlags,
    normaliseSet: normaliseSet,
    normaliseClient: normaliseClient,
    splitSessions: splitSessions,
    gap: gap,
    imbalance: imbalance,
    imbalanceLines: imbalanceLines,
  };
})(typeof window !== 'undefined' ? window : globalThis);
