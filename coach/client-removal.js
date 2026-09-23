/* Remove client: the client, their days, and everything made for them.
 *
 * The meals planned and sessions booked for a client each carry that client's
 * id and nothing else. With the client gone they appear in no week, can never
 * be sent or edited, and would still ride along in every backup -- data about
 * a former client the coach can neither see nor delete. So they go with them.
 * Recipes and workouts stay; they are the coach's own library.
 *
 * A port of Coach for Android's ClientRemoval.kt, with its wording, so the two
 * say and do the same thing. Nothing in here touches localStorage or the DOM:
 * it counts and filters, the caller saves, and node can test it with no
 * browser (client-removal.test.mjs).
 *
 * Shopping ticks are absent on purpose -- this app does not store them. The
 * list is derived from plans and recipes on every render (BACKUP-FORMAT.md,
 * "Shopping-list ticks are absent by design too"), so removing a client's
 * meals removes their list.
 *
 * Road picks go too, for the reason the meals do: they are a list made for one
 * client, keyed by that client's id, and with the client gone they can be
 * neither seen nor sent while still riding in every backup. They are not in
 * the confirmation sentence, which is Android's word for word and was written
 * before road picks existed; when Coach for Android gains them, the sentence
 * gains a clause in both places at once, not here alone.
 *
 * The record of what was sent to this client goes with them for the same
 * reason again, and is out of the sentence for the same reason again: a
 * SentPlan is a payload addressed to one person, readable on no screen once
 * they are gone, and still in every backup. It is a row carrying a clientId,
 * so it filters exactly as the meals and sessions do.
 */
(function (global) {
  'use strict';

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const mine = (rows, clientId) =>
    (Array.isArray(rows) ? rows : []).filter((row) => row && row.clientId === clientId);

  /** What removing this client takes with it, counted before the coach confirms.
   *  Null when the client is not on this device (already removed, or never was). */
  function impact(clientId, stores) {
    const client = (Array.isArray(stores.clients) ? stores.clients : [])
      .find((c) => c && c.id === clientId);
    if (!client) return null;
    return {
      clientName: client.name,
      loggedDays: Object.keys(client.days || {}).length,
      plannedMeals: mine(stores.plans, clientId).length,
      bookedSessions: mine(stores.sessions, clientId).length,
    };
  }

  /** The confirmation's body: what goes, in words, before anything does.
   *  Android says "routines"; this app calls the same thing a workout. */
  function confirmationText(imp) {
    const planned = [];
    if (imp.plannedMeals) planned.push(plural(imp.plannedMeals, 'planned meal', 'planned meals'));
    if (imp.bookedSessions) planned.push(plural(imp.bookedSessions, 'booked session', 'booked sessions'));
    const also = planned.length ? `, and the ${planned.join(' and ')} you made for them` : '';
    return `Their ${plural(imp.loggedDays, 'logged day', 'logged days')} will be removed `
      + `from this device${also}. Your recipes and workouts stay. A backup file you saved `
      + `earlier still has them. This can't be undone.`;
  }

  /** The whole dialog for a browser `confirm`, which has no title of its own:
   *  Android's title line, then its body. One dialog, naming the client. */
  const confirmationPrompt = (imp) => `Remove ${imp.clientName}?\n\n${confirmationText(imp)}`;

  /** The stores as they should be after the removal, as new values for the
   *  caller to save. A meal or session belonging to nobody (`clientId` null)
   *  is not this client's and stays. `removed` is false, and the stores come
   *  back untouched, when the client is not here. */
  function remove(clientId, stores) {
    const counted = impact(clientId, stores);
    if (!counted) {
      return {
        removed: false,
        impact: null,
        clients: stores.clients,
        plans: stores.plans,
        sessions: stores.sessions,
        roadPicks: stores.roadPicks,
        sentPlans: stores.sentPlans,
      };
    }
    // Road picks are a map keyed by client id, not rows carrying one, so the
    // client's key is dropped rather than the list filtered. A copy, so the
    // caller's own object is not changed before they decide to save it.
    const picks = {};
    const from = stores.roadPicks;
    if (from && typeof from === 'object') {
      Object.keys(from).forEach((id) => { if (id !== clientId) picks[id] = from[id]; });
    }
    return {
      removed: true,
      impact: counted,
      clients: stores.clients.filter((c) => !c || c.id !== clientId),
      plans: (Array.isArray(stores.plans) ? stores.plans : [])
        .filter((p) => !p || p.clientId !== clientId),
      sessions: (Array.isArray(stores.sessions) ? stores.sessions : [])
        .filter((k) => !k || k.clientId !== clientId),
      roadPicks: picks,
      sentPlans: (Array.isArray(stores.sentPlans) ? stores.sentPlans : [])
        .filter((p) => !p || p.clientId !== clientId),
    };
  }

  global.CoachClientRemoval = {
    impact: impact,
    confirmationText: confirmationText,
    confirmationPrompt: confirmationPrompt,
    remove: remove,
  };
})(typeof window !== 'undefined' ? window : globalThis);
