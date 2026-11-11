// Sound effects (CC0: Kenney RPG / Interface / Sci-fi packs, "80 CC0 RPG SFX").
// Web Audio, unlocked by the first click or key. Sounds near the player are louder; repeats are throttled.
const SOUNDS = {
  fire_cast: 2, boom: 3, bigboom: 2, ice_cast: 2, ice_hit: 2, leaf: 2, rock: 4, hit: 3, pop: 2, gem: 4, levelup: 1, capture: 1,
  release: 1, dash: 3, firedash: 1, icefield: 1, vine: 2, wall: 1, ult: 1, warn: 1, roar: 3, hurt: 1, gate: 1, door: 1, click: 1, heal: 1,
};

class Sfx {
  constructor() { this.ctx = null; this.buf = {}; this.last = {}; this.muted = false; this.listener = null; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ctx.destination);
    for (const [name, n] of Object.entries(SOUNDS)) {
      this.buf[name] = [];
      for (let i = 0; i < n; i++)
        fetch(`assets/sfx/${name}_${i}.ogg`).then(r => r.arrayBuffer()).then(a => this.ctx.decodeAudioData(a)).then(b => this.buf[name].push(b)).catch(() => {});
    }
  }
  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.7; return this.muted; }
  // vol 0..1, rate = pitch, at = {x, z} for distance falloff, gap = min seconds between repeats of this sound
  play(name, { vol = 0.5, rate = 1, at = null, gap = 0.05 } = {}) {
    const ctx = this.ctx, list = this.buf[name];
    if (!ctx || this.muted || !list || !list.length) return;
    const now = ctx.currentTime;
    if (now - (this.last[name] ?? -1) < gap) return;
    if (at && this.listener) {
      const d = Math.hypot(at.x - this.listener.x, at.z - this.listener.z);
      vol *= Math.max(0, 1 - d / 45); if (vol < 0.02) return;
    }
    this.last[name] = now;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
    g.gain.value = vol; src.connect(g); g.connect(this.master); src.start();
  }
}
export const sfx = new Sfx();
