// Captured companions: defeated monsters sometimes join you (up to 3). They follow you and shoot nearby enemies
// with their element; F sends them to guard the spot under the mouse, R calls them back. Knocked out, they
// recover after 15 s.
import * as THREE from 'three';
import { MONSTERS, ELEM } from './data.js';
import { heightAt, collide } from './world.js';
import { PAL } from './fx.js';
import { sfx } from './audio.js';
import { rand } from './rng.js';
import { dex } from './dex.js';
import { meta } from './meta.js';

// Two or more of an element (you + companions) unlock a bonus
export const SYNERGY = { fire: '불 피해 +25%', ice: '얼음 공격이 적을 둔화', wood: '초당 체력 +1.5', rock: '받는 피해 -20%' };

export const MAX_PARTY = 3, COMP_MAX_LV = 20;
const eul = (s) => ((s.charCodeAt(s.length - 1) - 0xac00) % 28 ? '을' : '를');   // Korean object particle

export class Party {
  constructor(game) {
    this.g = game; this.list = []; this.mode = 'follow'; this.guard = null;
    this.rings = []; this.flag = null;
    this.captures = 0;
  }

  onKill(e) {
    if (e.boss || this.list.length >= MAX_PARTY) return;
    if (rand() < (e.elite ? 0.35 : 0.035) * (1 + 0.25 * this.g.mv('capture'))) this.add(e.key, e.x, e.z, e.elite);
  }

  add(key, x, z, elite) {
    const g = this.g, m = MONSTERS[key], lv = g.player.level, maxHp = (elite ? 170 : 75) * (1 + lv * 0.08);
    const c = { key, name: m.name, elem: m.elem, x, z, y: heightAt(x, z), maxHp, hp: maxHp, dmg: (elite ? 16 : 8) * (1 + lv * 0.08),
      cd: 0.6, flip: 1, flash: 0, inv: 0, down: 0, elite, lv: 1, xp: 0, phase: rand() * 12, size: elite ? 4.8 : 3.6, radius: 0.6 };
    c.owner = g.player;
    this.list.push(c); this.captures++; if (g.player === g.me && dex.catch(key)) { meta.add(3); setTimeout(() => (g.toast = `도감에 새 몬스터 등록! 균열 조각 +3`), 2500); } sfx.play('capture', { vol: 0.7, at: c });
    g.say(`${m.name} 포획! 동료가 되었습니다 (${this.list.length}/${MAX_PARTY})`);
    g.parts.burst(x, c.y + 1.5, z, 50, PAL.gold, { speed: 7, up: 7, life: 0.9, size: 0.6, grav: 5 });
    g.shock(x, z, 4, '#ffd257', 0.5);
    const ring = new THREE.Mesh(g.geo.ring, new THREE.MeshBasicMaterial({ color: ELEM[m.elem].color, transparent: true, opacity: 0.85, depthWrite: false }));
    g.fx.add(ring); this.rings.push(ring);
  }

  // F: guard the aimed spot, R: follow me
  command(mode) {
    const g = this.g;
    if (!this.list.length) { g.say('동료가 없습니다 — 몬스터를 쓰러뜨리면 가끔 포획됩니다'); return; }
    this.mode = mode;
    if (mode === 'guard') {
      this.guard = { x: g.aim.x, z: g.aim.z };
      if (!this.flag) {
        this.flag = new THREE.Mesh(g.geo.ring, new THREE.MeshBasicMaterial({ color: '#ffd257', transparent: true, opacity: 0.9, depthWrite: false }));
        g.fx.add(this.flag);
      }
      this.flag.visible = true; this.flag.scale.setScalar(2.2);
      this.flag.position.set(this.guard.x, heightAt(this.guard.x, this.guard.z) + 0.15, this.guard.z);
      g.say('동료: 저기를 지켜!'); sfx.play('click', { vol: 0.5 });
    } else { if (this.flag) this.flag.visible = false; g.say('동료: 따라와!'); sfx.play('click', { vol: 0.5 }); }
  }

  alive() { return this.list.filter(c => c.down <= 0); }

  // Let a companion go (two clicks on its ✕ within 3 s, so a stray click does not lose it)
  release(i) {
    const g = this.g, c = this.list[i];
    if (!c) return;
    if (!this.armed || this.armed.c !== c || g.time > this.armed.until) { this.armed = { c, until: g.time + 3 }; return; }
    this.armed = null;
    this.list.splice(i, 1);
    g.fx.remove(this.rings.splice(i, 1)[0]);
    g.parts.burst(c.x, c.y + 1.5, c.z, 40, PAL.heal, { speed: 5, up: 8, life: 1, size: 0.5, grav: -2 });
    sfx.play('release', { vol: 0.6 });
    g.say(`${c.name}${eul(c.name)} 놓아주었습니다 (${this.list.length}/${MAX_PARTY})`);
    if (!this.list.length && this.flag) { this.flag.visible = false; this.mode = 'follow'; }
  }
  armedFor(c) { return this.armed && this.armed.c === c && this.g.time <= this.armed.until; }

  hurt(c, amount) {
    if (c.down > 0 || c.inv > 0) return;
    c.hp -= amount; c.inv = 0.5; c.flash = 1;
    if (c.hp <= 0) { c.hp = 0; c.down = 15; if (c.owner === this.g.me) this.g.toast = `${c.name} 기절! 15초 뒤 회복합니다`; }
  }

  // Companions grow with the XP you collect: +15% health and damage per level, up to Lv 20
  gainXp(v) {
    for (const c of this.list) {
      if (c.lv >= COMP_MAX_LV) continue;
      c.xp += v;
      const need = 5 + (c.lv - 1) * 4 + c.lv ** 1.75;   // the same curve as the player
      if (c.xp >= need) {   // +15% of the starting health and damage per level (adding, not compounding)
        c.xp -= need; c.lv++; c.base ??= { hp: c.maxHp, dmg: c.dmg };
        c.maxHp = c.base.hp * (1 + 0.15 * (c.lv - 1)); c.dmg = c.base.dmg * (1 + 0.15 * (c.lv - 1)); c.hp = c.maxHp;
        this.g.parts.burst(c.x, c.y + 1.2, c.z, 24, PAL.gold, { speed: 5, up: 6, life: 0.8, size: 0.45, grav: 5 });
      }
    }
  }

  update(dt) {
    const g = this.g, p = g.player, cr = g.camRight;
    // element synergy from you + companions still standing
    const count = { [p.elem]: 1 };
    for (const c of this.alive()) count[c.elem] = (count[c.elem] || 0) + 1;
    g.syn = {}; for (const k in SYNERGY) if (count[k] >= 2) g.syn[k] = true;
    g.takenMul = g.syn.rock ? 0.8 : 1;
    this.list.forEach((c, i) => {
      c.inv -= dt; c.flash = Math.max(0, c.flash - dt * 4);
      if (c.down > 0) { if ((c.down -= dt) <= 0) { c.hp = c.maxHp * 0.5; g.parts.burst(c.x, c.y + 1, c.z, 20, PAL.heal, { speed: 4, up: 4 }); } return; }
      // where to stand
      let gx, gz;
      if (this.mode === 'guard') { const a = i * 2.1; gx = this.guard.x + Math.cos(a) * 1.4; gz = this.guard.z + Math.sin(a) * 1.4; }
      else { const a = g.time * 0.4 + i * 2.1; gx = p.x + Math.cos(a) * 3; gz = p.z + Math.sin(a) * 3; }
      const dx = gx - c.x, dz = gz - c.z, d = Math.hypot(dx, dz) || 1;
      if (this.mode === 'follow' && d > 45) { c.x = p.x; c.z = p.z; }   // left far behind: catch up
      const sp = d > 0.8 ? Math.min(10, 3 + d * 1.5) : 0;
      c.x += dx / d * sp * dt; c.z += dz / d * sp * dt;
      collide(c, c.radius);
      if (g.dungeon.inside) g.dungeon.clamp(c, c.radius);
      c.y = heightAt(c.x, c.z);
      const side = dx * cr.x + dz * cr.z; if (sp > 0 && Math.abs(side) > 0.2) c.flip = side > 0 ? 1 : -1;
      // shoot the nearest enemy
      if ((c.cd -= dt) <= 0) {
        const e = g.nearest(c.x, c.z, 13);
        if (e) {
          c.cd = c.elite ? 0.6 : 0.9;
          g.shoot(c.elem === 'none' ? 'rock' : c.elem, e, 18, 1.2, { dmg: c.dmg, blast: c.elem === 'fire' || c.elem === 'rock' ? 1.6 : 0, pierce: 1, target: e }, c);
          const side2 = (e.x - c.x) * cr.x + (e.z - c.z) * cr.z; c.flip = side2 > 0 ? 1 : -1;
        } else c.cd = 0.3;
      }
    });
  }

  draw() {
    const g = this.g, t = g.time;
    this.list.forEach((c, i) => {
      g.batches[c.key].add(c.x, c.y, c.z, c.size, c.down > 0 ? 0 : Math.floor(t * 10 + c.phase) % 12, c.flip, c.down > 0 ? -1 : c.flash);
      g.shadows.add(c.x, c.y, c.z, 0.7);
      const r = this.rings[i]; r.scale.setScalar(c.elite ? 1.4 : 1); r.position.set(c.x, c.y + 0.12, c.z);
      r.material.opacity = c.down > 0 ? 0.25 : 0.85;
    });
  }

  clear() { for (const r of this.rings) this.g.fx.remove(r); if (this.flag) this.g.fx.remove(this.flag); }
}
