/* A recipe link: what the "Send to Coach" bookmarklet opens.
 *
 * The bookmarklet runs on a recipe page the coach already has open and
 * navigates here with the page's address and the raw text of its schema.org
 * JSON-LD blocks in the fragment -- the same two things Safari's share
 * extension hands Coach iPhone. Coach never requests the page. The source of
 * the bookmarklet, its four built forms (bookmarklets.json) and the reference
 * decoder this ports are dugcanlift-kit's bookmarklet/; its fixture pair is
 * fixtures/recipe-link.txt and recipe-link-expected.json, never regenerated
 * here.
 *
 *   https://www.dugcanlift.com/coach/#r1<base64url(deflate-raw(JSON))>
 *   JSON = {"v":1,"url":"<page address>","jsonld":["<block text>", ...]}
 *
 * `r1` cannot be mistaken for a log link: a log link's fragment opens with
 * its version number (`1z`, `1u`), a recipe link's with a letter.
 *
 * This only unwraps. The blocks go to recipe-import.js's
 * recipeFromJsonLdPayload, and the recipe form does the rest.
 *
 * Kept as its own script so node tests it (recipe-link.test.mjs), using node's
 * own DecompressionStream.
 */
(function (global) {
  'use strict';

  var PREFIX = 'r1';
  var MAX_BYTES = 512 * 1024;

  /* The fragment, by the reference decoder's rule: everything after the first
   * `#`, or the whole text when there is none. */
  function fragmentOf(text) {
    var hash = text.indexOf('#');
    return hash >= 0 ? text.slice(hash + 1) : text;
  }

  /** Whether the text is a recipe link at all -- the routing question, asked
   *  before any decoding, so a log link is never offered to this decoder and a
   *  recipe link is never offered to the log decoder. */
  function isRecipeLink(text) {
    return typeof text === 'string' && fragmentOf(text).startsWith(PREFIX);
  }

  function base64urlBytes(data) {
    var b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    var padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    var binary = atob(padded);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /* Inflates, refusing (null) once the output passes MAX_BYTES rather than
   * holding all of it first. Throws on bad deflate; the caller refuses. */
  async function inflateCapped(bytes) {
    var stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    var reader = stream.getReader();
    var chunks = [];
    var total = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > MAX_BYTES) {
        reader.cancel().catch(function () {});
        return null;
      }
      chunks.push(step.value);
    }
    var joined = new Uint8Array(total);
    var at = 0;
    chunks.forEach(function (c) { joined.set(c, at); at += c.byteLength; });
    return new TextDecoder('utf-8').decode(joined);
  }

  /**
   * {url, jsonld} out of a recipe link, or null.
   *
   * Refuses rather than guessing, exactly where recipe-link.mjs does: no `r1`
   * prefix, bad base64url, bad deflate, more than MAX_BYTES once inflated,
   * JSON that is not {v: 1, url: http(s) string, jsonld: [...]}, or no string
   * blocks. A non-string block is dropped, not fatal.
   */
  async function decodeRecipeLink(text) {
    if (typeof text !== 'string') return null;
    var fragment = fragmentOf(text);
    if (!fragment.startsWith(PREFIX)) return null;
    var data = fragment.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(data)) return null;

    var json;
    try {
      json = await inflateCapped(base64urlBytes(data));
    } catch (e) {
      return null;
    }
    if (json === null) return null;

    var doc;
    try {
      doc = JSON.parse(json);
    } catch (e) {
      return null;
    }
    if (!doc || doc.v !== 1 || typeof doc.url !== 'string' || !Array.isArray(doc.jsonld)) return null;
    if (!/^https?:\/\//i.test(doc.url)) return null;
    var jsonld = doc.jsonld.filter(function (b) { return typeof b === 'string'; });
    if (!jsonld.length) return null;
    return { url: doc.url, jsonld: jsonld };
  }

  /**
   * The first block the reader finds a recipe in, with the page address it
   * came from, or null when none of them holds one. `read` is
   * recipe-import.js's recipeFromJsonLdPayload, passed in so this file stays
   * loadable on its own.
   */
  function recipeFrom(decoded, read) {
    if (!decoded) return null;
    for (var i = 0; i < decoded.jsonld.length; i++) {
      var found = read(decoded.jsonld[i]);
      if (found) return { recipe: found, url: decoded.url };
    }
    return null;
  }

  var SITE_FIGURES_NOTE = "Macros are the site's own figures, per serving.";

  /**
   * What the recipe form is filled with, and what Save adds to it.
   *
   * Servings are the page's own yield, or null when it stated none -- never a
   * guess, because every macro is divided by it. The page's nutrition is kept
   * as it was published, per serving, and marked an estimate, as Coach
   * iPhone's LinkImportMacros does: it was not resolved line by line here.
   * The source fields are BACKUP-FORMAT's spellings; the transcript is the
   * block as the page published it, with the iPhone's note under it when the
   * macros are the site's.
   */
  function formFill(found) {
    var r = found.recipe;
    var nutrition = r.nutritionPerServing ? Object.assign({}, r.nutritionPerServing) : null;
    if (nutrition) nutrition.estimated = true;
    var transcript = r.sourceTranscript || '';
    if (nutrition) transcript = transcript ? transcript + '\n\n' + SITE_FIGURES_NOTE : SITE_FIGURES_NOTE;
    return {
      name: r.name,
      servings: r.servings,
      ingredientLines: r.ingredientLines.slice(),
      steps: r.steps.slice(),
      nutritionPerServing: nutrition,
      source: {
        sourceUrl: found.url,
        sourceAuthor: r.author || null,
        sourceTranscript: transcript || null,
        prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes,
      },
    };
  }

  global.CoachRecipeLink = {
    PREFIX: PREFIX,
    MAX_BYTES: MAX_BYTES,
    SITE_FIGURES_NOTE: SITE_FIGURES_NOTE,
    isRecipeLink: isRecipeLink,
    decodeRecipeLink: decodeRecipeLink,
    recipeFrom: recipeFrom,
    formFill: formFill,
  };
})(typeof window !== 'undefined' ? window : globalThis);
