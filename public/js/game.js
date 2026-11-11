// One run: the player monster, waves of wild monsters by region, six auto-cast skills, XP gems and level-ups.
import * as THREE from 'three';
import { MONSTERS, BIOMES, SKILLS, PASSIVES, MAX_SKILLS, MAX_LEVEL, ACTIVES, matchup } from './data.js';
import { heightAt, biomeAt, collide, inWater, iceAt, LIMIT, makeProp } from './world.js';
import { loadSheet, SpriteBatch, ShadowBatch } from './sprites.js';
import { FX, PAL, halo } from './fx.js';
import { Party } from './party.js';
import { Dungeon } from './dungeon.js';
import { sfx } from './audio.js';
import { rand, seed } from './rng.js';
import { runSkill } from './skills.js';
import { dex } from './dex.js';
import { DamageNumbers } from './dmgnum.js';

const ELEM_GLOW = { fire: '#ffb347', ice: '#bff0ff', wood: '#b4f57a', rock: '#f0cc8a', none: '#ffffff' };

export const PCOLOR = ['#ff5a5a', '#5ab4ff', '#ffd257', '#c07aff'];   // P1..P4 rings in a LAN game

const BASE = { hp: 18, dmg: 5, speed: 3.0, size: 3.8 };
const rnd = (a, b) => a + rand() * (b - a);

export class Game {
  constructor(scene) {
    this.scene = scene;
    this.batches = {};
    this.shadows = new ShadowBatch(scene);
    this.fx = new THREE.Group(); scene.add(this.fx);
    this.parts = new FX(scene); this.shake = 0;
    this.dungeon = new Dungeon(this);
    this.nums = new DamageNumbers(scene);
    // shared effect meshes
    this.geo = {
      ball: new THREE.IcosahedronGeometry(0.45, 1), spear: new THREE.OctahedronGeometry(0.35).scale(0.6, 0.6, 3),
      leaf: new THREE.OctahedronGeometry(0.5).scale(1.2, 0.15, 0.5), rock: new THREE.DodecahedronGeometry(0.9),
      ring: new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), disc: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
    };
    const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
    this.mat = {
      fire: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.9, 0.3) }), ice: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 1.6, 2.0) }),
      leaf: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 1.9, 0.45) }), rock: new THREE.MeshLambertMaterial({ color: '#8d7a63', flatShading: true }),
      warn: new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.5, depthWrite: false }),
      aura: new THREE.MeshBasicMaterial({ color: '#9fe3ff', transparent: true, opacity: 0.18, depthWrite: false }),
      wave: new THREE.MeshBasicMaterial({ color: '#d9b88a', transparent: true, opacity: 0.7, depthWrite: false }),
      boom: new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.6, depthWrite: false }),
    };
    // XP gems and heal items, instanced
    this.gemMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#223344' }), 600);
    this.gemMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3);
    this.gemMesh.frustumCulled = false; this.gemMesh.count = 0; scene.add(this.gemMesh);
    this.healMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshLambertMaterial({ color: '#ff5a7a', emissive: '#551122' }), 60);
    this.healMesh.frustumCulled = false; this.healMesh.count = 0; scene.add(this.healMesh);
  }

  async preload() {
    for (const key of Object.keys(MONSTERS)) {
      const sheet = await loadSheet(key);
      const elite = Object.values(BIOMES).some(b => b.elite === key);
      this.batches[key] = new SpriteBatch(this.scene, sheet, elite ? 320 : 260);
    }
  }

  // players: [{ id, key, skill, active }] (just one in a solo run); me: the id of the player on this PC.
  // A LAN game passes the same seed and players to every PC, which then all simulate the same run.
  start({ players, me = players[0].id, seed: sd = (Math.random() * 2 ** 32) >>> 0 }) {
    seed(sd);
    for (const o of [...this.fx.children]) this.fx.remove(o);
    this.parts.clear(); this.shake = 0; this.nums.clear();
    this.time = 0; this.kills = 0; this.over = false; this.won = false; this.fieldKills = 0;
    this.enemies = []; this.projectiles = []; this.effects = []; this.gems = []; this.heals = []; this.zones = [];
    this.eliteT = 60; this.spawnAcc = 0; this.walls = []; this.trails = []; this.hash = new Map();
    this.view = { x: 1, z: 0 }; this.pRings = [];
    const n = players.length; this.hpScale = 1 + 0.35 * (n - 1); this.bossScale = 1 + 0.6 * (n - 1);
    this.players = players.map((s, i) => this.newPlayer(s, i, n));
    this.me = this.players.find(p => p.id === me) || this.players[0]; this.player = this.me;
    this.dungeon.resetRun(); this.clears = 0;
    dex.catch(this.me.key);   // your starter counts as caught
  }
  newPlayer({ id = 0, key, skill, active, meta = {} }, i, n) {   // meta: permanent upgrade levels (meta.js)
    const x = (i - (n - 1) / 2) * 2.5;
    const p = this.player = {
      id, name: `P${i + 1}`, num: i, key, elem: MONSTERS[key].elem, x, z: 4, y: heightAt(x, 4), vx: 0, vz: 0,
      meta, kills: 0, hp: 100 + 10 * (meta.hp || 0), maxHp: 100 + 10 * (meta.hp || 0), level: 1, xp: 0, next: 5, radius: 0.6, inv: 0, flip: 1, flash: 0, down: false, revive: 0, gone: false,
      skills: { [skill]: { lv: 1, t: 0.5 } }, passives: {}, active: { key: active, t: 0 }, dashCd: 0, ult: 0, ultT: 0, ultTick: 0, ultMesh: null,
      orbits: {}, auraMesh: null, aim: { x: 0, z: 0 }, syn: {}, takenMul: 1, playerSlow: 1, pendingLevels: 0, offers: null, camRight: { x: 1, z: 0 },
    };
    p.party = new Party(this);
    return p;
  }
  leaveGame(id) {   // a player closed the game: their monster and companions leave
    const p = this.players.find(q => q.id === id); if (!p || p.gone) return;
    p.gone = true; p.down = true; p.party.clear(); p.party.list = []; p.party.rings = [];
    for (const k in p.orbits) for (const m of p.orbits[k]) this.fx.remove(m);
    for (const m of [p.auraMesh, p.ultMesh]) if (m) this.fx.remove(m);
    p.orbits = {}; p.auraMesh = p.ultMesh = null; p.ultT = 0;
    p.offers = null; p.pendingLevels = 0;   // nobody waits for their level-up pick
    this.toast = `${p.name}(${MONSTERS[p.key].name})가 나갔습니다`;
  }
  get topLevel() { return Math.max(...this.players.map(p => p.level)); }   // dungeons scale to the strongest player
  aliveP() { return this.players.filter(p => !p.down); }   // players who left count as down
  allies() { return this.players.flatMap(p => p.gone ? [] : p.party.alive()); }
  nearestPlayer(x, z) { let best = null, bd = Infinity; for (const p of this.aliveP()) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } } return best; }
  say(msg) { if (this.player === this.me) this.toast = msg; }   // personal notices only on that player's screen
  hurtPlayer(p, dmg, flash = 0.3) {
    p.hp -= dmg * p.takenMul; p.flash = 1;
    if (p === this.me) { this.hurt = flash; sfx.play('hurt', { vol: 0.35, gap: 0.3 }); }
  }

  // ---- derived stats
  pv(k) { return this.passives[k] || 0; }
  mv(k) { return this.player.meta[k] || 0; }   // permanent upgrade level
  get dmgMul() { return (1 + 0.1 * this.pv('damage')) * (1 + 0.05 * this.mv('dmg')); }
  get cdMul() { return 0.92 ** this.pv('cooldown'); }
  get speed() { return 7 * 1.08 ** this.pv('speed') * (1 + 0.03 * this.mv('speed')); }
  get magnet() { return 4 * (1 + 0.35 * this.pv('magnet')) * (1 + 0.15 * this.mv('magnet')); }

  // ---- level-up choices
  offer() {
    const pool = [];
    for (const k in this.skills) if (this.skills[k].lv < MAX_LEVEL) pool.push({ kind: 'skill', key: k, lv: this.skills[k].lv + 1, w: 3 });
    if (Object.keys(this.skills).length < MAX_SKILLS)
      for (const k in SKILLS) if (!this.skills[k] && SKILLS[k].elem === this.player.elem) pool.push({ kind: 'skill', key: k, lv: 1, w: 2 });
    for (const k in PASSIVES) if (this.pv(k) < MAX_LEVEL) pool.push({ kind: 'passive', key: k, lv: this.pv(k) + 1, w: 1.5 });
    const picks = [];
    while (picks.length < 3 && pool.length) {
      let r = rand() * pool.reduce((s, o) => s + o.w, 0), i = 0;
      while ((r -= pool[i].w) > 0) i++;
      picks.push(pool.splice(i, 1)[0]);
    }
    return picks.length ? picks : [{ kind: 'heal', key: 'heal', lv: 0 }];
  }
  choose(o) {
    if (o.kind === 'skill') { this.skills[o.key] ??= { lv: 0, t: 0.3 }; this.skills[o.key].lv = o.lv; }
    else if (o.kind === 'passive') {
      this.passives[o.key] = o.lv;
      if (o.key === 'maxHp') { this.player.maxHp += 20; this.player.hp += 20; }
    } else this.player.hp = Math.min(this.player.maxHp, this.player.hp + 40);
    this.pendingLevels--;
    this.player.offers = this.pendingLevels > 0 ? this.offer() : null;
  }

  // ---- one step for everyone. inputs[id] = { x, y (stick), w (camera yaw), ax, az (aim point), e: [events] }.
  // viewYaw is this PC's camera, used only for which way sprites face.
  update(dt, inputs = {}, viewYaw = 0) {
    if (this.over) return;
    this.view = { x: Math.cos(viewYaw), z: -Math.sin(viewYaw) };
    for (const p of this.players) for (const ev of inputs[p.id]?.e || []) {   // level-up picks
      if (ev.pick === undefined || !p.offers) continue;
      this.player = p; this.choose(p.offers[ev.pick] || p.offers[0]);
    }
    this.player = this.me;
    if (this.players.length === 1 && this.me.offers) return;   // solo: the game waits for your pick; together it keeps going
    this.time += dt;
    for (const p of this.players) { this.player = p; this.move(dt, inputs[p.id] || {}); }
    this.spawn(dt);
    this.buildHash();
    for (const p of this.players) { this.player = p; if (!p.down) this.act(inputs[p.id]?.e); }
    this.updateEnemies(dt);
    this.dungeon.update(dt);
    for (const p of this.players) {
      if (p.gone) continue;
      this.player = p; p.party.update(dt);
      if (!p.down) { this.updateSkills(dt); this.updateActives(dt); }
    }
    this.updateTrails(dt);
    this.updateZones(dt);
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.updatePickups(dt);
    this.enemies = this.enemies.filter(e => !e.dead);
    this.updateDowned(dt);
    this.player = this.me;
  }
  act(events = []) {   // a = left click, d = dash, u = ultimate, e = dungeon door, f / r = companions guard / follow
    for (const ev of events) {
      if (ev === 'a') this.useActive();
      else if (ev === 'd') this.dash();
      else if (ev === 'u') this.useUlt();
      else if (ev === 'e') this.dungeon.tryUse();
      else if (ev === 'f') this.party.command('guard');
      else if (ev === 'r') this.party.command('follow');
      else if (ev.rel !== undefined) this.party.release(ev.rel);
    }
  }
  // Knocked out players get back up when a friend stands next to them for 3 s; the run ends when nobody is standing
  updateDowned(dt) {
    for (const p of this.players) {
      if (p.gone) continue;
      if (!p.down && p.hp <= 0) {
        p.hp = 0; p.down = true; p.revive = 0; p.dashT = 0; p.rootT = 0;
        if (this.players.length > 1) this.toast = p === this.me ? '쓰러졌습니다! 친구가 곁에 3초 있으면 일어납니다' : `${p.name}(${MONSTERS[p.key].name}) 쓰러짐! 곁에 가서 일으켜 주세요`;
      } else if (p.down) {
        const helped = this.aliveP().some(o => Math.hypot(o.x - p.x, o.z - p.z) < 2.5);
        p.revive = helped ? p.revive + dt : Math.max(0, p.revive - dt);
        if (p.revive >= 3) {
          p.down = false; p.hp = p.maxHp * 0.4; p.inv = 2;
          this.parts.burst(p.x, p.y + 1, p.z, 40, PAL.heal, { speed: 5, up: 6, life: 0.9, size: 0.5 }); sfx.play('heal', { vol: 0.5, at: p });
        }
      }
    }
    if (!this.aliveP().length) this.over = true;
  }
  move(dt, input) {
    const p = this.player;
    if (input.ax !== undefined) { p.aim.x = input.ax; p.aim.z = input.az; }
    const camYaw = input.w || 0, camRight = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
    this.camRight = camRight;
    if (p.down) { p.vx = p.vz = 0; return; }
    // Player movement: camera relative; ice slides, water and swamp pools slow you down
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), ix = input.x || 0, iy = input.y || 0;
    let mx = ix * camRight.x + iy * fx, mz = ix * camRight.z + iy * fz;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    if (p.rootT > 0) {
      const helped = [...this.allies(), ...this.aliveP().filter(o => o !== p)].some(c => Math.hypot(c.x - p.x, c.z - p.z) < 2.6);
      p.rootT -= dt * (helped ? 3 : 1); mx = mz = 0; p.vx = p.vz = 0;
      if (rand() < 0.3) this.parts.puff(p.x, p.y + 0.6, p.z, PAL.wood, { vy: 0.5, life: 0.4, size: 0.5, jitter: 0.6 });
    }
    const slow = (inWater(p.x, p.z) ? 0.65 : 1) * this.playerSlow, grip = iceAt(p.x, p.z) ? 2.2 : 16;
    p.vx += (mx * this.speed * slow - p.vx) * Math.min(1, grip * dt);
    p.vz += (mz * this.speed * slow - p.vz) * Math.min(1, grip * dt);
    const h0 = heightAt(p.x, p.z);
    if (p.dashT > 0) this.dashStep(dt); else
    for (const axis of ['x', 'z']) {   // too-steep slopes block movement, one axis at a time so you slide along them
      const step = (axis === 'x' ? p.vx : p.vz) * dt, nx = axis === 'x' ? p.x + step : p.x, nz = axis === 'z' ? p.z + step : p.z;
      if (heightAt(nx, nz) - h0 > Math.abs(step) * 1.6 + 0.02) { if (axis === 'x') p.vx = 0; else p.vz = 0; continue; }
      p.x = nx; p.z = nz;
    }
    collide(p, p.radius);
    if (this.dungeon.inside) this.dungeon.clamp(p, p.radius);
    else { p.x = Math.max(-LIMIT, Math.min(LIMIT, p.x)); p.z = Math.max(-LIMIT, Math.min(LIMIT, p.z)); }
    p.y = heightAt(p.x, p.z);
    const side = p.vx * camRight.x + p.vz * camRight.z;
    if (Math.abs(side) > 0.3) p.flip = side > 0 ? 1 : -1;
    p.inv -= dt; p.flash = Math.max(0, p.flash - dt * 4);
    p.hp = Math.min(p.maxHp, p.hp + (0.6 * this.pv('regen') + (this.syn.wood ? 1.5 : 0)) * dt);
  }

  // ---- spawning: density grows with time, monsters come from the region they spawn in
  spawn(dt) {
    if (this.dungeon.inside) return;   // the dungeon spawns its own packs
    const alive = this.aliveP(); if (!alive.length) return;
    const more = 1 + 0.4 * (this.players.filter(q => !q.gone).length - 1);   // more players, bigger crowds
    const target = Math.min(280, (12 + this.time * 0.55) * more);
    // despawn monsters everyone has left far behind (open world: the crowd follows you)
    for (const e of this.enemies) if (!e.elite && alive.every(q => Math.hypot(e.x - q.x, e.z - q.z) > 75)) e.dead = true;
    this.spawnAcc += dt * (4 + this.time * 0.05) * more;
    while (this.spawnAcc >= 1 && this.enemies.length < target) {
      this.spawnAcc -= 1;
      const p = alive[(rand() * alive.length) | 0], a = rand() * Math.PI * 2, d = rnd(30, 42);
      const x = Math.max(-LIMIT, Math.min(LIMIT, p.x + Math.cos(a) * d)), z = Math.max(-LIMIT, Math.min(LIMIT, p.z + Math.sin(a) * d));
      const b = BIOMES[biomeAt(x, z)];
      this.addEnemy(b.spawn[Math.floor(rand() * b.spawn.length)], x, z, false);
    }
    if (this.spawnAcc > 3) this.spawnAcc = 3;
    if ((this.eliteT -= dt) <= 0) {
      this.eliteT = 70;
      const p = alive[(rand() * alive.length) | 0], a = rand() * Math.PI * 2, x = p.x + Math.cos(a) * 34, z = p.z + Math.sin(a) * 34;
      this.addEnemy(BIOMES[biomeAt(x, z)].elite, Math.max(-LIMIT, Math.min(LIMIT, x)), Math.max(-LIMIT, Math.min(LIMIT, z)), true);
      this.toast = '강한 기운이 다가옵니다 — 엘리트 몬스터!'; sfx.play('roar', { vol: 0.6 });
      const el = this.enemies[this.enemies.length - 1]; this.parts.burst(el.x, el.y + 1, el.z, 50, PAL.fire, { speed: 6, up: 8, life: 1, size: 0.8 }); this.shock(el.x, el.z, 6, '#ff5a3a', 0.6);
    }
  }
  addEnemy(key, x, z, elite, far = Math.hypot(x, z)) {
    const m = MONSTERS[key]; dex.see(key);
    const hpMul = (1 + this.time / 80 + (this.time / 600) ** 2) * (1 + far / 180) * (m.hp || 1) * (elite ? 14 : 1) * (1 + 0.3 * this.clears) * this.hpScale;   // grows faster after 20 min; each cleared dungeon toughens the field
    this.enemies.push({
      key, elem: m.elem, x, z, y: heightAt(x, z), hp: BASE.hp * hpMul, maxHp: BASE.hp * hpMul,
      speed: BASE.speed * (m.spd || 1) * (elite ? 0.85 : 1) * rnd(0.9, 1.1) * (1 + this.time / 4800),   // up to 1.5x faster at 40 min
      dmg: BASE.dmg * (1 + this.time / 200) * (1 + far / 400) * (elite ? 2 : 1),
      size: BASE.size * (elite ? 2.1 : 1) * (m.hp > 1.4 ? 1.15 : 1), radius: elite ? 1.3 : 0.55, elite,
      xp: elite ? 'level' : 1 + Math.floor(far / 110), phase: rand() * 12, flip: 1, flash: 0, slowT: 0, slowF: 1, leafT: 0, hit: 0,
    });
  }

  // spatial hash (2.5 m cells) for separation and hit tests
  buildHash() {
    this.hash = new Map();
    for (const e of this.enemies) {
      const k = Math.floor(e.x / 2.5) * 4096 + Math.floor(e.z / 2.5);
      let l = this.hash.get(k); if (!l) this.hash.set(k, (l = [])); l.push(e);
    }
  }
  near(x, z, r, fn) {
    const c = Math.ceil(r / 2.5), cx = Math.floor(x / 2.5), cz = Math.floor(z / 2.5);
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) {
      const l = this.hash.get((cx + i) * 4096 + cz + j); if (!l) continue;
      for (const e of l) if (!e.dead && !e.hidden && (e.x - x) ** 2 + (e.z - z) ** 2 <= (r + e.radius) ** 2) fn(e);
    }
  }
  nearest(x, z, max, skip) {
    let best = null, bd = max * max;
    for (const e of this.enemies) {
      if (e.dead || e.hidden || (skip && skip.has(e))) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2; if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  updateEnemies(dt) {
    const cr = this.view, allies = this.allies(), fallback = this.players[0];
    for (const e of this.enemies) {
      if (e.dead) continue;
      const p = this.player = this.nearestPlayer(e.x, e.z) || fallback;   // each monster (and boss pattern) goes for the closest player
      e.slowT -= dt; e.freezeT = (e.freezeT || 0) - dt; e.rootT = (e.rootT || 0) - dt;
      if (e.ai) {   // bosses run their own patterns; crowd control only staggers them briefly
        e.freezeT = Math.min(e.freezeT, 0.6); e.rootT = Math.min(e.rootT, 0.6);
        e.ai(e, dt);
        if (this.dungeon.inside) this.dungeon.clamp(e, e.radius);
        e.y = heightAt(e.x, e.z); e.flash = Math.max(0, e.flash - dt * 6); e.leafT -= dt;
        const bs = (p.x - e.x) * cr.x + (p.z - e.z) * cr.z; if (Math.abs(bs) > 0.5) e.flip = bs > 0 ? 1 : -1;
        if (!p.down && !e.hidden && e.dmg > 0 && Math.hypot(p.x - e.x, p.z - e.z) < e.radius + p.radius && p.inv <= 0) { this.hurtPlayer(p, e.dmg); p.inv = 0.6; }
        continue;
      }
      // chase the player, or a companion that is closer
      let tg = p, td = Math.hypot(p.x - e.x, p.z - e.z);
      for (const c of allies) { const cd = Math.hypot(c.x - e.x, c.z - e.z); if (cd < 7 && cd < td) { tg = c; td = cd; } }
      let dx = tg.x - e.x, dz = tg.z - e.z; const d = td || 1;
      if (tg !== p && d < e.radius + 0.9 && !(e.freezeT > 0)) this.party.hurt(tg, e.dmg);
      const held = e.freezeT > 0 || e.rootT > 0;
      const sp = held ? 0 : e.speed * (e.slowT > 0 ? e.slowF : 1) * (inWater(e.x, e.z) ? 0.7 : 1);
      let vx = dx / d * sp, vz = dz / d * sp;
      // keep apart from neighbours
      this.near(e.x, e.z, e.radius + 0.6, o => {
        if (o === e) return;
        const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz) || 0.01, push = (e.radius + o.radius - od);
        if (push > 0) { vx += ox / od * push * 6; vz += oz / od * push * 6; }
      });
      e.x += vx * dt; e.z += vz * dt;
      collide(e, e.radius);
      for (const w of this.walls) this.wallPush(w, e);
      if (this.dungeon.inside) this.dungeon.clamp(e, e.radius);
      e.y = heightAt(e.x, e.z);
      const side = vx * cr.x + vz * cr.z; if (Math.abs(side) > 0.2) e.flip = side > 0 ? 1 : -1;
      e.flash = Math.max(0, e.flash - dt * 6); e.leafT -= dt;
      if (tg === p && !p.down && !(e.freezeT > 0) && d < e.radius + p.radius + 0.2 && p.inv <= 0) { this.hurtPlayer(p, e.dmg); p.inv = 0.6; }
    }
  }

  damage(e, amount, elem, knock = 0, from = null) {
    if (e.dead) return;
    const m = matchup(elem, e.elem);
    if (this.syn.fire && elem === 'fire') amount *= 1.25;
    if (this.syn.ice && elem === 'ice') { e.slowT = Math.max(e.slowT, 1); e.slowF = Math.min(e.slowF, 0.6); }
    const dealt = amount * this.dmgMul * m * (e.freezeT > 0 ? 2 : 1) * (e.dmgMul ?? 1);
    e.hp -= dealt; if (dealt > 0) e.flash = e.boss ? 0.35 : 1;   // big bosses only blink lightly, or they would stay white
    if (this.player === this.me) { const d = (e.dn ??= { v: 0, t: this.time, m }); d.v += dealt; d.m = m; }   // my hits, shown as a number every 0.3 s
    sfx.play('hit', { vol: 0.18, at: e, gap: 0.07 });
    if (rand() < 0.6) this.parts.burst(e.x, e.y + 1.3, e.z, m > 1 ? 5 : 3, PAL[elem] || PAL.gold, { speed: m > 1 ? 7 : 5, life: 0.3, size: m > 1 ? 0.5 : 0.35 });
    if (knock && from) { const dx = e.x - from.x, dz = e.z - from.z, d = Math.hypot(dx, dz) || 1; const k = e.boss ? 0 : e.elite ? knock * 0.2 : knock; e.x += dx / d * k; e.z += dz / d * k; }
    if (e.hp <= 0) {
      e.dead = true; this.kills++; this.player.kills++;
      if (this.player === this.me) dex.kill(e.key);
      this.showDamage(e);
      this.party.onKill(e); this.dungeon.onKill(e);
      sfx.play(e.elite ? 'bigboom' : 'pop', { vol: e.elite ? 0.7 : 0.22, at: e, gap: e.elite ? 0 : 0.05 });
      this.parts.burst(e.x, e.y + 1, e.z, e.elite ? 30 : 6, PAL.snow, { soft: true, speed: e.elite ? 5 : 2.5, up: 1.5, life: 0.5, size: e.elite ? 1.6 : 0.9, end: 1.8, drag: 4 });
      this.parts.burst(e.x, e.y + 1.2, e.z, e.elite ? 40 : 6, PAL[e.elem] || PAL.gold, { speed: e.elite ? 10 : 5, up: 3, life: 0.5, size: 0.45 });
      if (e.elite) this.shake = Math.max(this.shake, 0.4); this.ult = Math.min(1, this.ult + (e.elite ? 0.25 : 0.012));
      if (e.xp === 'level') for (let i = 0; i < 12; i++) this.dropGem(e.x + rnd(-2, 2), e.z + rnd(-2, 2), Math.ceil(this.player.next / 12));
      else this.dropGem(e.x, e.z, e.xp);
      if (rand() < 0.012) this.heals.push({ x: e.x, z: e.z, y: e.y + 0.5 });
    }
  }

  // ---- skills
  updateSkills(dt) { for (const k in this.skills) runSkill(this, k, this.skills[k], dt); }
  shoot(kind, target, speed, life, opt, from = this.player) {
    const p = from, a = Math.atan2(target.z - p.z, target.x - p.x);
    const look = { fire: [this.geo.ball, this.mat.fire, [1.1, 0.55, 0.2], 2.6], ice: [this.geo.spear, this.mat.ice, [0.45, 0.9, 1.2], 1.6],
      wood: [this.geo.leaf, this.mat.leaf, [0.5, 1.2, 0.35], 1.6], rock: [this.geo.rock, this.mat.rock, [0.9, 0.7, 0.4], 1.4] }[kind];
    const mesh = new THREE.Mesh(look[0], look[1]);
    if (kind === 'rock') mesh.scale.setScalar(0.4);
    if (from !== this.player) mesh.scale.multiplyScalar(0.75);
    mesh.position.set(p.x, p.y + 1.1, p.z); mesh.rotation.y = -a + Math.PI / 2; this.fx.add(mesh);
    mesh.add(halo(new THREE.Color(...look[2]), look[3]));
    const cast = { fire: 'fire_cast', ice: 'ice_cast', wood: 'leaf', rock: 'rock' }[kind];
    sfx.play(cast, from === this.me ? { vol: 0.3, gap: 0.08 } : { vol: 0.12, at: from, gap: 0.15, rate: 1.3 });
    this.projectiles.push({ kind, mesh, x: p.x, z: p.z, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, speed, life, hit: new Set(), own: this.player, ...opt });
  }
  updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      this.player = pr.own;
      if (pr.target && !pr.target.dead) {   // fireballs home in gently
        const a = Math.atan2(pr.target.z - pr.z, pr.target.x - pr.x), cur = Math.atan2(pr.vz, pr.vx);
        let da = ((a - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI; da = Math.max(-4 * dt, Math.min(4 * dt, da));
        pr.vx = Math.cos(cur + da) * pr.speed; pr.vz = Math.sin(cur + da) * pr.speed;
      }
      pr.x += pr.vx * dt; pr.z += pr.vz * dt; pr.life -= dt;
      const elem = pr.kind;
      this.near(pr.x, pr.z, 0.5, e => {
        if (pr.life <= 0 || pr.hit.has(e)) return;
        pr.hit.add(e);
        if (pr.blast) { this.boom(pr.x, pr.z, pr.blast, pr.dmg, elem); pr.life = 0; }
        else { this.damage(e, pr.dmg, elem, 0.6, pr); this.parts.burst(pr.x, e.y + 1.2, pr.z, 6, PAL[elem], { speed: 6, life: 0.35, size: 0.4 }); if (pr.hit.size > pr.pierce) pr.life = 0; }
      });
      pr.mesh.position.set(pr.x, heightAt(pr.x, pr.z) + 1.1, pr.z); pr.mesh.rotation.y = -Math.atan2(pr.vz, pr.vx) + Math.PI / 2;
      const mp = pr.mesh.position;
      if (pr.kind === 'fire') for (let i = 0; i < 2; i++) this.parts.puff(mp.x, mp.y, mp.z, PAL.fire, { vy: 0.8, life: 0.35, size: 0.8, end: 0.2, jitter: 0.15 });
      else this.parts.puff(mp.x, mp.y, mp.z, PAL[pr.kind], { vy: 0.2, life: 0.3, size: 0.4, jitter: 0.1 });
      if (pr.life <= 0) this.fx.remove(pr.mesh);
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
  }
  boom(x, z, r, dmg, elem, opt = {}) {
    this.near(x, z, r, e => {
      this.damage(e, dmg, elem, 1.2, { x, z });
      if (opt.freeze) e.freezeT = Math.max(e.freezeT || 0, opt.freeze);
    });
    const y = heightAt(x, z), m = new THREE.Mesh(this.geo.disc, this.mat.boom.clone());
    m.material.color.set(ELEM_GLOW[elem]); m.material.blending = THREE.AdditiveBlending;
    m.position.set(x, y + 0.15, z); this.fx.add(m);
    this.effects.push({ kind: 'flash', mesh: m, t: 0, dur: 0.3, r });
    this.parts.burst(x, y + 0.8, z, 10 + Math.round(r * 6), PAL[elem] || PAL.gold, { speed: r * 3.5, up: 3, life: 0.5, size: 0.65, end: 0.2 });
    const smoke = { fire: PAL.smoke, rock: PAL.dust, ice: PAL.snow, wood: PAL.leaf }[elem] || PAL.dust;
    this.parts.burst(x, y + 0.6, z, 4 + Math.round(r * 2), smoke, { soft: true, speed: r * 1.5, up: 1.5, life: 0.9, size: 1.4, end: 2.2, drag: 3 });
    this.shock(x, z, r * 1.3, ELEM_GLOW[elem]);
    this.shake = Math.min(0.6, this.shake + 0.035 * r);
    sfx.play({ fire: 'boom', ice: 'ice_hit', wood: 'leaf', rock: 'rock' }[elem] || 'boom', { vol: Math.min(0.8, 0.25 + r * 0.1), at: { x, z }, gap: 0.04 });
  }
  // Expanding additive ring on the ground
  shock(x, z, r, color, dur = 0.35) {
    const m = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(x, heightAt(x, z) + 0.2, z); this.fx.add(m);
    this.effects.push({ kind: 'shock', mesh: m, t: 0, dur, r });
  }
  rockDrop(x, z, dmg, r, elem = 'rock', opt = {}) {
    const y = heightAt(x, z);
    const warn = new THREE.Mesh(this.geo.ring, this.mat.warn); warn.scale.setScalar(r); warn.position.set(x, y + 0.12, z); this.fx.add(warn);
    const look = { fire: [this.geo.ball, this.mat.fire], ice: [this.geo.spear, this.mat.ice], rock: [this.geo.rock, this.mat.rock] }[elem] || [this.geo.rock, this.mat.rock];
    const rock = new THREE.Mesh(look[0], look[1]);
    if (elem === 'fire') { rock.scale.setScalar(1.6); rock.add(halo(new THREE.Color(1.0, 0.45, 0.15), 2)); }
    if (elem === 'ice') { rock.scale.setScalar(2.2); rock.rotation.x = Math.PI / 2; rock.add(halo(new THREE.Color(0.45, 0.9, 1.2), 1)); }
    rock.position.set(x, y + 14, z); this.fx.add(rock);
    this.effects.push({ kind: 'rock', mesh: rock, warn, t: 0, dur: 0.5, x, z, y, r, dmg, elem, opt, own: this.player });
  }
  // Expanding ring that hits each enemy once as it passes (quake, fire ring, life pulse)
  nova(x, z, r, dmg, elem, knock = 2) {
    const ring = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color: ELEM_GLOW[elem], transparent: true, opacity: 0.7, depthWrite: false, blending: elem === 'rock' ? THREE.NormalBlending : THREE.AdditiveBlending }));
    ring.position.set(x, heightAt(x, z) + 0.2, z); this.fx.add(ring);
    this.effects.push({ kind: 'quake', mesh: ring, t: 0, dur: 0.45 * Math.max(1, r / 8), x, z, max: r, dmg, knock, elem, hit: new Set(), own: this.player });
  }
  later(delay, fn) { this.effects.push({ kind: 'delay', t: 0, dur: delay || 0.001, fn, own: this.player }); }
  // Damage-over-time ground: burning, freezing, poison clouds, whirlwinds (optionally moving)
  addZone({ x, z, r, dur, dps, elem, slow = 0, vx = 0, vz = 0, tall = false, swirl = false, cloud = false }) {
    const m = new THREE.Mesh(this.geo.disc, new THREE.MeshBasicMaterial({ color: ELEM_GLOW[elem], transparent: true, opacity: 0.32, depthWrite: false, blending: elem === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.scale.setScalar(r); m.position.set(x, heightAt(x, z) + 0.13, z); this.fx.add(m);
    this.zones.push({ x, z, r, t: dur, dps, elem, slow, vx, vz, tall, swirl, cloud, mesh: m, tick: 0, own: this.player });
  }
  updateZones(dt) {
    for (const zn of this.zones) {
      this.player = zn.own;
      zn.t -= dt; zn.x += zn.vx * dt; zn.z += zn.vz * dt;
      const y = heightAt(zn.x, zn.z);
      zn.mesh.position.set(zn.x, y + 0.13, zn.z); zn.mesh.material.opacity = 0.32 * Math.min(1, zn.t * 2);
      if ((zn.tick -= dt) <= 0) {
        zn.tick = 0.4;
        this.near(zn.x, zn.z, zn.r, e => {
          this.damage(e, zn.dps * 0.4, zn.elem);
          if (zn.slow) { e.slowT = Math.max(e.slowT, 0.6); e.slowF = Math.min(e.slowF, 1 - zn.slow); }
          if (zn.swirl && zn.vx) { e.x += (zn.x - e.x) * 0.15; e.z += (zn.z - e.z) * 0.15; }   // whirlwinds drag enemies along
        });
      }
      const a = rand() * 6.283, d = Math.sqrt(rand()) * zn.r, px = zn.x + Math.cos(a) * d, pz = zn.z + Math.sin(a) * d;
      if (zn.elem === 'fire') this.parts.puff(px, y + 0.3, pz, PAL.fire, { vy: zn.tall ? 4 : 2, life: zn.tall ? 0.6 : 0.45, size: zn.tall ? 0.9 : 0.6, end: 0.1, jitter: 0.2 });
      else if (zn.cloud) this.parts.puff(px, y + 0.8, pz, PAL.leaf, { soft: true, vy: 0.4, life: 1.2, size: 1.4, end: 1.6, jitter: 0.3 });
      else if (zn.swirl) { const sa = this.time * 8 + rand() * 6.283, sr = zn.r * (0.3 + rand() * 0.7); this.parts.puff(zn.x + Math.cos(sa) * sr, y + 0.5 + rand() * 2.5, zn.z + Math.sin(sa) * sr, zn.elem === 'ice' ? PAL.snow : PAL.dust, { soft: zn.elem !== 'ice', vx: -Math.sin(sa) * 6, vz: Math.cos(sa) * 6, vy: 1, life: 0.5, size: zn.elem === 'ice' ? 0.35 : 0.9, jitter: 0 }); }
      else this.parts.puff(px, y + 0.3, pz, PAL[zn.elem], { vy: 0.8, life: 0.5, size: 0.4, jitter: 0.2 });
      if (zn.t <= 0) this.fx.remove(zn.mesh);
    }
    this.zones = this.zones.filter(zn => zn.t > 0);
  }
  updateEffects(dt) {
    for (const f of this.effects) {
      if (f.own) this.player = f.own;
      f.t += dt; const k = Math.min(1, f.t / f.dur);
      if (f.kind === 'rock') {
        f.mesh.position.y = f.y + 14 * (1 - k * k); if (f.elem !== 'ice') f.mesh.rotation.x += dt * 6;
        const q = f.mesh.position;
        if (f.elem === 'fire') this.parts.puff(q.x, q.y, q.z, PAL.fire, { vy: 2, life: 0.35, size: 0.9, end: 0.3, jitter: 0.3 });
        else if (f.elem === 'ice') this.parts.puff(q.x, q.y, q.z, PAL.ice, { vy: 1, life: 0.3, size: 0.4, jitter: 0.2 });
        else this.parts.puff(q.x, q.y, q.z, PAL.dust, { soft: true, vy: 1, life: 0.4, size: 0.8, end: 1.5, jitter: 0.3 });
        if (k >= 1) { this.fx.remove(f.warn); this.boom(f.x, f.z, f.r, f.dmg, f.elem, f.opt); }
      } else if (f.kind === 'quake') {
        const r = 0.5 + f.max * k; f.mesh.scale.setScalar(r); f.mesh.material.opacity = 0.7 * (1 - k);
        const el = f.elem || 'rock';
        this.near(f.x, f.z, r, e => { if (!f.hit.has(e)) { f.hit.add(e); this.damage(e, f.dmg, el, f.knock, f); } });
        if (el === 'rock') this.parts.ring(f.x, heightAt(f.x, f.z), f.z, r, Math.min(24, 4 + Math.ceil(r)), PAL.dust, { soft: true, speed: 1.5, life: 0.6, size: 1.2 });
        else this.parts.ring(f.x, heightAt(f.x, f.z), f.z, r, Math.min(28, 6 + Math.ceil(r * 1.5)), PAL[el], { speed: 2.5, life: 0.4, size: 0.7 });
        if (f.max > 20) this.parts.ring(f.x, heightAt(f.x, f.z), f.z, r, 10, PAL.rock, { speed: 2, life: 0.5, size: 0.7 });
      } else if (f.kind === 'zone') { f.mesh.material.opacity = 0.45 * (1 - k); if (f.shrink) f.mesh.scale.setScalar(f.r * (1 - 0.8 * k));
      } else if (f.kind === 'delay') { if (k >= 1) f.fn();
      } else if (f.kind === 'shock') { f.mesh.scale.setScalar(f.r * (0.25 + 0.75 * (1 - (1 - k) ** 3))); f.mesh.material.opacity = 0.9 * (1 - k);
      } else if (f.kind === 'flash') { f.mesh.scale.setScalar(f.r * (0.6 + 0.4 * k)); f.mesh.material.opacity = 0.6 * (1 - k); }
      if (k >= 1 && f.mesh) this.fx.remove(f.mesh);
    }
    this.effects = this.effects.filter(f => f.t < f.dur);
  }

  // ---- player-triggered skills: left click (signature), Shift (dash), Q (ultimate)
  setAim(x, z) { this.aim.x = x; this.aim.z = z; }
  aimAt(range) {
    const p = this.player, dx = this.aim.x - p.x, dz = this.aim.z - p.z, d = Math.hypot(dx, dz) || 1, k = Math.min(1, range / d);
    return { x: p.x + dx * k, z: p.z + dz * k, dx: dx / d, dz: dz / d };
  }
  useActive() {
    const a = this.active, def = ACTIVES[a.key];
    if (this.over || a.t > 0) return false;
    a.t = def.cd * this.cdMul;
    const p = this.player, t = this.aimAt(def.range);
    sfx.play({ fireDash: 'firedash', iceField: 'icefield', vineSnare: 'vine', rockWall: 'wall' }[a.key], { vol: 0.6 });
    if (a.key === 'fireDash') this.startDash(t.x - p.x, t.z - p.z, Math.max(3, Math.hypot(t.x - p.x, t.z - p.z)), 0.26, true);
    else if (a.key === 'iceField') {
      this.near(t.x, t.z, def.radius, e => { e.freezeT = 2; this.damage(e, 10, 'ice'); });
      this.zone(t.x, t.z, def.radius, '#c9f1ff', 2);
      const ty = heightAt(t.x, t.z); this.shock(t.x, t.z, def.radius * 1.2, '#bff0ff', 0.45);
      this.parts.burst(t.x, ty + 0.6, t.z, 60, PAL.ice, { speed: 10, up: 5, life: 0.7, size: 0.6, grav: 6 });
      this.parts.burst(t.x, ty + 0.5, t.z, 18, PAL.snow, { soft: true, speed: 5, up: 1, life: 1.1, size: 1.4, end: 2, drag: 3 });
      this.shake = Math.max(this.shake, 0.2);
    } else if (a.key === 'vineSnare') {
      this.near(t.x, t.z, def.radius, e => {
        if (!e.elite) { e.x += (t.x - e.x) * 0.75; e.z += (t.z - e.z) * 0.75; }
        e.rootT = 2.5; this.damage(e, 8, 'wood');
      });
      this.zone(t.x, t.z, def.radius, '#7fe05a', 0.6, true);
      const ty = heightAt(t.x, t.z);
      for (let i = 0; i < 48; i++) {   // vines lash inwards from the rim
        const a = (i / 48) * Math.PI * 2, r = def.radius * (0.8 + rand() * 0.3), sp = r / 0.45;
        this.parts.glow.emit(t.x + Math.cos(a) * r, ty + 0.4 + rand(), t.z + Math.sin(a) * r, -Math.cos(a) * sp, 0, -Math.sin(a) * sp, 0.45, 0.7, 0.2, PAL.wood[i % 3], 0, 0);
      }
      this.parts.burst(t.x, ty + 0.5, t.z, 16, PAL.leaf, { soft: true, speed: 3, up: 3, life: 1, size: 0.6, grav: 3 });
    } else if (a.key === 'rockWall') this.addWall(t.x, t.z, -t.dz, t.dx);
    this.used = (this.used || 0) + 1;
    return true;
  }
  dash() {
    const p = this.player;
    if (this.over || this.dashCd > 0 || p.dashT > 0) return false;
    this.dashCd = 3 * this.cdMul;
    let dx = p.vx, dz = p.vz;
    if (Math.hypot(dx, dz) < 1) { dx = this.aim.x - p.x; dz = this.aim.z - p.z; }   // standing still: dash towards the mouse
    this.startDash(dx, dz, 7, 0.18, false); sfx.play('dash', { vol: 0.5 });
    return true;
  }
  startDash(dx, dz, dist, dur, fire) {
    const p = this.player, d = Math.hypot(dx, dz) || 1;
    p.dashV = { x: dx / d * dist / dur, z: dz / d * dist / dur }; p.dashT = dur; p.dashFire = fire; p.trailAcc = 0;
    p.dashHit = new Set(); p.inv = Math.max(p.inv, dur + 0.25);
  }
  dashStep(dt) {
    const p = this.player, step = Math.min(dt, p.dashT);
    p.dashT -= dt;
    p.x += p.dashV.x * step; p.z += p.dashV.z * step;
    p.vx = p.dashV.x * 0.15; p.vz = p.dashV.z * 0.15;
    if (!p.dashFire) { for (let i = 0; i < 2; i++) this.parts.puff(p.x, p.y + 1, p.z, PAL.snow, { soft: true, vy: 0.3, life: 0.35, size: 0.9, end: 1.5, jitter: 0.5 }); return; }
    for (let i = 0; i < 4; i++) this.parts.puff(p.x, p.y + 0.8, p.z, PAL.fire, { vy: 1.5, life: 0.45, size: 1.1, end: 0.3, jitter: 0.6 });
    this.near(p.x, p.z, 1.6, e => { if (!p.dashHit.has(e)) { p.dashHit.add(e); this.damage(e, 22, 'fire', 1.5, p); } });
    if ((p.trailAcc += Math.hypot(p.dashV.x, p.dashV.z) * step) >= 1.2) {   // burning ground every 1.2 m
      p.trailAcc = 0;
      const m = new THREE.Mesh(this.geo.disc, this.mat.boom.clone()); m.scale.setScalar(1.8); m.position.set(p.x, heightAt(p.x, p.z) + 0.12, p.z); this.fx.add(m);
      this.trails.push({ x: p.x, z: p.z, t: 3, tick: 0, mesh: m, own: p });
    }
  }
  zone(x, z, r, color, dur, shrink = false) {
    const m = new THREE.Mesh(this.geo.disc, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    m.scale.setScalar(r); m.position.set(x, heightAt(x, z) + 0.14, z); this.fx.add(m);
    this.effects.push({ kind: 'zone', mesh: m, t: 0, dur, r, shrink });
  }
  // Rock wall: a row of boulders that bursts out of the ground, then crumbles back down
  addWall(x, z, tx, tz) {
    const group = new THREE.Group(), rocks = [];
    const kinds = ['rock_tallA', 'rock_tallC', 'rock_tallF', 'stone_tallB'];
    for (let i = 0; i < 9; i++) {
      const s = (i / 8 - 0.5) * 10 + rnd(-0.3, 0.3), off = rnd(-0.3, 0.3);
      const px = x + tx * s - tz * off, pz = z + tz * s + tx * off;
      const big = i % 2 === 0, r = makeProp(kinds[Math.floor(rand() * kinds.length)], big ? rnd(2.6, 3.4) : rnd(1.8, 2.4), '#9c8b78');
      r.rotation.y = rand() * Math.PI * 2;
      r.position.set(px, heightAt(px, pz), pz);
      r.userData.y = r.position.y; r.userData.delay = Math.abs(i - 4) * 0.035;   // rises from the middle outwards
      group.add(r); rocks.push(r);
    }
    for (let i = 0; i < 5; i++) {   // rubble at the foot
      const s = rnd(-5, 5), side = rand() < 0.5 ? -1 : 1, px = x + tx * s - tz * side * 0.9, pz = z + tz * s + tx * side * 0.9;
      const r = makeProp('rock_smallA', rnd(0.6, 1), '#9c8b78'); r.rotation.y = rand() * 6;
      r.position.set(px, heightAt(px, pz), pz); r.userData.y = r.position.y; r.userData.delay = 0.2; group.add(r); rocks.push(r);
    }
    this.fx.add(group);
    const w = { x, z, tx, tz, half: 5, t: 8, life: 8, mesh: group, rocks, faded: false };
    this.walls.push(w);
    for (let s = -5; s <= 5; s += 2.5) {   // dust and flying debris along the wall
      const px = x + tx * s, pz = z + tz * s, py = heightAt(px, pz);
      this.zone(px, pz, 2.2, '#b49a7a', 0.6);
      this.parts.burst(px, py + 0.5, pz, 6, PAL.dust, { soft: true, speed: 3, up: 2, life: 0.9, size: 1.5, end: 2.2, drag: 3 });
      this.parts.burst(px, py + 0.5, pz, 5, PAL.rock, { speed: 4, up: 7, life: 0.8, size: 0.4, grav: 18, drag: 0.5 });
    }
    this.shake = Math.max(this.shake, 0.3);
    this.animateWall(w);
    for (const e of this.enemies) if (this.wallDist(w, e) < 1.6) this.damage(e, 20, 'rock', 3, { x: e.x - w.tz, z: e.z + w.tx });
  }
  wallClosest(w, e) {
    const s = Math.max(-w.half, Math.min(w.half, (e.x - w.x) * w.tx + (e.z - w.z) * w.tz));
    return { x: w.x + w.tx * s, z: w.z + w.tz * s };
  }
  // Rise in the first 0.3 s (with a little overshoot), sink in the last 0.6 s; see-through while you stand next to it
  animateWall(w) {
    const age = w.life - w.t, p = this.me;
    for (const r of w.rocks) {
      const a = Math.min(1, Math.max(0, (age - r.userData.delay) / 0.3));
      const rise = a < 1 ? 1 - (1 - a) ** 3 + Math.sin(a * Math.PI) * 0.12 : 1;
      const sink = Math.min(1, Math.max(0, w.t / 0.6));
      const h = r.userData.h ??= new THREE.Box3().setFromObject(r).getSize(new THREE.Vector3()).y;
      r.position.y = r.userData.y - h * (1 - rise * sink) - 0.1;
    }
    const fade = this.wallDist(w, p) < 4;
    if (fade !== w.faded) {
      w.faded = fade;
      w.mesh.traverse(o => { if (o.material) { o.material.transparent = fade; o.material.opacity = fade ? 0.4 : 1; o.material.depthWrite = !fade; } });
    }
  }
  wallDist(w, e) { const c = this.wallClosest(w, e); return Math.hypot(e.x - c.x, e.z - c.z); }
  wallPush(w, e) {
    const c = this.wallClosest(w, e), dx = e.x - c.x, dz = e.z - c.z, d = Math.hypot(dx, dz) || 0.01, min = e.radius + 0.65;
    if (d < min) { e.x = c.x + dx / d * min; e.z = c.z + dz / d * min; }
  }
  useUlt() {
    const p = this.player;
    if (this.over || this.ult < 1 || this.ultT > 0) return false;
    this.ult = 0; this.ultTick = 0;
    if (p.elem === 'fire') this.ultT = 8;
    else if (p.elem === 'wood') {
      this.ultT = 10;
      this.ultMesh = new THREE.Mesh(this.geo.disc, new THREE.MeshBasicMaterial({ color: '#8cff6a', transparent: true, opacity: 0.3, depthWrite: false }));
      this.fx.add(this.ultMesh);
    } else if (p.elem === 'ice') {
      this.near(p.x, p.z, 35, e => { e.freezeT = 4; this.damage(e, 20, 'ice'); });
      this.zone(p.x, p.z, 35, '#c9f1ff', 1.2); this.shock(p.x, p.z, 36, '#ffffff', 0.7);
      for (let i = 0; i < 160; i++) { const a = rand() * 6.283, d = Math.sqrt(rand()) * 32, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; this.parts.puff(x, heightAt(x, z) + 0.5, z, i % 2 ? PAL.ice : PAL.snow, { vy: 3, life: 1.2, size: 0.8, jitter: 0 }); }
    } else {
      const ring = new THREE.Mesh(this.geo.ring, this.mat.wave.clone()); ring.position.set(p.x, p.y + 0.2, p.z); this.fx.add(ring);
      this.effects.push({ kind: 'quake', mesh: ring, t: 0, dur: 0.9, x: p.x, z: p.z, max: 32, dmg: 60, knock: 6, hit: new Set(), own: this.player });
    }
    this.say('필살기!'); sfx.play('ult', { vol: 0.8 }); sfx.play('bigboom', { vol: 0.6 });
    this.parts.burst(p.x, p.y + 1.5, p.z, 70, PAL[p.elem], { speed: 12, up: 6, life: 0.8, size: 0.9 });
    this.shock(p.x, p.z, 10, ELEM_GLOW[p.elem], 0.5);
    this.shake = Math.max(this.shake, 0.6);
    this.ultsUsed = (this.ultsUsed || 0) + 1;
    return true;
  }
  updateActives(dt) {
    const p = this.player;
    this.active.t = Math.max(0, this.active.t - dt); this.dashCd = Math.max(0, this.dashCd - dt);
    if (this.ultT > 0) this.updateUlt(dt, p);
  }
  updateTrails(dt) {
    for (const tr of this.trails) {
      this.player = tr.own;
      tr.t -= dt; tr.mesh.material.opacity = 0.55 * Math.min(1, tr.t);
      if (rand() < 0.6) this.parts.puff(tr.x, heightAt(tr.x, tr.z) + 0.3, tr.z, PAL.fire, { vy: 2.2, life: 0.5, size: 0.6, end: 0.1, jitter: 0.8 });
      if ((tr.tick -= dt) <= 0) { tr.tick = 0.4; this.near(tr.x, tr.z, 1.8, e => this.damage(e, 8, 'fire')); }
      if (tr.t <= 0) this.fx.remove(tr.mesh);
    }
    this.trails = this.trails.filter(t => t.t > 0);
    for (const w of this.walls) {
      w.t -= dt; this.animateWall(w);
      if (w.t <= 0) { this.fx.remove(w.mesh); for (const r of w.rocks) r.traverse(o => o.material?.dispose()); }
    }
    this.walls = this.walls.filter(w => w.t > 0);
  }
  updateUlt(dt, p) {
    {
      this.ultT -= dt;
      if (p.elem === 'fire' && (this.ultTick -= dt) <= 0) {
        this.ultTick = 0.15;
        const a = rand() * Math.PI * 2, r = 3 + rand() * 20;
        this.rockDrop(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 40, 3, 'fire');
      }
      if (p.elem === 'wood') {
        this.ultMesh.scale.setScalar(6); this.ultMesh.position.set(p.x, p.y + 0.16, p.z);
        for (let i = 0; i < 3; i++) { const a = rand() * 6.283, d = rand() * 6; this.parts.puff(p.x + Math.cos(a) * d, p.y + 0.2, p.z + Math.sin(a) * d, PAL.heal, { vy: 2.5, life: 0.9, size: 0.5, jitter: 0 }); }
        if (rand() < 0.3) { const a = rand() * 6.283; this.parts.puff(p.x + Math.cos(a) * 6, p.y + 2.5, p.z + Math.sin(a) * 6, PAL.leaf, { soft: true, vy: -0.6, life: 1.4, size: 0.5, jitter: 1 }); }
        p.hp = Math.min(p.maxHp, p.hp + 8 * dt);
        if ((this.ultTick -= dt) <= 0) { this.ultTick = 0.5; this.near(p.x, p.z, 6, e => this.damage(e, 12, 'wood', 3, p)); }
        if (this.ultT <= 0) { this.fx.remove(this.ultMesh); this.ultMesh = null; }
      }
    }
  }

  // ---- pickups
  dropGem(x, z, value) {
    if (this.gems.length >= 590) { this.gems[Math.floor(rand() * this.gems.length)].value += value; return; }
    this.gems.push({ x, z, y: heightAt(x, z) + 0.5, value, mag: false, v: 0 });
  }
  updatePickups(dt) {
    const alive = this.aliveP();
    for (const g of this.gems) {   // gems fly to the closest player, whose XP it is
      const p = this.nearestPlayer(g.x, g.z); if (!p) break;
      this.player = p;
      const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
      if (d < this.magnet) g.mag = true;
      if (g.mag) { g.v = Math.min(30, g.v + 40 * dt); g.x += dx / (d || 1) * Math.min(d, g.v * dt); g.z += dz / (d || 1) * Math.min(d, g.v * dt); g.y = heightAt(g.x, g.z) + 0.8; }
      if (d < 0.8) {
        g.taken = true;
        p.xp += g.value * (1 + 0.08 * (p.meta.xp || 0)); p.party.gainXp(g.value);
        if (p === this.me) sfx.play('gem', { vol: 0.14, gap: 0.035, rate: g.value >= 5 ? 0.8 : 1.2 });
        this.parts.puff(p.x, p.y + 1.2, p.z, PAL.ice, { vy: 2, life: 0.3, size: 0.4 });
      }
    }
    this.gems = this.gems.filter(g => !g.taken);
    for (const p of this.players) {
      if (p.gone) continue;
      this.player = p;
      while (p.xp >= p.next) {
        p.xp -= p.next; p.level++; p.next = Math.floor(5 + (p.level - 1) * 4 + p.level ** 1.75); p.pendingLevels++;
        if (p === this.me) sfx.play('levelup', { vol: 0.6 });
        this.parts.burst(p.x, p.y + 1, p.z, 60, PAL.gold, { speed: 8, up: 9, life: 1, size: 0.6, grav: 6 }); this.shock(p.x, p.z, 6, '#ffd257', 0.5);
      }
      if (p.pendingLevels > 0 && !p.offers) p.offers = this.offer();
    }
    for (const h of this.heals) for (const p of alive) if (!h.taken && Math.hypot(p.x - h.x, p.z - h.z) < 1.2) { h.taken = true; p.hp = Math.min(p.maxHp, p.hp + 30); sfx.play('heal', { vol: 0.5, at: p }); }
    this.heals = this.heals.filter(h => !h.taken);
  }

  showDamage(e) { if (e.dn) { this.nums.add(e.x, e.y + e.size * 0.75, e.z, e.dn.v, e.dn.m); e.dn = null; } }
  playerRing(i) {
    const m = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color: PCOLOR[i], transparent: true, opacity: 0.9, depthWrite: false }));
    this.fx.add(m); return m;
  }

  // ---- drawing (sprites + instanced pickups)
  draw(dt = 0) {
    this.parts.update(dt); this.shake = Math.max(0, this.shake - dt * 2.5);
    for (const k in this.batches) this.batches[k].begin();
    this.shadows.begin();
    const t = this.time, multi = this.players.length > 1;
    this.players.forEach((p, i) => {
      const ring = multi && (this.pRings[i] ??= this.playerRing(i));
      if (ring) ring.visible = !p.gone;
      if (p.gone) return;
      const moving = Math.hypot(p.vx, p.vz) > 0.5, side = p.vx * this.view.x + p.vz * this.view.z;   // others face the way they walk on this screen
      if (p !== this.me && Math.abs(side) > 0.3) p.vflip = side > 0 ? 1 : -1;
      this.batches[p.key].add(p.x, p.y, p.z, 4.2, p.down ? 0 : Math.floor(t * (moving ? 14 : 6)) % 12, p === this.me ? p.flip : p.vflip || 1,
        p.down ? -1 : p.inv > 0 ? 0.6 * (Math.sin(t * 40) > 0) : 0);
      this.shadows.add(p.x, p.y, p.z, 0.75);
      if (ring) { ring.position.set(p.x, p.y + 0.1, p.z); ring.scale.setScalar(p.down ? 1.3 + 0.25 * Math.sin(t * 6) : 1.1); }
      p.party.draw();
    });
    for (const e of this.enemies) {
      if (e.dn && this.time - e.dn.t >= 0.3) this.showDamage(e);
      if (e.hidden || e.noSprite) continue;   // rift crystals are meshes of their own
      this.batches[e.key].add(e.x, e.y, e.z, e.size, Math.floor(t * 10 + e.phase) % 12, e.flip, e.flash > 0.05 ? e.flash : e.freezeT > 0 ? -1 : e.rootT > 0 ? -2 : 0);
      this.shadows.add(e.x, e.y, e.z, e.radius * 0.9);
    }
    for (const k in this.batches) this.batches[k].end();
    this.shadows.end();
    const m = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 3), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    this.gems.forEach((g, i) => {
      const big = g.value >= 20 ? 1.8 : g.value >= 5 ? 1.35 : 1;
      this.gemMesh.setMatrixAt(i, m.compose(v.set(g.x, g.y + Math.sin(t * 3 + i) * 0.1, g.z), q, s.setScalar(big)));
      this.gemMesh.setColorAt(i, c.set(g.value >= 20 ? '#ff5d5d' : g.value >= 5 ? '#5dff8a' : '#5db8ff'));
    });
    this.gemMesh.count = this.gems.length; this.gemMesh.instanceMatrix.needsUpdate = true; this.gemMesh.instanceColor.needsUpdate = true;
    this.heals.forEach((h, i) => this.healMesh.setMatrixAt(i, m.compose(v.set(h.x, h.y + Math.sin(t * 2) * 0.15, h.z), q, s.setScalar(1))));
    this.healMesh.count = Math.min(60, this.heals.length); this.healMesh.instanceMatrix.needsUpdate = true;
  }
}

// Per-player state lives on the player object; this.player is whoever is being simulated at the moment
// (the local player between steps), so skills, actives and companions read their own owner's state.
for (const k of ['skills', 'passives', 'active', 'dashCd', 'ult', 'ultT', 'ultTick', 'ultMesh', 'orbits', 'auraMesh', 'aim', 'party', 'syn', 'takenMul', 'playerSlow', 'pendingLevels', 'camRight'])
  Object.defineProperty(Game.prototype, k, { get() { return this.player[k]; }, set(v) { this.player[k] = v; } });
