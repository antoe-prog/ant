// ============================================================
// 부트스트랩 + 게임 루프.
// 고정 타임스텝으로 시뮬레이션하고, 렌더는 프레임마다.
// ============================================================

import { SIM, VIEW, RUN, META } from './data/balance.js';
import { WEAPON_BY_ID, WEAPONS } from './data/weapons.js';
import { EventBus, EV } from './core/events.js';
import { createInput } from './core/input.js';
import { loadSave, writeSave, resetSave, metaEffects, buyUpgrade } from './core/save.js';
import { createWorld } from './sim/world.js';
import { createRun } from './sim/run.js';
import { createCamera } from './render/camera.js';
import { createVfx } from './render/vfx.js';
import { createRenderer } from './render/renderer.js';
import { createHud } from './render/hud.js';
import { createSfx } from './audio/sfx.js';
import { createScreens } from './ui/screens.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');

let save = loadSave();
let world = null, director = null, camera = null, vfx = null, renderer = null, hud = null, input = null;
let bus = new EventBus();
let sfx = createSfx(bus);
let mode = 'title';       // title | playing | paused | menu
let lastScreen = '';
let accumulator = 0;
let lastTime = performance.now();

// ---------------- 캔버스 크기 ----------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}
window.addEventListener('resize', resize);

// ---------------- 게임 컨트롤러 (UI가 호출하는 유일한 창구) ----------------
const game = {
  sfx,
  get save() { return save; },

  startRun(weaponId) {
    sfx.resume();
    save.lastWeapon = WEAPON_BY_ID[weaponId] ? weaponId : WEAPONS[0].id;
    save.stats.runs++;
    writeSave(save);

    bus = new EventBus();
    sfx = createSfx(bus);
    game.sfx = sfx;

    world = createWorld({ seed: Date.now() ^ (Math.random() * 0xffffffff), weaponId: save.lastWeapon, bus, metaEffects: metaEffects(save) });
    world.ash = 0;
    director = createRun(world);
    camera = createCamera(world);
    world.camera = camera;
    vfx = createVfx(world, bus);
    renderer = createRenderer(canvas, world, camera, vfx);
    hud = createHud(canvas, world);
    input = createInput(canvas, camera, world);

    director.start();
    mode = 'playing';
    lastScreen = '';
    screens.hide();
  },

  chooseReward(i) { director.chooseReward(i); mode = 'playing'; lastScreen = ''; },
  chooseCurse(i) { director.chooseCurse(i); mode = 'playing'; lastScreen = ''; },
  buyShop(i) {
    if (director.buyShop(i)) sfx.ui();
    screens.shop(director.shopItems, world.run.gold);
  },
  rerollShop() {
    if (director.rerollShop()) sfx.ui();
    screens.shop(director.shopItems, world.run.gold);
  },
  leaveShop() { director.leaveShop(); mode = 'playing'; lastScreen = ''; },
  resume() { mode = 'playing'; },
  abandon() { finishRun(false); },

  buyUpgrade(id) {
    const ok = buyUpgrade(save, id);
    if (ok) sfx.ui();
    return ok;
  },
  resetSave() { save = resetSave(); },
};

const screens = createScreens(overlay, game);

// ---------------- 런 종료 처리 ----------------
function finishRun(won) {
  const run = world.run;
  const place = `${run.biomeIdx + 1}-${run.roomIdx + 1}`;
  const ash = Math.round(world.ash || 0);

  save.ash += ash;
  save.stats.kills += run.kills;
  if (won) {
    save.stats.wins++;
    if (!save.stats.bestTime || run.elapsed < save.stats.bestTime) save.stats.bestTime = run.elapsed;
  }
  if (deeper(place, save.stats.deepest)) save.stats.deepest = place;
  writeSave(save);

  mode = 'menu';
  screens.result(won, {
    place: won ? '회랑 돌파' : `${place} 에서 사망`,
    time: run.elapsed,
    kills: run.kills,
    weapon: world.weapon.name,
    damageTaken: run.damageTaken,
    curses: run.curses.length ? run.curses.length + '개' : '',
    ash,
    owned: run.owned,
  });
}

function deeper(a, b) {
  const pa = a.split('-').map(Number), pb = String(b || '1-1').split('-').map(Number);
  return pa[0] > pb[0] || (pa[0] === pb[0] && pa[1] > pb[1]);
}

// ---------------- 화면 상태 동기화 ----------------
function syncScreens() {
  if (!world) return;
  const st = world.run.state;
  if (st === lastScreen) return;

  if (st === 'reward') {
    const label = director.rewardKind === 'boonUpgrade' ? '권능을 강화하라' :
      (world.run.roomType === 'boss' ? '보스의 유산 — 강력한 권능을 선택하라' : '권능을 선택하라');
    screens.reward(director.rewardOptions, label);
    mode = 'menu';
  } else if (st === 'curse') {
    screens.curse(director.curseOptions);
    mode = 'menu';
  } else if (st === 'shop') {
    screens.shop(director.shopItems, world.run.gold);
    mode = 'menu';
  } else if (st === 'dead') {
    finishRun(false);
  } else if (st === 'victory') {
    sfx.victory();
    finishRun(true);
  }
  lastScreen = st;
}

// ---------------- 루프 ----------------
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (mode === 'title' || !world) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewW = canvas.width / dpr, viewH = canvas.height / dpr;

  if (mode === 'playing') {
    accumulator += dtReal;
    let steps = 0;
    while (accumulator >= SIM.DT && steps < SIM.MAX_FRAME_STEPS) {
      const intent = input.intent(viewW, viewH);
      director.update(SIM.DT);
      world.step(intent, SIM.DT);
      accumulator -= SIM.DT;
      steps++;
      if (world.run.state !== 'fight' && world.run.state !== 'cleared') break;
    }
    if (steps >= SIM.MAX_FRAME_STEPS) accumulator = 0;
    syncScreens();
  }

  // 카메라/VFX 는 메뉴 중에도 부드럽게 유지 (정지 화면이 얼어붙지 않도록)
  const aim = input.aim(viewW, viewH);
  camera.update(dtReal, aim, viewW, viewH);
  vfx.update(mode === 'playing' ? dtReal : dtReal * 0.35);
  renderer.draw(dtReal, aim);
  if (mode !== 'menu') hud.draw(dtReal);
}

// ---------------- 일시정지 ----------------
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || !world) return;
  if (mode === 'playing') {
    const run = world.run;
    mode = 'paused';
    screens.pause(`<p class="hint">${world.biome().name} ${run.biomeIdx + 1}-${run.roomIdx + 1} · 권능 ${run.owned.length}개 · ◈ ${run.gold}</p>`);
  } else if (mode === 'paused') {
    screens.hide();
    mode = 'playing';
  }
});

// ---------------- 시작 ----------------
resize();
screens.title();
requestAnimationFrame(frame);

// 개발용 콘솔 훅
window.__ashfall = { get world() { return world; }, get director() { return director; }, get save() { return save; }, game };
