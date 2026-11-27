import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEpochRequest, subscribeSystemSuspend} from '../dist/desktop-suspend.js';

test('an event observed while fetching the snapshot supersedes the older snapshot', async () => {
  let listener;
  const observed = [];
  const unlisten = () => {};
  const tauri = {
    event: {
      async listen(name, handler) {
        assert.equal(name, 'system-suspend');
        listener = handler;
        return unlisten;
      },
    },
    core: {
      async invoke() {
        listener({payload: {suspended: true, epoch: 1}});
        return {suspended: false, epoch: 0};
      },
    },
  };
  await subscribeSystemSuspend(tauri, value => observed.push(value), cleanup => assert.equal(cleanup, unlisten));
  listener({payload: {suspended: true, epoch: 1}});
  listener({payload: {suspended: false, epoch: 2}});
  assert.deepEqual(observed, [{suspended: true, epoch: 1}, {suspended: false, epoch: 2}]);
});

test('a late old layout invocation cannot block or replace the resume refresh', () => {
  const requests = createEpochRequest();
  const old = requests.begin(0);
  assert.equal(requests.begin(0), null);
  const resumed = requests.begin(2);
  assert.ok(resumed);
  assert.equal(requests.isCurrent(old), false);
  requests.finish(old);
  assert.equal(requests.isCurrent(resumed), true);
  assert.equal(requests.begin(2), null);
  requests.finish(resumed);
  assert.ok(requests.begin(2));
});

test('the Tauri original waits for the snapshot, suspends its rAF, and keeps manual pause', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {style: {}, classList: {toggle() {}}, addEventListener() {},
        setAttribute() {}, append() {}});
    }
    return elements.get(id);
  }

  let deliver, resolveSnapshot, pagehide, disposed = false, serial = 0;
  const frames = new Map();
  Object.assign(globalThis, {
    window: globalThis, self: globalThis, top: globalThis,
    innerWidth: 1363, innerHeight: 936, devicePixelRatio: 1,
    document: {
      getElementById: element, querySelectorAll: () => [],
      createElement: () => ({style: {}, addEventListener() {}, setAttribute() {}, getContext() { return null; }}),
      addEventListener() {}, body: element('body'),
    },
    addEventListener(type, handler) { if (type === 'pagehide') pagehide = handler; },
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    __TAURI__: {
      event: {
        async listen(_, handler) {
          deliver = snapshot => handler({payload: snapshot});
          return () => { disposed = true; };
        },
      },
      core: {
        invoke() { return new Promise(resolve => { resolveSnapshot = resolve; }); },
      },
    },
  });

  const previousConsoleError = console.error;
  console.error = () => {};
  try { await import('../dist/app.js'); }
  finally { console.error = previousConsoleError; }

  assert.equal(frames.size, 0);
  resolveSnapshot({suspended: true, epoch: 1});
  await Promise.resolve();
  assert.equal(frames.size, 0);
  window.__spider.state.paused = true;
  deliver({suspended: false, epoch: 2});
  assert.equal(frames.size, 1);
  assert.equal(window.__spider.state.paused, true);
  deliver({suspended: true, epoch: 3});
  assert.equal(frames.size, 0);
  deliver({suspended: false, epoch: 4});
  assert.equal(frames.size, 1);
  pagehide();
  assert.equal(frames.size, 0);
  assert.equal(disposed, true);
});
