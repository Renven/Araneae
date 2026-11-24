import assert from 'node:assert/strict';
import {Vector2, Vector3, Plane, Raycaster} from '../dist/assets/three.module.js';
import {desktopBounds, contains} from '../dist/desktop-routing.js';
import {DesktopBehavior} from '../dist/desktop-behavior.js';
import {createContentBounds, chooseViewport} from '../dist/desktop-viewport.js';

// The existing gait checks use this same minimal DOM harness to run the actual app.
// No motion, gait, model or desktop-routing implementation is mocked.
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {style: {}, value: '', textContent: '', classList: {toggle() {}},
    addEventListener() {}, setAttribute() {}, append() {}});
  return elements.get(id);
};
const listeners = new Map();
globalThis.innerWidth = 3360;
globalThis.innerHeight = 1080;
globalThis.devicePixelRatio = 1;
globalThis.window = globalThis;
globalThis.addEventListener = (type, callback) => listeners.set(type, callback);
globalThis.document = {getElementById: element, querySelectorAll: () => [],
  createElement: () => ({style: {}, events: {}, addEventListener(type, callback) {this.events[type] = callback;},
    setAttribute() {}, getContext: () => ({}), animate() {return {};}, remove() {}}),
  addEventListener: (type, callback) => listeners.set(type, callback), body: element('body')};
let timestamp = 0;
Object.defineProperty(globalThis, 'performance', {value: {now: () => timestamp}});
let frame;
globalThis.requestAnimationFrame = callback => { frame = callback; };
let seed = 123456;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const originalError = console.error;
console.error = () => {};
await import('../dist/app.js');
console.error = originalError;
const spider = window.__spider;
const ray = new Raycaster();
const floor = new Plane(new Vector3(0, 1, 0), 0);
const measure = createContentBounds(spider.scene, spider.camera);
function assertVisibleVertices(bounds, viewport) {
  const world = new Vector3(), projected = new Vector3(), shadow = new Vector3();
  const include = point => {
    projected.copy(point).project(spider.camera);
    const x = bounds.x + (projected.x + 1) * bounds.width / 2;
    const y = bounds.y + (1 - projected.y) * bounds.height / 2;
    assert(x >= viewport.x && x <= viewport.x + viewport.width
      && y >= viewport.y && y <= viewport.y + viewport.height, 'Visible geometry or its shadow was cropped');
  };
  spider.scene.traverseVisible(object => {
    if (!object.geometry || object.material?.isShadowMaterial) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      world.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      include(world);
      if (object.castShadow) {
        const height = -.5 - world.y;
        include(shadow.set(world.x - .4 * height, -.5, world.z + .36 * height));
      }
    }
  });
}
const screen = (x, y, width, height) => ({frame: {x, y, width, height}, workArea: {x, y: y + 28, width, height: height - 28}});

for (const [name, screens, mode, speed = 1.25] of [
  ['horizontal-roam', [screen(0, 0, 1440, 900), screen(1440, -180, 1920, 1080)], 'roam'],
  ['vertical-roam', [screen(0, 0, 1440, 900), screen(-300, -1080, 1920, 1080)], 'roam'],
  ['horizontal-follow', [screen(0, 0, 1440, 900), screen(-1920, 0, 1920, 1080)], 'follow'],
  ['high-speed-staggered-roam', [screen(0, 0, 1440, 900), screen(1440, -180, 1920, 1080)], 'roam', 3],
  ['high-speed-follow', [screen(0, 0, 1440, 900), screen(-1920, 0, 1920, 1080)], 'follow', 3],
]) {
  const bounds = desktopBounds(screens);
  delete window.__spiderDesktop;
  globalThis.innerWidth = bounds.width;
  globalThis.innerHeight = bounds.height;
  listeners.get('resize')();
  const worldPoint = point => {
    ray.setFromCamera(new Vector2((point.x - bounds.x) / bounds.width * 2 - 1,
      1 - (point.y - bounds.y) / bounds.height * 2), spider.camera);
    return ray.ray.intersectPlane(floor, new Vector3());
  };
  const project = world => {
    const p = world.clone().project(spider.camera);
    return {x: bounds.x + (p.x + 1) * bounds.width / 2, y: bounds.y + (1 - p.y) * bounds.height / 2};
  };
  const globalPoint = () => project(spider.position);
  spider.position.copy(worldPoint({x: 700, y: 450}));
  spider.velocity.set(0, 0, 0);
  spider.state.mode = mode;
  spider.state.speed = speed;
  spider.cancelManual();
  spider.patrol.beginTravel('long');
  spider.legs.forEach(leg => { leg.initialized = false; leg.stepping = false; });
  const behavior = new DesktopBehavior(spider, screens, false, project, worldPoint, bounds);
  window.__spiderDesktop = behavior;
  let viewport, measuredFrames = 0, nativeMoves = 0, surfaceResizes = 0;
  const targetScreen = screens[1].frame;
  const pointer = {x: targetScreen.x + targetScreen.width / 2, y: targetScreen.y + targetScreen.height / 2};
  behavior.pointer = pointer;
  if (mode === 'roam') spider.goal.copy(behavior.chooseGoal('long'));
  const looksBefore = spider.patrol.completedLooks;
  const phases = new Set(), legs = new Set();
  let maxHeadYaw = 0;
  let recoveryFrames = 0;
  let peakSpeed = 0;
  const initialSkids = spider.motion.skidSequence;
  spider.renderer.render = () => {
    const next = chooseViewport(measure(bounds), viewport, globalPoint(), spider.state.size);
    if (viewport && (next.x !== viewport.x || next.y !== viewport.y)) nativeMoves++;
    if (viewport && (next.width !== viewport.width || next.height !== viewport.height)) surfaceResizes++;
    viewport = next;
    if (measuredFrames++ % 200 === 0) assertVisibleVertices(bounds, viewport);
  };
  const visited = new Set();
  let plantedChecks = 0;
  let maxDisplacement = 0;
  for (let index = 0; index < 3600; index++) {
    const before = spider.position.clone();
    const slidingBefore = spider.motion.skid?.stage === 'slide';
    const old = spider.legs.map(leg => ({ready: leg.initialized, air: leg.stepping, foot: leg.foot.clone()}));
    timestamp += 1000 / 60;
    frame(timestamp);
    assert(spider.diagnostics.finite, `${name}: nonfinite pose`);
    assert(spider.legs.filter(leg => leg.stepping).length <= 4, `${name}: lost support set`);
    maxDisplacement = Math.max(maxDisplacement, before.distanceTo(spider.position));
    assert(before.distanceTo(spider.position) < 40, `${name}: position teleported`);
    assert(screens.some(display => contains(display.frame, globalPoint())), `${name}: walked into an invisible desktop notch`);
    spider.legs.forEach((leg, i) => {
      if (old[i].ready && !old[i].air && !leg.stepping && !slidingBefore && spider.motion.skid?.stage !== 'slide') {
        assert(old[i].foot.distanceTo(leg.foot) < 1e-6, `${name}: planted foot slid during a crossing`);
        plantedChecks++;
      }
    });
    screens.forEach((display, i) => { if (contains(display.frame, globalPoint())) visited.add(i); });
    phases.add(spider.patrol.phase); legs.add(spider.patrol.leg);
    if (spider.motion.skid?.stage === 'recover') recoveryFrames++;
    peakSpeed = Math.max(peakSpeed, spider.velocity.length());
    maxHeadYaw = Math.max(maxHeadYaw, Math.abs(spider.appearance.head.rotation.y));
  }
  assert.equal(visited.size, 2, `${name}: did not reach both displays`);
  assert.equal(surfaceResizes, 0, `${name}: resized the surface while walking`);
  if (mode === 'roam') {
    assert(spider.patrol.completedLooks > looksBefore + 1, `${name}: routing suppressed patrol observations`);
    assert(legs.has('short') && legs.has('long'), `${name}: routing suppressed short/long patrol legs`);
    assert(phases.has('left') && phases.has('right') && maxHeadYaw > .28, `${name}: head did not observe both sides`);
  }
  if (mode === 'follow' && speed === 3) assert(recoveryFrames > 0,
    `Follow routing did not complete inertia recovery: ${JSON.stringify({peakSpeed, skids: spider.motion.skidSequence - initialSkids,
      phase: spider.motion.phase, position: globalPoint(), goal: project(spider.goal), path: behavior.navigator.points})}`);
  console.log(JSON.stringify({scenario: name, displaysVisited: visited.size, plantedChecks,
    maxDisplacement: +maxDisplacement.toFixed(3), nativeMoves, surfaceResizes, viewport,
    completedLooks: spider.patrol.completedLooks - looksBefore, recoveryFrames, phases: [...phases]}));
}

for (const size of [.35, 2.1]) {
  spider.state.size = size;
  spider.state.speed = 3;
  const bounds = {x: 0, y: 0, width: innerWidth, height: innerHeight};
  spider.renderer.render = () => {
    const projected = spider.position.clone().project(spider.camera);
    const anchor = {x: (projected.x + 1) * bounds.width / 2, y: (1 - projected.y) * bounds.height / 2};
    const viewport = chooseViewport(measure(bounds), null, anchor, size);
    assertVisibleVertices(bounds, viewport);
  };
  for (let index = 0; index < 20; index++) { timestamp += 1000 / 60; frame(timestamp); }
  console.log(JSON.stringify({scenario: 'model-crop-at-size-extremes', size, frames: 20}));
}

spider.state.paused = true;
timestamp += 1000 / 60;
frame(timestamp);
const pausedFrame = spider.diagnostics.frameCount;
timestamp += 30000;
// The adapter dispatches this original handler before restarting its clock.
listeners.get('visibilitychange')();
spider.state.paused = false;
timestamp += 1000 / 60;
frame(timestamp);
assert(spider.diagnostics.frameCount - pausedFrame <= 3, 'Resume replayed suspended time as motion');
console.log(JSON.stringify({scenario: 'pause-resume-without-motion-catch-up',
  resumedSimulationSteps: spider.diagnostics.frameCount - pausedFrame}));

// Exercise real input callbacks with the same desktop hooks used in WKWebView.
{
  delete window.__spiderDesktop;
  const screens = [screen(0, 0, 1440, 900), screen(1440, -180, 1920, 1080)];
  const bounds = desktopBounds(screens);
  globalThis.innerWidth = bounds.width; globalThis.innerHeight = bounds.height;
  listeners.get('resize')();
  const project = world => {
    const p = world.clone().project(spider.camera);
    return {x: bounds.x + (p.x + 1) * bounds.width / 2, y: bounds.y + (1 - p.y) * bounds.height / 2};
  };
  const unproject = point => {
    ray.setFromCamera(new Vector2((point.x - bounds.x) / bounds.width * 2 - 1,
      1 - (point.y - bounds.y) / bounds.height * 2), spider.camera);
    return ray.ray.intersectPlane(floor, new Vector3());
  };
  spider.state.mode = 'roam'; spider.state.size = 1.5; spider.state.speed = .4;
  spider.cancelManual(); spider.position.copy(unproject({x: 2200, y: 420})); spider.velocity.set(0, 0, 0);
  spider.legs.forEach(leg => {leg.initialized = false; leg.stepping = false;});
  const behavior = new DesktopBehavior(spider, screens, false, project, unproject, bounds);
  window.__spiderDesktop = behavior;
  let dustFrames = 0;
  spider.renderer.render = () => {
    const viewport = chooseViewport(measure(bounds), null, project(spider.position), spider.state.size);
    assertVisibleVertices(bounds, viewport);
    spider.scene.traverseVisible(object => {
      if (object.renderOrder === 2 && object.material?.opacity > .005) dustFrames++;
    });
  };
  const step = () => {timestamp += 1000 / 60; frame(timestamp); assert(spider.diagnostics.finite);};
  const command = (point, fast) => {
    const event = {clientX: point.x - bounds.x, clientY: point.y - bounds.y, button: 0,
      target: {closest: () => null}, preventDefault() {}};
    spider.renderer.domElement.events.pointerdown(event);
    if (fast) {
      spider.renderer.domElement.events.pointerdown(event);
      spider.renderer.domElement.events.dblclick(event);
    }
  };
  const arrive = () => {
    let slid = false, anchors, anchoredChecks = 0;
    for (let index = 0; index < 500; index++) {
      step();
      assert(screens.some(display => contains(display.frame, project(spider.position))), 'Manual skid left visible displays');
      slid ||= spider.motion.skid?.stage === 'slide';
      if (spider.motion.skid?.frontAnchors) anchors = spider.motion.skid.frontAnchors;
      if (anchors) for (const anchor of anchors) {
        assert(spider.legs[anchor.i].foot.distanceTo(anchor.point) < 1e-6, 'Desktop recovery moved a front anchor');
        anchoredChecks++;
      }
      if (index > 3 && !spider.sprinting && !spider.motion.arriving && spider.velocity.length() < .1
        && (spider.motion.isAtGoal(spider.goal, spider.state.size) || spider.position.distanceTo(spider.goal) < 26)) {
        return {slid, anchoredChecks};
      }
    }
    assert.fail('Desktop manual destination did not settle');
  };
  command({x: 2850, y: 420}, true);
  step();
  const requested = spider.goal.clone();
  assert.equal(spider.sprinting, true);
  const dash = arrive();
  assert(dash.slid && dash.anchoredChecks > 10 && dustFrames > 0, 'Desktop dash lost skid, grip or dust');
  assert(spider.goal.distanceTo(requested) < 1e-6, 'Desktop routing replaced the dash destination');
  assert.equal(spider.state.speed, .4, 'Desktop dash overwrote the saved walking speed');
  command({x: 2500, y: 420}, true); step();
  command({x: 2650, y: 420}, false); step();
  assert.equal(spider.sprinting, false, 'Single click failed to interrupt the desktop dash');
  command({x: 3100, y: 430}, true);
  const edge = arrive();
  const stopped = project(spider.position);
  const area = screens[1].workArea;
  assert(stopped.x < area.x + area.width - 84 * spider.state.size, 'Dash ignored the screen-edge recovery allowance');
  // Manual ownership is explicit; it is not inferred from the render clock.
  spider.cancelManual();
  spider.state.mode = 'roam';
  behavior.manualCommand(unproject({x: 2600, y: 420}));
  const manualGoal = behavior.updateGoal({autonomous: false, manual: true});
  assert(manualGoal.distanceTo(unproject({x: 2600, y: 420})) < 1e-6);
  assert.equal(behavior.manualActive, true);
  command({x: 2500, y: 420}, true); step();
  behavior.relocate({x: 700, y: 420});
  assert.equal(spider.sprinting, false, 'Explicit relocation failed to cancel a manual dash');
  assert(behavior.routing && behavior.navigator.points.length > 1);
  console.log(JSON.stringify({scenario: 'desktop-manual-dash', dash, edge, dustFrames,
    speedRestored: spider.state.speed, clickInterrupted: true, relocationInterrupted: true}));
}

for (const [name, screens, speed, fast] of [
  ['manual-horizontal-slow', [screen(0, 0, 1440, 900), screen(1440, -180, 1920, 1080)], .35, false],
  ['manual-vertical-dash', [screen(0, 0, 1440, 900), screen(-300, -1080, 1920, 1080)], .4, true],
  ['manual-negative-origin-dash', [screen(0, 0, 1440, 900), screen(-1920, 0, 1920, 1080)], 1.25, true],
]) {
  spider.cancelManual(); delete window.__spiderDesktop;
  const bounds = desktopBounds(screens);
  globalThis.innerWidth = bounds.width; globalThis.innerHeight = bounds.height;
  listeners.get('resize')();
  const project = world => {
    const p = world.clone().project(spider.camera);
    return {x: bounds.x + (p.x + 1) * bounds.width / 2, y: bounds.y + (1 - p.y) * bounds.height / 2};
  };
  const unproject = point => {
    ray.setFromCamera(new Vector2((point.x - bounds.x) / bounds.width * 2 - 1,
      1 - (point.y - bounds.y) / bounds.height * 2), spider.camera);
    return ray.ray.intersectPlane(floor, new Vector3());
  };
  spider.position.copy(unproject({x: 650, y: 450})); spider.velocity.set(0, 0, 0);
  spider.state.mode = 'roam'; spider.state.size = 1.5; spider.state.speed = speed;
  spider.cancelManual(); spider.legs.forEach(leg => {leg.initialized = false; leg.stepping = false;});
  const behavior = new DesktopBehavior(spider, screens, false, project, unproject, bounds);
  window.__spiderDesktop = behavior;
  const destination = {x: screens[1].workArea.x + screens[1].workArea.width * .5,
    y: screens[1].workArea.y + screens[1].workArea.height * .5};
  // This public command is also called by the actual native-input event bridge.
  spider.commandMove({clientX: destination.x - bounds.x, clientY: destination.y - bounds.y, button: 0}, fast);
  const target = behavior.manualTarget.clone();
  let duration = 0, arrived = false, recovery = 0;
  const visited = new Set();
  const step = () => {timestamp += 1000 / 60; frame(timestamp);};
  spider.renderer.render = () => {
    const crop = chooseViewport(measure(bounds), null, project(spider.position), spider.state.size);
    assertVisibleVertices(bounds, crop);
  };
  for (let index = 0; index < 3600; index++) {
    step(); duration += 1 / 60;
    assert(spider.diagnostics.finite);
    const point = project(spider.position);
    assert(screens.some(display => contains(display.frame, point)), `${name}: entered an invisible desktop gap`);
    screens.forEach((display, i) => {if (contains(display.frame, point)) visited.add(i);});
    assert.equal(spider.patrol.active, false, `${name}: patrol took over a manual destination`);
    if (spider.motion.skid?.stage === 'recover') recovery++;
    if (index > 3 && !behavior.manualActive && !spider.sprinting && !spider.motion.arriving
      && spider.velocity.length() < 1 && (spider.motion.isAtGoal(target, 1.5) || spider.position.distanceTo(target) < 30)) {
      arrived = true; break;
    }
  }
  assert(arrived && visited.size === 2, `${name}: manual command failed to reach the other display`);
  assert.equal(spider.state.speed, speed, `${name}: changed saved walking speed`);
  if (!fast) assert(duration > 6, 'Slow route did not exercise the former six-second timeout');
  if (fast) assert(recovery > 0, `${name}: lost the final dash recovery`);
  console.log(JSON.stringify({scenario: name, duration, displaysVisited: visited.size, recoveryFrames: recovery}));
}
