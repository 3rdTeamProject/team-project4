'use strict';
// PC 레이아웃(1024px 이상)에서만 쓰는 배치 코드. 바깥 페이지(Home.jsx)가 같은 농장 화면을 둘 띄운다.
//  - scene: 가운데 농장 장면. 장면 말고 다른 화면으로 가는 요청은 오른쪽 패널로 넘긴다.
//  - panel: 오른쪽 패널. 오늘 할 일 / 전체 농장 / 칸 상세 등 기존 화면을 그대로 보여 준다.
// 화면 그리는 코드와 기능 로직은 그대로 두고, 화면 전환 요청만 바깥으로 전달한다.
(() => {
  const role = window.GARDEN_ROLE;
  if (!role || parent === window) return;
  const post = message => parent.postMessage(message, location.origin);

  const baseRender = render;
  const baseNavigate = navigate;
  const baseMoveDay = moveDay;

  // ---------- 공통: 지금 화면 이름을 표시해 둔다(CSS가 패널 첫 화면의 뒤로가기를 숨길 때 쓴다)
  let lastView = '';
  function afterRender() {
    app.dataset.view = view;
    if (role === 'panel' && lastView !== view) {
      lastView = view;
      post({ type: 'garden:pc-view', view });
    }
  }

  if (role === 'scene') {
    // ---------- 가운데: 농장 장면만 보여 주고, 다른 화면 요청은 패널로 보낸다
    navigate = function (next) {
      if (next === 'garden') return baseNavigate(next);
      post({ type: 'garden:pc-open', view: next, selected, plotIndex, pendingPlot });
    };

    // 해·달·구름은 가운데 칸(430px) 안에 두고, 하늘 바탕과 효과(비·눈·별)는 화면 전체 너비로 둔다
    function wrapSky() {
      const sky = app.querySelector('.sky');
      if (!sky || sky.querySelector('.sky-stage')) return;
      const items = [...sky.querySelectorAll(':scope > .sun, :scope > .moon, :scope > .cloud')];
      if (!items.length) return;
      const stage = document.createElement('div');
      stage.className = 'sky-stage';
      sky.insertBefore(stage, items[0]);
      stage.append(...items);
    }

    // 울타리는 그림 한 조각의 너비가 정해져 있어서, 화면이 넓으면 조각을 더 이어 붙여 끝까지 채운다
    function fillFence() {
      const fence = app.querySelector('.fence');
      if (!fence || !fence.firstElementChild) return;
      const tile = fence.firstElementChild.getBoundingClientRect().width || 1;
      const need = Math.ceil(window.innerWidth / tile) + 1;
      while (fence.children.length < need) fence.append(fence.firstElementChild.cloneNode(true));
    }
    window.addEventListener('resize', fillFence);

    // ---------- 개발용 날짜·날씨: 왼쪽 메뉴가 그릴 수 있게 현재 값을 바깥으로 보낸다
    let lastDev = '';
    function reportDev() {
      const payload = JSON.stringify(dev.enabled ? {
        enabled: true,
        today: day(),
        offset: dev.offset,
        steps: DEV_DAY_STEPS,
        weather: DEV_WEATHER.map((w, i) => ({ label: w.label, on: (() => {
          const now = GardenWeather.getOverride();
          return w.o ? !!now && now.code === w.o.code && now.isDay === w.o.isDay : !now;
        })() })),
      } : { enabled: false });
      if (payload === lastDev) return;
      lastDev = payload;
      post({ type: 'garden:dev', dev: JSON.parse(payload) });
    }

    // 농장이 하나도 없으면 흐린 빈 텃밭을 보여 준다. 밭이나 버튼을 누르면 오른쪽 패널에 '내 농장'(첫 농장 만들기) 화면이 열린다
    farmsPage = function () {
      const plots = Array.from({ length: 6 }, () => `<button class="plot" data-action="nav" data-to="farms" aria-label="내 농장 만들기">${terrainPart('bed')}</button>`).join('');
      return `<div class="garden-top"></div>${skyScene()}<main class="garden-field"><div class="terrain-grass-layer">${terrainPart('grass')}</div><div class="fence" aria-hidden="true">${terrainPart('fence')}${terrainPart('fence')}${terrainPart('fence')}</div><div class="plots pc-empty-plots">${plots}</div><button class="pc-empty-hint" data-action="nav" data-to="farms">＋ 내 농장 만들기</button></main>`;
    };

    render = function () {
      baseRender();
      wrapSky();
      fillFence();
      afterRender();
      reportDev();
    };

    // 날짜를 옮기면 패널의 할 일도 달라지므로 바깥에 알린다
    moveDay = async function (b) {
      await baseMoveDay(b);
      post({ type: 'garden:pc-changed' });
    };

    window.addEventListener('message', async event => {
      if (event.origin !== location.origin || event.source !== parent) return;
      const m = event.data;
      if (m?.type === 'garden:pc-refresh') refreshFromServer();
      else if (m?.type === 'garden:pc-select') {
        const changed = m.selected !== selected;
        const show = async () => {
          selected = m.selected;
          if (!current()) await refreshFromServer();
          navigate('garden');
        };
        // 다른 농장을 고르면 모바일처럼 구름으로 덮은 뒤 바꾼다(구름은 바깥 페이지가 가운데 영역 위에 그린다)
        if (changed && window.enterWithClouds) await window.enterWithClouds(show);
        else await show();
      } else if (m?.type === 'garden:pc-dev') {
        if (m.kind === 'day') moveDay({ dataset: m.set !== undefined ? { set: String(m.set) } : { add: String(m.add) } });
        else if (m.kind === 'weather' && DEV_WEATHER[m.i]) { GardenWeather.setOverride(DEV_WEATHER[m.i].o); render(); }
      }
    });
  } else {
    // ---------- 오른쪽 패널: 농장 장면(garden)으로 돌아가는 요청은 가운데 장면에 알리고, 패널은 처음 화면으로 둔다
    navigate = function (next) {
      if (next !== 'garden') return baseNavigate(next);
      post({ type: 'garden:pc-select', selected });
      // 재배일지 화면(/journals)의 패널은 일지로, 그 밖에는 처음 화면(전체 농장이면 그대로, 아니면 오늘 할 일)으로 돌아간다
      baseNavigate(window.GARDEN_VIEW === 'journal' ? 'journal' : view === 'farms' ? 'farms' : 'tasks');
    };

    render = function () {
      baseRender();
      afterRender();
    };

    // 가운데 장면에서 누른 칸·농장 정보를 현재 화면에 반영한다(패널을 처음 열 때와 이미 열려 있을 때 모두 쓴다)
    function applyShow(m) {
      if (m.selected !== undefined) selected = m.selected;
      if (m.plotIndex !== undefined) plotIndex = m.plotIndex;
      if (m.pendingPlot !== undefined) pendingPlot = m.pendingPlot;
      if (m.view === 'select') plantingDraft = { checks: [], photos: [], memo: '' };
    }
    if (window.GARDEN_SHOW) applyShow(window.GARDEN_SHOW);

    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== parent) return;
      const m = event.data;
      if (m?.type === 'garden:pc-refresh') refreshFromServer();
      else if (m?.type === 'garden:pc-show') {
        applyShow(m);
        view = 'garden'; // 다른 화면 코드가 "농장 장면에서 왔다"고 보고 처리하는 부분(할 일 모아보기의 뒤로가기 등)을 그대로 쓰기 위해
        baseNavigate(m.view);
      }
    });
  }

  render();
})();
