/* Ingredient parsing and shopping-list rules.
 *
 * Its own file so it can be tested without a DOM — open parser-test.html.
 *
 * These rules exist four times over: here, in the web build of LIFT, and in
 * the Android and iOS apps. All four must produce the same answer for the same
 * line, because a recipe written on one client reaches the others through the
 * shared wire format, and a quantity that reads differently on one of them is
 * a bug nobody would think to look for.
 *
 * buildShoppingList takes a lookup rather than reading app state, so the rules
 * stay testable and the state stays in app.js.
 */

/* Grouping key for an ingredient with no unit — "2 eggs", "1 banana".
 *
 * A sentinel, not a unit. It keeps counts in their own bucket during
 * aggregation, so two cloves of garlic are never added to two cups of
 * anything, and the shopping list drops it when printing, because
 * "2 x banana" is not how anyone writes a shopping list.
 *
 * Contains a null character so it can never collide with something typed. */
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
 * shows the raw line instead. A confident wrong quantity on a client's
 * shopping list is worse than a line they can read and check. */
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

const trimNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const servingsLabel = (v) => (v === 1 ? '1 serving' : `${trimNum(v)} servings`);
const cookUid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/* Counts print bare — "2", not "2 x banana". */
function amountsLabel(amounts) {
  return Object.keys(amounts).sort().map((unit) => {
    const value = trimNum(amounts[unit]);
    return unit === COUNT_UNIT ? value : `${value} ${unit}`;
  }).join(' + ');
}

function dayLabel(key) {
  if (key === todayKey()) return 'Today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === dateKey(tomorrow)) return 'Tomorrow';
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'long' });
}

function cookWeek() {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push(dateKey(d));
  }
  return out;
}

/* Amounts scale by each meal's servings against the recipe's own serving
 * count, so planning two servings of a four-serving recipe buys half. */
function buildShoppingList(meals, lookup) {
  const amounts = {}, names = {}, unparsed = {};

  meals.forEach((meal) => {
    const recipe = lookup(meal.recipeId);
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
