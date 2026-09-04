// ============================================================
// 모든 밸런스 수치의 단일 출처(SSOT).
// 코드 수정 없이 이 파일만 고쳐 튜닝할 수 있어야 한다.
// ============================================================

export const SIM = {
  TICK_HZ: 60,
  DT: 1 / 60,
  MAX_FRAME_STEPS: 5, // 프레임 스파이크 시 따라잡기 상한 (죽음의 나선 방지)
};

export const ARENA = {
  WIDTH: 1200,
  HEIGHT: 780,
  WALL_PAD: 34,
};

export const VIEW = {
  WIDTH: 960,
  HEIGHT: 540,
};

export const PLAYER = {
  RADIUS: 15,
  MAX_HP: 120,
  MAX_FOCUS: 100,
  FOCUS_REGEN: 7.5,          // 초당
  FOCUS_ON_HIT: 3.2,         // 타격당
  MOVE_SPEED: 268,           // px/s
  ACCEL: 3400,
  FRICTION: 12,
  DASH_SPEED: 780,
  DASH_TIME: 0.155,
  DASH_IFRAMES: 0.24,        // 대시 시작부터 무적 지속
  DASH_COOLDOWN: 0.42,
  DASH_CHARGES: 2,
  DASH_RECHARGE: 1.05,       // 충전 1개 회복 시간
  HURT_IFRAMES: 0.62,        // 피격 후 무적
  HURT_KNOCKBACK: 210,
  CRIT_MULT: 1.9,
  BASE_CRIT: 0.05,
  CONTACT_GRACE: 0.35,       // 적 접촉 데미지 재적용 간격
};

// 입력 버퍼: 이 시간 안에 누른 키는 조건이 갖춰지는 즉시 발동한다.
// 짧게 톡 누른 입력이 프레임 사이에서 사라지는 것을 막는다.
export const INPUT_BUFFER = 0.18;

export const HITSTOP = {
  LIGHT: 0.028,
  HEAVY: 0.075,
  KILL: 0.055,
  BOSS_KILL: 0.34,
  PLAYER_HURT: 0.09,
};

export const SHAKE = {
  LIGHT: 2.4,
  HEAVY: 7.0,
  KILL: 4.0,
  EXPLOSION: 9.0,
  PLAYER_HURT: 11.0,
  BOSS_SLAM: 14.0,
};

// ---- 상태이상 ----
export const STATUS = {
  burn:  { duration: 3.2, tickRate: 0.4, dmgPerStack: 2.6, maxStacks: 8, color: '#ff7a3c' },
  chill: { duration: 2.6, slowPerStack: 0.09, maxStacks: 5, color: '#7fd8ff' },
  // chill 최대 중첩 도달 시 frozen 으로 전환
  // 빙결은 기본적으로 추가 피해를 받는다 (냉기 빌드의 기본 보상)
  frozen:{ duration: 1.15, shatterBonus: 1.35, color: '#bff0ff' },
  shock: { duration: 4.0, maxStacks: 4, chainRange: 190, color: '#ffe36b' },
  bleed: { duration: 4.5, tickRate: 0.5, dmgPerStack: 2.0, maxStacks: 10, color: '#ff4d6d' },
};

// 플레이어가 받는 상태이상 — 적의 정체성을 만들고 "맞으면 다음 회피가 어려워진다"는 압박을 만든다
export const PLAYER_STATUS = {
  chill: { duration: 2.2, slow: 0.32, color: '#7fd8ff' },   // 이동속도 감소
  shock: { duration: 3.0, focusRegen: 0.4, color: '#ffe36b' }, // 집중 회복 감소
};

// ---- 런 구조 (10~20분 목표) ----
export const RUN = {
  BIOMES: 3,
  ROOMS_PER_BIOME: 5,        // 마지막이 보스방
  // 방 난이도 곡선: 전역 방 인덱스 기반 승수
  DIFFICULTY_PER_ROOM: 0.105,
  DIFFICULTY_PER_BIOME: 0.47,
  ELITE_CHANCE_BASE: 0.16,
  ELITE_CHANCE_PER_BIOME: 0.1,
  MINIBOSS_CHANCE: 0.45,     // 구역당 최대 1회, 중반에 등장
  GOLD_PER_ROOM: [12, 22],
  HEAL_ROOM_AMOUNT: 28,
  BOSS_HEAL: 34,
};

// 보상 종류별 등장 가중치
export const REWARD_WEIGHTS = {
  boon: 52,
  gold: 12,
  heal: 14,
  maxhp: 8,
  weaponUpgrade: 8,
  shop: 8,
};

// 저주(엘리트 방 선택지): 위험↑ 보상↑
export const CURSES = [
  { id: 'frenzy',  name: '광기의 인장', desc: '적 이동/공격속도 +25%', enemySpeed: 1.25, rewardBoost: 1 },
  { id: 'iron',    name: '무쇠의 인장', desc: '적 체력 +45%', enemyHp: 1.45, rewardBoost: 1 },
  { id: 'venom',   name: '독아의 인장', desc: '적 피해량 +35%', enemyDmg: 1.35, rewardBoost: 1 },
  { id: 'swarm',   name: '군세의 인장', desc: '적 수 +40%', enemyCount: 1.4, rewardBoost: 1 },
  { id: 'fragile', name: '유리의 인장', desc: '받는 피해 +30%, 주는 피해 +20%', playerTaken: 1.3, playerDealt: 1.2, rewardBoost: 2 },
];

// ---- 희귀도 ----
export const RARITY = {
  common:    { id: 'common',    name: '일반',   mult: 1.00, weight: 100, color: '#c8d2dc' },
  rare:      { id: 'rare',      name: '희귀',   mult: 1.35, weight: 42,  color: '#5ad0ff' },
  epic:      { id: 'epic',      name: '서사',   mult: 1.75, weight: 15,  color: '#c07bff' },
  legendary: { id: 'legendary', name: '전설',   mult: 2.30, weight: 4,   color: '#ffc94d' },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

// 보상 희귀도 가중치에 곱해지는 보너스(저주/유물 등)
export const RARITY_LUCK_STEP = 0.55;

// ---- 적 스케일링 ----
export const ENEMY_SCALE = {
  HP_PER_DIFFICULTY: 0.62,
  DMG_PER_DIFFICULTY: 0.38,
  ELITE_HP: 2.6,
  ELITE_DMG: 1.45,
  ELITE_SCALE: 1.28,     // 크기
  ELITE_GOLD: 3,
};

// ---- 상점 ----
export const SHOP = {
  BOON_COST: [55, 85],
  HEAL_COST: 40,
  HEAL_AMOUNT: 40,
  MAXHP_COST: 70,
  MAXHP_AMOUNT: 15,
  REROLL_COST: 25,
};

// ---- 메타 진행(영구 강화) ----
export const META = {
  ASH_PER_ROOM: 3,
  ASH_PER_BOSS: 25,
  ASH_PER_BIOME: 10,
  UPGRADES: [
    { id: 'vigor',    name: '불굴',       desc: '시작 최대 체력 +12',       max: 5, cost: (l) => 30 + l * 25, effect: (l) => ({ maxHp: 12 * l }) },
    { id: 'edge',     name: '예리함',     desc: '피해량 +5%',               max: 5, cost: (l) => 35 + l * 30, effect: (l) => ({ damageMult: 1 + 0.05 * l }) },
    { id: 'swift',    name: '질풍',       desc: '이동속도 +4%',             max: 3, cost: (l) => 40 + l * 35, effect: (l) => ({ moveMult: 1 + 0.04 * l }) },
    { id: 'lifeline', name: '생명선',     desc: '방 클리어 시 체력 +2',     max: 3, cost: (l) => 45 + l * 40, effect: (l) => ({ roomHeal: 2 * l }) },
    { id: 'fortune',  name: '행운',       desc: '권능 희귀도 상승',         max: 3, cost: (l) => 60 + l * 55, effect: (l) => ({ luck: l }) },
    { id: 'reserve',  name: '예비 대시',  desc: '대시 충전 +1',             max: 1, cost: () => 120,          effect: (l) => ({ dashCharges: l }) },
    { id: 'defiance', name: '항거',       desc: '런당 1회 부활(체력 40%)',  max: 1, cost: () => 200,          effect: (l) => ({ revives: l }) },
  ],
};

export const SAVE_VERSION = 3;
