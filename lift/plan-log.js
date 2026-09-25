/* What you were asked to do, and what you did.
 *
 * A coach's plan and your log have always been two separate claims on this
 * device -- `training` is what was sent, `workouts` is what happened, and
 * app.js says in as many words that merging them would lose the ability to
 * say whether the week was followed. They have also never been shown side by
 * side, so Train could tell you what today asks for and nothing at all about
 * the other six days: a booked Wednesday is invisible on Thursday, and Train
 * cannot even be scrolled to a Friday that has not happened yet.
 *
 * This is the join, and it is a week rather than a day for exactly that
 * reason. Nothing in it touches the DOM or localStorage, so node tests it
 * (plan-log.test.mjs) rather than an eye.
 *
 * **Nothing new travels and nothing new is stored.** `training` already holds
 * every prescription a coach has sent, `workouts` already holds every session,
 * and `startedSessionId` already says which session was started from which
 * booking. No wire change, no new key, no new permission, and a log a coach
 * never receives is compared just the same -- this is your copy of your own
 * week.
 *
 * **You are not being graded.** There is no score, no percentage, no streak,
 * no colour on a day nothing was logged against, and nothing that carries from
 * one week to the next. `lines()` exists so that is testable as strings rather
 * than left to an eye on a screen. The house rule -- tracked and shown, never
 * targeted -- applies here with more force than anywhere else in the app,
 * because this is the screen most likely to drift into nagging.
 *
 * **The words are Coach's, where the fact is the same one.** A coach reading
 * `Fri 17 Oct · Upper B · not logged` about a client and you reading it about
 * yourself are reading the same fact, and describing your week to each other
 * is easier when the app describes it the same way to both of you. Coach's
 * `not logged`, `not booked`, `Asked` / `Logged`, the side counts and the
 * count line are all reused unchanged. Two things are deliberately not:
 *
 *   `outside the log they sent`  -- Coach's fourth state, which exists
 *       because a client sends a window and a booked day can fall outside it.
 *       Your log is right here. The state cannot arise and the sentence does
 *       not exist.
 *   the footer                   -- "whether it arrived, and whether they
 *       opened it, only they know" is a sentence about somebody else. This
 *       card's footer is the same thought pointed the other way.
 *
 * And one state is new, because only the person living the week has it:
 * `to do`. A booked day that has not happened yet is not an absence, and
 * calling it one would be the app inventing a failure out of a Wednesday.
 *
 * Loaded after sides.js, whose side reading (`of`, `countsIn`, `anySided`)
 * and prescribed-side counting (`targetsLabel`) this reuses rather than
 * repeats -- the counts on this card are the same counts the session header
 * has shown since per-side prescriptions shipped.
 */
(function (global) {
  'use strict';

  var Sides = global.LiftSides;

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

  /* Monday. A coach writes weeks, so a rolling seven days would move a booked
   * Tuesday from "this week" to "last week" overnight and describe the same
   * plan two different ways on two consecutive days. Fixed here as a named
   * constant rather than read from a locale, so the week a lifter sees is the
   * week their coach wrote wherever either of them happens to be. */
  var WEEK_STARTS_ON = 1;

  /** The [Monday, Sunday] containing a day. */
  function weekOf(key) {
    var dt = parseKey(key);
    var back = (dt.getDay() - WEEK_STARTS_ON + 7) % 7;
    var from = shiftKey(key, -back);
    return [from, shiftKey(from, 6)];
  }

  /* "Oct", localised. Written day-then-month by hand rather than through
   * toLocaleDateString's own ordering, because "12-18 Oct" has to read as a
   * range and a US locale would put the month in the middle of it. */
  var monthName = function (key) {
    return parseKey(key).toLocaleDateString(undefined, { month: 'short' });
  };
  var weekdayName = function (key) {
    return parseKey(key).toLocaleDateString(undefined, { weekday: 'short' });
  };
  var dayOf = function (key) { return parseKey(key).getDate(); };

  /** "Mon 13 Oct". A week can cross a month, and a bare "Mon 13" above a
   *  "Sun 5" says nothing about which. Coach's label, unchanged. */
  var dayLabel = function (key) {
    return weekdayName(key) + ' ' + dayOf(key) + ' ' + monthName(key);
  };
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

  /* ---------------- reading the two halves ---------------- */

  var exerciseKey = function (name, equipment) {
    return (String(name == null ? '' : name).trim()
      + '|' + String(equipment == null ? '' : equipment).trim()).toLowerCase();
  };
  var nameKey = function (name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  };

  /** Exercises pooled by name|equipment, keeping first-seen order. The same
   *  lift asked for twice in a day, or logged twice in a day, is one lift of
   *  more sets -- Coach pools both sides the same way, and has to, because the
   *  share link merges a day's sessions before Coach ever sees them. */
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
      // Each side is a property of the lift, not of one booking of it.
      if (ex.eachSide === true) byKey[key].eachSide = true;
      (ex.sets || []).forEach(function (s) { byKey[key].sets.push(s); });
    });
    return order.map(function (k) { return byKey[k]; });
  }

  /** A session's exercises, pooled, warmups dropped. Warmups are excluded on
   *  both sides -- masked, never compared, because a left-side warmup arrives
   *  as flags 3 and `flags === 1` would read it as a working set. This build
   *  cannot record a warmup itself; a log restored off a phone can. */
  function loggedIn(sessions) {
    var all = [];
    (sessions || []).forEach(function (s) {
      (s && s.exercises || []).forEach(function (ex) {
        all.push({
          name: ex.name, equipment: ex.equipment,
          sets: (ex.sets || []).filter(function (st) { return !(st && st.warmup); }),
        });
      });
    });
    return pool(all);
  }

  /** The prescriptions booked for one date, pooled into one day's ask. */
  function askedIn(rows) {
    var names = [];
    var exercises = [];
    (rows || []).forEach(function (row) {
      if (row && row.name) names.push(row.name);
      (row && row.exercises || []).forEach(function (ex) { exercises.push(ex); });
    });
    return { name: names.join(' · '), exercises: pool(exercises) };
  }

  /* ---------------- how a set reads ---------------- */

  /**
   * One set, asked or logged, in the same shape: "225 x 5 @8", "5 reps",
   * "1600 m 10:00". PLAN-FORMAT's set tuple and SHARE-FORMAT's are
   * deliberately the same six fields "so nothing has to be transposed to
   * compare what was asked for against what was done", and one row sitting
   * above the other is what that was written for -- so both rows are printed
   * by this, and never one by this and one by something that orders its
   * fields differently.
   *
   * The side is deliberately not here: sets are grouped by side (see
   * `setGroups`), and a set that carried its own "L" inside a group already
   * labelled "L" would say it twice. `formatPrescription` in app.js adds it
   * for the flat list on the prescribed card, which is not grouped.
   *
   * Weights are pounds, which is the only unit this build stores or shows.
   * Blank stays blank: `{ reps: 5 }` is "5 reps", never "0 x 5".
   */
  function setText(set) {
    var s = set || {};
    var parts = [];
    if (s.weightLb != null && s.reps != null) parts.push(s.weightLb + ' x ' + s.reps);
    else if (s.reps != null) parts.push(s.reps + ' reps');
    else if (s.weightLb != null) parts.push(s.weightLb + ' lb');
    if (s.distanceMeters != null) parts.push(s.distanceMeters + ' m');
    if (s.durationSec != null) {
      parts.push(s.durationSec >= 60
        ? Math.floor(s.durationSec / 60) + ':' + pad2(s.durationSec % 60)
        : s.durationSec + 's');
    }
    if (s.rpe != null) parts.push('@' + s.rpe);
    return parts.join(' ') || 'as written';
  }

  var SERIES = [Sides.LEFT, Sides.RIGHT, null];

  /**
   * Sets as one group per side -- "L 40 x 8 · 40 x 8 · 40 x 5" beside
   * "R 40 x 8 · 40 x 8" -- or a single unlabelled group when nothing is sided.
   *
   * Sets are listed, never paired one to one with the row above. If three of
   * four sets came back, nothing here can say which one was dropped, so
   * nothing here says.
   */
  function setGroups(sets) {
    var list = sets || [];
    if (!Sides.anySided(list)) {
      return list.length
        ? [{ label: '', text: list.map(setText).join(' · ') }]
        : [];
    }
    var groups = [];
    SERIES.forEach(function (side) {
      var mine = Sides.onSide(list, side);
      if (!mine.length) return;
      groups.push({
        label: side ? Sides.label(side) : 'Both',
        text: mine.map(setText).join(' · '),
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
   * The side counts the session header has shown since per-side prescriptions
   * shipped: "L 3/3 · R 2/3", logged over asked, over never capped, an
   * each-side exercise's ask twice its tuples. `LiftSides.targetsLabel` is
   * that header, called with the same two arguments it is called with there,
   * so this card and the session it describes can never disagree about a
   * side. A prescription that says nothing about sides returns '' and the
   * caller falls back to the plain count, exactly as the header does.
   */
  function sideLine(asked, logged) {
    if (!logged) return null;
    var loggedSets = logged.sets || [];
    return Sides.targetsLabel(asked.sets, asked.eachSide, loggedSets)
      || (Sides.anySided(loggedSets) ? Sides.countsLabel(loggedSets) : '')
      || null;
  }

  /**
   * What an each-side lift asks for, on a day nothing has been logged against
   * yet: "Each side · L 4 · R 3", the sentence the prescribed card has printed
   * under an each-side exercise since per-side prescriptions shipped.
   *
   * Deliberately not `targetsLabel`, which would read "L 0/3 · R 0/3" -- true
   * during a session, and on a day still ahead a zero nobody has had the
   * chance to earn. Blank stays blank; a week that has not happened is not a
   * week of noughts.
   */
  function askLine(asked) {
    if (!asked.eachSide) return null;
    var t = Sides.prescribedTargets(asked.sets, true);
    return 'Each side · L ' + t.left + ' · R ' + t.right;
  }

  /**
   * One lift's two rows.
   *
   * `recite` is whether the prescription is printed under a lift nothing has
   * been logged against. It is true for a day still ahead -- that is the work,
   * and Train cannot be scrolled to a day that has not happened, so this card
   * is the only place it can be read -- and false for a day in the past, where
   * reciting what was asked for under a day nothing was logged on turns a fact
   * into a list of what someone did not do. The past day is one tap away and
   * its own prescribed card still holds every set.
   */
  function pairLines(asked, logged, substituted, absentWord, recite) {
    var side = sideLine(asked, logged);
    var askedSets = asked.sets || [];
    var loggedSets = logged ? logged.sets : [];
    var lift = title(asked) + (asked.eachSide ? ' · each side' : '');
    var out = {
      key: asked.key,
      lift: lift,
      title: lift,
      state: logged ? 'logged' : (recite ? 'toDo' : 'notLogged'),
      substitution: substituted && logged
        ? 'Asked ' + equipmentWord(asked.equipment) + ' · logged ' + equipmentWord(logged.equipment)
        : null,
      sideLine: side || (recite ? askLine(asked) : null),
      countLine: null,
      asked: (logged || recite) && askedSets.length
        ? { label: 'Asked', groups: setGroups(askedSets) } : null,
      logged: logged ? { label: 'Logged', groups: setGroups(loggedSets) } : null,
    };
    // "each side" is a clause on the ask, not a set of its own, so it is its
    // own field rather than glued onto the last group's text -- a view that
    // drew the groups and forgot the clause would print a plan asking for half
    // of what it asks for.
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
    if (!logged && absentWord) out.title += ' · ' + absentWord;
    return out;
  }

  /**
   * The asked and the logged exercises of one day, joined.
   *
   * Two passes, in this order, so an exact match always wins:
   *   1. name and equipment -- a cable pulldown and a machine pulldown are
   *      not the same lift, and a coach prescribing one of them meant it.
   *   2. name alone, over what is left on each side: the equipment
   *      substitution, paired and labelled.
   * Never by position: skipping the second exercise would shift every pairing
   * after it.
   */
  function joinExercises(asked, logged) {
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
        return pairLines(p.asked, p.logged, p.substituted, 'not logged', false);
      }),
      // Working sets are the claim everywhere else here, so a lift nobody
      // asked for that was all warmups is not "0 sets" on screen.
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

  /**
   * Coach's footer is about somebody else -- "whether it arrived, and whether
   * they opened it, only they know". This is the same thought pointed the
   * other way, and it is the whole discipline of the card in one sentence: it
   * holds two records and knows nothing about the week that produced them. A
   * day nothing was logged against may have been a day you trained and did
   * not log, a day you were ill, or a day you were told to rest, and the only
   * person who can tell those apart is reading this.
   */
  var FOOTER = 'Your coach’s plan beside your own log. What else the week '
    + 'held, only you know.';

  /**
   * The head of the week.
   *
   * `logged N` is printed only once something is behind you: a week booked
   * entirely in the days ahead would otherwise open with "logged 0", which is
   * a zero nobody earned. A week that is over prints it whatever it is,
   * because by then it is a count of a finished thing and the same sentence a
   * coach reads.
   */
  function headLine(range, counts) {
    var head = 'Booked ' + plural(counts.booked, 'day', 'days') + ', ' + range;
    if (counts.logged || counts.notLogged) head += ' · logged ' + counts.logged;
    if (counts.toDo) head += ' · ' + counts.toDo + ' to do';
    if (counts.other) head += ' · ' + plural(counts.other, 'other day logged', 'other days logged');
    return head;
  }

  var WORDS = { logged: 'logged', toDo: 'to do', notLogged: 'not logged', notBooked: 'not booked' };

  /**
   * One week of a coach's plan against this device's log, or `null` when
   * there is nothing to say.
   *
   * `null` -- not an empty card, not an explanation -- whenever the week the
   * card is looking at books no training. A lifter who has never been sent a
   * plan should not learn that this screen exists by being told it has nothing
   * for them, and a week of your own training held up against a plan nobody
   * wrote is the app inventing an expectation.
   *
   * Days join on date, and on `startedSessionId` where there is one: starting
   * a booked session records which session it became, so a day carrying two
   * sessions compares the right one and the other falls to "Also logged". That
   * link is the one thing this side of the join has that Coach's does not --
   * and it is still only ever used to pick a session out of a day, never to
   * claim a session logged on one day answers a booking on another. A session
   * lifted the day after the one it was booked for is a booked day with
   * nothing logged, and a session of its own, sitting next to each other where
   * the person who lived the week can read what happened.
   */
  function compare(options) {
    var opts = options || {};
    var today = opts.today || dateKey(new Date());
    var anchor = opts.anchor || today;
    var span = weekOf(anchor);
    var from = span[0];
    var to = span[1];

    var training = (opts.training || []).filter(function (t) {
      return t && typeof t.date === 'string' && t.date >= from && t.date <= to;
    });
    if (!training.length) return null;

    var workouts = (opts.workouts || []).filter(function (w) {
      return w && typeof w.date === 'string' && w.date >= from && w.date <= to;
    });
    var startedIds = {};
    training.forEach(function (t) { if (t.startedSessionId) startedIds[t.startedSessionId] = true; });

    var byDate = {};
    training.forEach(function (t) { (byDate[t.date] || (byDate[t.date] = [])).push(t); });
    var bookedDates = Object.keys(byDate).sort();

    var counts = { booked: bookedDates.length, logged: 0, notLogged: 0, toDo: 0, other: 0 };
    var rows = bookedDates.map(function (date) {
      var booking = askedIn(byDate[date]);
      var onDay = workouts.filter(function (w) { return w.date === date; });
      // The session this booking was started as, when it still exists: a day
      // with a booked session and an extra one of your own compares the right
      // half. Deleting that session falls back to the day, which is what every
      // session logged without pressing "Start this session" does anyway.
      var started = null;
      (byDate[date] || []).forEach(function (t) {
        if (!t.startedSessionId) return;
        onDay.forEach(function (w) { if (w.id === t.startedSessionId) started = w; });
      });
      var mine = started ? [started] : onDay;
      var extra = started ? onDay.filter(function (w) { return w !== started; }) : [];

      var state;
      if (loggedIn(mine).length) { state = 'logged'; counts.logged += 1; }
      else if (date >= today) { state = 'toDo'; counts.toDo += 1; }
      else { state = 'notLogged'; counts.notLogged += 1; }

      var joined = state === 'logged'
        ? joinExercises(booking.exercises, loggedIn(mine))
        : { exercises: [], alsoLogged: [] };
      // A session on the same day that was not the one booked is logged work,
      // counted against nothing, exactly like a lift nobody asked for.
      loggedIn(extra).filter(function (ex) { return ex.sets.length; })
        .forEach(function (ex) { joined.alsoLogged.push(alsoLogged(ex)); });

      var word = WORDS[state];
      return {
        key: date,
        state: state,
        name: booking.name,
        // Past or today, so Train can be scrolled to it; a day still ahead
        // cannot be opened, which is the reason its prescription is printed
        // here instead.
        openable: date <= today,
        text: [dayLabel(date), booking.name, word].filter(Boolean).join(' · '),
        exercises: state === 'logged' ? joined.exercises
          : booking.exercises.map(function (ex) {
            return pairLines(ex, null, false, state === 'toDo' ? '' : word, state === 'toDo');
          }),
        alsoLogged: joined.alsoLogged,
      };
    });

    // A day in the week that was trained and that nothing was booked for.
    // Shown beside the bookings, saying nothing about cause: a session lifted
    // the day after the one it was booked for looks exactly like this, and so
    // does a session added for its own sake.
    workouts.forEach(function (session) {
      if (byDate[session.date]) return;
      if (!loggedIn([session]).length) return;
      var existing = null;
      rows.forEach(function (r) { if (r.key === session.date && r.state === 'notBooked') existing = r; });
      if (existing) {
        loggedIn([session]).filter(function (ex) { return ex.sets.length; })
          .forEach(function (ex) { existing.alsoLogged.push(alsoLogged(ex)); });
        return;
      }
      counts.other += 1;
      rows.push({
        key: session.date,
        state: 'notBooked',
        name: session.name || '',
        openable: session.date <= today,
        text: [dayLabel(session.date), session.name || '', WORDS.notBooked]
          .filter(Boolean).join(' · '),
        exercises: [],
        alsoLogged: loggedIn([session]).filter(function (ex) { return ex.sets.length; })
          .map(alsoLogged),
      });
    });
    rows.sort(function (a, b) { return a.key.localeCompare(b.key); });

    return {
      from: from,
      to: to,
      range: rangeText(from, to),
      counts: counts,
      head: headLine(rangeText(from, to), counts),
      days: rows,
      footer: FOOTER,
    };
  }

  /**
   * The Monday of the nearest week in `direction` (-1 back, +1 on) that books
   * something, or null when there is none.
   *
   * Paging moves between weeks a coach actually wrote, never one week at a
   * time. A card that vanished on the way to an empty week would take its own
   * arrows with it and leave no way back, which is the one thing worse than an
   * empty frame; and an arrow with nothing behind it is disabled rather than
   * hidden, so the row does not change shape as it is used.
   */
  function adjacentWeek(training, fromMonday, direction) {
    var weeks = {};
    (training || []).forEach(function (t) {
      if (!t || typeof t.date !== 'string') return;
      weeks[weekOf(t.date)[0]] = true;
    });
    var keys = Object.keys(weeks).sort().filter(function (k) {
      return direction < 0 ? k < fromMonday : k > fromMonday;
    });
    if (!keys.length) return null;
    return direction < 0 ? keys[keys.length - 1] : keys[0];
  }

  /** Who sent the week, for the one muted line above the head -- the same
   *  sentence the prescribed card has always opened with. */
  function sentBy(result, training) {
    var names = {};
    (training || []).forEach(function (t) {
      if (!t || t.date < result.from || t.date > result.to) return;
      if (typeof t.fromCoach === 'string' && t.fromCoach.trim()) names[t.fromCoach.trim()] = true;
    });
    var list = Object.keys(names);
    return list.length ? 'From ' + list.join(' · ') : 'From your coach';
  }

  /**
   * Every sentence this card can produce, flattened, in the order it is read.
   * The line-discipline tests run over this rather than over the DOM, so a
   * string that grades a week fails a test the day it is written rather than
   * the day someone notices it on a screen.
   */
  function lines(result) {
    if (!result) return [];
    var out = [result.head];
    result.days.forEach(function (day) {
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
    out.push(result.footer);
    return out;
  }

  global.LiftPlanLog = {
    FOOTER: FOOTER,
    WORDS: WORDS,
    weekOf: weekOf,
    rangeText: rangeText,
    dayLabel: dayLabel,
    exerciseKey: exerciseKey,
    setText: setText,
    setGroups: setGroups,
    compare: compare,
    adjacentWeek: adjacentWeek,
    sentBy: sentBy,
    lines: lines,
  };
})(typeof window !== 'undefined' ? window : globalThis);
