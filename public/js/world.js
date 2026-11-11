// The open world: a 600 m heightmap with five biome regions around a central plain, Kenney nature props,
// dungeon entrances at the four ends, obstacle collision and a minimap image.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SIZE = 600, HALF = SIZE / 2, SEG = 300, LIMIT = 262;   // players stay inside +-LIMIT
export const wind = { value: 0 };   // shared time uniform for swaying plants (advanced by ambience.js)
const STEP = SIZE / SEG;

// ---------- noise
function hash(x, z) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f + i * 17.3, z * f - i * 9.1); norm += amp; f *= 2; amp *= 0.5; }
  return s / norm;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- biomes. angle 0 = east (+x), north = -z
const OUTER = ['snow', 'desert', 'swamp', 'rock', 'forest'];
const DIR = { snow: -Math.PI / 2, desert: Math.PI / 2, swamp: 0, rock: Math.PI };
function scores(x, z) {
  const a = Math.atan2(z, x), s = {};
  for (const k in DIR) s[k] = Math.max(0, Math.cos(a - DIR[k])) ** 4;
  s.forest = 0.55;   // wins on the diagonals (each cardinal biome spans about +-30 deg)
  return s;
}
export function biomeAt(x, z) {
  if (x > 600) return 'dungeon';   // dungeon interiors live far east of the map
  if (Math.hypot(x, z) < 95) return 'center';
  const s = scores(x, z);
  return OUTER.reduce((b, k) => (s[k] > s[b] ? k : b), 'forest');
}

function poolDip(x, z, scale, lo, hi, depth, seed) { return smooth(lo, hi, fbm(x / scale + seed, z / scale - seed)) * depth; }
const BH = {
  center: (x, z) => 0.7 + 1.3 * (fbm(x / 45, z / 45) - 0.5) * 2 - poolDip(x, z, 22, 0.64, 0.72, 2.4, 50),
  snow: (x, z) => {
    const h = 0.8 + 15 * fbm(x / 70, z / 70) ** 1.6 + 3 * fbm(x / 20, z / 20);
    return lerp(h, 0.35, smooth(0.63, 0.69, fbm(x / 35 + 90, z / 35)));   // frozen lakes
  },
  desert: (x, z) => 0.8 + 2.5 * fbm(x / 35, z / 35) + 1.4 * Math.sin((x * 0.6 + z) / 11 + 4 * fbm(x / 50, z / 50)),
  swamp: (x, z) => 0.35 + 1.1 * fbm(x / 30, z / 30) - poolDip(x, z, 16, 0.52, 0.6, 1.7, 20),
  rock: (x, z) => { const r = 1 - Math.abs(2 * fbm(x / 55, z / 55) - 1); return 0.6 + 26 * r ** 3 + 2 * fbm(x / 15, z / 15); },
  forest: (x, z) => 0.7 + 2.6 * fbm(x / 40, z / 40),
};
export const iceAt = (x, z) => biomeAt(x, z) === 'snow' && fbm(x / 35 + 90, z / 35) > 0.66;

export const DUNGEONS = [
  { elem: 'ice', name: '빙결 성채', x: 0, z: -240 },
  { elem: 'fire', name: '용암 용광로', x: 0, z: 240 },
  { elem: 'wood', name: '고목의 뿌리 미궁', x: 240, z: 0 },
  { elem: 'rock', name: '지저 신전', x: -240, z: 0 },
];

function rawHeight(x, z) {
  const r = Math.hypot(x, z), outer = smooth(70, 120, r);
  let h = BH.center(x, z);
  if (outer > 0) {
    const s = scores(x, z); let sum = 0, acc = 0;
    for (const k of OUTER) { const w = Math.exp(14 * s[k]); sum += w; acc += w * BH[k](x, z); }
    h = lerp(h, acc / sum, outer);
  }
  h = lerp(0.8, h, smooth(10, 18, r));                                                     // start plaza
  for (const d of DUNGEONS) h = lerp(1.0, h, smooth(14, 24, Math.hypot(x - d.x, z - d.z)));  // dungeon plazas
  const edge = Math.max(Math.abs(x), Math.abs(z));
  return h + smooth(262, 292, edge) * 38 * (0.6 + 0.4 * fbm(x / 12, z / 12));               // border mountains
}

// ---------- colours
const C = (hex) => new THREE.Color(hex);
const COL = {
  center: C('#6fae4f'), snow: C('#e9eff5'), desert: C('#e0c07a'), swamp: C('#4f7436'), rock: C('#8b8379'), forest: C('#3f7c38'),
  ice: C('#bfe6f5'), mud: C('#6a5838'), stone: C('#9a9aa0'), sandRock: C('#c79a62'),
};
function colourAt(x, z, h, out) {
  const b = biomeAt(x, z), n = fbm(x / 6, z / 6, 2) - 0.5;
  out.copy(COL[b]);
  if (b === 'snow') { if (iceAt(x, z)) out.copy(COL.ice); else if (h < 4) out.lerp(COL.stone, 0.25); }
  if (b === 'rock') out.lerp(C('#6e665c'), smooth(6, 0, h) * 0.6).lerp(C('#a49b90'), smooth(10, 20, h) * 0.5);
  if (b === 'desert' && h > 3.5) out.lerp(COL.sandRock, 0.3);
  if (b === 'center' || b === 'forest' || b === 'swamp') {   // meadow patches: sunny yellow-green and shady dark green
    const m = fbm(x / 28 + 7, z / 28 - 3, 3);
    out.lerp(C('#a8c85a'), smooth(0.58, 0.72, m) * 0.45).lerp(C('#3e7434'), smooth(0.42, 0.28, m) * 0.4);
  }
  if (b === 'desert') out.lerp(C('#ecd08c'), smooth(0.5, 0.7, fbm(x / 20, z / 20, 2)) * 0.5);
  if (h < 0.15) out.lerp(COL.mud, 0.8);                                         // pool banks and beds
  if (Math.max(Math.abs(x), Math.abs(z)) > 266) out.lerp(COL.stone, 0.7);       // border cliffs
  out.offsetHSL(0, 0, n * 0.08);
}

// ---------- props: [model, count, min height, max height, collision radius factor (0 = walk through), tint]
const PROPS = {
  center: [['tree_default', 40, 5, 7, 0.25], ['tree_oak', 30, 5, 7, 0.25], ['plant_bush', 50, 1, 1.6, 0], ['flower_redA', 60, 0.6, 0.9, 0], ['flower_yellowA', 60, 0.6, 0.9, 0], ['rock_smallA', 30, 0.8, 1.4, 0.5], ['grass_large', 120, 0.8, 1.2, 0]],
  forest: [['tree_detailed', 260, 6, 9, 0.22], ['tree_fat', 200, 5, 8, 0.25], ['tree_tall', 200, 8, 11, 0.2], ['tree_pineTallA', 160, 8, 11, 0.2], ['mushroom_red', 120, 0.8, 1.4, 0], ['stump_old', 60, 1, 1.5, 0.5], ['plant_bushLarge', 140, 1.5, 2.2, 0], ['log_large', 40, 1, 1.4, 0.45]],
  snow: [['tree_pineRoundC', 160, 6, 9, 0.22, '#ffffff'], ['tree_pineTallC', 160, 8, 11, 0.2, '#ffffff'], ['rock_largeA', 60, 2.5, 4, 0.5, '#dfe7ee'], ['rock_smallFlatA', 60, 0.6, 1, 0, '#dfe7ee']],
  desert: [['cactus_tall', 140, 3, 5, 0.25], ['cactus_short', 140, 1.5, 2.5, 0.3], ['tree_palmTall', 30, 6, 9, 0.2], ['stone_largeB', 60, 2, 4, 0.5, '#d9a86c'], ['rock_smallFlatA', 80, 0.6, 1, 0, '#d9a86c']],
  swamp: [['tree_thin_dark', 220, 7, 10, 0.2], ['tree_default_dark', 160, 6, 9, 0.25], ['mushroom_tanGroup', 120, 1, 1.6, 0], ['log_large', 60, 1, 1.4, 0.45], ['grass_large', 200, 1, 1.5, 0], ['plant_bushLarge', 120, 1.5, 2.2, 0], ['lily_large', 160, 0.15, 0.25, 0, null, 'water']],
  rock: [['rock_tallA', 35, 4, 7, 0.45, '#a08f7e'], ['rock_tallC', 35, 4, 7, 0.45, '#a08f7e'], ['rock_tallF', 30, 4, 8, 0.45, '#a08f7e'], ['rock_largeC', 45, 2, 4, 0.5, '#a08f7e'], ['rock_largeE', 45, 2, 4, 0.5, '#a08f7e'], ['stone_tallB', 25, 3, 6, 0.45, '#a08f7e'], ['rock_smallA', 60, 0.8, 1.4, 0, '#a08f7e']],
};

const obstacles = [], grid = new Map(), CELL = 8;
const models = {};   // loaded GLB props: { parts: [{ geo, mat }], height, radius }

// A single prop as an ordinary (non-instanced) group, scaled to a height, with its own tinted materials
export function makeProp(name, height, tint) {
  const m = models[name], g = new THREE.Group();
  for (const part of m.parts) {
    const mat = part.mat.clone();
    if (tint) mat.color = mat.color.clone().lerp(new THREE.Color(tint), 0.85);
    g.add(new THREE.Mesh(part.geo, mat));
  }
  g.scale.setScalar(height / m.height);
  return g;
}
const gkey = (cx, cz) => cx * 1000 + cz;
function addObstacle(x, z, r) {
  const o = { x, z, r }; obstacles.push(o);
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const k = gkey(cx + i, cz + j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o);
  }
}
// Push a circle (pos, radius) out of trees and rocks
export function collide(p, radius) {
  const list = grid.get(gkey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  if (!list) return;
  for (const o of list) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + radius;
    if (d < min && d > 1e-4) { p.x = o.x + dx / d * min; p.z = o.z + dz / d * min; }
  }
}

// ---- see-through trees: tall props between the camera and the player dissolve with an ordered dither
const fadeGrid = new Map(), fading = new Map(), FCELL = 8;
export const fadeCount = () => fading.size;   // automated checks
export const fadeSample = () => { for (const l of fadeGrid.values()) for (const f of l) if (f.x > 100 && f.z > 100) return { x: f.x, z: f.z, r: f.r, v: f.attrs[0].array[f.i] }; };
function dither(mat, sway) {
  if (mat.userData.dither) return;
  mat.userData.dither = true;
  mat.customProgramCacheKey = () => (sway ? 'dither-sway' : 'dither');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    const swayCode = sway ? `
      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float sw = sin(uWind * 1.3 + ip.x * 0.21 + ip.z * 0.17) + 0.4 * sin(uWind * 2.9 + ip.z * 0.5);
      transformed.x += sw * 0.03 * max(0.0, position.y) * max(0.0, position.y);` : '';
    sh.vertexShader = 'attribute float aFade;\nvarying float vFade;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFade = aFade;' + swayCode);
    sh.fragmentShader = `varying float vFade;
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      ` + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vFade < 0.999 && bayer4(gl_FragCoord.xy) >= vFade) discard;');
  };
}
// Camera at (cx, cz), player at (px, pz): fade props whose trunk is near that line
export function updateFade(cx, cz, px, pz, dt) {
  const want = new Set(), sx = px - cx, sz = pz - cz, len2 = sx * sx + sz * sz || 1;
  const x0 = Math.floor((Math.min(cx, px) - 6) / FCELL), x1 = Math.floor((Math.max(cx, px) + 6) / FCELL);
  const z0 = Math.floor((Math.min(cz, pz) - 6) / FCELL), z1 = Math.floor((Math.max(cz, pz) + 6) / FCELL);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const l = fadeGrid.get(i * 1000 + j); if (!l) continue;
    for (const f of l) {
      const t = Math.max(0, Math.min(1.1, ((f.x - cx) * sx + (f.z - cz) * sz) / len2));
      if (t < 0.05) continue;
      const d = Math.hypot(f.x - (cx + sx * t), f.z - (cz + sz * t));
      if (d < f.r + 1.2) want.add(f);
    }
  }
  for (const f of want) if (!fading.has(f)) fading.set(f, 1);
  for (const [f, v] of fading) {
    const target = want.has(f) ? 0.15 : 1, nv = v + (target - v) * Math.min(1, dt * 8);
    for (const a of f.attrs) { a.array[f.i] = nv; a.needsUpdate = true; }
    if (target === 1 && nv > 0.995) { for (const a of f.attrs) a.array[f.i] = 1; fading.delete(f); } else fading.set(f, nv);
  }
}

let heights;   // (SEG+1)^2 grid
export function heightAt(x, z) {
  if (x > 600) return 0;   // flat dungeon floors
  const gx = Math.min(SEG - 1e-3, Math.max(0, (x + HALF) / STEP)), gz = Math.min(SEG - 1e-3, Math.max(0, (z + HALF) / STEP));
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz, W = SEG + 1;
  const a = heights[iz * W + ix], b = heights[iz * W + ix + 1], c = heights[(iz + 1) * W + ix], d = heights[(iz + 1) * W + ix + 1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}
export const inWater = (x, z) => heightAt(x, z) < -0.05;

// Ground data for shaders, one texel per terrain vertex: R height, G grass density, B grass darkness
export function groundTexture() {
  const W = SEG + 1, data = new Float32Array(W * W * 4);
  const dens = { center: 1, forest: 0.9, swamp: 0.75, rock: 0.06 }, dark = { forest: 1, swamp: 0.6, rock: 0.3 };
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const x = -HALF + i * STEP, z = -HALF + j * STEP, h = heights[j * W + i], b = biomeAt(x, z);
    let d = dens[b] || 0;
    if (h < 0.05 || Math.hypot(x, z) < 12 || DUNGEONS.some(dn => Math.hypot(x - dn.x, z - dn.z) < 24)) d = 0;
    data.set([h, d, dark[b] || 0, 1], (j * W + i) * 4);
  }
  const t = new THREE.DataTexture(data, W, W, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

// Seeded random so every PC builds the same world (co-op later)
let seed = 12345;
const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9 | 0) >>> 0) / 4294967296;

export async function buildWorld(scene, onProgress) {
  // Terrain
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), col = new THREE.Color();
  heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = rawHeight(x, z);
    heights[i] = h; pos.setY(i, h);
    colourAt(x, z, h, col); cols.set([col.r, col.g, col.b], i * 3);
  }
  // steep slopes show bare rock (grey in the snow, warm stone elsewhere)
  const W = SEG + 1, rockCol = C('#8d8478'), snowRock = C('#9aa3ab');
  for (let j = 1; j < SEG; j++) for (let i = 1; i < SEG; i++) {
    const k = j * W + i, s = (Math.abs(heights[k + 1] - heights[k - 1]) + Math.abs(heights[k + W] - heights[k - W])) / (2 * STEP);
    const t = smooth(0.7, 1.5, s) * 0.75; if (t <= 0) continue;
    col.setRGB(cols[k * 3], cols[k * 3 + 1], cols[k * 3 + 2]).lerp(biomeAt(pos.getX(k), pos.getZ(k)) === 'snow' ? snowRock : rockCol, t);
    cols[k * 3] = col.r; cols[k * 3 + 1] = col.g; cols[k * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  scene.add(terrain);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#3d86b8', transparent: true, opacity: 0.72 }));
  water.position.y = -0.05; scene.add(water);
  onProgress?.(0.3);

  // Props (instanced per model part)
  const loader = new GLTFLoader();
  const names = new Set(Object.values(PROPS).flat().map(p => p[0]).concat(['cliff_cave_rock', 'campfire_stones']));
  let done = 0;
  await Promise.all([...names].map(async n => {
    const g = await loader.loadAsync(`assets/nature/${n}.glb`);
    g.scene.updateMatrixWorld(true);
    const parts = [];
    g.scene.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: o.material }); });
    const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3());
    models[n] = { parts, height: size.y || 1, radius: Math.max(size.x, size.z) / 2 };
    onProgress?.(0.3 + 0.5 * (++done / names.size));
  }));

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function instance(name, mats, tint) {
    const m = models[name], attrs = [];
    for (const part of m.parts) {
      let mat = part.mat; mat.side = THREE.DoubleSide;   // grass and leaves are single planes
      if ('metalness' in mat) { mat.metalness = 0; mat.roughness = 1; }   // the kit ships metallic materials that render near-black
      if (tint) { mat = mat.clone(); mat.color = mat.color.clone().lerp(new THREE.Color(tint), 0.55); }
      dither(mat, /^(tree_|plant_|grass|flower)/.test(name));
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(mats.length).fill(1), 1);
      const geo = part.geo.clone(); geo.setAttribute('aFade', fade);   // own copy: the same model is used in several biomes
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.computeBoundingSphere(); im.userData.prop = true;
      scene.add(im);
      attrs.push(fade);
    }
    return attrs;
  }
  for (const biome in PROPS) for (const [name, count, h0, h1, rf, tint, where] of PROPS[biome]) {
    const mats = [], spots = [], m = models[name];
    for (let tries = 0; mats.length < count && tries < count * 60; tries++) {
      const x = (rand() * 2 - 1) * (LIMIT - 4), z = (rand() * 2 - 1) * (LIMIT - 4);
      if (biomeAt(x, z) !== biome || Math.hypot(x, z) < 22) continue;
      if (DUNGEONS.some(d => Math.hypot(x - d.x, z - d.z) < 26)) continue;
      const y = heightAt(x, z);
      if (where === 'water' ? y > -0.4 : y < 0.05) continue;
      const sc = (h0 + rand() * (h1 - h0)) / m.height;
      s.setScalar(sc); q.setFromAxisAngle(up, rand() * Math.PI * 2); p.set(x, where === 'water' ? -0.02 : y - 0.05, z);
      mats.push(m4.compose(p, q, s).clone()); spots.push({ x, z, r: m.radius * sc * 0.6, h: h1 });
      if (rf > 0) addObstacle(x, z, m.radius * sc * rf * 2);
    }
    const attrs = instance(name, mats, tint);
    if (h1 >= 3.5) spots.forEach((sp, i) => {   // tall enough to hide the player: register for see-through
      const f = { x: sp.x, z: sp.z, r: sp.r, attrs, i }, k = Math.floor(sp.x / FCELL) * 1000 + Math.floor(sp.z / FCELL);
      if (!fadeGrid.has(k)) fadeGrid.set(k, []); fadeGrid.get(k).push(f);
    });
  }

  // Dungeon entrances: a cave mouth facing the centre, sealed for now
  const caveMats = [], fireMats = [];
  for (const d of DUNGEONS) {
    const sc = 14 / models.cliff_cave_rock.height, y = heightAt(d.x, d.z);
    const back = new THREE.Vector3(d.x, 0, d.z).normalize().multiplyScalar(8);
    q.setFromAxisAngle(up, Math.atan2(-d.x, -d.z));
    caveMats.push(m4.compose(p.set(d.x + back.x, y - 0.2, d.z + back.z), q, s.setScalar(sc)).clone());
    addObstacle(d.x + back.x * 1.2, d.z + back.z * 1.2, 9);
    for (const side of [-1, 1]) {
      const sideV = new THREE.Vector3(-back.z, 0, back.x).normalize().multiplyScalar(7 * side);
      fireMats.push(m4.compose(p.set(d.x + sideV.x - back.x * 0.3, y, d.z + sideV.z - back.z * 0.3), q, s.setScalar(2 / models.campfire_stones.height)).clone());
    }
  }
  instance('cliff_cave_rock', caveMats);
  instance('campfire_stones', fireMats);
  onProgress?.(1);
  return { terrain, water, minimap: minimapCanvas() };
}

function minimapCanvas(px = 180) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const ctx = c.getContext('2d'), img = ctx.createImageData(px, px), col = new THREE.Color();
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = (i + 0.5) / px * SIZE - HALF, z = (j + 0.5) / px * SIZE - HALF, h = heightAt(x, z);
    if (h < -0.05) col.set('#3d86b8'); else { colourAt(x, z, h, col); col.offsetHSL(0, 0, Math.min(0.15, h * 0.008)); }
    img.data.set([col.r * 255, col.g * 255, col.b * 255, 255], (j * px + i) * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
