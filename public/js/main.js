// Boot, camera, input, HUD and menus around the Game.
import * as THREE from 'three';
import { buildWorld, biomeAt, DUNGEONS, SIZE, HALF, updateFade } from './world.js';
import { Game, PCOLOR } from './game.js';
import { net } from './net.js';
import { meta, UPGRADES, upCost, cleanMeta } from './meta.js';
import { RIFT_WARN, RIFT_OPEN } from './dungeon.js';
import { loadSheet } from './sprites.js';
import { MONSTERS, STARTERS, SKILLS, PASSIVES, ELEM, BIOMES, ACTIVES, ULTS } from './data.js';
import { heightAt } from './world.js';
import { rngState } from './rng.js';
import { sfx } from './audio.js';
import { dex } from './dex.js';
import { Ambience } from './ambience.js';
import { SYNERGY } from './party.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const sky = new THREE.Color('#a8d8f0');
scene.background = sky; scene.fog = new THREE.Fog(sky, 70, 190);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 400);
scene.add(new THREE.HemisphereLight('#ffffff', '#5b7a4c', 1.3));
const sun = new THREE.DirectionalLight('#fff1d6', 1.7); sun.position.set(60, 100, 30); scene.add(sun);

// Bloom: only effects brighter than the scene glow (B toggles it for slow PCs)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.45, 0.35, 0.95);
composer.addPass(bloom); composer.addPass(new OutputPass());
function resize() { renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---- input
const keys = new Set();
const events = [];   // actions since the last input sent to the game: 'a' click, 'd' dash, 'u' ultimate, 'e' door, 'f'/'r' companions, { pick }, { rel }
let yaw = 0, dist = 24, dragging = false, lastX = 0;
let ambience = null;
addEventListener('pointerdown', () => sfx.unlock());   // browsers allow sound only after a user gesture
addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.code === 'KeyN') toast(game.nums.toggle() ? '피해 숫자 켜짐' : '피해 숫자 꺼짐', 1.2);
  if (e.code === 'KeyM') toast(sfx.toggle() ? '소리 꺼짐' : '소리 켜짐', 1.2);
  if (e.code === 'Escape' && (state === 'dex' || state === 'shop')) showSelect();
  keys.add(e.code);
  if (e.code === 'Escape' && (state === 'play' || state === 'paused')) setState(state === 'play' ? 'paused' : 'play');
  if (e.code === 'KeyB') { bloom.enabled = !bloom.enabled; ambience?.setRich(bloom.enabled); toast(bloom.enabled ? '고화질 (빛 번짐 · 그림자 · 풀)' : '가벼운 모드 (빛 번짐 · 그림자 · 풀 끔)', 1.8); }
  if ((state === 'play' || (state === 'levelup' && net.running)) && !e.repeat) {   // actions reach the game with the next input, the same way in solo and LAN games
    const ev = { ShiftLeft: 'd', ShiftRight: 'd', KeyQ: 'u', KeyE: 'e', KeyF: 'f', KeyR: 'r' }[e.code];
    if (ev) events.push(ev);
  }
  if (state === 'levelup' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) pick(+e.code.slice(5) - 1);
  if (state === 'select' && /^Digit[1-8]$/.test(e.code)) choosePick(+e.code.slice(5) - 1);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) { dragging = true; lastX = e.clientX; }
  if (e.button === 0 && (state === 'play' || (state === 'levelup' && net.running))) events.push('a');
});
const mouse = new THREE.Vector2(), ray = new THREE.Raycaster();
addEventListener('mousemove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
// Ground point under the mouse: march along the ray until it dips below the terrain, then refine
function groundUnderMouse() {
  ray.setFromCamera(mouse, camera);
  const o = ray.ray.origin, d = ray.ray.direction, at = (t) => o.y + d.y * t - heightAt(o.x + d.x * t, o.z + d.z * t);
  let a = 0, b = 0;
  for (let t = 1; t < 260; t += 1.5) { if (at(t) < 0) { b = t; break; } a = t; }
  if (!b) return null;
  for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (at(m) < 0) b = m; else a = m; }
  return { x: o.x + d.x * b, z: o.z + d.z * b };
}
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => { if (dragging) { yaw -= (e.clientX - lastX) * 0.006; lastX = e.clientX; } });
canvas.addEventListener('wheel', (e) => { dist = Math.max(12, Math.min(40, dist + Math.sign(e.deltaY) * 2)); }, { passive: true });
function moveInput() {
  if (window.autoplay) return autoInput();
  const k = (...c) => c.some((x) => keys.has(x));
  return { x: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0), y: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0) };
}

// Everything this PC tells the game for one step (rounded: it travels to the other PCs in a LAN game)
function collectInput() {
  const m = moveInput(), g = window.autoplay ? autoAim() : groundUnderMouse();
  const inp = { x: m.x, y: m.y, w: Math.round(yaw * 1000) / 1000 };
  if (g) { inp.ax = Math.round(g.x * 10) / 10; inp.az = Math.round(g.z * 10) / 10; }
  if (window.autoplay && state === 'play') events.push('a', 'u');
  if (events.length) inp.e = events.splice(0);
  return inp;
}

// Test aid (window.autoplay = true): run away from nearby monsters while circling, like a cautious player
function autoInput() {
  const p = game.player; let ax = Math.cos(game.time * 0.3) * 0.6, az = Math.sin(game.time * 0.3) * 0.6;
  for (const e of game.enemies) { const dx = p.x - e.x, dz = p.z - e.z, d2 = dx * dx + dz * dz; if (d2 < 100) { ax += dx / d2 * 4; az += dz / d2 * 4; } }
  ax -= p.x * 0.004; az -= p.z * 0.004;   // drift back towards the centre
  let g = null, gd = 1e9; for (const o of game.gems) { const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < gd) { gd = d; g = o; } }
  if (g) { const d = Math.hypot(g.x - p.x, g.z - p.z) || 1; ax += (g.x - p.x) / d * 0.8; az += (g.z - p.z) / d * 0.8; }
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return { x: ax * rx + az * rz, y: ax * fx + az * fz };
}

// ---- state
const game = new Game(scene);
let state = 'loading', minimapBase, offer = [], shownOffers, myPick = null, lastPick = 0, lastBiome = '', toastT = 0, nearDungeon = null;
window.sfx = null; import('./audio.js').then((a) => (window.sfx = a.sfx));
window.game = game; window.net = net; import('./world.js').then((w) => { window.fadeCount = w.fadeCount; window.fadeSample = w.fadeSample; });   // for automated checks in the browser
function setState(s) {
  state = s;
  for (const id of ['loading', 'select', 'levelup', 'pause', 'over', 'dex', 'shop']) $(id).classList.add('hidden');
  const show = { loading: 'loading', select: 'select', levelup: 'levelup', paused: 'pause', over: 'over', dex: 'dex', shop: 'shop' }[s];
  if (show) $(show).classList.remove('hidden');
  $('hud').classList.toggle('hidden', ['loading', 'select', 'dex', 'shop'].includes(s));
}
function toast(text, t = 2.5) { $('toast').textContent = text; $('toast').style.opacity = 1; toastT = t; }

function spriteCanvas(key, px = 128, dark = false) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  loadSheet(key).then((s) => { if (dark) ctx.filter = 'brightness(0) opacity(0.6)'; ctx.drawImage(s.image, 0, 0, 80, 80, 0, 0, px, px); });
  return c;
}

function showSelect() {
  const box = $('starters'); box.innerHTML = '';
  STARTERS.forEach((s, i) => {
    const m = MONSTERS[s.key], sk = SKILLS[s.skill], card = document.createElement('div'), locked = isLocked(i);
    card.className = 'card' + (locked ? ' locked' : '');
    card.append(spriteCanvas(s.key, 128, locked));
    card.insertAdjacentHTML('beforeend', `<div class="name">${m.name}</div><div class="tag" style="background:${ELEM[m.elem].color}">${ELEM[m.elem].name} 속성</div>
      <div class="desc"><b>자동</b> ${sk.name}: ${s.desc}<br><b>클릭</b> ${ACTIVES[s.active].name}: ${ACTIVES[s.active].desc}<br><b>Q</b> ${ULTS[m.elem].name}: ${ULTS[m.elem].desc}</div><div class="key">${i + 1}번</div>`);
    if (locked) card.querySelector('.desc').innerHTML = `🔒 ${ELEM[s.unlock].name} 던전을 한 번 정복하면 해금됩니다`;
    card.onclick = () => choosePick(i);
    box.append(card);
  });
  $('shopcount').textContent = meta.shards;
  $('dexcount').textContent = `${Object.keys(MONSTERS).filter((k) => dex.caught(k)).length} / ${Object.keys(MONSTERS).length} 포획`;
  net.send({ t: 'busy', on: false });
  setState('select'); renderLobby();
}
// LAN lobby under the monster cards: who is here, and the address friends type in
function renderLobby() {
  const l = net.lobby, box = $('lobby');
  document.querySelectorAll('#starters .card').forEach((c, i) => c.classList.toggle('picked', i === myPick));
  if (!l) { box.innerHTML = ''; return; }
  const addr = l.ips.map((ip) => `<b>http://${ip}:${l.port}</b>`).join(' 또는 ');
  const chips = l.players.map((p) => {
    const what = p.inRun ? '게임 중' : p.busy ? '혼자 하는 중' : p.pick !== null ? `${MONSTERS[STARTERS[p.pick].key].name} 준비!` : '고르는 중…';
    return `<span class="lp${p.pick !== null && !p.busy ? ' ready' : ''}">${p.id === net.id ? '나' : '친구'} · ${what}</span>`;
  }).join('');
  const free = net.free().length;
  box.innerHTML = `<div>👥 같이 하기 — 같은 네트워크의 친구 PC에서 ${addr} 로 접속하세요</div><div>${chips}</div><div class="dim">`
    + (free ? (myPick !== null ? '친구들이 모두 고르면 함께 시작합니다' : `친구 ${free}명과 함께 시작합니다 — 몬스터를 고르세요`) : '지금 고르면 혼자 시작합니다')
    + (l.running ? ' · 다른 친구들은 게임 중이에요' : '') + '</div>';
}
// A friend is free in the lobby: pick and wait for everyone. Nobody else: start alone right away.
const isLocked = (i) => !!STARTERS[i]?.unlock && !meta.cleared(STARTERS[i].unlock);
function choosePick(i) {
  if (!STARTERS[i]) return;
  if (isLocked(i)) { toast(`${ELEM[STARTERS[i].unlock].name} 던전을 한 번 정복하면 쓸 수 있습니다`, 2); return; }
  sfx.play('click', { vol: 0.5 });
  if (!net.free().length) return startRun(i);
  myPick = i; net.send({ t: 'pick', i, meta: meta.levels() }); renderLobby();
}
net.onLobby = () => {
  if (state !== 'select' && state !== 'dex' && state !== 'over') return;
  if (myPick !== null && !net.free().length) { const i = myPick; myPick = null; return startRun(i); }   // the friends left: go alone
  if (state === 'over') overWait();
  if (state === 'select') renderLobby();
};
net.onStart = (d) => {
  myPick = null; lastPick = d.players.find((p) => p.id === net.id)?.pick ?? 0;
  game.start({ players: d.players.map((p) => ({ id: p.id, ...STARTERS[p.pick], meta: cleanMeta(p.meta) })), me: net.id, seed: d.seed });
  netAcc = 0; hashes.clear(); myHash = null; desyncs = 0;
  begin(`${d.players.length}명이 함께 출발! 쓰러진 친구 곁에 서 있으면 일으킬 수 있어요`);
};
net.onLost = () => toast('서버와 연결이 끊겼습니다 — 다시 연결하는 중…', 90);
net.onResume = () => toast('다시 연결됐습니다! 놓친 부분을 따라잡는 중…', 3);
net.onClose = (wasRunning) => {
  if (wasRunning && !game.over) { game.over = true; toast('서버에 다시 연결하지 못했습니다', 4); }
  if (state === 'select') { myPick = null; renderLobby(); }
};
// Bestiary: met monsters in colour, unknown ones as silhouettes
const BOSSES = [['Frostbuck', '서리뿔 사슴왕'], ['Jewelstinger', '모래 전갈왕'], ['Springtail', '늪지 식인꽃'], ['Widoweb', '바위 거미'],
  ['Bluelotl', '쌍둥이 빙하룡'], ['Urndrake', '용광로 수호룡'], ['Palmor', '천년 고목 정령'], ['Basticlaw', '고대 골렘'], ['Auroradream', '균열의 왕']];
const BOSS_ONLY = new Set(['Jewelstinger', 'Widoweb', 'Urndrake', 'Auroradream']);
const REGION = {};   // where each monster lives (first region that spawns it)
for (const [b, def] of Object.entries(BIOMES)) if (b !== 'dungeon') for (const k of [...def.spawn, def.elite]) REGION[k] ??= def.name.replace(/^. · /, '');
function showDex() {
  const bb = $('dexboss'); bb.innerHTML = '';
  for (const [key, name] of BOSSES) {
    const beat = dex.beaten(name), card = document.createElement('div');
    card.className = 'dexcard' + (beat ? ' caught' : '');
    card.append(spriteCanvas(key, 72, !beat));
    card.insertAdjacentHTML('beforeend', `<div class="dn">${beat ? name : '???'}</div><div class="de">${beat ? '격파' : '-'}</div>`);
    bb.append(card);
  }
  const box = $('dexgrid'); box.innerHTML = '';
  const keys = Object.keys(MONSTERS).filter((k) => !BOSS_ONLY.has(k));
  for (const key of keys) {
    const m = MONSTERS[key], seen = dex.seen(key), caught = dex.caught(key), card = document.createElement('div');
    card.className = 'dexcard' + (caught ? ' caught' : '');
    const c = spriteCanvas(key, 72, !seen); card.append(c);
    card.insertAdjacentHTML('beforeend', `<div class="dn">${seen ? m.name : '???'}</div><div class="de" style="color:${seen ? ELEM[m.elem].color : '#666'}">${seen ? ELEM[m.elem].name : '-'}${caught ? ' · 포획' : ''}</div>`
      + (seen ? `<div class="dk">${REGION[key] || '시작 몬스터'} · 처치 ${dex.kills(key)}</div>` : ''));
    box.append(card);
  }
  $('dexsum').textContent = `포획 ${keys.filter((k) => dex.caught(k)).length} / ${keys.length} · 만남 ${keys.filter((k) => dex.seen(k)).length} · 보스 격파 ${BOSSES.filter(([, n]) => dex.beaten(n)).length} / ${BOSSES.length} · 균열의 왕 승리 ${meta.wins}회`;
  setState('dex');
}
// Permanent upgrades bought with rift shards
function showShop() {
  $('shopinfo').innerHTML = `💎 균열 조각 <b>${meta.shards}</b>개 — 판이 끝날 때 생존 시간·처치·던전·보스에 따라 모이고, 도감에 새 몬스터를 등록할 때도 3개 얻습니다`;
  const box = $('shopgrid'); box.innerHTML = '';
  for (const k in UPGRADES) {
    const u = UPGRADES[k], lv = meta.level(k), max = lv >= u.max, cost = upCost(k, lv), card = document.createElement('div');
    card.className = 'card shopcard' + (max || meta.shards < cost ? ' dim' : '');
    card.innerHTML = `<div class="name">${u.name}</div><div class="lv">Lv ${lv} / ${u.max}</div><div class="desc">${u.desc}</div><div class="cost">${max ? '최대' : `💎 ${cost}`}</div>`;
    card.onclick = () => { if (meta.buy(k)) { sfx.play('levelup', { vol: 0.5 }); showShop(); } else sfx.play('click', { vol: 0.3 }); };
    box.append(card);
  }
  setState('shop');
}
$('shopbtn').onclick = () => { sfx.play('click', { vol: 0.5 }); showShop(); };
$('shopclose').onclick = () => showSelect();
// Shards for the run that just ended (only this PC's own progress)
function awardShards() {
  const g = game, parts = [['생존', Math.floor(g.time / 60) * 2], ['처치', Math.floor(g.me.kills / 100)],
    ['던전', 15 * ['ice', 'fire', 'wood', 'rock'].filter((el) => g.dungeon.cleared[el]).length], ['필드보스', 5 * (g.fieldKills || 0)], ['균열의 왕', g.won ? 60 : 0]].filter(([, n]) => n > 0);
  const total = parts.reduce((s, [, n]) => s + n, 0);
  meta.add(total); if (g.won) meta.win();
  return `💎 균열 조각 +${total}` + (parts.length ? ` (${parts.map(([k, n]) => `${k} ${n}`).join(' · ')})` : '') + ` · 보유 ${meta.shards}`;
}
$('dexbtn').onclick = () => { sfx.play('click', { vol: 0.5 }); showDex(); };
$('dexclose').onclick = () => showSelect();
function startRun(i) {   // solo
  const s = STARTERS[i]; lastPick = i;
  myPick = null; net.send({ t: 'busy', on: true });
  game.start({ players: [{ id: 0, ...s, meta: meta.levels() }] });
  begin(`${MONSTERS[s.key].name}와 함께 출발!`);
}
function begin(msg) { yaw = 0; lastBiome = ''; events.length = 0; shownOffers = undefined; setState('play'); toast(msg); }
window.ui = { startRun, pick: (i) => pick(i), get state() { return state; } };

// Level-up cards come from the game (everyone's picks are made before it goes on); with none of my own, I wait for friends
function openLevelUp() {
  shownOffers = game.me.offers; offer = [...shownOffers];
  $('levelup').classList.toggle('mini', net.running);
  $('levelup').querySelector('p').textContent = net.running ? '게임은 계속 진행됩니다 — 1 · 2 · 3 또는 클릭' : '하나를 고르세요 (1 · 2 · 3)';
  const box = $('choices'); box.innerHTML = '';
  offer.forEach((o, i) => {
    const card = document.createElement('div'); card.className = 'card lvcard';
    if (o.kind === 'skill') {
      const sk = SKILLS[o.key];
      card.innerHTML = `<div class="tag" style="background:${ELEM[sk.elem].color}">${ELEM[sk.elem].name} 기술</div><div class="name">${sk.name}</div>
        <div class="lv">${o.lv === 1 ? '새 기술' : `Lv ${o.lv}`}</div><div class="desc">${sk.desc[o.lv - 1]}</div><div class="key">${i + 1}번</div>`;
    } else if (o.kind === 'passive') {
      const ps = PASSIVES[o.key];
      card.innerHTML = `<div class="tag" style="background:#ddd">강화</div><div class="name">${ps.name}</div><div class="lv">Lv ${o.lv}</div><div class="desc">${ps.desc}</div><div class="key">${i + 1}번</div>`;
    } else card.innerHTML = `<div class="name">회복</div><div class="desc">체력 40 회복</div>`;
    card.onclick = () => pick(i);
    box.append(card);
  });
  setState('levelup');
}
function pick(i) {
  if (state !== 'levelup' || !offer[i]) return;
  events.push({ pick: i }); offer = []; sfx.play('click', { vol: 0.5 });
  [...$('choices').children].forEach((c, j) => (c.style.opacity = j === i ? 1 : 0.35));
}
$('again').onclick = showSelect;
$('restart').onclick = restart;
addEventListener('keydown', (e) => { if (e.code === 'Enter' && state === 'over') restart(); });
function restart() {
  sfx.play('click', { vol: 0.5 });
  if (!net.free().length) return startRun(lastPick);
  myPick = lastPick; net.send({ t: 'pick', i: lastPick, meta: meta.levels() }); overWait();
}
function overWait() {   // over screen in a LAN game: who wants to go again
  const free = net.free();
  const ready = free.filter((p) => p.pick !== null).length;
  $('overwait').textContent = myPick === null ? (ready ? `친구 ${ready}명이 재시작을 기다리는 중 — Enter를 누르면 같은 몬스터로 다시 시작합니다` : free.length ? `친구 ${free.length}명이 대기 중 — 재시작을 누르면 같은 몬스터로 다시 모입니다` : '') :
    `재시작 대기 중… (${free.filter((p) => p.pick !== null).length + 1}/${free.length + 1}명 준비)`;
}
// Party panel: ✕ releases a companion (click twice). mousedown, because the panel is redrawn 10 times a second
$('party').addEventListener('mousedown', (e) => {
  const b = e.target.closest('.rel'); if (!b || state !== 'play') return;
  e.preventDefault(); e.stopPropagation();
  events.push({ rel: +b.dataset.i }); hudT = 0.05;
});

// ---- HUD
const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let hudT = 0;
function updateHud(dt) {
  const p = game.player;
  $('hurt').style.opacity = Math.max(0, (game.hurt || 0)) * 2; game.hurt = Math.max(0, (game.hurt || 0) - dt);
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').style.opacity = 0;
  if (game.toast) { toast(game.toast, 3); game.toast = null; }
  // region and dungeon notices
  const b = biomeAt(p.x, p.z);
  if (b !== lastBiome) { if (lastBiome) toast(BIOMES[b].name, 2); lastBiome = b; }
  const d = game.dungeon.nearEntrance();
  if (d !== nearDungeon) { nearDungeon = d; if (d) toast(game.dungeon.entranceText(d), 4); }
  if ((hudT -= dt) > 0) return;
  hudT = 0.1;
  $('xpbar').firstChild.style.width = `${(p.xp / p.next) * 100}%`;
  $('lvl').textContent = `Lv ${p.level}`;
  const dg = game.dungeon, tt = game.time;   // the clock also tells when the rift opens and the king comes
  $('time').innerHTML = fmt(tt) + (dg.cleared.rift ? '' : dg.riftUsed ? '<small>최종 결전</small>' : dg.kingOut ? '<small>균열의 왕 출현!</small>' : dg.riftOpen ? '<small>🌀 균열 열림 — 중앙에서 E</small>'
    : tt >= RIFT_WARN ? `<small>균열까지 ${fmt(RIFT_OPEN - tt)}</small>` : '');
  $('kills').textContent = `처치 ${game.kills}`;
  const act = ACTIVES[game.active.key], ult = ULTS[p.elem];
  skillBox('actA', '클릭', act.name, game.active.t > 0 ? `${game.active.t.toFixed(1)}초` : '준비', 1 - game.active.t / (act.cd * game.cdMul));
  skillBox('actD', 'Shift', '대시', game.dashCd > 0 ? `${game.dashCd.toFixed(1)}초` : '준비', 1 - game.dashCd / (3 * game.cdMul));
  skillBox('actU', 'Q', ult.name, game.ultT > 0 ? '사용 중' : game.ult >= 1 ? '준비!' : `${Math.floor(game.ult * 100)}%`, game.ultT > 0 ? 1 : game.ult);
  $('hpbar').firstChild.style.width = `${(p.hp / p.maxHp) * 100}%`;
  $('hpbar').firstChild.style.background = p.hp < p.maxHp * 0.3 ? '#ff5050' : '#4fd36b';
  $('hptext').textContent = p.down ? `쓰러짐 — 친구가 곁에 오면 일어납니다 (${Math.floor((p.revive / 3) * 100)}%)` : `${MONSTERS[p.key].name}  ${Math.ceil(p.hp)} / ${p.maxHp}`;
  $('region').textContent = game.dungeon.inside ? game.dungeon.def.name : BIOMES[b].name + ' ' + Object.keys(game.dungeon.keys).filter((k) => !game.dungeon.cleared[k]).map(() => '🔑').join('');
  $('minimap').style.display = game.dungeon.inside ? 'none' : '';
  $('bosses').innerHTML = game.dungeon.bars().map((bb) => bb.warn ? `<div class="bname warn">${bb.warn}</div>`
    : `<div class="bname">${bb.name}${bb.note ? ` <span class="bnote">· ${bb.note}</span>` : ''}</div><div class="bbar"><div style="width:${bb.frac * 100}%"></div></div>`).join('');
  const team = game.players.filter((q) => q !== p && !q.gone).map((q) => `<div class="pm" style="border-color:${PCOLOR[q.num]}"><b>${q.name} ${MONSTERS[q.key].name}</b> <span class="plv">Lv${q.level}</span> ${q.down ? '<span class="pdown">쓰러짐 — 곁에 가서 일으켜 주세요</span>' : `<span class="pbar"><span style="width:${(q.hp / q.maxHp) * 100}%"></span></span>`}</div>`).join('');
  $('party').innerHTML = team + game.party.list.map((c, i) => `<div class="pm" style="border-color:${ELEM[c.elem].color}"><b>${c.name}</b> <span class="plv">Lv${c.lv}</span> ${c.down > 0 ? `<span class="pdown">기절 ${Math.ceil(c.down)}초</span>` : `<span class="pbar"><span style="width:${(c.hp / c.maxHp) * 100}%"></span></span>`}<button class="rel${game.party.armedFor(c) ? ' armed' : ''}" data-i="${i}" title="놓아주기">${game.party.armedFor(c) ? '놓아주기?' : '✕'}</button></div>`).join('')
    + (game.party.list.length ? `<div class="pmode">${game.party.mode === 'guard' ? '지키는 중' : '따라오는 중'} · F 지켜 · R 따라와</div>` : '')
    + Object.keys(game.syn).map((k) => `<div class="syn" style="border-color:${ELEM[k].color}">${ELEM[k].name} 시너지 · ${SYNERGY[k]}</div>`).join('');
  $('skills').innerHTML = Object.entries(game.skills).map(([k, s]) => `<div class="sk" style="border-color:${ELEM[SKILLS[k].elem].color}">${SKILLS[k].name} Lv${s.lv}</div>`).join('')
    + Object.entries(game.passives).map(([k, l]) => `<div class="sk" style="border-color:#ddd">${PASSIVES[k].name} Lv${l}</div>`).join('');
  // minimap
  const ctx = $('minimap').getContext('2d'), sc = 180 / SIZE, mx = (x) => (x + HALF) * sc;
  ctx.drawImage(minimapBase, 0, 0);
  for (const dn of DUNGEONS) { ctx.fillStyle = ELEM[dn.elem].color; ctx.strokeStyle = '#000'; ctx.fillRect(mx(dn.x) - 5, mx(dn.z) - 5, 10, 10); ctx.strokeRect(mx(dn.x) - 5, mx(dn.z) - 5, 10, 10); }
  if (game.dungeon.riftOpen) { ctx.fillStyle = '#c08aff'; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(mx(0), mx(0), 6 + Math.sin(game.time * 4), 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#ff3b30';
  for (const e of game.enemies) if (e.elite) { ctx.beginPath(); ctx.arc(mx(e.x), mx(e.z), e.boss ? 5.5 : 3.5, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
  for (const dn of DUNGEONS) if (game.dungeon.cleared[dn.elem]) ctx.fillText('✓', mx(dn.x) - 4, mx(dn.z) + 4);
  for (const q of game.players) if (q !== p && !q.gone) { ctx.fillStyle = PCOLOR[q.num]; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(mx(q.x), mx(q.z), 4, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.save(); ctx.translate(mx(p.x), mx(p.z)); ctx.rotate(-yaw);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function skillBox(id, key, name, state, fill) {
  const el = $(id);
  el.innerHTML = `<div class="k">${key}</div><div class="n">${name}</div><div class="s">${state}</div><div class="f" style="width:${Math.max(0, Math.min(1, fill)) * 100}%"></div>`;
  el.classList.toggle('ready', fill >= 1);
}
// Aim marker on the ground (where the left-click skill lands)
const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false }));
aimRing.visible = false; scene.add(aimRing);
function autoAim() {   // test aid: aim at the thickest nearby crowd
  const e = game.nearest(game.player.x, game.player.z, 18); return e ? { x: e.x, z: e.z } : null;
}

// ---- loop
const clock = new THREE.Clock();
let camPos = new THREE.Vector3(), wasInside = false;
const perf = { t: 0, n: 0, left: 3 };   // three 3-second samples at the start of a session
// LAN game: send my input for the coming steps, then simulate every step whose bundle (all players' inputs) has arrived
const TICK = 1 / 60;
let netAcc = 0;
// Out-of-step check: every 5 s each PC sends a fingerprint of its world; a mismatch is shown and logged on the server
const CHECK = 300, hashes = new Map();
let myHash = null, desyncs = 0;
const fingerprint = () => `t${game.time.toFixed(2)} r${rngState()} e${game.enemies.length} k${game.kills} `
  + game.players.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)},${Math.round(p.hp)},${p.level}`).join('|');
function report(k, mine, theirs) {
  if (desyncs++ < 5) net.send({ t: 'desync', k, mine, theirs });
  if (desyncs === 1) toast('⚠ 친구 PC와 화면이 어긋났습니다 — 서버 창에 기록했어요', 5);
}
function stepNet(raw) {
  netAcc = Math.min(0.25, netAcc + raw);
  while (netAcc >= TICK && net.sent - net.done < 6) {
    netAcc -= TICK; const d = collectInput();
    if (myHash) { d.h = myHash; myHash = null; }
    net.send({ t: 'in', n: net.sent++, d });
  }
  const t0 = performance.now();   // after a hidden tab or a reconnect, catch up as fast as this PC allows
  while (net.ticks.length && !game.over && performance.now() - t0 < 12) {
    const tk = net.ticks.shift();
    for (const id of tk.gone || []) game.leaveGame(id);
    try { game.update(TICK, tk.ins, yaw); } catch (e) { console.error(e); report(tk.n, `error: ${e.message}`, ''); }
    net.done++;
    for (const id in tk.ins) {
      const h = tk.ins[id].h; if (!h || +id === net.id) continue;
      const mine = hashes.get(h[0]); if (mine && mine !== h[1]) report(h[0], mine, h[1]);
    }
    if (tk.n % CHECK === 0) { myHash = [tk.n, fingerprint()]; hashes.set(tk.n, myHash[1]); hashes.delete(tk.n - CHECK * 20); }
  }
}
function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta(), dt = Math.min(0.05, raw);
  const live = state === 'play' || state === 'levelup' || (state === 'paused' && net.running);   // a LAN game never pauses
  if (live && game.player) {
    if (net.running) stepNet(raw);
    else if (state !== 'paused') game.update(dt, { [game.me.id]: collectInput() }, yaw);
    if (game.over) {
      $('overstats').innerHTML = `생존 ${fmt(game.time)} · Lv ${game.player.level} · 처치 ${game.me.kills}` + (game.players.length > 1 ? ` · ${game.players.length}명 협동` : '') + '<br>' + awardShards();
      if (net.running) { net.running = false; net.send({ t: 'over' }); }
      $('over').querySelector('h1').textContent = game.won ? '🏆 균열의 왕을 쓰러뜨렸습니다!' : game.players.length > 1 ? '전멸했습니다' : '쓰러졌습니다';
      myPick = null; setState('over'); overWait();
    } else if (state !== 'paused') {
      const mine = game.me.offers;   // only my own level-ups; in a LAN game the others play on meanwhile
      if (mine && (state === 'play' || mine !== shownOffers)) openLevelUp();
      else if (!mine && state === 'levelup') setState('play');
    }
  }
  if (game.player) {
    game.draw(state === 'play' || state === 'levelup' || net.running ? dt : 0);
    if (state === 'play' && game.active) {
      const def = ACTIVES[game.active.key], t = game.aimAt(def.range);
      aimRing.visible = true; aimRing.scale.setScalar(def.radius); aimRing.position.set(t.x, heightAt(t.x, t.z) + 0.2, t.z);
      aimRing.material.color.set(game.active.t > 0 ? '#888888' : ELEM[game.player.elem].color);
    } else aimRing.visible = false;
    const p = game.player, pitch = 0.95;
    const want = new THREE.Vector3(p.x + Math.sin(yaw) * Math.cos(pitch) * dist, p.y + Math.sin(pitch) * dist, p.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camPos.lerp(want, camPos.lengthSq() ? Math.min(1, dt * 8) : 1);
    const sh = game.shake * game.shake * 1.2;   // screen shake from big hits
    camera.position.copy(camPos).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    camera.lookAt(p.x, p.y + 1.2, p.z);
    if (!game.dungeon.inside) updateFade(camera.position.x, camera.position.z, p.x, p.z, dt);
    sfx.listener = p;
    // dungeon: close dark fog (its colour comes from the ambience)
    const inside = game.dungeon.inside;
    if (inside !== wasInside) { wasInside = inside; scene.fog.near = inside ? 25 : 70; scene.fog.far = inside ? 75 : 190; }
    if (state !== 'loading' && state !== 'select') updateHud(dt);
  } else {   // menu: slow orbit over the centre
    const t = performance.now() / 9000;
    camera.position.set(Math.sin(t) * 60, 34, Math.cos(t) * 60); camera.lookAt(0, 2, 0);
  }
  ambience?.update(state === 'play' || !game.player ? dt : 0, game, scene);
  // Slow PC? Sample the frame rate early in the run and drop to the light mode once
  if (state === 'play' && perf.left > 0 && bloom.enabled) {
    perf.t += dt; perf.n++;
    if (perf.t > 3 && perf.n / perf.t < 42) { bloom.enabled = false; ambience?.setRich(false); perf.left = 0; toast('자동으로 가벼운 모드로 바꿨습니다 (B 키로 변경)', 3); }
    else if (perf.t > 3) { perf.left--; perf.t = perf.n = 0; }
  }
  if (game.player) game.nums.update(state === 'paused' && !net.running ? 0 : dt, camera);
  composer.render();
}

// ---- boot
(async () => {
  frame(); net.connect();
  const bar = $('loadbar').firstChild;
  const w = await buildWorld(scene, (f) => (bar.style.width = `${f * 80}%`));
  minimapBase = w.minimap;
  ambience = new Ambience({ scene, renderer, sun, terrain: w.terrain, water: w.water }); window.amb = ambience;   // amb: automated checks
  $('loadtext').textContent = '몬스터를 부르는 중…';
  await game.preload();
  bar.style.width = '100%';
  showSelect();
})().catch((e) => { $('loadtext').textContent = '불러오기 실패: ' + e.message; console.error(e); });
