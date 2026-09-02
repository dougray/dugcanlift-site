/* Ingredient lookup, shared by LIFT Coach and the web build of LIFT.
 *
 * Two sources, because a recipe is made of two kinds of thing:
 *
 *   Ingredients  USDA FoodData Central, SR Legacy. 7,793 raw and prepared
 *                foods, public domain, bundled and searched offline. This is
 *                what "500 g chicken breast" actually is.
 *
 *   Packaged     Open Food Facts, through the same proxy LIFT's food search
 *                uses. Branded products and barcodes — the tub of yoghurt, not
 *                the chicken.
 *
 * Open Food Facts is products, not ingredients; USDA is ingredients, not
 * products. Neither is a recipe database, and no open one carries macros, so
 * recipes are still written rather than imported wholesale.
 *
 * Everything here is per 100 g except an Open Food Facts product that only
 * publishes per-serving figures, which says so in `per`.
 */

const FOOD_PROXY = 'https://lift-proxy.dugcanlift.workers.dev';
const FOOD_DB = 'foods.json';

let foodLibrary = null;
let foodLibraryError = null;

/** Loaded on first use: 131 KB over the wire is not something to spend at boot. */
async function loadFoodLibrary() {
  if (foodLibrary || foodLibraryError) return foodLibrary;
  try {
    const response = await fetch(FOOD_DB);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const raw = await response.json();
    foodLibrary = raw.foods.map(([name, category, calories, proteinG, fatG, carbsG, fiberG]) => ({
      name,
      category: raw.categories[category] || '',
      per: 'g',
      // Per gram. One multiplier whichever source a row came from.
      unit: {
        calories: calories / 100,
        proteinG: proteinG / 100,
        fatG: fatG / 100,
        carbsG: carbsG / 100,
        fiberG: fiberG / 100,
      },
      label: `${Math.round(calories)} kcal per 100 g · P ${Math.round(proteinG)}`
           + ` C ${Math.round(carbsG)} F ${Math.round(fatG)}`,
    }));
  } catch (e) {
    foodLibraryError = e.message;
  }
  return foodLibrary;
}

/* Matches every word you typed, in any order.
 *
 * A contiguous substring match is the obvious implementation and it is wrong
 * here. USDA descriptions are written worst-first — the plain food is
 * "Chicken, broilers or fryers, breast, meat only, raw" — so "chicken breast"
 * does not appear in it as a phrase at all, and a substring search answers a
 * question about chicken breast with deli rolls and breaded tenders.
 *
 * Ranking, in order of weight:
 *   - where the words start, so a name leading with them wins;
 *   - shorter names, because USDA qualifies as it elaborates, which means the
 *     plain ingredient is nearly always the shortest row that matches.
 */
function searchFoodLibrary(query, limit = 30) {
  if (!foodLibrary) return [];
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  // Word starts, not bare substrings: "salmon" must not match "Salmonberries",
  // and "oat" must not match "goat".
  const patterns = words.map((word) =>
    new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const scored = [];
  for (const food of foodLibrary) {
    const name = food.name.toLowerCase();
    let positions = 0;
    let matchedAll = true;
    for (const pattern of patterns) {
      const found = name.search(pattern);
      if (found < 0) { matchedAll = false; break; }
      positions += found;
    }
    if (!matchedAll) continue;
    scored.push([positions * 100 + name.length, food]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, limit).map((row) => row[1]);
}

/* Prefers per-100 g, because an ingredient is weighed. A product publishing
 * only per-serving figures is still usable, but the amount then means servings
 * and the row has to say so. */
function parseFoodProduct(product) {
  const nutriments = product.nutriments || {};
  const value = (v) => (typeof v === 'number' ? v : parseFloat(v));
  if (!product.product_name) return null;

  const read = (suffix) => {
    const calories = value(nutriments[`energy-kcal_${suffix}`]);
    if (isNaN(calories)) return null;
    return {
      calories,
      proteinG: value(nutriments[`proteins_${suffix}`]) || 0,
      fatG: value(nutriments[`fat_${suffix}`]) || 0,
      carbsG: value(nutriments[`carbohydrates_${suffix}`]) || 0,
      fiberG: value(nutriments[`fiber_${suffix}`]) || 0,
    };
  };

  const per100 = read('100g');
  const perServing = read('serving');
  const values = per100 || perServing;
  if (!values) return null;

  const brand = Array.isArray(product.brands) ? product.brands[0] : product.brands;
  const basis = per100 ? 'per 100 g' : 'per serving';

  return {
    name: brand ? `${product.product_name} (${brand})` : product.product_name,
    category: 'Packaged',
    per: per100 ? 'g' : 'serving',
    unit: per100
      ? { calories: values.calories / 100, proteinG: values.proteinG / 100,
          fatG: values.fatG / 100, carbsG: values.carbsG / 100, fiberG: values.fiberG / 100 }
      : values,
    label: `${Math.round(values.calories)} kcal ${basis} · P ${Math.round(values.proteinG)}`
         + ` C ${Math.round(values.carbsG)} F ${Math.round(values.fatG)}`,
  };
}

/** Throws on a failed lookup so the caller can say why rather than show none. */
async function searchPackagedFoods(query) {
  const isBarcode = /^[0-9]{8,14}$/.test(query);
  const response = await fetch(isBarcode
    ? `${FOOD_PROXY}/barcode/${query}`
    : `${FOOD_PROXY}/search?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);

  const hits = isBarcode
    ? (data.status === 1 && data.product ? [data.product] : [])
    : (data.hits || []);
  return hits.map(parseFoodProduct).filter(Boolean);
}

/** What a quantity of one hit contributes. Grams, or servings when that is all
 *  the source publishes. */
function foodContribution(hit, quantity) {
  return {
    calories: hit.unit.calories * quantity,
    proteinG: hit.unit.proteinG * quantity,
    fatG: hit.unit.fatG * quantity,
    carbsG: hit.unit.carbsG * quantity,
    fiberG: hit.unit.fiberG * quantity,
  };
}

/** The ingredient line a pick writes: "600 g Chicken, breast, raw". */
function foodLine(hit, quantity) {
  const amount = Math.round(quantity * 100) / 100;
  return hit.per === 'g' ? `${amount} g ${hit.name}` : `${amount} × ${hit.name}`;
}


/* ---------------- weights ---------------- */

/* Grams for the units that convert to a weight without guessing.
 *
 * Volume and vague units are deliberately absent. A tablespoon of oil and a
 * tablespoon of flour are not the same mass, and "a handful" is not a
 * measurement — costing them would mean inventing densities, and a confident
 * wrong calorie count is worse than an obvious gap. */
const GRAMS_PER_UNIT = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592, lbs: 453.592 };

function gramsFor(parsed) {
  if (!parsed || parsed.qty == null) return null;
  const factor = GRAMS_PER_UNIT[parsed.unit];
  return factor ? parsed.qty * factor : null;
}
