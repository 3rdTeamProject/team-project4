'use strict';
// 주소 끝에 ?shell=... 이 있으면 부모 화면·서버 없이 '껍데기'(시안 그대로의 화면)만 연다
if (new URLSearchParams(location.search).has('shell')) {
  const shell = document.createElement('script');
  shell.src = 'shell.js';
  document.body.append(shell);
} else {
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
      const report = () => parent.postMessage({type:'garden:height',height:Math.ceil(document.querySelector(".phone-shell").getBoundingClientRect().height)}, location.origin);
      new ResizeObserver(report).observe(document.querySelector(".phone-shell"));
      report();
    };
    document.body.append(script);
  });
  parent.postMessage({type:'garden:ready'}, location.origin);
}
