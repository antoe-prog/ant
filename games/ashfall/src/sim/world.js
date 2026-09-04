// ============================================================
// World: 시뮬레이션의 소유자. DOM/캔버스를 전혀 모른다.
// 렌더러·오디오·UI 는 world 를 "읽기만" 하고, 변화는 EventBus 로 받는다.
// ============================================================

import { ARENA, arenaForAspect, SIM, PLAYER, ENEMY_SCALE, RUN, STATUS } from '../data/balance.js';
import { ENEMY_BY_ID, BOSS_BY_ID, MINIBOSS_BY_ID, ELITE_AFFIXES, BIOMES } from '../data/enemies.js';
import { WEAPON_BY_ID, WEAPON_UPGRADE } from '../data/weapons.js';
import { EventBus, EV } from '../core/events.js';
import { Rng } from '../core/rng.js';
import { clamp, dist, TAU } from '../core/math.js';
import { buildLoadout } from './loadout.js';
import { createPlayer, updatePlayer, refreshPlayerStats } from './player.js';
import { updateEnemies, updateProjectiles, retaliate } from './enemyAI.js';
import { updateMinions, updateCorpses, updateCommand, issueCommand, summonMinion, spawnCorpse, corpsesNear, consumeCorpse, aliveMinions, minionCap } from './minions.js';
import { updateBoss } from './boss.js';
import { updateStatuses, updatePlayerStatus, healPlayer, damageEnemy, damagePlayer, runHooks } from './combat.js';

export function createWorld(opts = {}) {
  const bus = opts.bus || new EventBus();
  const rng = new Rng(opts.seed ?? Date.now());

  const world = {
    bus, rng, seed: rng.seed,
    time: 0,
    hitstop: 0,
    shakeAmount: 0,
    arena: arenaForAspect(opts.aspect),
    obstacles: [],
    enemies: [],
    projectiles: [],
    pickups: [],
    doors: [],
    hazards: [],
    corpses: [],
    minions: [],
    command: null,      // {x, y, t} — 소환수에게 내린 공격 지점
    commandCd: 0,
    decals: [],
    weapon: WEAPON_BY_ID[opts.weaponId] || WEAPON_BY_ID.emberblade,
    weaponDamageMult: 1,
    loadout: null,
    player: null,
    meta: opts.metaEffects || {},
    _hookDepth: 0,

    run: {
      biomeIdx: 0,
      roomIdx: 0,
      globalRoom: 0,
      state: 'fight',
      gold: 0,
      kills: 0,
      damageTaken: 0,
      elapsed: 0,
      owned: [],
      weaponLevel: 0,
      curses: [],
      enemyHpMult: 1,
      enemyDmgMult: 1,
      enemySpeedMult: 1,
      enemyCountMult: 1,
      playerTakenMult: 1,
      playerDealtMult: 1,
      bonusMaxHp: 0,
      bonusDashCharges: 0,
      revives: opts.metaEffects?.revives || 0,
      luck: opts.metaEffects?.luck || 0,
      roomHeal: opts.metaEffects?.roomHeal || 0,
      bossesKilled: 0,
      roomsCleared: 0,
      minibossDone: false,
    },

    shake(amount) { this.shakeAmount = Math.max(this.shakeAmount, amount); },

    retaliate(e, af) { retaliate(this, e, af); },

    // ---- 사령술 API (권능/무기가 쓰는 창구) ----
    summon(id, x, y, opts) { return summonMinion(this, id, x, y, opts); },
    spawnCorpse(e) { spawnCorpse(this, e); },
    corpsesNear(x, y, r) { return corpsesNear(this, x, y, r); },
    consumeCorpse(c) { return consumeCorpse(this, c); },
    aliveMinions() { return aliveMinions(this); },
    issueCommand(x, y) { return issueCommand(this, x, y); },
    minionCap() { return minionCap(this); },

    rebuildLoadout() {
      this.loadout = buildLoadout(this.run.owned, this.meta);
      this.weaponDamageMult = 1 + WEAPON_UPGRADE.DMG_PER_LEVEL * this.run.weaponLevel;
      if (this.player) refreshPlayerStats(this);
    },

    spawnEnemy(id, x, y, extra = {}) {
      const def = ENEMY_BY_ID[id];
      if (!def) return null;
      const d = this.difficulty();
      const elite = !!extra.elite;
      const hp = def.hp * (1 + ENEMY_SCALE.HP_PER_DIFFICULTY * d) * this.run.enemyHpMult * (elite ? ENEMY_SCALE.ELITE_HP : 1);
      const dmg = def.dmg * (1 + ENEMY_SCALE.DMG_PER_DIFFICULTY * d) * (elite ? ENEMY_SCALE.ELITE_DMG : 1);
      // 엘리트 접두사: 같은 적도 매번 다른 위협이 된다
      let affixes = [];
      if (elite) {
        const n = this.run.biomeIdx >= 1 ? 2 : 1;
        affixes = this.rng.sampleWeighted(ELITE_AFFIXES.slice(), n, () => 1);
      }
      const speedAffix = affixes.reduce((m, a) => m * (a.speedMult || 1), 1);
      const teleAffix = affixes.reduce((m, a) => m * (a.telegraphMult || 1), 1);

      const e = {
        def, id, elite, affixes, teleMult: teleAffix,
        x: clamp(x, this.arena.pad + 30, this.arena.width - this.arena.pad - 30),
        y: clamp(y, this.arena.pad + 30, this.arena.height - this.arena.pad - 30),
        vx: 0, vy: 0,
        radius: def.radius * (elite ? ENEMY_SCALE.ELITE_SCALE : 1),
        hp, maxHp: hp, dmg,
        speed: def.speed * this.run.enemySpeedMult * speedAffix,
        facing: this.rng.float(0, TAU),
        state: 'idle', t: 0, cd: this.rng.float(0.2, 0.9),
        status: {}, dead: false, hurtFlash: 0, _thermalCd: 0, staggerT: 0, noCorpse: false,
        spawnT: extra.fromSplit ? 0.1 : 0.45,
        strafeDir: this.rng.bool() ? 1 : -1,
        isBoss: false,
      };
      this.enemies.push(e);
      return e;
    },

    spawnBoss(bossId, opts = {}) {
      const def = BOSS_BY_ID[bossId] || MINIBOSS_BY_ID[bossId];
      if (!def) return null;
      const d = this.difficulty();
      const hp = def.hp * (1 + 0.22 * d) * this.run.enemyHpMult;
      const b = {
        def, id: bossId, elite: false, isBoss: true, isMini: !!def.miniboss, affixes: [], teleMult: 1,
        x: this.arena.width / 2, y: this.arena.pad + 140,
        vx: 0, vy: 0,
        radius: def.radius,
        hp, maxHp: hp, dmg: def.contactDmg,
        speed: def.speed,
        facing: Math.PI / 2,
        state: 'idle', t: 0, cd: 1.6,
        status: {}, dead: false, hurtFlash: 0, _thermalCd: 0, staggerT: 0, noCorpse: false,
        spawnT: def.miniboss ? 0.8 : 1.2, phaseIdx: 0, invuln: 0,
        ringPhase: this.rng.float(0, TAU),
      };
      this.enemies.push(b);
      this.boss = b;
      return b;
    },

    /** 플레이어 편 투사체 (권능으로 열리는 원거리 옵션) */
    spawnPlayerProjectile({ x, y, angle, speed = 620, dmg = 20, radius = 10, life = 0.9, pierce = 3, color = '#ffd166', element = 'none', status = null }) {
      this.projectiles.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        radius, dmg, life, color, element, status,
        hostile: false, pierce, hitSet: new Set(),
      });
      this.bus.emit(EV.PROJECTILE_SPAWN, { x, y, angle, friendly: true });
    },

    /** 예고 후 터지는 지면 위험지대 (폭발성 엘리트 등) */
    spawnHazard(x, y, radius, dmg, delay, color = '#ff6b35') {
      this.hazards.push({ x, y, radius, dmg, t: delay, maxT: delay, color });
    },

    spawnPickup(x, y, kind, amount) {
      this.pickups.push({
        x, y, vx: this.rng.float(-90, 90), vy: this.rng.float(-90, 90),
        kind, amount, life: 22, magnet: 0, born: this.time,
      });
    },

    difficulty() {
      const r = this.run;
      return r.globalRoom * RUN.DIFFICULTY_PER_ROOM + r.biomeIdx * RUN.DIFFICULTY_PER_BIOME;
    },

    aliveEnemies() {
      let n = 0;
      for (const e of this.enemies) if (!e.dead) n++;
      return n;
    },

    biome() { return BIOMES[Math.min(this.run.biomeIdx, BIOMES.length - 1)]; },

    step(intent, dt) { stepWorld(this, intent, dt); },
  };

  world.rebuildLoadout();
  world.player = createPlayer(world, world.weapon);
  world.player.x = world.arena.width / 2;
  world.player.y = world.arena.height / 2;
  refreshPlayerStats(world);
  return world;
}

// ---------------- 시뮬레이션 1틱 ----------------

function stepWorld(world, intent, dt) {
  // 히트스톱: 타격의 무게감. 시뮬레이션만 멈추고 렌더는 계속된다.
  if (world.hitstop > 0) {
    world.hitstop -= dt;
    world.shakeAmount *= Math.exp(-6 * dt);
    return;
  }

  world.time += dt;
  if (world.run.state === 'fight') world.run.elapsed += dt;
  world.shakeAmount *= Math.exp(-9 * dt);

  const paused = world.run.state === 'reward' || world.run.state === 'shop' ||
                 world.run.state === 'dead' || world.run.state === 'victory' ||
                 world.run.state === 'curse';
  if (paused) return;

  updatePlayer(world, intent, dt);
  runHooks(world, 'tick', {});

  for (const e of world.enemies) {
    if (e.dead) continue;
    if (e.isBoss) updateBoss(world, e, dt);
  }
  updateEnemies(world, dt);
  updateMinions(world, dt);
  updateProjectiles(world, dt);
  updateCorpses(world, dt);
  updateCommand(world, dt);
  updateStatuses(world, dt);
  updatePlayerStatus(world, dt);
  updateHazards(world, dt);
  updatePickups(world, dt);

  // 죽은 적 정리
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    if (world.enemies[i].dead) {
      if (world.enemies[i].isBoss) world.boss = null;
      world.enemies.splice(i, 1);
    }
  }

  if (world.player.dead && world.run.state !== 'dead') {
    world.run.state = 'dead';
    return;
  }

  // 방 클리어 판정
  if (world.run.state === 'fight' && world.aliveEnemies() === 0 && world.spawnQueue?.length === 0) {
    world.onRoomClear?.();
  }

  // 문 진입 판정
  if (world.run.state === 'cleared') {
    for (const d of world.doors) {
      if (dist(world.player.x, world.player.y, d.x, d.y) < 42) {
        world.onEnterDoor?.(d);
        break;
      }
    }
  }
}

function updateHazards(world, dt) {
  for (let i = world.hazards.length - 1; i >= 0; i--) {
    const h = world.hazards[i];
    h.t -= dt;
    if (h.t > 0) continue;
    world.bus.emit(EV.EXPLOSION, { x: h.x, y: h.y, radius: h.radius, element: 'ember' });
    world.shake(9);
    if (dist(h.x, h.y, world.player.x, world.player.y) < h.radius + world.player.radius) {
      damagePlayer(world, h.dmg * world.run.enemyDmgMult, { fromX: h.x, fromY: h.y });
    }
    world.hazards.splice(i, 1);
  }
}

function updatePickups(world, dt) {
  const p = world.player;
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const it = world.pickups[i];
    it.life -= dt;
    const d = dist(it.x, it.y, p.x, p.y);
    if (d < 150) it.magnet = Math.min(1, it.magnet + dt * 3);
    if (it.magnet > 0) {
      const pull = 60 + 620 * it.magnet;
      it.vx += ((p.x - it.x) / Math.max(d, 1)) * pull * dt * 6;
      it.vy += ((p.y - it.y) / Math.max(d, 1)) * pull * dt * 6;
    }
    it.x += it.vx * dt; it.y += it.vy * dt;
    const f = Math.exp(-4 * dt);
    it.vx *= f; it.vy *= f;

    if (d < p.radius + 14) {
      collectPickup(world, it);
      world.pickups.splice(i, 1);
    } else if (it.life <= 0) {
      world.pickups.splice(i, 1);
    }
  }
}

function collectPickup(world, it) {
  if (it.kind === 'gold') world.run.gold += it.amount;
  else if (it.kind === 'heal') healPlayer(world, it.amount);
  world.bus.emit(EV.PICKUP, { x: it.x, y: it.y, kind: it.kind, amount: it.amount });
}

// ---------------- 아레나 생성 ----------------

/** 방마다 장애물 배치를 새로 만든다 — 위치 잡기가 매번 달라진다. */
export function generateObstacles(world, count) {
  const a = world.arena;
  const out = [];
  const cx = a.width / 2, cy = a.height / 2;
  let tries = 0;
  while (out.length < count && tries < 200) {
    tries++;
    const r = world.rng.float(26, 52);
    const x = world.rng.float(a.pad + r + 60, a.width - a.pad - r - 60);
    const y = world.rng.float(a.pad + r + 60, a.height - a.pad - r - 60);
    if (dist(x, y, cx, cy) < 150) continue; // 시작 지점은 비워둔다
    let ok = true;
    for (const o of out) if (dist(x, y, o.x, o.y) < o.radius + r + 90) { ok = false; break; }
    if (ok) out.push({ x, y, radius: r, seed: world.rng.float(0, TAU) });
  }
  world.obstacles = out;

  // 바닥 장식(순수 연출) — 방마다 다른 인상을 준다
  const decals = [];
  for (let i = 0; i < 22; i++) {
    decals.push({
      x: world.rng.float(a.pad, a.width - a.pad),
      y: world.rng.float(a.pad, a.height - a.pad),
      a: world.rng.float(0, TAU),
      len: world.rng.float(20, 90),
    });
  }
  world.decals = decals;
  return out;
}
