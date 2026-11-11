// Permanent progress kept in this browser between runs: rift shards earned at the end of each run, spent on
// small permanent upgrades; extra starters unlocked by conquering dungeons. In a LAN game each player brings
// their own upgrade levels (sent with the pick), so every PC applies the same numbers.
const KEY = 'monster-survivor.meta';
let data = { shards: 0, up: {}, cleared: {}, wins: 0 };
try { data = { ...data, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* private mode: start empty */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ } };

export const UPGRADES = {
  hp: { name: '튼튼함', desc: '최대 체력 +10', max: 5 },
  dmg: { name: '날카로움', desc: '모든 피해 +5%', max: 5 },
  speed: { name: '날렵함', desc: '이동 속도 +3%', max: 3 },
  xp: { name: '배움', desc: '얻는 경험치 +8%', max: 3 },
  magnet: { name: '끌림', desc: '구슬 흡수 범위 +15%', max: 3 },
  capture: { name: '친화력', desc: '포획 확률 +25%', max: 3 },
};
export const upCost = (key, lv) => 15 + lv * 15;   // 15, 30, 45 ...

export const meta = {
  get shards() { return data.shards; },
  level: (key) => data.up[key] || 0,
  levels: () => ({ ...data.up }),
  buy(key) {
    const lv = this.level(key), c = upCost(key, lv);
    if (lv >= UPGRADES[key].max || data.shards < c) return false;
    data.shards -= c; data.up[key] = lv + 1; save(); return true;
  },
  add(n) { data.shards += n; save(); },
  clear(el) { if (!data.cleared[el]) { data.cleared[el] = true; save(); } },   // a dungeon conquered once unlocks its starter
  cleared: (el) => !!data.cleared[el],
  win() { data.wins++; save(); },
  get wins() { return data.wins; },
};
// Upgrade levels from another PC: only known keys, whole numbers within range
export function cleanMeta(m) {
  const out = {};
  for (const k in UPGRADES) { const v = m?.[k]; if (Number.isInteger(v) && v > 0) out[k] = Math.min(v, UPGRADES[k].max); }
  return out;
}
