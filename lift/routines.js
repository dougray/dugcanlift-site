/* Routines for the browser build: starter splits, saved templates, and the
 * two conversions between a routine and a workout.
 *
 * Kept as its own script, like backup.js, so node tests the rules rather than
 * an eye. A routine is stored in LIFT for Android's shape exactly -- `id`,
 * `name`, `folder`, `createdAt`, `exercises[]` of `id`, `name`, `equipment`,
 * `targetSets`, `targetReps`, `targetWeightLb`, `targetRpe`,
 * `targetDurationSec`, `targetDistanceMeters`, `note` -- so a backup moves
 * routines between the two with no conversion step.
 */
(function (global) {
  'use strict';

  var present = function (v) { return v !== null && v !== undefined; };
  var positiveInt = function (v) { return Number.isInteger(v) && v > 0 ? v : null; };

  /**
   * Reads splits.json into routines. A malformed entry costs that split, not
   * the list; a split with no usable exercise is dropped. Every read mints
   * fresh ids, so a starter is never the same record as the copy someone adds.
   */
  function parseStarters(json, makeId, now) {
    var rows = json && Array.isArray(json.routines) ? json.routines : [];
    return rows.map(function (row) {
      if (!row || typeof row.name !== 'string' || !row.name) return null;
      var exercises = (Array.isArray(row.exercises) ? row.exercises : []).map(function (e) {
        if (!e || typeof e.name !== 'string' || !e.name) return null;
        return {
          id: makeId(),
          name: e.name,
          equipment: typeof e.equipment === 'string' ? e.equipment : '',
          // A missing count falls back rather than shipping a zero-set exercise.
          targetSets: positiveInt(e.sets) || 3,
          targetReps: positiveInt(e.reps),
          targetWeightLb: null,
          targetRpe: null,
          targetDurationSec: positiveInt(e.durationSec),
          targetDistanceMeters: null,
          note: '',
        };
      }).filter(Boolean);
      if (!exercises.length) return null;
      return {
        id: makeId(),
        name: row.name,
        folder: typeof row.folder === 'string' ? row.folder : '',
        createdAt: now,
        exercises: exercises,
      };
    }).filter(Boolean);
  }

  /** Matched on folder and name, case-insensitively, as on iOS and Android.
   *  Someone who renamed their copy gets the starter offered again. */
  function alreadySaved(starter, routines) {
    var name = starter.name.toLowerCase();
    var folder = (starter.folder || '').toLowerCase();
    return (routines || []).some(function (r) {
      return r && (r.name || '').toLowerCase() === name && (r.folder || '').toLowerCase() === folder;
    });
  }

  /** A copy with its own identity. From here it is the person's to change. */
  function copyOf(routine, makeId, now) {
    return {
      id: makeId(),
      name: routine.name,
      folder: routine.folder || '',
      createdAt: now,
      exercises: routine.exercises.map(function (e) {
        var copy = {};
        Object.keys(e).forEach(function (k) { copy[k] = e[k]; });
        copy.id = makeId();
        return copy;
      }),
    };
  }

  /** Groups in first-seen order. A blank folder reads "My Routines", as on
   *  Android. */
  function byFolder(routines) {
    var groups = [];
    (routines || []).forEach(function (r) {
      var label = (r.folder || '').trim() || 'My Routines';
      var group = groups.find(function (g) { return g.folder === label; });
      if (!group) { group = { folder: label, routines: [] }; groups.push(group); }
      group.routines.push(r);
    });
    return groups;
  }

  var setCount = function (routine) {
    return routine.exercises.reduce(function (t, e) { return t + Math.max(e.targetSets || 0, 1); }, 0);
  };

  /**
   * A workout laid out from a routine, one set per target set. Only targets
   * the routine actually has are copied: a blank weight must stay blank rather
   * than arrive as a zero to be deleted -- the same rule a coach's prescription
   * follows.
   */
  function toSession(routine, date, makeId, now) {
    return {
      id: makeId(),
      date: date,
      name: routine.name,
      note: '',
      startedAt: now,
      exercises: routine.exercises.map(function (e) {
        var sets = [];
        for (var i = 0; i < Math.max(e.targetSets || 0, 1); i++) {
          var set = { id: makeId() };
          if (present(e.targetWeightLb)) set.weightLb = e.targetWeightLb;
          if (present(e.targetReps)) set.reps = e.targetReps;
          if (present(e.targetRpe)) set.rpe = e.targetRpe;
          if (present(e.targetDurationSec)) set.durationSec = e.targetDurationSec;
          if (present(e.targetDistanceMeters)) set.distanceMeters = e.targetDistanceMeters;
          sets.push(set);
        }
        return { id: makeId(), name: e.name, equipment: e.equipment || '', note: e.note || '', sets: sets };
      }),
    };
  }

  /**
   * A workout someone just did, kept as a routine. Android's rules: the most
   * common rep count (so one heavy single does not become the template), the
   * heaviest weight, and at least one set.
   */
  function fromSession(session, name, folder, makeId, now) {
    var mostCommon = function (values) {
      var counts = new Map();
      values.forEach(function (v) { counts.set(v, (counts.get(v) || 0) + 1); });
      var best = null, bestCount = 0;
      counts.forEach(function (c, v) { if (c > bestCount) { best = v; bestCount = c; } });
      return best;
    };
    var nums = function (sets, field) {
      return sets.map(function (s) { return s[field]; }).filter(function (v) { return typeof v === 'number'; });
    };
    return {
      id: makeId(),
      name: (name || '').trim() || (session.name || '').trim() || 'Routine',
      folder: (folder || '').trim(),
      createdAt: now,
      exercises: (session.exercises || []).map(function (e) {
        var sets = e.sets || [];
        var weights = nums(sets, 'weightLb');
        var durations = nums(sets, 'durationSec');
        var distances = nums(sets, 'distanceMeters');
        return {
          id: makeId(),
          name: e.name,
          equipment: e.equipment || '',
          targetSets: Math.max(sets.length, 1),
          targetReps: mostCommon(nums(sets, 'reps')),
          targetWeightLb: weights.length ? Math.max.apply(null, weights) : null,
          targetRpe: null,
          targetDurationSec: mostCommon(durations),
          targetDistanceMeters: distances.length ? Math.max.apply(null, distances) : null,
          note: e.note || '',
        };
      }),
    };
  }

  global.LiftRoutines = {
    parseStarters: parseStarters,
    alreadySaved: alreadySaved,
    copyOf: copyOf,
    byFolder: byFolder,
    setCount: setCount,
    toSession: toSession,
    fromSession: fromSession,
  };
})(typeof window !== 'undefined' ? window : globalThis);
