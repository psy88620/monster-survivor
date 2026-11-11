// Pixel sprites as camera-facing billboards, one InstancedMesh per sprite sheet so hundreds of monsters cost a
// handful of draw calls. Sheets: 320x320, 4x4 cells of 80 px, frames row by row, facing right.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const sheets = {};

// Texture + where the feet are (lowest opaque pixel row inside a cell) so sprites stand on the ground
export async function loadSheet(key) {
  if (sheets[key]) return sheets[key];
  const tex = await loader.loadAsync(`assets/monsters/${key}.png`);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
  const img = tex.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const a = ctx.getImageData(0, 0, c.width, c.height).data;
  let bottom = 0, top = 80;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++)
    if (a[(y * c.width + x) * 4 + 3] > 128) { bottom = Math.max(bottom, y % 80); top = Math.min(top, y % 80); }
  return (sheets[key] = { tex, foot: (79 - bottom) / 80, top: top / 80, image: img });
}

export class SpriteBatch {
  constructor(scene, sheet, capacity = 400) {
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.frame = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.flip = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.flash = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.frame, this.flip, this.flash]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFrame', this.frame); geo.setAttribute('aFlip', this.flip); geo.setAttribute('aFlash', this.flash);
    const mat = new THREE.MeshBasicMaterial({ map: sheet.tex, alphaTest: 0.5, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFoot = { value: -sheet.foot };
      sh.vertexShader = 'attribute float aFrame; attribute float aFlip; attribute float aFlash; uniform float uFoot; varying float vFlash;\n' + sh.vertexShader
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          float f = floor(aFrame + 0.5), col = mod(f, 4.0), row = floor(f / 4.0);
          vec2 uv0 = vec2(aFlip > 0.0 ? uv.x : 1.0 - uv.x, uv.y);
          vMapUv = vec2((col + uv0.x) * 0.25, 1.0 - (row + 1.0 - uv0.y) * 0.25);
          vFlash = aFlash;`)
        .replace('#include <project_vertex>', `
          vec4 wpos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = wpos.xyz + camR * position.x * s + camU * (position.y + uFoot) * s;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = 'varying float vFlash;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (vFlash < -1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 1.0, 0.35), 0.45);        // rooted
          else if (vFlash < -0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.65, 0.92, 1.0), 0.6);   // frozen
          else diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFlash);`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.capacity = capacity; this.n = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  add(x, y, z, size, frame, flip, flash = 0) {
    if (this.n >= this.capacity) return;
    const i = this.n++, e = this.mesh.instanceMatrix.array, o = i * 16;
    e.fill(0, o, o + 16); e[o] = e[o + 5] = e[o + 10] = size; e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    this.frame.array[i] = frame; this.flip.array[i] = flip; this.flash.array[i] = flash;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = this.frame.needsUpdate = this.flip.needsUpdate = this.flash.needsUpdate = true;
  }
}

// Soft round shadows under every sprite (one draw call)
export class ShadowBatch {
  constructor(scene, capacity = 1200) {
    const geo = new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.capacity = capacity;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  add(x, y, z, r) {
    if (this.n >= this.capacity) return;
    const e = this.mesh.instanceMatrix.array, o = this.n++ * 16;
    e.fill(0, o, o + 16); e[o] = e[o + 10] = r * 2; e[o + 5] = 1; e[o + 12] = x; e[o + 13] = y + 0.06; e[o + 14] = z; e[o + 15] = 1;
  }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; }
}
