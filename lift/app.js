/* LIFT — nutrition and training tracker.
 *
 * Storage mirrors the Android app's JSON schema exactly, so a log can move
 * between the two later without a conversion step.
 */

/* ---------------- storage ---------------- */

const KEY = { goal: 'lift.goal', food: 'lift.food', workouts: 'lift.workouts', settings: 'lift.settings', steps: 'lift.steps',
              coach: 'lift.coach', profile: 'lift.profile', weights: 'lift.weights',
              ext: 'lift.ext', unknownData: 'lift.unknownData',
              recipes: 'lift.recipes', plan: 'lift.plan', shopping: 'lift.shopping',
              training: 'lift.training', templates: 'lift.templates',
              routines: 'lift.routines', outdoor: 'lift.outdoor', recording: 'lift.recording' };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    // A corrupt value shouldn't wipe the screen on launch.
    console.warn('could not read', key, e);
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    alert('Could not save — device storage may be full.');
  }
}

let goal = load(KEY.goal, null);
let food = load(KEY.food, []);
let workouts = load(KEY.workouts, []);
let settings = load(KEY.settings, { focus: 'BODYBUILDING' });
// Keyed by date, e.g. { '2026-08-09': 4200 }. Entered by hand — see renderSteps
// for why this can't read from Health Connect / HealthKit like the native apps.
let steps = load(KEY.steps, {});
// COOK. Recipes and the week's plan; the shopping list is derived from them
// rather than stored, so only the tick-offs persist.
let recipes = load(KEY.recipes, []);
let plan = load(KEY.plan, []);
/* Sessions a coach has prescribed, by date. Kept apart from `workouts`, which
 * is what actually happened — a plan and a log are different claims, and
 * merging them would lose the ability to say whether the week was followed. */
let training = load(KEY.training, []);
/* Workout templates a coach has sent without booking a day for them. Yours to
 * start whenever; a prescription in `training` is for a named date. */
let templates = load(KEY.templates, []);
/* Your own routines, in LIFT for Android's shape (see routines.js). Before this
 * build had routines, an Android backup's `routines` section was kept aside as
 * an unknown section so a re-save would not lose it. The first run of this
 * build adopts them, so a restore done months ago still turns up. */
let routines = load(KEY.routines, null);
if (!Array.isArray(routines)) {
  const kept = load(KEY.unknownData, {});
  routines = Array.isArray(kept.routines) ? kept.routines.filter((r) => r && Array.isArray(r.exercises)) : [];
  if (kept.routines !== undefined) {
    delete kept.routines;
    save(KEY.unknownData, kept);
  }
  save(KEY.routines, routines);
}
/* Finished runs, walks and hikes, routes stored compactly (see outdoor.js). A
 * recording in progress lives apart under KEY.recording, written on every kept
 * fix, so a reload or a crash mid-run keeps the route so far. */
let outdoor = load(KEY.outdoor, []);
let shoppingTicks = load(KEY.shopping, []);
// Who to send logs to, and who they are from. See "send to coach" below.
let coach = load(KEY.coach, { email: '', you: '', id: '', weeks: 8, itemised: false });
// The calculator's inputs, kept so a coach gets more than a bare calorie
// number, and so a saved weight becomes a real datapoint on a real date.
let profile = load(KEY.profile, null);
let weights = load(KEY.weights, {});

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/* ---------------- dates ---------------- */

const dateKey = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayKey = () => dateKey(new Date());

function shiftDate(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dateKey(dt);
}

function dateLabel(key) {
  if (key === todayKey()) return 'Today';
  if (key === shiftDate(todayKey(), -1)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function shortLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const lastNDays = (n) => Array.from({ length: n }, (_, i) => shiftDate(todayKey(), -(n - 1 - i)));

/* ---------------- macro maths (matches dugcanlift.com) ---------------- */

const ACTIVITY = [
  ['Sedentary', 1.2], ['Light', 1.375], ['Moderate', 1.55], ['Active', 1.725], ['Very Active', 1.9]
];
const GOALS = [['Lose Weight', -500], ['Maintain', 0], ['Gain Weight', 300]];
const PROTEIN = [['0.7 g/lb', 0.7], ['0.8 g/lb', 0.8], ['1.0 g/lb', 1.0]];
const FAT = [['20%', 0.20], ['25%', 0.25], ['30%', 0.30], ['35%', 0.35]];
const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
const MEAL_LABEL = { BREAKFAST: 'Breakfast', LUNCH: 'Lunch', DINNER: 'Dinner', SNACK: 'Snack' };

/* Training focus.
 *
 * Focus used to be nothing but a field-visibility switch, and Bodybuilding and
 * Powerlifting carried identical flags -- so picking between the two most
 * likely options changed nothing whatsoever. It now also decides what a set
 * starts at, which number summarises a session, and what the progress chart
 * plots, because those are the things that actually differ between a hypertrophy
 * block and a strength block. The flags stay because they still matter: an
 * endurance set has no business asking for reps.
 *
 * `defaultReps` seeds the FIRST set of an exercise only. Every set after it
 * copies the one before, which is a better guess than any constant.
 *
 * Nothing here changes what is STORED. Every set keeps every field it was
 * given, so switching focus -- or opening a log on a device set to another
 * focus -- never drops data, only stops asking for it. */
const FOCUS = {
  BODYBUILDING: {
    label: 'Bodybuilding',
    weight: 1, reps: 1, rpe: 1, time: 0, dist: 0,
    defaultReps: 10, summary: 'volume', chart: 'volume',
  },
  POWERLIFTING: {
    label: 'Powerlifting',
    weight: 1, reps: 1, rpe: 1, time: 0, dist: 0,
    defaultReps: 5, summary: 'topSet', chart: 'strength',
  },
  CROSSFIT: {
    label: 'CrossFit',
    weight: 1, reps: 1, rpe: 0, time: 1, dist: 0,
    defaultReps: null, summary: 'work', chart: 'work',
  },
  HYROX: {
    label: 'Hyrox',
    weight: 1, reps: 1, rpe: 0, time: 1, dist: 1,
    defaultReps: null, summary: 'distance', chart: 'pace',
  },
  ENDURANCE: {
    label: 'Endurance',
    weight: 0, reps: 0, rpe: 1, time: 1, dist: 1,
    defaultReps: null, summary: 'distance', chart: 'pace',
  },
  EVERYTHING: {
    label: 'Everything',
    weight: 1, reps: 1, rpe: 1, time: 1, dist: 1,
    defaultReps: 8, summary: 'volume', chart: 'strength',
  },
};

const currentFocus = () => FOCUS[settings.focus] || FOCUS.BODYBUILDING;

function calculateMacros(sex, age, weightLb, heightIn, activity, goalAdjust, proteinPerLb, fatPct) {
  const kg = weightLb * 0.453592;
  const cm = heightIn * 2.54;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
  const calories = Math.round(bmr * activity + goalAdjust);
  const proteinG = Math.round(proteinPerLb * weightLb);
  const fatG = Math.round((calories * fatPct) / 9);
  // Carbs use the ROUNDED fat grams, exactly as the website does.
  const carbsG = Math.round(Math.max(calories - proteinG * 4 - fatG * 9, 0) / 4);
  const fiberG = Math.round((calories / 1000) * 14);
  return { calories, proteinG, fatG, carbsG, fiberG };
}

/* ---------------- totals ---------------- */

const entriesFor = (day) => food.filter((e) => e.date === day)
  .sort((a, b) => (a.loggedAt || 0) - (b.loggedAt || 0));

const sessionsFor = (day) => workouts.filter((w) => w.date === day);

const mul = (e, field) => Math.round((e[field] || 0) * (e.servings || 1));

function totals(list) {
  return list.reduce((acc, e) => ({
    calories: acc.calories + mul(e, 'calories'),
    proteinG: acc.proteinG + mul(e, 'proteinG'),
    fatG:     acc.fatG     + mul(e, 'fatG'),
    carbsG:   acc.carbsG   + mul(e, 'carbsG'),
    fiberG:   acc.fiberG   + mul(e, 'fiberG'),
  }), { calories: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0 });
}

const sessionVolume = (s) => (s.exercises || []).reduce((t, ex) =>
  t + (ex.sets || []).reduce((u, st) => u + ((st.weightLb || 0) * (st.reps || 0)), 0), 0);

const sessionSets = (s) => (s.exercises || []).reduce((t, ex) => t + (ex.sets || []).length, 0);

const allSets = (s) => (s.exercises || []).flatMap((ex) => ex.sets || []);
const sessionSeconds = (s) => allSets(s).reduce((t, st) => t + (st.durationSec || 0), 0);
const sessionMetres = (s) => allSets(s).reduce((t, st) => t + (st.distanceMeters || 0), 0);

/** The heaviest set that also has reps -- "315 x 3" is the number a strength
 *  session is remembered by, and a weight with no reps is not a set. */
function topSet(s) {
  return allSets(s)
    .filter((st) => st.weightLb != null && st.reps > 0)
    .sort((a, b) => b.weightLb - a.weightLb)[0] || null;
}

/** mm:ss, or h:mm:ss once it runs past an hour. */
function clock(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Metres are the stored unit; km reads better past a kilometre. */
function distanceLabel(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

/* What one line under the workout name should say. Volume is the wrong answer
 * for four of the six focuses: a Hyrox session's number is metres and minutes,
 * and a top single is the point of a powerlifting day. Each branch falls back
 * to plain set count when the session holds nothing of that kind, so an
 * endurance focus with a stray weighted set never renders "0 m". */
function focusSummary(session, f) {
  const sets = sessionSets(session);
  const count = `${sets} ${sets === 1 ? 'set' : 'sets'}`;

  if (f.summary === 'topSet') {
    const best = topSet(session);
    return best ? `${count} - top ${best.weightLb} x ${best.reps}` : count;
  }
  if (f.summary === 'work') {
    const seconds = sessionSeconds(session);
    return seconds ? `${count} - ${clock(seconds)} working` : count;
  }
  if (f.summary === 'distance') {
    const metres = sessionMetres(session);
    const seconds = sessionSeconds(session);
    const parts = [count];
    if (metres) parts.push(distanceLabel(metres));
    if (seconds) parts.push(clock(seconds));
    return parts.join(' - ');
  }
  const volume = sessionVolume(session);
  return volume ? `${count} - ${Math.round(volume)} lb volume` : count;
}

function mealOf(entry) {
  if (entry.meal && MEALS.includes(entry.meal)) return entry.meal;
  const h = entry.loggedAt ? new Date(entry.loggedAt).getHours() : 12;
  if (h < 11) return 'BREAKFAST';
  if (h < 15) return 'LUNCH';
  if (h < 21) return 'DINNER';
  return 'SNACK';
}

const matchKey = (name, equipment) => `${(name || '').trim()}|${(equipment || '').trim()}`.toLowerCase();

/* ---------------- tiny DOM helpers ---------------- */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function chips(container, items, isOn, onPick) {
  container.innerHTML = '';
  items.forEach((item) => {
    const b = el('button', 'chip' + (isOn(item) ? ' on' : ''), item.label);
    b.onclick = () => onPick(item);
    container.appendChild(b);
  });
}

function statline(parent, label, value) {
  const row = el('div', 'statline');
  row.appendChild(el('span', null, label));
  row.appendChild(el('span', null, value));
  parent.appendChild(row);
}

function bar(parent, name, eaten, target, unit = 'g') {
  const wrap = el('div');
  wrap.style.margin = '10px 0';
  const top = el('div', 'statline');
  top.appendChild(el('span', null, name));
  const over = target > 0 && eaten > target;
  const val = el('span', null, `${eaten} / ${target} ${unit}`);
  if (over) val.style.color = 'var(--accent)';
  top.appendChild(val);
  wrap.appendChild(top);
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill' + (over ? ' over' : ''));
  fill.style.width = `${target > 0 ? Math.min(100, (eaten / target) * 100) : 0}%`;
  track.appendChild(fill);
  wrap.appendChild(track);
  parent.appendChild(wrap);
}

/* ---------------- charts ---------------- */

const CHART = {
  calories: 'var(--accent)', protein: 'var(--accent-2)', carbs: '#5b8db8',
  fat: '#d9a441', fiber: '#8e7cc3', weight: 'var(--accent)', e1rm: '#5b8db8',
  volume: '#d9a441', time: '#8e7cc3', distance: 'var(--accent-2)',
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
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    let prev = null;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { prev = null; return; }  // gap, not zero
      const x = stepX * i;
      const y = plotH - (v / max) * plotH + pad / 2;
      if (prev) {
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      prev = [x, y];
    });
  });

  ctx.fillStyle = LiftAppearance.cssColor('var(--muted)');
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillText(String(Math.round(max)), 0, 11);
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

let currentTab = 'home';

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  $('#' + name).classList.add('active');
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  $('#tabs').style.display = (name === 'calc') ? 'none' : 'flex';
  window.scrollTo(0, 0);
  render();
}

document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => showTab(b.dataset.tab);
});

/* ---------------- home ---------------- */

function renderHome() {
  renderCoach();
  renderBackupNote();
  const today = todayKey();
  const eaten = totals(entriesFor(today));

  const summary = $('#goal-summary');
  summary.innerHTML = '';
  const card = el('div', 'card');
  if (!goal) {
    card.appendChild(el('p', null, 'No goal set yet.'));
    card.appendChild(el('p', 'muted', 'Work out your daily calories and macros to start tracking against them.'));
    const b = el('button', null, 'Set my goal');
    b.onclick = () => showTab('calc');
    card.appendChild(b);
  } else {
    const remaining = goal.calories - eaten.calories;
    card.appendChild(el('div', 'big', remaining >= 0 ? `${remaining} kcal left` : `${-remaining} kcal over`));
    card.appendChild(el('p', 'muted', `${eaten.calories} of ${goal.calories}`));
    bar(card, 'Protein', eaten.proteinG, goal.proteinG);
    bar(card, 'Fat', eaten.fatG, goal.fatG);
    bar(card, 'Carbs', eaten.carbsG, goal.carbsG);
    bar(card, 'Fiber', eaten.fiberG, goal.fiberG);
  }
  summary.appendChild(card);

  const training = $('#today-training');
  training.innerHTML = '';
  const todays = sessionsFor(today);
  const todaysOutdoor = outdoorOn(today);
  if (!todays.length && !todaysOutdoor.length) {
    training.appendChild(el('p', 'muted', 'Nothing logged today.'));
  } else {
    todaysOutdoor.forEach((a) => {
      training.appendChild(el('div', null, outdoorLabel(a.activityType)));
      training.appendChild(el('p', 'muted', outdoorSummary(a)));
    });
    todays.forEach((s) => {
      training.appendChild(el('div', null, s.name || 'Workout'));
      training.appendChild(el('p', 'muted',
        `${(s.exercises || []).length} exercises - ${sessionSets(s)} sets - ${Math.round(sessionVolume(s))} lb`));
    });
  }

  const fuel = $('#today-fuel');
  fuel.innerHTML = '';
  statline(fuel, 'Calories', `${eaten.calories} kcal`);
  statline(fuel, 'Protein', `${eaten.proteinG} g`);
  statline(fuel, 'Carbs', `${eaten.carbsG} g`);
  statline(fuel, 'Fat', `${eaten.fatG} g`);
  statline(fuel, 'Fiber', `${eaten.fiberG} g`);

  const week = lastNDays(7);
  const weekSessions = workouts.filter((w) => week.includes(w.date));

  const wt = $('#week-training');
  wt.innerHTML = '';
  statline(wt, 'Workouts', String(weekSessions.length));
  statline(wt, 'Total volume', `${Math.round(weekSessions.reduce((t, s) => t + sessionVolume(s), 0))} lb`);
  statline(wt, 'Total sets', String(weekSessions.reduce((t, s) => t + sessionSets(s), 0)));

  renderSteps();
  renderProgress();
  renderWeekFuel(week);
}

/* Manual entry only — there's no browser API for HealthKit or Health Connect,
 * so this can't auto-read steps the way the native Android and iOS apps do.
 * See the note rendered into the card below. */
function renderSteps() {
  const today = todayKey();
  const goalSteps = settings.stepGoal || 10000;
  const card = $('#today-steps');
  card.innerHTML = '';

  bar(card, 'Today', steps[today] || 0, goalSteps, 'steps');

  const input = el('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.placeholder = 'Steps today';
  input.style.marginTop = '12px';
  input.value = steps[today] || '';
  input.onchange = () => {
    const v = parseInt(input.value, 10);
    steps[today] = isNaN(v) || v < 0 ? 0 : v;
    save(KEY.steps, steps);
    renderSteps();
  };
  card.appendChild(input);

  const row = el('div', 'row');
  const editGoal = el('button', 'ghost', 'Edit goal');
  editGoal.onclick = () => {
    const v = prompt('Daily step goal', String(goalSteps));
    if (v === null) return;
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) {
      settings.stepGoal = n;
      save(KEY.settings, settings);
      renderSteps();
    }
  };
  row.appendChild(editGoal);
  card.appendChild(row);

  card.appendChild(el('p', 'muted',
    'Entered by hand — browsers can’t read Health Connect or HealthKit. ' +
    'The Android and iOS apps track this automatically.'));
}

let selectedExercise = null;

function knownExercises() {
  const seen = new Map();
  [...workouts].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .forEach((s) => (s.exercises || []).forEach((ex) => {
      const k = matchKey(ex.name, ex.equipment);
      if (!seen.has(k)) seen.set(k, ex);
    }));
  return [...seen.values()].slice(0, 20);
}

function renderProgress() {
  const options = knownExercises();
  const chipBox = $('#progress-chips');
  const card = $('#progress-card');
  card.innerHTML = '';

  if (!options.length) {
    chipBox.innerHTML = '';
    card.appendChild(el('p', 'muted', 'Log a workout and your lifts will chart here.'));
    return;
  }

  if (!selectedExercise || !options.some((o) => matchKey(o.name, o.equipment) === selectedExercise)) {
    selectedExercise = matchKey(options[0].name, options[0].equipment);
  }

  chips(
    chipBox,
    options.map((o) => ({ label: o.equipment ? `${o.name} (${o.equipment})` : o.name, ex: o })),
    (item) => matchKey(item.ex.name, item.ex.equipment) === selectedExercise,
    (item) => { selectedExercise = matchKey(item.ex.name, item.ex.equipment); renderProgress(); }
  );

  // Plotted per session it appeared in, not per calendar day — an exercise
  // trained twice a week would otherwise be mostly empty space.
  const history = [...workouts]
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
    .flatMap((s) => (s.exercises || []).map((ex) => ({ date: s.date, ex })))
    .filter((h) => matchKey(h.ex.name, h.ex.equipment) === selectedExercise)
    .filter((h) => (h.ex.sets || []).length)
    .slice(-10);

  const topWeight = (ex) => {
    const ws = (ex.sets || []).map((s) => s.weightLb).filter((v) => v != null);
    return ws.length ? Math.max(...ws) : null;
  };
  // Epley: reliable to about five reps, optimistic beyond ten.
  const e1rm = (ex) => {
    const vals = (ex.sets || [])
      .filter((s) => s.weightLb != null && s.reps > 0)
      .map((s) => s.weightLb * (1 + s.reps / 30));
    return vals.length ? Math.max(...vals) : null;
  };

  const chosen = options.find((o) => matchKey(o.name, o.equipment) === selectedExercise);
  card.appendChild(el('h3', null, chosen.equipment ? `${chosen.name} (${chosen.equipment})` : chosen.name));

  const sumOf = (ex, key) => (ex.sets || []).reduce((t, st) => t + (st[key] || 0), 0);
  // A session that logged none of this metric is a gap in the line, not a zero:
  // drawChart skips null and would otherwise draw a dive to the axis.
  const scaled = (ex, key, divisor) => {
    const total = sumOf(ex, key);
    return total ? total / divisor : null;
  };
  const exVolume = (ex) => (ex.sets || [])
    .reduce((t, st) => t + ((st.weightLb || 0) * (st.reps || 0)), 0);

  const weights = history.map((h) => topWeight(h.ex)).filter((v) => v != null);
  const rms = history.map((h) => e1rm(h.ex)).filter((v) => v != null);
  const best = (values) => (values.length ? Math.max(...values) : null);

  statline(card, 'Sessions', String(history.length));

  /* Which two numbers matter depends on what you train for, and the old chart
   * answered "top weight and estimated 1RM" for everyone -- so an endurance or
   * Hyrox user got two dashes and a flat line.
   *
   * drawChart scales every series against ONE shared maximum, so a mode may
   * only pair series of comparable magnitude: pounds against pounds, or km
   * against minutes. Pairing metres with minutes would pin the minutes to the
   * baseline and look like a bug. Where nothing comparable exists, one series
   * is the honest answer. */
  const f = currentFocus();
  let series;

  if (f.chart === 'volume') {
    const volumes = history.map((h) => exVolume(h.ex)).filter((v) => v > 0);
    statline(card, 'Best volume', volumes.length ? `${Math.round(best(volumes))} lb` : '-');
    statline(card, 'Most recent', volumes.length ? `${Math.round(volumes[volumes.length - 1])} lb` : '-');
    statline(card, 'Best weight', weights.length ? `${Math.round(best(weights))} lb` : '-');
    series = [
      { label: 'Volume', color: CHART.volume, values: history.map((h) => exVolume(h.ex) || null) },
    ];
  } else if (f.chart === 'work') {
    const times = history.map((h) => sumOf(h.ex, 'durationSec')).filter((v) => v > 0);
    statline(card, 'Longest', times.length ? clock(best(times)) : '-');
    statline(card, 'Most recent', times.length ? clock(times[times.length - 1]) : '-');
    statline(card, 'Total reps', String(history.reduce((t, h) => t + sumOf(h.ex, 'reps'), 0) || '-'));
    series = [
      { label: 'Working time (min)', color: CHART.time,
        values: history.map((h) => scaled(h.ex, 'durationSec', 60)) },
    ];
  } else if (f.chart === 'pace') {
    const metres = history.map((h) => sumOf(h.ex, 'distanceMeters')).filter((v) => v > 0);
    const times = history.map((h) => sumOf(h.ex, 'durationSec')).filter((v) => v > 0);
    statline(card, 'Furthest', metres.length ? distanceLabel(best(metres)) : '-');
    statline(card, 'Most recent', metres.length ? distanceLabel(metres[metres.length - 1]) : '-');
    statline(card, 'Longest', times.length ? clock(best(times)) : '-');
    // Distance alone. km and minutes are both small numbers and would share an
    // axis legibly here, but Android's LineChart prints its shared maximum as
    // the axis label, where one number over two units is simply wrong -- and
    // the two apps charting endurance differently is worse than one fewer line.
    series = [
      { label: 'Distance (km)', color: CHART.distance,
        values: history.map((h) => scaled(h.ex, 'distanceMeters', 1000)) },
    ];
  } else {
    statline(card, 'Best weight', weights.length ? `${Math.round(best(weights))} lb` : '-');
    statline(card, 'Most recent', weights.length ? `${Math.round(weights[weights.length - 1])} lb` : '-');
    statline(card, 'Best est. 1RM', rms.length ? `${Math.round(best(rms))} lb` : '-');
    series = [
      { label: 'Top weight', color: CHART.weight, values: history.map((h) => topWeight(h.ex)) },
      { label: 'Est. 1RM', color: CHART.e1rm, values: history.map((h) => e1rm(h.ex)) },
    ];
  }

  const canvas = el('canvas');
  canvas.setAttribute('height', '150');
  card.appendChild(canvas);
  const lg = el('div', 'legend');
  card.appendChild(lg);
  requestAnimationFrame(() => drawChart(canvas, series, history.map((h) => shortLabel(h.date))));
  legend(lg, series);
}

function renderWeekFuel(week) {
  const logged = week.filter((d) => entriesFor(d).length);
  const weekCals = logged.reduce((t, d) => t + totals(entriesFor(d)).calories, 0);

  const stats = $('#week-fuel-stats');
  stats.innerHTML = '';
  statline(stats, 'Days logged', `${logged.length} of 7`);
  // Averaged over days actually logged — skipping a day shouldn't look like
  // eating less.
  statline(stats, 'Average calories', logged.length ? `${Math.round(weekCals / logged.length)} kcal` : '-');

  const val = (d, field) => entriesFor(d).length ? totals(entriesFor(d))[field] : null;

  const calSeries = [{ label: 'Calories', color: CHART.calories, values: week.map((d) => val(d, 'calories')) }];
  const macroSeries = [
    { label: 'Protein', color: CHART.protein, values: week.map((d) => val(d, 'proteinG')) },
    { label: 'Carbs', color: CHART.carbs, values: week.map((d) => val(d, 'carbsG')) },
    { label: 'Fat', color: CHART.fat, values: week.map((d) => val(d, 'fatG')) },
    { label: 'Fiber', color: CHART.fiber, values: week.map((d) => val(d, 'fiberG')) },
  ];
  const labels = week.map(shortLabel);

  requestAnimationFrame(() => {
    drawChart($('#chart-calories'), calSeries, labels);
    drawChart($('#chart-macros'), macroSeries, labels);
  });
  legend($('#legend-calories'), calSeries);
  legend($('#legend-macros'), macroSeries);
}

$('#open-calc').onclick = () => showTab('calc');

/* ---------------- calculator ---------------- */

const calc = { sex: 'male', activity: 1.55, goal: 0, protein: 0.8, fat: 0.25 };

function renderCalc() {
  chips($('#calc-sex'),
    [{ label: 'Male', v: 'male' }, { label: 'Female', v: 'female' }],
    (i) => calc.sex === i.v, (i) => { calc.sex = i.v; renderCalc(); });
  chips($('#calc-activity'), ACTIVITY.map(([label, v]) => ({ label, v })),
    (i) => calc.activity === i.v, (i) => { calc.activity = i.v; renderCalc(); });
  chips($('#calc-goal'), GOALS.map(([label, v]) => ({ label, v })),
    (i) => calc.goal === i.v, (i) => { calc.goal = i.v; renderCalc(); });
  chips($('#calc-protein'), PROTEIN.map(([label, v]) => ({ label, v })),
    (i) => calc.protein === i.v, (i) => { calc.protein = i.v; renderCalc(); });
  chips($('#calc-fat'), FAT.map(([label, v]) => ({ label, v })),
    (i) => calc.fat === i.v, (i) => { calc.fat = i.v; renderCalc(); });
  updateCalcResult();
}

function currentCalc() {
  const age = parseFloat($('#c-age').value);
  const weight = parseFloat($('#c-weight').value);
  const ft = parseFloat($('#c-ft').value);
  const inch = parseFloat($('#c-in').value) || 0;
  if (!age || !weight || !ft) return null;
  return calculateMacros(calc.sex, age, weight, ft * 12 + inch, calc.activity, calc.goal, calc.protein, calc.fat);
}

function updateCalcResult() {
  const out = $('#calc-result');
  out.innerHTML = '';
  const r = currentCalc();
  if (!r) {
    out.appendChild(el('p', 'muted', 'Enter age, weight and height to see your numbers.'));
    $('#calc-save').disabled = true;
    return;
  }
  $('#calc-save').disabled = false;
  const box = el('div');
  box.style.marginTop = '16px';
  const head = el('div', 'big', `${r.calories} kcal / day`);
  box.appendChild(head);
  [['Protein', r.proteinG], ['Fat', r.fatG], ['Carbs', r.carbsG], ['Fiber', r.fiberG]].forEach(([k, v]) => {
    const row = el('div', 'result');
    row.appendChild(el('span', null, k));
    row.appendChild(el('span', null, `${v} g`));
    box.appendChild(row);
  });
  out.appendChild(box);
}

['c-age', 'c-weight', 'c-ft', 'c-in'].forEach((id) => {
  $('#' + id).addEventListener('input', updateCalcResult);
});

$('#calc-save').onclick = () => {
  const r = currentCalc();
  if (!r) return;
  goal = r;
  save(KEY.goal, goal);

  // The numbers that produced the goal are worth keeping: a coach reading a
  // 2,400 kcal target wants to know it came from a 210 lb 34-year-old, and the
  // weight is a genuine reading on a genuine day rather than a guess.
  const inch = parseFloat($('#c-in').value) || 0;
  profile = {
    sex: calc.sex,
    age: parseFloat($('#c-age').value),
    weightLb: parseFloat($('#c-weight').value),
    heightIn: parseFloat($('#c-ft').value) * 12 + inch,
  };
  save(KEY.profile, profile);
  weights[todayKey()] = profile.weightLb;
  save(KEY.weights, weights);

  showTab('home');
};
$('#calc-cancel').onclick = () => showTab('home');

/* ---------------- food ---------------- */

let foodDate = todayKey();
let formMeal = 'BREAKFAST';

function renderFood() {
  $('#food-date').textContent = dateLabel(foodDate);
  $('#food-next').disabled = foodDate === todayKey();

  const list = entriesFor(foodDate);
  const t = totals(list);

  const sum = $('#food-summary');
  sum.innerHTML = '';
  if (goal) {
    const remaining = goal.calories - t.calories;
    sum.appendChild(el('div', 'big', remaining >= 0 ? `${remaining} kcal left` : `${-remaining} kcal over`));
    sum.appendChild(el('p', 'muted', `${t.calories} of ${goal.calories}`));
    bar(sum, 'Protein', t.proteinG, goal.proteinG);
    bar(sum, 'Fat', t.fatG, goal.fatG);
    bar(sum, 'Carbs', t.carbsG, goal.carbsG);
    bar(sum, 'Fiber', t.fiberG, goal.fiberG);
  } else {
    sum.appendChild(el('p', 'muted', 'Set a goal on the Home tab and it will show up here.'));
  }

  // recent, deduplicated by name
  const seen = new Map();
  [...food].sort((a, b) => (b.loggedAt || 0) - (a.loggedAt || 0))
    .forEach((e) => { const k = e.name.trim().toLowerCase(); if (!seen.has(k)) seen.set(k, e); });
  chips($('#recent-chips'), [...seen.values()].slice(0, 10).map((e) => ({ label: e.name, e })),
    () => false,
    (item) => {
      food.push({ ...item.e, id: uid(), date: foodDate, loggedAt: Date.now(), meal: guessMeal() });
      save(KEY.food, food);
      render();
    });

  const out = $('#food-list');
  out.innerHTML = '';
  if (!list.length) {
    out.appendChild(el('p', 'muted', 'Nothing logged on this day.'));
    return;
  }
  MEALS.forEach((meal) => {
    const forMeal = list.filter((e) => mealOf(e) === meal);
    if (!forMeal.length) return;
    const head = el('div', 'mealhead');
    head.appendChild(el('span', null, MEAL_LABEL[meal]));
    head.appendChild(el('span', null, `${totals(forMeal).calories} kcal`));
    out.appendChild(head);
    forMeal.forEach((e) => {
      const row = el('div', 'entry');
      const info = el('div');
      const amount = FoodAmount.amountText(e, servingUnitKey());
      info.appendChild(el('div', null, amount ? `${e.name} - ${amount}` : e.name));
      info.appendChild(el('div', 'muted',
        `${mul(e, 'calories')} kcal - P ${mul(e, 'proteinG')} - F ${mul(e, 'fatG')} - C ${mul(e, 'carbsG')} - Fib ${mul(e, 'fiberG')}`));
      row.appendChild(info);
      const x = el('button', 'x', '\u00d7');
      // Mutate the live array in place rather than rebinding `food` to a
      // new one. `food` is `let`, and anything that captured it -- a closure,
      // a published reference -- would keep pointing at the abandoned array
      // forever, silently. window.food was exactly that bug: an import after
      // any delete wrote a stale array over storage, losing every entry
      // logged since. Nothing is published by value now, and in-place
      // mutation keeps it that way.
      x.onclick = () => {
        const i = food.findIndex((f) => f.id === e.id);
        if (i !== -1) food.splice(i, 1);
        save(KEY.food, food);
        render();
      };
      row.appendChild(x);
      out.appendChild(row);
    });
  });
}

function guessMeal() {
  const h = new Date().getHours();
  if (h < 11) return 'BREAKFAST';
  if (h < 15) return 'LUNCH';
  if (h < 21) return 'DINNER';
  return 'SNACK';
}

$('#food-prev').onclick = () => { foodDate = shiftDate(foodDate, -1); render(); };
$('#food-next').onclick = () => { foodDate = shiftDate(foodDate, 1); render(); };

/* Food is logged by weight. The unit is the person's preference -- grams or
 * ounces -- and matches `servingUnit` in LIFT iOS and LIFT Android so a
 * backup carries it between them. Grams are canonical on the wire either way.
 *
 * Servings are gone as something you type. Entries logged before this still
 * carry one and still render from it, because there is no honest way to turn
 * "2 servings" into grams after the fact. */
let foodPer100 = null;

const servingUnitKey = () => (settings.servingUnit === 'ounces' ? 'oz' : 'g');

/* A recipe's total weight, in grams, or null when blank or not a positive
 * number. Null is a real answer: an unweighed recipe keeps working by
 * servings, and a zero would be a dish that weighs nothing. */
function recipeWeightGrams() {
  const typed = parseFloat($('#r-weight').value);
  if (!isFinite(typed) || typed <= 0) return null;
  return FoodAmount.UNITS[servingUnitKey()].toGrams(typed);
}

/* The recipe form's unit chips. They change the same person-level setting the
 * food form does -- one preference, as in LIFT iOS -- and carry the weight
 * across the switch rather than reinterpreting the number, so 1200 g becomes
 * 42.3 oz and never 1200 oz. */
function renderRecipeWeightUnit() {
  chips($('#r-weight-mode'),
    [{ label: 'Grams', u: 'grams' }, { label: 'Ounces', u: 'ounces' }],
    (i) => i.u === (settings.servingUnit || 'grams'),
    (i) => {
      const before = recipeWeightGrams();
      settings.servingUnit = i.u;
      save(KEY.settings, settings);
      if (before) {
        $('#r-weight').value = FoodAmount.trim(FoodAmount.UNITS[servingUnitKey()].fromGrams(before));
      }
      renderRecipeWeightUnit();
      render();
    });
  $('#r-weight-label').textContent = `Total weight (${FoodAmount.UNITS[servingUnitKey()].abbreviation})`;
  renderRecipeWeightEach();
}

/* "4 servings · 300 g each", when both numbers are known. The point of the
 * field: a count says how many portions exist, not how much is on the scale. */
function renderRecipeWeightEach() {
  const grams = recipeWeightGrams();
  const count = parseFloat($('#r-servings').value);
  const out = $('#r-weight-each');
  if (!grams || !(count > 0)) { out.textContent = ''; return; }
  const unit = FoodAmount.UNITS[servingUnitKey()];
  out.textContent = `${count} serving${count === 1 ? '' : 's'} \u00B7 `
    + `${FoodAmount.trim(unit.fromGrams(grams / count))} ${unit.abbreviation} each`;
}

function openFoodForm(prefill) {
  $('#food-form').classList.remove('hidden');
  $('#food-search').classList.add('hidden');
  formMeal = guessMeal();

  // Only a hit carrying per-100 g values can be prefilled. One that lists a
  // serving size and nothing else has numbers on a basis this form does not
  // use, and quietly treating them as per-100 g is how a portion becomes a
  // reading off the side of the packet.
  foodPer100 = prefill ? (prefill.per100 || null) : null;

  $('#f-name').value = prefill ? prefill.name : '';
  $('#f-amount').value = FoodAmount.trim(
    FoodAmount.UNITS[servingUnitKey()].fromGrams(100)
  );

  const from = foodPer100;
  $('#f-cal').value = from ? from.calories : '';
  $('#f-p').value = from ? from.proteinG : '';
  $('#f-f').value = from ? from.fatG : '';
  $('#f-c').value = from ? from.carbsG : '';
  $('#f-fib').value = from ? from.fiberG : '';

  renderMealChips();
  renderFoodUnit(prefill);
  renderFoodPreview();
}

/* The macro fields are always per 100 g, and say so. Leaving them as a bare
 * "Calories" is how someone logs 100 g of chicken as a whole breast. */
function renderFoodUnit(prefill) {
  chips($('#f-mode'),
    [{ label: 'Grams', u: 'grams' }, { label: 'Ounces', u: 'ounces' }],
    (i) => i.u === (settings.servingUnit || 'grams'),
    (i) => {
      const before = amountInGrams();
      settings.servingUnit = i.u;
      save(KEY.settings, settings);
      // Carry the weight across the unit change rather than reinterpreting
      // the number, so switching to ounces mid-entry does not turn 175 g into
      // 175 oz. It is preserved only to the precision ounces display, one
      // decimal -- 175 g becomes 6.2 oz, which is 175.8 g and one more
      // calorie. Showing 6.17466 oz to avoid that would be worse.
      if (before) {
        $('#f-amount').value = FoodAmount.trim(
          FoodAmount.UNITS[servingUnitKey()].fromGrams(before)
        );
      }
      renderFoodUnit(prefill);
      renderFoodPreview();
      render();
    });

  const unit = FoodAmount.UNITS[servingUnitKey()];
  $('#f-amount-label').textContent = `Amount (${unit.abbreviation})`;
  $('#f-cal-label').textContent = 'Calories (per 100 g)';
  // Short enough not to wrap onto two lines at phone width, which knocked
  // the paired fields out of alignment. The note above carries the long form.
  $('#f-p-label').textContent = 'Protein (g/100g)';
  $('#f-f-label').textContent = 'Fat (g/100g)';
  $('#f-c-label').textContent = 'Carbs (g/100g)';
  $('#f-fib-label').textContent = 'Fiber (g/100g)';

  $('#f-basis-note').textContent = prefill && !foodPer100
    ? 'This product only lists a serving size, so its macros could not be '
      + 'filled in here. Enter them as they read per 100 g.'
    : 'Macros as they read per 100 g, then the amount you actually ate.';
}

/* What the entry will actually count as, shown before it is committed.
 *
 * The iPhone's food search and both watches have always shown this while you
 * set the amount; the two hand-entry forms made you save first and find out
 * afterwards. Seeing 219 kcal appear as you type 175 g is also how a typo in
 * the per-100 g numbers becomes obvious at entry rather than in the day's
 * total. */
function renderFoodPreview() {
  const box = $('#f-preview');
  if (!box) return;

  const grams = amountInGrams();
  const calories = parseInt($('#f-cal').value, 10);
  if (grams == null || isNaN(calories)) {
    box.textContent = '';
    return;
  }

  const t = FoodAmount.scaleFrom100g({
    calories,
    proteinG: parseInt($('#f-p').value, 10) || 0,
    fatG: parseInt($('#f-f').value, 10) || 0,
    carbsG: parseInt($('#f-c').value, 10) || 0,
    fiberG: parseInt($('#f-fib').value, 10) || 0,
  }, grams);
  if (!t) { box.textContent = ''; return; }

  const unit = FoodAmount.UNITS[servingUnitKey()];
  const shown = FoodAmount.trim(unit.fromGrams(grams)) + ' ' + unit.abbreviation;
  box.textContent = `${shown} = ${t.calories} kcal - P ${t.proteinG} - F ${t.fatG}`
    + ` - C ${t.carbsG} - Fib ${t.fiberG}`;
}

/** The amount currently in the form, in grams. Null if it isn't a weight. */
function amountInGrams() {
  const entered = parseFloat($('#f-amount').value);
  if (!isFinite(entered) || entered <= 0) return null;
  return FoodAmount.UNITS[servingUnitKey()].toGrams(entered);
}

function renderMealChips() {
  chips($('#f-meal'), MEALS.map((m) => ({ label: MEAL_LABEL[m], m })),
    (i) => i.m === formMeal, (i) => { formMeal = i.m; renderMealChips(); });
}

// Every field the preview reads, so it never shows a total for numbers that
// are no longer on screen.
['#f-amount', '#f-cal', '#f-p', '#f-f', '#f-c', '#f-fib'].forEach((sel) => {
  $(sel).addEventListener('input', renderFoodPreview);
});

$('#food-add').onclick = () => openFoodForm(null);
$('#f-cancel').onclick = () => $('#food-form').classList.add('hidden');

$('#f-save').onclick = () => {
  const name = $('#f-name').value.trim();
  const calories = parseInt($('#f-cal').value, 10);
  const grams = amountInGrams();
  if (!name || isNaN(calories) || grams == null) return;

  // Stored the way the native apps store it: the gram amount is
  // authoritative, servings is 1, and the macros are already the totals for
  // this amount. `totals()` multiplies by servings, so a 1 leaves them be.
  const totalsForAmount = FoodAmount.scaleFrom100g({
    calories,
    proteinG: parseInt($('#f-p').value, 10) || 0,
    fatG: parseInt($('#f-f').value, 10) || 0,
    carbsG: parseInt($('#f-c').value, 10) || 0,
    fiberG: parseInt($('#f-fib').value, 10) || 0,
  }, grams);
  if (!totalsForAmount) return;

  food.push({
    id: uid(), name,
    servings: 1,
    amountGrams: grams,
    ...totalsForAmount,
    date: foodDate, loggedAt: Date.now(), meal: formMeal,
  });
  save(KEY.food, food);
  $('#food-form').classList.add('hidden');
  render();
};

/* ---------------- Open Food Facts ---------------- */

$('#food-search-open').onclick = () => {
  $('#food-search').classList.remove('hidden');
  $('#food-form').classList.add('hidden');
  $('#fs-query').focus();
};
$('#fs-cancel').onclick = () => $('#food-search').classList.add('hidden');

/* Food lookups go through a small Cloudflare Worker rather than straight to
 * Open Food Facts.
 *
 * Their two hosts each refuse one of the paths we need: search.openfoodfacts.org
 * sends no CORS headers so browsers block it, and world.openfoodfacts.org's
 * search endpoint returns 503 to datacentre traffic. The proxy calls them
 * server-side, where CORS doesn't apply, and adds the header on the way back.
 *
 * Source: worker.js in this repo.
 */
const PROXY = 'https://lift-proxy.dugcanlift.workers.dev';

function showResults(items) {
  const box = $('#fs-results');
  box.innerHTML = '';
  if (!items.length) {
    box.appendChild(el('p', 'muted', 'Nothing found for that.'));
    return;
  }
  items.forEach((h) => {
    const row = el('div', 'entry');
    const info = el('div');
    info.appendChild(el('div', null, h.name));
    info.appendChild(el('div', 'muted',
      `${h.calories} kcal, ${h.basis} - P ${h.proteinG} - F ${h.fatG} - C ${h.carbsG}`));
    row.appendChild(info);
    row.onclick = () => { $('#food-search').classList.add('hidden'); openFoodForm(h); };
    box.appendChild(row);
  });
}

async function runSearch(query) {
  const box = $('#fs-results');
  box.innerHTML = '';
  box.appendChild(el('p', 'muted', 'Searching...'));

  // A string of digits is almost certainly a barcode, so look it up directly
  // rather than searching for the number as text.
  const isBarcode = /^[0-9]{8,14}$/.test(query);

  try {
    if (isBarcode) {
      const res = await fetch(`${PROXY}/barcode/${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      if (data.status !== 1 || !data.product) {
        box.innerHTML = '';
        box.appendChild(el('p', 'muted', 'No product found for that barcode.'));
        return;
      }
      const one = parseProduct(data.product);
      showResults(one ? [one] : []);
      return;
    }

    const res = await fetch(`${PROXY}/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    // Search-a-licious returns "hits"; the barcode endpoint returns a product.
    showResults((data.hits || []).map(parseProduct).filter(Boolean));
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'muted', `Could not reach Open Food Facts (${e.message}).`));
  }
}

$('#fs-go').onclick = () => {
  const q = $('#fs-query').value.trim();
  if (q) runSearch(q);
};

$('#fs-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#fs-go').click(); }
});

function parseProduct(p) {
  const n = p.nutriments || {};
  const num = (v) => (typeof v === 'number' ? v : parseFloat(v));
  if (!p.product_name) return null;

  const read = (suffix) => {
    const cal = num(n[`energy-kcal_${suffix}`]);
    // No calorie figure makes an entry useless for tracking — better to skip
    // the product than log a misleading zero.
    if (isNaN(cal)) return null;
    return {
      calories: Math.round(cal),
      proteinG: Math.round(num(n[`proteins_${suffix}`]) || 0),
      fatG: Math.round(num(n[`fat_${suffix}`]) || 0),
      carbsG: Math.round(num(n[`carbohydrates_${suffix}`]) || 0),
      fiberG: Math.round(num(n[`fiber_${suffix}`]) || 0),
    };
  };

  const perServing = read('serving');
  const per100 = read('100g');
  const values = perServing || per100;
  if (!values) return null;

  const brand = Array.isArray(p.brands) ? p.brands[0] : p.brands;
  const display = brand ? `${p.product_name} (${brand})` : p.product_name;
  const serving = (p.serving_size || '').trim();

  // Say which basis the numbers are on, so nobody logs a bowl of rice
  // thinking it was a portion when it was 100 grams.
  const basis = perServing ? (serving || 'per serving') : 'per 100 g';

  return {
    name: `${display}, ${basis}`,
    basis,
    // Kept alongside whichever basis won above, because logging by weight
    // needs per-100 g specifically and this is the only place that knows
    // whether Open Food Facts gave us any. A product with only a serving
    // size cannot be weighed into, and the form says so rather than
    // guessing a conversion.
    per100: per100 || null,
    ...values,
  };
}

/* ---------------- train ---------------- */

let trainDate = todayKey();

/* ---------------- exercise library ----------------
 *
 * 873 exercises from free-exercise-db, the same file and the same picker the
 * Coach app uses — a coach prescribing "Barbell Squat" and a client logging it
 * are then naming the same lift, which is what makes history match up.
 *
 * Fetched on first use. Someone who only tracks food never pays for it.
 */

let exerciseLibrary = null;
let libraryError = null;
let pickerSession = null;
let exerciseFilter = '';

const EQUIPMENT_FILTERS = ['barbell', 'dumbbell', 'machine', 'cable', 'body only', 'kettlebells'];

const titleCase = (text) => (text || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

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

async function openExercisePicker(session) {
  pickerSession = session;
  const panel = $('#exercise-picker');
  panel.classList.remove('hidden');
  $('#ex-query').value = '';
  $('#ex-results').innerHTML = '';
  $('#ex-results').appendChild(el('p', 'muted', 'Loading the exercise library...'));
  panel.scrollIntoView({ block: 'nearest' });

  await loadExerciseLibrary();
  renderExercisePicker();
  $('#ex-query').focus();
}

function renderExercisePicker() {
  const results = $('#ex-results');
  results.innerHTML = '';

  const query = $('#ex-query').value.trim();

  // Typing a name nothing matches still has to work: the library is a
  // convenience, not a gate on what you are allowed to have done.
  const addByHand = (name, equipment) => {
    pickerSession.exercises = pickerSession.exercises || [];
    pickerSession.exercises.push({
      id: uid(), name: name.trim(), equipment: (equipment || '').trim(), note: '', sets: [],
    });
    save(KEY.workouts, workouts);
    $('#exercise-picker').classList.add('hidden');
    render();
  };

  if (libraryError) {
    results.appendChild(el('p', 'muted',
      `Could not load the exercise library (${libraryError}).`));
    if (query) {
      const own = el('button', 'wide', `Add "${query}" anyway`);
      own.onclick = () => addByHand(query, '');
      results.appendChild(own);
    }
    return;
  }

  chips($('#ex-filters'),
    [{ label: 'All', v: '' }, ...EQUIPMENT_FILTERS.map((e) => ({ label: titleCase(e), v: e }))],
    (i) => i.v === exerciseFilter,
    (i) => { exerciseFilter = i.v; renderExercisePicker(); });

  const needle = query.toLowerCase();
  const hits = (exerciseLibrary || [])
    .filter((x) => !exerciseFilter || x.equipment === exerciseFilter)
    .filter((x) => !needle
      || x.name.toLowerCase().includes(needle)
      || x.muscle.toLowerCase().includes(needle))
    .slice(0, 40);

  if (!hits.length) {
    results.appendChild(el('p', 'muted', 'Nothing matches that.'));
  }

  hits.forEach((hit) => {
    const row = el('button', 'chip wide',
      `${hit.name} - ${hit.muscle}${hit.equipment ? `, ${hit.equipment}` : ''}`);
    row.onclick = () => addByHand(hit.name, titleCase(hit.equipment));
    results.appendChild(row);
  });

  if (query) {
    const own = el('button', 'ghost wide', `Add "${query}" as typed`);
    own.onclick = () => addByHand(query, '');
    results.appendChild(own);
  }
}

$('#ex-cancel').onclick = () => $('#exercise-picker').classList.add('hidden');
$('#ex-query').addEventListener('input', () => {
  if (pickerSession) renderExercisePicker();
});

/** What a prescribed set asks for: "225 x 5 @8", "5 reps", "10:00 - 1600 m". */
function formatPrescription(set) {
  const parts = [];
  if (set.weightLb != null && set.reps != null) parts.push(`${set.weightLb} x ${set.reps}`);
  else if (set.reps != null) parts.push(`${set.reps} reps`);
  else if (set.weightLb != null) parts.push(`${set.weightLb} lb`);
  if (set.distanceMeters != null) parts.push(`${set.distanceMeters} m`);
  if (set.durationSec != null) {
    parts.push(set.durationSec >= 60
      ? `${Math.floor(set.durationSec / 60)}:${String(set.durationSec % 60).padStart(2, '0')}`
      : `${set.durationSec}s`);
  }
  if (set.rpe != null) parts.push(`@${set.rpe}`);
  return parts.join(' ') || 'as written';
}

/* The coach's session for this day, shown above your own log rather than
 * inside it. Starting it copies the prescription into a real workout you can
 * then correct — see startPrescribed. */
function renderPrescribed() {
  const wrap = $('#prescribed');
  wrap.innerHTML = '';

  renderTemplates(wrap);

  prescribedFor(trainDate).forEach((prescription) => {
    const card = el('div', 'card');
    const from = typeof prescription.fromCoach === 'string'
      ? `From ${prescription.fromCoach}` : 'From your coach';
    card.appendChild(el('p', 'muted', from));
    card.appendChild(el('p', 'big', prescription.name));

    prescription.exercises.forEach((exercise) => {
      const block = el('div', 'exercise');
      block.appendChild(el('h3', null,
        exercise.equipment ? `${exercise.name} (${exercise.equipment})` : exercise.name));
      exercise.sets.forEach((set, i) => {
        block.appendChild(el('div', 'muted', `${i + 1}.  ${formatPrescription(set)}`));
      });
      if (exercise.note) block.appendChild(el('p', 'muted', exercise.note));
      card.appendChild(block);
    });

    const started = prescription.startedSessionId
      && workouts.some((w) => w.id === prescription.startedSessionId);

    if (started) {
      card.appendChild(el('p', 'muted', 'Started - log what you actually did below.'));
    } else {
      const go = el('button', 'wide', 'Start this session');
      go.onclick = () => startPrescribed(prescription);
      card.appendChild(go);
    }

    wrap.appendChild(card);
  });
}

/* Templates a coach sent without a date on them. Shown on whatever day you are
 * looking at, because that is the point of them — you decide when. */
function renderTemplates(wrap) {
  if (!templates.length) return;

  const card = el('div', 'card');
  card.appendChild(el('p', 'muted', 'From your coach, to do when you like'));

  templates.forEach((template) => {
    const row = el('div', 'entry');
    const info = el('div');
    info.appendChild(el('div', null, template.name));
    const sets = template.exercises.reduce((t, e) => t + e.sets.length, 0);
    info.appendChild(el('div', 'muted',
      `${template.exercises.length} exercises - ${sets} sets`));
    row.appendChild(info);

    const go = el('button', 'ghost', 'Start');
    go.onclick = () => startPrescribed({ ...template, date: trainDate });
    row.appendChild(go);

    const drop = el('button', 'x', '\u00d7');
    drop.onclick = () => {
      if (!confirm(`Remove "${template.name}" from your templates?`)) return;
      templates = templates.filter((t) => t.id !== template.id);
      save(KEY.templates, templates);
      render();
    };
    row.appendChild(drop);

    card.appendChild(row);
  });

  wrap.appendChild(card);
}

function renderTrain() {
  $('#train-date').textContent = dateLabel(trainDate);
  $('#train-next').disabled = trainDate === todayKey();

  chips($('#focus-chips'), Object.keys(FOCUS).map((k) => ({ label: FOCUS[k].label, k })),
    (i) => i.k === settings.focus,
    (i) => { settings.focus = i.k; save(KEY.settings, settings); render(); });

  renderPrescribed();
  renderRoutines();
  renderOutdoor();

  const f = currentFocus();
  const out = $('#session-list');
  out.innerHTML = '';

  sessionsFor(trainDate).forEach((session) => {
    const card = el('div', 'card');

    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Workout name';
    nameInput.value = session.name || '';
    nameInput.onchange = () => { session.name = nameInput.value; save(KEY.workouts, workouts); };
    card.appendChild(nameInput);

    if (sessionSets(session)) {
      card.appendChild(el('p', 'muted', focusSummary(session, f)));
    }

    (session.exercises || []).forEach((ex) => {
      const block = el('div', 'exercise');
      block.appendChild(el('h3', null, ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name));

      const prev = lastPerformed(ex, session);
      if (prev) block.appendChild(el('p', 'muted', 'Last time: ' + prev.sets.map(formatSet).join('   ')));

      (ex.sets || []).forEach((st, i) => {
        const row = el('div', 'entry');
        row.appendChild(el('div', null, `${i + 1}.  ${formatSet(st)}`));
        const x = el('button', 'x', '\u00d7');
        x.onclick = () => {
          ex.sets = ex.sets.filter((s) => s.id !== st.id);
          save(KEY.workouts, workouts);
          render();
        };
        row.appendChild(x);
        block.appendChild(row);
      });

      const add = el('button', 'ghost', 'Add set');
      add.onclick = () => addSetPrompt(ex, f);
      block.appendChild(add);
      card.appendChild(block);
    });

    const addEx = el('button', 'ghost wide', 'Add exercise');
    addEx.onclick = () => openExercisePicker(session);
    card.appendChild(addEx);

    if ((session.exercises || []).length) {
      const keep = el('button', 'ghost wide', 'Save as routine');
      keep.onclick = () => saveAsRoutine(session);
      card.appendChild(keep);
    }

    const del = el('button', 'ghost wide', 'Delete workout');
    del.onclick = () => {
      if (!confirm('Delete this workout?')) return;
      workouts = workouts.filter((w) => w.id !== session.id);
      save(KEY.workouts, workouts);
      render();
    };
    card.appendChild(del);

    out.appendChild(card);
  });
}

function lastPerformed(ex, currentSession) {
  const key = matchKey(ex.name, ex.equipment);
  const found = [...workouts]
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .filter((s) => s.id !== currentSession.id)
    .flatMap((s) => s.exercises || [])
    .find((e) => matchKey(e.name, e.equipment) === key && (e.sets || []).length);
  return found || null;
}

function addSetPrompt(ex, f) {
  const last = (ex.sets || [])[ex.sets.length - 1] || {};
  const set = { id: uid() };
  if (f.weight) {
    const v = prompt('Weight (lb)', last.weightLb != null ? last.weightLb : '');
    if (v === null) return;
    if (v !== '') set.weightLb = parseFloat(v);
  }
  if (f.reps) {
    // The set before is the best guess there is; the focus only has to answer
    // for the first one, where 5 and 10 are different training decisions.
    const seed = last.reps != null ? last.reps : (f.defaultReps != null ? f.defaultReps : '');
    const v = prompt('Reps', seed);
    if (v === null) return;
    if (v !== '') set.reps = parseInt(v, 10);
  }
  if (f.rpe) {
    const v = prompt('RPE (optional)', '');
    if (v) set.rpe = parseFloat(v);
  }
  if (f.time) {
    const v = prompt('Time (mm:ss or seconds)', '');
    if (v) set.durationSec = parseDuration(v);
  }
  if (f.dist) {
    const v = prompt('Distance (m)', '');
    if (v) set.distanceMeters = parseFloat(v);
  }
  const empty = ['weightLb', 'reps', 'rpe', 'durationSec', 'distanceMeters']
    .every((k) => set[k] === undefined || isNaN(set[k]));
  if (empty) return;
  ex.sets = ex.sets || [];
  ex.sets.push(set);
  save(KEY.workouts, workouts);
  render();
}

function parseDuration(text) {
  const t = String(text).trim();
  if (t.includes(':')) {
    const [m, s] = t.split(':');
    return (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0);
  }
  return parseInt(t, 10) || null;
}

function formatSet(s) {
  const parts = [];
  if (s.weightLb != null && s.reps != null) parts.push(`${s.weightLb} x ${s.reps}`);
  else {
    if (s.weightLb != null) parts.push(`${s.weightLb} lb`);
    if (s.reps != null) parts.push(`${s.reps} reps`);
  }
  if (s.rpe != null) parts.push(`@${s.rpe}`);
  if (s.durationSec != null) {
    parts.push(s.durationSec >= 60
      ? `${Math.floor(s.durationSec / 60)}:${String(s.durationSec % 60).padStart(2, '0')}`
      : `${s.durationSec}s`);
  }
  if (s.distanceMeters != null) parts.push(`${s.distanceMeters} m`);
  return parts.length ? parts.join(' ') : '-';
}

$('#train-prev').onclick = () => { trainDate = shiftDate(trainDate, -1); render(); };
$('#train-next').onclick = () => { trainDate = shiftDate(trainDate, 1); render(); };
$('#train-start').onclick = () => {
  workouts.push({ id: uid(), date: trainDate, name: '', note: '', exercises: [], startedAt: Date.now() });
  save(KEY.workouts, workouts);
  render();
};


/* ---------------- routines ----------------
 *
 * Starter splits come from splits.json, the same file LIFT for iOS and Android
 * bundle. Adding one copies it into your routines, where it is yours to start
 * or delete; the rules are in routines.js. A routine starts on the day Train is
 * showing, as a workout with its sets already laid out.
 */

let starterRoutines = null;
let startersError = false;

async function loadStarterRoutines() {
  if (starterRoutines || startersError) return;
  try {
    const response = await fetch('splits.json');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    starterRoutines = LiftRoutines.parseStarters(await response.json(), uid, Date.now());
  } catch (e) {
    // Costs the starter list and nothing else; writing your own still works.
    startersError = true;
  }
  if (currentTab === 'train') renderRoutines();
}

function startRoutine(routine) {
  workouts.push(LiftRoutines.toSession(routine, trainDate, uid, Date.now()));
  save(KEY.workouts, workouts);
  render();
  const list = $('#session-list');
  if (list.lastElementChild) list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveAsRoutine(session) {
  const name = prompt('Name this routine', session.name || '');
  if (name === null) return;
  routines.push(LiftRoutines.fromSession(session, name, '', uid, Date.now()));
  save(KEY.routines, routines);
  render();
}

function routineRow(routine, button) {
  const row = el('div', 'entry');
  const info = el('div');
  info.appendChild(el('div', null, routine.name));
  info.appendChild(el('div', 'muted',
    `${routine.exercises.length} ${routine.exercises.length === 1 ? 'exercise' : 'exercises'} - ${LiftRoutines.setCount(routine)} sets`));
  row.appendChild(info);
  row.appendChild(button);
  return row;
}

function renderRoutines() {
  const wrap = $('#routine-list');
  wrap.innerHTML = '';
  if (!starterRoutines && !startersError) loadStarterRoutines();

  if (routines.length) {
    const card = el('div', 'card');
    card.appendChild(el('strong', null, 'Your routines'));
    LiftRoutines.byFolder(routines).forEach((group) => {
      const head = el('div', 'mealhead');
      head.appendChild(el('span', null, group.folder));
      head.appendChild(el('span', null, String(group.routines.length)));
      card.appendChild(head);
      group.routines.forEach((routine) => {
        const go = el('button', 'ghost', 'Start');
        go.onclick = () => startRoutine(routine);
        const row = routineRow(routine, go);
        const drop = el('button', 'x', '×');
        drop.setAttribute('aria-label', `Delete ${routine.name}`);
        drop.onclick = () => {
          if (!confirm(`Delete the routine "${routine.name}"? Workouts you already logged from it stay.`)) return;
          routines = routines.filter((r) => r.id !== routine.id);
          save(KEY.routines, routines);
          render();
        };
        row.appendChild(drop);
        card.appendChild(row);
      });
    });
    wrap.appendChild(card);
  }

  const unclaimed = (starterRoutines || []).filter((s) => !LiftRoutines.alreadySaved(s, routines));
  if (unclaimed.length) {
    // Closed until asked for: open, ten starters push the day's own workout
    // off the bottom of a phone screen.
    const card = el('details', 'card starters');
    card.appendChild(el('summary', null, `Starter routines (${unclaimed.length})`));
    LiftRoutines.byFolder(unclaimed).forEach((group) => {
      const head = el('div', 'mealhead');
      head.appendChild(el('span', null, group.folder));
      card.appendChild(head);
      group.routines.forEach((starter) => {
        const add = el('button', 'ghost', 'Add');
        add.onclick = () => {
          routines.push(LiftRoutines.copyOf(starter, uid, Date.now()));
          save(KEY.routines, routines);
          render();
        };
        const row = routineRow(starter, add);
        row.firstChild.appendChild(el('div', 'muted small clamp', starter.exercises.map((e) => e.name).join(', ')));
        card.appendChild(row);
      });
    });
    wrap.appendChild(card);
  }
}

/* ---------------- outdoor ----------------
 *
 * GPS runs, walks and hikes, recorded by the browser. The rules -- which fixes
 * to keep, distance, bests, drawing -- are outdoor.js, shared in spirit with
 * LIFT for iOS and Android and tested by node.
 *
 * A browser is not a phone app here, and the card says so: it only reads GPS
 * while the page is on screen. Locking the phone or switching apps pauses the
 * route, so the recording screen asks for a wake lock to keep the screen on,
 * and tells you when the signal has gone quiet.
 *
 * The route is a line on a plain canvas rather than a street map. A map means
 * sending your location to a tile server on every run, and this app sends
 * nothing anywhere you did not ask it to.
 */

const outdoorLabel = (type) => (LiftOutdoor.TYPES.find((t) => t.key === type) || { label: 'Outdoor' }).label;
const outdoorOn = (day) => outdoor
  .filter((a) => dateKey(new Date(a.startedAtEpochMs)) === day)
  .sort((a, b) => a.startedAtEpochMs - b.startedAtEpochMs);
const distanceUnit = () => (settings.distanceUnit === 'kilometers' ? 'kilometers' : 'miles');
const activityDate = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function outdoorPace(a) {
  const pace = LiftOutdoor.paceSecondsPerMeter(a);
  return pace && a.distanceMeters >= LiftOutdoor.MINIMUM_PACE_DISTANCE_METERS
    ? LiftOutdoor.paceText(pace, distanceUnit()) : '—';
}

function outdoorSummary(a) {
  const ms = LiftOutdoor.durationMs(a);
  return `${LiftOutdoor.distanceText(a.distanceMeters, distanceUnit())} - ${ms != null ? LiftOutdoor.durationText(ms) : '—'}`;
}

function statGrid(parent, stats) {
  const grid = el('div', 'stats');
  stats.forEach(([label, value]) => {
    const cell = el('div');
    cell.appendChild(el('div', 'muted small', label));
    cell.appendChild(el('div', 'stat', value));
    grid.appendChild(cell);
  });
  parent.appendChild(grid);
}

/** Draws a route at the canvas's own width and the given width:height. */
function drawRoute(canvas, route, aspect, emptyText) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = Math.round(w / aspect);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!route || route.length < 2) {
    ctx.fillStyle = LiftAppearance.cssColor('var(--muted)');
    ctx.font = '15px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(emptyText || 'No route recorded', w / 2, h / 2);
    return;
  }

  const pts = LiftOutdoor.project(route, w, h);
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

function renderOutdoor() {
  const wrap = $('#outdoor-section');
  wrap.innerHTML = '';
  const unit = distanceUnit();

  // Start, and the day's activities.
  const card = el('div', 'card');
  const head = el('div', 'cardhead');
  head.appendChild(el('span', 'muted', 'Record a route'));
  const units = el('div', 'chips');
  chips(units, [{ label: 'mi', v: 'miles' }, { label: 'km', v: 'kilometers' }],
    (i) => i.v === unit,
    (i) => { settings.distanceUnit = i.v; save(KEY.settings, settings); render(); });
  head.appendChild(units);
  card.appendChild(head);

  const buttons = el('div', 'row');
  LiftOutdoor.TYPES.forEach((type) => {
    const b = el('button', null, type.label);
    b.onclick = () => startRecording(type.key);
    buttons.appendChild(b);
  });
  card.appendChild(buttons);

  if (!navigator.geolocation) {
    card.appendChild(el('p', 'muted', "This browser can't read your location, so it can't record a route."));
    buttons.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  }

  outdoorOn(trainDate).forEach((a) => {
    const row = el('button', 'entry linkrow');
    row.appendChild(el('div', null, outdoorLabel(a.activityType)));
    row.appendChild(el('span', 'muted', outdoorSummary(a)));
    row.onclick = () => openReview(a.id);
    card.appendChild(row);
  });
  wrap.appendChild(card);

  // The newest route, whatever day Train is showing.
  const last = LiftOutdoor.lastRoute(outdoor);
  if (last) {
    const lastCard = el('button', 'card linkcard');
    lastCard.appendChild(el('strong', 'cardtitle', 'Last route'));
    const canvas = el('canvas', 'route');
    lastCard.appendChild(canvas);
    const line = el('div', 'routeline');
    line.appendChild(el('span', null, outdoorLabel(last.activityType)));
    line.appendChild(el('span', 'muted', activityDate(last.startedAtEpochMs)));
    lastCard.appendChild(line);
    statGrid(lastCard, [
      ['Distance', LiftOutdoor.distanceText(last.distanceMeters, unit)],
      ['Time', LiftOutdoor.durationText(LiftOutdoor.durationMs(last))],
      ['Pace', outdoorPace(last)],
    ]);
    lastCard.onclick = () => openReview(last.id);
    wrap.appendChild(lastCard);
    drawRoute(canvas, last.route, 2);
  }

  const bestsCard = el('div', 'card');
  bestsCard.appendChild(el('strong', 'cardtitle', 'Personal bests'));
  const bests = LiftOutdoor.bests(outdoor);
  if (!bests.length) {
    bestsCard.appendChild(el('p', 'muted',
      'Your last route and your best distance, time and pace show up here after your first run, walk or hike.'));
  }
  bests.forEach((b) => {
    bestsCard.appendChild(el('div', 'besthead', `${b.label} - ${b.count} ${b.count === 1 ? 'activity' : 'activities'}`));
    statGrid(bestsCard, [
      ['Farthest', b.longestDistanceMeters != null ? LiftOutdoor.distanceText(b.longestDistanceMeters, unit) : '—'],
      ['Longest', b.longestDurationMs != null ? LiftOutdoor.durationText(b.longestDurationMs) : '—'],
      ['Fastest pace', b.fastestPaceSecondsPerMeter != null ? LiftOutdoor.paceText(b.fastestPaceSecondsPerMeter, unit) : '—'],
    ]);
  });
  wrap.appendChild(bestsCard);
}

/* ---- recording ---- */

let recording = load(KEY.recording, null);
let geoWatch = null;
let wakeLock = null;
let recordTimer = null;
let lastFixAt = 0;
let gpsProblem = '';

async function holdScreenOn() {
  try {
    if (navigator.wakeLock && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {
    // Low battery mode or an old browser. The warning on screen still applies.
  }
}

document.addEventListener('visibilitychange', () => {
  // A wake lock is released whenever the page is hidden; take it back.
  if (recording && document.visibilityState === 'visible') holdScreenOn();
});

function startRecording(type) {
  if (recording) { showRecording(); return; }
  recording = { id: uid(), activityType: type, startedAtEpochMs: Date.now(), route: [] };
  save(KEY.recording, recording);
  showRecording();
}

function showRecording() {
  $('#recording').classList.remove('hidden');
  $('#rec-title').textContent = outdoorLabel(recording.activityType);
  $('#rec-finish').textContent = `Finish ${outdoorLabel(recording.activityType).toLowerCase()}`;
  gpsProblem = '';
  lastFixAt = 0;
  holdScreenOn();

  if (geoWatch === null && navigator.geolocation) {
    geoWatch = navigator.geolocation.watchPosition(onFix, onFixError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  clearInterval(recordTimer);
  recordTimer = setInterval(updateRecording, 1000);
  updateRecording();
}

function onFix(position) {
  if (!recording) return;
  lastFixAt = Date.now();
  gpsProblem = position.coords.accuracy > LiftOutdoor.MAX_ACCURACY_METERS
    ? `Weak GPS signal (${Math.round(position.coords.accuracy)} m). Waiting for a better fix.` : '';
  const route = recording.route;
  const point = LiftOutdoor.acceptFix(route[route.length - 1] || null, position.coords,
    position.timestamp || Date.now(), recording.startedAtEpochMs);
  if (point) {
    route.push(point);
    save(KEY.recording, recording);
  }
  updateRecording();
}

function onFixError(error) {
  gpsProblem = error.code === 1
    ? 'Location is turned off for this site. Allow it in your browser settings to record a route.'
    : 'Looking for GPS...';
  updateRecording();
}

function updateRecording() {
  if (!recording) return;
  const elapsed = Date.now() - recording.startedAtEpochMs;
  const metres = LiftOutdoor.totalDistanceMeters(recording.route);
  const unit = distanceUnit();
  $('#rec-time').textContent = LiftOutdoor.durationText(elapsed);
  $('#rec-distance').textContent = LiftOutdoor.distanceText(metres, unit);
  $('#rec-pace').textContent = metres >= 100
    ? LiftOutdoor.paceText((elapsed / 1000) / metres, unit) : '—';

  let status = gpsProblem;
  if (!status && !recording.route.length) status = 'Waiting for GPS...';
  if (!status && lastFixAt && Date.now() - lastFixAt > 20000) {
    status = 'No GPS update for a while. Keep LIFT open on screen.';
  }
  $('#rec-status').textContent = status;
  drawRoute($('#rec-canvas'), recording.route, 1, 'Waiting for GPS...');
}

function stopWatching() {
  if (geoWatch !== null && navigator.geolocation) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = null;
  clearInterval(recordTimer);
  recordTimer = null;
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
  $('#recording').classList.add('hidden');
}

$('#rec-finish').onclick = () => {
  if (!recording) return;
  const route = recording.route;
  if (route.length < 2 && !confirm('No route was recorded. Save the time anyway?')) return;
  const activity = {
    id: recording.id,
    activityType: recording.activityType,
    startedAtEpochMs: recording.startedAtEpochMs,
    endedAtEpochMs: Date.now(),
    distanceMeters: Math.round(LiftOutdoor.totalDistanceMeters(route) * 10) / 10,
    elevationGainMeters: Math.round(LiftOutdoor.elevationGainMeters(route) * 10) / 10,
    route,
  };
  outdoor.push(activity);
  save(KEY.outdoor, outdoor);
  recording = null;
  localStorage.removeItem(KEY.recording);
  stopWatching();
  trainDate = dateKey(new Date(activity.startedAtEpochMs));
  render();
  openReview(activity.id);
};

$('#rec-discard').onclick = () => {
  if (!recording || !confirm('Discard this recording? The route so far is lost.')) return;
  recording = null;
  localStorage.removeItem(KEY.recording);
  stopWatching();
  render();
};

/* ---- reviewing one ---- */

let reviewingId = null;

function openReview(id) {
  const a = outdoor.find((x) => x.id === id);
  if (!a) return;
  reviewingId = id;
  const unit = distanceUnit();
  $('#review').classList.remove('hidden');
  $('#review-title').textContent = outdoorLabel(a.activityType);
  $('#review-date').textContent = new Date(a.startedAtEpochMs).toLocaleString(undefined,
    { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const stats = $('#review-stats');
  stats.innerHTML = '';
  const climb = unit === 'kilometers'
    ? `${Math.round(a.elevationGainMeters || 0)} m` : `${Math.round((a.elevationGainMeters || 0) * 3.28084)} ft`;
  statGrid(stats, [
    ['Distance', LiftOutdoor.distanceText(a.distanceMeters, unit)],
    ['Time', LiftOutdoor.durationText(LiftOutdoor.durationMs(a))],
    ['Pace', outdoorPace(a)],
  ]);
  statGrid(stats, [['Climb', climb], ['GPS points', String((a.route || []).length)], ['', '']]);
  window.scrollTo(0, 0);
  drawRoute($('#review-canvas'), a.route, 1);
}

$('#review-close').onclick = () => { reviewingId = null; $('#review').classList.add('hidden'); };
$('#review-delete').onclick = () => {
  const a = outdoor.find((x) => x.id === reviewingId);
  if (!a || !confirm(`Delete this ${outdoorLabel(a.activityType).toLowerCase()}? It can't be undone.`)) return;
  outdoor = outdoor.filter((x) => x.id !== reviewingId);
  save(KEY.outdoor, outdoor);
  reviewingId = null;
  $('#review').classList.add('hidden');
  render();
};

// A recording survives a reload: pick it back up, and keep adding to the route.
if (recording && recording.id && Array.isArray(recording.route)) {
  showRecording();
} else {
  recording = null;
}

LiftAppearance.onChange(() => {
  if (recording) updateRecording();
  if (reviewingId) openReview(reviewingId);
});

/* ---------------- send to coach ---------------- */

/* Builds the link documented in /coach/SHARE-FORMAT.md and hands it to the
 * phone's email app, already addressed and written. There is no upload: the
 * whole log rides in the fragment, which browsers never send to a server.
 *
 * The Android and iOS versions of LIFT produce byte-identical links. Any
 * change here is a change in three other places too. */

const COACH_URL = 'https://www.dugcanlift.com/coach/';

const WINDOWS = [
  { label: '4 weeks', weeks: 4 },
  { label: '8 weeks', weeks: 8 },
  { label: '12 weeks', weeks: 12 },
  { label: '6 months', weeks: 26 },
];

function clientId() {
  if (!coach.id) {
    coach.id = uid();
    save(KEY.coach, coach);
  }
  return coach.id;
}

const toBase64Url = (bytes) => {
  let binary = '';
  // Chunked because a spread of 30,000 arguments blows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function deflateRaw(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return null;   // caller sends plain
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The compact payload. Keys are short because every byte is email body. */
function buildPayload(weeks, itemised) {
  const span = weeks * 7;
  const start = shiftDate(todayKey(), -(span - 1));
  const keys = lastNDays(span);

  const exerciseDict = [];
  const foodDict = [];
  const indexIn = (dict, value) => {
    const at = dict.indexOf(value);
    return at >= 0 ? at : dict.push(value) - 1;
  };

  const days = [];
  keys.forEach((key, offset) => {
    const day = { k: offset };
    let any = false;

    const sessions = sessionsFor(key);
    const exercises = sessions.flatMap((s) => s.exercises || []);
    if (exercises.length) {
      any = true;
      const named = sessions.map((s) => s.name).filter(Boolean);
      if (named.length) day.n = named[0];
      day.fo = settings.focus;
      day.w = exercises.map((ex) => {
        const index = indexIn(exerciseDict, `${(ex.name || '').trim()}|${(ex.equipment || '').trim()}`);
        const sets = (ex.sets || []).map((set) => {
          const tuple = [
            set.weightLb ?? null, set.reps ?? null, set.rpe ?? null,
            set.durationSec ?? null, set.distanceMeters ?? null, 0,
          ];
          while (tuple.length && !tuple[tuple.length - 1]) tuple.pop();
          return tuple;
        });
        return [index, sets];
      });
    }

    const entries = entriesFor(key);
    if (entries.length) {
      any = true;
      if (itemised) {
        day.f = entries.map((e) => [
          indexIn(foodDict, e.name || ''), e.servings || 1,
          e.calories || 0, e.proteinG || 0, e.fatG || 0, e.carbsG || 0, e.fiberG || 0,
          MEALS.indexOf(mealOf(e)),
        ]);
      } else {
        const t = totals(entries);
        day.ft = [t.calories, t.proteinG, t.fatG, t.carbsG, t.fiberG];
      }
    }

    // Runs, walks and hikes that day, as SHARE-FORMAT.md "Outdoor" spells them.
    const activities = LiftOutdoor.shareDay(outdoorOn(key));
    if (activities.length) { day.o = activities; any = true; }

    if (steps[key] != null) { day.st = steps[key]; any = true; }
    if (weights[key] != null) { day.bw = weights[key]; any = true; }

    if (any) days.push(day);
  });

  const payload = {
    v: 1,
    c: {
      i: clientId(),
      n: coach.you || 'A LIFT user',
      u: 'lb',
      p: 'web',
    },
    r: start,
    t: todayKey(),
    z: Math.floor(Date.now() / 1000),
    x: exerciseDict,
    d: days,
  };
  if (profile) {
    if (profile.sex) payload.c.s = profile.sex;
    if (profile.age) payload.c.a = profile.age;
    if (profile.heightIn) payload.c.h = profile.heightIn;
  }
  if (goal) {
    payload.g = { c: goal.calories, p: goal.proteinG, f: goal.fatG, cb: goal.carbsG, fb: goal.fiberG };
  }
  if (foodDict.length) payload.fd = foodDict;
  // Bests are all-time, not the window. The route goes only when asked for,
  // trimmed so it never shows where someone starts and finishes.
  const bestsOut = LiftOutdoor.shareBests(outdoor);
  if (bestsOut) payload.ob = bestsOut;
  if (coach.route) {
    const route = LiftOutdoor.shareLastRoute(outdoor);
    if (route) payload.lr = route;
  }
  return payload;
}

async function buildLink(weeks, itemised) {
  const json = JSON.stringify(buildPayload(weeks, itemised));
  const packed = await deflateRaw(json);
  const fragment = packed
    ? '1z' + toBase64Url(packed)
    : '1u' + toBase64Url(new TextEncoder().encode(json));
  return COACH_URL + '#' + fragment;
}

/** The part the coach reads without tapping anything. */
function weekSummary() {
  const week = lastNDays(7);
  let sessions = 0, sets = 0, volume = 0, kcal = 0, protein = 0, logged = 0;

  week.forEach((key) => {
    const daySessions = sessionsFor(key);
    if (daySessions.some((s) => (s.exercises || []).length)) sessions++;
    daySessions.forEach((s) => { sets += sessionSets(s); volume += sessionVolume(s); });
    const entries = entriesFor(key);
    if (entries.length) {
      const t = totals(entries);
      kcal += t.calories;
      protein += t.proteinG;
      logged++;
    }
  });

  const lines = [
    'Last 7 days',
    `Training   ${sessions} session${sessions === 1 ? '' : 's'} · ${sets} sets`
      + (volume ? ` · ${Math.round(volume).toLocaleString()} lb` : ''),
  ];
  if (logged) {
    const avgKcal = Math.round(kcal / logged);
    const avgProtein = Math.round(protein / logged);
    lines.push(`Fuel       ${avgKcal.toLocaleString()} kcal · ${avgProtein} g protein`
      + (goal ? `  (goal ${goal.calories.toLocaleString()} · ${goal.proteinG})` : '')
      + `  over ${logged} logged day${logged === 1 ? '' : 's'}`);
  } else {
    lines.push('Fuel       nothing logged this week');
  }

  const dates = Object.keys(weights).sort();
  if (dates.length) {
    const latest = dates[dates.length - 1];
    lines.push(`Weight     ${weights[latest]} lb on ${shortLabel(latest)}`);
  }
  return lines.join('\n');
}

async function sendToCoach() {
  const button = $('#coach-send');
  button.disabled = true;
  button.textContent = 'Preparing…';
  try {
    const link = await buildLink(coach.weeks, coach.itemised);
    const name = coach.you || 'your client';
    const subject = `LIFT log from ${name} — ${shortLabel(todayKey())}`;
    const body = [
      `Open the log:`,
      link,
      ``,
      weekSummary(),
      ``,
      `Covers the last ${coach.weeks} weeks. Sent from LIFT.`,
    ].join('\n');

    // mailto is plain text by definition, so the link stands on its own line
    // where every mail client on earth will turn it into something tappable.
    location.href = `mailto:${encodeURIComponent(coach.email)}`
      + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } catch (e) {
    alert('Could not build the link: ' + e.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Send to Coach';
  }
}

let sizeTimer = null;

function updateLinkSize() {
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(async () => {
    const note = $('#coach-size');
    if (!note) return;
    try {
      const link = await buildLink(coach.weeks, coach.itemised);
      const kb = link.length / 1024;
      note.textContent = `About ${kb.toFixed(1)} KB of email.`
        + (kb > 16 ? ' That is long enough that some mail apps will break it — send a shorter window.' : '');
      note.style.color = kb > 16 ? 'var(--accent)' : '';
    } catch (e) {
      note.textContent = '';
    }
  }, 60);
}

function renderCoach() {
  const setup = $('#coach-setup');
  const ready = $('#coach-ready');
  const configured = !!coach.email;

  setup.classList.toggle('hidden', configured);
  ready.classList.toggle('hidden', !configured);
  if (!configured) {
    $('#coach-you').value = coach.you || '';
    $('#coach-email').value = coach.email || '';
    return;
  }

  const to = $('#coach-to');
  to.innerHTML = '';
  to.appendChild(el('p', 'muted',
    `Goes to ${coach.email}${coach.you ? `, from ${coach.you}` : ''}. `
    + 'Your email app opens with it all written — you just hit send.'));

  chips($('#coach-window'), WINDOWS,
    (i) => coach.weeks === i.weeks,
    (i) => { coach.weeks = i.weeks; save(KEY.coach, coach); renderCoach(); });

  chips($('#coach-detail'),
    [{ label: 'Daily totals', v: false }, { label: 'Every food logged', v: true }],
    (i) => coach.itemised === i.v,
    (i) => { coach.itemised = i.v; save(KEY.coach, coach); renderCoach(); });

  chips($('#coach-route'),
    [{ label: "Don't send", v: false }, { label: 'Send, trimmed', v: true }],
    (i) => !!coach.route === i.v,
    (i) => { coach.route = i.v; save(KEY.coach, coach); renderCoach(); });

  updateLinkSize();
}

$('#coach-save').onclick = () => {
  const email = $('#coach-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("That doesn't look like an email address.");
    return;
  }
  coach.email = email;
  coach.you = $('#coach-you').value.trim();
  clientId();
  save(KEY.coach, coach);
  renderCoach();
};

$('#coach-change').onclick = () => {
  $('#coach-setup').classList.remove('hidden');
  $('#coach-ready').classList.add('hidden');
  $('#coach-you').value = coach.you || '';
  $('#coach-email').value = coach.email || '';
};

$('#coach-send').onclick = sendToCoach;

/* ---------------- boot ---------------- */

function render() {
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'calc') renderCalc();
  else if (currentTab === 'food') renderFood();
  else if (currentTab === 'cook') renderCook();
  else if (currentTab === 'train') renderTrain();
}

/* ---------------- backup ---------------- */

/* Everything lives in this browser, so a file the user keeps is the only thing
 * between a cleared cache and a lost training history. It is also how a log
 * moves to a new phone, which matters more here than in most apps: there is no
 * account to log back into.
 *
 * Restoring is deliberately additive. It fills gaps and never overwrites
 * something already on the device, so pulling last month's file onto a working
 * phone cannot cost you today's session. The price is that a restore can't undo
 * a deletion — which is the right way round.
 *
 * Keeping the client id means a coach sees the same person after a restore
 * rather than a second one appearing in their roster. */

/* What goes in a backup, and the merge rules, live in backup.js so node can
 * test them. See coach/BACKUP-FORMAT.md. */

function saveBackup() {
  const stored = {};
  LiftBackup.STORED.forEach((k) => { stored[k] = load(KEY[k], null); });
  // Routes are compact in storage and spelled out in the file, in LIFT for
  // Android's field names. See outdoor.js.
  stored.outdoor = outdoor.map(LiftOutdoor.toBackup);
  // Sections a newer client wrote that this build does not store go back out
  // as they came in -- the same promise `ext` makes, for the same reason.
  const data = LiftBackup.buildData(stored, load(KEY.unknownData, {}));
  const out = { v: 1, app: 'lift', saved: todayKey(), data };
  // Hand back whatever another platform recorded that this one has no field
  // for. Dropping it would mean a phone's backup came through here and lost
  // its warmup flags on the way out. See coach/BACKUP-FORMAT.md.
  const ext = load(KEY.ext, null);
  if (ext && Object.keys(ext).length) out.ext = ext;
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lift-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  renderBackupNote();
}

function loadBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed && parsed.data;
      if (!incoming || parsed.app !== 'lift') throw new Error('not a LIFT backup');

      // Case-insensitive now: an exact comparison duplicated every food entry
      // and workout on a round trip through an iPhone, which writes ids in
      // upper case. The rule and its tests are in backup.js.
      const addMissing = LiftBackup.addMissing;
      const fillGaps = (current, arriving) => {
        Object.entries(arriving || {}).forEach(([k, v]) => {
          if (current[k] == null) current[k] = v;
        });
      };

      // Keep the parts of the file this app cannot read, so saving again
      // returns them intact rather than quietly dropping them.
      if (parsed.ext && Object.keys(parsed.ext).length) save(KEY.ext, parsed.ext);
      const unknown = LiftBackup.unknownSections(incoming);
      if (Object.keys(unknown).length) {
        save(KEY.unknownData, { ...load(KEY.unknownData, {}), ...unknown });
      }

      // Ingredient lines are reparsed rather than trusted: rawText is the
      // contract, and every client runs the same parser. Only the fields the
      // parser does not own are carried from the file -- spreading the whole
      // ingredient under the parse would keep the file's cached quantity for
      // exactly the lines that do not parse.
      const arrivingRecipes = (incoming.recipes || []).filter(Boolean).map((r) => ({
        ...r,
        ingredients: (r.ingredients || []).map((i) => {
          const raw = typeof i === 'string' ? i : (i && i.rawText) || '';
          const extra = {};
          if (i && typeof i === 'object') {
            if (i.optional != null) extra.optional = i.optional;
            if (i.note != null) extra.note = i.note;
          }
          return { ...extra, ...parseIngredient(raw) };
        }),
        steps: r.steps || [],
      }));

      const added = addMissing(food, incoming.food) + addMissing(workouts, incoming.workouts)
        + addMissing(recipes, arrivingRecipes)
        // After recipes, so a meal whose recipe came in this same file keeps it.
        + LiftBackup.addMissingPlan(plan, incoming.plan, recipes)
        + addMissing(routines, (incoming.routines || []).filter((r) => r && Array.isArray(r.exercises)))
        + addMissing(outdoor, (incoming.outdoor || []).map(LiftOutdoor.fromBackup).filter(Boolean));
      fillGaps(steps, incoming.steps);
      fillGaps(weights, incoming.weights);
      if (!goal && incoming.goal) goal = incoming.goal;
      if (!profile && incoming.profile) profile = incoming.profile;
      if (!coach.email && incoming.coach) coach = incoming.coach;
      if (!settings.focus && incoming.settings) settings = incoming.settings;

      save(KEY.food, food);
      save(KEY.workouts, workouts);
      save(KEY.steps, steps);
      save(KEY.weights, weights);
      save(KEY.goal, goal);
      save(KEY.profile, profile);
      save(KEY.coach, coach);
      save(KEY.settings, settings);
      save(KEY.recipes, recipes);
      save(KEY.plan, plan);
      save(KEY.routines, routines);
      save(KEY.outdoor, outdoor);

      render();
      alert(added
        ? `Restored. Added ${added} ${added === 1 ? 'entry' : 'entries'} this device didn't already have.`
        : 'Restored. This device already had everything in that file.');
    } catch (e) {
      alert("That file isn't a LIFT backup.");
    }
  };
  reader.onerror = () => alert('Could not read that file.');
  reader.readAsText(file);
}

function renderBackupNote() {
  const days = new Set([...food.map((e) => e.date), ...workouts.map((w) => w.date)]).size;
  $('#backup-note').textContent = days
    ? `${days} ${days === 1 ? 'day' : 'days'} logged on this device.`
    : 'Nothing logged yet.';
}

$('#backup-save').onclick = saveBackup;
$('#backup-load').onclick = () => $('#backup-file').click();
$('#backup-file').onchange = (e) => {
  if (e.target.files[0]) loadBackup(e.target.files[0]);
  e.target.value = '';
};


/* ---------------- appearance ---------------- */

/* System / Light / Dark. appearance.js owns the choice and the palette switch;
 * this renders the chips and redraws, because canvas charts are drawn with the
 * palette's colours at draw time and do not change by themselves. */
function renderAppearance() {
  const labels = { system: 'System', light: 'Light', dark: 'Dark' };
  chips($('#appearance-mode'),
    LiftAppearance.CHOICES.map((v) => ({ label: labels[v], v })),
    (i) => i.v === LiftAppearance.get(),
    (i) => LiftAppearance.set(i.v));
}
LiftAppearance.onChange(() => { renderAppearance(); render(); });
renderAppearance();

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------------- COOK ----------------
 *
 * Recipes, the week's plan, and the shopping list that falls out of it.
 *
 * The client half. The trainer half is the COOK page in Coach, which authors
 * the same planned-meal shapes and sends them here as a link.
 *
 * Shapes mirror the Android and iOS builds exactly — recipes store macros PER
 * SERVING and scaling happens at the point of use, so a plan can move between
 * the three clients without a conversion step.
 */

/* Grouping key for an ingredient with no unit — "2 eggs", "1 banana".
 *
 * A sentinel, not a unit. It keeps counts in their own bucket during
 * aggregation, so two cloves of garlic are never added to two cups of
 * anything, and the shopping list drops it when printing, because
 * "2 x banana" is not how anyone writes a shopping list.
 *
 * Contains a null character so it can never collide with something typed. The
 * same value exists in both native builds; all three must agree. */
const COUNT_UNIT = '\u0000count';

const COOK_UNITS = new Set([
  'g', 'kg', 'mg', 'ml', 'l',
  'tsp', 'tbsp', 'cup', 'cups', 'oz', 'lb', 'lbs',
  'clove', 'cloves', 'slice', 'slices', 'scoop', 'scoops',
  'can', 'cans', 'pinch', 'handful',
]);

/* Pulls a quantity and unit off the front of a typed ingredient line.
 *
 * Deliberately small. It handles the shapes people actually type and gives up
 * cleanly on everything else, leaving `item` undefined so the shopping list
 * shows the raw line instead. Guessing harder here would produce confident
 * wrong quantities, which is worse than an unparsed line the reader can
 * check. */
function parseIngredient(raw) {
  let rest = raw.trimStart();

  const takeNumber = () => {
    const m = rest.match(/^[0-9.]+/);
    if (!m) return null;
    const value = parseFloat(m[0]);
    if (isNaN(value)) return null;
    rest = rest.slice(m[0].length);
    return value;
  };

  let qty = takeNumber();
  if (qty === null) return { rawText: raw };

  if (rest.startsWith('/')) {
    rest = rest.slice(1);
    const denominator = takeNumber();
    if (!denominator) return { rawText: raw };
    qty /= denominator;
  } else if (rest.startsWith(' ')) {
    // "1 1/2" — a whole number followed by a fraction.
    const saved = rest;
    rest = rest.slice(1);
    const whole = takeNumber();
    if (whole !== null && rest.startsWith('/')) {
      rest = rest.slice(1);
      const denominator = takeNumber();
      if (denominator) qty += whole / denominator;
      else rest = saved;
    } else {
      rest = saved;
    }
  }

  rest = rest.trimStart();
  const firstWord = rest.split(' ')[0];
  const candidate = firstWord.toLowerCase().replace(/[.,]+$/, '');

  let unit = null;
  let item;
  if (COOK_UNITS.has(candidate)) {
    unit = candidate;
    item = rest.slice(firstWord.length).trim();
  } else {
    item = rest.trim();
  }

  if (!item) return { rawText: raw };

  return {
    rawText: raw,
    item,
    qty,
    unit: unit || COUNT_UNIT,
    grams: unit === 'g' ? qty : null,
  };
}

/* Counts print bare — "2", not "2 x banana". */
function amountsLabel(amounts) {
  return Object.keys(amounts).sort().map((unit) => {
    const value = trimNum(amounts[unit]);
    return unit === COUNT_UNIT ? value : `${value} ${unit}`;
  }).join(' + ');
}

const trimNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const servingsLabel = (v) => (v === 1 ? '1 serving' : `${trimNum(v)} servings`);
const recipeById = (id) => recipes.find((r) => r.id === id);

/* Today plus six. A plan is a week you are shopping for, not a calendar. */
function cookWeek() {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push(dateKey(d));
  }
  return out;
}

/* Aggregates ingredients across planned meals.
 *
 * Amounts scale by each meal's servings against the recipe's own serving
 * count, so planning two servings of a four-serving recipe buys half. */
function buildShoppingList(meals) {
  const amounts = {}, names = {}, unparsed = {};

  meals.forEach((meal) => {
    const recipe = recipeById(meal.recipeId);
    if (!recipe) return;
    const factor = meal.servings / (recipe.servings > 0 ? recipe.servings : 1);

    (recipe.ingredients || []).forEach((ing) => {
      const name = (ing.item && ing.item.trim()) || ing.rawText;
      const key = name.trim().toLowerCase();
      if (!key) return;
      if (!names[key]) names[key] = name;

      if (ing.qty != null && ing.unit) {
        amounts[key] = amounts[key] || {};
        amounts[key][ing.unit] = (amounts[key][ing.unit] || 0) + ing.qty * factor;
      } else {
        unparsed[key] = unparsed[key] || [];
        unparsed[key].push(ing.rawText);
      }
    });
  });

  return Object.keys(names).sort().map((key) => ({
    key,
    displayName: names[key],
    amounts: amounts[key] || {},
    unparsed: unparsed[key] || [],
  }));
}

/* ---------------- COOK views ---------------- */

let cookSection = 'recipes';
let editingRecipeId = null;

function renderCook() {
  chips($('#cook-sections'),
    [{ label: 'Recipes', v: 'recipes' }, { label: 'Plan', v: 'plan' }, { label: 'Shopping', v: 'shopping' }],
    (i) => i.v === cookSection,
    (i) => { cookSection = i.v; $('#recipe-form').classList.add('hidden'); render(); });

  $('#cook-recipes').classList.toggle('hidden', cookSection !== 'recipes');
  $('#cook-plan').classList.toggle('hidden', cookSection !== 'plan');
  $('#cook-shopping').classList.toggle('hidden', cookSection !== 'shopping');

  if (cookSection === 'recipes') renderRecipes();
  if (cookSection === 'plan') renderPlan();
  if (cookSection === 'shopping') renderShopping();
}

function renderRecipes() {
  const list = $('#recipe-list');
  list.innerHTML = '';

  if (!recipes.length) {
    list.appendChild(el('p', 'muted',
      'No recipes yet. Add one you already cook — the plan and the shopping list build themselves from here.'));
    return;
  }

  [...recipes].sort((a, b) => a.name.localeCompare(b.name)).forEach((r) => {
    const card = el('div', 'card');
    const head = el('div', 'statline');
    head.appendChild(el('strong', null, r.name));
    head.appendChild(el('span', 'muted', servingsLabel(r.servings)));
    card.appendChild(head);

    // Deliberately not "0 kcal". An unknown that renders as zero becomes a
    // zero-calorie dinner in someone's day total.
    const n = r.nutritionPerServing;
    card.appendChild(el('p', 'muted', n
      ? `${trimNum(n.calories)} kcal  P ${trimNum(n.proteinG)}  C ${trimNum(n.carbsG)}  F ${trimNum(n.fatG)}`
      : 'Macros not set'));

    if ((r.ingredients || []).length) {
      card.appendChild(el('p', 'muted',
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
  $('#r-servings').value = r ? r.servings : 1;
  // Grams on the recipe, the person's preferred unit on screen -- the same
  // rule the food form follows.
  $('#r-weight').value = r && r.totalWeightGrams > 0
    ? FoodAmount.trim(FoodAmount.UNITS[servingUnitKey()].fromGrams(r.totalWeightGrams))
    : '';
  renderRecipeWeightUnit();
  $('#r-ingredients').value = r ? (r.ingredients || []).map((i) => i.rawText).join('\n') : '';
  $('#r-steps').value = r ? (r.steps || []).join('\n') : '';
  const n = r && r.nutritionPerServing;
  $('#r-cal').value = n ? n.calories : '';
  $('#r-p').value = n ? n.proteinG : '';
  $('#r-c').value = n ? n.carbsG : '';
  $('#r-f').value = n ? n.fatG : '';
  // Blank rather than a zero nobody measured: fibre is often absent on a
  // recipe that has the other four.
  $('#r-fib').value = n && n.fiberG ? n.fiberG : '';
  $('#r-delete').classList.toggle('hidden', !r);

  // A recipe already carrying macros counts as typed: reopening it to add one
  // more ingredient must not throw away numbers that were already right.
  // Fibre counts as typed only when the recipe actually has some, so a recipe
  // without it stays open to the ingredient tally.
  ['#r-cal', '#r-p', '#r-c', '#r-f'].forEach((selector) => {
    $(selector).dataset.typed = n ? '1' : '';
  });
  $('#r-fib').dataset.typed = n && n.fiberG ? '1' : '';
  ingredientTally = null;
  $('#ing-query').value = '';
  $('#ing-results').innerHTML = '';
  $('#ing-tally').textContent = '';

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
  // Unlogged plan entries for a deleted recipe go too. Logged ones stay: the
  // food entry they produced carries its own copy of the numbers, and history
  // must not change because a recipe was tidied up later.
  plan = plan.filter((m) => m.recipeId !== editingRecipeId || m.loggedFoodEntryId);
  save(KEY.recipes, recipes);
  save(KEY.plan, plan);
  $('#recipe-form').classList.add('hidden');
  editingRecipeId = null;
  render();
};

$('#r-save').onclick = () => {
  const name = $('#r-name').value.trim();
  if (!name) return;

  const num = (sel) => {
    const raw = $(sel).value.trim();
    return raw === '' ? null : parseFloat(raw);
  };
  const typed = [num('#r-cal'), num('#r-p'), num('#r-c'), num('#r-f'), num('#r-fib')];
  // Null unless something was actually typed — an untouched form must not
  // write zeros, which would later log as a zero-calorie meal.
  const nutrition = typed.every((v) => v === null) ? null : {
    calories: typed[0] || 0,
    proteinG: typed[1] || 0,
    carbsG: typed[2] || 0,
    fatG: typed[3] || 0,
    // Was hard-coded to 0 because there was no field, so a recipe carrying
    // fibre lost it the first time anyone opened it and pressed Save.
    fiberG: typed[4] || 0,
  };

  const lines = (sel) => $(sel).value.split('\n').map((l) => l.trim()).filter(Boolean);
  const servings = parseFloat($('#r-servings').value) || 1;

  const body = {
    name,
    servings: servings > 0 ? servings : 1,
    ingredients: lines('#r-ingredients').map(parseIngredient),
    steps: lines('#r-steps'),
    nutritionPerServing: nutrition,
    // Written even when null, so clearing the field on an existing recipe
    // actually clears it -- the spread below would otherwise keep the old one.
    totalWeightGrams: recipeWeightGrams(),
  };

  if (editingRecipeId) {
    recipes = recipes.map((r) => (r.id === editingRecipeId ? { ...r, ...body } : r));
  } else {
    recipes.push({ id: uid(), importedAt: Date.now(), ...body });
  }

  save(KEY.recipes, recipes);
  $('#recipe-form').classList.add('hidden');
  editingRecipeId = null;
  render();
};

function renderPlan() {
  const wrap = $('#cook-plan');
  wrap.innerHTML = '';

  if (!recipes.length) {
    wrap.appendChild(el('p', 'muted', 'Add a recipe first — the plan is built from them.'));
    return;
  }

  cookWeek().forEach((day) => {
    const card = el('div', 'card');
    card.appendChild(el('strong', null, dateLabel(day)));

    ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'].forEach((meal) => {
      const forSlot = plan.filter((m) => m.date === day && m.meal === meal);
      const row = el('div', 'statline planrow');
      row.appendChild(el('span', 'muted', meal.charAt(0) + meal.slice(1).toLowerCase()));

      const right = el('div');
      if (!forSlot.length) {
        const add = el('button', 'chip', 'Add');
        add.onclick = () => pickRecipe(day, meal);
        right.appendChild(add);
      } else {
        forSlot.forEach((m) => {
          const line = el('div', 'planmeal');
          line.appendChild(el('div', null, m.recipeName));
          // snapshotNutrition is per serving; this row is a whole meal.
          if (m.snapshotNutrition) {
            line.appendChild(el('p', 'muted',
              `${Math.round(m.snapshotNutrition.calories * m.servings)} kcal`));
          }
          if (m.loggedFoodEntryId) {
            line.appendChild(el('span', 'muted', 'Logged'));
          } else if (m.snapshotNutrition) {
            const log = el('button', 'chip', 'Log it');
            log.onclick = () => logPlannedMeal(m.id);
            line.appendChild(log);
          }
          const rm = el('button', 'chip', 'Remove');
          rm.onclick = () => {
            plan = plan.filter((x) => x.id !== m.id);
            save(KEY.plan, plan);
            render();
          };
          line.appendChild(rm);
          right.appendChild(line);
        });
      }
      row.appendChild(right);
      card.appendChild(row);
    });

    wrap.appendChild(card);
  });
}

/* Two browser dialogs to place one dinner was the roughest edge in here. This
 * is the same choice made in the page, where the servings you pick are
 * reflected in the calories on every row before you commit to one. */
function pickRecipe(day, meal) {
  const panel = $('#picker');
  $('#picker-title').textContent =
    `${dateLabel(day)} · ${meal.charAt(0) + meal.slice(1).toLowerCase()}`;
  $('#picker-servings').value = '1';
  panel.classList.remove('hidden');
  panel.scrollIntoView({ block: 'nearest' });

  const draw = () => {
    const servings = parseFloat($('#picker-servings').value) || 1;
    const list = $('#picker-list');
    list.innerHTML = '';
    [...recipes].sort((a, b) => a.name.localeCompare(b.name)).forEach((r) => {
      const row = el('button', 'chip wide');
      const n = r.nutritionPerServing;
      row.textContent = n ? `${r.name} — ${Math.round(n.calories * servings)} kcal` : r.name;
      row.onclick = () => {
        panel.classList.add('hidden');
        placeMeal(r, day, meal, servings);
      };
      list.appendChild(row);
    });
  };

  $('#picker-servings').oninput = draw;
  draw();
}

$('#picker-cancel').onclick = () => $('#picker').classList.add('hidden');

function placeMeal(recipe, day, meal, servings) {
  plan.push({
    id: uid(),
    recipeId: recipe.id,
    recipeName: recipe.name,
    date: day,
    meal,
    servings,
    // Per serving, never pre-scaled. Same invariant as every other client.
    snapshotNutrition: recipe.nutritionPerServing,
    loggedFoodEntryId: null,
  });
  save(KEY.plan, plan);
  render();
}

/* Writes the log entry, then records that it happened.
 *
 * The order matters: loggedFoodEntryId is the only thing stopping a second tap
 * logging the same dinner twice, so it is set from the entry that actually
 * exists rather than optimistically beforehand. */
function logPlannedMeal(id) {
  const m = plan.find((x) => x.id === id);
  if (!m || m.loggedFoodEntryId || !m.snapshotNutrition) return;

  const n = m.snapshotNutrition;
  const entry = {
    id: uid(),
    name: m.recipeName,
    // Food entries store macros per serving and multiply by servings, so the
    // per-serving snapshot passes through unscaled.
    servings: m.servings,
    calories: Math.round(n.calories),
    proteinG: Math.round(n.proteinG),
    fatG: Math.round(n.fatG),
    carbsG: Math.round(n.carbsG),
    fiberG: Math.round(n.fiberG || 0),
    date: m.date,
    loggedAt: Date.now(),
    meal: m.meal,
  };
  food.push(entry);
  save(KEY.food, food);

  plan = plan.map((x) => (x.id === id ? { ...x, loggedFoodEntryId: entry.id } : x));
  save(KEY.plan, plan);
  render();
}

function renderShopping() {
  const wrap = $('#cook-shopping');
  wrap.innerHTML = '';

  // Only what is still ahead. A list that keeps yesterday's shopping on it
  // stops being a list you trust.
  const today = todayKey();
  const week = cookWeek();
  const upcoming = plan.filter((m) => m.date >= today && m.date <= week[week.length - 1]);
  const lines = buildShoppingList(upcoming);

  if (!lines.length) {
    wrap.appendChild(el('p', 'muted',
      'Nothing planned for the next week, so there is nothing to buy yet.'));
    return;
  }

  lines.forEach((line) => {
    const ticked = shoppingTicks.includes(line.key);
    const card = el('div', 'card');
    const label = el('div', null, line.displayName);
    if (ticked) label.style.textDecoration = 'line-through';
    card.appendChild(label);

    if (Object.keys(line.amounts).length) {
      card.appendChild(el('p', 'muted', amountsLabel(line.amounts)));
    }
    // Ingredients that never parsed, verbatim, so nothing silently drops off
    // the list you shop from.
    line.unparsed.forEach((raw) => card.appendChild(el('p', 'muted', raw)));

    card.onclick = () => {
      shoppingTicks = ticked
        ? shoppingTicks.filter((k) => k !== line.key)
        : [...shoppingTicks, line.key];
      save(KEY.shopping, shoppingTicks);
      render();
    };
    wrap.appendChild(card);
  });

  if (shoppingTicks.length) {
    const clear = el('button', 'wide ghost', 'Clear ticks');
    clear.onclick = () => {
      shoppingTicks = [];
      save(KEY.shopping, shoppingTicks);
      render();
    };
    wrap.appendChild(clear);
  }
}

/* ---------------- incoming plan ----------------
 *
 * A coach builds a week in Coach and sends it as a link. The plan rides in the
 * fragment — the part after '#', which browsers never transmit — so it goes
 * from their browser, through mail, to this one, and dugcanlift.com never sees
 * it. Same trip a log makes, in the opposite direction.
 *
 * PLAN-FORMAT.md documents the shape.
 */

const planB64urlToBytes = (s) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function planInflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser is too old to open plan links. Safari 16.4, '
                  + 'Chrome 103 or anything newer will work.');
  }
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

async function decodeIncomingPlan(hash) {
  const frag = String(hash || '').replace(/^#/, '').trim();
  const match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  if (Number(match[1]) !== 1) {
    throw new Error('That plan was made by a newer version of Coach. Reload this page to update.');
  }
  const bytes = planB64urlToBytes(match[3]);
  const json = match[2] === 'z' ? await planInflate(bytes) : new TextDecoder().decode(bytes);
  const payload = JSON.parse(json);
  return payload && payload.t === 'plan' ? payload : null;
}

/* Turns a decoded payload into recipes and planned meals.
 *
 * Recipes are matched by name so a coach sending next week's plan does not
 * leave you with two copies of the same chilli. */
function importPlan(payload) {
  const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  const ids = [];

  (payload.r || []).forEach((raw) => {
    const name = raw.n || 'Untitled recipe';
    const existing = recipes.find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
    // u is [kcal, protein, carbs, fat, fibre] per serving, and is absent
    // entirely when the coach did not know the macros. Absent stays unknown —
    // it must not become a zero-calorie dinner in the day's total.
    const nutrition = Array.isArray(raw.u) ? {
      calories: raw.u[0] || 0, proteinG: raw.u[1] || 0,
      carbsG: raw.u[2] || 0, fatG: raw.u[3] || 0, fiberG: raw.u[4] || 0,
    } : null;

    const body = {
      name,
      servings: raw.s > 0 ? raw.s : 1,
      ingredients: (raw.i || []).map(parseIngredient),
      steps: raw.t || [],
      nutritionPerServing: nutrition,
      fromCoach: payload.n || true,
    };

    if (existing) {
      Object.assign(existing, body);
      ids.push(existing.id);
    } else {
      const fresh = { id: uid(), importedAt: Date.now(), ...body };
      recipes.push(fresh);
      ids.push(fresh.id);
    }
  });

  let added = 0;
  (payload.m || []).forEach((m) => {
    const recipeId = ids[m.x];
    if (!recipeId) return;
    const recipe = recipes.find((r) => r.id === recipeId);
    const meal = MEALS[m.s] || 'DINNER';
    // Replace whatever was in that slot rather than stacking a second dinner
    // on top of it — a plan is the coach's answer for that meal.
    plan = plan.filter((p) => !(p.date === m.d && p.meal === meal && !p.loggedFoodEntryId));
    plan.push({
      id: uid(),
      recipeId,
      recipeName: recipe ? recipe.name : 'Recipe',
      date: m.d,
      meal,
      servings: m.q > 0 ? m.q : 1,
      // Per serving, never pre-scaled. Same invariant as every other client.
      snapshotNutrition: recipe ? recipe.nutritionPerServing : null,
      loggedFoodEntryId: null,
      fromCoach: payload.n || true,
    });
    added++;
  });

  save(KEY.recipes, recipes);
  save(KEY.plan, plan);
  return added;
}

/* Takes in the training half of a plan.
 *
 * A prescribed session replaces whatever the coach previously sent for that
 * day, but never touches a workout already logged — the plan is the coach's
 * answer for the day, and the log is yours. */
function importTraining(payload) {
  const incoming = payload.w || [];
  if (!incoming.length) return 0;

  const toTemplate = (raw) => ({
    name: raw.n || 'Session',
    exercises: (raw.e || []).map((exercise) => ({
      name: exercise.n || 'Exercise',
      equipment: exercise.q || '',
      note: exercise.c || '',
      // [weightLb, reps, rpe, durationSec, distanceMeters], trailing nulls
      // trimmed by the sender. Missing is unprescribed, not zero.
      sets: (exercise.s || []).map((tuple) => ({
        weightLb: tuple[0] ?? null,
        reps: tuple[1] ?? null,
        rpe: tuple[2] ?? null,
        durationSec: tuple[3] ?? null,
        distanceMeters: tuple[4] ?? null,
      })),
    })),
  });

  // Workouts with no day booked for them are a library send: file them for
  // later rather than inventing a date the coach did not choose.
  if (!(payload.k || []).length) {
    incoming.forEach((raw) => {
      const body = toTemplate(raw);
      const existing = templates.find(
        (t) => t.name.trim().toLowerCase() === body.name.trim().toLowerCase());
      if (existing) Object.assign(existing, body);
      else templates.push({ id: uid(), fromCoach: payload.n || true, ...body });
    });
    save(KEY.templates, templates);
    return incoming.length;
  }

  let added = 0;
  (payload.k || []).forEach((slot) => {
    const template = incoming[slot.x];
    if (!template) return;

    training = training.filter((t) => t.date !== slot.d);
    training.push({
      id: uid(),
      date: slot.d,
      fromCoach: payload.n || true,
      startedSessionId: null,
      ...toTemplate(template),
    });
    added++;
  });

  save(KEY.training, training);
  return added;
}

const prescribedFor = (day) => training.filter((t) => t.date === day);

/* Opens a logged workout pre-filled with what was asked for.
 *
 * The prescription is copied in as ordinary sets so they can be edited: what
 * gets logged has to be what happened, and a session nobody can correct would
 * either be a lie or go unlogged. */
function startPrescribed(prescription) {
  const session = {
    id: uid(),
    date: prescription.date,
    name: prescription.name,
    note: '',
    startedAt: Date.now(),
    exercises: prescription.exercises.map((exercise) => ({
      id: uid(),
      name: exercise.name,
      equipment: exercise.equipment,
      note: exercise.note || '',
      sets: exercise.sets.map((set) => {
        const copy = { id: uid() };
        // Only fields the coach actually prescribed. An unprescribed weight
        // must stay blank rather than arriving as a zero to be deleted.
        if (set.weightLb != null) copy.weightLb = set.weightLb;
        if (set.reps != null) copy.reps = set.reps;
        if (set.rpe != null) copy.rpe = set.rpe;
        if (set.durationSec != null) copy.durationSec = set.durationSec;
        if (set.distanceMeters != null) copy.distanceMeters = set.distanceMeters;
        return copy;
      }),
    })),
  };

  workouts.push(session);
  save(KEY.workouts, workouts);

  // Only a dated prescription gets marked as started. A template is reusable
  // by definition, so starting it must not consume it.
  if (training.some((t) => t.id === prescription.id)) {
    training = training.map((t) =>
      (t.id === prescription.id ? { ...t, startedSessionId: session.id } : t));
    save(KEY.training, training);
  }
  render();
}

async function checkForIncomingPlan() {
  if (!location.hash || location.hash.length < 4) return;

  let payload;
  try {
    payload = await decodeIncomingPlan(location.hash);
  } catch (e) {
    alert(e.message);
    history.replaceState(null, '', location.pathname);
    return;
  }
  if (!payload) return;

  // A plan is addressed, not broadcast. Refusing one meant for someone else
  // is the whole reason the id travels with it.
  const mine = coach && coach.id;
  if (payload.l && mine && payload.l !== mine) {
    alert('That plan was sent to a different person, so it has not been opened. '
        + 'Ask your coach to send one addressed to you.');
    history.replaceState(null, '', location.pathname);
    return;
  }

  const from = payload.n ? `from ${payload.n}` : 'from your coach';
  const meals = (payload.m || []).length;
  const recipeCount = (payload.r || []).length;
  const sessionCount = (payload.k || []).length;

  // Naming both halves is what makes a client running an older build notice
  // that the training never arrived. See "Changing this" in PLAN-FORMAT.md.
  const workoutCount = (payload.w || []).length;
  const holds = [];
  if (meals) {
    holds.push(`${meals} meal${meals === 1 ? '' : 's'} and `
             + `${recipeCount} recipe${recipeCount === 1 ? '' : 's'}`);
  } else if (recipeCount) {
    // A library send: recipes to keep, with nothing booked into a day.
    holds.push(`${recipeCount} recipe${recipeCount === 1 ? '' : 's'} to keep`);
  }
  if (sessionCount) holds.push(`${sessionCount} session${sessionCount === 1 ? '' : 's'}`);
  else if (workoutCount) {
    holds.push(`${workoutCount} workout${workoutCount === 1 ? '' : 's'} to keep`);
  }
  if (!holds.length) return;

  // Only a send that books days replaces anything. Saying otherwise about a
  // recipe handed over on its own is a warning about a thing that cannot happen.
  const schedules = meals || sessionCount;
  const ok = confirm(
    `A plan ${from}.\n\n${holds.join('\n')}\n\n`
    + (schedules
      ? 'Take it in? Anything already planned for those days is replaced.'
      : 'Keep it?'));

  history.replaceState(null, '', location.pathname);
  if (!ok) return;

  const addedMeals = importPlan(payload);
  const addedSessions = importTraining(payload);

  const took = [];
  if (addedMeals) took.push(`${addedMeals} meal${addedMeals === 1 ? '' : 's'}`);
  else if (recipeCount) took.push(`${recipeCount} recipe${recipeCount === 1 ? '' : 's'}`);
  if (addedSessions) {
    took.push(sessionCount
      ? `${addedSessions} session${addedSessions === 1 ? '' : 's'}`
      : `${addedSessions} workout${addedSessions === 1 ? '' : 's'}`);
  }
  alert(`Added ${took.join(' and ')}.`);
  showTab(addedMeals || (recipeCount && !workoutCount) ? 'cook' : 'train');
}

checkForIncomingPlan();

/* ---------------- ingredient lookup ----------------
 *
 * Same data layer as the Coach app (foods.js) and the same two sources, so a
 * recipe a coach costs and a recipe you write yourself carry comparable
 * numbers rather than two different people's guesses.
 */

let ingredientSource = 'library';
let ingredientTally = null;

const emptyTally = () => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, lines: 0 });

function renderIngredientSources() {
  chips($('#ing-source'),
    [{ label: 'Ingredients', v: 'library' }, { label: 'Packaged & barcodes', v: 'packaged' }],
    (i) => i.v === ingredientSource,
    (i) => {
      ingredientSource = i.v;
      renderIngredientSources();
      const query = $('#ing-query').value.trim();
      if (query) runIngredientSearch(query);
    });

  $('#ing-query').placeholder = ingredientSource === 'library'
    ? 'Chicken breast, oats, olive oil...'
    : 'Brand name, or a barcode';
}

async function runIngredientSearch(query) {
  const box = $('#ing-results');
  box.innerHTML = '';
  box.appendChild(el('p', 'muted', 'Searching...'));

  if (ingredientSource === 'library') {
    await loadFoodLibrary();
    if (foodLibraryError) {
      box.innerHTML = '';
      box.appendChild(el('p', 'muted',
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
    box.appendChild(el('p', 'muted', `Could not reach Open Food Facts (${e.message}).`));
  }
}

function showIngredientHits(hits) {
  const box = $('#ing-results');
  box.innerHTML = '';
  if (!hits.length) {
    box.appendChild(el('p', 'muted', 'Nothing found for that.'));
    return;
  }

  hits.slice(0, 12).forEach((hit) => {
    const card = el('div', 'card');
    card.appendChild(el('div', null, hit.name));
    card.appendChild(el('p', 'muted', hit.label));

    const row = el('div', 'row');
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.inputMode = 'decimal';
    amount.min = '0';
    amount.value = hit.per === 'g' ? '100' : '1';
    amount.setAttribute('aria-label', hit.per === 'g' ? 'Grams' : 'Servings');
    row.appendChild(amount);

    const add = el('button', null, hit.per === 'g' ? 'Add grams' : 'Add servings');
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
  Object.keys(contribution).forEach((key) => { ingredientTally[key] += contribution[key]; });
  ingredientTally.lines += 1;

  applyTally();
  $('#ing-results').innerHTML = '';
  $('#ing-query').value = '';
}

/* Only fields you have not typed into are filled in. A looked-up figure must
 * never quietly overwrite a number entered deliberately. */
function applyTally() {
  const note = $('#ing-tally');
  if (!ingredientTally || !ingredientTally.lines) {
    note.textContent = '';
    return;
  }

  const servings = parseFloat($('#r-servings').value) || 1;
  const perServing = {
    '#r-fib': ingredientTally.fiberG / servings,
    '#r-cal': ingredientTally.calories / servings,
    '#r-p': ingredientTally.proteinG / servings,
    '#r-c': ingredientTally.carbsG / servings,
    '#r-f': ingredientTally.fatG / servings,
  };

  Object.entries(perServing).forEach(([selector, value]) => {
    const field = $(selector);
    if (field.dataset.typed === '1') return;
    field.value = Math.round(value);
  });

  const round = (n) => Math.round(n).toLocaleString();
  note.textContent = `${ingredientTally.lines} looked-up `
    + `ingredient${ingredientTally.lines === 1 ? '' : 's'} - `
    + `${round(ingredientTally.calories)} kcal for the whole recipe, `
    + `${round(ingredientTally.calories / servings)} a serving.`;
}

$('#r-weight').addEventListener('input', renderRecipeWeightEach);
$('#r-servings').addEventListener('input', renderRecipeWeightEach);

['#r-cal', '#r-p', '#r-c', '#r-f', '#r-fib'].forEach((selector) => {
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

/* Published for watch-scan.js, which is a separate script rather than more
 * lines in this file. Top-level const/let never land on window by themselves.
 *
 * `food` and `foodDate` are NOT published by value: both are `let`s app.js
 * can rebind or reassign, and a snapshot published once at load time would
 * go stale forever the first time that happened, while watch-scan.js kept
 * reading or writing the abandoned copy. Instead this publishes functions
 * that close over the live bindings and do the whole read or write
 * themselves. */
Object.assign(window, {
  KEY,
  uid,
  dateKey,
  // Adds records to the live food array, persists, and re-renders -- the
  // only supported way for watch-scan.js to write an import.
  //
  // Skips any record whose id is already in the store. The watch only
  // clears its on-screen log on a manual tap, so the same codes are still
  // there to be rescanned by accident -- and watch-scan.js gives every
  // imported record a deterministic id (export timestamp + logged time +
  // position in the code) precisely so that a re-import of the same code
  // produces the same ids and can be told apart from new ones here, against
  // the live store, rather than by a random id that would just double the
  // day silently every time. Returns the records actually written, so the
  // caller can report what happened and, e.g., navigate to what landed.
  addFoodEntries: (records) => {
    const existingIds = new Set(food.map((f) => f.id));
    const fresh = records.filter((r) => !existingIds.has(r.id));
    fresh.forEach((r) => food.push(r));
    save(KEY.food, food);
    render();
    return { imported: fresh, skipped: records.length - fresh.length };
  },
  // Points the Food tab at a specific day and switches to it. `foodDate` is
  // also a `let` (see the comment above) -- published the same way as
  // addFoodEntries, as a setter closing over the live binding, rather than
  // by value. Used after a successful import so the user lands on what they
  // just imported instead of staying on "Today" wondering where it went;
  // Previous/Next is the only other navigation, one day per tap, and the
  // watch retains its most recent 200 entries with no age limit, so the
  // oldest imported day could be an unbounded number of taps away.
  goToFoodDate: (day) => { foodDate = day; showTab('food'); },
});
