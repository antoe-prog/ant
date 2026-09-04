// 적 데이터. ai 필드가 sim/enemyAI.js 의 행동 함수를 선택한다.
// 모든 공격은 "예고(telegraph) → 판정" 구조 — 플레이어가 읽고 대응할 수 있어야 한다.

export const ENEMIES = [
  {
    id: 'husk',
    name: '잿더미 병사',
    ai: 'charger',
    hp: 46, dmg: 10, speed: 108, radius: 17, gold: 4,
    color: '#8d7f74', accent: '#d9603f',
    weight: 100, minBiome: 0,
    telegraph: 0.55,   // 돌진 예고 시간
    chargeSpeed: 560,
    chargeTime: 0.38,
    chargeRange: 300,
    cooldown: 1.25,
    contact: true,
  },
  {
    id: 'cinderling',
    name: '잿까마귀',
    ai: 'chaser',
    hp: 24, dmg: 7, speed: 190, radius: 12, gold: 2,
    color: '#4d4a5a', accent: '#ff9f43',
    weight: 85, minBiome: 0,
    packSize: [2, 4],
    contact: true,
  },
  {
    id: 'bolter',
    name: '재의 석궁수',
    ai: 'ranged',
    hp: 34, dmg: 9, speed: 96, radius: 14, gold: 5,
    color: '#5b6b7a', accent: '#7fd8ff',
    weight: 70, minBiome: 0,
    telegraph: 0.62,
    keepDist: [230, 400],
    projSpeed: 420, projRadius: 7, projLife: 2.4,
    cooldown: 1.7, burst: 1,
  },
  {
    id: 'bulwark',
    name: '무쇠 방벽',
    ai: 'shielder',
    hp: 92, dmg: 14, speed: 74, radius: 21, gold: 8,
    color: '#6f7d8c', accent: '#ffd166',
    weight: 46, minBiome: 1,
    shieldArc: 130,        // 전방 이 각도 내 피해 감소
    shieldReduce: 0.82,    // 82% 감소 → 뒤/옆을 쳐야 한다
    telegraph: 0.62,
    swingArc: 120, swingRange: 92, swingTime: 0.22,
    cooldown: 1.5,
    contact: false,
  },
  {
    id: 'splitter',
    name: '분열하는 고름',
    ai: 'chaser',
    hp: 52, dmg: 8, speed: 128, radius: 20, gold: 6,
    color: '#7a5a86', accent: '#c07bff',
    weight: 44, minBiome: 1,
    contact: true,
    splitInto: { id: 'splitterling', count: 2 },
  },
  {
    id: 'splitterling',
    name: '고름 조각',
    ai: 'chaser',
    hp: 16, dmg: 6, speed: 168, radius: 11, gold: 1,
    color: '#8f6c9b', accent: '#c07bff',
    weight: 0, minBiome: 1, // 직접 스폰 안 됨
    contact: true,
  },
  {
    id: 'bomber',
    name: '자폭 화신',
    ai: 'bomber',
    hp: 30, dmg: 22, speed: 158, radius: 15, gold: 5,
    color: '#a33b3b', accent: '#ff6b35',
    weight: 40, minBiome: 1,
    fuse: 0.7, blastRadius: 108,
  },
  {
    id: 'lancer',
    name: '서리창 기병',
    ai: 'charger',
    hp: 70, dmg: 15, speed: 132, radius: 18, gold: 8,
    color: '#5a7a8c', accent: '#7fd8ff',
    weight: 52, minBiome: 2,
    telegraph: 0.45,
    chargeSpeed: 720, chargeTime: 0.46, chargeRange: 420,
    cooldown: 1.1,
    contact: true,
    applyStatus: { kind: 'chill', stacks: 2 },
  },
  {
    id: 'warden',
    name: '폭풍 감시자',
    ai: 'ranged',
    hp: 58, dmg: 11, speed: 110, radius: 16, gold: 9,
    color: '#4a5b8c', accent: '#ffe36b',
    weight: 48, minBiome: 2,
    telegraph: 0.5,
    keepDist: [200, 360],
    projSpeed: 340, projRadius: 9, projLife: 2.8,
    cooldown: 1.9, burst: 3, burstGap: 0.13, spread: 0.22,
    applyStatus: { kind: 'shock', stacks: 1 },
  },
  {
    id: 'bonecaller',
    name: '시체 술사',
    ai: 'raiser',
    hp: 62, dmg: 10, speed: 104, radius: 16, gold: 11,
    color: '#5c4b73', accent: '#9d7fd8',
    weight: 42, minBiome: 1,
    telegraph: 0.8,          // 부활 예고 — 끊을 시간을 준다
    keepDist: [230, 380],
    raiseRange: 340,
    revivedHp: 0.55,         // 되살아난 적의 체력 배율
    cooldown: 2.6,
    contact: false,
  },
];

export const ENEMY_BY_ID = Object.fromEntries(ENEMIES.map((e) => [e.id, e]));

// ============================================================
// 엘리트 접두사(affix) — 같은 적이라도 매번 다른 위협이 되게 한다.
// 엘리트는 1~2개를 무작위로 얻고, 이름과 오라 색으로 표시된다.
// ============================================================
export const ELITE_AFFIXES = [
  {
    id: 'volatile', name: '폭발성', color: '#ff6b35',
    desc: '죽을 때 폭발한다',
    onDeath: { explode: { radius: 190, dmg: 26, telegraph: 0.55 } },
  },
  {
    id: 'warded', name: '수호', color: '#7fd8ff',
    desc: '주변 적이 받는 피해를 줄인다',
    aura: { radius: 220, damageReduce: 0.45 },
  },
  {
    id: 'swift', name: '신속', color: '#63e6be',
    desc: '이동과 공격이 매우 빠르다',
    speedMult: 1.5, telegraphMult: 0.65,
  },
  {
    id: 'regen', name: '재생', color: '#8bd450',
    desc: '체력을 계속 회복한다 (빠르게 처치해야 한다)',
    regenPerSec: 0.035,
  },
  {
    id: 'thorned', name: '가시', color: '#c07bff',
    desc: '근접 공격을 받으면 반격 탄을 뿌린다',
    retaliate: { count: 6, speed: 260, dmg: 9, cooldown: 1.1 },
  },
  {
    id: 'vampiric', name: '흡혈', color: '#ff4d6d',
    desc: '플레이어를 때리면 체력을 회복한다',
    lifesteal: 0.35,
  },
];
export const AFFIX_BY_ID = Object.fromEntries(ELITE_AFFIXES.map((a) => [a.id, a]));

// ============================================================
// 미니보스 — 구역 중반에 등장하는 이름 있는 적.
// 보스와 같은 패턴 시스템을 쓰되 규모가 작다.
// ============================================================
export const MINIBOSSES = [
  {
    id: 'emberpriest', name: '잿불 사제', title: '불씨를 나르는 자',
    hp: 620, radius: 30, speed: 108, gold: 30,
    color: '#c96a3a', accent: '#ffb347', contactDmg: 0,
    miniboss: true,
    phases: [
      { at: 1.0, patterns: ['flameRing', 'summon'] },
      { at: 0.5, patterns: ['flameRing', 'summon', 'dive'], speedMult: 1.2, cooldownMult: 0.7 },
    ],
    patternCooldown: [1.2, 1.8],
    patterns: {
      flameRing: { kind: 'ringBurst', telegraph: 0.6, count: 12, projSpeed: 250, dmg: 10, waves: 2, waveGap: 0.4, rotate: 0.26 },
      summon:    { kind: 'summon', telegraph: 0.6, spawn: [{ id: 'cinderling', n: 3 }] },
      dive:      { kind: 'charge', telegraph: 0.5, speed: 700, time: 0.5, dmg: 14 },
    },
  },
  {
    id: 'frostwarden', name: '서리 파수병', title: '얼어붙은 감시자',
    hp: 900, radius: 32, speed: 96, gold: 42,
    color: '#5a8ca8', accent: '#bff0ff', contactDmg: 0,
    miniboss: true,
    phases: [
      { at: 1.0, patterns: ['iceVolley', 'stomp'] },
      { at: 0.5, patterns: ['iceVolley', 'stomp', 'blink'], speedMult: 1.15, cooldownMult: 0.72 },
    ],
    patternCooldown: [1.1, 1.7],
    patterns: {
      iceVolley: { kind: 'aimedVolley', telegraph: 0.5, count: 4, spread: 0.3, projSpeed: 440, dmg: 11, status: { kind: 'chill', stacks: 2 } },
      stomp:     { kind: 'slam', telegraph: 0.66, radius: 170, dmg: 15, shake: 'BOSS_SLAM', status: { kind: 'chill', stacks: 1 } },
      blink:     { kind: 'blink', telegraph: 0.32, dmg: 13, radius: 120 },
    },
  },
  {
    id: 'stormherald', name: '폭풍 전령', title: '번개를 부르는 자',
    hp: 1150, radius: 34, speed: 122, gold: 55,
    color: '#6a5ab0', accent: '#ffe36b', contactDmg: 0,
    miniboss: true,
    phases: [
      { at: 1.0, patterns: ['boltVolley', 'dash'] },
      { at: 0.5, patterns: ['boltVolley', 'dash', 'nova', 'summon'], speedMult: 1.2, cooldownMult: 0.68 },
    ],
    patternCooldown: [1.0, 1.5],
    patterns: {
      boltVolley: { kind: 'aimedVolley', telegraph: 0.44, count: 5, spread: 0.4, projSpeed: 500, dmg: 12, status: { kind: 'shock', stacks: 1 } },
      dash:       { kind: 'charge', telegraph: 0.4, speed: 820, time: 0.45, dmg: 16, repeats: 2, repeatGap: 0.2 },
      nova:       { kind: 'ringBurst', telegraph: 0.58, count: 16, projSpeed: 290, dmg: 11, waves: 2, waveGap: 0.3, rotate: -0.2 },
      summon:     { kind: 'summon', telegraph: 0.6, spawn: [{ id: 'bomber', n: 2 }] },
    },
  },
];
export const MINIBOSS_BY_ID = Object.fromEntries(MINIBOSSES.map((b) => [b.id, b]));

// ============================================================
// 보스: 페이즈 + 패턴 목록. 각 패턴은 예고 후 실행된다.
// ============================================================
export const BOSSES = [
  {
    id: 'ashwarden',
    name: '잿불 파수꾼',
    title: '첫 번째 회랑의 수문장',
    hp: 1500, radius: 40, speed: 118, gold: 40,
    color: '#b5563a', accent: '#ffb347',
    contactDmg: 13,
    phases: [
      { at: 1.0, patterns: ['slam', 'charge', 'summon'] },
      { at: 0.55, patterns: ['slam', 'charge', 'ringBurst', 'summon'], speedMult: 1.16, cooldownMult: 0.8 },
      { at: 0.25, patterns: ['slam', 'charge', 'ringBurst', 'ringBurst', 'summon'], speedMult: 1.3, cooldownMult: 0.62, enrage: true },
    ],
    patternCooldown: [1.15, 1.7],
    patterns: {
      slam:      { kind: 'slam', telegraph: 0.72, radius: 190, dmg: 17, shake: 'BOSS_SLAM' },
      charge:    { kind: 'charge', telegraph: 0.62, speed: 760, time: 0.62, dmg: 17 },
      ringBurst: { kind: 'ringBurst', telegraph: 0.66, count: 14, projSpeed: 280, dmg: 10, waves: 2, waveGap: 0.42, rotate: 0.22 },
      summon:    { kind: 'summon', telegraph: 0.7, spawn: [{ id: 'cinderling', n: 3 }] },
    },
  },
  {
    id: 'frostqueen',
    name: '서리 여왕 실라',
    title: '두 번째 회랑의 지배자',
    hp: 2050, radius: 36, speed: 132, gold: 60,
    color: '#5aa8d6', accent: '#bff0ff',
    contactDmg: 15,
    phases: [
      { at: 1.0, patterns: ['spear', 'blink', 'novaRing'] },
      { at: 0.6, patterns: ['spear', 'blink', 'novaRing', 'iceWall'], speedMult: 1.12, cooldownMult: 0.82 },
      { at: 0.28, patterns: ['spearVolley', 'blink', 'novaRing', 'iceWall'], speedMult: 1.28, cooldownMult: 0.6, enrage: true },
    ],
    patternCooldown: [1.0, 1.5],
    patterns: {
      spear:      { kind: 'aimedVolley', telegraph: 0.55, count: 3, spread: 0.16, projSpeed: 470, dmg: 11, status: { kind: 'chill', stacks: 2 } },
      spearVolley:{ kind: 'aimedVolley', telegraph: 0.5, count: 5, spread: 0.34, projSpeed: 500, dmg: 11, status: { kind: 'chill', stacks: 2 }, waves: 2, waveGap: 0.3 },
      blink:      { kind: 'blink', telegraph: 0.34, dmg: 14, radius: 130 },
      novaRing:   { kind: 'ringBurst', telegraph: 0.7, count: 20, projSpeed: 250, dmg: 9, waves: 3, waveGap: 0.36, rotate: 0.16, status: { kind: 'chill', stacks: 1 } },
      iceWall:    { kind: 'summon', telegraph: 0.66, spawn: [{ id: 'lancer', n: 2 }] },
    },
  },
  {
    id: 'stormtyrant',
    name: '폭풍 폭군 카르',
    title: '마지막 회랑의 왕',
    hp: 2700, radius: 44, speed: 126, gold: 90,
    color: '#7b5ad6', accent: '#ffe36b',
    contactDmg: 18,
    phases: [
      { at: 1.0, patterns: ['slam', 'aimedVolley', 'charge'] },
      { at: 0.68, patterns: ['slam', 'aimedVolley', 'charge', 'ringBurst', 'summon'], speedMult: 1.1, cooldownMult: 0.84 },
      { at: 0.38, patterns: ['slam', 'aimedVolley', 'chargeTriple', 'ringBurst', 'summon'], speedMult: 1.24, cooldownMult: 0.66 },
      { at: 0.15, patterns: ['slam', 'ringBurst', 'chargeTriple', 'aimedVolley'], speedMult: 1.42, cooldownMult: 0.5, enrage: true },
    ],
    patternCooldown: [0.95, 1.4],
    patterns: {
      slam:        { kind: 'slam', telegraph: 0.6, radius: 215, dmg: 19, shake: 'BOSS_SLAM', status: { kind: 'shock', stacks: 1 } },
      charge:      { kind: 'charge', telegraph: 0.5, speed: 860, time: 0.6, dmg: 20 },
      chargeTriple:{ kind: 'charge', telegraph: 0.42, speed: 900, time: 0.42, dmg: 17, repeats: 3, repeatGap: 0.22 },
      aimedVolley: { kind: 'aimedVolley', telegraph: 0.48, count: 4, spread: 0.42, projSpeed: 520, dmg: 12, status: { kind: 'shock', stacks: 1 } },
      ringBurst:   { kind: 'ringBurst', telegraph: 0.62, count: 18, projSpeed: 300, dmg: 11, waves: 3, waveGap: 0.3, rotate: -0.2 },
      summon:      { kind: 'summon', telegraph: 0.66, spawn: [{ id: 'warden', n: 2 }, { id: 'bomber', n: 2 }] },
    },
  },
];

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));

// ============================================================
// 구역(biome) 정의 — 색조와 등장 적 풀
// ============================================================
export const BIOMES = [
  {
    id: 'emberhall', name: '잿불의 회랑',
    floor: '#241c1a', wall: '#3a2c27', accent: '#ff8b4a', fog: '#160f0e',
    pool: ['husk', 'cinderling', 'bolter'],
    boss: 'ashwarden',
    miniboss: 'emberpriest',
    budget: [7.0, 9.5], // 방당 스폰 예산(적 코스트 합)
  },
  {
    id: 'frostvault', name: '서리 지하묘',
    floor: '#1a2028', wall: '#27333f', accent: '#7fd8ff', fog: '#0d1218',
    pool: ['husk', 'cinderling', 'bolter', 'bulwark', 'splitter', 'bomber', 'bonecaller'],
    boss: 'frostqueen',
    miniboss: 'frostwarden',
    budget: [10.0, 13.0],
  },
  {
    id: 'stormspire', name: '폭풍의 첨탑',
    floor: '#1d1a2a', wall: '#2b2740', accent: '#c07bff', fog: '#100e18',
    pool: ['cinderling', 'bolter', 'bulwark', 'splitter', 'bomber', 'lancer', 'warden', 'bonecaller'],
    boss: 'stormtyrant',
    miniboss: 'stormherald',
    budget: [13.0, 17.0],
  },
];

/** 스폰 예산 계산용 적 코스트 */
export const ENEMY_COST = {
  cinderling: 0.55, husk: 1.0, bolter: 1.1, bomber: 1.2,
  splitter: 1.6, bulwark: 2.0, lancer: 1.9, warden: 2.0, bonecaller: 2.2, splitterling: 0,
};
