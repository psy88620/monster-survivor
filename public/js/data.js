// Game data: elements, monsters, biomes, skills, passive upgrades.

// fire > ice > wood > rock > fire  (x1.5 / x0.7), plus fire > wood x1.2
export const ELEM = {
  fire: { name: '불', color: '#ff6a3d' },
  ice: { name: '얼음', color: '#7fd8ff' },
  wood: { name: '나무', color: '#7ccf4a' },
  rock: { name: '암석', color: '#b59a74' },
  none: { name: '무', color: '#cccccc' },
};
const BEATS = { fire: 'ice', ice: 'wood', wood: 'rock', rock: 'fire' };
export function matchup(attack, defend) {
  if (attack === 'none' || defend === 'none') return 1;
  if (BEATS[attack] === defend) return 1.5;
  if (BEATS[defend] === attack) return 0.7;
  if (attack === 'fire' && defend === 'wood') return 1.2;
  return 1;
}

// Sprite sheets: 320x320, 4x4 cells of 80 px, 12 frames, facing right (CC0, hensji "71 monsters animations")
// hp/spd are multipliers on the base enemy
export const MONSTERS = {
  // starters
  Pyrokit: { name: '불꽃여우', elem: 'fire' },
  Icyguin: { name: '얼음펭귄', elem: 'ice' },
  Woodchip: { name: '도토리다람쥐', elem: 'wood' },
  Pebblenail: { name: '조약돌달팽이', elem: 'rock' },
  // centre (weak, mixed)
  Bandanaberry: { name: '두건열매', elem: 'wood', hp: 0.8 },
  Flameorb: { name: '불씨눈알', elem: 'fire', hp: 0.7, spd: 1.2 },
  Froggoo: { name: '풀개구리', elem: 'wood' },
  Jumpider: { name: '돌거미', elem: 'rock', spd: 1.3, hp: 0.7 },
  Browshroom: { name: '갈색버섯', elem: 'wood', hp: 1.2, spd: 0.8 },
  Waxlit: { name: '촛불이', elem: 'fire', hp: 0.8 },
  Frostytoon: { name: '눈사람병정', elem: 'ice' },
  // north: ice
  Icerant: { name: '서리개미', elem: 'ice', spd: 1.3, hp: 0.8 },
  Bluelotl: { name: '빙하도롱뇽', elem: 'ice' },
  Glaciermite: { name: '얼음벌', elem: 'ice', spd: 1.4, hp: 0.7 },
  Arcticcube: { name: '얼음상자새', elem: 'ice', hp: 1.3, spd: 0.8 },
  Snowdrifter: { name: '눈보라마법사', elem: 'ice', hp: 1.4 },
  Spearlotl: { name: '창도롱뇽', elem: 'ice', hp: 1.1 },
  Frostbuck: { name: '서리사슴', elem: 'ice', hp: 1.5, spd: 1.1 },
  // south: fire
  Emberiris: { name: '불꽃눈', elem: 'fire', spd: 1.3, hp: 0.7 },
  Flamefloat: { name: '불꽃낙하산', elem: 'fire' },
  Torchowl: { name: '횃불올빼미', elem: 'fire' },
  Scorchbeak: { name: '그을린부리', elem: 'fire', spd: 1.2 },
  Inariflame: { name: '구미화염', elem: 'fire', hp: 1.5, spd: 1.1 },
  Azureflame: { name: '푸른불새', elem: 'fire', hp: 1.3 },
  // east: wood
  Lizardle: { name: '풀도마뱀', elem: 'wood', spd: 1.2 },
  Springtail: { name: '식충꽃', elem: 'wood', hp: 1.4, spd: 0.8 },
  Chamelord: { name: '카멜레온왕', elem: 'wood', hp: 1.6 },
  Tropicool: { name: '열대싹', elem: 'wood', hp: 0.8 },
  Rosewing: { name: '장미나비', elem: 'wood', spd: 1.3, hp: 0.8 },
  Wingcocoon: { name: '날개고치', elem: 'wood', hp: 1.2 },
  Sludgebucket: { name: '늪양동이', elem: 'wood', hp: 1.5, spd: 0.8 },
  // west: rock
  Fortcrab: { name: '요새게', elem: 'rock', hp: 1.6, spd: 0.7 },
  Basticlaw: { name: '성채집게', elem: 'rock', hp: 2, spd: 0.7 },
  Turtlwheel: { name: '바퀴거북', elem: 'rock', hp: 1.5, spd: 0.8 },
  Gemsclor: { name: '보석전갈', elem: 'rock' },
  Raptoskull: { name: '해골랩터', elem: 'rock', spd: 1.3 },
  Tyraskull: { name: '해골티라노', elem: 'rock', hp: 1.6 },
  Snarlpaw: { name: '으르렁하이에나', elem: 'rock', spd: 1.2 },
  Carabash: { name: '바위딱정벌레', elem: 'rock', hp: 1.2 },
  // forests
  Palmor: { name: '야자공룡', elem: 'wood', hp: 1.3 },
  Deerie: { name: '얼룩사슴', elem: 'wood', spd: 1.3 },
  Cubhyena: { name: '새끼하이에나', elem: 'rock', spd: 1.2 },
  Bladesnail: { name: '칼날달팽이', elem: 'wood', hp: 1.3, spd: 0.8 },
  Sombractus: { name: '솜브레로선인장', elem: 'wood', hp: 1.2 },
  // bosses
  Jewelstinger: { name: '모래 전갈왕', elem: 'fire' },
  Widoweb: { name: '바위 거미', elem: 'rock' },
  Urndrake: { name: '용광로 수호룡', elem: 'fire' },
  Auroradream: { name: '균열의 왕', elem: 'none' },   // final boss: changes element as it fights
};

export const STARTERS = [
  { key: 'Pyrokit', skill: 'fireball', active: 'fireDash', desc: '화염구를 자동으로 발사합니다' },
  { key: 'Icyguin', skill: 'iceSpear', active: 'iceField', desc: '적을 꿰뚫는 얼음 창을 던집니다' },
  { key: 'Woodchip', skill: 'leaves', active: 'vineSnare', desc: '몸 주위를 도는 잎날로 베어냅니다' },
  { key: 'Pebblenail', skill: 'rockfall', active: 'rockWall', desc: '적 머리 위로 바위를 떨어뜨립니다' },
  // unlocked for good by conquering that element's dungeon once
  { key: 'Inariflame', skill: 'flameWall', active: 'fireDash', desc: '적 앞에 불타는 벽을 세웁니다', unlock: 'fire' },
  { key: 'Snowdrifter', skill: 'blizzard', active: 'iceField', desc: '적 무리에 눈보라를 일으킵니다', unlock: 'ice' },
  { key: 'Chamelord', skill: 'thorns', active: 'vineSnare', desc: '땅에서 가시 덩굴이 솟아 적을 묶습니다', unlock: 'wood' },
  { key: 'Tyraskull', skill: 'spikes', active: 'rockWall', desc: '적 발밑에서 바위 가시가 솟습니다', unlock: 'rock' },
];

// Left-click signature skill of each starter (aimed at the ground under the mouse)
export const ACTIVES = {
  fireDash: { name: '화염 돌진', cd: 5, range: 12, radius: 1.5, desc: '클릭한 곳까지 불길을 남기며 돌진 (돌진 중 무적)' },
  iceField: { name: '빙결 지대', cd: 6, range: 18, radius: 5, desc: '클릭한 곳의 적을 2초간 얼림 · 언 적은 피해 2배' },
  vineSnare: { name: '덩굴 올가미', cd: 6, range: 18, radius: 7, desc: '클릭한 곳 주변 적을 끌어모아 묶음' },
  rockWall: { name: '바위 벽', cd: 7, range: 16, radius: 1.5, desc: '클릭한 곳에 8초간 적을 막는 바위 벽' },
};
// Q ultimate by element, charged by kills
export const ULTS = {
  fire: { name: '유성우', desc: '8초간 주변에 불덩이가 쏟아짐' },
  ice: { name: '절대영도', desc: '주변 모든 적을 4초간 얼림' },
  wood: { name: '세계수', desc: '10초간 회복하며 주변 적을 밀어냄' },
  rock: { name: '대지진', desc: '주변 모든 적에게 큰 피해 + 넉백' },
};

// Biomes: spawn tables and the elite of each region
export const BIOMES = {
  center: { name: '중앙 평지', spawn: ['Bandanaberry', 'Flameorb', 'Froggoo', 'Jumpider', 'Browshroom', 'Waxlit', 'Frostytoon'], elite: 'Browshroom' },
  snow: { name: '북 · 설원 언덕', spawn: ['Icerant', 'Bluelotl', 'Glaciermite', 'Arcticcube', 'Snowdrifter', 'Spearlotl'], elite: 'Snowdrifter' },
  dungeon: { name: '빙결 성채', spawn: ['Icerant', 'Glaciermite', 'Arcticcube', 'Spearlotl', 'Snowdrifter'], elite: 'Snowdrifter' },
  desert: { name: '남 · 사막', spawn: ['Emberiris', 'Flamefloat', 'Torchowl', 'Scorchbeak', 'Azureflame'], elite: 'Inariflame' },
  swamp: { name: '동 · 늪지 밀림', spawn: ['Lizardle', 'Springtail', 'Tropicool', 'Rosewing', 'Wingcocoon', 'Sludgebucket'], elite: 'Chamelord' },
  rock: { name: '서 · 돌산 협곡', spawn: ['Fortcrab', 'Turtlwheel', 'Gemsclor', 'Raptoskull', 'Snarlpaw', 'Carabash'], elite: 'Tyraskull' },
  forest: { name: '숲', spawn: ['Palmor', 'Deerie', 'Cubhyena', 'Bladesnail', 'Sombractus', 'Froggoo'], elite: 'Palmor' },
};

// Skills: each element has its own kit of six; a monster only learns skills of its element.
// lv 1..5; the numbers live in skills.js
export const SKILLS = {
  // fire
  fireball: { name: '화염구', elem: 'fire', desc: ['가장 가까운 적에게 날아가 폭발', '화염구 +1', '폭발 범위 증가', '화염구 +1', '피해 +50%'] },
  flameWall: { name: '화염벽', elem: 'fire', desc: ['적 앞에 불타는 벽 (지속 피해)', '벽 길이·피해 증가', '쿨타임 감소', '지속 시간 증가', '피해 크게 증가'] },
  fireSteps: { name: '화염 걸음', elem: 'fire', desc: ['걸어간 자리에 불길이 남음', '불길 범위 증가', '피해 증가', '불길이 더 오래 탐', '피해 크게 증가'] },
  fireRing: { name: '불의 고리', elem: 'fire', desc: ['주변으로 퍼지는 불의 파동', '범위 증가', '피해 증가', '쿨타임 감소', '범위·피해 증가'] },
  meteor: { name: '유성', elem: 'fire', desc: ['적 위로 불타는 유성 낙하', '피해 증가', '유성 +1', '쿨타임 감소', '유성 +1'] },
  flamethrower: { name: '화염 방사', elem: 'fire', desc: ['앞쪽 적에게 계속 불을 뿜음', '사거리 증가', '피해 증가', '사거리 증가', '피해 크게 증가'] },
  // ice
  iceSpear: { name: '얼음 창', elem: 'ice', desc: ['적을 꿰뚫는 얼음 창', '관통 +2', '창 +1', '피해 +40%', '창 +1'] },
  frostAura: { name: '서리 오라', elem: 'ice', desc: ['주변 적에게 지속 피해 + 둔화', '범위 증가', '피해 +40%', '범위 증가', '둔화 강화'] },
  blizzard: { name: '눈보라', elem: 'ice', desc: ['적 무리에 눈보라 (지속 피해 + 둔화)', '범위 증가', '피해 증가', '쿨타임 감소', '범위·피해 증가'] },
  icicle: { name: '고드름', elem: 'ice', desc: ['적 위로 고드름 낙하 + 잠깐 얼림', '피해 증가', '고드름 +1', '쿨타임 감소', '고드름 +1'] },
  iceShards: { name: '얼음 파편', elem: 'ice', desc: ['사방으로 얼음 파편 발사', '파편 +2', '피해 증가', '파편 +2', '피해 크게 증가'] },
  iceOrbit: { name: '회전 빙정', elem: 'ice', desc: ['몸 주위를 도는 빙정 (닿으면 얼림)', '피해 증가', '빙정 +1', '피해 증가', '빙정 +1'] },
  // wood
  leaves: { name: '회전 잎날', elem: 'wood', desc: ['몸 주위를 도는 잎날 3개', '잎날 +1', '회전 반경 증가', '잎날 +1', '피해 +50%'] },
  thorns: { name: '가시 덩굴', elem: 'wood', desc: ['적을 향해 땅에서 가시가 솟음 (묶기)', '가시 +1', '피해 증가', '가시 +1', '피해 크게 증가'] },
  seedBomb: { name: '씨앗 폭탄', elem: 'wood', desc: ['적에게 터지는 씨앗을 던짐', '피해 증가', '씨앗 +1', '폭발 범위 증가', '씨앗 +1'] },
  pollen: { name: '독 꽃가루', elem: 'wood', desc: ['적 무리에 독 꽃가루 구름 (지속 피해)', '범위 증가', '피해 증가', '구름 +1', '피해 크게 증가'] },
  lifePulse: { name: '생명의 고동', elem: 'wood', desc: ['체력을 회복하며 주변 적을 밀어냄', '회복량 증가', '피해 증가', '쿨타임 감소', '회복·피해 크게 증가'] },
  leafBlades: { name: '잎사귀 표창', elem: 'wood', desc: ['적을 꿰뚫는 잎사귀 표창 2개', '피해 증가', '표창 +1', '피해 증가', '표창 +1'] },
  // rock
  rockfall: { name: '낙석', elem: 'rock', desc: ['적 위로 바위 낙하', '바위 +1', '피해 +40%', '바위 +1', '범위 증가'] },
  quake: { name: '지진파', elem: 'rock', desc: ['주변으로 퍼지는 충격파', '범위 증가', '피해 +40%', '쿨타임 감소', '넉백 강화'] },
  stoneShot: { name: '돌 탄환', elem: 'rock', desc: ['적에게 터지는 돌덩이를 쏨', '피해 증가', '폭발 범위 증가', '돌 +1', '피해 크게 증가'] },
  spikes: { name: '바위 가시', elem: 'rock', desc: ['적들 발밑에서 바위 가시가 솟음', '가시 +1', '피해 증가', '가시 +1', '피해 크게 증가'] },
  stoneOrbit: { name: '돌 방패', elem: 'rock', desc: ['몸 주위를 도는 바위 (강한 넉백)', '피해 증가', '바위 +1', '피해 증가', '바위 +1'] },
  dustDevil: { name: '흙먼지 회오리', elem: 'rock', desc: ['적을 향해 나아가는 회오리 (지속 피해)', '범위 증가', '피해 증가', '쿨타임 감소', '범위·피해 증가'] },
};

export const PASSIVES = {
  maxHp: { name: '튼튼한 몸', desc: '최대 체력 +20' },
  speed: { name: '날쌘 발', desc: '이동 속도 +8%' },
  cooldown: { name: '집중', desc: '쿨타임 -8%' },
  damage: { name: '힘', desc: '모든 피해 +10%' },
  magnet: { name: '자석', desc: '경험치 흡수 범위 +35%' },
  regen: { name: '회복력', desc: '초당 체력 +0.6' },
};
export const MAX_SKILLS = 6, MAX_LEVEL = 5;
