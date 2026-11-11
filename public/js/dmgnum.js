// Floating damage numbers: only your own hits, summed per monster over 0.3 s, at most 60 on screen, yellow when
// your element is strong against the target and grey when weak. One instanced mesh draws every digit from a
// canvas atlas, facing the camera at a steady on-screen size. Visual only: uses Math.random, never the game's dice.
import * as THREE from 'three';

const GLYPHS = '0123456789.k', MAX_NUM = 60, MAX_GLYPH = 320, LIFE = 0.9;
const COLOR = { up: new THREE.Color(1.0, 0.8, 0.18), even: new THREE.Color(0.9, 0.9, 0.9), down: new THREE.Color(0.5, 0.53, 0.58) };
const fmt = (v) => (v < 1000 ? String(Math.max(1, Math.round(v))) : v < 10000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v / 1000) + 'k');
const KEY = 'monster-survivor.dmgnum';

function atlas() {   // white digits with a thick black outline; tinted per number by the instance colour
  const W = 48, H = 64, c = document.createElement('canvas');
  c.width = W * GLYPHS.length; c.height = H;
  const x = c.getContext('2d');
  x.font = 'bold 52px "Arial Black", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round'; x.lineWidth = 10; x.strokeStyle = '#000'; x.fillStyle = '#fff';
  [...GLYPHS].forEach((g, i) => { x.strokeText(g, W * i + W / 2, H / 2 + 3); x.fillText(g, W * i + W / 2, H / 2 + 3); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DamageNumbers {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(0.75, 1);
    this.glyph = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLYPH * 2), 2);   // (which glyph, alpha)
    geo.setAttribute('aG', this.glyph);
    const mat = new THREE.MeshBasicMaterial({ map: atlas(), transparent: true, depthTest: false, depthWrite: false });
    mat.onBeforeCompile = (s) => {
      s.vertexShader = 'attribute vec2 aG;\nvarying float vA;\n' + s.vertexShader.replace('#include <uv_vertex>',
        `#include <uv_vertex>\n  vMapUv.x = (aG.x + vMapUv.x) / ${GLYPHS.length}.0; vA = aG.y;`);
      s.fragmentShader = 'varying float vA;\n' + s.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= vA;\n#include <alphatest_fragment>');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_GLYPH);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLYPH * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 20; this.mesh.count = 0;
    scene.add(this.mesh);
    this.list = []; this.on = true;
    try { this.on = localStorage.getItem(KEY) !== 'off'; } catch { /* storage blocked: default on */ }
  }
  toggle() {
    this.on = !this.on; if (!this.on) this.clear();
    try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch { /* not remembered */ }
    return this.on;
  }
  clear() { this.list.length = 0; this.mesh.count = 0; }
  // m: element matchup of the hits (> 1 strong, < 1 weak)
  add(x, y, z, v, m) {
    if (!this.on || v < 0.5) return;   // a shielded boss takes nothing: no '1'
    if (this.list.length >= MAX_NUM) this.list.shift();
    this.list.push({ x: x + (Math.random() - 0.5) * 1.2, y, z: z + (Math.random() - 0.5) * 1.2, text: fmt(v),
      color: m > 1 ? COLOR.up : m < 1 ? COLOR.down : COLOR.even, big: m > 1 ? 1.25 : 1, t: 0 });
  }
  update(dt, camera) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), mtx = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
    this.list = this.list.filter((d) => (d.t += dt) < LIFE);
    let n = 0;
    for (const d of this.list) {
      const k = d.t / LIFE, pop = d.t < 0.12 ? 1.6 - d.t / 0.12 * 0.6 : 1;   // pops in, rises, fades
      const y = d.y + 1.5 * (1 - (1 - k) ** 2), a = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      const size = camera.position.distanceTo(p.set(d.x, y, d.z)) * 0.03 * d.big * pop;
      for (let i = 0; i < d.text.length && n < MAX_GLYPH; i++, n++) {
        p.set(d.x, y, d.z).addScaledVector(right, (i - (d.text.length - 1) / 2) * 0.6 * size);
        this.mesh.setMatrixAt(n, mtx.compose(p, camera.quaternion, s.setScalar(size)));
        this.mesh.setColorAt(n, d.color);
        this.glyph.setXY(n, GLYPHS.indexOf(d.text[i]), a);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; this.glyph.needsUpdate = true;
  }
}
