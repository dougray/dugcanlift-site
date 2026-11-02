/* Road picks -- the items a coach is happy with at the places a client stops.
 *
 * LIFT has Road Food: a curated file of chains, items and gas-station snacks,
 * ranked against what is left of the client's day. A coach marking picks is
 * saying "these fit how I want you eating on the road" and nothing else -- no
 * calorie or macro claim, because LIFT already ranks on those and re-ranking
 * them from here would put a coach's tick in front of the client's own numbers.
 *
 * On the wire: `rf`, a flat list of item ids, omitted entirely when there are
 * none (PLAN-FORMAT.md "Road picks"). Item ids are the contract -- the Road
 * Food spec says they are stable for exactly this -- and they are all that
 * travels. A whole chain is not a thing on the wire: "Pick all" here ticks the
 * items the coach can see at the time they tick them, so a chain that gains an
 * item next quarter does not silently gain a pick nobody looked at.
 *
 * **Nothing is filtered against this app's own copy of the data on the way
 * out.** The coach's bundle and the client's are two builds of two apps,
 * updated at different times, so only the receiver can say what it has. It
 * skips an id it does not know, silently, and shows no broken row. That is why
 * a withdrawn item is safe to leave in a coach's stored picks.
 *
 * Tracked and shown, never targeted, like saturated fat and the imbalance
 * figure: a pick is shown as a pick, and nothing anywhere judges what a client
 * ate or did not eat against it.
 */
(function (global) {
  'use strict';

  /** The stored shape: strings, trimmed, no blanks, no duplicates, in the
   *  order the coach ticked them. Anything else in the array is dropped
   *  rather than failing -- a picks list is not worth losing a backup over. */
  function normalise(ids) {
    var seen = {};
    var out = [];
    (Array.isArray(ids) ? ids : []).forEach(function (raw) {
      if (typeof raw !== 'string') return;
      var id = raw.trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  /** The `rf` value for a payload, or null when there is nothing to send.
   *  Null means the key is left out; an empty array is never written. */
  function wire(ids) {
    var list = normalise(ids);
    return list.length ? list : null;
  }

  /** `rf` read back, leniently: a missing or junk key is no picks at all. */
  function fromWire(rf) {
    return normalise(rf);
  }

  /* ---------------- the bundled data ---------------- */

  /** Every item in the file, chain items and gas-station snacks alike, as
   *  { id, item, placeId, placeName }. Snacks belong to no chain, so their
   *  place is the gas station they are all found in. */
  function catalogue(data) {
    var out = [];
    ((data && data.chains) || []).forEach(function (chain) {
      (chain.items || []).forEach(function (item) {
        if (item && item.id) {
          out.push({ id: item.id, item: item, placeId: chain.id, placeName: chain.name });
        }
      });
    });
    ((data && data.snacks) || []).forEach(function (snack) {
      if (snack && snack.id) {
        out.push({ id: snack.id, item: snack, placeId: 'snacks', placeName: 'Gas station' });
      }
    });
    return out;
  }

  /** The same, keyed by id, for a lookup that runs per row. */
  function index(data) {
    var map = {};
    catalogue(data).forEach(function (entry) { map[entry.id] = entry; });
    return map;
  }

  /** Picked ids this copy of the data has no item for. They still travel:
   *  the client's app decides what it knows. Shown in Coach only so a coach
   *  is never puzzled by a count that does not match what is on screen. */
  function missing(ids, data) {
    var have = index(data);
    return normalise(ids).filter(function (id) { return !have[id]; });
  }

  /** How many of `items` are picked. */
  function countIn(ids, items) {
    var picked = {};
    normalise(ids).forEach(function (id) { picked[id] = true; });
    return (items || []).filter(function (i) { return i && picked[i.id]; }).length;
  }

  /** `ids` with `id` added at the end or taken out. The order picks were
   *  ticked in is kept: it is the only order a coach has authored. */
  function toggle(ids, id, on) {
    var list = normalise(ids);
    var without = list.filter(function (x) { return x !== id; });
    return on ? without.concat([String(id)]) : without;
  }

  /** `ids` with every id in `items` added, or every one of them removed. */
  function toggleAll(ids, items, on) {
    var these = (items || []).map(function (i) { return i && i.id; }).filter(Boolean);
    var list = normalise(ids);
    if (!on) {
      return list.filter(function (x) { return these.indexOf(x) === -1; });
    }
    return normalise(list.concat(these));
  }

  /**
   * What is picked, in words: "6 items at 3 places", "1 item at 1 place",
   * "" when there are none. Counts only what this copy of the data has, so
   * the sentence matches the ticks on screen; the wire still carries the rest.
   */
  function summary(ids, data) {
    var have = index(data);
    var places = {};
    var n = 0;
    normalise(ids).forEach(function (id) {
      var entry = have[id];
      if (!entry) return;
      n += 1;
      places[entry.placeId] = true;
    });
    if (!n) return '';
    var placeCount = Object.keys(places).length;
    return n + (n === 1 ? ' item at ' : ' items at ')
      + placeCount + (placeCount === 1 ? ' place' : ' places');
  }

  /* ---------------- how old a place's numbers are ---------------- */

  /*
   * A chain carries two dates, and Coach says both. `publishedOn` is the date
   * the chain's own document states about itself -- Burger King's chart says
   * "NOVEMBER 2022" -- and `checkedOn` is the day a person read it. A chain
   * whose document states no date has no `publishedOn`, and its card says only
   * when it was checked.
   *
   * Written the way a person writes a date, in the reader's own locale --
   * "Sep 20, 2026", and "Nov 2022" for a document that names only a month, so
   * no day is invented for the reader (LIFT web's `roadDocDate`, LIFT
   * Android's `publishedLabel`, Coach iPhone's `RoadFoodDates`). A value that
   * is not `YYYY-MM-DD` or `YYYY-MM` reads as no date and its clause is left
   * out; LIFT web prints "Invalid Date" there, which is its bug, not a shape
   * to copy.
   *
   * Coach does not warn. LIFT does, from the same field, and no Coach build
   * says anything about staleness: this line gains a clause in all three or
   * in none.
   */

  /** { year, month, day|null } for "YYYY-MM-DD" or "YYYY-MM", else null. */
  function parseDate(key) {
    if (typeof key !== 'string') return null;
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key.trim());
    if (!m) return null;
    var year = Number(m[1]);
    var month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    if (m[3] === undefined) return { year: year, month: month, day: null };
    var day = Number(m[3]);
    // Local calendar day, built with the local constructor: a day key is a
    // day, not an instant, and "2026-09-20" parsed as UTC is the 19th in
    // America. A day the month does not have (Feb 31) is not a date.
    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return { year: year, month: month, day: day };
  }

  function dateText(parts, locale) {
    if (parts.day === null) {
      return new Date(parts.year, parts.month - 1, 1)
        .toLocaleDateString(locale, { year: 'numeric', month: 'short' });
    }
    return new Date(parts.year, parts.month - 1, parts.day)
      .toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /** "Sep 20, 2026" for a `YYYY-MM-DD`, or null. The day someone read a
   *  chart is always a whole day, so a month alone is not one. */
  function dayText(key, locale) {
    var parts = parseDate(key);
    return parts && parts.day !== null ? dateText(parts, locale) : null;
  }

  /** A document's own date, no more precise than it was written: "Mar 29,
   *  2021" for a chart that gives a day, "Nov 2022" for one that names only a
   *  month. Null when it is neither shape. */
  function documentText(key, locale) {
    var parts = parseDate(key);
    return parts ? dateText(parts, locale) : null;
  }

  /** The line under a place's name: "Published Nov 2022 · checked Sep 20,
   *  2026", either clause alone, or '' when the chain has no readable date.
   *  `locale` is for the tests; the page passes nothing and gets the
   *  reader's. */
  function dateLine(chain, locale) {
    var published = documentText(chain && chain.publishedOn, locale);
    var checked = dayText(chain && chain.checkedOn, locale);
    if (published && checked) return 'Published ' + published + ' · checked ' + checked;
    if (published) return 'Published ' + published;
    if (checked) return 'Checked ' + checked;
    return '';
  }

  global.CoachRoadPicks = {
    normalise: normalise,
    wire: wire,
    fromWire: fromWire,
    catalogue: catalogue,
    index: index,
    missing: missing,
    countIn: countIn,
    toggle: toggle,
    toggleAll: toggleAll,
    summary: summary,
    dayText: dayText,
    documentText: documentText,
    dateLine: dateLine,
  };
})(typeof window !== 'undefined' ? window : globalThis);
