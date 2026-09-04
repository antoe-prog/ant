// ============================================================
// Run Director: 방 생성 · 스폰 웨이브 · 문/보상 · 상점 · 저주 · 진행.
// "전투 → 클리어 → 선택(문) → 보상 → 다음 전투" 루프의 주인.
// ============================================================

import { RUN, REWARD_WEIGHTS, RARITY, RARITY_ORDER, RARITY_LUCK_STEP, CURSES, SHOP, ENEMY_SCALE, META } from '../data/balance.js';
import { BIOMES, ENEMY_COST, ENEMY_BY_ID } from '../data/enemies.js';
import { BOONS, DUO_BOONS, ANY_BOON_BY_ID, scaleValues, GODS } from '../data/boons.js';
import { WEAPON_UPGRADE } from '../data/weapons.js';
import { EV } from '../core/events.js';
import { TAU, clamp } from '../core/math.js';
import { generateObstacles } from './world.js';
import { healPlayer } from './combat.js';
import { availableDuos, slotsUsed } from './loadout.js';

const MAX_BOON_LEVEL = 3;

export function createRun(world) {
  const run = world.run;
  world.spawnQueue = [];

  const director = {
    world,

    /** 런 시작 */
    start() {
      run.biomeIdx = 0; run.roomIdx = 0; run.globalRoom = 0;
      this.enterRoom({ type: 'combat', first: true });
    },

    /** 새 방 진입: 지형 생성 + 스폰 예약 */
    enterRoom(spec) {
      const biome = world.biome();
      world.enemies.length = 0;
      world.projectiles.length = 0;
      world.pickups.length = 0;
      world.doors.length = 0;
      world.spawnQueue = [];
      world.boss = null;
      run.roomType = spec.type;
      run.roomElite = !!spec.elite;

      generateObstacles(world, spec.type === 'boss' ? world.rng.int(1, 3) : world.rng.int(3, 6));

      // 플레이어를 방 아래쪽 입구에 배치
      world.player.x = world.arena.width / 2;
      world.player.y = world.arena.height - world.arena.pad - 70;
      world.player.vx = 0; world.player.vy = 0;
      world.player.state = 'free';
      world.player.iframes = 0.8;

      world.bus.emit(EV.ROOM_ENTER, {
        type: spec.type, biome: biome.name, roomIdx: run.roomIdx, biomeIdx: run.biomeIdx, elite: run.roomElite,
      });

      if (spec.type === 'boss') {
        world.spawnBoss(biome.boss);
        run.state = 'fight';
        return;
      }
      if (spec.type === 'rest') {
        run.state = 'cleared';
        this.openDoors();
        return;
      }

      buildWaves(world, biome, spec);
      releaseWave(world);
      run.state = 'fight';
    },

    /** 매 프레임 호출 — 웨이브 방출 등 시간 기반 진행 */
    update(dt) {
      if (run.state !== 'fight') return;
      if (world.spawnQueue.length && world.aliveEnemies() <= world.waveThreshold) {
        releaseWave(world);
      }
    },

    /** 방의 모든 적 처치 */
    onRoomClear() {
      if (run.state !== 'fight') return;
      run.state = 'cleared';
      run.roomsCleared++;
      world.ash = (world.ash || 0) + META.ASH_PER_ROOM;
      if (run.roomHeal) healPlayer(world, run.roomHeal);
      world.bus.emit(EV.ROOM_CLEAR, { roomIdx: run.roomIdx, biomeIdx: run.biomeIdx, type: run.roomType });

      if (run.roomType === 'boss') {
        run.bossesKilled++;
        world.ash = (world.ash || 0) + META.ASH_PER_BOSS;
        healPlayer(world, RUN.BOSS_HEAL);
        if (run.biomeIdx >= RUN.BIOMES - 1) {
          run.state = 'victory';
          return;
        }
        // 보스 보상: 확정 서사급 권능 선택
        this.pendingAfterReward = () => this.advanceBiome();
        this.openReward({ kind: 'boon', minRarity: 'epic' });
        return;
      }
      this.openDoors();
    },

    /** 클리어 후 문 배치 — 여기서 플레이어가 "다음 위험/보상"을 고른다 */
    openDoors() {
      const isLastBefore = run.roomIdx >= RUN.ROOMS_PER_BIOME - 2;
      const a = world.arena;
      const spots = [
        { x: a.width * 0.22, y: a.pad + 46 },
        { x: a.width * 0.5,  y: a.pad + 46 },
        { x: a.width * 0.78, y: a.pad + 46 },
      ];
      const count = isLastBefore ? 1 : (world.rng.bool(0.35) ? 2 : 3);
      const chosenSpots = count === 1 ? [spots[1]] : count === 2 ? [spots[0], spots[2]] : spots;

      const doors = [];
      for (let i = 0; i < chosenSpots.length; i++) {
        const s = chosenSpots[i];
        if (isLastBefore) {
          // 보스 직전에는 반드시 회복 — "보스 앞 회복의 샘"
          doors.push({
            ...s, roomType: 'boss', boss: true,
            reward: { kind: 'heal', amount: Math.max(Math.round(world.player.maxHp * 0.4), Math.round(world.player.maxHp * 0.75 - world.player.hp)) },
            label: BIOMES[run.biomeIdx].boss,
          });
        } else {
          const elite = world.rng.next() < RUN.ELITE_CHANCE_BASE + RUN.ELITE_CHANCE_PER_BIOME * run.biomeIdx;
          doors.push({
            ...s,
            roomType: elite ? 'elite' : 'combat',
            elite,
            reward: rollReward(world, elite),
          });
        }
      }
      // 같은 보상만 나오면 선택이 무의미하므로 최소 1개는 다르게
      if (doors.length >= 2 && doors.every((d) => d.reward.kind === doors[0].reward.kind)) {
        doors[doors.length - 1].reward = rollReward(world, doors[doors.length - 1].elite, doors[0].reward.kind);
      }
      // 빌드 성장 페이싱 보장: 보유 권능이 진행도에 못 미치면 최소 1개 문은 권능
      const wantBoons = Math.floor(run.globalRoom * 0.62);
      const hasBoonDoor = doors.some((d) => d.reward.kind === 'boon' || d.reward.kind === 'boonUpgrade');
      if (!hasBoonDoor && run.owned.length < wantBoons && doors.length && !isLastBefore) {
        const i = world.rng.int(0, doors.length - 1);
        doors[i].reward = { kind: 'boon', minRarity: doors[i].elite ? 'rare' : null };
      }
      world.doors = doors;
      world.bus.emit(EV.DOOR_OPEN, { doors });
    },

    /** 문 진입 */
    onEnterDoor(door) {
      if (run.state !== 'cleared') return;
      world.doors = [];
      this.nextRoomSpec = { type: door.roomType, elite: door.elite };

      if (door.roomType === 'boss') { healPlayer(world, door.reward.amount); this.advanceRoom(); return; }

      // 엘리트 문: 저주를 하나 고르고 보상 등급이 올라간다 (위험 ↔ 보상)
      if (door.elite) {
        this.pendingReward = door.reward;
        run.state = 'curse';
        this.curseOptions = world.rng.sampleWeighted(
          CURSES.filter((c) => !run.curses.includes(c.id)), 3, () => 1
        );
        if (!this.curseOptions.length) { this.applyReward(door.reward); }
        return;
      }
      this.applyReward(door.reward);
    },

    /** 저주 선택 */
    chooseCurse(idx) {
      const c = this.curseOptions?.[idx];
      if (!c) return;
      run.curses.push(c.id);
      if (c.enemySpeed) run.enemySpeedMult *= c.enemySpeed;
      if (c.enemyHp) run.enemyHpMult *= c.enemyHp;
      if (c.enemyDmg) run.enemyDmgMult *= c.enemyDmg;
      if (c.enemyCount) run.enemyCountMult *= c.enemyCount;
      if (c.playerTaken) run.playerTakenMult *= c.playerTaken;
      if (c.playerDealt) run.playerDealtMult *= c.playerDealt;
      run.luck += c.rewardBoost || 0;
      this.curseOptions = null;
      const r = this.pendingReward;
      this.pendingReward = null;
      this.applyReward(r);
    },

    /** 보상 적용 (선택이 필요한 것은 UI 상태로 전환) */
    applyReward(reward) {
      switch (reward.kind) {
        case 'boon':
        case 'boonUpgrade':
          this.openReward(reward);
          return;
        case 'gold':
          run.gold += reward.amount;
          world.bus.emit(EV.PICKUP, { x: world.player.x, y: world.player.y, kind: 'gold', amount: reward.amount });
          break;
        case 'heal':
          healPlayer(world, reward.amount);
          break;
        case 'maxhp':
          run.bonusMaxHp += reward.amount;
          world.rebuildLoadout();
          break;
        case 'weaponUpgrade':
          run.weaponLevel = Math.min(WEAPON_UPGRADE.MAX_LEVEL, run.weaponLevel + 1);
          world.rebuildLoadout();
          break;
        case 'shop':
          this.openShop();
          return;
        default: break;
      }
      this.advanceRoom();
    },

    /** 권능 선택창 열기 */
    openReward(reward) {
      const opts = reward.kind === 'boonUpgrade'
        ? buildUpgradeOptions(world)
        : buildBoonOptions(world, reward.minRarity);
      if (!opts.length) { this.advanceRoom(); return; }
      this.rewardOptions = opts;
      this.rewardKind = reward.kind;
      run.state = 'reward';
    },

    /** 권능 선택 확정 */
    chooseReward(idx) {
      const opt = this.rewardOptions?.[idx];
      if (!opt) return;
      grantBoon(world, opt);
      this.rewardOptions = null;
      const after = this.pendingAfterReward;
      this.pendingAfterReward = null;
      if (after) after();
      else this.advanceRoom();
    },

    /** 상점 */
    openShop() {
      this.shopItems = buildShopItems(world);
      run.state = 'shop';
    },

    buyShop(idx) {
      const item = this.shopItems?.[idx];
      if (!item || item.sold || run.gold < item.cost) return false;
      run.gold -= item.cost;
      item.sold = true;
      if (item.type === 'boon') grantBoon(world, item.boon);
      else if (item.type === 'heal') healPlayer(world, SHOP.HEAL_AMOUNT);
      else if (item.type === 'maxhp') { run.bonusMaxHp += SHOP.MAXHP_AMOUNT; world.rebuildLoadout(); }
      else if (item.type === 'weapon') { run.weaponLevel = Math.min(WEAPON_UPGRADE.MAX_LEVEL, run.weaponLevel + 1); world.rebuildLoadout(); }
      return true;
    },

    rerollShop() {
      if (run.gold < SHOP.REROLL_COST) return false;
      run.gold -= SHOP.REROLL_COST;
      this.shopItems = buildShopItems(world);
      return true;
    },

    leaveShop() {
      this.shopItems = null;
      this.advanceRoom();
    },

    /** 다음 방으로 */
    advanceRoom() {
      run.roomIdx++;
      run.globalRoom++;
      const spec = this.nextRoomSpec || { type: 'combat' };
      this.nextRoomSpec = null;
      this.enterRoom(spec);
    },

    advanceBiome() {
      run.biomeIdx++;
      run.roomIdx = 0;
      run.globalRoom++;
      world.ash = (world.ash || 0) + META.ASH_PER_BIOME;
      this.enterRoom({ type: 'combat' });
    },
  };

  world.onRoomClear = () => director.onRoomClear();
  world.onEnterDoor = (d) => director.onEnterDoor(d);
  world.director = director;
  return director;
}

// ---------------- 스폰 ----------------

function buildWaves(world, biome, spec) {
  const run = world.run;
  const [lo, hi] = biome.budget;
  let budget = world.rng.float(lo, hi) * run.enemyCountMult * (1 + run.roomIdx * 0.07);
  if (spec.elite) budget *= 1.25;

  const pool = biome.pool.map((id) => ENEMY_BY_ID[id]).filter(Boolean);
  const waves = [];
  const waveCount = budget > 8 ? 2 : 1;
  const perWave = budget / waveCount;

  for (let w = 0; w < waveCount; w++) {
    const wave = [];
    let left = perWave;
    let guard = 0;
    while (left > 0.4 && guard++ < 40) {
      const def = world.rng.weighted(pool, (d) => d.weight);
      const cost = ENEMY_COST[def.id] ?? 1;
      if (cost > left + 0.4) continue;
      left -= cost;
      const n = def.packSize ? world.rng.int(def.packSize[0], def.packSize[1]) : 1;
      for (let i = 0; i < n && left > -1; i++) {
        wave.push({ id: def.id, elite: false });
        if (i > 0) left -= cost * 0.6;
      }
    }
    if (spec.elite && w === 0 && wave.length) {
      wave[0].elite = true;
      if (wave.length > 3) wave[Math.floor(wave.length / 2)].elite = true;
    }
    if (wave.length) waves.push(wave);
  }
  if (!waves.length) waves.push([{ id: biome.pool[0], elite: false }]);
  world.spawnQueue = waves;
  world.waveThreshold = 0;
}

function releaseWave(world) {
  const wave = world.spawnQueue.shift();
  if (!wave) return;
  const a = world.arena;
  const px = world.player.x, py = world.player.y;
  for (const s of wave) {
    // 플레이어에게서 충분히 떨어진 지점에 스폰 (기습사 방지)
    let x = 0, y = 0, tries = 0;
    do {
      x = world.rng.float(a.pad + 60, a.width - a.pad - 60);
      y = world.rng.float(a.pad + 60, a.height - a.pad - 60);
      tries++;
    } while (Math.hypot(x - px, y - py) < 240 && tries < 30);
    const e = world.spawnEnemy(s.id, x, y, { elite: s.elite });
    if (e) world.bus.emit('spawn', { x, y, elite: s.elite });
  }
  // 다음 웨이브는 남은 적이 절반 이하일 때
  world.waveThreshold = Math.max(0, Math.floor(world.aliveEnemies() * 0.4));
}

// ---------------- 보상 ----------------

function rollReward(world, elite, excludeKind) {
  const entries = Object.entries(REWARD_WEIGHTS).filter(([k]) => k !== excludeKind);
  const run = world.run;
  const items = entries.map(([kind, weight]) => {
    let w = weight;
    if (kind === 'shop' && run.roomIdx < 1) w = 0;
    if (kind === 'weaponUpgrade' && run.weaponLevel >= WEAPON_UPGRADE.MAX_LEVEL) w = 0;
    if (kind === 'heal' && world.player.hp > world.player.maxHp * 0.92) w = w * 0.3;
    return { kind, weight: w };
  });
  // 권능 강화(pom)는 보유 권능이 있을 때만 등장
  if (run.owned.some((o) => o.level < MAX_BOON_LEVEL)) items.push({ kind: 'boonUpgrade', weight: 14 });

  const picked = world.rng.weighted(items, (i) => i.weight);
  const kind = picked.kind;

  switch (kind) {
    case 'gold': return { kind, amount: world.rng.int(RUN.GOLD_PER_ROOM[0], RUN.GOLD_PER_ROOM[1]) * (elite ? 2 : 1) };
    case 'heal': return { kind, amount: RUN.HEAL_ROOM_AMOUNT + (elite ? 12 : 0) };
    case 'maxhp': return { kind, amount: elite ? 20 : 12 };
    case 'boon': return { kind, minRarity: elite ? 'rare' : null };
    default: return { kind };
  }
}

/** 희귀도 뽑기 (행운/저주 보정) */
function rollRarity(world, minRarity) {
  const run = world.run;
  const luck = run.luck * RARITY_LUCK_STEP;
  const items = RARITY_ORDER.map((id, i) => ({
    id, weight: RARITY[id].weight * (1 + luck * i * 0.6),
  }));
  let picked = world.rng.weighted(items).id;
  if (minRarity) {
    const need = RARITY_ORDER.indexOf(minRarity);
    if (RARITY_ORDER.indexOf(picked) < need) picked = minRarity;
  }
  return picked;
}

/** 선택 가능한 권능 3종 생성 */
export function buildBoonOptions(world, minRarity, count = 3) {
  const run = world.run;
  const owned = run.owned;
  const ownedIds = new Set(owned.map((o) => o.id));
  const used = slotsUsed(owned);

  const candidates = [];
  for (const b of BOONS) {
    if (ownedIds.has(b.id)) {
      const cur = owned.find((o) => o.id === b.id);
      if (cur.level >= MAX_BOON_LEVEL) continue;
      candidates.push({ def: b, level: cur.level + 1, upgrade: true, weight: 12 });
    } else {
      if (b.slot !== 'passive' && used[b.slot]) continue; // 슬롯 점유 → 선택지에서 제외
      candidates.push({ def: b, level: 1, weight: 40 });
    }
  }
  // 합일 권능: 해금되면 강한 우선순위로 등장
  for (const d of availableDuos(owned)) {
    candidates.push({ def: d, level: 1, weight: 55, duo: true });
  }
  if (!candidates.length) return [];

  const picked = world.rng.sampleWeighted(candidates, Math.min(count, candidates.length), (c) => c.weight);
  return picked.map((c) => {
    const rarity = c.duo ? 'legendary' : rollRarity(world, minRarity);
    const level = c.level;
    const values = scaleValues(c.def, RARITY[rarity].mult, level);
    return {
      id: c.def.id, def: c.def, rarity, level, values,
      duo: !!c.duo, upgrade: !!c.upgrade,
      title: c.def.name,
      god: c.def.god === 'none' && c.duo ? 'none' : c.def.god,
      slot: c.def.slot,
      text: c.def.desc(values),
    };
  });
}

/** 보유 권능 강화(pom) 선택지 */
function buildUpgradeOptions(world) {
  const owned = world.run.owned.filter((o) => o.level < MAX_BOON_LEVEL);
  if (!owned.length) return [];
  const picks = world.rng.sampleWeighted(owned.slice(), Math.min(3, owned.length), () => 1);
  return picks.map((o) => {
    const def = ANY_BOON_BY_ID[o.id];
    const level = o.level + 1;
    const values = scaleValues(def, RARITY[o.rarity].mult, level);
    return {
      id: o.id, def, rarity: o.rarity, level, values,
      upgrade: true, title: def.name, god: def.god, slot: def.slot,
      text: def.desc(values),
      prevText: def.desc(scaleValues(def, RARITY[o.rarity].mult, o.level)),
    };
  });
}

export function grantBoon(world, opt) {
  const run = world.run;
  const existing = run.owned.find((o) => o.id === opt.id);
  if (existing) {
    existing.level = Math.max(existing.level, opt.level);
    // 더 좋은 희귀도로 갱신
    if (RARITY_ORDER.indexOf(opt.rarity) > RARITY_ORDER.indexOf(existing.rarity)) existing.rarity = opt.rarity;
  } else {
    run.owned.push({ id: opt.id, rarity: opt.rarity, level: opt.level });
  }
  world.rebuildLoadout();
  world.bus.emit(EV.BOON_TAKEN, { boon: opt, level: opt.level });
}

// ---------------- 상점 ----------------

function buildShopItems(world) {
  const items = [];
  const boons = buildBoonOptions(world, null, 2);
  for (const b of boons) {
    items.push({
      type: 'boon', boon: b,
      name: `${b.title} (${RARITY[b.rarity].name})`,
      desc: b.text,
      cost: Math.round(world.rng.int(SHOP.BOON_COST[0], SHOP.BOON_COST[1]) * RARITY[b.rarity].mult),
    });
  }
  items.push({ type: 'heal', name: '치유의 성수', desc: `체력 ${SHOP.HEAL_AMOUNT} 회복`, cost: SHOP.HEAL_COST });
  items.push({ type: 'maxhp', name: '생명의 정수', desc: `최대 체력 +${SHOP.MAXHP_AMOUNT}`, cost: SHOP.MAXHP_COST });
  if (world.run.weaponLevel < WEAPON_UPGRADE.MAX_LEVEL) {
    items.push({ type: 'weapon', name: '무기 각인', desc: `무기 피해 +${Math.round(WEAPON_UPGRADE.DMG_PER_LEVEL * 100)}%`, cost: 90 });
  }
  return items;
}

export { MAX_BOON_LEVEL };
