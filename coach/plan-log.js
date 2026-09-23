/* What you booked, and what they logged.
 *
 * Coach holds both halves -- it wrote the plan and it decoded the log -- and
 * until now joined them nowhere, so a coach could not see that Friday never
 * happened. This is the join, and the record that makes it possible.
 *
 * Two things live here, and nothing in either touches the DOM or
 * localStorage, so node tests them (plan-log.test.mjs) rather than an eye:
 *
 *   SentPlan   one row per send: the plan payload as JSON exactly as encoded,
 *              with the canonical hash of it, so re-sending the same week
 *              replaces rather than duplicates. Coach has never kept a record
 *              of what it sent -- the link was built fresh on every render and
 *              handed straight to the clipboard -- so editing "Lower A" after
 *              sending left the store no longer saying what the client got.
 *   compare()  the plan against the log, per sent week and per booked day.
 *
 * **Counting is allowed; grading is not.** This says how many days were booked
 * and how many were logged, side by side, and stops. There is no score, no
 * percentage, no colour on an absence, no roster column, nothing carried
 * across weeks and nothing comparing one client to another. The words are
 * `not logged`, never "missed" or "skipped": a client may have trained and not
 * sent, been ill, or been told to rest, and Coach cannot tell those apart.
 * `outside the log they sent` is a fourth state and exists so the third is
 * never claimed wrongly. The word "adherence" never reaches a screen.
 * `lines()` exists so both of those are testable as strings.
 *
 * **Nothing new travels.** SHARE-FORMAT and PLAN-FORMAT are unchanged; this
 * works from what Coach sent and the log the client already chose to send, so
 * it reads every LIFT build in the field, including ones that will never
 * update, and one a client never opened. The cost, stated: a session lifted
 * the day after it was booked is a booked day with nothing logged plus a
 * session of its own. They sit next to each other on screen where a coach can
 * read what happened, and Coach claims no connection between them -- that
 * join is the trainer's to make.
 *
 * Loaded after sides.js and prescriptions.js, whose side reading (`of`,
 * `countsIn`) and prescribed-side counting (`targets`) this reuses rather
 * than repeats.
 */
(function (global) {
  'use strict';

  var Sides = global.CoachSides;
  var Prescriptions = global.CoachPrescriptions;

  /* ---------------- dates ----------------
   *
   * Local day keys, like the rest of the app. Kept here rather than imported
   * because this file runs in node with no app.js around it, and the whole
   * point of it being its own file is that node can run it. */

  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var dateKey = function (d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };
  var parseKey = function (key) {
    var parts = String(key || '').split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  };
  function shiftKey(key, days) {
    var dt = parseKey(key);
    dt.setDate(dt.getDate() + days);
    return dateKey(dt);
  }

  /* "Oct", localised. Written day-then-month by hand rather than through
   * toLocaleDateString's own ordering, because "12–18 Oct" has to read as a
   * range and a US locale would put the month in the middle of it. */
  var monthName = function (key) {
    return parseKey(key).toLocaleDateString(undefined, { month: 'short' });
  };
  var weekdayName = function (key) {
    return parseKey(key).toLocaleDateString(undefined, { weekday: 'short' });
  };
  var dayOf = function (key) { return parseKey(key).getDate(); };

  /** "Mon 13 Oct". The head line above carries the range, but a day row is
   * read on its own -- and two sends in different months sit one above the
   * other, where a bare "Mon 13" says nothing about which. */
  var dayLabel = function (key) {
    return weekdayName(key) + ' ' + dayOf(key) + ' ' + monthName(key);
  };
  /** "13 Oct" -- for the by-lift view, where rows cross weeks. */
  var dayMonth = function (key) { return dayOf(key) + ' ' + monthName(key); };

  /** "12–18 Oct", "28 Sep–4 Oct", "12 Oct" for a single day. */
  function rangeText(from, to) {
    if (from === to) return dayMonth(from);
    var a = parseKey(from), b = parseKey(to);
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
      return dayOf(from) + '–' + dayMonth(to);
    }
    return dayMonth(from) + '–' + dayMonth(to);
  }

  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

  /* ---------------- SentPlan ---------------- */

  /** The newest sends kept per client. A backup must not grow without limit,
   *  and a coach reading eight weeks back has never needed more than this. */
  var CAP = 26;

  /**
   * JSON with every object's keys in sorted order, at every depth -- the same
   * canonical form LIFT iOS's `PlanImporter.hash(of:)` hashes, so the two
   * apps compute the same hash for the same plan. Arrays keep their order:
   * `k` is a list of bookings and reordering it would be a different plan.
   */
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (k) {
        return JSON.stringify(k) + ':' + canonical(value[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  /** SHA-256 of the canonical form, hex. Async because that is the only
   *  digest a browser offers; node's WebCrypto answers the same call. */
  async function hash(payload) {
    var bytes = new TextEncoder().encode(canonical(payload));
    var digest = await (global.crypto || globalThis.crypto).subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /** This client's rows, newest first. */
  function forClient(rows, clientId) {
    return (Array.isArray(rows) ? rows : [])
      .filter(function (r) { return r && r.clientId === clientId; })
      .slice()
      .sort(function (a, b) { return (b.sentAt || 0) - (a.sentAt || 0); });
  }

  /**
   * `rows` with this send recorded, as a new array.
   *
   * A send whose hash matches this client's **newest** send replaces it: an
   * abandoned share sheet is re-shared identically a moment later, and that is
   * one plan, not two. An older matching send is left alone -- a coach who
   * went back to last week's plan after a week of something else did send it
   * again, and the two dates are both true.
   *
   * Pruned to the newest CAP per client, oldest first. Other clients' rows are
   * untouched and keep their order.
   */
  function record(rows, entry) {
    var all = (Array.isArray(rows) ? rows : []).filter(Boolean);
    var clientId = entry.clientId;
    var mine = forClient(all, clientId);
    var newest = mine[0];
    var others = all.filter(function (r) { return r.clientId !== clientId; });

    if (newest && newest.payloadHash && newest.payloadHash === entry.payloadHash) {
      // The same plan again. Its id stays, so a backup written before and one
      // written after merge as one row rather than two.
      mine = mine.slice();
      mine[0] = {
        id: newest.id,
        clientId: clientId,
        sentAt: entry.sentAt,
        payloadHash: entry.payloadHash,
        payload: entry.payload,
      };
    } else {
      mine = [{
        id: entry.id,
        clientId: clientId,
        sentAt: entry.sentAt,
        payloadHash: entry.payloadHash,
        payload: entry.payload,
      }].concat(mine);
    }
    return others.concat(mine.slice(0, CAP));
  }

  /**
   * Rows out of a backup folded in, by id, additively -- the library half's
   * rule, not the roster's: an older backup must never delete a newer send,
   * and a file written before sent plans existed has no key at all and changes
   * nothing. Ids are compared case-insensitively, as BACKUP-FORMAT asks
   * everywhere, because iOS writes UUIDs upper case and a browser lower.
   * The cap is applied after the merge, so restoring two files cannot leave a
   * client with more rows than sending would.
   */
  function mergeBackup(rows, incoming) {
    var all = (Array.isArray(rows) ? rows : []).filter(Boolean);
    if (!Array.isArray(incoming)) return { rows: all, added: 0 };
    var have = {};
    all.forEach(function (r) { if (r.id) have[String(r.id).toLowerCase()] = true; });

    var added = 0;
    incoming.forEach(function (row) {
      if (!row || !row.id || !row.clientId || !row.payload) return;
      var id = String(row.id).toLowerCase();
      if (have[id]) return;
      have[id] = true;
      added += 1;
      all.push({
        id: row.id,
        clientId: row.clientId,
        sentAt: Number(row.sentAt) || 0,
        payloadHash: row.payloadHash || '',
        payload: row.payload,
      });
    });

    var byClient = {};
    all.forEach(function (r) { byClient[r.clientId] = true; });
    var kept = [];
    Object.keys(byClient).forEach(function (clientId) {
      forClient(all, clientId).slice(0, CAP).forEach(function (r) { kept.push(r); });
    });
    return { rows: kept, added: added };
  }

  /* ---------------- reading a sent payload ---------------- */

  var exerciseKey = function (name, equipment) {
    return (String(name == null ? '' : name).trim()
      + '|' + String(equipment == null ? '' : equipment).trim()).toLowerCase();
  };
  var nameKey = function (name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  };

  /** Every day a payload books, as { date, name, exercises }, pooled where a
   *  payload books two sessions on one date -- SHARE-FORMAT gives a day one
   *  `w` array, so the log has already merged two sessions into one before
   *  Coach sees it, and the asked side has to be read the same way. */
  function bookingsIn(payload) {
    var workouts = Array.isArray(payload && payload.w) ? payload.w : [];
    var booked = Array.isArray(payload && payload.k) ? payload.k : [];
    var byDate = {};
    booked.forEach(function (entry) {
      if (!entry || typeof entry.d !== 'string') return;
      var wire = workouts[entry.x];
      if (!wire) return;
      var workout = Prescriptions.decodeWorkout(wire);
      var day = byDate[entry.d] || (byDate[entry.d] = { date: entry.d, names: [], exercises: [] });
      if (workout.name) day.names.push(workout.name);
      workout.exercises.forEach(function (ex) { day.exercises.push(ex); });
    });
    return Object.keys(byDate).sort().map(function (date) {
      var day = byDate[date];
      return { date: date, name: day.names.join(' · '), exercises: pool(day.exercises) };
    });
  }

  /** Exercises pooled by name|equipment, keeping first-seen order. The same
   *  key prescribed twice in a day is one prescription of more sets. */
  function pool(list) {
    var order = [];
    var byKey = {};
    (list || []).forEach(function (ex) {
      if (!ex) return;
      var key = exerciseKey(ex.name, ex.equipment);
      if (!byKey[key]) {
        byKey[key] = { key: key, name: ex.name, equipment: ex.equipment || '',
          eachSide: ex.eachSide === true, sets: [] };
        order.push(key);
      }
      // Each side is a property of the lift, not of one booking of it: if
      // either says each side, the sets pooled under it are each side.
      if (ex.eachSide === true) byKey[key].eachSide = true;
      (ex.sets || []).forEach(function (s) { byKey[key].sets.push(s); });
    });
    return order.map(function (k) { return byKey[k]; });
  }

  /** A logged day's exercises, pooled the same way, warmups dropped. Warmups
   *  are excluded on both sides -- masked, never compared, because a left-side
   *  warmup arrives as 3 and `flags === 1` would read it as a working set. */
  function loggedIn(day) {
    return pool(((day && day.exercises) || []).map(function (ex) {
      return {
        name: ex.name, equipment: ex.equipment,
        sets: (ex.sets || []).filter(function (s) { return !(s && s.warmup); }),
      };
    }));
  }

  /* ---------------- how a set reads ---------------- */

  var LB_PER_KG = 2.2046226218;
  var fromLb = function (lb, unit) { return unit === 'kg' ? lb / LB_PER_KG : lb; };
  var num = function (n) { return Math.round(n).toLocaleString(); };

  /**
   * One set, asked or logged, in the same shape -- PLAN-FORMAT's set tuple and
   * SHARE-FORMAT's are deliberately the same six fields so nothing has to be
   * transposed to put one above the other, and this is what that was for.
   *
   * Both rows come from pounds: the stored payload's and the wire's, converted
   * once here. Never from a routine, which stores kilograms -- an asked row in
   * kg above a logged row in lb would be two units in one card, silently and
   * 2.2x wrong.
   *
   * Blank stays blank. `[null, 5]` is "5 reps", never "0 × 5".
   */
  function setText(set, unit) {
    var s = set || {};
    var bits = [];
    if (s.weightLb != null && s.reps != null) bits.push(num(fromLb(s.weightLb, unit)) + ' × ' + s.reps);
    else if (s.reps != null) bits.push(s.reps + ' reps');
    else if (s.weightLb != null) bits.push(num(fromLb(s.weightLb, unit)) + ' ' + unit);
    if (s.distanceM != null) bits.push(num(s.distanceM) + ' m');
    if (s.durationSec != null) {
      var minutes = Math.floor(s.durationSec / 60);
      bits.push(minutes ? minutes + ':' + pad2(s.durationSec % 60) : s.durationSec + 's');
    }
    if (s.rpe != null) bits.push('@' + s.rpe);
    return bits.join(' · ') || 'as written';
  }

  var SERIES = [Sides.LEFT, Sides.RIGHT, null];

  /**
   * Sets as one group per side -- "L 40 × 8 · 40 × 8 · 40 × 5" beside
   * "R 40 × 8 · 40 × 8" -- or a single unlabelled group when nothing is sided.
   * Sets are listed, never paired one to one with the asked row: if they did
   * three of four sets, Coach cannot say which one they dropped, so it does
   * not.
   */
  function setGroups(sets, unit) {
    var list = sets || [];
    if (!Sides.anySided(list)) {
      return list.length
        ? [{ label: '', text: list.map(function (s) { return setText(s, unit); }).join(' · ') }]
        : [];
    }
    var groups = [];
    SERIES.forEach(function (side) {
      var mine = Sides.onSide(list, side);
      if (!mine.length) return;
      groups.push({
        label: side ? Sides.label(side) : 'Both',
        text: mine.map(function (s) { return setText(s, unit); }).join(' · '),
      });
    });
    return groups;
  }

  var groupsText = function (groups) {
    return groups.map(function (g) { return (g.label ? g.label + ' ' : '') + g.text; }).join('   ');
  };

  /* ---------------- one exercise, asked against logged ---------------- */

  var title = function (ex) {
    return ex.equipment ? ex.name + ' (' + ex.equipment + ')' : ex.name;
  };
  var equipmentWord = function (equipment) { return equipment || 'no equipment'; };

  /**
   * The side counts LIFT already shows in its own header: "L 3/3 · R 2/3",
   * the logged count over what the prescription asks for. Over is shown as
   * over -- "L 4/3", never capped. An each-side exercise's ask is twice its
   * tuples, which `CoachPrescriptions.targets` already works out. An exercise
   * with no side on either half gets no line at all.
   *
   * Printed, not judged. Coach does no arithmetic on the difference between
   * the two numbers; "three reps short on the left every time" is what a coach
   * reads off the two rows, not a number this computes.
   */
  function sideLine(asked, logged) {
    var t = Prescriptions.targets({ eachSide: asked.eachSide, sets: asked.sets });
    var c = Sides.countsIn(logged ? logged.sets : []);
    if (!t.left && !t.right && !c.left && !c.right) return null;
    var text = 'L ' + c.left + '/' + t.left + ' · R ' + c.right + '/' + t.right;
    // Sets logged with no side are still real work. Saying so beats leaving
    // them out -- the same clause CoachSides.countsLabel already prints.
    if (c.both) text += ' · ' + c.both + ' both';
    return text;
  }

  /** `absentWord` is what a lift with nothing logged against it says: "not
   *  logged" on a day the client sent, "outside the log they sent" on a day
   *  they did not. The second exists so the first is never claimed wrongly. */
  function pairLines(asked, logged, unit, substituted, absentWord) {
    var side = sideLine(asked, logged);
    var askedSets = asked.sets || [];
    var loggedSets = logged ? logged.sets : [];
    var lift = title(asked) + (asked.eachSide ? ' · each side' : '');
    var out = {
      key: asked.key,
      // The lift on its own, for a heading that is about the lift and not
      // about one day of it.
      lift: lift,
      title: lift,
      state: logged ? 'logged' : 'notLogged',
      substitution: substituted && logged
        ? 'Asked ' + equipmentWord(asked.equipment) + ' · logged ' + equipmentWord(logged.equipment)
        : null,
      sideLine: side,
      countLine: null,
      // A lift with nothing logged against it is one line and no rows: the
      // day row above already says the session was not logged, and repeating
      // the prescription under every lift of a missed day turns a fact into a
      // recital of what someone did not do.
      asked: logged && askedSets.length
        ? { label: 'Asked', groups: setGroups(askedSets, unit) } : null,
      logged: logged
        ? { label: 'Logged', groups: setGroups(loggedSets, unit) } : null,
    };
    // "each side" is a clause on the ask, not a set of its own, so it is its
    // own field rather than glued onto the last group's text -- a view that
    // draws the groups and forgets the clause would otherwise print a plan
    // that asks for half of what it asks for.
    if (out.asked) {
      out.asked.suffix = asked.eachSide ? ' each side' : '';
      out.asked.text = groupsText(out.asked.groups) + out.asked.suffix;
    }
    if (out.logged) {
      out.logged.suffix = '';
      out.logged.text = groupsText(out.logged.groups);
    }
    // How many were asked for and how many came back, when they differ and
    // there is no side line already saying it per side.
    if (logged && !side && askedSets.length !== loggedSets.length) {
      out.countLine = 'Asked ' + plural(askedSets.length, 'set', 'sets')
        + ' · logged ' + loggedSets.length;
    }
    if (!logged) out.title += ' · ' + (absentWord || 'not logged');
    return out;
  }

  /**
   * The prescribed and the logged exercises of one day, joined.
   *
   * Two passes, in this order, so an exact match always wins:
   *   1. name and equipment -- a cable pulldown and a machine pulldown are not
   *      the same lift and a coach prescribing one of them meant it.
   *   2. name alone, over what is left on each side: the equipment
   *      substitution, paired and labelled.
   * Never by position: a client who skips the second exercise would shift
   * every pairing after it.
   */
  function joinExercises(asked, logged, unit) {
    var remaining = logged.slice();
    var take = function (predicate) {
      for (var i = 0; i < remaining.length; i++) {
        if (predicate(remaining[i])) return remaining.splice(i, 1)[0];
      }
      return null;
    };

    var pairs = asked.map(function (ex) {
      return { asked: ex, logged: take(function (l) { return l.key === ex.key; }), substituted: false };
    });
    pairs.forEach(function (pair) {
      if (pair.logged) return;
      var match = take(function (l) { return nameKey(l.name) === nameKey(pair.asked.name); });
      if (match) { pair.logged = match; pair.substituted = true; }
    });

    return {
      exercises: pairs.map(function (p) {
        return pairLines(p.asked, p.logged, unit, p.substituted, 'not logged');
      }),
      // Working sets are the claim everywhere else here, so a lift nobody
      // asked for that came back as warmups alone is not "0 sets" on screen.
      alsoLogged: remaining.filter(function (ex) { return ex.sets.length; }).map(alsoLogged),
    };
  }

  /** A lift the log has and the plan does not: its name and how many working
   *  sets it carried, counted against nothing. */
  function alsoLogged(ex) {
    return {
      key: ex.key,
      title: title(ex),
      state: 'alsoLogged',
      text: title(ex) + ' · ' + plural(ex.sets.length, 'set', 'sets'),
    };
  }

  /* ---------------- the card ---------------- */

  var FOOTER = 'This is what you shared. Whether it arrived, and whether they '
    + 'opened it, only they know.';

  var hasTraining = function (day) { return !!(day && day.exercises && day.exercises.length); };

  /** Whether a date falls inside the window the client actually sent. A day
   *  with no log is not the same as a day the client did not send, and one of
   *  those is "not logged" while the other is "we do not know". */
  function covered(key, coverage) {
    if (!Array.isArray(coverage) || !coverage[0] || !coverage[1]) return false;
    return key >= coverage[0] && key <= coverage[1];
  }

  function headLine(range, counts) {
    var head = 'Booked ' + plural(counts.booked, 'day', 'days') + ', ' + range;
    if (counts.outside === counts.booked) return head + ' · no log covering them';
    head += ' · logged ' + counts.logged;
    if (counts.outside) head += ' · ' + counts.outside + ' outside the log they sent';
    if (counts.other) head += ' · ' + plural(counts.other, 'other day logged', 'other days logged');
    return head;
  }

  /**
   * One sent plan against the log.
   *
   * `sentPlans` are this client's rows, `days` their stored days, `coverage`
   * the [from, to] of what they have sent. The window is the Weeks table's
   * own eight weeks, so the card and the table look at the same stretch.
   *
   * Days join on date and nothing else. A group is one send, and its range is
   * the first and last day that send booked -- not a calendar week, because a
   * coach sends the days they book.
   */
  function compare(options) {
    var opts = options || {};
    var unit = opts.unit === 'kg' ? 'kg' : 'lb';
    var days = opts.days || {};
    var coverage = opts.coverage || null;
    var today = opts.today || dateKey(new Date());
    var from = shiftKey(today, -(7 * (opts.weeks || 8) - 1));

    var groups = [];
    forClient(opts.sentPlans, opts.clientId).forEach(function (row) {
      var booked = bookingsIn(row.payload).filter(function (b) {
        return b.date >= from && b.date <= today;
      });
      if (!booked.length) return;

      var first = booked[0].date;
      var last = booked[booked.length - 1].date;
      var bookedDates = {};
      booked.forEach(function (b) { bookedDates[b.date] = true; });

      var counts = { booked: booked.length, logged: 0, notLogged: 0, outside: 0, other: 0 };
      var rows = booked.map(function (booking) {
        var day = days[booking.date];
        var state;
        if (!covered(booking.date, coverage)) { state = 'outside'; counts.outside += 1; }
        else if (hasTraining(day)) { state = 'logged'; counts.logged += 1; }
        else { state = 'notLogged'; counts.notLogged += 1; }

        var joined = state === 'logged'
          ? joinExercises(booking.exercises, loggedIn(day), unit)
          : { exercises: [], alsoLogged: [] };

        var word = state === 'logged' ? 'logged'
          : state === 'notLogged' ? 'not logged' : 'outside the log they sent';
        return {
          key: booking.date,
          state: state,
          name: booking.name,
          text: [dayLabel(booking.date), booking.name, word].filter(Boolean).join(' · '),
          exercises: joined.exercises,
          alsoLogged: joined.alsoLogged,
          // What this day booked, whatever became of it. The day view does not
          // draw these on a day nobody logged -- the row above already says so,
          // and reciting the prescription under it turns a fact into a list of
          // what someone did not do. The by-lift view does need them: a lift
          // shown only on the weeks it was logged reads steadier than it was.
          booked: state === 'logged' ? [] : booking.exercises.map(function (ex) {
            return pairLines(ex, null, unit, false, word);
          }),
        };
      });

      // A day inside this send's span that was trained and not booked. Shown
      // beside the bookings, saying nothing about cause: a session lifted the
      // day after the one it was booked for looks exactly like this, and so
      // does a session the client added themselves.
      Object.keys(days).sort().forEach(function (key) {
        if (key < first || key > last || bookedDates[key]) return;
        if (!hasTraining(days[key])) return;
        counts.other += 1;
        rows.push({
          key: key,
          state: 'notBooked',
          name: days[key].name || '',
          text: [dayLabel(key), days[key].name || '', 'not booked'].filter(Boolean).join(' · '),
          exercises: [],
          booked: [],
          alsoLogged: loggedIn(days[key])
            .filter(function (ex) { return ex.sets.length; }).map(alsoLogged),
        });
      });
      rows.sort(function (a, b) { return a.key.localeCompare(b.key); });

      groups.push({
        id: row.id,
        sentAt: row.sentAt,
        from: first,
        to: last,
        range: rangeText(first, last),
        counts: counts,
        head: headLine(rangeText(first, last), counts),
        days: rows,
      });
    });

    return { groups: groups, byLift: byLift(groups), footer: FOOTER };
  }

  /**
   * The same lines grouped the other way: each prescribed lift across the sent
   * weeks, its asked and logged rows stacked by date. Same rules, same
   * strings -- this is a regrouping of what `compare` already decided, not a
   * second opinion about it, and it still carries nothing across weeks beyond
   * putting the days under one heading.
   */
  function byLift(groups) {
    var order = [];
    var byKey = {};
    groups.forEach(function (group) {
      group.days.forEach(function (day) {
        day.exercises.concat(day.booked || []).forEach(function (ex) {
          if (!byKey[ex.key]) {
            byKey[ex.key] = { key: ex.key, title: '', entries: [] };
            order.push(ex.key);
          }
          byKey[ex.key].entries.push({ key: day.key, when: dayMonth(day.key), exercise: ex });
        });
      });
    });
    return order.map(function (key) {
      var lift = byKey[key];
      lift.entries.sort(function (a, b) { return a.key.localeCompare(b.key); });
      // The heading is the lift, without the per-day clause: whether one day
      // of it was logged belongs to that day and not to the lift.
      lift.title = lift.entries[0].exercise.lift;
      return lift;
    });
  }

  /**
   * Every sentence this card can produce, flattened, in the order a coach
   * reads them. The line-discipline tests run over this rather than over the
   * DOM, so a string that judges a client fails a test the day it is written
   * rather than the day someone notices it on screen.
   */
  function lines(result) {
    var out = [];
    (result.groups || []).forEach(function (group) {
      out.push(group.head);
      group.days.forEach(function (day) {
        out.push(day.text);
        day.exercises.forEach(function (ex) {
          out.push(ex.title);
          if (ex.sideLine) out.push(ex.sideLine);
          if (ex.countLine) out.push(ex.countLine);
          if (ex.asked) out.push(ex.asked.label + ' ' + ex.asked.text);
          if (ex.logged) out.push(ex.logged.label + ' ' + ex.logged.text);
          // Under the pair, as it sits on screen: the substitution line says
          // what the two rows above it are, and reads as nonsense above them.
          if (ex.substitution) out.push(ex.substitution);
        });
        if (day.alsoLogged.length) {
          out.push('Also logged');
          day.alsoLogged.forEach(function (ex) { out.push(ex.text); });
        }
      });
    });
    // The other way round. The same lines under a lift's heading rather than
    // a day's, so the second view is pinned by the same tests as the first
    // rather than being the one place a sentence could slip through.
    if ((result.byLift || []).length) {
      out.push('By lift');
      result.byLift.forEach(function (lift) {
        out.push(lift.title);
        lift.entries.forEach(function (entry) {
          out.push(entry.when);
          var ex = entry.exercise;
          if (ex.state !== 'logged') out.push(ex.title);
          if (ex.sideLine) out.push(ex.sideLine);
          if (ex.countLine) out.push(ex.countLine);
          if (ex.asked) out.push(ex.asked.label + ' ' + ex.asked.text);
          if (ex.logged) out.push(ex.logged.label + ' ' + ex.logged.text);
          if (ex.substitution) out.push(ex.substitution);
        });
      });
    }
    if (out.length) out.push(result.footer);
    return out;
  }

  global.CoachPlanLog = {
    CAP: CAP,
    FOOTER: FOOTER,
    canonical: canonical,
    hash: hash,
    record: record,
    forClient: forClient,
    mergeBackup: mergeBackup,
    bookingsIn: bookingsIn,
    exerciseKey: exerciseKey,
    setText: setText,
    setGroups: setGroups,
    compare: compare,
    lines: lines,
    rangeText: rangeText,
    dayLabel: dayLabel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
