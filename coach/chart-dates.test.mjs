import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it. Run from the repo root:
// node --test coach/*.test.mjs
const shim = { window: {} };
new Function('window', readFileSync('coach/chart-dates.js', 'utf8')).call(shim, shim.window);
const C = shim.window.CoachChartDates;

// The locale is pinned only so a string can be asserted; the page passes none
// and gets the reader's.
const EN = { locale: 'en-US' };

/** Consecutive local day keys, the way app.js's lastNDays builds them. */
function days(from, n) {
  const [y, m, d] = from.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date(y, m - 1, d + i);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  });
}

/** Every label's box, from its alignment, so collisions can be checked. */
function boxes(ticks, measure) {
  return ticks.map((t) => {
    const w = measure(t.text);
    const left = t.align === 'left' ? t.x : t.align === 'right' ? t.x - w : t.x - w / 2;
    return { left, right: left + w };
  });
}

const widthOf = (text) => text.length * 6.5;

/* ---------------- reading a day key ---------------- */

test('a day key is a local calendar day, never UTC midnight', (t) => {
  // new Date("2026-10-04") is UTC midnight, the 3rd west of Greenwich. CI runs
  // in UTC, where that bug hides, so both sides of the line are tried.
  const before = process.env.TZ;
  t.after(() => { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; });
  for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
    process.env.TZ = zone;
    assert.equal(C.label('2026-10-04', EN), 'Oct 4', zone);
    const date = C.dateOf('2026-10-04');
    assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [2026, 9, 4], zone);
  }
});

test('a key that is not a real YYYY-MM-DD has no label', () => {
  for (const key of ['', '2026-10', '2026-13-01', '2026-02-31', '2026-10-04T00:00Z', 'Oct 4', null, 20261004]) {
    assert.equal(C.dateOf(key), null, JSON.stringify(key));
    assert.equal(C.label(key, EN), null, JSON.stringify(key));
  }
});

test('labels are written in the reader\'s locale', () => {
  for (const locale of ['en-GB', 'de-DE', 'ja-JP']) {
    assert.equal(C.label('2026-10-04', { locale }),
      new Date(2026, 9, 4).toLocaleDateString(locale, { month: 'short', day: 'numeric' }), locale);
  }
});

test('the year is said only when the keys cross one', () => {
  assert.equal(C.crossesYear(days('2026-10-01', 28)), false);
  assert.equal(C.crossesYear(days('2026-12-20', 28)), true);
  const ticks = C.ticks(days('2026-12-20', 28), 600, EN);
  assert.equal(ticks[0].text, 'Dec 20, 2026');
  assert.equal(ticks[ticks.length - 1].text, 'Jan 16, 2027');
  assert.equal(C.ticks(days('2026-10-04', 28), 600, EN)[0].text, 'Oct 4');
});

/* ---------------- choosing the ticks ---------------- */

test('a few dates, evenly spaced, first and last always among them', () => {
  const keys = days('2026-10-04', 28);  // the Fuel chart's last four weeks
  const ticks = C.ticks(keys, 600, EN);
  assert.equal(ticks.length, 4);
  assert.deepEqual(ticks.map((t) => t.index), [0, 9, 18, 27]);
  assert.deepEqual(ticks.map((t) => t.text), ['Oct 4', 'Oct 13', 'Oct 22', 'Oct 31']);
  assert.deepEqual(ticks.map((t) => t.align), ['left', 'center', 'center', 'right']);
});

test('each label sits under its own point', () => {
  const keys = days('2026-10-04', 28);
  const width = 540;
  for (const t of C.ticks(keys, width, EN)) {
    assert.equal(t.key, keys[t.index]);
    assert.equal(t.x, width * t.index / (keys.length - 1), 'the point drawChart puts there');
  }
});

test('irregular days are labelled as the days they are, not as a scale', () => {
  // A lift's sessions: points one step apart, dates not.
  const keys = ['2026-09-01', '2026-09-03', '2026-09-04', '2026-10-20', '2026-10-27'];
  const ticks = C.ticks(keys, 600, EN);
  assert.deepEqual(ticks.map((t) => t.key), ['2026-09-01', '2026-09-03', '2026-10-20', '2026-10-27']);
});

test('at phone width labels never collide, and never leave the card', () => {
  const measure = (t) => t.length * 7;  // a little wider than the real 11 px face
  for (const width of [280, 300, 320, 343, 360, 390, 430, 600, 900]) {
    for (const keys of [days('2026-10-04', 28), days('2026-12-20', 28), days('2026-08-09', 12), days('2026-10-01', 2)]) {
      const ticks = C.ticks(keys, width, { locale: 'en-US', measure });
      assert.ok(ticks.length >= 1, `${width}px`);
      const b = boxes(ticks, measure);
      b.forEach((box, i) => {
        assert.ok(box.left >= 0 && box.right <= width + 0.5, `${width}px: ${ticks[i].text} inside`);
        if (i) assert.ok(b[i - 1].right + 12 <= box.left, `${width}px: ${ticks[i - 1].text} / ${ticks[i].text}`);
      });
    }
  }
});

test('a narrow chart gets fewer dates rather than overlapping ones', () => {
  const keys = days('2026-12-20', 28);  // long labels, with the year
  const wide = C.ticks(keys, 900, EN);
  const narrow = C.ticks(keys, 240, EN);
  assert.equal(wide.length, 4);
  assert.ok(narrow.length < wide.length);
  assert.ok(narrow.length >= 1);
  assert.deepEqual(C.ticks(keys, 40, EN), [], 'no room for even one: none, not a smear');
});

test('two points get two dates; one or none get what they have', () => {
  const two = C.ticks(['2026-10-01', '2026-10-29'], 343, EN);
  assert.deepEqual(two.map((t) => [t.text, t.align]), [['Oct 1', 'left'], ['Oct 29', 'right']]);
  assert.deepEqual(C.ticks([], 343, EN), []);
  assert.deepEqual(C.ticks(days('2026-10-01', 5), 0, EN), []);
  assert.deepEqual(C.ticks(['2026-10-01'], 343, EN).map((t) => t.text), ['Oct 1']);
});

test('a key with no date is skipped, not printed', () => {
  const ticks = C.ticks(['2026-10-01', 'nonsense', '2026-10-15', '2026-10-29'], 600, EN);
  assert.ok(ticks.every((t) => t.text && !/Invalid/.test(t.text)));
  assert.ok(!ticks.some((t) => t.key === 'nonsense'));
});

test('the spread is even and never repeats an index', () => {
  assert.deepEqual(C.spread(28, 4), [0, 9, 18, 27]);
  assert.deepEqual(C.spread(12, 3), [0, 6, 11]);
  assert.deepEqual(C.spread(3, 4), [0, 1, 2]);
  assert.deepEqual(C.spread(1, 4), [0]);
  assert.deepEqual(C.spread(0, 4), []);
});

test('the default estimate is enough when no canvas is at hand', () => {
  // Without `measure` the ticks still come back sensibly sized for 11 px type.
  const ticks = C.ticks(days('2026-10-04', 28), 343, EN);
  assert.ok(ticks.length >= 3);
  boxes(ticks, widthOf).forEach((box, i, all) => {
    if (i) assert.ok(all[i - 1].right + 12 <= box.left);
  });
});
