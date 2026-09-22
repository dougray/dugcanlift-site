/* Prescribed sets and their sides -- the training half of a plan link.
 *
 * PLAN-FORMAT.md "Sides" has the rules; this is the one place Coach web
 * applies them, so node tests them rather than an eye. Two separate, small
 * things, and neither turns a single-limb set into two rows:
 *
 *   each side    an exercise flag: every prescribed set is done on both sides.
 *                "3 × 8, each side" stays three rows here and on the wire, and
 *                LIFT expects six sets, three a side. Stored as
 *                `eachSide: true`, omitted when false; on the wire `b: 1`,
 *                omitted when not (never `0`).
 *   a named side a set done on one side only, once, for the asymmetric cases:
 *                an extra set on the left, rehab side only. Stored as
 *                `side: "left" | "right"`, omitted when both -- the spelling
 *                BACKUP-FORMAT already uses for a logged set. On the wire, a
 *                sixth tuple position carrying SHARE-FORMAT's flags bits 1-2.
 *
 * Absent is today's meaning in both places, so a plan written before this
 * encodes byte for byte as it always did: a both-sides set writes no sixth
 * position at all, and an exercise that is not each side carries no `b`.
 *
 * Tracked and prescribed, never judged. A coach writing an extra left set is
 * making a coaching decision; nothing here comments on it.
 *
 * Loaded after sides.js, whose side reading (`of`, masked `sideFromFlags`)
 * this reuses rather than repeats.
 */
(function (global) {
  'use strict';

  var Sides = global.CoachSides;

  /* Bits 1-2 of flags. Bit 0 is SHARE-FORMAT's warmup bit: a coach does not
   * prescribe warmups as flagged sets, so a plan always writes it 0. */
  var SIDE_SHIFT = 1;
  var SIDE_BITS = { left: 1, right: 2 };

  var orNull = function (v) { return v == null ? null : v; };

  /**
   * One prescribed set as PLAN-FORMAT's tuple:
   * `[weightLb, reps, rpe, durationSec, distanceMeters, flags]`.
   *
   * A both-sides set is the five-field tuple it has always been, trailing nulls
   * trimmed. A set that names a side keeps every position up to its flags:
   * only trailing nulls are trimmed, never interior ones, or a left-side
   * conditioning piece `[null, null, null, 600, 1600, 2]` would slide its
   * distance into the weight slot.
   */
  function setTuple(set) {
    var s = set || {};
    var values = [s.weightLb, s.reps, s.rpe, s.durationSec, s.distanceM].map(orNull);
    var side = Sides.of(s);
    if (side) return values.concat([SIDE_BITS[side] << SIDE_SHIFT]);
    while (values.length && values[values.length - 1] == null) values.pop();
    return values;
  }

  /** One exercise on the wire. Key order is `n q b s c`, and `b` is absent
   *  unless each side, so a plan without it is unchanged to the byte. */
  function exerciseWire(exercise) {
    var out = { n: exercise.name };
    if (exercise.equipment) out.q = exercise.equipment;
    if (exercise.eachSide === true) out.b = 1;
    out.s = (exercise.sets || []).map(setTuple);
    if (exercise.note) out.c = exercise.note;
    return out;
  }

  function workoutWire(workout) {
    return { n: workout.name, e: (workout.exercises || []).map(exerciseWire) };
  }

  /* ---------------- reading a plan back ---------------- */

  /**
   * A tuple back into the shape Coach stores. The side is masked out of the
   * sixth position, never compared: `(flags >> 1) & 3`, where 3 reads as both
   * and bit 0 is ignored. A missing or junk sixth position is both.
   */
  function decodeSet(tuple) {
    var t = Array.isArray(tuple) ? tuple : [];
    var set = {
      weightLb: orNull(t[0]),
      reps: orNull(t[1]),
      rpe: orNull(t[2]),
      durationSec: orNull(t[3]),
      distanceM: orNull(t[4]),
    };
    var side = Sides.sideFromFlags(t[5]);
    if (side) set.side = side;
    return set;
  }

  function decodeExercise(wire) {
    var w = wire || {};
    var exercise = {
      name: w.n || 'Exercise',
      equipment: w.q || '',
      note: w.c || '',
      sets: (Array.isArray(w.s) ? w.s : []).map(decodeSet),
    };
    // `1` is each side. Anything else -- absent, 0, junk -- is today's meaning.
    if (Number(w.b) === 1) exercise.eachSide = true;
    return exercise;
  }

  function decodeWorkout(wire) {
    var w = wire || {};
    return { name: w.n || 'Session', exercises: (Array.isArray(w.e) ? w.e : []).map(decodeExercise) };
  }

  /* ---------------- storage and the backup file ---------------- */

  /**
   * Normalise one stored exercise in place: `eachSide` is kept only as `true`
   * and removed otherwise, and each set's side is kept only as "left" or
   * "right" (CoachSides.normaliseSet). Run on save and on restore, so a file
   * never carries a spelling this app would not read back, and an unknown side
   * string restores as both rather than failing the import.
   */
  function normaliseExercise(exercise) {
    if (!exercise || typeof exercise !== 'object') return exercise;
    if (exercise.eachSide === true) exercise.eachSide = true;
    else if ('eachSide' in exercise) delete exercise.eachSide;
    if (Array.isArray(exercise.sets)) exercise.sets.forEach(Sides.normaliseSet);
    return exercise;
  }

  function normaliseWorkout(workout) {
    if (workout && Array.isArray(workout.exercises)) workout.exercises.forEach(normaliseExercise);
    return workout;
  }

  /* ---------------- what a prescription asks for ---------------- */

  /**
   * How many sets a side the exercise asks for, and how many two-sided ones.
   * An each-side exercise's unmarked set counts once on each side; a set that
   * names a side counts once on that side, each side or not. So "3 × 8 each
   * side plus one left" is left 4, right 3 -- seven sets.
   */
  function targets(exercise) {
    var out = { left: 0, right: 0, both: 0 };
    var each = !!(exercise && exercise.eachSide === true);
    ((exercise && exercise.sets) || []).forEach(function (set) {
      var side = Sides.of(set);
      if (side) out[side] += 1;
      else if (each) { out.left += 1; out.right += 1; }
      else out.both += 1;
    });
    return out;
  }

  /* ---------------- how it reads ---------------- */

  var num = function (n) { return Math.round(n).toLocaleString(); };
  var pad2 = function (n) { return String(n).padStart(2, '0'); };

  /** A set's numbers: "225 × 5 · @8", "5 reps", "10:00 · 1600 m". */
  function prescriptionText(set) {
    var bits = [];
    if (set.weightLb != null && set.reps != null) bits.push(num(set.weightLb) + ' × ' + set.reps);
    else if (set.reps != null) bits.push(set.reps + ' reps');
    else if (set.weightLb != null) bits.push(num(set.weightLb) + ' lb');
    if (set.distanceM != null) bits.push(num(set.distanceM) + ' m');
    if (set.durationSec != null) {
      var minutes = Math.floor(set.durationSec / 60);
      bits.push(minutes ? minutes + ':' + pad2(set.durationSec % 60) : set.durationSec + 's');
    }
    if (set.rpe != null) bits.push('@' + set.rpe);
    return bits.join(' · ') || 'as written';
  }

  /** The same, with the side it names: "30 × 8 L". Nothing added for both. */
  function setText(set) {
    var side = Sides.label(set);
    return prescriptionText(set) + (side ? ' ' + side : '');
  }

  /** "3 × 225 × 5" when every set matches, otherwise each set spelled out.
   *  Matching is the stored set, not its text, as it always was: 225 and
   *  225.4 print alike and are not the same prescription. */
  function listText(sets, text) {
    var first = JSON.stringify(sets[0]);
    var uniform = sets.every(function (s) { return JSON.stringify(s) === first; });
    return uniform && sets.length > 1
      ? sets.length + ' × ' + text(sets[0])
      : sets.map(text).join(', ');
  }

  /**
   * One line for an exercise: "3 × 225 × 5", "3 × 30 × 8 each side",
   * "3 × 30 × 8 each side + 1 L", "185 × 5, 185 × 5, 95 × 10 R".
   *
   * An exercise with no side anywhere reads exactly as it always has.
   */
  function summary(exercise) {
    var sets = (exercise && exercise.sets) || [];
    if (!sets.length) return 'no sets yet';
    var each = exercise.eachSide === true;
    var plain = sets.filter(function (s) { return !Sides.of(s); });
    if (!each || !plain.length) return listText(sets, setText);

    var plainText = listText(plain, prescriptionText);
    var first = JSON.stringify(plain[0]);
    var same = plain.every(function (s) { return JSON.stringify(s) === first; })
      ? prescriptionText(plain[0]) : null;

    // The named extras, grouped by what they say, in the order they appear.
    var groups = [];
    sets.forEach(function (s) {
      var side = Sides.of(s);
      if (!side) return;
      var text = prescriptionText(s);
      var found = groups.filter(function (g) { return g.side === side && g.text === text; })[0];
      if (found) found.count += 1;
      else groups.push({ side: side, text: text, count: 1 });
    });

    var extras = groups.map(function (g) {
      var label = Sides.label(g.side);
      // "+ 1 L" when the extra is the same set; its numbers when it is not.
      if (g.text === same) return ' + ' + g.count + ' ' + label;
      return ' + ' + (g.count > 1 ? g.count + ' × ' : '') + g.text + ' ' + label;
    });
    return plainText + ' each side' + extras.join('');
  }

  /* ---------------- the link envelope ---------------- */

  var bytesToB64url = function (bytes) {
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  var b64urlToBytes = function (s) {
    var pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    var bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  /** A payload's JSON as the fragment body: `z` + deflate-raw, or `u` +
   *  plain when the browser has no CompressionStream. */
  async function pack(json) {
    if (typeof CompressionStream !== 'undefined') {
      var stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      var packed = new Uint8Array(await new Response(stream).arrayBuffer());
      return 'z' + bytesToB64url(packed);
    }
    return 'u' + bytesToB64url(new TextEncoder().encode(json));
  }

  /** The reverse, from a whole link or a bare `1z…` fragment, to the JSON text. */
  async function unpack(link) {
    var text = String(link || '').trim();
    var frag = text.indexOf('#') >= 0 ? text.slice(text.indexOf('#') + 1) : text;
    var match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
    if (!match || Number(match[1]) !== 1) throw new Error('not a v1 plan link');
    var bytes = b64urlToBytes(match[3]);
    if (match[2] === 'u') return new TextDecoder().decode(bytes);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  global.CoachPrescriptions = {
    setTuple: setTuple,
    exerciseWire: exerciseWire,
    workoutWire: workoutWire,
    decodeSet: decodeSet,
    decodeExercise: decodeExercise,
    decodeWorkout: decodeWorkout,
    normaliseExercise: normaliseExercise,
    normaliseWorkout: normaliseWorkout,
    targets: targets,
    prescriptionText: prescriptionText,
    setText: setText,
    summary: summary,
    pack: pack,
    unpack: unpack,
  };
})(typeof window !== 'undefined' ? window : globalThis);
