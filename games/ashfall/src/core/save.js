// 영구 저장(메타 진행). 버전 + 마이그레이션 + 손상 대응.
// 세이브 구조가 바뀌어도 기존 플레이어의 진행이 날아가지 않도록 한다.

import { SAVE_VERSION, META } from '../data/balance.js';

const KEY = 'ashfall.save';

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    ash: 0,
    upgrades: {},          // { upgradeId: level }
    stats: { runs: 0, wins: 0, kills: 0, bestTime: null, deepest: '1-1' },
    lastWeapon: 'emberblade',
    seen: {},              // 처음 본 권능/적 (도감 확장 여지)
  };
}

/** 구버전 → 현재 버전 마이그레이션 */
function migrate(data) {
  const d = { ...defaultSave(), ...data };
  d.upgrades = { ...(data.upgrades || {}) };
  d.stats = { ...defaultSave().stats, ...(data.stats || {}) };

  // v1: ash 대신 'dust' 를 쓰던 시절
  if (data.version < 2 && typeof data.dust === 'number') d.ash = data.dust;
  // v2 → v3: 사라진 업그레이드 ID 정리 + 레벨 상한 보정
  if (data.version < 3) {
    const valid = new Set(META.UPGRADES.map((u) => u.id));
    for (const k of Object.keys(d.upgrades)) if (!valid.has(k)) delete d.upgrades[k];
  }
  for (const u of META.UPGRADES) {
    if (d.upgrades[u.id] != null) d.upgrades[u.id] = Math.min(u.max, Math.max(0, Math.floor(d.upgrades[u.id])));
  }
  d.version = SAVE_VERSION;
  return d;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || typeof data.version !== 'number') {
      console.warn('세이브 형식이 올바르지 않아 새로 시작합니다.');
      return defaultSave();
    }
    if (data.version === SAVE_VERSION) return migrate(data);
    return migrate(data);
  } catch (err) {
    console.warn('세이브 손상 — 백업 후 초기화합니다.', err);
    try { localStorage.setItem(KEY + '.corrupt', localStorage.getItem(KEY) || ''); } catch {}
    return defaultSave();
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch (err) {
    console.warn('세이브 실패', err);
    return false;
  }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch {}
  return defaultSave();
}

/** 메타 업그레이드 레벨 → 실제 효과 합산 */
export function metaEffects(save) {
  const out = { maxHp: 0, damageMult: 1, moveMult: 1, roomHeal: 0, luck: 0, dashCharges: 0, revives: 0 };
  for (const u of META.UPGRADES) {
    const lv = save.upgrades[u.id] || 0;
    if (!lv) continue;
    const e = u.effect(lv);
    if (e.maxHp) out.maxHp += e.maxHp;
    if (e.damageMult) out.damageMult *= e.damageMult;
    if (e.moveMult) out.moveMult *= e.moveMult;
    if (e.roomHeal) out.roomHeal += e.roomHeal;
    if (e.luck) out.luck += e.luck;
    if (e.dashCharges) out.dashCharges += e.dashCharges;
    if (e.revives) out.revives += e.revives;
  }
  return out;
}

export function upgradeCost(save, u) {
  const lv = save.upgrades[u.id] || 0;
  if (lv >= u.max) return null;
  return u.cost(lv);
}

export function buyUpgrade(save, id) {
  const u = META.UPGRADES.find((x) => x.id === id);
  if (!u) return false;
  const cost = upgradeCost(save, u);
  if (cost == null || save.ash < cost) return false;
  save.ash -= cost;
  save.upgrades[u.id] = (save.upgrades[u.id] || 0) + 1;
  writeSave(save);
  return true;
}
