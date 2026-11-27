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

function setupSystemClock() {
  const requests = [];
  const clock = createDesktopClock({performance: {now: () => 100}}, (id, _, epoch) => {
    requests.push({id, epoch});
  });
  return {clock, requests};
}

test('a discarded in-flight frame cannot stall the clock after system resume', () => {
  const {clock, requests} = setupSystemClock();
  let calls = 0;
  const animate = () => { calls++; clock.request(animate); };
  clock.request(animate);
  const old = requests[0];
  clock.setSystemSuspended(true, 1);
  clock.tick(old.id, old.epoch);
  assert.equal(calls, 0);
  clock.setSystemSuspended(false, 2);
  const current = requests[1];
  assert.equal(current.epoch, 2);
  clock.tick(current.id, 0);
  assert.equal(calls, 0);
  clock.tick(current.id, current.epoch);
  assert.equal(calls, 1);
  assert.equal(requests.length, 3);
});

test('system suspension blocks one-shot redraws while manual pause permits them', () => {
  const {clock, requests} = setupSystemClock();
  clock.setRunning(false);
  clock.request(() => {});
  clock.redraw();
  assert.equal(requests.length, 1);
  clock.setSystemSuspended(true, 1);
  clock.redraw();
  assert.equal(requests.length, 1);
});

test('resume replays one deferred redraw and keeps manual pause', () => {
  const {clock, requests} = setupSystemClock();
  let calls = 0;
  const animate = () => { calls++; clock.request(animate); };
  clock.setRunning(false);
  clock.setSystemSuspended(true, 1);
  clock.request(animate);
  clock.redraw();
  clock.redraw();
  clock.setSystemSuspended(false, 2);
  assert.equal(requests.length, 1);
  clock.tick(requests[0].id, requests[0].epoch);
  assert.equal(calls, 1);
  assert.equal(requests.length, 1);
});

test('a newer awake snapshot supersedes its missing suspend event and ignores old epochs', () => {
  const {clock, requests} = setupSystemClock();
  clock.request(() => {});
  clock.setSystemSuspended(false, 2);
  assert.deepEqual(requests.map(request => request.epoch), [0, 2]);
  clock.setSystemSuspended(true, 1);
  clock.setSystemSuspended(false, 0);
  clock.tick(requests[1].id, 2);
  clock.request(() => {});
  assert.deepEqual(requests.map(request => request.epoch), [0, 2, 2]);
});
