// ============================================================
// 브라우저 스모크 테스트 — 실제 페이지를 띄우고 실제 입력으로 플레이한다.
// 준비: npm i playwright-core  (또는 games/ashfall/node_modules 에 심볼릭 링크)
// 실행: node tests/browser.mjs
// ============================================================
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.PORT || 8199);
const SHOTS = process.env.SHOT_DIR || path.join(ROOT, '.shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
await sleep(600);

const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
const state = () => page.evaluate(() => {
  const w = window.__ashfall.world;
  if (!w) return { screen: document.getElementById('overlay').dataset.screen || '' };
  return {
    runState: w.run.state, biome: w.run.biomeIdx + 1, room: w.run.roomIdx + 1,
    hp: Math.round(w.player.hp), maxHp: w.player.maxHp, enemies: w.enemies.filter((e) => !e.dead).length,
    kills: w.run.kills, boons: w.run.owned.length, gold: w.run.gold,
    elapsed: +w.run.elapsed.toFixed(1),
    screen: document.getElementById('overlay').dataset.screen || '',
  };
});

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${info ? '  ' + info : ''}`);
};

// ---- 브라우저 안에서 조준/이동을 계산해 실제 입력으로 되돌린다 ----
const decide = () => page.evaluate(() => {
  const w = window.__ashfall.world, cam = w.camera;
  const canvas = document.getElementById('game');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.width / dpr, H = canvas.height / dpr;
  const screen = document.getElementById('overlay').dataset.screen || '';
  if (screen) return { screen };
  const p = w.player;
  let tx, ty, attack = false;
  if (w.run.state === 'cleared' && w.doors.length) { tx = w.doors[0].x; ty = w.doors[0].y; }
  else {
    let best = null, bd = Infinity;
    for (const e of w.enemies) {
      if (e.dead) continue;
      const dd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best) return { keys: [], screen: '', runState: w.run.state };
    tx = best.x; ty = best.y;
    attack = Math.sqrt(bd) < best.radius + p.radius + 46;
  }
  const dx = tx - p.x, dy = ty - p.y;
  const keys = [];
  if (Math.hypot(dx, dy) > 62) {
    if (dy < -20) keys.push('KeyW');
    if (dy > 20) keys.push('KeyS');
    if (dx < -20) keys.push('KeyA');
    if (dx > 20) keys.push('KeyD');
  }
  return {
    keys, attack, screen: '', runState: w.run.state,
    mx: (tx - cam.x) * cam.zoom + W / 2, my: (ty - cam.y) * cam.zoom + H / 2,
    special: p.focus > p.maxFocus * 0.8,
  };
});

const heldKeys = new Set();
let mouseDown = false;
let box = null;
async function applyKeys(keys) {
  for (const k of [...heldKeys]) if (!keys.includes(k)) { await page.keyboard.up(k); heldKeys.delete(k); }
  for (const k of keys) if (!heldKeys.has(k)) { await page.keyboard.down(k); heldKeys.add(k); }
}
async function playFor(ms) {
  const end = Date.now() + ms;
  let i = 0;
  while (Date.now() < end) {
    const d = await decide();
    if (d.screen) break;
    await applyKeys(d.keys || []);
    if (d.mx != null) await page.mouse.move(box.x + d.mx, box.y + d.my);
    if (d.attack && !mouseDown) { await page.mouse.down(); mouseDown = true; }
    else if (!d.attack && mouseDown) { await page.mouse.up(); mouseDown = false; }
    if (d.special && i % 8 === 0) await page.keyboard.press('KeyK');
    if (i % 7 === 3) await page.keyboard.press('Space');
    i++;
    await sleep(70);
  }
  await applyKeys([]);
  if (mouseDown) { await page.mouse.up(); mouseDown = false; }
}

// ============================================================
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await sleep(400);
check('타이틀 화면 렌더', await page.locator('#startBtn').isVisible());
check('메타 강화 패널 표시', await page.locator('.upg').first().isVisible());
await shot('01-title');

await page.locator('[data-weapon="emberblade"]').click();
await page.locator('#startBtn').click();
await sleep(900);
let s = await state();
check('런 시작 → 전투 상태', s.runState === 'fight', JSON.stringify(s));
check('적 스폰', s.enemies > 0, `적 ${s.enemies}`);
box = await page.locator('#game').boundingBox();
await shot('02-combat');

await page.keyboard.press('Escape');
await sleep(300);
check('Esc 일시정지', (await state()).screen === 'pause');
await shot('03-pause');
await page.locator('#resume').click();
await sleep(250);
check('일시정지 해제', (await state()).screen === '');

await playFor(8000);
s = await state();
check('실제 입력으로 적 처치', s.kills > 0, `처치 ${s.kills}`);
check('골드 드롭 획득', s.gold > 0, `◈ ${s.gold}`);
await shot('04-fighting');

// ---- 권능 UI 배선 (RNG 비의존) ----
if ((await state()).screen === '') {
  await page.evaluate(() => window.__ashfall.director.openReward({ kind: 'boon' }));
  await sleep(400);
}
check('권능 선택 화면', await page.locator('.boon').first().isVisible());
check('선택지 3개', (await page.locator('.boon').count()) === 3);
await shot('05-boon-choice');
const snapshot = () => page.evaluate(() => {
  const w = window.__ashfall.world;
  return JSON.stringify({
    stats: w.loadout.stats, mods: w.loadout.mods,
    atk: w.loadout.attackStatus.length, sp: w.loadout.specialStatus.length,
    hooks: Object.values(w.loadout.on).reduce((a, b) => a + b.length, 0),
  });
});
const before = (await state()).boons;
const loadoutBefore = await snapshot();
await page.locator('.boon').first().click();
await sleep(500);
s = await state();
check('선택이 빌드에 반영', s.boons === before + 1, `${before} → ${s.boons}`);
const loadoutAfter = await snapshot();
check('권능이 전투 로드아웃에 컴파일됨(스탯/훅 변화)', loadoutAfter !== loadoutBefore);

// ---- 클리어 → 문 → 다음 방 ----
await page.evaluate(() => {
  const w = window.__ashfall.world;
  w.spawnQueue.length = 0;              // 남은 웨이브 취소
  for (const e of w.enemies) e.dead = true;  // 즉시 전멸시켜 클리어 전이를 검증
});
await sleep(700);
s = await state();
check('전멸 → 클리어 상태', s.runState === 'cleared', JSON.stringify(s));
const doors = await page.evaluate(() => window.__ashfall.world.doors.map((d) => d.reward.kind));
check('문(다음 방 선택지) 생성', doors.length >= 1, doors.join(', '));
await shot('06-doors');

const roomBefore = (await state()).room;
await playFor(10000);
await sleep(500);
s = await state();
check('문 진입 → 방 진행', s.room > roomBefore || !!s.screen, `방 ${roomBefore} → ${s.room} (화면 ${s.screen || '없음'})`);
await shot('07-next-room');

// ---- 보스전 ----
// 어떤 화면이 떠 있든 정리하고 반드시 플레이 상태로 되돌린다 (사망했다면 새 런 시작)
async function dismissScreens() {
  for (let i = 0; i < 6; i++) {
    const sc = (await state()).screen;
    if (!sc) return true;
    const btn = page.locator('#again, #resume, #leave, .boon, .curse').first();
    if (await btn.isVisible().catch(() => false)) { await btn.click(); await sleep(800); }
    else return false;
  }
  return !(await state()).screen;
}
const ready = await dismissScreens();
check('선택/결과 화면에서 플레이로 복귀', ready, `화면 ${(await state()).screen || '없음'}`);
await page.evaluate(() => {
  const g = window.__ashfall;
  g.world.run.roomIdx = 4; g.world.run.globalRoom = 4;
  g.director.enterRoom({ type: 'boss' });
});
await sleep(1800);
const bossInfo = await page.evaluate(() => {
  const b = window.__ashfall.world.boss;
  return b ? { name: b.def.name, hp: Math.round(b.hp), phases: b.def.phases.length } : null;
});
check('보스 등장', !!bossInfo, JSON.stringify(bossInfo));
await playFor(6000);
const bossHpK = await page.evaluate(() => {
  const b = window.__ashfall.world.boss;
  return b ? +(b.hp / b.maxHp).toFixed(2) : 0;
});
check('보스에게 피해 적용', bossHpK < 1, `남은 체력 ${Math.round(bossHpK * 100)}%`);
await shot('08-boss');

// ---- 사령술: 새 런을 강령장으로 시작해 시체 → 소환수 루프를 검증 ----
await dismissScreens();
await page.evaluate(() => window.__ashfall.game.startRun('gravecall'));
await sleep(1000);
check('강령장으로 런 시작', (await state()).runState === 'fight');
await page.evaluate(() => {
  const w = window.__ashfall.world;
  w.spawnQueue.length = 0;
  for (const e of w.enemies) e.hp = 1;   // 곧바로 처치되도록
});
await playFor(6000);
const necro = await page.evaluate(() => {
  const w = window.__ashfall.world;
  return { corpses: w.corpses.length, minions: w.minions.length, cap: w.minionCap(), kills: w.run.kills };
});
check('처치 시 시체가 남거나 소환수가 생긴다', necro.corpses > 0 || necro.minions > 0, JSON.stringify(necro));

// 망자 봉기(특수기)로 시체를 소환수로 전환
await page.evaluate(() => {
  const w = window.__ashfall.world;
  const p = w.player;
  p.focus = p.maxFocus;
  w.minions.length = 0;
  w.corpses.length = 0;
  for (let i = 0; i < 3; i++) {
    w.corpses.push({ x: p.x + 40 + i * 25, y: p.y, radius: 15, scale: 1, enemyId: 'husk', life: 10, seed: 0, used: false });
  }
});
const preSpecial = await page.evaluate(() => {
  const p = window.__ashfall.world.player;
  return { state: p.state, spCd: +p.spCd.toFixed(2), focus: Math.round(p.focus), dead: p.dead };
});
// 특수기 쿨다운이 남아 있을 수 있으므로 조건이 갖춰질 때까지 눌러 본다
let raised = null;
for (let i = 0; i < 12; i++) {
  await page.keyboard.down('KeyK');
  await sleep(120);
  await page.keyboard.up('KeyK');
  await sleep(180);
  raised = await page.evaluate(() => ({
    minions: window.__ashfall.world.minions.length,
    corpses: window.__ashfall.world.corpses.filter((c) => !c.used).length,
  }));
  if (raised.minions > 0) break;
}
raised.pre = preSpecial;
check('망자 봉기가 시체를 소환수로 바꾼다', raised.minions > 0 && raised.corpses < 3, JSON.stringify(raised));
await shot('09-necro');

// ---- 세이브 ----
const saveData = await page.evaluate(() => {
  const raw = localStorage.getItem('ashfall.save');
  return raw ? JSON.parse(raw) : null;
});
check('세이브 기록/버전', saveData && saveData.version >= 3 && saveData.stats.runs >= 1,
  saveData ? `v${saveData.version} runs=${saveData.stats.runs}` : 'none');

const realErrors = errors.filter((e) => !/favicon|404/i.test(e));
check('콘솔 에러 없음', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
server.kill();

const failed = results.filter((r) => !r.ok);
console.log(`\n브라우저 테스트: ${results.length - failed.length}/${results.length} 통과  (스크린샷: ${SHOTS})`);
if (failed.length) process.exitCode = 1;
