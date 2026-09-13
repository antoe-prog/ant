// 보유 권능 목록 → 실제 전투에 쓰이는 파생 스탯/훅 묶음으로 컴파일.
// 권능을 얻거나 강화할 때마다 rebuild 한다. (전투 루프 중엔 재계산하지 않음)

import { ANY_BOON_BY_ID, scaleValues, DUO_BOONS } from '../data/boons.js';
import { RARITY } from '../data/balance.js';

export function emptyLoadout() {
  return {
    stats: {
      damageMult: 1,
      attackSpeed: 1,
      moveMult: 1,
      critChance: 0,
      critMult: 0,
      maxHpBonus: 0,
      focusRegen: 0,
      dashCharges: 0,
      damageTakenMult: 1,
    },
    mods: {
      burnMult: 0,
      bleedMult: 0,
      dashCooldownMult: 1,
      specialCostMult: 1,
      dashStrikeMult: 0,
      dashStrikeWindow: 0,
      // 사령술
      minionDamage: 0,
      raiseBonus: 0,      // 망자 봉기가 한 번에 더 일으키는 시체 수
      minionSwap: {},     // 소환수 종류 교체 (원래 id → 바꿀 id)
      giantMerge: 0,      // 망자 봉기가 시체를 합쳐 거인을 만든다 (합칠 최대 수)
      minionHp: 0,
      minionLife: 0,
      corpseRadius: 0,
      archerChance: 0,
    },
    attackStatus: [],
    specialStatus: [],
    minionStatus: [],   // 소환수 타격이 부여하는 상태이상
    on: {
      hit: [], kill: [], dashStart: [], dashTrail: [], dashEnd: [],
      special: [], hurt: [], roomClear: [], modifyDamage: [], statusApplied: [],
      attackStep: [],   // 콤보의 특정 단계가 발동할 때 (무기 전용 권능의 연결점)
      dashStrike: [],   // 대시 직후 강타가 적중했을 때
      summon: [],       // 소환수를 불렀을 때
      minionDeath: [],  // 소환수가 스러졌을 때
      corpse: [],       // 시체가 생겼을 때
      corpseExpire: [], // 시체가 자연 소멸했을 때
      tick: [],         // 매 시뮬레이션 틱 (밟고 지나가는 상호작용용, 보통 비어 있다)
    },
  };
}

/**
 * owned: [{ id, rarity, level }]
 * metaEffects: 메타 업그레이드 결과 {damageMult, moveMult, maxHp, dashCharges, ...}
 */
export function buildLoadout(owned, metaEffects = {}) {
  const L = emptyLoadout();

  for (const o of owned) {
    const def = ANY_BOON_BY_ID[o.id];
    if (!def) continue;
    const rarityMult = RARITY[o.rarity]?.mult ?? 1;
    const v = scaleValues(def, rarityMult, o.level);
    try {
      def.apply(L, v);
    } catch (err) {
      console.error('boon apply 실패:', o.id, err);
    }
  }

  // 메타(영구) 강화 적용
  if (metaEffects.damageMult) L.stats.damageMult *= metaEffects.damageMult;
  if (metaEffects.moveMult) L.stats.moveMult *= metaEffects.moveMult;
  if (metaEffects.maxHp) L.stats.maxHpBonus += metaEffects.maxHp;
  if (metaEffects.dashCharges) L.stats.dashCharges += metaEffects.dashCharges;

  return L;
}

/** 보유 신 집합 (합일 권능 해금 판정용) */
export function godsOwned(owned) {
  const set = new Set();
  for (const o of owned) {
    const def = ANY_BOON_BY_ID[o.id];
    if (def && def.god && def.god !== 'none') set.add(def.god);
    if (def && def.gods) for (const g of def.gods) set.add(g);
  }
  return set;
}

/**
 * 현재 보유 권능으로 해금된 합일 권능 목록.
 *
 * 조건은 두 가지를 쓸 수 있다:
 *  - gods:     해당 신의 권능을 하나라도 가지고 있어야 한다 (계열 합일)
 *  - requires: 지정한 권능을 반드시 가지고 있어야 한다 (분기 전용 합일)
 * 분기 전용 합일 덕분에 초반에 고른 갈래가 후반까지 이어진다.
 */
export function availableDuos(owned) {
  const gods = godsOwned(owned);
  const ownedIds = new Set(owned.map((o) => o.id));
  return DUO_BOONS.filter((d) => {
    if (ownedIds.has(d.id)) return false;
    if (d.gods && !d.gods.every((g) => gods.has(g))) return false;
    if (d.requires && !d.requires.every((id) => ownedIds.has(id))) return false;
    return true;
  });
}

/** 슬롯 점유 상태 (attack/dash/special 은 1개 제한) */
export function slotsUsed(owned) {
  const used = {};
  for (const o of owned) {
    const def = ANY_BOON_BY_ID[o.id];
    if (!def) continue;
    if (def.slot !== 'passive') used[def.slot] = o.id;
  }
  return used;
}
