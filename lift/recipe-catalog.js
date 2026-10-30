/* The bundled recipe catalogue: "Browse the catalogue" on Cook.
 *
 * A port of LIFT iOS's RecipeCatalogView and the kit's CatalogRecipe /
 * CatalogEntry (dugcanlift-kit, Sources/LiftReference/RecipeCatalog.swift),
 * rule for rule. The iPhone reads recipes.db; this build cannot open SQLite,
 * so it reads recipes.json, the kit's export of the same rows, copied here
 * byte for byte and pinned by recipes.sha256 (recipe-catalog.test.mjs).
 *
 * Reference data, like a food or an exercise. Nothing here is in the library
 * until Add, and Add saves an ordinary recipe through app.js's own save path,
 * ingredient lines reparsed by parseIngredient: the line is the contract.
 *
 * Nothing is re-costed. A recipe whose source stated a yield carries the
 * publisher's (or the costing's) figure per serving, and that figure is used
 * as it is whatever the serving count -- rescaling it would be a second
 * opinion about a number somebody measured. A recipe whose source stated none
 * (`servings: null`, most of the public-domain books) carries whole-dish
 * totals instead; the person says how many it serves, 4 to start with, and
 * only then is anything divided. Never guessed.
 *
 * Every recipe carries its own `license` and `attribution` (CC BY-SA 4.0 or
 * public domain), and both are on screen wherever the recipe is. The credit is
 * the obligation, not decoration.
 *
 * Search stands in for the iPhone's SQLite FTS5 index over name, summary and
 * country: every word typed must start a word in one of them, diacritics and
 * case ignored, and results rank name matches first, then the shorter name --
 * the iPhone's bm25-then-name-length order, approximated. FTS5's porter
 * stemmer is not reproduced; prefix matching covers what it would mostly add.
 */
(function (root) {
  'use strict';

  /* The iPhone's stepper starts here for a recipe that states no yield. */
  var DEFAULT_SERVINGS = 4;
  var MIN_SERVINGS = 1;
  var MAX_SERVINGS = 48;
  /* searchRecipes(limit: 40). Browsing has no limit: with no search typed,
   * every recipe is listed, by name, as every build's catalogue lists it. */
  var SEARCH_LIMIT = 40;

  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
  var text = function (v) { return typeof v === 'string' && v.trim() ? v : null; };

  /* Reads recipes.json. Rows without an id or a name are dropped rather than
   * shown as blanks; everything else is kept as the file has it. */
  function parse(raw) {
    if (!raw || !Array.isArray(raw.recipes)) throw new Error('not a recipe catalog');
    return raw.recipes.filter(function (r) {
      return r && typeof r.id === 'string' && text(r.name);
    }).map(function (r) {
      return {
        id: r.id,
        name: r.name,
        summary: text(r.summary),
        country: text(r.country),
        category: text(r.category),
        servings: num(r.servings) > 0 ? r.servings : null,
        prepMinutes: num(r.prepMinutes),
        cookMinutes: num(r.cookMinutes),
        caloriesPerServing: num(r.caloriesPerServing),
        proteinPerServing: num(r.proteinPerServing),
        carbsPerServing: num(r.carbsPerServing),
        fatPerServing: num(r.fatPerServing),
        caloriesTotal: num(r.caloriesTotal),
        proteinTotal: num(r.proteinTotal),
        carbsTotal: num(r.carbsTotal),
        fatTotal: num(r.fatTotal),
        nutritionIsEstimated: r.nutritionIsEstimated === true,
        nutritionNote: text(r.nutritionNote),
        steps: Array.isArray(r.steps) ? r.steps.filter(text) : [],
        ingredients: Array.isArray(r.ingredients) ? r.ingredients.filter(text) : [],
        license: text(r.license) || '',
        attribution: text(r.attribution) || '',
        sourceURL: text(r.sourceURL),
      };
    });
  }

  /* The source stated no yield. The person supplies one on Add -- whether or
   * not the recipe has macros to divide, because a library recipe needs a
   * serving count and a silent 4 would be one nobody chose. This is what
   * decides whether the detail shows the servings stepper. */
  function statesNoYield(r) { return r.servings == null; }
  var showsServingsStepper = statesNoYield;

  /* A whole number for the screen: rounded half away from zero, never
   * truncated. Math.round alone rounds -2.5 to -2; no macro here is negative,
   * but the rule is written as every build writes it. Display only -- what is
   * stored is the raw figure. */
  function roundWhole(v) {
    return v < 0 ? -Math.round(-v) : Math.round(v);
  }

  /* "225 kcal · P 10 · C 18 · F 13", the detail's macro line. */
  function macroLine(n) {
    return roundWhole(n.calories) + ' kcal \u00b7 P ' + roundWhole(n.proteinG)
      + ' \u00b7 C ' + roundWhole(n.carbsG) + ' \u00b7 F ' + roundWhole(n.fatG);
  }

  /* The word a library card adds after its macros when they are an estimate:
   * LIFT iPhone's CookView row, word for word, in the accent. A recipe copied
   * from here is the usual way to have one (`estimated` on its
   * nutritionPerServing, BACKUP-FORMAT's spelling), but a backup from another
   * build can carry it too, so it is read off the nutrition, not the source.
   * Only a literal true counts: an absent or false flag shows nothing new. */
  var ESTIMATED_MARK = 'estimated';

  function estimatedMark(n) {
    return n && n.estimated === true ? ESTIMATED_MARK : null;
  }

  /* The browsing row's line under the name. */
  function rowMacros(r) {
    if (r.caloriesPerServing != null) return roundWhole(r.caloriesPerServing) + ' kcal per serving';
    return needsServings(r) ? 'Macros for the whole dish' : 'No macros';
  }

  /* CatalogRecipe.needsServings: the macros describe the whole dish. */
  function needsServings(r) { return r.servings == null && r.caloriesTotal != null; }

  /* CatalogRecipe.nutrition(servings:). Per serving at `count`: a published
   * per-serving figure ignores the count, a whole-dish total is divided by it.
   * Null when there are no macros at all -- never zeros. */
  function nutrition(r, count) {
    if (r.caloriesPerServing != null) {
      return {
        calories: r.caloriesPerServing,
        proteinG: r.proteinPerServing || 0,
        carbsG: r.carbsPerServing || 0,
        fatG: r.fatPerServing || 0,
      };
    }
    if (r.caloriesTotal == null) return null;
    var divisor = isFinite(count) && count > 0 ? count : 1;
    return {
      calories: r.caloriesTotal / divisor,
      proteinG: (r.proteinTotal || 0) / divisor,
      carbsG: (r.carbsTotal || 0) / divisor,
      fatG: (r.fatTotal || 0) / divisor,
    };
  }

  /* The serving count a copy is saved with: the stated yield, or the one the
   * person set, held to the stepper's range. */
  function servingsFor(r, chosen) {
    if (r.servings != null) return r.servings;
    var n = Math.round(Number(chosen));
    if (!isFinite(n)) n = DEFAULT_SERVINGS;
    return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
  }

  /* Everything the library recipe holds except its ingredients, which app.js
   * parses on the save path like every other recipe's. Field names are
   * BACKUP-FORMAT's, so the credit and the costing caveat travel in a backup:
   * CatalogEntry.makeRecipe carries the same three lines in sourceTranscript. */
  function libraryFields(r, chosenServings) {
    var servings = servingsFor(r, chosenServings);
    var n = nutrition(r, servings);
    var fields = {
      name: r.name,
      servings: servings,
      steps: r.steps.slice(),
      // fiberG 0 is how the recipe form writes an unknown fibre: it reads
      // back blank, and a catalogue recipe records none.
      nutritionPerServing: n ? {
        calories: n.calories, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG,
        fiberG: 0, estimated: r.nutritionIsEstimated,
      } : null,
      totalWeightGrams: null,
      sourceAuthor: r.attribution,
      sourceTranscript: [r.attribution, r.license, r.nutritionNote].filter(Boolean).join('\n'),
    };
    if (r.sourceURL) fields.sourceUrl = r.sourceURL;
    if (r.prepMinutes != null) fields.prepMinutes = r.prepMinutes;
    if (r.cookMinutes != null) fields.cookMinutes = r.cookMinutes;
    return fields;
  }

  /* Lowercased, diacritics off (FTS5 unicode61's default), split on anything
   * that is not a letter or a digit. */
  function words(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  /* SQLite's ORDER BY name: by code unit, not by locale. */
  function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }

  /* Before anything is typed: every recipe, by name, so the two collections
   * interleave rather than one reading as an afterthought. */
  function browse(list) {
    return list.slice().sort(byName);
  }

  /* Fewer than two characters is no query (searchRecipes' guard). */
  function isQuery(query) { return String(query || '').trim().length >= 2; }

  function search(list, query, limit) {
    if (!isQuery(query)) return [];
    var terms = words(query);
    if (!terms.length) return [];
    var starts = function (tokens, term) {
      return tokens.some(function (t) { return t.indexOf(term) === 0; });
    };
    var hits = [];
    list.forEach(function (r) {
      var name = words(r.name);
      var rest = words(r.summary).concat(words(r.country));
      var inName = 0;
      for (var i = 0; i < terms.length; i++) {
        if (starts(name, terms[i])) inName++;
        else if (!starts(rest, terms[i])) return;
      }
      hits.push({ r: r, inName: inName });
    });
    hits.sort(function (a, b) {
      return (b.inName - a.inName) || (a.r.name.length - b.r.name.length) || byName(a.r, b.r);
    });
    return hits.slice(0, limit || SEARCH_LIMIT).map(function (h) { return h.r; });
  }

  /* recipeAttributions(): every distinct "attribution — license", sorted. */
  function credits(list) {
    var seen = {};
    list.forEach(function (r) { seen[r.attribution + ' — ' + r.license] = true; });
    return Object.keys(seen).sort();
  }

  root.LiftRecipeCatalog = {
    DEFAULT_SERVINGS: DEFAULT_SERVINGS,
    MIN_SERVINGS: MIN_SERVINGS,
    MAX_SERVINGS: MAX_SERVINGS,
    parse: parse,
    statesNoYield: statesNoYield,
    showsServingsStepper: showsServingsStepper,
    roundWhole: roundWhole,
    macroLine: macroLine,
    ESTIMATED_MARK: ESTIMATED_MARK,
    estimatedMark: estimatedMark,
    rowMacros: rowMacros,
    needsServings: needsServings,
    nutrition: nutrition,
    servingsFor: servingsFor,
    libraryFields: libraryFields,
    browse: browse,
    isQuery: isQuery,
    search: search,
    credits: credits,
  };
})(typeof window !== 'undefined' ? window : globalThis);
