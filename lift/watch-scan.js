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

  // Thrown by decodePayload, above the try that would otherwise swallow it --
  // see the comment there.
  function browserTooOldError() {
    return new Error('This browser is too old to read watch codes. Safari 16.4, '
                    + 'Chrome 103 or anything newer will work.');
  }

  async function inflate(bytes) {
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

    // Checked here, above the try below, rather than inside inflate(): the
    // sibling decoder this mirrors, decodeIncomingPlan in app.js, does not
    // wrap its own version of this check in a try, so its message reaches
    // the user. Thrown from inside that try, this specific, actionable
    // message ("Safari 16.4, Chrome 103...") got replaced by the generic
    // "That code isn't a LIFT watch export." -- true, but useless to someone
    // whose browser can never read any code until they update it.
    if (match[2] === 'z' && typeof DecompressionStream === 'undefined') {
      throw browserTooOldError();
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

    // Every `fd` row is [name, calories, proteinG, fatG, carbsG, fiberG]: a
    // string followed by five finite numbers.
    const rowIsValid = (row) => Array.isArray(row) && row.length === 6
      && typeof row[0] === 'string'
      && row.slice(1).every((n) => typeof n === 'number' && Number.isFinite(n));

    // Every entry must point at a real row of the food dictionary, and its
    // own fields must be usable: grams a non-negative finite number, meal an
    // integer in range of the meal list, loggedAt a finite timestamp.
    // Checking here, at the edge, rather than skipping or coercing bad rows
    // later: a dropped row is a meal missing from someone's day with
    // nothing to tell them, and a sequence would still have reported itself
    // complete. Coercing (e.g. defaulting an out-of-range meal to SNACK) is
    // just as bad the other direction -- it creates a record with no
    // reliable date/meal that no date navigation can reach and the user can
    // never delete, yet it still rides along in every backup and coach
    // export.
    const entryIsValid = (tuple) => Array.isArray(tuple)
      && Number.isInteger(tuple[0]) && tuple[0] >= 0 && tuple[0] < payload.fd.length
      && typeof tuple[1] === 'number' && Number.isFinite(tuple[1]) && tuple[1] >= 0
      && Number.isInteger(tuple[2]) && tuple[2] >= 0 && tuple[2] < MEALS.length
      && typeof tuple[3] === 'number' && Number.isFinite(tuple[3]);

    // `p`, when present, is [position, declaredTotal]. createSequence.complete
    // scans positions 1..total, so a malformed position such as [0, 1] can
    // never be satisfied: the status would read "Scanned 1 of 1" forever,
    // with Import permanently disabled and only Cancel escaping the panel.
    // Both elements must be integers, and position must fall within
    // 1..declaredTotal.
    const pIsValid = !('p' in payload) || (Array.isArray(payload.p) && payload.p.length === 2
      && Number.isInteger(payload.p[0]) && Number.isInteger(payload.p[1])
      && payload.p[0] >= 1 && payload.p[0] <= payload.p[1]);

    if (!payload.fd.every(rowIsValid) || !payload.e.every(entryIsValid) || !pIsValid) {
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
        } else if (declared !== total) {
          // `z` alone is not a strong enough guard: two unrelated exports
          // sharing the same export timestamp would otherwise pass the
          // check above and merge into one "complete" set, silently
          // combining two different logs. The declared total has to agree
          // too, matching the same "different export" message -- from the
          // user's side this is exactly that mistake.
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
          // `z` plus this code's position plus the entry's index within it
          // is what toFoodRecords uses to build a deterministic id. The
          // position is part of it because the index alone restarts at 0 in
          // every code -- see the comment there.
          payload.e.forEach((tuple, indexInCode) => {
            const food = payload.fd[tuple[0]];
            if (!food) return;
            out.push({
              name: food[0],
              per100g: {
                calories: food[1], proteinG: food[2], fatG: food[3],
                carbsG: food[4], fiberG: food[5],
              },
              grams: tuple[1],
              // No `|| 'SNACK'` fallback: decodePayload now validates
              // tuple[2] is an in-range meal index before this ever runs, so
              // silently refiling an out-of-range meal is no longer
              // possible to reach -- it would have masked exactly the kind
              // of damaged entry decodePayload now rejects outright.
              meal: MEALS[tuple[2]],
              loggedAt: tuple[3],
              z: exportedAt,
              position,
              indexInCode,
            });
          });
        });
        return out.sort((a, b) => a.loggedAt - b.loggedAt);
      },
    };
  }

  /* Scanned entries into records the Food tab already understands.
   *
   * `dateKey` is injected rather than read off the global so this is
   * testable outside a browser. Pass app.js's own — the date key must stay
   * local, matching every other entry in the store. */
  function toFoodRecords(entries, deps) {
    return entries.map((entry) => ({
      // Deterministic, not deps.uid(): the watch only clears its on-screen
      // log on a manual tap, so the same codes are still there to be
      // rescanned -- by an accidental double-scan, or because a prior
      // import looked like it failed (see the browser-too-old bug this same
      // review found). A random id would import the whole day again every
      // time, silently doubling it. `z` (the export timestamp) plus the
      // entry's address within it -- which code, and where in that code --
      // is stable across rescans and unique within one export, so importing
      // the same code twice produces the same id both times and the caller
      // (app.js's addFoodEntries) can skip anything already in the store.
      //
      // The code's position is part of the address on purpose. `indexInCode`
      // restarts at 0 in every code of a multi-code export, so two different
      // foods logged in the same second in different codes would otherwise
      // collide on one id -- and since app.js deletes by matching the first
      // record with that id, tapping the × on one of them would remove the
      // other.
      id: `watch-${entry.z}-${entry.position}-${entry.loggedAt}-${entry.indexInCode}`,
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
      //
      // All five are rounded, as every other write path into this store does
      // (app.js:714 parseInt, app.js:821 and app.js:2035 Math.round). The
      // Food tab is shielded either way because it reads through mul(), which
      // rounds the product -- but the itemised coach export reads these
      // fields raw (app.js:1300), so an unrounded value would show a coach
      // "31.02 g protein" where every other entry shows a whole number.
      servings: Number((entry.grams / 100).toFixed(2)),
      calories: Math.round(entry.per100g.calories),
      proteinG: Math.round(entry.per100g.proteinG),
      fatG: Math.round(entry.per100g.fatG),
      carbsG: Math.round(entry.per100g.carbsG),
      fiberG: Math.round(entry.per100g.fiberG),
      // The day the food was eaten, not the day it was scanned — a user
      // scanning Monday's log on Wednesday must not see it land on Wednesday.
      date: deps.dateKey(new Date(entry.loggedAt * 1000)),
      loggedAt: entry.loggedAt * 1000,
      meal: entry.meal,
      fromWatch: true,
    }));
  }

  /* ---- camera ---- */

  function mount() {
    const $ = (id) => window.document.getElementById(id);
    const open = $('watch-scan-open');
    if (!open) return;   // not on a page that has the card

    const panel = $('watch-scan');
    const video = $('watch-scan-video');
    const status = $('watch-scan-status');
    const importButton = $('watch-scan-import');

    let stream = null;
    let frame = null;
    let sequence = null;

    const say = (text) => { status.textContent = text; };

    function stop() {
      if (frame) { cancelAnimationFrame(frame); frame = null; }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      // Every path that stops the camera -- Cancel, a completed scan, the
      // tab going hidden, or a fresh tap guarding against an orphaned prior
      // session -- must also let the user tap "Scan from watch" again.
      open.disabled = false;
    }

    function close() {
      stop();
      panel.classList.add('hidden');
      sequence = null;
      importButton.disabled = true;
    }

    // requestAnimationFrame pauses on its own when the tab is backgrounded,
    // but the MediaStream does not -- the camera light stays on until the
    // user comes back and finds Cancel. That is a privacy failure, so stop
    // the stream itself, not just the read loop.
    //
    // On return, this deliberately does NOT re-acquire the camera on its
    // own: silently turning the camera back on the moment a hidden tab
    // becomes visible again is the same surprise this exists to prevent,
    // and re-running getUserMedia here would need to redo all of the
    // open.onclick error handling anyway (permission revoked while away,
    // camera claimed by another app) for a path the user never asked to
    // start. Telling them to tap "Scan from watch" again reuses that
    // already-correct handler and only turns the camera on when a fresh tap
    // asks for it.
    function onHidden() {
      if (!stream) return;   // no camera running, nothing to pause
      stop();
      say('Camera paused because the tab was hidden. Tap "Scan from watch" to resume.');
    }

    window.document.addEventListener('visibilitychange', () => {
      if (window.document.visibilityState === 'hidden') onHidden();
    });
    // Belt and suspenders for the case a tab is discarded/closed without a
    // visibilitychange first (some mobile browsers do this on swipe-away).
    window.addEventListener('pagehide', () => { if (stream) stop(); });

    function tick(canvas, context) {
      frame = requestAnimationFrame(() => tick(canvas, context));
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

      // Assigning canvas.width/height clears the backing store even when
      // the value is unchanged, so only touch them when the video's
      // dimensions actually differ from the canvas's current ones.
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(image.data, image.width, image.height);
      if (!found) return;

      window.WatchScan.decodePayload(found.data).then((payload) => {
        // A decode can still be in flight when Import is tapped: close()
        // nulls `sequence`, but this .then was already scheduled and
        // assumed sequence was non-null, writing "Cannot read properties of
        // null (reading 'add')" straight into the status. The scan is over
        // by the time this settles either way, so there is nothing useful
        // left to do with the result.
        if (!sequence) return;
        try {
          sequence.add(payload);
        } catch (e) {
          say(e.message);
          return;
        }
        if (sequence.complete) {
          stop();
          say(`Ready to import ${sequence.entries.length} item(s).`);
          importButton.disabled = false;
        } else {
          say(`Scanned ${sequence.scanned} of ${sequence.total}. Swipe to the next code.`);
        }
      }).catch((e) => say(e.message));
    }

    open.onclick = async () => {
      // Belt and suspenders against a second tap orphaning the first
      // session's MediaStream: stop() releases any stream/loop already
      // running, and disabling the button (cleared by stop(), including on
      // every early return below) keeps a second tap from reaching this
      // handler at all while one is in flight.
      stop();
      open.disabled = true;
      panel.classList.remove('hidden');
      // Keep any sequence still in progress. Backgrounding the tab stops the
      // camera but does not end the scan, and a long export is several codes:
      // starting fresh here would silently throw away the codes already
      // scanned, so the user would rescan code 1, see "1 of 2" again, and
      // never reach the end. `close()` is what ends a scan, and it nulls
      // this.
      const resuming = sequence !== null && !sequence.complete;
      if (!resuming) sequence = window.WatchScan.createSequence();
      importButton.disabled = !(sequence.complete);
      say(resuming
        ? `Resuming — ${sequence.scanned} of ${sequence.total} scanned.`
        : 'Starting the camera…');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        say('This browser cannot use the camera. Safari on iOS or Chrome will work.');
        open.disabled = false;
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        video.srcObject = stream;
        await video.play();
      } catch (e) {
        // Covers both getUserMedia rejecting (denied/no camera) and
        // video.play() rejecting (autoplay policy, element torn down
        // mid-await). Either way, an already-acquired stream must not be
        // left running with nothing watching it.
        if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
        open.disabled = false;
        say(e && e.name === 'NotAllowedError'
          ? 'Camera access was refused. Allow it in your browser settings, then try again.'
          : 'No camera available on this device.');
        return;
      }

      say('Point the camera at your watch.');
      const canvas = window.document.createElement('canvas');
      tick(canvas, canvas.getContext('2d', { willReadFrequently: true }));
    };

    importButton.onclick = () => {
      const records = window.WatchScan.toFoodRecords(sequence.entries, {
        dateKey: window.dateKey,
      });
      // Goes through app.js's addFoodEntries rather than touching
      // window.food/save/render directly: window.food is a snapshot taken
      // once at load time, and app.js can rebind that `let` (e.g. deleting a
      // row) without window.food ever finding out. Pushing into that stale
      // array and saving it over storage is how a deletion, an import, and
      // whatever was logged in between all got silently destroyed together.
      const { imported, skipped } = window.addFoodEntries(records);
      close();

      const skippedNote = skipped > 0
        ? ` Skipped ${skipped} already on this device.` : '';

      if (imported.length === 0) {
        window.alert(`Imported 0 item(s) from your watch.${skippedNote}`);
        return;
      }

      // Previous/Next is the only date navigation, one day per tap, and the
      // watch retains its most recent 200 entries with no age limit --
      // without this, a successful import could land the user an unbounded
      // number of taps away from anything showing on the Food tab.
      // Jump to the earliest imported day and name the range so the alert
      // itself explains where things went.
      const dates = imported.map((r) => r.date).sort();
      const earliest = dates[0];
      const latest = dates[dates.length - 1];
      const rangeNote = earliest === latest ? ` on ${earliest}` : ` from ${earliest} to ${latest}`;
      window.goToFoodDate(earliest);
      window.alert(`Imported ${imported.length} item(s) from your watch${rangeNote}.${skippedNote}`);
    };

    $('watch-scan-cancel').onclick = close;
  }

  if (window.document.readyState === 'loading') {
    window.document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.WatchScan = { b64urlToBytes, decodePayload, createSequence, toFoodRecords, MEALS };
}(window));
