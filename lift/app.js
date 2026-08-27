/* LIFT — nutrition and training tracker.
 *
 * Storage mirrors the Android app's JSON schema exactly, so a log can move
 * between the two later without a conversion step.
 */

/* ---------------- storage ---------------- */

const KEY = { goal: 'lift.goal', food: 'lift.food', workouts: 'lift.workouts', settings: 'lift.settings', steps: 'lift.steps',
              coach: 'lift.coach', profile: 'lift.profile', weights: 'lift.weights',
              ext: 'lift.ext',
              recipes: 'lift.recipes', plan: 'lift.plan', shopping: 'lift.shopping' };

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

const FOCUS = {
  BODYBUILDING: { label: 'Bodybuilding', weight: 1, reps: 1, rpe: 1, time: 0, dist: 0 },
  POWERLIFTING: { label: 'Powerlifting', weight: 1, reps: 1, rpe: 1, time: 0, dist: 0 },
  CROSSFIT:     { label: 'CrossFit',     weight: 1, reps: 1, rpe: 0, time: 1, dist: 0 },
  HYROX:        { label: 'Hyrox',        weight: 1, reps: 1, rpe: 0, time: 1, dist: 1 },
  ENDURANCE:    { label: 'Endurance',    weight: 0, reps: 0, rpe: 1, time: 1, dist: 1 },
  EVERYTHING:   { label: 'Everything',   weight: 1, reps: 1, rpe: 1, time: 1, dist: 1 },
};

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
  calories: '#c1442c', protein: '#7c8b7a', carbs: '#5b8db8',
  fat: '#d9a441', fiber: '#8e7cc3', weight: '#c1442c', e1rm: '#5b8db8',
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

  ctx.fillStyle = '#a39c8e';
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
  if (!todays.length) {
    training.appendChild(el('p', 'muted', 'Nothing logged today.'));
  } else {
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

  const weights = history.map((h) => topWeight(h.ex)).filter((v) => v != null);
  const rms = history.map((h) => e1rm(h.ex)).filter((v) => v != null);
  statline(card, 'Sessions', String(history.length));
  statline(card, 'Best weight', weights.length ? `${Math.round(Math.max(...weights))} lb` : '-');
  statline(card, 'Most recent', weights.length ? `${Math.round(weights[weights.length - 1])} lb` : '-');
  statline(card, 'Best est. 1RM', rms.length ? `${Math.round(Math.max(...rms))} lb` : '-');

  const canvas = el('canvas');
  canvas.setAttribute('height', '150');
  card.appendChild(canvas);
  const lg = el('div', 'legend');
  card.appendChild(lg);

  const series = [
    { label: 'Top weight', color: CHART.weight, values: history.map((h) => topWeight(h.ex)) },
    { label: 'Est. 1RM', color: CHART.e1rm, values: history.map((h) => e1rm(h.ex)) },
  ];
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
      info.appendChild(el('div', null, e.servings === 1 ? e.name : `${e.name} x${e.servings}`));
      info.appendChild(el('div', 'muted',
        `${mul(e, 'calories')} kcal - P ${mul(e, 'proteinG')} - F ${mul(e, 'fatG')} - C ${mul(e, 'carbsG')} - Fib ${mul(e, 'fiberG')}`));
      row.appendChild(info);
      const x = el('button', 'x', '\u00d7');
      x.onclick = () => { food = food.filter((f) => f.id !== e.id); save(KEY.food, food); render(); };
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

function openFoodForm(prefill) {
  $('#food-form').classList.remove('hidden');
  $('#food-search').classList.add('hidden');
  formMeal = guessMeal();
  $('#f-name').value = prefill ? prefill.name : '';
  $('#f-servings').value = 1;
  $('#f-cal').value = prefill ? prefill.calories : '';
  $('#f-p').value = prefill ? prefill.proteinG : '';
  $('#f-f').value = prefill ? prefill.fatG : '';
  $('#f-c').value = prefill ? prefill.carbsG : '';
  $('#f-fib').value = prefill ? prefill.fiberG : '';
  renderMealChips();
}

function renderMealChips() {
  chips($('#f-meal'), MEALS.map((m) => ({ label: MEAL_LABEL[m], m })),
    (i) => i.m === formMeal, (i) => { formMeal = i.m; renderMealChips(); });
}

$('#food-add').onclick = () => openFoodForm(null);
$('#f-cancel').onclick = () => $('#food-form').classList.add('hidden');

$('#f-save').onclick = () => {
  const name = $('#f-name').value.trim();
  const calories = parseInt($('#f-cal').value, 10);
  if (!name || isNaN(calories)) return;
  food.push({
    id: uid(), name,
    servings: parseFloat($('#f-servings').value) || 1,
    calories,
    proteinG: parseInt($('#f-p').value, 10) || 0,
    fatG: parseInt($('#f-f').value, 10) || 0,
    carbsG: parseInt($('#f-c').value, 10) || 0,
    fiberG: parseInt($('#f-fib').value, 10) || 0,
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
    ...values,
  };
}

/* ---------------- train ---------------- */

let trainDate = todayKey();

function renderTrain() {
  $('#train-date').textContent = dateLabel(trainDate);
  $('#train-next').disabled = trainDate === todayKey();

  chips($('#focus-chips'), Object.keys(FOCUS).map((k) => ({ label: FOCUS[k].label, k })),
    (i) => i.k === settings.focus,
    (i) => { settings.focus = i.k; save(KEY.settings, settings); render(); });

  const f = FOCUS[settings.focus] || FOCUS.BODYBUILDING;
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
      card.appendChild(el('p', 'muted',
        `${sessionSets(session)} sets - ${Math.round(sessionVolume(session))} lb volume`));
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
    addEx.onclick = () => {
      const name = prompt('Exercise name');
      if (!name) return;
      const equipment = prompt('Equipment (optional)') || '';
      session.exercises = session.exercises || [];
      session.exercises.push({ id: uid(), name: name.trim(), equipment: equipment.trim(), note: '', sets: [] });
      save(KEY.workouts, workouts);
      render();
    };
    card.appendChild(addEx);

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
    const v = prompt('Reps', last.reps != null ? last.reps : '');
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

const BACKUP_KEYS = ['goal', 'food', 'workouts', 'settings', 'steps', 'coach', 'profile', 'weights'];

function saveBackup() {
  const data = {};
  BACKUP_KEYS.forEach((k) => { data[k] = load(KEY[k], null); });
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

      const addMissing = (current, arriving) => {
        const seen = new Set(current.map((r) => r && r.id));
        let added = 0;
        (arriving || []).forEach((r) => {
          if (r && r.id && !seen.has(r.id)) { current.push(r); added += 1; }
        });
        return added;
      };
      const fillGaps = (current, arriving) => {
        Object.entries(arriving || {}).forEach(([k, v]) => {
          if (current[k] == null) current[k] = v;
        });
      };

      // Keep the parts of the file this app cannot read, so saving again
      // returns them intact rather than quietly dropping them.
      if (parsed.ext && Object.keys(parsed.ext).length) save(KEY.ext, parsed.ext);

      const added = addMissing(food, incoming.food) + addMissing(workouts, incoming.workouts);
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
  const typed = [num('#r-cal'), num('#r-p'), num('#r-c'), num('#r-f')];
  // Null unless something was actually typed — an untouched form must not
  // write zeros, which would later log as a zero-calorie meal.
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
      const row = el('div', 'statline');
      row.appendChild(el('span', 'muted', meal.charAt(0) + meal.slice(1).toLowerCase()));

      const right = el('div');
      if (!forSlot.length) {
        const add = el('button', 'chip', 'Add');
        add.onclick = () => pickRecipe(day, meal);
        right.appendChild(add);
      } else {
        forSlot.forEach((m) => {
          const line = el('div');
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

function pickRecipe(day, meal) {
  const servings = parseFloat(prompt('How many servings?', '1'));
  if (!servings || servings <= 0) return;
  const names = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
  const choice = prompt(
    'Which recipe?\n\n' + names.map((r, i) => `${i + 1}. ${r.name}`).join('\n'), '1');
  const index = parseInt(choice, 10) - 1;
  const recipe = names[index];
  if (!recipe) return;

  plan.push({
    id: uid(),
    recipeId: recipe.id,
    recipeName: recipe.name,
    date: day,
    meal,
    servings,
    // Per serving, never pre-scaled. Same invariant as both native builds.
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
