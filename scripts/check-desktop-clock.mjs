import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopClock} from '../dist/desktop-clock.js';

function setup() {
  const requests = [];
  let now = 100;
  const clock = createDesktopClock({performance: {now: () => now}}, id => requests.push(id));
  return {clock, requests, time(value) { now = value; }, tick() { clock.tick(requests.at(-1)); }};
}

test('native delivery uses the iframe clock and coalesces a callback batch', () => {
  const {clock, requests, tick} = setup();
  const calls = [];
  clock.request(time => calls.push(time));
  clock.request(time => calls.push(time));
  assert.equal(requests.length, 1);
  tick();
  assert.deepEqual(calls, [100, 100]);
  assert.equal(requests.length, 1);
});

test('a delayed or duplicate native event cannot advance a later frame', () => {
  const {clock, requests, tick} = setup();
  let calls = 0;
  const animate = () => { calls++; clock.request(animate); };
  clock.request(animate);
  const old = requests[0];
  tick();
  assert.equal(calls, 1);
  clock.tick(old);
  assert.equal(calls, 1);
  tick();
  assert.equal(calls, 2);
  clock.dispose();
});

test('cancellation, including within a batch, and disposal release callbacks', () => {
  const {clock, tick} = setup();
  let calls = 0;
  clock.request(() => clock.cancel(second));
  const second = clock.request(() => calls++);
  tick();
  assert.equal(calls, 0);
  const third = clock.request(() => calls++);
  clock.cancel(third);
  tick();
  clock.request(() => calls++);
  clock.dispose();
  tick();
  assert.equal(calls, 0);
});

test('suspension drains at most one frame and resuming retains the pending animation', () => {
  const {clock, requests, tick, time} = setup();
  const calls = [];
  const animate = now => { calls.push(now); clock.request(animate); };
  clock.request(animate);
  clock.setRunning(false);
  tick();
  assert.deepEqual(calls, [100]);
  assert.equal(requests.length, 1);
  time(10000);
  clock.setRunning(true);
  assert.equal(requests.length, 2);
  tick();
  assert.deepEqual(calls, [100, 10000]);
  clock.dispose();
});

test('a settings redraw while suspended does not restart continuous rendering', () => {
  const {clock, requests, tick} = setup();
  let calls = 0;
  clock.setRunning(false);
  const animate = () => { calls++; clock.request(animate); };
  clock.request(animate);
  assert.equal(requests.length, 0);
  clock.redraw();
  clock.redraw();
  assert.equal(requests.length, 1);
  tick();
  assert.equal(calls, 1);
  assert.equal(requests.length, 1);
  clock.redraw();
  tick();
  assert.equal(calls, 2);
  clock.dispose();
});
