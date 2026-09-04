// 입력 → intent 변환. sim 은 입력 장치를 모른다.
// 키보드+마우스 / 터치를 같은 intent 로 합쳐서 내보낸다.

import { createTouch } from './touch.js';

export function createInput(canvas, camera, world) {
  const touch = createTouch(canvas, world);
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, right: false, movedAt: -999 };
  let usedMouse = false;

  const KEYMAP = {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    dash: ['Space', 'ShiftLeft', 'ShiftRight'],
    attack: ['KeyJ', 'KeyZ'],
    special: ['KeyK', 'KeyX'],
    command: ['KeyF'],
  };
  const held = (action) => KEYMAP[action].some((c) => keys.has(c));

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; mouse.right = false; });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    usedMouse = true;
    document.body.classList.add('pointer');
  });
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) mouse.right = true;
    usedMouse = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    keys, mouse, touch,
    get touchActive() { return touch.active; },

    /** 현재 조준 지점(월드 좌표) */
    aim(viewW, viewH) {
      // 터치 조준이 최우선 (모바일에서 마우스 좌표는 의미가 없다)
      const av = touch.aimVector();
      if (av && (av.x || av.y)) {
        const p = world.player;
        return { x: p.x + av.x * 260, y: p.y + av.y * 260 };
      }
      if (touch.active) {
        // 조준 중이 아니면 가장 가까운 적을 본다
        const t = nearestEnemyAim();
        if (t) return t;
      }
      if (usedMouse) return camera.toWorld(mouse.x, mouse.y, viewW, viewH);
      // 키보드 전용: 가장 가까운 적 자동 조준
      const p = world.player;
      let best = null, bd = Infinity;
      for (const e of world.enemies) {
        if (e.dead) continue;
        const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) return { x: best.x, y: best.y };
      return { x: p.x + Math.cos(p.facing) * 100, y: p.y + Math.sin(p.facing) * 100 };
    },
    intent(viewW, viewH) {
      const a = this.aim(viewW, viewH);
      let mx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      let my = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);

      const tm = touch.moveVector();
      if (tm.x || tm.y) { mx = tm.x; my = tm.y; }

      const av = touch.aimVector();
      const ts = touch.state;

      return {
        mx, my,
        aimX: a.x, aimY: a.y,
        attack: mouse.down || held('attack') || !!(av && av.firing),
        special: mouse.right || held('special') || ts.pressed.special,
        dash: held('dash') || ts.pressed.dash,
        command: held('command') || ts.pressed.command,
      };
    },

    endFrame() { touch.endFrame(); },
  };

  /** 키보드 전용/터치 조작에서 가장 가까운 적을 자동 조준 */
  function nearestEnemyAim() {
    const p = world.player;
    let best = null, bd = Infinity;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { x: best.x, y: best.y } : null;
  }
}
