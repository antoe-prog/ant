// ============================================================
// 전투 파이프라인: 피해 계산 · 상태이상 · 권능 훅 실행.
// 표현(연출)은 전부 EventBus 로 내보내고, 여기서는 상태만 바꾼다.
// ============================================================

import { STATUS, PLAYER_STATUS, PLAYER, HITSTOP, SHAKE, ENEMY_SCALE } from '../data/balance.js';
import { EV } from '../core/events.js';
import { dist2, TAU, normalize } from '../core/math.js';

const MAX_HOOK_DEPTH = 4; // 권능 연쇄가 무한 재귀하지 않도록

// ---------------- 상태이상 ----------------

export function applyStatus(world, target, kind, stacks = 1) {
  if (!target || target.dead || stacks <= 0) return;
  const cfg = STATUS[kind];
  if (!cfg) return;
  if (!target.status) target.status = {};

  if (kind === 'chill') {
    if (target.status.frozen) return; // 이미 빙결
    const s = target.status.chill || (target.status.chill = { stacks: 0, time: 0 });
    s.stacks = Math.min(cfg.maxStacks, s.stacks + stacks);
    s.time = cfg.duration;
    if (s.stacks >= cfg.maxStacks) {
      delete target.status.chill;
      target.status.frozen = { time: STATUS.frozen.duration, stacks: 1 };
      world.bus.emit(EV.STATUS, { x: target.x, y: target.y, kind: 'frozen' });
    }
  } else {
    const s = target.status[kind] || (target.status[kind] = { stacks: 0, time: 0, tickTimer: 0 });
    s.stacks = Math.min(cfg.maxStacks ?? 99, s.stacks + stacks);
    s.time = cfg.duration;
  }

  world.bus.emit(EV.STATUS, { x: target.x, y: target.y, kind });
  runHooks(world, 'statusApplied', { target, kind });
}

/** 플레이어에게 상태이상을 건다 (적이 주는 디버프) */
export function applyPlayerStatus(world, kind, dt) {
  const cfg = PLAYER_STATUS[kind];
  if (!cfg) return;
  const p = world.player;
  p.status = p.status || {};
  p.status[kind] = { time: cfg.duration };
  world.bus.emit(EV.STATUS, { x: p.x, y: p.y, kind });
}

/** 플레이어 상태이상 시간 감소 */
export function updatePlayerStatus(world, dt) {
  const st = world.player.status;
  if (!st) return;
  for (const k of Object.keys(st)) {
    st[k].time -= dt;
    if (st[k].time <= 0) delete st[k];
  }
}

/** 상태이상 갱신 + 도트 피해. 적 배열 전체에 대해 매 틱 호출. */
export function updateStatuses(world, dt) {
  const L = world.loadout;
  for (const e of world.enemies) {
    if (e.dead || !e.status) continue;
    if (e._thermalCd > 0) e._thermalCd -= dt;

    // 화상
    const burn = e.status.burn;
    if (burn) {
      burn.time -= dt;
      burn.tickTimer -= dt;
      if (burn.tickTimer <= 0) {
        burn.tickTimer = STATUS.burn.tickRate;
        const dmg = STATUS.burn.dmgPerStack * burn.stacks * (1 + L.mods.burnMult);
        damageEnemy(world, e, dmg, 'ember', { tag: 'burn', silent: true, noCrit: true });
      }
      if (burn.time <= 0) delete e.status.burn;
    }
    // 출혈
    const bleed = e.status.bleed;
    if (bleed) {
      bleed.time -= dt;
      bleed.tickTimer -= dt;
      if (bleed.tickTimer <= 0) {
        bleed.tickTimer = STATUS.bleed.tickRate;
        const dmg = STATUS.bleed.dmgPerStack * bleed.stacks * (1 + L.mods.bleedMult);
        damageEnemy(world, e, dmg, 'blood', { tag: 'bleed', silent: true, noCrit: true });
      }
      if (bleed.time <= 0) delete e.status.bleed;
    }
    // 냉기 / 빙결 / 감전은 지속시간만 관리
    for (const k of ['chill', 'frozen', 'shock']) {
      const s = e.status[k];
      if (s) {
        s.time -= dt;
        if (s.time <= 0) delete e.status[k];
      }
    }
  }
}

/** 이동속도 배율 (냉기 둔화 / 빙결 정지) */
export function statusSpeedMult(e) {
  if (!e.status) return 1;
  if (e.status.frozen) return 0;
  const c = e.status.chill;
  if (c) return Math.max(0.25, 1 - STATUS.chill.slowPerStack * c.stacks);
  return 1;
}

export function isDisabled(e) {
  return !!(e.status && e.status.frozen);
}

/**
 * 경직: 짧게 행동을 끊는다. 빙결과 달리 추가 피해는 없고 상태이상도 아니다.
 * 무거운 타격이 "먹혔다"는 감각을 만든다.
 */
export function staggerEnemy(world, e, time) {
  if (!e || e.dead) return;
  const t = e.isBoss ? time * 0.35 : time;
  e.staggerT = Math.max(e.staggerT || 0, t);
  world.bus.emit(EV.STATUS, { x: e.x, y: e.y, kind: 'stagger' });
}

// ---------------- 훅 컨텍스트 ----------------

function makeCtx(world) {
  return {
    world, player: world.player, rng: world.rng,
    target: null, dmg: 0, mult: 1, crit: false, element: 'none', tag: '', step: -1, dir: 0, x: 0, y: 0,
    damage: (e, amount, element, opts) => damageEnemy(world, e, amount, element, opts),
    heal: (amount) => healPlayer(world, amount),
    applyStatus: (e, kind, stacks) => applyStatus(world, e, kind, stacks),
    explode: (x, y, r, dmg, element, status) => explode(world, x, y, r, dmg, element, status),
    chain: (from, count, dmg, mult) => chainLightning(world, from, count, dmg, mult),
    strikeRandom: (count, dmg, radius) => strikeRandom(world, count, dmg, radius),
    stagger: (e, time) => staggerEnemy(world, e, time),
    shoot: (opts) => world.spawnPlayerProjectile(opts),
    // 사령술
    summon: (id, x, y, opts) => world.summon(id, x, y, opts),
    corpses: (x, y, r) => world.corpsesNear(x, y, r),
    consume: (c) => world.consumeCorpse(c),
    minions: () => world.minions.filter((m) => !m.dead),
    forEachEnemyInRange: (x, y, r, fn) => forEachEnemyInRange(world, x, y, r, fn),
    fx: (type, payload) => world.bus.emit(type, payload),
  };
}

function runHooks(world, name, fields) {
  const list = world.loadout.on[name];
  if (!list || !list.length) return;
  if (world._hookDepth >= MAX_HOOK_DEPTH) return;
  world._hookDepth++;
  const ctx = world._ctx || (world._ctx = makeCtx(world));
  ctx.player = world.player;
  ctx.target = fields.target ?? null;
  ctx.dmg = fields.dmg ?? 0;
  ctx.crit = fields.crit ?? false;
  ctx.element = fields.element ?? 'none';
  ctx.tag = fields.tag ?? '';
  ctx.step = fields.step ?? -1;
  ctx.dir = fields.dir ?? 0;
  ctx.x = fields.x ?? (fields.target ? fields.target.x : world.player.x);
  ctx.y = fields.y ?? (fields.target ? fields.target.y : world.player.y);
  ctx.mult = 1;
  for (let i = 0; i < list.length; i++) list[i](ctx);
  world._hookDepth--;
  return ctx;
}

export function forEachEnemyInRange(world, x, y, radius, fn) {
  const r2 = radius * radius;
  const list = world.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) continue;
    if (dist2(x, y, e.x, e.y) <= r2 + e.radius * e.radius) fn(e);
  }
}

// ---------------- 피해 ----------------

/**
 * 적에게 피해를 준다.
 * opts: { tag, knock, dir, silent, heavy, noCrit, fromShieldCheck }
 * 반환: 실제 입힌 피해
 */
export function damageEnemy(world, e, amount, element = 'none', opts = {}) {
  if (!e || e.dead || amount <= 0) return 0;
  const L = world.loadout;
  const tag = opts.tag || 'attack';

  // 1) 권능 피해 수정자
  let mult = 1;
  const mods = L.on.modifyDamage;
  if (mods.length && world._hookDepth < MAX_HOOK_DEPTH) {
    const ctx = world._ctx || (world._ctx = makeCtx(world));
    ctx.player = world.player;
    ctx.target = e; ctx.tag = tag; ctx.element = element; ctx.mult = 1; ctx.dmg = amount;
    ctx.step = opts.step ?? -1;
    world._hookDepth++;
    for (let i = 0; i < mods.length; i++) mods[i](ctx);
    world._hookDepth--;
    mult = ctx.mult;
  }

  // 2) 빙결 대상 추가 피해 (냉기 계열의 기본 보상 — 권능 없이도 성립)
  if (e.status?.frozen) mult *= STATUS.frozen.shatterBonus;

  // 3) 무기 각인 / 저주 / 메타
  mult *= L.stats.damageMult * world.run.playerDealtMult * world.weaponDamageMult;

  // 4) 치명타 (도트는 제외)
  let crit = false;
  if (!opts.noCrit && (tag === 'attack' || tag === 'special' || tag === 'dash')) {
    const chance = PLAYER.BASE_CRIT + L.stats.critChance + (world.weapon.critBonus || 0);
    if (world.rng.next() < chance) {
      crit = true;
      mult *= PLAYER.CRIT_MULT + L.stats.critMult;
    }
  }

  // 5) '수호' 엘리트 오라 — 오라 주인을 먼저 잡을지, 무시하고 밀어붙일지 선택하게 한다
  if (!e.elite || !hasAffix(e, 'warded')) {
    const guard = findWardingElite(world, e);
    if (guard) {
      mult *= 1 - guard.reduce;
      world.bus.emit(EV.STATUS, { x: e.x, y: e.y, kind: 'warded' });
    }
  }

  // 6) 방패병 정면 방어 → 위치잡기 보상
  if (e.def.shieldArc && !e.dead) {
    const toPlayer = Math.atan2(world.player.y - e.y, world.player.x - e.x);
    let d = Math.abs(((toPlayer - e.facing + Math.PI * 3) % TAU) - Math.PI);
    if (d < (e.def.shieldArc * Math.PI) / 360) {
      mult *= 1 - e.def.shieldReduce;
      world.bus.emit(EV.STATUS, { x: e.x, y: e.y, kind: 'block' });
    }
  }

  const final = amount * mult;
  e.hp -= final;
  e.hurtFlash = 0.12;
  e.lastHitAt = world.time;

  // 넉백
  if (opts.knock && !e.def.noKnock) {
    const dir = opts.dir ?? Math.atan2(e.y - world.player.y, e.x - world.player.x);
    const resist = e.isBoss ? 0.12 : e.def.knockResist ?? 1;
    e.vx += Math.cos(dir) * opts.knock * resist;
    e.vy += Math.sin(dir) * opts.knock * resist;
    if (e.state === 'charge' && !e.isBoss) e.interrupt = true;
  }

  if (!opts.silent) {
    world.bus.emit(EV.HIT, {
      x: e.x, y: e.y, dmg: final, crit, element, heavy: !!opts.heavy, target: e,
    });
    world.hitstop = Math.max(world.hitstop, HITSTOP[opts.heavy ? 'HEAVY' : 'LIGHT']);
    world.shake(crit || opts.heavy ? SHAKE.HEAVY : SHAKE.LIGHT);
  } else {
    world.bus.emit(EV.HIT, { x: e.x, y: e.y, dmg: final, crit, element, tick: true, target: e });
  }

  // 집중 회복
  if (tag === 'attack') world.player.focus = Math.min(world.player.maxFocus, world.player.focus + PLAYER.FOCUS_ON_HIT);

  // 7) onHit 훅
  runHooks(world, 'hit', {
    target: e, dmg: final, crit, element, tag,
    step: opts.step ?? -1, dir: opts.dir ?? 0, x: e.x, y: e.y,
  });

  // 8) 처치
  // '가시' 엘리트: 근접 타격에 반격 탄을 뿌린다
  if (hasAffix(e, 'thorned') && (tag === 'attack' || tag === 'special') && !e.dead) {
    e.thornCd = (e.thornCd || 0);
    if (e.thornCd <= 0) {
      const af = getAffix(e, 'thorned').retaliate;
      e.thornCd = af.cooldown;
      world.retaliate(e, af);
    }
  }

  if (e.hp <= 0 && !e.dead) killEnemy(world, e, { element, tag });

  return final;
}

export function hasAffix(e, id) {
  return !!(e.affixes && e.affixes.some((a) => a.id === id));
}
export function getAffix(e, id) {
  return e.affixes && e.affixes.find((a) => a.id === id);
}

/** 대상을 보호 중인 '수호' 엘리트를 찾는다 */
function findWardingElite(world, target) {
  for (const g of world.enemies) {
    if (g.dead || g === target || !hasAffix(g, 'warded')) continue;
    const af = getAffix(g, 'warded').aura;
    if (dist2(g.x, g.y, target.x, target.y) <= af.radius * af.radius) {
      return { guard: g, reduce: af.damageReduce };
    }
  }
  return null;
}

export function killEnemy(world, e, info = {}) {
  if (e.dead) return;
  e.dead = true;
  world.run.kills++;
  world.player.focus = Math.min(world.player.maxFocus, world.player.focus + 6);

  world.bus.emit(EV.KILL, {
    x: e.x, y: e.y, enemy: e, elite: e.elite, boss: e.isBoss, element: info.element,
  });
  world.hitstop = Math.max(world.hitstop, e.isBoss ? HITSTOP.BOSS_KILL : HITSTOP.KILL);
  world.shake(e.isBoss ? SHAKE.EXPLOSION : SHAKE.KILL);

  // 골드 드롭
  const gold = Math.round((e.def.gold || 0) * (e.elite ? ENEMY_SCALE.ELITE_GOLD : 1));
  if (gold > 0) world.spawnPickup(e.x, e.y, 'gold', gold);
  // 소량 회복 오브: 공격적으로 밀어붙일 이유를 만든다
  if (e.elite) world.spawnPickup(e.x, e.y, 'heal', 12);
  else if (!e.isBoss && world.rng.next() < 0.07) world.spawnPickup(e.x, e.y, 'heal', 5);

  // 시체를 남긴다 — 사령술 빌드의 자원이자, 적 시체 술사의 자원이기도 하다
  if (!e.noCorpse) {
    world.spawnCorpse(e);
    runHooks(world, 'corpse', { x: e.x, y: e.y, target: e });
  }

  // '폭발성' 엘리트: 죽은 자리에 예고된 폭발을 남긴다 (시체 근처에 서 있지 말 것)
  if (hasAffix(e, 'volatile')) {
    const af = getAffix(e, 'volatile').onDeath.explode;
    world.spawnHazard(e.x, e.y, af.radius, af.dmg, af.telegraph, '#ff6b35');
  }

  // 무기 고유: 처치 시 망령 자동 소환 (강령장)
  const soc = world.weapon.summonOnKill;
  if (soc && !e.isBoss && world.rng.next() < soc.chance) {
    world.summon(soc.id, e.x, e.y, { scale: e.elite ? 1.5 : 1 });
  }

  // 무기 고유: 처치 시 대시 충전 회복 (쌍아검)
  if (world.weapon.dashOnKill) {
    const p = world.player;
    p.dashCharges = Math.min(p.maxDashCharges, p.dashCharges + world.weapon.dashOnKill);
  }

  // onKill 훅 (dead 처리 후에 호출해야 연쇄 폭발이 자기 자신을 다시 죽이지 않음)
  runHooks(world, 'kill', { target: e, x: e.x, y: e.y, element: info.element, tag: info.tag });

  // 분열
  if (e.def.splitInto && !e.elite) {
    const { id, count } = e.def.splitInto;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + world.rng.float(0, TAU);
      world.spawnEnemy(id, e.x + Math.cos(a) * 26, e.y + Math.sin(a) * 26, { fromSplit: true });
    }
  }
}

export function damagePlayer(world, amount, opts = {}) {
  const p = world.player;
  if (p.dead || p.iframes > 0 || world.run.state !== 'fight') return 0;

  // 슈퍼아머(파쇄추): 휘두르는 동안은 버틴다 — 느린 무기의 정체성
  const W = world.weapon;
  const armored = W.superArmor && p.state === 'attack';
  const armorMult = armored
    ? Math.max(0.2, 1 - (W.superArmorReduce || 0.3) - world.loadout.mods.armorExtra)
    : 1;
  // 가속 방어: 연속 타격을 유지하는 동안 단단해진다 (쌍아검)
  const rampMult = W.rampArmor && p.ramp > 0
    ? 1 - W.rampArmor * (p.ramp / W.rampMax)
    : 1;
  const final = amount * world.run.playerTakenMult * world.loadout.stats.damageTakenMult * armorMult * rampMult;
  p.hp -= final;
  p.iframes = PLAYER.HURT_IFRAMES;
  p.hurtFlash = 0.3;
  if (p.ramp > 0) p.ramp *= 0.5; // 가속 절반 소실 — 맞으면 대가를 치르되 회복 가능해야 한다
  world.run.damageTaken += final;
  if (armored) world.bus.emit(EV.STATUS, { x: p.x, y: p.y, kind: 'armor' });

  const dir = opts.dir ?? Math.atan2(p.y - (opts.fromY ?? p.y), p.x - (opts.fromX ?? p.x));
  const kb = PLAYER.HURT_KNOCKBACK * (armored ? 0.25 : 1);
  p.vx += Math.cos(dir) * kb;
  p.vy += Math.sin(dir) * kb;

  // '흡혈' 엘리트는 때린 만큼 회복한다 — 빠르게 처리하지 않으면 소모전에서 진다
  const src = opts.source;
  if (src && !src.dead && hasAffix(src, 'vampiric')) {
    const heal = final * getAffix(src, 'vampiric').lifesteal;
    src.hp = Math.min(src.maxHp, src.hp + heal);
    world.bus.emit(EV.HEAL, { x: src.x, y: src.y, amount: heal, enemy: true });
  }

  world.bus.emit(EV.PLAYER_HURT, { x: p.x, y: p.y, dmg: final });
  world.hitstop = Math.max(world.hitstop, HITSTOP.PLAYER_HURT);
  world.shake(SHAKE.PLAYER_HURT);

  runHooks(world, 'hurt', { x: p.x, y: p.y, dmg: final });

  if (p.hp <= 0) {
    if (world.run.revives > 0) {
      world.run.revives--;
      p.hp = p.maxHp * 0.4;
      p.iframes = 1.6;
      world.bus.emit(EV.HEAL, { x: p.x, y: p.y, amount: p.hp, revive: true });
    } else {
      p.hp = 0;
      p.dead = true;
      world.bus.emit(EV.PLAYER_DEAD, {});
    }
  }
  return final;
}

export function healPlayer(world, amount) {
  const p = world.player;
  if (amount <= 0 || p.dead) return 0;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const healed = p.hp - before;
  if (healed > 0.5) world.bus.emit(EV.HEAL, { x: p.x, y: p.y, amount: healed });
  return healed;
}

// ---------------- 광역 효과 ----------------

export function explode(world, x, y, radius, dmg, element = 'none', status = null, opts = {}) {
  world.bus.emit(EV.EXPLOSION, { x, y, radius, element });
  world.shake(SHAKE.EXPLOSION * 0.6);
  forEachEnemyInRange(world, x, y, radius, (e) => {
    damageEnemy(world, e, dmg, element, { tag: opts.tag || 'explosion', knock: opts.knock || 120, dir: Math.atan2(e.y - y, e.x - x), silent: true, noCrit: true });
    if (status) applyStatus(world, e, status.kind, status.stacks);
  });
}

export function chainLightning(world, from, count, dmg, mult = 1) {
  const range = STATUS.shock.chainRange;
  let current = from;
  const visited = new Set([from]);
  for (let i = 0; i < count; i++) {
    let best = null, bestD = Infinity;
    for (const e of world.enemies) {
      if (e.dead || visited.has(e)) continue;
      const d = dist2(current.x, current.y, e.x, e.y);
      if (d < bestD && d <= range * range) { bestD = d; best = e; }
    }
    if (!best) break;
    visited.add(best);
    world.bus.emit('chain', { x1: current.x, y1: current.y, x2: best.x, y2: best.y });
    damageEnemy(world, best, dmg * mult, 'storm', { tag: 'chain', silent: true, noCrit: true });
    applyStatus(world, best, 'shock', 1);
    current = best;
  }
}

export function strikeRandom(world, count, dmg, radius) {
  const alive = world.enemies.filter((e) => !e.dead);
  if (!alive.length) return;
  world.rng.shuffle(alive);
  for (let i = 0; i < Math.min(count, alive.length); i++) {
    const e = alive[i];
    world.bus.emit('bolt', { x: e.x, y: e.y });
    explode(world, e.x, e.y, radius, dmg, 'storm', { kind: 'shock', stacks: 1 }, { tag: 'special' });
  }
}

export { runHooks };
