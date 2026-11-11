// Field bosses and the four element dungeons.
// Each region has a field boss that drops its key; E at the cave mouth enters the dungeon: a corridor of three
// packs, a gate, then a round boss room with a co-op mechanic (companions sent with F stand in for friends):
//   ice  쌍둥이 빙하룡 — kill both within 10 s of each other, keep them apart
//   fire 용광로 수호룡 — overheated (-90%) until both cooling valves are held at once for 3 s
//   wood 천년 고목 정령 — four sap roots heal it; cut all four within 5 s to weaken it, and free snared allies
//   rock 고대 골렘    — armoured until its charge is lured into a stone pillar (stunned 5 s)
// Every boss attack is telegraphed with a red ground circle.
import * as THREE from 'three';
import { BIOMES, ELEM } from './data.js';
import { heightAt, makeProp, DUNGEONS } from './world.js';
import { PAL, halo } from './fx.js';
import { dex } from './dex.js';
import { meta } from './meta.js';
import { sfx } from './audio.js';
import { rand } from './rng.js';

const X0 = 1000, ROOM_R = 16, CORR_W = 4, CORR_END = 64;   // interiors sit far east of the map, one per element
const rnd = (a, b) => a + rand() * (b - a);
const vr = (a, b) => a + Math.random() * (b - a);   // looks only
const C = (r, g, b) => new THREE.Color(r, g, b);

export const DEFS = {
  ice: { z0: 0, name: '빙결 성채', key: '얼음', field: { key: 'Frostbuck', name: '서리뿔 사슴왕', lair: { x: 0, z: -165 }, ai: 'stag', where: '북쪽 설원' },
    boss: 'twins', title: '쌍둥이 빙하룡', hint: '둘을 떼어 놓고, 10초 안에 둘 다 쓰러뜨리세요', spawn: 'dungeon', elite: 'Snowdrifter',
    floor: '#8fb6c8', wall: '#d6eef8', gate: '#9fe8ff', fog: '#0c1824', ambient: 'snow', portal: C(0.6, 1.4, 2) },
  fire: { z0: 200, name: '용암 용광로', key: '불', field: { key: 'Jewelstinger', name: '모래 전갈왕', lair: { x: 0, z: 165 }, ai: 'scorpion', where: '남쪽 사막' },
    boss: 'furnace', title: '용광로 수호룡', hint: '양쪽 냉각 밸브를 동시에 지키세요 (친구나 F로 보낸 동료와 함께, 혼자면 밸브가 4초간 열려 있음)', spawn: 'desert', elite: 'Inariflame',
    floor: '#4a2e26', wall: '#8a5040', gate: '#ff8a3a', fog: '#26100a', ambient: 'ember', portal: C(2, 0.9, 0.4) },
  wood: { z0: 400, name: '고목의 뿌리 미궁', key: '나무', field: { key: 'Springtail', name: '늪지 식인꽃', lair: { x: 165, z: 0 }, ai: 'flower', where: '동쪽 늪지' },
    boss: 'tree', title: '천년 고목 정령', hint: '수액 뿌리 4개를 5초 안에 모두 끊으면 정령이 약해집니다', spawn: 'swamp', elite: 'Chamelord',
    floor: '#34502a', wall: '#6f8f4a', gate: '#7fe05a', fog: '#0c180b', ambient: 'spore', portal: C(0.6, 1.8, 0.5) },
  rock: { z0: 600, name: '지저 신전', key: '암석', field: { key: 'Widoweb', name: '바위 거미', lair: { x: -165, z: 0 }, ai: 'spider', where: '서쪽 돌산' },
    boss: 'golem', title: '고대 골렘', hint: '돌진을 돌기둥으로 유인하면 기절합니다 — 그때만 피해가 들어갑니다', spawn: 'rock', elite: 'Tyraskull',
    floor: '#6a6054', wall: '#a08f7e', gate: '#e0b87a', fog: '#15110c', ambient: 'dust', portal: C(1.6, 1.2, 0.6) },
};
const ELEMS = Object.keys(DEFS);   // the four element dungeons (the rift below is the fifth, final one)
DEFS.rift = { z0: 800, name: '균열의 심연', key: '균열', boss: 'rift', title: '균열의 왕', spawn: 'mix', elite: 'Tyraskull',
  hint: '12초마다 속성이 바뀝니다 — 약점 속성이 잘 통합니다. 체력 70%·35%에서 보호막: 균열 수정 4개를 부수세요',
  floor: '#2b2340', wall: '#6c5a96', gate: '#c08aff', fog: '#0d0a18', ambient: 'rift', portal: C(1.4, 0.8, 2) };
const FORMS = ['fire', 'ice', 'wood', 'rock'], WEAK = { fire: 'rock', ice: 'fire', wood: 'ice', rock: 'wood' };   // WEAK[x]: the element that beats x
const SPAWN_OF = { fire: 'desert', ice: 'snow', wood: 'swamp', rock: 'rock' };
const MIX = ['desert', 'snow', 'swamp', 'rock'].flatMap(b => BIOMES[b].spawn);
export const RIFT_WARN = 30 * 60, RIFT_OPEN = 35 * 60, RIFT_KING = 40 * 60;
const kingHp = (lv) => 7000 + 750 * lv;   // solo with a full kit (~Lv 65): about 2.5-4 min incl. two shields

export class Dungeon {
  constructor(game) { this.g = game; this.built = {}; this.resetRun(); }
  resetRun() {   // a new run: geometry is kept, everything else starts over
    this.inside = false; this.cur = null; this.phase = null; this.keys = {}; this.cleared = {};
    this.tele = []; this.hazards = []; this.bosses = [];
    this.field = {}; this.fieldT = {}; for (const el of ELEMS) this.fieldT[el] = 0;
    this.riftOpen = this.riftWarned = this.kingOut = this.riftUsed = false; if (this.mark) this.mark.visible = false;
    for (const b of Object.values(this.built)) { b.portal.visible = false; for (const r of b.gate) r.visible = true; }
  }
  get def() { return this.cur ? DEFS[this.cur] : null; }
  get z0() { return this.def.z0; }

  // ---------------- shared boss tools
  // Red warning circle that fills up, then fn() fires
  telegraph(x, z, r, delay, fn) {
    sfx.play('warn', { vol: 0.25, at: { x, z }, gap: 0.25 });
    const g = this.g, y = heightAt(x, z) + 0.13;
    const ring = new THREE.Mesh(g.geo.ring, g.mat.warn); ring.scale.setScalar(r); ring.position.set(x, y, z);
    const fill = new THREE.Mesh(g.geo.disc, new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.28, depthWrite: false }));
    fill.position.set(x, y - 0.01, z); fill.scale.setScalar(0.01);
    g.fx.add(ring); g.fx.add(fill);
    this.tele.push({ x, z, r, t: 0, delay, fn, ring, fill });
  }
  // Damage the player and companions inside a circle (a dash dodges it)
  hitArea(x, z, r, dmg) {
    const g = this.g;
    for (const p of g.aliveP()) if (Math.hypot(p.x - x, p.z - z) <= r + p.radius && !(p.dashT > 0)) { g.hurtPlayer(p, dmg, 0.4); p.inv = Math.max(p.inv, 0.3); }
    for (const c of g.allies()) if (Math.hypot(c.x - x, c.z - z) <= r + c.radius) g.party.hurt(c, dmg);
  }
  // Lingering ground: frost (slow), poison, fire, webs
  hazard(x, z, r, life, { color = '#d6f4ff', slow = 0.55, dps = 6, pal = PAL.snow } = {}) {
    const g = this.g, m = new THREE.Mesh(g.geo.disc, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
    m.scale.setScalar(r); m.position.set(x, heightAt(x, z) + 0.11, z); g.fx.add(m);
    this.hazards.push({ x, z, r, t: life, mesh: m, tick: 0, slow, dps, pal });
  }
  frost(x, z, r, life) { this.hazard(x, z, r, life); }
  burst(x, z, r, pal, color) {
    const g = this.g, y = heightAt(x, z);
    g.parts.burst(x, y + 0.5, z, 24, pal, { speed: r * 3, up: 8, life: 0.6, size: 0.55, grav: 14 });
    g.shock(x, z, r, color, 0.3); g.shake = Math.max(g.shake, 0.2);
  }
  icy(x, z, r) { this.burst(x, z, r, PAL.ice, '#bff0ff'); }
  boss(e, name, ai) { Object.assign(e, { boss: true, name, ai, atkT: 2.5, home: { x: e.x, z: e.z } }); return e; }
  spawnBoss(key, x, z, name, hp, size, radius, ai) {
    const g = this.g;
    g.addEnemy(key, x, z, true, 200);
    const e = g.enemies[g.enemies.length - 1];
    e.hp = e.maxHp = hp * g.bossScale; e.size = size; e.radius = radius; e.dmg = 18;
    return this.boss(e, name, ai);
  }
  nearestTarget(e) {   // the closest player (the current one) or a companion, whichever is closer
    const g = this.g; let tg = g.player, bd = Math.hypot(g.player.x - e.x, g.player.z - e.z);
    for (const c of g.allies()) { const d = Math.hypot(c.x - e.x, c.z - e.z); if (d < bd) { bd = d; tg = c; } }
    return { tg, d: bd };
  }
  walkTo(e, x, z, speed, dt, stop = 4) {
    const d = Math.hypot(x - e.x, z - e.z);
    if (!(e.freezeT > 0 || e.rootT > 0) && d > stop) { e.x += (x - e.x) / d * speed * dt; e.z += (z - e.z) / d * speed * dt; }
    return d;
  }
  // Field bosses wander back home and heal when you run away
  leash(e, dt) {
    const p = this.g.player;
    if (Math.hypot(p.x - e.x, p.z - e.z) < 50) return false;
    this.walkTo(e, e.home.x, e.home.z, 6, dt, 1);
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.05 * dt); e.hidden = false;
    return true;
  }

  // ---------------- field bosses
  spawnField(el) {
    const f = DEFS[el].field, g = this.g;
    const e = this.spawnBoss(f.key, f.lair.x, f.lair.z, f.name, 1500 * (1 + g.time / 600), 10, 2.2, (e, dt) => this[f.ai + 'AI'](e, dt));
    e.speed = 3.2; e.fieldOf = el;
    this.field[el] = e;
    sfx.play('roar', { vol: 0.7, at: e, rate: 0.8 });
  }
  stagAI(e, dt) {   // 서리뿔 사슴왕: charges leaving frost, icicle rain
    const g = this.g, p = g.player;
    if (e.windup) { if ((e.windup.t -= dt) <= 0) { e.charge = { dx: e.windup.dx, dz: e.windup.dz, t: 0.75, trail: 0, hit: false }; e.windup = null; } return; }
    if (e.charge) {
      e.charge.t -= dt; e.x += e.charge.dx * 30 * dt; e.z += e.charge.dz * 30 * dt;
      if ((e.charge.trail -= dt) <= 0) { e.charge.trail = 0.08; this.frost(e.x, e.z, 2, 5); }
      if (!e.charge.hit && g.aliveP().some(q => Math.hypot(q.x - e.x, q.z - e.z) < 3)) { e.charge.hit = true; this.hitArea(e.x, e.z, 3, 28); }
      g.parts.puff(e.x, e.y + 1, e.z, PAL.snow, { soft: true, vy: 1, life: 0.5, size: 1.6, end: 1.5, jitter: 1.2 });
      if (e.charge.t <= 0) e.charge = null;
      return;
    }
    if (this.leash(e, dt)) return;
    const d = this.walkTo(e, p.x, p.z, e.speed, dt);
    if ((e.atkT -= dt) > 0) return;
    if (rand() < 0.55) {
      const dx = (p.x - e.x) / (d || 1), dz = (p.z - e.z) / (d || 1);
      e.atkT = 3.2;
      for (let s = 3; s <= 22; s += 3.8) this.telegraph(e.x + dx * s, e.z + dz * s, 2.2, 0.9, () => {});
      e.windup = { dx, dz, t: 0.9 }; sfx.play('roar', { vol: 0.8, at: e, rate: 0.75 });
    } else {
      e.atkT = 2.8;
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2, r = i === 0 ? 0 : rnd(3, 9), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        this.telegraph(x, z, 2.6, 1.1, () => { this.hitArea(x, z, 2.6, 22); this.icy(x, z, 2.6); });
      }
    }
  }
  scorpionAI(e, dt) {   // 모래 전갈왕: burrows and bursts out under you, poison tail
    const g = this.g, p = g.player;
    if (e.burrow) {
      e.burrow.t -= dt;
      if (e.burrow.t > 0) { this.walkTo(e, p.x, p.z, 14, dt, 0.5); if (rand() < 0.5) g.parts.puff(e.x, e.y + 0.3, e.z, PAL.dust, { soft: true, vy: 1, life: 0.6, size: 1.4, end: 1.5, jitter: 1 }); }
      else if (!e.burrow.armed) {
        e.burrow.armed = true; const x = e.x, z = e.z;
        this.telegraph(x, z, 3.4, 1.0, () => { e.hidden = false; e.burrow = null; this.hitArea(x, z, 3.4, 30); this.burst(x, z, 3.4, PAL.dust, '#f0cc8a'); sfx.play('rock', { vol: 0.7, at: e }); });
      }
      return;
    }
    if (this.leash(e, dt)) return;
    const d = this.walkTo(e, p.x, p.z, e.speed, dt);
    if ((e.atkT -= dt) > 0) return;
    if (rand() < 0.5) { e.atkT = 4; e.hidden = true; e.burrow = { t: 1.6 }; sfx.play('rock', { vol: 0.5, at: e, rate: 0.6 }); }
    else {
      e.atkT = 3;
      const dx = (p.x - e.x) / (d || 1), dz = (p.z - e.z) / (d || 1);
      for (let s = 3; s <= 11; s += 4) {
        const x = e.x + dx * s, z = e.z + dz * s;
        this.telegraph(x, z, 2.4, 0.9, () => { this.hitArea(x, z, 2.4, 22); this.hazard(x, z, 2.2, 5, { color: '#b46ad8', slow: 0, dps: 7, pal: PAL.leaf }); });
      }
    }
  }
  flowerAI(e, dt) {   // 늪지 식인꽃: blinks between spots, pulls you in with vines, poison puddles
    const g = this.g, p = g.player;
    if (this.leash(e, dt)) return;
    const d = this.walkTo(e, p.x, p.z, 1.4, dt, 6);
    if ((e.atkT -= dt) > 0) return;
    if (rand() < 0.5) {
      e.atkT = 3.4;
      const a = rand() * 6.283, x = p.x + Math.cos(a) * rnd(5, 9), z = p.z + Math.sin(a) * rnd(5, 9);
      this.telegraph(x, z, 4, 1.0, () => { e.x = x; e.z = z; this.hitArea(x, z, 4, 22); this.burst(x, z, 4, PAL.wood, '#b4f57a'); this.hazard(x, z, 3.5, 5, { color: '#9be070', slow: 0.2, dps: 6, pal: PAL.leaf }); });
    } else {
      e.atkT = 3;
      const dx = (p.x - e.x) / (d || 1), dz = (p.z - e.z) / (d || 1);
      for (let s = 2; s < Math.min(d, 16); s += 2.5) this.telegraph(e.x + dx * s, e.z + dz * s, 1.1, 0.8, () => {});
      g.later(0.8, () => {   // vine pull
        if (e.dead || p.down || Math.hypot(p.x - e.x, p.z - e.z) > 17 || p.dashT > 0) return;
        const dd = Math.hypot(p.x - e.x, p.z - e.z) || 1, k = Math.max(0, dd - 4) / dd;
        for (let i = 0; i < 12; i++) g.parts.puff(p.x + (e.x - p.x) * i / 12, p.y + 1, p.z + (e.z - p.z) * i / 12, PAL.wood, { vy: 0.2, life: 0.5, size: 0.6, jitter: 0.2 });
        p.x -= (p.x - e.x) * k; p.z -= (p.z - e.z) * k; g.hurtPlayer(p, 10, 0.4);
        sfx.play('vine', { vol: 0.7 });
      });
    }
  }
  spiderAI(e, dt) {   // 바위 거미: leaps onto you, webs slow you, boulders fall
    const g = this.g, p = g.player;
    if (this.leash(e, dt)) return;
    this.walkTo(e, p.x, p.z, e.speed, dt);
    if ((e.atkT -= dt) > 0) return;
    const r = rand();
    if (r < 0.4) {
      e.atkT = 3; const x = p.x, z = p.z;
      this.telegraph(x, z, 3.5, 1.0, () => { e.x = x; e.z = z; this.hitArea(x, z, 3.5, 28); this.burst(x, z, 3.5, PAL.rock, '#f0cc8a'); sfx.play('rock', { vol: 0.8, at: e, rate: 0.7 }); });
    } else if (r < 0.7) {
      e.atkT = 2.4; const x = p.x, z = p.z;
      this.telegraph(x, z, 3, 0.7, () => this.hazard(x, z, 3, 5, { color: '#f2f2f2', slow: 0.35, dps: 0, pal: PAL.snow }));
    } else {
      e.atkT = 2.8;
      for (let i = 0; i < 5; i++) {
        const a = rand() * 6.283, rr = i ? rnd(2, 8) : 0, x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
        this.telegraph(x, z, 2.4, 1.1, () => { this.hitArea(x, z, 2.4, 20); this.burst(x, z, 2.4, PAL.dust, '#f0cc8a'); });
      }
    }
  }

  // ---------------- entering and leaving
  nearEntrance(p = this.g.player) {
    if (this.inside) return null;
    if (this.riftOpen && Math.hypot(p.x, p.z) < 10) return 'rift';
    const d = DUNGEONS.find(d => Math.hypot(p.x - d.x, p.z - d.z) < 22);
    return d ? d.elem : null;
  }
  entranceText(el) {
    const d = DEFS[el];
    if (this.cleared[el]) return `${d.name} · 정복 완료`;
    if (el === 'rift') return `🌀 ${d.name}\nE 키로 입장 — 최종 보스 균열의 왕`;
    if (this.keys[el]) return `${d.name}\nE 키로 입장`;
    return `🔒 ${d.name}\n${d.field.where}의 ${d.field.name}을(를) 쓰러뜨려 ${d.key} 열쇠를 얻으세요`;
  }
  tryUse() {   // E key
    const g = this.g, p = g.player;
    if (this.inside) {
      if (this.phase === 'cleared' && Math.hypot(p.x - X0, p.z - this.z0) < 4) this.leave();
      return;
    }
    const el = this.nearEntrance(); if (!el) return;
    if (this.cleared[el]) g.say('이미 정복한 던전입니다');
    else if (el !== 'rift' && !this.keys[el]) g.say(this.entranceText(el).replace('\n', ' — '));
    else this.enter(el);
  }
  enter(el) {
    const g = this.g, p = g.player;
    this.cur = el; this.st = {}; this.build(el); sfx.play('door', { vol: 0.7 });
    if (el === 'rift') { this.riftOpen = false; this.riftUsed = true; this.riftMark().visible = false; }   // the way down is spent
    this.inside = true; this.phase = 'corridor'; this.pack = 0; this.bosses = [];
    g.enemies.length = 0; this.absorbGems(); g.projectiles.forEach(pr => g.fx.remove(pr.mesh)); g.projectiles.length = 0;
    for (const q of g.players) {   // everyone goes in together
      q.x = X0 + (q.num - (g.players.length - 1) / 2) * 2; q.z = this.z0 + 58; q.vx = q.vz = 0; q.rootT = 0;
      for (const c of q.party.list) { c.x = X0 + rnd(-2, 2); c.z = this.z0 + 61; }
      if (q.party.mode === 'guard') { q.party.mode = 'follow'; if (q.party.flag) q.party.flag.visible = false; }
    }
    for (const pl of this.st.pillars || []) this.raisePillar(pl, true);   // the pillars are kept from an earlier run
    this.gate(true);
    g.toast = `${this.def.name} — 통로의 몬스터를 모두 쓰러뜨리세요`;
    this.spawnPack();
  }
  leave() {
    const g = this.g, p = g.player, el = this.cur, ent = DUNGEONS.find(d => d.elem === el);
    this.cleared[el] = true; g.clears = (g.clears || 0) + 1;
    this.inside = false; this.phase = null; this.cur = null; this.bosses = [];
    g.enemies.length = 0; this.absorbGems();
    const back = Math.hypot(ent.x, ent.z) || 1;
    for (const q of g.players) {
      q.x = ent.x - ent.x / back * 16 + (q.num - (g.players.length - 1) / 2) * 2; q.z = ent.z - ent.z / back * 16; q.rootT = 0;
      for (const c of q.party.list) { c.x = q.x + rnd(-2, 2); c.z = q.z + 2; }
    }
    sfx.play('door', { vol: 0.7 });
    const left = ELEMS.filter(e => !this.cleared[e]).length;
    g.toast = `${DEFS[el].name} 정복! 필드의 몬스터가 한층 강해집니다` + (left ? ` (남은 던전 ${left}곳)` : ' — 모든 던전을 정복했습니다!');
  }
  absorbGems() { const g = this.g; for (const gm of g.gems) (g.nearestPlayer(gm.x, gm.z) || g.players[0]).xp += gm.value; g.gems.length = 0; }   // nothing is lost when changing areas
  spawnPack() {
    const g = this.g, list = this.def.spawn === 'mix' ? MIX : BIOMES[this.def.spawn].spawn, n = 10 + Math.min(10, g.topLevel);
    for (let i = 0; i < n; i++) g.addEnemy(list[i % list.length], X0 + rnd(-3, 3), this.z0 + rnd(20, 40) - this.pack * 2, false, 220);
    if (this.pack === 2) g.addEnemy(this.def.elite, X0, this.z0 + 24, true, 220);
    this.pack++;
  }
  // Keep things inside the corridor / room (and outside the golem's pillars)
  clamp(o, r) {
    const lx = o.x - X0, lz = o.z - this.z0;
    const corridor = () => { o.x = X0 + Math.max(-CORR_W + r, Math.min(CORR_W - r, lx)); o.z = this.z0 + Math.max(this.phase === 'corridor' ? 17 : 10, Math.min(CORR_END - r, lz)); };
    const room = () => { const d = Math.hypot(lx, lz), m = ROOM_R - r; if (d > m) { o.x = X0 + lx / d * m; o.z = this.z0 + lz / d * m; } };
    if (this.phase === 'corridor') corridor();
    else if (this.phase === 'boss') room();
    else if (lz > ROOM_R - 3 && Math.abs(lx) < CORR_W) corridor(); else room();
    for (const pl of this.st?.pillars || []) {
      if (!pl.up) continue;
      const dx = o.x - pl.x, dz = o.z - pl.z, d = Math.hypot(dx, dz), m = 1.4 + r;
      if (d < m && d > 1e-3) { o.x = pl.x + dx / d * m; o.z = pl.z + dz / d * m; }
    }
  }
  gate(closed) { for (const r of this.built[this.cur].gate) r.visible = closed; }

  // ---------------- dungeon bosses
  startBoss() {
    const g = this.g, z0 = this.z0, lv = g.topLevel, d = this.def;
    this.phase = 'boss'; this.gate(true);
    g.toast = `${d.title}! ${d.hint}`;
    sfx.play('roar', { vol: 0.9, rate: 0.6 });
    if (d.boss === 'rift') this.bosses = [this.spawnRiftKing(X0, z0 - 3)];
    if (d.boss === 'twins') { this.spawnTwin(0, 1); this.spawnTwin(1, 1); this.st.mergeCd = 6; }
    if (d.boss === 'furnace') {
      const e = this.spawnBoss('Urndrake', X0, z0 - 3, d.title, 1500 + 150 * lv, 11, 2.6, (e, dt) => this.furnaceAI(e, dt));
      e.speed = 0; this.bosses = [e];
      Object.assign(this.st, { valveT: 0, hotT: 0, lavaT: 14, lava: 0 });
    }
    if (d.boss === 'tree') {
      const e = this.spawnBoss('Palmor', X0, z0, d.title, 1800 + 150 * lv, 12, 2.8, (e, dt) => this.treeAI(e, dt));
      e.speed = 0; this.bosses = [e];
      this.st.roots = [0, 1, 2, 3].map(i => ({ a: Math.PI / 4 + i * Math.PI / 2, e: null, regrow: 0 }));
      this.st.weakT = 0; this.st.snareT = 5;
      for (const rt of this.st.roots) this.growRoot(rt);
    }
    if (d.boss === 'golem') {
      const e = this.spawnBoss('Basticlaw', X0, z0 - 7, d.title, 1600 + 150 * lv, 10, 2.4, (e, dt) => this.golemAI(e, dt));
      e.speed = 2; this.bosses = [e];
      this.st.pillars.forEach(pl => this.raisePillar(pl, true));
      this.st.regrowT = 0;
    }
  }
  bossDown(e) {   // all bosses of the room defeated?
    const g = this.g;
    if (this.bosses.some(b => b !== e && !b.dead)) return;
    this.phase = 'cleared'; this.st.reviveT = 0;
    for (const rt of this.st.roots || []) if (rt.e && !rt.e.dead) rt.e.dead = true;
    g.toast = `${this.def.title} 격파! 방 가운데에서 E 키로 나갈 수 있습니다`;
    dex.beat(this.def.title);
    if (!meta.cleared(this.cur)) { meta.clear(this.cur); g.toast += ' · 새 시작 몬스터 해금!'; }
    for (const q of g.players) if (!q.gone) { q.hp = q.maxHp; q.rootT = 0; q.down = false; }   // the win revives everyone
    for (let i = 0; i < 16; i++) g.dropGem(X0 + rnd(-5, 5), this.z0 + rnd(-5, 5), Math.ceil(g.player.next / 6));
    this.built[this.cur].portal.visible = true; sfx.play('levelup', { vol: 0.8 }); sfx.play('bigboom', { vol: 0.8 });
    g.shake = 0.8;
  }

  // ice: twins
  spawnTwin(i, frac) {
    const g = this.g, x = X0 + (i ? 10 : -10);
    const e = this.spawnBoss('Bluelotl', x, this.z0 - 2, i ? '빙하룡 눈보라' : '빙하룡 서리', 900 + 110 * g.topLevel, 9, 2, (e, dt) => this.twinAI(e, dt));
    e.hp = e.maxHp * frac; e.speed = 2.3; e.dmg = 16; e.twin = i; e.flip = i ? -1 : 1; e.atkT = 2 + i * 1.8;
    this.bosses[i] = e; sfx.play('roar', { vol: 0.8, rate: 0.6 + i * 0.15 });
    g.parts.burst(x, 2, this.z0, 60, PAL.ice, { speed: 8, up: 8, life: 1, size: 0.8 });
    g.shock(x, this.z0, 6, '#bff0ff', 0.6);
  }
  twinAI(e, dt) {
    const g = this.g, { tg, d } = this.nearestTarget(e);
    this.walkTo(e, tg.x, tg.z, e.speed, dt);
    if (tg !== g.player && d < e.radius + 1) g.party.hurt(tg, e.dmg);
    if ((e.atkT -= dt) > 0) return;
    e.atkT = 3.6;
    const dx = (tg.x - e.x) / (d || 1), dz = (tg.z - e.z) / (d || 1);
    for (let s = 4; s <= 13; s += 4.5) {   // frost breath: three circles in a line
      const x = e.x + dx * s, z = e.z + dz * s;
      this.telegraph(x, z, 2.6, 1.0, () => { this.hitArea(x, z, 2.6, 24); this.icy(x, z, 2.6); this.frost(x, z, 2.4, 4); });
    }
  }
  twinsUpdate(dt) {
    const g = this.g, [a, b] = this.bosses, st = this.st;
    if (st.reviveT > 0 && (st.reviveT -= dt) <= 0) { this.spawnTwin(st.dead, 0.5); g.toast = '쓰러진 빙하룡이 되살아났습니다!'; }
    if (a && b && !a.dead && !b.dead && (st.mergeCd -= dt) <= 0 && Math.hypot(a.x - b.x, a.z - b.z) < 9) {
      st.mergeCd = 7;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      g.toast = '합체 브레스! 둘이 붙어 있으면 위험합니다';
      this.telegraph(mx, mz, 10, 1.6, () => { this.hitArea(mx, mz, 10, 50); this.icy(mx, mz, 10); g.shake = 0.7; });
    }
  }

  // fire: overheated until both valves are held
  valves() { return [{ x: X0 - 11, z: this.z0 }, { x: X0 + 11, z: this.z0 }]; }
  // With no companion left, a valve you touched stays open 4 s so you can run to the other one alone
  held(v, i) {
    const g = this.g, all = [...g.aliveP(), ...g.allies()], on = all.some(o => Math.hypot(o.x - v.x, o.z - v.z) < 2.4);
    const latch = (this.st.latch ??= [0, 0]);
    if (on && all.length < 2) latch[i] = this.g.time + 4;
    return on || latch[i] > this.g.time;
  }
  furnaceAI(e, dt) {
    const g = this.g, p = g.player, st = this.st;
    e.dmgMul = st.hotT > 0 ? 1.2 : 0.1;
    if (st.hotT <= 0) g.parts.puff(e.x, e.y + 3, e.z, PAL.fire, { vy: 3, life: 0.6, size: 1.2, jitter: 2 });
    else g.parts.puff(e.x, e.y + 3, e.z, PAL.snow, { soft: true, vy: 2, life: 1, size: 1.6, end: 2, jitter: 2 });
    if ((e.atkT -= dt) > 0) return;
    if (rand() < 0.55) {
      e.atkT = 3;
      for (let i = 0; i < 5; i++) {
        const a = rand() * 6.283, r = i ? rnd(2, 8) : 0, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        this.telegraph(x, z, 2.6, 1.1, () => { this.hitArea(x, z, 2.6, 22); this.burst(x, z, 2.6, PAL.fire, '#ffb347'); this.hazard(x, z, 2.2, 4, { color: '#ff7a2e', slow: 0, dps: 6, pal: PAL.fire }); });
      }
    } else {
      e.atkT = 3.4;
      this.telegraph(e.x, e.z, 7, 1.2, () => { this.hitArea(e.x, e.z, 7, 30); this.burst(e.x, e.z, 7, PAL.fire, '#ffb347'); });
    }
  }
  furnaceUpdate(dt) {
    const g = this.g, st = this.st, b = this.built.fire, p = g.player;
    const vs = this.valves(), hs = vs.map((v, i) => this.held(v, i)), both = hs.every(Boolean);
    b.valves.forEach((m, i) => m.material.color.set(hs[i] ? '#7fdcff' : '#ff7a2e'));
    if (st.hotT > 0) st.hotT -= dt;
    else if (both) {
      st.valveT += dt;
      if (rand() < 0.5) for (const v of this.valves()) g.parts.puff(v.x, 1.5, v.z, PAL.snow, { soft: true, vy: 3, life: 0.8, size: 1.2, end: 1.5, jitter: 0.5 });
      if (st.valveT >= 3) { st.hotT = 8; st.valveT = 0; g.toast = '냉각 성공! 8초 동안 수호룡이 약해집니다'; sfx.play('icefield', { vol: 0.8 }); g.shake = 0.4; }
    } else st.valveT = Math.max(0, st.valveT - dt * 2);
    // rising lava: the rim of the room burns now and then
    if ((st.lavaT -= dt) <= 0) {
      if (st.lava > 0) { st.lava = 0; st.lavaT = 16; b.lava.visible = false; }
      else { st.lava = 6; st.lavaT = 6; b.lava.visible = true; g.toast = '용암이 차오릅니다 — 가운데로!'; }
    }
    if (st.lava > 0) {
      st.lava -= dt;
      for (const q of g.aliveP()) if (Math.hypot(q.x - X0, q.z - this.z0) > 12.5 && !(q.dashT > 0)) g.hurtPlayer(q, 10 * dt, 0.2);
      if (rand() < 0.6) { const a = rand() * 6.283; g.parts.puff(X0 + Math.cos(a) * 14, 0.3, this.z0 + Math.sin(a) * 14, PAL.fire, { vy: 2.5, life: 0.6, size: 0.9 }); }
    }
  }

  // wood: sap roots heal the spirit; it snares you with vines
  growRoot(rt) {
    const g = this.g, x = X0 + Math.cos(rt.a) * 12, z = this.z0 + Math.sin(rt.a) * 12;
    g.addEnemy('Tropicool', x, z, false, 200);
    const e = g.enemies[g.enemies.length - 1];
    Object.assign(e, { hp: 140 + 20 * g.topLevel, maxHp: 140 + 20 * g.topLevel, size: 4.5, radius: 1, speed: 0, dmg: 0, boss: true, rootOf: rt, ai: () => {} });
    rt.e = e;
    g.parts.burst(x, 1, z, 20, PAL.wood, { speed: 4, up: 6, life: 0.7 });
  }
  treeAI(e, dt) {
    const g = this.g, p = g.player, st = this.st;
    const alive = st.roots.filter(r => r.e && !r.e.dead).length;
    e.dmgMul = st.weakT > 0 ? 2 : 1;
    if (st.weakT <= 0) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.005 * alive * dt);
    for (const r of st.roots) if (r.e && !r.e.dead && rand() < 0.3) {   // sap flowing to the spirit
      const k = rand(); g.parts.puff(r.e.x + (e.x - r.e.x) * k, 0.5, r.e.z + (e.z - r.e.z) * k, PAL.heal, { vy: 0.3, life: 0.5, size: 0.4, jitter: 0.2 });
    }
    if ((st.snareT -= dt) <= 0) {
      st.snareT = 8; const x = p.x, z = p.z;
      this.telegraph(x, z, 1.8, 0.8, () => {
        if (Math.hypot(p.x - x, p.z - z) > 2.4 || p.dashT > 0 || p.down) return;
        p.rootT = 3.5; if (p === g.me) g.toast = '덩굴에 묶였습니다! 동료나 친구가 곁에 오면 빨리 풀립니다'; sfx.play('vine', { vol: 0.8 });
      });
    }
    if ((e.atkT -= dt) > 0) return;
    e.atkT = 3.2;
    if (rand() < 0.5) for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + rand() * 0.5, x = p.x + Math.cos(a) * 4, z = p.z + Math.sin(a) * 4;
      this.telegraph(x, z, 2.2, 1.0, () => { this.hitArea(x, z, 2.2, 20); this.burst(x, z, 2.2, PAL.wood, '#b4f57a'); });
    } else { const x = p.x, z = p.z; this.telegraph(x, z, 3.5, 1.0, () => this.hazard(x, z, 3.5, 6, { color: '#9be070', slow: 0.2, dps: 7, pal: PAL.leaf })); }
  }
  treeUpdate(dt) {
    const g = this.g, st = this.st, boss = this.bosses[0];
    if (st.weakT > 0 && (st.weakT -= dt) <= 0) g.toast = '정령이 다시 뿌리를 내립니다';
    for (const rt of st.roots) {
      if (rt.e && rt.e.dead) { rt.e = null; rt.regrow = 5; }
      if (!rt.e && (rt.regrow -= dt) <= 0 && st.weakT <= 0) this.growRoot(rt);
    }
    if (st.weakT <= 0 && st.roots.every(r => !r.e)) {
      st.weakT = 10; for (const r of st.roots) r.regrow = 10;
      g.toast = '뿌리가 모두 끊겼습니다! 10초 동안 정령이 약해집니다'; sfx.play('bigboom', { vol: 0.6 }); g.shake = 0.5;
      g.parts.burst(boss.x, 3, boss.z, 60, PAL.leaf, { speed: 8, up: 8, life: 1, soft: true, size: 1 });
    }
  }

  // rock: armoured golem, stunned by charging into a pillar
  raisePillar(pl, up) {
    pl.up = up; pl.mesh.visible = up;
    if (!up) { this.burst(pl.x, pl.z, 3, PAL.rock, '#f0cc8a'); this.g.parts.burst(pl.x, 2, pl.z, 20, PAL.dust, { soft: true, speed: 4, up: 3, life: 1, size: 1.6 }); sfx.play('rock', { vol: 0.9, rate: 0.6 }); }
  }
  golemAI(e, dt) {
    const g = this.g, p = g.player, st = this.st;
    e.dmgMul = e.stunT > 0 ? 1.4 : 0.1;
    if (e.stunT > 0) {
      e.stunT -= dt;
      const a = g.time * 6; g.parts.puff(e.x + Math.cos(a) * 1.5, e.y + 9, e.z + Math.sin(a) * 1.5, PAL.gold, { vy: 0, life: 0.3, size: 0.6, jitter: 0 });
      return;
    }
    if (e.windup) { if ((e.windup.t -= dt) <= 0) { e.charge = { dx: e.windup.dx, dz: e.windup.dz, t: 1.2, hit: false }; e.windup = null; } return; }
    if (e.charge) {
      e.charge.t -= dt; e.x += e.charge.dx * 22 * dt; e.z += e.charge.dz * 22 * dt;
      g.parts.puff(e.x, e.y + 0.5, e.z, PAL.dust, { soft: true, vy: 1, life: 0.5, size: 1.6, end: 1.5, jitter: 1.2 });
      if (!e.charge.hit && g.aliveP().some(q => Math.hypot(q.x - e.x, q.z - e.z) < 3)) { e.charge.hit = true; this.hitArea(e.x, e.z, 3, 35); }
      const pl = st.pillars.find(pl => pl.up && Math.hypot(pl.x - e.x, pl.z - e.z) < 3.2);
      if (pl) {
        e.charge = null; e.stunT = 5; this.raisePillar(pl, false);
        g.toast = '골렘이 기둥에 부딪혀 기절했습니다! 지금 공격하세요'; g.shake = 0.7;
      } else if (e.charge.t <= 0 || Math.hypot(e.x - X0, e.z - this.z0) > ROOM_R - 2.5) e.charge = null;
      return;
    }
    const { tg, d } = this.nearestTarget(e);
    this.walkTo(e, tg.x, tg.z, e.speed, dt, 5);
    if ((e.atkT -= dt) > 0) return;
    if (d < 6 && rand() < 0.5) {
      e.atkT = 2.6;
      this.telegraph(e.x, e.z, 6, 0.9, () => { this.hitArea(e.x, e.z, 6, 25); this.burst(e.x, e.z, 6, PAL.rock, '#f0cc8a'); });
    } else {
      e.atkT = 5;
      const dx = (p.x - e.x) / (Math.hypot(p.x - e.x, p.z - e.z) || 1), dz = (p.z - e.z) / (Math.hypot(p.x - e.x, p.z - e.z) || 1);
      for (let s = 3; s <= 24; s += 3) this.telegraph(e.x + dx * s, e.z + dz * s, 1.8, 1.0, () => {});
      e.windup = { dx, dz, t: 1.0 }; sfx.play('roar', { vol: 0.9, rate: 0.5 });
    }
  }
  golemUpdate(dt) {
    const st = this.st;
    if (st.pillars.every(pl => !pl.up)) {
      if ((st.regrowT += dt) > 10) { st.regrowT = 0; st.pillars.forEach(pl => this.raisePillar(pl, true)); this.g.toast = '돌기둥이 다시 솟아올랐습니다'; }
    }
  }

  onKill(e) {
    const g = this.g;
    if (e.riftKing) return this.victory(e);
    if (e.fieldOf) {
      dex.beat(e.name); g.fieldKills = (g.fieldKills || 0) + 1;
      const el = e.fieldOf, d = DEFS[el];
      this.field[el] = null; this.fieldT[el] = 300;
      if (!this.keys[el]) { this.keys[el] = true; g.toast = `${d.key} 열쇠 획득! ${d.name}로 가서 E 키로 들어가세요`; }
      else g.toast = `${d.field.name} 처치!`;
      g.ult = Math.min(1, g.ult + 0.3);
      return;
    }
    if (this.phase !== 'boss' || !this.bosses.includes(e)) return;
    if (e.twin !== undefined) {
      const other = this.bosses[1 - e.twin];
      if (other && !other.dead) { this.st.reviveT = 10; this.st.dead = e.twin; g.toast = `${e.name} 쓰러짐! 10초 안에 나머지도 쓰러뜨리세요`; return; }
    }
    this.bossDown(e);
  }

  update(dt) {
    const g = this.g, p = g.me;
    for (const q of g.players) q.playerSlow = 1;
    // field boss lifecycle
    for (const el of ELEMS) {
      if (this.field[el]?.dead) this.field[el] = null;
      if (!this.field[el] && !this.inside && (this.fieldT[el] -= dt) <= 0) this.spawnField(el);
    }
    // warnings and lingering ground
    for (const t of this.tele) {
      t.t += dt; const k = Math.min(1, t.t / t.delay);
      t.fill.scale.setScalar(t.r * k); t.ring.material.opacity = 0.5 + 0.4 * Math.sin(t.t * 20);
      if (k >= 1) { g.fx.remove(t.ring); g.fx.remove(t.fill); t.fn(); }
    }
    this.tele = this.tele.filter(t => t.t < t.delay);
    for (const h of this.hazards) {
      h.t -= dt; h.mesh.material.opacity = 0.5 * Math.min(1, h.t);
      const tick = h.dps && (h.tick -= dt) <= 0; if (tick) h.tick = 0.5;
      for (const q of g.aliveP()) if (Math.hypot(q.x - h.x, q.z - h.z) < h.r) {
        if (h.slow) q.playerSlow = Math.min(q.playerSlow, 1 - h.slow);
        if (tick && !(q.dashT > 0)) q.hp -= h.dps * 0.5 * q.takenMul;
      }
      if (rand() < 0.05) g.parts.puff(h.x, heightAt(h.x, h.z) + 0.2, h.z, h.pal, { vy: 0.6, life: 0.8, size: 0.3, jitter: h.r * 0.7 });
      if (h.t <= 0) g.fx.remove(h.mesh);
    }
    this.hazards = this.hazards.filter(h => h.t > 0);
    this.riftTick();
    if (!this.inside) return;

    // ambience inside
    const amb = this.def.ambient;
    if (rand() < 0.6) {
      const x = p.x + rnd(-14, 14), z = p.z + rnd(-14, 14);
      if (amb === 'snow') g.parts.puff(x, 9, z, PAL.snow, { vy: -1.2, life: 3, size: 0.25, jitter: 0, drag: 0 });
      if (amb === 'ember') g.parts.puff(x, 0.3, z, PAL.fire, { vy: 1.5, life: 2.5, size: 0.2, jitter: 0, drag: 0 });
      if (amb === 'spore') g.parts.puff(x, rnd(0.5, 4), z, PAL.wood, { vy: 0.2, life: 3, size: 0.22, jitter: 0, drag: 0 });
      if (amb === 'rift') g.parts.puff(x, rnd(0.5, 5), z, PAL[FORMS[(rand() * 4) | 0]], { vy: 0.6, life: 2.5, size: 0.25, jitter: 0, drag: 0 });
      if (amb === 'dust') g.parts.puff(x, rnd(0.5, 4), z, PAL.dust, { soft: true, vx: 0.5, vy: 0.1, life: 3, size: 0.5, jitter: 0, drag: 0 });
    }
    if (this.phase === 'corridor' && !g.enemies.some(e => !e.dead)) {
      if (this.pack < 3) { this.spawnPack(); g.toast = `몬스터 무리 ${this.pack}/3`; }
      else {
        this.phase = 'open'; this.gate(false); sfx.play('gate', { vol: 0.8 });
        g.toast = '문이 열렸습니다 — 보스의 방으로!';
        g.parts.burst(X0, 2, this.z0 + 16, 60, PAL[this.cur] || PAL.gold, { speed: 8, up: 6, life: 1 });
      }
    }
    if (this.phase === 'open' && g.aliveP().some(q => q.z - this.z0 < ROOM_R - 3)) this.startBoss();
    if (this.phase === 'boss') {
      const b = this.def.boss;
      if (b === 'twins') this.twinsUpdate(dt);
      if (b === 'furnace') this.furnaceUpdate(dt);
      if (b === 'tree') this.treeUpdate(dt);
      if (b === 'golem') this.golemUpdate(dt);
    }
  }

  // HUD: boss bars with the state of the room's mechanic
  bars() {
    const out = [], p = this.g.me, st = this.st || {};
    for (const e of Object.values(this.field)) if (e && !e.dead && Math.hypot(p.x - e.x, p.z - e.z) < 55) out.push({ name: e.name, frac: e.hp / e.maxHp, note: e.riftKing ? this.kingNote(e) : '' });
    if (this.phase !== 'boss') return out;
    for (const e of this.bosses) {
      if (!e || e.dead) continue;
      let note = '';
      if (this.def.boss === 'furnace') note = st.hotT > 0 ? `냉각됨 ${st.hotT.toFixed(0)}초` : `과열 (피해 -90%) · 밸브 ${this.valves().filter((v, i) => this.held(v, i)).length}/2` + (st.valveT > 0 ? ` ${st.valveT.toFixed(1)}/3초` : '');
      if (this.def.boss === 'tree') note = st.weakT > 0 ? `약해짐 ${st.weakT.toFixed(0)}초` : `수액 뿌리 ${st.roots.filter(r => r.e && !r.e.dead).length}/4`;
      if (e.riftKing) note = this.kingNote(e);
      if (this.def.boss === 'golem') note = e.stunT > 0 ? `기절 ${e.stunT.toFixed(1)}초` : '단단함 (피해 -90%)';
      out.push({ name: e.name, frac: e.hp / e.maxHp, note });
    }
    if (st.reviveT > 0) out.push({ warn: `부활까지 ${st.reviveT.toFixed(1)}초!` });
    return out;
  }


  // ---------------- the rift and its king (final boss)
  // The rift opens at the centre once all four dungeons are conquered, or at 35:00 anyway. At 40:00 the king
  // comes out into the field by himself. He changes element every 12 s (the element that beats it hits x1.5),
  // and at 70% and 35% health hides behind four rift crystals, one per element, that must all be broken.
  riftTick() {
    const g = this.g;
    if (!this.riftOpen && !this.kingOut && !this.riftUsed && (ELEMS.every(el => this.cleared[el]) || g.time >= RIFT_OPEN)) this.openRift();
    if (!this.riftWarned && !this.riftOpen && g.time >= RIFT_WARN) { this.riftWarned = true; g.toast = '땅이 울립니다… 5분 뒤 중앙 평지에 균열이 열립니다'; sfx.play('roar', { vol: 0.5, rate: 0.5 }); }
    if (this.riftOpen && rand() < 0.5) {
      const a = rand() * 6.283, r = rand() * 5;
      g.parts.puff(Math.cos(a) * r, heightAt(0, 0) + 0.3, Math.sin(a) * r, PAL[ELEMS[(rand() * 4) | 0]], { vy: 4, life: 1.2, size: 0.6, jitter: 0.3 });
    }
    if (!this.kingOut && !this.cleared.rift && g.time >= RIFT_KING && !this.inside) this.kingEmerges();
  }
  openRift() {
    const g = this.g;
    this.riftOpen = true; this.riftMark().visible = true;
    g.toast = '중앙 평지에 균열이 열렸습니다! 균열의 왕이 기다립니다 (가운데에서 E)';
    sfx.play('roar', { vol: 0.8, rate: 0.6 }); g.shake = 0.5;
  }
  riftMark() {   // glowing ring and a pillar of light at the centre of the map (looks only)
    if (this.mark) return this.mark;
    const g = this.g, m = this.mark = new THREE.Group(), y = heightAt(0, 0);
    const ring = new THREE.Mesh(g.geo.ring, new THREE.MeshBasicMaterial({ color: C(1.3, 0.7, 2.0), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.scale.setScalar(6); ring.position.y = y + 0.2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 70, 24, 1, true), new THREE.MeshBasicMaterial({ color: C(0.7, 0.35, 1.1), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = y + 35;
    m.add(ring, beam); m.visible = false; g.scene.add(m);
    return m;
  }
  kingEmerges() {   // 40:00: no more waiting
    const g = this.g, alive = g.aliveP(); if (!alive.length) return;
    const p = alive[(rand() * alive.length) | 0], a = rand() * 6.283;
    this.kingOut = true; this.riftOpen = false; this.riftMark().visible = false;
    const e = this.spawnRiftKing(p.x + Math.cos(a) * 22, p.z + Math.sin(a) * 22);
    e.dmg *= 1.3; this.field.rift = e;
    g.toast = '40분 — 균열의 왕이 직접 나타났습니다! 쓰러뜨리면 승리!';
    sfx.play('roar', { vol: 1, rate: 0.45 }); g.shake = 0.8;
  }
  spawnRiftKing(x, z) {
    const g = this.g, e = this.spawnBoss('Auroradream', x, z, '균열의 왕', kingHp(g.topLevel), 13, 3, (e, dt) => this.riftAI(e, dt));
    Object.assign(e, { speed: 2.2, dmg: 25, atkT: 3, riftKing: true, form: -1, formT: 0, addT: 8, crystals: [], shields: [0.7, 0.35] });
    this.setForm(e, 0);
    return e;
  }
  setForm(e, i) {
    const g = this.g, el = FORMS[i];
    e.form = i; e.elem = el; e.formT = 12;
    g.toast = `균열의 왕이 ${ELEM[el].name}의 형상으로! ${ELEM[WEAK[el]].name} 속성이 잘 통합니다`;
    g.parts.burst(e.x, e.y + 5, e.z, 60, PAL[el], { speed: 9, up: 6, life: 0.9, size: 0.8 });
    g.shock(e.x, e.z, 9, ELEM[el].color, 0.6);
  }
  riftAI(e, dt) {
    const g = this.g, p = g.player;
    if ((e.formT -= dt) <= 0) this.setForm(e, (e.form + 1) % 4);
    if (rand() < 0.6) g.parts.puff(e.x + rnd(-2.5, 2.5), e.y + rnd(1, 9), e.z + rnd(-2.5, 2.5), PAL[e.elem], { vy: 1.2, life: 0.7, size: 0.7, jitter: 0.4 });
    if (e.shields.length && e.hp / e.maxHp <= e.shields[0]) { e.shields.shift(); this.raiseShield(e); }
    if (e.crystals.length) {
      for (const c of e.crystals) if (c.dead) g.fx.remove(c.mesh);
      e.crystals = e.crystals.filter(c => !c.dead);
      if (!e.crystals.length) { g.toast = '보호막이 깨졌습니다! 지금 공격하세요'; sfx.play('bigboom', { vol: 0.8 }); g.shake = 0.6; g.parts.burst(e.x, e.y + 5, e.z, 80, PAL.gold, { speed: 10, up: 8, life: 1, size: 0.8 }); }
    }
    e.dmgMul = e.crystals.length ? 0 : 1;
    if (e.crystals.length && rand() < 0.4) for (const c of e.crystals) {   // the crystals feed the shield
      const k = rand(); g.parts.puff(c.x + (e.x - c.x) * k, 2 + 4 * k, c.z + (e.z - c.z) * k, PAL[c.elem], { vy: 0.3, life: 0.5, size: 0.5, jitter: 0.2 });
    }
    if ((e.addT -= dt) <= 0) {   // minions of its current element
      e.addT = 9; const list = BIOMES[SPAWN_OF[e.elem]].spawn;
      for (let i = 0; i < 2 + g.aliveP().length; i++) g.addEnemy(list[(rand() * list.length) | 0], e.x + rnd(-7, 7), e.z + rnd(-7, 7), false, 260);
    }
    this.walkTo(e, p.x, p.z, e.speed, dt, 6);
    if ((e.atkT -= dt) > 0) return;
    e.atkT = (e.crystals.length ? 2.4 : 3.1) * (e.hp / e.maxHp < 0.2 ? 0.7 : 1);   // faster while shielded and when nearly beaten
    this['rift_' + e.elem](e, p);
  }
  rift_fire() {   // meteors around every player
    for (const q of this.g.aliveP()) for (let i = 0; i < 3; i++) {
      const a = rand() * 6.283, r = i ? rnd(2, 7) : 0, x = q.x + Math.cos(a) * r, z = q.z + Math.sin(a) * r;
      this.telegraph(x, z, 2.8, 1.1, () => { this.hitArea(x, z, 2.8, 26); this.burst(x, z, 2.8, PAL.fire, '#ffb347'); this.hazard(x, z, 2.4, 4, { color: '#ff7a2e', slow: 0, dps: 7, pal: PAL.fire }); });
    }
  }
  rift_ice(e, p) {   // frost breath: a line of circles towards the target, frozen ground behind
    const d = Math.hypot(p.x - e.x, p.z - e.z) || 1, dx = (p.x - e.x) / d, dz = (p.z - e.z) / d;
    for (let s = 3; s <= 21; s += 3.6) {
      const x = e.x + dx * s, z = e.z + dz * s;
      this.telegraph(x, z, 2.6, 1.0, () => { this.hitArea(x, z, 2.6, 28); this.icy(x, z, 2.6); this.frost(x, z, 2.4, 5); });
    }
  }
  rift_wood() {   // vines under every player (a friend or companion nearby frees you faster), poison left behind
    const g = this.g;
    for (const q of g.aliveP()) {
      const x = q.x, z = q.z;
      this.telegraph(x, z, 2, 0.9, () => {
        if (!q.down && !(q.dashT > 0) && Math.hypot(q.x - x, q.z - z) < 2.6) { q.rootT = 2.5; if (q === g.me) g.toast = '덩굴에 묶였습니다! 친구나 동료가 곁에 오면 빨리 풀립니다'; }
        this.hazard(x, z, 3.2, 5, { color: '#9be070', slow: 0.2, dps: 8, pal: PAL.leaf }); sfx.play('vine', { vol: 0.6, at: { x, z } });
      });
    }
  }
  rift_rock(e) {   // slam around itself, boulders on everyone
    this.telegraph(e.x, e.z, 8, 1.2, () => { this.hitArea(e.x, e.z, 8, 32); this.burst(e.x, e.z, 8, PAL.rock, '#f0cc8a'); });
    for (const q of this.g.aliveP()) {
      const x = q.x + rnd(-3, 3), z = q.z + rnd(-3, 3);
      this.telegraph(x, z, 2.4, 1.4, () => { this.hitArea(x, z, 2.4, 22); this.burst(x, z, 2.4, PAL.dust, '#f0cc8a'); });
    }
  }
  raiseShield(e) {
    const g = this.g, cx = this.inside ? X0 : e.x, cz = this.inside ? this.z0 : e.z, hp = (260 + 25 * g.topLevel) * g.bossScale;
    g.toast = '균열의 왕이 보호막을 둘렀습니다! 네 속성의 균열 수정을 모두 부수세요';
    sfx.play('roar', { vol: 0.9, rate: 0.5 }); g.shake = 0.6;
    e.crystals = FORMS.map((el, i) => {
      const a = Math.PI / 4 + i * Math.PI / 2, x = cx + Math.cos(a) * 11, z = cz + Math.sin(a) * 11;
      g.addEnemy(BIOMES[SPAWN_OF[el]].elite, x, z, false, 200);
      const c = g.enemies[g.enemies.length - 1];
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.1).scale(1, 1.9, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(ELEM[el].color).multiplyScalar(1.6) }));
      mesh.add(halo(new THREE.Color(ELEM[el].color), 3)); g.fx.add(mesh);
      Object.assign(c, { elem: el, hp, maxHp: hp, radius: 1.3, speed: 0, dmg: 0, boss: true, noSprite: true, mesh, name: `${ELEM[el].name} 수정`,
        ai: (c) => { c.mesh.position.set(c.x, c.y + 2.4 + Math.sin(g.time * 3 + i) * 0.3, c.z); c.mesh.rotation.y += 0.04; c.mesh.scale.setScalar(1 + c.flash * 0.25); } });
      c.ai(c);
      g.parts.burst(x, 2, z, 30, PAL[el], { speed: 6, up: 7, life: 0.8 });
      return c;
    });
  }
  kingNote(e) { return e.crystals.length ? `보호막 · 균열 수정 ${e.crystals.length}/4` : `${ELEM[e.elem].name}의 형상 · 약점 ${ELEM[WEAK[e.elem]].name}`; }
  victory(e) {
    const g = this.g;
    this.cleared.rift = true; dex.beat('균열의 왕');
    for (const o of g.enemies) if (o !== e) o.dead = true;
    for (const c of e.crystals) g.fx.remove(c.mesh);
    g.toast = '균열의 왕을 쓰러뜨렸습니다! 균열이 닫힙니다…';
    sfx.play('bigboom', { vol: 1 }); sfx.play('levelup', { vol: 0.9 }); g.shake = 1;
    for (const el of FORMS) g.parts.burst(e.x, e.y + 5, e.z, 80, PAL[el], { speed: 14, up: 10, life: 1.4, size: 1 });
    g.later(3, () => { g.won = true; g.over = true; });
  }

  // ---------------- geometry, built on first entry of each dungeon
  build(el) {
    if (this.built[el]) { this.st = this.st || {}; this.st.pillars = this.built[el].pillars; return; }
    const g = this.g, d = DEFS[el], z0 = d.z0, root = new THREE.Group(), floorMat = new THREE.MeshLambertMaterial({ color: d.floor, flatShading: true });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R + 1, 48).rotateX(-Math.PI / 2), floorMat); floor.position.set(X0, 0, z0);
    const corr = new THREE.Mesh(new THREE.PlaneGeometry(CORR_W * 2 + 2, CORR_END - 8).rotateX(-Math.PI / 2), floorMat); corr.position.set(X0, 0.01, z0 + (CORR_END + 8) / 2);
    root.add(floor, corr);
    const kinds = ['rock_tallA', 'rock_tallC', 'rock_tallF', 'stone_tallB'];
    const pillar = (x, z, h, tint = d.wall) => { const r = makeProp(kinds[(Math.random() * kinds.length) | 0], h, tint); r.position.set(x, 0, z); r.rotation.y = Math.random() * 6; root.add(r); return r; };
    for (let a = 0; a < Math.PI * 2; a += 0.2) {   // room wall, open towards the corridor (+z)
      if (Math.abs(a - Math.PI / 2) < 0.32) continue;
      pillar(X0 + Math.cos(a) * (ROOM_R + 1.8), z0 + Math.sin(a) * (ROOM_R + 1.8), vr(3.5, 5.5));
    }
    for (let z = ROOM_R; z <= CORR_END + 2; z += 2.6) for (const s of [-1, 1]) pillar(X0 + s * (CORR_W + 1.6), z0 + z, vr(3.2, 4.8));
    for (let x = -CORR_W; x <= CORR_W; x += 2.6) pillar(X0 + x, z0 + CORR_END + 2.5, vr(4, 6));
    const gate = [];
    for (let x = -CORR_W + 0.5; x <= CORR_W; x += 1.6) gate.push(pillar(X0 + x, z0 + 16.5, vr(4, 5.5), d.gate));
    const portal = new THREE.Mesh(g.geo.ring, new THREE.MeshBasicMaterial({ color: d.portal, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    portal.scale.setScalar(3); portal.position.set(X0, 0.15, z0); portal.visible = false; root.add(portal);
    const b = { root, gate, portal, pillars: [] };
    if (el === 'fire') {   // two cooling valves and the lava rim
      b.valves = [-11, 11].map(x => {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 10), new THREE.MeshBasicMaterial({ color: '#ff7a2e' }));
        pipe.position.set(X0 + x, 1.5, z0); root.add(pipe);
        const pad = new THREE.Mesh(g.geo.ring, new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.8, depthWrite: false }));
        pad.scale.setScalar(2.4); pad.position.set(X0 + x, 0.12, z0); root.add(pad);
        return pipe;
      });
      b.lava = new THREE.Mesh(new THREE.RingGeometry(12.5, ROOM_R + 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.5, 0.1), transparent: true, opacity: 0.75, depthWrite: false }));
      b.lava.position.set(X0, 0.1, z0); b.lava.visible = false; root.add(b.lava);
    }
    if (el === 'rock') {   // four breakable stone pillars for the golem to crash into
      b.pillars = [[-8, 3], [8, 3], [-6, -10], [6, -10]].map(([x, z]) => {
        const m = makeProp('stone_tallB', 6, '#c8b090'); m.position.set(X0 + x, 0, z0 + z); root.add(m);
        return { x: X0 + x, z: z0 + z, up: true, mesh: m };
      });
    }
    g.scene.add(root);
    this.built[el] = b;
    this.st = this.st || {}; this.st.pillars = b.pillars;
  }
}
