import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// fixtures/web-plan-per-side.txt: a plan link Coach web's own encoder wrote
// (dugcanlift-coach, coach/fixtures/, the same bytes). An each-side
// exercise (`b: 1`), an each-side exercise plus one extra left set, a named
// right set on a two-sided lift and a left-side conditioning piece, all as
// six-field tuples. Never regenerate it from a decoder here.
const FIXTURE = readFileSync('lift/fixtures/web-plan-per-side.txt', 'utf8').trim();

async function unpack(link) {
  const frag = link.slice(link.indexOf('#') + 1);
  const match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
  const bytes = Buffer.from(match[3], 'base64url');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// MARK: - Old decoder degradation

// importTraining's tuple mapping and startPrescribed's copy, as they stood on
// main before plan sides (dugcanlift-site c184639, lift/app.js), verbatim.
// Frozen here on purpose: the promise is that a LIFT build that has never
// heard of `b` or a sixth position still takes the plan in, with the right
// weights, reps and set count, as ordinary two-sided sets. Checked on
// 2026-09-22 against main itself, in node and in a browser, before anything
// here changed: it does.
const oldToTemplate = (raw) => ({
  name: raw.n || 'Session',
  exercises: (raw.e || []).map((exercise) => ({
    name: exercise.n || 'Exercise',
    equipment: exercise.q || '',
    note: exercise.c || '',
    sets: (exercise.s || []).map((tuple) => ({
      weightLb: tuple[0] ?? null,
      reps: tuple[1] ?? null,
      rpe: tuple[2] ?? null,
      durationSec: tuple[3] ?? null,
      distanceMeters: tuple[4] ?? null,
    })),
  })),
});
const oldCopy = (set) => {
  const copy = {};
  if (set.weightLb != null) copy.weightLb = set.weightLb;
  if (set.reps != null) copy.reps = set.reps;
  if (set.rpe != null) copy.rpe = set.rpe;
  if (set.durationSec != null) copy.durationSec = set.durationSec;
  if (set.distanceMeters != null) copy.distanceMeters = set.distanceMeters;
  return copy;
};

test('old decoder degradation: the per-side fixture reads as two-sided sets, weights and reps intact', async () => {
  const payload = await unpack(FIXTURE);
  assert.equal(payload.v, 1, 'no version bump, so an old build does not refuse the link');
  const template = oldToTemplate(payload.w[0]);
  const logged = template.exercises.map((e) => ({ name: e.name, sets: e.sets.map(oldCopy) }));
  assert.deepEqual(logged, [
    { name: 'Back Squat', sets: Array(3).fill({ weightLb: 225, reps: 5, rpe: 8 }) },
    { name: 'Single-Arm Dumbbell Row', sets: Array(3).fill({ weightLb: 30, reps: 8 }) },
    { name: 'Bulgarian Split Squat', sets: Array(4).fill({ weightLb: 40, reps: 8 }) },
    { name: 'Dumbbell Bench Press', sets: [{ weightLb: 60, reps: 8 }, { weightLb: 60, reps: 8 }, { weightLb: 40, reps: 10 }] },
    { name: 'Suitcase Carry', sets: [{ durationSec: 600, distanceMeters: 1600 }] },
  ]);
  // Nothing about a side leaks through: the sixth position is simply unread.
  logged.forEach((e) => e.sets.forEach((s) => assert.equal('side' in s, false)));
});
