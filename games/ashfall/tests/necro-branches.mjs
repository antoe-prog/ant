// 사령술 분기 비교.
// 권능이 '수치만 다른 것'이 아니라 '다른 플레이'로 갈라지는지 확인한다.
// 갈라짐의 증거: 소환수 구성, 피해가 나오는 출처, 적을 붙잡는 정도가 달라야 한다.
import { createWorld } from '../src/sim/world.js';
import { createRun, grantBoon } from '../src/sim/run.js';
import { SIM } from '../src/data/balance.js';
import { EV } from '../src/core/events.js';
import { botIntent } from './bot.mjs';

const BASE = ['necro_attack', 'necro_dash', 'necro_special'];
const BRANCHES = [
  { name: '군세(기본)', boons: [...BASE, 'necro_horde', 'necro_bind'] },
  { name: '사냥개',     boons: [...BASE, 'necro_hounds', 'necro_horde'] },
  { name: '거인',       boons: [...BASE, 'necro_giant', 'necro_horde'] },
  { name: '폭렬',       boons: [...BASE, 'necro_detonate', 'necro_horde'] },
  { name: '역병',       boons: [...BASE, 'necro_plague', 'necro_bind'] },
];
const REPS = Number(process.env.REPS || 4);
const BUDGET = Number(process.env.BUDGET || 420);  // 18방 런은 봇 기준 ~264초, 여유를 둔다
const SHORT = { wraith: '망령', skeleton: '해골', bonearcher: '궁수', bonehound: '사냥개', bonegiant: '거인' };

function run(boons, seed) {
  const w = createWorld({ seed, weaponId: 'gravecall' });
  const d = createRun(w);
  d.start();
  for (const id of boons) grantBoon(w, { id, rarity: 'epic', level: 2 });

  const m = { byMinion: 0, byPlayer: 0, byBlast: 0, summons: 0, staggerTicks: 0, ticks: 0, minionSum: 0, kinds: {}, duoSeen: 0, duoTaken: 0 };
  w.bus.on(EV.HIT, (p) => {
    if (p.tag === 'minion') m.byMinion += p.dmg;
    else if (p.tag === 'explosion') m.byBlast += p.dmg;
    else m.byPlayer += p.dmg;
  });
  w.bus.on('minionSummon', (p) => { m.summons++; m.kinds[p.id] = (m.kinds[p.id] || 0) + 1; });

  let t = 0;
  while (t < BUDGET) {
    const st = w.run;
    if (st.state === 'reward') {
      // 분기 전용 합일이 제안되면 세고, 있으면 그것을 고른다 (사람의 선택을 흉내)
      const opts = d.rewardOptions || [];
      const i = opts.findIndex((o) => o.reqText);
      if (i >= 0) { m.duoSeen++; m.duoTaken++; d.chooseReward(i); }
      else d.chooseReward(0);
      continue;
    }
    if (st.state === 'curse') { d.chooseCurse(0); continue; }
    if (st.state === 'shop') { d.leaveShop(); continue; }
    if (st.state === 'dead' || st.state === 'victory') break;
    d.update(SIM.DT); w.step(botIntent(w, 1), SIM.DT); t += SIM.DT;
    if (st.state === 'fight') {
      m.ticks++;
      m.minionSum += w.minions.length;
      for (const e of w.enemies) if (e.staggerT > 0) { m.staggerTicks++; break; }
    }
  }
  return { ...m, kills: w.run.kills, elapsed: t, rooms: w.run.roomsCleared, won: w.run.state === 'victory' };
}

// 피해 출처는 실제로 tag 로 구분되므로, 태그를 흘려보내도록 hit 이벤트에 tag 추가가 필요하다
console.log('분기        승  방수  분당처치  소환수(평균)  소환 종류            피해출처(소환/폭발/직접)  적경직  분기합일획득');
for (const b of BRANCHES) {
  const rows = [];
  for (let i = 0; i < REPS; i++) rows.push(run(b.boons, (i + 1) * 977));
  const avg = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const kinds = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.kinds)) kinds[k] = (kinds[k] || 0) + v;
  const totalK = Object.values(kinds).reduce((a, v) => a + v, 0) || 1;
  const kindStr = Object.entries(kinds).sort((a, c) => c[1] - a[1])
        .slice(0, 3)
    .map(([k, v]) => `${SHORT[k] || k} ${Math.round(v / totalK * 100)}%`).join(' ');
  const dmgTot = avg((r) => r.byMinion + r.byBlast + r.byPlayer) || 1;
  console.log(
    `${b.name.padEnd(10)} ${String(rows.filter((r) => r.won).length).padStart(2)}  ` +
    `${avg((r) => r.rooms).toFixed(1).padStart(4)}  ` +
    `${(avg((r) => r.kills) / avg((r) => r.elapsed) * 60).toFixed(1).padStart(7)}  ` +
    `${(avg((r) => r.minionSum) / avg((r) => r.ticks)).toFixed(1).padStart(11)}  ` +
    `${kindStr.padEnd(20)}  ` +
    `${Math.round(avg((r) => r.byMinion) / dmgTot * 100)}% / ${Math.round(avg((r) => r.byBlast) / dmgTot * 100)}% / ${Math.round(avg((r) => r.byPlayer) / dmgTot * 100)}%`.padStart(24) + '  ' +
    `${Math.round(avg((r) => r.staggerTicks) / avg((r) => r.ticks) * 100)}%`.padStart(6) + '  ' +
    `${rows.filter((r) => r.duoTaken > 0).length}/${rows.length}판`
  );
}
