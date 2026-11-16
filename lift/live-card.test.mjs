import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { O, appSource, KEY, T0, harness } from './live-harness.mjs';


// The run lives in app.js, not in the overlay: closing the overlay hides a
// screen and ends nothing, and the card on Train is the run while it records.
// app.js is one script that talks to the page as it loads, so it cannot be
// imported. As live-session.test.mjs and plan-sides.test.mjs do, this lifts
// the outdoor section out of app.js *as it is now* and runs it against
// stand-ins for the page, the clock, storage and the GPS, so these cases read
// the code that ships rather than a copy of it.
//
// What a lesson from LIFT for iPhone and Android looks like here:
//   - a run with no fix reads 0:00 and a dash, never NaN or a negative;
//   - the card always offers Open and Finish, and Finish works with the
//     overlay closed;
//   - Finish saves exactly once;
//   - a reload brings the run back as the card, not the overlay.


const RECORDING_TITLE = (label) => `Recording · ${label}`;

// MARK: - Starting, and only once

test('starting a run opens the overlay and watches the GPS once', () => {
  const h = harness();
  assert.equal(h.startRecording('RUN'), true);
  assert.equal(h.overlayOpen(), true);
  assert.equal(h.watchers.length, 1);
  assert.equal(h.recording.activityType, 'RUN');
});

test('startRecording refuses a second run', () => {
  const h = harness();
  h.startRecording('RUN');
  const first = h.recording;
  assert.equal(h.startRecording('WALK'), false);
  assert.equal(h.recording, first, 'the run that is recording is untouched');
  assert.equal(h.recording.activityType, 'RUN');
  assert.equal(h.watchers.length, 1, 'never a second tracker');
  assert.equal(h.activeTimers(), 1);
});

test('Run, Walk and Hike are disabled while a run records, and the card says which one', () => {
  const h = harness();
  h.renderOutdoor();
  const starts = () => ['Run', 'Walk', 'Hike'].map((label) => h.section.button(label));
  assert.ok(starts().every((b) => b && !b.disabled), 'all three start a run when none records');
  h.startRecording('HIKE');
  h.closeRecording();
  assert.ok(starts().every((b) => b && b.disabled), 'all three are off while one records');
  assert.deepEqual(h.cardTitle().filter((t) => t.startsWith('Recording')), [RECORDING_TITLE('Hike')]);
});

// MARK: - Closing the overlay ends nothing

test('closing the overlay keeps the watch', () => {
  const h = harness();
  h.startRecording('RUN');
  const timers = h.activeTimers();
  h.closeRecording();
  assert.equal(h.overlayOpen(), false);
  assert.deepEqual(h.cleared, [], 'clearWatch is never called by closing');
  assert.equal(h.activeTimers(), timers, 'the timer keeps running');
  assert.equal(h.wake().released, 0, 'the screen is still held on');
  assert.ok(h.recording, 'the run is still recording');
  assert.ok(h.storage.has(KEY.recording), 'and still kept in storage');
});

test('Back to LIFT is on the overlay and closes it without ending the run', () => {
  const html = readFileSync('lift/index.html', 'utf8');
  assert.match(html, /<button[^>]*id="rec-close"[^>]*>Back to LIFT<\/button>/);
  const wired = appSource.includes("$('#rec-close').onclick = closeRecording");
  assert.ok(wired, 'Back to LIFT calls closeRecording');
});

test('Back to LIFT puts focus on the card\'s Open button, not the page body', () => {
  const h = harness();
  h.renderOutdoor();
  h.startRecording('RUN');
  h.closeRecording();
  const open = h.section.button('Open');
  assert.ok(open, 'the live card is drawn');
  assert.equal(h.focused(), open, 'the re-rendered Open button, not the detached opener');
});

test('a GPS error reads Looking for GPS\u2026 with the ellipsis character', () => {
  const h = harness();
  h.startRecording('RUN');
  h.watchers[0].err({ code: 2 });
  assert.equal(h.node('#rec-status').textContent, 'Looking for GPS\u2026');
});

test('the card does not add a sentence of its own about which run records', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  assert.ok(!/is recording\. Open it/.test(h.sectionText()));
});

test('the card and the overlay reopen each other without a second watch', () => {
  const h = harness();
  h.startRecording('WALK');
  h.closeRecording();
  h.openRecording();
  assert.equal(h.overlayOpen(), true);
  h.closeRecording();
  h.openRecording();
  assert.equal(h.watchers.length, 1);
  assert.deepEqual(h.cleared, []);
});

test('switching light and dark while the overlay is closed neither stops nor reopens the run', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  h.appearanceChanged();
  assert.equal(h.overlayOpen(), false);
  assert.ok(h.recording);
  assert.deepEqual(h.cleared, []);
});

// MARK: - The card

test('the card is titled Recording · <type>, with Open and Finish, and replaces Last route', () => {
  const h = harness({ stored: { [KEY.outdoor]: [{
    id: 'old', activityType: 'RUN', startedAtEpochMs: T0 - 86400000, endedAtEpochMs: T0 - 86400000 + 600000,
    distanceMeters: 1500, elevationGainMeters: 0, route: [[30, -97, null, 0, 5], [30.01, -97, null, 60, 5]] }] } });
  h.renderOutdoor();
  assert.ok(h.cardTitle().includes('Last route'), 'before a run, Last route');
  h.startRecording('WALK');
  h.closeRecording();
  assert.ok(h.cardTitle().includes(RECORDING_TITLE('Walk')));
  assert.ok(!h.cardTitle().includes('Last route'), 'the live card stands in its place');
  assert.ok(h.section.button('Open'));
  assert.ok(h.section.button('Finish'));
});

test('under the live card: LIFT records only while this page is on screen.', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  assert.ok(h.sectionText().includes('LIFT records only while this page is on screen.'));
});

test('the card leaves an empty slot for what a later change adds', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  const [slot] = h.section.querySelectorAll('.liveextras');
  assert.ok(slot, 'liveExtras slot');
  assert.equal(slot.children.length, 0);
});

test('Open brings the overlay back', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  h.section.button('Open').onclick();
  assert.equal(h.overlayOpen(), true);
});

test('a run with no fix reads 0:00, 0.00 mi and a dash, and the route says it is waiting', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  assert.deepEqual(h.cardStats(), ['0:00', '0.00 mi', '—']);
  assert.ok(!/NaN|undefined|Infinity/.test(h.sectionText()));
  const canvas = h.section.querySelectorAll('canvas')[0];
  assert.deepEqual(canvas.texts, [O.WAITING_FOR_GPS]);
  // And a clock set back mid-run never shows a negative time.
  h.advance(-60000);
  assert.deepEqual(h.cardStats(), ['0:00', '0.00 mi', '—']);
});

test('the card and the overlay show the same numbers', () => {
  const h = harness();
  h.startRecording('RUN');
  h.fix(0);
  h.advance(60000);
  h.fix(120);
  h.advance(1000);
  h.closeRecording();
  const overlay = ['#rec-time', '#rec-distance', '#rec-pace'].map((s) => h.node(s).textContent);
  assert.deepEqual(h.cardStats(), overlay);
  const stats = O.liveStats(h.recording.route, h.recording.startedAtEpochMs, h.now());
  assert.equal(overlay[0], O.durationText(stats.elapsedMs));
  assert.equal(overlay[1], O.distanceText(stats.distanceMeters, 'miles'));
  assert.equal(overlay[2], O.paceText(stats.paceSecondsPerMeter, 'miles'));
  assert.notEqual(overlay[2], '—', 'a pace once it has gone past ten meters');
});

test('fixes that arrive while the overlay is closed move the card', () => {
  const h = harness();
  h.startRecording('RUN');
  h.closeRecording();
  h.fix(0);
  h.advance(10000);
  h.fix(200);
  h.advance(1000);
  const [time, distance] = h.cardStats();
  assert.equal(time, '0:11');
  assert.equal(distance, '0.12 mi');
});

// MARK: - A reload

test('a reloaded recording comes back as the card, not the overlay', () => {
  const recording = { id: 'r1', activityType: 'WALK', startedAtEpochMs: T0 - 120000,
    route: [[30, -97, null, 0, 5], [30.001, -97, null, 60, 5]] };
  const h = harness({ stored: { [KEY.recording]: recording } });
  assert.equal(h.overlayOpen(), false, 'the overlay stays closed over whatever tab the person is on');
  assert.ok(h.cardTitle().includes(RECORDING_TITLE('Walk')), 'the card is drawn');
  assert.equal(h.watchers.length, 1, 'the watch is picked up again');
  assert.equal(h.activeTimers(), 1);
  assert.equal(h.recording.route.length, 2, 'and keeps adding to the same route');
});

test('a stored recording that is not a recording is dropped', () => {
  const h = harness({ stored: { [KEY.recording]: { nonsense: true } } });
  assert.equal(h.recording, null);
  assert.equal(h.watchers.length, 0);
});

// MARK: - Finishing

function runOf(h, meters = 300) {
  h.startRecording('RUN');
  h.fix(0);
  h.advance(60000);
  h.fix(meters);
  h.advance(1000);
}

test('Finish from the card works with the overlay closed, and Last route takes its place', () => {
  const h = harness();
  runOf(h);
  h.closeRecording();
  h.section.button('Finish').onclick();
  assert.equal(h.outdoor.length, 1);
  assert.equal(h.recording, null);
  assert.ok(!h.storage.has(KEY.recording));
  assert.deepEqual(h.cleared, [1], 'the watch is let go');
  assert.equal(h.activeTimers(), 0);
  assert.ok(h.cardTitle().includes('Last route'));
  assert.ok(!h.cardTitle().some((t) => t.startsWith('Recording')));
  assert.equal(h.reviewOpen(), true, 'and the review opens for what was saved');
  assert.ok(['Run', 'Walk', 'Hike'].every((l) => !h.section.button(l).disabled), 'a new run can start');
});

test('Finish saves exactly once; a second call is silently ignored', () => {
  const h = harness();
  runOf(h);
  h.closeRecording();
  const finish = h.section.button('Finish').onclick;
  finish();
  finish();
  h.node('#rec-finish').onclick();
  assert.equal(h.outdoor.length, 1);
  assert.equal(JSON.parse(h.storage.get(KEY.outdoor)).length, 1);
  assert.deepEqual(h.confirms, []);
  assert.equal(h.alerts.length, 0);
});

test('Finish from the overlay saves the same run', () => {
  const h = harness();
  runOf(h);
  h.node('#rec-finish').onclick();
  assert.equal(h.outdoor.length, 1);
  assert.equal(h.overlayOpen(), false);
  assert.equal(h.outdoor[0].activityType, 'RUN');
  assert.ok(h.outdoor[0].distanceMeters > 290 && h.outdoor[0].distanceMeters < 310);
});

test('a run with no route asks before saving only the time, and No keeps recording', () => {
  const h = harness({ confirmAnswer: false });
  h.startRecording('RUN');
  h.closeRecording();
  h.section.button('Finish').onclick();
  assert.equal(h.confirms.length, 1);
  assert.equal(h.outdoor.length, 0);
  assert.ok(h.recording, 'still recording');
  assert.deepEqual(h.cleared, []);
  assert.ok(h.section.button('Finish') && h.section.button('Open'), 'and the card still offers both');
});

test('a save that fails keeps the run, the watch and the card', () => {
  const h = harness();
  runOf(h);
  h.closeRecording();
  h.failWrites.add(KEY.outdoor);
  h.section.button('Finish').onclick();
  assert.ok(h.recording, 'the run is not lost');
  assert.equal(h.outdoor.length, 0);
  assert.deepEqual(h.cleared, []);
  assert.equal(h.activeTimers(), 1);
  assert.ok(h.storage.has(KEY.recording));
  assert.equal(h.alerts.length, 1, 'and the person is told');
  assert.ok(/still recording/i.test(h.alerts[0]));
  h.failWrites.clear();
  h.section.button('Finish').onclick();
  assert.equal(h.outdoor.length, 1, 'Finish works once the write can');
});

// MARK: - Discarding

test('Discard ends the run only when confirmed', () => {
  const h = harness({ confirmAnswer: false });
  h.startRecording('RUN');
  h.node('#rec-discard').onclick();
  assert.ok(h.recording);
  assert.deepEqual(h.cleared, []);
  h.state.confirmAnswer = true;
  h.node('#rec-discard').onclick();
  assert.equal(h.recording, null);
  assert.equal(h.outdoor.length, 0);
  assert.deepEqual(h.cleared, [1]);
  assert.equal(h.overlayOpen(), false);
  assert.ok(!h.cardTitle().some((t) => t.startsWith('Recording')));
});

// MARK: - Nothing else stops it

test('only Finish and Discard stop the watch', () => {
  const stops = appSource.match(/\bstopWatching\(\)/g) || [];
  // The definition, Finish's call and Discard's call.
  assert.equal(stops.length, 3, 'stopWatching is called from exactly two places');
  assert.equal((appSource.match(/clearWatch\(/g) || []).length, 1);
});
