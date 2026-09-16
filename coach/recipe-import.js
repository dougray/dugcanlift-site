/* Reading a recipe out of a page, or out of pasted prose.
 *
 * Its own file so it can be tested without a DOM — open recipe-import-test.html.
 * No build step and no toolchain, the same reason the rest of Coach has none.
 *
 * Two readers, mirroring `RecipeJSONLD` / `CaptionRecipe` in the iOS build and
 * `RecipeJsonLd` / `CaptionRecipe` in the Android one.
 *
 *   recipeFromJsonLd(html)  — the labelled path. Almost every recipe site
 *                             publishes schema.org JSON-LD because Google
 *                             requires it for a rich result, so the publisher
 *                             has already said which strings are ingredients
 *                             and we read the labels rather than scraping a
 *                             layout.
 *
 *   parseCaption(text)      — the unlabelled path, for when nobody did.
 *                             TikTok, Instagram and Reels publish no
 *                             schema.org Recipe at all; YouTube publishes a
 *                             VideoObject. The recipe there is prose in a
 *                             caption.
 *
 * parseCaption only ever PROPOSES a split. Whatever uses it must be an editor
 * rather than a review — that is the whole safety argument. A wrong split costs
 * the reader an edit and never a number, because parseIngredient (parser.js)
 * still reads the quantities afterwards, from the text finally approved, and
 * still refuses to weigh a volume.
 *
 * Unlike parser.js, these two owe no cross-client parity contract: they are
 * input paths, and what they produce is indistinguishable from a hand-typed
 * recipe the moment it is saved. They were still ported rather than
 * reinvented, and the test page uses the same fixtures as the iOS and Android
 * suites.
 */

/* ------------------------------------------------------------------ *
 * Caption reading
 * ------------------------------------------------------------------ */

const CAPTION_BULLETS = '-–—*•‣·▢☐□▪▫●○+>~';

const INGREDIENT_HEADINGS = new Set([
  'ingredients', 'ingredient', 'the ingredients', 'ingredients list',
  'ingredient list', 'what you need', 'what youll need', 'what you will need',
  'youll need', 'you will need', 'you need', 'shopping list', 'grocery list',
  'what to buy', 'for the recipe',
]);

const METHOD_HEADINGS = new Set([
  'method', 'the method', 'instructions', 'instruction', 'directions',
  'direction', 'steps', 'the steps', 'how to', 'how to make',
  'how to make it', 'how to make this', 'how i make it', 'preparation',
  'lets make it', 'lets go', 'process', 'to make',
]);

const YIELD_WORDS = new Set([
  'serves', 'serving', 'servings', 'makes', 'yield', 'yields', 'feeds',
  'portions',
]);

/* Emoji and symbols used as decoration around a heading or a bullet. */
function isDecorativeChar(ch) {
  if (/[\p{L}\p{N}]/u.test(ch)) return false;
  return /[\p{S}\p{Extended_Pictographic}]/u.test(ch);
}

/* Removes bullets and leading list numbering, keeping the content.
 *
 * Formatting, not content, so taking it off is not a guess. The numbering
 * strip requires whitespace after the separator, because "1.5 cups flour"
 * otherwise loses its "1." and becomes five cups. */
function stripCaptionLine(raw) {
  let text = String(raw);

  const trimDecoration = () => {
    /* Array.from splits by code point, so an emoji is one character here
     * rather than two surrogate halves neither of which tests as a symbol. */
    const chars = Array.from(text);
    let i = 0;
    while (
      i < chars.length &&
      (/\s/.test(chars[i]) || CAPTION_BULLETS.includes(chars[i]) || isDecorativeChar(chars[i]))
    ) i++;
    text = chars.slice(i).join('');
  };

  trimDecoration();

  const numbered = text.match(/^(\d+)[.)]\s/);
  if (numbered) {
    text = text.slice(numbered[1].length + 1);
    trimDecoration();
  }

  return text.trim();
}

/* Letters only, lowercased, apostrophes dropped so "you'll" and "youll" are one
 * word. Digits and punctuation are not words. */
function significantWords(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/* A heading is a short line that says nothing but its own name.
 *
 * Matched on the words alone, so "INGREDIENTS:" and "— Ingredients —" and
 * "Ingredients 👇" are all the same heading. */
function captionHeading(words) {
  if (words.length === 0 || words.length > 4) return null;
  const phrase = words.join(' ');
  if (INGREDIENT_HEADINGS.has(phrase)) return 'ingredients';
  if (METHOD_HEADINGS.has(phrase)) return 'method';
  return null;
}

/* An explicitly stated yield, and nothing looser.
 *
 * The line must OPEN with a yield word and carry a number. A bare "for 2" is
 * not accepted, because "cook slowly with the ham bone for 2 hours" is a
 * cooking time, and reading it as a yield halves every macro in the dish. A
 * wrong serving count is silent and divides everything, so this is the
 * strictest rule in the file. */
function statedServings(text, words) {
  if (words.length === 0 || !YIELD_WORDS.has(words[0])) return null;
  if (words.length > 6) return null;

  const match = text.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  if (!(value > 0) || value > 200) return null;
  return value;
}

function captionRow(raw) {
  const text = stripCaptionLine(raw);
  const words = significantWords(text);
  const tokens = text.split(' ').filter(Boolean);

  const noise =
    text === '' ||
    (tokens.length > 0 && tokens.every((t) => t.startsWith('#') || t.startsWith('@'))) ||
    words.length === 0;

  /* Short, wordy, and not opening with a quantity. The digit test is what keeps
   * "2 chicken breasts" from being read as a dish called "2 chicken breasts" —
   * almost every ingredient line starts with its number, almost no title does. */
  const looksLikeTitle =
    text.length > 0 &&
    !/\d/.test(text[0]) &&
    text.length <= 80 &&
    words.length <= 12;

  return {
    text,
    heading: captionHeading(words),
    servings: statedServings(text, words),
    noise,
    looksLikeTitle,
  };
}

/* Proposes a split of pasted text into name, ingredients and method.
 *
 * Never fails: text with no recognisable structure comes back split 'unsorted'
 * with every content line in ingredientLines, which is the honest answer and
 * the one an editor can act on.
 *
 * Returns { name, ingredientLines, steps, servings, split, sourceText }. */
function parseCaption(input) {
  const rows = String(input || '')
    .split(/\r\n|\r|\n/)
    .map(captionRow)
    .filter((row) => !row.noise);

  let ingredientsAt = null;
  let methodAt = null;
  rows.forEach((row, index) => {
    if (row.heading === 'ingredients' && ingredientsAt === null) ingredientsAt = index;
    if (row.heading === 'method' && methodAt === null) methodAt = index;
  });

  const servingsRow = rows.find((row) => row.servings !== null);
  const servings = servingsRow ? servingsRow.servings : null;

  /* The FIRST line, and only that line, when it reads like a title.
   *
   * Scanning further down for "something titular" looks more generous and is
   * strictly worse: in a caption that opens with a method heading it picks up
   * the first instruction, and in an unstructured paste it picks up whichever
   * line happens not to start with a number — usually the method. A title being
   * at the top is stated structure; a title in the middle is a guess, and a
   * wrong one takes a real line out of the recipe with it. */
  const first = rows[0];
  const name =
    first && !first.heading && first.servings === null && first.looksLikeTitle
      ? first.text
      : null;

  /* Anything already spoken for by the heading scan must not also be offered as
   * content — the name line most of all, which is otherwise the first
   * "ingredient" of every unsorted paste. */
  const content = (slice) =>
    slice
      .filter((row) => !row.heading && row.servings === null && row.text !== name)
      .map((row) => row.text);

  let ingredientLines;
  let steps;
  let split;

  if (ingredientsAt !== null && methodAt !== null && ingredientsAt < methodAt) {
    ingredientLines = content(rows.slice(ingredientsAt + 1, methodAt));
    steps = content(rows.slice(methodAt + 1));
    split = 'labelled';
  } else if (ingredientsAt !== null && methodAt !== null) {
    /* Method first. Rare, but some writers lead with the story and list what to
     * buy underneath, and the headings say so plainly. */
    steps = content(rows.slice(methodAt + 1, ingredientsAt));
    ingredientLines = content(rows.slice(ingredientsAt + 1));
    split = 'labelled';
  } else if (ingredientsAt !== null) {
    ingredientLines = content(rows.slice(ingredientsAt + 1));
    steps = [];
    split = 'inferred';
  } else if (methodAt !== null) {
    /* Everything above a method heading is the shopping side of it. That is an
     * inference, so it is labelled as one. */
    ingredientLines = content(rows.slice(0, methodAt));
    steps = content(rows.slice(methodAt + 1));
    split = 'inferred';
  } else {
    ingredientLines = content(rows);
    steps = [];
    split = 'unsorted';
  }

  return {
    name,
    ingredientLines,
    steps,
    servings,
    split,
    sourceText: String(input || '').trim(),
  };
}

/* Turns an edited text box back into lines.
 *
 * The save path, and the reason the editor can be two plain text boxes: the raw
 * text is the contract and reparsing is how it stays one. */
function captionLines(text) {
  return String(text || '')
    .split(/\r\n|\r|\n/)
    .map(stripCaptionLine)
    .filter((line) => line !== '');
}

/* ------------------------------------------------------------------ *
 * JSON-LD reading
 * ------------------------------------------------------------------ */

/* Publishers put markup inside JSON-LD string values more often than the spec
 * would suggest — <p> around a step, &amp; in a title. */
function cleanJsonLdText(string) {
  let out = String(string);
  if (out.includes('<')) {
    let stripped = '';
    let insideTag = false;
    for (const ch of out) {
      if (ch === '<') insideTag = true;
      else if (ch === '>') insideTag = false;
      else if (!insideTag) stripped += ch;
    }
    out = stripped;
  }
  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/* A boolean is not a quantity. Coercing it would read {"recipeYield": true}
 * as one serving. */
function jsonLdNumber(any) {
  return typeof any === 'number' && isFinite(any) ? any : null;
}

/* Strings and numbers both reach here, because a publisher may emit
 * "recipeYield": 4 or "recipeYield": "4" for the same dish. */
function jsonLdText(any) {
  if (typeof any === 'string') return cleanJsonLdText(any);
  const number = jsonLdNumber(any);
  if (number === null) return null;
  return Number.isInteger(number) ? String(number) : String(number);
}

/* First run of digits, with an optional decimal part.
 *
 * Commas are stripped first so "1,200 calories" reads as 1200 rather than
 * stopping at 1. A comma used as a decimal separator would be misread, but
 * JSON-LD nutrition is overwhelmingly written in English-locale numerals, and
 * reading "1,5 g" as 15 is the same class of confident-wrong answer parser.js
 * refuses to produce elsewhere — so it is left alone. */
function firstNumberIn(string) {
  const match = String(string).replace(/,/g, '').match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function jsonLdQuantity(any) {
  const number = jsonLdNumber(any);
  if (number !== null) return number;
  const text = jsonLdText(any);
  return text === null ? null : firstNumberIn(text);
}

function jsonLdStringList(any) {
  if (any === null || any === undefined) return [];
  if (Array.isArray(any)) {
    return any.map(jsonLdText).filter((s) => s !== null && s !== '');
  }
  const single = jsonLdText(any);
  return single ? [single] : [];
}

/* Instructions arrive as a paragraph, a list of strings, a list of HowToStep
 * objects, or HowToSections holding those steps.
 *
 * A single paragraph is split on newlines only. Splitting on sentences would
 * cut "Bake at 200 C. for 20 minutes" in half, and a step that is too long is
 * far easier for the reader to fix than one quietly cut in two. */
function jsonLdSteps(any) {
  if (any === null || any === undefined) return [];

  if (typeof any === 'string') {
    return cleanJsonLdText(any)
      .split(/\r\n|\r|\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (Array.isArray(any)) {
    const out = [];
    any.forEach((element) => {
      if (typeof element === 'string') {
        const cleaned = cleanJsonLdText(element);
        if (cleaned) out.push(cleaned);
        return;
      }
      if (!element || typeof element !== 'object') return;
      /* A section holds its own steps under itemListElement. */
      if (element.itemListElement !== undefined) {
        out.push(...jsonLdSteps(element.itemListElement));
        return;
      }
      const step = jsonLdText(element.text) || jsonLdText(element.name);
      if (step) out.push(step);
    });
    return out;
  }

  if (typeof any === 'object') {
    return jsonLdSteps(any.itemListElement !== undefined ? any.itemListElement : any.text);
  }
  return [];
}

/* recipeYield is "4", "4 servings", "Serves 4" or a bare number.
 *
 * The first number in the string wins. A yield with no number at all ("1 loaf"
 * parses, "a crowd" does not) stays null rather than defaulting to 1, so the
 * editor can ask instead of inventing a serving count that every macro on the
 * recipe would then be divided by. */
function jsonLdServings(any) {
  if (any === null || any === undefined) return null;
  const number = jsonLdNumber(any);
  if (number !== null) return number > 0 ? number : null;

  let candidate = null;
  if (typeof any === 'string') candidate = any;
  else if (Array.isArray(any)) candidate = any.map(jsonLdText).find((s) => s) || null;
  if (candidate === null) return null;

  const value = firstNumberIn(candidate);
  return value !== null && value > 0 ? value : null;
}

/* ISO 8601 durations, the only form schema.org allows for these — "PT30M",
 * "PT1H15M", occasionally "P0DT0H30M".
 *
 * Written out rather than handed to a library so the result is the same
 * everywhere, and so the iOS and Android copies have something unambiguous to
 * match. */
function jsonLdMinutes(any) {
  const raw = jsonLdText(any);
  if (!raw) return null;

  const scanning = raw.toUpperCase();
  if (scanning[0] !== 'P') return null;

  let inTimeSection = false;
  let digits = '';
  let totalMinutes = 0;
  let sawAnything = false;

  for (const character of scanning.slice(1)) {
    if (character === 'T') {
      inTimeSection = true;
      digits = '';
      continue;
    }
    if (character >= '0' && character <= '9') {
      digits += character;
      continue;
    }
    const value = parseInt(digits, 10);
    if (isNaN(value)) {
      digits = '';
      continue;
    }
    if (character === 'D') {
      totalMinutes += value * 24 * 60;
      sawAnything = true;
    } else if (character === 'H' && inTimeSection) {
      totalMinutes += value * 60;
      sawAnything = true;
    } else if (character === 'M' && inTimeSection) {
      totalMinutes += value;
      sawAnything = true;
    }
    /* A leading "M" outside the time section is months. Nothing sane publishes
     * a recipe in months, and treating it as minutes would be a silent
     * thirty-fold error, so it is ignored. */
    digits = '';
  }
  return sawAnything ? totalMinutes : null;
}

/* author is a string, a Person object, or a list of either. */
function jsonLdAuthor(any) {
  if (any === null || any === undefined) return null;
  if (typeof any === 'string') {
    const text = cleanJsonLdText(any);
    return text || null;
  }
  if (Array.isArray(any)) {
    for (const element of any) {
      const found = jsonLdAuthor(element);
      if (found) return found;
    }
    return null;
  }
  if (typeof any === 'object') return jsonLdText(any.name) || null;
  return null;
}

/* schema.org states NutritionInformation is per serving, which is the same
 * contract a recipe's own macros already hold — so this maps straight across
 * with no scaling.
 *
 * Values arrive as strings with units attached ("350 calories", "12 g"). Only
 * the number is read. Calories are required: a block with no energy value is
 * not worth carrying, because every screen that shows macros leads with them.
 *
 * Sodium is the one field published in two units — "320 mg" on most sites,
 * "0.32 g" on a few European ones. A gram value read as milligrams would be
 * wrong by a thousand, so the unit is checked rather than assumed. */
function jsonLdNutrition(any) {
  if (!any || typeof any !== 'object' || Array.isArray(any)) return null;
  const calories = jsonLdQuantity(any.calories);
  if (calories === null) return null;

  const sodiumRaw = jsonLdText(any.sodiumContent);
  let sodiumMg = null;
  if (sodiumRaw !== null) {
    const value = firstNumberIn(sodiumRaw);
    if (value !== null) {
      const lowered = sodiumRaw.toLowerCase();
      if (lowered.includes('mg')) sodiumMg = value;
      else if (lowered.includes('g')) sodiumMg = value * 1000;
      else sodiumMg = value;
    }
  }

  return {
    calories,
    proteinG: jsonLdQuantity(any.proteinContent) || 0,
    carbsG: jsonLdQuantity(any.carbohydrateContent) || 0,
    fatG: jsonLdQuantity(any.fatContent) || 0,
    fiberG: jsonLdQuantity(any.fiberContent),
    saturatedFatG: jsonLdQuantity(any.saturatedFatContent),
    sugarG: jsonLdQuantity(any.sugarContent),
    sodiumMg,
  };
}

/* @type is a string on most pages and an array on the ones that also declare
 * the page an Article, so both are accepted. */
function isRecipeNode(node) {
  const type = node['@type'];
  if (typeof type === 'string') return type.toLowerCase() === 'recipe';
  if (Array.isArray(type)) {
    return type.some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe');
  }
  return false;
}

/* Finds the Recipe object inside a payload of any of the shapes sites use.
 *
 * Publishers wrap it three common ways: the bare object, a top-level array of
 * objects, and an @graph array holding the page's whole entity set. Walking all
 * three costs a few lines and removes a whole class of "works on one blog, not
 * the next". */
function findRecipeNode(any) {
  if (Array.isArray(any)) {
    for (const element of any) {
      const found = findRecipeNode(element);
      if (found) return found;
    }
    return null;
  }
  if (!any || typeof any !== 'object') return null;
  if (isRecipeNode(any)) return any;
  if (any['@graph'] !== undefined) return findRecipeNode(any['@graph']);
  return null;
}

/* Parses one JSON-LD payload that has already been isolated.
 *
 * Separate from the HTML entry point so a caller holding JSON from an API — or
 * a test holding a fixture — does not have to wrap it in a fake page. */
function recipeFromJsonLdPayload(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return null;
  }
  const node = findRecipeNode(parsed);
  if (!node) return null;

  /* A recipe with no name is not one we can show in a list, and every real page
   * has one. Bailing here keeps a half-read blob from reaching the editor as an
   * untitled recipe. */
  const name = jsonLdText(node.name);
  if (!name) return null;

  return {
    name,
    ingredientLines: jsonLdStringList(
      node.recipeIngredient !== undefined ? node.recipeIngredient : node.ingredients
    ),
    steps: jsonLdSteps(node.recipeInstructions),
    servings: jsonLdServings(node.recipeYield),
    prepMinutes: jsonLdMinutes(node.prepTime),
    cookMinutes: jsonLdMinutes(node.cookTime),
    author: jsonLdAuthor(node.author),
    nutritionPerServing: jsonLdNutrition(node.nutrition),
    sourceTranscript: json,
  };
}

/* Every <script type="application/ld+json"> body on the page, in order.
 *
 * Matched loosely — a <script whose attributes mention the JSON-LD media type —
 * because attribute order and quoting vary and a strict match would miss pages
 * that are otherwise perfectly readable. */
function jsonLdBlocks(html) {
  const blocks = [];
  const text = String(html);
  let cursor = 0;

  for (;;) {
    const openStart = text.toLowerCase().indexOf('<script', cursor);
    if (openStart < 0) break;
    const openEnd = text.indexOf('>', openStart);
    if (openEnd < 0) break;
    const closeStart = text.toLowerCase().indexOf('</script', openEnd);
    if (closeStart < 0) break;

    const attributes = text.slice(openStart, openEnd).toLowerCase();
    if (attributes.includes('application/ld+json')) {
      const body = text.slice(openEnd + 1, closeStart).trim();
      if (body) blocks.push(body);
    }
    cursor = closeStart + 1;
  }
  return blocks;
}

/* Pulls the first schema.org Recipe out of a fetched HTML page.
 *
 * Returns null when the page publishes no JSON-LD, or publishes some that
 * contains no Recipe. Both are ordinary outcomes for a page that is not a
 * recipe, not errors worth surfacing. */
function recipeFromJsonLd(html) {
  for (const block of jsonLdBlocks(html)) {
    const found = recipeFromJsonLdPayload(block);
    if (found) return found;
  }
  return null;
}

/* Node can require this file for tests; the browser just gets the globals. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCaption,
    captionLines,
    recipeFromJsonLd,
    recipeFromJsonLdPayload,
  };
}
