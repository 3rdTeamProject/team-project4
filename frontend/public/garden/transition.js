'use strict';
// 농장 카드를 눌러 작물 6칸 화면(garden)으로 들어갈 때와 그 화면에서 농장을 바꿀 때만 구름 전환을 쓴다(칸 상세에서 돌아오기 등은 제외).
// 구름은 바깥 페이지가 그린다: 덮어 달라고 요청 → 덮였다는 답을 받으면 화면을 바꾸고 데이터를 불러옴 → 준비되면 열어 달라고 요청.
(() => {
  if (parent === window) return;
  const MIN_CLOSED_MS = 200;    // 덮인 뒤 최소로 유지하는 시간
  const MAX_WAIT_MS = 4000;     // 데이터가 늦어도 이만큼만 기다렸다가 연다
  const COVER_REPLY_MS = 1000;  // 바깥이 답하지 않으면 구름 없이 그냥 이동한다
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function waitForParent(type, ms) {
    return new Promise(resolve => {
      const done = ok => { clearTimeout(timer); removeEventListener('message', onMessage); resolve(ok); };
      const onMessage = event => {
        if (event.origin === location.origin && event.source === parent && event.data?.type === type) done(true);
      };
      const timer = setTimeout(() => done(false), ms);
      addEventListener('message', onMessage);
    });
  }

  async function until(isDone, ms) {
    const end = Date.now() + ms;
    while (!isDone() && Date.now() < end) await delay(50);
  }

  // 이 화면이 처음 그려질 때 필요한 서버·외부 데이터: 오늘 할 일과 날씨
  async function loadFarmData() {
    const farm = current();
    const weather = farm ? GardenWeather.load(farm).catch(() => {}) : Promise.resolve();
    const hasTaskCrops = () => state.farms.some(f => f.plots.some(p => p && isTaskPlant(p)));
    const tasks = until(() => !hasTaskCrops() || (taskData.status !== 'idle' && !taskData.loading), MAX_WAIT_MS);
    await Promise.all([weather, tasks]);
  }

  async function enterWithClouds(go) {
    parent.postMessage({ type: 'garden:cloud-close' }, location.origin);
    const covered = await waitForParent('garden:cloud-closed', COVER_REPLY_MS);
    try {
      go('garden');  // 덮인 뒤에 화면(또는 농장)을 바꾼다
      if (!covered) return;
      const coveredAt = Date.now();
      await Promise.race([loadFarmData(), delay(MAX_WAIT_MS)]);
      await delay(Math.max(0, MIN_CLOSED_MS - (Date.now() - coveredAt)));
    } finally {
      parent.postMessage({ type: 'garden:cloud-open' }, location.origin);  // 어떤 경우에도 열어서 화면이 덮인 채 남지 않게 한다
    }
  }

  const baseNavigate = navigate;
  let entering = false;
  navigate = function (next) {
    if (next !== 'garden' || view !== 'farms' || entering) return baseNavigate(next);
    entering = true;
    enterWithClouds(baseNavigate).finally(() => { entering = false; });
  };

  // 6칸 화면 위쪽의 농장 선택 목록(.farm-options)에서 다른 농장을 고를 때도 같은 구름을 쓴다.
  // 원래 처리(app.js)보다 먼저 받아서 막고, 구름이 덮인 뒤에 대신 농장을 바꾼다. 지금 농장을 다시 고르면 원래대로 둔다.
  document.querySelector('#app').addEventListener('click', event => {
    const button = event.target.closest('.farm-options [data-action="farm"]');
    if (!button || view !== 'garden' || entering || button.dataset.id === selected) return;
    event.stopPropagation();
    const farmId = button.dataset.id;
    entering = true;
    enterWithClouds(() => { selected = farmId; baseNavigate('garden'); }).finally(() => { entering = false; });
  }, true);
})();
