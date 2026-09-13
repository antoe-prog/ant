import { simulateRun } from './bot.mjs';
import { WEAPONS } from '../src/data/weapons.js';

const t0 = Date.now();
for (const w of WEAPONS) {
  const r = simulateRun({ seed: 7, weaponId: w.id, skill: 1 });
  console.log(
    `[${w.name}] 결과=${r.outcome} 시간=${r.elapsed.toFixed(0)}s 방=${r.log.rooms} 처치=${r.log.kills} ` +
    `구역=${r.world.run.biomeIdx + 1} 보스=${r.world.run.bossesKilled} 권능=${r.world.run.owned.length} ` +
    `HP=${r.world.player.hp.toFixed(0)}/${r.world.player.maxHp}`
  );
  console.log('   권능:', r.log.boons.join(', ') || '(없음)');
}
console.log('소요', Date.now() - t0, 'ms');
