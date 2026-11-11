// Particles: camera-facing soft dots in one InstancedMesh per blend mode (additive glow, normal smoke/dust).
// CPU-simulated in flat typed arrays; thousands of particles cost two draw calls.
import * as THREE from 'three';

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.75)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const SOFT = softTexture();

class System {
  constructor(scene, cap, additive) {
    this.cap = cap; this.n = 0;
    const F = (k) => new Float32Array(cap * k);
    Object.assign(this, { p: F(3), v: F(3), c: F(3), life: F(1), max: F(1), s0: F(1), s1: F(1), grav: F(1), drag: F(1) });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCol', this.col); geo.setAttribute('aAlpha', this.alpha);
    const mat = new THREE.MeshBasicMaterial({ map: SOFT, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec3 aCol; attribute float aAlpha; varying vec3 vCol; varying float vAlpha;\n' + sh.vertexShader
        .replace('#include <project_vertex>', `
          vec4 wpos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec4 mvPosition = viewMatrix * vec4(wpos.xyz + (camR * position.x + camU * position.y) * s, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vCol = aCol; vAlpha = aAlpha;`);
      sh.fragmentShader = 'varying vec3 vCol; varying float vAlpha;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= vCol; diffuseColor.a *= vAlpha;');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, color, grav = 0, drag = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.c.set([color.r, color.g, color.b], i * 3);
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    const { p, v, c, life, max, s0, s1, grav, drag } = this, m = this.mesh.instanceMatrix.array, col = this.col.array, al = this.alpha.array;
    for (let i = 0; i < this.n; i++) {
      if ((life[i] -= dt) <= 0) {   // swap-remove
        const j = --this.n;
        for (const [arr, k] of [[p, 3], [v, 3], [c, 3]]) arr.copyWithin(i * k, j * k, j * k + k);
        life[i] = life[j]; max[i] = max[j]; s0[i] = s0[j]; s1[i] = s1[j]; grav[i] = grav[j]; drag[i] = drag[j];
        i--; continue;
      }
      const k = Math.max(0, 1 - drag[i] * dt);
      v[i * 3] *= k; v[i * 3 + 1] = v[i * 3 + 1] * k - grav[i] * dt; v[i * 3 + 2] *= k;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const t = 1 - life[i] / max[i], s = s0[i] + (s1[i] - s0[i]) * t, o = i * 16;
      m.fill(0, o, o + 16); m[o] = m[o + 5] = m[o + 10] = s; m[o + 12] = p[i * 3]; m[o + 13] = p[i * 3 + 1]; m[o + 14] = p[i * 3 + 2]; m[o + 15] = 1;
      col[i * 3] = c[i * 3]; col[i * 3 + 1] = c[i * 3 + 1]; col[i * 3 + 2] = c[i * 3 + 2];
      al[i] = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;   // quick fade in, long fade out
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = this.col.needsUpdate = this.alpha.needsUpdate = true;
  }
}

// Palettes per element (glow) and for smoke/dust
const P = (...h) => h.map((x) => new THREE.Color(x));
export const PAL = {
  fire: P('#fff3a0', '#ffb43a', '#ff6a1a', '#ff3a10'), ice: P('#ffffff', '#c8f4ff', '#7fdcff'), wood: P('#eaffb0', '#9cf060', '#4fcf3f'),
  rock: P('#fff0c8', '#e0b87a', '#c08a50'), gold: P('#fff6b0', '#ffd257', '#ffae2a'), heal: P('#d8ffd0', '#7dff8a'),
  smoke: P('#5a5048', '#6d6158', '#3e3832'), dust: P('#b49a7a', '#9c8468', '#c8b294'), snow: P('#ffffff', '#e6f6ff'), leaf: P('#5fbf3a', '#8fd84a', '#3f9a2a'),
};
const pick = (pal) => pal[(Math.random() * pal.length) | 0];
const rnd = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene) { this.glow = new System(scene, 5000, true); this.soft = new System(scene, 2500, false); }
  update(dt) { this.glow.update(dt); this.soft.update(dt); }
  // Ball of particles flying out from a point
  burst(x, y, z, n, pal, { speed = 6, up = 2, life = 0.6, size = 0.6, end = 0, grav = 0, drag = 2, soft = false } = {}) {
    const sys = soft ? this.soft : this.glow;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random() * 0.65), e = Math.random();
      sys.emit(x, y, z, Math.cos(a) * s * (1 - e * 0.5), up * (0.3 + Math.random()) + e * speed * 0.4, Math.sin(a) * s * (1 - e * 0.5),
        life * rnd(0.6, 1.2), size * rnd(0.7, 1.3), end * size, pick(pal), grav, drag);
    }
  }
  // One drifting particle (trails, auras)
  puff(x, y, z, pal, { vx = 0, vy = 1, vz = 0, life = 0.5, size = 0.5, end = 0, jitter = 0.4, grav = 0, drag = 1, soft = false } = {}) {
    (soft ? this.soft : this.glow).emit(x + rnd(-jitter, jitter), y + rnd(-jitter, jitter) * 0.5, z + rnd(-jitter, jitter),
      vx + rnd(-0.5, 0.5), vy, vz + rnd(-0.5, 0.5), life * rnd(0.7, 1.3), size * rnd(0.7, 1.3), end * size, pick(pal), grav, drag);
  }
  // Ring of particles on the ground (shockwaves)
  ring(x, y, z, r, n, pal, { speed = 3, life = 0.5, size = 0.7, soft = false } = {}) {
    const sys = soft ? this.soft : this.glow;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      sys.emit(x + Math.cos(a) * r, y + 0.3, z + Math.sin(a) * r, Math.cos(a) * speed, rnd(0.5, 2), Math.sin(a) * speed, life * rnd(0.7, 1.2), size * rnd(0.7, 1.3), 0, pick(pal), 1, 2);
    }
  }
  clear() { this.glow.n = this.soft.n = 0; }
}

// Additive glow halo to attach to projectiles
export function halo(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size); return s;
}
