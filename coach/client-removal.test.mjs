import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it. Run from the repo root: node --test coach/
const shim = { window: {} };
new Function('window', readFileSync('coach/client-removal.js', 'utf8')).call(shim, shim.window);
const { impact, confirmationText, confirmationPrompt, remove } = shim.window.CoachClientRemoval;

// The three stores app.js keeps, in the shape it keeps them: a client's days
// are an object keyed by date, and a plan or session carries its client's id.
const stores = () => ({
  clients: [
    { id: 'jordan', name: 'Jordan Reyes', days: { '2026-09-14': {}, '2026-09-15': {} } },
    { id: 'sam', name: 'Sam Ortiz', days: { '2026-09-15': {} } },
  ],
  plans: [
    { id: 'm1', clientId: 'jordan', recipeId: 'chili', date: '2026-09-16', meal: 'DINNER' },
    { id: 'm2', clientId: 'jordan', recipeId: 'chili', date: '2026-09-17', meal: 'LUNCH' },
    { id: 'm3', clientId: 'sam', recipeId: 'chili', date: '2026-09-16', meal: 'DINNER' },
    { id: 'm4', clientId: null, recipeId: 'chili', date: '2026-09-16', meal: 'SNACK' },
  ],
  sessions: [
    { id: 's1', clientId: 'jordan', date: '2026-09-16', workoutId: 'push', workoutName: 'Push' },
    { id: 's2', clientId: 'sam', date: '2026-09-16', workoutId: 'push', workoutName: 'Push' },
  ],
  // Road picks are a map, one list of item ids per client.
  roadPicks: {
    jordan: ['wendys-large-chili', 'snack-jack-links-original-beef-jerky'],
    sam: ['subway-oven-roasted-turkey-6-inch'],
  },
  // Sent plans are rows carrying a client id, like the meals and sessions.
  sentPlans: [
    { id: 'sp1', clientId: 'jordan', sentAt: 100, payloadHash: 'h1', payload: { v: 1 } },
    { id: 'sp2', clientId: 'sam', sentAt: 200, payloadHash: 'h2', payload: { v: 1 } },
  ],
});

test('impact counts the client\'s days, meals and sessions', () => {
  assert.deepEqual(impact('jordan', stores()), {
    clientName: 'Jordan Reyes', loggedDays: 2, plannedMeals: 2, bookedSessions: 1,
  });
});

test('impact of a client not on this device is null', () => {
  assert.equal(impact('nobody', stores()), null);
});

test('removing a client with meals and sessions takes exactly theirs', () => {
  const before = stores();
  const after = remove('jordan', before);

  assert.equal(after.removed, true);
  assert.deepEqual(after.impact, {
    clientName: 'Jordan Reyes', loggedDays: 2, plannedMeals: 2, bookedSessions: 1,
  });
  assert.deepEqual(after.clients.map((c) => c.id), ['sam']);
  // m4 belongs to nobody, not to Jordan, so it stays.
  assert.deepEqual(after.plans.map((p) => p.id), ['m3', 'm4']);
  assert.deepEqual(after.sessions.map((k) => k.id), ['s2']);
  // The record of what was sent to them goes too: it is addressed to one
  // person, shows on no screen once they are gone, and would otherwise ride
  // in every backup from now on.
  assert.deepEqual(after.sentPlans.map((p) => p.id), ['sp2']);
});

test('the other client keeps their day, their meal and their session', () => {
  const after = remove('jordan', stores());

  assert.deepEqual(after.clients[0].days, { '2026-09-15': {} });
  assert.deepEqual(after.plans.filter((p) => p.clientId === 'sam').map((p) => p.id), ['m3']);
  assert.deepEqual(after.sessions.filter((k) => k.clientId === 'sam').map((k) => k.id), ['s2']);
  // And counting Sam afterwards still sees everything of theirs.
  assert.deepEqual(impact('sam', after), {
    clientName: 'Sam Ortiz', loggedDays: 1, plannedMeals: 1, bookedSessions: 1,
  });
});

test('a client with nothing planned leaves both libraries alone', () => {
  const before = stores();
  before.clients.push({ id: 'solo', name: 'Solo', days: {} });
  const after = remove('solo', before);

  assert.equal(after.removed, true);
  assert.deepEqual(after.impact,
    { clientName: 'Solo', loggedDays: 0, plannedMeals: 0, bookedSessions: 0 });
  assert.deepEqual(after.clients.map((c) => c.id), ['jordan', 'sam']);
  assert.deepEqual(after.plans, before.plans);
  assert.deepEqual(after.sessions, before.sessions);
});

test('removing a client who is not here changes nothing', () => {
  const before = stores();
  const after = remove('nobody', before);

  assert.equal(after.removed, false);
  assert.equal(after.impact, null);
  assert.equal(after.clients, before.clients);
  assert.equal(after.plans, before.plans);
  assert.equal(after.sessions, before.sessions);
  assert.equal(after.sentPlans, before.sentPlans);
});

test('a backup written afterwards mentions neither the meals nor the sessions', () => {
  const after = remove('jordan', stores());
  const file = JSON.stringify({
    v: 2, clients: after.clients, settings: {},
    recipes: [{ id: 'chili', name: 'Chili' }],
    plans: after.plans, workouts: [{ id: 'push', name: 'Push' }], sessions: after.sessions,
    sentPlans: after.sentPlans,
  });

  assert.equal(file.includes('jordan'), false);
  assert.equal(file.includes('m1'), false);
  assert.equal(file.includes('s1'), false);
  assert.equal(file.includes('sp1'), false);
  // The coach's own library is untouched by any of it.
  assert.equal(JSON.parse(file).recipes.length, 1);
  assert.equal(JSON.parse(file).workouts.length, 1);
});

test('the confirmation says whose, what goes and what stays', () => {
  assert.equal(
    confirmationText({ clientName: 'Jordan Reyes', loggedDays: 2, plannedMeals: 2, bookedSessions: 1 }),
    'Their 2 logged days will be removed from this device, and the 2 planned meals and '
      + '1 booked session you made for them. Your recipes and workouts stay. A backup file '
      + "you saved earlier still has them. This can't be undone.");
  assert.equal(
    confirmationText({ clientName: 'Sam', loggedDays: 1, plannedMeals: 0, bookedSessions: 0 }),
    'Their 1 logged day will be removed from this device. Your recipes and workouts stay. '
      + "A backup file you saved earlier still has them. This can't be undone.");
  assert.equal(
    confirmationText({ clientName: 'Sam', loggedDays: 0, plannedMeals: 1, bookedSessions: 0 }),
    'Their 0 logged days will be removed from this device, and the 1 planned meal you made '
      + "for them. Your recipes and workouts stay. A backup file you saved earlier still has "
      + "them. This can't be undone.");
});

test('the prompt names the client above the body', () => {
  const imp = { clientName: 'Jordan Reyes', loggedDays: 2, plannedMeals: 2, bookedSessions: 1 };
  assert.equal(confirmationPrompt(imp), `Remove Jordan Reyes?\n\n${confirmationText(imp)}`);
});

/* ---------------- road picks ---------------- */

test("a removal takes the client's road picks and leaves everyone else's", () => {
  const before = stores();
  const after = remove('jordan', before);
  assert.deepEqual(after.roadPicks, { sam: ['subway-oven-roasted-turkey-6-inch'] });
  // The caller's own object is untouched until it saves what came back.
  assert.ok(before.roadPicks.jordan, 'the stores passed in are not mutated');
});

test('a client who is not here changes no picks, and missing picks are not an error', () => {
  const after = remove('nobody', stores());
  assert.deepEqual(after.roadPicks, stores().roadPicks);
  const noPicks = { ...stores(), roadPicks: undefined };
  assert.deepEqual(remove('jordan', noPicks).roadPicks, {});
});

/* ---------------- sent plans ---------------- */

test("a removal takes the client's sent plans and leaves everyone else's", () => {
  const after = remove('jordan', stores());
  assert.deepEqual(after.sentPlans.map((p) => p.id), ['sp2']);
  // A row belonging to nobody is not this client's and stays.
  const orphan = stores();
  orphan.sentPlans.push({ id: 'sp0', clientId: null, payload: { v: 1 } });
  assert.deepEqual(remove('jordan', orphan).sentPlans.map((p) => p.id), ['sp2', 'sp0']);
});

test('a store with no sent plans at all is not an error', () => {
  const none = { ...stores(), sentPlans: undefined };
  assert.deepEqual(remove('jordan', none).sentPlans, []);
});

test('the confirmation sentence is unchanged by any of this', () => {
  // Three Coach builds pin this sentence word for word, and it was written
  // before sent plans existed. It gains a clause in all three at once or in
  // none -- the call road picks already made.
  const imp = { clientName: 'Jordan Reyes', loggedDays: 2, plannedMeals: 2, bookedSessions: 1 };
  const text = confirmationText(imp).toLowerCase();
  // "booked session" is Android's own clause and belongs there; what must
  // not appear is a clause about the plans Coach sent or the picks it holds.
  ['sent plan', 'plan you sent', 'road pick'].forEach((clause) => {
    assert.equal(text.includes(clause), false, `the sentence gained "${clause}"`);
  });
});
