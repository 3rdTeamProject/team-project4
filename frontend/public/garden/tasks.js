'use strict';
// 작물별 할 일(task_logs)·성장 단계·수확을 서버 데이터로 보여 주는 화면.
// features.js 화면 위에 덧붙인다. 서버에 할 일 데이터(crop_tasks)가 있는 작물(오이 등)만 이 화면을 쓰고,
// 데이터가 아직 없는 작물은 기존 화면이 그대로 동작한다.
//
// 흐름: 작물 선택 → 심기 전 준비(밭 준비 안내) → 심었어요(작물 생성) → 칸은 포트·0단계 →
//       칸 상세에서 할 일을 체크하고 '일지 올리기'로 완료(포인트) → 모종 옮겨심기를 마치면 3단계.
// 수확하기는 표시만 하고, 일지를 올릴 때 수확 기록과 첫 수확 보너스가 생긴다.

// ---------- 부모 화면(서버 연결)과 주고받기
const pendingCalls = new Map();
let callSeq = 0;
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== parent) return;
  const m = e.data;
  if (m?.type !== 'garden:api-result') return;
  const call = pendingCalls.get(m.id);
  if (!call) return;
  pendingCalls.delete(m.id);
  clearTimeout(call.timer);
  m.ok ? call.resolve(m.data) : call.reject(new Error(m.error || '요청에 실패했어요.'));
});
function hostApi(op, payload) {
  return new Promise((resolve, reject) => {
    if (window.parent === window) { reject(new Error('서버에 연결되어 있지 않아요.')); return; }
    const id = ++callSeq;
    const timer = setTimeout(() => { pendingCalls.delete(id); reject(new Error('서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.')); }, 30000);
    pendingCalls.set(id, { resolve, reject, timer });
    window.parent.postMessage({ type: 'garden:api', id, op, payload }, location.origin);
  });
}
let dirty = 0;
const baseSave = save;
save = function () { dirty++; return baseSave.apply(this, arguments); };
// 서버가 보낸 농장 내용으로 화면을 바꾼다(저장 요청은 보내지 않는다)
function applyServerState(next) {
  if (!isState(next)) return;
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  if (!state.farms.some(f => f.id === selected)) selected = state.farms[0]?.id;
  render();
}
async function refreshFromServer() {
  const mark = dirty;
  try {
    const r = await hostApi('refresh');
    if (mark === dirty) { applyServerState(r.state); loadTasks(true); }
  } catch {}
}

// ---------- 작물 정보(어떤 작물에 할 일 데이터가 있는지, 심기 전 안내)
let cropInfo = {};
const isTaskKind = kind => !!cropInfo[kind]?.hasTasks;
function isTaskPlant(p) { return isTaskKind(p.kind); }
// 씨앗으로 심고 아직 밭에 옮겨심기 전(0단계, 포트)
// (직파 작물은 옮겨심기가 없어서 포트 단계가 없다)
const isPrep = p => isTaskPlant(p) && p.method === 'seed' && p.stage < 3 && !!cropInfo[p.kind]?.hasTransplant;
categories.cucumber_spring = 'fruit';
categories.cucumber_summer = 'fruit';

// ---------- 그림·단계: 오이는 한 종류 그림을 쓰고, 0단계는 포트, 단계는 서버가 정한다
const potArt = () => '<svg class="plant-art pot-art" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><ellipse cx="50" cy="94" rx="31" ry="5" fill="var(--color-text)" opacity=".18"/><path d="M21 46h58l-6 44a6 6 0 0 1-6 5H33a6 6 0 0 1-6-5z" fill="var(--color-soil)"/><rect x="15" y="35" width="70" height="15" rx="6" fill="var(--color-soil)"/><ellipse cx="50" cy="37" rx="31" ry="6" fill="var(--color-text)" opacity=".6"/><circle cx="39" cy="37" r="2.4" fill="var(--color-point-chip)"/><circle cx="52" cy="39" r="2.4" fill="var(--color-point-chip)"/><circle cx="63" cy="36" r="2.4" fill="var(--color-point-chip)"/></svg>';
const baseCropSvg = CropArt.svg;
CropArt.svg = (kind, stage = 5, preview = false) => stage === 0 ? potArt() : baseCropSvg(kind, stage, preview);
const basePlant = plant;
plant = function (p) { return isTaskPlant(p) && isPrep(p) ? potArt() : basePlant(p); };
const baseGrowthStage = GardenGrowth.stage;
GardenGrowth.stage = function (p, total, today) { return isTaskPlant(p) ? p.stage : baseGrowthStage.call(this, p, total, today); };

// ---------- 오늘 할 일(서버)
let taskData = { status: 'idle', tasks: [], harvestDue: [], at: 0, loading: false, message: '' };
const checked = new Set();
let completing = false;
const harvestMark = {};
let sowChecked = false;  // 심기 전 준비에서 '포트에 씨앗 심기'를 체크했는지
const hasTask = (farmId, i) => taskData.tasks.some(t => !t.infoOnly && t.farm === farmId && t.position === i + 1);
const plotTasks = (f, i, withInfo = false) => taskData.tasks.filter(t => t.farm === f.id && t.position === i + 1 && (withInfo || !t.infoOnly));
function ensureTasks() {
  if (!state.farms.some(f => f.plots.some(p => p && isTaskPlant(p))) || taskData.loading) return;
  if (taskData.status === 'idle' || Date.now() - taskData.at >= 30000) loadTasks();
}
async function loadTasks(force = false) {
  if (taskData.loading) return;
  taskData.loading = true;
  const before = JSON.stringify([taskData.status, taskData.tasks, taskData.harvestDue]);
  try {
    const r = await hostApi('tasks');
    // '고추 따기'처럼 5단계를 올리는 수확 할 일은 목록에 보여 주지 않고, 수확할 때가 됐다는 표시로만 쓴다(수확은 '수확하기' 버튼으로 한다)
    const isHarvestTask = t => t.triggersStage === 5 && !t.infoOnly && t.title.endsWith('따기');
    const harvestDue = r.tasks.filter(isHarvestTask).map(t => `${t.farm}|${t.position - 1}`);
    taskData = { status: 'ready', tasks: r.tasks.filter(t => !isHarvestTask(t)), harvestDue, at: Date.now(), loading: false, message: '' };
    const ids = new Set(r.tasks.map(t => t.id));
    [...checked].forEach(id => { if (!ids.has(id)) checked.delete(id); });
  } catch (e) {
    taskData = { ...taskData, status: 'error', at: Date.now(), loading: false, message: e.message };
  }
  if ((force || before !== JSON.stringify([taskData.status, taskData.tasks, taskData.harvestDue])) && ['farms', 'garden', 'tasks', 'detail'].includes(view)) render();
}
const fmtLong = d => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const statusNote = () => taskData.status === 'error'
  ? `<div class="info">⚠ ${esc(taskData.message)} <button type="button" class="tk-link" data-tk="retry">다시 불러오기</button></div>`
  : taskData.status !== 'ready' ? '<p class="help">할 일을 불러오는 중…</p>' : '';

// 체크하면 '일지에 담을 할 일'로 표시되고, 일지를 올려야 완료된다(카드 어디를 눌러도 체크, 팁 보기는 제외)
const taskCard = t => {
  const on = checked.has(t.id);
  return `<div class="check-card tk-task" role="checkbox" tabindex="0" aria-checked="${on}" aria-label="${esc(t.title)}" data-tk="toggle-task" data-task="${t.id}"><span class="check-box ${on ? 'checked' : ''}">${on ? '<span class="check-mark">✓</span>' : ''}</span><div class="task-content"><div class="tk-title-row"><b>${esc(t.title)}</b><span class="tk-point-chip">+${t.points}P</span></div>${t.howTo ? `<small>${esc(t.howTo)}</small>` : ''}${t.tip ? `<div class="tk-tip-open">💡 ${esc(t.tip)}</div>` : ''}</div></div>`;
};
const infoCard = t => `<div class="tk-info-card"><b>${esc(t.title)}</b>${t.howTo ? `<small>${esc(t.howTo)}</small>` : ''}${t.tip ? `<div class="tk-tip-open">💡 ${esc(t.tip)}</div>` : ''}</div>`;
// '미리 해 두면 좋아요' 목록: 제목을 누르면 접고 펼친다(화면을 다시 그려도 상태가 남도록 변수에 둔다)
let infoOpen = true;
const infoSection = list => list.length
  ? `<h3 class="field-label tk-sub-title"><button type="button" class="tk-fold" data-tk="toggle-info" aria-expanded="${infoOpen}"><span>미리 해 두면 좋아요</span><span class="tk-fold-arrow" aria-hidden="true">▾</span></button></h3>${infoOpen ? list.map(infoCard).join('') : ''}`
  : '';
const trashButton = '<button class="icon-btn" data-feature="delete-crop" aria-label="작물 삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/></svg></button>';
const memoBox = p => `<div class="field"><label class="field-label" for="feature-memo">메모</label><textarea id="feature-memo" maxlength="500" placeholder="오늘 텃밭 상태를 적어보세요 (선택)">${esc(p.draftMemo || '')}</textarea></div>`;
const journalFooter = label => footer(`<button class="secondary diagnosis-button" data-feature="diagnosis">AI진단</button><button class="primary" data-tk="post-journal" ${completing ? 'disabled' : ''}>${completing ? '올리는 중…' : label}</button>`);
function harvestBanner(f, i, p) {
  const done = !!p.harvestedAt, ready = p.stage >= 5 || taskData.harvestDue.includes(`${f.id}|${i}`);
  if (!done && !ready) return '';
  const marked = !!harvestMark[`${f.id}|${i}`];
  const note = marked ? (done ? '일지를 올리면 수확이 기록돼요' : '일지를 올리면 수확 보너스 +120P') : '';
  // 수확은 하루에 한 번만 기록한다: 오늘 수확을 기록했으면 내일까지 버튼을 막는다
  const doneToday = p.lastHarvestedAt === day();
  const button = doneToday
    ? '<button class="secondary" disabled>오늘은 수확했어요</button>'
    : marked
      ? '<button class="secondary" data-tk="mark-harvest" aria-pressed="true">✓ 수확했어요</button>'
      : '<button class="primary" data-tk="mark-harvest" aria-pressed="false">수확하기</button>';
  return `<div class="harvest-banner"><b>${done ? '수확 중이에요 🧺' : '수확할 때가 됐어요'}</b><p>${done ? `${esc(fmtLong(p.harvestedAt))}에 처음 수확했어요. 수확 보너스는 이미 받았어요. 다 자란 열매는 알맞은 때에 계속 따 주세요.` : '다 자란 모습을 보고, 알맞은 때에 수확해 주세요.'}</p>${note ? `<p><b>${note}</b></p>` : ''}${button}</div>`;
}

// 칸 상세: 씨앗을 심은 뒤(옮겨심기 전, 0단계)도 3단계 이후와 같은 화면이다. 밭 준비 안내가 있으면 위에 보여 준다
function plotPage(f, i, p) {
  const all = plotTasks(f, i, true), info = all.filter(t => t.infoOnly), mine = all.filter(t => !t.infoOnly);
  const picked = mine.filter(t => checked.has(t.id)).length, days = GardenGrowth.elapsed(p.plantedAt, day());
  const stageText = p.harvestedAt ? '수확 중' : `${isPrep(p) ? 0 : p.stage}/5단계`;
  return `<main class="page">${head(meta(p).name, 'garden')}<div class="detail-subhead"><small>${esc(f.name)} · 심은 지 ${days + 1}일</small><span class="pill">${stageText}</span>${trashButton}</div>${harvestBanner(f, i, p)}${infoSection(info)}<div class="field-label tk-sub-title">오늘 할 일 <span class="count">${taskData.status === 'ready' ? `완료 ${picked} / ${mine.length}` : ''}</span></div>${statusNote()}${mine.length ? mine.map(taskCard).join('') : taskData.status === 'ready' ? '<div class="tk-empty-task"><span class="tk-empty-icon" aria-hidden="true">🌱</span><div><strong>오늘 할 일 끝!</strong><p>지금 할 일은 모두 마쳤어요.</p></div></div>' : ''}${photoSection(p.draftPhotos)}${memoBox(p)}<p class="help">체크한 할 일은 일지를 올려야 완료돼요.</p></main>${journalFooter('일지 올리기')}`;
}
const baseDetailPage = detailPage;
detailPage = function () {
  const f = current(), p = f?.plots[plotIndex];
  if (p && isTaskPlant(p)) return plotPage(f, plotIndex, p);
  return baseDetailPage();
};

// 작물 선택 뒤의 '심기 전 준비'(작물이 생기기 전): 서버가 알려 준 안내 작업만 보여 준다
// '심었어요'가 곧 끝내는 첫 작업: 씨앗이면 포트에 씨앗 심기, 모종이면 모종 옮겨심기
const firstTask = () => (plantingMethod === 'seed' ? cropInfo[chosenCrop]?.plant : cropInfo[chosenCrop]?.hasTransplant ? cropInfo[chosenCrop]?.transplant : null) || null;
const basePreparationPage = preparationPage;
preparationPage = function () {
  if (!isTaskKind(chosenCrop)) return basePreparationPage();
  const name = CROPS.find(c => c.id === chosenCrop).name, prep = cropInfo[chosenCrop].prep, sow = firstTask();
  // 첫 작업(씨앗은 포트에 씨앗 심기, 모종은 모종 옮겨심기)을 체크하고 '심었어요'를 누르면 완료된다(카드 어디를 눌러도 체크) — 오늘 할 일에는 나오지 않는다
  const sowCard = sow ? `<h3>이번에 할 일</h3><div class="check-card tk-sow" role="checkbox" tabindex="0" aria-checked="${sowChecked}" aria-label="${esc(sow.title)}" data-tk="toggle-sow"><span class="check-box ${sowChecked ? 'checked' : ''}">${sowChecked ? '<span class="check-mark">✓</span>' : ''}</span><div class="task-content"><b>${esc(sow.title)}</b>${sow.howTo ? `<small>${esc(sow.howTo)}</small>` : ''}${sow.tip ? `<div class="tk-tip-open">💡 ${esc(sow.tip)}</div>` : ''}</div></div>` : '';
  return `<main class="page planting-prep-page">${head('심기 전 준비', 'select')}<div class="seed-sign"><b>${esc(name)}</b><small>${plantingMethod === 'seed' ? '씨앗' : '모종'}으로 시작 · ${pendingPlot + 1}번째 칸</small></div>${infoSection(prep)}${sowCard}${photoSection(plantingDraft.photos)}<div class="field"><label class="field-label" for="feature-memo">메모</label><textarea id="feature-memo" maxlength="500" placeholder="준비하면서 한 일을 적어보세요 (선택)">${esc(plantingDraft.memo)}</textarea></div><div class="info">ⓘ 준비가 되면 아래 버튼을 눌러요. 누르면 오늘부터 재배가 시작돼요.</div></main>${footer('<button class="primary" data-feature="plant">심기</button>')}`;
};

// 오늘 할 일 모아보기: 농장별 목록(서버 할 일 + 서버 할 일이 없는 작물의 기존 할 일). 캘린더는 아직 없다
const baseTasksPage = tasksPage;
tasksPage = function () {
  const hasTaskCrop = state.farms.some(f => f.plots.some(p => p && isTaskPlant(p)));
  const groups = state.farms.map(f => ({ f, rows: f.plots.flatMap((p, i) => {
    if (!p) return [];
    if (isTaskPlant(p)) return plotTasks(f, i).map(t => ({ i, label: t.title, sub: `${meta(p).name}${t.howTo ? ' · ' + t.howTo : ''}` }));
    return p.plantedAt <= day() && (!p.harvestedAt || day() <= p.harvestedAt)
      ? careItems(p).filter(([key]) => !completed(p, key)).map(([, label, sub]) => ({ i, label, sub: `${meta(p).name} · ${sub}` })) : [];
  }) }));
  return `<main class="page tasks-overview">${head('오늘 할 일', tasksBack === 'garden' && current() ? 'garden' : 'farms')}${hasTaskCrop ? statusNote() : ''}${groups.map(({ f, rows }) => `<h3 class="tasks-farm-heading"><span>${esc(f.name)}</span><span class="task-count" aria-label="할 일 ${rows.length}개">${rows.length}</span></h3>${rows.length ? rows.map(r => `<button class="check-card tasks-overview-card" data-feature="open-task" data-id="${esc(f.id)}" data-index="${r.i}"><span><b>${esc(r.label)}</b><small>${esc(r.sub)}</small></span></button>`).join('') : '<div class="no-tasks">오늘 할 일이 없어요</div>'}`).join('')}<p class="help">할 일을 누르면 작물 관리 화면으로 이동해요.</p></main>`;
};

// ---------- 일지 올리기: 체크한 할 일(과 수확)을 완료하고 일지·포인트를 서버에서 한 번에 처리
// 포인트·레벨업 연출은 바깥(React)이 그린다. 농장 화면(iframe)은 내용만큼 길어서 안에서 그리면 위치가 어긋난다
function showReward(r) {
  if (window.parent === window || !(r.earned > 0)) return;
  window.parent.postMessage({ type: 'garden:reward', earned: r.earned, bonus: r.bonus || 0, firstHarvest: !!r.firstHarvest, level: r.level || null, motion: state.settings?.motion !== false }, window.location.origin);
}

async function postJournal() {
  if (completing) return;
  const f = current(), i = plotIndex, p = f?.plots[i];
  if (!p) return;
  if (!p.plantingId) { toast('서버와 맞추는 중이에요. 잠시 후 다시 눌러 주세요.'); return; }
  const key = `${f.id}|${i}`, mine = plotTasks(f, i).filter(t => checked.has(t.id));
  const memo = (p.draftMemo || '').trim(), photos = p.draftPhotos || [], harvest = !!harvestMark[key];
  if (!mine.length && !harvest && !memo && !photos.length) { toast('완료한 할 일을 체크하거나 메모·사진을 추가해 주세요.'); return; }
  const before = p.stage;
  completing = true;
  p.draftMemo = ''; p.draftPhotos = [];
  save(); render();
  try {
    const r = await hostApi('complete', { planting_id: p.plantingId, task_log_ids: mine.map(t => t.id), content: memo, photos, harvest });
    mine.forEach(t => checked.delete(t.id));
    delete harvestMark[key];
    completing = false;
    applyServerState(r.state);
    if (typeof journalCaptureTasks === 'function') journalCaptureTasks(f, p, mine.map(t => t.title));
    const after = state.farms.find(x => x.id === f.id)?.plots[i]?.stage;
    toast(`일지를 올렸어요!${r.firstHarvest ? ' · 첫 수확을 축하해요 🧺' : after > before ? ` · ${after}단계로 자랐어요 🌱` : ''}`);
    showReward(r);
    await loadTasks(true);
  } catch (e) {
    completing = false;
    const cur = state.farms.find(x => x.id === f.id)?.plots[i];
    if (cur) { cur.draftMemo = memo; cur.draftPhotos = photos; save(); }
    toast(e.message);
    render();
  }
}
app.addEventListener('click', e => {
  const b = e.target.closest('[data-tk]');
  if (!b) return;
  switch (b.dataset.tk) {
    case 'toggle-task': { if (e.target.closest('details')) break; const id = Number(b.dataset.task); checked.has(id) ? checked.delete(id) : checked.add(id); render(); break; }
    case 'mark-harvest': { const k = `${current().id}|${plotIndex}`; harvestMark[k] = !harvestMark[k]; render(); break; }
    case 'post-journal': postJournal(); break;
    case 'toggle-sow': sowChecked = !sowChecked; render(); break;
    case 'toggle-info': infoOpen = !infoOpen; render(); break;
    case 'retry': loadTasks(true); break;
    case 'dev-day': moveDay(b); break;
    case 'dev-weather': { const o = DEV_WEATHER[Number(b.dataset.i)].o; GardenWeather.setOverride(o); render(); break; }
  }
});

app.addEventListener('keydown', e => {
  const card = e.target.closest?.('.check-card[role="checkbox"]');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
});
// 첫 작업을 체크해야 '심었어요'가 동작한다
app.addEventListener('click', e => {
  const b = e.target.closest('[data-feature="plant"]');
  if (!b || view !== 'prepare' || !isTaskKind(chosenCrop) || !firstTask()) return;
  if (sowChecked) { sowChecked = false; return; }
  e.stopImmediatePropagation();
  toast(`'${firstTask().title}'를 체크한 뒤 눌러 주세요.`);
}, true);

// ---------- 개발용 날짜 이동(서버 날짜를 며칠 앞으로)
// 개발용 날씨 바꾸기: 날씨별 하늘·구름·효과를 확인한다(o가 null이면 실제 날씨)
const DEV_WEATHER = [
  { label: '실제', o: null },
  { label: '맑음', o: { code: 0, isDay: 1 } },
  { label: '밤', o: { code: 0, isDay: 0 } },
  { label: '흐림', o: { code: 3, isDay: 1 } },
  { label: '흐림 밤', o: { code: 3, isDay: 0 } },
  { label: '비', o: { code: 61, isDay: 1 } },
  { label: '뇌우', o: { code: 95, isDay: 1 } },
  { label: '눈', o: { code: 71, isDay: 1 } },
  { label: '안개', o: { code: 45, isDay: 1 } },
  { label: '정보 없음', o: { code: -1, isDay: 1 } },
];
const devWeatherBar = () => {
  const now = GardenWeather.getOverride();
  const on = i => { const o = DEV_WEATHER[i].o; return o ? !!now && now.code === o.code && now.isDay === o.isDay : !now; };
  return `<div class="tk-dev" role="group" aria-label="개발용 날씨 바꾸기"><b>🛠 날씨</b>${DEV_WEATHER.map((w, i) => `<button type="button" data-tk="dev-weather" data-i="${i}" aria-pressed="${on(i)}">${w.label}</button>`).join('')}</div>`;
};
const DEV_DAY_STEPS = [1, 5, 7, 30];
const devBar = () => `<div class="tk-dev" role="group" aria-label="개발용 날짜 이동"><b>🛠 개발용</b><span>오늘 ${esc(day())} (+${dev.offset}일)</span>${DEV_DAY_STEPS.map(n => `<button type="button" data-tk="dev-day" data-add="${n}">+${n}일</button>`).join('')}<button type="button" data-tk="dev-day" data-set="0">처음으로</button></div>`;
async function moveDay(b) {
  try {
    const r = await hostApi('devdayset', { offset: b.dataset.set !== undefined ? Number(b.dataset.set) : dev.offset + Number(b.dataset.add) });
    dev = { enabled: r.enabled, offset: r.offset };
    toast(`서버 날짜를 ${r.today}로 옮겼어요.`);
    await refreshFromServer();
    await loadTasks(true);
    render();
  } catch (e) { toast(e.message); }
}

// ---------- 화면 그릴 때마다: 할 일 불러오기, 방금 심은 작물을 서버와 맞추기, 개발용 줄
const baseRender = render;
let syncing = false;
render = function () {
  baseRender();
  if (view !== 'prepare') sowChecked = false;
  if (!['farms', 'garden', 'tasks', 'detail'].includes(view)) return;
  ensureTasks();
  if (!syncing && state.farms.some(f => f.plots.some(p => p && isTaskPlant(p) && !p.plantingId))) {
    syncing = true;  // 새로 심은 작물은 저장이 끝난 뒤 서버 값(작물 번호·단계)을 받아 온다
    refreshFromServer().finally(() => { syncing = false; });
  }
  // PC 레이아웃(role이 있을 때)에서는 개발용 줄을 왼쪽 메뉴가 대신 보여 준다(pc-layout.js가 내용을 바깥으로 보낸다)
  if (dev.enabled && !window.GARDEN_ROLE) app.insertAdjacentHTML('afterbegin', devBar() + (view === 'garden' ? devWeatherBar() : ''));
};

// ---------- 시작: 작물 정보와 개발용 날짜를 받아 온다
Promise.all([
  hostApi('crops').then(r => {
    r.crops.forEach(c => {
      cropInfo[c.kind] = c;
      CropArt.register(c.kind, c.name);
      // 처음 7종 밖의 작물은 서버 목록으로 채운다. 분류는 서버가 내려준다.
      if (!CROPS.some(x => x.id === c.kind)) CROPS.push({ id: c.kind, name: c.name, emoji: '🌱', days: c.days });
      categories[c.kind] = c.category || categories[c.kind] || 'other';
    });
  }).catch(() => {}),
  hostApi('devday').then(r => { if (r.enabled) dev = { enabled: true, offset: r.offset }; }).catch(() => {}),
]).then(() => {
  render();
  // 작물 정보를 받기 전의 첫 화면에서 팀원 코드가 단계를 시간 기준으로 덮어썼으니, 할 일이 있는 작물은 서버 값으로 되돌린다
  if (state.farms.some(f => f.plots.some(p => p && isTaskPlant(p)))) refreshFromServer();
});
