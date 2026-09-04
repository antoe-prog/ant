// 무기 데이터.
// combo step: windup(선딜) → active(판정) → recover(후딜)
//  - move: 단계별 이동 가능 비율 {windup, active, recover}. 0 = 완전 정지.
//    핵앤슬래시는 "때리면서 움직일 수 있어야" 성립한다. 후딜에서 특히 풀어준다.
//  - lunge: 단계 시작 시 전방 추진력(px/s)
//  - heavy: 큰 타격(히트스톱/셰이크/사운드 강화)
//
// 후딜은 대시로 캔슬할 수 있다(공수 전환의 기본기).

export const WEAPONS = [
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
