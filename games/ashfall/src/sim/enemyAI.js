// ============================================================
// 적 AI. 모든 공격은 telegraph(예고) → 실행 구조.
// 플레이어가 "읽고 대응"할 수 있어야 핵앤슬래시가 성립한다.
// ============================================================

import { EV } from '../core/events.js';
import { clamp, dist, dist2, normalize, arcHit, TAU, rotateToward, normAngle } from '../core/math.js';
import { PLAYER } from '../data/balance.js';
import { damagePlayer, statusSpeedMult, isDisabled, applyPlayerStatus, applyStatus, damageEnemy, killEnemy } from './combat.js';
import { blockProjectile, damageMinionsInRange } from './minions.js';

const SEPARATION_FORCE = 260;

export function updateEnemies(world, dt) {
  const list = world.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) continue;
    updateEnemy(world, e, dt);
  }
  // 서로 겹치지 않도록 밀어내기 (군집이 한 점에 뭉치는 것 방지)
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / min) * SEPARATION_FORCE * dt;
        const nx = dx / d, ny = dy / d;
        const wa = b.isBoss ? 0 : 1, wb = a.isBoss ? 0 : 1;
        a.x -= nx * push * wa; a.y -= ny * push * wa;
        b.x += nx * push * wb; b.y += ny * push * wb;
      }
    }
  }
}

function updateEnemy(world, e, dt) {
  const p = world.player;
  if (e.hurtFlash > 0) e.hurtFlash -= dt;
  if (e.thornCd > 0) e.thornCd -= dt;
  // '재생' 엘리트 — 화력이 모자라면 절대 못 잡는다
  if (e.elite && e.affixes.length) {
    for (const a of e.affixes) {
      if (a.regenPerSec && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * a.regenPerSec * dt);
      }
    }
  }
  if (e.tele) { e.tele.t -= dt; if (e.tele.t <= 0) e.tele = null; }
  if (e.spawnT > 0) { // 등장 연출 중엔 무적/무행동
    e.spawnT -= dt;
    applyPhysics(world, e, dt);
    return;
  }

  if (e.staggerT > 0) {
    // 경직: 짧게 행동이 끊긴다 (무거운 타격의 보상)
    e.staggerT -= dt;
    e.vx *= 0.86; e.vy *= 0.86;
    applyPhysics(world, e, dt);
    return;
  }

  const slow = statusSpeedMult(e);
  if (isDisabled(e)) {
    // 빙결: 아무것도 못 하지만 넉백은 받는다
    applyPhysics(world, e, dt);
    return;
  }
  if (e.interrupt) { e.interrupt = false; if (e.state === 'charge') { e.state = 'idle'; e.cd = 0.5; } }

  e.t -= dt;
  if (e.cd > 0) e.cd -= dt;

  const behavior = BEHAVIORS[e.def.ai] || BEHAVIORS.chaser;
  behavior(world, e, p, dt, slow);

  applyPhysics(world, e, dt);
  handleContactDamage(world, e, dt);
}

function applyPhysics(world, e, dt) {
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  const f = Math.exp(-9 * dt);
  e.vx *= f; e.vy *= f;

  for (const o of world.obstacles) {
    const dx = e.x - o.x, dy = e.y - o.y;
    const d = Math.hypot(dx, dy);
    const min = e.radius + o.radius;
    if (d < min && d > 1e-5) {
      e.x = o.x + (dx / d) * min;
      e.y = o.y + (dy / d) * min;
      if (e.state === 'charge') { e.state = 'recover'; e.t = 0.35; }
    }
  }
  const a = world.arena;
  e.x = clamp(e.x, a.pad + e.radius, a.width - a.pad - e.radius);
  e.y = clamp(e.y, a.pad + e.radius, a.height - a.pad - e.radius);
}

/**
 * 접촉 피해 규칙:
 *  - chaser 계열(군집)은 몸통 접촉으로 피해를 준다 → "붙으면 아프다"는 압박.
 *  - charger 계열은 '돌진 중'에만 피해를 준다 → 예고를 읽고 피하면 안전.
 *  - 그 외에는 서로 밀어내기만 한다.
 */
function handleContactDamage(world, e, dt) {
  const p = world.player;
  const d = dist(e.x, e.y, p.x, p.y);
  const min = e.radius + p.radius;
  if (d >= min) return;

  const isCharger = e.def.ai === 'charger';
  const dealsDamage = e.def.contact && (!isCharger || e.state === 'charge');

  if (dealsDamage) {
    e.contactCd = (e.contactCd || 0) - dt;
    if (e.contactCd <= 0) {
      const dmg = e.dmg * (e.state === 'charge' ? 1.25 : 1);
      if (damagePlayer(world, dmg * world.run.enemyDmgMult, { fromX: e.x, fromY: e.y, source: e })) {
        e.contactCd = PLAYER.CONTACT_GRACE;
        // 돌진 명중 시에만 디버프 (서리창 기병의 냉기 등)
        if (e.def.applyStatus && e.state === 'charge') applyPlayerStatus(world, e.def.applyStatus.kind);
      }
    }
  } else if (d > 1e-5) {
    // 몸통 밀어내기 (겹쳐서 갇히는 상황 방지)
    const push = (min - d) * 0.5;
    e.x -= ((p.x - e.x) / d) * push;
    e.y -= ((p.y - e.y) / d) * push;
  }
}

function moveToward(e, tx, ty, speed, dt, slow) {
  const n = normalize(tx - e.x, ty - e.y);
  e.vx += (n.x * speed * slow - e.vx) * Math.min(1, 8 * dt);
  e.vy += (n.y * speed * slow - e.vy) * Math.min(1, 8 * dt);
  if (Math.hypot(n.x, n.y) > 0.01) e.facing = Math.atan2(n.y, n.x);
}

// ---------------- 행동 ----------------

const BEHAVIORS = {
  /** 단순 추격 + 접촉 피해 */
  chaser(world, e, p, dt, slow) {
    moveToward(e, p.x, p.y, e.speed, dt, slow);
  },

  /** 거리 안에 들어오면 예고 후 직선 돌진 */
  charger(world, e, p, dt, slow) {
    const d = dist(e.x, e.y, p.x, p.y);
    switch (e.state) {
      case 'telegraph':
        e.facing = rotateToward(e.facing, Math.atan2(p.y - e.y, p.x - e.x), 3.2 * dt);
        e.vx *= 0.86; e.vy *= 0.86;
        if (e.t <= 0) {
          e.state = 'charge';
          e.t = e.def.chargeTime;
          e.chargeDir = e.facing;
          e.vx = Math.cos(e.chargeDir) * e.def.chargeSpeed * world.run.enemySpeedMult;
          e.vy = Math.sin(e.chargeDir) * e.def.chargeSpeed * world.run.enemySpeedMult;
          world.bus.emit(EV.STATUS, { x: e.x, y: e.y, kind: 'charge' });
        }
        break;
      case 'charge':
        // 관성 유지 (마찰 상쇄)
        e.vx = Math.cos(e.chargeDir) * e.def.chargeSpeed * world.run.enemySpeedMult;
        e.vy = Math.sin(e.chargeDir) * e.def.chargeSpeed * world.run.enemySpeedMult;
        if (e.t <= 0) { e.state = 'recover'; e.t = 0.45; }
        break;
      case 'recover':
        e.vx *= 0.8; e.vy *= 0.8;
        if (e.t <= 0) { e.state = 'idle'; e.cd = e.def.cooldown; }
        break;
      default:
        if (d < e.def.chargeRange && e.cd <= 0 && d > 40) {
          e.state = 'telegraph';
          e.t = (e.def.telegraph * e.teleMult) / world.run.enemySpeedMult;
          e.tele = { kind: 'line', t: e.t, maxT: e.t, range: e.def.chargeSpeed * e.def.chargeTime };
        } else {
          moveToward(e, p.x, p.y, e.speed * 0.75, dt, slow);
        }
    }
  },

  /** 거리 유지 + 예고 후 사격 */
  ranged(world, e, p, dt, slow) {
    const d = dist(e.x, e.y, p.x, p.y);
    const [near, far] = e.def.keepDist;
    e.facing = rotateToward(e.facing, Math.atan2(p.y - e.y, p.x - e.x), 5 * dt);

    if (e.state === 'telegraph') {
      e.vx *= 0.88; e.vy *= 0.88;
      if (e.t <= 0) {
        e.state = 'fire';
        e.burstLeft = e.def.burst || 1;
        e.t = 0;
      }
    } else if (e.state === 'fire') {
      if (e.t <= 0) {
        fireProjectile(world, e, p);
        e.burstLeft--;
        e.t = e.def.burstGap || 0.1;
        if (e.burstLeft <= 0) { e.state = 'idle'; e.cd = e.def.cooldown / world.run.enemySpeedMult; }
      }
      e.vx *= 0.9; e.vy *= 0.9;
    } else {
      // 위치 조정
      if (d < near) moveToward(e, e.x * 2 - p.x, e.y * 2 - p.y, e.speed, dt, slow);
      else if (d > far) moveToward(e, p.x, p.y, e.speed, dt, slow);
      else {
        // 옆으로 돌기 (스트레이핑) — 플레이어가 쫓기 어렵게
        const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2 * (e.strafeDir || 1);
        moveToward(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, e.speed * 0.7, dt, slow);
      }
      if (e.cd <= 0 && d < far * 1.2) {
        e.state = 'telegraph';
        e.t = (e.def.telegraph * e.teleMult) / world.run.enemySpeedMult;
        e.tele = { kind: 'aim', t: e.t, maxT: e.t, range: 520 };
      }
    }
  },

  /** 전방 방패. 정면 피해 대폭 감소 → 뒤/옆으로 돌아야 한다. */
  shielder(world, e, p, dt, slow) {
    const d = dist(e.x, e.y, p.x, p.y);
    e.facing = rotateToward(e.facing, Math.atan2(p.y - e.y, p.x - e.x), 2.1 * dt); // 느린 회전 = 백스탭 기회
    if (e.state === 'telegraph') {
      e.vx *= 0.85; e.vy *= 0.85;
      if (e.t <= 0) { e.state = 'swing'; e.t = e.def.swingTime; e.swung = false; }
    } else if (e.state === 'swing') {
      if (!e.swung) {
        e.swung = true;
        const half = (e.def.swingArc * Math.PI) / 360;
        if (arcHit(e.x, e.y, e.facing, half, e.def.swingRange, p.x, p.y, p.radius)) {
          damagePlayer(world, e.dmg * world.run.enemyDmgMult, { fromX: e.x, fromY: e.y, source: e });
        }
        damageMinionsInRange(world, e.x, e.y, e.def.swingRange * 0.8, e.dmg * world.run.enemyDmgMult);
        world.bus.emit(EV.SHOCKWAVE, { x: e.x, y: e.y, radius: e.def.swingRange, color: e.def.accent, weak: true });
      }
      if (e.t <= 0) { e.state = 'idle'; e.cd = e.def.cooldown / world.run.enemySpeedMult; }
    } else {
      moveToward(e, p.x, p.y, e.speed, dt, slow);
      if (d < e.def.swingRange * 0.9 && e.cd <= 0) {
        e.state = 'telegraph';
        e.t = (e.def.telegraph * e.teleMult) / world.run.enemySpeedMult;
        e.tele = { kind: 'arc', t: e.t, maxT: e.t, arc: e.def.swingArc, range: e.def.swingRange };
      }
    }
  },

  /**
   * 시체 술사: 전장의 시체를 되살린다.
   * 플레이어의 사령술 자원을 놓고 경쟁하며, 방치하면 방이 끝나지 않는다.
   * 부활은 길게 예고되므로 '먼저 끊을지 / 시체를 먼저 치울지'가 선택이 된다.
   */
  raiser(world, e, p, dt, slow) {
    const d = dist(e.x, e.y, p.x, p.y);
    const [near, far] = e.def.keepDist;
    e.facing = rotateToward(e.facing, Math.atan2(p.y - e.y, p.x - e.x), 3.4 * dt);

    if (e.state === 'telegraph') {
      e.vx *= 0.88; e.vy *= 0.88;
      if (e.t <= 0) {
        const c = e.raiseTarget;
        if (c && !c.used && world.corpses.includes(c)) {
          c.used = true;
          const revived = world.spawnEnemy(c.enemyId, c.x, c.y, {});
          if (revived) {
            revived.hp = revived.maxHp = revived.maxHp * e.def.revivedHp;
            revived.noCorpse = true;   // 무한 부활 고리를 막는다
            revived.revived = true;
          }
          world.bus.emit(EV.EXPLOSION, { x: c.x, y: c.y, radius: 70, element: 'necro' });
        }
        e.raiseTarget = null;
        e.state = 'idle';
        e.cd = e.def.cooldown / world.run.enemySpeedMult;
      }
      return;
    }

    // 되살릴 시체를 찾는다
    if (e.cd <= 0) {
      let best = null, bestD = Infinity;
      for (const c of world.corpses) {
        if (c.used) continue;
        const cd = dist2(e.x, e.y, c.x, c.y);
        if (cd < bestD && cd <= e.def.raiseRange * e.def.raiseRange) { bestD = cd; best = c; }
      }
      if (best) {
        e.raiseTarget = best;
        e.state = 'telegraph';
        e.t = (e.def.telegraph * e.teleMult) / world.run.enemySpeedMult;
        e.tele = { kind: 'raise', t: e.t, maxT: e.t, radius: 60, tx: best.x, ty: best.y };
        return;
      }
    }

    // 시체가 없으면 거리를 유지하며 배회한다
    if (d < near) moveToward(e, e.x * 2 - p.x, e.y * 2 - p.y, e.speed, dt, slow);
    else if (d > far) moveToward(e, p.x, p.y, e.speed, dt, slow);
    else {
      const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2 * (e.strafeDir || 1);
      moveToward(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, e.speed * 0.6, dt, slow);
    }
  },

  /** 접근 후 자폭. 도망칠 시간을 준다. */
  bomber(world, e, p, dt, slow) {
    const d = dist(e.x, e.y, p.x, p.y);
    if (e.state === 'fuse') {
      e.vx *= 0.9; e.vy *= 0.9;
      if (e.t <= 0) {
        world.bus.emit(EV.EXPLOSION, { x: e.x, y: e.y, radius: e.def.blastRadius, element: 'ember' });
        damageMinionsInRange(world, e.x, e.y, e.def.blastRadius, e.dmg * world.run.enemyDmgMult * 1.3);
        if (dist(e.x, e.y, p.x, p.y) < e.def.blastRadius + p.radius) {
          damagePlayer(world, e.dmg * world.run.enemyDmgMult, { fromX: e.x, fromY: e.y, source: e });
        }
        e.hp = 0;
        e.suicide = true;
        killEnemy(world, e, { element: 'ember' });
      }
    } else {
      moveToward(e, p.x, p.y, e.speed, dt, slow);
      if (d < e.def.blastRadius * 0.55) {
        e.state = 'fuse';
        e.t = e.def.fuse;
        e.tele = { kind: 'circle', t: e.t, maxT: e.t, radius: e.def.blastRadius };
      }
    }
  },
};

/** 아군 투사체 갱신. 제거해야 하면 true 반환 */
function updateFriendlyProjectile(world, pr, dt) {
  if (pr.life <= 0) return true;
  const a = world.arena;
  if (pr.x < a.pad || pr.y < a.pad || pr.x > a.width - a.pad || pr.y > a.height - a.pad) {
    world.bus.emit(EV.PROJECTILE_HIT, { x: pr.x, y: pr.y, color: pr.color });
    return true;
  }
  for (const e of world.enemies) {
    if (e.dead || pr.hitSet.has(e)) continue;
    if (Math.hypot(pr.x - e.x, pr.y - e.y) > pr.radius + e.radius) continue;
    pr.hitSet.add(e);
    damageEnemy(world, e, pr.dmg, pr.element, {
      tag: 'projectile', knock: 90, dir: Math.atan2(pr.vy, pr.vx), heavy: false,
    });
    if (pr.status) applyStatus(world, e, pr.status.kind, pr.status.stacks);
    if (--pr.pierce <= 0) {
      world.bus.emit(EV.PROJECTILE_HIT, { x: pr.x, y: pr.y, color: pr.color });
      return true;
    }
  }
  return false;
}

export function fireProjectile(world, e, p, overrides = {}) {
  const def = e.def;
  const angle = overrides.angle ?? (Math.atan2(p.y - e.y, p.x - e.x) + (def.spread ? world.rng.float(-def.spread, def.spread) : 0));
  const speed = overrides.speed ?? def.projSpeed;
  world.projectiles.push({
    x: e.x + Math.cos(angle) * (e.radius + 6),
    y: e.y + Math.sin(angle) * (e.radius + 6),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: overrides.radius ?? def.projRadius ?? 7,
    dmg: (overrides.dmg ?? e.dmg) * world.run.enemyDmgMult,
    life: overrides.life ?? def.projLife ?? 2.5,
    status: overrides.status ?? def.applyStatus ?? null,
    color: overrides.color ?? def.accent ?? '#ffb347',
    hostile: true,
    owner: e,
  });
  world.bus.emit(EV.PROJECTILE_SPAWN, { x: e.x, y: e.y, angle });
}

/** '가시' 엘리트의 반격: 사방으로 탄을 뿌린다 */
export function retaliate(world, e, af) {
  for (let i = 0; i < af.count; i++) {
    const a = (i / af.count) * TAU + world.rng.float(0, 0.5);
    fireProjectile(world, e, world.player, {
      angle: a, speed: af.speed, dmg: af.dmg, radius: 7, life: 1.6, color: '#c07bff',
    });
  }
}

export function updateProjectiles(world, dt) {
  const p = world.player;
  const list = world.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;

    // 플레이어 편 투사체: 적을 관통하며 때린다
    if (!pr.hostile) {
      if (updateFriendlyProjectile(world, pr, dt)) list.splice(i, 1);
      continue;
    }

    let remove = pr.life <= 0;

    // 장애물에 막힘 → 엄폐가 의미를 갖는다
    if (!remove) {
      for (const o of world.obstacles) {
        if (Math.hypot(pr.x - o.x, pr.y - o.y) < o.radius + pr.radius) {
          world.bus.emit(EV.PROJECTILE_HIT, { x: pr.x, y: pr.y, color: pr.color });
          remove = true; break;
        }
      }
    }
    // 소환수가 몸으로 막는다 (해골 병사) — 진형이 의미를 갖는 지점
    if (!remove && blockProjectile(world, pr)) remove = true;

    // 아레나 밖
    const a = world.arena;
    if (!remove && (pr.x < a.pad || pr.y < a.pad || pr.x > a.width - a.pad || pr.y > a.height - a.pad)) {
      world.bus.emit(EV.PROJECTILE_HIT, { x: pr.x, y: pr.y, color: pr.color });
      remove = true;
    }
    // 플레이어 피격
    if (!remove && Math.hypot(pr.x - p.x, pr.y - p.y) < pr.radius + p.radius) {
      if (damagePlayer(world, pr.dmg, { fromX: pr.x, fromY: pr.y, source: pr.owner })) {
        if (pr.status) applyPlayerStatus(world, pr.status.kind);
        world.bus.emit(EV.PROJECTILE_HIT, { x: pr.x, y: pr.y, color: pr.color });
        remove = true;
      } else if (p.iframes > 0) {
        // 무적 중엔 관통 (대시로 탄을 뚫는 쾌감)
      }
    }
    if (remove) list.splice(i, 1);
  }
}
