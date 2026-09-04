// ============================================================
// DOM 오버레이 UI. 캔버스는 "게임 월드", DOM 은 "선택과 정보".
// 모든 화면은 game 컨트롤러의 메서드만 호출한다 (sim 을 직접 만지지 않음).
// ============================================================

import { WEAPONS } from '../data/weapons.js';
import { RARITY, META, SHOP, CURSES, RUN } from '../data/balance.js';
import { GODS, SLOT_NAMES, ANY_BOON_BY_ID } from '../data/boons.js';
import { upgradeCost } from '../core/save.js';

export function createScreens(overlay, game) {
  let current = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function show(name, html, wire) {
    current = name;
    overlay.innerHTML = html;
    overlay.classList.add('active');
    overlay.dataset.screen = name;
    if (wire) wire(overlay);
    overlay.querySelectorAll('[data-sfx]').forEach((el) =>
      el.addEventListener('mouseenter', () => game.sfx.ui()));
  }

  function hide() {
    current = null;
    overlay.classList.remove('active');
    overlay.innerHTML = '';
    overlay.dataset.screen = '';
  }

  // ---------------- 타이틀 / 무기 선택 / 메타 강화 ----------------
  function title() {
    const save = game.save;
    const st = save.stats;
    const weapons = WEAPONS.map((w, i) => `
      <button class="card weapon ${i === 0 ? 'sel' : ''}" data-weapon="${w.id}" data-sfx style="--c:${w.color}">
        <div class="wname">${esc(w.name)}</div>
        <div class="wtag">${esc(w.tagline)}</div>
        <ul class="wtraits">${(w.traits || []).map((tr) => `<li>${esc(tr)}</li>`).join('')}</ul>
        <div class="wsp"><b>특수기 · ${esc(w.special.name)}</b><br>${esc(w.special.desc)}</div>
      </button>`).join('');

    const ups = META.UPGRADES.map((u) => {
      const lv = save.upgrades[u.id] || 0;
      const cost = upgradeCost(save, u);
      const maxed = cost == null;
      return `
      <button class="upg ${maxed ? 'maxed' : ''} ${!maxed && save.ash < cost ? 'poor' : ''}" data-upg="${u.id}" ${maxed ? 'disabled' : ''} data-sfx>
        <span class="un">${esc(u.name)} <i>${lv}/${u.max}</i></span>
        <span class="ud">${esc(u.desc)}</span>
        <span class="uc">${maxed ? '최대' : '잿가루 ' + cost}</span>
      </button>`;
    }).join('');

    show('title', `
      <div class="screen title-screen">
        <div class="title-main">
          <h1>잿불의 회랑</h1>
          <p class="sub">핵앤슬래시 로그라이크 · 한 판 10~20분</p>

          <h2>무기 선택</h2>
          <div class="cards weapons">${weapons}</div>

          <button class="primary" id="startBtn" data-sfx>회랑으로 들어간다</button>

          <div class="controls">
            <b>조작</b> — 이동 <kbd>WASD</kbd> · 조준 <kbd>마우스</kbd> · 공격 <kbd>좌클릭</kbd>/<kbd>J</kbd> ·
            특수기 <kbd>우클릭</kbd>/<kbd>K</kbd> · 대시 <kbd>Space</kbd> · 일시정지 <kbd>Esc</kbd>
          </div>
        </div>
        <aside class="meta">
          <h2>영구 강화</h2>
          <div class="ash">보유 잿가루 <b>${save.ash}</b></div>
          <div class="upgrades">${ups}</div>
          <div class="stats">
            도전 ${st.runs}회 · 클리어 ${st.wins}회 · 최고 도달 ${esc(st.deepest)}
            ${st.bestTime ? ` · 최단 클리어 ${fmtTime(st.bestTime)}` : ''}
          </div>
          <button class="ghost" id="resetBtn" data-sfx>기록 초기화</button>
        </aside>
      </div>`, (root) => {
      let weaponId = save.lastWeapon || WEAPONS[0].id;
      const mark = () => root.querySelectorAll('[data-weapon]').forEach((b) =>
        b.classList.toggle('sel', b.dataset.weapon === weaponId));
      mark();
      root.querySelectorAll('[data-weapon]').forEach((b) =>
        b.addEventListener('click', () => { weaponId = b.dataset.weapon; game.sfx.ui(); mark(); }));
      root.querySelector('#startBtn').addEventListener('click', () => { hide(); game.startRun(weaponId); });
      root.querySelectorAll('[data-upg]').forEach((b) =>
        b.addEventListener('click', () => { if (game.buyUpgrade(b.dataset.upg)) title(); }));
      root.querySelector('#resetBtn').addEventListener('click', () => {
        if (confirm('영구 강화와 기록을 모두 지웁니다. 계속할까요?')) { game.resetSave(); title(); }
      });
    });
  }

  // ---------------- 권능 선택 ----------------
  function reward(options, kindLabel) {
    const cards = options.map((o, i) => {
      const god = GODS[o.god] || GODS.none;
      const rc = RARITY[o.rarity]?.color || '#fff';
      return `
      <button class="card boon" data-i="${i}" data-sfx style="--c:${o.duo ? '#ffc94d' : god.color};--r:${rc}">
        <div class="btop">
          <span class="god">${o.duo ? '합일 권능' : esc(god.name)}</span>
          <span class="slot">${esc(SLOT_NAMES[o.slot] || '')}</span>
        </div>
        <div class="bname">${esc(o.title)}${o.level > 1 ? ` <i>Lv.${o.level}</i>` : ''}</div>
        <div class="brar" style="color:${rc}">${RARITY[o.rarity]?.name || ''}</div>
        <div class="bdesc">${esc(o.text)}</div>
        ${o.prevText ? `<div class="bprev">이전: ${esc(o.prevText)}</div>` : ''}
      </button>`;
    }).join('');
    show('reward', `
      <div class="screen choose">
        <h2>${esc(kindLabel || '권능을 선택하라')}</h2>
        <div class="cards">${cards}</div>
      </div>`, (root) => {
      root.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => { hide(); game.chooseReward(+b.dataset.i); }));
    });
  }

  // ---------------- 저주 선택 ----------------
  function curse(options) {
    const cards = options.map((c, i) => `
      <button class="card curse" data-i="${i}" data-sfx>
        <div class="bname">${esc(c.name)}</div>
        <div class="bdesc">${esc(c.desc)}</div>
        <div class="bgain">대가: 보상 희귀도 상승</div>
      </button>`).join('');
    show('curse', `
      <div class="screen choose">
        <h2>엘리트의 문 — 저주를 하나 짊어져라</h2>
        <p class="hint">저주는 남은 런 전체에 적용된다. 대신 더 좋은 권능이 나온다.</p>
        <div class="cards">${cards}</div>
      </div>`, (root) => {
      root.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => { hide(); game.chooseCurse(+b.dataset.i); }));
    });
  }

  // ---------------- 상점 ----------------
  function shop(items, gold) {
    const rows = items.map((it, i) => `
      <button class="shopitem ${it.sold ? 'sold' : ''} ${gold < it.cost ? 'poor' : ''}" data-i="${i}" ${it.sold ? 'disabled' : ''} data-sfx>
        <span class="sname">${esc(it.name)}</span>
        <span class="sdesc">${esc(it.desc)}</span>
        <span class="scost">${it.sold ? '판매됨' : '◈ ' + it.cost}</span>
      </button>`).join('');
    show('shop', `
      <div class="screen choose shop">
        <h2>떠돌이 상인</h2>
        <div class="gold">보유 ◈ ${gold}</div>
        <div class="shoplist">${rows}</div>
        <div class="row">
          <button class="ghost" id="reroll" data-sfx>목록 새로고침 (◈ ${SHOP.REROLL_COST})</button>
          <button class="primary" id="leave" data-sfx>떠난다</button>
        </div>
      </div>`, (root) => {
      root.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => game.buyShop(+b.dataset.i)));
      root.querySelector('#reroll').addEventListener('click', () => game.rerollShop());
      root.querySelector('#leave').addEventListener('click', () => { hide(); game.leaveShop(); });
    });
  }

  // ---------------- 결과 ----------------
  function result(win, summary) {
    const boons = summary.owned.map((o) => {
      const def = ANY_BOON_BY_ID[o.id];
      const rc = RARITY[o.rarity]?.color || '#fff';
      return `<li style="color:${rc}">${esc(def ? def.name : o.id)}${o.level > 1 ? ` +${o.level - 1}` : ''}</li>`;
    }).join('') || '<li class="muted">획득한 권능 없음</li>';

    show('result', `
      <div class="screen result ${win ? 'win' : 'lose'}">
        <h1>${win ? '회랑을 돌파했다' : '재가 되어 스러졌다'}</h1>
        <p class="sub">${esc(summary.place)} · ${fmtTime(summary.time)} · 처치 ${summary.kills}</p>
        <div class="resgrid">
          <div><b>무기</b><span>${esc(summary.weapon)}</span></div>
          <div><b>받은 피해</b><span>${Math.round(summary.damageTaken)}</span></div>
          <div><b>저주</b><span>${summary.curses || '없음'}</span></div>
          <div><b>획득 잿가루</b><span class="ash">+${summary.ash}</span></div>
        </div>
        <h3>이번 런의 빌드</h3>
        <ul class="boonlist">${boons}</ul>
        <div class="row">
          <button class="primary" id="again" data-sfx>다시 도전</button>
          <button class="ghost" id="home" data-sfx>메인으로</button>
        </div>
      </div>`, (root) => {
      root.querySelector('#again').addEventListener('click', () => { hide(); game.startRun(game.save.lastWeapon); });
      root.querySelector('#home').addEventListener('click', () => { hide(); title(); });
    });
  }

  // ---------------- 일시정지 ----------------
  function pause(summaryHtml) {
    show('pause', `
      <div class="screen choose pause">
        <h2>일시정지</h2>
        ${summaryHtml}
        <div class="row">
          <button class="primary" id="resume" data-sfx>계속하기</button>
          <button class="ghost" id="quit" data-sfx>런 포기</button>
        </div>
      </div>`, (root) => {
      root.querySelector('#resume').addEventListener('click', () => { hide(); game.resume(); });
      root.querySelector('#quit').addEventListener('click', () => { hide(); game.abandon(); });
    });
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  return { title, reward, curse, shop, result, pause, hide, get current() { return current; } };
}
