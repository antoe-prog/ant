// 무기 데이터. 각 무기는 "손맛(리듬)"이 서로 달라야 한다.
// combo step: windup(선딜) → active(판정) → recover(후딜)
//  - move: 단계별 이동 가능 비율 {windup, active, recover}. 0 = 완전 정지.
//    핵앤슬래시는 "때리면서 움직일 수 있어야" 성립한다. 후딜에서 특히 풀어준다.
//  - lunge: 단계 시작 시 전방 추진력(px/s)
//  - heavy: 큰 타격(히트스톱/셰이크/사운드 강화)
//
// 모든 무기는 후딜을 대시로 캔슬할 수 있다(공수 전환의 기본기).
// dashCancel: true 인 무기는 판정 중에도 캔슬 가능하다.

export const WEAPONS = [
  {
    id: 'emberblade',
    name: '잿불검',
    tagline: '균형 잡힌 3연격. 마지막 타격이 적을 크게 밀어낸다.',
    traits: ['사거리가 길어 안전하게 싸운다', '후딜을 대시로 캔슬', '전용 권능: 참수 · 검압'],
    color: '#ff8b4a',
    moveMult: 1.0,
    critBonus: 0.03,
    combo: [
      { windup: 0.065, active: 0.06, recover: 0.10, dmg: 16, arc: 100, range: 86, knock: 130, move: { windup: 0.60, active: 0.50, recover: 0.85 }, lunge: 210, hitstop: 'LIGHT' },
      { windup: 0.060, active: 0.06, recover: 0.11, dmg: 18, arc: 115, range: 88, knock: 150, move: { windup: 0.60, active: 0.50, recover: 0.85 }, lunge: 230, hitstop: 'LIGHT' },
      { windup: 0.115, active: 0.09, recover: 0.20, dmg: 30, arc: 215, range: 108, knock: 420, move: { windup: 0.32, active: 0.25, recover: 0.60 }, lunge: 300, hitstop: 'HEAVY', heavy: true },
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
    traits: ['슈퍼아머: 휘두르는 중 피해 40% 감소', '2타는 360° 광역', '전용 권능: 지진 · 철벽'],
    color: '#c9a227',
    moveMult: 0.9,
    critBonus: 0,
    superArmor: true,      // 공격 중 넉백 저항 + 피해 경감
    superArmorReduce: 0.4, // 휘두르는 동안 받는 피해 40% 감소
    combo: [
      { windup: 0.22, active: 0.10, recover: 0.20, dmg: 36, arc: 150, range: 104, knock: 330, move: { windup: 0.50, active: 0.30, recover: 0.70 }, lunge: 160, hitstop: 'HEAVY', heavy: true },
      { windup: 0.30, active: 0.12, recover: 0.30, dmg: 54, arc: 360, range: 128, knock: 480, move: { windup: 0.34, active: 0.15, recover: 0.55 }, lunge: 90,  hitstop: 'HEAVY', heavy: true, shockwave: true },
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
    tagline: '4연타의 폭풍. 붙어서 계속 때릴수록 강해진다.',
    traits: [
      '가속: 연속 적중마다 피해 +4.5% (최대 +55%), 피격 시 초기화',
      '대시 충전 +1, 처치 시 대시 즉시 회복',
      '마무리 적중 → 대시 강타 재개방 (콤보 순환)',
      '전용 권능: 연격 · 그림자 일격',
    ],
    color: '#63e6be',
    moveMult: 1.15,
    critBonus: 0.08,
    dashCharges: 1,              // 기동력이 곧 생존력인 무기
    dashCancel: true,            // 적중 확인 후 판정 중에도 대시로 취소 가능
    dashStrikeMult: 1.9,         // 대시 직후 강타 배율
    dashStrikeOnFinisher: 0.6,   // 마무리 타가 적중하면 대시 강타가 다시 열린다
                                 // → 콤보 → 마무리 → 대시 → 강타 → 콤보 의 순환 루프
    dashOnKill: 1,               // 처치 시 대시 충전 즉시 회복 — 사거리가 짧은 대가를
                                 // '많이 죽인다'는 강점으로 되갚는 생존 장치
    // 가속(ramp): 연속 적중할수록 피해가 오르고 피격하면 초기화된다.
    // "붙어서 계속 때린다"는 플레이를 보상하고, 한 대 맞으면 대가를 치른다.
    rampPerHit: 0.045,
    rampMax: 0.55,
    rampDecay: 1.6,              // 이 시간 동안 때리지 않으면 서서히 풀린다
    rampArmor: 0.3,              // 가속이 높을수록 받는 피해도 감소 (최대 -30%)
                                 // 짧은 사거리로 붙어 있는 대가를 같은 루프로 보상한다
    dashIframeBonus: 0.06,       // 대시 무적이 조금 더 길다
    combo: [
      { windup: 0.036, active: 0.05, recover: 0.050, dmg: 11, arc: 135, range: 88, knock: 60,  move: { windup: 0.85, active: 0.75, recover: 0.95 }, lunge: 190, hitstop: 'LIGHT' },
      { windup: 0.032, active: 0.05, recover: 0.050, dmg: 11, arc: 135, range: 88, knock: 60,  move: { windup: 0.85, active: 0.75, recover: 0.95 }, lunge: 190, hitstop: 'LIGHT' },
      { windup: 0.038, active: 0.05, recover: 0.060, dmg: 14, arc: 150, range: 92, knock: 90,  move: { windup: 0.80, active: 0.70, recover: 0.92 }, lunge: 220, hitstop: 'LIGHT' },
      { windup: 0.070, active: 0.07, recover: 0.135, dmg: 24, arc: 250, range: 102, knock: 260, move: { windup: 0.55, active: 0.45, recover: 0.80 }, lunge: 280, hitstop: 'HEAVY', heavy: true },
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
  {
    id: 'gravecall',
    name: '강령장',
    tagline: '느리지만 사거리가 길다. 적을 눕히고, 그 시체를 다시 일으킨다.',
    traits: [
      '처치 시 30% 확률로 망령이 자동으로 일어난다',
      '주변 시체 1구당 공격속도 +6% (최대 +36%)',
      '특수기: 주변 시체를 전부 해골 병사로 일으킨다',
      '전용 권능: 대군 · 죽음의 손아귀',
    ],
    color: '#9d7fd8',
    moveMult: 0.95,
    critBonus: 0.02,
    summonOnKill: { id: 'wraith', chance: 0.3 },
    corpseHaste: { perCorpse: 0.06, max: 0.36, radius: 260 },
    combo: [
      { windup: 0.11, active: 0.07, recover: 0.14, dmg: 21, arc: 130, range: 112, knock: 170, move: { windup: 0.55, active: 0.45, recover: 0.85 }, lunge: 180, hitstop: 'LIGHT' },
      { windup: 0.10, active: 0.07, recover: 0.15, dmg: 23, arc: 140, range: 116, knock: 190, move: { windup: 0.55, active: 0.45, recover: 0.85 }, lunge: 190, hitstop: 'LIGHT' },
      { windup: 0.17, active: 0.10, recover: 0.24, dmg: 38, arc: 260, range: 132, knock: 380, move: { windup: 0.35, active: 0.28, recover: 0.62 }, lunge: 240, hitstop: 'HEAVY', heavy: true },
    ],
    comboWindow: 0.48,
    special: {
      kind: 'raiseDead',
      name: '망자 봉기',
      cost: 34,
      cooldown: 1.2,
      radius: 300,
      minion: 'skeleton',
      maxRaise: 3,
      fallbackDmg: 46,      // 시체가 없으면 대신 영혼 파동을 터뜨린다
      fallbackRadius: 175,
      desc: '주변 시체를 해골 병사로 일으킨다. 시체가 없으면 영혼 파동을 터뜨린다.',
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
