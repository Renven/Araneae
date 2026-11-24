import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Scene, Mesh, BoxGeometry, PlaneGeometry, MeshBasicMaterial, ShadowMaterial,
  DirectionalLight, OrthographicCamera, Vector3, BufferGeometry, Float32BufferAttribute} from '../dist/assets/three.module.js';
import {createContentBounds, chooseViewport} from '../dist/desktop-viewport.js';

const desktop = {x: -1920, y: -180, width: 3360, height: 1080};
const contains = (rect, p) => p.x >= rect.x && p.x <= rect.x + rect.width
  && p.y >= rect.y && p.y <= rect.y + rect.height;
function setup() {
  const scene = new Scene();
  const camera = new OrthographicCamera(-1680, 1680, 540, -540, .1, 4000);
  camera.position.set(0, 1600, 420); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const mesh = new Mesh(new BoxGeometry(80, 40, 120), new MeshBasicMaterial());
  mesh.position.set(200, 70, 100); mesh.castShadow = true; scene.add(mesh);
  const ground = new Mesh(new PlaneGeometry(8000, 8000), new ShadowMaterial());
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.5; scene.add(ground);
  const light = new DirectionalLight(); light.position.set(-200, 500, 180);
  light.castShadow = true; scene.add(light);
  const project = p => {
    const clip = p.clone().project(camera);
    return {x: desktop.x + (clip.x + 1) * desktop.width / 2,
      y: desktop.y + (1 - clip.y) * desktop.height / 2};
  };
  return {scene, camera, mesh, project, measure: createContentBounds(scene, camera)};
}

test('crop contains all visible vertices and directional shadows at unchanged pixel scale', () => {
  const {camera, mesh, project, measure} = setup();
  const original = camera.projectionMatrix.toArray();
  const content = measure(desktop), anchor = project(mesh.position), crop = chooseViewport(content, null, anchor, 1.5);
  const positions = mesh.geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const point = new Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    const full = project(point);
    assert(contains(content, full));
    const height = -.5 - point.y;
    assert(contains(content, project(new Vector3(point.x - .4 * height, -.5, point.z + .36 * height))));
    camera.setViewOffset(desktop.width, desktop.height, crop.x - desktop.x, crop.y - desktop.y, crop.width, crop.height);
    const clipped = point.clone().project(camera);
    assert(Math.abs(crop.x + (clipped.x + 1) * crop.width / 2 - full.x) < 1e-8);
    assert(Math.abs(crop.y + (1 - clipped.y) * crop.height / 2 - full.y) < 1e-8);
    camera.clearViewOffset();
  }
  assert.deepEqual(camera.projectionMatrix.toArray(), original);
  assert(crop.width < 1024 && crop.height < 1024);
});

test('transforms, edited hair vertices and newly visible geometry update the measured bounds', () => {
  const {scene, mesh, measure} = setup();
  const first = measure(desktop);
  mesh.position.x += 200;
  const moved = measure(desktop);
  assert(Math.abs(moved.x - first.x - 200) < 1e-8);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1000, 10, 0, 0, 20, 0], 3));
  const hair = new Mesh(geometry, new MeshBasicMaterial()); hair.visible = false; scene.add(hair);
  assert.deepEqual(measure(desktop), moved);
  hair.visible = true;
  const visible = measure(desktop);
  assert(visible.width > moved.width);
  geometry.attributes.position.setX(1, 1300); geometry.attributes.position.needsUpdate = true;
  assert(measure(desktop).width > visible.width);
});

test('continuous movement keeps old and new surfaces anchored to the same local pixel', () => {
  const content = {x: 0, y: 0, width: 380, height: 410};
  const anchor = {x: 190, y: 205};
  const first = chooseViewport(content, null, anchor, 1.5);
  let previous = first;
  for (let index = 1; index <= 100; index++) {
    const dx = index * 8, dy = index * -3;
    const nextAnchor = {x: anchor.x + dx, y: anchor.y + dy};
    const next = chooseViewport({...content, x: dx, y: dy}, previous, nextAnchor, 1.5);
    // Even if macOS still presents an earlier surface, its local anchor matches.
    assert.equal(nextAnchor.x - next.x, anchor.x - first.x);
    assert.equal(nextAnchor.y - next.y, anchor.y - first.y);
    assert.equal(next.width, first.width);
    assert.equal(next.height, first.height);
    assert.equal(next.x - previous.x, 8);
    assert.equal(next.y - previous.y, -3);
    previous = next;
  }
});

test('a larger model expands its surface without clipping or frame-by-frame shrinkage', () => {
  const content = {x: 0, y: 0, width: 380, height: 410};
  const first = chooseViewport(content, null, {x: 190, y: 205}, 1.5);
  const moved = chooseViewport({...content, x: 250}, first, {x: 440, y: 205}, 1.5);
  assert(contains(moved, {x: 250, y: 0}) && contains(moved, {x: 630, y: 410}));
  const grown = chooseViewport({...content, width: 1100}, moved, {x: 190, y: 205}, 1.5);
  assert(grown.width > moved.width);
  assert.equal(chooseViewport(content, grown, {x: 190, y: 205}, 1.5).width, grown.width);
  assert(chooseViewport(content, null, {x: 190, y: 205}, 1.5).width < grown.width);
});
