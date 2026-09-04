// ============================================================
// 캔버스 렌더러. 에셋 없이 절차적 도형으로 그린다.
// 실루엣이 서로 확실히 달라야 플레이어가 위협을 즉시 구분할 수 있다.
// ============================================================

import { TAU, clamp } from '../core/math.js';
import { STATUS } from '../data/balance.js';


const ALLY_RING = '#7ff0d8';
const ELEMENT_COLOR = { ember: '#ff8b4a', frost: '#7fd8ff', storm: '#ffe36b', blood: '#ff4d6d', necro: '#9d7fd8', none: '#ffffff' };

export function createRenderer(canvas, world, camera, vfx) {
  const ctx = canvas.getContext('2d');
  let t = 0;

  function draw(dt, aim) {
    t += dt;
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    const biome = world.biome();

    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.fillStyle = biome.fog;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    camera.apply(ctx, W, H);

    drawFloor(biome);
    drawCorpses();
    drawHazards();
    drawTelegraphs();
    drawAuras();
    drawObstacles(biome);
    drawPickups();
    drawDoors();
    drawEnemies();
    drawMinions();
    drawPlayer();
    drawProjectiles();
    drawSlashes();
    drawRings();
    drawBeams();
    drawParticles();
    drawNumbers();

    ctx.restore();

    drawScreenFlash(W, H);
    drawVignette(W, H, biome);
  }

  // ---------------- 배경 ----------------
  function drawFloor(biome) {
    const a = world.arena;
    ctx.fillStyle = biome.floor;
    ctx.fillRect(0, 0, a.width, a.height);

    // 중앙이 밝은 바닥 — 전투 공간이 어디인지 눈에 들어오게
    const g = ctx.createRadialGradient(a.width / 2, a.height / 2, 60, a.width / 2, a.height / 2, a.width * 0.66);
    g.addColorStop(0, biome.accent + '1c');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, a.width, a.height);

    // 방마다 달라지는 바닥 균열 (같은 방이 반복되는 느낌을 줄인다)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const d of world.decals || []) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + Math.cos(d.a) * d.len, d.y + Math.sin(d.a) * d.len);
    }
    ctx.stroke();

    // 타일 격자 — 이동 거리를 눈으로 가늠하게 해준다
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= a.width; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, a.height); }
    for (let y = 0; y <= a.height; y += 80) { ctx.moveTo(0, y); ctx.lineTo(a.width, y); }
    ctx.stroke();

    // 벽
    ctx.strokeStyle = biome.wall;
    ctx.lineWidth = a.pad * 2;
    ctx.strokeRect(0, 0, a.width, a.height);
    ctx.strokeStyle = biome.accent + '55';
    ctx.lineWidth = 2;
    ctx.strokeRect(a.pad, a.pad, a.width - a.pad * 2, a.height - a.pad * 2);
  }

  function drawObstacles(biome) {
    for (const o of world.obstacles) {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(4, 8, o.radius, o.radius * 0.5, 0, 0, TAU); ctx.fill();
      ctx.rotate(o.seed);
      ctx.fillStyle = biome.wall;
      ctx.strokeStyle = biome.accent + '44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const r = o.radius * (0.82 + 0.18 * Math.sin(i * 2.3 + o.seed));
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------- 예고(텔레그래프) ----------------
  function drawTelegraphs() {
    for (const e of world.enemies) {
      if (e.dead || !e.tele) continue;
      const tl = e.tele;
      const p = 1 - tl.t / tl.maxT; // 0→1 진행도
      const color = e.def.accent || '#ff6b35';
      ctx.save();
      ctx.globalAlpha = 0.10 + 0.20 * p;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;

      if (tl.kind === 'circle') {
        ctx.beginPath(); ctx.arc(e.x, e.y, tl.radius, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, tl.radius, 0, TAU); ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, tl.radius * p, 0, TAU); ctx.stroke();
      } else if (tl.kind === 'line') {
        ctx.translate(e.x, e.y); ctx.rotate(e.facing);
        const w = e.radius * 1.9;
        ctx.fillRect(0, -w, tl.range, w * 2);
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, -w, tl.range, w * 2);
        // 진행 게이지: 언제 터지는지 눈으로 읽히게
        ctx.globalAlpha = 0.5;
        ctx.fillRect(0, -w, tl.range * p, w * 2);
      } else if (tl.kind === 'arc') {
        const half = (tl.arc * Math.PI) / 360;
        ctx.beginPath(); ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, tl.range, e.facing - half, e.facing + half);
        ctx.closePath(); ctx.fill();
      } else if (tl.kind === 'aim') {
        ctx.globalAlpha = 0.35 + 0.4 * p;
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.facing) * tl.range, e.y + Math.sin(e.facing) * tl.range);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (tl.kind === 'raise') {
        // 시체 술사 → 되살릴 시체를 잇는 선. 무엇을 끊어야 하는지 보인다.
        ctx.globalAlpha = 0.5 + 0.4 * p;
        ctx.strokeStyle = '#9d7fd8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(tl.tx, tl.ty); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(tl.tx, tl.ty, tl.radius * (0.3 + 0.7 * p), 0, TAU); ctx.stroke();
      } else if (tl.kind === 'ring' || tl.kind === 'summon' || tl.kind === 'blink') {
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 3 + 4 * p;
        ctx.beginPath(); ctx.arc(e.x, e.y, (tl.radius || 90) * (0.4 + 0.6 * p), 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * 시체 — 사령술의 자원. 바닥에 깔려 있어야 하므로 지형처럼 낮게 그린다.
   * 사령술 빌드일 때는 빛나서 "쓸 수 있는 것"임을 알린다.
   */
  function drawCorpses() {
    if (!world.corpses.length) return;
    const necro = usesCorpses();
    for (const c of world.corpses) {
      const fade = Math.min(1, c.life / 2.2);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.seed);
      ctx.globalAlpha = 0.55 * fade * (c.life < 2.2 ? 0.5 + 0.5 * Math.abs(Math.sin(t * 9)) : 1);
      // 그림자처럼 눌린 잔해
      ctx.fillStyle = '#100c14';
      ctx.beginPath();
      ctx.ellipse(0, 0, c.radius * 1.15 * c.scale, c.radius * 0.55 * c.scale, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = necro ? '#9d7fd8' : '#3a3040';
      ctx.lineWidth = necro ? 2 : 1.4;
      ctx.globalAlpha = (necro ? 0.85 : 0.5) * fade;
      ctx.beginPath();
      ctx.ellipse(0, 0, c.radius * 1.15 * c.scale, c.radius * 0.55 * c.scale, 0, 0, TAU);
      ctx.stroke();
      if (necro) {
        // 일으킬 수 있다는 신호: 위로 피어오르는 영혼 불꽃
        ctx.globalAlpha = 0.5 * fade;
        ctx.fillStyle = '#c4a8ff';
        const bob = Math.sin(t * 3 + c.seed) * 3;
        ctx.beginPath();
        ctx.arc(0, -10 + bob, 2.6 * c.scale, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** 현재 빌드가 시체를 자원으로 쓰는가 (연출 강도를 바꾼다) */
  function usesCorpses() {
    if (world.weapon.summonOnKill || world.weapon.corpseHaste) return true;
    const L = world.loadout;
    return L.on.corpse.length > 0 || L.on.corpseExpire.length > 0 ||
      L.on.tick.length > 0 || L.mods.minionCap > 0;
  }

  /** 소환수 — 아군임이 한눈에 보여야 한다 (밝은 테두리 + 발밑 링) */
  function drawMinions() {
    for (const m of world.minions) {
      if (m.dead) continue;
      const def = m.def;
      ctx.save();
      ctx.translate(m.x, m.y);

      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, m.radius * 0.7, m.radius * 0.9, m.radius * 0.36, 0, 0, TAU); ctx.fill();

      // 아군 표식 — 모든 소환수가 같은 민트색 링을 공유한다.
      // "이 링 = 내 편"이라는 규칙 하나만 배우면 난전에서도 헷갈리지 않는다.
      ctx.strokeStyle = ALLY_RING;
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(0, 0, m.radius + 5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;

      if (m.spawnT > 0) {
        // 땅에서 솟아오르는 연출
        const k = 1 - m.spawnT / 0.35;
        ctx.globalAlpha = k;
        ctx.translate(0, (1 - k) * 18);
        ctx.scale(1, Math.max(0.2, k));
      }
      // 곧 스러질 때 깜빡임
      if (m.life < 2) ctx.globalAlpha *= 0.45 + 0.55 * Math.abs(Math.sin(t * 10));

      ctx.rotate(m.facing + Math.PI / 2);
      const body = m.hurtFlash > 0 ? '#ffffff' : def.color;
      ctx.fillStyle = body;
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 2;
      const r = m.radius;

      if (m.id === 'wraith') {
        // 아래가 흩어지는 유령 형태
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.3);
        ctx.quadraticCurveTo(r, -r * 0.2, r * 0.7, r);
        ctx.quadraticCurveTo(0, r * 0.5, -r * 0.7, r);
        ctx.quadraticCurveTo(-r, -r * 0.2, 0, -r * 1.3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (m.id === 'skeleton') {
        ctx.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        ctx.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        // 방패 (탄을 막는다는 정보)
        ctx.fillStyle = def.accent;
        ctx.beginPath();
        ctx.arc(0, -r * 0.6, r * 1.2, Math.PI * 1.15, Math.PI * 1.85);
        ctx.lineTo(0, -r * 0.15);
        ctx.closePath(); ctx.fill();
      } else {
        poly(0, 0, r, 3, 0); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = def.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 1.2, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
      }
      ctx.restore();

      // 체력바 (다칠 때만)
      if (m.hp < m.maxHp && m.spawnT <= 0) {
        const w = m.radius * 2;
        const x = m.x - w / 2, y = m.y - m.radius - 10;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 1, y - 1, w + 2, 4);
        ctx.fillStyle = def.accent;
        ctx.fillRect(x, y, w * clamp(m.hp / m.maxHp, 0, 1), 2);
      }
    }
  }

  /** 곧 터질 지면 — 시체 근처에 서 있으면 안 된다는 정보 */
  function drawHazards() {
    for (const h of world.hazards) {
      const p = 1 - h.t / h.maxT;
      ctx.save();
      ctx.globalAlpha = 0.14 + 0.26 * p;
      ctx.fillStyle = h.color;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.radius, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.radius * p, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  /** '수호' 엘리트의 보호 범위 — 오라 주인을 먼저 잡을지 판단할 수 있어야 한다 */
  function drawAuras() {
    for (const e of world.enemies) {
      if (e.dead || !e.affixes || !e.affixes.length) continue;
      for (const a of e.affixes) {
        if (!a.aura) continue;
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = a.color;
        ctx.beginPath(); ctx.arc(e.x, e.y, a.aura.radius, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = a.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 10]);
        ctx.beginPath(); ctx.arc(e.x, e.y, a.aura.radius, t * 0.6, t * 0.6 + TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  // ---------------- 픽업 / 문 ----------------
  function drawPickups() {
    for (const it of world.pickups) {
      const bob = Math.sin(t * 5 + it.x) * 3;
      const gold = it.kind === 'gold';
      ctx.save();
      ctx.translate(it.x, it.y + bob);
      ctx.globalAlpha = it.life < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(t * 12)) : 1;
      ctx.fillStyle = gold ? '#ffd166' : '#63e6be';
      ctx.shadowBlur = 12; ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      if (gold) ctx.arc(0, 0, 5, 0, TAU);
      else { ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
    }
  }

  function drawDoors() {
    for (const d of world.doors) {
      const pulse = 0.7 + 0.3 * Math.sin(t * 3.4);
      ctx.save();
      ctx.translate(d.x, d.y);
      const col = d.boss ? '#ff4d6d' : d.miniboss ? '#c07bff' : d.elite ? '#ffd166' : '#7fd8ff';
      ctx.globalAlpha = 0.22 * pulse;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, 54, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke();
      // 보상 아이콘
      ctx.fillStyle = col;
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(rewardIcon(d), 0, 1);
      ctx.restore();
    }
  }

  function rewardIcon(d) {
    if (d.boss) return '☠';
    if (d.miniboss) return '⚑';
    switch (d.reward?.kind) {
      case 'boon': return '✦';
      case 'boonUpgrade': return '↑';
      case 'gold': return '◈';
      case 'heal': return '✚';
      case 'maxhp': return '❤';
      case 'weaponUpgrade': return '⚔';
      case 'shop': return '⌂';
      default: return '?';
    }
  }

  // ---------------- 적 ----------------
  function drawEnemies() {
    for (const e of world.enemies) {
      if (e.dead) continue;
      ctx.save();
      ctx.translate(e.x, e.y);

      // 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, e.radius * 0.75, e.radius * 0.9, e.radius * 0.38, 0, 0, TAU); ctx.fill();

      // 등장 연출 (스폰 시 솟아오름)
      if (e.spawnT > 0) {
        const k = 1 - e.spawnT / (e.isBoss ? 1.2 : 0.45);
        ctx.globalAlpha = clamp(k, 0, 1);
        ctx.scale(clamp(k, 0.2, 1), clamp(k, 0.2, 1));
      }

      const flash = e.hurtFlash > 0;
      const body = flash ? '#ffffff' : (e.elite ? shade(e.def.color, 1.25) : e.def.color);
      ctx.rotate(e.facing + Math.PI / 2);

      if (e.isBoss) drawBoss(e, body);
      else drawEnemyShape(e, body);

      ctx.restore();

      drawStatusAura(e);
      drawStagger(e);
      drawNameTag(e);
      if (!e.isBoss) drawEnemyHpBar(e);
    }
  }

  function drawEnemyShape(e, body) {
    const r = e.radius;
    const acc = e.def.accent || '#fff';
    ctx.strokeStyle = acc; ctx.lineWidth = 2;
    ctx.fillStyle = body;

    switch (e.id) {
      case 'cinderling':
      case 'splitterling':
        poly(0, 0, r * 1.25, 3, 0); ctx.fill(); ctx.stroke();
        break;
      case 'husk':
        poly(0, 0, r, 6, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = acc; ctx.fillRect(-2.5, -r - 6, 5, 8);
        break;
      case 'bolter':
      case 'warden':
        poly(0, 0, r, e.id === 'warden' ? 5 : 4, 0); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = acc; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 1.1, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        break;
      case 'bulwark': {
        ctx.fillRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
        ctx.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
        // 방패: 정면을 명확히 표시 (뒤를 쳐야 한다는 정보)
        ctx.fillStyle = acc;
        ctx.beginPath();
        ctx.arc(0, -r * 0.55, r * 1.15, Math.PI * 1.17, Math.PI * 1.83);
        ctx.lineTo(0, -r * 0.2);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'splitter':
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          const rr = r * (0.82 + 0.22 * Math.sin(i * 3 + t * 3));
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'bomber': {
        const pulse = e.state === 'fuse' ? 1 + 0.28 * Math.sin(t * 40) : 1;
        ctx.beginPath(); ctx.arc(0, 0, r * pulse, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r - 8); ctx.stroke();
        break;
      }
      case 'bonecaller':
        poly(0, 0, r, 5, 0); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = acc; ctx.lineWidth = 2.5;
        // 지팡이
        ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 0.3); ctx.lineTo(r * 0.5, -r - 14); ctx.stroke();
        ctx.fillStyle = acc;
        ctx.beginPath(); ctx.arc(r * 0.5, -r - 16, 4, 0, TAU); ctx.fill();
        break;
      case 'lancer':
        poly(0, 0, r * 1.15, 3, 0); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = acc; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r - 26); ctx.stroke();
        break;
      default:
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
    }

    // 엘리트 표식 — 접두사마다 색이 다른 링이 하나씩 늘어난다
    if (e.elite) {
      const rings = (e.affixes && e.affixes.length) ? e.affixes : [{ color: '#ffd166' }];
      for (let i = 0; i < rings.length; i++) {
        ctx.strokeStyle = rings[i].color;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([5, 5]);
        const off = t * (1.6 + i * 0.7) * (i % 2 ? -1 : 1);
        ctx.beginPath(); ctx.arc(0, 0, r + 7 + i * 5, off, off + TAU * 0.85); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawBoss(b, body) {
    const r = b.radius;
    const acc = b.def.accent;
    // 회전하는 외곽 링 — 존재감
    ctx.save();
    ctx.rotate(-b.facing - Math.PI / 2);
    ctx.strokeStyle = acc + '99'; ctx.lineWidth = 3;
    ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.arc(0, 0, r + 16, t * 0.8, t * 0.8 + TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.fillStyle = body;
    ctx.strokeStyle = acc; ctx.lineWidth = 3;
    poly(0, 0, r, 7, 0); ctx.fill(); ctx.stroke();
    // 왕관/눈
    ctx.fillStyle = acc;
    poly(0, -r * 0.35, r * 0.34, 3, 0); ctx.fill();
    if (b.invuln > 0) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 22);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawStatusAura(e) {
    if (!e.status) return;
    const items = [];
    if (e.status.burn) items.push(STATUS.burn.color);
    if (e.status.chill) items.push(STATUS.chill.color);
    if (e.status.frozen) items.push(STATUS.frozen.color);
    if (e.status.shock) items.push(STATUS.shock.color);
    if (e.status.bleed) items.push(STATUS.bleed.color);
    if (!items.length) return;
    ctx.save();
    ctx.translate(e.x, e.y);
    for (let i = 0; i < items.length; i++) {
      ctx.strokeStyle = items[i];
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      const rr = e.radius + 4 + i * 3.5;
      const off = t * (2 + i) + i;
      ctx.beginPath(); ctx.arc(0, 0, rr, off, off + TAU * 0.6); ctx.stroke();
    }
    if (e.status.frozen) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = STATUS.frozen.color;
      ctx.beginPath(); ctx.arc(0, 0, e.radius + 3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /** 경직: 별 모양 스파크로 "끊겼다"를 알린다 */
  function drawStagger(e) {
    if (!(e.staggerT > 0)) return;
    ctx.save();
    ctx.translate(e.x, e.y - e.radius - 14);
    ctx.strokeStyle = '#ffd166';
    ctx.globalAlpha = Math.min(1, e.staggerT * 3);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = t * 6 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 엘리트/미니보스 이름표 — 무엇을 상대하는지 즉시 알 수 있게 */
  function drawNameTag(e) {
    if (!e.elite && !e.isMini) return;
    if (e.spawnT > 0) return;
    const label = e.isMini
      ? e.def.name
      : (e.affixes || []).map((a) => a.name).join('·') + ' ' + e.def.name;
    const y = e.y - e.radius - (e.elite ? 24 : 18);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(label, e.x, y);
    ctx.fillStyle = e.isMini ? e.def.accent : (e.affixes?.[0]?.color || '#ffd166');
    ctx.fillText(label, e.x, y);
  }

  function drawEnemyHpBar(e) {
    if (e.hp >= e.maxHp || e.spawnT > 0) return;
    const w = e.radius * 2.2;
    const x = e.x - w / 2, y = e.y - e.radius - 12;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = e.elite ? '#ffd166' : '#ff6b81';
    ctx.fillRect(x, y, w * clamp(e.hp / e.maxHp, 0, 1), 3);
  }

  // ---------------- 플레이어 ----------------
  function drawPlayer() {
    const p = world.player;
    if (p.dead) return;
    const W = world.weapon;

    // 대시 잔상
    for (const tr of p.trail) {
      ctx.globalAlpha = (tr.life / 0.22) * 0.35;
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath(); ctx.arc(tr.x, tr.y, p.radius * 0.9, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(0, p.radius * 0.8, p.radius, p.radius * 0.4, 0, 0, TAU); ctx.fill();

    // 무적 깜빡임
    if (p.iframes > 0) ctx.globalAlpha = 0.45 + 0.35 * Math.sin(t * 30);

    // 바닥 링 — 난전 속에서 내 위치를 놓치지 않게
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, p.radius + 5, 0, TAU); ctx.stroke();
    ctx.strokeStyle = W.color + '88'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, p.radius + 5, 0, TAU); ctx.stroke();

    ctx.rotate(p.facing + Math.PI / 2);
    // 몸통 (어두운 외곽선으로 배경과 분리)
    ctx.shadowBlur = 14; ctx.shadowColor = W.color;
    ctx.fillStyle = p.hurtFlash > 0 ? '#ffffff' : '#f4f8fc';
    poly(0, 0, p.radius, 5, 0); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#0c0e12'; ctx.lineWidth = 3;
    poly(0, 0, p.radius, 5, 0); ctx.stroke();
    ctx.strokeStyle = W.color; ctx.lineWidth = 1.6;
    poly(0, 0, p.radius, 5, 0); ctx.stroke();
    // 방향 표시 (칼끝)
    ctx.fillStyle = W.color;
    ctx.beginPath();
    ctx.moveTo(0, -p.radius - 9); ctx.lineTo(4.5, -p.radius + 2); ctx.lineTo(-4.5, -p.radius + 2);
    ctx.closePath(); ctx.fill();

    // 무기 시각화: 공격 단계에 따라 위치가 변한다
    if (p.state === 'attack') {
      const step = W.combo[p.atkStep];
      const prog = p.atkPhase === 'windup' ? -0.5 : p.atkPhase === 'active' ? 0.6 : 0.2;
      ctx.save();
      ctx.rotate(prog * (step.arc * Math.PI) / 360);
      ctx.strokeStyle = W.color;
      ctx.lineWidth = step.heavy ? 6 : 4;
      ctx.beginPath(); ctx.moveTo(0, -p.radius); ctx.lineTo(0, -p.radius - step.range * 0.45); ctx.stroke();
      ctx.restore();
    } else if (p.state === 'special' && W.special.kind === 'whirl') {
      ctx.strokeStyle = W.color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, W.special.radius * 0.6, 0, TAU * 0.7); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // 플레이어 디버프 표시 (왜 느려졌는지 알 수 있어야 한다)
    if (p.status) {
      const cols = { chill: '#7fd8ff', shock: '#ffe36b' };
      let i = 0;
      for (const k of Object.keys(p.status)) {
        ctx.strokeStyle = cols[k] || '#fff';
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 2.5;
        const off = t * 3 + i * 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 11 + i * 4, off, off + TAU * 0.55); ctx.stroke();
        i++;
      }
      ctx.globalAlpha = 1;
    }

    // 대시 강타 준비 표시
    if (p.dashStrikeT > 0) {
      ctx.strokeStyle = '#ffd166';
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 18);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 8, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawProjectiles() {
    for (const pr of world.projectiles) {
      ctx.save();
      ctx.translate(pr.x, pr.y);
      ctx.fillStyle = pr.color;
      ctx.shadowBlur = 14; ctx.shadowColor = pr.color;
      ctx.rotate(Math.atan2(pr.vy, pr.vx));
      if (pr.hostile) {
        ctx.beginPath();
        ctx.ellipse(0, 0, pr.radius * 1.9, pr.radius, 0, 0, TAU);
        ctx.fill();
      } else {
        // 아군 투사체: 길고 얇은 참격 형태 + 흰 코어 (적탄과 즉시 구분)
        ctx.beginPath();
        ctx.moveTo(pr.radius * 2.6, 0);
        ctx.lineTo(0, -pr.radius);
        ctx.lineTo(-pr.radius * 1.6, 0);
        ctx.lineTo(0, pr.radius);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(pr.radius * 0.4, 0, pr.radius * 1.1, pr.radius * 0.3, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------------- VFX ----------------
  function drawSlashes() {
    for (const s of vfx.slashes) {
      const k = s.life / s.maxLife;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.dir);
      ctx.globalAlpha = k * 0.85;
      const grad = ctx.createRadialGradient(0, 0, s.range * 0.35, 0, 0, s.range);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.7, s.color + 'aa');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const sweep = s.arc * (0.4 + 0.6 * (1 - k));
      ctx.arc(0, 0, s.range, -sweep / 2, sweep / 2);
      ctx.closePath(); ctx.fill();
      // 선명한 궤적선
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s.heavy ? 3 : 2;
      ctx.beginPath();
      ctx.arc(0, 0, s.range * 0.92, -sweep / 2, sweep / 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawRings() {
    for (const r of vfx.rings) {
      const k = r.life / r.maxLife;
      ctx.globalAlpha = k;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * k;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawBeams() {
    for (const b of vfx.beams) {
      const k = b.life / b.maxLife;
      ctx.globalAlpha = k;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = (b.width || 3) * k;
      ctx.shadowBlur = 16; ctx.shadowColor = b.color;
      ctx.beginPath();
      // 지그재그 번개
      const steps = 5;
      ctx.moveTo(b.x1, b.y1);
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        const jx = (Math.random() - 0.5) * 16 * (i < steps ? 1 : 0);
        const jy = (Math.random() - 0.5) * 16 * (i < steps ? 1 : 0);
        ctx.lineTo(b.x1 + (b.x2 - b.x1) * f + jx, b.y1 + (b.y2 - b.y1) * f + jy);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of vfx.particles) {
      const k = p.life / p.maxLife;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      if (p.glow) { ctx.shadowBlur = 10; ctx.shadowColor = p.color; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function drawNumbers() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const n of vfx.numbers) {
      const k = n.life / n.maxLife;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      const size = n.small ? 11 : n.crit ? 25 : n.player ? 19 : 15;
      ctx.font = `bold ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(n.v, n.x, n.y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.v, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawScreenFlash(W, H) {
    if (vfx.screenFlash <= 0) return;
    ctx.globalAlpha = Math.min(0.45, vfx.screenFlash * 0.5);
    ctx.fillStyle = vfx.screenFlashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  function drawVignette(W, H, biome) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 저체력 경고
    const p = world.player;
    const hpK = p.hp / p.maxHp;
    if (hpK < 0.3 && !p.dead) {
      const pulse = 0.18 + 0.14 * Math.sin(t * 6);
      const g2 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      g2.addColorStop(0, 'rgba(255,0,50,0)');
      g2.addColorStop(1, `rgba(255,0,50,${pulse * (1 - hpK / 0.3)})`);
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------- 유틸 ----------------
  function poly(cx, cy, r, sides, rot) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * TAU - Math.PI / 2;
      ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * k), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * k), 0, 255);
    const b = clamp(Math.round((n & 255) * k), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  return { draw, ctx };
}
