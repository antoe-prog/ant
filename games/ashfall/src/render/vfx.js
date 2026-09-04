// ============================================================
// VFX: EventBus 를 구독해 파티클/피해숫자/잔상/충격파를 만든다.
// sim 은 VFX 를 전혀 모른다 — 연출을 통째로 갈아끼워도 게임은 돌아간다.
// ============================================================

import { EV } from '../core/events.js';
import { TAU } from '../core/math.js';

const ELEMENT_COLOR = {
  ember: '#ff8b4a', frost: '#7fd8ff', storm: '#ffe36b', blood: '#ff4d6d', none: '#ffffff',
};

export function createVfx(world, bus) {
  const particles = [];
  const numbers = [];
  const rings = [];
  const beams = [];
  const slashes = [];
  const flashes = [];
  let screenFlash = 0;
  let screenFlashColor = '#ffffff';

  const rnd = (a, b) => a + Math.random() * (b - a);

  function burst(x, y, count, color, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = opts.dir != null ? opts.dir + rnd(-(opts.spread ?? 0.9), opts.spread ?? 0.9) : rnd(0, TAU);
      const sp = rnd(opts.speedMin ?? 60, opts.speedMax ?? 260);
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rnd(opts.lifeMin ?? 0.22, opts.lifeMax ?? 0.55),
        maxLife: 1, size: rnd(opts.sizeMin ?? 1.6, opts.sizeMax ?? 4.2),
        color, drag: opts.drag ?? 5, glow: opts.glow ?? false,
      });
      particles[particles.length - 1].maxLife = particles[particles.length - 1].life;
    }
  }

  // ---- 이벤트 구독 ----
  bus.on(EV.HIT, (p) => {
    const color = ELEMENT_COLOR[p.element] || '#fff';
    if (p.tick) {
      // 도트 피해: 조용한 연출
      burst(p.x, p.y, 2, color, { speedMax: 70, lifeMax: 0.3, sizeMax: 2.4 });
      numbers.push({ x: p.x + rnd(-8, 8), y: p.y - 6, v: Math.round(p.dmg), life: 0.5, maxLife: 0.5, color, small: true });
      return;
    }
    burst(p.x, p.y, p.heavy ? 16 : 8, color, { speedMax: p.heavy ? 420 : 260, glow: true });
    burst(p.x, p.y, p.heavy ? 6 : 3, '#ffffff', { speedMax: 200, lifeMax: 0.25, sizeMax: 3 });
    numbers.push({
      x: p.x + rnd(-10, 10), y: p.y - 14, v: Math.round(p.dmg),
      life: p.crit ? 0.95 : 0.7, maxLife: p.crit ? 0.95 : 0.7,
      color: p.crit ? '#ffd166' : color, crit: p.crit,
    });
    flashes.push({ target: p.target, life: 0.1 });
  });

  bus.on(EV.KILL, (p) => {
    const color = p.enemy?.def?.accent || '#ffb347';
    burst(p.x, p.y, p.boss ? 90 : p.elite ? 34 : 18, color, { speedMax: p.boss ? 620 : 340, lifeMax: 0.9, glow: true, sizeMax: p.boss ? 7 : 4.5 });
    burst(p.x, p.y, p.boss ? 40 : 10, '#ffffff', { speedMax: 300, lifeMax: 0.4 });
    rings.push({ x: p.x, y: p.y, r: 6, max: p.boss ? 260 : p.elite ? 120 : 70, life: p.boss ? 0.9 : 0.4, maxLife: p.boss ? 0.9 : 0.4, color, width: p.boss ? 6 : 3 });
    if (p.boss) { screenFlash = 0.5; screenFlashColor = color; }
  });

  bus.on(EV.PLAYER_HURT, (p) => {
    burst(p.x, p.y, 20, '#ff4d6d', { speedMax: 300, glow: true });
    screenFlash = Math.max(screenFlash, 0.42);
    screenFlashColor = '#ff2d55';
    numbers.push({ x: p.x, y: p.y - 22, v: Math.round(p.dmg), life: 0.8, maxLife: 0.8, color: '#ff6b81', player: true });
  });

  bus.on(EV.HEAL, (p) => {
    burst(p.x, p.y, p.revive ? 40 : 12, '#63e6be', { speedMax: 180, lifeMax: 0.8, glow: true });
    numbers.push({ x: p.x, y: p.y - 26, v: '+' + Math.round(p.amount), life: 0.9, maxLife: 0.9, color: '#63e6be', player: true });
    if (p.revive) { screenFlash = 0.6; screenFlashColor = '#63e6be'; }
  });

  bus.on(EV.DASH, (p) => {
    burst(p.x, p.y, 12, '#9fd8ff', { dir: p.dir + Math.PI, spread: 0.6, speedMax: 260, lifeMax: 0.35 });
  });

  bus.on(EV.ATTACK, (p) => {
    slashes.push({
      x: p.x, y: p.y, dir: p.dir, arc: (p.arc * Math.PI) / 180, range: p.range,
      life: p.heavy ? 0.22 : 0.14, maxLife: p.heavy ? 0.22 : 0.14,
      color: world.weapon.color, heavy: p.heavy,
    });
  });

  bus.on(EV.SPECIAL, (p) => {
    rings.push({ x: p.x, y: p.y, r: 10, max: 120, life: 0.35, maxLife: 0.35, color: world.weapon.color, width: 4 });
    burst(p.x, p.y, 22, world.weapon.color, { speedMax: 320, glow: true });
  });

  bus.on(EV.EXPLOSION, (p) => {
    const color = ELEMENT_COLOR[p.element] || '#ff8b4a';
    rings.push({ x: p.x, y: p.y, r: 8, max: p.radius, life: 0.36, maxLife: 0.36, color, width: 5 });
    burst(p.x, p.y, 26, color, { speedMax: p.radius * 3.4, lifeMax: 0.6, glow: true });
  });

  bus.on(EV.SHOCKWAVE, (p) => {
    rings.push({
      x: p.x, y: p.y, r: p.weak ? p.radius * 0.5 : 10, max: p.radius,
      life: p.weak ? 0.22 : 0.42, maxLife: p.weak ? 0.22 : 0.42,
      color: p.color || '#fff', width: p.big ? 8 : p.weak ? 2 : 5,
    });
    if (p.big) { screenFlash = Math.max(screenFlash, 0.22); screenFlashColor = p.color || '#fff'; }
  });

  bus.on(EV.STATUS, (p) => {
    const map = { burn: '#ff7a3c', chill: '#7fd8ff', frozen: '#bff0ff', shock: '#ffe36b', bleed: '#ff4d6d', block: '#c8d2dc', dashStrike: '#ffd166', armor: '#c9a227' };
    const c = map[p.kind] || '#fff';
    if (p.kind === 'frozen') rings.push({ x: p.x, y: p.y, r: 4, max: 44, life: 0.4, maxLife: 0.4, color: c, width: 3 });
    if (p.kind === 'block') numbers.push({ x: p.x, y: p.y - 18, v: '막힘', life: 0.5, maxLife: 0.5, color: c, small: true });
    if (p.kind === 'dashStrike') { burst(p.x, p.y, 14, c, { speedMax: 320, glow: true }); rings.push({ x: p.x, y: p.y, r: 4, max: 60, life: 0.3, maxLife: 0.3, color: c, width: 3 }); }
    else burst(p.x, p.y, 4, c, { speedMax: 90, lifeMax: 0.4 });
  });

  bus.on(EV.PROJECTILE_HIT, (p) => burst(p.x, p.y, 6, p.color || '#ffb347', { speedMax: 140, lifeMax: 0.3 }));
  bus.on(EV.PICKUP, (p) => {
    burst(p.x, p.y, 8, p.kind === 'gold' ? '#ffd166' : '#63e6be', { speedMax: 140, lifeMax: 0.4, glow: true });
  });
  bus.on('chain', (p) => beams.push({ ...p, life: 0.18, maxLife: 0.18, color: '#ffe36b' }));
  bus.on('bolt', (p) => {
    beams.push({ x1: p.x, y1: p.y - 400, x2: p.x, y2: p.y, life: 0.2, maxLife: 0.2, color: '#ffe36b', width: 5 });
    burst(p.x, p.y, 16, '#ffe36b', { speedMax: 260, glow: true });
  });
  bus.on('spawn', (p) => {
    rings.push({ x: p.x, y: p.y, r: 2, max: p.elite ? 60 : 36, life: 0.45, maxLife: 0.45, color: p.elite ? '#ffd166' : '#8d7f74', width: 2 });
  });
  bus.on(EV.BOSS_PHASE, (p) => {
    screenFlash = 0.55; screenFlashColor = p.boss?.def?.accent || '#fff';
    rings.push({ x: p.boss.x, y: p.boss.y, r: 10, max: 420, life: 0.8, maxLife: 0.8, color: p.boss.def.accent, width: 7 });
  });
  bus.on(EV.BOON_TAKEN, () => { screenFlash = 0.3; screenFlashColor = '#ffd166'; });

  return {
    particles, numbers, rings, beams, slashes, flashes,
    get screenFlash() { return screenFlash; },
    get screenFlashColor() { return screenFlashColor; },

    update(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        const f = Math.exp(-p.drag * dt);
        p.vx *= f; p.vy *= f;
      }
      for (let i = numbers.length - 1; i >= 0; i--) {
        const n = numbers[i];
        n.life -= dt;
        n.y -= (n.crit ? 46 : 32) * dt;
        if (n.life <= 0) numbers.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life -= dt;
        const t = 1 - r.life / r.maxLife;
        r.r = 6 + (r.max - 6) * (1 - Math.pow(1 - t, 2.4));
        if (r.life <= 0) rings.splice(i, 1);
      }
      for (let i = beams.length - 1; i >= 0; i--) { beams[i].life -= dt; if (beams[i].life <= 0) beams.splice(i, 1); }
      for (let i = slashes.length - 1; i >= 0; i--) { slashes[i].life -= dt; if (slashes[i].life <= 0) slashes.splice(i, 1); }
      for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].life -= dt; if (flashes[i].life <= 0) flashes.splice(i, 1); }
      if (screenFlash > 0) screenFlash = Math.max(0, screenFlash - dt * 2.6);
    },

    clear() {
      particles.length = 0; numbers.length = 0; rings.length = 0;
      beams.length = 0; slashes.length = 0; flashes.length = 0;
      screenFlash = 0;
    },
  };
}
