/* Training history in and out as CSV: in from Strong, Hevy and FitNotes, out
 * as LIFT's own one-row-per-set file. A port of LIFT iOS's `WorkoutCSV`
 * (lift-ios #63), rule for rule, checked against the same fixtures:
 * `fixtures/csv-*.csv` are the iPhone's `Tests/Fixtures/csv-*.csv`, copied
 * byte for byte. Never regenerate them here.
 *
 * **None of the three apps publishes its export format.** Their help pages say
 * only where the export button is. Every header, delimiter and date shape here
 * was read from real exports people have published, so the reader is strict
 * about what it recognises and says plainly when it does not: a file it cannot
 * place is refused, never half-read.
 *
 * **Weights become pounds on the way in**, because every weight LIFT web
 * stores is pounds (the iPhone, which stores kilograms, converts the other
 * way). A pound figure is kept exactly; a kilogram figure is converted and
 * kept to two decimals. Hevy and FitNotes say their unit in the file. Strong's
 * semicolon export says "Weight (kg)". Strong's comma export says nothing at
 * all, so the person importing it is asked, because a guess is 2.2x wrong
 * either way.
 *
 * **Blank stays blank.** LIFT web's set fields are all optional, so a weight,
 * reps or time the file leaves empty -- or writes as 0, the way these apps fill
 * a column a set did not use -- is not recorded, rather than recorded as zero.
 * The iPhone's weight and reps are not optional and hold 0 instead.
 */
(function (global) {
  'use strict';

  var LB_PER_KG = 2.2046226218; // LiftCore's WeightUnit
  var METERS_PER_MILE = 1609.344;

  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var dayKey = function (d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };
  var round2 = function (v) { return Math.round(v * 100) / 100; };

  /** A weight in `unit` ('lb' or 'kg') as LIFT web's pounds. */
  function toLb(value, unit) {
    return unit === 'lb' ? value : round2(value * LB_PER_KG);
  }

  /* ---------------- reading CSV ---------------- */

  /** RFC 4180, with the delimiter taken from the header (Strong's Android
   *  export uses `;`), quotes doubled to escape, CR LF or LF, and a BOM
   *  dropped. */
  function parse(text) {
    var source = String(text == null ? '' : text);
    if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1);
    var firstLine = source.split(/\r?\n|\r/, 1)[0] || '';
    var count = function (ch) { return firstLine.split(ch).length - 1; };
    var delimiter = count(';') > count(',') ? ';' : ',';
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    for (var i = 0; i < source.length; i++) {
      var ch = source[i];
      if (quoted) {
        if (ch === '"') {
          if (source[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** Spaces and tabs, as Swift's `.whitespaces` trims. */
  var trim = function (s) { return String(s == null ? '' : s).replace(/^[ \t]+|[ \t]+$/g, ''); };

  function columns(names) {
    var index = {};
    names.forEach(function (name, i) { if (index[name] === undefined) index[name] = i; });
    return {
      has: function (name) { return index[name] !== undefined; },
      value: function (row, name) {
        var i = index[name];
        return i === undefined || i >= row.length ? '' : trim(row[i]);
      },
    };
  }

  /** Digits and a point only: every export seen writes a point whatever the
   *  phone's language, and a comma read as a decimal would turn 1,000 m into
   *  one. Negative, blank and anything else is no number. */
  function number(text) {
    var t = trim(text);
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    var v = Number(t);
    return isFinite(v) ? v : null;
  }
  var positive = function (v) { return v != null && v > 0 ? v : null; };

  /** "0:01:30" or "1:30" -> seconds. */
  function clockSeconds(text) {
    var parts = String(text == null ? '' : text).split(':').filter(function (p) { return p !== ''; });
    if (!parts.length || !parts.every(function (p) { return /^\d+$/.test(p); })) return null;
    var seconds = parts.reduce(function (t, p) { return t * 60 + Number(p); }, 0);
    return seconds > 0 ? seconds : null;
  }

  /** "Bench Press (Barbell)" -> ["Bench Press", "Barbell"], the shape Strong
   *  and Hevy both name an exercise in. A name with no trailing bracket is
   *  left whole. */
  function splitEquipment(text) {
    var t = trim(text);
    var open = t.lastIndexOf('(');
    if (t.slice(-1) !== ')' || open <= 0) return [t, null];
    var name = trim(t.slice(0, open));
    var equipment = trim(t.slice(open + 1, -1));
    return name && equipment ? [name, equipment] : [t, null];
  }

  /* Times have no zone in any of the three files, so they are read as the
   * device's own local time, which is what each app wrote them in. */
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function local(y, mo, d, h, mi, s) {
    var date = new Date(y, mo, d, h, mi, s || 0);
    return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d
      && date.getHours() === h && date.getMinutes() === mi ? date : null;
  }
  function strongDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(trim(text));
    return m ? local(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }
  /** "2 Mar 2026, 18:04", or "Oct 1, 2026, 8:28 PM". */
  function hevyDate(text) {
    var t = trim(text);
    var m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4}), (\d{1,2}):(\d{2})$/.exec(t);
    if (m) {
      var mo = MONTHS.indexOf(m[2].toLowerCase());
      return mo < 0 ? null : local(+m[3], mo, +m[1], +m[4], +m[5]);
    }
    m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) ([AaPp][Mm])$/.exec(t);
    if (m) {
      var month = MONTHS.indexOf(m[1].toLowerCase());
      var hour = +m[4];
      if (month < 0 || hour < 1 || hour > 12) return null;
      hour = hour % 12 + (m[6].toLowerCase() === 'pm' ? 12 : 0);
      return local(+m[3], month, +m[2], hour, +m[5]);
    }
    return null;
  }
  /** A day with no time: noon, so it never slides a day either way. */
  function fitNotesDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(text));
    return m ? local(+m[1], +m[2] - 1, +m[3], 12, 0) : null;
  }

  /* ---------------- what a file holds ---------------- */

  /** Groups rows into workouts and exercises in the order they first appear;
   *  a set joins the exercise before it when name and equipment match. */
  function builder() {
    var order = [];
    var byKey = {};
    return {
      add: function (set, key, date, workoutName, exercise, equipment, muscle) {
        if (!exercise) return;
        if (!byKey[key]) {
          order.push(key);
          byKey[key] = { date: date, name: workoutName, exercises: [] };
        }
        var exercises = byKey[key].exercises;
        var last = exercises[exercises.length - 1];
        if (last && last.name === exercise && last.equipment === equipment) last.sets.push(set);
        else exercises.push({ name: exercise, equipment: equipment, primaryMuscle: muscle, sets: [set] });
      },
      workouts: function () {
        return order.map(function (k) { return byKey[k]; })
          .sort(function (a, b) { return a.date - b.date; });
      },
    };
  }

  function emptySet() {
    return { weightLb: null, reps: null, rpe: null, warmup: false, durationSec: null, distanceMeters: null };
  }
  var reps = function (v) { return v != null && v > 0 ? Math.trunc(v) : null; };

  /** One row per set, plus "Note" and "Rest Timer" rows that are not sets.
   *  `Set Order` is a number for a working set, `W` a warm-up, `D` a drop set
   *  and `F` a set to failure; the last two are working sets here. */
  function strong(rows, c, unit, weightColumn) {
    var b = builder();
    var distanceColumn = c.has('Distance (meters)') ? 'Distance (meters)' : 'Distance';
    rows.forEach(function (row) {
      var order = c.value(row, 'Set Order');
      if (order === 'Note' || order === 'Rest Timer') return;
      var date = strongDate(c.value(row, 'Date'));
      if (!date) return;
      var key = (c.has('Workout #') ? c.value(row, 'Workout #') : '') + '|' + c.value(row, 'Date')
        + '|' + c.value(row, 'Workout Name');
      var named = splitEquipment(c.value(row, 'Exercise Name'));
      var set = emptySet();
      var weight = positive(number(c.value(row, weightColumn)));
      set.weightLb = weight == null ? null : toLb(weight, unit);
      set.reps = reps(number(c.value(row, 'Reps')));
      set.rpe = positive(number(c.value(row, 'RPE')));
      set.warmup = order === 'W';
      var seconds = positive(number(c.value(row, 'Seconds')));
      set.durationSec = seconds == null ? null : Math.round(seconds);
      set.distanceMeters = positive(number(c.value(row, distanceColumn)));
      b.add(set, key, date, c.value(row, 'Workout Name'), named[0], named[1], null);
    });
    return b.workouts();
  }

  function hevy(rows, c) {
    var pounds = c.has('weight_lbs');
    var miles = c.has('distance_miles');
    var b = builder();
    rows.forEach(function (row) {
      var date = hevyDate(c.value(row, 'start_time'));
      if (!date) return;
      var key = c.value(row, 'title') + '|' + c.value(row, 'start_time') + '|' + c.value(row, 'end_time');
      var named = splitEquipment(c.value(row, 'exercise_title'));
      var set = emptySet();
      var weight = positive(number(c.value(row, pounds ? 'weight_lbs' : 'weight_kg')));
      set.weightLb = weight == null ? null : toLb(weight, pounds ? 'lb' : 'kg');
      set.reps = reps(number(c.value(row, 'reps')));
      set.rpe = number(c.value(row, 'rpe'));
      set.warmup = c.value(row, 'set_type').toLowerCase() === 'warmup';
      var seconds = positive(number(c.value(row, 'duration_seconds')));
      set.durationSec = seconds == null ? null : Math.round(seconds);
      var distance = positive(number(c.value(row, miles ? 'distance_miles' : 'distance_km')));
      set.distanceMeters = distance == null ? null : distance * (miles ? METERS_PER_MILE : 1000);
      b.add(set, key, date, c.value(row, 'title'), named[0], named[1], null);
    });
    return b.workouts();
  }

  /** One workout a day, which is how FitNotes keeps them. Weight's unit is on
   *  every row, and one file can mix the two. */
  function fitNotes(rows, c) {
    var b = builder();
    rows.forEach(function (row) {
      var day = c.value(row, 'Date');
      var date = fitNotesDate(day);
      if (!date) return;
      var set = emptySet();
      var weight;
      var unit;
      if (c.has('Weight Unit')) {
        weight = number(c.value(row, 'Weight'));
        unit = c.value(row, 'Weight Unit').toLowerCase().indexOf('lb') === 0 ? 'lb' : 'kg';
      } else if (c.has('Weight (lbs)')) {
        weight = number(c.value(row, 'Weight (lbs)')); unit = 'lb';
      } else {
        weight = number(c.value(row, 'Weight (kgs)')); unit = 'kg';
      }
      weight = positive(weight);
      set.weightLb = weight == null ? null : toLb(weight, unit);
      set.reps = reps(number(c.value(row, 'Reps')));
      set.durationSec = clockSeconds(c.value(row, 'Time'));
      var distance = positive(number(c.value(row, 'Distance')));
      if (distance != null) {
        var per = { km: 1000, mi: METERS_PER_MILE, ft: 0.3048 }[c.value(row, 'Distance Unit').toLowerCase()] || 1;
        set.distanceMeters = distance * per;
      }
      // FitNotes' category is a muscle group, except "Cardio", which is not.
      var category = c.value(row, 'Category').toLowerCase();
      b.add(set, day, date, '', c.value(row, 'Exercise'), null,
        !category || category === 'cardio' ? null : category);
    });
    return b.workouts();
  }

  /** What reading a file found, before anything is written: `source`
   *  ('Strong', 'Hevy' or 'FitNotes'), `needsUnit` -- Strong's comma export,
   *  whose numbers carry no unit, so nothing can be built until the person
   *  says which -- and `parse(unit)`, unit 'lb' or 'kg', giving the workouts.
   *  Throws an Error whose `failure` is 'empty' or 'notRecognised'. */
  function read(text) {
    var rows = parse(text);
    if (rows.length < 2) throw Object.assign(new Error('empty'), { failure: 'empty' });
    var c = columns(rows[0].map(trim));
    var body = rows.slice(1).filter(function (r) { return !(r.length === 1 && r[0] === ''); });

    if (c.has('Workout #') && c.has('Set Order')) {
      var kg = c.has('Weight (kg)');
      return { source: 'Strong', needsUnit: false, parse: function () {
        return strong(body, c, kg ? 'kg' : 'lb', kg ? 'Weight (kg)' : 'Weight (lbs)');
      } };
    }
    if (c.has('Exercise Name') && c.has('Set Order') && c.has('Weight')) {
      return { source: 'Strong', needsUnit: true, parse: function (unit) {
        return strong(body, c, unit || 'kg', 'Weight');
      } };
    }
    if (c.has('exercise_title') && c.has('set_type')) {
      return { source: 'Hevy', needsUnit: false, parse: function () { return hevy(body, c); } };
    }
    if (c.has('Exercise') && c.has('Category')
        && (c.has('Weight') || c.has('Weight (kgs)') || c.has('Weight (lbs)'))) {
      return { source: 'FitNotes', needsUnit: false, parse: function () { return fitNotes(body, c); } };
    }
    throw Object.assign(new Error('notRecognised'), { failure: 'notRecognised' });
  }

  /** "2 workouts, 14 sets, Mar 2, 2026 to Mar 4, 2026." */
  function describe(workouts, locale) {
    if (!workouts.length) return 'No sets found in this file.';
    var sets = workouts.reduce(function (t, w) {
      return t + w.exercises.reduce(function (n, e) { return n + e.sets.length; }, 0);
    }, 0);
    var day = function (d) { return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }); };
    return (workouts.length === 1 ? '1 workout' : workouts.length + ' workouts') + ', '
      + (sets === 1 ? '1 set' : sets + ' sets') + ', '
      + day(workouts[0].date) + ' to ' + day(workouts[workouts.length - 1].date) + '.';
  }

  /* ---------------- into LIFT web's log ---------------- */

  /** Adds imported workouts to `workouts` (LIFT web's sessions, changed in
   *  place). **A day LIFT already has training on is left alone**, counted in
   *  the outcome and never merged into: there is no telling an imported bench
   *  session from the same one logged by hand, and a doubled day is worse
   *  than a missing one. That also makes importing the same file twice add
   *  nothing. Two workouts on one day in the file become one LIFT day, in the
   *  order they were done, named after the first. An empty workout already
   *  started that day is filled rather than left beside a second one. */
  function apply(imported, workouts, makeId) {
    var outcome = { daysAdded: 0, setsAdded: 0, daysSkipped: 0 };
    var byDay = {};
    imported.forEach(function (w) { (byDay[dayKey(w.date)] = byDay[dayKey(w.date)] || []).push(w); });
    Object.keys(byDay).sort().forEach(function (key) {
      var day = byDay[key].slice().sort(function (a, b) { return a.date - b.date; });
      var hasSets = day.some(function (w) { return w.exercises.some(function (e) { return e.sets.length; }); });
      if (!hasSets) return;
      var onDay = workouts.filter(function (w) { return w && w.date === key; });
      if (onDay.some(function (w) { return (w.exercises || []).length; })) {
        outcome.daysSkipped++;
        return;
      }
      var target = onDay[0];
      if (!target) {
        target = { id: makeId(), date: key, name: '', note: '', exercises: [], startedAt: day[0].date.getTime() };
        workouts.push(target);
      }
      target.exercises = target.exercises || [];
      if (!trim(target.name || '')) {
        var named = day.filter(function (w) { return w.name; })[0];
        target.name = named ? named.name : '';
      }
      day.forEach(function (w) {
        w.exercises.forEach(function (e) {
          if (!e.sets.length) return;
          var ex = { id: makeId(), name: e.name, equipment: e.equipment || '', note: '', sets: [] };
          if (e.primaryMuscle) ex.primaryMuscle = e.primaryMuscle;
          e.sets.forEach(function (s) {
            var set = { id: makeId() };
            ['weightLb', 'reps', 'rpe', 'durationSec', 'distanceMeters'].forEach(function (k) {
              if (s[k] != null) set[k] = s[k];
            });
            if (s.warmup) set.warmup = true;
            ex.sets.push(set);
          });
          outcome.setsAdded += ex.sets.length;
          target.exercises.push(ex);
        });
      });
      outcome.daysAdded++;
    });
    return outcome;
  }

  /** "Added 3 days (40 sets). 1 day you already had training on was left as
   *  it was." */
  function summary(outcome) {
    var line = (outcome.daysAdded === 1 ? 'Added 1 day' : 'Added ' + outcome.daysAdded + ' days')
      + (outcome.setsAdded === 1 ? ' (1 set).' : ' (' + outcome.setsAdded + ' sets).');
    if (outcome.daysSkipped > 0) {
      line += outcome.daysSkipped === 1
        ? ' 1 day you already had training on was left as it was.'
        : ' ' + outcome.daysSkipped + ' days you already had training on were left as they were.';
    }
    return line;
  }

  /* ---------------- LIFT's own export ---------------- */

  var EXPORT_HEADER = ['Date', 'Workout', 'Exercise', 'Equipment', 'Set', 'Warmup', 'Side',
                       'Weight (kg)', 'Reps', 'RPE', 'Seconds', 'Distance (m)'];

  /** Every logged set, oldest day first, as export rows. Kilograms always, the
   *  file's one unit on every build; blank where the set recorded nothing. */
  function exportRows(workouts) {
    var sessions = (workouts || []).filter(function (w) { return w && w.date; }).slice()
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a.startedAt || 0) - (b.startedAt || 0);
      });
    var rows = [];
    sessions.forEach(function (s) {
      (s.exercises || []).forEach(function (ex) {
        if (!ex) return;
        (ex.sets || []).forEach(function (st, i) {
          if (!st) return;
          rows.push({
            dayKey: s.date, workout: s.name || '', exercise: ex.name || '', equipment: ex.equipment || null,
            set: i + 1, isWarmup: !!st.warmup,
            side: st.side === 'left' || st.side === 'right' ? st.side : null,
            weightKg: st.weightLb != null && isFinite(st.weightLb) ? st.weightLb / LB_PER_KG : null,
            reps: st.reps != null ? st.reps : null, rpe: st.rpe != null ? st.rpe : null,
            seconds: st.durationSec != null ? st.durationSec : null,
            distanceMeters: st.distanceMeters != null ? st.distanceMeters : null,
          });
        });
      });
    });
    return rows;
  }

  /** One row per set, blanks blank. A point for decimals whatever the
   *  device's language, so the file reads the same everywhere. */
  function exportText(rows) {
    var cell = function (s) {
      var t = String(s == null ? '' : s);
      return /[,"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    var num = function (d) {
      if (d == null || !isFinite(d)) return '';
      if (d === Math.round(d)) return String(d);
      // Two decimals, trailing zeros dropped -- and the point with them, so
      // 59.999 is "60", never "60.".
      return d.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    };
    var lines = [EXPORT_HEADER.join(',')];
    rows.forEach(function (r) {
      lines.push([r.dayKey, cell(r.workout), cell(r.exercise), cell(r.equipment || ''), String(r.set),
        r.isWarmup ? 'yes' : '', r.side || '', num(r.weightKg), num(r.reps),
        num(r.rpe), r.seconds != null ? String(r.seconds) : '', num(r.distanceMeters)].join(','));
    });
    return lines.join('\n') + '\n';
  }

  /** A file's bytes as text: UTF-8, and Latin-1 when it is not valid UTF-8,
   *  as the iPhone reads it. */
  function decode(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('iso-8859-1').decode(bytes);
    }
  }

  global.LiftWorkoutCSV = {
    LB_PER_KG: LB_PER_KG,
    EXPORT_HEADER: EXPORT_HEADER,
    parse: parse,
    read: read,
    number: number,
    clockSeconds: clockSeconds,
    splitEquipment: splitEquipment,
    hevyDate: hevyDate,
    describe: describe,
    apply: apply,
    summary: summary,
    exportRows: exportRows,
    exportText: exportText,
    decode: decode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
