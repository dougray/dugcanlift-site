import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// fixtures/web-plan-road-picks.txt: a plan link Coach web's own encoder wrote
// (dugcanlift-coach, coach/fixtures/, the same bytes). Two meals off one
// recipe, one session off a workout, and six road picks in `rf` -- two at
// Wendy's, two at Chick-fil-A, a gas-station jerky, and one id the bundled
// file deliberately does not have. Never regenerate it from a decoder here.
const FIXTURE = readFileSync('lift/fixtures/web-plan-road-picks.txt', 'utf8').trim();
const DATA = JSON.parse(readFileSync('lift/road-food.json', 'utf8'));

async function unpack(link) {
  const frag = link.slice(link.indexOf('#') + 1);
  const match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
  const bytes = Buffer.from(match[3], 'base64url');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// MARK: - Old decoder degradation

// importPlan's recipe and meal mapping and importTraining's template mapping,
// as they stood on main before road picks (dugcanlift-site f0afe6c,
// lift/app.js), verbatim. Frozen here on purpose: the promise is that a LIFT
// build that has never heard of `rf` takes the plan in exactly as before and
// simply does not see the key.
//
// Checked on 2026-09-22 against main itself, not against this copy: the
// fixture was run through `git show origin/main:lift/app.js` -- importPlan and
// importTraining lifted out of it and given stand-in storage -- before
// anything in this repo changed. It imported 2 meals and 1 session, and
// nothing about a pick reached storage. These assertions are that run.
const oldImportPlan = (payload, recipes, plan, uid) => {
  const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  const ids = [];
  (payload.r || []).forEach((raw) => {
    const name = raw.n || 'Untitled recipe';
    const nutrition = Array.isArray(raw.u) ? {
      calories: raw.u[0] || 0, proteinG: raw.u[1] || 0,
      carbsG: raw.u[2] || 0, fatG: raw.u[3] || 0, fiberG: raw.u[4] || 0,
    } : null;
    const fresh = {
      id: uid(), name, servings: raw.s > 0 ? raw.s : 1,
      ingredients: (raw.i || []).map((line) => ({ rawText: line })),
      steps: raw.t || [], nutritionPerServing: nutrition,
    };
    recipes.push(fresh);
    ids.push(fresh.id);
  });
  let added = 0;
  (payload.m || []).forEach((m) => {
    const recipeId = ids[m.x];
    if (!recipeId) return;
    plan.push({
      id: uid(), recipeId, date: m.d, meal: MEALS[m.s] || 'DINNER',
      servings: m.q > 0 ? m.q : 1,
    });
    added++;
  });
  return added;
};
const oldImportTraining = (payload, training, uid) => {
  let added = 0;
  (payload.k || []).forEach((slot) => {
    const raw = (payload.w || [])[slot.x];
    if (!raw) return;
    training.push({
      id: uid(), date: slot.d, name: raw.n || 'Session',
      exercises: (raw.e || []).map((exercise) => ({
        name: exercise.n || 'Exercise',
        sets: (exercise.s || []).map((tuple) => ({
          weightLb: tuple[0] ?? null, reps: tuple[1] ?? null,
        })),
      })),
    });
    added++;
  });
  return added;
};

test('old decoder degradation: a build that never heard of rf takes the rest in unchanged', async () => {
  const payload = await unpack(FIXTURE);
  assert.equal(payload.v, 1, 'no version bump, so an old build does not refuse the link');
  assert.ok(Array.isArray(payload.rf) && payload.rf.length, 'the fixture does carry picks');

  const recipes = []; const plan = []; const training = [];
  let n = 0;
  const uid = () => 'id' + (++n);
  assert.equal(oldImportPlan(payload, recipes, plan, uid), 2, '2 meals, as main imported them');
  assert.equal(oldImportTraining(payload, training, uid), 1, '1 session, as main imported it');

  assert.deepEqual(recipes.map((r) => [r.name, r.servings]), [['Beef Chilli', 4]]);
  assert.deepEqual(recipes[0].nutritionPerServing,
    { calories: 438, proteinG: 36, carbsG: 31, fatG: 19, fiberG: 9 });
  assert.deepEqual(plan.map((p) => [p.date, p.meal, p.servings]),
    [['2026-09-28', 'DINNER', 2], ['2026-09-29', 'LUNCH', 1]]);
  assert.deepEqual(training[0].exercises.map((e) => [e.name, e.sets.length]),
    [['Back Squat', 3], ['Bulgarian Split Squat', 2]]);

  // Nothing about a pick reaches storage: the key is simply unread.
  const stored = JSON.stringify({ recipes, plan, training });
  payload.rf.forEach((id) => assert.ok(!stored.includes(id), id));
  assert.ok(!stored.includes('wendys'));
});

// MARK: - This build's decoder

// importRoadPicks lifted out of app.js as it is now and run against stand-in
// storage, so the test reads the real code rather than a copy of it.
function liftPicks() {
  const src = readFileSync('lift/app.js', 'utf8');
  const i = src.indexOf('function importRoadPicks(payload)');
  assert.ok(i >= 0);
  const code = src.slice(i, src.indexOf('/* Takes in the training half', i));
  return new Function('KEY', 'save',
    'let roadPicks = null;\n' + code
    + '\nreturn { importRoadPicks, state: () => roadPicks, set: (v) => { roadPicks = v; } };')(
    {}, () => {});
}

test('a plan\'s picks are stored whole, with the coach\'s name', async () => {
  const payload = await unpack(FIXTURE);
  const app = liftPicks();
  assert.equal(app.importRoadPicks(payload), 6);
  const stored = app.state();
  assert.deepEqual(stored.ids, payload.rf, 'the list as sent, in order');
  assert.equal(stored.from, 'Doug');
  assert.ok(stored.at > 0);
});

test('a plan carrying picks replaces what was stored; one with none leaves it alone', () => {
  const app = liftPicks();
  app.importRoadPicks({ n: 'Doug', rf: ['a', 'b'] });
  assert.deepEqual(app.state().ids, ['a', 'b']);
  app.importRoadPicks({ n: 'Doug', rf: ['c'] });
  assert.deepEqual(app.state().ids, ['c'], 'the newest send is the coach\'s current answer, whole');

  // No key: silent about picks, not a retraction. Every older Coach and every
  // "here is a recipe" send looks exactly like this.
  assert.equal(app.importRoadPicks({ n: 'Doug' }), 0);
  assert.deepEqual(app.state().ids, ['c']);
  assert.equal(app.importRoadPicks({ n: 'Doug', rf: [] }), 0);
  assert.deepEqual(app.state().ids, ['c']);
});

test('junk in rf is read leniently rather than refusing the plan', () => {
  const app = liftPicks();
  assert.equal(app.importRoadPicks({ rf: ['a', 'a', '', '  b ', 7, null, {}] }), 2);
  assert.deepEqual(app.state().ids, ['a', 'b']);
  assert.equal(app.state().from, '', 'an unnamed coach is not a missing pick');
  [undefined, null, 'a', 3, {}].forEach((junk) => {
    const fresh = liftPicks();
    assert.equal(fresh.importRoadPicks({ rf: junk }), 0, String(junk));
    assert.equal(fresh.state(), null);
  });
});

// MARK: - What the fixture asks the list to do

test('the fixture\'s picks resolve at three places, and exactly one id is unknown', async () => {
  const payload = await unpack(FIXTURE);
  const everything = DATA.chains.reduce((all, c) => all.concat(c.items), []).concat(DATA.snacks);
  const known = new Set(everything.map((i) => i.id));
  const unknown = payload.rf.filter((id) => !known.has(id));
  assert.deepEqual(unknown, ['wendys-item-withdrawn-2019'],
    'the deliberate one, so the skip rule is exercised by the fixture itself');

  const places = DATA.chains.filter((c) => c.items.some((i) => payload.rf.includes(i.id)))
    .map((c) => c.id);
  assert.deepEqual(places, ['wendys', 'chickfila']);
  assert.ok(DATA.snacks.some((s) => payload.rf.includes(s.id)), 'and a gas-station snack');
});
