/* Reading an r1 recipe link: what the "Send to LIFT" bookmarklet opens.
 *
 * A port of dugcanlift-kit's bookmarklet/recipe-link.mjs, the reference
 * decoder every build ports, with the same refusals. Only the inflate differs:
 * node's inflateRawSync there, the browser's DecompressionStream here, capped
 * at the same MAX_BYTES while it streams.
 *
 *   <target>#r1<base64url(deflate-raw(JSON)), no padding>
 *   JSON = {"v":1,"url":"<page address>","jsonld":["<block text>", ...]}
 *
 * It only unwraps. What comes out is {url, jsonld} -- exactly what Safari's
 * share extension hands the iPhone apps -- and app.js passes the blocks to
 * recipeFromJsonLdPayload (recipe-import.js), the reader LIFT already has.
 *
 * Refuses, resolving null, rather than guessing: a missing or unknown prefix,
 * bad base64url, bad deflate, more than MAX_BYTES once inflated, JSON that is
 * not {v: 1, url: http(s) string, jsonld: [string, ...]}, or no blocks. A
 * non-string entry in jsonld is dropped, not fatal, as on the iPhone. Nothing
 * here requests anything: the page's address is carried, never opened.
 *
 * A classic script; node tests it through window.LiftRecipeLink, as
 * recipe-catalog.test.mjs reads recipe-catalog.js. */
(function (root) {
  'use strict';

  var PREFIX = 'r1';
  var MAX_BYTES = 512 * 1024;

  function fragmentOf(text) {
    var hash = text.indexOf('#');
    return hash >= 0 ? text.slice(hash + 1) : text;
  }

  /* Whether this text is an r1 link at all, before any decoding -- so the
   * page can tell a recipe link that will not read from a fragment that was
   * never one. */
  function isRecipeLink(text) {
    return typeof text === 'string' && fragmentOf(text).startsWith(PREFIX);
  }

  function base64urlBytes(data) {
    var padded = data.replace(/-/g, '+').replace(/_/g, '/');
    if (padded.length % 4) padded += '='.repeat(4 - (padded.length % 4));
    var binary = atob(padded);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /* Inflates, giving up as soon as the output passes MAX_BYTES rather than
   * holding all of it first. Resolves null when it does. */
  async function inflateCapped(bytes) {
    var reader = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
      .getReader();
    var chunks = [];
    var total = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      total += step.value.length;
      if (total > MAX_BYTES) {
        reader.cancel().catch(function () {});
        return null;
      }
      chunks.push(step.value);
    }
    var joined = new Uint8Array(total);
    var at = 0;
    chunks.forEach(function (c) { joined.set(c, at); at += c.length; });
    return new TextDecoder().decode(joined);
  }

  async function decode(text) {
    if (typeof text !== 'string') return null;
    var fragment = fragmentOf(text);
    if (!fragment.startsWith(PREFIX)) return null;
    var data = fragment.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(data)) return null;
    if (typeof DecompressionStream === 'undefined') return null;

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

  root.LiftRecipeLink = { PREFIX: PREFIX, MAX_BYTES: MAX_BYTES, isRecipeLink: isRecipeLink, decode: decode };
})(typeof window !== 'undefined' ? window : globalThis);
