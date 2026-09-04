// ============================================================
// 터치 컨트롤 (모바일).
//
// 좌측 절반: 가상 스틱으로 이동 (누른 자리가 곧 스틱 원점 — 손 위치를 강요하지 않는다)
// 우측 절반: 드래그로 조준하며 자동 공격 (트윈스틱 표준)
// 우하단 버튼: 대시 / 특수기 / 소환수 명령
//
// 출력은 키보드·마우스와 동일한 intent 객체다. sim 은 입력 장치를 모른다.
// ============================================================

const STICK_RADIUS = 62;      // 최대 기울기 거리(px, CSS 픽셀 기준)
const STICK_DEAD = 8;         // 데드존

/** 화면 크기에 맞춘 버튼 배치. 렌더러와 히트 판정이 같은 값을 쓴다. */
export function touchButtons(viewW, viewH) {
  const k = Math.max(0.78, Math.min(1.15, Math.min(viewW, viewH) / 640));
  const R = 42 * k;
  const bx = viewW - 26 - R;
  const by = viewH - 26 - R;
  return [
    { id: 'dash',    label: '대시', x: bx,             y: by,             r: R },
    { id: 'special', label: '특수', x: bx - R * 2.25,  y: by - R * 0.55,  r: R * 0.88 },
    { id: 'command', label: '명령', x: bx - R * 0.55,  y: by - R * 2.25,  r: R * 0.8 },
  ];
}

export function createTouch(canvas, world) {
  const state = {
    active: false,          // 터치를 한 번이라도 썼는가 (HUD 표시 여부)
    move: null,             // {id, ox, oy, x, y}
    aim: null,              // {id, ox, oy, x, y}
    buttons: {},            // id -> pointerId
    pressed: { dash: false, special: false, command: false },
    tapped: { dash: false, special: false, command: false }, // 이번 프레임에 눌렸는가
  };

  const view = () => {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  };

  function hitButton(x, y, v) {
    for (const b of touchButtons(v.w, v.h)) {
      const dx = x - b.x, dy = y - b.y;
      if (dx * dx + dy * dy <= (b.r + 12) * (b.r + 12)) return b;
    }
    return null;
  }

  function onDown(e) {
    if (e.pointerType === 'mouse') return;
    state.active = true;
    const v = view();
    const x = e.clientX - v.left, y = e.clientY - v.top;

    const btn = hitButton(x, y, v);
    if (btn) {
      state.buttons[e.pointerId] = btn.id;
      state.pressed[btn.id] = true;
      state.tapped[btn.id] = true;
      e.preventDefault();
      return;
    }
    if (x < v.w * 0.5) {
      if (!state.move) state.move = { id: e.pointerId, ox: x, oy: y, x, y };
    } else if (!state.aim) {
      state.aim = { id: e.pointerId, ox: x, oy: y, x, y };
    }
    e.preventDefault();
  }

  function onMove(e) {
    if (e.pointerType === 'mouse') return;
    const v = view();
    const x = e.clientX - v.left, y = e.clientY - v.top;
    if (state.move && state.move.id === e.pointerId) { state.move.x = x; state.move.y = y; }
    else if (state.aim && state.aim.id === e.pointerId) { state.aim.x = x; state.aim.y = y; }
    e.preventDefault();
  }

  function onUp(e) {
    if (e.pointerType === 'mouse') return;
    const id = state.buttons[e.pointerId];
    if (id) { state.pressed[id] = false; delete state.buttons[e.pointerId]; }
    if (state.move && state.move.id === e.pointerId) state.move = null;
    if (state.aim && state.aim.id === e.pointerId) state.aim = null;
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return {
    state,
    get active() { return state.active; },
    buttons(viewW, viewH) { return touchButtons(viewW, viewH); },

    /** 이동 입력 (-1..1) */
    moveVector() {
      if (!state.move) return { x: 0, y: 0 };
      const dx = state.move.x - state.move.ox, dy = state.move.y - state.move.oy;
      const len = Math.hypot(dx, dy);
      if (len < STICK_DEAD) return { x: 0, y: 0 };
      const k = Math.min(1, len / STICK_RADIUS) / len;
      return { x: dx * k, y: dy * k };
    },

    /** 조준 방향(정규화)과 공격 여부 */
    aimVector() {
      if (!state.aim) return null;
      const dx = state.aim.x - state.aim.ox, dy = state.aim.y - state.aim.oy;
      const len = Math.hypot(dx, dy);
      if (len < STICK_DEAD) return { x: 0, y: 0, firing: false };
      return { x: dx / len, y: dy / len, firing: true };
    },

    /** 프레임 끝에서 호출 — 탭(한 번 누름) 플래그를 비운다 */
    endFrame() {
      state.tapped.dash = false;
      state.tapped.special = false;
      state.tapped.command = false;
    },
  };
}
