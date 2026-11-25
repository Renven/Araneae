import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/assets/three.module.js';
import {SilkTrail} from '../dist/silk-trail.js';
import {createContentBounds} from '../dist/desktop-viewport.js';

function makeSpider() {
  const body = new THREE.Group();
  body.position.set(0, 14, 0);
  body.updateMatrixWorld(true);
  return {
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, -80),
    state: {size: 0.5, dark: false},
    appearance: {body},
  };
}

test('silk trail emits behind moving spinnerets and expires within 1.6s when stationary', () => {
  const scene = new THREE.Scene();
  const spider = makeSpider();
  const trail = new SilkTrail(scene, 1.6);

  for (let i = 0; i < 8; i++) {
    spider.position.set(0, 0, -i * 15);
    spider.appearance.body.position.set(0, 14, -i * 15);
    spider.appearance.body.updateMatrixWorld(true);
    trail.update(0.05, spider, 180);
  }

  assert(trail.count >= 4);
  assert.equal(trail.filament.mesh.visible, true);
  assert.equal(trail.halo.mesh.visible, true);

  // Stop moving and advance past 1.6s lifetime.
  spider.velocity.set(0, 0, 0);
  for (let i = 0; i < 10; i++) trail.update(0.2, spider, 180);
  assert.equal(trail.count, 0);
  assert.equal(trail.filament.mesh.visible, false);
  assert.equal(trail.halo.mesh.visible, false);

  trail.dispose();
});

test('silk trail is ignored by content bounds and feathers alpha to zero before viewport edge', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-500, 500, 500, -500, 0.1, 4000);
  camera.position.set(0, 1600, 420);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial());
  scene.add(bodyMesh);
  const measure = createContentBounds(scene, camera);
  const desktop = {x: 0, y: 0, width: 1000, height: 1000};
  const before = measure(desktop);

  const spider = makeSpider();
  const trail = new SilkTrail(scene, 1.6);
  for (let i = 0; i < 12; i++) {
    spider.position.set(i * 30, 0, 0);
    spider.appearance.body.position.set(i * 30, 14, 0);
    spider.appearance.body.updateMatrixWorld(true);
    trail.update(0.05, spider, 160);
  }

  // Content bounds must not expand to chase the silk trail.
  assert.deepEqual(measure(desktop), before);

  // Oldest point far beyond maxRadius (160) must have feathered to alpha 0.
  assert.equal(trail.filament.colors[3], 0);
  assert.equal(trail.halo.colors[3], 0);

  trail.reset();
  assert.equal(trail.count, 0);
  assert.equal(trail.filament.mesh.visible, false);
  trail.dispose();
});
