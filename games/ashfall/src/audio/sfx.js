// ============================================================
// WebAudio 절차적 효과음. 오디오 에셋이 없어도 타격감은 포기하지 않는다.
// 나중에 실제 샘플로 교체할 때는 play(name) 내부만 바꾸면 된다.
// ============================================================

import { EV } from '../core/events.js';

export function createSfx(bus) {
  let ac = null;
  let master = null;
  let enabled = true;
  let lastAt = {};

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return null; }
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.32;
    master.connect(ac.destination);
    return ac;
  }

  function noiseBuffer(dur) {
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 노이즈 기반 타격/폭발 */
  function noise({ dur = 0.16, freq = 900, q = 1, type = 'lowpass', gain = 0.6, sweep = 0 }) {
    if (!ensure()) return;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filt = ac.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), ac.currentTime + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start();
    src.stop(ac.currentTime + dur);
  }

  /** 톤 (사인/사각/톱니) */
  function tone({ freq = 440, dur = 0.14, type = 'square', gain = 0.18, to = null, delay = 0 }) {
    if (!ensure()) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  /** 같은 소리가 한 프레임에 몰려 터지는 것 방지 */
  function throttle(name, ms) {
    const now = performance.now();
    if (lastAt[name] && now - lastAt[name] < ms) return false;
    lastAt[name] = now;
    return true;
  }

  const S = {
    swing() { noise({ dur: 0.13, freq: 2600, type: 'bandpass', q: 0.9, gain: 0.28, sweep: 0.35 }); },
    heavySwing() { noise({ dur: 0.24, freq: 1400, type: 'bandpass', q: 0.7, gain: 0.4, sweep: 0.25 }); tone({ freq: 130, to: 60, dur: 0.2, type: 'sine', gain: 0.2 }); },
    hit() { noise({ dur: 0.1, freq: 1100, gain: 0.4, sweep: 0.4 }); tone({ freq: 220, to: 120, dur: 0.07, type: 'square', gain: 0.1 }); },
    heavyHit() { noise({ dur: 0.22, freq: 700, gain: 0.6, sweep: 0.3 }); tone({ freq: 110, to: 45, dur: 0.22, type: 'sine', gain: 0.3 }); },
    crit() { noise({ dur: 0.14, freq: 2200, gain: 0.45, sweep: 0.3 }); tone({ freq: 880, to: 1500, dur: 0.1, type: 'square', gain: 0.12 }); },
    kill() { noise({ dur: 0.28, freq: 500, gain: 0.45, sweep: 0.2 }); tone({ freq: 180, to: 60, dur: 0.24, type: 'triangle', gain: 0.16 }); },
    bossKill() {
      noise({ dur: 1.1, freq: 400, gain: 0.7, sweep: 0.12 });
      [0, 0.12, 0.26].forEach((d, i) => tone({ freq: 160 - i * 30, to: 50, dur: 0.7, type: 'sine', gain: 0.3, delay: d }));
    },
    dash() { noise({ dur: 0.19, freq: 3200, type: 'bandpass', q: 1.4, gain: 0.22, sweep: 0.2 }); },
    hurt() { tone({ freq: 210, to: 70, dur: 0.28, type: 'sawtooth', gain: 0.24 }); noise({ dur: 0.16, freq: 400, gain: 0.3 }); },
    explode() { noise({ dur: 0.44, freq: 900, gain: 0.55, sweep: 0.12 }); tone({ freq: 90, to: 35, dur: 0.4, type: 'sine', gain: 0.3 }); },
    shoot() { noise({ dur: 0.09, freq: 1800, type: 'bandpass', q: 2, gain: 0.16, sweep: 0.5 }); },
    projHit() { noise({ dur: 0.07, freq: 1500, gain: 0.16, sweep: 0.5 }); },
    pickup() { tone({ freq: 880, to: 1320, dur: 0.1, type: 'triangle', gain: 0.13 }); },
    heal() { [660, 880, 1100].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'sine', gain: 0.12, delay: i * 0.05 })); },
    boon() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.14, delay: i * 0.07 })); },
    special() { noise({ dur: 0.3, freq: 1800, type: 'bandpass', q: 1.1, gain: 0.32, sweep: 0.25 }); tone({ freq: 300, to: 900, dur: 0.22, type: 'sawtooth', gain: 0.14 }); },
    shock() { tone({ freq: 1400, to: 400, dur: 0.12, type: 'sawtooth', gain: 0.13 }); },
    freeze() { tone({ freq: 1800, to: 900, dur: 0.3, type: 'sine', gain: 0.14 }); noise({ dur: 0.24, freq: 4200, type: 'bandpass', q: 2, gain: 0.16 }); },
    telegraph() { tone({ freq: 320, to: 420, dur: 0.18, type: 'triangle', gain: 0.08 }); },
    bossPhase() { [110, 138, 165].forEach((f, i) => tone({ freq: f, to: f * 2, dur: 0.6, type: 'sawtooth', gain: 0.16, delay: i * 0.06 })); },
    door() { tone({ freq: 440, to: 660, dur: 0.2, type: 'sine', gain: 0.12 }); },
    death() { [220, 165, 110, 82].forEach((f, i) => tone({ freq: f, to: f * 0.6, dur: 0.5, type: 'sawtooth', gain: 0.2, delay: i * 0.16 })); },
    victory() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, dur: 0.42, type: 'triangle', gain: 0.16, delay: i * 0.12 })); },
    ui() { tone({ freq: 700, dur: 0.06, type: 'square', gain: 0.08 }); },
    // 사령술: 낮게 깔리며 위로 솟는 소리
    summon() { tone({ freq: 90, to: 260, dur: 0.34, type: 'sawtooth', gain: 0.14 }); noise({ dur: 0.3, freq: 700, type: 'bandpass', q: 1.4, gain: 0.18, sweep: 2.2 }); },
    raise() { [70, 105, 140].forEach((f, i) => tone({ freq: f, to: f * 3, dur: 0.5, type: 'sawtooth', gain: 0.15, delay: i * 0.07 })); },
    corpse() { noise({ dur: 0.18, freq: 500, gain: 0.22, sweep: 0.4 }); tone({ freq: 140, to: 300, dur: 0.16, type: 'triangle', gain: 0.1 }); },
    minionDown() { tone({ freq: 260, to: 90, dur: 0.28, type: 'triangle', gain: 0.12 }); },
    command() { [520, 700].forEach((f, i) => tone({ freq: f, to: f * 1.3, dur: 0.18, type: 'square', gain: 0.11, delay: i * 0.07 })); },
  };

  // ---- 이벤트 바인딩 ----
  bus.on(EV.ATTACK, (p) => (p.heavy ? S.heavySwing() : S.swing()));
  bus.on(EV.HIT, (p) => {
    if (p.tick) return;
    if (!throttle('hit', 26)) return;
    if (p.crit) S.crit();
    else if (p.heavy) S.heavyHit();
    else S.hit();
  });
  bus.on(EV.KILL, (p) => (p.boss ? S.bossKill() : throttle('kill', 40) && S.kill()));
  bus.on(EV.PLAYER_HURT, () => S.hurt());
  bus.on(EV.PLAYER_DEAD, () => S.death());
  bus.on(EV.DASH, () => S.dash());
  bus.on(EV.SPECIAL, () => S.special());
  bus.on(EV.EXPLOSION, () => throttle('exp', 60) && S.explode());
  bus.on(EV.PROJECTILE_SPAWN, () => throttle('shoot', 30) && S.shoot());
  bus.on(EV.PROJECTILE_HIT, () => throttle('ph', 40) && S.projHit());
  bus.on(EV.PICKUP, (p) => (p.kind === 'heal' ? S.heal() : throttle('pick', 40) && S.pickup()));
  bus.on(EV.HEAL, () => S.heal());
  bus.on(EV.BOON_TAKEN, () => S.boon());
  bus.on(EV.BOSS_PHASE, () => S.bossPhase());
  bus.on(EV.DOOR_OPEN, () => S.door());
  bus.on('minionSummon', () => throttle('summon', 60) && S.summon());
  bus.on('raiseDead', () => S.raise());
  bus.on('minionCommand', () => S.command());
  bus.on('corpseUsed', () => throttle('corpse', 50) && S.corpse());
  bus.on('minionDeath', () => throttle('mdown', 80) && S.minionDown());
  bus.on(EV.STATUS, (p) => {
    if (p.kind === 'frozen') S.freeze();
    else if (p.kind === 'shock' && throttle('shock', 90)) S.shock();
  });

  return {
    S,
    ui: () => S.ui(),
    victory: () => S.victory(),
    resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    setVolume(v) { if (master) master.gain.value = v; },
    get enabled() { return enabled; },
  };
}
