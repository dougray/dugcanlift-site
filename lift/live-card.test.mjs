import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// The run lives in app.js, not in the overlay: closing the overlay hides a
// screen and ends nothing, and the card on Train is the run while it records.
// app.js is one script that talks to the page as it loads, so it cannot be
// imported. As live-session.test.mjs and plan-sides.test.mjs do, this lifts
// the outdoor section out of app.js *as it is now* and runs it against
// stand-ins for the page, the clock, storage and the GPS, so these cases read
// the code that ships rather than a copy of it.
//
// What a lesson from LIFT for iPhone and Android looks like here:
//   - a run with no fix reads 0:00 and a dash, never NaN or a negative;
//   - the card always offers Open and Finish, and Finish works with the
//     overlay closed;
//   - Finish saves exactly once;
//   - a reload brings the run back as the card, not the overlay.

const shim = { window: {} };
new Function('window', readFileSync('lift/outdoor.js', 'utf8')).call(shim, shim.window);
const O = shim.window.LiftOutdoor;

const appSource = readFileSync('lift/app.js', 'utf8');
function grab(start, end) {
  const i = appSource.indexOf(start);
  assert.ok(i >= 0, `app.js has "${start}"`);
  const j = appSource.indexOf(end, i);
  assert.ok(j > i, `app.js has "${end}" after it`);
  return appSource.slice(i, j);
}
const ELEMENT_HELPER = grab('const el = (tag, cls, text) => {', '/* A chip is a button');
const OUTDOOR_SECTION = grab('const outdoorLabel = ', '/* ---------------- send to coach');

const KEY = { outdoor: 'lift.outdoor', recording: 'lift.recording', settings: 'lift.settings' };
const T0 = 1_800_000_000_000;

// MARK: - A page just big enough to draw on

const focusLog = [];

class FakeEl {
  constructor(tag, root = false) {
    this.tag = tag;
    this.root = root;
    this.children = [];
    this.parentElement = null;
    this.classes = new Set();
    this.attrs = {};
    this.own = '';
    this.style = {};
    this.disabled = false;
    this.onclick = null;
    this.clientWidth = 300;
    this.inert = false;
    this.texts = [];
    const ctx = new Proxy({}, {
      get: (_, name) => (name === 'fillText' ? (text) => { this.texts.push(text); } : () => {}),
      set: () => true,
    });
    this.getContext = () => ctx;
    this.classList = {
      add: (...cs) => cs.forEach((c) => this.classes.add(c)),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
    };
  }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.children.forEach((c) => { c.parentElement = null; }); this.children = []; this.own = ''; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  focus() { focusLog.push(this); }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n.root; }
  get offsetParent() { return this.isConnected ? {} : null; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) {
    if (sel.startsWith('.')) return this.all().filter((n) => n.classes.has(sel.slice(1)));
    return this.all().filter((n) => n.tag === sel);
  }
  button(text) { return this.all().find((n) => n.tag === 'button' && n.textContent === text); }
}

function harness({ stored = {}, confirmAnswer = true } = {}) {
  focusLog.length = 0;
  const storage = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  const failWrites = new Set();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { if (failWrites.has(k)) throw new Error('quota'); storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
  };

  const clock = { t: T0 };
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.t); }
    static now() { return clock.t; }
  }

  const intervals = new Map();
  let nextTimer = 1;
  const setInterval = (fn) => { intervals.set(nextTimer, fn); return nextTimer++; };
  const clearInterval = (id) => { intervals.delete(id); };
  const setTimeout = () => nextTimer++;
  const clearTimeout = () => {};

  const nodes = {};
  const make = (sel, tag = 'div', root = true) => { nodes[sel] = new FakeEl(tag, root); return nodes[sel]; };
  ['#recording', '#review'].forEach((sel) => make(sel).classList.add('overlay', 'hidden'));
  ['#rec-title', '#rec-time', '#rec-distance', '#rec-pace', '#rec-status', '#review-title', '#review-date',
    '#review-stats', '#outdoor-section', 'header', '#tabs', 'main'].forEach((sel) => make(sel));
  ['#rec-finish', '#rec-discard', '#rec-close', '#review-close', '#review-delete'].forEach((sel) => make(sel, 'button'));
  ['#rec-canvas', '#review-canvas'].forEach((sel) => make(sel, 'canvas'));
  nodes['#rec-title'].classes.clear();
  const document = {
    querySelector: (sel) => {
      if (sel === '.overlay:not(.hidden)') return ['#recording', '#review'].map((s) => nodes[s]).find((n) => !n.classes.has('hidden')) || null;
      return nodes[sel] || null;
    },
    createElement: (tag) => new FakeEl(tag),
    addEventListener() {},
    activeElement: null,
    body: {},
    visibilityState: 'visible',
  };

  const watchers = [];
  const cleared = [];
  let wakeLocks = 0;
  let wakeReleased = 0;
  const navigator = {
    geolocation: {
      watchPosition: (ok, err) => { watchers.push({ ok, err }); return watchers.length; },
      clearWatch: (id) => { cleared.push(id); },
    },
    wakeLock: {
      request: async () => { wakeLocks += 1; return { addEventListener() {}, release: async () => { wakeReleased += 1; } }; },
    },
  };

  let appearance = null;
  const alerts = [];
  const confirms = [];
  const state = { confirmAnswer };
  const api = new Function('document', 'navigator', 'localStorage', 'Date', 'setInterval', 'clearInterval',
    'setTimeout', 'clearTimeout', 'alert', 'confirm', 'window', 'KEY', 'LiftOutdoor', 'LiftAppearance',
    'LiftLiveSession',
    [
      'let settings = { distanceUnit: "miles" };',
      'let trainDate = "2027-01-15";',
      'let liveSession = null;',
      'let nextId = 0;',
      'const uid = () => "run-" + (++nextId);',
      'const load = (key, fallback) => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; };',
      'const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { alert("Could not save"); } };',
      'const $ = (sel) => document.querySelector(sel);',
      'const dateKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");',
      'const chips = (container) => { container.innerHTML = ""; };',
      'let outdoor = load(KEY.outdoor, []);',
      'const render = () => renderOutdoor();',
      ELEMENT_HELPER,
      OUTDOOR_SECTION,
      'return {',
      '  startRecording, openRecording, closeRecording, finishRecording, renderOutdoor, updateRecording,',
      '  get recording() { return recording; },',
      '  get outdoor() { return outdoor; },',
      '  get trainDate() { return trainDate; },',
      '};',
    ].join('\n'))(
    document, navigator, localStorage, FakeDate, setInterval, clearInterval, setTimeout, clearTimeout,
    (m) => { alerts.push(m); }, (m) => { confirms.push(m); return state.confirmAnswer; },
    { devicePixelRatio: 1, addEventListener() {}, scrollTo() {} }, KEY, O,
    { cssColor: (c) => c, onChange: (fn) => { appearance = fn; } },
    { holdsScreenOn: () => false, screenEnabled: () => true, nextCutoff: () => null });

  const section = nodes['#outdoor-section'];
  return {
    startRecording: api.startRecording,
    openRecording: api.openRecording,
    closeRecording: api.closeRecording,
    finishRecording: api.finishRecording,
    renderOutdoor: api.renderOutdoor,
    get recording() { return api.recording; },
    get outdoor() { return api.outdoor; },
    section,
    node: (sel) => nodes[sel],
    overlayOpen: () => !nodes['#recording'].classes.has('hidden'),
    reviewOpen: () => !nodes['#review'].classes.has('hidden'),
    watchers, cleared, alerts, confirms, storage, failWrites, state,
    focused: () => focusLog[focusLog.length - 1] || null,
    activeTimers: () => intervals.size,
    wake: () => ({ requested: wakeLocks, released: wakeReleased }),
    appearanceChanged: () => appearance(),
    advance(ms) { clock.t += ms; [...intervals.values()].forEach((fn) => fn()); },
    now: () => clock.t,
    fix(meters, { accuracy = 5 } = {}) {
      // A fix `meters` north of the origin, stamped now.
      const lat = 30 + meters / 6371000 * 180 / Math.PI;
      watchers[watchers.length - 1].ok({ coords: { latitude: lat, longitude: -97, accuracy, altitude: null }, timestamp: clock.t });
    },
    cardTitle: () => section.querySelectorAll('.cardtitle').map((n) => n.textContent),
    cardStats: () => section.querySelectorAll('.stat').map((n) => n.textContent),
    sectionText: () => section.textContent,
  };
}

const RECORDING_TITLE = (label) => `Recording · ${label}`;

// MARK: - Starting, and only once

test('starting a run opens the overlay and watches the GPS once', () => {
  const h = harness();
  assert.equal(h.startRecording('RUN'), true);
  assert.equal(h.overlayOpen(), true);
  assert.equal(h.watchers.length, 1);
  assert.equal(h.recording.activityType, 'RUN');
});

test('startRecording refuses a second run', () => {
  const h = harness();
  h.startRecording('RUN');
  const first = h.recording;
  assert.equal(h.startRecording('WALK'), false);
  assert.equal(h.recording, first, 'the run that is recording is untouched');
  assert.equal(h.recording.activityType, 'RUN');
  assert.equal(h.watchers.length, 1, 'never a second tracker');
  assert.equal(h.activeTimers(), 1);
});

test('Run, Walk and Hike are disabled while a run records, and the card says which one', () => {
  const h = harness();
  h.renderOutdoor();
  const starts = () => ['Run', 'Walk', 'Hike'].map((label) => h.section.button(label));
  assert.ok(starts().every((b) => b && !b.disabled), 'all three start a run when none records');
  h.startRecording('HIKE');
  h.closeRecording();
  assert.ok(starts().every((b) => b && b.disabled), 'all three are off while one records');
  assert.deepEqual(h.cardTitle().filter((t) => t.startsWith('Recording')), [RECORDING_TITLE('Hike')]);
});

// MARK: - Closing the overlay ends nothing

test('closing the overlay keeps the watch', () => {
  const h = harness();
  h.startRecording('RUN');
  const timers = h.activeTimers();
  h.closeRecording();
  assert.equal(h.overlayOpen(), false);
  assert.deepEqual(h.cleared, [], 'clearWatch is never called by closing');
  assert.equal(h.activeTimers(), timers, 'the timer keeps running');
  assert.equal(h.wake().released, 0, 'the screen is still held on');
  assert.ok(h.recording, 'the run is still recording');
  assert.ok(h.storage.has(KEY.recording), 'and still kept in storage');
});

test('Back to LIFT is on the overlay and closes it without ending the run', () => {
  const html = readFileSync('lift/index.html', 'utf8');
  assert.match(html, /<button[^>]*id="rec-close"[^>]*>Back to LIFT<\/button>/);
  const wired = appSource.includes("$('#rec-close').onclick = closeRecording");
  assert.ok(wired, 'Back to LIFT calls closeRecording');
});

test('Back to LIFT puts focus on the card\'s Open button, not the page body', () => {
  const h = harness();
  h.renderOutdoor();
  h.startRecording('RUN');
  h.closeRecording();
  const open = h.section.button('Open');
  assert.ok(open, 'the live card is drawn');
  assert.equal(h.focused(), open, 'the re-rendered Open button, not the detached opener');
});

test('a GPS error reads Looking for GPS\u2026 with the ellipsis character', () => {
  const h = harness();
  h.startRecording('RUN');
  h.watchers[0].err({ code: 2 });
  assert.equal(h.node('#rec-status').textContent, 'Looking for GPS\u2026');
});

test('the card does not add a sentence of its own about which run records', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  assert.ok(!/is recording\. Open it/.test(h.sectionText()));
});

test('the card and the overlay reopen each other without a second watch', () => {
  const h = harness();
  h.startRecording('WALK');
  h.closeRecording();
  h.openRecording();
  assert.equal(h.overlayOpen(), true);
  h.closeRecording();
  h.openRecording();
  assert.equal(h.watchers.length, 1);
  assert.deepEqual(h.cleared, []);
});

test('switching light and dark while the overlay is closed neither stops nor reopens the run', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  h.appearanceChanged();
  assert.equal(h.overlayOpen(), false);
  assert.ok(h.recording);
  assert.deepEqual(h.cleared, []);
});

// MARK: - The card

test('the card is titled Recording · <type>, with Open and Finish, and replaces Last route', () => {
  const h = harness({ stored: { [KEY.outdoor]: [{
    id: 'old', activityType: 'RUN', startedAtEpochMs: T0 - 86400000, endedAtEpochMs: T0 - 86400000 + 600000,
    distanceMeters: 1500, elevationGainMeters: 0, route: [[30, -97, null, 0, 5], [30.01, -97, null, 60, 5]] }] } });
  h.renderOutdoor();
  assert.ok(h.cardTitle().includes('Last route'), 'before a run, Last route');
  h.startRecording('WALK');
  h.closeRecording();
  assert.ok(h.cardTitle().includes(RECORDING_TITLE('Walk')));
  assert.ok(!h.cardTitle().includes('Last route'), 'the live card stands in its place');
  assert.ok(h.section.button('Open'));
  assert.ok(h.section.button('Finish'));
});

test('under the live card: LIFT records only while this page is on screen.', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  assert.ok(h.sectionText().includes('LIFT records only while this page is on screen.'));
});

test('the card leaves an empty slot for what a later change adds', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  const [slot] = h.section.querySelectorAll('.liveextras');
  assert.ok(slot, 'liveExtras slot');
  assert.equal(slot.children.length, 0);
});

test('Open brings the overlay back', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  h.section.button('Open').onclick();
  assert.equal(h.overlayOpen(), true);
});

test('a run with no fix reads 0:00, 0.00 mi and a dash, and the route says it is waiting', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  assert.deepEqual(h.cardStats(), ['0:00', '0.00 mi', '—']);
  assert.ok(!/NaN|undefined|Infinity/.test(h.sectionText()));
  const canvas = h.section.querySelectorAll('canvas')[0];
  assert.deepEqual(canvas.texts, [O.WAITING_FOR_GPS]);
  // And a clock set back mid-run never shows a negative time.
  h.advance(-60000);
  assert.deepEqual(h.cardStats(), ['0:00', '0.00 mi', '—']);
});

test('the card and the overlay show the same numbers', () => {
  const h = harness();
  h.startRecording('RUN');
  h.fix(0);
  h.advance(60000);
  h.fix(120);
  h.advance(1000);
  h.closeRecording();
  const overlay = ['#rec-time', '#rec-distance', '#rec-pace'].map((s) => h.node(s).textContent);
  assert.deepEqual(h.cardStats(), overlay);
  const stats = O.liveStats(h.recording.route, h.recording.startedAtEpochMs, h.now());
  assert.equal(overlay[0], O.durationText(stats.elapsedMs));
  assert.equal(overlay[1], O.distanceText(stats.distanceMeters, 'miles'));
  assert.equal(overlay[2], O.paceText(stats.paceSecondsPerMeter, 'miles'));
  assert.notEqual(overlay[2], '—', 'a pace once it has gone past ten meters');
});

test('fixes that arrive while the overlay is closed move the card', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  h.fix(0);
  h.advance(10000);
  h.fix(200);
  h.advance(1000);
  const [time, distance] = h.cardStats();
  assert.equal(time, '0:11');
  assert.equal(distance, '0.12 mi');
});

// MARK: - A reload

test('a reloaded recording comes back as the card, not the overlay', () => {
  const recording = { id: 'r1', activityType: 'WALK', startedAtEpochMs: T0 - 120000,
    route: [[30, -97, null, 0, 5], [30.001, -97, null, 60, 5]] };
  const h = harness({ stored: { [KEY.recording]: recording } });
  assert.equal(h.overlayOpen(), false, 'the overlay stays closed over whatever tab the person is on');
  assert.ok(h.cardTitle().includes(RECORDING_TITLE('Walk')), 'the card is drawn');
  assert.equal(h.watchers.length, 1, 'the watch is picked up again');
  assert.equal(h.activeTimers(), 1);
  assert.equal(h.recording.route.length, 2, 'and keeps adding to the same route');
});

test('a stored recording that is not a recording is dropped', () => {
  const h = harness({ stored: { [KEY.recording]: { nonsense: true } } });
  assert.equal(h.recording, null);
  assert.equal(h.watchers.length, 0);
});

// MARK: - Finishing

function runOf(h, meters = 300) {
  h.startRecording('RUN');
  h.fix(0);
  h.advance(60000);
  h.fix(meters);
  h.advance(1000);
}

test('Finish from the card works with the overlay closed, and Last route takes its place', () => {
  const h = harness();
  runOf(h);
  h.closeRecording();
  h.section.button('Finish').onclick();
  assert.equal(h.outdoor.length, 1);
  assert.equal(h.recording, null);
  assert.ok(!h.storage.has(KEY.recording));
  assert.deepEqual(h.cleared, [1], 'the watch is let go');
  assert.equal(h.activeTimers(), 0);
  assert.ok(h.cardTitle().includes('Last route'));
  assert.ok(!h.cardTitle().some((t) => t.startsWith('Recording')));
  assert.equal(h.reviewOpen(), true, 'and the review opens for what was saved');
  assert.ok(['Run', 'Walk', 'Hike'].every((l) => !h.section.button(l).disabled), 'a new run can start');
});

test('Finish saves exactly once; a second call is silently ignored', () => {
  const h = harness();
  runOf(h);
  h.closeRecording();
  const finish = h.section.button('Finish').onclick;
  finish();
  finish();
  h.node('#rec-finish').onclick();
  assert.equal(h.outdoor.length, 1);
  assert.equal(JSON.parse(h.storage.get(KEY.outdoor)).length, 1);
  assert.deepEqual(h.confirms, []);
  assert.equal(h.alerts.length, 0);
});

test('Finish from the overlay saves the same run', () => {
  const h = harness();
  runOf(h);
  h.node('#rec-finish').onclick();
  assert.equal(h.outdoor.length, 1);
  assert.equal(h.overlayOpen(), false);
  assert.equal(h.outdoor[0].activityType, 'RUN');
  assert.ok(h.outdoor[0].distanceMeters > 290 && h.outdoor[0].distanceMeters < 310);
});

test('a run with no route asks before saving only the time, and No keeps recording', () => {
  const h = harness({ confirmAnswer: false });
  h.startRecording('RUN');
  h.closeRecording();
  h.section.button('Finish').onclick();
  assert.equal(h.confirms.length, 1);
  assert.equal(h.outdoor.length, 0);
  assert.ok(h.recording, 'still recording');
  assert.deepEqual(h.cleared, []);
  assert.ok(h.section.button('Finish') && h.section.button('Open'), 'and the card still offers both');
});

test('a save that fails keeps the run, the watch and the card', () => {
  const h = harness();
  runOf(h);
  h.closeRecording();
  h.failWrites.add(KEY.outdoor);
  h.section.button('Finish').onclick();
  assert.ok(h.recording, 'the run is not lost');
  assert.equal(h.outdoor.length, 0);
  assert.deepEqual(h.cleared, []);
  assert.equal(h.activeTimers(), 1);
  assert.ok(h.storage.has(KEY.recording));
  assert.equal(h.alerts.length, 1, 'and the person is told');
  assert.ok(/still recording/i.test(h.alerts[0]));
  h.failWrites.clear();
  h.section.button('Finish').onclick();
  assert.equal(h.outdoor.length, 1, 'Finish works once the write can');
});

// MARK: - Discarding

test('Discard ends the run only when confirmed', () => {
  const h = harness({ confirmAnswer: false });
  h.startRecording('RUN');
  h.node('#rec-discard').onclick();
  assert.ok(h.recording);
  assert.deepEqual(h.cleared, []);
  h.state.confirmAnswer = true;
  h.node('#rec-discard').onclick();
  assert.equal(h.recording, null);
  assert.equal(h.outdoor.length, 0);
  assert.deepEqual(h.cleared, [1]);
  assert.equal(h.overlayOpen(), false);
  assert.ok(!h.cardTitle().some((t) => t.startsWith('Recording')));
});

// MARK: - Nothing else stops it

test('only Finish and Discard stop the watch', () => {
  const stops = appSource.match(/\bstopWatching\(\)/g) || [];
  // The definition, Finish's call and Discard's call.
  assert.equal(stops.length, 3, 'stopWatching is called from exactly two places');
  assert.equal((appSource.match(/clearWatch\(/g) || []).length, 1);
});
