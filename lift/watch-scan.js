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

    // Every entry must point at a real row of the food dictionary. Checking
    // here, at the edge, rather than skipping bad rows later: a dropped row
    // is a meal missing from someone's day with nothing to tell them, and a
    // sequence would still have reported itself complete.
    const strayIndex = payload.e.some((tuple) => !Array.isArray(tuple)
      || !Number.isInteger(tuple[0])
      || tuple[0] < 0
      || tuple[0] >= payload.fd.length);
    if (strayIndex) {
      throw new Error("That code is damaged — some of its entries don't line up "
                    + 'with the foods it lists. Show the code again and rescan it.');
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

        // Two different codes claiming the same slot means one of them was
        // misread. Last-write-wins would swap a code the user did scan for
        // one they did not, and the count would still say the set was
        // complete -- so say so instead of quietly picking one.
        const seen = byPosition.get(position);
        if (seen && JSON.stringify(seen) !== JSON.stringify(payload)) {
          throw new Error(`Two different codes both say they are number ${position}. `
                        + 'Start again and rescan the set.');
        }

        byPosition.set(position, payload);
      },
      get scanned() { return byPosition.size; },
      get total() { return total; },
      /* Every position from 1 to `total`, not merely `total` codes: a count
       * can be satisfied by a stray out-of-range position while a real one is
       * still missing, and importing that set would drop a whole code's worth
       * of the user's log. */
      get complete() {
        for (let position = 1; position <= total; position += 1) {
          if (!byPosition.has(position)) return false;
        }
        return true;
      },
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

  /* Scanned entries into records the Food tab already understands.
   *
   * `dateKey` and `uid` are injected rather than read off the global so this
   * is testable outside a browser. Pass app.js's own — the date key must stay
   * local, matching every other entry in the store. */
  function toFoodRecords(entries, deps) {
    return entries.map((entry) => ({
      id: deps.uid(),
      name: entry.name,
      // `servings` is grams/100, and macros stay PER SERVING — i.e. exactly
      // the per-100g figures, passed through unscaled.
      //
      // Do NOT pre-multiply them by grams. This store's invariant is that
      // `mul(e, field) = e[field] * e.servings` (app.js:131), applied by both
      // totals() and the per-row display, and logPlannedMeal states it
      // outright: "Food entries store macros per serving and multiply by
      // servings, so the per-serving snapshot passes through unscaled."
      // Scaling here as well double-scales: a 50g portion of a 297 kcal/100g
      // food would read 75 kcal instead of 149, and a 200g portion would
      // read double. It is wrong in both directions, which is what makes it
      // hard to notice.
      servings: Number((entry.grams / 100).toFixed(2)),
      calories: Math.round(entry.per100g.calories),
      proteinG: entry.per100g.proteinG,
      fatG: entry.per100g.fatG,
      carbsG: entry.per100g.carbsG,
      fiberG: entry.per100g.fiberG,
      // The day the food was eaten, not the day it was scanned — a user
      // scanning Monday's log on Wednesday must not see it land on Wednesday.
      date: deps.dateKey(new Date(entry.loggedAt * 1000)),
      loggedAt: entry.loggedAt * 1000,
      meal: entry.meal,
      fromWatch: true,
    }));
  }

  window.WatchScan = { b64urlToBytes, decodePayload, createSequence, toFoodRecords, MEALS };
}(window));
