'use strict';
let initialized = false;
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const message = event.data;
  if (message?.type !== 'garden:init' || initialized) return;
  initialized = true;
  window.GARDEN_STORAGE_KEY = `woori-garden-user-${message.userId}`;
  window.GARDEN_VIEW = message.view;
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
      document.body.append(tasks);
    };
    document.body.append(features);
    const report = () => parent.postMessage({type:'garden:height',height:Math.ceil(document.querySelector(".phone-shell").getBoundingClientRect().height)}, location.origin);
    new ResizeObserver(report).observe(document.querySelector(".phone-shell"));
    report();
  };
  document.body.append(script);
});
parent.postMessage({type:'garden:ready'}, location.origin);
