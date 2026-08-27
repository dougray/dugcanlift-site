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

function expandSet(tuple) {
  const [weightLb, reps, rpe, durationSec, distanceM, flags] = tuple;
  return {
    weightLb: weightLb ?? null,
    reps: reps ?? null,
    rpe: rpe ?? null,
    durationSec: durationSec ?? null,
    distanceM: distanceM ?? null,
    warmup: !!((flags || 0) & 1),
  };
}

function expandDay(raw, dictExercises, dictFoods) {
  const day = {};
  if (raw.n) day.name = raw.n;
  if (raw.fo) day.focus = raw.fo;
  if (raw.bw != null) day.bodyweightLb = raw.bw;
  if (raw.st != null) day.steps = raw.st;

  if (Array.isArray(raw.w)) {
    day.exercises = raw.w.map(([index, sets]) => {
      const [name, equipment] = String(dictExercises[index] || '').split('|');
      return {
        name: name || 'Exercise',
        equipment: equipment || '',
        sets: (sets || []).map(expandSet),
      };
    });
  }

  if (Array.isArray(raw.ft)) {
    const [calories, proteinG, fatG, carbsG, fiberG] = raw.ft;
    day.foodTotals = { calories, proteinG, fatG, carbsG, fiberG };
  }

  if (Array.isArray(raw.f)) {
    day.food = raw.f.map(([index, servings, calories, proteinG, fatG, carbsG, fiberG, meal]) => ({
      name: dictFoods[index] || 'Food',
      servings: servings ?? 1,
      calories, proteinG, fatG, carbsG, fiberG,
      meal: MEALS[meal] || '',
    }));
    // An itemised payload carries no totals line — it doesn't need to.
    if (!day.foodTotals) {
      day.foodTotals = day.food.reduce((acc, e) => ({
        calories: acc.calories + Math.round(e.calories * e.servings),
        proteinG: acc.proteinG + Math.round(e.proteinG * e.servings),
        fatG:     acc.fatG     + Math.round(e.fatG * e.servings),
        carbsG:   acc.carbsG   + Math.round(e.carbsG * e.servings),
        fiberG:   acc.fiberG   + Math.round(e.fiberG * e.servings),
      }), { calories: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0 });
    }
  }

  return day;
}

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
      const id = `${ex.name}|${ex.equipment}`.toLowerCase();
      if (!map.has(id)) {
        map.set(id, { id, label: ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name, days: [] });
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
  calories: '#c1442c', protein: '#7c8b7a', goal: '#a39c8e',
  volume: '#c1442c', sets: '#5b8db8', weight: '#c1442c', e1rm: '#5b8db8',
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
    ctx.fillStyle = '#a39c8e';
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

  ctx.strokeStyle = '#3a3733';
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach((f) => {
    const y = plotH - plotH * f + pad / 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
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

  ctx.fillStyle = '#a39c8e';
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

function showTab(name) {
  currentTab = name;
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
  if (!client) { showTab('roster'); return; }
  const unit = unitFor(client);

  renderClientHead(client, unit);
  renderWeeks(client, unit);
  renderVolumeChart(client, unit);
  renderFuel(client);
  renderBodyweight(client, unit);
  renderLifts(client, unit);
  renderSessions(client, unit);
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
  const points = lift.days.map(({ key, ex }) => {
    const best = ex.sets.map(estimatedOneRepMax).filter(Boolean);
    const heaviest = ex.sets.filter((s) => !s.warmup && s.weightLb)
      .sort((a, b) => b.weightLb - a.weightLb)[0];
    return {
      key,
      e1rm: best.length ? Math.max(...best) : null,
      top: heaviest || null,
      sets: ex.sets.filter((s) => !s.warmup).length,
    };
  });

  const withE1rm = points.filter((p) => p.e1rm != null);
  if (withE1rm.length >= 2) {
    const first = withE1rm[0], last = withE1rm[withE1rm.length - 1];
    const delta = deltaText(fromLb(last.e1rm - first.e1rm, unit), unit);
    const row = el('div', 'statline');
    row.appendChild(el('span', null,
      `Estimated 1RM since ${shortDate(first.key)}`));
    row.appendChild(el('span', 'delta ' + delta.cls, delta.text));
    card.appendChild(row);
  }

  const best = points.filter((p) => p.top)
    .sort((a, b) => b.top.weightLb - a.top.weightLb)[0];
  if (best) {
    statline(card, 'Heaviest set',
      `${weightText(best.top.weightLb, unit)} × ${best.top.reps} on ${shortDate(best.key)}`);
  }

  if (withE1rm.length >= 2) {
    const canvas = el('canvas');
    canvas.setAttribute('height', '130');
    card.appendChild(canvas);
    drawChart(canvas, [{
      label: 'e1RM', color: CHART.e1rm, zoom: true,
      values: points.map((p) => (p.e1rm == null ? null : Math.round(fromLb(p.e1rm, unit)))),
    }], points.map((p) => p.key));
  }

  const recent = points.slice(-6).reverse().map((p) => [
    shortDate(p.key),
    p.sets,
    p.top ? `${num(fromLb(p.top.weightLb, unit))} × ${p.top.reps}` : null,
    p.e1rm ? num(fromLb(p.e1rm, unit)) : null,
  ]);
  const wrap = el('div', 'scroll-x');
  table(wrap, ['Date', 'Sets', 'Top set', `e1RM ${unit}`], recent);
  card.appendChild(wrap);
}

/** How a set reads back: "185 × 5 @8", "400 m in 1:30", "12 reps". */
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
  if (set.rpe != null) bits.push(`@${set.rpe}`);
  if (set.warmup) bits.push('warm-up');
  return bits.join(' · ') || '—';
}

function renderSessions(client, unit) {
  const node = $('#session-log');
  node.innerHTML = '';

  const keys = dayKeys(client).filter((k) => hasTraining(client.days[k]) || hasFood(client.days[k]));
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
    left.appendChild(el('div', 'muted', parts.join('  ·  ')));
    summary.appendChild(left);
    if (day.focus) summary.appendChild(el('span', 'pill', day.focus.toLowerCase()));
    details.appendChild(summary);

    const body = el('div', 'body');
    (day.exercises || []).forEach((ex) => {
      const block = el('div', 'exercise');
      block.appendChild(el('h3', null, ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name));
      ex.sets.forEach((set, i) => {
        const line = el('div', 'setline');
        line.appendChild(el('b', null, `${i + 1}. `));
        line.appendChild(document.createTextNode(setText(set, unit)));
        block.appendChild(line);
      });
      body.appendChild(block);
    });

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
      });
      body.appendChild(block);
    } else if (hasFood(day)) {
      const block = el('div', 'exercise');
      block.appendChild(el('h3', null, 'Food'));
      const t = day.foodTotals;
      block.appendChild(el('div', 'setline',
        `${num(t.calories)} kcal · ${t.proteinG}p / ${t.fatG}f / ${t.carbsG}c / ${t.fiberG} fibre`));
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

  const bytes = new Blob([localStorage.getItem(KEY.clients) || '']).size;
  $('#storage-note').textContent = clients.length
    ? `${clients.length} ${clients.length === 1 ? 'client' : 'clients'} stored here, `
      + `${(bytes / 1024).toFixed(0)} KB. This lives in this browser only — `
      + `clearing site data wipes it, so keep a backup.`
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
  const blob = new Blob([JSON.stringify({ v: 1, clients, settings }, null, 1)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = `lift-coach-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
        const existing = clients.find((c) => c.id === client.id);
        if (!existing) clients.push(client);
        else Object.assign(existing.days, client.days);
      });
      persist();
      render();
      alert(`Restored ${parsed.clients.length} client(s).`);
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
  if (currentTab === 'roster') renderRoster();
  else if (currentTab === 'client') renderClient();
  else if (currentTab === 'cook') renderCook();
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

$('#client-remove').onclick = () => {
  const client = currentClient();
  if (!client) return;
  if (!confirm(`Remove ${client.name} and everything they have sent you? `
             + 'This cannot be undone from here.')) return;
  clients = clients.filter((c) => c.id !== client.id);
  persist();
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

// Charts are sized from the element's rendered width, so they need redrawing
// when that width changes.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (currentTab === 'client') renderClient(); }, 150);
});

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

const COOK_KEY = { recipes: 'coach.recipes', plans: 'coach.plans' };

let recipes = load(COOK_KEY.recipes, []);
/* Planned meals across every client, each tagged with the client id it is for.
 * A plan is addressed, not broadcast. */
let plans = load(COOK_KEY.plans, []);

const LIFT_URL = 'https://www.dugcanlift.com/lift/';

const recipeById = (id) => recipes.find((r) => r.id === id);

/* ---------------- plan link ---------------- */

const bytesToB64url = (bytes) => {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function deflate(text) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([text]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Builds the link for one client's week.
 *
 * Recipes ride inline, but only the ones this plan actually uses, and only the
 * fields needed to cook and log them. That is what keeps a month of dinners
 * inside a link an email client will not mangle.
 */
async function encodePlan(clientId) {
  const client = clients.find((c) => c.id === clientId);
  const mine = plans.filter((p) => p.clientId === clientId);
  if (!client || !mine.length) return null;

  const used = [...new Set(mine.map((m) => m.recipeId))];
  const index = {};
  const inline = [];
  used.forEach((id) => {
    const r = recipeById(id);
    if (!r) return;
    index[id] = inline.length;
    const n = r.nutritionPerServing;
    inline.push({
      n: r.name,
      s: r.servings,
      // Per serving, omitted entirely when unknown — a zero here would become
      // a zero-calorie dinner in the client's day total.
      ...(n ? { u: [n.calories, n.proteinG, n.carbsG, n.fatG, n.fiberG || 0] } : {}),
      i: (r.ingredients || []).map((g) => g.rawText),
      t: r.steps || [],
    });
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

  const json = JSON.stringify(payload);
  const packed = await deflate(json);
  // 'u' is the uncompressed fallback the decoder already understands, for
  // browsers without CompressionStream.
  const body = packed
    ? 'z' + bytesToB64url(packed)
    : 'u' + bytesToB64url(new TextEncoder().encode(json));
  return `${LIFT_URL}#1${body}`;
}

/* ---------------- COOK views ---------------- */

let cookSection = 'recipes';
let editingRecipeId = null;
let planClientId = null;

function renderCook() {
  chipRow($('#cook-sections'),
    [{ label: 'Recipes', v: 'recipes' }, { label: 'Plan', v: 'plan' }, { label: 'Shopping', v: 'shopping' }],
    (i) => i.v === cookSection,
    (i) => { cookSection = i.v; $('#recipe-form').classList.add('hidden'); renderCook(); });

  $('#cook-recipes').classList.toggle('hidden', cookSection !== 'recipes');
  $('#cook-plan').classList.toggle('hidden', cookSection !== 'plan');
  $('#cook-shopping').classList.toggle('hidden', cookSection !== 'shopping');

  if (cookSection === 'recipes') renderCookRecipes();
  if (cookSection === 'plan') renderCookPlan();
  if (cookSection === 'shopping') renderCookShopping();
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
    card.appendChild(cookEl('p', 'muted', n
      ? `${trimNum(n.calories)} kcal  P ${trimNum(n.proteinG)}  C ${trimNum(n.carbsG)}  F ${trimNum(n.fatG)}`
      : 'Macros not set'));

    if ((r.ingredients || []).length) {
      card.appendChild(cookEl('p', 'muted',
        `${r.ingredients.length} ingredient${r.ingredients.length === 1 ? '' : 's'}`));
    }

    card.onclick = () => openRecipeForm(r.id);
    list.appendChild(card);
  });
}

function openRecipeForm(id) {
  editingRecipeId = id;
  const r = id ? recipeById(id) : null;
  $('#r-name').value = r ? r.name : '';
  $('#r-servings').value = r ? r.servings : 4;
  $('#r-ingredients').value = r ? (r.ingredients || []).map((i) => i.rawText).join('\n') : '';
  $('#r-steps').value = r ? (r.steps || []).join('\n') : '';
  const n = r && r.nutritionPerServing;
  $('#r-cal').value = n ? n.calories : '';
  $('#r-p').value = n ? n.proteinG : '';
  $('#r-c').value = n ? n.carbsG : '';
  $('#r-f').value = n ? n.fatG : '';
  $('#r-delete').classList.toggle('hidden', !r);
  $('#recipe-form').classList.remove('hidden');
  $('#r-name').focus();
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
  const typed = [num('#r-cal'), num('#r-p'), num('#r-c'), num('#r-f')];
  // Null unless something was typed. An untouched form must not write zeros.
  const nutrition = typed.every((v) => v === null) ? null : {
    calories: typed[0] || 0,
    proteinG: typed[1] || 0,
    carbsG: typed[2] || 0,
    fatG: typed[3] || 0,
    fiberG: 0,
  };

  const lines = (sel) => $(sel).value.split('\n').map((l) => l.trim()).filter(Boolean);
  const servings = parseFloat($('#r-servings').value) || 1;

  const body = {
    name,
    servings: servings > 0 ? servings : 1,
    ingredients: lines('#r-ingredients').map(parseIngredient),
    steps: lines('#r-steps'),
    nutritionPerServing: nutrition,
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

  $('#plan-note').textContent = recipes.length
    ? 'Plans go to this client only. Their app refuses a plan addressed to anyone else.'
    : 'Write a recipe first — the plan is built from them.';
  $('#plan-send-card').classList.toggle('hidden', !recipes.length);

  const wrap = $('#plan-days');
  wrap.innerHTML = '';
  if (!recipes.length) return;

  const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  cookWeek().forEach((day) => {
    const card = cookEl('div', 'card');
    card.appendChild(cookEl('strong', null, dayLabel(day)));

    MEALS.forEach((meal) => {
      const forSlot = plans.filter(
        (p) => p.clientId === planClientId && p.date === day && p.meal === meal);
      const row = cookEl('div', 'row');
      row.appendChild(cookEl('span', 'muted', meal.charAt(0) + meal.slice(1).toLowerCase()));

      if (!forSlot.length) {
        const add = cookEl('button', 'chip', 'Add');
        add.onclick = () => addPlannedMeal(day, meal);
        row.appendChild(add);
      } else {
        forSlot.forEach((p) => {
          const label = cookEl('span', null,
            `${p.recipeName} · ${servingsLabel(p.servings)}`);
          row.appendChild(label);
          const rm = cookEl('button', 'chip', 'Remove');
          rm.onclick = () => {
            plans = plans.filter((x) => x.id !== p.id);
            save(COOK_KEY.plans, plans);
            renderCook();
          };
          row.appendChild(rm);
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
      row.textContent = n
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

async function updatePlanSize() {
  const link = await encodePlan(planClientId);
  const note = $('#plan-size');
  if (!link) {
    note.textContent = 'Nothing planned for this client yet.';
    return;
  }
  const kb = (link.length / 1024).toFixed(1);
  note.textContent = link.length > RISKY_LINK_LENGTH
    ? `${kb} KB — long enough that some mail apps will break it. Send fewer days, or fewer recipes with long ingredient lists.`
    : `${kb} KB — comfortably inside what an email will carry.`;
}

$('#plan-copy').onclick = async () => {
  const link = await encodePlan(planClientId);
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
  const link = await encodePlan(planClientId);
  if (!link) return;
  const client = clients.find((c) => c.id === planClientId);
  const who = settings.name || 'your coach';
  const subject = encodeURIComponent(`Your week from ${who}`);
  const body = encodeURIComponent(
    `${client ? client.name : 'Hi'},\n\n`
    + `Here's your week. Open this on your phone and LIFT will take it in — `
    + `recipes, the plan, and a shopping list for the lot.\n\n${link}\n\n`
    + `Nothing in that link goes to a server. It travels in the part of the `
    + `address browsers never send.\n\n${who}\n`);
  location.href = `mailto:?subject=${subject}&body=${body}`;
};

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
