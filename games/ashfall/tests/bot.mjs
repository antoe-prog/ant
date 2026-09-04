// 헤드리스 자동 플레이 봇: 시뮬레이션 계층만으로 런을 끝까지 돌린다.
// 렌더/오디오/DOM 없이 게임 루프 전체(전투→클리어→문→보상→보스→승리)를 검증한다.

import { createWorld } from '../src/sim/world.js';
import { createRun } from '../src/sim/run.js';
import { SIM } from '../src/data/balance.js';
import { EV } from '../src/core/events.js';
import { dist } from '../src/core/math.js';

export function simulateRun({ seed = 1, weaponId = 'emberblade', maxSeconds = 1500, skill = 1, metaEffects = {}, onEvent } = {}) {
  const world = createWorld({ seed, weaponId, metaEffects });
  const director = createRun(world);
  const log = { rooms: 0, kills: 0, boons: [], events: [], damageTaken: 0, bossPhases: 0 };

  world.bus.on('*', (type, payload) => {
    if (type === EV.BOON_TAKEN) log.boons.push(payload.boon.title + ' L' + payload.level);
    if (type === EV.ROOM_CLEAR) log.rooms++;
    if (type === EV.BOSS_PHASE) log.bossPhases++;
    if (onEvent) onEvent(type, payload);
  });

  director.start();

  const dt = SIM.DT;
  let t = 0;
  let guard = 0;
  let roomStart = 0;
  log.slowRooms = [];
  world.bus.on(EV.ROOM_CLEAR, () => {
    const d = t - roomStart;
    if (d > 90) log.slowRooms.push({ room: `${world.run.biomeIdx + 1}-${world.run.roomIdx + 1}`, sec: +d.toFixed(0) });
    roomStart = t;
  });
  const maxSteps = Math.ceil(maxSeconds / dt);

  while (t < maxSeconds && guard++ < maxSteps) {
    const run = world.run;

    // --- 메뉴 상태 자동 처리 ---
    if (run.state === 'reward') { director.chooseReward(pickBoon(world, director)); continue; }
    if (run.state === 'curse') { director.chooseCurse(0); continue; }
    if (run.state === 'shop') {
      let bought = true;
      while (bought) {
        bought = false;
        for (let i = 0; i < director.shopItems.length; i++) {
          if (!director.shopItems[i].sold && run.gold >= director.shopItems[i].cost) { director.buyShop(i); bought = true; }
        }
      }
      director.leaveShop();
      continue;
    }
    if (run.state === 'dead' || run.state === 'victory') break;

    const intent = botIntent(world, skill);
    director.update(dt);
    world.step(intent, dt);
    t += dt;
  }

  log.kills = world.run.kills;
  log.damageTaken = world.run.damageTaken;
  return { world, director, log, elapsed: t, outcome: world.run.state };
}

function pickBoon(world, director) {
  // 같은 신에 몰아주는 봇 (합일 권능 해금 경로 검증)
  const opts = director.rewardOptions || [];
  let best = 0;
  for (let i = 0; i < opts.length; i++) {
    if (opts[i].duo) return i;
    if (opts[i].god === 'ember' || opts[i].god === 'storm') best = i;
  }
  return best;
}

/** 문 선택도 플레이어의 결정이다 — 봇도 의미 있게 고른다. */
function chooseDoor(world) {
  const p = world.player;
  const hurt = p.hp < p.maxHp * 0.6;
  let best = null, bestScore = -Infinity;
  for (const d of world.doors) {
    let score = 0;
    switch (d.reward.kind) {
      case 'boon': score = 100; break;
      case 'boonUpgrade': score = 80; break;
      case 'heal': score = hurt ? 110 : 20; break;
      case 'weaponUpgrade': score = 70; break;
      case 'maxhp': score = 60; break;
      case 'shop': score = world.run.gold > 70 ? 65 : 25; break;
      case 'gold': score = 30; break;
      default: score = 50;
    }
    if (d.elite) score += 15; // 위험을 감수하고 더 좋은 보상
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best || world.doors[0];
}

/** 숙련된 플레이어를 흉내내는 봇: 예고를 읽고 회피, 틈에 공격. */
export function botIntent(world, skill) {
  const p = world.player;
  const intent = { mx: 0, my: 0, aimX: p.x + 1, aimY: p.y, attack: false, dash: false, special: false };

  if (world.run.state === 'cleared') {
    const d = chooseDoor(world);
    if (d) {
      const dx = d.x - p.x, dy = d.y - p.y, len = Math.hypot(dx, dy) || 1;
      intent.mx = dx / len; intent.my = dy / len;
      intent.aimX = d.x; intent.aimY = d.y;
    }
    return intent;
  }

  let target = null, bestD = Infinity;
  for (const e of world.enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bestD) { bestD = d; target = e; }
  }
  if (!target) return intent;

  intent.aimX = target.x; intent.aimY = target.y;
  const dx = target.x - p.x, dy = target.y - p.y, len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;

  // --- 위협 평가: avoid(계속 벗어나기) / emergency(즉시 대시) ---
  let avoidX = 0, avoidY = 0, emergency = false;
  const push = (ax, ay, urgent) => {
    const l = Math.hypot(ax, ay) || 1;
    avoidX += ax / l; avoidY += ay / l;
    if (urgent) emergency = true;
  };

  for (const e of world.enemies) {
    if (e.dead) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (e.tele) {
      const reach = (e.tele.radius || e.tele.range || 110) + p.radius + 16;
      if (e.tele.kind === 'line') {
        // 직선 돌진: 옆으로 피한다
        if (d < reach) push(-Math.sin(e.facing), Math.cos(e.facing), e.tele.t < 0.28);
      } else if (d < reach) {
        push(p.x - e.x, p.y - e.y, e.tele.t < 0.3);
      }
    }
    if (e.state === 'charge' && d < 170) push(-Math.sin(e.chargeDir || e.facing), Math.cos(e.chargeDir || e.facing), d < 110);
    if (e.isBoss && e.state === 'exec' && d < e.radius + 70) push(p.x - e.x, p.y - e.y, false);
  }
  for (const pr of world.projectiles) {
    const cur = Math.hypot(pr.x - p.x, pr.y - p.y);
    if (cur > 190) continue; // 멀리 있는 탄까지 피하면 아무것도 못 죽인다
    const t = 0.3;
    const fx = pr.x + pr.vx * t, fy = pr.y + pr.vy * t;
    if (Math.hypot(fx - p.x, fy - p.y) < pr.radius + p.radius + 26) push(-pr.vy, pr.vx, cur < 110);
  }

  const desired = target.radius + p.radius + (target.isBoss ? 34 : 22);
  const lowHp = p.hp < p.maxHp * 0.28;

  // 접근 벡터
  let apX, apY;
  if (bestD > desired + 10) { apX = nx; apY = ny; }
  else { apX = -ny * 0.5; apY = nx * 0.5; }
  if (lowHp) { apX = -nx * 0.7 - ny * 0.5; apY = -ny * 0.7 + nx * 0.5; }

  // 회피 벡터와 혼합 — 도망만 다니면 아무것도 못 죽인다
  // 목표가 멀면 회피보다 접근을 우선한다 (원거리 적에게 영원히 도망다니지 않도록)
  const avoidWeight = bestD > 220 ? 0.6 : 1.5;
  let mx = apX + avoidX * avoidWeight;
  let my = apY + avoidY * avoidWeight;
  const ml = Math.hypot(mx, my) || 1;
  intent.mx = mx / ml; intent.my = my / ml;

  if (emergency && p.dashCharges > 0 && p.dashCd <= 0 && p.iframes <= 0.05) intent.dash = true;
  else if (bestD > 330 && p.dashCharges > 1 && p.dashCd <= 0) intent.dash = true;

  if (bestD < desired + 40) {
    intent.attack = true;
    if (p.focus >= p.maxFocus * 0.7) intent.special = true;
  }
  return intent;
}
