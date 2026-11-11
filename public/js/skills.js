// The 24 auto-cast skills (six per element). Each runs every frame with its state s = { lv, t };
// s.t is the cooldown left. Built from the game's shared pieces: shoot (projectiles), rockDrop (falling
// objects), nova (expanding ring), addZone (damage-over-time ground), orbit (circling blades), later (delayed hit).
import * as THREE from 'three';
import { PAL, halo } from './fx.js';
import { heightAt } from './world.js';
import { sfx } from './audio.js';
import { rand } from './rng.js';

const up = (lv, base, per) => base + per * (lv - 1);          // value growing per level
const ready = (g, s, dt, cd) => { if ((s.t -= dt) > 0) return false; s.t = cd * g.cdMul; return true; };
// Direction to the nearest enemy (or the way we are walking) as a unit vector
function aimDir(g, range) {
  const p = g.player, e = g.nearest(p.x, p.z, range);
  let dx = e ? e.x - p.x : p.vx, dz = e ? e.z - p.z : p.vz;
  if (Math.hypot(dx, dz) < 0.1) { dx = p.flip; dz = 0; }
  const d = Math.hypot(dx, dz); return { dx: dx / d, dz: dz / d, e };
}
function enemiesWithin(g, r) { const p = g.player; return g.enemies.filter(e => !e.dead && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < r * r); }
const pickSome = (list, n) => { const out = []; while (out.length < n && list.length) out.push(list.splice((rand() * list.length) | 0, 1)[0]); return out; };

// Blades / crystals / stones circling the player; each enemy is hit at most every 0.35 s per orbit
function orbit(g, key, n, r, speed, dmg, elem, opt = {}) {
  const p = g.player, list = (g.orbits[key] ??= []);
  const look = { wood: [g.geo.leaf, g.mat.leaf, [0.5, 1.4, 0.35], 1], ice: [g.geo.spear, g.mat.ice, [0.45, 0.9, 1.2], 0.9], rock: [g.geo.rock, g.mat.rock, [0.9, 0.7, 0.4], 0.5] }[elem];
  while (list.length < n) {
    const m = new THREE.Mesh(look[0], look[1]); m.scale.setScalar(look[3]); m.add(halo(new THREE.Color(...look[2]), 1.8 / look[3]));
    g.fx.add(m); list.push(m);
  }
  list.forEach((m, i) => {
    const a = g.time * speed + i * Math.PI * 2 / n, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    m.position.set(x, p.y + 1, z); m.rotation.y = -a; if (elem === 'rock') m.rotation.x += 0.05;
    g.parts.puff(x, p.y + 1, z, PAL[elem], { vy: 0.2, life: 0.3, size: 0.45, jitter: 0.1 });
    g.near(x, z, 0.8, e => {
      const hk = key + p.id;   // per player, so two players' orbits both hit
      if ((e[hk] || 0) > g.time) return;
      e[hk] = g.time + 0.35;
      g.damage(e, dmg, elem, opt.knock ?? 0.8, p);
      if (opt.freeze) e.freezeT = Math.max(e.freezeT || 0, opt.freeze);
      sfx.play(elem === 'rock' ? 'rock' : elem === 'ice' ? 'ice_hit' : 'leaf', { vol: 0.13, gap: 0.12 });
    });
  });
}
// Ground spike / burst at a point after a delay
function spike(g, x, z, delay, r, dmg, elem, opt) {
  g.later(delay, () => {
    const y = heightAt(x, z);
    g.near(x, z, r, e => { g.damage(e, dmg, elem, opt.knock || 0, { x, z }); if (opt.root) e.rootT = Math.max(e.rootT || 0, opt.root); });
    g.parts.burst(x, y + 0.3, z, 14, PAL[elem], { speed: 2.5, up: 9, life: 0.45, size: 0.5, grav: 10 });
    g.parts.burst(x, y + 0.3, z, 4, elem === 'rock' ? PAL.dust : PAL.leaf, { soft: true, speed: 2, up: 2, life: 0.6, size: 1, end: 1.6 });
    g.shock(x, z, r * 1.2, elem === 'rock' ? '#f0cc8a' : '#b4f57a', 0.25);
    sfx.play(elem === 'rock' ? 'rock' : 'vine', { vol: 0.2, at: { x, z }, gap: 0.06 });
  });
}

const IMPL = {
  // ---------------- fire
  fireball(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 1.1)) return;
    const n = 1 + (lv >= 2) + (lv >= 4), used = new Set();
    for (let i = 0; i < n; i++) {
      const e = g.nearest(p.x, p.z, 24, used); if (!e) { if (!i) s.t = 0.2; break; } used.add(e);
      g.shoot('fire', e, 20, 2.2, { dmg: 16 * (lv >= 5 ? 1.5 : 1), blast: lv >= 3 ? 3.2 : 1.8, pierce: 0, target: e });
    }
  },
  flameWall(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 3 ? 3.6 : 4.5)) return;
    const { dx, dz } = aimDir(g, 16), cx = p.x + dx * 6, cz = p.z + dz * 6, len = 6 + lv;
    for (let o = -len / 2; o <= len / 2; o += 1.3)
      g.addZone({ x: cx - dz * o, z: cz + dx * o, r: 1.4, dur: lv >= 4 ? 4.5 : 3.5, dps: up(lv, 7, 1.6) * (lv >= 5 ? 1.4 : 1), elem: 'fire', tall: true });
    sfx.play('firedash', { vol: 0.3 });
  },
  fireSteps(g, s, lv, p) {
    s.lx ??= p.x; s.lz ??= p.z;
    if (Math.hypot(p.x - s.lx, p.z - s.lz) < 1.2) return;
    s.lx = p.x; s.lz = p.z;
    g.addZone({ x: p.x, z: p.z, r: lv >= 2 ? 1.5 : 1.2, dur: lv >= 4 ? 2.6 : 1.8, dps: up(lv, 4, 1.4) * (lv >= 5 ? 1.4 : 1), elem: 'fire' });
  },
  fireRing(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 4 ? 2.4 : 3)) return;
    g.nova(p.x, p.z, (lv >= 2 ? 6 : 5) + (lv >= 5 ? 1.5 : 0), up(lv, 12, 4), 'fire', 1.5);
    sfx.play('boom', { vol: 0.3, rate: 1.3 });
  },
  meteor(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 4 ? 2.6 : 3.2)) return;
    const list = enemiesWithin(g, 18); if (!list.length) { s.t = 0.4; return; }
    for (const e of pickSome(list, 1 + (lv >= 3) + (lv >= 5))) g.rockDrop(e.x, e.z, up(lv, 26, 6), 2.8, 'fire');
  },
  flamethrower(g, s, lv, p, dt) {
    if ((s.t -= dt) > 0) return;
    s.t = 0.12;
    const range = 5 + (lv >= 2 ? 1 : 0) + (lv >= 4 ? 1 : 0), { dx, dz, e } = aimDir(g, range + 1);
    if (!e) { s.t = 0.25; return; }
    g.near(p.x, p.z, range, en => {
      const ex = en.x - p.x, ez = en.z - p.z, d = Math.hypot(ex, ez) || 1;
      if ((ex * dx + ez * dz) / d > 0.82) g.damage(en, up(lv, 2.5, 0.8) * (lv >= 5 ? 1.5 : 1), 'fire');
    });
    for (let i = 0; i < 5; i++) {
      const sp = 10 + rand() * 6, j = (rand() - 0.5) * 0.5;
      g.parts.glow.emit(p.x + dx, p.y + 1, p.z + dz, (dx - dz * j) * sp, 0.6, (dz + dx * j) * sp, range / sp, 0.5, 1.6, PAL.fire[(rand() * 4) | 0], 0, 1);
    }
    sfx.play('fire_cast', { vol: 0.12, gap: 0.3, rate: 0.7 });
  },

  // ---------------- ice
  iceSpear(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 1.2)) return;
    const e = g.nearest(p.x, p.z, 26); if (!e) { s.t = 0.2; return; }
    const n = 1 + (lv >= 3) + (lv >= 5), base = Math.atan2(e.z - p.z, e.x - p.x);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.22;
      g.shoot('ice', { x: p.x + Math.cos(a) * 10, z: p.z + Math.sin(a) * 10 }, 26, 1.1, { dmg: 26 * (lv >= 4 ? 1.4 : 1), blast: 0, pierce: 3 + (lv >= 2 ? 2 : 0) });
    }
  },
  frostAura(g, s, lv, p, dt) {
    const r = 3.5 + (lv >= 2) + (lv >= 4);
    if (!g.auraMesh) { g.auraMesh = new THREE.Mesh(g.geo.disc, g.mat.aura); g.fx.add(g.auraMesh); }
    g.auraMesh.scale.setScalar(r); g.auraMesh.position.set(p.x, p.y + 0.15, p.z);
    g.mat.aura.opacity = 0.14 + 0.06 * Math.sin(g.time * 4);
    for (let i = 0; i < 2; i++) { const a = rand() * 6.283, d = Math.sqrt(rand()) * r; g.parts.puff(p.x + Math.cos(a) * d, p.y + 0.3, p.z + Math.sin(a) * d, PAL.snow, { vy: 0.9, life: 0.9, size: 0.3, jitter: 0 }); }
    { const a = g.time * 2.5; for (const sgn of [1, -1]) g.parts.puff(p.x + sgn * Math.cos(a) * r, p.y + 0.3, p.z + sgn * Math.sin(a) * r, PAL.ice, { vy: 0.4, life: 0.6, size: 0.55, jitter: 0 }); }
    if ((s.t -= dt) > 0) return;
    s.t = 0.5;
    g.near(p.x, p.z, r, e => { e.slowT = 0.7; e.slowF = lv >= 5 ? 0.4 : 0.6; g.damage(e, 5 * (lv >= 3 ? 1.4 : 1), 'ice'); });
  },
  blizzard(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 4 ? 3.8 : 4.8)) return;
    const e = g.nearest(p.x, p.z, 18); if (!e) { s.t = 0.4; return; }
    g.addZone({ x: e.x, z: e.z, r: (lv >= 2 ? 4.2 : 3.6) + (lv >= 5 ? 1 : 0), dur: 3.2, dps: up(lv, 8, 3), elem: 'ice', slow: 0.5, swirl: true });
    sfx.play('icefield', { vol: 0.25 });
  },
  icicle(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 4 ? 1.7 : 2.2)) return;
    const list = enemiesWithin(g, 16); if (!list.length) { s.t = 0.4; return; }
    for (const e of pickSome(list, 1 + (lv >= 3) + (lv >= 5))) g.rockDrop(e.x, e.z, up(lv, 26, 7), 2, 'ice', { freeze: 0.7 });
  },
  iceShards(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 1.8)) return;
    const n = 6 + (lv >= 2 ? 2 : 0) + (lv >= 4 ? 2 : 0), off = rand() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = off + i * Math.PI * 2 / n;
      g.shoot('ice', { x: p.x + Math.cos(a) * 10, z: p.z + Math.sin(a) * 10 }, 22, 0.65, { dmg: up(lv, 18, 4) * (lv >= 5 ? 1.4 : 1), blast: 0, pierce: 1 });
    }
  },
  iceOrbit(g, s, lv) { orbit(g, 'iceOrbit', 2 + (lv >= 3) + (lv >= 5), 3.4, 2.6, up(lv, 9, 2.5), 'ice', { freeze: 0.4 }); },

  // ---------------- wood
  leaves(g, s, lv) { orbit(g, 'leaves', 3 + (lv >= 2) + (lv >= 4), 3.2 + (lv >= 3 ? 1.1 : 0), 3.2, 12 * (lv >= 5 ? 1.5 : 1), 'wood'); },
  thorns(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 2.6)) return;
    const { dx, dz, e } = aimDir(g, 14); if (!e) { s.t = 0.3; return; }
    const n = 4 + (lv >= 2) + (lv >= 4);
    for (let i = 0; i < n; i++) spike(g, p.x + dx * (1.6 + i * 1.5), p.z + dz * (1.6 + i * 1.5), i * 0.06, 1.4, up(lv, 16, 5) * (lv >= 5 ? 1.4 : 1), 'wood', { root: 0.8 });
  },
  seedBomb(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 1.8)) return;
    const n = 1 + (lv >= 3) + (lv >= 5), used = new Set();
    for (let i = 0; i < n; i++) {
      const e = g.nearest(p.x, p.z, 20, used); if (!e) { if (!i) s.t = 0.3; break; } used.add(e);
      g.shoot('wood', e, 15, 1.6, { dmg: up(lv, 18, 5), blast: lv >= 4 ? 2.8 : 2.2, pierce: 0, target: e });
    }
  },
  pollen(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 4)) return;
    const list = enemiesWithin(g, 16); if (!list.length) { s.t = 0.4; return; }
    for (const e of pickSome(list, 1 + (lv >= 4))) g.addZone({ x: e.x, z: e.z, r: lv >= 2 ? 3.6 : 3, dur: 4, dps: up(lv, 7, 3) * (lv >= 5 ? 1.4 : 1), elem: 'wood', cloud: true });
  },
  lifePulse(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 4 ? 4 : 5)) return;
    p.hp = Math.min(p.maxHp, p.hp + up(lv, 6, 3) * (lv >= 5 ? 1.5 : 1));
    g.nova(p.x, p.z, 5, up(lv, 14, 5), 'wood', 2.5);
    g.parts.burst(p.x, p.y + 1, p.z, 30, PAL.heal, { speed: 3, up: 5, life: 0.9, size: 0.45 });
    sfx.play('heal', { vol: 0.3 });
  },
  leafBlades(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 1.3)) return;
    const e = g.nearest(p.x, p.z, 20); if (!e) { s.t = 0.2; return; }
    const n = 2 + (lv >= 3) + (lv >= 5), base = Math.atan2(e.z - p.z, e.x - p.x);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.18;
      g.shoot('wood', { x: p.x + Math.cos(a) * 10, z: p.z + Math.sin(a) * 10 }, 22, 1, { dmg: up(lv, 22, 6), blast: 0, pierce: 2 });
    }
  },

  // ---------------- rock
  rockfall(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 1.6)) return;
    const list = enemiesWithin(g, 18); if (!list.length) { s.t = 0.4; return; }
    for (const e of pickSome(list, 1 + (lv >= 2) + (lv >= 4))) g.rockDrop(e.x, e.z, 20 * (lv >= 3 ? 1.4 : 1), lv >= 5 ? 3.3 : 2.3);
  },
  quake(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 4 ? 2.4 : 3.2)) return;
    g.nova(p.x, p.z, 6 + (lv >= 2 ? 2.5 : 0), 16 * (lv >= 3 ? 1.4 : 1), 'rock', lv >= 5 ? 4 : 2);
    sfx.play('rock', { vol: 0.45, rate: 0.7 });
  },
  stoneShot(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 1.25)) return;
    const n = 1 + (lv >= 4), used = new Set();
    for (let i = 0; i < n; i++) {
      const e = g.nearest(p.x, p.z, 20, used); if (!e) { if (!i) s.t = 0.2; break; } used.add(e);
      g.shoot('rock', e, 18, 1.5, { dmg: up(lv, 16, 5) * (lv >= 5 ? 1.4 : 1), blast: lv >= 3 ? 2.2 : 1.6, pierce: 0, target: e });
    }
  },
  spikes(g, s, lv, p, dt) {
    if (!ready(g, s, dt, 2.8)) return;
    const list = enemiesWithin(g, 11); if (!list.length) { s.t = 0.4; return; }
    pickSome(list, 3 + (lv >= 2) + (lv >= 4)).forEach((e, i) => spike(g, e.x, e.z, i * 0.08, 1.6, up(lv, 18, 5) * (lv >= 5 ? 1.4 : 1), 'rock', { knock: 1.2 }));
  },
  stoneOrbit(g, s, lv) { orbit(g, 'stoneOrbit', 2 + (lv >= 3) + (lv >= 5), 2.5, 2, up(lv, 12, 4), 'rock', { knock: 2.6 }); },
  dustDevil(g, s, lv, p, dt) {
    if (!ready(g, s, dt, lv >= 4 ? 3.6 : 4.5)) return;
    const { dx, dz } = aimDir(g, 18);
    g.addZone({ x: p.x + dx * 2, z: p.z + dz * 2, r: (lv >= 2 ? 2.6 : 2.2) + (lv >= 5 ? 0.8 : 0), dur: 3, dps: up(lv, 14, 4), elem: 'rock', vx: dx * 6, vz: dz * 6, swirl: true });
    sfx.play('dash', { vol: 0.3, rate: 0.6 });
  },
};

export function runSkill(g, key, s, dt) { IMPL[key]?.(g, s, s.lv, g.player, dt); }
