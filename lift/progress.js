/* Progress: your year, muscles this week, body weight, progress photos.
 *
 * A port of LIFT iOS's `ProgressRules.swift` and `ProgressPhotoStore`, rule
 * for rule (lift-ios #60; LIFT superproject build plan 2026-10-28, items
 * 9-12). `progress.test.mjs` is a port of `ProgressRulesTests` and
 * `ProgressPhotoStoreTests`, case for case where a browser has the same thing.
 *
 * Counting, never grading: a quiet week is a count of zero, said plainly, and
 * nothing is coloured as a failure.
 *
 * Dates are LIFT web's own `YYYY-MM-DD` keys, read as local days, and day
 * arithmetic goes through `Date#setDate`, so a daylight-saving change never
 * repeats or skips a day.
 */
(function (global) {
  'use strict';

  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var dateKey = function (d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };
  var KEY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var parseKey = function (key) {
    var m = KEY_SHAPE.exec(String(key || ''));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return dateKey(d) === key ? d : null;
  };
  function shiftKey(key, days) {
    var dt = parseKey(key);
    dt.setDate(dt.getDate() + days);
    return dateKey(dt);
  }

  /* ---------------- the year ---------------- */

  /** A day's level from its working sets: 0 none, 1 a few (1-9), 2 a session
   *  (10-19), 3 a big one (20 or more). Fixed steps rather than quartiles of
   *  the year, so the same day reads the same next month. */
  function level(sets) {
    if (!(sets >= 1)) return 0;
    if (sets < 10) return 1;
    if (sets < 20) return 2;
    return 3;
  }

  /** The first day of the week holding `key`. `firstDay` is JavaScript's
   *  numbering, 0 Sunday to 6 Saturday. */
  function weekStart(key, firstDay) {
    var back = (parseKey(key).getDay() - firstDay + 7) % 7;
    return shiftKey(key, -back);
  }

  /** A year of training days as weeks of seven, oldest first, ending with the
   *  week holding `today`. `setsByDay` is keyed by day. A day after today is
   *  `isFuture`, drawn as nothing at all, never as a rest day. */
  function weeks(setsByDay, today, count, firstDay) {
    var n = count == null ? 53 : count;
    var first = shiftKey(weekStart(today, firstDay == null ? 1 : firstDay), -7 * (n - 1));
    var out = [];
    for (var w = 0; w < n; w++) {
      var week = [];
      for (var d = 0; d < 7; d++) {
        var key = shiftKey(first, w * 7 + d);
        var sets = (setsByDay && setsByDay[key]) || 0;
        var future = key > today;
        week.push({ key: key, sets: sets, isFuture: future, level: future ? 0 : level(sets) });
      }
      out.push(week);
    }
    return out;
  }

  /** Days with any working set in the 365 days up to and including today. */
  function trainingDays(setsByDay, today) {
    var start = shiftKey(today, -364);
    return Object.keys(setsByDay || {}).filter(function (key) {
      return setsByDay[key] > 0 && parseKey(key) && key >= start && key <= today;
    }).length;
  }

  /** "1 training day in the last 12 months". */
  function trainingDaysText(total) {
    return total === 1 ? '1 training day in the last 12 months'
      : total + ' training days in the last 12 months';
  }

  /** Working sets by day from LIFT web's sessions: every set but a warmup. A
   *  drop or rest-pause set is a working set. Two sessions on one day add up. */
  function setsByDay(workouts) {
    var counts = {};
    (workouts || []).forEach(function (s) {
      if (!s || !s.date) return;
      var working = 0;
      (s.exercises || []).forEach(function (ex) {
        (ex && ex.sets || []).forEach(function (st) { if (st && !st.warmup) working++; });
      });
      counts[s.date] = (counts[s.date] || 0) + working;
    });
    return counts;
  }

  /* ---------------- muscles this week ---------------- */

  /** `"name|equipment"`, trimmed and lowercased: an identity for lookup, never
   *  shown. LIFT iOS's `ExerciseKey.make`. */
  function muscleKey(name, equipment) {
    return String(name == null ? '' : name).trim().toLowerCase() + '|'
      + String(equipment == null ? '' : equipment).trim().toLowerCase();
  }

  /** The exercise library as a lookup: by name and equipment, and by name
   *  alone (`name|`) as the fallback an exercise logged with no equipment
   *  needs, the first muscle for a name winning. `records` are
   *  `{ name, equipment, muscle }`, as app.js reads exercises.json. */
  function muscleLookup(records) {
    var map = {};
    (records || []).forEach(function (r) {
      if (!r || !r.muscle) return;
      map[muscleKey(r.name, r.equipment)] = r.muscle;
      var bare = muscleKey(r.name, null);
      if (map[bare] === undefined) map[bare] = r.muscle;
    });
    return map;
  }

  /** Every muscle a lookup knows, lowercased and sorted. */
  function allMuscles(lookup) {
    var seen = {};
    Object.keys(lookup || {}).forEach(function (k) { seen[String(lookup[k]).toLowerCase()] = true; });
    return Object.keys(seen).sort();
  }

  /** Working sets per primary muscle. A muscle comes from the exercise as
   *  logged, and failing that from the library by name and equipment, then by
   *  name alone. An exercise nobody can place is counted as unplaced, said in
   *  words, rather than guessed into a muscle.
   *
   *  `logged` is `{ name, equipment, primaryMuscle, workingSets }`. Returns
   *  `trained` (muscle and sets, most first, names breaking a tie),
   *  `untrained` (every muscle the library knows that got no set) and
   *  `unplacedSets`. */
  function tally(logged, lookup, muscles) {
    var sets = {};
    var unplaced = 0;
    (logged || []).forEach(function (entry) {
      if (!(entry.workingSets > 0)) return;
      var muscle = (entry.primaryMuscle ? entry.primaryMuscle : null)
        || lookup[muscleKey(entry.name, entry.equipment)]
        || lookup[muscleKey(entry.name, null)];
      if (muscle) {
        var k = String(muscle).toLowerCase();
        sets[k] = (sets[k] || 0) + entry.workingSets;
      } else {
        unplaced += entry.workingSets;
      }
    });
    var trained = Object.keys(sets)
      .sort(function (a, b) { return sets[a] !== sets[b] ? sets[b] - sets[a] : (a < b ? -1 : a > b ? 1 : 0); })
      .map(function (m) { return { muscle: m, sets: sets[m] }; });
    var seen = {};
    (muscles || []).forEach(function (m) { seen[String(m).toLowerCase()] = true; });
    var untrained = Object.keys(seen).filter(function (m) { return !sets[m]; }).sort();
    return { trained: trained, untrained: untrained, unplacedSets: unplaced };
  }

  /** The exercises logged in the week holding `today`, for `tally`. */
  function loggedThisWeek(workouts, today, firstDay) {
    var from = weekStart(today, firstDay == null ? 1 : firstDay);
    var to = shiftKey(from, 6);
    var out = [];
    (workouts || []).forEach(function (s) {
      if (!s || !(s.date >= from && s.date <= to)) return;
      (s.exercises || []).forEach(function (ex) {
        if (!ex) return;
        out.push({
          name: ex.name || '', equipment: ex.equipment || '',
          primaryMuscle: ex.primaryMuscle || null,
          workingSets: (ex.sets || []).filter(function (st) { return st && !st.warmup; }).length,
        });
      });
    });
    return out;
  }

  /** "1 set is from an exercise LIFT can't place on a muscle." */
  function unplacedText(n) {
    return n === 1 ? "1 set is from an exercise LIFT can't place on a muscle."
      : n + " sets are from exercises LIFT can't place on a muscle.";
  }

  /* ---------------- body weight ---------------- */

  /** LIFT iOS's `PlateMath.text`: whole numbers bare, otherwise up to two
   *  decimals with trailing zeros dropped. */
  function numberText(value) {
    if (value === Math.round(value)) return String(value);
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  var tenth = function (v) { return Math.round(v * 10) / 10; };

  /** The weigh-ins kept in LIFT web's `weights` map (one a day, by day, in
   *  pounds) from `since` on, oldest first. Anything that is not a positive
   *  number is not a weigh-in. */
  function points(weights, since) {
    return Object.keys(weights || {})
      .filter(function (k) { return parseKey(k) && (!since || k >= since); })
      .map(function (k) { return { key: k, lb: Number(weights[k]) }; })
      .filter(function (p) { return isFinite(p.lb) && p.lb > 0; })
      .sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  }

  /** "Aug 1", the reader's way. */
  function shortDay(key, locale) {
    return parseKey(key).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }

  /** The card's line: the latest weigh-in, the change over the period on
   *  screen, and how far from a goal, if one is set. Pounds, as every weight
   *  LIFT web stores is. Null with no weigh-ins. */
  function summary(pts, goalLb, locale) {
    if (!pts || !pts.length) return null;
    var latest = pts[pts.length - 1];
    var parts = [numberText(tenth(latest.lb)) + ' lb'];
    if (pts.length > 1) {
      var first = pts[0];
      var change = latest.lb - first.lb;
      var rounded = tenth(Math.abs(change));
      parts.push(rounded === 0 ? 'no change since ' + shortDay(first.key, locale)
        : (change > 0 ? 'up ' : 'down ') + numberText(rounded) + ' since ' + shortDay(first.key, locale));
    }
    if (goalLb > 0) {
      var gap = tenth(Math.abs(latest.lb - goalLb));
      parts.push(gap === 0 ? 'at your goal'
        : numberText(gap) + ' from your goal of ' + numberText(tenth(goalLb)));
    }
    return parts.join(' · ');
  }

  /** A typed weight: a positive, finite number, or null for blank or junk. A
   *  comma is read as a decimal point, since that is what a phone keyboard in
   *  much of the world types. */
  function typedWeight(text) {
    var t = String(text == null ? '' : text).trim().replace(',', '.');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    var v = Number(t);
    return isFinite(v) && v > 0 ? v : null;
  }

  /* ---------------- progress photos ----------------
   *
   * Kept in this browser's IndexedDB, never in localStorage (which holds the
   * log and goes into every backup), never in a backup file, never in a link
   * to a coach. A photo is megabytes; a backup that quietly grew by a gigabyte
   * of pictures is a backup nobody can move to a new phone.
   *
   * Re-encoded as a JPEG no longer than 2048 px on its long side before it is
   * kept: plenty to compare two photos, a fraction of a camera original, and
   * the re-encode leaves the original's location metadata behind. */

  var LONGEST = 2048;

  /** The size a picture is drawn at to be kept: no side over `longest`, never
   *  enlarged. */
  function scaledSize(width, height, longest) {
    var cap = longest || LONGEST;
    var scale = Math.min(1, cap / Math.max(width, height, 1));
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  }

  /** Oldest first: by day, then by id. A record without a valid day is not one
   *  of these and is left out. */
  function orderPhotos(records) {
    return (records || []).filter(function (r) { return r && parseKey(r.dayKey) && r.id; })
      .sort(function (a, b) {
        if (a.dayKey !== b.dayKey) return a.dayKey < b.dayKey ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }

  /** "Oct 26, 2026", the reader's way. LIFT iOS's `PlanDayText.short`. */
  function photoDay(key, locale) {
    return parseKey(key).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var DB_NAME = 'lift-photos';
  var STORE = 'photos';

  function openDb(indexedDB) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function run(indexedDB, mode, work) {
    return openDb(indexedDB).then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var result;
        var req = work(tx.objectStore(STORE));
        if (req) req.onsuccess = function () { result = req.result; };
        tx.oncomplete = function () { db.close(); resolve(result); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  /** The photo store over an IndexedDB factory: `list()` oldest first,
   *  `add(blob, dayKey, id)`, `remove(id)`. A record is `{ id, dayKey, blob }`
   *  and nothing else. */
  function photoStore(indexedDB) {
    return {
      list: function () {
        return run(indexedDB, 'readonly', function (store) { return store.getAll(); }).then(orderPhotos);
      },
      add: function (blob, dayKey, id) {
        var record = { id: id, dayKey: dayKey, blob: blob };
        return run(indexedDB, 'readwrite', function (store) { store.put(record); }).then(function () { return record; });
      },
      remove: function (id) {
        return run(indexedDB, 'readwrite', function (store) { store.delete(id); });
      },
    };
  }

  global.LiftProgress = {
    year: { level: level, weeks: weeks, trainingDays: trainingDays, text: trainingDaysText, setsByDay: setsByDay },
    muscles: {
      key: muscleKey, lookup: muscleLookup, all: allMuscles, tally: tally,
      loggedThisWeek: loggedThisWeek, unplacedText: unplacedText,
    },
    bodyWeight: { points: points, summary: summary, typed: typedWeight, numberText: numberText },
    photos: {
      LONGEST: LONGEST, scaledSize: scaledSize, order: orderPhotos, day: photoDay, store: photoStore,
    },
    weekStart: weekStart,
    shiftKey: shiftKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
