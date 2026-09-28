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
 * **Meals are stated, never answered.** A coach can book meals as well as
 * sessions (PLAN-FORMAT's `m`), and accepting a plan files them in `plan`
 * beside the ones you place yourself. This card lists the ones a coach booked
 * -- `Dinner · Beef Chilli · 2 servings` -- and says nothing whatever about
 * what you ate. Coach's card does the other half as well: it names the foods
 * the client stamped with that slot, above a count of the day's foods so
 * `Nothing logged at lunch` cannot read as `they ate nothing`, under a note
 * saying it cannot know whether the dish was the one it booked. None of that
 * half is worth anything here. Your food log is on the Food screen, dated, and
 * reading it back to you in the third person tells you nothing you did not
 * already know -- and you are the one person who does not need telling whether
 * they ate their dinner. So there is no `Nothing logged at lunch`, no food
 * count above the rows, no macros beside a booked dish, no figure for meals
 * eaten, and no meal footer: the note exists to disclaim a join Coach cannot
 * make, and this card makes no claim to disclaim.
 *
 * What is left is the one thing no other screen gives you: the food booked for
 * a day you cannot reach. Cook's plan shows seven days from today and Train
 * shows one, so a dish booked for next Thursday is legible nowhere until you
 * arrive at it, and a week of it that a coach sent reached no screen at all.
 * `to do` carries that, as it does for a session.
 *
 * `loggedFoodEntryId` is deliberately not read. This device really does know a
 * planned meal was logged -- you tapped "Log it" and the entry's id was stored
 * against it -- so unlike Coach there would be no guessing in saying so. It is
 * still not printed. The only thing it could add is a tick on some meal rows
 * and a blank on the rest, which is a score with the numbers filed off, and
 * the screen that can act on the answer (Cook's plan, with `Log it` beside the
 * dish) already shows it where it is useful.
 *
 * Only a coach's meals, never your own. A dinner you planned yourself is yours
 * to move, and holding it up on a card headed "your coach's plan" would be the
 * app making an expectation out of your own note-taking -- the same reason a
 * week nobody booked is no card at all. A week a coach booked no meals in
 * reads exactly as it did before any of this: the count, the clause and the
 * rows appear only where there is a booked meal to carry them.
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

  /* ---------------- the meals a coach booked ----------------
   *
   * `plan` is this device's planned meals -- the ones a coach sent and the ones
   * placed here, in one list, the coach's marked `fromCoach` exactly as a
   * prescribed session is. The slot is stored as LIFT writes it, and read into
   * the four words PLAN-FORMAT's `m.s` indexes in the same order, so a booked
   * slot is named here the way Coach names it. */
  var MEAL_SLOTS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  var SLOT_LABELS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

  /**
   * One booked meal: the slot, the dish and how much of it, which are the
   * three things a coach wrote and so the three things that can be said
   * without reservation. Macros are not here, and neither is anything about
   * the food log -- see the head of this file.
   *
   * `title` is the whole line and `slotLabel` / `detail` are its two columns,
   * so the view can align the slots without composing a second sentence of its
   * own that could drift from the one the tests read.
   */
  function mealRow(meal) {
    var detail = [meal.name, plural(meal.servings, 'serving', 'servings')].join(' · ');
    return {
      date: meal.date,
      slot: meal.slot,
      slotLabel: meal.slotLabel,
      name: meal.name,
      servings: meal.servings,
      detail: detail,
      title: [meal.slotLabel, detail].filter(Boolean).join(' · '),
    };
  }

  /**
   * The meals a coach booked, in the window given, breakfast to snack within
   * each day -- the order a day is eaten in, not the order the coach happened
   * to book them. Two dishes at one dinner are two dishes and both are shown;
   * meals do not pool, as sessions on a date do, because a coach who booked
   * both wants both eaten.
   *
   * A slot this build cannot read sorts last rather than being dropped: a dish
   * a coach booked is a dish a coach booked, and hiding it would hide the plan.
   * `from` and `to` are optional -- the arrows need every week a coach booked a
   * meal in, not one week of them.
   */
  function bookedMeals(plan, from, to) {
    return (plan || []).filter(function (m) {
      return m && m.fromCoach && typeof m.date === 'string'
        && (!from || m.date >= from) && (!to || m.date <= to);
    }).map(function (m) {
      var slot = MEAL_SLOTS.indexOf(String(m.meal == null ? '' : m.meal).toUpperCase());
      var servings = Number(m.servings);
      return {
        date: m.date,
        slot: slot,
        slotLabel: slot < 0 ? '' : SLOT_LABELS[slot],
        name: String(m.recipeName == null ? '' : m.recipeName).trim() || 'Recipe',
        servings: servings > 0 ? servings : 1,
      };
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.slot < 0 ? 9 : a.slot) - (b.slot < 0 ? 9 : b.slot);
    }).map(mealRow);
  }

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

  /** The name of the first session logged on a day that names itself, for a
   *  row whose booking has no session of its own to take a name from. */
  function loggedName(sessions) {
    var found = '';
    (sessions || []).forEach(function (s) {
      if (found || !s || !loggedIn([s]).length) return;
      found = s.name || '';
    });
    return found;
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
    // What a coach booked, which is a count of their own writing. There is no
    // figure beside it for meals eaten, in this line or anywhere else.
    if (counts.meals) head += ' · ' + plural(counts.meals, 'meal booked', 'meals booked');
    if (counts.logged || counts.notLogged) {
      // `logged 1` under `Booked 5 days` would read as one day of five when
      // three of them booked no session at all, so once meals are in the line
      // the figure says what it counts. Coach's sentence, for the same reason.
      head += counts.meals
        ? ' · ' + plural(counts.training, 'training day', 'training days')
          + ', ' + counts.logged + ' logged'
        : ' · logged ' + counts.logged;
    }
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
    var meals = bookedMeals(opts.plan, from, to);
    // A plan is a plan whichever half of it arrived: `k` and `m` are
    // independent (PLAN-FORMAT), and a send carrying only meals books days.
    // Before this the card was absent for one, so a coach who sent a week of
    // food reached no screen that said so past Cook's seven days from today.
    if (!training.length && !meals.length) return null;

    var workouts = (opts.workouts || []).filter(function (w) {
      return w && typeof w.date === 'string' && w.date >= from && w.date <= to;
    });
    var startedIds = {};
    training.forEach(function (t) { if (t.startedSessionId) startedIds[t.startedSessionId] = true; });

    var byDate = {};
    training.forEach(function (t) { (byDate[t.date] || (byDate[t.date] = [])).push(t); });
    var mealsByDate = {};
    meals.forEach(function (m) { (mealsByDate[m.date] || (mealsByDate[m.date] = [])).push(m); });
    // Every date this week books anything at all. A day may book a session
    // with no meals, meals with no session, or both, and all three are one row
    // -- this card opens one date at a time and Train navigates to a date, so
    // a second row on the same day would open two details and go nowhere new.
    var bookedOn = {};
    Object.keys(byDate).concat(Object.keys(mealsByDate)).forEach(function (date) {
      bookedOn[date] = true;
    });
    var bookedDates = Object.keys(bookedOn).sort();

    var counts = { booked: bookedDates.length, training: 0, meals: 0,
      logged: 0, notLogged: 0, toDo: 0, other: 0 };
    var rows = bookedDates.map(function (date) {
      var booked = byDate[date] || [];
      var booking = askedIn(booked);
      // Whether this day books a session at all. A day that books only meals
      // gets no training verdict: `not logged` against a day nobody was asked
      // to train would be the app inventing a booking to hold against you.
      var booksTraining = booked.length > 0;
      var dayMeals = mealsByDate[date] || [];
      var onDay = workouts.filter(function (w) { return w.date === date; });
      // The session this booking was started as, when it still exists: a day
      // with a booked session and an extra one of your own compares the right
      // half. Deleting that session falls back to the day, which is what every
      // session logged without pressing "Start this session" does anyway.
      var started = null;
      booked.forEach(function (t) {
        if (!t.startedSessionId) return;
        onDay.forEach(function (w) { if (w.id === t.startedSessionId) started = w; });
      });
      var mine = !booksTraining ? [] : (started ? [started] : onDay);
      var extra = !booksTraining ? onDay
        : (started ? onDay.filter(function (w) { return w !== started; }) : []);

      if (booksTraining) counts.training += 1;
      counts.meals += dayMeals.length;
      var state;
      if (booksTraining) {
        if (loggedIn(mine).length) { state = 'logged'; counts.logged += 1; }
        else if (date >= today) { state = 'toDo'; counts.toDo += 1; }
        else { state = 'notLogged'; counts.notLogged += 1; }
      // A day booked for food that you trained anyway. The training was not
      // booked, which is the same fact -- and Coach's same word -- as a day the
      // plan says nothing about, and it is said on the row itself so a week
      // read with every day shut still says which days you trained.
      } else if (loggedIn(onDay).length) { state = 'notBooked'; counts.other += 1; }
      // A day still ahead is a plan, whether it books a session, a dinner or
      // both. `to do` is a fact about the calendar and needs no log to be true,
      // which is why it is the one verdict a meals-only day can carry.
      else if (date >= today) { state = 'toDo'; counts.toDo += 1; }
      // A day in the past that booked food and nothing else. No word at all:
      // there is no `not logged` for a meal, and no figure for one either.
      else { state = 'meals'; }

      var joined = state === 'logged'
        ? joinExercises(booking.exercises, loggedIn(mine))
        : { exercises: [], alsoLogged: [] };
      // A session on the same day that was not the one booked is logged work,
      // counted against nothing, exactly like a lift nobody asked for.
      loggedIn(extra).filter(function (ex) { return ex.sets.length; })
        .forEach(function (ex) { joined.alsoLogged.push(alsoLogged(ex)); });

      var word = WORDS[state] || '';
      // A booking names itself. Only a day that books no session at all takes
      // its name from what was logged on it, exactly as a `not booked` day of
      // its own does -- a booked session with a blank name keeps its blank.
      var name = booking.name || (booksTraining ? '' : loggedName(onDay));
      var mealsClause = dayMeals.length
        ? plural(dayMeals.length, 'meal booked', 'meals booked') : '';
      // The training word hugs the session it judges; the meal clause follows
      // it. A day that booked no session has no session for it to hug, so what
      // is left -- `to do`, or nothing -- goes last instead. Coach's own rule,
      // and its own sentence: a week described to a coach reads the same way.
      var head = name
        ? [dayLabel(date), name, word, mealsClause]
        : [dayLabel(date), mealsClause, word];
      return {
        key: date,
        state: state,
        name: name,
        // Past or today, so Train can be scrolled to it; a day still ahead
        // cannot be opened, which is the reason its prescription is printed
        // here instead.
        openable: date <= today,
        text: head.filter(Boolean).join(' · '),
        exercises: state === 'logged' ? joined.exercises
          : booking.exercises.map(function (ex) {
            return pairLines(ex, null, false, state === 'toDo' ? '' : word, state === 'toDo');
          }),
        alsoLogged: joined.alsoLogged,
        // What a coach booked for this day to eat, and nothing about what was
        // eaten. Empty on every day nobody booked a meal for.
        meals: dayMeals,
      };
    });

    // A day in the week that was trained and that nothing was booked for.
    // Shown beside the bookings, saying nothing about cause: a session lifted
    // the day after the one it was booked for looks exactly like this, and so
    // does a session added for its own sake.
    workouts.forEach(function (session) {
      // Every date this send booked, meals included: a day booked for food and
      // trained anyway is already the row above, with `not booked` on it.
      if (bookedOn[session.date]) return;
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
        // A day nobody booked booked no meal either, by definition.
        meals: [],
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
  function adjacentWeek(training, fromMonday, direction, plan) {
    var weeks = {};
    var mark = function (date) { weeks[weekOf(date)[0]] = true; };
    (training || []).forEach(function (t) {
      if (!t || typeof t.date !== 'string') return;
      mark(t.date);
    });
    // Meals book weeks too. Without this a week a coach sent food for would be
    // reachable only by standing in it, and the arrows would skip over a card
    // that exists.
    bookedMeals(plan).forEach(function (m) { mark(m.date); });
    var keys = Object.keys(weeks).sort().filter(function (k) {
      return direction < 0 ? k < fromMonday : k > fromMonday;
    });
    if (!keys.length) return null;
    return direction < 0 ? keys[keys.length - 1] : keys[0];
  }

  /** Who sent the week, for the one muted line above the head -- the same
   *  sentence the prescribed card has always opened with. */
  function sentBy(result, training, plan) {
    var names = {};
    var add = function (row) {
      if (!row || row.date < result.from || row.date > result.to) return;
      if (typeof row.fromCoach === 'string' && row.fromCoach.trim()) {
        names[row.fromCoach.trim()] = true;
      }
    };
    (training || []).forEach(add);
    // A week that booked only meals is signed by whoever sent it, like any
    // other. A meal placed on this device carries no `fromCoach` at all, so the
    // same test that keeps it off the card keeps its owner out of the name.
    (plan || []).forEach(add);
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
      // Meals last, under the training they sit beside. One line each, and
      // nothing under them: there is no second row about the food log.
      if (day.meals.length) {
        out.push('Meals');
        day.meals.forEach(function (meal) { out.push(meal.title); });
      }
    });
    out.push(result.footer);
    return out;
  }

  global.LiftPlanLog = {
    FOOTER: FOOTER,
    WORDS: WORDS,
    MEAL_SLOTS: MEAL_SLOTS,
    bookedMeals: bookedMeals,
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
