/* Scanning a food log off an Apple Watch.
 *
 * The watch has no way to reach this browser — WatchConnectivity only ever
 * talks to a paired iPhone, and LIFT has no backend. So the watch draws the
 * log as a QR code and this reads it with the camera. Nothing is uploaded;
 * decoding happens entirely here, the same property share links have.
 *
 * The payload is documented in the Phase 2 design spec. It is deliberately
 * self-contained — food names and per-100g macros, never identifiers —
 * because this app's food data and LIFT iOS's share no ids.
 */

(function (window) {
  'use strict';

  const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

  function b64urlToBytes(s) {
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser is too old to read watch codes. Safari 16.4, '
                    + 'Chrome 103 or anything newer will work.');
    }
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  async function decodePayload(text) {
    // <formatVersion><codecChar><base64url>, the same envelope SHARE-FORMAT
    // and PLAN-FORMAT use -- and the same one decodeIncomingPlan parses in
    // app.js. `u` is the watch's fallback for when DEFLATE declines to help;
    // without the codec character those bytes would be undecodable here.
    const match = String(text || '').trim().match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
    if (!match) {
      throw new Error("That code isn't a LIFT watch export.");
    }
    if (Number(match[1]) !== 1) {
      throw new Error('That code came from a newer version of LIFT on the watch. '
                    + 'Update this app and try again.');
    }

    let payload;
    try {
      const bytes = b64urlToBytes(match[3]);
      const json = match[2] === 'z' ? await inflate(bytes)
                                    : new TextDecoder().decode(bytes);
      payload = JSON.parse(json);
    } catch (e) {
      throw new Error("That code isn't a LIFT watch export.");
    }

    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.e)
        || !Array.isArray(payload.fd)) {
      throw new Error("That code isn't a LIFT watch export.");
    }
    // Checked in the envelope too. Both are checked on purpose: the envelope
    // guards the codec, the payload guards the field shapes below it, and
    // SHARE-FORMAT carries the version in both places for the same reason.
    if (payload.v !== 1) {
      throw new Error('That code came from a newer version of LIFT on the watch. '
                    + 'Update this app and try again.');
    }
    return payload;
  }

  /* Holds codes until the whole numbered set has arrived. Importing half a
   * sequence would silently drop days, so a partial set is never usable. */
  function createSequence() {
    const byPosition = new Map();
    let exportedAt = null;
    let total = 1;

    return {
      add(payload) {
        const position = Array.isArray(payload.p) ? payload.p[0] : 1;
        const declared = Array.isArray(payload.p) ? payload.p[1] : 1;

        if (exportedAt === null) {
          exportedAt = payload.z;
          total = declared;
        } else if (payload.z !== exportedAt) {
          throw new Error('That code is from a different export. Start again, or '
                        + 'scan the rest of the first set.');
        }

        byPosition.set(position, payload);
      },
      get scanned() { return byPosition.size; },
      get total() { return total; },
      get complete() { return byPosition.size >= total; },
      /* Flattened, oldest first — the order a log reads in, regardless of
       * which code the user happened to point the camera at first. */
      get entries() {
        const out = [];
        Array.from(byPosition.keys()).sort((a, b) => a - b).forEach((position) => {
          const payload = byPosition.get(position);
          payload.e.forEach((tuple) => {
            const food = payload.fd[tuple[0]];
            if (!food) return;
            out.push({
              name: food[0],
              per100g: {
                calories: food[1], proteinG: food[2], fatG: food[3],
                carbsG: food[4], fiberG: food[5],
              },
              grams: tuple[1],
              meal: MEALS[tuple[2]] || 'SNACK',
              loggedAt: tuple[3],
            });
          });
        });
        return out.sort((a, b) => a.loggedAt - b.loggedAt);
      },
    };
  }

  window.WatchScan = { b64urlToBytes, decodePayload, createSequence, MEALS };
}(window));
