'use strict';
let initialized = false;
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const message = event.data;
  if (message?.type !== 'garden:init' || initialized) return;
  initialized = true;
  window.GARDEN_STORAGE_KEY = `woori-garden-user-${message.userId}`;
  window.GARDEN_VIEW = message.view;
  window.GARDEN_DEFER_RENDER = true;
  localStorage.setItem(window.GARDEN_STORAGE_KEY, JSON.stringify(message.state));
  const script = document.createElement('script');
  script.src = 'app.js';
  script.onload = () => {
    const features = document.createElement('script');
    features.src = 'features.js';
    // 작물별 할 일(서버 데이터)은 features.js 화면 위에 덧붙이므로 그 뒤에 불러온다
    features.onload = () => {
      const tasks = document.createElement('script');
      tasks.src = 'tasks.js';
      // 농장 카드를 눌러 6칸 화면으로 들어갈 때의 구름 전환은 화면·할 일 코드가 모두 올라온 뒤에 덧붙인다
      tasks.onload = () => {
        const transition = document.createElement('script');
        transition.src = 'transition.js';
        document.body.append(transition);
        window.GARDEN_DEFER_RENDER = false;
        render();
      };
      tasks.onerror = () => {
        window.GARDEN_DEFER_RENDER = false;
        render();
      };
      document.body.append(tasks);
    };
    features.onerror = () => {
      window.GARDEN_DEFER_RENDER = false;
      render();
    };
    document.body.append(features);
    const report = () => parent.postMessage({type:'garden:height',height:Math.ceil(document.querySelector(".phone-shell").getBoundingClientRect().height)}, location.origin);
    new ResizeObserver(report).observe(document.querySelector(".phone-shell"));
    report();
    hostFooter();
  };
  const imageBounds = document.createElement('script');
  imageBounds.src = 'crop-image-bounds.js';
  imageBounds.onload = imageBounds.onerror = () => document.body.append(script);
  document.body.append(imageBounds);
});
// 화면 아래 버튼(.footer)은 이 화면이 iframe이라 스크롤을 따라오지 못한다. 바깥 페이지가 하단 고정 막대로 대신 보여 주고,
// 눌렀을 때만 여기로 알려 준다. 버튼만 들어 있는 푸터만 옮기고, 글자나 입력이 섞인 푸터는 원래 자리에 둔다.
function hostFooter() {
  if (parent === window) return;
  const app = document.querySelector('#app');
  document.documentElement.classList.add('hosted');
  let last = '';
  let queued = false;
  function sync() {
    queued = false;
    const footer = app.querySelector('footer.footer');
    const hostable = !!footer && footer.children.length > 0 && [...footer.children].every(el => el.tagName === 'BUTTON');
    if (footer && !hostable) footer.dataset.own = '1';
    const buttons = hostable ? [...footer.children].map((el, index) => ({
      index, label: el.textContent.trim(), kind: el.classList.contains('primary') ? 'primary' : 'secondary', disabled: el.disabled,
    })) : [];
    const payload = JSON.stringify(buttons);
    if (payload === last) return;
    last = payload;
    parent.postMessage({ type: 'garden:footer', buttons }, location.origin);
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
  new MutationObserver(queue).observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class'] });
  queue();
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'garden:footer-click') return;
    app.querySelector('footer.footer')?.children[event.data.index]?.click();
  });
}

// 바깥 페이지가 아직 듣고 있지 않을 때를 대비해, 초기 데이터를 받을 때까지 준비 신호를 다시 보낸다
parent.postMessage({type:'garden:ready'}, location.origin);
const readyTimer = setInterval(() => { if (initialized) clearInterval(readyTimer); else parent.postMessage({type:'garden:ready'}, location.origin); }, 300);
