/* Set types: supersets and circuits, drop sets and rest-pause.
 *
 * coach/PLAN-FORMAT.md "Set types" has the rules, and Coach web's
 * coach/prescriptions.js is the reference implementation -- this is a port of
 * its half that a reader needs, function for function where the two overlap,
 * so a coach and their client read the same groups and the same words.
 *
 * Two things, each an optional field omitted when it does not apply, the
 * shape sides already have:
 *
 *   a group      exercises done round by round -- one set of each, then the
 *                rest. Two make a superset, three or more a circuit. Stored
 *                as `group: <positive integer>` on each member exercise. On a
 *                plan link it is `g`. **Adjacency makes the group, not the
 *                number**: `g: 1` on exercises one and three, with another
 *                between them, is two groups of one, and a group of one is an
 *                ordinary exercise -- so storage never keeps one.
 *   a kind       how a set follows the one before it: `kind: "drop"` (no
 *                rest, normally lighter) or `"restPause"` (a short pause,
 *                normally the same weight), omitted when straight. On a plan
 *                link it is flags bits 3-4, OR'd with the side in bits 1-2.
 *                An exercise's first set has no set before it, so it is always
 *                straight, whatever a file says.
 *
 * Where they live in this build:
 *
 *   a coach's plan   `group` on a prescribed exercise and `kind` on a
 *                    prescribed set, in `training` and `templates`, read off
 *                    the link by importTraining.
 *   a started day    copied onto the logged exercise and its pre-filled sets
 *                    by startPrescribed and LiftRoutines.toSession, so the
 *                    session can label them. Informational, like `prescribed`
 *                    and `eachSide`: SHARE-FORMAT carries no set type, and
 *                    LiftSides.encodeSet writes a logged set field by field,
 *                    so none of this reaches a coach. A drop set logged here
 *                    reaches them as an ordinary set with its real numbers.
 *   your routines    `group` on a routine exercise, set with "Superset with
 *                    next". A routine stores a set count, `targetSets`, not a
 *                    list of sets (LIFT for Android's shape), so a kind lives
 *                    beside the count: `setKinds`, an array by set position
 *                    -- index 0 is set 1 -- of "drop", "restPause" or null.
 *                    Index 0 is always null, trailing nulls are trimmed, it
 *                    is never longer than `targetSets`, and it is omitted when
 *                    every set is straight, so a routine without kinds is the
 *                    shape it always was. Set in the routine's Exercises with
 *                    "Drop / rest-pause", copied onto the sets toSession lays
 *                    out. LIFT for Android stores and backs up the same field
 *                    under the same spelling (coach/BACKUP-FORMAT.md).
 *
 * Counted and shown, never graded. Nothing here says whether a superset was
 * done as one, and progression, the imbalance figure and volume read the log,
 * never a plan.
 */
(function (global) {
  'use strict';

  /* Bits 3-4 of flags: 0 straight, 1 drop, 2 rest-pause. 3 is never written
   * and reads as straight, as 3 in the side bits reads as both. */
  var KIND_SHIFT = 3;
  var KIND_MASK = 3;
  var DROP = 'drop';
  var REST_PAUSE = 'restPause';
  var KIND_BITS = { drop: 1, restPause: 2 };

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

  /** The kind of set `i` of a list as it should be shown: the first set is
   *  straight whatever it says, because there is nothing before it to drop
   *  from or pause after -- which can happen in a log, when a set before a
   *  drop set is deleted. */
  function kindAt(sets, i) {
    return i > 0 ? kindOf((sets || [])[i]) : null;
  }

  /** "drop", "rest-pause", or "" for a straight set -- Coach web's words, said
   *  after the side: "30 x 12 L drop". */
  function kindLabel(kind) {
    var k = kindOf(kind);
    return k === DROP ? 'drop' : k === REST_PAUSE ? 'rest-pause' : '';
  }

  /* ---------------- a routine's set kinds ---------------- */

  /** The kind one entry of `setKinds` says: only the strings "drop" and
   *  "restPause", case and space aside. Anything else -- null, "straight",
   *  an object, junk another app wrote -- is straight. */
  function entryKind(v) {
    return typeof v === 'string' ? kindOf(v) : null;
  }

  /** How many sets a routine exercise lays out: `targetSets`, at least one,
   *  as LiftRoutines.toSession counts it. */
  function routineSetCount(exercise) {
    var n = exercise && typeof exercise.targetSets === 'number' ? Math.floor(exercise.targetSets) : 0;
    return Math.max(n, 1);
  }

  /**
   * A routine exercise's `setKinds` as it should be stored, or null when
   * there are none: index 0 null, nothing past `targetSets`, trailing nulls
   * trimmed. Read leniently -- not a list is none, an entry that is not
   * "drop" or "restPause" is straight. None for an exercise carrying a
   * coach's `prescribed` sets, whose kinds live on those sets.
   */
  function routineSetKinds(exercise) {
    if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise.prescribed)) return null;
    var raw = exercise.setKinds;
    if (!Array.isArray(raw)) return null;
    var out = raw.slice(0, routineSetCount(exercise)).map(function (v, i) {
      return i > 0 ? entryKind(v) : null;
    });
    while (out.length && out[out.length - 1] == null) out.pop();
    return out.length ? out : null;
  }

  /** The kind of set `i` of a routine exercise, or null for straight. */
  function routineSetKindAt(exercise, i) {
    var kinds = routineSetKinds(exercise);
    return kinds && i < kinds.length ? kinds[i] : null;
  }

  /**
   * "set 3 drop, set 4 rest-pause": the sets of a routine exercise that are
   * not straight, by number from 1, in order, or "" when every set is
   * straight. Said after the exercise's targets, behind " · ", in the
   * routine's Exercises: "4 x 8 · 185 lb · set 3 drop". LIFT for
   * Android's line (`RoutineExercise.summary`), word for word, so a lifter
   * reads the same sentence on every build. Set 1 never appears -- it is
   * always straight -- and neither does an exercise carrying a coach's
   * `prescribed` sets, whose kinds are on those sets (routineSetKinds).
   */
  function routineSetKindsLine(exercise) {
    var kinds = routineSetKinds(exercise) || [];
    var named = [];
    kinds.forEach(function (kind, i) {
      if (kind) named.push('set ' + (i + 1) + ' ' + kindLabel(kind));
    });
    return named.join(', ');
  }

  /**
   * Set or clear the kind of set `i` of a routine exercise, in place -- the
   * editor's one write. The first set and a set past the count cannot have
   * one. A new list is written rather than the old one changed, so a routine
   * copied from this one keeps its own; and when every set is straight the
   * key is removed.
   */
  function setRoutineSetKind(exercise, i, kind) {
    if (!exercise || typeof exercise !== 'object') return exercise;
    if (i < 1 || i >= routineSetCount(exercise)) return exercise;
    var kinds = (routineSetKinds(exercise) || []).slice();
    while (kinds.length <= i) kinds.push(null);
    kinds[i] = kindOf(kind);
    exercise.setKinds = kinds;
    var stored = routineSetKinds(exercise);
    if (stored) exercise.setKinds = stored;
    else delete exercise.setKinds;
    return exercise;
  }

  /* ---------------- groups ---------------- */

  /** A group number as stored or sent: a positive integer, or null. `0`, a
   *  fraction, a negative, a string or anything else is not grouped. */
  function groupOf(value) {
    var g = value && typeof value === 'object' ? value.group : value;
    return typeof g === 'number' && Number.isInteger(g) && g > 0 ? g : null;
  }

  /**
   * The group each position belongs to, from the raw group numbers in order:
   * runs of two or more adjacent equal numbers become 1, 2, 3... in order of
   * appearance, and everything else -- a lone number, a number its neighbours
   * do not share, no number at all -- is null.
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

  /** The group of each stored exercise, renumbered as the wire would. */
  function wireGroups(exercises) {
    return runs((exercises || []).map(function (ex) { return groupOf(ex); }));
  }

  /** The group of each exercise of a plan link's workout, read from `g`. */
  function decodeGroups(wireExercises) {
    return runs((Array.isArray(wireExercises) ? wireExercises : []).map(function (x) {
      return x && typeof x === 'object' ? groupOf(x.g) : null;
    }));
  }

  /**
   * Rewrite a list's stored groups in place the way the wire would number
   * them: runs renumbered 1, 2, 3..., and a group of one removed. Run after
   * every join and split, and on save and restore, so storage never holds a
   * group that would not be read back as one.
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
   * What each exercise of a list is labelled, or null when it is not grouped:
   * `{ group: "Superset A", member: "A1", first, size }`. Two exercises are a
   * superset and three or more a circuit; the letters run A, B, C... within
   * the day and the members are numbered from 1. Coach web's labels, so a
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

  /* ---------------- storage and the backup file ---------------- */

  /**
   * Normalise one stored exercise in place: `group` kept only as a positive
   * integer, each set's `kind` only as "drop" or "restPause", and the first
   * set never has one; a routine exercise's `setKinds` as routineSetKinds
   * reads it, or no key. An exercise with none of these fields is not
   * touched, so a file written before set types restores exactly as it did;
   * junk reads as not grouped, or straight, rather than failing the import.
   */
  function normaliseExercise(exercise) {
    if (!exercise || typeof exercise !== 'object') return exercise;
    if (groupOf(exercise) == null && 'group' in exercise) delete exercise.group;
    if ('setKinds' in exercise) {
      var kinds = routineSetKinds(exercise);
      if (kinds) exercise.setKinds = kinds;
      else delete exercise.setKinds;
    }
    if (Array.isArray(exercise.sets)) {
      exercise.sets.forEach(function (set, i) {
        if (!set || typeof set !== 'object' || !('kind' in set)) return;
        var kind = i > 0 ? kindOf(set) : null;
        if (kind) set.kind = kind;
        else delete set.kind;
      });
    }
    return exercise;
  }

  /** The same over a routine's or a workout's exercises, and then their
   *  groups as the wire would number them. */
  function normaliseExercises(exercises) {
    if (!Array.isArray(exercises)) return exercises;
    exercises.forEach(normaliseExercise);
    return regroup(exercises);
  }

  /** The same over a backup section of routines or workouts, in place: each
   *  record's exercises. A record without an exercise list is left alone, and
   *  so is anything that is not a list. */
  function normaliseRecords(records) {
    if (!Array.isArray(records)) return records;
    records.forEach(function (r) {
      if (r && typeof r === 'object' && Array.isArray(r.exercises)) normaliseExercises(r.exercises);
    });
    return records;
  }

  global.LiftSetTypes = {
    DROP: DROP,
    REST_PAUSE: REST_PAUSE,
    kindOf: kindOf,
    kindFromFlags: kindFromFlags,
    kindAt: kindAt,
    kindLabel: kindLabel,
    routineSetCount: routineSetCount,
    routineSetKinds: routineSetKinds,
    routineSetKindAt: routineSetKindAt,
    routineSetKindsLine: routineSetKindsLine,
    setRoutineSetKind: setRoutineSetKind,
    groupOf: groupOf,
    wireGroups: wireGroups,
    decodeGroups: decodeGroups,
    regroup: regroup,
    groupedWithNext: groupedWithNext,
    setGroupedWithNext: setGroupedWithNext,
    groupLabels: groupLabels,
    normaliseExercise: normaliseExercise,
    normaliseExercises: normaliseExercises,
    normaliseRecords: normaliseRecords,
  };
})(typeof window !== 'undefined' ? window : globalThis);
