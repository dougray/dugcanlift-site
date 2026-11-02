/* The dates under a client chart.
 *
 * Every chart on the client page used to draw its line with nothing beneath
 * it, so a coach could see a trend and not when it happened. Coach iPhone
 * plots dates and lets the system choose a few ticks ("Sep 27 · Oct 11 ·
 * Oct 25"); this is the same thing for a canvas, which chooses nothing on its
 * own.
 *
 * **A label sits under its own point.** The charts here place points by
 * position, one step per day key, so a tick is an index into those keys and
 * reads that key's date. Evenly spaced positions are therefore what is drawn,
 * and where the keys are not evenly spaced in time -- a lift trained on
 * irregular days -- the dates say so rather than a scale pretending otherwise.
 *
 * **Day keys are local calendar days.** A date is built with the local
 * constructor, `new Date(y, m - 1, d)`, never by parsing "YYYY-MM-DD" (which
 * reads as UTC midnight and is the day before west of Greenwich) and never by
 * adding milliseconds across days. A key that is not a real `YYYY-MM-DD` gets
 * no label at all.
 *
 * **The locale is the reader's**, `toLocaleDateString(undefined, ...)`, as
 * every other date on this page is. The year is added only when the keys
 * cross one, so a chart of the last four weeks says "Oct 4", not "Oct 4,
 * 2026".
 *
 * **Labels never collide.** The first is drawn from the left edge, the last
 * to the right edge and the rest centered on their point; fewer are chosen
 * until every label, measured, has room. At phone width that is usually
 * three, and on a wide card four.
 *
 * Display only: nothing here reaches storage, a statistic or the wire.
 */
(function (global) {
  'use strict';

  var MAX_TICKS = 4;
  var GAP = 12;

  /** A local Date for a "YYYY-MM-DD" key, or null when it is not one. */
  function dateOf(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof key === 'string' ? key : '');
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var date = new Date(y, mo - 1, d);
    // Rejects 2026-02-31 and friends, which the constructor rolls forward.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date;
  }

  /** "Oct 4", in the reader's locale; with the year when `withYear`. */
  function label(key, options) {
    var date = dateOf(key);
    if (!date) return null;
    var opts = options || {};
    var style = { month: 'short', day: 'numeric' };
    if (opts.withYear) style.year = 'numeric';
    return date.toLocaleDateString(opts.locale, style);
  }

  /** True when the valid keys fall in more than one calendar year. */
  function crossesYear(keys) {
    var years = {};
    (keys || []).forEach(function (k) {
      var d = dateOf(k);
      if (d) years[d.getFullYear()] = true;
    });
    return Object.keys(years).length > 1;
  }

  /** `count` indices spread evenly from the first key to the last. */
  function spread(n, count) {
    if (n <= 0 || count <= 0) return [];
    if (count === 1 || n === 1) return [0];
    var out = [];
    for (var i = 0; i < count; i += 1) {
      var index = Math.round((i * (n - 1)) / (count - 1));
      if (out.indexOf(index) === -1) out.push(index);
    }
    return out;
  }

  /** A rough width for a label when no canvas is at hand: 11 px type. */
  function estimate(text) {
    return String(text).length * 6.5;
  }

  /**
   * The date labels for a chart whose points sit at `width * i / (n - 1)`.
   *
   *   keys     the day keys the chart plots, one per point, in order
   *   width    the chart's width in CSS pixels
   *   options  { locale, measure(text) -> px, max }
   *
   * Returns [{ index, key, text, x, align }], align being 'left', 'center' or
   * 'right' -- canvas `textAlign` values -- and x where that edge or centre
   * goes. Empty when there is nothing to label or no room for even one.
   */
  function ticks(keys, width, options) {
    var opts = options || {};
    var list = Array.isArray(keys) ? keys : [];
    var n = list.length;
    if (!n || !(width > 0)) return [];
    var measure = typeof opts.measure === 'function' ? opts.measure : estimate;
    var withYear = crossesYear(list);
    var max = Math.max(1, Math.min(opts.max || MAX_TICKS, n));
    var xOf = function (i) { return n > 1 ? (width * i) / (n - 1) : 0; };

    for (var count = max; count >= 1; count -= 1) {
      var chosen = [];
      spread(n, count).forEach(function (index) {
        var text = label(list[index], { locale: opts.locale, withYear: withYear });
        if (text) chosen.push({ index: index, key: list[index], text: text });
      });
      if (!chosen.length) continue;
      var boxes = chosen.map(function (t, i) {
        var w = measure(t.text);
        var x = xOf(t.index);
        var align = 'center';
        if (n > 1 && t.index === 0) align = 'left';
        else if (n > 1 && t.index === n - 1) align = 'right';
        else if (chosen.length === 1) align = 'left';
        var left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
        // A centered label near an edge is pushed back inside the card.
        if (left < 0) { left = 0; align = 'left'; x = 0; }
        if (left + w > width) { left = width - w; align = 'right'; x = width; }
        return { tick: t, left: left, right: left + w, x: x, align: align, i: i };
      });
      var fits = boxes.every(function (b, i) {
        if (b.left < 0 || b.right > width + 0.5) return false;
        return i === 0 || boxes[i - 1].right + GAP <= b.left;
      });
      if (!fits) continue;
      return boxes.map(function (b) {
        return { index: b.tick.index, key: b.tick.key, text: b.tick.text, x: b.x, align: b.align };
      });
    }
    return [];
  }

  global.CoachChartDates = {
    dateOf: dateOf,
    label: label,
    crossesYear: crossesYear,
    spread: spread,
    ticks: ticks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
