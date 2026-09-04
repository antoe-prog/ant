// 무기 데이터. 각 무기는 "손맛(리듬)"이 서로 달라야 한다.
// combo step: windup(선딜) → active(판정) → recover(후딜)
//  - moveScale: 해당 단계에서 이동 가능 비율 (0 = 완전 정지)
//  - lunge: 단계 시작 시 전방 추진력(px/s)
//  - heavy: 큰 타격(히트스톱/셰이크/사운드 강화)

export const WEAPONS = [
  {
    id: 'emberblade',
    name: '잿불검',
    tagline: '균형 잡힌 3연격. 마지막 타격이 적을 크게 밀어낸다.',
    color: '#ff8b4a',
    moveMult: 1.0,
    critBonus: 0.03,
    combo: [
      { windup: 0.065, active: 0.06, recover: 0.10, dmg: 16, arc: 100, range: 84, knock: 130, moveScale: 0.42, lunge: 210, hitstop: 'LIGHT' },
      { windup: 0.060, active: 0.06, recover: 0.11, dmg: 18, arc: 115, range: 86, knock: 150, moveScale: 0.42, lunge: 230, hitstop: 'LIGHT' },
      { windup: 0.115, active: 0.09, recover: 0.20, dmg: 30, arc: 215, range: 106, knock: 420, moveScale: 0.18, lunge: 300, hitstop: 'HEAVY', heavy: true },
    ],
    comboWindow: 0.42, // 후딜 후 이 시간 안에 다시 치면 콤보 유지
    special: {
      kind: 'dashSlash',
      name: '잿불 관통',
      cost: 30,
      cooldown: 0.9,
      dmg: 44,
      range: 300,
      width: 46,
      speed: 1150,
      desc: '전방으로 돌진하며 일직선상의 적을 모두 베어낸다. 돌진 중 무적.',
    },
  },
  {
    id: 'ruinmaul',
    name: '파쇄추',
    tagline: '느리지만 한 방이 무겁다. 휘두르는 동안 밀리지 않는다.',
    color: '#c9a227',
    moveMult: 0.9,
    critBonus: 0,
    superArmor: true, // 공격 중 넉백 저항
    combo: [
      { windup: 0.22, active: 0.10, recover: 0.20, dmg: 36, arc: 150, range: 100, knock: 330, moveScale: 0.25, lunge: 160, hitstop: 'HEAVY', heavy: true },
      { windup: 0.30, active: 0.12, recover: 0.30, dmg: 54, arc: 360, range: 118, knock: 480, moveScale: 0.10, lunge: 90,  hitstop: 'HEAVY', heavy: true, shockwave: true },
    ],
    comboWindow: 0.55,
    special: {
      kind: 'groundSlam',
      name: '대지 붕괴',
      cost: 40,
      cooldown: 1.4,
      dmg: 62,
      radius: 168,
      chargeTime: 0.42,
      desc: '도약 후 내리찍어 광역 충격파를 일으킨다. 차징 중 무적.',
    },
  },
  {
    id: 'twinfangs',
    name: '쌍아검',
    tagline: '4연타의 폭풍. 대시 직후의 첫 타가 치명적으로 꽂힌다.',
    color: '#63e6be',
    moveMult: 1.1,
    critBonus: 0.08,
    dashCancel: true,      // 후딜을 대시로 취소 가능
    dashStrikeMult: 1.75,  // 대시 직후 첫 타 배율
    combo: [
      { windup: 0.045, active: 0.05, recover: 0.055, dmg: 10, arc: 90,  range: 70, knock: 60,  moveScale: 0.65, lunge: 190, hitstop: 'LIGHT' },
      { windup: 0.040, active: 0.05, recover: 0.055, dmg: 10,  arc: 90,  range: 70, knock: 60,  moveScale: 0.65, lunge: 190, hitstop: 'LIGHT' },
      { windup: 0.045, active: 0.05, recover: 0.065, dmg: 12, arc: 105, range: 74, knock: 90,  moveScale: 0.60, lunge: 220, hitstop: 'LIGHT' },
      { windup: 0.080, active: 0.07, recover: 0.150, dmg: 22, arc: 170, range: 84, knock: 260, moveScale: 0.35, lunge: 280, hitstop: 'HEAVY', heavy: true },
    ],
    comboWindow: 0.34,
    special: {
      kind: 'whirl',
      name: '피의 회전',
      cost: 34,
      cooldown: 1.0,
      dmg: 13,          // 틱당
      tickRate: 0.13,
      duration: 1.05,
      radius: 96,
      moveScale: 0.72,
      desc: '주위를 회전 베기로 갈아버린다. 지속 중에도 이동 가능.',
    },
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** 무기 각인(런 내 보상) 단계별 배율 */
export const WEAPON_UPGRADE = {
  MAX_LEVEL: 4,
  DMG_PER_LEVEL: 0.14,
  names: ['', '각인 I', '각인 II', '각인 III', '각인 IV'],
};
