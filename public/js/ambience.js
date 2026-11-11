// Making the world feel alive: wind (swaying grass and trees), animated water, drifting cloud shadows,
// sun shadows that follow the player, ambient particles per region and fog tinted by region.
// B toggles the expensive parts (shadows, grass, bloom) for slower PCs.
import * as THREE from 'three';
import { biomeAt, heightAt, wind, groundTexture } from './world.js';
import { PAL } from './fx.js';

const NOISE = `
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
  float fbm2(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03) + 0.15 * vnoise(p * 4.1); }
`;
// Adds a world-position varying and the noise helpers to a material
function worldShader(mat, uniforms, fragment) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWorld;\nuniform float uTime;\n' + NOISE + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + fragment);
  };
}

const MIST = [new THREE.Color('#b8c9b0'), new THREE.Color('#c8d4c0')];
const FOG = { center: '#a8d8f0', forest: '#9ccdb0', snow: '#cfe4f2', desert: '#f0d9ae', swamp: '#9fb59a', rock: '#c4bcb2', dungeon: '#0c1824' };

export class Ambience {
  constructor({ scene, renderer, sun, terrain, water }) {
    Object.assign(this, { scene, renderer, sun });
    this.time = { value: 0 }; this.player = { value: new THREE.Vector2() };
    this.fog = new THREE.Color(FOG.center); this.acc = 0; this.rich = true;

    // cloud shadows and fine grain on the ground
    worldShader(terrain.material, { uTime: this.time }, `
      float cl = fbm2(vWorld.xz * 0.011 + uTime * vec2(0.012, 0.005));
      diffuseColor.rgb *= 1.0 - 0.3 * smoothstep(0.48, 0.7, cl);
      diffuseColor.rgb *= 0.93 + 0.14 * vnoise(vWorld.xz * 0.7);`);
    // rippling water with sparkles
    worldShader(water.material, { uTime: this.time }, `
      float w = vnoise(vWorld.xz * 0.18 + uTime * vec2(0.35, 0.1)) + vnoise(vWorld.xz * 0.37 - uTime * vec2(0.1, 0.3));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.86, 1.0), smoothstep(1.15, 1.55, w) * 0.55);
      diffuseColor.rgb += smoothstep(0.95, 0.99, vnoise(vWorld.xz * 1.6 + uTime * 1.1)) * 0.55;`);

    // sun shadows around the player
    // props never move, so the shadow map is redrawn only every 3rd frame (it costs about as much as the scene)
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; this.frame = 0;
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 260 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    scene.add(sun.target);
    terrain.receiveShadow = true;
    scene.traverse((o) => { if (o.isInstancedMesh && o.userData.prop) o.castShadow = true; });

    this.grass = this.makeGrass();
    scene.add(this.grass);
  }

  // A dense patch of swaying grass that travels with the player: tufts sit on a fixed square of
  // side 2R around the origin and the shader wraps each one to the copy nearest the player, then reads the
  // terrain height and grass density from the ground texture. They lean away from the player.
  makeGrass(count = 13000, R = 30) {
    const blade = [], cols = [];
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * Math.PI, c = Math.cos(a), s = Math.sin(a), w = 0.17, h = 0.5 + b * 0.1;
      blade.push(-c * w, 0, -s * w, c * w, 0, s * w, c * 0.04, h, s * 0.04);
      cols.push(0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 1.1, 1.1, 1.1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(blade, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(blade.length / 3).fill([0, 1, 0]).flat(), 3));   // lit like the ground
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const ground = groundTexture();
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime: this.time, uPlayer: this.player, uGround: { value: ground }, uR: { value: R } });
      sh.vertexShader = 'uniform float uTime, uR; uniform vec2 uPlayer; uniform sampler2D uGround;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 base = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          vec2 wp = uPlayer + mod(base - uPlayer + uR, 2.0 * uR) - uR;      // nearest copy around the player
          vec2 g = clamp((wp + 300.0) / 2.0, vec2(0.0), vec2(299.99));
          ivec2 i0 = ivec2(floor(g)); vec2 f = fract(g);
          vec4 gd = mix(mix(texelFetch(uGround, i0, 0), texelFetch(uGround, i0 + ivec2(1, 0), 0), f.x),
                        mix(texelFetch(uGround, i0 + ivec2(0, 1), 0), texelFetch(uGround, i0 + ivec2(1, 1), 0), f.x), f.y);
          float rnd = fract(sin(dot(base, vec2(12.9898, 78.233))) * 43758.5453);
          float edge = smoothstep(uR, uR * 0.75, length(wp - uPlayer));
          float size = step(rnd, gd.g) * edge * (0.6 + 0.7 * fract(rnd * 7.13));
          float h = position.y;
          transformed *= size;
          float sway = sin(uTime * 2.1 + wp.x * 0.31 + wp.y * 0.23) * 0.16 + sin(uTime * 3.9 + wp.x * 0.9) * 0.04;
          transformed.x += sway * h * h * size; transformed.z += sway * 0.4 * h * h * size;
          vec2 away = wp - uPlayer; float dd = length(away);
          if (dd < 1.8) { transformed.xz += away / (dd + 0.001) * (1.8 - dd) * 0.55 * h * size; transformed.y -= (1.8 - dd) * 0.3 * h * size; }
          transformed += vec3(wp.x - base.x, gd.r - 0.05, wp.y - base.y);
          vGrassTint = mix(vec3(0.24, 0.46, 0.1), vec3(0.11, 0.27, 0.07), gd.b) * (0.85 + 0.3 * fract(rnd * 3.7));   // linear colour`)
        .replace('void main() {', 'varying vec3 vGrassTint;\nvoid main() {');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec3 vGrassTint;\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vGrassTint;')
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));   // both sides lit the same
    };
    const im = new THREE.InstancedMesh(geo, mat, count), m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) im.setMatrixAt(i, m.makeTranslation((Math.random() * 2 - 1) * R, 0, (Math.random() * 2 - 1) * R));
    im.receiveShadow = true; im.frustumCulled = false;
    return im;
  }

  setRich(on) {
    this.rich = on;
    this.sun.castShadow = on;
    this.renderer.shadowMap.needsUpdate = true;
  }

  // dt seconds; game for the player position, region and particles
  update(dt, game, scene) {
    this.time.value += dt; wind.value = this.time.value;
    const p = game.player; if (!p) return;
    this.player.value.set(p.x, p.z);
    this.grass.visible = this.rich && !game.dungeon.inside;
    if (this.rich && ++this.frame % 3 === 0) {
      const sx = Math.round(p.x), sz = Math.round(p.z);   // whole metres: no shimmering edges
      this.sun.position.set(sx + 40, p.y + 90, sz + 25); this.sun.target.position.set(sx, p.y, sz);
      this.renderer.shadowMap.needsUpdate = true;
    }
    // fog drifts towards the colour of the region you are in
    const b = game.dungeon.inside ? 'dungeon' : biomeAt(p.x, p.z);
    this.fog.lerp(new THREE.Color(game.dungeon.inside ? game.dungeon.def.fog : FOG[b] || FOG.center), Math.min(1, dt * (game.dungeon.inside ? 20 : 1.2)));
    scene.background.copy(this.fog); scene.fog.color.copy(this.fog);
    // ambient particles around the player
    if (game.dungeon.inside) return;
    const fx = game.parts, R = 24, rx = () => p.x + (Math.random() * 2 - 1) * R, rz = () => p.z + (Math.random() * 2 - 1) * R;
    this.acc += dt * 60;
    for (; this.acc >= 1; this.acc--) {
      const x = rx(), z = rz(), y = heightAt(x, z);
      if (b === 'snow') { for (let i = 0; i < 2; i++) fx.puff(rx(), p.y + 14, rz(), PAL.snow, { soft: true, vx: 0.6, vy: -2.2, life: 5, size: 0.28, jitter: 0, drag: 0 }); }
      else if (b === 'desert' && Math.random() < 0.6) fx.puff(x, y + 0.6, z, PAL.dust, { soft: true, vx: 5, vy: 0.1, life: 2.2, size: 1.6, end: 2.5, jitter: 0, drag: 0 });
      else if ((b === 'forest' || b === 'swamp') && Math.random() < 0.35) fx.puff(x, y + 1 + Math.random() * 2, z, PAL.wood, { vy: 0.15, life: 3, size: 0.22, jitter: 0, drag: 0 });
      else if (b === 'center' && Math.random() < 0.3) fx.puff(x, y + 1.5 + Math.random() * 2, z, PAL.snow, { soft: true, vx: 0.8, vy: 0.1, life: 4, size: 0.15, jitter: 0, drag: 0 });
      if (b === 'swamp' && Math.random() < 0.06) fx.puff(x, y + 0.5, z, MIST, { soft: true, vx: 0.3, vy: 0.05, life: 4, size: 5, end: 1.6, jitter: 0, drag: 0 });
      if (b === 'rock' && Math.random() < 0.15) fx.puff(x, y + 0.4, z, PAL.dust, { soft: true, vx: 1.5, vy: 0.2, life: 2, size: 0.8, end: 2, jitter: 0, drag: 0 });
    }
  }
}
