'use strict';
// 칸 상세 '껍데기'(시안 그대로의 화면). 서버·저장·할 일 계산 없이 가짜 데이터로 모양만 그린다.
// 주소 끝에 ?shell=prep|plot|harvest|done 을 붙여 열고, 맨 위 막대로 화면을 바꿔 가며 시안과 비교한다.
// 체크·수확하기·칸 비우기 메뉴는 모양을 보기 위한 토글일 뿐 아무것도 저장하지 않는다.
const app = document.querySelector('#app');
document.body.classList.add('sh-body');
const SCREENS = { prep: '심기 전 준비', plot: '칸 상세', harvest: '수확 시기', done: '수확 완료' };
const screen = SCREENS[new URLSearchParams(location.search).get('shell')] ? new URLSearchParams(location.search).get('shell') : 'plot';

// 화면마다 달라지는 가짜 데이터(시안의 예시 문구)
const DATA = {
  plot: { name: '방울토마토', sub: '주말농장 · 심은 지 24일', pill: '3/4단계', tasks: [
    { k: 'water', title: '물주기 확인', desc: '흙이 말랐는지 손가락으로 확인해요', on: true },
    { k: 'shoot', title: '곁순 따기', desc: '아래쪽 곁순을 손으로 떼어주세요', on: false },
  ], photo: true, leafCard: true, total: 3, doneCount: 2 },
  harvest: { name: '상추', sub: '주말농장 · 심은 지 48일', pill: '4/4단계', tasks: [
    { k: 'water', title: '물주기 확인', desc: '흙이 말랐는지 손가락으로 확인해요', on: true },
    { k: 'leaf', title: '겉잎 상태 보기', desc: '시든 잎이 있으면 떼어주세요', on: false },
  ], photo: false, total: 3, doneCount: 2 },
  done: { name: '상추', sub: '주말농장 · 심은 지 48일', pill: '수확 완료', tasks: [
    { k: 'water', title: '물주기 확인', desc: '흙이 말랐는지 손가락으로 확인해요', on: true },
    { k: 'leaf', title: '겉잎 상태 보기', desc: '시든 잎이 있으면 떼어주세요', on: false },
  ], photo: false, total: 3, doneCount: 2 },
};
const prepChecks = { soil: true, gap: true, tools: false };
const ui = { moreOpen: false, marked: false, checks: {} };

const I = {
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1F2A1C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  trash: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A3B2A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A4B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17h.01"/></svg>',
  chevWarn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7A4B00" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C8A74" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  check: (size = 18, color = '#fff', w = 3) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>`,
  camBlue: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D4E73" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"/></svg>',
  camGreen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2F7D32" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"/></svg>',
  leaf: '<svg width="62" height="52" viewBox="0 0 200 170" aria-hidden="true"><path d="M20 150C20 70 70 20 180 20C180 100 130 160 40 150Z" fill="#6FBF4F"/><path d="M30 142L158 36" stroke="#4C9A3A" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="112" cy="82" r="9" fill="#8A5A3C"/><circle cx="84" cy="108" r="7" fill="#8A5A3C"/></svg>',
  info: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1D4E73" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

const nav = () => `<nav class="sh-nav" aria-label="껍데기 화면 바꾸기"><span>껍데기 미리보기</span>${Object.entries(SCREENS).map(([k, v]) => `<a href="?shell=${k}" class="${k === screen ? 'on' : ''}">${v}</a>`).join('')}</nav>`;

function head(d) {
  return `<div class="sh-head"><a class="sh-iconbtn" href="#" aria-label="농장으로 돌아가기">${I.back}</a><div class="sh-head-title"><div class="sh-title">${d.name}</div><div class="sh-sub">${d.sub}</div></div><span class="sh-pill">${d.pill}</span><button type="button" class="sh-iconbtn sh-trash" data-act="more" aria-label="칸 비우기" aria-expanded="${ui.moreOpen}">${I.trash}</button></div>${moreMenu()}`;
}
function moreMenu() {
  return ui.moreOpen ? '<div class="sh-more"><button type="button"><b>칸 비우기</b><span>누르면 한 번 더 물어봐요. 쓴 일지는 남아요</span></button></div>' : '';
}
function checkRow(d, t) {
  const on = t.k in ui.checks ? ui.checks[t.k] : t.on;
  return `<div class="sh-task"><button type="button" class="sh-check" data-act="check" data-k="${t.k}" aria-label="${on ? '완료 해제' : '완료 체크'}"><span class="${on ? 'on' : ''}">${on ? I.check() : ''}</span></button><div class="sh-task-body"><div class="sh-task-title${on ? ' done' : ''}">${t.title}</div><div class="sh-task-desc">${t.desc}</div></div></div>`;
}
function leafRow() {
  return `<a href="#" class="sh-task"><span class="sh-ai-icon">${I.camBlue}</span><div class="sh-ai-body"><div class="sh-ai-line"><span class="sh-task-title">잎 관찰하기</span><span class="sh-ai-badge">주 1회 · AI 확인</span></div><div class="sh-task-desc">잎 사진을 찍으면 AI가 바로 알려줘요</div></div>${I.chev}</a>`;
}
function tasks(d) {
  // 시안의 예시 숫자(완료 2 / 3)에서 시작하고, 체크를 토글하면 그만큼 늘고 준다
  const delta = d.tasks.filter(t => (t.k in ui.checks ? ui.checks[t.k] : t.on)).length - d.tasks.filter(t => t.on).length;
  const count = `완료 ${d.doneCount + delta} / ${d.total}`;
  return `<div class="sh-sec"><div class="sh-sec-title">오늘 할 일</div><div class="sh-sec-count">${count}</div></div><div class="sh-list">${d.tasks.map(t => checkRow(d, t)).join('')}${leafRow()}</div>`;
}
function photos(withThumb) {
  return `<div class="sh-sec photo"><div class="sh-sec-title">사진</div><span class="sh-badge">넣으면 포인트가 더 많아요</span></div><div class="sh-photos">${withThumb ? `<div class="sh-thumb">${I.leaf}<span class="sh-thumb-label">잎 관찰</span></div>` : ''}<button type="button" class="sh-addphoto">${I.camGreen}사진 추가</button></div>`;
}
const memo = placeholder => `<div class="sh-memo-title">메모</div><div class="sh-memo-wrap"><textarea class="sh-memo" rows="3" placeholder="${placeholder}"></textarea></div>`;
function bar(note) {
  return `<div class="sh-bar"><div class="sh-bar-row"><a href="#" class="sh-ai-btn">AI진단</a><a href="#" class="sh-post">일지 올리기</a></div><div class="sh-bar-note">${note}</div></div>`;
}
function leafCard() {
  return `<div class="sh-warn"><div class="sh-warn-top">${I.warn}최근 잎 관찰 · 10월 1일</div><div class="sh-warn-title">문제가 의심돼요 (참고용)</div><a href="#" class="sh-warn-link">AI진단으로 자세히 보기${I.chevWarn}</a></div>`;
}
function harvestBanner() {
  const m = ui.marked;
  return `<div class="sh-banner"><div class="sh-banner-text"><div class="sh-banner-title">수확할 때가 됐어요</div><div class="sh-banner-desc">다 자란 모습을 보고, 알맞은 때에 수확해 주세요.</div>${m ? '<div class="sh-banner-bonus">일지를 올리면 수확 보너스 +120P</div>' : ''}</div>${m ? `<span class="sh-harvested">${I.check(18, '#1F5E24')}수확했어요</span>` : '<button type="button" class="sh-harvest" data-act="mark">수확하기</button>'}</div>`;
}
function doneBanner() {
  return `<div class="sh-banner done"><div class="sh-banner-text"><div class="sh-banner-title">수확을 마쳤어요</div><div class="sh-banner-desc">10월 12일에 수확했어요. 수확 보너스는 이미 받았어요.</div></div><span class="sh-harvest-off">${I.check(18, '#8A9684')}수확 완료</span></div>`;
}

const screens = {
  plot: () => { const d = DATA.plot; return `${head(d)}${leafCard()}${tasks(d)}${photos(true)}${memo('오늘 텃밭 상태를 적어보세요 (선택)')}${bar('잎 관찰이 들어간 일지는 포인트가 가장 많아요')}`; },
  harvest: () => { const d = DATA.harvest; return `${head(d)}${harvestBanner()}${tasks(d)}${photos(false)}${memo('오늘 텃밭 상태를 적어보세요 (선택)')}${bar('사진을 넣으면 포인트를 더 받아요')}`; },
  done: () => { const d = DATA.done; return `${head(d)}${doneBanner()}${tasks(d)}${photos(false)}${memo('오늘 텃밭 상태를 적어보세요 (선택)')}${bar('사진을 넣으면 포인트를 더 받아요')}`; },
  prep: () => {
    const items = [['soil', '흙 고르기', '삽으로 흙을 부드럽게 갈아주세요'], ['gap', '간격 맞추기', '포기 사이를 15cm 정도 띄워요'], ['tools', '준비물 챙기기', '씨앗 · 물뿌리개 · 모종삽']];
    return `<div class="sh-head"><a class="sh-iconbtn" href="#" aria-label="돌아가기">${I.back}</a><div class="sh-head-title"><div class="sh-title">심기 전 준비</div></div></div>`
      + `<div class="sh-prep"><div class="sh-sign-wrap"><div class="sh-sign"><div class="sh-sign-name">상추</div><div class="sh-sign-sub">씨앗으로 시작 · 5번째 칸</div></div><div class="sh-sign-leg"></div></div>`
      + `<div class="sh-prep-title">심기 전에 준비해요</div><div class="sh-prep-list">${items.map(([k, t, s]) => `<button type="button" class="sh-prep-item" data-act="prep" data-k="${k}"><span class="sh-prep-box ${prepChecks[k] ? 'on' : ''}">${prepChecks[k] ? I.check(16, '#fff', 2.2) : ''}</span><span><b>${t}</b><small>${s}</small></span></button>`).join('')}</div>`
      + `<div class="sh-photohead"><div class="sh-sec-title">사진</div><span class="sh-badge">넣으면 포인트가 더 많아요</span></div><div class="sh-photos"><button type="button" class="sh-addphoto">${I.camGreen}사진 추가</button></div>`
      + `<div class="sh-memo-title">메모</div><textarea class="sh-memo" rows="3" placeholder="준비하면서 한 일을 적어보세요 (선택)"></textarea>`
      + `<div class="sh-info">${I.info}<div>정해진 날짜는 없어요. 준비가 되면 아래 버튼을 눌러요</div></div></div>`
      + `<div class="sh-bar tight" style="margin-top:16px"><a href="#" class="sh-plant-btn">심었어요</a><div class="sh-bar-note">누르면 오늘부터 재배가 시작돼요</div></div>`;
  },
};

function render() { app.innerHTML = `${nav()}<div class="sh">${screens[screen]()}</div>`; }
app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) { if (e.target.closest('a[href="#"]')) e.preventDefault(); return; }
  if (b.dataset.act === 'more') ui.moreOpen = !ui.moreOpen;
  if (b.dataset.act === 'mark') ui.marked = true;
  if (b.dataset.act === 'check') { const cur = b.dataset.k in ui.checks ? ui.checks[b.dataset.k] : (DATA[screen].tasks.find(t => t.k === b.dataset.k) || {}).on; ui.checks[b.dataset.k] = !cur; }
  if (b.dataset.act === 'prep') prepChecks[b.dataset.k] = !prepChecks[b.dataset.k];
  render();
});
render();
