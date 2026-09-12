import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

// watch-scan.js is a plain browser script, so load it into a shim the same
// way the browser would rather than restructuring it as a module.
const shim = { window: {} };
shim.window.window = shim.window;
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

test('the real fixtures still decode after the hardening', async () => {
  const code = readFileSync('lift/fixtures/watch-export-single.txt', 'utf8').trim();
  const seq = WatchScan.createSequence();
  seq.add(await WatchScan.decodePayload(code));
  assert.equal(seq.complete, true);
  assert.equal(seq.entries.length, 3);
});
