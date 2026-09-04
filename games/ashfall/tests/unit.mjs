// 시뮬레이션 계층 단위 테스트. 프레임워크 없이 순수 node 로 실행.
import { Rng, hashSeed } from '../src/core/rng.js';
import { arcHit, segCircleHit, normAngle, rotateToward } from '../src/core/math.js';
import { createWorld } from '../src/sim/world.js';
import { createRun, grantBoon, buildBoonOptions } from '../src/sim/run.js';
import { buildLoadout, availableDuos, slotsUsed } from '../src/sim/loadout.js';
import { applyStatus, updateStatuses, damageEnemy, damagePlayer, healPlayer } from '../src/sim/combat.js';
import { STATUS, SIM, PLAYER, RUN, ARENA } from '../src/data/balance.js';
import { WEAPONS } from '../src/data/weapons.js';
import { BOONS, DUO_BOONS, ALL_BOONS, scaleValues } from '../src/data/boons.js';
import { ENEMIES, BOSSES, BIOMES, ENEMY_COST } from '../src/data/enemies.js';

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
