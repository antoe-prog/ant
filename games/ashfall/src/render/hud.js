// 화면 좌표계 HUD. 플레이어가 매 순간 알아야 할 것만 보여준다:
// 남은 체력 · 집중 · 대시 · 진행도 · 보스 체력 · 현재 빌드.

import { clamp, TAU } from '../core/math.js';
import { RARITY } from '../data/balance.js';
import { ANY_BOON_BY_ID, GODS } from '../data/boons.js';
import { RUN } from '../data/balance.js';
import { WEAPON_UPGRADE } from '../data/weapons.js';

export function createHud(canvas, world) {
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
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const p = world.player;
    const run = world.run;

    // ---- 체력 ----
    const bx = 22, by = H - 74, bw = 300, bh = 20;
    const hpK = clamp(p.hp / p.maxHp, 0, 1);
    hpGhost += (hpK - hpGhost) * Math.min(1, dt * 4);
    panel(bx - 6, by - 24, bw + 12, 66);

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,80,110,0.4)';
    ctx.fillRect(bx, by, bw * hpGhost, bh); // 잔상 = 방금 잃은 양
    ctx.fillStyle = hpK < 0.3 ? '#ff4d6d' : '#ff8fa3';
    ctx.fillRect(bx, by, bw * hpK, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    text(`${Math.ceil(p.hp)} / ${p.maxHp}`, bx + 8, by + bh / 2, '#fff', 'bold 13px system-ui', 'left');

    // ---- 집중(특수기) ----
    const fy = by + bh + 6;
    const fK = clamp(p.focus / p.maxFocus, 0, 1);
    const cost = world.weapon.special.cost * world.loadout.mods.specialCostMult;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, fy, bw, 10);
    ctx.fillStyle = p.focus >= cost ? '#7fd8ff' : '#3d6d80';
    ctx.fillRect(bx, fy, bw * fK, 10);
    // 특수기 사용 가능선
    const cx = bx + bw * (cost / p.maxFocus);
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, fy - 2); ctx.lineTo(cx, fy + 12); ctx.stroke();

    // ---- 대시 충전 ----
    for (let i = 0; i < p.maxDashCharges; i++) {
      const dx = bx + i * 20, dy = by - 14;
      ctx.beginPath(); ctx.arc(dx + 6, dy, 6, 0, TAU);
      ctx.fillStyle = i < p.dashCharges ? '#9fd8ff' : 'rgba(255,255,255,0.15)';
      ctx.fill();
    }
    text('DASH', bx + p.maxDashCharges * 20 + 6, by - 14, 'rgba(255,255,255,0.4)', 'bold 10px system-ui', 'left');

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
    const cap = world.minionCap();
    const alive = world.aliveMinions();
    if (alive > 0 || cap > 3) {
      const my = fy + (world.weapon.rampPerHit && p.ramp > 0 ? 26 : 14);
      text(`소환수 ${alive}/${cap}`, bx, my + 4, alive >= cap ? '#c4a8ff' : '#9d7fd8', 'bold 12px system-ui', 'left');
      for (let i = 0; i < cap; i++) {
        ctx.beginPath();
        ctx.arc(bx + 78 + i * 13, my + 4, 4.2, 0, TAU);
        ctx.fillStyle = i < alive ? '#c4a8ff' : 'rgba(255,255,255,0.15)';
        ctx.fill();
      }
    }

    // ---- 시체 (사령술 빌드일 때만) ----
    if (world.corpses.length && (world.weapon.corpseHaste || world.weapon.summonOnKill || world.loadout.mods.minionCap > 0)) {
      text(`시체 ${world.corpses.length}`, bx + 210, fy + 18, '#9d7fd8', 'bold 12px system-ui', 'left');
    }

    // ---- 무기 / 골드 / 진행도 ----
    const rx = W - 22;
    text(`${world.weapon.name}${run.weaponLevel ? ' ' + WEAPON_UPGRADE.names[run.weaponLevel] : ''}`, rx, H - 70, world.weapon.color, 'bold 15px system-ui', 'right');
    text(`◈ ${run.gold}`, rx, H - 50, '#ffd166', 'bold 15px system-ui', 'right');
    text(`${world.biome().name}  ${run.biomeIdx + 1}-${run.roomIdx + 1} / ${RUN.BIOMES}-${RUN.ROOMS_PER_BIOME}`, rx, H - 30, 'rgba(255,255,255,0.55)', '12px system-ui', 'right');
    const mm = Math.floor(run.elapsed / 60), ss = Math.floor(run.elapsed % 60);
    text(`${mm}:${String(ss).padStart(2, '0')}`, rx, H - 14, 'rgba(255,255,255,0.35)', '12px system-ui', 'right');

    // ---- 빌드(권능) 목록 ----
    drawBoons(W, H);

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

  function drawBoons(W, H) {
    const owned = world.run.owned;
    if (!owned.length) return;
    const x = 22, y0 = 46;
    text('빌드', x, y0 - 14, 'rgba(255,255,255,0.35)', 'bold 11px system-ui', 'left');
    for (let i = 0; i < owned.length; i++) {
      const o = owned[i];
      const def = ANY_BOON_BY_ID[o.id];
      if (!def) continue;
      const y = y0 + i * 19;
      const god = GODS[def.god] || GODS.none;
      ctx.fillStyle = god.color;
      ctx.beginPath(); ctx.arc(x + 5, y, 4.5, 0, TAU); ctx.fill();
      const rc = RARITY[o.rarity]?.color || '#fff';
      text(def.name + (o.level > 1 ? ` +${o.level - 1}` : ''), x + 16, y, rc, '12px system-ui', 'left');
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
