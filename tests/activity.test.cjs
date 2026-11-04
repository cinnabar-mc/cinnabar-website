const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../activity.js'), 'utf8');
const IDLE_MS = 600_000;

/** Runs the activity gate against a controllable clock, timers, input and visibility. */
function page(hidden = false) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const inputs = {};
  const documentListeners = {};
  const changes = [];
  const document = {hidden, addEventListener: (name, callback) => { documentListeners[name] = callback; }};
  const window = {
    addEventListener(name, callback, options) { inputs[name] = {callback, options}; },
    setTimeout(callback, delay) { timers.set(++nextId, {callback, at: now + delay}); return nextId; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, {document, window, performance: {now: () => now}});
  const activity = window.CINNABAR_ACTIVITY;
  activity.subscribe(active => changes.push(active));
  return {activity, changes, inputs, timers,
    /** Advances the clock, firing due timers in order. */
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
    input(name = 'pointermove') { inputs[name].callback(); },
    visible(value) { document.hidden = !value; documentListeners.visibilitychange(); }};
}

test('a visible tab goes idle after ten minutes without input', () => {
  const p = page();
  assert.equal(p.activity.active(), true);
  p.advance(IDLE_MS - 1);
  assert.equal(p.activity.active(), true);
  assert.deepEqual(p.changes, []);
  p.advance(1);
  assert.equal(p.activity.active(), false);
  assert.deepEqual(p.changes, [false]);
  assert.equal(p.timers.size, 0);
});

test('input postpones idleness without rescheduling a timer per event', () => {
  const p = page();
  p.advance(IDLE_MS - 1000);
  for (let i = 0; i < 50; i++) p.input();
  assert.equal(p.timers.size, 1);
  p.advance(IDLE_MS - 1);
  assert.equal(p.activity.active(), true);
  p.advance(1);
  assert.equal(p.activity.active(), false);
  assert.deepEqual(p.changes, [false]);
});

test('any input after idleness resumes at once and restarts the idle window', () => {
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart', 'focus']) {
    const p = page();
    assert.deepEqual({...p.inputs[name].options}, {capture: true, passive: true});
    p.advance(IDLE_MS);
    p.input(name);
    assert.equal(p.activity.active(), true);
    assert.deepEqual(p.changes, [false, true]);
    p.input(name);
    assert.deepEqual(p.changes, [false, true]);
    p.advance(IDLE_MS);
    assert.deepEqual(p.changes, [false, true, false]);
  }
});

test('hidden tabs are inactive, and showing a tab counts as attention', () => {
  const p = page(true);
  assert.equal(p.activity.active(), false);
  assert.equal(p.timers.size, 0);
  p.input();
  assert.deepEqual(p.changes, []);
  p.visible(true);
  assert.deepEqual(p.changes, [true]);
  p.advance(IDLE_MS);
  assert.deepEqual(p.changes, [true, false]);
  p.visible(false);
  p.visible(true);
  assert.equal(p.activity.active(), true);
  assert.deepEqual(p.changes, [true, false, false, true]);
  p.visible(false);
  assert.equal(p.timers.size, 0);
  p.advance(IDLE_MS * 3);
  assert.equal(p.activity.active(), false);
  assert.deepEqual(p.changes, [true, false, false, true, false]);
});
