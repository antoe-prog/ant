// ============================================================
// 시체(Corpse)와 소환수(Minion) 데이터.
//
// 설계 의도:
//  - 시체는 "위치를 가진 소모성 자원"이다. 적이 죽은 자리에 남고 시간이 지나면 사라진다.
//    → 어디서 싸울지, 언제 회수할지가 선택이 된다.
//  - 소환수는 숫자가 아니라 "전장의 구성"을 바꾼다. 탄을 막고 적을 붙잡는다.
//  - 적 '시체 술사'도 같은 시체를 노린다 → 자원 경쟁이 생긴다.
// ============================================================

export const CORPSE = {
  LIFETIME: 11,          // 시체 지속 시간(초)
  FADE: 2.2,             // 사라지기 전 깜빡이는 시간
  MAX: 40,               // 성능 상한 (초과 시 가장 오래된 것부터 제거)
  ELITE_SCALE: 1.5,      // 엘리트 시체는 더 크고 더 강한 소환수가 된다
  BOSS_SCALE: 2.4,
  RAISE_RADIUS: 150,     // 시체를 일으킬 수 있는 기본 반경
  HARVEST_RADIUS: 46,    // 지나가며 흡수하는 반경
};

export const MINIONS = [
  {
    id: 'wraith',
    name: '망령',
    hp: 26, dmg: 11, speed: 232, radius: 11,
    life: 12,                 // 지속 시간(초)
    attackCd: 0.62,
    color: '#9d7fd8', accent: '#d9c6ff',
    kind: 'melee',
    blocksProjectiles: false,
    desc: '빠르게 달려들어 적을 물어뜯는다',
  },
  {
    id: 'skeleton',
    name: '해골 병사',
    hp: 58, dmg: 15, speed: 148, radius: 15,
    life: 18,
    attackCd: 0.85,
    color: '#c9c2ae', accent: '#efe7d2',
    kind: 'melee',
    blocksProjectiles: true,   // 몸으로 탄을 막는다 — 진짜 방패 역할
    desc: '느리지만 단단하고, 적의 탄을 몸으로 막는다',
  },
  {
    id: 'bonearcher',
    name: '뼈 궁수',
    hp: 30, dmg: 13, speed: 132, radius: 12,
    life: 15,
    attackCd: 1.05,
    range: 330,
    projSpeed: 560,
    color: '#a8b3a0', accent: '#dff0d8',
    kind: 'ranged',
    blocksProjectiles: false,
    desc: '거리를 두고 뼈 화살을 쏜다',
  },
];

export const MINION_BY_ID = Object.fromEntries(MINIONS.map((m) => [m.id, m]));

export const MINION_RULES = {
  BASE_MAX: 3,           // 기본 최대 소환수 (권능으로 증가)
  HARD_CAP: 9,           // 화면 가독성/성능 상한 — 이 이상은 늘지 않는다
  LEASH: 460,            // 플레이어에게서 이만큼 멀어지면 되돌아온다
  SEEK_RANGE: 520,       // 적을 찾는 범위
  CONTACT_CD: 0.5,       // 적과 몸이 닿았을 때 서로 피해를 주는 간격
  ENEMY_DMG_TO_MINION: 0.55, // 소환수가 받는 피해 배율 (너무 쉽게 녹지 않도록)
  SUMMON_INVULN: 0.35,   // 소환 직후 무적(솟아오르는 연출 동안)
  EXPIRE_FADE: 1.2,

  // ---- 소환수 명령 ----
  // 소환수가 알아서 싸우기만 하면 플레이어의 선택이 없다.
  // "여기를 쳐라"를 지정할 수 있어야 소환 빌드가 조작 가능한 시스템이 된다.
  COMMAND_CD: 6.0,
  COMMAND_DURATION: 3.6,
  COMMAND_RADIUS: 230,     // 이 반경 안의 적을 최우선으로 노린다
  COMMAND_SPEED: 1.4,      // 명령 중 이동속도 배율
  COMMAND_DAMAGE: 1.3,     // 명령 중 피해 배율
  COMMAND_RANGE: 420,      // 명령 지점을 찍을 수 있는 최대 거리
};
