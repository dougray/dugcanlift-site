/* A live session: the "training now" mode of a workout on Train. A port of
 * LIFT iOS's live session tools (`SessionRest.swift`, `RestTimer.swift`,
 * `RestCountdown.swift`, `LiveSessionScreen.swift` and `WatchPlanSettings`'s
 * rest), rule for rule and word for word. Plate math is `plates.js`.
 *
 * - **Start live session** on a workout today. Each set then gets a done tick.
 *   End ends it. A day log is complete without ever starting one.
 * - **Ticking a set starts its rest**, of "Rest between sets" (Home ->
 *   Training settings, 90 seconds unless changed, 30 to 300 in steps of 15).
 *   No plan format has a rest field, so the setting is the only length there
 *   is. The next tick starts a fresh rest; unticking or deleting the set that
 *   started it takes it back; End ends it. A banner at the foot of Train counts
 *   down, with -15 / +15 / Skip, and says "Rest over" at the end, when the
 *   phone vibrates where the browser can.
 * - **The rest follows the round** (`after`): round by round across a superset
 *   or circuit, skipping a member that has run out. Ticking a set while
 *   another set of its round is not ticked starts no rest and the banner says
 *   "Next: Seated Cable Rows"; the round's last tick starts the full rest.
 *   Otherwise the next set not ticked decides: a drop set is no rest and "Drop
 *   set next", rest-pause is 15 seconds (fixed, not a setting). A tick with no
 *   rest ends a rest still running.
 * - **The screen stays on** while a session is live (Keep the screen on, on by
 *   default), through the Screen Wake Lock, and stops holding after eight hours
 *   for a session nobody ended.
 *
 * A rest is an **end time**, never a count of seconds left, so a tab put in the
 * background and brought back shows the right time: every figure on screen is
 * worked out from `endsAt` and the clock, not from how many ticks an interval
 * managed to fire.
 *
 * What differs from iOS, because this build's data and platform do:
 *
 * - **The done tick is not on the set.** iOS's tick is the set's own
 *   `completedAt`, which iOS keeps in its backup's `ext` block. This build's
 *   backup, CSV and Send to Coach write a set field by field and have no such
 *   field, so the ticks live beside the log, under `lift.liveSession`, and go
 *   when the session ends. Ticking writes nothing to the set: the set is
 *   already in the log, exactly as Add set or a routine put it there.
 * - **No notification, no lock screen.** The countdown is on the page only:
 *   no permission is asked, and nothing is pushed or fetched.
 * - **A session is a workout, not a day.** This build can hold two workouts on
 *   one day, so the live one is named by its id, and one is live at a time.
 *   iOS records `liveEndedAt` on the day and offers no second start; here
 *   nothing about a session is recorded, so an ended workout can be started
 *   again.
 *
 * Shown, never graded: nothing here counts ticks, compares sessions or says
 * how a rest was used.
 */
(function (global) {
  'use strict';

  var T = global.LiftSetTypes;

  /* ---------------- settings ---------------- */

  var REST_KEY = 'lift.restSeconds';
  /** The watch's own default on iOS, and so iOS's. */
  var DEFAULT_REST_SECONDS = 90;
  var REST_MIN = 30;
  var REST_MAX = 300;
  var REST_STEP = 15;

  /**
   * "Rest between sets", or null for no rest at all.
   *
   * Never set is the normal case and means the default; only a stored number
   * that is not positive means "nothing" (iOS's `resolvedRestSeconds`). A
   * value that is not a number at all is read as never set, not as zero: no
   * rest for anybody whose storage holds junk would be the worse mistake.
   */
  function restSeconds(storage) {
    var raw;
    try { raw = storage.getItem(REST_KEY); } catch (e) { return DEFAULT_REST_SECONDS; }
    if (raw == null || raw === '') return DEFAULT_REST_SECONDS;
    var n = Number(raw);
    if (!isFinite(n)) return DEFAULT_REST_SECONDS;
    var whole = Math.trunc(n);
    return whole > 0 ? whole : null;
  }

  /** Held to the stepper's range and steps, as iOS's stepper holds it. */
  function setRestSeconds(seconds, storage) {
    var n = Math.round((Number(seconds) || 0) / REST_STEP) * REST_STEP;
    n = Math.min(Math.max(n, REST_MIN), REST_MAX);
    try { storage.setItem(REST_KEY, String(n)); } catch (e) { /* keep going */ }
    return n;
  }

  var SCREEN_KEY = 'lift.keepScreenOn';

  /** On is no key at all, like Suggest the next weight. */
  function screenEnabled(storage) {
    try { return storage.getItem(SCREEN_KEY) !== 'false'; } catch (e) { return true; }
  }

  function setScreenEnabled(on, storage) {
    try {
      if (on) storage.removeItem(SCREEN_KEY);
      else storage.setItem(SCREEN_KEY, 'false');
    } catch (e) { /* keep going */ }
  }

  /* ---------------- the screen ---------------- */

  /** As long as iOS keeps a Live Activity, and so how long iOS holds it. */
  var LONGEST_HOLD_MS = 8 * 3600 * 1000;

  /** Whether the screen is held: a session started under eight hours ago and
   *  not ended. The day it started on does not matter, so one that runs past
   *  midnight keeps holding. `liveSince` is epoch milliseconds. */
  function holdsScreenOn(liveSince, enabled, now) {
    if (!enabled) return false;
    return (liveSince || []).some(function (start) {
      var elapsed = now - start;
      return elapsed >= 0 && elapsed < LONGEST_HOLD_MS;
    });
  }

  /** When that answer next changes on its own, or null. A screen held awake
   *  never hides the page, so nothing else would ask again. */
  function nextCutoff(liveSince, now) {
    var cutoffs = (liveSince || []).map(function (s) { return s + LONGEST_HOLD_MS; })
      .filter(function (c) { return c > now; });
    return cutoffs.length ? Math.min.apply(null, cutoffs) : null;
  }

  /* ---------------- the countdown ---------------- */

  /** Fifteen minutes, as long as anyone rests between sets on purpose. */
  var LONGEST_REST_SECONDS = 15 * 60;

  /** One rest: when it started and when it is over, epoch milliseconds. */
  function countdown(seconds, setId, exerciseName, now) {
    var s = Math.min(Math.max(0, seconds), LONGEST_REST_SECONDS);
    return { startedAt: now, endsAt: now + s * 1000,
             setId: setId == null ? null : setId,
             exerciseName: exerciseName == null ? null : exerciseName };
  }

  /** Seconds left, never below nothing. */
  function remaining(rest, now) { return Math.max(0, (rest.endsAt - now) / 1000); }

  function isOver(rest, now) { return now >= rest.endsAt; }

  /** Fifteen seconds more or less. Never below nothing left and never past the
   *  longest rest from now; added to a rest already over, it counts from now.
   *  The start stays where it was. */
  function adjusted(rest, seconds, now) {
    var left = remaining(rest, now) + seconds;
    var copy = Object.assign({}, rest);
    copy.endsAt = now + Math.min(Math.max(0, left), LONGEST_REST_SECONDS) * 1000;
    return copy;
  }

  /** "1:35". Rounded up, so it never reads 0:00 with time still left. */
  function clock(seconds) {
    var whole = Math.ceil(seconds - 1e-9);
    if (whole < 0) whole = 0;
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }

  /* ---------------- the rest follows the round ---------------- */

  /** Rest-pause is a fixed pause, not a setting (the design's own call). */
  var REST_PAUSE_SECONDS = 15;

  /**
   * Every set of the day in the order it is trained. `exercises` is
   * [{ name, restName, group, sets: [{ id, done, kind }] }]: an ungrouped
   * exercise is its sets in order; a group is one set of each member, in
   * order, then the next round, and a member that has run out is skipped.
   * Adjacency makes a group, as everywhere else (LiftSetTypes).
   */
  function order(exercises) {
    var groups = T.wireGroups(exercises);
    var steps = [];
    var i = 0;
    while (i < exercises.length) {
      var group = groups[i];
      if (group == null) {
        for (var s = 0; s < exercises[i].sets.length; s++) {
          steps.push({ exercise: i, set: s, block: i, round: s, grouped: false });
        }
        i += 1;
        continue;
      }
      var end = i;
      while (end < exercises.length && groups[end] === group) end += 1;
      var rounds = 0;
      for (var m = i; m < end; m++) rounds = Math.max(rounds, exercises[m].sets.length);
      for (var round = 0; round < rounds; round++) {
        for (var member = i; member < end; member++) {
          if (round < exercises[member].sets.length) {
            steps.push({ exercise: member, set: round, block: i, round: round, grouped: true });
          }
        }
      }
      i = end;
    }
    return steps;
  }

  /**
   * What ticking `setId` done starts:
   *   { type: 'rest', seconds, before }   a rest, before the named exercise
   *   { type: 'noRest', cue }             no rest, and what the banner says
   *   { type: 'nothing' }                 the rest is turned off
   * `restSeconds` is "Rest between sets", null when it is off.
   */
  function after(setId, exercises, restSeconds) {
    if (!(restSeconds > 0)) return { type: 'nothing' };
    var steps = order(exercises);
    var setAt = function (step) { return exercises[step.exercise].sets[step.set]; };
    var waiting = function (step) { var s = setAt(step); return !s.done && s.id !== setId; };

    var position = -1;
    for (var p = 0; p < steps.length; p++) { if (setAt(steps[p]).id === setId) { position = p; break; } }
    if (position < 0) return { type: 'rest', seconds: restSeconds, before: null };
    var ticked = steps[position];

    // The round is not over while another of its sets is still to do.
    if (ticked.grouped) {
      var other = steps.filter(function (st) {
        return st.block === ticked.block && st.round === ticked.round && waiting(st);
      })[0];
      if (other) return { type: 'noRest', cue: 'Next: ' + exercises[other.exercise].name };
    }

    var next = steps.slice(position + 1).filter(waiting)[0];
    if (!next) return { type: 'rest', seconds: restSeconds, before: exercises[ticked.exercise].restName };
    var kind = T.kindOf(setAt(next).kind);
    if (kind === T.DROP) return { type: 'noRest', cue: 'Drop set next' };
    if (kind === T.REST_PAUSE) {
      return { type: 'rest', seconds: REST_PAUSE_SECONDS, before: exercises[next.exercise].restName };
    }
    // Back to whatever comes next inside a group; otherwise the exercise just
    // ticked, which is what the rest always said.
    var before = next.block === ticked.block ? next.exercise : ticked.exercise;
    return { type: 'rest', seconds: restSeconds, before: exercises[before].restName };
  }

  /** The heading Train gives an exercise, "Bench Press (barbell)": what a
   *  rest is before. */
  function restName(ex) {
    return ex.equipment ? ex.name + ' (' + ex.equipment + ')' : ex.name;
  }

  /** A workout as `after` reads it: each exercise's group, and each set's done
   *  tick and kind, with an exercise's first set always straight. */
  function exercisesOf(session, done) {
    var isDone = function (id) { return done ? (done.has ? done.has(id) : done.indexOf(id) >= 0) : false; };
    return ((session && session.exercises) || []).map(function (ex) {
      var sets = ex.sets || [];
      return {
        name: ex.name,
        restName: restName(ex),
        group: T.groupOf(ex),
        sets: sets.map(function (st, i) {
          return { id: st.id, done: isDone(st.id), kind: T.kindAt(sets, i) };
        }),
      };
    });
  }

  /* ---------------- the rest timer ---------------- */

  var REST_STORE_KEY = 'lift.rest';
  /** How long "Rest over" stays on screen once it is, in seconds. */
  var KEEPS_OVER_FOR = 120;
  var STEP_SECONDS = 15;

  function readRest(storage) {
    try {
      var raw = storage.getItem(REST_STORE_KEY);
      var r = raw ? JSON.parse(raw) : null;
      if (r && typeof r.startedAt === 'number' && typeof r.endsAt === 'number'
          && isFinite(r.startedAt) && isFinite(r.endsAt)) {
        return { startedAt: r.startedAt, endsAt: r.endsAt,
                 setId: r.setId == null ? null : String(r.setId),
                 exerciseName: typeof r.exerciseName === 'string' ? r.exerciseName : null };
      }
    } catch (e) { /* unreadable is no rest */ }
    return null;
  }

  /**
   * The rest between sets, one at a time. Kept in storage, so a reload or a
   * tab the browser discarded loses nothing, and one long over is dropped on
   * the way back in (`restore`) rather than greeting someone the next morning.
   *
   * `cue` is what the banner says when a tick starts no rest: "Next: Seated
   * Cable Rows", "Drop set next". Never at the same time as a rest, and not
   * kept: it has no end time, and the next tick says it again.
   */
  function RestTimer(storage) {
    this.storage = storage;
    this.current = readRest(storage);
    this.cue = null;
  }

  RestTimer.prototype._store = function (rest) {
    this.current = rest;
    try { this.storage.setItem(REST_STORE_KEY, JSON.stringify(rest)); } catch (e) { /* keep going */ }
  };

  RestTimer.prototype._clear = function () {
    this.current = null;
    try { this.storage.removeItem(REST_STORE_KEY); } catch (e) { /* keep going */ }
  };

  /** `restSeconds` null is "no rest": nothing starts. */
  RestTimer.prototype.setDone = function (setId, exerciseName, restSeconds, now) {
    this.cue = null;
    if (!(restSeconds > 0)) return;
    this._store(countdown(restSeconds, setId, exerciseName, now));
  };

  /** A tick that starts no rest. A rest still running is over -- the next set
   *  has begun -- and the banner says what comes next instead. */
  RestTimer.prototype.setDoneNoRest = function (setId, text) {
    if (this.current) this._clear();
    this.cue = { setId: setId, text: text };
  };

  /** What `after` decided, carried out. */
  RestTimer.prototype.apply = function (setId, decision, exerciseName, now) {
    if (decision.type === 'rest') {
      this.setDone(setId, decision.before != null ? decision.before : exerciseName, decision.seconds, now);
    } else if (decision.type === 'noRest') {
      this.setDoneNoRest(setId, decision.cue);
    } else {
      this.setDone(setId, exerciseName, null, now);
    }
  };

  RestTimer.prototype.setUndone = function (setId) {
    if (this.cue && this.cue.setId === setId) this.cue = null;
    if (!this.current || this.current.setId !== setId) return;
    this._clear();
  };

  RestTimer.prototype.adjust = function (seconds, now) {
    if (!this.current) return;
    this._store(adjusted(this.current, seconds, now));
  };

  RestTimer.prototype.skip = function () {
    this.cue = null;
    if (this.current) this._clear();
  };

  RestTimer.prototype.sessionEnded = function () { this.skip(); };

  /** On the way back to the page: a rest over for a while is done with. */
  RestTimer.prototype.restore = function (now) {
    if (this.current && (now - this.current.endsAt) / 1000 > KEEPS_OVER_FOR) this._clear();
  };

  /* ---------------- which workout is live ---------------- */

  var LIVE_KEY = 'lift.liveSession';

  /** { sessionId, startedAt, done: [set ids] }, or null. */
  function readLive(storage) {
    try {
      var raw = storage.getItem(LIVE_KEY);
      var v = raw ? JSON.parse(raw) : null;
      if (v && typeof v.sessionId === 'string' && typeof v.startedAt === 'number' && isFinite(v.startedAt)) {
        return { sessionId: v.sessionId, startedAt: v.startedAt,
                 done: Array.isArray(v.done) ? v.done.filter(function (id) { return typeof id === 'string'; }) : [] };
      }
    } catch (e) { /* unreadable is not live */ }
    return null;
  }

  function writeLive(live, storage) {
    try {
      if (live) storage.setItem(LIVE_KEY, JSON.stringify(live));
      else storage.removeItem(LIVE_KEY);
    } catch (e) { /* keep going */ }
  }

  function start(sessionId, now) { return { sessionId: sessionId, startedAt: now, done: [] }; }

  function isDone(live, setId) { return !!live && live.done.indexOf(setId) >= 0; }

  /** The same session with `setId` ticked or not. */
  function withTick(live, setId, on) {
    var done = live.done.filter(function (id) { return id !== setId; });
    if (on) done.push(setId);
    return { sessionId: live.sessionId, startedAt: live.startedAt, done: done };
  }

  global.LiftLiveSession = {
    REST_KEY: REST_KEY,
    DEFAULT_REST_SECONDS: DEFAULT_REST_SECONDS,
    REST_MIN: REST_MIN,
    REST_MAX: REST_MAX,
    REST_STEP: REST_STEP,
    restSeconds: restSeconds,
    setRestSeconds: setRestSeconds,
    SCREEN_KEY: SCREEN_KEY,
    screenEnabled: screenEnabled,
    setScreenEnabled: setScreenEnabled,
    LONGEST_HOLD_MS: LONGEST_HOLD_MS,
    holdsScreenOn: holdsScreenOn,
    nextCutoff: nextCutoff,
    LONGEST_REST_SECONDS: LONGEST_REST_SECONDS,
    countdown: countdown,
    remaining: remaining,
    isOver: isOver,
    adjusted: adjusted,
    clock: clock,
    REST_PAUSE_SECONDS: REST_PAUSE_SECONDS,
    order: order,
    after: after,
    restName: restName,
    exercisesOf: exercisesOf,
    REST_STORE_KEY: REST_STORE_KEY,
    KEEPS_OVER_FOR: KEEPS_OVER_FOR,
    STEP_SECONDS: STEP_SECONDS,
    RestTimer: RestTimer,
    LIVE_KEY: LIVE_KEY,
    readLive: readLive,
    writeLive: writeLive,
    start: start,
    isDone: isDone,
    withTick: withTick,
  };
})(typeof window !== 'undefined' ? window : globalThis);
