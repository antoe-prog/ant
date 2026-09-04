// ============================================================
// 터치 감도 실측 리포트.
//
// 사람 엄지의 특성을 모사한 입력으로 실제 브라우저에서 플레이시키고,
// "감각"이 아니라 수치로 감도를 판단한다.
//
//  - 떨림(jitter): 엄지는 정확히 한 점을 유지하지 못한다
//  - 짧은 드래그: 엄지 가동 범위는 작다 (보통 25~55px)
//  - 반응 지연: 화면을 보고 손이 따라가는 데 시간이 걸린다
//
// 실행: node tests/touch-report.mjs   (playwright-core 필요)
// ============================================================
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.PORT || 8215);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 손 특성 프리셋
const THUMB = {
  jitter: 7,        // 프레임당 좌표 흔들림(px)
  dragLen: [26, 52],// 엄지가 실제로 끄는 거리
  reaction: 0.18,   // 반응 지연(초) — 목표가 움직여도 손은 늦게 따라온다
};

const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
await sleep(600);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

/** 한 판을 시뮬레이션 엄지로 플레이하고 지표를 수집한다 */
async function play({ weaponId = 'emberblade', seconds = 42, viewport = { width: 390, height: 844 }, label = '', touch = null }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(400);
  // 감도 설정을 실험 조건으로 덮어쓴다
  if (touch) {
    await page.evaluate((t) => {
      for (const [k, v] of Object.entries(t)) window.__ashfall.game.setTouch(k, v);
    }, touch);
  }
  await page.locator(`[data-weapon="${weaponId}"]`).tap();
  await page.locator('#startBtn').tap();
  await sleep(900);

  // 계측 훅 설치: 스윙/명중, 조준 오차
  await page.evaluate(() => {
    const w = window.__ashfall.world;
    const m = { swings: 0, hits: 0, aimErrSum: 0, aimErrN: 0, stickOverflow: 0, stickSamples: 0, hurt: 0 };
    window.__m = m;
    w.bus.on('attack', () => m.swings++);
    w.bus.on('hit', (p) => { if (!p.tick) m.hits++; });
    w.bus.on('playerHurt', () => m.hurt++);
  });

  const V = viewport;
  const moveOrigin = { x: V.width * 0.22, y: V.height * 0.80 };
  const aimOrigin = { x: V.width * 0.72, y: V.height * 0.72 };
  let moveDown = false, aimDown = false;
  let aimSmoothed = null;

  const send = (type, id, x, y) =>
    page.dispatchEvent('#game', type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, buttons: 1 });

  const jit = () => (Math.random() * 2 - 1) * THUMB.jitter;

  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const s = await page.evaluate(() => {
      const w = window.__ashfall.world;
      if (w.run.state === 'dead' || w.run.state === 'victory') return { over: true };
      if (document.getElementById('overlay').dataset.screen) return { menu: true };
      const p = w.player;
      let best = null, bd = Infinity;
      for (const e of w.enemies) {
        if (e.dead || e.spawnT > 0) continue;
        const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      // 문으로 이동해야 하는 상태
      if (w.run.state === 'cleared' && w.doors.length) {
        const d = w.doors[0];
        const L = Math.hypot(d.x - p.x, d.y - p.y) || 1;
        return { moveTo: { x: (d.x - p.x) / L, y: (d.y - p.y) / L }, aimAt: null };
      }
      if (!best) return { idle: true };
      const L = Math.sqrt(bd) || 1;
      const reach = Math.max(...w.weapon.combo.map((c) => c.range));
      return {
        aimAt: { x: (best.x - p.x) / L, y: (best.y - p.y) / L },
        moveTo: L > best.radius + reach * 0.7 ? { x: (best.x - p.x) / L, y: (best.y - p.y) / L } : null,
        dist: L,
        facing: p.facing,
      };
    });

    if (s.over) break;
    if (s.menu) {
      // 선택창이 뜨면 첫 카드를 누른다
      const c = page.locator('.card, #leave, #again').first();
      if (await c.isVisible().catch(() => false)) { await c.tap(); await sleep(500); }
      continue;
    }

    // --- 이동 스틱 ---
    if (s.moveTo) {
      const len = THUMB.dragLen[0] + Math.random() * (THUMB.dragLen[1] - THUMB.dragLen[0]);
      const mx = moveOrigin.x + s.moveTo.x * len + jit();
      const my = moveOrigin.y + s.moveTo.y * len + jit();
      if (!moveDown) { await send('pointerdown', 1, moveOrigin.x, moveOrigin.y); moveDown = true; }
      await send('pointermove', 1, mx, my);
    } else if (moveDown) {
      await send('pointerup', 1, moveOrigin.x, moveOrigin.y); moveDown = false;
    }

    // --- 조준 스틱 (반응 지연 + 떨림) ---
    if (s.aimAt) {
      if (!aimSmoothed) aimSmoothed = { ...s.aimAt };
      const k = 0.35; // 손이 목표를 따라가는 속도
      aimSmoothed.x += (s.aimAt.x - aimSmoothed.x) * k;
      aimSmoothed.y += (s.aimAt.y - aimSmoothed.y) * k;
      const nl = Math.hypot(aimSmoothed.x, aimSmoothed.y) || 1;
      const len = THUMB.dragLen[0] + Math.random() * (THUMB.dragLen[1] - THUMB.dragLen[0]);
      const ax = aimOrigin.x + (aimSmoothed.x / nl) * len + jit();
      const ay = aimOrigin.y + (aimSmoothed.y / nl) * len + jit();
      if (!aimDown) { await send('pointerdown', 2, aimOrigin.x, aimOrigin.y); aimDown = true; }
      await send('pointermove', 2, ax, ay);

      // 조준 오차 계측: 실제 플레이어 facing 과 목표 방향의 각도차
      await page.evaluate(({ tx, ty }) => {
        const w = window.__ashfall.world, m = window.__m;
        const want = Math.atan2(ty, tx);
        let d = Math.abs(((w.player.facing - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        m.aimErrSum += d * 180 / Math.PI;
        m.aimErrN++;
      }, { tx: s.aimAt.x, ty: s.aimAt.y });
    } else if (aimDown) {
      await send('pointerup', 2, aimOrigin.x, aimOrigin.y); aimDown = false;
      aimSmoothed = null;
    }

    await sleep(55);
  }

  if (moveDown) await send('pointerup', 1, moveOrigin.x, moveOrigin.y);
  if (aimDown) await send('pointerup', 2, aimOrigin.x, aimOrigin.y);

  const out = await page.evaluate(() => {
    const w = window.__ashfall.world, m = window.__m;
    return {
      kills: w.run.kills, elapsed: w.run.elapsed, hp: Math.round(w.player.hp), maxHp: w.player.maxHp,
      room: `${w.run.biomeIdx + 1}-${w.run.roomIdx + 1}`, state: w.run.state,
      swings: m.swings, hits: m.hits, hurt: m.hurt,
      aimErr: m.aimErrN ? m.aimErrSum / m.aimErrN : 0,
    };
  });
  await page.close();
  return { ...out, errors, label };
}

// 실험 조건: 조준 보정 강도만 바꾼다 (나머지는 동일)
const CONDITIONS = (process.env.SWEEP || 'ab') === 'ab'
  ? [
      { name: '보정 없음', touch: { aimAssist: 0 } },
      { name: '보정 0.55', touch: { aimAssist: 0.55 } },
      { name: '보정 0.85', touch: { aimAssist: 0.85 } },
    ]
  : [{ name: '현재 설정', touch: null }];
const REPS = Number(process.env.REPS || 3);
const SECS = Number(process.env.SECS || 30);

const byCond = [];
for (const c of CONDITIONS) {
  const rows = [];
  for (let i = 0; i < REPS; i++) {
    const wid = i % 2 === 0 ? 'emberblade' : 'twinfangs';
    rows.push(await play({ weaponId: wid, seconds: SECS, label: `${c.name}#${i + 1}`, touch: c.touch }));
  }
  byCond.push({ cond: c.name, rows });
}

const avg = (rows, f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
const sd = (rows, f) => {
  const m = avg(rows, f);
  return Math.sqrt(rows.reduce((a, r) => a + (f(r) - m) ** 2, 0) / Math.max(1, rows.length - 1));
};

console.log(`\n=== 터치 실측 (폰 세로 390x844, 엄지 모사 입력, 조건당 ${REPS}판 × ${SECS}초) ===`);
console.log('조건        분당처치      명중률     조준오차        분당피격');
for (const { cond, rows } of byCond) {
  const kpm = (r) => r.kills / Math.max(1, r.elapsed) * 60;
  const acc = (r) => r.hits / Math.max(1, r.swings) * 100;
  const err = (r) => r.aimErr;
  const hurt = (r) => r.hurt / Math.max(1, r.elapsed) * 60;
  console.log(
    `${cond.padEnd(11)} ` +
    `${avg(rows, kpm).toFixed(1).padStart(5)}±${sd(rows, kpm).toFixed(1).padEnd(4)} ` +
    `${avg(rows, acc).toFixed(0).padStart(4)}%±${sd(rows, acc).toFixed(0).padEnd(3)} ` +
    `${avg(rows, err).toFixed(1).padStart(6)}°±${sd(rows, err).toFixed(1).padEnd(4)} ` +
    `${avg(rows, hurt).toFixed(1).padStart(6)}±${sd(rows, hurt).toFixed(1)}`
  );
}
const errs = byCond.flatMap((c) => c.rows).flatMap((r) => r.errors);
if (errs.length) console.log('에러:', errs.slice(0, 3));

await browser.close();
server.kill();
