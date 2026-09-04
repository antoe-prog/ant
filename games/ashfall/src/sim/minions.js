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
import { damageEnemy, applyStatus, staggerEnemy, forEachEnemyInRange, runHooks } from './combat.js';

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

/**
 * 소환수 수에는 제한이 없다.
 * 자연스러운 상한은 지속시간이 만든다 — 소환 속도 × 지속시간 = 동시 존재 수.
 * (HUD/설명용으로만 남겨둔 함수. 더 이상 소환을 막지 않는다.)
 */
export function minionCap() {
  return Infinity;
}

/**
 * 소환수를 부른다. 상한을 넘으면 가장 오래된 소환수가 스러진다.
 * scale 은 시체 크기(엘리트/보스)로 강화된 배율.
 */
export function summonMinion(world, id, x, y, opts = {}) {
  const L = world.loadout;
  // 권능이 소환수 종류를 바꾼다 (예: 망령 → 뼈 사냥개).
  // 소환처(처치/대시/특수기)를 건드리지 않고 '무엇이 나오는지'만 갈아끼운다.
  const swapped = (!opts.noSwap && L.mods.minionSwap[id]) || id;
  const def = MINION_BY_ID[swapped];
  if (!def) return null;
  id = swapped;
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
    target: null,
    retargetT: world.rng.float(0, MINION_RULES.RETARGET_INTERVAL), // 재탐색 시점을 분산
    cmdSeq: -1,
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

    // 목표 선정.
    // 소환수 수에 제한이 없으므로 매 프레임 전수 탐색하면 O(소환수×적)이 커진다.
    // 목표는 짧은 주기로만 갱신하고, 그 사이에는 캐시된 목표를 쫓는다.
    const cmd = world.command;
    const leashed = !cmd && dist(m.x, m.y, p.x, p.y) > MINION_RULES.LEASH;

    m.retargetT -= dt;
    if (m.target && (m.target.dead || m.target.spawnT > 0)) m.target = null;
    if (m.retargetT <= 0 || !m.target || m.cmdSeq !== world.commandSeq) {
      m.retargetT = MINION_RULES.RETARGET_INTERVAL;
      m.cmdSeq = world.commandSeq;
      m.target = pickTarget(world, m, cmd, leashed);
    }
    const target = m.target;
    const bestD = target ? dist2(m.x, m.y, target.x, target.y) : Infinity;

    // 명령 중에는 더 빠르고 세진다
    const cmdSpeed = cmd ? MINION_RULES.COMMAND_SPEED : 1;
    const cmdDmg = cmd ? MINION_RULES.COMMAND_DAMAGE : 1;

    if (!target && cmd) {
      // 명령 지점에 적이 없으면 그 자리로 몰려간다
      if (dist(m.x, m.y, cmd.x, cmd.y) > 50) moveToward(m, cmd.x, cmd.y, m.speed * cmdSpeed, dt);
      else { m.vx *= 0.88; m.vy *= 0.88; }
    } else if (!target) {
      // 적이 없으면 플레이어 곁으로 (뒤에 붙어 따라온다)
      const d = dist(m.x, m.y, p.x, p.y);
      if (d > 70) moveToward(m, p.x, p.y, m.speed * 1.15, dt);
      else { m.vx *= 0.86; m.vy *= 0.86; }
    } else if (m.def.kind === 'ranged') {
      const d = Math.sqrt(bestD);
      if (d > m.def.range * 0.85) moveToward(m, target.x, target.y, m.speed * cmdSpeed, dt);
      else if (d < m.def.range * 0.45) moveToward(m, m.x * 2 - target.x, m.y * 2 - target.y, m.speed * cmdSpeed, dt);
      else { m.vx *= 0.9; m.vy *= 0.9; }
      m.facing = Math.atan2(target.y - m.y, target.x - m.x);
      if (m.attackCd <= 0 && d <= m.def.range) {
        m.attackCd = m.def.attackCd;
        world.spawnPlayerProjectile({
          x: m.x, y: m.y, angle: m.facing, speed: m.def.projSpeed,
          dmg: m.dmg * cmdDmg, radius: 8, life: 0.9, pierce: 1, color: m.def.accent, tag: 'minion',
        });
      }
    } else {
      moveToward(m, target.x, target.y, m.speed * cmdSpeed, dt);
      const reach = m.radius + target.radius + 6;
      if (m.attackCd <= 0 && Math.sqrt(bestD) <= reach) {
        m.attackCd = m.def.attackCd;
        const hit = (e) => {
          damageEnemy(world, e, m.dmg * cmdDmg, 'none', {
            tag: 'minion', knock: 70, dir: Math.atan2(e.y - m.y, e.x - m.x), silent: true, noCrit: true,
          });
          for (const st of world.loadout.minionStatus) applyStatus(world, e, st.kind, st.stacks);
          // 사냥개: 물면 적의 행동을 끊는다 (피해보다 '붙잡기'가 역할)
          if (m.def.staggerOnHit) staggerEnemy(world, e, m.def.staggerOnHit);
          world.bus.emit('minionHit', { x: e.x, y: e.y, color: m.def.accent });
        };
        if (m.def.slamRadius) {
          // 거인: 광역으로 내리친다 — 하나가 여럿 몫을 한다
          const r = m.def.slamRadius * (0.7 + 0.3 * m.scale);
          world.bus.emit('shockwave', { x: m.x, y: m.y, radius: r, color: m.def.accent, weak: true });
          forEachEnemyInRange(world, m.x, m.y, r, hit);
        } else {
          hit(target);
        }
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

    // 적과 몸이 닿으면 서로 갉아먹는다 — 소환수가 압박을 나눠 받는다.
    // 전수 탐색 대신 '지금 쫓는 적'만 본다 (닿을 수 있는 건 사실상 그 적이다).
    if (m.contactCd <= 0 && target && target.def.contact && !target.dead) {
      if (dist(m.x, m.y, target.x, target.y) < m.radius + target.radius) {
        m.contactCd = MINION_RULES.CONTACT_CD;
        damageMinion(world, m, target.dmg * MINION_RULES.ENEMY_DMG_TO_MINION * world.run.enemyDmgMult);
      }
    }
  }

  for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
}

/** 목표 선정 (재탐색 주기마다 한 번만 호출된다) */
function pickTarget(world, m, cmd, leashed) {
  let target = null, bestD = Infinity;
  if (cmd) {
    // 명령 중: 지정 지점 주변의 적을 최우선으로
    const r2 = MINION_RULES.COMMAND_RADIUS * MINION_RULES.COMMAND_RADIUS;
    for (const e of world.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      if (dist2(cmd.x, cmd.y, e.x, e.y) > r2) continue;
      const d = dist2(m.x, m.y, e.x, e.y);
      if (d < bestD) { bestD = d; target = e; }
    }
  }
  if (!target && !leashed) {
    const seek2 = MINION_RULES.SEEK_RANGE * MINION_RULES.SEEK_RANGE;
    for (const e of world.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = dist2(m.x, m.y, e.x, e.y);
      if (d < bestD && d <= seek2) { bestD = d; target = e; }
    }
  }
  return target;
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

// ---------------- 소환수 명령 ----------------

/**
 * "저기를 쳐라" — 조준 지점으로 군세를 몰아붙인다.
 * 지정 반경 안의 적을 최우선으로 노리고, 그동안 더 빠르고 세진다.
 * 소환 빌드가 자동 전투가 아니라 지휘로 성립하게 만드는 장치.
 */
export function issueCommand(world, x, y) {
  if (world.commandCd > 0) return false;
  if (aliveMinions(world) <= 0) return false;
  const p = world.player;
  const dx = x - p.x, dy = y - p.y;
  const len = Math.hypot(dx, dy);
  const max = MINION_RULES.COMMAND_RANGE;
  const tx = len > max ? p.x + (dx / len) * max : x;
  const ty = len > max ? p.y + (dy / len) * max : y;

  world.command = { x: tx, y: ty, t: MINION_RULES.COMMAND_DURATION, maxT: MINION_RULES.COMMAND_DURATION };
  world.commandSeq++;   // 소환수들이 즉시 목표를 다시 고르게 한다
  world.commandCd = MINION_RULES.COMMAND_CD;
  world.bus.emit('minionCommand', { x: tx, y: ty, count: aliveMinions(world) });
  return true;
}

export function updateCommand(world, dt) {
  if (world.commandCd > 0) world.commandCd -= dt;
  if (world.command) {
    world.command.t -= dt;
    if (world.command.t <= 0) { world.command = null; world.commandSeq++; }
  }
}

export function aliveMinions(world) {
  let n = 0;
  for (const m of world.minions) if (!m.dead) n++;
  return n;
}
