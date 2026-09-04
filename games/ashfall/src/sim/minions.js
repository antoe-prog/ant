// ============================================================
// 시체(Corpse) · 소환수(Minion) 시뮬레이션.
//
// 시체: 적이 죽은 자리에 남는 위치 자원. 권능/무기가 이것을 소비한다.
// 소환수: 플레이어 편 유닛. 숫자가 아니라 전장의 구성을 바꾼다.
//   - 적을 붙잡아 플레이어에게 오는 압박을 나눈다
//   - 해골 병사는 몸으로 적탄을 막는다
//   - 뼈 궁수는 원거리 화력을 더한다
// ============================================================

import { CORPSE, MINION_BY_ID, MINION_RULES } from '../data/minions.js';
import { EV } from '../core/events.js';
import { clamp, dist, dist2, normalize, TAU } from '../core/math.js';
import { damageEnemy, applyStatus, runHooks } from './combat.js';

// ---------------- 시체 ----------------

export function spawnCorpse(world, e) {
  const scale = e.isBoss ? CORPSE.BOSS_SCALE : e.elite ? CORPSE.ELITE_SCALE : 1;
  world.corpses.push({
    x: e.x, y: e.y,
    radius: e.radius * 0.9,
    scale,
    enemyId: e.id,
    life: CORPSE.LIFETIME,
    seed: world.rng.float(0, TAU),
    used: false,
  });
  if (world.corpses.length > CORPSE.MAX) world.corpses.shift();
}

export function updateCorpses(world, dt) {
  for (let i = world.corpses.length - 1; i >= 0; i--) {
    const c = world.corpses[i];
    c.life -= dt;
    if (c.used) { world.corpses.splice(i, 1); continue; }
    if (c.life <= 0) {
      // 자연 소멸 — 소비된 것과 구분한다 (빙결의 무덤 등이 여기에 걸린다)
      runHooks(world, 'corpseExpire', { x: c.x, y: c.y });
      world.corpses.splice(i, 1);
    }
  }
}

/** 반경 안의 시체 목록 (가까운 순) */
export function corpsesNear(world, x, y, radius) {
  const r2 = radius * radius;
  return world.corpses
    .filter((c) => !c.used && dist2(x, y, c.x, c.y) <= r2)
    .sort((a, b) => dist2(x, y, a.x, a.y) - dist2(x, y, b.x, b.y));
}

/** 시체를 소비한다. 소비된 시체는 다음 틱에 정리된다. */
export function consumeCorpse(world, c) {
  if (!c || c.used) return false;
  c.used = true;
  world.bus.emit('corpseUsed', { x: c.x, y: c.y });
  return true;
}

// ---------------- 소환수 ----------------

export function minionCap(world) {
  return Math.min(MINION_RULES.HARD_CAP, MINION_RULES.BASE_MAX + world.loadout.mods.minionCap);
}

/**
 * 소환수를 부른다. 상한을 넘으면 가장 오래된 소환수가 스러진다.
 * scale 은 시체 크기(엘리트/보스)로 강화된 배율.
 */
export function summonMinion(world, id, x, y, opts = {}) {
  const def = MINION_BY_ID[id];
  if (!def) return null;
  const L = world.loadout;
  const cap = minionCap(world);

  const alive = world.minions.filter((m) => !m.dead);
  if (alive.length >= cap) {
    // 가장 오래 산 소환수를 스러지게 한다 (상한이 곧 선택이 되도록)
    let oldest = alive[0];
    for (const m of alive) if (m.life < oldest.life) oldest = m;
    oldest.dead = true;
    world.bus.emit('minionExpire', { x: oldest.x, y: oldest.y, color: oldest.def.color });
  }

  const scale = opts.scale || 1;
  const hp = def.hp * scale * (1 + L.mods.minionHp);
  const m = {
    def, id,
    x: clamp(x, world.arena.pad + 20, world.arena.width - world.arena.pad - 20),
    y: clamp(y, world.arena.pad + 20, world.arena.height - world.arena.pad - 20),
    vx: 0, vy: 0,
    radius: def.radius * (1 + (scale - 1) * 0.4),
    hp, maxHp: hp,
    dmg: def.dmg * scale * (1 + L.mods.minionDamage),
    speed: def.speed,
    life: def.life * (1 + L.mods.minionLife),
    maxLife: def.life * (1 + L.mods.minionLife),
    facing: world.rng.float(0, TAU),
    attackCd: 0,
    contactCd: 0,
    spawnT: MINION_RULES.SUMMON_INVULN,
    hurtFlash: 0,
    dead: false,
    scale,
  };
  world.minions.push(m);
  world.bus.emit('minionSummon', { x: m.x, y: m.y, id, color: def.color, scale });
  runHooks(world, 'summon', { x: m.x, y: m.y, minion: m });
  return m;
}

export function updateMinions(world, dt) {
  const p = world.player;
  const list = world.minions;

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.dead) continue;

    if (m.hurtFlash > 0) m.hurtFlash -= dt;
    if (m.spawnT > 0) { m.spawnT -= dt; continue; } // 솟아오르는 중
    if (m.attackCd > 0) m.attackCd -= dt;
    if (m.contactCd > 0) m.contactCd -= dt;

    m.life -= dt;
    if (m.life <= 0) {
      m.dead = true;
      world.bus.emit('minionExpire', { x: m.x, y: m.y, color: m.def.color });
      runHooks(world, 'minionDeath', { x: m.x, y: m.y, minion: m });
      continue;
    }

    // 목표 선정: 플레이어 주변의 가장 가까운 적
    const leashed = dist(m.x, m.y, p.x, p.y) > MINION_RULES.LEASH;
    let target = null, bestD = Infinity;
    if (!leashed) {
      for (const e of world.enemies) {
        if (e.dead || e.spawnT > 0) continue;
        const d = dist2(m.x, m.y, e.x, e.y);
        if (d < bestD && d <= MINION_RULES.SEEK_RANGE * MINION_RULES.SEEK_RANGE) { bestD = d; target = e; }
      }
    }

    if (!target) {
      // 적이 없으면 플레이어 곁으로 (뒤에 붙어 따라온다)
      const d = dist(m.x, m.y, p.x, p.y);
      if (d > 70) moveToward(m, p.x, p.y, m.speed * 1.15, dt);
      else { m.vx *= 0.86; m.vy *= 0.86; }
    } else if (m.def.kind === 'ranged') {
      const d = Math.sqrt(bestD);
      if (d > m.def.range * 0.85) moveToward(m, target.x, target.y, m.speed, dt);
      else if (d < m.def.range * 0.45) moveToward(m, m.x * 2 - target.x, m.y * 2 - target.y, m.speed, dt);
      else { m.vx *= 0.9; m.vy *= 0.9; }
      m.facing = Math.atan2(target.y - m.y, target.x - m.x);
      if (m.attackCd <= 0 && d <= m.def.range) {
        m.attackCd = m.def.attackCd;
        world.spawnPlayerProjectile({
          x: m.x, y: m.y, angle: m.facing, speed: m.def.projSpeed,
          dmg: m.dmg, radius: 8, life: 0.9, pierce: 1, color: m.def.accent, tag: 'minion',
        });
      }
    } else {
      moveToward(m, target.x, target.y, m.speed, dt);
      const reach = m.radius + target.radius + 6;
      if (m.attackCd <= 0 && Math.sqrt(bestD) <= reach) {
        m.attackCd = m.def.attackCd;
        damageEnemy(world, target, m.dmg, 'none', {
          tag: 'minion', knock: 70, dir: Math.atan2(target.y - m.y, target.x - m.x), silent: true, noCrit: true,
        });
        for (const s of world.loadout.minionStatus) applyStatus(world, target, s.kind, s.stacks);
        world.bus.emit('minionHit', { x: target.x, y: target.y, color: m.def.accent });
      }
    }

    // 이동 적용
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    const f = Math.exp(-8 * dt);
    m.vx *= f; m.vy *= f;

    // 장애물 / 벽
    for (const o of world.obstacles) {
      const dx = m.x - o.x, dy = m.y - o.y, d = Math.hypot(dx, dy);
      const min = m.radius + o.radius;
      if (d < min && d > 1e-5) { m.x = o.x + (dx / d) * min; m.y = o.y + (dy / d) * min; }
    }
    const a = world.arena;
    m.x = clamp(m.x, a.pad + m.radius, a.width - a.pad - m.radius);
    m.y = clamp(m.y, a.pad + m.radius, a.height - a.pad - m.radius);

    // 적과 몸이 닿으면 서로 갉아먹는다 — 소환수가 압박을 나눠 받는다
    if (m.contactCd <= 0) {
      for (const e of world.enemies) {
        if (e.dead || e.spawnT > 0 || !e.def.contact) continue;
        if (dist(m.x, m.y, e.x, e.y) < m.radius + e.radius) {
          m.contactCd = MINION_RULES.CONTACT_CD;
          damageMinion(world, m, e.dmg * MINION_RULES.ENEMY_DMG_TO_MINION * world.run.enemyDmgMult);
          break;
        }
      }
    }
  }

  for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
}

function moveToward(m, tx, ty, speed, dt) {
  const n = normalize(tx - m.x, ty - m.y);
  m.vx += (n.x * speed - m.vx) * Math.min(1, 9 * dt);
  m.vy += (n.y * speed - m.vy) * Math.min(1, 9 * dt);
  if (Math.abs(n.x) + Math.abs(n.y) > 0.01) m.facing = Math.atan2(n.y, n.x);
}

export function damageMinion(world, m, amount) {
  if (!m || m.dead || m.spawnT > 0) return 0;
  m.hp -= amount;
  m.hurtFlash = 0.12;
  if (m.hp <= 0) {
    m.dead = true;
    world.bus.emit('minionDeath', { x: m.x, y: m.y, color: m.def.color });
    runHooks(world, 'minionDeath', { x: m.x, y: m.y, minion: m });
  }
  return amount;
}

/**
 * 적탄이 소환수에 막히는지 판정.
 * 해골 병사가 진짜 '벽'으로 기능하게 하는 부분.
 */
export function blockProjectile(world, pr) {
  for (const m of world.minions) {
    if (m.dead || m.spawnT > 0 || !m.def.blocksProjectiles) continue;
    if (Math.hypot(pr.x - m.x, pr.y - m.y) < pr.radius + m.radius) {
      damageMinion(world, m, pr.dmg * MINION_RULES.ENEMY_DMG_TO_MINION);
      world.bus.emit(EV.PROJECTILE_HIT, { x: pr.x, y: pr.y, color: pr.color });
      return true;
    }
  }
  return false;
}

export function aliveMinions(world) {
  let n = 0;
  for (const m of world.minions) if (!m.dead) n++;
  return n;
}
