/* LIFT Coach — collates the logs clients send from LIFT.
 *
 * There is no server and no account. A client's log arrives inside the
 * fragment of a link (the part after '#', which browsers never transmit),
 * gets decoded here, and lives in localStorage on this device only.
 *
 * The wire format is documented in SHARE-FORMAT.md and is shared with the
 * Android, iOS and web versions of LIFT. Anything changed here has to change
 * in all four places, which is why the decoder below is deliberately dull.
 */

/* ---------------- storage ---------------- */

const KEY = { clients: 'coach.clients', settings: 'coach.settings' };
// Declared here, beside KEY, rather than down in their own sections: the
// backup and the Connect tab's storage note both need every key, and both
// can run before those sections are evaluated.
const COOK_KEY = { recipes: 'coach.recipes', plans: 'coach.plans',
                   roadPicks: 'coach.roadPicks' };
const TRAIN_KEY = { workouts: 'coach.workouts', sessions: 'coach.sessions' };
// What was actually sent, per client, so a plan is still there after it has
// left. Beside the others for the same reason: the backup and the Connect
// tab's storage note both need every key. See plan-log.js.
const PLAN_KEY = { sentPlans: 'coach.sentPlans' };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('could not read', key, e);
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    alert('Could not save — this device is out of storage for the app. '
        + 'Removing a client you no longer coach will free some.');
    return false;
  }
}

/* Every client the coach has ever received a link from, keyed by the client
 * id that travels in the payload. Days are stored expanded rather than in the
 * compact wire shape: the compact shape exists to survive an email, and past
 * that point it only makes every read harder. */
let clients = load(KEY.clients, []);
let settings = load(KEY.settings, { name: '', email: '', unit: null });

/* One row per send: the plan payload as JSON exactly as encoded, with the
 * canonical hash of it. Coach built the link fresh on every render and handed
 * it straight to the clipboard, so editing "Lower A" after sending left the
 * store no longer saying what the client got -- and the client page could
 * never put what was booked beside what came back. See plan-log.js.
 *
 * Declared up here with the roster rather than down in COOK beside the plans
 * it records, because the client page reads it and render() can run at module
 * scope before the COOK section is evaluated. */
let sentPlans = load(PLAN_KEY.sentPlans, []);

const persist = () => save(KEY.clients, clients);

/* ---------------- link codec ---------------- */

const b64urlToBytes = (s) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser is too old to open LIFT links. Safari 16.4, '
                  + 'Chrome 103 or anything newer will work.');
  }
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/* Pulls the payload out of anything that might hold it — a bare fragment, a
 * whole URL the coach pasted, or a URL a mail client has helpfully wrapped in
 * angle brackets. */
function extractFragment(text) {
  const trimmed = String(text || '').trim().replace(/^<|>$/g, '');
  const hash = trimmed.indexOf('#');
  const frag = hash >= 0 ? trimmed.slice(hash + 1) : trimmed;
  const match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)/);
  if (!match) return null;
  return { version: Number(match[1]), codec: match[2], data: match[3] };
}

async function decodeLink(text) {
  const parsed = extractFragment(text);
  if (!parsed) throw new Error("That doesn't look like a LIFT link.");
  if (parsed.version !== 1) {
    throw new Error(`This link was made by a newer version of LIFT (format ${parsed.version}). `
                  + 'Reload this page to update.');
  }
  const bytes = b64urlToBytes(parsed.data);
  const json = parsed.codec === 'z'
    ? await inflate(bytes)
    : new TextDecoder().decode(bytes);
  const payload = JSON.parse(json);
  if (!payload || !payload.c || !payload.c.i) {
    throw new Error('That link is missing the part that says who it is from.');
  }
  return payload;
}

/* ---------------- dates ---------------- */

const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayKey = () => dateKey(new Date());
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };

function shiftKey(key, days) {
  const dt = parseKey(key);
  dt.setDate(dt.getDate() + days);
  return dateKey(dt);
}

const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);

const shortDate = (key) => parseKey(key)
  .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function agoLabel(key) {
  const n = daysBetween(key, todayKey());
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  return shortDate(key);
}

const lastNDays = (n, endKey = todayKey()) =>
  Array.from({ length: n }, (_, i) => shiftKey(endKey, -(n - 1 - i)));

/* ---------------- units and formatting ---------------- */

const LB_PER_KG = 2.2046226218;
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/* Payloads are always pounds on the wire. The client's own preference rides
 * along so a kg lifter's coach sees the numbers that lifter would recognise,
 * but the coach can pin one unit for the whole roster. */
const unitFor = (client) => settings.unit || client.unit || 'lb';
const fromLb = (lb, unit) => (unit === 'kg' ? lb / LB_PER_KG : lb);

const num = (n) => Math.round(n).toLocaleString();
const weightText = (lb, unit) => `${num(fromLb(lb, unit))} ${unit}`;
const oneDp = (n) => (Math.round(n * 10) / 10).toFixed(1);

function deltaText(value, unit, invertColour = false) {
  if (value === null || value === undefined) return null;
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded) < 0.05) return { text: 'level', cls: '' };
  const up = rounded > 0;
  return {
    text: `${up ? '+' : '−'}${oneDp(Math.abs(rounded))} ${unit}`,
    cls: (up !== invertColour) ? 'up' : 'down',
  };
}

/* ---------------- payload → client record ---------------- */

// expandSet and expandDay live in share-import.js, so node tests them.
const expandDay = (raw, dictExercises, dictFoods) =>
  CoachShareImport.expandDay(raw, dictExercises, dictFoods, MEALS);

function expand(payload) {
  const c = payload.c;
  const dictExercises = payload.x || [];
  const dictFoods = payload.fd || [];
  const days = {};
  (payload.d || []).forEach((raw) => {
    days[shiftKey(payload.r, raw.k || 0)] = expandDay(raw, dictExercises, dictFoods);
  });

  return {
    id: c.i,
    name: c.n || 'Unnamed client',
    sex: c.s || null,
    age: c.a ?? null,
    heightIn: c.h ?? null,
    unit: c.u === 'kg' ? 'kg' : 'lb',
    platform: c.p || null,
    goal: payload.g ? {
      calories: payload.g.c, proteinG: payload.g.p, fatG: payload.g.f,
      carbsG: payload.g.cb, fiberG: payload.g.fb,
    } : null,
    exportedAt: (payload.z || 0) * 1000,
    coverage: [payload.r, payload.t || payload.r],
    days,
    // All-time bests and the newest route, per SHARE-FORMAT.md "Outdoor". The
    // route is present only when the client chose to send it.
    outdoorBests: CoachRoute.readBests(payload.ob),
    lastRoute: CoachRoute.readLastRoute(payload.lr),
  };
}

/* Folds a freshly decoded payload into the roster.
 *
 * Whole days are replaced, never merged entry by entry: the window the client
 * sent is the truth for the days inside it, so something they deleted at home
 * disappears here too. Days before the window are kept, which is how a coach
 * accumulates a year of history from a rolling 8-week send. */
function absorb(incoming) {
  const existing = clients.find((x) => x.id === incoming.id);
  if (!existing) {
    clients.push({ ...incoming, receivedAt: Date.now() });
    persist();
    return { added: true, daysChanged: Object.keys(incoming.days).length };
  }

  let daysChanged = 0;
  Object.entries(incoming.days).forEach(([key, day]) => {
    if (JSON.stringify(existing.days[key]) !== JSON.stringify(day)) daysChanged++;
    existing.days[key] = day;
  });

  // Profile and goal come from whichever send is newer — a client who changed
  // their goal last week shouldn't have an old link undo it.
  if (!existing.exportedAt || incoming.exportedAt >= existing.exportedAt) {
    Object.assign(existing, {
      name: incoming.name, sex: incoming.sex, age: incoming.age,
      heightIn: incoming.heightIn, unit: incoming.unit, platform: incoming.platform,
      goal: incoming.goal, exportedAt: incoming.exportedAt,
      // Absent clears: a client who stops sending their route expects it gone.
      outdoorBests: incoming.outdoorBests, lastRoute: incoming.lastRoute,
    });
  }
  existing.receivedAt = Date.now();
  existing.coverage = [
    [existing.coverage?.[0], incoming.coverage[0]].filter(Boolean).sort()[0],
    [existing.coverage?.[1], incoming.coverage[1]].filter(Boolean).sort().pop(),
  ];
  persist();
  return { added: false, daysChanged };
}

/* ---------------- derived numbers ---------------- */

const dayKeys = (client) => Object.keys(client.days).sort();

const hasTraining = (day) => !!(day && day.exercises && day.exercises.length);
const hasFood = (day) => !!(day && day.foodTotals && day.foodTotals.calories > 0);

const setVolume = (s) =>
  (s.warmup || !s.weightLb || !s.reps) ? 0 : s.weightLb * s.reps;

const dayVolume = (day) => (day.exercises || [])
  .reduce((t, ex) => t + ex.sets.reduce((u, s) => u + setVolume(s), 0), 0);

const daySets = (day) => (day.exercises || [])
  .reduce((t, ex) => t + ex.sets.filter((s) => !s.warmup).length, 0);

/** Epley. Only means anything in the low rep ranges, so cap it. */
function estimatedOneRepMax(set) {
  if (set.warmup || !set.weightLb || !set.reps || set.reps > 12) return null;
  return set.weightLb * (1 + set.reps / 30);
}

function lastLogged(client) {
  const keys = dayKeys(client).filter((k) => {
    const day = client.days[k];
    return hasTraining(day) || hasFood(day);
  });
  return keys.length ? keys[keys.length - 1] : null;
}

/** Everything the roster and the client header need, over a span of days. */
function windowStats(client, span, endKey = todayKey()) {
  const keys = lastNDays(span, endKey);
  const goal = client.goal;
  let sessions = 0, sets = 0, volume = 0;
  let kcal = 0, protein = 0, foodDays = 0, proteinHits = 0, steps = 0, stepDays = 0;

  keys.forEach((key) => {
    const day = client.days[key];
    if (!day) return;
    if (hasTraining(day)) { sessions++; sets += daySets(day); volume += dayVolume(day); }
    if (hasFood(day)) {
      foodDays++;
      kcal += day.foodTotals.calories;
      protein += day.foodTotals.proteinG;
      // "Hit" is 95% of target, not 100% — nobody lands exactly on it, and a
      // threshold that nobody can meet stops being informative.
      if (goal && goal.proteinG && day.foodTotals.proteinG >= goal.proteinG * 0.95) proteinHits++;
    }
    if (day.steps != null) { steps += day.steps; stepDays++; }
  });

  return {
    span, sessions, sets, volume, foodDays,
    kcalAvg: foodDays ? Math.round(kcal / foodDays) : null,
    proteinAvg: foodDays ? Math.round(protein / foodDays) : null,
    proteinHitRate: foodDays ? proteinHits / foodDays : null,
    stepsAvg: stepDays ? Math.round(steps / stepDays) : null,
  };
}

/** Weekly buckets, newest last, aligned to the end date rather than to Monday
 *  so "this week" always means the last seven days the coach is looking at. */
function weeklyBuckets(client, weeks, endKey = todayKey()) {
  return Array.from({ length: weeks }, (_, i) => {
    const end = shiftKey(endKey, -7 * (weeks - 1 - i));
    const stats = windowStats(client, 7, end);
    return { end, start: shiftKey(end, -6), ...stats };
  });
}

function bodyweightSeries(client) {
  return dayKeys(client)
    .filter((k) => client.days[k].bodyweightLb != null)
    .map((k) => ({ key: k, lb: client.days[k].bodyweightLb }));
}

/** Every distinct lift the client has trained, most-recently-trained first. */
function exerciseIndex(client) {
  const map = new Map();
  dayKeys(client).forEach((key) => {
    (client.days[key].exercises || []).forEach((ex) => {
      // Name and equipment, not side: a lift's two limbs share one chip so
      // that they share one card, which is what makes an imbalance figure
      // possible at all. Side joins the key one level down, on the series
      // inside that card (CoachSides.splitSessions).
      const id = `${ex.name}|${ex.equipment}`.toLowerCase();
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: ex.name,
          equipment: ex.equipment,
          label: ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name,
          days: [],
        });
      }
      map.get(id).days.push({ key, ex });
    });
  });
  return [...map.values()].sort((a, b) =>
    b.days[b.days.length - 1].key.localeCompare(a.days[a.days.length - 1].key));
}

/* ---------------- tiny DOM helpers ---------------- */

const $ = (sel) => document.querySelector(sel);

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function statline(parent, label, value) {
  const row = el('div', 'statline');
  row.appendChild(el('span', null, label));
  row.appendChild(el('span', null, value));
  parent.appendChild(row);
}

function table(parent, headers, rows) {
  const t = el('table', 'grid');
  const head = el('tr');
  headers.forEach((h) => head.appendChild(el('th', null, h)));
  t.appendChild(head);
  rows.forEach((cells) => {
    const tr = el('tr');
    cells.forEach((cell) => {
      const value = (cell && typeof cell === 'object') ? cell.text : cell;
      const td = el('td', (cell && cell.cls) || null, value === null || value === undefined ? '—' : String(value));
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  parent.appendChild(t);
  return t;
}

/* ---------------- charts ---------------- */

const CHART = {
  calories: 'var(--accent)', protein: 'var(--accent-2)', goal: 'var(--muted)',
  volume: 'var(--accent)', sets: '#5b8db8', weight: 'var(--accent)', e1rm: '#5b8db8',
};

function drawChart(canvas, series, labels) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  // Scaling for the display below overwrites the height attribute, so the
  // height the markup asked for is remembered the first time through. Reading
  // the attribute every time would multiply it by the pixel ratio on every
  // redraw, and the chart would march off the bottom of its own canvas.
  if (!canvas.dataset.h) canvas.dataset.h = canvas.getAttribute('height') || '150';
  const h = parseInt(canvas.dataset.h, 10);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  const max = all.length ? Math.max(...all) : 0;
  if (!max || labels.length < 2) {
    ctx.fillStyle = LiftAppearance.cssColor('var(--muted)');
    ctx.font = '14px -apple-system, sans-serif';
    ctx.fillText('Not enough logged yet to chart.', 0, 20);
    return;
  }

  // Weight charts spend their whole life in a narrow band near the top, so
  // they get a floor that isn't zero. Volume and calories start at zero
  // because "half as much" has to look like half as much.
  const floor = series.some((s) => s.zoom) ? Math.min(...all) * 0.97 : 0;
  const range = Math.max(max - floor, 1e-6);

  const pad = 16;
  const plotH = h - pad;
  const stepX = w / (labels.length - 1);

  ctx.strokeStyle = LiftAppearance.cssColor('var(--rule)');
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach((f) => {
    const y = plotH - plotH * f + pad / 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  series.forEach((s) => {
    ctx.strokeStyle = LiftAppearance.cssColor(s.color);
    ctx.fillStyle = LiftAppearance.cssColor(s.color);
    ctx.lineWidth = s.dashed ? 1.5 : 2.5;
    ctx.setLineDash(s.dashed ? [4, 4] : []);
    ctx.lineCap = 'round';
    let prev = null;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { prev = null; return; }  // gap, not zero
      const x = stepX * i;
      const y = plotH - ((v - floor) / range) * plotH + pad / 2;
      if (prev) {
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      if (!s.dashed) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      prev = [x, y];
    });
  });
  ctx.setLineDash([]);

  ctx.fillStyle = LiftAppearance.cssColor('var(--muted)');
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillText(num(max), 0, 11);
}

function legend(node, series) {
  node.innerHTML = '';
  series.forEach((s) => {
    const span = el('span');
    const swatch = el('i');
    swatch.style.background = s.color;
    span.appendChild(swatch);
    span.appendChild(document.createTextNode(s.label));
    node.appendChild(span);
  });
}

/* ---------------- tabs ---------------- */

let currentTab = 'roster';
let openClientId = null;

/* From 1024px up, Roster and Client are one list/detail view: the roster in a
 * left column, the open client beside it. style.css does the layout off the
 * same width; this only decides what to render. It is a width, never a device
 * check -- an iPad in split view and a narrow desktop window are both phones
 * here, and a folding phone opened flat is not. */
const splitView = window.matchMedia('(min-width: 1024px)');

function showTab(name) {
  currentTab = name;
  // style.css reads this to show the roster beside a client, and the client
  // pane beside the roster, when the split view is on.
  document.body.dataset.tab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  $('#' + name).classList.add('active');
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  window.scrollTo(0, 0);
  render();
}

function openClient(id) {
  openClientId = id;
  $('#tab-client').disabled = false;
  showTab('client');
}

/* ---------------- roster ---------------- */

const STALE_DAYS = 7;

function renderRoster() {
  const empty = $('#roster-empty');
  const list = $('#roster-list');
  const alerts = $('#roster-alerts');
  list.innerHTML = '';
  alerts.innerHTML = '';

  empty.classList.toggle('hidden', clients.length > 0);
  $('#roster-tools').classList.toggle('hidden', clients.length === 0);
  if (!clients.length) return;

  const rows = clients.map((client) => {
    const last = lastLogged(client);
    const week = windowStats(client, 7);
    const prior = windowStats(client, 7, shiftKey(todayKey(), -7));
    const silentFor = last ? daysBetween(last, todayKey()) : 999;
    return { client, last, week, prior, silentFor };
  });

  // Anyone who has gone quiet floats to the top — that is the whole reason a
  // coach opens this on a Monday morning.
  rows.sort((a, b) => b.silentFor - a.silentFor || a.client.name.localeCompare(b.client.name));

  const quiet = rows.filter((r) => r.silentFor >= STALE_DAYS);
  if (quiet.length) {
    const names = quiet.map((r) => r.client.name.split(' ')[0]).join(', ');
    alerts.appendChild(el('div', 'alert',
      `${quiet.length === 1 ? 'One client has' : `${quiet.length} clients have`} `
      + `logged nothing in a week: ${names}.`));
  }

  rows.forEach(({ client, last, week, prior, silentFor }) => {
    const unit = unitFor(client);
    const row = el('button', 'client-row' + (silentFor >= STALE_DAYS ? ' stale' : ''));
    row.appendChild(el('span', 'name', client.name));
    row.appendChild(el('span', 'when', last ? `logged ${agoLabel(last)}` : 'nothing logged'));

    const metrics = el('div', 'metrics');
    const metric = (label, value, extraClass) => {
      const span = el('span');
      span.appendChild(el('b', extraClass, value));
      span.appendChild(document.createTextNode(' ' + label));
      metrics.appendChild(span);
    };

    metric('sessions', String(week.sessions));
    metric('sets', String(week.sets));

    // The week-on-week change only appears when there is a previous week to
    // compare against. "−100%" against a rest week is noise dressed as a signal.
    if (week.volume) {
      const change = prior.volume ? ((week.volume - prior.volume) / prior.volume) * 100 : null;
      const arrow = change === null ? ''
        : ` (${change >= 0 ? '+' : '−'}${Math.abs(Math.round(change))}%)`;
      metric('volume' + arrow, weightText(week.volume, unit));
    }

    if (week.kcalAvg != null) {
      const goal = client.goal ? client.goal.calories : null;
      const off = goal ? Math.round(((week.kcalAvg - goal) / goal) * 100) : null;
      metric('kcal/day' + (off === null ? '' : ` (${off >= 0 ? '+' : '−'}${Math.abs(off)}%)`),
        num(week.kcalAvg));
    }

    if (week.proteinHitRate != null) {
      metric('protein days on target',
        `${Math.round(week.proteinHitRate * 100)}%`,
        week.proteinHitRate < 0.6 ? 'under' : null);
    }

    row.appendChild(metrics);
    if (client.id === openClientId) row.classList.add('selected');
    row.onclick = () => openClient(client.id);
    list.appendChild(row);
  });
}

/* ---------------- one client ---------------- */

let openLiftId = null;

function currentClient() {
  return clients.find((c) => c.id === openClientId) || null;
}

function renderClient() {
  const client = currentClient();
  if (!client) {
    // Beside the roster there is nowhere to go back to: say so in place.
    if (splitView.matches) {
      $('#client-empty').classList.remove('hidden');
      $('#client-body').classList.add('hidden');
      return;
    }
    showTab('roster');
    return;
  }
  $('#client-empty').classList.add('hidden');
  $('#client-body').classList.remove('hidden');
  const unit = unitFor(client);

  renderClientHead(client, unit);
  renderWeeks(client, unit);
  renderVolumeChart(client, unit);
  renderFuel(client);
  renderBodyweight(client, unit);
  renderLifts(client, unit);
  renderOutdoor(client, unit);
  renderBooked(client, unit);
  renderSessions(client, unit);
}

/* ---------------- outdoor ----------------
 *
 * What the client ran, walked and hiked, from SHARE-FORMAT.md "Outdoor". The
 * reading and formatting rules are route.js. The map is the client's newest
 * route with its first and last 200 m already cut off by their app, drawn on a
 * canvas rather than street tiles -- a map server would otherwise learn where
 * the client runs. */

const hasOutdoor = (day) => !!(day && day.outdoor && day.outdoor.length);

function drawRoute(canvas, points, aspect) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = Math.round(w / aspect);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pts = CoachRoute.project(points, w, h);
  const accent = LiftAppearance.cssColor('var(--accent)');
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  const dot = (p, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); };
  dot(pts[0], 5, LiftAppearance.cssColor('var(--accent-2)'));
  dot(pts[pts.length - 1], 6, accent);
}

function outdoorStats(parent, stats) {
  const grid = el('div', 'stats');
  stats.forEach(([label, value]) => {
    const cell = el('div');
    cell.appendChild(el('div', 'muted small', label));
    cell.appendChild(el('div', 'stat', value));
    grid.appendChild(cell);
  });
  parent.appendChild(grid);
}

function renderOutdoor(client, unit) {
  const node = $('#client-outdoor');
  node.innerHTML = '';
  const du = CoachRoute.distanceUnit(unit);
  const recent = dayKeys(client).filter((k) => hasOutdoor(client.days[k])).reverse();
  const route = client.lastRoute;
  const bests = client.outdoorBests;
  const heading = $('#client-outdoor-heading');
  let drawRouteAfter = null;

  if (!route && !bests && !recent.length) {
    heading.classList.add('hidden');
    return;
  }
  heading.classList.remove('hidden');

  if (route) {
    const card = el('div', 'card');
    card.appendChild(el('strong', 'cardtitle', 'Last route'));
    const canvas = el('canvas', 'route');
    card.appendChild(canvas);
    const line = el('div', 'routeline');
    line.appendChild(el('span', null, CoachRoute.typeLabel(route.type)));
    line.appendChild(el('span', 'muted', new Date(route.startedAt).toLocaleDateString(undefined,
      { weekday: 'short', month: 'short', day: 'numeric' })));
    card.appendChild(line);
    outdoorStats(card, [
      ['Distance', CoachRoute.distanceText(route.distanceM, du)],
      ['Time', route.durationSec != null ? CoachRoute.durationText(route.durationSec) : '—'],
      ['Pace', CoachRoute.activityPace(route.distanceM, route.durationSec, du) || '—'],
    ]);
    card.appendChild(el('p', 'muted small', 'The first and last 200 m are left off by the client\'s app.'));
    node.appendChild(card);
    // Drawn once every outdoor card is in: on a wide screen the cards share a
    // grid, and the route card is only full width until its neighbours arrive.
    // Measured any earlier, the map is drawn for a card twice its final width.
    drawRouteAfter = () => drawRoute(canvas, route.points, 2);
  }

  if (bests) {
    const card = el('div', 'card');
    card.appendChild(el('strong', 'cardtitle', 'Personal bests'));
    bests.forEach((b) => {
      card.appendChild(el('div', 'besthead',
        `${CoachRoute.typeLabel(b.type)} · ${b.count} ${b.count === 1 ? 'activity' : 'activities'}`));
      outdoorStats(card, [
        ['Farthest', b.farthestM != null ? CoachRoute.distanceText(b.farthestM, du) : '—'],
        ['Longest', b.longestSec != null ? CoachRoute.durationText(b.longestSec) : '—'],
        ['Fastest pace', b.fastestSecPerKm != null ? CoachRoute.paceText(b.fastestSecPerKm, du) : '—'],
      ]);
    });
    node.appendChild(card);
  }

  if (recent.length) {
    const card = el('div', 'card');
    card.appendChild(el('strong', 'cardtitle', 'Recent'));
    recent.slice(0, 10).forEach((key) => {
      client.days[key].outdoor.forEach((a) => {
        const row = el('div', 'statline');
        row.appendChild(el('span', null, `${shortDate(key)} · ${CoachRoute.typeLabel(a.type)}`));
        row.appendChild(el('span', 'muted',
          `${CoachRoute.distanceText(a.distanceM, du)} · ${a.durationSec != null ? CoachRoute.durationText(a.durationSec) : '—'}`));
        card.appendChild(row);
      });
    });
    node.appendChild(card);
  }

  if (drawRouteAfter) drawRouteAfter();
}

function renderClientHead(client, unit) {
  const head = $('#client-head');
  head.innerHTML = '';

  const card = el('div', 'card');
  card.appendChild(el('p', 'big', client.name));

  const bits = [];
  if (client.age != null) bits.push(`${client.age}`);
  if (client.sex) bits.push(client.sex);
  if (client.heightIn) bits.push(`${Math.floor(client.heightIn / 12)}′${client.heightIn % 12}″`);
  const latest = bodyweightSeries(client).pop();
  if (latest) bits.push(weightText(latest.lb, unit));
  if (bits.length) card.appendChild(el('p', 'muted', bits.join(' · ')));

  const last = lastLogged(client);
  card.appendChild(el('p', 'muted',
    (last ? `Last logged ${agoLabel(last)}. ` : 'Nothing logged yet. ')
    + `History ${shortDate(client.coverage[0])} – ${shortDate(client.coverage[1])}.`));

  const week = windowStats(client, 7);
  const month = windowStats(client, 28);
  const summary = el('div');
  statline(summary, 'Sessions', `${week.sessions} this week · ${month.sessions} in 4 weeks`);
  statline(summary, 'Working sets', `${week.sets} this week · ${month.sets} in 4 weeks`);
  statline(summary, 'Volume', `${weightText(week.volume, unit)} this week`);
  if (month.stepsAvg != null) statline(summary, 'Steps', `${num(month.stepsAvg)} a day`);
  card.appendChild(summary);

  if (client.goal) {
    const goal = client.goal;
    card.appendChild(el('p', 'muted',
      `Goal ${num(goal.calories)} kcal · ${goal.proteinG}p / ${goal.fatG}f / ${goal.carbsG}c`));
  }

  head.appendChild(card);
}

function renderWeeks(client, unit) {
  const node = $('#client-weeks');
  node.innerHTML = '';
  const weeks = weeklyBuckets(client, 8).filter((w) =>
    w.sessions || w.foodDays);

  if (!weeks.length) {
    node.appendChild(el('p', 'muted', 'Nothing logged in the last eight weeks.'));
    return;
  }

  // Steps only earn a column when the client's phone is actually reporting
  // them — an empty column on every row is worse than no column.
  const anySteps = weeks.some((w) => w.stepsAvg != null);

  const rows = weeks.reverse().map((w) => [
    `${shortDate(w.start)}–${shortDate(w.end)}`,
    w.sessions,
    w.sets,
    w.volume ? num(fromLb(w.volume, unit)) : null,
    w.kcalAvg != null ? num(w.kcalAvg) : null,
    w.proteinAvg != null
      ? { text: w.proteinAvg,
          cls: client.goal && w.proteinAvg < client.goal.proteinG * 0.9 ? 'under' : null }
      : null,
    ...(anySteps ? [w.stepsAvg != null ? num(w.stepsAvg) : null] : []),
    w.foodDays ? `${w.foodDays}/7` : null,
  ]);

  const headers = ['Week', 'Sess', 'Sets', `Vol ${unit}`, 'kcal', 'Prot'];
  if (anySteps) headers.push('Steps');
  headers.push('Logged');

  table(node, headers, rows);
}

function renderVolumeChart(client, unit) {
  const weeks = weeklyBuckets(client, 12);
  const series = [
    { label: `Weekly volume (${unit})`, color: CHART.volume,
      values: weeks.map((w) => (w.sessions ? Math.round(fromLb(w.volume, unit)) : null)) },
  ];
  drawChart($('#chart-volume'), series, weeks.map((w) => w.end));
  legend($('#legend-volume'), series);
}

function renderFuel(client) {
  const stats = $('#client-fuel-stats');
  stats.innerHTML = '';
  const days = lastNDays(28);
  const goal = client.goal;

  const kcal = days.map((k) => {
    const day = client.days[k];
    return hasFood(day) ? day.foodTotals.calories : null;
  });
  const protein = days.map((k) => {
    const day = client.days[k];
    return hasFood(day) ? day.foodTotals.proteinG : null;
  });

  const month = windowStats(client, 28);
  if (month.foodDays) {
    statline(stats, 'Days logged', `${month.foodDays} of the last 28`);
    statline(stats, 'Calories', goal
      ? `${num(month.kcalAvg)} a day vs ${num(goal.calories)} target`
      : `${num(month.kcalAvg)} a day`);
    statline(stats, 'Protein', goal
      ? `${month.proteinAvg} g vs ${goal.proteinG} g target`
      : `${month.proteinAvg} g a day`);
    if (month.proteinHitRate != null) {
      statline(stats, 'Protein on target',
        `${Math.round(month.proteinHitRate * 100)}% of logged days`);
    }
  } else {
    stats.appendChild(el('p', 'muted', 'No food logged in the last four weeks.'));
  }

  renderNutrientDetails(client, stats);

  const series = [
    { label: 'Calories', color: CHART.calories, values: kcal },
    { label: 'Protein (g)', color: CHART.protein, values: protein },
  ];
  if (goal) {
    series.push({ label: 'Calorie target', color: CHART.goal, dashed: true,
      values: days.map(() => goal.calories) });
  }
  drawChart($('#chart-fuel'), series, days);
  legend($('#legend-fuel'), series);
}

/* Saturated fat, sugar and sodium: the newest day that recorded any, then
 * averages over the last week and four weeks counting only the days that
 * recorded each. No goal exists for them, so no target and no bar. */
function renderNutrientDetails(client, parent) {
  const block = (heading, lines) => {
    if (!lines.length) return;
    parent.appendChild(el('p', 'nutrient-heading', heading));
    lines.forEach((line) => statline(parent, line.label, line.value));
  };
  const latest = dayKeys(client).filter((k) => client.days[k].nutrientTotals).pop();
  if (latest) {
    block(`Latest day recorded, ${shortDate(latest)}`,
      CoachNutrients.dayLines(client.days[latest].nutrientTotals));
  }
  const windowTotals = (span) => lastNDays(span)
    .map((k) => client.days[k] && client.days[k].nutrientTotals);
  block('Last 7 days, average',
    CoachNutrients.averages(windowTotals(7)).map((a) => CoachNutrients.averageLine(a)));
  block('Last 4 weeks, average',
    CoachNutrients.averages(windowTotals(28)).map((a) => CoachNutrients.averageLine(a)));
}

function renderBodyweight(client, unit) {
  const node = $('#client-weight');
  node.innerHTML = '';
  const series = bodyweightSeries(client);

  if (series.length < 2) {
    node.appendChild(el('p', 'muted', series.length
      ? `One reading: ${weightText(series[0].lb, unit)}. Trend needs a second.`
      : 'No bodyweight logged.'));
    return;
  }

  const latest = series[series.length - 1];
  const monthAgo = shiftKey(todayKey(), -28);
  const baseline = series.filter((p) => p.key <= monthAgo).pop() || series[0];
  const change = fromLb(latest.lb - baseline.lb, unit);
  const delta = deltaText(change, unit, true);

  statline(node, 'Now', `${weightText(latest.lb, unit)} on ${shortDate(latest.key)}`);
  const row = el('div', 'statline');
  row.appendChild(el('span', null, `Since ${shortDate(baseline.key)}`));
  row.appendChild(el('span', 'delta ' + delta.cls, delta.text));
  node.appendChild(row);

  const canvas = el('canvas');
  canvas.setAttribute('height', '130');
  node.appendChild(canvas);
  const keys = series.map((p) => p.key);
  drawChart(canvas, [{
    label: 'Bodyweight', color: CHART.weight, zoom: true,
    values: series.map((p) => fromLb(p.lb, unit)),
  }], keys);
}

function renderLifts(client, unit) {
  const chips = $('#lift-chips');
  const card = $('#lift-card');
  chips.innerHTML = '';
  card.innerHTML = '';

  const lifts = exerciseIndex(client);
  if (!lifts.length) {
    card.appendChild(el('p', 'muted', 'No training logged yet.'));
    return;
  }
  if (!lifts.some((l) => l.id === openLiftId)) openLiftId = lifts[0].id;

  lifts.slice(0, 24).forEach((lift) => {
    const chip = el('button', 'chip' + (lift.id === openLiftId ? ' on' : ''), lift.label);
    chip.onclick = () => { openLiftId = lift.id; renderLifts(client, unit); };
    chips.appendChild(chip);
  });

  const lift = lifts.find((l) => l.id === openLiftId);

  /* One session's sets, as a point on a line. Epley on the best working set,
   * which is `estimatedOneRepMax` -- the same rule that has always drawn this
   * chart, so the imbalance figure below and the lines above are read off the
   * same numbers. */
  const summarise = (sets) => {
    const best = sets.map(estimatedOneRepMax).filter(Boolean);
    const heaviest = sets.filter((s) => !s.warmup && s.weightLb)
      .sort((a, b) => b.weightLb - a.weightLb)[0];
    return {
      e1rm: best.length ? Math.max(...best) : null,
      top: heaviest || null,
      sets: sets.filter((s) => !s.warmup).length,
    };
  };

  /* Left, right and unmarked as separate series, keyed name|equipment|side.
   * Reading the side bits and then charting as before is worse than ignoring
   * them, because the two limbs are genuinely interleaved and the line
   * zig-zags between them set for set -- the same bug `name|equipment` was
   * introduced to fix for a cable pulldown against a machine one. */
  const series = CoachSides.splitSessions(lift.name, lift.equipment,
    lift.days.map(({ key, ex }) => ({ key, sets: ex.sets })), summarise);
  const sided = series.length > 1 || (series[0] && series[0].side !== null);
  const seriesColour = (side) => (
    side === CoachSides.LEFT ? CHART.e1rm
      : side === CoachSides.RIGHT ? 'var(--accent)'
        : sided ? 'var(--muted)' : CHART.e1rm);

  series.forEach((s) => {
    const withE1rm = s.points.filter((p) => p.e1rm != null);
    if (withE1rm.length < 2) return;
    const first = withE1rm[0], last = withE1rm[withE1rm.length - 1];
    const delta = deltaText(fromLb(last.e1rm - first.e1rm, unit), unit);
    const row = el('div', 'statline');
    row.appendChild(el('span', null,
      `${sided ? s.label + ' e' : 'E'}stimated 1RM since ${shortDate(first.key)}`));
    row.appendChild(el('span', 'delta ' + delta.cls, delta.text));
    card.appendChild(row);
  });

  /* The gap between the sides, and whether it is moving. Shown, never
   * targeted: no threshold, no colour, no advice. A two-sided lift has no
   * sides and no figure. */
  const left = series.find((s) => s.side === CoachSides.LEFT);
  const right = series.find((s) => s.side === CoachSides.RIGHT);
  if (left && right) {
    const result = CoachSides.imbalance(
      left.points.map((p) => p.e1rm), right.points.map((p) => p.e1rm));
    const lines = CoachSides.imbalanceLines(result);
    statline(card, 'Imbalance', lines.headline);
    card.appendChild(el('p', 'muted', lines.detail));
  }

  const allPoints = series.flatMap((s) => s.points);
  const best = allPoints.filter((p) => p.top)
    .sort((a, b) => b.top.weightLb - a.top.weightLb)[0];
  if (best) {
    const mark = CoachSides.label(best.side);
    statline(card, 'Heaviest set',
      `${weightText(best.top.weightLb, unit)} × ${best.top.reps}${mark ? ' ' + mark : ''}`
      + ` on ${shortDate(best.key)}`);
  }

  // One x-axis for every series, so the two limbs line up session for session
  // and a day trained on one side alone leaves a gap in the other's line
  // rather than a zero.
  const labels = lift.days.map((d) => d.key);
  const plotted = series
    .map((s) => {
      const byKey = new Map(s.points.map((p) => [p.key, p]));
      return {
        label: sided ? s.label : 'e1RM',
        color: seriesColour(s.side),
        zoom: true,
        values: labels.map((k) => {
          const point = byKey.get(k);
          return point && point.e1rm != null ? Math.round(fromLb(point.e1rm, unit)) : null;
        }),
      };
    })
    .filter((s) => s.values.filter((v) => v != null).length >= 2);

  if (plotted.length) {
    const canvas = el('canvas');
    canvas.setAttribute('height', '130');
    card.appendChild(canvas);
    drawChart(canvas, plotted, labels);
    if (sided) {
      // Built here rather than sitting in index.html, because the card is
      // rebuilt from empty on every render and a lift with no sides has no
      // legend to show.
      const legendRow = el('div', 'legend');
      legend(legendRow, plotted);
      card.appendChild(legendRow);
    }
  }

  // Up to six sessions per side, newest first, so two limbs get six each
  // rather than three.
  const recent = series.flatMap((s) => s.points.slice(-6))
    .sort((a, b) => a.key.localeCompare(b.key)).reverse()
    .map((p) => [
      shortDate(p.key),
      ...(sided ? [CoachSides.longLabel(p.side)] : []),
      p.sets,
      p.top ? `${num(fromLb(p.top.weightLb, unit))} × ${p.top.reps}` : null,
      p.e1rm ? num(fromLb(p.e1rm, unit)) : null,
    ]);
  const wrap = el('div', 'scroll-x');
  table(wrap, ['Date', ...(sided ? ['Side'] : []), 'Sets', 'Top set', `e1RM ${unit}`], recent);
  card.appendChild(wrap);
}

/** How a set reads back: "185 × 5 L", "185 × 5 @8", "400 m in 1:30". */
function setText(set, unit) {
  const bits = [];
  if (set.weightLb != null && set.reps != null) {
    bits.push(`${num(fromLb(set.weightLb, unit))} × ${set.reps}`);
  } else if (set.reps != null) {
    bits.push(`${set.reps} reps`);
  } else if (set.weightLb != null) {
    bits.push(weightText(set.weightLb, unit));
  }
  if (set.distanceM != null) bits.push(`${num(set.distanceM)} m`);
  if (set.durationSec != null) {
    const m = Math.floor(set.durationSec / 60);
    bits.push(m ? `${m}:${pad2(set.durationSec % 60)}` : `${set.durationSec}s`);
  }
  // The side rides on the first bit -- "185 × 5 L", not "185 × 5 · L" -- so
  // it reads as part of the set rather than as another measurement of it. A
  // set with no side says nothing: absent is both, and always has been.
  const mark = CoachSides.label(set);
  if (mark) {
    if (bits.length) bits[0] += ` ${mark}`;
    else bits.push(mark);
  }
  if (set.rpe != null) bits.push(`@${set.rpe}`);
  if (set.warmup) bits.push('warm-up');
  return bits.join(' · ') || '—';
}

/* ---------------- booked ----------------
 *
 * What the coach booked, beside what the client logged. The rules -- which
 * day joins which, which lift answers which, and every sentence on screen --
 * are plan-log.js, which node tests; this draws what it returns and decides
 * nothing of its own.
 *
 * It sits here, above Sessions and below the summary cards, because Train is
 * where a coach writes and the client page is where a coach reads, and this
 * is reading. Absent entirely for a client never sent a plan: plans sent
 * before this existed cannot be reconstructed, and a line saying so is a line
 * every coach reads once and never again.
 *
 * **Counting, never grading.** Every day row is the same weight and the same
 * colour, whichever of the four states it is in. The nearest precedent in
 * this file goes the other way -- the Weeks table puts an `.under` class on a
 * protein average below 90% of goal -- and this deliberately does not follow
 * it. A macro goal is a number on a dial; a booked day nobody logged is a
 * person's week.
 */

let bookedMode = 'day';

function bookedSets(parent, row) {
  const line = el('div', 'setline');
  line.appendChild(el('b', null, row.label + ' '));
  row.groups.forEach((group) => {
    const span = el('span', 'sidegroup');
    if (group.label) span.appendChild(el('b', null, group.label + ' '));
    span.appendChild(document.createTextNode(group.text));
    line.appendChild(span);
  });
  // "each side" is a clause on what was asked for, not a set: the groups
  // above are three rows and this is what makes them six.
  if (row.suffix) line.appendChild(document.createTextNode(row.suffix));
  parent.appendChild(line);
}

function bookedExercise(parent, ex) {
  const block = el('div', 'exercise');
  block.appendChild(el('h3', null, ex.title));
  if (ex.sideLine) block.appendChild(el('div', 'setline muted', ex.sideLine));
  if (ex.countLine) block.appendChild(el('div', 'setline muted', ex.countLine));
  if (ex.asked) bookedSets(block, ex.asked);
  if (ex.logged) bookedSets(block, ex.logged);
  if (ex.substitution) block.appendChild(el('div', 'setline muted', ex.substitution));
  parent.appendChild(block);
}

function bookedAlsoLogged(parent, list) {
  if (!list.length) return;
  const block = el('div', 'exercise');
  block.appendChild(el('h3', null, 'Also logged'));
  list.forEach((ex) => block.appendChild(el('div', 'setline', ex.text)));
  parent.appendChild(block);
}

/* The meals a day booked, and what the log holds at each slot.
 *
 * Two separate statements, never one: the bold row is Coach's own record of
 * what it booked, the muted row under it is what the client's log holds at
 * that meal, and nothing anywhere says they are the same dish. The context
 * line above them all is what stops "Nothing logged at lunch" being read as
 * "they ate nothing" -- see plan-log.js's MEAL_NOTE, which sits under the
 * card saying so in words.
 */
function bookedMeals(parent, day) {
  if (!day.meals.length) return;
  const block = el('div', 'exercise');
  block.appendChild(el('h3', null, 'Meals'));
  if (day.foodContext) block.appendChild(el('div', 'setline muted', day.foodContext));
  day.meals.forEach((meal) => {
    const row = el('div', 'mealrow');
    const booked = el('div', 'setline');
    booked.appendChild(el('b', null, meal.title));
    row.appendChild(booked);
    if (meal.logged) row.appendChild(el('div', 'setline muted', meal.logged));
    block.appendChild(row);
  });
  parent.appendChild(block);
}

function bookedDay(parent, day) {
  const has = day.exercises.length || day.alsoLogged.length || day.meals.length;
  if (!has) {
    // A day with nothing under it is the same line in the same weight, just
    // without a disclosure triangle.
    parent.appendChild(el('div', 'bookedday flat', day.text));
    return;
  }
  const details = el('details', 'session booked');
  const summary = el('summary');
  summary.appendChild(el('div', 'bookedday', day.text));
  details.appendChild(summary);
  const body = el('div', 'body');
  day.exercises.forEach((ex) => bookedExercise(body, ex));
  bookedAlsoLogged(body, day.alsoLogged);
  bookedMeals(body, day);
  details.appendChild(body);
  parent.appendChild(details);
}

function renderBooked(client, unit) {
  const node = $('#client-booked');
  const heading = $('#client-booked-heading');
  const modes = $('#client-booked-modes');
  node.innerHTML = '';

  const result = CoachPlanLog.compare({
    clientId: client.id,
    sentPlans,
    days: client.days,
    coverage: client.coverage,
    unit,
    weeks: 8,
  });

  if (!result.groups.length) {
    heading.classList.add('hidden');
    modes.classList.add('hidden');
    modes.innerHTML = '';
    return;
  }
  heading.classList.remove('hidden');
  // By lift is about lifts. A send that booked only meals has none, so the
  // chip would open an empty card -- one mode is no choice, so no chips.
  const modeList = [{ label: 'By day', v: 'day' }];
  if (result.byLift.length) modeList.push({ label: 'By lift', v: 'lift' });
  const mode = result.byLift.length ? bookedMode : 'day';
  if (modeList.length > 1) {
    modes.classList.remove('hidden');
    chipRow(modes, modeList,
      (i) => i.v === mode,
      (i) => { bookedMode = i.v; renderBooked(client, unit); });
  } else {
    modes.classList.add('hidden');
    modes.innerHTML = '';
  }

  if (mode === 'lift') {
    result.byLift.forEach((lift) => {
      const card = el('div', 'card');
      card.appendChild(el('strong', 'cardtitle', lift.title));
      lift.entries.forEach((entry) => {
        const ex = entry.exercise;
        const block = el('div', 'exercise');
        block.appendChild(el('h3', null, entry.when));
        // A day with nothing logged against this lift says so in the rule's
        // own words -- "not logged" on a day the client sent, "outside the
        // log they sent" on a day they did not.
        if (ex.state !== 'logged') block.appendChild(el('div', 'setline', ex.title));
        if (ex.sideLine) block.appendChild(el('div', 'setline muted', ex.sideLine));
        if (ex.countLine) block.appendChild(el('div', 'setline muted', ex.countLine));
        if (ex.asked) bookedSets(block, ex.asked);
        if (ex.logged) bookedSets(block, ex.logged);
        if (ex.substitution) block.appendChild(el('div', 'setline muted', ex.substitution));
        card.appendChild(block);
      });
      node.appendChild(card);
    });
  } else {
    result.groups.forEach((group) => {
      const card = el('div', 'card');
      card.appendChild(el('strong', 'cardtitle', group.head));
      group.days.forEach((day) => bookedDay(card, day));
      node.appendChild(card);
    });
  }

  // What a meal row does not claim, once, under the card that has one.
  if (result.mealFooter) node.appendChild(el('p', 'muted small', result.mealFooter));
  // Permanently, whatever is above it: Coach knows what it put on a
  // clipboard and nothing after that.
  node.appendChild(el('p', 'muted small', result.footer));
}

function renderSessions(client, unit) {
  const node = $('#session-log');
  node.innerHTML = '';

  const keys = dayKeys(client).filter((k) =>
    hasTraining(client.days[k]) || hasFood(client.days[k]) || hasOutdoor(client.days[k]));
  if (!keys.length) {
    node.appendChild(el('p', 'muted', 'Nothing logged yet.'));
    return;
  }

  keys.reverse().slice(0, 40).forEach((key) => {
    const day = client.days[key];
    const details = el('details', 'session');
    const summary = el('summary');
    const left = el('div');
    left.appendChild(el('div', null,
      `${shortDate(key)}${day.name ? ' · ' + day.name : ''}`));
    const parts = [];
    if (hasTraining(day)) parts.push(`${daySets(day)} sets · ${weightText(dayVolume(day), unit)}`);
    if (hasFood(day)) parts.push(`${num(day.foodTotals.calories)} kcal · ${day.foodTotals.proteinG}g protein`);
    if (hasOutdoor(day)) {
      parts.push(day.outdoor.map((a) => `${CoachRoute.typeLabel(a.type)} ${CoachRoute.distanceText(a.distanceM, CoachRoute.distanceUnit(unit))}`).join(', '));
    }
    left.appendChild(el('div', 'muted', parts.join('  ·  ')));
    summary.appendChild(left);
    if (day.focus) summary.appendChild(el('span', 'pill', day.focus.toLowerCase()));
    details.appendChild(summary);

    const body = el('div', 'body');
    (day.exercises || []).forEach((ex) => {
      const block = el('div', 'exercise');
      block.appendChild(el('h3', null, ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name));
      // "L 3 · R 2" when any set is sided, so a missed side is obvious at a
      // glance. Empty, and absent, for an ordinary two-sided lift.
      const counts = CoachSides.countsLabel(ex.sets);
      if (counts) block.appendChild(el('div', 'setline muted', counts));
      ex.sets.forEach((set, i) => {
        const line = el('div', 'setline');
        line.appendChild(el('b', null, `${i + 1}. `));
        line.appendChild(document.createTextNode(setText(set, unit)));
        block.appendChild(line);
      });
      body.appendChild(block);
    });

    // The day's saturated fat, sugar and sodium, with coverage when partial.
    const nutrientLines = (block) => CoachNutrients.dayLines(day.nutrientTotals)
      .forEach((line) => block.appendChild(el('div', 'setline', line.text)));

    if (day.food && day.food.length) {
      const block = el('div', 'exercise');
      block.appendChild(el('h3', null, 'Food'));
      day.food.forEach((entry) => {
        const line = el('div', 'setline');
        line.appendChild(el('b', null, entry.name));
        line.appendChild(document.createTextNode(
          ` — ${num(entry.calories * entry.servings)} kcal, `
          + `${Math.round(entry.proteinG * entry.servings)}g protein`
          + (entry.meal ? ` · ${entry.meal}` : '')));
        block.appendChild(line);
        const detail = CoachNutrients.foodLine(entry);
        if (detail) block.appendChild(el('div', 'setline muted', detail));
      });
      nutrientLines(block);
      body.appendChild(block);
    } else if (hasFood(day)) {
      const block = el('div', 'exercise');
      block.appendChild(el('h3', null, 'Food'));
      const t = day.foodTotals;
      block.appendChild(el('div', 'setline',
        `${num(t.calories)} kcal · ${t.proteinG}p / ${t.fatG}f / ${t.carbsG}c / ${t.fiberG} fibre`));
      nutrientLines(block);
      block.appendChild(el('p', 'muted',
        'Daily totals only — ask them to switch on itemised food in LIFT if you want the detail.'));
      body.appendChild(block);
    }

    if (day.steps != null) body.appendChild(el('p', 'muted', `${num(day.steps)} steps`));

    details.appendChild(body);
    node.appendChild(details);
  });
}

/* ---------------- connect ---------------- */

function inviteText() {
  const name = settings.name.trim() || 'your coach';
  const email = settings.email.trim() || '<your email address>';
  return [
    `Hi — I use LIFT to keep an eye on your training and eating between sessions.`,
    ``,
    `One-time setup, takes a minute:`,
    `1. Open LIFT and go to Settings.`,
    `2. Under "Coach", put in ${email} and tap Save.`,
    ``,
    `From then on, whenever you want me to look at your training:`,
    `tap "Send to Coach" on the home screen, then hit Send when your`,
    `email opens. It fills itself in — there is nothing to type or attach.`,
    ``,
    `Once a week is plenty.`,
    ``,
    `— ${name}`,
  ].join('\n');
}

function renderConnect() {
  $('#coach-name').value = settings.name;
  $('#coach-email').value = settings.email;
  $('#invite-text').textContent = inviteText();

  // Every store the backup carries, so the size shown matches what a backup
  // would actually hold. Read through localStorage rather than the live
  // arrays: render() runs at module scope before `recipes` and `workouts`
  // are initialised, and every mutation persists immediately anyway.
  const stored = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (e) { return []; }
  };
  const keys = [KEY.clients, COOK_KEY.recipes, COOK_KEY.plans, COOK_KEY.roadPicks,
    TRAIN_KEY.workouts, TRAIN_KEY.sessions, PLAN_KEY.sentPlans];
  const bytes = keys.reduce(
    (total, key) => total + new Blob([localStorage.getItem(key) || '']).size, 0);
  const recipeCount = stored(COOK_KEY.recipes).length;
  const workoutCount = stored(TRAIN_KEY.workouts).length;
  const library = recipeCount + workoutCount;
  $('#storage-note').textContent = clients.length || library
    ? `${clients.length} ${clients.length === 1 ? 'client' : 'clients'}, `
      + `${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'} and `
      + `${workoutCount} ${workoutCount === 1 ? 'workout' : 'workouts'} `
      + `stored here, ${(bytes / 1024).toFixed(0)} KB. This lives in this `
      + `browser only — clearing site data wipes it, so keep a backup.`
    : 'Nothing stored yet.';
}

/* ---------------- incoming link ---------------- */

let pending = null;

function showIncoming(payload) {
  const incoming = expand(payload);
  pending = incoming;

  const existing = clients.find((c) => c.id === incoming.id);
  const body = $('#incoming-body');
  body.innerHTML = '';

  body.appendChild(el('p', 'big', incoming.name));

  const dayCount = Object.keys(incoming.days).length;
  const trainingDays = Object.values(incoming.days).filter(hasTraining).length;
  body.appendChild(el('p', null,
    `Sent ${shortDate(incoming.coverage[0])} – ${shortDate(incoming.coverage[1])}: `
    + `${dayCount} logged ${dayCount === 1 ? 'day' : 'days'}, `
    + `${trainingDays} with training.`));

  body.appendChild(el('p', 'muted', existing
    ? `Already on your roster — last heard from ${agoLabel(dateKey(new Date(existing.receivedAt)))}. `
      + 'Days in this window will be replaced with what they just sent.'
    : 'New client. They will be added to your roster.'));

  $('#incoming-save').textContent = existing ? 'Update ' + incoming.name.split(' ')[0] : 'Add to roster';
  $('#incoming').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showLinkError(error) {
  const body = $('#incoming-body');
  body.innerHTML = '';
  body.appendChild(el('p', 'big', "Couldn't read that link"));
  body.appendChild(el('p', null, error.message));
  body.appendChild(el('p', 'muted',
    'Mail apps sometimes break long links across lines. Copying the link from '
    + 'the bottom of the email and pasting it into the box on the Roster tab '
    + 'usually works.'));
  pending = null;
  $('#incoming-save').textContent = 'Add to roster';
  $('#incoming').classList.remove('hidden');
}

/* The fragment is cleared as soon as it is read. It keeps a refresh from
 * re-importing, and keeps a client's log out of the address bar and out of
 * whatever the browser syncs. */
function clearFragment() {
  history.replaceState(null, '', location.pathname + location.search);
}

async function consume(text) {
  try {
    const payload = await decodeLink(text);
    showIncoming(payload);
  } catch (error) {
    showLinkError(error);
  }
}

/* ---------------- backup ---------------- */

function saveBackup() {
  // v2 adds the four library stores. v1 carried only clients and settings,
  // which meant every recipe and workout a coach had ever written was absent
  // from their own backup -- silently, while the Connect tab told them a
  // backup was enough to survive clearing site data.
  //
  // `side` is a named field here, not SHARE-FORMAT's flags bits: a backup is
  // read by people and by three Coach builds, and has to survive a reader that
  // does not know the field. Normalised on the way out so the file never
  // carries a spelling this app would not read back, and omitted entirely when
  // a set is two-sided -- absent is how "both" is written (BACKUP-FORMAT.md).
  clients.forEach(CoachSides.normaliseClient);
  // A prescription's sides follow the same rule: `eachSide: true` on an
  // exercise done each side, omitted when not, and `side` on a set that names
  // one, omitted when both. See prescriptions.js.
  workouts.forEach(CoachPrescriptions.normaliseWorkout);
  // Road picks are a map of client id to item ids, not a list of rows with
  // ids of their own, so they are written as they are stored rather than
  // merged by id on the way back in. See restoreLibrary.
  // Sent plans ride as rows with ids of their own, so they merge by id the
  // way recipes and workouts do. Omitted when there are none, so a coach who
  // has never sent a plan writes the file they always did.
  const payload = { v: 2, clients, settings, recipes, plans, workouts, sessions,
    roadPicks };
  if (sentPlans.length) payload.sentPlans = sentPlans;
  const blob = new Blob([JSON.stringify(payload, null, 1)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = `lift-coach-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Merge the four library stores out of a v2 backup, by id, additively --
 *  the same rule the roster uses, for the same reason: an older backup must
 *  never delete newer work sitting on this device. Returns a fragment for
 *  the restore message, empty when the file carried no library (v1). */
function restoreLibrary(parsed) {
  const stores = [
    ['recipes', recipes, 'recipe'],
    ['plans', plans, 'planned meal'],
    ['workouts', workouts, 'workout'],
    ['sessions', sessions, 'scheduled session'],
  ];
  const added = [];
  stores.forEach(([key, target, noun]) => {
    if (!Array.isArray(parsed[key])) return;
    let n = 0;
    parsed[key].forEach((item) => {
      // A workout from a file written before sides has neither field and
      // restores as it always did; an unknown side string reads as both.
      if (key === 'workouts') CoachPrescriptions.normaliseWorkout(item);
      if (item && item.id && !target.some((existing) => existing.id === item.id)) {
        target.push(item);
        n += 1;
      }
    });
    if (n) added.push(`${n} ${noun}${n === 1 ? '' : 's'}`);
  });
  // Road picks: one list per client, so "merge by id" has nothing to key on.
  // A client this device already has picks for keeps them -- an older backup
  // must never delete newer work -- and a client it has none for takes the
  // file's. A file written before road picks has no key at all and changes
  // nothing.
  if (parsed.roadPicks && typeof parsed.roadPicks === 'object') {
    let picked = 0;
    Object.keys(parsed.roadPicks).forEach((clientId) => {
      if (picksFor(clientId).length) return;
      const list = CoachRoadPicks.normalise(parsed.roadPicks[clientId]);
      if (!list.length) return;
      roadPicks[clientId] = list;
      picked += list.length;
    });
    if (picked) added.push(`${picked} road pick${picked === 1 ? '' : 's'}`);
    save(COOK_KEY.roadPicks, roadPicks);
  }

  // Sent plans: rows with ids, merged by id and never deleted by an older
  // file -- the library half's rule. A file written before sent plans existed
  // has no key at all and changes nothing.
  const sent = CoachPlanLog.mergeBackup(sentPlans, parsed.sentPlans);
  sentPlans = sent.rows;
  if (sent.added) added.push(`${sent.added} sent plan${sent.added === 1 ? '' : 's'}`);
  save(PLAN_KEY.sentPlans, sentPlans);

  save(COOK_KEY.recipes, recipes);
  save(COOK_KEY.plans, plans);
  save(TRAIN_KEY.workouts, workouts);
  save(TRAIN_KEY.sessions, sessions);
  return added.length ? `, plus ${added.join(', ')}` : '';
}

function loadBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.clients)) throw new Error('not a backup');
      // Restoring adds to the roster rather than replacing it, so pulling an
      // old backup onto a working device can't lose the newer clients on it.
      parsed.clients.forEach((client) => {
        // A side another app spelt differently -- "Both", "L", null, a field
        // from a format nobody here knows -- reads as both rather than
        // failing the import, and a file written before per-limb logging has
        // no `side` anywhere and restores exactly as it always did.
        CoachSides.normaliseClient(client);
        const existing = clients.find((c) => c.id === client.id);
        if (!existing) clients.push(client);
        else Object.assign(existing.days, client.days);
      });
      persist();

      // v1 files have no library at all; absent stays absent rather than
      // wiping what is on this device.
      const restored = restoreLibrary(parsed);
      render();
      alert(`Restored ${parsed.clients.length} client(s)${restored}.`);
    } catch (e) {
      alert("That file isn't a LIFT Coach backup.");
    }
  };
  reader.readAsText(file);
}

/* ---------------- sample client ---------------- */

/* Enough shape to show what the screens do before a real client has sent
 * anything. Removed like any other client. */
function sampleClient() {
  const days = {};
  const lifts = [
    ['Back Squat', 'Barbell', 285], ['Bench Press', 'Barbell', 205],
    ['Deadlift', 'Barbell', 345], ['Overhead Press', 'Barbell', 125],
    ['Lat Pulldown', 'Cable', 140], ['Barbell Row', 'Barbell', 165],
  ];
  for (let back = 55; back >= 0; back--) {
    const key = shiftKey(todayKey(), -back);
    const day = {};
    const progress = (55 - back) / 55;

    if ([0, 1, 3, 5].includes(back % 7)) {
      const picks = lifts.slice((back % 2) * 3, (back % 2) * 3 + 3);
      day.name = back % 2 ? 'Lower' : 'Upper';
      day.focus = 'POWERLIFTING';
      day.exercises = picks.map(([name, equipment, base]) => {
        const top = Math.round((base * (0.88 + progress * 0.12)) / 5) * 5;
        return {
          name, equipment,
          sets: [
            { weightLb: Math.round(top * 0.5 / 5) * 5, reps: 8, rpe: null, durationSec: null, distanceM: null, warmup: true },
            { weightLb: top, reps: 5, rpe: 8, durationSec: null, distanceM: null, warmup: false },
            { weightLb: top, reps: 5, rpe: 8.5, durationSec: null, distanceM: null, warmup: false },
            { weightLb: Math.round(top * 0.9 / 5) * 5, reps: 8, rpe: 9, durationSec: null, distanceM: null, warmup: false },
          ],
        };
      });

      // One unilateral lift on lower days, so the two-series chart and the
      // imbalance figure are visible before a real client has sent anything.
      // The left side starts 15 lb down and closes to 5 -- an ordinary gap
      // doing an ordinary thing, which is the whole point of showing it
      // without a threshold or a colour attached.
      if (back % 2) {
        const top = Math.round((95 * (0.88 + progress * 0.12)) / 5) * 5;
        const deficit = Math.round((15 - progress * 10) / 5) * 5;
        day.exercises.push({
          name: 'Bulgarian Split Squat',
          equipment: 'Dumbbell',
          // Alternating, the way it is actually logged.
          sets: [0, 1, 2].flatMap(() => ['left', 'right'].map((side) => ({
            weightLb: side === 'left' ? top - deficit : top,
            reps: 8, rpe: 8, durationSec: null, distanceM: null,
            warmup: false, side,
          }))),
        });
      }
    }

    if (back % 9 !== 0) {   // a couple of missed days, because that is real
      const swing = ((back * 37) % 400) - 200;
      const calories = 2380 + swing;
      day.foodTotals = {
        calories,
        proteinG: 165 + ((back * 13) % 40),
        fatG: 68 + ((back * 7) % 20),
        carbsG: 225 + ((back * 11) % 60),
        fiberG: 26 + (back % 12),
      };
    }

    day.steps = 6000 + ((back * 613) % 7000);
    if (back % 7 === 0) day.bodyweightLb = Math.round((212 - progress * 6.5) * 10) / 10;
    days[key] = day;
  }

  return {
    id: 'sample-client',
    name: 'Sample Client',
    sex: 'male', age: 34, heightIn: 71, unit: 'lb', platform: 'web',
    goal: { calories: 2400, proteinG: 190, fatG: 70, carbsG: 220, fiberG: 34 },
    exportedAt: Date.now(),
    receivedAt: Date.now(),
    coverage: [shiftKey(todayKey(), -55), todayKey()],
    days,
  };
}

/* ---------------- render ---------------- */

function render() {
  document.body.dataset.tab = currentTab;
  if (currentTab === 'roster' || currentTab === 'client') {
    if (splitView.matches) { renderRoster(); renderClient(); }
    else if (currentTab === 'roster') renderRoster();
    else renderClient();
  }
  else if (currentTab === 'cook') renderCook();
  else if (currentTab === 'train') renderTrain();
  else if (currentTab === 'connect') renderConnect();
}

/* ---------------- events ---------------- */

document.querySelectorAll('#tabs button').forEach((button) => {
  button.onclick = () => showTab(button.dataset.tab);
});

$('#incoming-cancel').onclick = () => {
  pending = null;
  $('#incoming').classList.add('hidden');
};

$('#incoming-save').onclick = () => {
  if (!pending) { $('#incoming').classList.add('hidden'); return; }
  const client = pending;
  absorb(client);
  pending = null;
  $('#incoming').classList.add('hidden');
  openClient(client.id);
};

$('#paste-go').onclick = () => {
  const value = $('#paste-link').value;
  if (!value.trim()) return;
  $('#paste-link').value = '';
  consume(value);
};

$('#empty-connect').onclick = () => showTab('connect');

$('#empty-demo').onclick = () => {
  if (clients.some((c) => c.id === 'sample-client')) { showTab('roster'); return; }
  clients.push(sampleClient());
  persist();
  render();
};

/* Remove this client: the client, their days, and the meals planned and
 * sessions booked for them. What goes is counted and worded by
 * client-removal.js, which node can test; this handler only asks and saves.
 * Leaving the meals and sessions behind left them in no week, sendable from
 * nowhere, and in every backup -- see that file. */
$('#client-remove').onclick = () => {
  const client = currentClient();
  if (!client) return;
  const stores = { clients, plans, sessions, roadPicks, sentPlans };
  const impact = CoachClientRemoval.impact(client.id, stores);
  if (!impact) return;
  if (!confirm(CoachClientRemoval.confirmationPrompt(impact))) return;

  const after = CoachClientRemoval.remove(client.id, stores);
  clients = after.clients;
  plans = after.plans;
  sessions = after.sessions;
  roadPicks = after.roadPicks;
  sentPlans = after.sentPlans;
  persist();
  save(COOK_KEY.plans, plans);
  save(TRAIN_KEY.sessions, sessions);
  save(COOK_KEY.roadPicks, roadPicks);
  save(PLAN_KEY.sentPlans, sentPlans);
  openClientId = null;
  $('#tab-client').disabled = true;
  showTab('roster');
};

const saveSettings = () => save(KEY.settings, settings);

$('#coach-name').oninput = (e) => {
  settings.name = e.target.value;
  saveSettings();
  $('#invite-text').textContent = inviteText();
};

$('#coach-email').oninput = (e) => {
  settings.email = e.target.value;
  saveSettings();
  $('#invite-text').textContent = inviteText();
};

$('#invite-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(inviteText());
    $('#invite-copy').textContent = 'Copied';
    setTimeout(() => { $('#invite-copy').textContent = 'Copy invite'; }, 1500);
  } catch (e) {
    alert('Copying was blocked — select the text above and copy it by hand.');
  }
};

$('#invite-email').onclick = () => {
  const subject = encodeURIComponent(
    `Sending me your training from LIFT${settings.name ? ' — ' + settings.name : ''}`);
  location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(inviteText())}`;
};

$('#backup-save').onclick = saveBackup;
$('#backup-load').onclick = () => $('#backup-file').click();
$('#backup-file').onchange = (e) => {
  if (e.target.files[0]) loadBackup(e.target.files[0]);
  e.target.value = '';
};

// Charts and the route map are canvases sized from their card's rendered
// width, so they need redrawing when that width changes. Watching the client
// pane rather than the window catches every cause: a rotation, a desktop
// window dragged wider, and a card moving into or out of a two-column grid.
// Only a change in width redraws -- a pane growing taller as it renders must
// not loop back into another render.
let resizeTimer = null;
let clientPaneWidth = 0;
const clientPaneVisible = () =>
  currentTab === 'client' || (currentTab === 'roster' && splitView.matches);
const redrawClient = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (clientPaneVisible()) renderClient(); }, 150);
};
if ('ResizeObserver' in window) {
  new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (!width || width === clientPaneWidth) return;
    clientPaneWidth = width;
    redrawClient();
  }).observe($('#client-body'));
} else {
  window.addEventListener('resize', redrawClient);
}

// Crossing 1024px turns two tabs into one view or back again, which changes
// what is on screen, not just its size.
splitView.addEventListener('change', render);

// A link tapped while the app is already open changes the fragment without
// reloading the page.
window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  if (!hash) return;
  clearFragment();
  consume(hash);
});

/* ---------------- boot ---------------- */

$('#tab-client').disabled = clients.length === 0;
if (clients.length) openClientId = clients[0].id;

const initialHash = location.hash.slice(1);
if (initialHash) {
  clearFragment();
  consume(initialHash);
}


/* ---------------- appearance ---------------- */

/* System / Light / Dark. appearance.js owns the choice and the palette switch;
 * this renders the chips and redraws, because canvas charts are drawn with the
 * palette's colours at draw time and do not change by themselves. */
function renderAppearance() {
  const labels = { system: 'System', light: 'Light', dark: 'Dark' };
  chipRow($('#appearance-mode'),
    LiftAppearance.CHOICES.map((v) => ({ label: labels[v], v })),
    (i) => i.v === LiftAppearance.get(),
    (i) => LiftAppearance.set(i.v));
}
LiftAppearance.onChange(() => { renderAppearance(); render(); });
renderAppearance();

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

/* ---------------- COOK ----------------
 *
 * The trainer half. A coach writes recipes, builds a week for one client, and
 * sends it as a link — the same trip a log makes, in the opposite direction.
 *
 * Recipes and plans live in this browser like everything else here. The plan
 * link carries no recipes of its own beyond what the client needs to cook
 * them, and it rides in the fragment, so dugcanlift.com never sees it.
 *
 * PLAN-FORMAT.md documents the wire shape. The ingredient parser below is the
 * same one in the Android, iOS and web builds of LIFT; all four must agree.
 */

let recipes = load(COOK_KEY.recipes, []);
/* Planned meals across every client, each tagged with the client id it is for.
 * A plan is addressed, not broadcast. */
let plans = load(COOK_KEY.plans, []);

/* Road picks, per client: { clientId: [itemId, ...] }.
 * Ids out of the bundled Road Food file, which LIFT has the same copy of --
 * the spec keeps them stable for exactly this. See road-picks.js. */
let roadPicks = load(COOK_KEY.roadPicks, {});


const LIFT_URL = 'https://www.dugcanlift.com/lift/';

const recipeById = (id) => recipes.find((r) => r.id === id);

const picksFor = (clientId) => CoachRoadPicks.normalise((roadPicks || {})[clientId] || []);

/* Stores one client's picks, dropping the key entirely when there are none:
 * an empty list is how "no picks" is written here and on the wire. */
function setPicksFor(clientId, ids) {
  const list = CoachRoadPicks.normalise(ids);
  if (list.length) roadPicks[clientId] = list;
  else delete roadPicks[clientId];
  save(COOK_KEY.roadPicks, roadPicks);
}

/* The Road Food file, fetched the first time the Road section is opened
 * rather than at launch -- a coach who never marks a pick never pays for it.
 * The same copy LIFT bundles, from dugcanlift-kit; never edited here. */
let roadData = null;
let roadLoading = null;
let roadError = null;

function loadRoadFood() {
  if (roadData) return Promise.resolve(roadData);
  if (!roadLoading) {
    roadLoading = fetch('road-food.json')
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then((raw) => {
        if (!raw || !Array.isArray(raw.chains)) throw new Error('not a Road Food file');
        roadData = {
          chains: raw.chains.filter(Boolean),
          snacks: Array.isArray(raw.snacks) ? raw.snacks.filter(Boolean) : [],
        };
        roadError = null;
        return roadData;
      })
      .catch((e) => {
        // Cleared so opening the section again tries again, once there is signal.
        roadError = e;
        roadLoading = null;
        throw e;
      });
  }
  return roadLoading;
}

/* ---------------- plan link ---------------- */

/* The envelope -- deflate-raw and base64url, or 'u' for uncompressed where
 * the browser has no CompressionStream -- lives in prescriptions.js as
 * `pack`, beside the workout encoding, so node can run the whole encoder. */

/* Builds the link for one client's week.
 *
 * Recipes ride inline, but only the ones this plan actually uses, and only the
 * fields needed to cook and log them. That is what keeps a month of dinners
 * inside a link an email client will not mangle.
 */
async function encodePlan(clientId) {
  const payload = planPayload(clientId);
  if (!payload) return null;
  // 'u' is the uncompressed fallback the decoder already understands, for
  // browsers without CompressionStream.
  const body = await CoachPrescriptions.pack(JSON.stringify(payload));
  return `${LIFT_URL}#1${body}`;
}

/* The same link, recorded as it goes.
 *
 * Every way of sending a plan goes through here, and `encodePlan` alone stays
 * side-effect-free -- the size note under the buttons re-encodes on every
 * render, and recording from there would file a plan nobody sent.
 *
 * Recorded when the coach asks for the link, not when a client receives one:
 * the clipboard and a mail app are both past where this page can see, and no
 * platform sees into either. A plan a coach copied and did not send may be
 * recorded, which is the accepted cost; the card says so in its own words and
 * never claims the link arrived. An abandoned copy is re-copied identically a
 * moment later, and the hash reads that as one plan rather than two. */
async function sendPlan(clientId) {
  const payload = planPayload(clientId);
  if (!payload) return null;
  const body = await CoachPrescriptions.pack(JSON.stringify(payload));
  await recordSentPlan(clientId, payload);
  return `${LIFT_URL}#1${body}`;
}

async function recordSentPlan(clientId, payload) {
  try {
    sentPlans = CoachPlanLog.record(sentPlans, {
      id: newId(),
      clientId,
      sentAt: Math.floor(Date.now() / 1000),
      payloadHash: await CoachPlanLog.hash(payload),
      payload,
    });
    save(PLAN_KEY.sentPlans, sentPlans);
  } catch (e) {
    // A record that cannot be written must never stop a plan being sent.
    console.warn('could not record the sent plan', e);
  }
}

function planPayload(clientId) {
  const client = clients.find((c) => c.id === clientId);
  const mine = plans.filter((p) => p.clientId === clientId);
  const myTraining = sessions.filter((k) => k.clientId === clientId);
  // Road picks ride in the same link, and are a send of their own: a coach
  // whose only answer this week is "these are fine on the road" has something
  // to send. Meals and training stay independent of each other as before.
  const picks = CoachRoadPicks.wire(picksFor(clientId));
  if (!client || (!mine.length && !myTraining.length && !picks)) return null;

  const used = [...new Set(mine.map((m) => m.recipeId))];
  const index = {};
  const inline = [];
  used.forEach((id) => {
    const r = recipeById(id);
    if (!r) return;
    index[id] = inline.length;
    // `u` per serving, omitted when no macro was entered -- a zero would
    // become a zero-calorie dinner in the client's day total -- and `ux`
    // when any of saturated fat, sugar and sodium is known.
    inline.push(CoachRecipeNutrition.planRecipe(r, CoachNutrients.row));
  });

  // Workout templates ride inline the same way recipes do, and for the same
  // reason: only the ones this plan actually schedules.
  const usedWorkouts = [...new Set(myTraining.map((k) => k.workoutId))];
  const workoutIndex = {};
  const inlineWorkouts = [];
  usedWorkouts.forEach((id) => {
    const w = workoutById(id);
    if (!w) return;
    workoutIndex[id] = inlineWorkouts.length;
    // Sides ride as `b: 1` on an each-side exercise and a sixth tuple
    // position on a set that names one; both are absent otherwise, so a plan
    // with neither is the same bytes it always was. See prescriptions.js.
    inlineWorkouts.push(CoachPrescriptions.workoutWire(w));
  });

  const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  const payload = {
    v: 1,
    t: 'plan',
    l: client.id,
    n: settings.name || '',
    r: inline,
    m: mine
      .filter((p) => index[p.recipeId] !== undefined)
      .map((p) => ({ d: p.date, s: MEALS.indexOf(p.meal), x: index[p.recipeId], q: p.servings })),
  };

  if (inlineWorkouts.length) {
    payload.w = inlineWorkouts;
    payload.k = myTraining
      .filter((k) => workoutIndex[k.workoutId] !== undefined)
      .map((k) => ({ d: k.date, x: workoutIndex[k.workoutId] }));
  }

  // `rf` is a flat list of Road Food item ids, left out entirely when there
  // are none. Nothing is dropped here for being absent from this app's copy
  // of the file: the client's build is the only one that can say what it has,
  // and it skips an id it does not know. See PLAN-FORMAT.md "Road picks".
  if (picks) payload.rf = picks;

  return payload;
}

/* Builds a link carrying a recipe or a workout on its own, with nothing
 * booked into a day.
 *
 * Same envelope and same addressing as a week — the only difference is the
 * absence of `m` and `k`, which the receiving app reads as "file this, don't
 * schedule it". */
async function encodeLibrary(clientId, { recipeIds = [], workoutIds = [] }) {
  const client = clients.find((c) => c.id === clientId);
  if (!client || (!recipeIds.length && !workoutIds.length)) return null;

  const payload = {
    v: 1,
    t: 'plan',
    l: client.id,
    n: settings.name || '',
  };

  const inlineRecipes = recipeIds.map(recipeById).filter(Boolean)
    .map((r) => CoachRecipeNutrition.planRecipe(r, CoachNutrients.row));
  if (inlineRecipes.length) payload.r = inlineRecipes;

  const inlineWorkouts = workoutIds.map(workoutById).filter(Boolean)
    .map(CoachPrescriptions.workoutWire);
  if (inlineWorkouts.length) payload.w = inlineWorkouts;

  const body = await CoachPrescriptions.pack(JSON.stringify(payload));
  return `${LIFT_URL}#1${body}`;
}

/* One panel for "send just this", used by both recipes and workouts. A coach
 * with several clients has to say who it is for; a plan is addressed. */
function openSendPanel(title, describe, build) {
  const panel = $('#send-one');
  $('#send-one-title').textContent = title;
  $('#send-one-what').textContent = describe;

  const select = $('#send-one-client');
  select.innerHTML = '';
  clients.forEach((client) => {
    const option = document.createElement('option');
    option.value = client.id;
    option.textContent = client.name;
    select.appendChild(option);
  });

  const note = $('#send-one-note');
  if (!clients.length) {
    note.textContent = 'No clients yet. A plan is addressed to one person, so add a client first.';
    $('#send-one-copy').disabled = true;
    $('#send-one-mail').disabled = true;
  } else {
    note.textContent = '';
    $('#send-one-copy').disabled = false;
    $('#send-one-mail').disabled = false;
  }

  $('#send-one-copy').onclick = async () => {
    const link = await build(select.value);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      $('#send-one-copy').textContent = 'Copied';
      setTimeout(() => { $('#send-one-copy').textContent = 'Copy link'; }, 1500);
    } catch (e) {
      alert('Copying was blocked by the browser.');
    }
  };

  $('#send-one-mail').onclick = async () => {
    const link = await build(select.value);
    if (!link) return;
    const client = clients.find((c) => c.id === select.value);
    const who = settings.name || 'your coach';
    const subject = encodeURIComponent(`${title} from ${who}`);
    const body = encodeURIComponent(
      `${client ? client.name : 'Hi'},\n\n${describe}. Open this on your phone `
      + `and LIFT will keep it for you.\n\n${link}\n\n`
      + `Nothing in that link goes to a server.\n\n${who}\n`);
    location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  panel.classList.remove('hidden');
  panel.scrollIntoView({ block: 'nearest' });
}

$('#send-one-cancel').onclick = () => $('#send-one').classList.add('hidden');

/* ---------------- COOK views ---------------- */

let cookSection = 'recipes';
let editingRecipeId = null;
let planClientId = null;

/* A recipe's weight unit is the coach's display preference: grams or ounces,
 * never a volume, because a cup of oil and a cup of flour are not the same
 * mass. Kept apart from `settings.unit`, which is for a client's bodyweight.
 * The model is always grams. Same factor as LIFT web's food-amount.js and
 * ServingUnit in the iOS and Android builds. */
const RECIPE_WEIGHT_UNITS = {
  grams: { key: 'grams', label: 'Grams', abbreviation: 'g',
           toGrams: (v) => v, fromGrams: (g) => g },
  ounces: { key: 'ounces', label: 'Ounces', abbreviation: 'oz',
            toGrams: (v) => v * 28.3495, fromGrams: (g) => g / 28.3495 },
};
const recipeWeightUnit = () => RECIPE_WEIGHT_UNITS[settings.recipeWeightUnit] || RECIPE_WEIGHT_UNITS.grams;
const roundOne = (v) => Math.round(v * 10) / 10;

/* The typed weight in grams, or null when blank or not a positive number. Null
 * is a real answer: an unweighed recipe keeps planning by servings. */
function recipeWeightGrams() {
  const typed = parseFloat($('#r-weight').value);
  if (!isFinite(typed) || typed <= 0) return null;
  return recipeWeightUnit().toGrams(typed);
}

/* Unit chips. Switching carries the weight across through grams rather than
 * relabelling the number, so 1200 g becomes 42.3 oz and never 1200 oz. */
function renderRecipeWeightUnit() {
  chipRow($('#r-weight-mode'),
    Object.values(RECIPE_WEIGHT_UNITS),
    (u) => u.key === recipeWeightUnit().key,
    (u) => {
      const before = recipeWeightGrams();
      settings.recipeWeightUnit = u.key;
      save(KEY.settings, settings);
      if (before) $('#r-weight').value = roundOne(recipeWeightUnit().fromGrams(before));
      renderRecipeWeightUnit();
    });
  $('#r-weight-label').textContent = `Total weight (${recipeWeightUnit().abbreviation})`;
  renderRecipeWeightEach();
}

/* "4 servings · 300 g each", when both numbers are known. */
function renderRecipeWeightEach() {
  const grams = recipeWeightGrams();
  const count = parseFloat($('#r-servings').value);
  const out = $('#r-weight-each');
  if (!grams || !(count > 0)) { out.textContent = ''; return; }
  const unit = recipeWeightUnit();
  out.textContent = `${count} serving${count === 1 ? '' : 's'} \u00B7 `
    + `${roundOne(unit.fromGrams(grams / count))} ${unit.abbreviation} each`;
}

function renderCook() {
  chipRow($('#cook-sections'),
    [{ label: 'Recipes', v: 'recipes' }, { label: 'Plan', v: 'plan' },
     { label: 'Shopping', v: 'shopping' }, { label: 'Road', v: 'road' }],
    (i) => i.v === cookSection,
    (i) => { cookSection = i.v; $('#recipe-form').classList.add('hidden'); renderCook(); });

  $('#cook-recipes').classList.toggle('hidden', cookSection !== 'recipes');
  $('#cook-plan').classList.toggle('hidden', cookSection !== 'plan');
  $('#cook-shopping').classList.toggle('hidden', cookSection !== 'shopping');
  $('#cook-road').classList.toggle('hidden', cookSection !== 'road');

  if (cookSection === 'recipes') renderCookRecipes();
  if (cookSection === 'plan') renderCookPlan();
  if (cookSection === 'shopping') renderCookShopping();
  if (cookSection === 'road') renderCookRoad();
}

function chipRow(container, items, isOn, onPick) {
  container.innerHTML = '';
  items.forEach((item) => {
    const b = document.createElement('button');
    b.className = 'chip' + (isOn(item) ? ' on' : '');
    b.textContent = item.label;
    b.onclick = () => onPick(item);
    container.appendChild(b);
  });
}

function cookEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function renderCookRecipes() {
  const list = $('#recipe-list');
  list.innerHTML = '';

  if (!recipes.length) {
    list.appendChild(cookEl('p', 'muted',
      'No recipes yet. Write the ones you actually give clients — the plan and '
      + 'their shopping list build themselves from here.'));
    return;
  }

  [...recipes].sort((a, b) => a.name.localeCompare(b.name)).forEach((r) => {
    const card = cookEl('div', 'card');
    card.appendChild(cookEl('strong', null, r.name));
    card.appendChild(cookEl('p', 'muted', servingsLabel(r.servings)));

    const n = r.nutritionPerServing;
    card.appendChild(cookEl('p', 'muted', CoachRecipeNutrition.hasMacros(n)
      ? `${trimNum(n.calories)} kcal  P ${trimNum(n.proteinG)}  C ${trimNum(n.carbsG)}  F ${trimNum(n.fatG)}`
      : 'Macros not set'));
    const detail = CoachNutrients.foodLine(n);
    if (detail) card.appendChild(cookEl('p', 'muted', `${detail} a serving`));

    if ((r.ingredients || []).length) {
      card.appendChild(cookEl('p', 'muted',
        `${r.ingredients.length} ingredient${r.ingredients.length === 1 ? '' : 's'}`));
    }

    const send = cookEl('button', 'chip', 'Send');
    send.onclick = (event) => {
      event.stopPropagation();
      openSendPanel(r.name, `The recipe "${r.name}"`,
        (clientId) => encodeLibrary(clientId, { recipeIds: [r.id] }));
    };
    card.appendChild(send);

    card.onclick = () => openRecipeForm(r.id);
    list.appendChild(card);
  });
}

const RECIPE_DETAIL_INPUTS = { saturatedFatG: '#r-sat', sugarG: '#r-sugar', sodiumMg: '#r-sodium' };

function openRecipeForm(id) {
  editingRecipeId = id;
  const r = id ? recipeById(id) : null;
  $('#r-name').value = r ? r.name : '';
  $('#r-servings').value = r ? r.servings : 4;
  // Grams on the recipe, the coach's preferred unit on screen.
  $('#r-weight').value = r && r.totalWeightGrams > 0
    ? roundOne(recipeWeightUnit().fromGrams(r.totalWeightGrams))
    : '';
  renderRecipeWeightUnit();
  $('#r-ingredients').value = r ? (r.ingredients || []).map((i) => i.rawText).join('\n') : '';
  $('#r-steps').value = r ? (r.steps || []).join('\n') : '';
  const n = r && r.nutritionPerServing;
  // Five zeros are placeholders on a recipe that holds only saturated fat,
  // sugar or sodium, and reopen blank rather than as a zero-calorie dish.
  const macros = CoachRecipeNutrition.hasMacros(n);
  $('#r-cal').value = macros ? n.calories : '';
  $('#r-p').value = macros ? n.proteinG : '';
  $('#r-c').value = macros ? n.carbsG : '';
  $('#r-f').value = macros ? n.fatG : '';
  // Fibre is often absent on a recipe that has the other four, so a blank
  // stays blank rather than showing a zero nobody measured.
  $('#r-fib').value = n && n.fiberG ? n.fiberG : '';
  $('#r-delete').classList.toggle('hidden', !r);

  // A recipe already carrying macros counts as typed: reopening it to add one
  // more ingredient must not throw away numbers that were already right.
  ['#r-cal', '#r-p', '#r-c', '#r-f'].forEach((selector) => {
    $(selector).dataset.typed = macros ? '1' : '';
  });
  // Fibre counts as typed only when the recipe actually has some. A recipe
  // without it leaves the field open to the ingredient tally rather than
  // pinning it to a blank nobody chose.
  $('#r-fib').dataset.typed = n && n.fiberG ? '1' : '';
  // Saturated fat, sugar and sodium the same way, one at a time: a known
  // value is kept, an unknown one stays open to the tally.
  const known = CoachNutrients.details(n);
  Object.entries(RECIPE_DETAIL_INPUTS).forEach(([key, selector]) => {
    $(selector).value = known[key] == null ? '' : known[key];
    $(selector).dataset.typed = known[key] == null ? '' : '1';
  });
  ingredientTally = null;
  $('#ing-query').value = '';
  $('#ing-results').innerHTML = '';
  $('#ing-tally').textContent = '';

  // Any in-flight import costing belongs to the form it opened, not this one.
  importRun++;
  showRecipeForm();
}

/* Unhides the editor and brings it on screen. Every way in needs both: the
 * form sits below the recipe list at every width, so a form that is only
 * unhidden -- or only filled -- can be a full list's height out of sight. The
 * import once filled it without opening it at all, and a recipe it found was
 * invisible unless the coach happened to have pressed New recipe first. */
function showRecipeForm() {
  const form = $('#recipe-form');
  form.classList.remove('hidden');
  form.scrollIntoView({ block: 'start' });
  $('#r-name').focus({ preventScroll: true });
}

$('#recipe-new').onclick = () => openRecipeForm(null);
$('#r-cancel').onclick = () => {
  $('#recipe-form').classList.add('hidden');
  editingRecipeId = null;
};

$('#r-delete').onclick = () => {
  if (!editingRecipeId) return;
  recipes = recipes.filter((r) => r.id !== editingRecipeId);
  plans = plans.filter((p) => p.recipeId !== editingRecipeId);
  save(COOK_KEY.recipes, recipes);
  save(COOK_KEY.plans, plans);
  $('#recipe-form').classList.add('hidden');
  editingRecipeId = null;
  renderCook();
};

$('#r-save').onclick = () => {
  const name = $('#r-name').value.trim();
  if (!name) return;

  const num = (sel) => {
    const raw = $(sel).value.trim();
    return raw === '' ? null : parseFloat(raw);
  };
  const typed = [num('#r-cal'), num('#r-p'), num('#r-c'), num('#r-f'), num('#r-fib')];
  // Null unless something was typed. An untouched form must not write zeros.
  //
  // Fibre used to be hard-coded to 0 here because there was no field for it,
  // so a recipe that arrived carrying fibre lost it the first time anyone
  // opened it and pressed Save. Sugar and sodium went the same way until the
  // merge moved to recipe-nutrition.js, which carries every key the form
  // does not show.
  const existing = editingRecipeId
    ? (recipes.find((r) => r.id === editingRecipeId) || {}).nutritionPerServing
    : null;
  // Saturated fat, sugar and sodium are form fields; blank removes them.
  const details = {};
  Object.entries(RECIPE_DETAIL_INPUTS).forEach(([key, selector]) => {
    details[key] = CoachNutrients.parseField($(selector).value);
  });
  const nutrition = CoachRecipeNutrition.mergeNutrition(typed, existing, details);

  const lines = (sel) => $(sel).value.split('\n').map((l) => l.trim()).filter(Boolean);
  const servings = parseFloat($('#r-servings').value) || 1;

  const body = {
    name,
    servings: servings > 0 ? servings : 1,
    ingredients: lines('#r-ingredients').map(parseIngredient),
    steps: lines('#r-steps'),
    nutritionPerServing: nutrition,
    // Written even when null, so clearing the field on an existing recipe
    // clears it -- the spread over the old recipe would otherwise keep it.
    totalWeightGrams: recipeWeightGrams(),
  };

  if (editingRecipeId) {
    recipes = recipes.map((r) => (r.id === editingRecipeId ? { ...r, ...body } : r));
  } else {
    recipes.push({ id: cookUid(), ...body });
  }

  save(COOK_KEY.recipes, recipes);
  $('#recipe-form').classList.add('hidden');
  editingRecipeId = null;
  renderCook();
};

function renderCookPlan() {
  const select = $('#plan-client');
  select.innerHTML = '';

  if (!clients.length) {
    $('#plan-note').textContent =
      'No clients yet. A plan is addressed to one person, so add a client first.';
    $('#plan-days').innerHTML = '';
    $('#plan-send-card').classList.add('hidden');
    return;
  }

  clients.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    select.appendChild(o);
  });

  if (!planClientId || !clients.some((c) => c.id === planClientId)) {
    planClientId = clients[0].id;
  }
  select.value = planClientId;
  select.onchange = () => { planClientId = select.value; renderCook(); };

  // Road picks travel in the same link, so a coach who has only marked those
  // still has something to send.
  const picked = picksFor(planClientId).length;
  $('#plan-note').textContent = recipes.length
    ? 'Plans go to this client only. Their app refuses a plan addressed to anyone else.'
    : (picked
      ? 'No recipes yet. The road picks you marked still go in the link.'
      : 'Write a recipe first — the plan is built from them.');
  $('#plan-send-card').classList.toggle('hidden', !recipes.length && !picked);

  const wrap = $('#plan-days');
  wrap.innerHTML = '';
  if (!recipes.length) { updatePlanSize(); return; }

  const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  cookWeek().forEach((day) => {
    const card = cookEl('div', 'card');
    card.appendChild(cookEl('strong', null, dayLabel(day)));

    MEALS.forEach((meal) => {
      const forSlot = plans.filter(
        (p) => p.clientId === planClientId && p.date === day && p.meal === meal);
      const row = cookEl('div', 'row planrow');
      row.appendChild(cookEl('span', 'muted', meal.charAt(0) + meal.slice(1).toLowerCase()));

      if (!forSlot.length) {
        const add = cookEl('button', 'chip', 'Add');
        add.onclick = () => addPlannedMeal(day, meal);
        row.appendChild(add);
      } else {
        forSlot.forEach((p) => {
          // The meal and its Remove travel together, so a narrow screen wraps
          // them as one unit instead of stranding the button under the label.
          const line = cookEl('div', 'planmeal');
          line.appendChild(cookEl('span', null,
            `${p.recipeName} · ${servingsLabel(p.servings)}`));
          const rm = cookEl('button', 'chip', 'Remove');
          rm.onclick = () => {
            plans = plans.filter((x) => x.id !== p.id);
            save(COOK_KEY.plans, plans);
            renderCook();
          };
          line.appendChild(rm);
          row.appendChild(line);
        });
      }
      card.appendChild(row);
    });

    wrap.appendChild(card);
  });

  updatePlanSize();
}

/* Two browser dialogs to place one dinner was the roughest edge in here, and
 * it sat in the path a coach walks most. This is the same choice made in the
 * page, where the servings you pick are reflected in the calories on every
 * row before you commit to one. */
function addPlannedMeal(day, meal) {
  const panel = $('#picker');
  $('#picker-title').textContent =
    `${dayLabel(day)} · ${meal.charAt(0) + meal.slice(1).toLowerCase()}`;
  $('#picker-servings').value = '1';
  panel.classList.remove('hidden');
  panel.scrollIntoView({ block: 'nearest' });

  const draw = () => {
    const servings = parseFloat($('#picker-servings').value) || 1;
    const list = $('#picker-list');
    list.innerHTML = '';
    [...recipes].sort((a, b) => a.name.localeCompare(b.name)).forEach((r) => {
      const row = cookEl('button', 'chip wide');
      const n = r.nutritionPerServing;
      row.textContent = CoachRecipeNutrition.hasMacros(n)
        ? `${r.name} — ${Math.round(n.calories * servings)} kcal`
        : r.name;
      row.onclick = () => {
        plans.push({
          id: cookUid(),
          clientId: planClientId,
          recipeId: r.id,
          recipeName: r.name,
          date: day,
          meal,
          servings,
        });
        save(COOK_KEY.plans, plans);
        panel.classList.add('hidden');
        renderCook();
      };
      list.appendChild(row);
    });
  };

  $('#picker-servings').oninput = draw;
  draw();
}

$('#picker-cancel').onclick = () => $('#picker').classList.add('hidden');

/* Mail clients wrap and corrupt very long links. The same 16k ceiling the
 * outbound log format works to applies here. */
const RISKY_LINK_LENGTH = 16000;

/* What is actually in this client's plan, in words. The email says it and the
 * import screen on the other end repeats it, which is what makes a client
 * running an older LIFT — one that reads meals but not training — a visible
 * mismatch rather than a silent loss. */
function planContents(clientId) {
  const meals = plans.filter((p) => p.clientId === clientId).length;
  const trained = sessions.filter((k) => k.clientId === clientId).length;
  const picks = picksFor(clientId).length;
  const parts = [];
  if (meals) parts.push(`${meals} meal${meals === 1 ? '' : 's'}`);
  if (trained) parts.push(`${trained} session${trained === 1 ? '' : 's'}`);
  if (picks) parts.push(`${picks} road pick${picks === 1 ? '' : 's'}`);
  if (parts.length < 3) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function mailPlan(clientId, link) {
  const client = clients.find((c) => c.id === clientId);
  const who = settings.name || 'your coach';
  const contents = planContents(clientId);
  const meals = plans.filter((p) => p.clientId === clientId).length;

  const subject = encodeURIComponent(`Your week from ${who}`);
  const body = encodeURIComponent(
    `${client ? client.name : 'Hi'},\n\n`
    + `Here's your week — ${contents}. Open this on your phone and LIFT will `
    + `take it in`
    + (meals ? `, shopping list and all` : '')
    + `.\n\n${link}\n\n`
    + `Nothing in that link goes to a server. It travels in the part of the `
    + `address browsers never send.\n\n${who}\n`);
  location.href = `mailto:?subject=${subject}&body=${body}`;
}

async function updatePlanSize() {
  const link = await encodePlan(planClientId);
  const note = $('#plan-size');
  if (!link) {
    note.textContent = 'Nothing planned for this client yet.';
    return;
  }
  const kb = (link.length / 1024).toFixed(1);
  note.textContent = `${planContents(planClientId)} · ` + (link.length > RISKY_LINK_LENGTH
    ? `${kb} KB — long enough that some mail apps will break it. Send fewer days, or fewer recipes with long ingredient lists.`
    : `${kb} KB — comfortably inside what an email will carry.`);
}

$('#plan-copy').onclick = async () => {
  const link = await sendPlan(planClientId);
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    $('#plan-copy').textContent = 'Copied';
    setTimeout(() => { $('#plan-copy').textContent = 'Copy plan link'; }, 1500);
  } catch (e) {
    alert('Copying was blocked by the browser. The link is:\n\n' + link);
  }
};

$('#plan-mail').onclick = async () => {
  const link = await sendPlan(planClientId);
  if (!link) return;
  mailPlan(planClientId, link);
};

/* ---------------- road picks ----------------
 *
 * The items a coach is happy with at the places a client stops on the road.
 *
 * In Cook, beside the week and the shopping list, rather than on the client's
 * page: that page is a record of what a client did, and this is something the
 * coach makes for them -- addressed to one person and sent in the same plan
 * link as the rest of Cook. Train would have been the other candidate and is
 * the wrong half of the app; this is food.
 *
 * A pick says "this fits how I want you eating on the road" and nothing about
 * calories or macros: LIFT already ranks Road Food against what is left of the
 * client's day, and a pick floats to the top of that list, labelled, without
 * re-ranking the numbers underneath or hiding anything that fits. Nothing here
 * or there judges what a client ate against what was picked.
 */

/* Which place cards are open, so ticking an item does not fold them all up
 * when the section re-renders. */
let roadOpenPlaces = {};

function renderCookRoad() {
  const select = $('#road-client');
  const body = $('#road-body');
  select.innerHTML = '';
  body.innerHTML = '';

  if (!clients.length) {
    $('#road-note').textContent =
      'No clients yet. Picks are made for one person, so add a client first.';
    return;
  }

  clients.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    select.appendChild(o);
  });
  if (!planClientId || !clients.some((c) => c.id === planClientId)) {
    planClientId = clients[0].id;
  }
  select.value = planClientId;
  select.onchange = () => { planClientId = select.value; renderCook(); };

  $('#road-note').textContent = 'Marked here, sent with the plan link. In LIFT they '
    + 'sit at the top of that place’s list, named as yours. The ranking underneath '
    + 'is unchanged, and nothing that fits is hidden.';

  if (!roadData) {
    if (roadError) {
      const card = cookEl('div', 'card');
      card.appendChild(cookEl('p', null, 'The Road Food list could not load.'));
      card.appendChild(cookEl('p', 'muted', `It is part of the app, so this is either a `
        + `connection that dropped before it was cached or a bad install (${roadError.message}).`));
      const retry = cookEl('button', 'ghost wide', 'Try again');
      retry.onclick = () => { roadError = null; loadRoadFood().then(renderCook, renderCook); renderCook(); };
      card.appendChild(retry);
      body.appendChild(card);
      return;
    }
    body.appendChild(cookEl('p', 'muted', 'Loading the Road Food list…'));
    loadRoadFood().then(renderCook, renderCook);
    return;
  }

  const ids = picksFor(planClientId);
  const client = clients.find((c) => c.id === planClientId);
  const summary = CoachRoadPicks.summary(ids, roadData);
  const head = cookEl('div', 'card');
  head.appendChild(cookEl('div', null, summary
    ? `${summary} picked for ${client ? client.name : 'this client'}.`
    : `Nothing picked for ${client ? client.name : 'this client'} yet.`));
  const missing = CoachRoadPicks.missing(ids, roadData);
  if (missing.length) {
    // A pick for an item this copy of the file no longer lists. It still
    // travels: the client's app is the one that knows what its own menus hold,
    // and it skips what it cannot find rather than drawing a broken row.
    head.appendChild(cookEl('p', 'muted',
      `${missing.length} more ${missing.length === 1 ? 'pick is' : 'picks are'} not on the `
      + 'menus this copy has. They still travel; an app skips what it cannot find.'));
  }
  if (ids.length) {
    const clear = cookEl('button', 'ghost wide', 'Clear these picks');
    clear.onclick = () => {
      if (!confirm(`Clear every road pick for ${client ? client.name : 'this client'}?`)) return;
      setPicksFor(planClientId, []);
      renderCook();
    };
    head.appendChild(clear);
  }
  body.appendChild(head);

  roadData.chains.forEach((chain) => {
    body.appendChild(roadPlaceCard(chain.id, chain.name, chain.items || [], ids));
  });
  if (roadData.snacks.length) {
    const snacks = roadData.snacks.slice().sort((a, b) =>
      String(a.category || '').localeCompare(String(b.category || ''))
      || String(a.name || '').localeCompare(String(b.name || '')));
    body.appendChild(roadPlaceCard('snacks', 'Gas station', snacks, ids, true));
  }
}

/* One place: a fold with its items, each a tick. Folded by default -- eight
 * chains and twenty-two snacks is a scroll nobody asked for. */
function roadPlaceCard(placeId, name, items, ids, showCategory) {
  const card = cookEl('details', 'card roadplace');
  card.open = !!roadOpenPlaces[placeId];
  card.ontoggle = () => { roadOpenPlaces[placeId] = card.open; };

  const head = document.createElement('summary');
  head.appendChild(cookEl('span', null, name));
  const picked = CoachRoadPicks.countIn(ids, items);
  head.appendChild(cookEl('span', 'muted',
    picked ? `${picked} of ${items.length} picked` : `${items.length} items`));
  card.appendChild(head);

  const all = cookEl('div', 'chips');
  const pickAll = cookEl('button', 'chip', 'Pick all');
  pickAll.onclick = () => {
    setPicksFor(planClientId, CoachRoadPicks.toggleAll(picksFor(planClientId), items, true));
    renderCook();
  };
  const none = cookEl('button', 'chip', 'Clear');
  none.disabled = !picked;
  none.onclick = () => {
    setPicksFor(planClientId, CoachRoadPicks.toggleAll(picksFor(planClientId), items, false));
    renderCook();
  };
  all.appendChild(pickAll);
  all.appendChild(none);
  card.appendChild(all);

  items.forEach((item) => card.appendChild(roadPickRow(item, ids, showCategory)));
  return card;
}

/* One item: the tick, the name, and the figures plainly. No colour, no
 * threshold, nothing ranked -- the ranking is the client's app's job, against
 * a day this screen knows nothing about. */
function roadPickRow(item, ids, showCategory) {
  const row = cookEl('label', 'roadpick');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = ids.indexOf(item.id) !== -1;
  box.onchange = () => {
    setPicksFor(planClientId, CoachRoadPicks.toggle(picksFor(planClientId), item.id, box.checked));
    renderCook();
  };
  row.appendChild(box);

  const text = cookEl('div', 'roadpicktext');
  text.appendChild(cookEl('div', null, item.name));
  // Blank stays blank: an item with no figure says so rather than showing 0.
  const bits = [
    item.kcal == null ? 'kcal not listed' : `${Math.round(item.kcal)} kcal`,
    item.proteinG == null ? 'protein not listed' : `P ${Math.round(item.proteinG)} g`,
  ];
  if (item.serving) bits.push(item.serving);
  if (showCategory && item.category) bits.unshift(item.category);
  text.appendChild(cookEl('div', 'muted', bits.join(' · ')));
  if (item.modification) text.appendChild(cookEl('div', 'muted', item.modification));
  row.appendChild(text);
  return row;
}

function renderCookShopping() {
  const wrap = $('#cook-shopping');
  wrap.innerHTML = '';

  const mine = plans.filter((p) => p.clientId === planClientId);
  if (!mine.length) {
    wrap.appendChild(cookEl('p', 'muted',
      'Nothing planned for this client, so there is nothing to buy yet.'));
    return;
  }

  const client = clients.find((c) => c.id === planClientId);
  wrap.appendChild(cookEl('p', 'muted',
    `What ${client ? client.name : 'this client'} needs for the week you planned. `
    + 'It goes with the plan link — you do not have to send this separately.'));

  buildShoppingList(mine, recipeById).forEach((line) => {
    const card = cookEl('div', 'card');
    card.appendChild(cookEl('div', null, line.displayName));
    if (Object.keys(line.amounts).length) {
      card.appendChild(cookEl('p', 'muted', amountsLabel(line.amounts)));
    }
    line.unparsed.forEach((raw) => card.appendChild(cookEl('p', 'muted', raw)));
    wrap.appendChild(card);
  });
}

/* ---------------- TRAIN ----------------
 *
 * The other half of the trainer's job. A coach writes workout templates,
 * schedules them across a client's week, and sends them in the same link the
 * meals ride in.
 *
 * Prescriptions use the same set shape as logged sets — see PLAN-FORMAT.md.
 * A prescription and the log that answers it being the same shape is what
 * lets "asked for" and "did" sit next to each other without transposing.
 */

/** Templates, e.g. "Lower A". Written once and scheduled many times. */
let workouts = load(TRAIN_KEY.workouts, []);
/** Scheduled sessions, each tagged with the client it is for. */
let sessions = load(TRAIN_KEY.sessions, []);

const workoutById = (id) => workouts.find((w) => w.id === id);

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/* ---------------- exercise library ---------------- */

/* 873 exercises from free-exercise-db, the same library the iOS build picks
 * from. Fetched on first use rather than at boot: a coach who only writes
 * meal plans should never pay for it. */
let exerciseLibrary = null;
let libraryError = null;

async function loadExerciseLibrary() {
  if (exerciseLibrary || libraryError) return exerciseLibrary;
  try {
    const response = await fetch('exercises.json');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const raw = await response.json();
    exerciseLibrary = raw.exercises.map(([name, muscle, equipment, category, level]) => ({
      name,
      muscle: raw.muscles[muscle] || '',
      equipment: raw.equipment[equipment] || '',
      category: raw.categories[category] || '',
      level: raw.levels[level] || '',
    }));
  } catch (e) {
    libraryError = e.message;
  }
  return exerciseLibrary;
}

/** Equipment worth a filter chip. The long tail stays reachable by typing. */
const EQUIPMENT_FILTERS = ['barbell', 'dumbbell', 'machine', 'cable', 'body only', 'kettlebells'];

function searchExercises(query, equipment) {
  if (!exerciseLibrary) return [];
  const needle = query.trim().toLowerCase();
  return exerciseLibrary
    .filter((x) => !equipment || x.equipment === equipment)
    .filter((x) => !needle
      || x.name.toLowerCase().includes(needle)
      || x.muscle.toLowerCase().includes(needle))
    .slice(0, 40);
}

/** Title case, because the library stores equipment lowercase. */
const titleCase = (text) => (text || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* ---------------- prescriptions ---------------- */

/** One line per exercise: "3 × 225 × 5", "3 × 30 × 8 each side + 1 L".
 *  The rules, and the tests, are in prescriptions.js. */
const exerciseSummary = (exercise) => CoachPrescriptions.summary(exercise);

/* ---------------- TRAIN views ---------------- */

let trainSection = 'workouts';
let editingWorkoutId = null;
/** The workout being edited, held apart from storage until Save. */
let workoutDraft = null;
let trainClientId = null;
let exerciseFilter = '';

function renderTrain() {
  chipRow($('#train-sections'),
    [{ label: 'Workouts', v: 'workouts' }, { label: 'Plan', v: 'plan' }],
    (i) => i.v === trainSection,
    (i) => {
      trainSection = i.v;
      $('#workout-form').classList.add('hidden');
      $('#exercise-picker').classList.add('hidden');
      renderTrain();
    });

  $('#train-workouts').classList.toggle('hidden', trainSection !== 'workouts');
  $('#train-plan').classList.toggle('hidden', trainSection !== 'plan');

  if (trainSection === 'workouts') renderWorkoutList();
  if (trainSection === 'plan') renderTrainPlan();
}

function renderWorkoutList() {
  const list = $('#workout-list');
  list.innerHTML = '';

  if (!workouts.length) {
    list.appendChild(cookEl('p', 'muted',
      'No workouts yet. Build one and you can schedule it across a client’s '
      + 'week as often as you like.'));
    return;
  }

  workouts.forEach((workout) => {
    const card = cookEl('div', 'card');
    card.appendChild(cookEl('strong', null, workout.name));
    const count = (workout.exercises || []).length;
    card.appendChild(cookEl('p', 'muted',
      `${count} exercise${count === 1 ? '' : 's'} · `
      + `${(workout.exercises || []).reduce((t, e) => t + (e.sets || []).length, 0)} sets`));

    (workout.exercises || []).forEach((exercise) => {
      const row = cookEl('div', 'setline');
      row.appendChild(cookEl('b', null,
        exercise.equipment ? `${exercise.name} (${exercise.equipment})` : exercise.name));
      row.appendChild(document.createTextNode(' — ' + exerciseSummary(exercise)));
      card.appendChild(row);
    });

    const edit = cookEl('button', 'chip', 'Edit');
    edit.onclick = () => openWorkoutForm(workout.id);
    card.appendChild(edit);

    const send = cookEl('button', 'chip', 'Send');
    send.onclick = () => openSendPanel(
      workout.name,
      `The workout "${workout.name}"`,
      (clientId) => encodeLibrary(clientId, { workoutIds: [workout.id] }));
    card.appendChild(send);

    list.appendChild(card);
  });
}

function openWorkoutForm(id) {
  editingWorkoutId = id;
  const existing = id ? workoutById(id) : null;
  // Deep copy: abandoning an edit must leave the stored workout untouched, and
  // the sets are nested deep enough that a shallow copy would not.
  workoutDraft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: newId(), name: '', exercises: [] };

  $('#w-name').value = workoutDraft.name;
  $('#w-delete').classList.toggle('hidden', !existing);
  $('#workout-form').classList.remove('hidden');
  $('#train-workouts').classList.add('hidden');
  renderWorkoutEditor();
  $('#workout-form').scrollIntoView({ block: 'nearest' });
}

function closeWorkoutForm() {
  editingWorkoutId = null;
  workoutDraft = null;
  $('#workout-form').classList.add('hidden');
  $('#exercise-picker').classList.add('hidden');
  $('#train-workouts').classList.remove('hidden');
  renderTrain();
}

/* ---------------- sides in the editor ----------------
 *
 * "Each side" is per exercise and means every set is done on both sides, so
 * "3 × 8 each side" stays three rows. It starts ticked when the name reads
 * unilateral -- LIFT's own guess, CoachSides.looksUnilateral -- and once the
 * coach has ticked or unticked it for a lift, that choice is what the next
 * copy of the lift starts with. Kept in settings, keyed like LIFT keys its
 * per-side preference (name|equipment), so it rides in a backup.
 *
 * A set naming a side is the asymmetric case, and the Both / L / R control
 * that sets it stays out of sight until the exercise is each side or the coach
 * asks for it with "Set a side" -- so a bench press editor looks exactly as it
 * always did. */

const eachSideKey = (exercise) =>
  `${(exercise.name || '').trim()}|${(exercise.equipment || '').trim()}`.toLowerCase();

function eachSideDefault(exercise) {
  const chosen = (settings.eachSide || {})[eachSideKey(exercise)];
  return typeof chosen === 'boolean' ? chosen : CoachSides.looksUnilateral(exercise.name);
}

function setEachSide(exercise, on) {
  if (on) exercise.eachSide = true;
  else delete exercise.eachSide;
  settings.eachSide = { ...(settings.eachSide || {}), [eachSideKey(exercise)]: on };
  saveSettings();
}

/* Exercises whose coach tapped "Set a side". Not stored: once a set names a
 * side the control stays because of that, and an untouched tap is nothing. */
const sidesAsked = new WeakSet();

const showsSides = (exercise) => exercise.eachSide === true
  || CoachSides.anySided(exercise.sets) || sidesAsked.has(exercise);

const SIDE_CHOICES = [
  { v: null, label: 'Both', name: 'Both sides' },
  { v: 'left', label: 'L', name: 'Left' },
  { v: 'right', label: 'R', name: 'Right' },
];

/** Both / L / R for one set: three buttons in a group, the pressed one filled. */
function sideControl(set, setNumber, onChange) {
  const group = cookEl('div', 'seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `Side for set ${setNumber}`);
  const current = CoachSides.of(set);
  SIDE_CHOICES.forEach((choice) => {
    const button = cookEl('button', null, choice.label);
    button.type = 'button';
    button.setAttribute('aria-label', choice.name);
    button.setAttribute('aria-pressed', String(current === choice.v));
    button.onclick = () => {
      if (choice.v) set.side = choice.v;
      else delete set.side;
      onChange();
    };
    group.appendChild(button);
  });
  return group;
}

/* The set editor.
 *
 * Every field is optional on purpose: "five reps, you pick the weight" is a
 * real prescription, and so is a ten-minute row with no reps at all. Blank
 * means unprescribed, never zero. */
function renderWorkoutEditor(focusAfter) {
  const wrap = $('#w-exercises');
  wrap.innerHTML = '';
  if (!workoutDraft) return;

  workoutDraft.exercises.forEach((exercise, exerciseIndex) => {
    const card = cookEl('div', 'card');

    const head = cookEl('div', 'statline');
    head.appendChild(cookEl('strong', null,
      exercise.equipment ? `${exercise.name} (${exercise.equipment})` : exercise.name));
    const remove = cookEl('button', 'chip', 'Remove');
    remove.onclick = () => {
      workoutDraft.exercises.splice(exerciseIndex, 1);
      renderWorkoutEditor();
    };
    head.appendChild(remove);
    card.appendChild(head);

    // What the exercise asks for, in words: "3 × 30 × 8 each side + 1 L".
    // Kept current as the numbers are typed, not only on the next render.
    const summary = cookEl('p', 'muted', exerciseSummary(exercise));
    const resummarise = () => { summary.textContent = exerciseSummary(exercise); };
    card.appendChild(summary);

    const each = exercise.eachSide === true;
    const toggle = cookEl('button', 'chip' + (each ? ' on' : ''), 'Each side');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', String(each));
    toggle.title = each
      ? 'Every set is done on both sides'
      : 'Count these sets once for each side';
    toggle.onclick = () => {
      setEachSide(exercise, !each);
      renderWorkoutEditor({ exercise: exerciseIndex, control: 'each' });
    };
    toggle.dataset.focus = `${exerciseIndex}:each`;
    const sideRow = cookEl('div', 'chips');
    sideRow.appendChild(toggle);
    card.appendChild(sideRow);

    const sided = showsSides(exercise);
    const table = cookEl('table', 'grid sets');
    const header = cookEl('tr');
    ['Set', 'lb', 'Reps', 'RPE', ...(sided ? ['Side'] : []), '']
      .forEach((h) => header.appendChild(cookEl('th', h === 'Side' ? 'side-col' : null, h)));
    table.appendChild(header);

    exercise.sets.forEach((set, setIndex) => {
      const row = cookEl('tr');
      row.appendChild(cookEl('td', null, String(setIndex + 1)));

      [['weightLb', 'any'], ['reps', '1'], ['rpe', '0.5']].forEach(([field, step]) => {
        const cell = cookEl('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.step = step;
        input.className = 'cell';
        input.value = set[field] == null ? '' : set[field];
        input.oninput = () => {
          const raw = input.value.trim();
          set[field] = raw === '' ? null : parseFloat(raw);
          resummarise();
        };
        cell.appendChild(input);
        row.appendChild(cell);
      });

      // The side control sits in its own column where there is room for one,
      // and on a line of its own under the set at phone width, where a fifth
      // column would squeeze the numbers to nothing. Only one of the two is
      // ever displayed (style.css), so only one is ever in the tab order.
      const sideFor = () => {
        const control = sideControl(set, setIndex + 1, () =>
          renderWorkoutEditor({ exercise: exerciseIndex, control: `side${setIndex}` }));
        control.dataset.focus = `${exerciseIndex}:side${setIndex}`;
        return control;
      };
      if (sided) {
        const cell = cookEl('td', 'side-col');
        cell.appendChild(sideFor());
        row.appendChild(cell);
      }

      const last = cookEl('td');
      const drop = cookEl('button', 'chip', '×');
      drop.onclick = () => { exercise.sets.splice(setIndex, 1); renderWorkoutEditor(); };
      last.appendChild(drop);
      row.appendChild(last);
      table.appendChild(row);

      if (sided) {
        row.classList.add('has-side-sub');
        const sub = cookEl('tr', 'side-sub');
        sub.appendChild(cookEl('td'));
        const cell = cookEl('td');
        cell.colSpan = 4;
        cell.appendChild(sideFor());
        sub.appendChild(cell);
        table.appendChild(sub);
      }
    });

    const scroll = cookEl('div', 'scroll-x');
    scroll.appendChild(table);
    card.appendChild(scroll);

    const addSet = cookEl('button', 'chip', 'Add set');
    addSet.onclick = () => {
      // A new set copies the one above it. Prescriptions repeat far more often
      // than they vary, and a ramp is quicker to edit than to retype.
      const previous = exercise.sets[exercise.sets.length - 1];
      exercise.sets.push(previous ? { ...previous } : {
        weightLb: null, reps: null, rpe: null, durationSec: null, distanceM: null,
      });
      renderWorkoutEditor();
    };
    const actions = cookEl('div', 'chips');
    actions.appendChild(addSet);
    if (!sided) {
      const ask = cookEl('button', 'chip', 'Set a side');
      ask.type = 'button';
      ask.title = 'Mark a set as left or right only';
      ask.onclick = () => {
        sidesAsked.add(exercise);
        renderWorkoutEditor({ exercise: exerciseIndex, control: 'side0' });
      };
      actions.appendChild(ask);
    }
    card.appendChild(actions);

    const note = document.createElement('input');
    note.type = 'text';
    note.placeholder = 'Note for this exercise (optional)';
    note.value = exercise.note || '';
    note.oninput = () => { exercise.note = note.value; };
    card.appendChild(note);

    wrap.appendChild(card);
  });

  // A tap re-renders the editor, which would drop keyboard focus onto the
  // page. Put it back on the control that was used, or its replacement.
  if (focusAfter) {
    const target = [...wrap.querySelectorAll(`[data-focus="${focusAfter.exercise}:${focusAfter.control}"]`)]
      .find((node) => node.offsetParent !== null);
    const button = target && (target.matches('button') ? target
      : target.querySelector('[aria-pressed="true"]') || target.querySelector('button'));
    if (button) button.focus({ preventScroll: true });
  }
}

/* ---------------- exercise picker ---------------- */

async function openExercisePicker() {
  const panel = $('#exercise-picker');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ block: 'nearest' });
  $('#ex-query').value = '';
  $('#ex-results').innerHTML = '';
  $('#ex-results').appendChild(cookEl('p', 'muted', 'Loading the exercise library…'));

  await loadExerciseLibrary();
  renderExercisePicker();
  $('#ex-query').focus();
}

function renderExercisePicker() {
  const results = $('#ex-results');
  results.innerHTML = '';

  if (libraryError) {
    results.appendChild(cookEl('p', 'muted',
      `Could not load the exercise library (${libraryError}). You can still type `
      + 'an exercise name by hand.'));
    return;
  }

  chipRow($('#ex-filters'),
    [{ label: 'All', v: '' }, ...EQUIPMENT_FILTERS.map((e) => ({ label: titleCase(e), v: e }))],
    (i) => i.v === exerciseFilter,
    (i) => { exerciseFilter = i.v; renderExercisePicker(); });

  const hits = searchExercises($('#ex-query').value, exerciseFilter);
  if (!hits.length) {
    results.appendChild(cookEl('p', 'muted', 'Nothing matches that.'));
    return;
  }

  hits.forEach((hit) => {
    const row = cookEl('button', 'chip wide');
    row.textContent = `${hit.name} — ${hit.muscle}`
      + (hit.equipment ? `, ${hit.equipment}` : '');
    row.onclick = () => {
      const exercise = {
        name: hit.name,
        equipment: titleCase(hit.equipment),
        note: '',
        // One set to start, so there is something to edit rather than an
        // exercise with nothing under it.
        sets: [{ weightLb: null, reps: null, rpe: null, durationSec: null, distanceM: null }],
      };
      // Pre-ticked when the name reads unilateral, or as the coach last left
      // this lift. Absent when not, as it is stored and sent.
      if (eachSideDefault(exercise)) exercise.eachSide = true;
      workoutDraft.exercises.push(exercise);
      $('#exercise-picker').classList.add('hidden');
      renderWorkoutEditor();
    };
    results.appendChild(row);
  });
}

/* ---------------- the training week ---------------- */

function renderTrainPlan() {
  const select = $('#tplan-client');
  select.innerHTML = '';

  if (!clients.length) {
    $('#tplan-note').textContent =
      'No clients yet. A plan is addressed to one person, so add a client first.';
    $('#tplan-days').innerHTML = '';
    $('#tplan-send-card').classList.add('hidden');
    return;
  }

  clients.forEach((client) => {
    const option = document.createElement('option');
    option.value = client.id;
    option.textContent = client.name;
    select.appendChild(option);
  });

  if (!trainClientId || !clients.some((c) => c.id === trainClientId)) {
    trainClientId = clients[0].id;
  }
  select.value = trainClientId;
  select.onchange = () => { trainClientId = select.value; renderTrain(); };

  $('#tplan-note').textContent = workouts.length
    ? 'One link carries this client’s meals and training together — sending from '
      + 'here or from Cook produces the same link.'
    : 'Build a workout first — the week is scheduled from them.';
  $('#tplan-send-card').classList.toggle('hidden', !workouts.length);

  const wrap = $('#tplan-days');
  wrap.innerHTML = '';
  if (!workouts.length) return;

  cookWeek().forEach((day) => {
    const card = cookEl('div', 'card');
    const head = cookEl('div', 'statline');
    head.appendChild(cookEl('strong', null, dayLabel(day)));

    const scheduled = sessions.filter(
      (k) => k.clientId === trainClientId && k.date === day);

    const add = cookEl('button', 'chip', scheduled.length ? 'Add another' : 'Add');
    add.onclick = () => addScheduledSession(day);
    head.appendChild(add);
    card.appendChild(head);

    if (!scheduled.length) {
      card.appendChild(cookEl('p', 'muted', 'Rest.'));
    } else {
      scheduled.forEach((session) => {
        const workout = workoutById(session.workoutId);
        const row = cookEl('div', 'statline');
        row.appendChild(cookEl('span', null, session.workoutName));
        const remove = cookEl('button', 'chip', 'Remove');
        remove.onclick = () => {
          sessions = sessions.filter((k) => k.id !== session.id);
          save(TRAIN_KEY.sessions, sessions);
          renderTrain();
        };
        row.appendChild(remove);
        card.appendChild(row);

        // A template deleted after being scheduled leaves the session behind.
        // Saying so beats sending a link with a session that carries nothing.
        if (!workout) {
          card.appendChild(cookEl('p', 'muted',
            'This workout has been deleted — remove it or rebuild it before sending.'));
        } else {
          (workout.exercises || []).forEach((exercise) => {
            const line = cookEl('div', 'setline');
            line.appendChild(cookEl('b', null, exercise.name));
            line.appendChild(document.createTextNode(' — ' + exerciseSummary(exercise)));
            card.appendChild(line);
          });
        }
      });
    }

    wrap.appendChild(card);
  });

  updateTrainPlanSize();
}

function addScheduledSession(day) {
  const panel = $('#session-picker');
  $('#session-picker-title').textContent = dayLabel(day);
  panel.classList.remove('hidden');
  panel.scrollIntoView({ block: 'nearest' });

  const list = $('#session-picker-list');
  list.innerHTML = '';
  workouts.forEach((workout) => {
    const row = cookEl('button', 'chip wide');
    const setCount = (workout.exercises || []).reduce((t, e) => t + (e.sets || []).length, 0);
    row.textContent = `${workout.name} — ${(workout.exercises || []).length} exercises, ${setCount} sets`;
    row.onclick = () => {
      sessions.push({
        id: newId(),
        clientId: trainClientId,
        date: day,
        workoutId: workout.id,
        // Denormalised so the week still reads correctly after a rename.
        workoutName: workout.name,
      });
      save(TRAIN_KEY.sessions, sessions);
      panel.classList.add('hidden');
      renderTrain();
    };
    list.appendChild(row);
  });
}

async function updateTrainPlanSize() {
  const note = $('#tplan-size');
  const link = await encodePlan(trainClientId);
  if (!link) {
    note.textContent = 'Nothing planned for this client yet.';
    return;
  }
  const kb = link.length / 1024;
  note.textContent = `${planContents(trainClientId)} · about ${kb.toFixed(1)} KB of email.`
    + (link.length > RISKY_LINK_LENGTH
      ? ' That is long enough that some mail apps will break it — send fewer days.'
      : '');
}

/* ---------------- train events ---------------- */

$('#workout-new').onclick = () => openWorkoutForm(null);
$('#w-cancel').onclick = closeWorkoutForm;
$('#w-add-exercise').onclick = openExercisePicker;
$('#ex-cancel').onclick = () => $('#exercise-picker').classList.add('hidden');
$('#ex-query').oninput = renderExercisePicker;
$('#session-picker-cancel').onclick = () => $('#session-picker').classList.add('hidden');

$('#w-save').onclick = () => {
  if (!workoutDraft) return;
  const name = $('#w-name').value.trim();
  if (!name) { alert('Give the workout a name so you can find it in the week.'); return; }
  if (!workoutDraft.exercises.length) {
    alert('Add at least one exercise.');
    return;
  }
  workoutDraft.name = name;

  const existing = workouts.findIndex((w) => w.id === workoutDraft.id);
  if (existing >= 0) workouts[existing] = workoutDraft;
  else workouts.push(workoutDraft);
  save(TRAIN_KEY.workouts, workouts);

  // Scheduled sessions carry the name for display, so a rename has to reach
  // the weeks this workout is already sitting in.
  sessions = sessions.map((k) =>
    (k.workoutId === workoutDraft.id ? { ...k, workoutName: name } : k));
  save(TRAIN_KEY.sessions, sessions);

  closeWorkoutForm();
};

$('#w-delete').onclick = () => {
  if (!workoutDraft) return;
  const scheduled = sessions.filter((k) => k.workoutId === workoutDraft.id).length;
  const warning = scheduled
    ? `\n\nIt is scheduled ${scheduled} time${scheduled === 1 ? '' : 's'}; `
      + 'those days will be emptied too.'
    : '';
  if (!confirm(`Delete "${workoutDraft.name}"?${warning}`)) return;

  workouts = workouts.filter((w) => w.id !== workoutDraft.id);
  sessions = sessions.filter((k) => k.workoutId !== workoutDraft.id);
  save(TRAIN_KEY.workouts, workouts);
  save(TRAIN_KEY.sessions, sessions);
  closeWorkoutForm();
};

$('#tplan-copy').onclick = async () => {
  const link = await sendPlan(trainClientId);
  if (!link) { alert('Nothing planned for this client yet.'); return; }
  try {
    await navigator.clipboard.writeText(link);
    $('#tplan-copy').textContent = 'Copied';
    setTimeout(() => { $('#tplan-copy').textContent = 'Copy plan link'; }, 1500);
  } catch (e) {
    alert('Copying was blocked by the browser.');
  }
};

$('#tplan-mail').onclick = async () => {
  const link = await sendPlan(trainClientId);
  if (!link) { alert('Nothing planned for this client yet.'); return; }
  mailPlan(trainClientId, link);
};

/* ---------------- ingredient lookup ----------------
 *
 * The data layer is foods.js, shared with the web build of LIFT so a coach
 * costing a recipe and a client logging one read identical numbers.
 *
 * Two sources: bundled USDA for ingredients, Open Food Facts for packaged
 * goods and barcodes. Ingredients is the default because that is what recipes
 * are written from.
 */

let ingredientSource = 'library';
/** Macros accumulated from looked-up ingredients, for the recipe being edited. */
let ingredientTally = null;

const emptyTally = () => ({
  calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, lines: 0,
  // Saturated fat, sugar and sodium, summed over the lines that recorded them
  // with a count, so the tally can tell a whole recipe from part of one.
  details: CoachNutrients.emptyTally(),
});

function renderIngredientSources() {
  chipRow($('#ing-source'),
    [{ label: 'Ingredients', v: 'library' }, { label: 'Packaged & barcodes', v: 'packaged' }],
    (i) => i.v === ingredientSource,
    (i) => {
      ingredientSource = i.v;
      renderIngredientSources();
      const query = $('#ing-query').value.trim();
      if (query) runIngredientSearch(query);
    });

  $('#ing-query').placeholder = ingredientSource === 'library'
    ? 'Chicken breast, oats, olive oil…'
    : 'Brand name, or a barcode';
}

async function runIngredientSearch(query) {
  const box = $('#ing-results');
  box.innerHTML = '';
  box.appendChild(cookEl('p', 'muted', 'Searching…'));

  if (ingredientSource === 'library') {
    await loadFoodLibrary();
    if (foodLibraryError) {
      box.innerHTML = '';
      box.appendChild(cookEl('p', 'muted',
        `Could not load the ingredient database (${foodLibraryError}).`));
      return;
    }
    showIngredientHits(searchFoodLibrary(query));
    return;
  }

  try {
    showIngredientHits(await searchPackagedFoods(query));
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(cookEl('p', 'muted', `Could not reach Open Food Facts (${e.message}).`));
  }
}

function showIngredientHits(hits) {
  const box = $('#ing-results');
  box.innerHTML = '';
  if (!hits.length) {
    box.appendChild(cookEl('p', 'muted', 'Nothing found for that.'));
    return;
  }

  hits.slice(0, 12).forEach((hit) => {
    const card = cookEl('div', 'card');
    card.appendChild(cookEl('strong', null, hit.name));
    card.appendChild(cookEl('p', 'muted', hit.label));

    const row = cookEl('div', 'row');
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.inputMode = 'decimal';
    amount.min = '0';
    amount.value = hit.per === 'g' ? '100' : '1';
    amount.setAttribute('aria-label', hit.per === 'g' ? 'Grams' : 'Servings');
    row.appendChild(amount);

    const add = cookEl('button', null, hit.per === 'g' ? 'Add grams' : 'Add servings');
    add.onclick = () => {
      const quantity = parseFloat(amount.value);
      if (!quantity || quantity <= 0) return;
      addIngredient(hit, quantity);
    };
    row.appendChild(add);
    card.appendChild(row);
    box.appendChild(card);
  });
}

function addIngredient(hit, quantity) {
  const field = $('#r-ingredients');
  const line = foodLine(hit, quantity);
  field.value = field.value.trim() ? `${field.value.replace(/\s+$/, '')}\n${line}` : line;

  if (!ingredientTally) ingredientTally = emptyTally();
  const contribution = foodContribution(hit, quantity);
  ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'].forEach((key) => {
    ingredientTally[key] += contribution[key];
  });
  CoachNutrients.addToTally(ingredientTally.details, contribution);
  ingredientTally.lines += 1;

  applyTally();
  $('#ing-results').innerHTML = '';
  $('#ing-query').value = '';
}

/* Writes the running total into the per-serving fields.
 *
 * Only fields the coach has not typed into are touched — a looked-up figure
 * should never quietly overwrite a number someone entered deliberately. */
function applyTally() {
  const note = $('#ing-tally');
  if (!ingredientTally || !ingredientTally.lines) {
    note.textContent = '';
    return;
  }

  const servings = parseFloat($('#r-servings').value) || 1;
  const perServing = {
    '#r-cal': ingredientTally.calories / servings,
    '#r-p': ingredientTally.proteinG / servings,
    '#r-c': ingredientTally.carbsG / servings,
    '#r-f': ingredientTally.fatG / servings,
    '#r-fib': ingredientTally.fiberG / servings,
  };

  Object.entries(perServing).forEach(([selector, value]) => {
    const field = $(selector);
    if (field.dataset.typed === '1') return;
    field.value = Math.round(value);
  });

  // A detail is filled in only when every looked-up ingredient recorded it;
  // otherwise it is left blank, never a partial figure (nutrients.js).
  const details = CoachNutrients.tallyPerServing(ingredientTally.details, servings);
  Object.entries(RECIPE_DETAIL_INPUTS).forEach(([key, selector]) => {
    const field = $(selector);
    if (field.dataset.typed === '1') return;
    field.value = details[key] == null ? '' : details[key];
  });

  note.textContent = `${ingredientTally.lines} looked-up `
    + `ingredient${ingredientTally.lines === 1 ? '' : 's'} · `
    + `${num(ingredientTally.calories)} kcal for the whole recipe, `
    + `${num(ingredientTally.calories / servings)} a serving.`;
}

$('#r-weight').addEventListener('input', renderRecipeWeightEach);
$('#r-servings').addEventListener('input', renderRecipeWeightEach);

['#r-cal', '#r-p', '#r-c', '#r-f', '#r-fib', '#r-sat', '#r-sugar', '#r-sodium'].forEach((selector) => {
  // A field the coach edits stops being ours to fill in.
  $(selector).addEventListener('input', (e) => { e.target.dataset.typed = '1'; });
});

$('#r-servings').addEventListener('input', applyTally);

$('#ing-go').onclick = () => {
  const query = $('#ing-query').value.trim();
  if (query) runIngredientSearch(query);
};

$('#ing-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#ing-go').click(); }
});

renderIngredientSources();

/* ---------------- recipe import ----------------
 *
 * TheMealDB carries recipes — name, ingredients, method — and no nutrition at
 * all. USDA carries nutrition and no recipes. So an import takes the shape of
 * the dish from one and costs it from the other.
 *
 * Only ingredients that convert to a weight get costed. Volume and vague units
 * are left alone and counted as unpriced, because pricing "2 tbsp olive oil"
 * means inventing a density, and the coach can see and fix a gap far more
 * easily than a plausible wrong number.
 */

const MEALDB = 'https://www.themealdb.com/api/json/v1/1';

let importedHits = [];
let importRun = 0;
const SERVINGS_UNSTATED = ' TheMealDB does not say how many this serves; set it before sending.';

function mealToRecipe(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] || '').trim();
    if (!name) continue;
    const measure = (meal[`strMeasure${i}`] || '').trim();
    ingredients.push(measure ? `${measure} ${name}` : name);
  }
  const steps = (meal.strInstructions || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return { name: meal.strMeal || 'Imported recipe', ingredients, steps };
}

async function searchMealDb(query) {
  const box = $('#import-results');
  box.innerHTML = '';
  box.appendChild(cookEl('p', 'muted', 'Searching…'));

  try {
    const response = await fetch(`${MEALDB}/search.php?s=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    importedHits = (data.meals || []).map(mealToRecipe);

    box.innerHTML = '';
    if (!importedHits.length) {
      box.appendChild(cookEl('p', 'muted', 'Nothing found for that.'));
      return;
    }
    importedHits.forEach((recipe, index) => {
      const row = cookEl('button', 'chip wide',
        `${recipe.name} — ${recipe.ingredients.length} ingredients`);
      row.onclick = () => useImportedRecipe(index);
      box.appendChild(row);
    });
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(cookEl('p', 'muted', `Could not reach TheMealDB (${e.message}).`));
  }
}

/* Opens a fresh recipe form filled from an import, then costs what it can.
 *
 * Always a new recipe: openRecipeForm(null) clears the id, so importing while
 * an existing recipe is open can never overwrite it on Save, and clears every
 * macro and its typed flag, so nothing from that recipe leaks into this one.
 *
 * Servings are 1: TheMealDB does not say how many a recipe feeds, and the
 * form's default of four would silently divide every macro by a number nobody
 * chose. The same rule Paste a recipe and Coach iOS follow. */
async function useImportedRecipe(index) {
  const recipe = importedHits[index];
  if (!recipe) return;

  // Panel first: hiding it after the form scrolled into view would pull the
  // form up past the top of the screen.
  $('#import-panel').classList.add('hidden');
  openRecipeForm(null);

  $('#r-name').value = recipe.name;
  $('#r-servings').value = 1;
  $('#r-ingredients').value = recipe.ingredients.join('\n');
  $('#r-steps').value = recipe.steps.join('\n');

  const note = $('#ing-tally');
  note.textContent = 'Costing the ingredients…';

  const run = ++importRun;
  await loadFoodLibrary();
  // The first load of the ingredient database takes a moment. If the coach
  // cancelled, or opened another recipe, meanwhile, these macros are not theirs.
  if (run !== importRun || editingRecipeId !== null
      || $('#recipe-form').classList.contains('hidden')) return;
  if (foodLibraryError) {
    note.textContent = `Imported. Could not load the ingredient database (${foodLibraryError}),`
      + ' so the macros are blank.' + SERVINGS_UNSTATED;
    return;
  }

  const unpriced = [];
  ingredientTally = emptyTally();

  recipe.ingredients.forEach((line) => {
    const parsed = parseIngredient(line);
    const grams = gramsFor(parsed);
    if (!grams || !parsed.item) { unpriced.push(line); return; }

    const hit = searchFoodLibrary(parsed.item, 1)[0];
    if (!hit) { unpriced.push(line); return; }

    const contribution = foodContribution(hit, grams);
    Object.keys(contribution).forEach((key) => { ingredientTally[key] += contribution[key]; });
    ingredientTally.lines += 1;
  });

  applyTally();

  // Say plainly how much of the dish is actually costed. A macro figure built
  // from three of seventeen ingredients is worse than useless if it looks whole.
  if (unpriced.length) {
    note.textContent = (ingredientTally.lines
      ? `${note.textContent} `
      : 'Imported. ')
      + `${unpriced.length} of ${recipe.ingredients.length} ingredients could not be `
      + 'weighed automatically, so the total is short. Look them up above, or type the macros in.';
  } else if (!ingredientTally.lines) {
    note.textContent = 'Imported. None of the ingredients could be weighed automatically — '
      + 'look them up above, or type the macros in.';
  }
  note.textContent += SERVINGS_UNSTATED;
}

$('#import-open').onclick = () => {
  $('#import-panel').classList.remove('hidden');
  $('#import-query').focus();
};
$('#import-cancel').onclick = () => $('#import-panel').classList.add('hidden');

/* Paste a recipe.
 *
 * The third way in, and the only one that touches no network at all. It exists
 * because the search above needs a dish TheMealDB happens to know, and because
 * a recipe website cannot be read from here at all: a browser may not fetch
 * another site's page, so the address bar is no use and the text is.
 *
 * parseCaption (recipe-import.js) only PROPOSES a split. Nothing is saved here
 * -- it fills the recipe form and the coach checks it, which is the whole
 * safety argument. The form's two textareas are already one-per-line, so the
 * editor the split lands in is the editor that already existed, and a wrong
 * split costs an edit rather than a number. parseIngredient still reads the
 * quantities on save, and still refuses to weigh a volume.
 */
$('#rp-open').onclick = () => {
  $('#rp-panel').classList.remove('hidden');
  $('#rp-note').textContent = '';
  $('#rp-text').focus();
};
$('#rp-cancel').onclick = () => $('#rp-panel').classList.add('hidden');

$('#rp-go').onclick = () => {
  const parsed = parseCaption($('#rp-text').value);

  if (!parsed.ingredientLines.length && !parsed.steps.length) {
    $('#rp-note').textContent =
      'Nothing in that reads as a recipe. Paste the ingredients and steps as text.';
    return;
  }

  // Panel first, as with the import: hiding it after the form scrolled into
  // view would pull the form up past the top of the screen.
  $('#rp-panel').classList.add('hidden');
  openRecipeForm(null);

  $('#r-name').value = parsed.name || '';
  $('#r-ingredients').value = parsed.ingredientLines.join('\n');
  $('#r-steps').value = parsed.steps.join('\n');
  // Only ever from an explicit "serves 4". A guessed yield silently divides
  // every macro by a number nobody chose, so an unstated one stays at 1 and
  // says so below.
  $('#r-servings').value = parsed.servings || 1;

  const advice = {
    labelled: 'Split on the headings in the text — check it read them right.',
    inferred: 'The text labelled one section and this worked out the rest, so check the division.',
    unsorted: 'The text had no headings, so everything landed in Ingredients — cut any method steps out and paste them into Method.',
  }[parsed.split];

  $('#ing-tally').textContent = parsed.servings
    ? advice
    : advice + ' The text did not say how many this serves; set it before sending.';
};
$('#import-go').onclick = () => {
  const query = $('#import-query').value.trim();
  if (query) searchMealDb(query);
};
$('#import-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#import-go').click(); }
});
