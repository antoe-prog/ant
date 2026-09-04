// 화면 좌표계 HUD. 플레이어가 매 순간 알아야 할 것만 보여준다:
// 남은 체력 · 집중 · 대시 · 진행도 · 보스 체력 · 현재 빌드.

import { clamp, TAU } from '../core/math.js';
import { touchButtons } from '../core/touch.js';
import { RARITY } from '../data/balance.js';
import { ANY_BOON_BY_ID, GODS } from '../data/boons.js';
import { RUN } from '../data/balance.js';
import { WEAPON_UPGRADE } from '../data/weapons.js';

export function createHud(canvas, world, input) {
  const ctx = canvas.getContext('2d');
  let t = 0;
  let toast = null;
  let hpGhost = 1;

  world.bus.on('roomEnter', (p) => {
    toast = { title: `${p.biome}  ${p.biomeIdx + 1}-${p.roomIdx + 1}`, sub: labelFor(p), life: 2.4, maxLife: 2.4 };
  });
  world.bus.on('boonTaken', (p) => {
    const def = ANY_BOON_BY_ID[p.boon.id];
    const title = p.boon.title || def?.name || p.boon.id;
    const sub = p.boon.text || (def && p.boon.values ? def.desc(p.boon.values) : '');
    toast = { title, sub, life: 3.2, maxLife: 3.2, color: RARITY[p.boon.rarity]?.color };
  });

  function labelFor(p) {
    if (p.type === 'boss') return '보스';
    if (p.elite) return '엘리트 — 위험 증가';
    return '전투';
  }

  function draw(dt) {
    t += dt;
    if (toast) { toast.life -= dt; if (toast.life <= 0) toast = null; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const p = world.player;
    const run = world.run;

    // 작은 화면에서는 HUD 전체를 비율로 줄인다 (폰에서 화면을 잡아먹지 않도록)
    const S = clamp(Math.min(W, H) / 720, 0.62, 1);
    const F = (px, weight = '') => `${weight ? weight + ' ' : ''}${Math.round(px * S)}px system-ui, sans-serif`;
    // 터치 조작 중에는 우하단 버튼 영역을 피해 HUD를 왼쪽에 붙인다
    const touchOn = !!(input && input.touchActive);

    // ---- 체력 ----
    const bx = Math.round(18 * S), bh = Math.round(20 * S);
    const bw = Math.min(Math.round(300 * S), W * 0.52);
    const by = H - Math.round(74 * S);
    const hpK = clamp(p.hp / p.maxHp, 0, 1);
    hpGhost += (hpK - hpGhost) * Math.min(1, dt * 4);
    panel(bx - 6 * S, by - 24 * S, bw + 12 * S, 66 * S);

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,80,110,0.4)';
    ctx.fillRect(bx, by, bw * hpGhost, bh); // 잔상 = 방금 잃은 양
    ctx.fillStyle = hpK < 0.3 ? '#ff4d6d' : '#ff8fa3';
    ctx.fillRect(bx, by, bw * hpK, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    text(`${Math.ceil(p.hp)} / ${p.maxHp}`, bx + 8 * S, by + bh / 2, '#fff', F(13, 'bold'), 'left');

    // ---- 집중(특수기) ----
    const fy = by + bh + 6 * S;
    const fK = clamp(p.focus / p.maxFocus, 0, 1);
    const cost = world.weapon.special.cost * world.loadout.mods.specialCostMult;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, fy, bw, 10 * S);
    ctx.fillStyle = p.focus >= cost ? '#7fd8ff' : '#3d6d80';
    ctx.fillRect(bx, fy, bw * fK, 10 * S);
    // 특수기 사용 가능선
    const cx = bx + bw * (cost / p.maxFocus);
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, fy - 2 * S); ctx.lineTo(cx, fy + 12 * S); ctx.stroke();

    // ---- 대시 충전 ----
    for (let i = 0; i < p.maxDashCharges; i++) {
      const dx = bx + i * 20 * S, dy = by - 14 * S;
      ctx.beginPath(); ctx.arc(dx + 6 * S, dy, 6 * S, 0, TAU);
      ctx.fillStyle = i < p.dashCharges ? '#9fd8ff' : 'rgba(255,255,255,0.15)';
      ctx.fill();
    }
    text('DASH', bx + p.maxDashCharges * 20 * S + 6 * S, by - 14 * S, 'rgba(255,255,255,0.4)', F(10, 'bold'), 'left');

    // ---- 가속(연속 타격 보너스) ----
    if (world.weapon.rampPerHit && p.ramp > 0) {
      const k = p.ramp / world.weapon.rampMax;
      const rx0 = bx, ry0 = fy + 14;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(rx0, ry0, bw, 6);
      ctx.fillStyle = k >= 0.99 ? '#ffd166' : '#63e6be';
      ctx.fillRect(rx0, ry0, bw * k, 6);
      text(`가속 +${Math.round(p.ramp * 100)}%`, rx0 + bw + 8, ry0 + 3, k >= 0.99 ? '#ffd166' : '#63e6be', 'bold 11px system-ui', 'left');
    }

    // ---- 소환수 ----
    const alive = world.aliveMinions();
    if (alive > 0) {
      const my = fy + (world.weapon.rampPerHit && p.ramp > 0 ? 26 : 14);
      text(`소환수 ${alive}`, bx, my + 4, '#c4a8ff', F(12, 'bold'), 'left');
      // 상한이 없으므로 점은 최대 12개까지만 그리고 나머지는 숫자로 안다
      const dots = Math.min(alive, 12);
      for (let i = 0; i < dots; i++) {
        ctx.beginPath();
        ctx.arc(bx + 62 * S + i * 11 * S, my + 4, 4 * S, 0, TAU);
        ctx.fillStyle = '#c4a8ff';
        ctx.fill();
      }
      if (alive > dots) text('+', bx + (62 + dots * 11) * S + 4, my + 4, '#9d7fd8', F(12, 'bold'), 'left');
    }

    // ---- 시체 (사령술 빌드일 때만) ----
    if (world.corpses.length && (world.weapon.corpseHaste || world.weapon.summonOnKill || world.loadout.mods.raiseBonus > 0 || world.aliveMinions() > 0)) {
      text(`시체 ${world.corpses.length}`, bx + 210, fy + 18, '#9d7fd8', 'bold 12px system-ui', 'left');
    }

    // ---- 무기 / 골드 / 진행도 ----
    // 터치 조작 중에는 우하단이 버튼 영역이므로 진행 정보를 우상단으로 옮긴다
    const rx = W - 18 * S;
    const ry = touchOn ? 20 * S : H - 70 * S;
    const step = touchOn ? 18 * S : 20 * S;
    text(`${world.weapon.name}${run.weaponLevel ? ' ' + WEAPON_UPGRADE.names[run.weaponLevel] : ''}`, rx, ry, world.weapon.color, F(14, 'bold'), 'right');
    text(`◈ ${run.gold}`, rx, ry + step, '#ffd166', F(14, 'bold'), 'right');
    const mm = Math.floor(run.elapsed / 60), ss = Math.floor(run.elapsed % 60);
    text(`${world.biome().name} ${run.biomeIdx + 1}-${run.roomIdx + 1}  ${mm}:${String(ss).padStart(2, '0')}`,
      rx, ry + step * 2, 'rgba(255,255,255,0.5)', F(11.5), 'right');

    // ---- 빌드(권능) 목록 ----
    drawBoons(W, H, S, F);

    // ---- 플레이어 디버프 ----
    if (p.status && Object.keys(p.status).length) {
      const names = { chill: '냉기 — 이동 둔화', shock: '감전 — 집중 회복 감소' };
      const cols = { chill: '#7fd8ff', shock: '#ffe36b' };
      let i = 0;
      for (const k of Object.keys(p.status)) {
        text(names[k] || k, bx, by - 34 - i * 16, cols[k] || '#fff', 'bold 12px system-ui', 'left');
        i++;
      }
    }

    // ---- 저주 ----
    if (run.curses.length) {
      text('저주 ' + run.curses.length, 22, 22, '#ff8fa3', 'bold 12px system-ui', 'left');
    }

    // ---- 보스 체력바 ----
    if (world.boss && world.boss.spawnT <= 0) {
      const b = world.boss;
      const w2 = Math.min(b.isMini ? 380 : 560, W - 80), x2 = (W - w2) / 2, y2 = 26;
      panel(x2 - 8, y2 - 22, w2 + 16, 46);
      text(b.isMini ? `${b.def.name} — ${b.def.title}` : b.def.name, W / 2, y2 - 9, b.def.accent, `bold ${b.isMini ? 13 : 15}px system-ui`, 'center');
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x2, y2, w2, 12);
      ctx.fillStyle = b.def.accent;
      ctx.fillRect(x2, y2, w2 * clamp(b.hp / b.maxHp, 0, 1), 12);
      // 페이즈 구분선
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
      for (const ph of b.def.phases) {
        if (ph.at >= 1) continue;
        ctx.beginPath();
        ctx.moveTo(x2 + w2 * ph.at, y2); ctx.lineTo(x2 + w2 * ph.at, y2 + 12);
        ctx.stroke();
      }
    }

    // ---- 방 클리어 안내 ----
    if (world.run.state === 'cleared' && world.doors.length) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 4);
      ctx.globalAlpha = pulse;
      text('문으로 이동해 다음 방을 선택하세요', W / 2, 92, '#ffffff', 'bold 16px system-ui', 'center');
      ctx.globalAlpha = 1;
      drawDoorHints(W, H);
    }

    // ---- 터치 조작 UI ----
    if (touchOn) drawTouchUi(W, H, S, F);

    // ---- 토스트 ----
    if (toast) {
      const k = Math.min(1, toast.life / 0.4);
      ctx.globalAlpha = k;
      panel(W / 2 - 210, 44, 420, toast.sub ? 52 : 34);
      text(toast.title, W / 2, 62, toast.color || '#fff', 'bold 17px system-ui', 'center');
      if (toast.sub) text(toast.sub, W / 2, 82, 'rgba(255,255,255,0.7)', '12px system-ui', 'center');
      ctx.globalAlpha = 1;
    }
  }

  /**
   * 터치 조작 표시.
   * 스틱은 "지금 어디를 누르고 있는지"를 보여주고,
   * 버튼은 쿨다운/사용 가능 여부를 색으로 알린다.
   */
  function drawTouchUi(W, H, S, F) {
    const t2 = input.touch;
    const p = world.player;
    const st = t2.state;

    // 가상 스틱 (누른 자리에 나타난다)
    const R = t2.stickRadius(W, H);
    const stick = (s0, color) => {
      if (!s0) return;
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s0.ox, s0.oy, R, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.6;
      const dx = s0.x - s0.ox, dy = s0.y - s0.oy;
      const len = Math.min(R, Math.hypot(dx, dy)) || 0;
      const a = Math.atan2(dy, dx);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(s0.ox + Math.cos(a) * len, s0.oy + Math.sin(a) * len, R * 0.42, 0, TAU); ctx.fill();
      ctx.restore();
    };
    stick(st.move, '#9fd8ff');
    stick(st.aim, world.weapon.color);

    // 버튼
    const cost = world.weapon.special.cost * world.loadout.mods.specialCostMult;
    const ready = {
      dash: p.dashCharges > 0 && p.dashCd <= 0,
      special: p.spCd <= 0 && p.focus >= cost,
      command: world.commandCd <= 0 && world.aliveMinions() > 0,
    };
    const sub = {
      dash: `${p.dashCharges}`,
      special: p.spCd > 0 ? p.spCd.toFixed(1) : '',
      command: world.aliveMinions() ? `${world.aliveMinions()}` : '',
    };
    for (const b of t2.buttons(W, H)) {
      const on = ready[b.id];
      ctx.save();
      ctx.globalAlpha = st.pressed[b.id] ? 0.95 : on ? 0.62 : 0.3;
      ctx.fillStyle = 'rgba(12,14,20,0.75)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = on ? '#e8eef5' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = on ? '#e8eef5' : 'rgba(255,255,255,0.4)';
      ctx.font = `bold ${Math.round(b.r * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x, b.y - (sub[b.id] ? b.r * 0.16 : 0));
      if (sub[b.id]) {
        ctx.font = `${Math.round(b.r * 0.3)}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(sub[b.id], b.x, b.y + b.r * 0.34);
      }
      ctx.restore();
    }
  }

  /** 화면 밖 문의 방향을 가장자리에 표시 */
  function drawDoorHints(W, H) {
    const cam = world.camera;
    for (const d of world.doors) {
      const sx = (d.x - cam.x) * cam.zoom + W / 2;
      const sy = (d.y - cam.y) * cam.zoom + H / 2;
      if (sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40) continue;
      const ex = clamp(sx, 34, W - 34), ey = clamp(sy, 34, H - 34);
      const a = Math.atan2(d.y - world.player.y, d.x - world.player.x);
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = d.boss ? '#ff4d6d' : d.elite ? '#ffd166' : '#7fd8ff';
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawBoons(W, H, S, F) {
    const owned = world.run.owned;
    if (!owned.length) return;
    const x = 18 * S, y0 = 44 * S;
    const rowH = 18 * S;
    const maxRows = Math.max(3, Math.floor((H * 0.5) / rowH));
    text('빌드', x, y0 - 14 * S, 'rgba(255,255,255,0.35)', F(11, 'bold'), 'left');
    const shown = owned.slice(0, maxRows);
    for (let i = 0; i < shown.length; i++) {
      const o = shown[i];
      const def = ANY_BOON_BY_ID[o.id];
      if (!def) continue;
      const y = y0 + i * rowH;
      const god = GODS[def.god] || GODS.none;
      ctx.fillStyle = god.color;
      ctx.beginPath(); ctx.arc(x + 5 * S, y, 4.5 * S, 0, TAU); ctx.fill();
      const rc = RARITY[o.rarity]?.color || '#fff';
      text(def.name + (o.level > 1 ? ` +${o.level - 1}` : ''), x + 16 * S, y, rc, F(11.5), 'left');
    }
    if (owned.length > shown.length) {
      text(`+${owned.length - shown.length}`, x + 16 * S, y0 + shown.length * rowH, 'rgba(255,255,255,0.4)', F(11), 'left');
    }
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(10,12,16,0.62)';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const r = 8;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  function text(str, x, y, color, font, align) {
    ctx.font = font;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  return { draw };
}
