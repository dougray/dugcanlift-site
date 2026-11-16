import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Heart rate on a run, in the browser: the rules, then the Web Bluetooth glue
// against a fake GATT server. The cases mirror RunHeartRateTests on iPhone and
// RunHeartRate.kt on Android by name, and add what only a browser has: a
// chooser that needs a tap, and a page reload that drops the connection.
//
// Tracked and shown, never targeted: nothing in here is a zone, a color or a
// threshold. There is no strap in this environment, so none of this has met
// real hardware (see the report).

const source = readFileSync('lift/heart-rate.js', 'utf8');

/** The module loaded as a browser would, against the page's own navigator and timers. */
function load(page = {}) {
  const shim = { ...page };
  new Function('window', source).call(shim, shim);
  return shim.LiftHeartRate;
}

const H = load({ navigator: { bluetooth: {} } });

const view = (...bytes) => new DataView(new Uint8Array(bytes).buffer);

// MARK: - bpm(dataView)

test('an eight-bit reading', () => {
  assert.equal(H.bpm(view(0x00, 142)), 142);
});

test('a sixteen-bit reading is little-endian', () => {
  assert.equal(H.bpm(view(0x01, 0x2c, 0x01)), 300);
  assert.equal(H.bpm(view(0x01, 0x8e, 0x00)), 142);
});

test('a sixteen-bit flag with one byte of value is no reading', () => {
  assert.equal(H.bpm(view(0x01, 0x8e)), null);
});

test('zero is no reading', () => {
  assert.equal(H.bpm(view(0x00, 0)), null);
  assert.equal(H.bpm(view(0x01, 0, 0)), null);
});

test('empty and short data are no reading', () => {
  assert.equal(H.bpm(view()), null);
  assert.equal(H.bpm(view(0x00)), null);
  assert.equal(H.bpm(null), null);
  assert.equal(H.bpm(undefined), null);
});

test('other flag bits do not change the width', () => {
  // Contact, energy expended and RR intervals come after the value and are not read.
  assert.equal(H.bpm(view(0x1e, 150, 0xff, 0xff)), 150);
  assert.equal(H.bpm(view(0x1f, 0x96, 0x00, 0xff, 0xff)), 150);
});

test('a value read from the middle of a larger buffer still starts at its own first byte', () => {
  const bytes = new Uint8Array([9, 9, 0x00, 77, 9]);
  assert.equal(H.bpm(new DataView(bytes.buffer, 2, 2)), 77);
});

// MARK: - shown(last, nowMs)

const AT = 1_800_000_000_000;

test('a reading is shown under ten seconds', () => {
  assert.equal(H.shown({ bpm: 142, at: AT }, AT + 9_900), 142);
});

test('a reading exactly ten seconds old still shows, the iPhone rule', () => {
  assert.equal(H.shown({ bpm: 142, at: AT }, AT + 10_000), 142);
});

test('a reading over ten seconds old is hidden', () => {
  assert.equal(H.shown({ bpm: 142, at: AT }, AT + 10_100), null);
});

test('no reading yet shows nothing', () => {
  assert.equal(H.shown(null, AT), null);
  assert.equal(H.shown(undefined, AT), null);
});

test('a reading that is not a pulse is never shown', () => {
  assert.equal(H.shown({ bpm: 0, at: AT }, AT), null);
  assert.equal(H.shown({ bpm: NaN, at: AT }, AT), null);
  assert.equal(H.shown({ bpm: 142, at: NaN }, AT), null);
});

test('the stale limit is ten seconds', () => {
  assert.equal(H.STALE_AFTER_MS, 10_000);
});

// MARK: - summary(readings)

test('summary is the mean and the max', () => {
  assert.deepEqual(H.summary([140, 150, 160]), { averageBpm: 150, maxBpm: 160 });
});

test('summary rounds the mean half up', () => {
  assert.deepEqual(H.summary([140, 141]), { averageBpm: 141, maxBpm: 141 });
  assert.deepEqual(H.summary([140, 141, 141, 141]), { averageBpm: 141, maxBpm: 141 });
  assert.deepEqual(H.summary([100, 101, 101]), { averageBpm: 101, maxBpm: 101 });
  assert.deepEqual(H.summary([100, 100, 101]), { averageBpm: 100, maxBpm: 101 });
});

test('no readings is no summary', () => {
  assert.equal(H.summary([]), null);
  assert.equal(H.summary(null), null);
  assert.equal(H.summary(undefined), null);
});

test('summary keeps nothing but the two figures', () => {
  assert.deepEqual(Object.keys(H.summary([120, 130])).sort(), ['averageBpm', 'maxBpm']);
});

// MARK: - available()

test('available is whether the browser has Web Bluetooth at all', () => {
  assert.equal(load({ navigator: { bluetooth: {} } }).available(), true);
  assert.equal(load({ navigator: {} }).available(), false, 'Firefox and Safari');
  assert.equal(load({}).available(), false, 'no navigator at all');
});

// MARK: - The setting

function storageOf(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('the setting is Automatic until it is turned Off, and Off persists', () => {
  const s = storageOf();
  assert.equal(H.setting(s), 'automatic');
  H.setSetting('off', s);
  assert.equal(H.setting(s), 'off');
  assert.equal(s.map.get(H.SETTING_KEY), 'off');
  H.setSetting('automatic', s);
  assert.equal(H.setting(s), 'automatic');
  assert.ok(!s.map.has(H.SETTING_KEY), 'Automatic is no key at all');
});

test('an unknown stored value reads as Automatic', () => {
  assert.equal(H.setting(storageOf({ [H.SETTING_KEY]: 'zone2' })), 'automatic');
});

test('a storage that throws never throws out of the setting', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); } };
  assert.equal(H.setting(broken), 'automatic');
  H.setSetting('off', broken);
  H.setSetting('automatic', broken);
});

// MARK: - The reconnect policy

test('reconnecting waits 2 s, then 5 s, then 5 s, then gives up', () => {
  assert.deepEqual(H.RECONNECT_DELAYS_MS, [2000, 5000, 5000]);
  assert.equal(H.reconnectDelay(0), 2000);
  assert.equal(H.reconnectDelay(1), 5000);
  assert.equal(H.reconnectDelay(2), 5000);
  assert.equal(H.reconnectDelay(3), null);
  assert.equal(H.reconnectDelay(99), null);
});

// MARK: - A fake device

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakePage({ name = 'Polar H10', failConnects = 0, bluetooth = true, requestFails = null } = {}) {
  const log = {
    requestDevice: [], connects: 0, disconnects: 0, started: 0, stopped: 0,
    charAdds: 0, charRemoves: 0, devAdds: 0, devRemoves: 0,
  };
  const charListeners = new Set();
  const devListeners = new Set();
  const state = { failConnects, connected: false };

  const characteristic = {
    value: null,
    addEventListener(type, fn) { if (type === 'characteristicvaluechanged') { charListeners.add(fn); log.charAdds += 1; } },
    removeEventListener(type, fn) { if (type === 'characteristicvaluechanged') { charListeners.delete(fn); log.charRemoves += 1; } },
    async startNotifications() { log.started += 1; return characteristic; },
    async stopNotifications() { log.stopped += 1; return characteristic; },
  };
  const server = {
    async getPrimaryService(service) {
      assert.equal(service, 'heart_rate');
      return { async getCharacteristic(c) { assert.equal(c, 'heart_rate_measurement'); return characteristic; } };
    },
  };
  const device = {
    id: 'device-1',
    name,
    gatt: {
      get connected() { return state.connected; },
      async connect() {
        log.connects += 1;
        if (state.failConnects > 0) { state.failConnects -= 1; throw new Error('out of range'); }
        state.connected = true;
        return server;
      },
      disconnect() { state.connected = false; log.disconnects += 1; },
    },
    addEventListener(type, fn) { if (type === 'gattserverdisconnected') { devListeners.add(fn); log.devAdds += 1; } },
    removeEventListener(type, fn) { if (type === 'gattserverdisconnected') { devListeners.delete(fn); log.devRemoves += 1; } },
  };

  const timers = new Map();
  let nextTimer = 1;
  const pageShim = {
    navigator: bluetooth ? { bluetooth: {
      async requestDevice(options) {
        log.requestDevice.push(options);
        if (requestFails) throw requestFails;
        return device;
      },
    } } : {},
    setTimeout: (fn, ms) => { timers.set(nextTimer, { fn, ms }); return nextTimer++; },
    clearTimeout: (id) => { timers.delete(id); },
  };

  return {
    H: load(pageShim),
    log, device, characteristic, state,
    timers: () => [...timers.values()].map((t) => t.ms),
    timerCount: () => timers.size,
    async fireTimer() {
      const [id, t] = [...timers.entries()][0];
      timers.delete(id);
      t.fn();
      await tick();
    },
    async drop() {
      state.connected = false;
      [...devListeners].forEach((fn) => fn({ target: device }));
      await tick();
    },
    notify(...bytes) {
      characteristic.value = view(...bytes);
      [...charListeners].forEach((fn) => fn({ target: characteristic }));
    },
    listening: () => ({ characteristic: charListeners.size, device: devListeners.size }),
  };
}

// MARK: - connect()

test('connect asks the browser for a heart rate device once, then reads notifications', async () => {
  const p = fakePage();
  const readings = [];
  const handle = await p.H.connect((bpm) => readings.push(bpm));
  assert.deepEqual(p.log.requestDevice, [{ filters: [{ services: ['heart_rate'] }] }]);
  assert.equal(handle.name, 'Polar H10');
  assert.equal(typeof handle.disconnect, 'function');
  assert.equal(p.log.started, 1);
  p.notify(0x00, 141);
  p.notify(0x01, 0x8e, 0x00);
  assert.deepEqual(readings, [141, 142]);
});

test('a zero, short or empty notification is not forwarded', async () => {
  const p = fakePage();
  const readings = [];
  await p.H.connect((bpm) => readings.push(bpm));
  p.notify(0x00, 0);
  p.notify(0x01, 0x8e);
  p.notify();
  assert.deepEqual(readings, []);
});

test('a device with no name still has one to show', async () => {
  const p = fakePage({ name: '' });
  const handle = await p.H.connect(() => {});
  assert.equal(handle.name, 'Heart rate device');
});

test('the device name is handed over as the device gave it, any length or characters', async () => {
  const hostile = '<img src=x onerror=alert(1)>' + 'W'.repeat(500) + '‮\u0000';
  const p = fakePage({ name: hostile });
  const handle = await p.H.connect(() => {});
  assert.equal(handle.name, hostile, 'never sliced here: the page truncates with CSS');
});

test('choosing nothing in the chooser rejects with the browser\'s own error, and starts nothing', async () => {
  const cancelled = Object.assign(new Error('User cancelled'), { name: 'NotFoundError' });
  const p = fakePage({ requestFails: cancelled });
  await assert.rejects(p.H.connect(() => {}), (e) => e === cancelled);
  assert.equal(p.log.connects, 0);
  assert.equal(p.timerCount(), 0);
});

test('without Web Bluetooth connect rejects instead of throwing synchronously', async () => {
  const p = fakePage({ bluetooth: false });
  await assert.rejects(p.H.connect(() => {}), /Bluetooth/);
});

test('a first connection that fails is reported, released and not retried behind the person\'s back', async () => {
  const p = fakePage({ failConnects: 1 });
  await assert.rejects(p.H.connect(() => {}), /out of range/);
  assert.equal(p.timerCount(), 0, 'no timer: the person is told and taps again');
  assert.deepEqual(p.listening(), { characteristic: 0, device: 0 });
});

// MARK: - Reconnecting: the same device, 2 s, 5 s, 5 s

test('a dropped device is reconnected, the same device, after two seconds', async () => {
  const p = fakePage();
  const readings = [];
  const states = [];
  await p.H.connect((b) => readings.push(b), { onState: (s) => states.push(s) });
  await p.drop();
  assert.deepEqual(p.timers(), [2000]);
  assert.equal(states.at(-1), 'reconnecting');
  await p.fireTimer();
  assert.equal(p.log.connects, 2);
  assert.equal(p.log.requestDevice.length, 1, 'never a second chooser: no swapping the source');
  assert.equal(states.at(-1), 'connected');
  p.notify(0x00, 150);
  assert.deepEqual(readings, [150]);
});

test('failed reconnects wait 2 s, 5 s, 5 s and then the person is told', async () => {
  const p = fakePage();
  const states = [];
  await p.H.connect(() => {}, { onState: (s) => states.push(s) });
  p.state.failConnects = 99;
  await p.drop();
  const waited = [];
  while (p.timerCount()) {
    waited.push(p.timers()[0]);
    await p.fireTimer();
  }
  assert.deepEqual(waited, [2000, 5000, 5000]);
  assert.equal(p.log.connects, 1 + 3);
  assert.equal(states.at(-1), 'lost');
  assert.equal(p.log.requestDevice.length, 1);
});

test('a reconnect that works resets the backoff', async () => {
  const p = fakePage();
  await p.H.connect(() => {});
  p.state.failConnects = 1;
  await p.drop();
  assert.deepEqual(p.timers(), [2000]);
  await p.fireTimer();
  assert.deepEqual(p.timers(), [5000], 'the first retry failed');
  await p.fireTimer();
  assert.equal(p.timerCount(), 0, 'then it connected');
  await p.drop();
  assert.deepEqual(p.timers(), [2000], 'the next drop starts from 2 s again');
});

test('retry after giving up goes to the same device, with no chooser and a fresh backoff', async () => {
  const p = fakePage();
  const handle = await p.H.connect(() => {});
  p.state.failConnects = 99;
  await p.drop();
  while (p.timerCount()) await p.fireTimer();
  p.state.failConnects = 0;
  handle.retry();
  await tick();
  assert.equal(p.log.requestDevice.length, 1);
  assert.equal(p.log.connects, 5);
  p.notify(0x00, 133);
});

test('retry while already connected does nothing', async () => {
  const p = fakePage();
  const handle = await p.H.connect(() => {});
  handle.retry();
  await tick();
  assert.equal(p.log.connects, 1);
});

test('a second drop while a reconnect is pending does not stack timers', async () => {
  const p = fakePage();
  await p.H.connect(() => {});
  await p.drop();
  await p.drop();
  assert.equal(p.timerCount(), 1);
});

// MARK: - Letting go

test('disconnect releases the device, the notifications and every listener', async () => {
  const p = fakePage();
  const readings = [];
  const handle = await p.H.connect((b) => readings.push(b));
  assert.deepEqual(p.listening(), { characteristic: 1, device: 1 });
  handle.disconnect();
  await tick();
  assert.equal(p.log.stopped, 1);
  assert.equal(p.log.disconnects, 1);
  assert.deepEqual(p.listening(), { characteristic: 0, device: 0 });
  p.notify(0x00, 150);
  assert.deepEqual(readings, [], 'nothing arrives after disconnect');
});

test('disconnect is idempotent', async () => {
  const p = fakePage();
  const handle = await p.H.connect(() => {});
  handle.disconnect();
  handle.disconnect();
  await tick();
  assert.equal(p.log.disconnects, 1);
  assert.equal(p.log.stopped, 1);
  assert.equal(p.log.charRemoves, 1);
  assert.equal(p.log.devRemoves, 1);
});

test('disconnect cancels a pending reconnect, and a drop after it schedules nothing', async () => {
  const p = fakePage();
  const handle = await p.H.connect(() => {});
  await p.drop();
  assert.equal(p.timerCount(), 1);
  handle.disconnect();
  assert.equal(p.timerCount(), 0);
  await p.drop();
  assert.equal(p.timerCount(), 0);
  assert.equal(p.log.connects, 1);
});

test('disconnect while a reconnect is mid-flight lets go of the connection it makes', async () => {
  const p = fakePage();
  const handle = await p.H.connect(() => {});
  await p.drop();
  // Start the retry but finish it after disconnect.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const realConnect = p.device.gatt.connect;
  p.device.gatt.connect = async function () { await gate; return realConnect.call(this); };
  const fire = p.fireTimer();
  handle.disconnect();
  release();
  await fire;
  await tick();
  assert.equal(p.state.connected, false, 'the late connection is closed, not left holding the strap');
  assert.deepEqual(p.listening(), { characteristic: 0, device: 0 });
  assert.equal(p.timerCount(), 0);
});

// MARK: - Nothing here can reach the network

test('nothing here can reach the network', () => {
  // Web Bluetooth talks to a device in the room, not a server. This pins that
  // nothing else slipped in beside it.
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'import('].forEach((word) => {
    assert.ok(!source.includes(word), word);
  });
});

test('it stores no per-second reading anywhere', () => {
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(source),
    'the only storage is the setting, through the storage the page hands it');
});
