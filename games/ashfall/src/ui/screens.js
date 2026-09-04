// ============================================================
// DOM 오버레이 UI.
//
// 모든 화면은 같은 3단 구조(sheet)를 쓴다:
//   header(제목/탭) · body(스크롤 가능한 본문) · footer(주 행동 버튼)
// 이 구조 덕분에 어떤 뷰포트에서도 "다음에 눌러야 할 버튼"이 항상 화면 안에 있다.
// 스크롤은 body 안에서만 일어나고 페이지 자체는 스크롤되지 않는다.
//
// 화면은 game 컨트롤러의 메서드만 호출한다 (sim 을 직접 만지지 않음).
// ============================================================

import { WEAPONS } from '../data/weapons.js';
import { RARITY, META, SHOP, TOUCH_DEFAULTS } from '../data/balance.js';
import { GODS, SLOT_NAMES, ANY_BOON_BY_ID } from '../data/boons.js';
import { upgradeCost } from '../core/save.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function createScreens(overlay, game) {
  let current = null;

  /**
   * 화면을 그린다.
   * @param {string} name 화면 id
   * @param {{title?, sub?, tabs?, body, actions}} parts
   */
  function show(name, parts, wire) {
    current = name;
    overlay.innerHTML = `
      <div class="sheet">
        <header>
          ${parts.title ? `<h1>${parts.title}</h1>` : ''}
          ${parts.sub ? `<p class="sub">${parts.sub}</p>` : ''}
          ${parts.tabs || ''}
        </header>
        <div class="body">${parts.body}</div>
        <footer>${parts.actions}</footer>
      </div>`;
    overlay.classList.add('active');
    overlay.dataset.screen = name;
    if (wire) wire(overlay);
  }

  function hide() {
    current = null;
    overlay.classList.remove('active');
    overlay.innerHTML = '';
    overlay.dataset.screen = '';
  }

  // ============================================================
  // 타이틀 — 무기 / 영구 강화 / 조작 을 탭으로 나눈다.
  // 탭 덕분에 본문 높이가 화면에 종속되지 않고, 시작 버튼은 항상 아래 고정.
  // ============================================================
  let titleTab = 'weapon';

  function title() {
    const save = game.save;
    let weaponId = WEAPONS.some((w) => w.id === save.lastWeapon) ? save.lastWeapon : WEAPONS[0].id;

    const render = () => {
      const st = save.stats;
      const tabs = `
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="weapon"  aria-selected="${titleTab === 'weapon'}">무기</button>
          <button class="tab" role="tab" data-tab="meta"    aria-selected="${titleTab === 'meta'}">영구 강화</button>
          <button class="tab" role="tab" data-tab="howto"   aria-selected="${titleTab === 'howto'}">조작</button>
        </div>`;

      let body = '';
      let actions = '';

      if (titleTab === 'weapon') {
        const w = WEAPONS.find((x) => x.id === weaponId) || WEAPONS[0];
        const detail = `
          <div class="detail" style="--c:${w.color}">
            <div class="dname">${esc(w.name)}</div>
            <div class="dtag">${esc(w.tagline)}</div>
            <ul>${(w.traits || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            <div class="dsp"><b>특수기 · ${esc(w.special.name)}</b><br>${esc(w.special.desc)}</div>
          </div>`;
        // 무기가 하나뿐이면 목록은 선택지가 아니라 잡음이다 — 정보만 보여준다
        body = WEAPONS.length > 1 ? `
          <div class="pick">
            <div class="picklist" role="listbox">
              ${WEAPONS.map((it) => `
                <button class="pickitem" role="option" data-weapon="${it.id}"
                        aria-selected="${it.id === weaponId}" style="--c:${it.color}">
                  <span class="pn">${esc(it.name)}</span>
                  <span class="chk">✓</span>
                </button>`).join('')}
            </div>
            ${detail}
          </div>` : detail;
        actions = `
          <span class="note">${WEAPONS.length > 1 ? esc(w.name) + ' 선택됨' : esc(w.name)}</span>
          <span class="spacer"></span>
          <button class="btn primary" id="startBtn">회랑으로 들어간다</button>`;
      } else if (titleTab === 'meta') {
        body = `
          <div class="ashline">보유 잿가루 <b>${save.ash}</b></div>
          <div class="upgrades">
            ${META.UPGRADES.map((u) => {
              const lv = save.upgrades[u.id] || 0;
              const cost = upgradeCost(save, u);
              const maxed = cost == null;
              return `
              <button class="upg ${maxed ? 'maxed' : ''} ${!maxed && save.ash < cost ? 'poor' : ''}"
                      data-upg="${u.id}" ${maxed ? 'disabled' : ''}>
                <span class="un">${esc(u.name)}<i>${lv}/${u.max}</i></span>
                <span class="uc">${maxed ? '최대' : '잿가루 ' + cost}</span>
                <span class="ud">${esc(u.desc)}</span>
              </button>`;
            }).join('')}
          </div>
          <h3>기록</h3>
          <p class="hint">도전 ${st.runs}회 · 클리어 ${st.wins}회 · 최고 도달 ${esc(st.deepest)}${st.bestTime ? ` · 최단 클리어 ${fmtTime(st.bestTime)}` : ''}</p>`;
        actions = `
          <button class="btn ghost" id="resetBtn">기록 초기화</button>
          <span class="spacer"></span>
          <button class="btn primary" id="startBtn">회랑으로 들어간다</button>`;
      } else {
        body = `
          <h3>키보드 · 마우스</h3>
          <div class="keys">
            <div class="keyrow"><span>이동</span><kbd>W A S D</kbd></div>
            <div class="keyrow"><span>조준</span><kbd>마우스</kbd></div>
            <div class="keyrow"><span>공격</span><kbd>좌클릭 / J</kbd></div>
            <div class="keyrow"><span>특수기</span><kbd>우클릭 / K</kbd></div>
            <div class="keyrow"><span>대시</span><kbd>Space</kbd></div>
            <div class="keyrow"><span>소환수 명령</span><kbd>F</kbd></div>
            <div class="keyrow"><span>일시정지</span><kbd>Esc</kbd></div>
          </div>
          <h3>터치 (모바일)</h3>
          <div class="keys">
            <div class="keyrow"><span>이동</span><kbd>왼쪽 화면 드래그</kbd></div>
            <div class="keyrow"><span>조준 + 공격</span><kbd>오른쪽 화면 드래그</kbd></div>
            <div class="keyrow"><span>대시 · 특수기 · 명령</span><kbd>우측 버튼</kbd></div>
          </div>
          <h3>알아두면 좋은 것</h3>
          <p class="hint">
            · 적의 모든 공격은 <b>예고</b> 후에 나간다. 예고를 보고 대시로 피할 수 있다.<br>
            · 후딜은 대시로 끊을 수 있다. 회피와 공격은 대립하지 않는다.<br>
            · 문 위 아이콘이 그 방의 보상이다. 무엇을 가져갈지 먼저 고른다.<br>
            · 무쇠 방벽은 정면 피해를 막는다. 돌아서 등을 쳐야 한다.
          </p>`;
        actions = `
          <button class="btn ghost" id="touchSet">터치 감도</button>
          <span class="spacer"></span>
          <button class="btn primary" id="startBtn">회랑으로 들어간다</button>`;
      }

      show('title', { title: '잿불의 회랑', sub: '핵앤슬래시 로그라이크 · 한 판 10~20분', tabs, body, actions }, (root) => {
        root.querySelectorAll('[data-tab]').forEach((b) =>
          b.addEventListener('click', () => { titleTab = b.dataset.tab; game.sfx.ui(); render(); }));
        root.querySelectorAll('[data-weapon]').forEach((b) =>
          b.addEventListener('click', () => { weaponId = b.dataset.weapon; game.sfx.ui(); render(); }));
        root.querySelectorAll('[data-upg]').forEach((b) =>
          b.addEventListener('click', () => { if (game.buyUpgrade(b.dataset.upg)) render(); }));
        const reset = root.querySelector('#resetBtn');
        if (reset) reset.addEventListener('click', () => {
          if (confirm('영구 강화와 기록을 모두 지웁니다. 계속할까요?')) { game.resetSave(); render(); }
        });
        const ts = root.querySelector('#touchSet');
        if (ts) ts.addEventListener('click', () => { hide(); settings(() => { titleTab = 'howto'; render(); }); });
        root.querySelector('#startBtn').addEventListener('click', () => { hide(); game.startRun(weaponId); });
      });
    };
    render();
  }

  // ============================================================
  // 터치 감도 설정
  //
  // 손 크기·그립·기기는 사람마다 다르다. 기본값은 정답이 아니므로
  // 플레이해 보고 바로 고칠 수 있어야 한다. 일시정지에서도 열 수 있다.
  // ============================================================
  const TOUCH_FIELDS = [
    { key: 'stickRadius', name: '스틱 반경', min: 30, max: 110, step: 2, unit: 'px',
      desc: '엄지를 최대로 꺾는 거리. 작을수록 조금만 움직여도 최대 속도가 난다.' },
    { key: 'stickDead', name: '데드존', min: 0, max: 20, step: 1, unit: 'px',
      desc: '이 거리 안의 움직임은 무시한다. 손이 떨려서 캐릭터가 흔들리면 올린다.' },
    { key: 'aimAssist', name: '조준 보정', min: 0, max: 1, step: 0.05, unit: '%', pct: true,
      desc: '조준 방향이 적을 거의 향하면 그쪽으로 끌어당긴다. 0이면 보정 없음.' },
    { key: 'assistCone', name: '보정 범위', min: 0, max: 90, step: 5, unit: '°',
      desc: '이 각도 안의 적에게만 보정이 걸린다. 넓히면 편하지만 원하는 적을 못 고를 수 있다.' },
    { key: 'buttonScale', name: '버튼 크기', min: 0.7, max: 1.6, step: 0.05, unit: '×',
      desc: '대시·특수기·명령 버튼의 크기.' },
  ];
  const TOUCH_TOGGLES = [
    { key: 'slidingStick', name: '따라오는 스틱', desc: '엄지가 반경을 넘으면 스틱 원점이 따라온다. 끄면 원점이 고정된다.' },
    { key: 'tapToAttack', name: '톡 쳐서 공격', desc: '오른쪽 화면을 짧게 치면 가장 가까운 적을 공격한다.' },
    { key: 'leftHanded', name: '왼손잡이 배치', desc: '이동/조준과 버튼 위치를 좌우로 뒤집는다.' },
    { key: 'haptics', name: '진동 피드백', desc: '버튼을 누를 때 진동한다. (지원 기기 한정)' },
  ];

  function settings(onBack) {
    const render = () => {
      const t = game.save.touch;
      const sliders = TOUCH_FIELDS.map((f) => {
        const v = t[f.key];
        const shown = f.pct ? `${Math.round(v * 100)}%` : `${Math.round(v * 100) / 100}${f.unit}`;
        return `
        <div class="setrow">
          <div class="sl"><span class="sname">${esc(f.name)}</span><span class="sval" data-val="${f.key}">${shown}</span></div>
          <input type="range" data-set="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}">
          <div class="sdesc">${esc(f.desc)}</div>
        </div>`;
      }).join('');
      const toggles = TOUCH_TOGGLES.map((f) => `
        <button class="toggle" data-toggle="${f.key}" aria-pressed="${!!t[f.key]}">
          <span><span class="tname">${esc(f.name)}</span><br><span class="tdesc">${esc(f.desc)}</span></span>
          <span class="sw"></span>
        </button>`).join('');

      show('settings', {
        title: '터치 감도',
        sub: '플레이해 보고 맞지 않으면 바로 고친다',
        body: `<div class="settings">${sliders}${toggles}</div>`,
        actions: `
          <button class="btn ghost" id="resetTouch">기본값</button>
          <span class="spacer"></span>
          <button class="btn primary" id="doneTouch">완료</button>`,
      }, (root) => {
        root.querySelectorAll('[data-set]').forEach((el) => {
          el.addEventListener('input', () => {
            const f = TOUCH_FIELDS.find((x) => x.key === el.dataset.set);
            const v = parseFloat(el.value);
            game.setTouch(f.key, v);
            const out = root.querySelector(`[data-val="${f.key}"]`);
            if (out) out.textContent = f.pct ? `${Math.round(v * 100)}%` : `${Math.round(v * 100) / 100}${f.unit}`;
          });
        });
        root.querySelectorAll('[data-toggle]').forEach((el) => {
          el.addEventListener('click', () => {
            const k = el.dataset.toggle;
            const nv = !game.save.touch[k];
            game.setTouch(k, nv);
            el.setAttribute('aria-pressed', String(nv));
            game.sfx.ui();
          });
        });
        root.querySelector('#resetTouch').addEventListener('click', () => { game.resetTouch(); render(); });
        root.querySelector('#doneTouch').addEventListener('click', () => { hide(); onBack(); });
      });
    };
    render();
  }

  // ============================================================
  // 권능 선택
  // ============================================================
  function reward(options, kindLabel) {
    const cards = options.map((o, i) => {
      const god = GODS[o.god] || GODS.none;
      const rc = RARITY[o.rarity]?.color || '#fff';
      return `
      <button class="card boon" data-i="${i}" style="--c:${o.duo ? '#ffc94d' : god.color}">
        <div class="btop">
          <span class="god">${o.duo ? '합일 권능' : esc(god.name)}</span>
          <span>${esc(SLOT_NAMES[o.slot] || '')}</span>
        </div>
        <div class="bname">${esc(o.title)}${o.level > 1 ? ` <i>Lv.${o.level}</i>` : ''}</div>
        <div class="brar" style="color:${rc}">${RARITY[o.rarity]?.name || ''}</div>
        <div class="bdesc">${esc(o.text)}</div>
        ${o.prevText ? `<div class="bprev">이전: ${esc(o.prevText)}</div>` : ''}
      </button>`;
    }).join('');

    show('reward', {
      title: esc(kindLabel || '권능을 선택하라'),
      body: `<div class="cards">${cards}</div>`,
      actions: `<span class="note">하나를 고르면 즉시 적용된다</span><span class="spacer"></span>`,
    }, (root) => {
      root.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => { hide(); game.chooseReward(+b.dataset.i); }));
    });
  }

  // ============================================================
  // 저주 선택
  // ============================================================
  function curse(options) {
    const cards = options.map((c, i) => `
      <button class="card curse" data-i="${i}" style="--c:#ff4d6d">
        <div class="bname">${esc(c.name)}</div>
        <div class="bdesc">${esc(c.desc)}</div>
        <div class="bgain">대가: 보상 희귀도 상승</div>
      </button>`).join('');

    show('curse', {
      title: '엘리트의 문',
      sub: '저주를 하나 짊어져라 — 남은 런 전체에 적용된다',
      body: `<div class="cards">${cards}</div>`,
      actions: `<span class="note">더 위험한 대신 더 좋은 권능이 나온다</span><span class="spacer"></span>`,
    }, (root) => {
      root.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => { hide(); game.chooseCurse(+b.dataset.i); }));
    });
  }

  // ============================================================
  // 상점
  // ============================================================
  function shop(items, gold) {
    const rows = items.map((it, i) => `
      <button class="shopitem ${it.sold ? 'sold' : ''} ${gold < it.cost ? 'poor' : ''}"
              data-i="${i}" ${it.sold ? 'disabled' : ''}>
        <span class="sname">${esc(it.name)}</span>
        <span class="scost">${it.sold ? '판매됨' : '◈ ' + it.cost}</span>
        <span class="sdesc">${esc(it.desc)}</span>
      </button>`).join('');

    show('shop', {
      title: '떠돌이 상인',
      sub: `보유 ◈ ${gold}`,
      body: `<div class="shoplist">${rows}</div>`,
      actions: `
        <button class="btn ghost" id="reroll">새로고침 ◈${SHOP.REROLL_COST}</button>
        <span class="spacer"></span>
        <button class="btn primary" id="leave">떠난다</button>`,
    }, (root) => {
      root.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => game.buyShop(+b.dataset.i)));
      root.querySelector('#reroll').addEventListener('click', () => game.rerollShop());
      root.querySelector('#leave').addEventListener('click', () => { hide(); game.leaveShop(); });
    });
  }

  // ============================================================
  // 결과
  // ============================================================
  function result(win, summary) {
    const boons = summary.owned.map((o) => {
      const def = ANY_BOON_BY_ID[o.id];
      const rc = RARITY[o.rarity]?.color || '#fff';
      return `<li style="color:${rc}">${esc(def ? def.name : o.id)}${o.level > 1 ? ` +${o.level - 1}` : ''}</li>`;
    }).join('') || '<li class="muted">획득한 권능 없음</li>';

    show('result', {
      title: win ? '회랑을 돌파했다' : '재가 되어 스러졌다',
      sub: `${esc(summary.place)} · ${fmtTime(summary.time)} · 처치 ${summary.kills}`,
      body: `
        <div class="resgrid">
          <div><b>무기</b><span>${esc(summary.weapon)}</span></div>
          <div><b>받은 피해</b><span>${Math.round(summary.damageTaken)}</span></div>
          <div><b>저주</b><span>${summary.curses || '없음'}</span></div>
          <div><b>획득 잿가루</b><span class="ash">+${summary.ash}</span></div>
        </div>
        <h3>이번 런의 빌드</h3>
        <ul class="boonlist">${boons}</ul>`,
      actions: `
        <button class="btn ghost" id="home">메인으로</button>
        <span class="spacer"></span>
        <button class="btn primary" id="again">다시 도전</button>`,
    }, (root) => {
      root.querySelector('#again').addEventListener('click', () => { hide(); game.startRun(game.save.lastWeapon); });
      root.querySelector('#home').addEventListener('click', () => { hide(); title(); });
    });
  }

  // ============================================================
  // 일시정지
  // ============================================================
  function pause(noteHtml) {
    show('pause', {
      title: '일시정지',
      body: noteHtml || '',
      actions: `
        <button class="btn ghost" id="quit">런 포기</button>
        <button class="btn ghost" id="pauseSet">터치 감도</button>
        <span class="spacer"></span>
        <button class="btn primary" id="resume">계속하기</button>`,
    }, (root) => {
      root.querySelector('#resume').addEventListener('click', () => { hide(); game.resume(); });
      root.querySelector('#quit').addEventListener('click', () => { hide(); game.abandon(); });
      // 플레이 중에 바로 감도를 고치고 돌아올 수 있어야 한다
      root.querySelector('#pauseSet').addEventListener('click', () => { hide(); settings(() => pause(noteHtml)); });
    });
  }

  return { title, reward, curse, shop, result, pause, settings, hide, get current() { return current; } };
}
