// ============================================================
// 터치 컨트롤 (모바일).
//
// 좌측: 가상 스틱 이동 — 누른 자리가 원점. 반경을 넘으면 원점이 따라온다(sliding).
//        엄지 가동 범위는 작아서, 원점이 고정이면 금방 "스틱이 끝까지 꺾인 채로" 굳는다.
// 우측: 드래그로 조준 + 자동 공격. 짧게 톡 치면 가장 가까운 적을 친다.
//        엄지 조준은 각도 오차가 크므로(짧은 드래그 + 손떨림) 조준 보정을 넣는다.
// 우하단: 대시 / 특수기 / 명령 버튼.
//
// 모든 감도 값은 save.touch 에서 온다 — 손 크기와 그립은 사람마다 다르다.
// 출력은 키보드·마우스와 동일한 intent 객체다. sim 은 입력 장치를 모른다.
// ============================================================

import { TOUCH_DEFAULTS } from '../data/balance.js';

/**
 * 화면 크기에 맞춘 버튼 배치. 렌더러와 히트 판정이 같은 값을 쓴다.
 * @param {object} cfg save.touch (없으면 기본값)
 */
export function touchButtons(viewW, viewH, cfg = TOUCH_DEFAULTS) {
  const k = Math.max(0.78, Math.min(1.15, Math.min(viewW, viewH) / 640)) * (cfg.buttonScale ?? 1);
  const R = 42 * k;
  const margin = 26;
  const bx = cfg.leftHanded ? margin + R : viewW - margin - R;
  const by = viewH - margin - R;
  const sx = cfg.leftHanded ? 1 : -1;   // 좌우 반전
  return [
    { id: 'dash',    label: '대시', x: bx,                    y: by,             r: R },
    { id: 'special', label: '특수', x: bx + sx * R * 2.25,    y: by - R * 0.55,  r: R * 0.88 },
    { id: 'command', label: '명령', x: bx + sx * R * 0.55,    y: by - R * 2.25,  r: R * 0.8 },
  ];
}

/** 화면 크기에 비례한 실제 스틱 반경 (작은 폰에서 반경이 너무 크면 못 꺾는다) */
function stickRadiusFor(cfg, viewW, viewH) {
  const base = cfg.stickRadius ?? TOUCH_DEFAULTS.stickRadius;
  const k = Math.max(0.75, Math.min(1.2, Math.min(viewW, viewH) / 700));
  return base * k;
}

export function createTouch(canvas, world, getCfg) {
  const cfg = () => (getCfg ? getCfg() : TOUCH_DEFAULTS);

  const state = {
    active: false,
    move: null,   // {id, ox, oy, x, y}
    aim: null,    // {id, ox, oy, x, y, t0, moved}
    buttons: {},
    pressed: { dash: false, special: false, command: false },
    tapped: { dash: false, special: false, command: false },
    tapFire: 0,   // 톡 쳐서 발생한 공격 지속 시간
  };

  const view = () => {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  };

  function hitButton(x, y, v) {
    for (const b of touchButtons(v.w, v.h, cfg())) {
      const dx = x - b.x, dy = y - b.y;
      // 판정은 보이는 것보다 조금 넓게 — 엄지는 정확히 가운데를 못 누른다
      if (dx * dx + dy * dy <= (b.r + 14) * (b.r + 14)) return b;
    }
    return null;
  }

  function buzz(ms) {
    if (!cfg().haptics) return;
    try { navigator.vibrate && navigator.vibrate(ms); } catch { /* 미지원 기기 */ }
  }

  /** 이동 스틱이 놓이는 쪽 (왼손잡이면 반전) */
  const isMoveSide = (x, v) => (cfg().leftHanded ? x >= v.w * 0.5 : x < v.w * 0.5);

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
      buzz(12);
      e.preventDefault();
      return;
    }
    if (isMoveSide(x, v)) {
      if (!state.move) state.move = { id: e.pointerId, ox: x, oy: y, x, y };
    } else if (!state.aim) {
      state.aim = { id: e.pointerId, ox: x, oy: y, x, y, t0: performance.now(), moved: false };
    }
    e.preventDefault();
  }

  function onMove(e) {
    if (e.pointerType === 'mouse') return;
    const v = view();
    const x = e.clientX - v.left, y = e.clientY - v.top;
    const R = stickRadiusFor(cfg(), v.w, v.h);

    const slide = (s0) => {
      s0.x = x; s0.y = y;
      if (!cfg().slidingStick) return;
      // 반경을 넘어가면 원점을 끌고 온다 → 엄지가 끝까지 가도 방향 제어가 유지된다
      const dx = s0.x - s0.ox, dy = s0.y - s0.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        s0.ox = s0.x - (dx / len) * R;
        s0.oy = s0.y - (dy / len) * R;
      }
    };

    if (state.move && state.move.id === e.pointerId) slide(state.move);
    else if (state.aim && state.aim.id === e.pointerId) {
      if (Math.hypot(x - state.aim.ox, y - state.aim.oy) > 10) state.aim.moved = true;
      slide(state.aim);
    }
    e.preventDefault();
  }

  function onUp(e) {
    if (e.pointerType === 'mouse') return;
    const id = state.buttons[e.pointerId];
    if (id) { state.pressed[id] = false; delete state.buttons[e.pointerId]; }
    if (state.move && state.move.id === e.pointerId) state.move = null;
    if (state.aim && state.aim.id === e.pointerId) {
      // 짧게 톡 친 경우 = 가장 가까운 적을 향한 공격
      const held = performance.now() - state.aim.t0;
      if (cfg().tapToAttack && !state.aim.moved && held < 260) state.tapFire = 0.22;
      state.aim = null;
    }
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return {
    state,
    buzz,
    get active() { return state.active; },
    buttons(viewW, viewH) { return touchButtons(viewW, viewH, cfg()); },
    stickRadius(viewW, viewH) { return stickRadiusFor(cfg(), viewW, viewH); },

    /** 이동 입력 (-1..1) */
    moveVector(viewW, viewH) {
      if (!state.move) return { x: 0, y: 0 };
      const c = cfg();
      const R = stickRadiusFor(c, viewW || 800, viewH || 800);
      const dx = state.move.x - state.move.ox, dy = state.move.y - state.move.oy;
      const len = Math.hypot(dx, dy);
      if (len < (c.stickDead ?? 6)) return { x: 0, y: 0 };
      const k = Math.min(1, len / R) / len;
      return { x: dx * k, y: dy * k };
    },

    /**
     * 조준 방향과 공격 여부.
     * 엄지는 각도 오차가 크므로, 조준 방향이 적을 '거의' 향하면 그 적으로 끌어당긴다.
     */
    aimVector(viewW, viewH) {
      const c = cfg();
      if (state.tapFire > 0) {
        const t = nearestEnemyDir();
        if (t) return { x: t.x, y: t.y, firing: true, assisted: true };
      }
      if (!state.aim) return null;
      const dx = state.aim.x - state.aim.ox, dy = state.aim.y - state.aim.oy;
      const len = Math.hypot(dx, dy);
      if (len < (c.stickDead ?? 6)) return { x: 0, y: 0, firing: false };
      let ax = dx / len, ay = dy / len;

      const assist = c.aimAssist ?? 0;
      if (assist > 0) {
        const t = nearestEnemyDir(Math.atan2(ay, ax), (c.assistCone ?? 42) * Math.PI / 180);
        if (t) {
          ax += (t.x - ax) * assist;
          ay += (t.y - ay) * assist;
          const l2 = Math.hypot(ax, ay) || 1;
          ax /= l2; ay /= l2;
        }
      }
      return { x: ax, y: ay, firing: true };
    },

    /** 프레임 끝에서 호출 */
    endFrame(dt = 0) {
      state.tapped.dash = false;
      state.tapped.special = false;
      state.tapped.command = false;
      if (state.tapFire > 0) state.tapFire -= dt;
    },
  };

  /**
   * 가장 가까운 적 방향.
   * withinAngle 이 주어지면 그 원뿔 안의 적만 후보로 삼는다(조준 보정용).
   */
  function nearestEnemyDir(fromAngle, cone) {
    const p = world.player;
    let best = null, bd = Infinity;
    for (const e of world.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = dx * dx + dy * dy;
      if (d > 620 * 620) continue;
      if (cone != null) {
        const a = Math.atan2(dy, dx);
        let diff = Math.abs(((a - fromAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff > cone) continue;
      }
      if (d < bd) { bd = d; best = { x: dx, y: dy }; }
    }
    if (!best) return null;
    const l = Math.hypot(best.x, best.y) || 1;
    return { x: best.x / l, y: best.y / l };
  }
}
