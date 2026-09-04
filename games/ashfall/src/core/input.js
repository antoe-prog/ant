// 입력 → intent 변환. sim 은 키보드/마우스를 모른다.
// 마우스 조준 + 키보드 이동. 마우스를 안 쓰면 가장 가까운 적을 자동 조준.

export function createInput(canvas, camera, world) {
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
    keys, mouse,
    /** 현재 조준 지점(월드 좌표) */
    aim(viewW, viewH) {
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
      return {
        mx, my,
        aimX: a.x, aimY: a.y,
        attack: mouse.down || held('attack'),
        special: mouse.right || held('special'),
        dash: held('dash'),
      };
    },
  };
}
