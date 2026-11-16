/* Heart rate on a run, in the browser: a Bluetooth device the person chooses.
 * The rules are LIFT for iPhone's RunHeartRate.swift and Android's
 * RunHeartRate.kt, case for case, so the same strap reads the same number on
 * every build.
 *
 * Tracked and shown, never targeted: no zones, no colors, no thresholds, no
 * advice. A run keeps three things and no more -- `averageBpm`, `maxBpm` and
 * the device's name -- never a reading a second.
 *
 * Web Bluetooth is a radio to a device in the room, not the network, and
 * nothing in this file can reach a server. Chrome and Edge have it; Firefox and
 * Safari do not, and there `available()` is false and the page offers nothing.
 *
 * A browser will not open its chooser without a tap, so `connect` must be
 * called from a click handler and nowhere else. It cannot reconnect after the
 * page reloads either, for the same reason: the person chooses again.
 *
 * One source a run: a device that drops is reconnected -- the same device, 2 s
 * then 5 s then 5 s -- and never swapped for another. After the third failure
 * it says so and waits for a tap (`retry`), which goes to the same device.
 */
(function (global) {
  'use strict';

  /** No reading for this long hides the number: a stale pulse on a screen is
   *  worse than a dash. A reading exactly this old still shows (the iPhone's
   *  `<=`). */
  var STALE_AFTER_MS = 10 * 1000;

  /** The wait before each reconnect attempt, then give up. */
  var RECONNECT_DELAYS_MS = [2000, 5000, 5000];

  /** What a nameless device is called on screen. */
  var UNNAMED = 'Heart rate device';

  var SETTING_KEY = 'lift.heartRate';

  // MARK: - The characteristic

  /**
   * Beats per minute from a Heart Rate Measurement (0x2A37) notification, or
   * null for data too short to hold one and for 0 -- a strap with no skin
   * contact reports 0, which is no reading, not a pulse. Byte 0 is flags; bit 0
   * clear means one byte of value, set means two, little-endian. The other flag
   * bits describe what follows the value and are not read.
   */
  function bpm(data) {
    if (!data || typeof data.byteLength !== 'number' || data.byteLength < 1) return null;
    var wide = (data.getUint8(0) & 0x01) !== 0;
    var value;
    if (wide) {
      if (data.byteLength < 3) return null;
      value = data.getUint16(1, true);
    } else {
      if (data.byteLength < 2) return null;
      value = data.getUint8(1);
    }
    return value > 0 ? value : null;
  }

  // MARK: - What the screen shows

  /** The number to show now, or null once the last reading is stale. `last` is
   *  `{ bpm, at }` with `at` in epoch milliseconds. */
  function shown(last, nowMs) {
    if (!last || !(last.bpm > 0) || !Number.isFinite(last.bpm) || !Number.isFinite(last.at)) return null;
    return nowMs - last.at <= STALE_AFTER_MS ? last.bpm : null;
  }

  /** All a run keeps: the mean rounded half up, and the max. Null when there
   *  is nothing to average. */
  function summary(readings) {
    var values = (Array.isArray(readings) ? readings : []).filter(function (v) {
      return typeof v === 'number' && Number.isFinite(v) && v > 0;
    });
    if (!values.length) return null;
    var sum = 0, max = 0;
    values.forEach(function (v) { sum += v; if (v > max) max = v; });
    // Integer half-up, as the iPhone does: (2 * sum + count) / (2 * count).
    return { averageBpm: Math.floor((2 * sum + values.length) / (2 * values.length)), maxBpm: max };
  }

  /** "Avg 141 \u00b7 Max 168 bpm", from what a run kept; null when it kept neither. */
  function line(averageBpm, maxBpm) {
    var parts = [];
    if (averageBpm > 0) parts.push('Avg ' + averageBpm);
    if (maxBpm > 0) parts.push('Max ' + maxBpm);
    return parts.length ? parts.join(' \u00b7 ') + ' bpm' : null;
  }

  /** Whether this browser can read a Bluetooth device at all. */
  function available() {
    var nav = global.navigator;
    return !!nav && typeof nav === 'object' && 'bluetooth' in nav;
  }

  // MARK: - The setting

  /** `'automatic'` or `'off'`. Automatic is no key at all, like Keep the screen
   *  on. There is no added-device list on the web: the browser asks the person
   *  to choose a device each time. */
  function setting(storage) {
    try { return storage.getItem(SETTING_KEY) === 'off' ? 'off' : 'automatic'; } catch (e) { return 'automatic'; }
  }

  function setSetting(value, storage) {
    try {
      if (value === 'off') storage.setItem(SETTING_KEY, 'off');
      else storage.removeItem(SETTING_KEY);
    } catch (e) { /* keep going */ }
  }

  // MARK: - Reconnecting

  /** The wait before the next attempt after `failures` in a row, or null to
   *  stop. A success resets the count to 0. */
  function reconnectDelay(failures) {
    var n = Number(failures);
    if (!(n >= 0)) return null;
    return n < RECONNECT_DELAYS_MS.length ? RECONNECT_DELAYS_MS[Math.floor(n)] : null;
  }

  // MARK: - Connecting

  /**
   * Asks the browser to choose a heart rate device and reads it. Call this from
   * a tap. Resolves with `{ name, disconnect(), retry() }` once the device is
   * notifying; rejects with the browser's own error if nothing was chosen
   * (`NotFoundError`) or the first connection failed, having let go of
   * everything. `options.onState` hears `'connected'`, `'reconnecting'` and
   * `'lost'` after that.
   *
   * `disconnect` is idempotent and always releases the device, the
   * notifications and every listener.
   */
  function connect(onReading, options) {
    var onState = options && options.onState;
    var nav = global.navigator;
    if (!available() || !nav.bluetooth || typeof nav.bluetooth.requestDevice !== 'function') {
      return Promise.reject(new Error('This browser cannot read a Bluetooth device.'));
    }
    // Called first and synchronously, so it is still inside the tap.
    var asked = nav.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    return Promise.resolve(asked).then(function (device) {
      return begin(device, onReading, onState);
    });
  }

  function begin(device, onReading, onState) {
    var closed = false;
    var opening = false;
    var failures = 0;
    var timer = null;
    var characteristic = null;
    var name = typeof device.name === 'string' && device.name.trim() ? device.name : UNNAMED;

    function tell(state) { if (!closed && onState) onState(state); }

    function onValue(event) {
      if (closed) return;
      var value = bpm(event && event.target && event.target.value);
      if (value != null) onReading(value);
    }

    function detachCharacteristic() {
      var c = characteristic;
      characteristic = null;
      if (!c) return;
      try { c.removeEventListener('characteristicvaluechanged', onValue); } catch (e) { /* gone */ }
      try {
        var stopped = c.stopNotifications();
        if (stopped && stopped.catch) stopped.catch(function () {});
      } catch (e) { /* the device is already gone */ }
    }

    function hangUp() {
      try { if (device.gatt && device.gatt.connected) device.gatt.disconnect(); } catch (e) { /* already gone */ }
    }

    /** One connection: GATT, the service, the characteristic, notifications. */
    function open() {
      opening = true;
      return device.gatt.connect().then(function (server) {
        if (closed) { hangUp(); return false; }
        return server.getPrimaryService('heart_rate');
      }).then(function (service) {
        if (service === false) return false;
        if (closed) { hangUp(); return false; }
        return service.getCharacteristic('heart_rate_measurement');
      }).then(function (c) {
        if (c === false) return false;
        if (closed) { hangUp(); return false; }
        c.addEventListener('characteristicvaluechanged', onValue);
        characteristic = c;
        return c.startNotifications().then(function () {
          if (closed) { detachCharacteristic(); hangUp(); return false; }
          return true;
        });
      }).then(function (ok) { opening = false; return ok; },
        function (error) { opening = false; detachCharacteristic(); throw error; });
    }

    function schedule() {
      if (closed || timer !== null || opening) return;
      var wait = reconnectDelay(failures);
      if (wait == null) { tell('lost'); return; }
      timer = global.setTimeout(attempt, wait);
    }

    function attempt() {
      timer = null;
      if (closed || opening) return;
      open().then(function (ok) {
        if (!ok || closed) return;
        failures = 0;
        tell('connected');
      }, function () {
        if (closed) return;
        failures += 1;
        schedule();
      });
    }

    function onDrop() {
      if (closed) return;
      detachCharacteristic();
      tell('reconnecting');
      schedule();
    }

    device.addEventListener('gattserverdisconnected', onDrop);

    function disconnect() {
      if (closed) return;
      closed = true;
      if (timer !== null) { global.clearTimeout(timer); timer = null; }
      detachCharacteristic();
      try { device.removeEventListener('gattserverdisconnected', onDrop); } catch (e) { /* gone */ }
      hangUp();
    }

    /** After 'lost': the same device again now, with a fresh backoff. A tap, so
     *  it needs no chooser. Does nothing while connected or already trying. */
    function retry() {
      if (closed || opening || timer !== null) return;
      if (device.gatt && device.gatt.connected && characteristic) return;
      failures = 0;
      tell('reconnecting');
      attempt();
    }

    return open().then(function (ok) {
      if (!ok) throw new Error('Heart rate connection was closed.');
      tell('connected');
      return { name: name, disconnect: disconnect, retry: retry };
    }, function (error) {
      disconnect();
      throw error;
    });
  }

  global.LiftHeartRate = {
    STALE_AFTER_MS: STALE_AFTER_MS,
    RECONNECT_DELAYS_MS: RECONNECT_DELAYS_MS,
    SETTING_KEY: SETTING_KEY,
    UNNAMED: UNNAMED,
    bpm: bpm,
    shown: shown,
    summary: summary,
    line: line,
    available: available,
    setting: setting,
    setSetting: setSetting,
    reconnectDelay: reconnectDelay,
    connect: connect,
  };
})(typeof window !== 'undefined' ? window : globalThis);
