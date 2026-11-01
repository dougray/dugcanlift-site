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

/* Unit words spelled out, as US recipe sites write them ("1.5 pounds ground
 * beef"), each stored as the abbreviation above. Storing the abbreviation is
 * the whole design: costing, shopping-list grouping and the count sentinel
 * already key on it, so a spelled-out line behaves exactly like its
 * abbreviated twin and nothing downstream changes.
 *
 * The same table, word for word, is in LiftKit's IngredientParser.swift, the
 * Android kit's IngredientParser.kt and LIFT web's app.js. Deliberately
 * not here: fl oz, a bare t or T, c., pt, qt, stick, or anything that needs a
 * density. */
const COOK_SPELLED_UNITS = {
  gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kilogram: 'kg', kilograms: 'kg', kilogramme: 'kg', kilogrammes: 'kg',
  kilo: 'kg', kilos: 'kg',
  milligram: 'mg', milligrams: 'mg', milligramme: 'mg', milligrammes: 'mg',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb',
  teaspoon: 'tsp', teaspoons: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
};

/* Every whitespace character, written out rather than left to a platform's
 * idea of whitespace: U+0009-U+000D, U+0020, U+00A0, U+1680, U+2000-U+200A,
 * U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF (JavaScript's \s). Before
 * parsing, each one becomes a plain space, so a non-breaking space or a tab
 * pasted from a recipe page splits words like a space does. rawText keeps the
 * line as it was. The same set, character for character, is in all four
 * parsers. */
const COOK_WHITESPACE = /[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/g;

/* The vulgar fractions read as quantities, each as [numerator, denominator]:
 * the eighteen in Unicode that name a fraction, alone ("½ cup") or after a
 * whole number with or without a space ("1½", "1 ½"). Not ⅟ (U+215F), which
 * is half of a fraction, or ↉ (U+2189), zero thirds. The same eighteen are in
 * all four parsers. */
const COOK_VULGAR_FRACTIONS = {
  '¼': [1, 4], '½': [1, 2], '¾': [3, 4],
  '⅐': [1, 7], '⅑': [1, 9], '⅒': [1, 10], '⅓': [1, 3], '⅔': [2, 3],
  '⅕': [1, 5], '⅖': [2, 5], '⅗': [3, 5], '⅘': [4, 5], '⅙': [1, 6], '⅚': [5, 6],
  '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8],
};

/* What may follow a quantity, checked once it has been read. The line is not
 * read at all when the next character after any spaces is a number character
 * (Unicode category N: a digit, a vulgar fraction, a superscript, another
 * script's digit) or a slash, or is one of . , - ‐ ‑ ‒ – — − followed, after
 * any spaces, by a number character: "1 2 eggs", "1,5 kg", "1,000 g", "1-2
 * cups", "1/2/3", "2² cups". Each of those is a number this parser cannot
 * read, and stopping short of it would be a confident wrong quantity. A dash
 * before a letter is fine: "1/2-inch piece ginger". */
const COOK_NOT_A_QUANTITY_END = /^ *(?:[\p{N}/\u2044]|[.,\-\u2010-\u2014\u2212] *\p{N})/u;

/* The punctuation trimmed from the end of a unit word, so "2 tbsp. oil",
 * "2 tbsp: oil" and "1 cup; sugar" all read the unit. Only the end, and only
 * these four: "(tbsp)", "tbsp)" and "tbsp-" are not units. The same four are
 * in all four parsers. */
const COOK_UNIT_TRAILING_PUNCTUATION = /[.,:;]+$/;

/* Reads the quantity off the front of a normalized line with no leading
 * spaces, returning it with the rest of the line (leading spaces dropped), or
 * null to give up on the line. A quantity is a decimal ("2", "1.5", "1.",
 * ".5"; ASCII digits and at most one point), a fraction of whole numbers
 * ("1/2", the fraction slash U+2044 read as "/"), a whole number then spaces
 * then a fraction ("1 1/2"), or a vulgar fraction, alone or after a whole
 * number ("½", "1½", "1 ½"). Every number in it must be finite and a
 * denominator must not be zero. */
function cookTakeQuantity(text) {
  let s = text;
  const digits = () => (s.match(/^[0-9]*/))[0];
  // A run of digits as a number, or null when it is too long to be finite.
  const number = (run) => { const v = Number(run); return Number.isFinite(v) ? v : null; };
  const vulgar = () => (Object.prototype.hasOwnProperty.call(COOK_VULGAR_FRACTIONS, s[0])
    ? COOK_VULGAR_FRACTIONS[s[0]] : null);
  // "/" or U+2044 and a nonzero whole denominator, consumed only if all there.
  const takeDenominator = () => {
    if (s[0] !== '/' && s[0] !== '\u2044') return null;
    const saved = s;
    s = s.slice(1);
    const run = digits();
    const d = run ? number(run) : null;
    if (!d) { s = saved; return null; }
    s = s.slice(run.length);
    return d;
  };

  let value;
  const lead = vulgar();
  if (lead) {
    s = s.slice(1);
    value = lead[0] / lead[1];
  } else {
    const run = (s.match(/^[0-9.]*/))[0];
    if (!run) return null;
    if (run.includes('.')) {
      // One point at most, and at least one digit: "1.2.3" and "." are not numbers.
      if (!/^(?:[0-9]+\.[0-9]*|\.[0-9]+)$/.test(run)) return null;
      value = number(run);
      s = s.slice(run.length);
    } else {
      value = number(run);
      s = s.slice(run.length);
      if (value === null) return null;
      const denominator = takeDenominator();
      const fraction = denominator === null ? vulgar() : null;
      if (denominator !== null) {
        value /= denominator;
      } else if (fraction) {
        s = s.slice(1);
        value += fraction[0] / fraction[1];
      } else if (s.startsWith(' ')) {
        // "1 1/2" or "1 ½" — a whole number, spaces, then a fraction.
        const saved = s;
        s = s.trimStart();
        const after = vulgar();
        const numerator = after ? '' : digits();
        if (after) {
          s = s.slice(1);
          value += after[0] / after[1];
        } else if (numerator && number(numerator) !== null) {
          s = s.slice(numerator.length);
          const d = takeDenominator();
          if (d !== null) value += number(numerator) / d;
          else s = saved;
        } else {
          s = saved;
        }
      }
    }
  }

  if (value === null || !Number.isFinite(value)) return null;
  if (COOK_NOT_A_QUANTITY_END.test(s)) return null;
  return { qty: value, rest: s.trimStart() };
}

/* Pulls a quantity and unit off the front of a typed ingredient line.
 *
 * Deliberately small. It handles the shapes people actually type and gives up
 * cleanly on everything else, leaving `item` undefined so the shopping list
 * shows the raw line instead. A confident wrong quantity on a client's
 * shopping list is worse than a line they can read and check.
 *
 * dugcanlift-kit's data/ingredient-lines.json is the case table all four
 * parsers are checked against; a copy is in fixtures/. */
function parseIngredient(raw) {
  const quantity = cookTakeQuantity(raw.replace(COOK_WHITESPACE, ' ').trimStart());
  if (quantity === null) return { rawText: raw };
  const { qty, rest } = quantity;

  const firstWord = rest.split(' ')[0];
  const candidate = firstWord.toLowerCase().replace(COOK_UNIT_TRAILING_PUNCTUATION, '');

  let unit = null;
  let item;
  // An own-property check, so "constructor" or "toString" is never a unit.
  const spelled = Object.prototype.hasOwnProperty.call(COOK_SPELLED_UNITS, candidate)
    ? COOK_SPELLED_UNITS[candidate] : null;
  const known = COOK_UNITS.has(candidate) ? candidate : spelled;
  if (known) {
    unit = known;
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
