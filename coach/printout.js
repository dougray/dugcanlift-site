/* A client's week on paper.
 *
 * The days that have something booked, each workout's exercises and what they
 * ask for, read the way this page's own workout cards read them
 * (CoachPrescriptions.summary). For the client who wants it printed or kept as
 * a PDF rather than imported into LIFT.
 *
 * A port of Coach iPhone's `PlanPrintout`, and the same lines Coach Android
 * prints, in the same order:
 *
 *   Jordan Reyes
 *   Week of Thu, Oct 29 · from Doug        (the clause only with a coach name)
 *   Nothing is booked this week.           (only when nothing is)
 *   Thu, Oct 29                            (each day with a booking, in order)
 *     Lower A                              ("Removed workout" when deleted)
 *       Back Squat (Barbell): 3 × 225 × 5
 *         Belt on the last set.            (the exercise's note, when it has one)
 *
 * Change these lines in all three builds or in none.
 *
 * **Printing is not a send.** Nothing is recorded -- no sent-plan row --
 * because a printout is not a plan the client's app received.
 *
 * The lines are values with no DOM in them, so printout.test.mjs pins what is
 * on the page; app.js only draws them, and the browser paginates (style.css,
 * `@media print`) and offers Save as PDF in its own print dialog.
 */
(function (global) {
  'use strict';

  var REMOVED_WORKOUT = 'Removed workout';

  /** "Back Squat (Barbell)": the name, and the equipment with each word's
   *  first letter upper-cased -- Coach iPhone's `RoutineExercise.displayName`. */
  function exerciseName(exercise) {
    var name = (exercise && exercise.name) || '';
    var equipment = String((exercise && exercise.equipment) || '').trim();
    if (!equipment) return name;
    var titled = equipment.split(' ').map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
    return name + ' (' + titled + ')';
  }

  /**
   * Days in order, only those with a booking, for one client. A booking whose
   * workout has been deleted reads "Removed workout" and lists nothing.
   *
   * @param weekDays  the week's day keys, in order
   * @param sessions  every scheduled session; filtered to `clientId` here
   * @param workouts  every workout template
   * @param summary   how an exercise reads -- CoachPrescriptions.summary
   */
  function days(weekDays, clientId, sessions, workouts, summary) {
    var byId = {};
    (workouts || []).forEach(function (w) { byId[w.id] = w; });
    var mine = (sessions || []).filter(function (k) { return k.clientId === clientId; });
    var out = [];
    (weekDays || []).forEach(function (day) {
      var booked = mine.filter(function (k) { return k.date === day; });
      if (!booked.length) return;
      out.push({
        dayKey: day,
        workouts: booked.map(function (session) {
          var workout = Object.prototype.hasOwnProperty.call(byId, session.workoutId)
            ? byId[session.workoutId] : null;
          if (!workout) return { name: REMOVED_WORKOUT, exercises: [] };
          return {
            name: workout.name || 'Untitled',
            exercises: (workout.exercises || []).map(function (exercise) {
              var note = typeof exercise.note === 'string' && exercise.note.trim()
                ? exercise.note : null;
              return { name: exerciseName(exercise), prescription: summary(exercise), note: note };
            }),
          };
        }),
      });
    });
    return out;
  }

  /**
   * Everything the page says, in order, each with how it is set and the space
   * above it in points -- the iPhone page's sizes: title 20 bold, subtitle 10
   * gray, day 14 and workout 12 semibold, exercise 11, note 10 gray, body 11.
   * `dayTitle` is passed in so the words can be pinned under one locale while
   * the page formats in the reader's.
   */
  function lines(clientName, weekStart, coachName, printedDays, dayTitle) {
    var out = [];
    var line = function (text, style, before) { out.push({ text: text, style: style, before: before || 0 }); };
    line(String(clientName || '').trim() || 'Plan', 'title');
    var coach = String(coachName || '').trim();
    line('Week of ' + dayTitle(weekStart) + (coach ? ' · from ' + coach : ''), 'subtitle');
    if (!printedDays.length) line('Nothing is booked this week.', 'body', 12);
    printedDays.forEach(function (day) {
      line(dayTitle(day.dayKey), 'day', 16);
      day.workouts.forEach(function (workout) {
        line(workout.name, 'workout', 6);
        workout.exercises.forEach(function (exercise) {
          line(exercise.name + ': ' + exercise.prescription, 'exercise', 2);
          if (exercise.note) line(exercise.note, 'note');
        });
      });
    });
    return out;
  }

  /** "Mon, Oct 26" in the reader's locale (undefined): abbreviated weekday,
   *  day, abbreviated month -- what iPhone's `.weekday(.abbreviated).day()
   *  .month(.abbreviated)` and Android's "EEEdMMM" give. A key that is not a
   *  day prints as itself. */
  function dayTitle(key, locale) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return String(key || '');
    var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (date.getMonth() !== Number(m[2]) - 1) return String(key);
    return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /** "Jordan Reyes – week of 2026-10-26.pdf", with what a file name cannot
   *  hold taken out. The page uses it, without ".pdf", as the document title,
   *  which is the name a browser's Save as PDF offers. */
  function fileName(clientName, weekStart) {
    var safe = String(clientName || '').replace(/[\/\\:?*"<>|]/g, '');
    return (safe || 'Plan') + ' – week of ' + weekStart + '.pdf';
  }

  global.CoachPrintout = {
    REMOVED_WORKOUT: REMOVED_WORKOUT,
    exerciseName: exerciseName,
    days: days,
    lines: lines,
    dayTitle: dayTitle,
    fileName: fileName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
