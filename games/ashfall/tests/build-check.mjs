// 번들 결과물이 실제로 플레이되는지 검증한다.
// 소스가 아니라 '배포될 파일'을 그대로 연다.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'dist/ashfall.html');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 무기가 여러 개일 때만 선택 UI 가 있다. 하나뿐이면 그냥 넘어간다. */
async function pickWeapon(pg, id) {
  const el = pg.locator(`[data-weapon="${id}"]`);
  if (await el.count() && await el.isVisible().catch(() => false)) await el.click();
}

if (!fs.existsSync(FILE)) { console.error('먼저 node tools/build.mjs 를 실행하세요'); process.exit(1); }

const results = [];
const check = (n, ok, info = '') => { results.push({ n, ok }); console.log(`${ok ? '  PASS' : '  FAIL'}  ${n}${info ? '  ' + info : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// file:// 로 연다 — 서버 없이도 돌아가야 한다
await page.goto('file://' + FILE);
await sleep(900);

check('단일 파일이 file:// 에서 로드된다', await page.locator('#startBtn').isVisible());
check('모듈 번들이 초기화됐다', await page.evaluate(() => !!window.__ashfall));

await pickWeapon(page, 'gravecall');
await page.locator('#startBtn').tap();
await sleep(1200);
const s = await page.evaluate(() => {
  const w = window.__ashfall.world;
  return { state: w.run.state, enemies: w.enemies.length, arena: `${w.arena.width}x${w.arena.height}` };
});
check('런이 시작되고 적이 스폰된다', s.state === 'fight' && s.enemies > 0, JSON.stringify(s));

// 터치로 실제 전투
const send = (t, id, x, y) => page.dispatchEvent('#game', t, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: 1 });
await send('pointerdown', 2, 280, 520);
for (let i = 0; i < 45; i++) {
  const a = await page.evaluate(() => {
    const w = window.__ashfall.world, p = w.player;
    let b = null, bd = Infinity;
    for (const e of w.enemies) { if (e.dead) continue; const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < bd) { bd = d; b = e; } }
    if (!b) return null;
    const L = Math.hypot(b.x - p.x, b.y - p.y) || 1;
    return { dx: (b.x - p.x) / L, dy: (b.y - p.y) / L, far: L > 110 };
  });
  if (!a) break;
  await send('pointermove', 2, 280 + a.dx * 40, 520 + a.dy * 40);
  if (a.far) { await send('pointerdown', 1, 95, 660); await send('pointermove', 1, 95 + a.dx * 50, 660 + a.dy * 50); }
  else await send('pointerup', 1, 95, 660);
  await sleep(70);
}
const k = await page.evaluate(() => window.__ashfall.world.run.kills);
check('터치로 적을 처치한다', k > 0, `처치 ${k}`);

// 세이브가 동작하는가 (file:// 에서도 localStorage 사용 가능)
const saved = await page.evaluate(() => { try { return !!localStorage.getItem('ashfall.save'); } catch { return false; } });
check('세이브가 기록된다', saved);

await page.screenshot({ path: path.join(ROOT, '.shots/build-mobile.png') });
check('콘솔 에러 없음', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n번들 검증: ${results.length - failed.length}/${results.length} 통과`);
if (failed.length) process.exitCode = 1;
