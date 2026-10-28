/* Prescribed sets, their sides and their types -- the training half of a
 * plan link.
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
 * Set types (PLAN-FORMAT.md "Set types") follow the same rules, and the same
 * shape: one exercise flag and one set field, each omitted when it does not
 * apply.
 *
 *   a group      exercises done round by round -- one set of each, then the
 *                rest. Two make a superset, three or more a circuit. Stored
 *                as `group: <positive integer>` on each member; on the wire
 *                `g`, renumbered 1, 2, 3... in order of appearance. Adjacency
 *                makes the group, not the number, so a group of one is no
 *                group and is never written.
 *   a kind       how a set follows the one before it: `kind: "drop"` (no
 *                rest, normally lighter) or `"restPause"` (a short pause,
 *                normally the same weight), omitted when straight. On the
 *                wire, flags bits 3-4, OR'd with the side. An exercise's first
 *                set has no set before it, so it is always straight.
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

  /* Bits 3-4 of flags: 0 straight, 1 drop, 2 rest-pause. 3 is never written
   * and reads as straight, as 3 in the side bits reads as both. */
  var KIND_SHIFT = 3;
  var KIND_MASK = 3;
  var DROP = 'drop';
  var REST_PAUSE = 'restPause';
  var KIND_BITS = { drop: 1, restPause: 2 };

  var orNull = function (v) { return v == null ? null : v; };

  /* ---------------- set kinds ---------------- */

  /**
   * The kind a set records, or null for straight. Anything that is not
   * "drop" or "restPause" -- absent, "straight", junk from a file another app
   * wrote -- is straight, for the reason anything but left or right is both:
   * straight is the only safe reading of a set nobody described. Case and
   * surrounding space are forgiven, as they are for a side.
   */
  function kindOf(set) {
    var raw = set && typeof set === 'object' ? set.kind : set;
    if (typeof raw !== 'string') return null;
    var v = raw.trim().toLowerCase();
    return v === 'drop' ? DROP : v === 'restpause' ? REST_PAUSE : null;
  }

  /**
   * The kind bits 3-4 of a flags field say, or null for straight.
   *
   * Masked, never compared: a left-side drop set arrives as 10, and a reader
   * testing `flags === 8` would call it straight.
   */
  function kindFromFlags(flags) {
    var bits = ((Number(flags) || 0) >> KIND_SHIFT) & KIND_MASK;
    if (bits === KIND_BITS.drop) return DROP;
    if (bits === KIND_BITS.restPause) return REST_PAUSE;
    return null;
  }

  /** "drop", "rest-pause", or "" for a straight set. */
  function kindLabel(set) {
    var k = kindOf(set);
    return k === DROP ? 'drop' : k === REST_PAUSE ? 'rest-pause' : '';
  }

  /** A set with its kind removed, for an exercise's first set, which has no
   *  set before it to follow. The stored set is left alone. */
  function withoutKind(set) {
    if (!set || typeof set !== 'object' || !('kind' in set)) return set;
    var copy = Object.assign({}, set);
    delete copy.kind;
    return copy;
  }

  /* ---------------- groups ---------------- */

  /** A group number as stored or sent: a positive integer, or null. `0`, a
   *  fraction, a negative, a string or anything else is not grouped. */
  function groupOf(value) {
    var g = value && typeof value === 'object' ? value.group : value;
    return typeof g === 'number' && Number.isInteger(g) && g > 0 ? g : null;
  }

  /**
   * The group each position belongs to, as the wire numbers them, from the raw
   * group numbers in order: runs of two or more adjacent equal numbers become
   * 1, 2, 3... in order of appearance, and everything else -- a lone number, a
   * number its neighbours do not share, no number at all -- is null.
   *
   * So `[7, 7, 3, 3, 3]` is `[1, 1, 2, 2, 2]`, and `[1, null, 1]` is three
   * ungrouped exercises: the number only has to differ from its neighbours.
   */
  function runs(numbers) {
    var out = numbers.map(function () { return null; });
    var next = 1;
    var i = 0;
    while (i < numbers.length) {
      var g = groupOf(numbers[i]);
      var j = i + 1;
      if (g != null) while (j < numbers.length && groupOf(numbers[j]) === g) j += 1;
      if (g != null && j - i >= 2) {
        for (var k = i; k < j; k++) out[k] = next;
        next += 1;
      }
      i = j;
    }
    return out;
  }

  /** The wire's group for each exercise of a workout, without touching it. */
  function wireGroups(exercises) {
    return runs((exercises || []).map(function (ex) { return groupOf(ex); }));
  }

  /**
   * Rewrite a workout's stored groups in place the way the wire would number
   * them: runs renumbered 1, 2, 3..., and a group of one removed. The editor
   * runs it after every join, split and removal, and normaliseWorkout on save
   * and restore, so storage never holds a group that would not be sent.
   */
  function regroup(exercises) {
    if (!Array.isArray(exercises)) return exercises;
    wireGroups(exercises).forEach(function (g, i) {
      var ex = exercises[i];
      if (!ex || typeof ex !== 'object') return;
      if (g != null) ex.group = g;
      else if ('group' in ex) delete ex.group;
    });
    return exercises;
  }

  /** True when exercise `i` and the one after it are in the same group --
   *  the "Superset with next" chip's state. */
  function groupedWithNext(exercises, i) {
    var list = exercises || [];
    var a = groupOf(list[i]);
    return a != null && i + 1 < list.length && groupOf(list[i + 1]) === a;
  }

  /**
   * Join exercise `i` to the next, or split them, in place. Joining takes the
   * whole group the next exercise is in, so "Superset with next" on the
   * exercise before a superset makes a circuit of three. Splitting keeps the
   * exercises before the split in their group and gives the rest one of their
   * own, so splitting a circuit of three after its first leaves a superset.
   * Either way the result is regrouped: a group left with one member is gone.
   */
  function setGroupedWithNext(exercises, i, on) {
    var list = exercises || [];
    if (i < 0 || i + 1 >= list.length) return exercises;
    regroup(list);
    var a = groupOf(list[i]);
    var b = groupOf(list[i + 1]);
    var fresh = list.reduce(function (m, ex) { return Math.max(m, groupOf(ex) || 0); }, 0) + 1;
    var j;
    if (on) {
      if (a != null && a === b) return exercises;
      var target = a != null ? a : b != null ? b : fresh;
      list[i].group = target;
      list[i + 1].group = target;
      for (j = i + 2; b != null && j < list.length && groupOf(list[j]) === b; j++) list[j].group = target;
    } else {
      if (a == null || a !== b) return exercises;
      for (j = i + 1; j < list.length && groupOf(list[j]) === a; j++) list[j].group = fresh;
    }
    return regroup(list);
  }

  /** Spreadsheet letters: 0 is A, 25 Z, 26 AA. A day with 27 groups is not
   *  likely, but a label must never be undefined. */
  function letters(n) {
    var out = '';
    for (var x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) {
      out = String.fromCharCode(65 + ((x - 1) % 26)) + out;
    }
    return out;
  }

  /**
   * What each exercise of a workout is labelled, or null when it is not
   * grouped: `{ group: "Superset A", member: "A1" }`. Two exercises are a
   * superset and three or more a circuit; the letters run A, B, C... within
   * the workout and the members are numbered from 1. LIFT's labels, so a
   * coach and their client read the same words.
   */
  function groupLabels(exercises) {
    var groups = wireGroups(exercises);
    var sizes = {};
    groups.forEach(function (g) { if (g != null) sizes[g] = (sizes[g] || 0) + 1; });
    var seen = {};
    return groups.map(function (g) {
      if (g == null) return null;
      var letter = letters(g - 1);
      seen[g] = (seen[g] || 0) + 1;
      return {
        group: (sizes[g] >= 3 ? 'Circuit ' : 'Superset ') + letter,
        member: letter + seen[g],
        first: seen[g] === 1,
        size: sizes[g],
      };
    });
  }

  /**
   * One prescribed set as PLAN-FORMAT's tuple:
   * `[weightLb, reps, rpe, durationSec, distanceMeters, flags]`.
   *
   * A straight both-sides set is the five-field tuple it has always been,
   * trailing nulls trimmed. A set that names a side or a kind keeps every
   * position up to its flags: only trailing nulls are trimmed, never interior
   * ones, or a left-side conditioning piece `[null, null, null, 600, 1600, 2]`
   * would slide its distance into the weight slot. The side is bits 1-2 and
   * the kind bits 3-4, OR'd together, so a left-side drop set is 10.
   *
   * This writes what the set says. That an exercise's first set is never a
   * drop or rest-pause is the exercise's rule, applied in exerciseWire.
   */
  function setTuple(set) {
    var s = set || {};
    var values = [s.weightLb, s.reps, s.rpe, s.durationSec, s.distanceM].map(orNull);
    var side = Sides.of(s);
    var kind = kindOf(s);
    var flags = (side ? SIDE_BITS[side] << SIDE_SHIFT : 0)
      | (kind ? KIND_BITS[kind] << KIND_SHIFT : 0);
    if (flags) return values.concat([flags]);
    while (values.length && values[values.length - 1] == null) values.pop();
    return values;
  }

  /* One exercise on the wire, with the group number the workout gave it. */
  function exerciseOut(exercise, group) {
    var out = { n: exercise.name };
    if (exercise.equipment) out.q = exercise.equipment;
    if (exercise.eachSide === true) out.b = 1;
    if (group != null) out.g = group;
    out.s = (exercise.sets || []).map(function (set, i) {
      // The first set has nothing before it to drop from or pause after.
      return setTuple(i === 0 ? withoutKind(set) : set);
    });
    if (exercise.note) out.c = exercise.note;
    return out;
  }

  /** One exercise on the wire. Key order is `n q b g s c`, and `b` is absent
   *  unless each side, so a plan without it is unchanged to the byte. A group
   *  is a fact about neighbours, so `g` is only ever written by workoutWire;
   *  an exercise encoded on its own carries none. */
  function exerciseWire(exercise) {
    return exerciseOut(exercise, null);
  }

  /** A workout on the wire. `g` is written on exercises in a run of two or
   *  more adjacent exercises sharing a stored group, numbered 1, 2, 3... in
   *  order of appearance, and on no others -- so a plan without groups is
   *  unchanged to the byte. */
  function workoutWire(workout) {
    var exercises = workout.exercises || [];
    var groups = wireGroups(exercises);
    return {
      n: workout.name,
      e: exercises.map(function (exercise, i) { return exerciseOut(exercise, groups[i]); }),
    };
  }

  /* ---------------- reading a plan back ---------------- */

  /**
   * A tuple back into the shape Coach stores. The side and the kind are masked
   * out of the sixth position, never compared: `(flags >> 1) & 3` and
   * `(flags >> 3) & 3`, where 3 reads as both or straight and bit 0 is
   * ignored. A missing or junk sixth position is a straight both-sides set.
   * Whether the set is first in its exercise is decodeExercise's business.
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
    var kind = kindFromFlags(t[5]);
    if (kind) set.kind = kind;
    return set;
  }

  /** One exercise back. `g` is not read here: a group is a fact about the
   *  exercises around this one, which only decodeWorkout can see. */
  function decodeExercise(wire) {
    var w = wire || {};
    var exercise = {
      name: w.n || 'Exercise',
      equipment: w.q || '',
      note: w.c || '',
      sets: (Array.isArray(w.s) ? w.s : []).map(function (t) { return decodeSet(t); }),
    };
    // `1` is each side. Anything else -- absent, 0, junk -- is today's meaning.
    if (Number(w.b) === 1) exercise.eachSide = true;
    // A first set that says drop or rest-pause has nothing to follow, and
    // reads as straight.
    if (exercise.sets.length && 'kind' in exercise.sets[0]) delete exercise.sets[0].kind;
    return exercise;
  }

  /** A workout back. Groups come from `g` -- a positive integer, anything else
   *  is not grouped -- and from adjacency: a run of two or more neighbours
   *  with the same `g` is one group, stored renumbered 1, 2, 3..., and a group
   *  of one is an ordinary exercise. */
  function decodeWorkout(wire) {
    var w = wire || {};
    var list = Array.isArray(w.e) ? w.e : [];
    var groups = runs(list.map(function (x) { return x && typeof x === 'object' ? groupOf(x.g) : null; }));
    var exercises = list.map(function (x, i) {
      var exercise = decodeExercise(x);
      if (groups[i] != null) exercise.group = groups[i];
      return exercise;
    });
    return { name: w.n || 'Session', exercises: exercises };
  }

  /* ---------------- storage and the backup file ---------------- */

  /** Normalise one stored set's kind in place: "drop" or "restPause" kept in
   *  that spelling, anything else removed, because absent is how straight is
   *  spelt. */
  function normaliseKind(set) {
    if (!set || typeof set !== 'object') return set;
    var kind = kindOf(set);
    if (kind) set.kind = kind;
    else if ('kind' in set) delete set.kind;
    return set;
  }

  /**
   * Normalise one stored exercise in place: `eachSide` is kept only as `true`
   * and removed otherwise, each set's side is kept only as "left" or "right"
   * (CoachSides.normaliseSet), each set's kind only as "drop" or "restPause",
   * and the first set never has a kind. `group` is kept only as a positive
   * integer. Run on save and on restore, so a file never carries a spelling
   * this app would not read back, and an unknown side or kind restores as
   * both or straight rather than failing the import.
   */
  function normaliseExercise(exercise) {
    if (!exercise || typeof exercise !== 'object') return exercise;
    if (exercise.eachSide === true) exercise.eachSide = true;
    else if ('eachSide' in exercise) delete exercise.eachSide;
    if (groupOf(exercise) == null && 'group' in exercise) delete exercise.group;
    if (Array.isArray(exercise.sets)) {
      exercise.sets.forEach(Sides.normaliseSet);
      exercise.sets.forEach(normaliseKind);
      var first = exercise.sets[0];
      if (first && typeof first === 'object' && 'kind' in first) delete first.kind;
    }
    return exercise;
  }

  /** The same over a workout, and then its groups as the wire would number
   *  them: a group of one, which would never be sent, is not kept either. */
  function normaliseWorkout(workout) {
    if (workout && Array.isArray(workout.exercises)) {
      workout.exercises.forEach(normaliseExercise);
      regroup(workout.exercises);
    }
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

  /* " drop", " rest-pause", or nothing for a straight set. */
  var kindSuffix = function (set) {
    var kind = kindLabel(set);
    return kind ? ' ' + kind : '';
  };

  /** The same, with the side it names and its kind: "30 × 8 L",
   *  "50 × 10 drop", "20 × 8 L drop". Nothing added for both, or straight. */
  function setText(set) {
    var side = Sides.label(set);
    return prescriptionText(set) + (side ? ' ' + side : '') + kindSuffix(set);
  }

  /* A set's numbers and its kind, without its side -- the each-side line's
   * unit, where the side is said once for the whole exercise. */
  var plainSetText = function (set) { return prescriptionText(set) + kindSuffix(set); };

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

    var plainText = listText(plain, plainSetText);
    var first = JSON.stringify(plain[0]);
    var same = plain.every(function (s) { return JSON.stringify(s) === first; })
      ? plainSetText(plain[0]) : null;

    // The named extras, grouped by what they say, in the order they appear.
    var groups = [];
    sets.forEach(function (s) {
      var side = Sides.of(s);
      if (!side) return;
      var text = prescriptionText(s);
      var kind = kindSuffix(s);
      var found = groups.filter(function (g) {
        return g.side === side && g.text === text && g.kind === kind;
      })[0];
      if (found) found.count += 1;
      else groups.push({ side: side, text: text, kind: kind, count: 1 });
    });

    var extras = groups.map(function (g) {
      var label = Sides.label(g.side);
      // "+ 1 L" when the extra is the same set; its numbers when it is not.
      if (g.text + g.kind === same) return ' + ' + g.count + ' ' + label;
      return ' + ' + (g.count > 1 ? g.count + ' × ' : '') + g.text + ' ' + label + g.kind;
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
    kindOf: kindOf,
    kindFromFlags: kindFromFlags,
    kindLabel: kindLabel,
    groupOf: groupOf,
    wireGroups: wireGroups,
    regroup: regroup,
    groupedWithNext: groupedWithNext,
    setGroupedWithNext: setGroupedWithNext,
    groupLabels: groupLabels,
    targets: targets,
    prescriptionText: prescriptionText,
    setText: setText,
    summary: summary,
    pack: pack,
    unpack: unpack,
  };
})(typeof window !== 'undefined' ? window : globalThis);
