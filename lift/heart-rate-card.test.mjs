import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { appSource, KEY, T0, harness } from './live-harness.mjs';

// Heart rate on the live card and the recording screen, run against the real
// code in app.js (lifted out as live-card.test.mjs does) and the real
// heart-rate.js, with a fake Web Bluetooth device in the room.
//
// What the iPhone and Android reviews taught, as cases that can fail here:
//   - a number goes away at ten seconds with nothing else changing, on the
//     card and on the recording screen;
//   - the browser's chooser needs a tap, so only the button opens it, and a
//     reload never does;
//   - a dropped device comes back as the same device, never another;
//   - Finish and Discard let go of it, Back to LIFT does not, and Finish saves
//     the summary once through the one finish path;
//   - a device's name is text, of any length.
// No strap was used: this is a fake device, not hardware.

const HR_KEY = 'lift.heartRate';
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeBluetooth({ name = 'Polar H10', chooser = null } = {}) {
  const log = { requestDevice: [], connects: 0, disconnects: 0, started: 0, stopped: 0 };
  const charListeners = new Set();
  const devListeners = new Set();
  const state = { connected: false, failConnects: 0 };
  const characteristic = {
    value: null,
    addEventListener(type, fn) { if (type === 'characteristicvaluechanged') charListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'characteristicvaluechanged') charListeners.delete(fn); },
    async startNotifications() { log.started += 1; },
    async stopNotifications() { log.stopped += 1; },
  };
  const server = {
    getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }),
  };
  const device = {
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
    addEventListener(type, fn) { if (type === 'gattserverdisconnected') devListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'gattserverdisconnected') devListeners.delete(fn); },
  };
  const bluetooth = {
    requestDevice(options) {
      log.requestDevice.push(options);
      return chooser ? chooser() : Promise.resolve(device);
    },
  };
  return {
    bluetooth, log, device, state,
    notify(bpm) {
      characteristic.value = new DataView(new Uint8Array([0x00, bpm]).buffer);
      [...charListeners].forEach((fn) => fn({ target: characteristic }));
    },
    async drop() {
      state.connected = false;
      [...devListeners].forEach((fn) => fn({}));
      await tick();
    },
    listening: () => ({ characteristic: charListeners.size, device: devListeners.size }),
  };
}

/** A harness with a device in range, a run started, the overlay open and the device connected. */
async function connected({ name, readings = [], ...rest } = {}) {
  const bt = fakeBluetooth({ name });
  const h = harness({ bluetooth: bt.bluetooth, ...rest });
  h.renderOutdoor();
  h.startRecording('RUN');
  h.node('#rec-hr-connect').onclick();
  await tick();
  readings.forEach((bpm) => { bt.notify(bpm); h.advance(1000); });
  return { h, bt };
}

const hidden = (h) => h.node('#rec-hr-connect').classes.has('hidden');
const cardSlot = (h) => h.section.querySelectorAll('.liveextras')[0];
const overlayText = (h) => h.node('#rec-hr').textContent;

// MARK: - Where it appears

test('a browser with no Web Bluetooth gets no button, no error and no number', () => {
  const h = harness();
  h.renderOutdoor();
  h.startRecording('RUN');
  assert.ok(hidden(h), 'Firefox and Safari: nothing to tap');
  assert.equal(h.node('#rec-hr-status').textContent, '');
  assert.equal(overlayText(h), '');
  assert.equal(cardSlot(h).children.length, 0);
  assert.deepEqual(h.alerts, []);
  h.node('#rec-hr-connect').onclick();
  assert.equal(h.recording.activityType, 'RUN', 'a stray tap breaks nothing');
});

test('with Web Bluetooth the button is on the recording screen, and nowhere on the card', () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth });
  h.renderOutdoor();
  h.startRecording('RUN');
  assert.equal(hidden(h), false);
  h.closeRecording();
  assert.equal(h.section.button('Connect heart rate'), undefined, 'the card never offers it');
  const html = readFileSync('lift/index.html', 'utf8');
  const overlay = html.slice(html.indexOf('id="recording"'), html.indexOf('id="review"'));
  assert.ok(/<button[^>]*id="rec-hr-connect"[^>]*>Connect heart rate<\/button>/.test(overlay));
  assert.equal((html.match(/Connect heart rate/g) || []).length, 1);
});

test('nothing connects on load, on starting, on opening, or on a reload', () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth });
  h.startRecording('RUN');
  h.closeRecording();
  h.openRecording();
  h.advance(5000);
  assert.deepEqual(bt.log.requestDevice, [], 'a chooser needs a tap');

  const reloadBt = fakeBluetooth();
  const reloaded = harness({ bluetooth: reloadBt.bluetooth, stored: { [KEY.recording]: {
    id: 'r1', activityType: 'RUN', startedAtEpochMs: T0 - 60000, route: [] } } });
  assert.ok(reloaded.recording, 'the run came back');
  assert.deepEqual(reloadBt.log.requestDevice, []);
  assert.equal(reloadBt.log.connects, 0);
});

test('only the button\'s tap asks the browser for a device', () => {
  assert.equal((appSource.match(/\.requestDevice\(/g) || []).length, 0, 'app.js never calls it directly');
  assert.equal((appSource.match(/LiftHeartRate\.connect\(/g) || []).length, 1, 'one place connects');
  const at = appSource.indexOf('LiftHeartRate.connect(');
  assert.ok(appSource.lastIndexOf('function connectHeartRate', at) > appSource.lastIndexOf('\nfunction ', at - 1) - 1);
  assert.ok(appSource.includes("$('#rec-hr-connect').onclick = connectHeartRate"));
});

test('a reload mid-run drops the device: no number, and the screen offers Connect heart rate again', async () => {
  // First life: connected and reading.
  const first = await connected({ readings: [140, 150] });
  assert.equal(overlayText(first.h), '150 bpm' + 'from Polar H10');
  // Second life: the page reloaded. The recording is in storage, the device is not.
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth, stored: {
    [KEY.recording]: JSON.parse(first.h.storage.get(KEY.recording)) } });
  assert.equal(cardSlot(h).children.length, 0, 'the card shows no number');
  h.openRecording();
  assert.equal(overlayText(h), '');
  assert.equal(hidden(h), false, 'and the screen offers the button');
  assert.deepEqual(bt.log.requestDevice, []);
  h.node('#rec-hr-connect').onclick();
  assert.equal(bt.log.requestDevice.length, 1, 'a tap asks again');
});

// MARK: - The number

test('a tap opens the chooser once, and the number and its device show on the card and the screen', async () => {
  const { h, bt } = await connected({ readings: [142] });
  assert.deepEqual(bt.log.requestDevice, [{ filters: [{ services: ['heart_rate'] }] }]);
  assert.ok(hidden(h), 'connected: nothing left to tap');
  assert.equal(overlayText(h), '142 bpm' + 'from Polar H10');
  h.closeRecording();
  assert.equal(cardSlot(h).textContent, '142 bpm' + 'from Polar H10');
  const [number, from] = cardSlot(h).children;
  assert.equal(number.textContent, '142 bpm');
  assert.equal(from.textContent, 'from Polar H10');
  assert.ok(from.classes.has('small') && from.classes.has('muted'));
});

test('tapping again while the chooser is open does not open a second', async () => {
  let resolve;
  const bt = fakeBluetooth({ chooser: () => new Promise((r) => { resolve = r; }) });
  const h = harness({ bluetooth: bt.bluetooth });
  h.startRecording('RUN');
  h.node('#rec-hr-connect').onclick();
  h.node('#rec-hr-connect').onclick();
  assert.equal(bt.log.requestDevice.length, 1);
  assert.ok(hidden(h), 'and the button is out of the way meanwhile');
  resolve(bt.device);
  await tick();
});

test('a reading is shown at 9.9 s, still at exactly 10 s, and gone at 10.1 s, on both screens', async () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth });
  h.renderOutdoor();
  h.startRecording('RUN');
  h.node('#rec-hr-connect').onclick();
  await tick();
  bt.notify(142);
  h.advance(0);
  h.closeRecording();
  const shown = () => [cardSlot(h).textContent, overlayText(h)];
  h.advance(9900);
  assert.deepEqual(shown(), ['142 bpmfrom Polar H10', '142 bpmfrom Polar H10']);
  h.advance(100);
  assert.deepEqual(shown(), ['142 bpmfrom Polar H10', '142 bpmfrom Polar H10'], 'exactly 10.000 s old still shows');
  h.advance(100);
  assert.deepEqual(shown(), ['', ''], '10.1 s: hidden, source line and all');
  assert.equal(cardSlot(h).children.length, 0);
  bt.notify(150);
  h.advance(0);
  assert.equal(cardSlot(h).children[0].textContent, '150 bpm', 'and a new reading brings it back');
});

test('a device name is text: markup and control characters are not interpreted', async () => {
  const name = '<img src=x onerror=alert(1)>‮<b>x</b>';
  const { h } = await connected({ name, readings: [120] });
  h.closeRecording();
  const [, from] = cardSlot(h).children;
  assert.equal(from.textContent, `from ${name}`);
  assert.equal(from.children.length, 0, 'no element was made from it');
  assert.equal(h.node('#rec-hr').children[1].children.length, 0);
  assert.deepEqual(h.alerts, []);
});

test('a very long name is shown whole and cut short by the stylesheet, not by slicing', async () => {
  const name = `Strap ${'W'.repeat(300)}`;
  const { h } = await connected({ name, readings: [120] });
  assert.equal(cardSlot(h).children[1].textContent, `from ${name}`);
  const css = readFileSync('lift/style.css', 'utf8');
  const rule = css.slice(css.indexOf('.hrsource'), css.indexOf('}', css.indexOf('.hrsource')));
  assert.match(rule, /text-overflow:\s*ellipsis/);
  assert.match(rule, /white-space:\s*nowrap/);
  assert.match(rule, /overflow:\s*hidden/);
});

test('no app code writes a device name as markup', () => {
  const block = appSource.slice(appSource.indexOf('/* ---- heart rate ----'), appSource.indexOf('async function holdScreenOn'));
  assert.ok(block.length > 500);
  const writes = block.match(/innerHTML\s*[+]?=\s*[^;]*/g) || [];
  writes.forEach((w) => assert.match(w, /^innerHTML\s*=\s*''$/, w));
  assert.ok(!/insertAdjacentHTML|outerHTML|document\.write/.test(block));
});

// MARK: - Only one source, and the run goes on

test('a dropped device is reconnected, the same one, and says so meanwhile', async () => {
  const { h, bt } = await connected({ readings: [140] });
  await bt.drop();
  assert.deepEqual(h.timeouts(), [2000]);
  assert.equal(h.node('#rec-hr-status').textContent, 'Reconnecting heart rate…');
  assert.ok(hidden(h), 'no button while it is trying');
  h.fireTimeout();
  await tick();
  assert.equal(bt.log.connects, 2);
  assert.equal(bt.log.requestDevice.length, 1, 'never a second chooser mid-run');
  assert.equal(h.node('#rec-hr-status').textContent, '');
  bt.notify(150);
  h.advance(0);
  assert.equal(overlayText(h), '150 bpmfrom Polar H10');
});

test('after three failed reconnects the screen says so and a tap goes back to the same device', async () => {
  const { h, bt } = await connected({ readings: [140] });
  bt.state.failConnects = 99;
  await bt.drop();
  const waited = [];
  while (h.timeouts().length) { waited.push(h.timeouts()[0]); h.fireTimeout(); await tick(); }
  assert.deepEqual(waited, [2000, 5000, 5000]);
  assert.equal(h.node('#rec-hr-status').textContent, 'Heart rate disconnected.');
  assert.equal(hidden(h), false, 'the button is offered again');
  bt.state.failConnects = 0;
  h.node('#rec-hr-connect').onclick();
  await tick();
  assert.equal(bt.log.requestDevice.length, 1, 'the same device: no chooser, so no swap');
  assert.ok(hidden(h));
  bt.notify(155);
  h.advance(0);
  assert.equal(overlayText(h), '155 bpmfrom Polar H10');
});

test('closing the chooser says nothing and leaves the button; a failed connection says so', async () => {
  const cancelled = Object.assign(new Error('cancelled'), { name: 'NotFoundError' });
  const h1 = harness({ bluetooth: fakeBluetooth({ chooser: () => Promise.reject(cancelled) }).bluetooth });
  h1.startRecording('RUN');
  h1.node('#rec-hr-connect').onclick();
  await tick();
  assert.equal(h1.node('#rec-hr-status').textContent, '');
  assert.equal(hidden(h1), false);

  const bt = fakeBluetooth();
  bt.state.failConnects = 1;
  const h2 = harness({ bluetooth: bt.bluetooth });
  h2.startRecording('RUN');
  h2.node('#rec-hr-connect').onclick();
  await tick();
  assert.equal(h2.node('#rec-hr-status').textContent, "Couldn't connect to that device.");
  assert.equal(hidden(h2), false);
  assert.deepEqual(h2.alerts, [], 'a status line, not an alert');
  h2.node('#rec-hr-connect').onclick();
  await tick();
  assert.equal(h2.node('#rec-hr-status').textContent, '', 'and a good second try clears it');
});

// MARK: - Letting go

test('closing the screen keeps the device and the readings', async () => {
  const { h, bt } = await connected({ readings: [140, 150] });
  h.closeRecording();
  assert.equal(bt.log.disconnects, 0);
  assert.deepEqual(bt.listening(), { characteristic: 1, device: 1 });
  bt.notify(160);
  h.advance(0);
  h.openRecording();
  assert.equal(overlayText(h), '160 bpmfrom Polar H10');
});

test('Finish keeps the average, the max and the device, once, and lets the device go', async () => {
  const { h, bt } = await connected({ readings: [140, 150, 160] });
  h.closeRecording();
  const finish = h.section.button('Finish').onclick;
  h.fix(0); h.advance(60000); h.fix(300);
  finish();
  finish();
  h.node('#rec-finish').onclick();
  assert.equal(h.outdoor.length, 1, 'saved once');
  assert.equal(h.outdoor[0].averageBpm, 150);
  assert.equal(h.outdoor[0].maxBpm, 160);
  assert.equal(h.outdoor[0].heartRateSource, 'Polar H10');
  const stored = JSON.parse(h.storage.get(KEY.outdoor));
  assert.equal(stored.length, 1);
  assert.deepEqual([stored[0].averageBpm, stored[0].maxBpm, stored[0].heartRateSource], [150, 160, 'Polar H10']);
  assert.equal(bt.log.disconnects, 1, 'released, once');
  assert.deepEqual(bt.listening(), { characteristic: 0, device: 0 });
  assert.equal(bt.log.stopped, 1);
  assert.equal(h.timeouts().length, 0);
  // The review says it in the words, and the device.
  assert.ok(h.node('#review-stats').textContent.includes('Avg 150 · Max 160 bpm'));
  assert.ok(h.node('#review-stats').textContent.includes('from Polar H10'));
  // The run kept the three figures and nothing per second.
  assert.deepEqual(Object.keys(stored[0]).filter((k) => /bpm|heart/i.test(k)).sort(),
    ['averageBpm', 'heartRateSource', 'maxBpm']);
});

test('the run in storage while it records never holds a reading', async () => {
  const { h } = await connected({ readings: [140, 150, 160] });
  h.fix(0); h.advance(60000); h.fix(300);
  const text = h.storage.get(KEY.recording);
  assert.ok(text);
  assert.ok(!/bpm|heart|readings/i.test(text));
});

test('a run with no heart rate keeps none of the three keys', () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth });
  h.startRecording('RUN');
  h.fix(0); h.advance(60000); h.fix(300);
  h.node('#rec-finish').onclick();
  ['averageBpm', 'maxBpm', 'heartRateSource'].forEach((k) => assert.ok(!(k in h.outdoor[0]), k));
  assert.ok(!h.node('#review-stats').textContent.includes('bpm'));
});

test('a device that never spoke leaves no summary, though it was connected', async () => {
  const { h } = await connected();
  h.fix(0); h.advance(60000); h.fix(300);
  h.node('#rec-finish').onclick();
  ['averageBpm', 'maxBpm', 'heartRateSource'].forEach((k) => assert.ok(!(k in h.outdoor[0]), k));
});

test('a Finish whose save fails keeps the run, the device and its readings', async () => {
  const { h, bt } = await connected({ readings: [140, 160] });
  h.fix(0); h.advance(60000); h.fix(300);
  h.failWrites.add(KEY.outdoor);
  h.node('#rec-finish').onclick();
  assert.ok(h.recording, 'the run is not lost');
  assert.equal(h.outdoor.length, 0);
  assert.equal(bt.log.disconnects, 0, 'the strap is still being read');
  assert.equal(h.alerts.length, 1);
  bt.notify(150);
  h.failWrites.clear();
  h.node('#rec-finish').onclick();
  assert.equal(h.outdoor.length, 1);
  assert.deepEqual([h.outdoor[0].averageBpm, h.outdoor[0].maxBpm], [150, 160], '140, 160 and 150 all count');
  assert.equal(bt.log.disconnects, 1);
});

test('Finish declined at "save the time anyway?" keeps the device', async () => {
  const { h, bt } = await connected({ readings: [140], confirmAnswer: false });
  h.node('#rec-finish').onclick();
  assert.ok(h.recording);
  assert.equal(bt.log.disconnects, 0);
});

test('Discard lets the device go and keeps nothing', async () => {
  const { h, bt } = await connected({ readings: [140, 150] });
  h.node('#rec-discard').onclick();
  assert.equal(h.recording, null);
  assert.equal(h.outdoor.length, 0);
  assert.equal(bt.log.disconnects, 1);
  assert.deepEqual(bt.listening(), { characteristic: 0, device: 0 });
  assert.equal(overlayText(h), '');
  assert.equal(h.timeouts().length, 0);
  // The next run starts with no number and none of the last run's readings.
  h.startRecording('WALK');
  assert.equal(overlayText(h), '');
  h.fix(0); h.advance(60000); h.fix(300);
  h.node('#rec-finish').onclick();
  assert.ok(!('averageBpm' in h.outdoor[0]));
});

test('Discard while a reconnect is pending cancels it', async () => {
  const { h, bt } = await connected({ readings: [140] });
  await bt.drop();
  assert.equal(h.timeouts().length, 1);
  h.node('#rec-discard').onclick();
  assert.equal(h.timeouts().length, 0);
  assert.equal(bt.log.connects, 1, 'it never came back for a run that was over');
});

test('a chooser answered after Finish is let go, not kept', async () => {
  let resolve;
  const bt = fakeBluetooth({ chooser: () => new Promise((r) => { resolve = r; }) });
  const h = harness({ bluetooth: bt.bluetooth });
  h.startRecording('RUN');
  h.node('#rec-hr-connect').onclick();
  h.fix(0); h.advance(60000); h.fix(300);
  h.node('#rec-finish').onclick();
  assert.equal(h.outdoor.length, 1);
  resolve(bt.device);
  await tick();
  assert.equal(bt.state.connected, false, 'the late device is not left connected');
  assert.deepEqual(bt.listening(), { characteristic: 0, device: 0 });
  assert.ok(!('averageBpm' in h.outdoor[0]));
});

// MARK: - The setting

test('the Heart rate panel is on Home after Training settings, Automatic or Off, with its footer', () => {
  const html = readFileSync('lift/index.html', 'utf8');
  const training = html.indexOf('<h2>Training settings</h2>');
  const panel = html.indexOf('<h2>Heart rate</h2>');
  const data = html.indexOf('<h2>Your data</h2>');
  assert.ok(training > 0 && panel > training && data > panel, 'between Training settings and Your data');
  assert.ok(html.includes('Chrome and Edge can read a Bluetooth heart rate device. The browser asks you to choose it each time.'));
  assert.ok(html.indexOf('id="heart-rate-mode"') > panel);
  assert.ok(appSource.includes('renderHeartRateSettings();'), 'Home draws it');
});

test('the panel offers Automatic and Off only, Automatic first and on', () => {
  const h = harness();
  h.renderHeartRateSettings();
  const chips = h.node('#heart-rate-mode').all().filter((n) => n.tag === 'button');
  assert.deepEqual(chips.map((c) => c.textContent), ['Automatic', 'Off']);
  assert.ok(chips[0].classes.has('on') && !chips[1].classes.has('on'));
});

test('Off persists, hides the button and connects to nothing', async () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth });
  h.renderHeartRateSettings();
  h.node('#heart-rate-mode').button('Off').onclick();
  assert.equal(h.storage.get(HR_KEY), 'off');
  assert.ok(h.node('#heart-rate-mode').button('Off').classes.has('on'));
  h.startRecording('RUN');
  assert.ok(hidden(h));
  h.node('#rec-hr-connect').onclick();
  assert.deepEqual(bt.log.requestDevice, [], 'even a stray tap asks for nothing');
  h.fix(0); h.advance(60000); h.fix(300);
  h.node('#rec-finish').onclick();
  assert.ok(!('averageBpm' in h.outdoor[0]));
});

test('a stored Off is honored on a reload', () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth, stored: { [KEY.recording]: {
    id: 'r1', activityType: 'RUN', startedAtEpochMs: T0 - 60000, route: [] } } });
  assert.equal(hidden(h), false, 'Automatic by default');
  h.storage.set(HR_KEY, 'off');
  h.updateRecording();
  assert.ok(hidden(h), 'and Off the moment it is stored');
});

test('turning Off mid-run lets the device go and keeps nothing', async () => {
  const { h, bt } = await connected({ readings: [140, 150] });
  h.renderHeartRateSettings();
  h.node('#heart-rate-mode').button('Off').onclick();
  assert.equal(bt.log.disconnects, 1);
  assert.equal(overlayText(h), '');
  assert.ok(hidden(h));
  h.fix(0); h.advance(60000); h.fix(300);
  h.node('#rec-finish').onclick();
  assert.ok(!('averageBpm' in h.outdoor[0]));
});

test('Automatic comes back with a tap and the button returns', async () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth });
  h.storage.set(HR_KEY, 'off');
  h.startRecording('RUN');
  assert.ok(hidden(h));
  h.renderHeartRateSettings();
  h.node('#heart-rate-mode').button('Automatic').onclick();
  assert.ok(!h.storage.has(HR_KEY), 'Automatic is no key');
  assert.equal(hidden(h), false);
});

test('a storage that refuses writes does not stop the setting from working for the page', () => {
  const bt = fakeBluetooth();
  const h = harness({ bluetooth: bt.bluetooth });
  h.failWrites.add(HR_KEY);
  h.renderHeartRateSettings();
  h.node('#heart-rate-mode').button('Off').onclick();
  h.startRecording('RUN');
  assert.ok(!h.alerts.length);
});

// MARK: - The shell

test('the page loads heart-rate.js before app.js, and the service worker caches it', () => {
  const html = readFileSync('lift/index.html', 'utf8');
  const hrAt = html.indexOf('<script src="heart-rate.js"></script>');
  assert.ok(hrAt > 0);
  assert.ok(hrAt < html.indexOf('<script src="app.js"></script>'));
  const sw = readFileSync('lift/sw.js', 'utf8');
  assert.ok(sw.includes("'/lift/heart-rate.js'"));
  assert.match(sw, /const CACHE = 'lift-v66';/);
});
