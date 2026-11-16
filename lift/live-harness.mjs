import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A page just big enough to run app.js's outdoor section against: the real
// code, lifted out of app.js as it is now, with stand-ins for the page, the
// clock, storage, the GPS and (optionally) Web Bluetooth. Shared by
// live-card.test.mjs and heart-rate-card.test.mjs so both read the code that
// ships rather than a copy of it.

const shim = { window: {} };
new Function('window', readFileSync('lift/outdoor.js', 'utf8')).call(shim, shim.window);
export const O = shim.window.LiftOutdoor;

export const appSource = readFileSync('lift/app.js', 'utf8');
function grab(start, end) {
  const i = appSource.indexOf(start);
  assert.ok(i >= 0, `app.js has "${start}"`);
  const j = appSource.indexOf(end, i);
  assert.ok(j > i, `app.js has "${end}" after it`);
  return appSource.slice(i, j);
}
const ELEMENT_HELPER = grab('const el = (tag, cls, text) => {', '/* A chip is a button');
const OUTDOOR_SECTION = grab('const outdoorLabel = ', '/* ---------------- send to coach');

export const KEY = { outdoor: 'lift.outdoor', recording: 'lift.recording', settings: 'lift.settings' };
export const T0 = 1_800_000_000_000;

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

const heartRateSource = readFileSync('lift/heart-rate.js', 'utf8');

/**
 * `bluetooth` is a fake Web Bluetooth (see heart-rate-card.test.mjs); leave it
 * out for a browser with none, the way Firefox and Safari are.
 */
export function harness({ stored = {}, confirmAnswer = true, bluetooth = null } = {}) {
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
  // Timeouts are kept apart from intervals so activeTimers() still counts only
  // the run's own once-a-second tick.
  const timeouts = new Map();
  const setTimeout = (fn, ms) => { timeouts.set(nextTimer, { fn, ms }); return nextTimer++; };
  const clearTimeout = (id) => { timeouts.delete(id); };

  const nodes = {};
  const make = (sel, tag = 'div', root = true) => { nodes[sel] = new FakeEl(tag, root); return nodes[sel]; };
  ['#recording', '#review'].forEach((sel) => make(sel).classList.add('overlay', 'hidden'));
  ['#rec-hr', '#rec-hr-status', '#heart-rate-mode'].forEach((sel) => make(sel));
  make('#rec-hr-connect', 'button').classList.add('hidden');
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
    ...(bluetooth ? { bluetooth } : {}),
    geolocation: {
      watchPosition: (ok, err) => { watchers.push({ ok, err }); return watchers.length; },
      clearWatch: (id) => { cleared.push(id); },
    },
    wakeLock: {
      request: async () => { wakeLocks += 1; return { addEventListener() {}, release: async () => { wakeReleased += 1; } }; },
    },
  };

  const hrWindow = { navigator, setTimeout, clearTimeout };
  new Function('window', heartRateSource).call(hrWindow, hrWindow);
  const LiftHeartRate = hrWindow.LiftHeartRate;

  let appearance = null;
  const alerts = [];
  const confirms = [];
  const state = { confirmAnswer };
  const api = new Function('document', 'navigator', 'localStorage', 'Date', 'setInterval', 'clearInterval',
    'setTimeout', 'clearTimeout', 'alert', 'confirm', 'window', 'KEY', 'LiftOutdoor', 'LiftAppearance',
    'LiftLiveSession', 'LiftHeartRate',
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
      'const chips = (container, items, isOn, onPick) => {',
      '  container.innerHTML = "";',
      '  items.forEach((item) => {',
      '    const b = document.createElement("button");',
      '    b.textContent = item.label;',
      '    b.className = "chip" + (isOn(item) ? " on" : "");',
      '    b.onclick = () => onPick(item);',
      '    container.appendChild(b);',
      '  });',
      '};',
      'let outdoor = load(KEY.outdoor, []);',
      'const render = () => renderOutdoor();',
      ELEMENT_HELPER,
      OUTDOOR_SECTION,
      'return {',
      '  startRecording, openRecording, closeRecording, finishRecording, renderOutdoor, updateRecording,',
      '  renderHeartRateSettings,',
      '  get recording() { return recording; },',
      '  get outdoor() { return outdoor; },',
      '  get trainDate() { return trainDate; },',
      '};',
    ].join('\n'))(
    document, navigator, localStorage, FakeDate, setInterval, clearInterval, setTimeout, clearTimeout,
    (m) => { alerts.push(m); }, (m) => { confirms.push(m); return state.confirmAnswer; },
    { devicePixelRatio: 1, addEventListener() {}, scrollTo() {} }, KEY, O,
    { cssColor: (c) => c, onChange: (fn) => { appearance = fn; } },
    { holdsScreenOn: () => false, screenEnabled: () => true, nextCutoff: () => null },
    LiftHeartRate);

  const section = nodes['#outdoor-section'];
  return {
    startRecording: api.startRecording,
    openRecording: api.openRecording,
    closeRecording: api.closeRecording,
    finishRecording: api.finishRecording,
    renderOutdoor: api.renderOutdoor,
    renderHeartRateSettings: api.renderHeartRateSettings,
    updateRecording: api.updateRecording,
    timeouts: () => [...timeouts.values()].map((t) => t.ms),
    fireTimeout() { const [id, t] = [...timeouts.entries()][0]; timeouts.delete(id); t.fn(); },
    LiftHeartRate,
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

