/* The bundled recipe catalogue: browse it, search it, copy one recipe into the
 * library.
 *
 * A port of Coach iPhone's RecipeCatalogView and LiftReference's
 * CatalogRecipe / CatalogEntry / ReferenceDatabase.searchRecipes. The iPhones
 * read the 622 recipes out of recipes.db; this build cannot open SQLite, so it
 * reads `recipes.json`, which the kit's Tools/export_recipes_json.py derives
 * from that same database. The file is a verbatim copy, pinned by
 * `recipes.sha256` (recipe-catalogue.test.mjs) -- never edited here.
 *
 * Nothing is costed here. The catalogue's own build already applied the
 * weight-only rules, so a recipe's macros and its coverage note are both
 * decided; re-running parser.js's arithmetic would reach the same answer.
 *
 * **A null `servings` means the source stated no yield.** Those rows carry
 * whole-dish totals (`*Total`), never per-serving figures, and the coach
 * picks a serving count on add -- 4 unless they change it. Per serving is the
 * total divided by that count, at that point and nowhere earlier. A recipe
 * with a stated yield carries `*PerServing` figures, which are used as they
 * are: rescaling a number the publisher measured would be inventing a second
 * opinion about it.
 *
 * **Attribution does not travel on the plan wire.** PLAN-FORMAT's inline
 * recipe is name, servings, macros, ingredients and steps; there is no field
 * for a credit, and the format is a contract with three other clients rather
 * than something to extend from here. A CC BY-SA recipe sent to a client
 * therefore arrives uncredited, which that licence asks for on redistribution.
 * Adding a recipe to the library keeps its credit (`sourceAuthor`,
 * `sourceTranscript`, BACKUP-FORMAT's spellings); sending one onward is the
 * open question, and it needs a wire-format decision, not a patch here. That
 * is the iPhone's position, word for word.
 *
 * Its own file, with no DOM in it, so node tests it.
 */
(function (global) {
  'use strict';

  var SEARCH_LIMIT = 40;
  var DEFAULT_SERVINGS = 4;
  var MIN_SERVINGS = 1;
  var MAX_SERVINGS = 48;

  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };

  /** The file's recipes, or a thrown error when it is not a catalogue. Rows
   *  without an id or a name are dropped rather than drawn as blanks. */
  function fromFile(raw) {
    if (!raw || !Array.isArray(raw.recipes)) throw new Error('not a recipe catalogue');
    return raw.recipes.filter(function (r) {
      return r && typeof r.id === 'string' && typeof r.name === 'string';
    }).map(function (r) {
      return Object.assign({}, r, {
        ingredients: Array.isArray(r.ingredients) ? r.ingredients.filter(isText) : [],
        steps: Array.isArray(r.steps) ? r.steps.filter(isText) : [],
      });
    });
  }

  function isText(v) { return typeof v === 'string' && v.trim() !== ''; }

  /* ---------------- servings and macros ---------------- */

  /** True when the macros describe the whole dish because the source stated
   *  no yield. The coach supplies a serving count before adding it. */
  function needsServings(r) {
    return r.servings == null && num(r.caloriesTotal) != null;
  }

  /** Whether the detail asks how many it serves: whenever the source stated
   *  no yield, with macros or without. With whole-dish totals the count
   *  divides every macro; without, it still scales the shopping list. Never
   *  guessed, and the same rule on every build. */
  function showsServingsStepper(r) {
    return r.servings == null;
  }

  /** The serving count a stepper may hold: whole, 1 to 48, 4 when blank or
   *  unreadable -- the iPhone's Stepper(in: 1...48, step: 1). */
  function clampServings(value) {
    if (value == null || String(value).trim() === '') return DEFAULT_SERVINGS;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_SERVINGS;
    return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(n)));
  }

  /** The count a new library recipe is saved with: the stated yield when the
   *  source gave one, otherwise the coach's pick. */
  function servingsFor(r, picked) {
    var stated = num(r.servings);
    return stated != null && stated > 0 ? stated : clampServings(picked);
  }

  /**
   * Per serving at `count`, as { calories, proteinG, carbsG, fatG }, or null
   * when the recipe has no macros.
   *
   * Published per-serving figures ignore `count`. Whole-dish totals are
   * divided by it. A missing protein, carb or fat reads as 0 beside a known
   * calorie figure, the iPhone's `?? 0`; calories missing is no macros at all.
   */
  function nutrition(r, count) {
    var per = num(r.caloriesPerServing);
    if (per != null) {
      return {
        calories: per,
        proteinG: num(r.proteinPerServing) || 0,
        carbsG: num(r.carbsPerServing) || 0,
        fatG: num(r.fatPerServing) || 0,
      };
    }
    var total = num(r.caloriesTotal);
    if (total == null) return null;
    var c = Number(count);
    var divisor = isFinite(c) && c > 0 ? c : 1;
    return {
      calories: total / divisor,
      proteinG: (num(r.proteinTotal) || 0) / divisor,
      carbsG: (num(r.carbsTotal) || 0) / divisor,
      fatG: (num(r.fatTotal) || 0) / divisor,
    };
  }

  /* A whole number on screen is rounded half away from zero, never truncated:
   * Beef Pot Pie's 898.1 kcal over four servings is 224.525 and reads 225.
   * The same rule on every build. Display only -- a stored value is never
   * rounded (see libraryRecipe). */
  function roundHalfAway(v) {
    return v < 0 ? -Math.round(-v) : Math.round(v);
  }
  var whole = function (v) { return String(roundHalfAway(v)); };

  /** The list row's macro clause. Said in the list, not only the detail, so a
   *  browsing eye never reads a whole-pot figure as a portion. */
  function macroSummary(r) {
    var per = num(r.caloriesPerServing);
    if (per != null) return whole(per) + ' kcal per serving';
    if (needsServings(r)) return 'Macros for the whole dish';
    return 'No macros';
  }

  function rowLine(r) {
    return macroSummary(r) + ' · ' + r.ingredients.length + ' ingredients';
  }

  /** "690 kcal · P 32 · C 62 · F 34", or null when there are no macros. */
  function macroLine(facts) {
    if (!facts) return null;
    return whole(facts.calories) + ' kcal · P ' + whole(facts.proteinG)
      + ' · C ' + whole(facts.carbsG) + ' · F ' + whole(facts.fatG);
  }

  /* ---------------- browse and search ---------------- */

  /* SQLite's default BINARY collation, which `ORDER BY name` uses: code unit
   * order, not the locale's. */
  function byName(a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }

  /** The opening page, before anyone has typed: every recipe, by name, so the
   *  world recipes and the heritage books interleave rather than one trailing
   *  the other. All 622, the same list on every build. */
  function browse(recipes) {
    return recipes.slice().sort(byName);
  }

  /* FTS5's unicode61 tokenizer folds case and strips diacritics, and splits on
   * anything that is not a letter or a digit. */
  function words(text) {
    return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  /* The index is built with FTS5's porter tokenizer. This is not Porter: it
   * folds the plurals only, on both sides, which is the part of stemming a
   * search for "tomatoes" or "berry" actually leans on. */
  function stem(word) {
    if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (word.length > 4 && /(ch|sh|s|x|z|o)es$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && /[^s]s$/.test(word)) return word.slice(0, -1);
    return word;
  }

  function hits(term, list) {
    var stemmed = stem(term);
    return list.some(function (w) { return w.indexOf(term) === 0 || stem(w).indexOf(stemmed) === 0; });
  }

  /**
   * Every word of the query must open a word of the recipe's name, summary or
   * country -- the same columns the iPhone's recipes_fts indexes, matched by
   * prefix the way FTS5Pattern(matchingAllPrefixesIn:) builds its query.
   * Category is not indexed there, so it is not searched here either.
   *
   * Ranked as bm25 then name length is: more of the query in the name first,
   * then the shorter name, so a short exact-ish match beats a long one that
   * merely mentions the word. Fewer than two characters searches nothing.
   */
  function search(recipes, query, limit) {
    var trimmed = String(query || '').trim();
    if (trimmed.length < 2) return [];
    var terms = words(trimmed);
    if (!terms.length) return [];

    var found = [];
    recipes.forEach(function (r) {
      var name = words(r.name);
      var rest = words(r.summary).concat(words(r.country));
      var inName = 0;
      for (var i = 0; i < terms.length; i++) {
        if (hits(terms[i], name)) inName += 1;
        else if (!hits(terms[i], rest)) return;
      }
      found.push({ recipe: r, inName: inName });
    });

    found.sort(function (a, b) {
      return (b.inName - a.inName)
        || (a.recipe.name.length - b.recipe.name.length)
        || byName(a.recipe, b.recipe);
    });
    return found.slice(0, limit == null ? SEARCH_LIMIT : limit).map(function (f) { return f.recipe; });
  }

  /** Every distinct "attribution — license", sorted, for the Credits list.
   *  CC BY-SA requires the credit be given, so it sits on the screen that
   *  shows the data. */
  function credits(recipes) {
    var seen = {};
    recipes.forEach(function (r) { seen[r.attribution + ' — ' + r.license] = true; });
    return Object.keys(seen).sort();
  }

  /* ---------------- copying into the library ---------------- */

  /**
   * The library recipe an Add writes, without its id: the same body the
   * recipe form's Save builds, plus BACKUP-FORMAT's source fields.
   *
   * Ingredient lines go in as the raw text and are read by `parse` -- parser.js
   * parseIngredient, passed in so this file stays loadable on its own -- the
   * rule the paste flow and the backup reader follow: the line is the
   * contract, and reparsing is how every client agrees what it means.
   *
   * `estimated` carries over: a world recipe's macros are its publisher's and a
   * heritage recipe's were costed from whichever lines were written in a
   * weight; neither was resolved line by line for this copy. Attribution and
   * the coverage note travel with the copy, as the iPhone's makeRecipe writes
   * them: CC BY-SA requires the credit, and the note is what stops a short
   * macro figure being read as a whole one.
   */
  function libraryRecipe(r, picked, parse, now) {
    var servings = servingsFor(r, picked);
    var facts = nutrition(r, servings);
    // Stored as the raw quotient, never rounded: a whole dish over six is
    // 149.68333... kcal, and that is what the iPhone, LIFT web and both
    // Androids store, back up and send. Rounding here would make the same
    // recipe a different number on this build alone. Screens round.
    if (facts) facts.estimated = !!r.nutritionIsEstimated;
    var body = {
      name: r.name,
      servings: servings,
      ingredients: r.ingredients.map(function (line) { return parse(line); }),
      steps: r.steps.slice(),
      nutritionPerServing: facts,
      totalWeightGrams: null,
      sourceUrl: typeof r.sourceURL === 'string' ? r.sourceURL : null,
      sourceAuthor: r.attribution,
      sourceTranscript: [r.attribution, r.license, r.nutritionNote]
        .filter(function (v) { return typeof v === 'string' && v; }).join('\n'),
      prepMinutes: num(r.prepMinutes),
      cookMinutes: num(r.cookMinutes),
      importedAt: now == null ? Date.now() : now,
    };
    return body;
  }

  global.CoachRecipeCatalogue = {
    SEARCH_LIMIT: SEARCH_LIMIT,
    DEFAULT_SERVINGS: DEFAULT_SERVINGS,
    MIN_SERVINGS: MIN_SERVINGS,
    MAX_SERVINGS: MAX_SERVINGS,
    fromFile: fromFile,
    needsServings: needsServings,
    showsServingsStepper: showsServingsStepper,
    roundHalfAway: roundHalfAway,
    clampServings: clampServings,
    servingsFor: servingsFor,
    nutrition: nutrition,
    macroSummary: macroSummary,
    rowLine: rowLine,
    macroLine: macroLine,
    browse: browse,
    search: search,
    credits: credits,
    libraryRecipe: libraryRecipe,
  };
})(typeof window !== 'undefined' ? window : globalThis);
