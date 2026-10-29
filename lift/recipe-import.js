/* Reading a recipe out of pasted prose: "Paste a recipe" on Cook.
 *
 * A copy of the caption half of Coach web's coach/recipe-import.js, and Coach
 * web's copy is the reference. Everything from "Caption reading" down to
 * captionLines is that file's text, unchanged, so the two web apps give the
 * same answer for the same text -- change it there first and copy it here, or
 * in neither. The same rules are LiftCore's CaptionRecipe (iOS) and
 * CaptionRecipe in LIFT for Android.
 *
 * Coach's other half, recipeFromJsonLd, is not here. It read schema.org JSON-LD
 * out of a fetched page, and nothing in LIFT fetches a page: the in-house rule
 * is that no request leaves for anything but this site. A recipe website's
 * text can still be pasted.
 *
 * parseCaption only ever PROPOSES a split. It fills the ordinary recipe form,
 * which the person edits and saves -- an editor, not a review, and that is the
 * whole safety argument. A wrong split costs an edit and never a number,
 * because parseIngredient (app.js) still reads the quantities on save, from
 * the text finally approved. The rules that keep the proposal honest are
 * pinned by recipe-import.test.mjs, ported case for case from Coach web's
 * recipe-import-test.html: the name is the first line or none, and a yield is
 * a line that OPENS with a yield word and carries a number, or none.
 *
 * A classic script, loaded before app.js: its functions are globals there, and
 * node reads them through module.exports at the foot of the file.
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

/* Node can require this file for tests; the browser just gets the globals. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCaption,
    captionLines,
  };
}
