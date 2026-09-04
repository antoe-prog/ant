import { simulateRun } from './bot.mjs';
import { WEAPONS } from '../src/data/weapons.js';
const N = Number(process.argv[2] || 12);
let total = { win: 0, n: 0 };
for (const w of WEAPONS) {
  let win = 0, sumT = 0, sumRoom = 0, deaths = [];
  for (let s = 1; s <= N; s++) {
    const r = simulateRun({ seed: s * 137, weaponId: w.id });
    if (r.outcome === 'victory') { win++; sumT += r.elapsed; }
    else deaths.push(`${r.world.run.biomeIdx + 1}-${r.world.run.roomIdx + 1}`);
    sumRoom += r.log.rooms;
  }
  total.win += win; total.n += N;
  console.log(`${w.name.padEnd(5)} 승률 ${win}/${N}  평균클리어시간 ${(win ? sumT / win : 0).toFixed(0)}s  평균방수 ${(sumRoom / N).toFixed(1)}  사망지점 ${deaths.join(' ')}`);
}
console.log(`전체 승률 ${total.win}/${total.n}`);
