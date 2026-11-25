import * as THREE from './assets/three.module.js';

const MAX_POINTS = 48;
const LIFETIME = 1.6;
const SPINNERET_LOCAL = new THREE.Vector3(0, -3, 77);

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function createRibbon(maxPoints, colorRgb, renderOrder) {
  const vertexCount = maxPoints * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  const indices = new Uint16Array((maxPoints - 1) * 6);
  for (let i = 0; i < maxPoints - 1; i++) {
    const v = i * 2;
    const o = i * 6;
    indices[o] = v;
    indices[o + 1] = v + 1;
    indices[o + 2] = v + 2;
    indices[o + 3] = v + 1;
    indices[o + 4] = v + 3;
    indices[o + 5] = v + 2;
  }
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = renderOrder === 1 ? 'silk-trail-halo' : 'silk-trail-filament';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = renderOrder;
  mesh.userData.ignoreContentBounds = true;
  return {mesh, geometry, material, positions, colors, posAttr, colAttr, rgb: colorRgb};
}

// Short-lived (1.6s) dual-layer gossamer silk dragline emitted from the spider's spinnerets.
// Pre-allocated buffers avoid per-frame garbage collection, and edge feathering prevents
// clipping or resizing of the cropped desktop overlay window.
export class SilkTrail {
  constructor(scene, lifetime = LIFETIME) {
    this.scene = scene;
    this.lifetime = lifetime;
    this.points = Array.from({length: MAX_POINTS}, () => ({x: 0, z: 0, age: 0}));
    this.count = 0;
    this.tip = new THREE.Vector3();
    // Cool-slate halo ensures contrast on bright pages; silver-white core gleams on dark pages.
    this.halo = createRibbon(MAX_POINTS, [0.18, 0.24, 0.34], 1);
    this.filament = createRibbon(MAX_POINTS, [0.94, 0.97, 1.0], 2);
    scene.add(this.halo.mesh);
    scene.add(this.filament.mesh);
  }

  reset() {
    this.count = 0;
    this.halo.mesh.visible = false;
    this.filament.mesh.visible = false;
    this.halo.geometry.setDrawRange(0, 0);
    this.filament.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.scene.remove(this.halo.mesh);
    this.scene.remove(this.filament.mesh);
    this.halo.geometry.dispose();
    this.halo.material.dispose();
    this.filament.geometry.dispose();
    this.filament.material.dispose();
  }

  update(dt, spider, maxRadius = Infinity) {
    if (!spider?.appearance?.body) return;
    const stepDt = Math.max(0, Math.min(dt, 0.25));
    const size = spider.state?.size ?? 1;

    // Age existing trail samples and compact expired tail entries in place.
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.points[i];
      p.age += stepDt;
      if (p.age < this.lifetime) {
        if (alive !== i) {
          this.points[alive].x = p.x;
          this.points[alive].z = p.z;
          this.points[alive].age = p.age;
        }
        alive++;
      }
    }
    this.count = alive;

    // Sample spinneret world position projected just above the floor plane.
    this.tip.copy(SPINNERET_LOCAL).applyMatrix4(spider.appearance.body.matrixWorld);
    const speed = spider.velocity ? spider.velocity.length() : 0;
    const minStep = Math.max(3.5, 6.0 * size);

    if (speed > 2.5) {
      if (this.count === 0) {
        this.points[0].x = this.tip.x;
        this.points[0].z = this.tip.z;
        this.points[0].age = 0;
        this.count = 1;
      } else {
        const last = this.points[this.count - 1];
        const dist = Math.hypot(this.tip.x - last.x, this.tip.z - last.z);
        if (dist >= minStep) {
          if (this.count >= MAX_POINTS) {
            for (let i = 1; i < MAX_POINTS; i++) {
              this.points[i - 1].x = this.points[i].x;
              this.points[i - 1].z = this.points[i].z;
              this.points[i - 1].age = this.points[i].age;
            }
            this.count = MAX_POINTS - 1;
          }
          this.points[this.count].x = this.tip.x;
          this.points[this.count].z = this.tip.z;
          this.points[this.count].age = 0;
          this.count++;
        } else {
          // Keep the newest anchor attached smoothly to the moving spinnerets.
          last.x = this.tip.x;
          last.z = this.tip.z;
          last.age = 0;
        }
      }
    }

    if (this.count < 2) {
      this.halo.mesh.visible = false;
      this.filament.mesh.visible = false;
      return;
    }

    const centerX = spider.position.x;
    const centerZ = spider.position.z;
    const dark = !!spider.state?.dark;
    this.writeRibbon(this.halo, 0.55, 2.5 * size, dark ? 0.16 : 0.28, centerX, centerZ, maxRadius);
    this.writeRibbon(this.filament, 0.68, 1.15 * size, dark ? 0.82 : 0.72, centerX, centerZ, maxRadius);
  }

  writeRibbon(ribbon, y, baseWidth, peakAlpha, centerX, centerZ, maxRadius) {
    const n = this.count;
    const {positions, colors, posAttr, colAttr, rgb} = ribbon;
    const fadeStart = Number.isFinite(maxRadius) ? maxRadius * 0.62 : Infinity;
    const fadeEnd = Number.isFinite(maxRadius) ? maxRadius * 0.94 : Infinity;
    let maxAlpha = 0;

    for (let i = 0; i < n; i++) {
      const curr = this.points[i];
      const prev = this.points[Math.max(0, i - 1)];
      const next = this.points[Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      // Perpendicular normal on the XZ floor plane.
      const nx = -tz;
      const nz = tx;

      const life = Math.max(0, 1 - curr.age / this.lifetime);
      const ageFade = Math.pow(life, 1.35);
      const distFromSpider = Math.hypot(curr.x - centerX, curr.z - centerZ);
      const edgeFade = Number.isFinite(maxRadius) ? 1 - smoothstep(fadeStart, fadeEnd, distFromSpider) : 1;
      const headPinch = i === n - 1 ? 0.85 : 1;
      const alpha = peakAlpha * ageFade * edgeFade * headPinch;
      if (alpha > maxAlpha) maxAlpha = alpha;

      const halfW = baseWidth * (0.35 + 0.65 * life) * 0.5;
      const v0 = i * 2;
      const p0 = v0 * 3;
      const p1 = (v0 + 1) * 3;
      positions[p0] = curr.x - nx * halfW;
      positions[p0 + 1] = y;
      positions[p0 + 2] = curr.z - nz * halfW;
      positions[p1] = curr.x + nx * halfW;
      positions[p1 + 1] = y;
      positions[p1 + 2] = curr.z + nz * halfW;

      const c0 = v0 * 4;
      const c1 = (v0 + 1) * 4;
      colors[c0] = rgb[0];
      colors[c0 + 1] = rgb[1];
      colors[c0 + 2] = rgb[2];
      colors[c0 + 3] = alpha;
      colors[c1] = rgb[0];
      colors[c1 + 1] = rgb[1];
      colors[c1 + 2] = rgb[2];
      colors[c1 + 3] = alpha;
    }

    if (maxAlpha < 0.005) {
      ribbon.mesh.visible = false;
      return;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    ribbon.geometry.setDrawRange(0, (n - 1) * 6);
    ribbon.mesh.visible = true;
  }
}
