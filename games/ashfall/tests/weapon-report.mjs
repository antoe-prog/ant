// 무기별 실측 리포트: 이론 DPS, 사이클, 실전 피격률.
// 밸런스 조정 전후 비교용 도구.
import { WEAPONS } from '../src/data/weapons.js';
import { createWorld } from '../src/sim/world.js';
import { createRun } from '../src/sim/run.js';
import { SIM, PLAYER } from '../src/data/balance.js';
import { EV } from '../src/core/events.js';
import { botIntent } from './bot.mjs';

console.log('=== 이론 수치 ===');
for (const w of WEAPONS) {
  let cycle = 0, dmg = 0, lockTime = 0;
  for (const s of w.combo) {
    const t = s.windup + s.active + s.recover;
    cycle += t; dmg += s.dmg;
    const mv = typeof s.move === 'number' ? { windup: s.move, active: s.move, recover: s.move } : s.move;
    lockTime += s.windup * (1 - mv.windup) + s.active * (1 - mv.active) + s.recover * (1 - mv.recover);
  }
  console.log(
    `${w.name.padEnd(5)} 콤보DPS ${(dmg / cycle).toFixed(1).padStart(5)}  사이클 ${cycle.toFixed(2)}s  ` +
    `타격당 ${(dmg / w.combo.length).toFixed(1).padStart(5)}  이동제한 ${(lockTime / cycle * 100).toFixed(0)}%  ` +
    `평균사거리 ${(w.combo.reduce((a, s) => a + s.range, 0) / w.combo.length).toFixed(0)}  ` +
    `이속×${w.moveMult}`
  );
}

console.log('\n=== 실전 계측 (동일 시드 12회, 봇 자동 플레이) ===');
for (const w of WEAPONS) {
  let dealt = 0, taken = 0, hurtWhileAttacking = 0, hurtTotal = 0, time = 0, kills = 0, rooms = 0;
  for (let s = 1; s <= 12; s++) {
    const world = createWorld({ seed: s * 313, weaponId: w.id });
    const d = createRun(world);
    world.bus.on(EV.HIT, (p) => { if (!p.tick) dealt += p.dmg; });
    world.bus.on(EV.PLAYER_HURT, (p) => {
      taken += p.dmg; hurtTotal++;
      if (world.player.state === 'attack') hurtWhileAttacking++;
    });
    world.bus.on(EV.ROOM_CLEAR, () => rooms++);
    d.start();
    let t = 0;
    while (t < 400) {
      const run = world.run;
      if (run.state === 'reward') { d.chooseReward(0); continue; }
      if (run.state === 'curse') { d.chooseCurse(0); continue; }
      if (run.state === 'shop') { d.leaveShop(); continue; }
      if (run.state === 'dead' || run.state === 'victory') break;
      d.update(SIM.DT); world.step(botIntent(world, 1), SIM.DT); t += SIM.DT;
    }
    time += t; kills += world.run.kills;
  }
  console.log(
    `${w.name.padEnd(5)} 실전DPS ${(dealt / time).toFixed(1).padStart(5)}  ` +
    `분당처치 ${(kills / time * 60).toFixed(1).padStart(5)}  ` +
    `분당피격 ${(hurtTotal / time * 60).toFixed(1).padStart(4)}회  ` +
    `공격중피격 ${(hurtWhileAttacking / Math.max(1, hurtTotal) * 100).toFixed(0)}%  ` +
    `평균방 ${(rooms / 12).toFixed(1)}`
  );
}
