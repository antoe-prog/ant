// ============================================================
// 권능(Boon) = 빌드의 핵심.
// 각 권능은 loadout(L)에 스탯/훅을 주입한다. sim 은 훅만 호출한다.
//
// slot: attack(기본공격) / dash(대시) / special(특수기) / passive(패시브)
//  - attack/dash/special 은 슬롯당 1개만 장착 가능 → 선택 압박이 생긴다.
//  - passive 는 여러 개 누적.
// god: ember/frost/storm/blood/none  (합일 권능 조건에 사용)
// ============================================================

export const GODS = {
  ember: { id: 'ember', name: '재의 신 엠버',   color: '#ff8b4a', element: 'ember' },
  frost: { id: 'frost', name: '서리 신 글라시아', color: '#7fd8ff', element: 'frost' },
  storm: { id: 'storm', name: '폭풍 신 볼트',   color: '#ffe36b', element: 'storm' },
  blood: { id: 'blood', name: '피의 신 상귄',   color: '#ff4d6d', element: 'blood' },
  necro: { id: 'necro', name: '사령의 신 모르', color: '#9d7fd8', element: 'necro' },
  none:  { id: 'none',  name: '방랑자의 유물',  color: '#c8d2dc', element: 'none' },
};

export const SLOT_NAMES = {
  attack: '기본공격', dash: '대시', special: '특수기', passive: '패시브',
};

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * 권능 정의.
 *  values: 기본 수치. 실제 값 = base * rarityMult * (1 + 0.32*(level-1))
 *  apply(L, v, ctxDefs) 에서 L 을 변형한다.
 */
export const BOONS = [
  // ---------------- 재의 신 엠버 (지속피해 / 폭발) ----------------
  {
    id: 'ember_attack', god: 'ember', slot: 'attack', name: '잿불 각인',
    values: { stacks: 2 },
    desc: (v) => `기본공격이 화상 ${Math.round(v.stacks)}중첩을 부여한다.`,
    apply: (L, v) => { L.attackStatus.push({ kind: 'burn', stacks: Math.round(v.stacks) }); },
  },
  {
    id: 'ember_dash', god: 'ember', slot: 'dash', name: '작열 폭발',
    values: { dmg: 26, radius: 92, stacks: 2 },
    desc: (v) => `대시가 끝날 때 반경 ${Math.round(v.radius)} 폭발 (${Math.round(v.dmg)} 피해 + 화상).`,
    apply: (L, v) => {
      L.on.dashEnd.push((c) => {
        c.explode(c.x, c.y, v.radius, v.dmg, 'ember', { kind: 'burn', stacks: Math.round(v.stacks) });
      });
    },
  },
  {
    id: 'ember_special', god: 'ember', slot: 'special', name: '화염 파문',
    values: { stacks: 3, mult: 0.25 },
    desc: (v) => `특수기가 화상 ${Math.round(v.stacks)}중첩을 부여하고 화상 대상에게 +${pct(v.mult)} 피해.`,
    apply: (L, v) => {
      L.specialStatus.push({ kind: 'burn', stacks: Math.round(v.stacks) });
      L.on.modifyDamage.push((c) => { if (c.tag === 'special' && c.target.status?.burn) c.mult *= 1 + v.mult; });
    },
  },
  {
    id: 'ember_amplify', god: 'ember', slot: 'passive', name: '타오르는 심장',
    values: { mult: 0.45 },
    desc: (v) => `화상 피해 +${pct(v.mult)}.`,
    apply: (L, v) => { L.mods.burnMult += v.mult; },
  },
  {
    id: 'ember_spread', god: 'ember', slot: 'passive', name: '번지는 불씨',
    values: { radius: 130, stacks: 2 },
    desc: (v) => `화상 중인 적을 처치하면 반경 ${Math.round(v.radius)} 내 적에게 화상 ${Math.round(v.stacks)}중첩이 옮겨붙는다.`,
    apply: (L, v) => {
      L.on.kill.push((c) => {
        if (!c.target.status?.burn) return;
        c.forEachEnemyInRange(c.x, c.y, v.radius, (e) => c.applyStatus(e, 'burn', Math.round(v.stacks)));
        c.fx('explosion', { x: c.x, y: c.y, radius: v.radius, element: 'ember' });
      });
    },
  },

  // ---------------- 서리 신 글라시아 (제어 / 파쇄) ----------------
  {
    id: 'frost_attack', god: 'frost', slot: 'attack', name: '서리 각인',
    values: { stacks: 1 },
    desc: (v) => `기본공격이 냉기 ${Math.round(v.stacks)}중첩을 부여한다. 최대 중첩 시 적이 빙결된다.`,
    apply: (L, v) => { L.attackStatus.push({ kind: 'chill', stacks: Math.round(v.stacks) }); },
  },
  {
    id: 'frost_dash', god: 'frost', slot: 'dash', name: '한파의 자취',
    values: { radius: 110, stacks: 2, dmg: 8 },
    desc: (v) => `대시가 지나간 자리의 적에게 냉기 ${Math.round(v.stacks)}중첩과 ${Math.round(v.dmg)} 피해.`,
    apply: (L, v) => {
      L.on.dashTrail.push((c) => {
        c.forEachEnemyInRange(c.x, c.y, v.radius, (e) => {
          c.applyStatus(e, 'chill', Math.round(v.stacks));
          c.damage(e, v.dmg, 'frost', { tag: 'dash', silent: true });
        });
      });
    },
  },
  {
    id: 'frost_special', god: 'frost', slot: 'special', name: '절대 영도',
    values: { stacks: 3 },
    desc: (v) => `특수기가 냉기 ${Math.round(v.stacks)}중첩을 부여한다.`,
    apply: (L, v) => { L.specialStatus.push({ kind: 'chill', stacks: Math.round(v.stacks) }); },
  },
  {
    id: 'frost_shatter', god: 'frost', slot: 'passive', name: '파쇄',
    values: { mult: 0.5 },
    desc: (v) => `빙결된 적에게 주는 피해 +${pct(v.mult)}.`,
    apply: (L, v) => {
      L.on.modifyDamage.push((c) => { if (c.target.status?.frozen) c.mult *= 1 + v.mult; });
    },
  },
  {
    id: 'frost_nova', god: 'frost', slot: 'passive', name: '얼음 무덤',
    values: { radius: 120, dmg: 22, stacks: 2 },
    desc: (v) => `냉기에 걸린 적이 죽으면 냉기 폭발이 일어난다 (${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.kill.push((c) => {
        if (!c.target.status?.chill && !c.target.status?.frozen) return;
        c.explode(c.x, c.y, v.radius, v.dmg, 'frost', { kind: 'chill', stacks: Math.round(v.stacks) });
      });
    },
  },

  // ---------------- 폭풍 신 볼트 (연쇄 / 기동) ----------------
  {
    id: 'storm_attack', god: 'storm', slot: 'attack', name: '방전 각인',
    values: { chance: 0.3, dmg: 16, targets: 2 }, caps: { chance: 0.75 },
    desc: (v) => `기본공격이 ${pct(v.chance)} 확률로 ${Math.round(v.targets)}명에게 연쇄 번개 (${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.hit.push((c) => {
        if (c.tag !== 'attack') return;
        if (c.rng.next() > v.chance) return;
        c.chain(c.target, Math.round(v.targets), v.dmg);
      });
    },
  },
  {
    id: 'storm_dash', god: 'storm', slot: 'dash', name: '뇌전 질주',
    values: { cdr: 0.28, dmg: 18, stacks: 1 }, caps: { cdr: 0.55 },
    desc: (v) => `대시 쿨다운 -${pct(v.cdr)}. 대시가 스친 적에게 ${Math.round(v.dmg)} 피해와 감전.`,
    apply: (L, v) => {
      L.mods.dashCooldownMult *= 1 - v.cdr;
      L.on.dashTrail.push((c) => {
        c.forEachEnemyInRange(c.x, c.y, 78, (e) => {
          c.damage(e, v.dmg, 'storm', { tag: 'dash', silent: true });
          c.applyStatus(e, 'shock', Math.round(v.stacks));
        });
      });
    },
  },
  {
    id: 'storm_special', god: 'storm', slot: 'special', name: '벼락 소환',
    values: { dmg: 40, count: 3, radius: 74 },
    desc: (v) => `특수기 사용 시 무작위 적 ${Math.round(v.count)}명에게 낙뢰 (${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.special.push((c) => { c.strikeRandom(Math.round(v.count), v.dmg, v.radius); });
    },
  },
  {
    id: 'storm_haste', god: 'storm', slot: 'passive', name: '폭풍의 발걸음',
    values: { move: 0.1, atk: 0.12 },
    desc: (v) => `이동속도 +${pct(v.move)}, 공격속도 +${pct(v.atk)}.`,
    apply: (L, v) => { L.stats.moveMult *= 1 + v.move; L.stats.attackSpeed *= 1 + v.atk; },
  },
  {
    id: 'storm_conduct', god: 'storm', slot: 'passive', name: '과전류',
    values: { perStack: 0.09 },
    desc: (v) => `감전 중첩 1당 대상이 받는 피해 +${pct(v.perStack)}.`,
    apply: (L, v) => {
      L.on.modifyDamage.push((c) => {
        const s = c.target.status?.shock;
        if (s) c.mult *= 1 + v.perStack * s.stacks;
      });
    },
  },

  // ---------------- 피의 신 상귄 (흡혈 / 광폭) ----------------
  {
    id: 'blood_attack', god: 'blood', slot: 'attack', name: '갈증의 각인',
    values: { leech: 0.07, stacks: 1 }, caps: { leech: 0.2 },
    desc: (v) => `기본공격이 출혈을 부여하고 피해의 ${pct(v.leech)}를 회복한다.`,
    apply: (L, v) => {
      L.attackStatus.push({ kind: 'bleed', stacks: Math.round(v.stacks) });
      L.on.hit.push((c) => { if (c.tag === 'attack') c.heal(c.dmg * v.leech); });
    },
  },
  {
    id: 'blood_dash', god: 'blood', slot: 'dash', name: '흡혈 도약',
    values: { mult: 0.6, window: 1.2 },
    desc: (v) => `대시 직후 ${v.window.toFixed(1)}초 내 첫 공격 피해 +${pct(v.mult)}.`,
    apply: (L, v) => {
      L.mods.dashStrikeWindow = Math.max(L.mods.dashStrikeWindow, v.window);
      L.mods.dashStrikeMult += v.mult;
    },
  },
  {
    id: 'blood_special', god: 'blood', slot: 'special', name: '피의 대가',
    values: { mult: 0.55, leech: 0.22 }, caps: { leech: 0.5 },
    desc: (v) => `특수기 피해 +${pct(v.mult)}, 특수기 피해의 ${pct(v.leech)}를 회복.`,
    apply: (L, v) => {
      L.on.modifyDamage.push((c) => { if (c.tag === 'special') c.mult *= 1 + v.mult; });
      L.on.hit.push((c) => { if (c.tag === 'special') c.heal(c.dmg * v.leech); });
    },
  },
  {
    id: 'blood_frenzy', god: 'blood', slot: 'passive', name: '광란',
    values: { max: 0.55 }, caps: { max: 1.2 },
    desc: (v) => `체력이 낮을수록 피해 증가 (최대 +${pct(v.max)}).`,
    apply: (L, v) => {
      L.on.modifyDamage.push((c) => {
        const missing = 1 - c.player.hp / c.player.maxHp;
        c.mult *= 1 + v.max * missing;
      });
    },
  },
  {
    id: 'blood_feast', god: 'blood', slot: 'passive', name: '피의 만찬',
    values: { heal: 4 },
    desc: (v) => `적 처치 시 체력 ${Math.round(v.heal)} 회복.`,
    apply: (L, v) => { L.on.kill.push((c) => c.heal(v.heal)); },
  },

  // ---------------- 사령의 신 모르 (시체 · 소환) ----------------
  // 이 계열의 자원은 '시체'다. 어디서 싸웠는지가 그대로 힘이 된다.
  {
    id: 'necro_attack', god: 'necro', slot: 'attack', name: '망자의 인장',
    values: { chance: 0.35 }, caps: { chance: 0.8 },
    desc: (v) => `기본공격으로 적을 처치하면 ${pct(v.chance)} 확률로 그 자리에서 망령이 일어난다.`,
    apply: (L, v) => {
      L.on.kill.push((c) => {
        if (c.tag !== 'attack') return;
        if (c.rng.next() > v.chance) return;
        const near = c.corpses(c.x, c.y, 60)[0];
        if (near) c.consume(near);
        c.summon('wraith', c.x, c.y, { scale: c.target.elite ? 1.5 : 1 });
      });
    },
  },
  {
    id: 'necro_dash', god: 'necro', slot: 'dash', name: '영혼 수확',
    values: { radius: 120, heal: 5 },
    desc: (v) => `대시가 지나간 자리의 시체를 거두어 망령으로 일으키고 체력 ${Math.round(v.heal)}를 회복한다.`,
    apply: (L, v) => {
      L.on.dashTrail.push((c) => {
        const list = c.corpses(c.x, c.y, v.radius);
        if (!list.length) return;
        const target = list[0];
        if (!c.consume(target)) return;
        c.summon('wraith', target.x, target.y, { scale: target.scale });
        c.heal(v.heal);
      });
    },
  },
  {
    id: 'necro_special', god: 'necro', slot: 'special', name: '시체 폭발',
    values: { radius: 300, dmg: 52, blast: 130 },
    desc: (v) => `특수기가 반경 ${Math.round(v.radius)} 내 모든 시체를 터뜨린다 (각각 ${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.special.push((c) => {
        for (const corpse of c.corpses(c.x, c.y, v.radius)) {
          if (!c.consume(corpse)) continue;
          c.explode(corpse.x, corpse.y, v.blast * corpse.scale, v.dmg * corpse.scale, 'necro', null);
        }
      });
    },
  },
  {
    id: 'necro_horde', god: 'necro', slot: 'passive', name: '군세',
    values: { life: 0.45, dmg: 0.25 },
    desc: (v) => `소환수 지속시간 +${pct(v.life)}, 피해 +${pct(v.dmg)}. (오래 살수록 군세가 두꺼워진다)`,
    apply: (L, v) => { L.mods.minionLife += v.life; L.mods.minionDamage += v.dmg; },
  },
  {
    id: 'necro_grave', god: 'necro', slot: 'passive', name: '무덤의 가호',
    values: { perCorpse: 0.05, max: 0.35, radius: 240 }, caps: { max: 0.6 },
    desc: (v) => `주변 시체 1구당 주는 피해 +${pct(v.perCorpse)} (최대 +${pct(v.max)}).`,
    apply: (L, v) => {
      L.on.modifyDamage.push((c) => {
        const n = c.corpses(c.player.x, c.player.y, v.radius).length;
        if (n > 0) c.mult *= 1 + Math.min(v.max, v.perCorpse * n);
      });
    },
  },
  {
    id: 'necro_harvest', god: 'necro', slot: 'passive', name: '시체 흡수',
    values: { heal: 7, focus: 12 },
    desc: (v) => `시체를 밟으면 흡수하여 체력 ${Math.round(v.heal)}와 집중 ${Math.round(v.focus)}를 얻는다.`,
    apply: (L, v) => {
      L.on.tick.push((c) => {
        const near = c.corpses(c.player.x, c.player.y, 46)[0];
        if (!near || !c.consume(near)) return;
        c.heal(v.heal);
        c.player.focus = Math.min(c.player.maxFocus, c.player.focus + v.focus);
      });
    },
  },
  // ---- 아래 셋은 '군세를 무엇으로 쓸 것인가'를 가르는 분기다.
  //      전부 사이드그레이드다 — 더 세지는 게 아니라 역할이 바뀐다.
  {
    id: 'necro_hounds', god: 'necro', slot: 'passive', name: '사냥개 무리',
    values: { stagger: 0.15 },
    desc: () => `망령 대신 뼈 사냥개가 일어난다. 훨씬 빠르고, 물면 적의 행동을 끊는다. (피해는 낮다)\n→ 서리 계열과 만나면 합일 '서리 송곳니'가 열린다.`,
    apply: (L) => { L.mods.minionSwap.wraith = 'bonehound'; },
  },
  {
    id: 'necro_giant', god: 'necro', slot: 'passive', name: '거인 결속',
    values: { merge: 4 },
    desc: (v) => `망자 봉기가 시체 ${Math.round(v.merge)}구까지 합쳐 해골 거인 하나를 세운다. 합칠수록 강해진다.\n→ 재 계열과 만나면 합일 '무너지는 거인'이 열린다.`,
    apply: (L, v) => { L.mods.giantMerge = Math.max(L.mods.giantMerge, Math.round(v.merge)); },
  },
  {
    id: 'necro_detonate', god: 'necro', slot: 'passive', name: '폭렬 결속',
    values: { dmg: 48, radius: 145, lifeCut: 0.4 },
    desc: (v) => `소환수가 스러질 때 폭발한다 (${Math.round(v.dmg)} 피해). 대신 지속시간 -${pct(v.lifeCut)}.\n→ 폭풍 계열과 만나면 합일 '연쇄 폭렬'이 열린다.`,
    caps: { lifeCut: 0.6 },
    apply: (L, v) => {
      L.mods.minionLife -= v.lifeCut;
      L.on.minionDeath.push((c) => {
        c.explode(c.x, c.y, v.radius, v.dmg, 'necro', null);
      });
    },
  },
  {
    id: 'necro_plague', god: 'necro', slot: 'passive', name: '역병',
    values: { burn: 2, bleed: 2, dmgCut: 0.2 },
    caps: { dmgCut: 0.35 },
    desc: (v) => `소환수의 타격이 화상과 출혈을 함께 남긴다 (각 ${Math.round(v.burn)}중첩). 대신 소환수 피해 -${pct(v.dmgCut)}.\n→ 피 계열과 만나면 합일 '역병의 피'가 열린다.`,
    apply: (L, v) => {
      L.minionStatus.push({ kind: 'burn', stacks: Math.round(v.burn) });
      L.minionStatus.push({ kind: 'bleed', stacks: Math.round(v.bleed) });
      L.mods.minionDamage -= v.dmgCut;   // 직접 때리는 대신 곪게 한다
    },
  },
  {
    id: 'necro_bind', god: 'necro', slot: 'passive', name: '영혼 결속',
    values: { life: 0.5, hp: 0.6, status: 2 },
    desc: (v) => `소환수 지속시간 +${pct(v.life)}, 체력 +${pct(v.hp)}. 소환수 타격이 냉기를 부여한다.`,
    apply: (L, v) => {
      L.mods.minionLife += v.life;
      L.mods.minionHp += v.hp;
      L.minionStatus.push({ kind: 'chill', stacks: Math.round(v.status) });
    },
  },

  // ---------------- 공용 유물 ----------------
  {
    id: 'relic_crit', god: 'none', slot: 'passive', name: '사냥꾼의 눈',
    values: { chance: 0.12, mult: 0.25 },
    desc: (v) => `치명타 확률 +${pct(v.chance)}, 치명타 피해 +${pct(v.mult)}.`,
    apply: (L, v) => { L.stats.critChance += v.chance; L.stats.critMult += v.mult; },
  },
  {
    id: 'relic_hp', god: 'none', slot: 'passive', name: '강철 심장',
    values: { hp: 22 },
    desc: (v) => `최대 체력 +${Math.round(v.hp)} (즉시 회복).`,
    apply: (L, v) => { L.stats.maxHpBonus += Math.round(v.hp); },
  },
  {
    id: 'relic_focus', god: 'none', slot: 'passive', name: '명상의 인장',
    values: { regen: 4.5, cost: 0.18 }, caps: { cost: 0.5 },
    desc: (v) => `집중 회복 +${v.regen.toFixed(1)}/초, 특수기 소모 -${pct(v.cost)}.`,
    apply: (L, v) => { L.stats.focusRegen += v.regen; L.mods.specialCostMult *= 1 - v.cost; },
  },
  {
    id: 'relic_dash', god: 'none', slot: 'passive', name: '바람의 부적',
    values: { charges: 1 },
    desc: () => `대시 충전 +1.`,
    apply: (L) => { L.stats.dashCharges += 1; },
  },
  {
    id: 'relic_power', god: 'none', slot: 'passive', name: '전쟁의 표식',
    values: { mult: 0.16 },
    desc: (v) => `모든 피해 +${pct(v.mult)}.`,
    apply: (L, v) => { L.stats.damageMult *= 1 + v.mult; },
  },
  {
    id: 'relic_thorns', god: 'none', slot: 'passive', name: '가시 갑주',
    values: { dmg: 34, radius: 130 },
    desc: (v) => `피격 시 주변 적에게 ${Math.round(v.dmg)} 피해로 반격한다.`,
    apply: (L, v) => {
      L.on.hurt.push((c) => { c.explode(c.player.x, c.player.y, v.radius, v.dmg, 'none', null); });
    },
  },
];

// ============================================================
// 무기 전용 권능 — 해당 무기를 들었을 때만 등장한다.
// 무기의 고유 메커니즘(시체·군세)을 빌드로 확장한다.
// ============================================================
export const WEAPON_BOONS = [


  {
    id: 'grave_legion', weapon: 'gravecall', god: 'none', slot: 'passive', name: '대군',
    values: { raise: 3, archer: 0.5 }, caps: { archer: 0.75 },
    desc: (v) => `망자 봉기가 시체 ${Math.round(v.raise)}구를 더 일으키고, ${pct(v.archer)} 확률로 뼈 궁수가 나온다.`,
    apply: (L, v) => {
      L.mods.raiseBonus += Math.round(v.raise);
      L.mods.archerChance += v.archer;
    },
  },
  {
    id: 'grave_grasp', weapon: 'gravecall', god: 'none', slot: 'passive', name: '죽음의 손아귀',
    values: { dmg: 44, radius: 150, chance: 0.5 }, caps: { chance: 0.85 },
    desc: (v) => `적이 죽을 때 ${pct(v.chance)} 확률로 시체가 즉시 터진다 (${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.corpse.push((c) => {
        if (c.rng.next() > v.chance) return;
        const near = c.corpses(c.x, c.y, 40)[0];
        if (near) c.consume(near);
        c.explode(c.x, c.y, v.radius, v.dmg, 'necro', null);
      });
    },
  },

];

export const BOON_BY_ID = Object.fromEntries(BOONS.map((b) => [b.id, b]));

// ============================================================
// 합일 권능 (Duo) — 두 신의 권능을 모두 보유했을 때만 등장.
// 빌드가 "완성되는" 순간을 만든다.
// ============================================================
export const DUO_BOONS = [
  {
    id: 'duo_thermal', gods: ['ember', 'frost'], name: '열충격', slot: 'passive', god: 'none',
    values: { dmg: 70, radius: 140 },
    desc: (v) => `화상과 냉기가 동시에 걸린 적이 폭발한다 (${Math.round(v.dmg)} 피해, 반경 ${Math.round(v.radius)}).`,
    apply: (L, v) => {
      L.on.statusApplied.push((c) => {
        const st = c.target.status;
        if (!st?.burn || !(st.chill || st.frozen)) return;
        if (c.target._thermalCd > 0) return;
        c.target._thermalCd = 1.1;
        c.explode(c.target.x, c.target.y, v.radius, v.dmg, 'ember', null);
      });
    },
  },
  {
    id: 'duo_wildfire', gods: ['ember', 'storm'], name: '연쇄 화염', slot: 'passive', god: 'none',
    values: { dmg: 46, radius: 150 },
    desc: (v) => `감전된 적을 처치하면 대폭발이 일어난다 (${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.kill.push((c) => {
        if (!c.target.status?.shock) return;
        c.explode(c.x, c.y, v.radius, v.dmg, 'ember', { kind: 'burn', stacks: 3 });
      });
    },
  },
  {
    id: 'duo_ashthirst', gods: ['ember', 'blood'], name: '재의 갈증', slot: 'passive', god: 'none',
    values: { leech: 0.35 }, caps: { leech: 0.7 },
    desc: (v) => `화상 피해의 ${pct(v.leech)}만큼 체력을 회복한다.`,
    apply: (L, v) => {
      L.on.hit.push((c) => { if (c.tag === 'burn') c.heal(c.dmg * v.leech); });
    },
  },
  {
    id: 'duo_superconduct', gods: ['frost', 'storm'], name: '초전도', slot: 'passive', god: 'none',
    values: { mult: 2.0, targets: 3, dmg: 28 },
    desc: (v) => `빙결된 적을 때리면 ${Math.round(v.targets)}명에게 강력한 연쇄 번개 (${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.hit.push((c) => {
        if (!c.target.status?.frozen) return;
        c.chain(c.target, Math.round(v.targets), v.dmg, 1.9);
      });
    },
  },
  {
    id: 'duo_frostbite', gods: ['frost', 'blood'], name: '동상', slot: 'passive', god: 'none',
    values: { perStack: 0.22 },
    desc: (v) => `출혈 피해가 대상의 냉기 중첩 1당 +${pct(v.perStack)}.`,
    apply: (L, v) => {
      L.on.modifyDamage.push((c) => {
        if (c.tag !== 'bleed') return;
        const s = c.target.status?.chill;
        if (s) c.mult *= 1 + v.perStack * s.stacks;
        if (c.target.status?.frozen) c.mult *= 1 + v.perStack * 5;
      });
    },
  },
  {
    id: 'duo_overload', gods: ['storm', 'blood'], name: '혈류 과부하', slot: 'passive', god: 'none',
    values: { dmg: 34, targets: 4 }, caps: {},
    desc: (v) => `출혈 중인 적을 때리면 ${Math.round(v.targets)}명에게 방전된다 (${Math.round(v.dmg)} 피해).`,
    apply: (L, v) => {
      L.on.hit.push((c) => {
        if (c.tag !== 'attack' || !c.target.status?.bleed) return;
        if (c.rng.next() > 0.45) return;
        c.chain(c.target, Math.round(v.targets), v.dmg);
      });
    },
  },
];

// 사령의 신과의 합일 — 소환/시체가 다른 계열과 맞물린다
DUO_BOONS.push(
  {
    id: 'duo_pyre', gods: ['necro', 'ember'], name: '화장', slot: 'passive', god: 'none',
    values: { dmg: 55, radius: 130, stacks: 3 },
    desc: (v) => `소환수가 스러질 때 폭발한다 (${Math.round(v.dmg)} 피해 + 화상).`,
    apply: (L, v) => {
      L.on.minionDeath.push((c) => {
        c.explode(c.x, c.y, v.radius, v.dmg, 'ember', { kind: 'burn', stacks: Math.round(v.stacks) });
      });
    },
  },
  {
    id: 'duo_icetomb', gods: ['necro', 'frost'], name: '빙결의 무덤', slot: 'passive', god: 'none',
    values: { radius: 160, stacks: 3, dmg: 24 },
    desc: (v) => `시체가 사라질 때 냉기 폭발을 남긴다 (${Math.round(v.dmg)} 피해 + 냉기 ${Math.round(v.stacks)}중첩).`,
    apply: (L, v) => {
      L.on.corpseExpire.push((c) => {
        c.explode(c.x, c.y, v.radius, v.dmg, 'frost', { kind: 'chill', stacks: Math.round(v.stacks) });
      });
    },
  },
  {
    id: 'duo_soulcharge', gods: ['necro', 'storm'], name: '영혼 방전', slot: 'passive', god: 'none',
    values: { dmg: 24, targets: 2, chance: 0.35 }, caps: { chance: 0.8 },
    desc: (v) => `소환수의 타격이 ${pct(v.chance)} 확률로 ${Math.round(v.targets)}명에게 연쇄 번개를 부른다.`,
    apply: (L, v) => {
      L.on.hit.push((c) => {
        if (c.tag !== 'minion') return;
        if (c.rng.next() > v.chance) return;
        c.chain(c.target, Math.round(v.targets), v.dmg);
      });
    },
  },
  {
    id: 'duo_siphon', gods: ['necro', 'blood'], name: '생명 착취', slot: 'passive', god: 'none',
    values: { leech: 0.3 }, caps: { leech: 0.6 },
    desc: (v) => `소환수가 준 피해의 ${pct(v.leech)}만큼 내 체력이 회복된다.`,
    apply: (L, v) => {
      L.on.hit.push((c) => { if (c.tag === 'minion') c.heal(c.dmg * v.leech); });
    },
  },
);

// ============================================================
// 분기 전용 합일 — 특정 사령술 갈래를 골랐을 때만 열린다.
// 초반에 고른 갈래가 후반의 강력한 한 방으로 이어지게 만든다.
// requires 에 적힌 권능을 반드시 보유해야 등장한다.
// ============================================================
DUO_BOONS.push(
  {
    id: 'duo_frostfang', gods: ['frost'], requires: ['necro_hounds'],
    reqText: '사냥개 무리 + 서리 계열',
    name: '서리 송곳니', slot: 'passive', god: 'none',
    values: { stacks: 2, stagger: 0.9, shatter: 0.5 },
    desc: (v) => `사냥개가 물면 냉기 ${Math.round(v.stacks)}중첩. 빙결된 적을 물면 ${v.stagger.toFixed(1)}초 경직시키고 +${pct(v.shatter)} 피해.`,
    apply: (L, v) => {
      L.on.hit.push((c) => {
        if (c.tag !== 'minion' || c.minion?.id !== 'bonehound') return;
        c.applyStatus(c.target, 'chill', Math.round(v.stacks));
        if (c.target.status?.frozen) c.stagger(c.target, v.stagger);
      });
      L.on.modifyDamage.push((c) => {
        if (c.tag === 'minion' && c.target.status?.frozen) c.mult *= 1 + v.shatter;
      });
    },
  },
  {
    id: 'duo_collapse', gods: ['ember'], requires: ['necro_giant'],
    reqText: '거인 결속 + 재 계열',
    name: '무너지는 거인', slot: 'passive', god: 'none',
    values: { dmg: 90, radius: 200, stacks: 4 },
    desc: (v) => `해골 거인이 스러질 때 무너져 내린다 (${Math.round(v.dmg)} 피해 + 화상). 합친 시체가 많을수록 크다.`,
    apply: (L, v) => {
      L.on.minionDeath.push((c) => {
        if (c.minion?.id !== 'bonegiant') return;
        const k = c.minion.scale || 1;
        c.explode(c.x, c.y, v.radius * k, v.dmg * k, 'ember', { kind: 'burn', stacks: Math.round(v.stacks) });
      });
    },
  },
  {
    id: 'duo_chainblast', gods: ['storm'], requires: ['necro_detonate'],
    reqText: '폭렬 결속 + 폭풍 계열',
    name: '연쇄 폭렬', slot: 'passive', god: 'none',
    values: { radius: 190, stacks: 2 },
    desc: (v) => `소환수가 터지면 반경 ${Math.round(v.radius)} 안의 다른 소환수도 함께 터진다. 폭발이 감전을 남긴다.`,
    apply: (L, v) => {
      L.on.minionDeath.push((c) => {
        const r2 = v.radius * v.radius;
        for (const m of c.minions()) {
          if (m === c.minion || m.dead || m.life <= 0.02) continue;
          const dx = m.x - c.x, dy = m.y - c.y;
          if (dx * dx + dy * dy <= r2) m.life = 0.01;   // 다음 틱에 스러지며 함께 터진다
        }
        c.forEachEnemyInRange(c.x, c.y, v.radius, (e) => c.applyStatus(e, 'shock', Math.round(v.stacks)));
      });
    },
  },
  {
    id: 'duo_plaguebloom', gods: ['blood'], requires: ['necro_plague'],
    reqText: '역병 + 피 계열',
    name: '역병의 피', slot: 'passive', god: 'none',
    values: { heal: 9 },
    desc: (v) => `화상과 출혈이 모두 걸린 적이 죽으면 그 자리에서 망령이 일어나고 체력 ${Math.round(v.heal)}를 회복한다.`,
    apply: (L, v) => {
      L.on.kill.push((c) => {
        const st = c.target.status;
        if (!st?.burn || !st?.bleed) return;
        c.summon('wraith', c.x, c.y);
        c.heal(v.heal);
      });
    },
  },
);

export const DUO_BY_ID = Object.fromEntries(DUO_BOONS.map((b) => [b.id, b]));
export const ALL_BOONS = [...BOONS, ...WEAPON_BOONS, ...DUO_BOONS];
export const ANY_BOON_BY_ID = Object.fromEntries(ALL_BOONS.map((b) => [b.id, b]));

/**
 * 레벨/희귀도가 반영된 실제 수치 계산.
 * caps 에 상한이 지정된 키는 그 값을 넘지 않는다 —
 * 확률(0~1)이나 감소율이 스케일링으로 100%를 넘어 의미를 잃는 것을 막는다.
 */
export function scaleValues(boon, rarityMult, level) {
  const out = {};
  const lvMult = 1 + 0.32 * (level - 1);
  const caps = boon.caps || {};
  for (const [k, base] of Object.entries(boon.values || {})) {
    const v = base * rarityMult * lvMult;
    out[k] = caps[k] != null ? Math.min(caps[k], v) : v;
  }
  return out;
}
