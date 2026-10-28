/* A folder of routines is a rotation: Push, Pull, Legs, Push... A port of LIFT
 * iOS's `RoutineRotation`, rule for rule, on this build's own data.
 *
 * The routine up next is the one after the last one started from that folder,
 * wrapping round, and the first of them before any has been started. A
 * folder's order is the order its routines were added in (`createdAt`), names
 * breaking a tie. The default folder -- a blank one, shown as "My Routines" --
 * is not a rotation: it is where routines go when nobody chose a folder, so it
 * groups nothing on purpose.
 *
 * **Which routine a day came from.** iOS knows by the `routine:<exercise id>`
 * ref `startSession` writes on each logged exercise. This build writes no such
 * thing: `LiftRoutines.toSession` gives every exercise a fresh id and records
 * the routine only as the session's `name`. So a session was started from a
 * routine when its name is the routine's (trimmed, any case) **and** it holds
 * at least one of the routine's lifts by `name|equipment` -- the second half
 * being iOS's own condition, "holds one of that routine's exercises", read the
 * only way this data can answer it. It also keeps a hand-logged "Push" with
 * none of the routine's lifts, or a same-named routine in another folder with
 * different lifts, from moving anything on. Nothing new is stored, so every
 * session started from a routine before this build counts too, as iOS's old
 * days do.
 *
 * A coach's session is never one of yours: a prescription's
 * `startedSessionId`, and a session named like a template the coach sent,
 * are left out (`ownSessions`), so a coach's "Push" does not turn your
 * rotation.
 */
(function (global) {
  'use strict';

  /** How far back is read: iOS fetches the newest 120 workout days. */
  var RECENT_DAYS = 120;

  var folderOf = function (routine) { return String((routine && routine.folder) || '').trim(); };
  var sameName = function (a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  };
  // app.js's matchKey, exactly: a lift is its name and its equipment.
  var liftKey = function (name, equipment) {
    return (String(name || '').trim() + '|' + String(equipment || '').trim()).toLowerCase();
  };

  /** Whether this session was started from this routine. See the top. */
  function startedFrom(session, routine) {
    if (!session || !routine || !String(routine.name || '').trim()) return false;
    if (!sameName(session.name, routine.name)) return false;
    var lifts = new Set((routine.exercises || []).map(function (e) { return liftKey(e.name, e.equipment); }));
    return (session.exercises || []).some(function (e) { return lifts.has(liftKey(e.name, e.equipment)); });
  }

  /** The sessions that are the lifter's own, not a coach's. */
  function ownSessions(workouts, training, templates) {
    var started = new Set((training || []).map(function (t) { return t && t.startedSessionId; }).filter(Boolean));
    var coachNames = (templates || []).map(function (t) { return t && t.name; }).filter(Boolean);
    return (workouts || []).filter(function (w) {
      return w && !started.has(w.id) && !coachNames.some(function (n) { return sameName(n, w.name); });
    });
  }

  function ordered(routines) {
    return (routines || []).slice().sort(function (a, b) {
      var ta = Number(a.createdAt) || 0, tb = Number(b.createdAt) || 0;
      if (ta !== tb) return ta - tb;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  /** Sessions grouped by date, newest date first, the newest RECENT_DAYS. */
  function days(sessions) {
    var byDate = new Map();
    (sessions || []).forEach(function (s) {
      if (!s || typeof s.date !== 'string') return;
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    });
    return Array.from(byDate.keys()).sort().reverse().slice(0, RECENT_DAYS)
      .map(function (date) { return { date: date, sessions: byDate.get(date) }; });
  }

  /**
   * `{ routineId, after, lastDate }`: the routine up next, the one the
   * rotation last moved through (null before the first), and the date it did.
   * Null for a folder of one, or the default folder.
   */
  function upNext(folder, routines, sessions) {
    if (!String(folder || '').trim() || !routines || routines.length < 2) return null;
    var order = ordered(routines);
    var list = days(sessions);
    for (var d = 0; d < list.length; d++) {
      // Two of a folder's routines started on one day: the later one in the
      // rotation is where it got to.
      var index = -1;
      order.forEach(function (routine, i) {
        if (list[d].sessions.some(function (s) { return startedFrom(s, routine); })) index = i;
      });
      if (index < 0) continue;
      return { routineId: order[(index + 1) % order.length].id, after: order[index].id, lastDate: list[d].date };
    }
    return { routineId: order[0].id, after: null, lastDate: null };
  }

  /** Routines by their folder as stored, trimmed; '' is the default folder. */
  function folders(routines) {
    var groups = [];
    (routines || []).forEach(function (r) {
      var folder = folderOf(r);
      var group = groups.find(function (g) { return g.folder === folder; });
      if (!group) { group = { folder: folder, routines: [] }; groups.push(group); }
      group.routines.push(r);
    });
    return groups;
  }

  /**
   * Of every folder's up next, the one whose rotation was trained most
   * recently: that is the programme someone is actually running. Null when no
   * folder's rotation has been started at all, because the first routine of
   * every folder is not a suggestion anybody asked for.
   */
  function current(routines, sessions) {
    var best = null;
    folders(routines).forEach(function (group) {
      var next = upNext(group.folder, group.routines, sessions);
      if (!next || next.lastDate === null) return;
      if (!best || next.lastDate > best.upNext.lastDate) best = { folder: group.folder, upNext: next };
    });
    return best;
  }

  /** Each folder's next routine, by id. */
  function upNextIds(routines, sessions) {
    var ids = new Set();
    folders(routines).forEach(function (group) {
      var next = upNext(group.folder, group.routines, sessions);
      if (next) ids.add(next.routineId);
    });
    return ids;
  }

  /** The order a folder's routines are listed in: a named folder in its
   *  rotation's order, the default folder as it always was. */
  function listed(folder, routines) {
    return String(folder || '').trim() ? ordered(routines) : routines;
  }

  global.LiftRotation = {
    RECENT_DAYS: RECENT_DAYS,
    startedFrom: startedFrom,
    ownSessions: ownSessions,
    ordered: ordered,
    upNext: upNext,
    folders: folders,
    current: current,
    upNextIds: upNextIds,
    listed: listed,
  };
})(typeof window !== 'undefined' ? window : globalThis);
