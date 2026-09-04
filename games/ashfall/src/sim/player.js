// ============================================================
// 플레이어 컨트롤러: 이동 · 3~4연 콤보 · 대시(무적) · 무기별 특수기.
// 입력은 intent 객체로만 받는다 → 봇/테스트가 그대로 조종할 수 있다.
// ============================================================

import { PLAYER, PLAYER_STATUS, SIM, HITSTOP, SHAKE, INPUT_BUFFER } from '../data/balance.js';
import { EV } from '../core/events.js';
import { clamp, arcHit, normalize, dist, segCircleHit, TAU } from '../core/math.js';
import { damageEnemy, applyStatus, damagePlayer, explode, forEachEnemyInRange, runHooks, isDisabled } from './combat.js';
import { corpsesNear, consumeCorpse, summonMinion } from './minions.js';

export function createPlayer(world, weapon) {
  const L = world.loadout;
  const maxHp = PLAYER.MAX_HP + L.stats.maxHpBonus;
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    radius: PLAYER.RADIUS,
    hp: maxHp, maxHp,
    focus: PLAYER.MAX_FOCUS, maxFocus: PLAYER.MAX_FOCUS,
    facing: 0,
    state: 'free',
    dead: false,
    iframes: 0,
    hurtFlash: 0,
    // 공격
    atkStep: -1, atkPhase: '', atkT: 0, atkHits: null,
    comboTimer: 0, bufferAttack: 0, bufferDash: 0, bufferSpecial: 0, bufferCommand: 0,
    // 대시
    dashCharges: PLAYER.DASH_CHARGES + L.stats.dashCharges + (weapon.dashCharges || 0),
    maxDashCharges: PLAYER.DASH_CHARGES + L.stats.dashCharges + (weapon.dashCharges || 0),
    dashRecharge: 0, dashCd: 0, dashT: 0, dashDir: 0,
    dashStrikeT: 0, dashStrikeUsed: false,
    ramp: 0, rampT: 0,
    trail: [],
    status: {},
    // 특수기
    spT: 0, spPhase: '', spCd: 0, spTick: 0, spHits: null,
    // 연출용
    animT: 0, lastMoveDir: 0,
  };
}

export function refreshPlayerStats(world) {
  const p = world.player, L = world.loadout;
  const newMax = PLAYER.MAX_HP + L.stats.maxHpBonus + world.run.bonusMaxHp;
  const delta = newMax - p.maxHp;
  p.maxHp = newMax;
  if (delta > 0) p.hp = Math.min(p.maxHp, p.hp + delta); // 최대체력 증가분은 즉시 회복
  p.hp = Math.min(p.hp, p.maxHp);
  p.maxDashCharges = PLAYER.DASH_CHARGES + L.stats.dashCharges + world.run.bonusDashCharges + (world.weapon.dashCharges || 0);
  p.dashCharges = Math.min(p.dashCharges + Math.max(0, p.maxDashCharges - p.dashCharges), p.maxDashCharges);
}

/** intent: {mx,my, aimX,aimY, attack, dash, special} — mx/my 는 -1..1 */
export function updatePlayer(world, intent, dt) {
  const p = world.player;
  if (p.dead) return;
  const L = world.loadout;
  const W = world.weapon;

  p.animT += dt;
  if (p.iframes > 0) p.iframes -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
  if (p.comboTimer > 0) p.comboTimer -= dt;
  if (p.bufferAttack > 0) p.bufferAttack -= dt;
  if (p.bufferDash > 0) p.bufferDash -= dt;
  if (p.bufferSpecial > 0) p.bufferSpecial -= dt;
  if (p.bufferCommand > 0) p.bufferCommand -= dt;

  // 소환수 명령은 어떤 상태에서든(공격 중에도) 낼 수 있다 — 지휘는 행동을 끊지 않는다
  if (p.bufferCommand > 0 && world.commandCd <= 0) {
    if (world.issueCommand(intent.aimX, intent.aimY)) p.bufferCommand = 0;
  }
  if (p.dashCd > 0) p.dashCd -= dt;
  if (p.spCd > 0) p.spCd -= dt;
  if (p.dashStrikeT > 0) p.dashStrikeT -= dt;

  // 가속 감쇠: 공격을 멈추면 서서히 풀린다
  if (W.rampPerHit && p.ramp > 0) {
    p.rampT -= dt;
    if (p.rampT <= 0) p.ramp = Math.max(0, p.ramp - dt * (W.rampMax / W.rampDecay));
  }

  // 집중 자연회복 (감전되면 느려진다)
  const focusMult = p.status?.shock ? PLAYER_STATUS.shock.focusRegen : 1;
  p.focus = Math.min(p.maxFocus, p.focus + (PLAYER.FOCUS_REGEN + L.stats.focusRegen) * focusMult * dt);

  // 대시 충전 회복
  if (p.dashCharges < p.maxDashCharges) {
    p.dashRecharge += dt;
    if (p.dashRecharge >= PLAYER.DASH_RECHARGE * L.mods.dashCooldownMult * (world.weapon.dashCooldownMult || 1)) {
      p.dashRecharge = 0;
      p.dashCharges++;
    }
  }

  // 조준 방향 (전투 중엔 항상 마우스/타깃 방향을 본다)
  if (p.state !== 'dash') {
    const ax = intent.aimX - p.x, ay = intent.aimY - p.y;
    if (Math.hypot(ax, ay) > 4) p.facing = Math.atan2(ay, ax);
  }

  // ---- 입력 버퍼링 ----
  // 짧게 톡 누른 입력이 프레임 사이에 사라지지 않도록 모든 행동 키를 버퍼링한다.
  // (공격만 버퍼가 있으면 대시/특수기를 '눌렀는데 안 나가는' 순간이 생긴다)
  if (intent.attack) p.bufferAttack = INPUT_BUFFER;
  if (intent.dash) p.bufferDash = INPUT_BUFFER;
  if (intent.special) p.bufferSpecial = INPUT_BUFFER;
  if (intent.command) p.bufferCommand = INPUT_BUFFER;

  // ---- 상태별 처리 ----
  switch (p.state) {
    case 'dash': updateDash(world, p, dt); break;
    case 'attack': updateAttack(world, p, intent, dt); break;
    case 'special': updateSpecial(world, p, intent, dt); break;
    default: break;
  }

  // ---- 자유 상태에서의 행동 개시 ----
  if (p.state === 'free') {
    if (p.bufferDash > 0 && canDash(p)) { p.bufferDash = 0; startDash(world, p, intent); }
    else if (p.bufferSpecial > 0 && p.spCd <= 0 && p.focus >= specialCost(world)) {
      p.bufferSpecial = 0;
      startSpecial(world, p, intent);
    } else if (p.bufferAttack > 0) { startAttack(world, p); }
  }

  // ---- 이동 ----
  moveStep(world, p, intent, dt);
  resolveCollisions(world, p);
  clampToArena(world, p);

  // 대시 잔상
  if (p.state === 'dash' || p.trail.length) {
    p.trail.push({ x: p.x, y: p.y, life: 0.22 });
    for (let i = p.trail.length - 1; i >= 0; i--) {
      p.trail[i].life -= dt;
      if (p.trail[i].life <= 0) p.trail.splice(i, 1);
    }
  }
}

// ---------------- 이동 ----------------

function moveScaleFor(world, p) {
  if (p.state === 'dash') return 0;
  if (p.state === 'attack') {
    const step = world.weapon.combo[p.atkStep];
    if (!step) return 1;
    const m = step.move;
    if (typeof m === 'number') return m;
    return m?.[p.atkPhase] ?? 0.5;
  }
  if (p.state === 'special') {
    const sp = world.weapon.special;
    if (sp.kind === 'whirl') return sp.moveScale;
    return 0;
  }
  return 1;
}

function moveStep(world, p, intent, dt) {
  const L = world.loadout;
  if (p.state === 'dash') {
    p.x += Math.cos(p.dashDir) * PLAYER.DASH_SPEED * dt;
    p.y += Math.sin(p.dashDir) * PLAYER.DASH_SPEED * dt;
    return;
  }
  if (p.state === 'special' && world.weapon.special.kind === 'dashSlash') {
    p.x += Math.cos(p.spDir) * world.weapon.special.speed * dt;
    p.y += Math.sin(p.spDir) * world.weapon.special.speed * dt;
    return;
  }

  const scale = moveScaleFor(world, p);
  const chill = p.status?.chill ? 1 - PLAYER_STATUS.chill.slow : 1;
  const speed = PLAYER.MOVE_SPEED * L.stats.moveMult * world.weapon.moveMult * scale * chill;
  const n = normalize(intent.mx, intent.my);
  const targetVx = n.x * speed, targetVy = n.y * speed;
  const hasInput = Math.hypot(intent.mx, intent.my) > 0.01;

  if (hasInput) {
    p.lastMoveDir = Math.atan2(n.y, n.x);
    p.vx += (targetVx - p.vx) * Math.min(1, PLAYER.ACCEL * dt / Math.max(speed, 1));
    p.vy += (targetVy - p.vy) * Math.min(1, PLAYER.ACCEL * dt / Math.max(speed, 1));
  }
  // 마찰 (넉백 감쇠 포함)
  const f = Math.exp(-PLAYER.FRICTION * dt);
  if (!hasInput) { p.vx *= f; p.vy *= f; }
  else {
    // 입력 중에도 넉백 성분은 감쇠시킨다
    const over = Math.hypot(p.vx, p.vy) - speed;
    if (over > 0) {
      const k = (speed + over * f) / Math.max(1e-6, Math.hypot(p.vx, p.vy));
      p.vx *= k; p.vy *= k;
    }
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function resolveCollisions(world, p) {
  for (const o of world.obstacles) {
    const dx = p.x - o.x, dy = p.y - o.y;
    const d = Math.hypot(dx, dy);
    const min = p.radius + o.radius;
    if (d < min && d > 1e-5) {
      p.x = o.x + (dx / d) * min;
      p.y = o.y + (dy / d) * min;
    }
  }
}

function clampToArena(world, p) {
  const a = world.arena;
  p.x = clamp(p.x, a.pad + p.radius, a.width - a.pad - p.radius);
  p.y = clamp(p.y, a.pad + p.radius, a.height - a.pad - p.radius);
}

// ---------------- 대시 ----------------

function canDash(p) {
  return p.dashCharges > 0 && p.dashCd <= 0;
}

export function startDash(world, p, intent, opts = {}) {
  const dirX = Math.abs(intent.mx) + Math.abs(intent.my) > 0.01 ? intent.mx : Math.cos(p.facing);
  const dirY = Math.abs(intent.mx) + Math.abs(intent.my) > 0.01 ? intent.my : Math.sin(p.facing);
  const n = normalize(dirX, dirY, Math.cos(p.facing), Math.sin(p.facing));
  p.dashDir = Math.atan2(n.y, n.x);
  p.state = 'dash';
  p.dashT = PLAYER.DASH_TIME;
  p.dashCharges--;
  p.dashCd = PLAYER.DASH_COOLDOWN * world.loadout.mods.dashCooldownMult * (world.weapon.dashCooldownMult || 1);
  p.iframes = Math.max(p.iframes, PLAYER.DASH_IFRAMES + (world.weapon.dashIframeBonus || 0));
  p.vx = 0; p.vy = 0;
  if (opts.keepCombo) {
    // 대시 캔슬로 회피해도 콤보는 이어진다 — 회피가 딜 손실이 되지 않게 한다
    p.comboTimer = world.weapon.comboWindow + world.loadout.mods.comboWindowBonus;
  } else {
    p.atkStep = -1;
    p.comboTimer = 0;
  }
  p.atkPhase = '';
  world.bus.emit(EV.DASH, { x: p.x, y: p.y, dir: p.dashDir });
  runHooks(world, 'dashStart', { x: p.x, y: p.y });
}

function updateDash(world, p, dt) {
  p.dashT -= dt;
  // 대시 경로 훅 (서리 자취 / 뇌전 질주)
  runHooks(world, 'dashTrail', { x: p.x, y: p.y });
  if (p.dashT <= 0) {
    p.state = 'free';
    const L = world.loadout;
    p.dashStrikeT = Math.max(L.mods.dashStrikeWindow, world.weapon.dashCancel ? 0.5 : 0);
    p.vx = Math.cos(p.dashDir) * 180;
    p.vy = Math.sin(p.dashDir) * 180;
    runHooks(world, 'dashEnd', { x: p.x, y: p.y });
  }
}

// ---------------- 기본공격 ----------------

function startAttack(world, p) {
  const W = world.weapon;
  p.bufferAttack = 0;
  const next = p.comboTimer > 0 ? (p.atkStep + 1) % W.combo.length : 0;
  p.atkStep = next;
  p.atkPhase = 'windup';
  p.atkT = W.combo[next].windup / (world.loadout.stats.attackSpeed * corpseHasteMult(world));
  p.atkHits = new Set();
  p.state = 'attack';
  const step = W.combo[next];
  // 전진(lunge)
  p.vx += Math.cos(p.facing) * step.lunge;
  p.vy += Math.sin(p.facing) * step.lunge;
}

/** 강령장: 주변 시체가 많을수록 빨라진다 — 시체 위에서 싸우게 만드는 압력 */
export function corpseHasteMult(world) {
  const ch = world.weapon.corpseHaste;
  if (!ch) return 1;
  const n = corpsesNear(world, world.player.x, world.player.y, ch.radius).length;
  return 1 + Math.min(ch.max, ch.perCorpse * n);
}

function updateAttack(world, p, intent, dt) {
  const W = world.weapon;
  const step = W.combo[p.atkStep];
  const spd = world.loadout.stats.attackSpeed * corpseHasteMult(world);
  p.atkT -= dt;

  // 대시 캔슬 — 후딜을 대시로 끊는 것이 이 장르의 기본기.
  // dashCancel 무기(쌍아검)는 '이미 적중한' 판정 중에도 끊을 수 있다(히트 컨펌 캔슬).
  // 빗나간 스윙까지 캔슬되면 자기 공격을 스스로 지우게 되므로 허용하지 않는다.
  const cancelable = p.atkPhase === 'recover' ||
    (W.dashCancel && p.atkPhase === 'active' && p.atkHits.size > 0);
  if (cancelable && p.bufferDash > 0 && canDash(p)) {
    p.bufferDash = 0;
    startDash(world, p, intent, { keepCombo: !!W.dashCancel });
    return;
  }

  if (p.atkPhase === 'windup' && p.atkT <= 0) {
    p.atkPhase = 'active';
    p.atkT = step.active / spd;
    world.bus.emit(EV.ATTACK, { x: p.x, y: p.y, dir: p.facing, step: p.atkStep, weapon: W.id, heavy: !!step.heavy, arc: step.arc, range: step.range });
    // 무기 전용 권능의 연결점: "몇 번째 타가 나갔는가"
    runHooks(world, 'attackStep', { step: p.atkStep, dir: p.facing, x: p.x, y: p.y, tag: 'attack' });
    if (step.shockwave) {
      world.bus.emit(EV.SHOCKWAVE, { x: p.x, y: p.y, radius: step.range, color: W.color });
      world.shake(SHAKE.HEAVY);
    }
  } else if (p.atkPhase === 'active') {
    doSwingHit(world, p, step);
    if (p.atkT <= 0) {
      p.atkPhase = 'recover';
      p.atkT = step.recover / spd;
      if (p.dashStrikeUsed) { p.dashStrikeT = 0; p.dashStrikeUsed = false; }
      // 마무리 타가 적중하면 대시 강타가 다시 열린다 (공격적 순환 루프)
      if (W.dashStrikeOnFinisher && p.atkStep === W.combo.length - 1 && p.atkHits.size > 0) {
        p.dashStrikeT = W.dashStrikeOnFinisher;
      }
    }
  } else if (p.atkPhase === 'recover' && p.atkT <= 0) {
    p.state = 'free';
    p.atkPhase = '';
    p.comboTimer = W.comboWindow + world.loadout.mods.comboWindowBonus;
    // 마지막 타 후에는 콤보가 끊긴다 — '연격' 권능이 있으면 계속 이어진다
    if (p.atkStep >= W.combo.length - 1 && world.loadout.mods.comboWindowBonus <= 0) p.comboTimer = 0;
  }
}

function doSwingHit(world, p, step) {
  const W = world.weapon;
  const half = (step.arc * Math.PI) / 360;
  const L = world.loadout;
  for (const e of world.enemies) {
    if (e.dead || p.atkHits.has(e)) continue;
    if (!arcHit(p.x, p.y, p.facing, half, step.range, e.x, e.y, e.radius)) continue;
    p.atkHits.add(e);

    let dmg = step.dmg;
    // 대시 직후 강타 (쌍아검 고유 + 피의 신 권능)
    let dashStruck = false;
    if (p.dashStrikeT > 0) {
      const bonus = (W.dashStrikeMult ? W.dashStrikeMult - 1 : 0) + L.mods.dashStrikeMult;
      if (bonus > 0) {
        dmg *= 1 + bonus;
        dashStruck = true;
        p.dashStrikeUsed = true; // 스윙이 끝날 때 소모 — 광역 타격 전체가 강타로 들어간다
        world.bus.emit(EV.STATUS, { x: e.x, y: e.y, kind: 'dashStrike' });
      }
    }

    if (W.rampPerHit) dmg *= 1 + p.ramp;

    damageEnemy(world, e, dmg, 'none', {
      tag: 'attack', knock: step.knock, dir: p.facing, heavy: step.heavy, step: p.atkStep,
    });

    if (W.rampPerHit) {
      p.ramp = Math.min(W.rampMax, p.ramp + W.rampPerHit);
      p.rampT = W.rampDecay;
    }
    if (dashStruck) runHooks(world, 'dashStrike', { target: e, dmg, dir: p.facing, x: e.x, y: e.y, tag: 'attack' });
    for (const s of L.attackStatus) applyStatus(world, e, s.kind, s.stacks);
  }
}

// ---------------- 특수기 ----------------

export function specialCost(world) {
  return world.weapon.special.cost * world.loadout.mods.specialCostMult;
}

function startSpecial(world, p, intent) {
  const sp = world.weapon.special;
  p.focus -= specialCost(world);
  p.spCd = sp.cooldown;
  p.state = 'special';
  p.spDir = p.facing;
  p.spHits = new Set();
  p.spTick = 0;
  p.spStartX = p.x; p.spStartY = p.y;
  p.vx = 0; p.vy = 0;

  world.bus.emit(EV.SPECIAL, { x: p.x, y: p.y, dir: p.facing, weapon: world.weapon.id, kind: sp.kind });
  runHooks(world, 'special', { x: p.x, y: p.y });

  if (sp.kind === 'dashSlash') {
    p.spT = sp.range / sp.speed;
    p.iframes = Math.max(p.iframes, p.spT + 0.1);
  } else if (sp.kind === 'groundSlam') {
    p.spT = sp.chargeTime;
    p.spPhase = 'charge';
    p.iframes = Math.max(p.iframes, sp.chargeTime + 0.12);
  } else if (sp.kind === 'whirl') {
    p.spT = sp.duration;
  } else if (sp.kind === 'raiseDead') {
    p.spT = 0.42;
    p.spPhase = 'raise';
    p.iframes = Math.max(p.iframes, 0.3);
    doRaiseDead(world, p, sp);
  }
}

/** 망자 봉기: 주변 시체를 해골 병사로 일으킨다. 시체가 없으면 영혼 파동. */
function doRaiseDead(world, p, sp) {
  const L = world.loadout;
  const list = corpsesNear(world, p.x, p.y, sp.radius);
  const max = sp.maxRaise + L.mods.minionCap;
  let raised = 0;
  for (const c of list) {
    if (raised >= max) break;
    if (!consumeCorpse(world, c)) continue;
    const archer = (L.mods.archerChance || 0) > 0 && world.rng.next() < L.mods.archerChance;
    summonMinion(world, archer ? 'bonearcher' : sp.minion, c.x, c.y, { scale: c.scale });
    for (const s of L.specialStatus) { /* 상태이상은 소환수 타격으로 전달된다 */ }
    raised++;
  }
  if (raised === 0) {
    // 시체가 없으면 화력으로 전환 — 자원이 없다고 특수기가 무용지물이 되지 않게
    world.bus.emit(EV.SHOCKWAVE, { x: p.x, y: p.y, radius: sp.fallbackRadius, color: world.weapon.color, big: true });
    world.shake(SHAKE.HEAVY);
    forEachEnemyInRange(world, p.x, p.y, sp.fallbackRadius, (e) => {
      damageEnemy(world, e, sp.fallbackDmg, 'necro', {
        tag: 'special', knock: 300, dir: Math.atan2(e.y - p.y, e.x - p.x), heavy: true,
      });
      for (const s of L.specialStatus) applyStatus(world, e, s.kind, s.stacks);
    });
  } else {
    world.bus.emit('raiseDead', { x: p.x, y: p.y, count: raised });
  }
}

function updateSpecial(world, p, intent, dt) {
  const sp = world.weapon.special;
  const L = world.loadout;
  p.spT -= dt;

  if (sp.kind === 'dashSlash') {
    // 이동은 moveStep 에서 처리. 지나간 선분상의 적을 벤다.
    for (const e of world.enemies) {
      if (e.dead || p.spHits.has(e)) continue;
      if (!segCircleHit(p.spStartX, p.spStartY, p.x, p.y, e.x, e.y, e.radius + sp.width / 2)) continue;
      p.spHits.add(e);
      damageEnemy(world, e, sp.dmg, 'none', { tag: 'special', knock: 220, dir: p.spDir, heavy: true });
      for (const s of L.specialStatus) applyStatus(world, e, s.kind, s.stacks);
    }
    if (p.spT <= 0) { p.state = 'free'; p.spPhase = ''; }
    return;
  }

  if (sp.kind === 'groundSlam') {
    if (p.spPhase === 'charge') {
      // 조준 방향으로 살짝 도약
      p.x += Math.cos(p.spDir) * 210 * dt;
      p.y += Math.sin(p.spDir) * 210 * dt;
      if (p.spT <= 0) {
        p.spPhase = 'impact';
        p.spT = 0.22;
        world.bus.emit(EV.SHOCKWAVE, { x: p.x, y: p.y, radius: sp.radius, color: world.weapon.color });
        world.shake(SHAKE.BOSS_SLAM);
        world.hitstop = Math.max(world.hitstop, HITSTOP.HEAVY);
        forEachEnemyInRange(world, p.x, p.y, sp.radius, (e) => {
          damageEnemy(world, e, sp.dmg, 'none', { tag: 'special', knock: 420, dir: Math.atan2(e.y - p.y, e.x - p.x), heavy: true });
          for (const s of L.specialStatus) applyStatus(world, e, s.kind, s.stacks);
        });
      }
    } else if (p.spT <= 0) { p.state = 'free'; p.spPhase = ''; }
    return;
  }

  if (sp.kind === 'raiseDead') {
    p.vx *= 0.88; p.vy *= 0.88;
    if (p.spT <= 0) { p.state = 'free'; p.spPhase = ''; }
    return;
  }

  if (sp.kind === 'whirl') {
    p.facing += TAU * 2.2 * dt; // 회전 연출 겸 판정 방향
    p.spTick -= dt;
    if (p.spTick <= 0) {
      p.spTick = sp.tickRate;
      forEachEnemyInRange(world, p.x, p.y, sp.radius, (e) => {
        damageEnemy(world, e, sp.dmg, 'none', { tag: 'special', knock: 70, dir: Math.atan2(e.y - p.y, e.x - p.x) });
        for (const s of L.specialStatus) applyStatus(world, e, s.kind, s.stacks);
      });
      world.bus.emit(EV.SHOCKWAVE, { x: p.x, y: p.y, radius: sp.radius, color: world.weapon.color, weak: true });
    }
    if (p.spT <= 0) { p.state = 'free'; p.spPhase = ''; }
  }
}
