// 시뮬레이션 계층 단위 테스트. 프레임워크 없이 순수 node 로 실행.
import { Rng, hashSeed } from '../src/core/rng.js';
import { arcHit, segCircleHit, normAngle, rotateToward } from '../src/core/math.js';
import { createWorld } from '../src/sim/world.js';
import { createRun, grantBoon, buildBoonOptions } from '../src/sim/run.js';
import { buildLoadout, availableDuos, slotsUsed } from '../src/sim/loadout.js';
import { applyStatus, updateStatuses, damageEnemy, damagePlayer, healPlayer, staggerEnemy as staggerFn } from '../src/sim/combat.js';
import { updatePlayer as updatePlayerFn, corpseHasteMult as corpseHasteFn } from '../src/sim/player.js';
import { updateProjectiles as updateProjectilesFn, updateEnemies as updateEnemiesFn } from '../src/sim/enemyAI.js';
import { STATUS, SIM, PLAYER, RUN, ARENA } from '../src/data/balance.js';
import { WEAPONS } from '../src/data/weapons.js';
import { BOONS, WEAPON_BOONS, DUO_BOONS, ALL_BOONS, scaleValues } from '../src/data/boons.js';
import { ENEMIES, BOSSES, MINIBOSSES, ELITE_AFFIXES, BIOMES, ENEMY_COST } from '../src/data/enemies.js';
import { MINIONS, MINION_BY_ID, MINION_RULES, CORPSE } from '../src/data/minions.js';
import { summonMinion, updateMinions, updateCorpses, updateCommand, issueCommand, corpsesNear, minionCap, aliveMinions, damageMinion } from '../src/sim/minions.js';
import { updateBoss } from '../src/sim/boss.js';

// ---- 아주 작은 테스트 하네스 ----
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '조건 실패'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 기대 ${b}, 실제 ${a}`); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error(`${msg || ''} 기대 ~${b}, 실제 ${a}`); }

// localStorage 스텁 (세이브 테스트용)
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { loadSave, writeSave, defaultSave, metaEffects, buyUpgrade } = await import('../src/core/save.js');

// ============ 코어 ============
test('RNG 은 시드가 같으면 항상 같은 수열을 낸다', () => {
  const a = new Rng(1234), b = new Rng(1234);
  for (let i = 0; i < 50; i++) eq(a.next(), b.next(), 'RNG 불일치');
  assert(new Rng('abc').seed === hashSeed('abc'), '문자열 시드 해시');
});

test('RNG weighted 는 가중치 0 을 뽑지 않는다', () => {
  const rng = new Rng(9);
  const items = [{ w: 0 }, { w: 0 }, { w: 10 }];
  for (let i = 0; i < 200; i++) eq(rng.weighted(items, (x) => x.w).w, 10);
});

test('부채꼴 판정은 각도/거리 밖을 배제한다', () => {
  assert(arcHit(0, 0, 0, Math.PI / 4, 100, 50, 0, 5), '정면 명중해야 함');
  assert(!arcHit(0, 0, 0, Math.PI / 4, 100, -50, 0, 5), '뒤는 빗나가야 함');
  assert(!arcHit(0, 0, 0, Math.PI / 4, 100, 200, 0, 5), '사거리 밖은 빗나가야 함');
  assert(arcHit(0, 0, 0, Math.PI / 4, 100, 3, 0, 5), '겹친 대상은 명중');
});

test('각도 정규화/회전 보간', () => {
  near(normAngle(Math.PI * 3), Math.PI, 1e-6);
  near(rotateToward(0, 1, 0.1), 0.1, 1e-6);
  near(rotateToward(0, 0.05, 0.1), 0.05, 1e-6);
});

// ============ 데이터 무결성 ============
test('모든 권능은 apply/desc 를 가지고 정상 동작한다', () => {
  for (const b of ALL_BOONS) {
    assert(typeof b.apply === 'function', `${b.id} apply 없음`);
    assert(typeof b.desc === 'function', `${b.id} desc 없음`);
    const v = scaleValues(b, 1.75, 2);
    const L = buildLoadout([]);
    b.apply(L, v);                       // 예외 없이 적용되어야 한다
    const text = b.desc(v);
    assert(typeof text === 'string' && text.length > 0, `${b.id} 설명 비어있음`);
    assert(!/NaN|undefined/.test(text), `${b.id} 설명에 NaN/undefined: ${text}`);
  }
});

test('적/보스 데이터에 필수 필드가 있다', () => {
  for (const e of ENEMIES) {
    assert(e.hp > 0 && e.dmg >= 0 && e.speed > 0 && e.radius > 0, `${e.id} 스탯 이상`);
    assert(ENEMY_COST[e.id] != null, `${e.id} 스폰 코스트 누락`);
  }
  for (const b of BOSSES) {
    assert(b.phases.length >= 2, `${b.id} 페이즈 부족`);
    for (const ph of b.phases) for (const name of ph.patterns) {
      assert(b.patterns[name], `${b.id} 패턴 '${name}' 정의 없음`);
    }
  }
  for (const bi of BIOMES) {
    assert(BOSSES.some((b) => b.id === bi.boss), `${bi.id} 보스 없음`);
    for (const id of bi.pool) assert(ENEMIES.some((e) => e.id === id), `${bi.id} 적 '${id}' 없음`);
  }
});

test('무기 콤보는 합리적인 사이클 타임을 가진다', () => {
  for (const w of WEAPONS) {
    let cycle = 0;
    for (const s of w.combo) {
      assert(s.windup > 0 && s.active > 0 && s.recover > 0, `${w.id} 단계 타이밍 이상`);
      assert(s.dmg > 0 && s.range > 0 && s.arc > 0, `${w.id} 단계 수치 이상`);
      cycle += s.windup + s.active + s.recover;
    }
    assert(cycle > 0.3 && cycle < 2.0, `${w.id} 콤보 사이클 ${cycle.toFixed(2)}s 가 비현실적`);
    assert(w.special.cost <= PLAYER.MAX_FOCUS, `${w.id} 특수기 비용이 최대 집중보다 큼`);
  }
});

// ============ 로드아웃 / 빌드 ============
test('권능이 실제 스탯을 바꾼다', () => {
  const base = buildLoadout([]);
  const withPower = buildLoadout([{ id: 'relic_power', rarity: 'common', level: 1 }]);
  assert(withPower.stats.damageMult > base.stats.damageMult, '피해 증가 미적용');
  const legendary = buildLoadout([{ id: 'relic_power', rarity: 'legendary', level: 3 }]);
  assert(legendary.stats.damageMult > withPower.stats.damageMult, '희귀도/레벨 스케일링 미적용');
});

test('합일 권능은 두 신을 모두 보유해야 해금된다', () => {
  eq(availableDuos([{ id: 'ember_attack', rarity: 'common', level: 1 }]).length, 0, '한 신만으론 해금 불가');
  const duos = availableDuos([
    { id: 'ember_attack', rarity: 'common', level: 1 },
    { id: 'frost_dash', rarity: 'common', level: 1 },
  ]);
  assert(duos.some((d) => d.id === 'duo_thermal'), '열충격이 해금되어야 함');
});

test('공격/대시/특수 슬롯은 중복 장착되지 않는다', () => {
  const world = createWorld({ seed: 3, weaponId: 'emberblade' });
  createRun(world);
  grantBoon(world, { id: 'ember_attack', rarity: 'common', level: 1 });
  const used = slotsUsed(world.run.owned);
  eq(used.attack, 'ember_attack');
  for (let i = 0; i < 40; i++) {
    for (const opt of buildBoonOptions(world, null, 3)) {
      if (opt.slot === 'attack') eq(opt.id, 'ember_attack', '점유된 슬롯에 다른 권능이 제안됨');
    }
  }
});

test('무기 전용 권능은 해당 무기에서만 제안된다', () => {
  for (const weaponId of ['emberblade', 'ruinmaul', 'twinfangs']) {
    const w = createWorld({ seed: 11, weaponId });
    createRun(w);
    const seen = new Set();
    for (let i = 0; i < 300; i++) for (const o of buildBoonOptions(w, null, 3)) seen.add(o.id);
    for (const b of WEAPON_BOONS) {
      if (b.weapon === weaponId) continue;
      assert(!seen.has(b.id), `${weaponId} 에서 다른 무기 권능 ${b.id} 가 제안됨`);
    }
    const own = WEAPON_BOONS.filter((b) => b.weapon === weaponId);
    assert(own.some((b) => seen.has(b.id)), `${weaponId} 전용 권능이 한 번도 제안되지 않음`);
  }
});

test('무기 전용 권능이 실제 전투에서 발동한다', () => {
  // 검압: 3타 마무리가 아군 투사체를 만든다
  const w = createWorld({ seed: 5, weaponId: 'emberblade' });
  const d = createRun(w);
  d.enterRoom({ type: 'combat' });
  grantBoon(w, { id: 'blade_wave', rarity: 'common', level: 1 });
  w.projectiles.length = 0;
  const p = w.player;
  p.state = 'attack'; p.atkStep = 2; p.atkPhase = 'windup'; p.atkT = 0; p.atkHits = new Set();
  const intent = { mx: 0, my: 0, aimX: p.x + 100, aimY: p.y, attack: false, dash: false, special: false };
  for (let i = 0; i < 6; i++) updatePlayerFn(w, intent, SIM.DT);
  assert(w.projectiles.some((pr) => !pr.hostile), '검기(아군 투사체)가 생성되지 않음');

  // 지진: 2타가 광역 경직을 건다
  const w2 = createWorld({ seed: 5, weaponId: 'ruinmaul' });
  const d2 = createRun(w2);
  d2.enterRoom({ type: 'combat' });
  grantBoon(w2, { id: 'maul_quake', rarity: 'common', level: 1 });
  w2.enemies.length = 0;
  const e = w2.spawnEnemy('husk', w2.player.x + 120, w2.player.y);
  e.spawnT = 0;
  const p2 = w2.player;
  p2.state = 'attack'; p2.atkStep = 1; p2.atkPhase = 'windup'; p2.atkT = 0; p2.atkHits = new Set();
  const intent2 = { mx: 0, my: 0, aimX: p2.x + 100, aimY: p2.y, attack: false, dash: false, special: false };
  for (let i = 0; i < 6; i++) updatePlayerFn(w2, intent2, SIM.DT);
  assert(e.staggerT > 0, '지진 경직이 적용되지 않음');
});

test('아군 투사체는 적을 관통하며 피해를 준다', () => {
  const w = createWorld({ seed: 2, weaponId: 'emberblade' });
  const d = createRun(w);
  d.enterRoom({ type: 'combat' });
  w.enemies.length = 0;
  const a = w.spawnEnemy('husk', 400, 400); a.spawnT = 0;
  const b = w.spawnEnemy('husk', 480, 400); b.spawnT = 0;
  const hpA = a.hp, hpB = b.hp;
  w.spawnPlayerProjectile({ x: 300, y: 400, angle: 0, dmg: 15, pierce: 3, speed: 600, life: 1 });
  for (let i = 0; i < 40; i++) updateProjectilesFn(w, SIM.DT);
  assert(a.hp < hpA && b.hp < hpB, '관통 투사체가 두 적을 모두 때려야 함');
});

test('경직된 적은 행동하지 않는다', () => {
  const w = createWorld({ seed: 3, weaponId: 'emberblade' });
  const d = createRun(w);
  d.enterRoom({ type: 'combat' });
  w.enemies.length = 0;
  const e = w.spawnEnemy('husk', 400, 400);
  e.spawnT = 0; e.state = 'idle'; e.cd = 0;
  w.player.x = 460; w.player.y = 400;
  staggerFn(w, e, 1.0);
  for (let i = 0; i < 30; i++) updateEnemiesFn(w, SIM.DT);
  eq(e.state, 'idle', '경직 중에는 새 행동을 시작하지 않아야 함');
  assert(e.staggerT > 0, '경직이 유지되어야 함');
});

// ============ 상태이상 / 전투 ============
function testWorld(weaponId = 'emberblade', seed = 1) {
  const world = createWorld({ seed, weaponId });
  createRun(world);
  world.director.enterRoom({ type: 'combat' });
  return world;
}

test('냉기는 최대 중첩에서 빙결로 전환된다', () => {
  const w = testWorld();
  const e = w.spawnEnemy('husk', 400, 400);
  for (let i = 0; i < STATUS.chill.maxStacks; i++) applyStatus(w, e, 'chill', 1);
  assert(e.status.frozen, '빙결되어야 함');
  assert(!e.status.chill, '냉기 중첩은 소모되어야 함');
});

test('빙결 대상은 추가 피해를 받는다', () => {
  const a = testWorld(); const e1 = a.spawnEnemy('husk', 400, 400);
  const b = testWorld(); const e2 = b.spawnEnemy('husk', 400, 400);
  a.rng.next = () => 1; b.rng.next = () => 1; // 치명타 제거
  e2.status.frozen = { time: 1, stacks: 1 };
  const d1 = damageEnemy(a, e1, 100, 'none', { silent: true });
  const d2 = damageEnemy(b, e2, 100, 'none', { silent: true });
  assert(d2 > d1 * 1.2, `빙결 추가 피해 미적용 (${d1} vs ${d2})`);
});

test('화상은 시간에 따라 피해를 주고 만료된다', () => {
  const w = testWorld();
  const e = w.spawnEnemy('husk', 400, 400);
  e.hp = e.maxHp = 100000; // 만료 전에 죽지 않도록
  const hp0 = e.hp;
  applyStatus(w, e, 'burn', 3);
  for (let i = 0; i < 60; i++) updateStatuses(w, SIM.DT);
  assert(e.hp < hp0, '화상 피해가 들어가야 함');
  for (let i = 0; i < Math.ceil(STATUS.burn.duration * 60) + 10; i++) updateStatuses(w, SIM.DT);
  assert(!e.status.burn, '화상이 만료되어야 함');
});

test('지속 피해만으로도 적이 죽는다 (도트 빌드 성립)', () => {
  const w = testWorld();
  const e = w.spawnEnemy('husk', 400, 400);
  applyStatus(w, e, 'burn', STATUS.burn.maxStacks);
  for (let i = 0; i < 60 * 6 && !e.dead; i++) updateStatuses(w, SIM.DT);
  assert(e.dead, '최대 중첩 화상으로 잡몹이 죽어야 함');
  assert(e.status.burn, '처치 시점의 상태이상은 onKill 훅을 위해 남아있어야 함');
});

test('방패병은 정면 피해를 크게 줄인다', () => {
  const w = testWorld();
  w.rng.next = () => 1; // 치명타 제거
  const front = w.spawnEnemy('bulwark', 400, 400);
  const back = w.spawnEnemy('bulwark', 800, 400);
  w.player.x = 400; w.player.y = 300;
  front.facing = Math.atan2(300 - 400, 400 - 400); // 플레이어를 향함
  back.facing = Math.atan2(400 - 400, 400 - 800);  // 등을 보임
  w.player.x = 800; w.player.y = 300;
  back.facing = Math.PI / 2; // 아래(플레이어 반대)를 향함
  w.player.x = 400; w.player.y = 300;
  const dFront = damageEnemy(w, front, 100, 'none', { silent: true });
  w.player.x = 800;
  const dBack = damageEnemy(w, back, 100, 'none', { silent: true });
  assert(dBack > dFront * 3, `등 뒤 공격이 훨씬 아파야 함 (정면 ${dFront.toFixed(1)} vs 후방 ${dBack.toFixed(1)})`);
});

test('플레이어 무적 중에는 피해를 받지 않는다', () => {
  const w = testWorld();
  w.player.iframes = 1;
  eq(damagePlayer(w, 50), 0, '무적 중 피해');
  w.player.iframes = 0;
  assert(damagePlayer(w, 50) > 0, '무적 해제 후에는 맞아야 함');
});

test('부활(메타 강화)이 있으면 한 번 살아난다', () => {
  const w = testWorld();
  w.run.revives = 1;
  w.player.iframes = 0;
  damagePlayer(w, 9999);
  assert(!w.player.dead, '부활해야 함');
  assert(w.player.hp > 0, '체력이 회복되어야 함');
  w.player.iframes = 0;
  damagePlayer(w, 9999);
  assert(w.player.dead, '두 번째는 사망해야 함');
});

test('회복은 최대 체력을 넘지 않는다', () => {
  const w = testWorld();
  w.player.hp = 10;
  healPlayer(w, 99999);
  eq(w.player.hp, w.player.maxHp);
});

// ============ 사령술: 시체 / 소환수 ============
test('적이 죽으면 시체가 남고, 시간이 지나면 사라진다', () => {
  const w = testWorld();
  w.corpses.length = 0;
  const e = w.spawnEnemy('husk', 400, 400);
  damageEnemy(w, e, 1e6, 'none', { silent: true });
  eq(w.corpses.length, 1, '시체가 생기지 않음');
  for (let i = 0; i < Math.ceil(CORPSE.LIFETIME * 60) + 5; i++) updateCorpses(w, SIM.DT);
  eq(w.corpses.length, 0, '시체가 만료되지 않음');
});

test('되살아난 적은 시체를 남기지 않는다 (무한 부활 방지)', () => {
  const w = testWorld();
  w.corpses.length = 0;
  const e = w.spawnEnemy('husk', 400, 400);
  e.noCorpse = true;
  damageEnemy(w, e, 1e6, 'none', { silent: true });
  eq(w.corpses.length, 0, '되살아난 적이 시체를 남김');
});

test('시체 자연 소멸은 corpseExpire 훅을 발생시킨다', () => {
  const w = testWorld();
  let fired = 0;
  w.loadout.on.corpseExpire.push(() => fired++);
  w.corpses.length = 0;
  const e = w.spawnEnemy('husk', 400, 400);
  damageEnemy(w, e, 1e6, 'none', { silent: true });
  for (let i = 0; i < Math.ceil(CORPSE.LIFETIME * 60) + 5; i++) updateCorpses(w, SIM.DT);
  eq(fired, 1, 'corpseExpire 미발생');
  // 소비된 시체는 만료 훅을 발생시키지 않는다
  fired = 0;
  const e2 = w.spawnEnemy('husk', 500, 500);
  damageEnemy(w, e2, 1e6, 'none', { silent: true });
  w.consumeCorpse(w.corpses[0]);
  for (let i = 0; i < 10; i++) updateCorpses(w, SIM.DT);
  eq(fired, 0, '소비된 시체가 만료 훅을 발생시킴');
});

test('소환수는 상한을 넘지 않고, 넘치면 가장 오래된 것이 스러진다', () => {
  const w = testWorld();
  const cap = minionCap(w);
  for (let i = 0; i < cap + 4; i++) summonMinion(w, 'wraith', 400 + i * 5, 400);
  for (let i = 0; i < 3; i++) updateMinions(w, SIM.DT);
  assert(aliveMinions(w) <= cap, `상한 ${cap} 초과: ${aliveMinions(w)}`);
});

test('권능이 소환수 상한/성능을 올린다', () => {
  const w = testWorld();
  const base = minionCap(w);
  grantBoon(w, { id: 'necro_horde', rarity: 'common', level: 1 });
  assert(minionCap(w) > base, '상한 미증가');
  const before = summonMinion(w, 'wraith', 400, 400).dmg;
  grantBoon(w, { id: 'necro_horde', rarity: 'legendary', level: 3 });
  const after = summonMinion(w, 'wraith', 400, 400).dmg;
  assert(after > before, '소환수 피해 미증가');
  assert(minionCap(w) <= MINION_RULES.HARD_CAP, '하드 캡을 넘음');
});

test('소환수가 적을 공격한다', () => {
  const w = testWorld();
  w.enemies.length = 0;
  const e = w.spawnEnemy('husk', 400, 400);
  e.spawnT = 0; e.hp = e.maxHp = 100000;
  w.player.x = 400; w.player.y = 420;
  const m = summonMinion(w, 'wraith', 420, 400);
  m.spawnT = 0;
  const hp0 = e.hp;
  for (let i = 0; i < 120; i++) updateMinions(w, SIM.DT);
  assert(e.hp < hp0, '소환수가 피해를 주지 못함');
});

test('해골 병사는 적탄을 몸으로 막는다', () => {
  const w = testWorld();
  w.projectiles.length = 0;
  w.player.x = 600; w.player.y = 400; w.player.iframes = 0;
  const m = summonMinion(w, 'skeleton', 500, 400);
  m.spawnT = 0;
  const mHp = m.hp;
  w.projectiles.push({ x: 400, y: 400, vx: 600, vy: 0, radius: 8, dmg: 20, life: 2, color: '#fff', hostile: true });
  const pHp = w.player.hp;
  for (let i = 0; i < 40; i++) updateProjectilesFn(w, SIM.DT);
  eq(w.projectiles.length, 0, '탄이 사라지지 않음');
  assert(m.hp < mHp, '해골이 피해를 받지 않음');
  eq(w.player.hp, pHp, '플레이어가 대신 맞음 — 막지 못했다');
});

test('망자 봉기는 시체를 소환수로 바꾸고, 시체가 없으면 광역 피해를 준다', () => {
  const w = createWorld({ seed: 4, weaponId: 'gravecall' });
  const d = createRun(w);
  d.enterRoom({ type: 'combat' });
  w.enemies.length = 0; w.spawnQueue = []; w.minions.length = 0; w.corpses.length = 0;
  const p = w.player;
  // 시체 3구 배치
  for (let i = 0; i < 3; i++) {
    w.corpses.push({ x: p.x + 40 + i * 30, y: p.y, radius: 15, scale: 1, enemyId: 'husk', life: 10, seed: 0, used: false });
  }
  p.focus = p.maxFocus;
  const intent = { mx: 0, my: 0, aimX: p.x + 100, aimY: p.y, attack: false, dash: false, special: true };
  updatePlayerFn(w, intent, SIM.DT);
  assert(aliveMinions(w) >= 1, '시체가 소환수로 바뀌지 않음');
  assert(w.corpses.filter((c) => !c.used).length < 3, '시체가 소비되지 않음');

  // 시체가 없을 때는 광역 피해로 전환
  const w2 = createWorld({ seed: 4, weaponId: 'gravecall' });
  const d2 = createRun(w2);
  d2.enterRoom({ type: 'combat' });
  w2.enemies.length = 0; w2.corpses.length = 0; w2.minions.length = 0;
  const e = w2.spawnEnemy('husk', w2.player.x + 60, w2.player.y);
  e.spawnT = 0; e.hp = e.maxHp = 100000;
  const hp0 = e.hp;
  w2.player.focus = w2.player.maxFocus;
  updatePlayerFn(w2, { mx: 0, my: 0, aimX: e.x, aimY: e.y, attack: false, dash: false, special: true }, SIM.DT);
  assert(e.hp < hp0, '시체가 없을 때 대체 피해가 없음');
  eq(aliveMinions(w2), 0, '시체가 없는데 소환됨');
});

test('강령장은 주변 시체 수만큼 공격이 빨라진다', () => {
  const w = createWorld({ seed: 4, weaponId: 'gravecall' });
  createRun(w);
  const base = corpseHasteFn(w);
  eq(base, 1, '시체가 없으면 배율 1이어야 함');
  for (let i = 0; i < 4; i++) {
    w.corpses.push({ x: w.player.x + i * 20, y: w.player.y, radius: 15, scale: 1, enemyId: 'husk', life: 10, seed: 0, used: false });
  }
  const hasted = corpseHasteFn(w);
  assert(hasted > base, '시체 가속이 적용되지 않음');
  // 상한을 넘지 않는다
  for (let i = 0; i < 30; i++) {
    w.corpses.push({ x: w.player.x, y: w.player.y, radius: 15, scale: 1, enemyId: 'husk', life: 10, seed: 0, used: false });
  }
  assert(corpseHasteFn(w) <= 1 + w.weapon.corpseHaste.max + 1e-9, '시체 가속 상한 초과');
});

test('시체 술사는 시체를 되살리고, 되살아난 적은 다시 시체가 되지 않는다', () => {
  const w = testWorld();
  w.enemies.length = 0; w.corpses.length = 0; w.spawnQueue = [];
  w.player.x = 300; w.player.y = 400;
  const caller = w.spawnEnemy('bonecaller', 600, 400);
  caller.spawnT = 0; caller.cd = 0;
  w.corpses.push({ x: 620, y: 400, radius: 15, scale: 1, enemyId: 'husk', life: 10, seed: 0, used: false });
  for (let i = 0; i < 200; i++) updateEnemiesFn(w, SIM.DT);
  const revived = w.enemies.filter((e) => e.revived);
  assert(revived.length >= 1, '시체를 되살리지 못함');
  assert(revived[0].noCorpse, '되살아난 적이 다시 시체를 남기도록 되어 있음');
  assert(revived[0].maxHp < ENEMY_BY_ID_husk(w), '되살아난 적의 체력이 줄지 않음');
});
function ENEMY_BY_ID_husk(w) {
  const e = w.spawnEnemy('husk', 10, 10);
  const hp = e.maxHp;
  e.dead = true;
  return hp;
}

test('확률 수치는 희귀도/레벨 스케일링으로 상한을 넘지 않는다', () => {
  for (const b of ALL_BOONS) {
    if (!b.caps) continue;
    const v = scaleValues(b, 2.3, 3); // 전설 + 최대 레벨
    for (const [k, cap] of Object.entries(b.caps)) {
      assert(v[k] <= cap + 1e-9, `${b.id}.${k} 상한 ${cap} 초과: ${v[k]}`);
    }
  }
  // 확률로 쓰이는 값은 모두 1 이하여야 한다
  for (const b of ALL_BOONS) {
    const v = scaleValues(b, 2.3, 3);
    for (const k of ['chance', 'archer']) {
      if (v[k] != null) assert(v[k] <= 1, `${b.id}.${k} 가 100%를 넘음: ${v[k]}`);
    }
  }
});

test('소환수 명령: 지정 지점의 적을 최우선으로 노린다', () => {
  const w = testWorld();
  w.enemies.length = 0; w.minions.length = 0; w.spawnQueue = [];
  const p = w.player;
  p.x = 300; p.y = 400;
  // 가까운 적(무시해야 함)과 명령 지점의 적(노려야 함)
  const near = w.spawnEnemy('husk', 360, 400); near.spawnT = 0; near.hp = near.maxHp = 100000;
  const far = w.spawnEnemy('husk', 640, 400); far.spawnT = 0; far.hp = far.maxHp = 100000;
  const m = summonMinion(w, 'wraith', 330, 400); m.spawnT = 0;

  assert(issueCommand(w, far.x, far.y), '명령이 내려지지 않음');
  assert(w.command, '명령 상태가 없음');
  const nearHp = near.hp, farHp = far.hp;
  for (let i = 0; i < 180; i++) { updateCommand(w, SIM.DT); updateMinions(w, SIM.DT); }
  assert(far.hp < farHp, '명령 지점의 적을 때리지 않음');
  assert(farHp - far.hp > nearHp - near.hp, '가까운 적보다 명령 대상을 우선해야 함');
});

test('소환수 명령은 쿨다운이 있고 소환수가 없으면 나가지 않는다', () => {
  const w = testWorld();
  w.minions.length = 0;
  eq(issueCommand(w, 500, 400), false, '소환수 없이 명령이 나감');
  const m = summonMinion(w, 'wraith', 400, 400); m.spawnT = 0;
  assert(issueCommand(w, 500, 400), '첫 명령 실패');
  eq(issueCommand(w, 500, 400), false, '쿨다운 중에 또 나감');
  for (let i = 0; i < Math.ceil(MINION_RULES.COMMAND_CD * 60) + 5; i++) updateCommand(w, SIM.DT);
  assert(issueCommand(w, 500, 400), '쿨다운 후 명령 실패');
});

test('명령 지점은 최대 사거리로 제한된다', () => {
  const w = testWorld();
  const m = summonMinion(w, 'wraith', 400, 400); m.spawnT = 0;
  const p = w.player;
  issueCommand(w, p.x + 5000, p.y);
  const d = Math.hypot(w.command.x - p.x, w.command.y - p.y);
  assert(d <= MINION_RULES.COMMAND_RANGE + 1, `명령 사거리 초과: ${d.toFixed(0)}`);
});

test('사령술 보스는 전장의 시체를 되살린다', () => {
  const w = testWorld();
  w.enemies.length = 0; w.corpses.length = 0; w.spawnQueue = [];
  const b = w.spawnBoss('bonesovereign');
  assert(b && b.isMini, '해골 군주가 소환되지 않음');
  b.spawnT = 0;
  for (let i = 0; i < 4; i++) {
    w.corpses.push({ x: b.x + 40 + i * 20, y: b.y, radius: 15, scale: 1, enemyId: 'husk', life: 10, seed: 0, used: false });
  }
  // raise 패턴을 강제로 실행
  b.pattern = b.def.patterns.raise;
  b.patternName = 'raise';
  b.state = 'telegraph';
  b.t = 0;
  for (let i = 0; i < 120; i++) updateBoss(w, b, SIM.DT);
  const revived = w.enemies.filter((e) => e.revived);
  assert(revived.length >= 1, '보스가 시체를 되살리지 못함');
  assert(revived.every((e) => e.noCorpse), '되살아난 적이 다시 시체를 남김');
});

test('사령술 보스는 시체가 없어도 패턴이 헛돌지 않는다', () => {
  const w = testWorld();
  w.enemies.length = 0; w.corpses.length = 0; w.spawnQueue = [];
  const b = w.spawnBoss('bonesovereign');
  b.spawnT = 0;
  const before = w.enemies.length;
  b.pattern = b.def.patterns.raise; b.patternName = 'raise'; b.state = 'telegraph'; b.t = 0;
  for (let i = 0; i < 120; i++) updateBoss(w, b, SIM.DT);
  assert(w.enemies.length > before, '시체가 없을 때 대체 소환이 없음');
});

// ============ 엘리트 접두사 / 미니보스 ============
test('엘리트만 접두사를 얻는다', () => {
  const w = testWorld();
  const normal = w.spawnEnemy('husk', 400, 400);
  eq(normal.affixes.length, 0, '일반 적에 접두사가 붙음');
  for (let i = 0; i < 20; i++) {
    const e = w.spawnEnemy('husk', 400, 400, { elite: true });
    assert(e.affixes.length >= 1, '엘리트에 접두사가 없음');
    const ids = new Set(e.affixes.map((a) => a.id));
    eq(ids.size, e.affixes.length, '접두사가 중복됨');
  }
});

test("'수호' 엘리트는 주변 적의 피해를 줄인다", () => {
  const w = testWorld();
  w.rng.next = () => 1; // 치명타 제거
  const guard = w.spawnEnemy('husk', 400, 400, { elite: true });
  guard.affixes = [ELITE_AFFIXES.find((a) => a.id === 'warded')];
  const near = w.spawnEnemy('husk', 460, 400);
  const far = w.spawnEnemy('husk', 400, 400 + 900);
  near.hp = near.maxHp = far.hp = far.maxHp = 100000; // 측정 중 죽지 않도록
  const dNear = damageEnemy(w, near, 100, 'none', { silent: true });
  const dFar = damageEnemy(w, far, 100, 'none', { silent: true });
  assert(dNear < dFar * 0.7, `오라 안이 더 단단해야 함 (${dNear.toFixed(1)} vs ${dFar.toFixed(1)})`);
  // 오라 주인을 잡으면 보호가 사라진다
  guard.dead = true;
  const dAfter = damageEnemy(w, near, 100, 'none', { silent: true });
  assert(dAfter > dNear * 1.5, '오라 주인 처치 후 보호가 사라져야 함');
});

test("'폭발성' 엘리트는 죽은 자리에 예고된 폭발을 남긴다", () => {
  const w = testWorld();
  const e = w.spawnEnemy('husk', 400, 400, { elite: true });
  e.affixes = [ELITE_AFFIXES.find((a) => a.id === 'volatile')];
  e.spawnT = 0;
  w.hazards.length = 0;
  damageEnemy(w, e, 1e6, 'none', { silent: true });
  eq(w.hazards.length, 1, '위험지대가 생기지 않음');
  // 폭발 지점에 서 있으면 피해를 받는다
  w.player.x = 400; w.player.y = 400; w.player.iframes = 0;
  const hp0 = w.player.hp;
  for (let i = 0; i < 60; i++) w.step({ mx: 0, my: 0, aimX: 400, aimY: 500, attack: false, dash: false, special: false }, SIM.DT);
  assert(w.player.hp < hp0, '폭발 피해가 들어가지 않음');
  eq(w.hazards.length, 0, '폭발 후 위험지대가 정리되어야 함');
});

test("'흡혈' 엘리트는 플레이어를 때리면 회복한다", () => {
  const w = testWorld();
  const e = w.spawnEnemy('husk', 400, 400, { elite: true });
  e.affixes = [ELITE_AFFIXES.find((a) => a.id === 'vampiric')];
  e.hp = e.maxHp * 0.5;
  const before = e.hp;
  w.player.iframes = 0;
  damagePlayer(w, 40, { source: e });
  assert(e.hp > before, '흡혈이 적용되지 않음');
});

test('미니보스 방은 미니보스를 소환하고 클리어 시 희귀 이상 권능을 준다', () => {
  const w = testWorld();
  w.director.enterRoom({ type: 'miniboss' });
  assert(w.boss && w.boss.isMini, '미니보스가 소환되지 않음');
  assert(MINIBOSSES.some((m) => m.id === w.boss.id), '미니보스 정의가 일치하지 않음');
  assert(w.enemies.filter((e) => !e.isBoss).length > 0, '미니보스 방에 잡졸이 없음');
  w.enemies.length = 0; w.spawnQueue = [];
  w.director.onRoomClear();
  eq(w.run.state, 'reward', '미니보스 클리어 후 보상 선택이 열려야 함');
  for (const o of w.director.rewardOptions) {
    assert(['rare', 'epic', 'legendary'].includes(o.rarity), `희귀 이상이어야 함: ${o.rarity}`);
  }
  w.director.chooseReward(0);
  eq(w.run.state, 'cleared', '보상 후 문이 열려야 함');
  assert(w.doors.length >= 1, '문이 생기지 않음');
});

test('미니보스는 구역당 한 번만 등장한다', () => {
  const w = testWorld();
  w.run.minibossDone = true;
  for (let i = 0; i < 60; i++) {
    w.run.roomIdx = 1;
    w.doors.length = 0;
    w.director.openDoors();
    assert(!w.doors.some((d) => d.roomType === 'miniboss'), '이미 처치했는데 또 등장함');
  }
});

// ============ 런 진행 ============
test('적은 항상 아레나 안에 스폰된다', () => {
  const w = testWorld();
  for (let i = 0; i < 200; i++) {
    const e = w.spawnEnemy('husk', w.rng.float(-2000, 4000), w.rng.float(-2000, 4000));
    assert(e.x >= 0 && e.x <= ARENA.WIDTH && e.y >= 0 && e.y <= ARENA.HEIGHT, '아레나 밖 스폰');
  }
});

test('방을 클리어하면 문이 생기고, 문마다 보상이 붙는다', () => {
  const w = testWorld();
  w.enemies.length = 0; w.spawnQueue = [];
  w.director.onRoomClear();
  eq(w.run.state, 'cleared');
  assert(w.doors.length >= 1, '문이 생겨야 함');
  for (const d of w.doors) assert(d.reward && d.reward.kind, '문에 보상 정보 없음');
});

test('보스 직전 문은 반드시 회복을 준다', () => {
  const w = testWorld();
  w.run.roomIdx = RUN.ROOMS_PER_BIOME - 2;
  w.enemies.length = 0; w.spawnQueue = [];
  w.director.onRoomClear();
  eq(w.doors.length, 1, '보스 문은 하나');
  eq(w.doors[0].roomType, 'boss');
  w.player.hp = 10;
  w.director.onEnterDoor(w.doors[0]);
  assert(w.player.hp > 10, '보스 앞에서 회복되어야 함');
  assert(w.boss, '보스가 소환되어야 함');
});

test('마지막 보스를 잡으면 승리 상태가 된다', () => {
  const w = testWorld();
  w.run.biomeIdx = RUN.BIOMES - 1;
  w.run.roomType = 'boss';
  w.run.state = 'fight';
  w.enemies.length = 0; w.spawnQueue = [];
  w.director.onRoomClear();
  eq(w.run.state, 'victory');
});

test('저주는 런 전체 배율에 적용된다', () => {
  const w = testWorld();
  w.director.pendingReward = { kind: 'gold', amount: 1 };
  w.director.curseOptions = [{ id: 'iron', name: 't', desc: 'd', enemyHp: 1.45, rewardBoost: 1 }];
  const before = w.run.enemyHpMult;
  w.director.chooseCurse(0);
  assert(w.run.enemyHpMult > before, '저주 미적용');
  assert(w.run.curses.includes('iron'), '저주 기록 누락');
});

test('시드가 같으면 런 진행이 재현된다', () => {
  const runOnce = () => {
    const w = createWorld({ seed: 777, weaponId: 'emberblade' });
    const d = createRun(w);
    d.start();
    const intent = { mx: 1, my: 0, aimX: 999, aimY: 400, attack: true, dash: false, special: false };
    for (let i = 0; i < 600; i++) { d.update(SIM.DT); w.step(intent, SIM.DT); }
    return `${w.player.x.toFixed(3)},${w.player.y.toFixed(3)},${w.run.kills},${w.enemies.length}`;
  };
  eq(runOnce(), runOnce(), '동일 시드 재현 실패');
});

// ============ 세이브 ============
test('세이브는 저장/복원된다', () => {
  store.clear();
  const s = defaultSave();
  s.ash = 123; s.upgrades.vigor = 2; s.stats.runs = 5;
  writeSave(s);
  const l = loadSave();
  eq(l.ash, 123); eq(l.upgrades.vigor, 2); eq(l.stats.runs, 5);
});

test('구버전 세이브가 마이그레이션된다', () => {
  store.clear();
  store.set('ashfall.save', JSON.stringify({ version: 1, dust: 88, upgrades: { vigor: 99, 사라진업글: 3 } }));
  const l = loadSave();
  eq(l.ash, 88, 'dust → ash 이전 실패');
  assert(l.upgrades['사라진업글'] === undefined, '없어진 업그레이드가 남아있음');
  eq(l.upgrades.vigor, 5, '레벨 상한 보정 실패');
  assert(l.stats && typeof l.stats.runs === 'number', '누락 필드 기본값 미보충');
});

test('손상된 세이브는 초기화되고 백업된다', () => {
  store.clear();
  store.set('ashfall.save', '{이건 JSON이 아님');
  const l = loadSave();
  eq(l.ash, 0);
  assert(store.has('ashfall.save.corrupt'), '손상 세이브 백업 없음');
});

test('메타 강화가 실제 효과로 환산된다', () => {
  const s = defaultSave();
  s.ash = 1000;
  assert(buyUpgrade(s, 'vigor'), '구매 실패');
  const e = metaEffects(s);
  assert(e.maxHp > 0, '최대 체력 보너스 미반영');
  assert(s.ash < 1000, '잿가루가 차감되지 않음');
  const w = createWorld({ seed: 1, weaponId: 'emberblade', metaEffects: e });
  assert(w.player.maxHp > PLAYER.MAX_HP, '메타 강화가 런에 반영되지 않음');
});

// ---- 결과 출력 ----
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.name}${r.err ? '\n        → ' + r.err : ''}`);
console.log(`\n단위 테스트: ${results.length - failed.length}/${results.length} 통과`);
if (failed.length) process.exitCode = 1;
