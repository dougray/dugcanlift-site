/* The next weight: what to lift next time, from what was lifted last time --
 * double progression, the rule most programmes write down. A port of LIFT
 * iOS's `ProgressionRule` and `ProgressionHint`, rule for rule and word for
 * word.
 *
 * - Every working set at last session's top weight reached the routine's
 *   reps, and there were as many of them as the routine asks for: **up** one
 *   step.
 * - Short, but not twice running at that weight: **the same weight again**.
 * - Short at the same weight two sessions running: **back off** about 10%,
 *   rounded down to a step, and build up again.
 *
 * It says why, every time, in the line it gives. It is a suggestion shown
 * beside the sets, never written into them unless "Use" is tapped.
 *
 * No suggestion at all where there is nothing honest to say: no rep target,
 * no earlier session of this lift, or no weight (a bodyweight lift has no step
 * to take). Nor for a lift logged a side at a time: its sides are two lifts,
 * and one number for both would be wrong for each. And none for a coach's
 * session: the coach programmes those numbers, and a second voice on the same
 * set is a contradiction, not help.
 *
 * What differs from iOS, because this build's data does:
 *
 * - **The step is always 5 lb.** iOS uses two of the smallest plate owned for
 *   a bar lift; this build has no plate or bar data, and weighs everything in
 *   pounds (`weightLb`, no unit setting), so the step is the usual dumbbell
 *   and machine jump in pounds. `step('kg')` is iOS's 2.5 kg, kept for the
 *   rule's sake and never reached.
 * - **The routine's reps and sets** are its exercise's `targetReps` and
 *   `targetSets`: a routine here stores a count and one rep target (LIFT for
 *   Android's shape), not a list of sets, so there is no "most reps of any
 *   set" to take. `targetSets` counts as `toSession` lays it out, at least 1.
 * - **Drop and rest-pause sets are not working sets.** A drop set is lighter
 *   on purpose and a rest-pause set short on purpose, so a routine of four
 *   with two of them would otherwise never go up. The routine asks for its
 *   straight sets only -- `targetSets` less the sets its `setKinds` marks --
 *   a logged set with a `kind` is not read, and "Use" leaves one alone: it
 *   keeps its own lighter weight.
 * - **"Not done"** is a set that still holds the routine's own weight, or no
 *   weight at all. iOS has a tick per set; this build has none -- a set is
 *   logged by being there -- so the sets a lifter has not yet put a number
 *   on are the ones `toSession` laid out and nobody changed.
 * - **Which routine** the session came from is `LiftRotation.startedFrom`:
 *   its name and one of its lifts, because nothing more is recorded.
 */
(function (global) {
  'use strict';

  var Rotation = global.LiftRotation;
  /** iOS reads the newest 60 workout days before today. */
  var EARLIER_DAYS = 60;
  var ENABLED_KEY = 'lift.suggestsNextWeight';

  var liftKey = function (name, equipment) {
    return (String(name || '').trim() + '|' + String(equipment || '').trim()).toLowerCase();
  };
  /** A drop or rest-pause set, read as set-types.js reads a kind. */
  var kinded = function (v) {
    var k = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return k === 'drop' || k === 'restpause';
  };
  var sided = function (set) {
    var v = set && typeof set.side === 'string' ? set.side.trim().toLowerCase() : '';
    return v === 'left' || v === 'right';
  };

  function topWeight(session) {
    if (!session.sets.length) return null;
    return Math.max.apply(null, session.sets.map(function (s) { return s.weight; }));
  }

  /** A weight that came through a conversion reads back a hair off. */
  function rounded(value, step) {
    var hundredths = Math.round(value * 100) / 100;
    var steps = Math.round(hundredths / step);
    return Math.abs(steps * step - hundredths) < 0.01 ? steps * step : hundredths;
  }

  /**
   * `target` is the routine's reps, `setCount` how many sets it asks for,
   * `sessions` the earlier days of this lift newest first, each
   * `{ date, sets: [{ weight, reps }] }`, and `step` the smallest change of
   * load. One of
   *   { kind: 'up', to, from, reps, date }
   *   { kind: 'same', weight, reps: [..], target, date }
   *   { kind: 'backOff', to, from, target }
   * or null.
   */
  function next(target, setCount, sessions, step) {
    if (!(target > 0) || !(step > 0) || !sessions || !sessions.length) return null;
    var last = sessions[0];
    var top = topWeight(last);
    if (!(top > 0)) return null;
    var atTop = last.sets.filter(function (s) { return s.weight === top; });

    if (atTop.length >= Math.max(setCount, 1) && atTop.every(function (s) { return s.reps >= target; })) {
      return { kind: 'up', to: rounded(top + step, step), from: top, reps: target, date: last.date };
    }
    if (sessions.length > 1 && topWeight(sessions[1]) === top
        && !sessions[1].sets.filter(function (s) { return s.weight === top; })
          .every(function (s) { return s.reps >= target; })) {
      var lighter = Math.floor(top * 0.9 / step) * step;
      if (lighter > 0 && lighter < top) {
        return { kind: 'backOff', to: rounded(lighter, step), from: top, target: target };
      }
    }
    return { kind: 'same', weight: top, reps: atTop.map(function (s) { return s.reps; }), target: target, date: last.date };
  }

  function weightOf(suggestion) {
    return suggestion.kind === 'same' ? suggestion.weight : suggestion.to;
  }

  /** iOS's: 5 lb or 2.5 kg. No plates here, so no bar case; see the top. */
  function step(unit) {
    return unit === 'kg' ? 2.5 : 5;
  }

  // MARK: - Words

  /** iOS's PlateMath.text: whole numbers bare, otherwise up to two places. */
  function text(value) {
    if (value === Math.round(value)) return String(value);
    var out = value.toFixed(2);
    while (out.endsWith('0')) out = out.slice(0, -1);
    return out;
  }

  /** "Mon, Oct 26" in the reader's own locale, as iOS's is. */
  function day(key, locale) {
    var p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2])
      .toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function line(s, unit, locale) {
    var u = unit || 'lb';
    if (s.kind === 'up') {
      return 'Next: ' + text(s.to) + ' ' + u + '. Every set reached ' + s.reps + ' at ' + text(s.from)
        + ' last time (' + day(s.date, locale) + ').';
    }
    if (s.kind === 'same') {
      return 'Next: ' + text(s.weight) + ' ' + u + ' again. ' + s.reps.join(', ') + ' at ' + text(s.weight)
        + ' last time (' + day(s.date, locale) + '), aiming for ' + s.target + '.';
    }
    return 'Next: ' + text(s.to) + ' ' + u + '. Short of ' + s.target + ' at ' + text(s.from)
      + ' two sessions running, so back off and build up again.';
  }

  function buttonText(s, unit) {
    return 'Use ' + text(weightOf(s)) + ' ' + (unit || 'lb');
  }

  // MARK: - From the log

  /**
   * The working sets of this lift on each earlier day, newest first, from the
   * newest EARLIER_DAYS days before `before`. A day this lift was logged a side
   * at a time is left out: its sides are two lifts. A day is a date, so two
   * sessions on one date are one day, as one iOS WorkoutDay holds both.
   */
  function sessions(exercise, workouts, before) {
    var key = liftKey(exercise.name, exercise.equipment);
    var byDate = new Map();
    (workouts || []).forEach(function (w) {
      if (!w || typeof w.date !== 'string' || !(w.date < before)) return;
      if (!byDate.has(w.date)) byDate.set(w.date, []);
      byDate.get(w.date).push(w);
    });
    return Array.from(byDate.keys()).sort().reverse().slice(0, EARLIER_DAYS).map(function (date) {
      var dayOf = byDate.get(date).slice().sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); });
      var sets = [];
      dayOf.forEach(function (w) {
        (w.exercises || []).forEach(function (e) {
          if (e.id !== exercise.id && liftKey(e.name, e.equipment) === key) sets = sets.concat(e.sets || []);
        });
      });
      if (sets.some(sided)) return null;
      var working = sets
        .filter(function (s) { return !s.warmup && !kinded(s.kind) && s.weightLb > 0 && s.reps > 0; })
        .map(function (s) { return { weight: rounded(s.weightLb, 0.25), reps: s.reps }; });
      return working.length ? { date: date, sets: working } : null;
    }).filter(Boolean);
  }

  /**
   * The routine exercise a logged exercise was started from: the lifter's own
   * routine the session was started from, and that routine's exercise for
   * this lift. Null for a coach's session, or a session from no routine.
   */
  function routineExercise(session, exercise, ctx) {
    var own = Rotation.ownSessions([session], ctx.training, ctx.templates);
    if (!own.length) return null;
    var key = liftKey(exercise.name, exercise.equipment);
    for (var i = 0; i < (ctx.routines || []).length; i++) {
      var routine = ctx.routines[i];
      if (!Rotation.startedFrom(session, routine)) continue;
      var found = (routine.exercises || []).find(function (e) { return liftKey(e.name, e.equipment) === key; });
      if (found) return found;
    }
    return null;
  }

  /**
   * The suggestion for one exercise on screen, or null. `ctx` is
   * `{ routines, workouts, training, templates, today, enabled, perSide }`:
   * `perSide` whether this exercise shows L / R, `today` today's date key.
   */
  function suggestion(session, exercise, ctx) {
    if (!ctx.enabled || ctx.perSide || !session || session.date !== ctx.today) return null;
    var prescribed = routineExercise(session, exercise, ctx);
    if (!prescribed || !(prescribed.targetReps > 0)) return null;
    return next(prescribed.targetReps, straightSets(prescribed),
      sessions(exercise, ctx.workouts, session.date), step('lb'));
  }

  /** How many straight sets a routine exercise asks for: the count toSession
   *  lays out, less the drop and rest-pause sets among them. Set 1 is always
   *  straight, so it is at least one. */
  function straightSets(routineExercise) {
    var count = Math.max(routineExercise.targetSets || 0, 1);
    var kinds = Array.isArray(routineExercise.setKinds) ? routineExercise.setKinds : [];
    var marked = kinds.slice(1, count).filter(kinded).length;
    return count - marked;
  }

  /**
   * The sets "Use" writes the weight into: working sets not done -- still at
   * the routine's own weight, or with none -- whose weight is not already the
   * one. See the top for why that is "not done" here. Never a drop or
   * rest-pause set: the weight is the top set's, and those keep their own.
   */
  function openSets(exercise, prescribed, weight) {
    var laidOut = prescribed && prescribed.targetWeightLb != null ? prescribed.targetWeightLb : null;
    return (exercise.sets || []).filter(function (s) {
      if (s.warmup || kinded(s.kind)) return false;
      var untouched = s.weightLb == null || (laidOut !== null && s.weightLb === laidOut);
      return untouched && s.weightLb !== weight;
    });
  }

  function enabled(storage) {
    try { return storage.getItem(ENABLED_KEY) !== 'false'; } catch (e) { return true; }
  }

  /** On is no key at all, like My equipment's nothing-left-out. */
  function setEnabled(on, storage) {
    if (on) storage.removeItem(ENABLED_KEY);
    else storage.setItem(ENABLED_KEY, 'false');
  }

  global.LiftProgression = {
    ENABLED_KEY: ENABLED_KEY,
    next: next,
    weightOf: weightOf,
    rounded: rounded,
    step: step,
    text: text,
    line: line,
    buttonText: buttonText,
    sessions: sessions,
    routineExercise: routineExercise,
    straightSets: straightSets,
    suggestion: suggestion,
    openSets: openSets,
    enabled: enabled,
    setEnabled: setEnabled,
  };
})(typeof window !== 'undefined' ? window : globalThis);
