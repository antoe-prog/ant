// ============================================================
// 보스 AI: 페이즈 기반 패턴 선택기.
// 모든 패턴은 예고(telegraph) 후 실행되며, 페이즈가 내려갈수록 빨라진다.
// ============================================================

import { EV } from '../core/events.js';
import { SHAKE, HITSTOP } from '../data/balance.js';
import { clamp, dist, normalize, TAU, rotateToward } from '../core/math.js';
import { damagePlayer, statusSpeedMult, isDisabled, applyPlayerStatus, forEachEnemyInRange } from './combat.js';
import { damageMinionsInRange } from './minions.js';
import { fireProjectile } from './enemyAI.js';

export function updateBoss(world, b, dt) {
  const p = world.player;
  if (b.hurtFlash > 0) b.hurtFlash -= dt;
  if (b.tele) { b.tele.t -= dt; if (b.tele.t <= 0) b.tele = null; }
  if (b.spawnT > 0) { b.spawnT -= dt; return; }

  // 페이즈 전환
  const ratio = b.hp / b.maxHp;
  let phaseIdx = 0;
  for (let i = 0; i < b.def.phases.length; i++) if (ratio <= b.def.phases[i].at) phaseIdx = i;
  if (phaseIdx !== b.phaseIdx) {
    b.phaseIdx = phaseIdx;
    b.state = 'phaseShift';
    b.t = 1.0;
    b.invuln = 1.0;
    world.bus.emit(EV.BOSS_PHASE, { phase: phaseIdx, boss: b });
    world.shake(SHAKE.EXPLOSION);
    world.hitstop = Math.max(world.hitstop, 0.16);
  }
  const phase = b.def.phases[b.phaseIdx];

  if (b.invuln > 0) b.invuln -= dt;
  if (isDisabled(b)) { applyBossPhysics(world, b, dt); return; }
  if (b.staggerT > 0) { b.staggerT -= dt; b.vx *= 0.9; b.vy *= 0.9; applyBossPhysics(world, b, dt); return; }

  const slow = statusSpeedMult(b);
  b.t -= dt;
  if (b.cd > 0) b.cd -= dt;

  switch (b.state) {
    case 'phaseShift': {
      b.vx *= 0.85; b.vy *= 0.85;
      // 페이즈 전환 시 링 버스트로 공간을 정리
      if (b.t <= 0) { b.state = 'idle'; b.cd = 0.5; }
      break;
    }
    case 'telegraph': {
      b.facing = rotateToward(b.facing, Math.atan2(p.y - b.y, p.x - b.x), 2.4 * dt);
      b.vx *= 0.88; b.vy *= 0.88;
      if (b.t <= 0) startPattern(world, b, phase);
      break;
    }
    case 'exec': {
      execPattern(world, b, phase, dt);
      break;
    }
    default: {
      // 접근/배회
      const d = dist(b.x, b.y, p.x, p.y);
      const speed = b.def.speed * (phase.speedMult || 1) * world.run.enemySpeedMult;
      if (d > 130) {
        const n = normalize(p.x - b.x, p.y - b.y);
        b.vx += (n.x * speed * slow - b.vx) * Math.min(1, 6 * dt);
        b.vy += (n.y * speed * slow - b.vy) * Math.min(1, 6 * dt);
        b.facing = Math.atan2(p.y - b.y, p.x - b.x);
      } else { b.vx *= 0.9; b.vy *= 0.9; }

      if (b.cd <= 0) choosePattern(world, b, phase);
    }
  }

  applyBossPhysics(world, b, dt);
  bossBodyPush(world, b, dt);
}

function applyBossPhysics(world, b, dt) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const f = Math.exp(-7 * dt);
  b.vx *= f; b.vy *= f;
  const a = world.arena;
  b.x = clamp(b.x, a.pad + b.radius, a.width - a.pad - b.radius);
  b.y = clamp(b.y, a.pad + b.radius, a.height - a.pad - b.radius);
}

/**
 * 보스 몸통은 피해를 주지 않고 "밀어낸다".
 * 근접해서 때리는 것이 핵심인 게임에서 몸통 접촉 피해는 근접 자체를 처벌한다.
 * 보스의 피해는 전부 예고된 패턴에서만 나온다 → 읽고 대응하면 안 맞을 수 있다.
 */
function bossBodyPush(world, b, dt) {
  const p = world.player;
  const dx = p.x - b.x, dy = p.y - b.y;
  const d = Math.hypot(dx, dy);
  const min = b.radius + p.radius;
  if (d < min && d > 1e-5) {
    const k = (min - d);
    p.x += (dx / d) * k;
    p.y += (dy / d) * k;
  }
}

function choosePattern(world, b, phase) {
  const name = world.rng.pick(phase.patterns);
  const pat = b.def.patterns[name];
  if (!pat) { b.cd = 0.6; return; }
  b.pattern = pat;
  b.patternName = name;
  b.state = 'telegraph';
  b.t = pat.telegraph;
  b.tele = makeTelegraph(world, b, pat);
}

function makeTelegraph(world, b, pat) {
  const t = { t: pat.telegraph, maxT: pat.telegraph, kind: pat.kind };
  if (pat.kind === 'slam') { t.kind = 'circle'; t.radius = pat.radius; t.x = b.x; t.y = b.y; }
  else if (pat.kind === 'charge') { t.kind = 'line'; t.range = pat.speed * pat.time; }
  else if (pat.kind === 'aimedVolley') { t.kind = 'aim'; t.range = 560; }
  else if (pat.kind === 'ringBurst') { t.kind = 'ring'; t.radius = 90; }
  else if (pat.kind === 'blink') { t.kind = 'blink'; t.radius = pat.radius; }
  else if (pat.kind === 'summon') { t.kind = 'summon'; t.radius = 110; }
  else if (pat.kind === 'raise') { t.kind = 'summon'; t.radius = 150; }
  return t;
}

function startPattern(world, b, phase) {
  const pat = b.pattern;
  b.state = 'exec';
  b.execT = 0;
  b.wave = 0;
  b.waveTimer = 0;
  b.repeat = pat.repeats || 1;

  switch (pat.kind) {
    case 'slam':
      doSlam(world, b, pat);
      b.t = 0.42;
      break;
    case 'charge':
      b.chargeDir = Math.atan2(world.player.y - b.y, world.player.x - b.x);
      b.vx = Math.cos(b.chargeDir) * pat.speed;
      b.vy = Math.sin(b.chargeDir) * pat.speed;
      b.t = pat.time;
      break;
    case 'ringBurst':
      b.waveTimer = 0;
      b.t = (pat.waves || 1) * (pat.waveGap || 0.3) + 0.2;
      break;
    case 'aimedVolley':
      b.waveTimer = 0;
      b.t = (pat.waves || 1) * (pat.waveGap || 0.25) + 0.2;
      break;
    case 'blink':
      doBlink(world, b, pat);
      b.t = 0.3;
      break;
    case 'summon':
      doSummon(world, b, pat);
      b.t = 0.5;
      break;
    case 'raise':
      doRaise(world, b, pat);
      b.t = 0.55;
      break;
    default:
      b.t = 0.3;
  }
}

function execPattern(world, b, phase, dt) {
  const pat = b.pattern;
  b.execT += dt;

  if (pat.kind === 'charge') {
    b.vx = Math.cos(b.chargeDir) * pat.speed;
    b.vy = Math.sin(b.chargeDir) * pat.speed;
    if (dist(b.x, b.y, world.player.x, world.player.y) < b.radius + world.player.radius + 4) {
      damagePlayer(world, pat.dmg * world.run.enemyDmgMult * b.dmgMult, { fromX: b.x, fromY: b.y, source: b });
    }
    // 돌진 경로의 소환수도 밀려 부서진다
    damageMinionsInRange(world, b.x, b.y, b.radius + 18, pat.dmg * world.run.enemyDmgMult * b.dmgMult);
    if (b.t <= 0) {
      b.repeat--;
      if (b.repeat > 0) {
        b.state = 'telegraph';
        b.t = pat.repeatGap || 0.25;
        b.tele = makeTelegraph(world, b, { ...pat, telegraph: b.t });
      } else finishPattern(world, b, phase);
    }
    return;
  }

  if (pat.kind === 'ringBurst' || pat.kind === 'aimedVolley') {
    b.vx *= 0.9; b.vy *= 0.9;
    b.waveTimer -= dt;
    const waves = pat.waves || 1;
    if (b.waveTimer <= 0 && b.wave < waves) {
      b.waveTimer = pat.waveGap || 0.3;
      if (pat.kind === 'ringBurst') doRing(world, b, pat, b.wave);
      else doVolley(world, b, pat);
      b.wave++;
    }
    if (b.t <= 0) finishPattern(world, b, phase);
    return;
  }

  b.vx *= 0.88; b.vy *= 0.88;
  if (b.t <= 0) finishPattern(world, b, phase);
}

function finishPattern(world, b, phase) {
  b.state = 'idle';
  const [lo, hi] = b.def.patternCooldown;
  b.cd = world.rng.float(lo, hi) * (phase.cooldownMult || 1);
  b.pattern = null;
}

// ---------------- 개별 패턴 ----------------

function doSlam(world, b, pat) {
  world.bus.emit(EV.SHOCKWAVE, { x: b.x, y: b.y, radius: pat.radius, color: b.def.accent, big: true });
  world.shake(SHAKE[pat.shake] || SHAKE.BOSS_SLAM);
  world.hitstop = Math.max(world.hitstop, HITSTOP.HEAVY);
  const p = world.player;
  if (dist(b.x, b.y, p.x, p.y) < pat.radius + p.radius) {
    if (damagePlayer(world, pat.dmg * world.run.enemyDmgMult * b.dmgMult, { fromX: b.x, fromY: b.y, source: b }) && pat.status) {
      applyPlayerStatus(world, pat.status.kind);
    }
  }
}

function doRing(world, b, pat, waveIdx) {
  const n = pat.count;
  const base = (pat.rotate || 0) * waveIdx + (b.ringPhase || 0);
  for (let i = 0; i < n; i++) {
    const a = base + (i / n) * TAU;
    fireProjectile(world, b, world.player, {
      angle: a, speed: pat.projSpeed, dmg: pat.dmg * b.dmgMult, radius: 9, life: 3.4,
      status: pat.status || null, color: b.def.accent,
    });
  }
  world.shake(SHAKE.LIGHT * 2);
}

function doVolley(world, b, pat) {
  const p = world.player;
  const base = Math.atan2(p.y - b.y, p.x - b.x);
  const n = pat.count;
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : ((i / (n - 1)) - 0.5) * 2 * pat.spread;
    fireProjectile(world, b, p, {
      angle: base + off, speed: pat.projSpeed, dmg: pat.dmg * b.dmgMult, radius: 8, life: 3.0,
      status: pat.status || null, color: b.def.accent,
    });
  }
}

function doBlink(world, b, pat) {
  const p = world.player;
  world.bus.emit(EV.EXPLOSION, { x: b.x, y: b.y, radius: 70, element: 'frost' });
  const a = world.rng.float(0, TAU);
  const r = 150;
  b.x = clamp(p.x + Math.cos(a) * r, world.arena.pad + b.radius, world.arena.width - world.arena.pad - b.radius);
  b.y = clamp(p.y + Math.sin(a) * r, world.arena.pad + b.radius, world.arena.height - world.arena.pad - b.radius);
  world.bus.emit(EV.EXPLOSION, { x: b.x, y: b.y, radius: pat.radius, element: 'frost' });
  damageMinionsInRange(world, b.x, b.y, pat.radius, pat.dmg * world.run.enemyDmgMult * b.dmgMult * 1.2);
  if (dist(b.x, b.y, p.x, p.y) < pat.radius + p.radius) {
    damagePlayer(world, pat.dmg * world.run.enemyDmgMult * b.dmgMult, { fromX: b.x, fromY: b.y, source: b });
  }
}

/**
 * 전장의 시체를 되살린다.
 * 플레이어가 시체를 자원으로 쓰는 만큼, 보스도 같은 자원을 노린다.
 * → 사령술 빌드는 "시체를 남겨둘지 즉시 소비할지"를 보스전에서도 고민하게 된다.
 */
function doRaise(world, b, pat) {
  const list = world.corpses.filter((c) => !c.used)
    .sort((x, y) => dist(b.x, b.y, x.x, x.y) - dist(b.x, b.y, y.x, y.y))
    .slice(0, pat.count);

  if (!list.length) {
    // 시체가 없으면 직접 소환으로 대체 (패턴이 헛돌지 않게)
    world.bus.emit(EV.EXPLOSION, { x: b.x, y: b.y, radius: 120, element: 'necro' });
    for (let i = 0; i < 2; i++) {
      const a = world.rng.float(0, TAU);
      world.spawnEnemy('cinderling', b.x + Math.cos(a) * 180, b.y + Math.sin(a) * 180, {});
    }
    return;
  }
  for (const c of list) {
    c.used = true;
    const e = world.spawnEnemy(c.enemyId, c.x, c.y, {});
    if (e) {
      e.hp = e.maxHp = e.maxHp * pat.hpMult;
      e.noCorpse = true;      // 무한 부활 고리 방지
      e.revived = true;
    }
    world.bus.emit(EV.EXPLOSION, { x: c.x, y: c.y, radius: 70, element: 'necro' });
  }
  world.shake(SHAKE.EXPLOSION * 0.7);
}

function doSummon(world, b, pat) {
  for (const s of pat.spawn) {
    for (let i = 0; i < s.n; i++) {
      const a = world.rng.float(0, TAU);
      const r = world.rng.float(120, 240);
      world.spawnEnemy(s.id, b.x + Math.cos(a) * r, b.y + Math.sin(a) * r, { summoned: true });
    }
  }
  world.bus.emit(EV.EXPLOSION, { x: b.x, y: b.y, radius: 130, element: 'storm' });
}
