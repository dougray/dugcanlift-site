import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like sides.test.mjs does. A port of
// LIFT iOS's ProgressRulesTests and ProgressPhotoStoreTests, case for case
// where a browser has the same thing.
const shim = { window: {} };
new Function('window', readFileSync('lift/progress.js', 'utf8')).call(shim, shim.window);
const P = shim.window.LiftProgress;

const MONDAY = 1;

// MARK: - The year

test('levels are fixed steps', () => {
  assert.deepEqual([0, 1, 9, 10, 19, 20, 60].map(P.year.level), [0, 1, 1, 2, 2, 3, 3]);
});

test('the year ends with this week, and nothing after today is a rest day', () => {
  const today = '2026-10-28'; // a Wednesday
  const weeks = P.year.weeks({ [today]: 12 }, today, 53, MONDAY);
  assert.equal(weeks.length, 53);
  assert.ok(weeks.every((w) => w.length === 7));
  const last = weeks[weeks.length - 1];
  assert.equal(last[0].key, '2026-10-26'); // Monday first
  assert.equal(last[2].level, 2);
  assert.equal(last[2].isFuture, false);
  assert.equal(last[3].isFuture, true);
  assert.equal(last[3].level, 0);
});

// The reader's calendar decides the first day, as it does on the iPhone.
test('a Sunday-first week starts on the Sunday', () => {
  const weeks = P.year.weeks({}, '2026-10-28', 53, 0);
  assert.equal(weeks[weeks.length - 1][0].key, '2026-10-25');
  assert.equal(weeks[0][0].key, '2025-10-26');
});

// Day arithmetic goes through the calendar, so a fall-back Sunday is one day.
test('every day of the year appears once, across a clock change', () => {
  const keys = P.year.weeks({}, '2026-10-28', 53, MONDAY).flat().map((d) => d.key);
  assert.equal(new Set(keys).size, 53 * 7);
});

test('training days count the last 365 only', () => {
  const counts = {
    '2026-10-28': 5, '2026-10-01': 20, '2025-10-29': 3, // in
    '2025-10-28': 8,                                     // a year and a day ago
    '2026-10-02': 0,                                     // nothing done
  };
  assert.equal(P.year.trainingDays(counts, '2026-10-28'), 3);
  assert.equal(P.year.text(1), '1 training day in the last 12 months');
  assert.equal(P.year.text(3), '3 training days in the last 12 months');
});

test('a warmup is not a working set, and two sessions on a day add up', () => {
  const counts = P.year.setsByDay([
    { date: '2026-10-27', exercises: [{ sets: [{ warmup: true }, {}, { kind: 'drop' }] }] },
    { date: '2026-10-27', exercises: [{ sets: [{}] }] },
    { date: '2026-10-26', exercises: [] },
  ]);
  assert.deepEqual(counts, { '2026-10-27': 3, '2026-10-26': 0 });
});

// MARK: - Muscles

test('sets go to the logged muscle, then the library, then unplaced', () => {
  const lookup = {
    [P.muscles.key('Barbell Squat', 'Barbell')]: 'quadriceps',
    [P.muscles.key('Face Pull', null)]: 'shoulders',
  };
  const logged = [
    { name: 'Bench Press', equipment: 'Barbell', primaryMuscle: 'Chest', workingSets: 4 },
    { name: 'Barbell Squat', equipment: 'Barbell', primaryMuscle: null, workingSets: 4 },
    { name: 'Face Pull', equipment: 'Cable', primaryMuscle: null, workingSets: 3 },
    { name: 'My Own Thing', equipment: null, primaryMuscle: null, workingSets: 2 },
    { name: 'Warmup only', equipment: null, primaryMuscle: 'calves', workingSets: 0 },
  ];
  const result = P.muscles.tally(logged, lookup, ['chest', 'quadriceps', 'shoulders', 'calves']);
  assert.deepEqual(result.trained.map((t) => t.muscle), ['chest', 'quadriceps', 'shoulders']);
  assert.deepEqual(result.trained.map((t) => t.sets), [4, 4, 3]);
  assert.deepEqual(result.untrained, ['calves']);
  assert.equal(result.unplacedSets, 2);
});

// LIFT web stores the library's equipment title-cased ("Barbell") and the
// library spells it "barbell": the key is case-blind, as iOS's is.
test('the library lookup is by name and equipment, then by name alone', () => {
  const lookup = P.muscles.lookup([
    { name: 'Barbell Squat', equipment: 'barbell', muscle: 'quadriceps' },
    { name: 'Face Pull', equipment: 'cable', muscle: 'shoulders' },
    { name: 'Face Pull', equipment: 'bands', muscle: 'traps' },
    { name: 'Stretch', equipment: '', muscle: '' },
  ]);
  assert.equal(lookup[P.muscles.key('barbell squat', 'Barbell')], 'quadriceps');
  assert.equal(lookup[P.muscles.key('Face Pull', null)], 'shoulders'); // the first wins
  assert.equal(lookup[P.muscles.key('Face Pull', 'Bands')], 'traps');
  assert.deepEqual(P.muscles.all(lookup), ['quadriceps', 'shoulders', 'traps']);
});

test('this week is the calendar week holding today, warmups left out', () => {
  const workouts = [
    { date: '2026-10-25', exercises: [{ name: 'Sunday', sets: [{}] }] },
    { date: '2026-10-26', exercises: [{ name: 'Bench Press', equipment: 'Barbell', sets: [{ warmup: true }, {}, {}] }] },
    { date: '2026-10-28', exercises: [{ name: 'Curl', primaryMuscle: 'biceps', sets: [{}] }] },
  ];
  const monday = P.muscles.loggedThisWeek(workouts, '2026-10-28', MONDAY);
  assert.deepEqual(monday.map((e) => [e.name, e.workingSets, e.primaryMuscle]),
    [['Bench Press', 2, null], ['Curl', 1, 'biceps']]);
  const sunday = P.muscles.loggedThisWeek(workouts, '2026-10-28', 0);
  assert.equal(sunday.length, 3);
});

test('the unplaced line says one set or several', () => {
  assert.equal(P.muscles.unplacedText(1), "1 set is from an exercise LIFT can't place on a muscle.");
  assert.equal(P.muscles.unplacedText(2), "2 sets are from exercises LIFT can't place on a muscle.");
});

// MARK: - Body weight

// LIFT web keeps one weigh-in a day already (`weights` is keyed by day), so
// iOS's `daily` has nothing to do here; what is left is reading the map.
test('weigh-ins are read oldest first, from the start of the window, numbers only', () => {
  const pts = P.bodyWeight.points({
    '2026-10-27': 181, '2026-10-20': '182', '2026-07-01': 190, nonsense: 80, '2026-10-21': 0,
  }, '2026-07-30');
  assert.deepEqual(pts, [{ key: '2026-10-20', lb: 182 }, { key: '2026-10-27', lb: 181 }]);
});

test('the summary says the change and the goal', () => {
  const pts = [{ key: '2026-08-01', lb: 200 }, { key: '2026-10-27', lb: 192.4 }];
  const line = P.bodyWeight.summary(pts, 185, 'en-US');
  assert.equal(line, '192.4 lb · down 7.6 since Aug 1 · 7.4 from your goal of 185');
  assert.equal(P.bodyWeight.summary([], null, 'en-US'), null);
  assert.equal(P.bodyWeight.summary([pts[1]], null, 'en-US'), '192.4 lb');
  assert.equal(P.bodyWeight.summary([{ key: '2026-08-01', lb: 185 }, { key: '2026-08-02', lb: 185.02 }], 185, 'en-US'),
    '185 lb · no change since Aug 1 · at your goal');
  assert.equal(P.bodyWeight.summary([{ key: '2026-08-01', lb: 185 }, { key: '2026-10-27', lb: 192.6 }], 0, 'en-US'),
    '192.6 lb · up 7.6 since Aug 1');
});

test('a typed weight is a positive number or nothing', () => {
  assert.equal(P.bodyWeight.typed('192.4'), 192.4);
  assert.equal(P.bodyWeight.typed(' 80,5 '), 80.5);
  assert.equal(P.bodyWeight.typed(''), null);
  assert.equal(P.bodyWeight.typed('0'), null);
  assert.equal(P.bodyWeight.typed('-3'), null);
  assert.equal(P.bodyWeight.typed('1e3'), null);
  assert.equal(P.bodyWeight.typed('heavy'), null);
});

// MARK: - Photos

// A camera original is cut down to 2048 px on its long side, and a small
// picture is never enlarged.
test('a big photo is scaled down and a small one is left alone', () => {
  assert.deepEqual(P.photos.scaledSize(4032, 3024), { width: 2048, height: 1536 });
  assert.deepEqual(P.photos.scaledSize(3024, 4032), { width: 1536, height: 2048 });
  assert.deepEqual(P.photos.scaledSize(30, 40), { width: 30, height: 40 });
});

// Anything that is not one of these is left out.
test('photos are kept oldest first, and other records are ignored', () => {
  const ordered = P.photos.order([
    { id: 'b', dayKey: '2027-01-15' },
    { id: 'z', dayKey: '2026-09-21' },
    { id: 'a', dayKey: '2027-01-15' },
    { id: 'c', dayKey: 'nonsense' },
    { dayKey: '2026-01-01' },
    null,
  ]);
  assert.deepEqual(ordered.map((p) => p.id), ['z', 'a', 'b']);
  assert.equal(P.photos.day('2026-10-26', 'en-US'), 'Oct 26, 2026');
});

// The store itself, over a minimal in-memory IndexedDB: kept, listed oldest
// first, deleted.
function memoryIndexedDB() {
  const rows = new Map();
  const later = (fn) => setTimeout(fn, 0);
  return {
    open() {
      const req = {};
      later(() => {
        const db = {
          createObjectStore() {},
          close() {},
          transaction() {
            const tx = {};
            const store = {
              getAll() { const r = {}; later(() => { r.result = [...rows.values()]; r.onsuccess && r.onsuccess(); }); return r; },
              put(record) { rows.set(record.id, record); },
              delete(id) { rows.delete(id); },
            };
            tx.objectStore = () => store;
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 5);
            return tx;
          },
        };
        req.result = db;
        req.onupgradeneeded && req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}

test('photos are kept oldest first and deleted', async () => {
  const store = P.photos.store(memoryIndexedDB());
  assert.deepEqual(await store.list(), []);
  await store.add('later-bytes', '2027-01-15', 'id-2');
  await store.add('earlier-bytes', '2026-09-21', 'id-1');
  assert.deepEqual((await store.list()).map((p) => p.id), ['id-1', 'id-2']);
  await store.remove('id-1');
  assert.deepEqual((await store.list()).map((p) => p.id), ['id-2']);
});
