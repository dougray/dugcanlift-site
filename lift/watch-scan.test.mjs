import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

// watch-scan.js is a plain browser script, so load it into a shim the same
// way the browser would rather than restructuring it as a module.
const shim = { window: {} };
shim.window.window = shim.window;
shim.window.document = { readyState: 'complete', getElementById: () => null };
new Function('window', readFileSync('lift/watch-scan.js', 'utf8')).call(shim, shim.window);
const WatchScan = shim.window.WatchScan;

const b64url = (buf) => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const encode = (payload) =>
  `1z${b64url(zlib.deflateRawSync(Buffer.from(JSON.stringify(payload))))}`;

// The `u` variant: the watch falls back to this when compression declines.
const encodeUncompressed = (payload) =>
  `1u${b64url(Buffer.from(JSON.stringify(payload)))}`;

const payload = (position, total, entryCount = 1) => ({
  v: 1,
  z: 1757500800,
  fd: [['Chicken breast, roasted', 165, 31, 3.6, 0, 0]],
  e: Array.from({ length: entryCount }, (_, i) => [0, 140, 2, 1757486400 + i * 3600]),
  p: [position, total],
});

test('decodes a code the watch encoder produced', async () => {
  const decoded = await WatchScan.decodePayload(encode(payload(1, 1)));
  assert.equal(decoded.v, 1);
  assert.equal(decoded.e.length, 1);
  assert.equal(decoded.fd[0][0], 'Chicken breast, roasted');
});

test('rejects a future format version rather than guessing', async () => {
  await assert.rejects(() => WatchScan.decodePayload(encode({ ...payload(1, 1), v: 2 })),
    /newer version/i);
});

test('rejects something that is not a payload at all', async () => {
  await assert.rejects(() => WatchScan.decodePayload('not-a-real-code'));
});

test('reads an uncompressed code, which the watch emits when DEFLATE declines', async () => {
  const decoded = await WatchScan.decodePayload(encodeUncompressed(payload(1, 1)));
  assert.equal(decoded.v, 1);
  assert.equal(decoded.e.length, 1);
});

test('rejects a code with no envelope at all', async () => {
  // A bare base64url body with no version/codec prefix is not a code.
  const bare = encode(payload(1, 1)).slice(2);
  await assert.rejects(() => WatchScan.decodePayload(bare));
});

test('rejects an envelope version this app does not know', async () => {
  await assert.rejects(() => WatchScan.decodePayload(`2z${encode(payload(1, 1)).slice(2)}`),
    /newer version/i);
});

test('a single-code sequence completes immediately', async () => {
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(encode(payload(1, 1))));
  assert.equal(seq.complete, true);
  assert.equal(seq.entries.length, 1);
});

test('a multi-code sequence stays incomplete until every code arrives', async () => {
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(encode(payload(1, 3))));
  assert.equal(seq.complete, false);
  assert.equal(seq.scanned, 1);
  assert.equal(seq.total, 3);
  seq.add(await WatchScan.decodePayload(encode(payload(2, 3))));
  seq.add(await WatchScan.decodePayload(encode(payload(3, 3))));
  assert.equal(seq.complete, true);
  assert.equal(seq.entries.length, 3);
});

test('codes may be scanned out of order', async () => {
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(encode(payload(3, 3))));
  seq.add(await WatchScan.decodePayload(encode(payload(1, 3))));
  seq.add(await WatchScan.decodePayload(encode(payload(2, 3))));
  assert.equal(seq.complete, true);
});

test('rescanning the same code does not double-count it', async () => {
  const seq = WatchScan.createSequence();
  const one = await WatchScan.decodePayload(encode(payload(1, 3)));
  seq.add(one);
  seq.add(one);
  assert.equal(seq.scanned, 1);
  assert.equal(seq.complete, false);
});

test('codes from a different export are rejected', async () => {
  // Mixing two exports would silently interleave two different logs.
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(encode(payload(1, 3))));
  const other = await WatchScan.decodePayload(encode({ ...payload(2, 3), z: 1757600000 }));
  assert.throws(() => seq.add(other), /different export/i);
});

test('entries come back in scan-independent order', async () => {
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(encode(payload(2, 2, 2))));
  seq.add(await WatchScan.decodePayload(encode(payload(1, 2, 2))));
  const times = seq.entries.map((entry) => entry.loggedAt);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

/* ---- hardening: gaps found reviewing the reference implementation ---- */

test('a stray position cannot fake a complete set', async () => {
  // `size >= total` was satisfiable by an out-of-range position while a real
  // code was still missing, and importing that set drops a whole code's
  // worth of the log.
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(encode(payload(1, 3))));
  seq.add(await WatchScan.decodePayload(encode(payload(2, 3))));
  seq.add(await WatchScan.decodePayload(encode(payload(99, 3))));
  assert.equal(seq.complete, false);
});

test('two different codes claiming one position are rejected', async () => {
  // Last-write-wins would swap a code the user did scan for one they did
  // not, while the count still called the set complete.
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(encode(payload(1, 2))));
  const other = { ...payload(1, 2), fd: [['Something else entirely', 1, 2, 3, 4, 5]] };
  const decoded = await WatchScan.decodePayload(encode(other));
  assert.throws(() => seq.add(decoded), /both say they are number 1/);
});

test('rescanning byte-identical content is still idempotent', async () => {
  const seq = WatchScan.createSequence();
  const one = await WatchScan.decodePayload(encode(payload(1, 2)));
  seq.add(one);
  seq.add(one);
  seq.add(await WatchScan.decodePayload(encode(payload(1, 2))));
  assert.equal(seq.scanned, 1);
});

test('an entry pointing outside the food dictionary is rejected, not dropped', async () => {
  // Previously this decoded fine and the entries getter silently skipped the
  // row, leaving a "complete" sequence with a meal missing and no signal.
  const broken = { ...payload(1, 1), e: [[7, 140, 2, 1757486400]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('a negative food index is rejected too', async () => {
  const broken = { ...payload(1, 1), e: [[-1, 140, 2, 1757486400]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

/* ---- Fix 4: only tuple[0] used to be checked. A code carrying
 * [[0, 'lots', 0, 'whenever']] imported fine and created a record with
 * date "NaN-NaN-NaN" and servings null -- unreachable by date navigation,
 * undeletable, but still riding along in every backup and coach export. ---- */

test('non-numeric grams are rejected, not coerced into NaN', async () => {
  const broken = { ...payload(1, 1), e: [[0, 'lots', 0, 1757486400]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('negative grams are rejected', async () => {
  const broken = { ...payload(1, 1), e: [[0, -5, 0, 1757486400]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('an out-of-range meal index is rejected, not refiled to SNACK', async () => {
  const broken = { ...payload(1, 1), e: [[0, 140, 4, 1757486400]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('a negative meal index is rejected', async () => {
  const broken = { ...payload(1, 1), e: [[0, 140, -1, 1757486400]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('a non-numeric loggedAt is rejected, not turned into an unreachable date', async () => {
  const broken = { ...payload(1, 1), e: [[0, 140, 0, 'whenever']] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('an fd row missing a macro field is rejected', async () => {
  const broken = { ...payload(1, 1), fd: [['Chicken breast, roasted', 165, 31, 3.6, 0]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('an fd row with a non-numeric macro is rejected', async () => {
  const broken = {
    ...payload(1, 1),
    fd: [['Chicken breast, roasted', 165, 31, 3.6, 0, 'none']],
  };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('an fd row with a non-string name is rejected', async () => {
  const broken = { ...payload(1, 1), fd: [[42, 165, 31, 3.6, 0, 0]] };
  await assert.rejects(() => WatchScan.decodePayload(encode(broken)), /damaged/i);
});

test('the real fixtures still decode after the hardening', async () => {
  const code = readFileSync('lift/fixtures/watch-export-single.txt', 'utf8').trim();
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(code));
  assert.equal(seq.complete, true);
  assert.equal(seq.entries.length, 3);
});

const deps = {
  dateKey: (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
};

const scanned = (over = {}) => ({
  name: 'Chicken breast, roasted',
  per100g: { calories: 165, proteinG: 31, fatG: 3.6, carbsG: 0, fiberG: 0 },
  grams: 200,
  meal: 'DINNER',
  loggedAt: 1757486400,
  z: 1757500800,
  indexInCode: 0,
  ...over,
});

// The store's own accounting, copied from app.js:131. Every assertion about
// what a user actually sees must go through this, not the raw record fields.
const mul = (e, field) => Math.round((e[field] || 0) * (e.servings || 1));

test('the portion a user sees is the true portion, not double-scaled', () => {
  // 200 g of a 165 kcal/100 g food is 330 kcal. This is THE test for this
  // task: asserting record.calories === 330 directly would pass while the
  // Food tab showed 660, because the store multiplies by servings again.
  const [record] = WatchScan.toFoodRecords([scanned()], deps);
  assert.equal(mul(record, 'calories'), 330);
  assert.equal(mul(record, 'proteinG'), 62);
});

test('a sub-100g portion is not halved', () => {
  // The same bug runs the other way under 100 g, which is why it survives
  // a single spot-check. 50 g of 297 kcal/100 g is 149 kcal, never 75.
  const [record] = WatchScan.toFoodRecords([scanned({
    grams: 50,
    per100g: { calories: 297, proteinG: 10, fatG: 5, carbsG: 30, fiberG: 2 },
  })], deps);
  assert.equal(mul(record, 'calories'), 149);
});

test('stored macros are per serving, matching logPlannedMeal', () => {
  const [record] = WatchScan.toFoodRecords([scanned()], deps);
  assert.equal(record.calories, 165);        // per 100 g, unscaled
  assert.equal(record.servings, 2);
});

test('a record matches the shape the food store already uses', () => {
  const [record] = WatchScan.toFoodRecords([scanned()], deps);
  for (const key of ['id', 'name', 'servings', 'calories', 'proteinG', 'fatG',
                     'carbsG', 'fiberG', 'date', 'loggedAt', 'meal']) {
    assert.ok(key in record, `missing ${key}`);
  }
  assert.equal(record.name, 'Chicken breast, roasted');
  assert.equal(record.meal, 'DINNER');
});

test('servings records the gram amount, matching gram-based logging', () => {
  const [record] = WatchScan.toFoodRecords([scanned({ grams: 140 })], deps);
  assert.equal(record.servings, 1.4);
});

test('the date comes from when it was logged, not when it was scanned', () => {
  const [record] = WatchScan.toFoodRecords([scanned()], deps);
  assert.equal(record.date, deps.dateKey(new Date(1757486400 * 1000)));
});

test('loggedAt is milliseconds, as the store stores it', () => {
  const [record] = WatchScan.toFoodRecords([scanned()], deps);
  assert.equal(record.loggedAt, 1757486400 * 1000);
});

test('an awkward gram amount still totals correctly through the store', () => {
  const [record] = WatchScan.toFoodRecords([scanned({ grams: 37 })], deps);
  assert.equal(mul(record, 'calories'), Math.round(165 * 0.37));
});

test('every scanned entry becomes exactly one record', () => {
  const records = WatchScan.toFoodRecords([
    scanned({ indexInCode: 0 }), scanned({ indexInCode: 1 }), scanned({ indexInCode: 2 }),
  ], deps);
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map((r) => r.id)).size, 3);
});

/* ---- Fix 2: deterministic ids, so a re-import of the same code can be
 * told apart from a new one and skipped rather than doubling the day. ---- */

test('the same scanned entry always produces the same id', () => {
  // The watch only clears its on-screen log on a manual tap, so an
  // accidental re-scan of the same code is expected, not exotic. Importing
  // it again must be detectable by app.js's addFoodEntries against the
  // live store, which means the id cannot be random.
  const [first] = WatchScan.toFoodRecords([scanned()], deps);
  const [second] = WatchScan.toFoodRecords([scanned()], deps);
  assert.equal(first.id, second.id);
});

test('two entries at different positions in the same code get different ids', () => {
  const [a, b] = WatchScan.toFoodRecords(
    [scanned({ indexInCode: 0 }), scanned({ indexInCode: 1 })], deps,
  );
  assert.notEqual(a.id, b.id);
});

test('the same position in two different exports gets different ids', () => {
  const [a] = WatchScan.toFoodRecords([scanned({ z: 1757500800 })], deps);
  const [b] = WatchScan.toFoodRecords([scanned({ z: 1757600000 })], deps);
  assert.notEqual(a.id, b.id);
});

test('importing a real fixture twice yields identical ids both times', async () => {
  // End-to-end through decodePayload/createSequence/toFoodRecords, not just
  // the pure id formula, since that is the path a real re-scan takes.
  const code = readFileSync('lift/fixtures/watch-export-single.txt', 'utf8').trim();
  const once = async () => {
    const seq = WatchScan.createSequence();
    seq.add(await WatchScan.decodePayload(code));
    return WatchScan.toFoodRecords(seq.entries, deps).map((r) => r.id);
  };
  const [firstRun, secondRun] = await Promise.all([once(), once()]);
  assert.deepEqual(firstRun, secondRun);
  assert.equal(new Set(firstRun).size, firstRun.length); // still distinct within one import
});

test('stored macros are whole numbers, like every other write path', () => {
  // The Food tab reads through mul() and would round anyway, but the
  // itemised coach export reads these fields raw -- an unrounded value would
  // show a coach "31.02 g protein" beside whole numbers everywhere else.
  const [record] = WatchScan.toFoodRecords([scanned({
    per100g: { calories: 165, proteinG: 31.02, fatG: 3.57, carbsG: 0, fiberG: 0 },
  })], deps);
  for (const field of ['calories', 'proteinG', 'fatG', 'carbsG', 'fiberG']) {
    assert.equal(record[field], Math.round(record[field]), `${field} is not whole`);
  }
});

/* ---- interoperability: real bytes from the watch's own encoder ---- */

test('decodes a code the real watch encoder produced', async () => {
  const code = readFileSync('lift/fixtures/watch-export-single.txt', 'utf8').trim();
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(code));
  assert.equal(seq.complete, true);
  assert.equal(seq.entries.length, 3);
  assert.equal(seq.entries[0].name,
    'Chicken, broilers or fryers, breast, meat only, cooked, roasted');
  assert.equal(seq.entries[0].meal, 'BREAKFAST');
  // Per-100g macros, straight off the wire, unscaled.
  assert.equal(seq.entries[0].per100g.calories, 165);
  assert.equal(seq.entries[0].per100g.proteinG, 31.02);
  // 50 g of it, so the store must end up showing 83 kcal, not 165 and not 41.
  assert.equal(seq.entries[0].grams, 50);
  const [record] = WatchScan.toFoodRecords([seq.entries[0]], deps);
  assert.equal(mul(record, 'calories'), Math.round(165 * 0.5));
});

test('reassembles a real multi-code sequence', async () => {
  const codes = readFileSync('lift/fixtures/watch-export-sequence.txt', 'utf8')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const seq = WatchScan.createSequence();
  for (const code of codes) seq.add(await WatchScan.decodePayload(code));
  assert.equal(codes.length, 2);      // 796 and 702 bytes
  assert.equal(seq.complete, true);
  assert.equal(seq.entries.length, 120);
  // Reassembly must not reorder: the watch emits oldest first.
  const times = seq.entries.map((e) => e.loggedAt);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('real codes stay inside the scannable size ceiling', () => {
  const all = [
    ...readFileSync('lift/fixtures/watch-export-single.txt', 'utf8').split('\n'),
    ...readFileSync('lift/fixtures/watch-export-sequence.txt', 'utf8').split('\n'),
  ].map((s) => s.trim()).filter(Boolean);
  for (const code of all) {
    assert.ok(code.length <= 800, `code is ${code.length} bytes`);
    assert.match(code, /^1[zu][A-Za-z0-9_-]+$/);
  }
});
