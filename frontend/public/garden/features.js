'use strict';
let chosenCrop='lettuce', plantingMethod='seed', cropCategory='all', cropQuery='', taskMode='list', taskDate=day();
// 작물마다 허용하는 심는 방식(씨앗/모종). 서버 작물 정보를 받기 전에는 둘 다 허용으로 본다
const allowedMethods=id=>{const i=typeof cropInfo!=='undefined'?cropInfo[id]:null;const m=i?[i.allowSeed&&'seed',i.allowSeedling&&'seedling'].filter(Boolean):[];return m.length?m:['seed','seedling']};
// 작물 선택 화면의 분류(서버가 작물마다 내려준다). 해당하는 작물이 있는 분류만 탭으로 보인다
const CATEGORY_LABELS={leaf:'잎채소',fruit:'과일채소',root:'뿌리채소',stem:'줄기·꽃채소',wild:'산나물',other:'기타'};
const categoryTabs=()=>[['all','전체'],...Object.entries(CATEGORY_LABELS).filter(([key])=>CROPS.some(c=>categories[c.id]===key))];
const methodNote=id=>{const m=allowedMethods(id);return m.length===1?(m[0]==='seed'?' · 씨앗만':' · 모종만'):''};
let plantingDraft={checks:[],photos:[],memo:''};
let farmFormLocation=null;
let tasksBack='farms';  // '오늘 할 일 모아보기'를 연 곳(농장 목록 또는 농장 화면). 뒤로가기는 그곳으로 돌아간다
const baseNavigate=navigate;
navigate=function(next){
  if(next==='diagnosis'&&!journalEdit){
    const farm=typeof current==='function'?current():null;
    const index=typeof plotIndex==='number'?plotIndex:-1;
    const plant=farm?.plots[index];
    const target=plant&&!plant.harvestedAt?{farmId:farm.id,plotNumber:index+1}:null;
    if(parent!==window)parent.postMessage(target?{type:'garden:navigate',to:'/diagnosis',...target}:{type:'garden:navigate',to:'/diagnosis?mode=detail'},location.origin);
    else location.assign(target?`/diagnosis?${new URLSearchParams({mode:'detail',farm:target.farmId,plot:String(target.plotNumber)})}`:'/diagnosis?mode=detail');
    return;
  }
  if(next==='tasks')tasksBack=view==='garden'?'garden':'farms';
  if(next==='add'||next==='edit')farmFormLocation=null;
  if(next==='select'&&view==='garden'){plantingMethod='seed';const m=allowedMethods(chosenCrop);if(!m.includes('seed'))plantingMethod=m[0]}
  baseNavigate(next);
};
const baseFormPage=formPage;
formPage=function(edit){
  return baseFormPage(edit).replace(/(<input id="farm-region"[^>]*>)/,
    '<div class="region-row">$1<button type="button" class="secondary location-button" data-feature="farm-location">⌖ 현재 위치</button></div><ul id="region-suggest" class="region-suggest" role="listbox" aria-label="비슷한 지역" hidden></ul><small class="region-credit">현재 위치 지역명: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></small>');
};
// 지역 입력 자동완성: 입력이 멈추면(0.35초) 서버(카카오 주소 검색)에서 비슷한 지역을 받아 목록으로 보여 준다
let regionResults=[],regionTimer=0,regionSeq=0;
const regionList=()=>document.querySelector('#region-suggest');
function showRegionResults(items){
  const list=regionList();
  if(!list)return;
  regionResults=items;
  list.innerHTML=items.map((p,i)=>`<li role="option"><button type="button" class="region-option" data-feature="region-pick" data-index="${i}">${esc(p.label)}</button></li>`).join('');
  list.hidden=!items.length;
}
app.addEventListener('input',event=>{
  if(event.target.id!=='farm-region')return;
  farmFormLocation=null;
  clearTimeout(regionTimer);
  const text=event.target.value.trim(),seq=++regionSeq;
  if(text.length<2){showRegionResults([]);return}
  regionTimer=setTimeout(async()=>{
    try{
      const r=await hostApi('places',{q:text});
      if(seq===regionSeq)showRegionResults(r.places);
    }catch{if(seq===regionSeq)showRegionResults([])}  // 검색이 안 돼도 직접 입력해서 저장할 수 있다
  },350);
});
app.addEventListener('click',async event=>{
  const button=event.target.closest('[data-feature="region-pick"]');
  if(!button)return;
  const input=document.querySelector('#farm-region'),place=regionResults[Number(button.dataset.index)];
  if(!input||!place)return;
  regionSeq++;
  input.value=place.label;
  showRegionResults([]);
  farmFormLocation=null;
  let found=Number.isFinite(place.latitude)&&Number.isFinite(place.longitude)?place:null;
  if(!found){  // 장소 검색에서 뽑은 후보는 좌표가 없어서, 이름으로 한 번 더 찾아 좌표를 받는다
    try{found=(await hostApi('places',{q:place.label})).places.find(p=>p.label===place.label&&Number.isFinite(p.latitude))||null}catch{}
  }
  if(!input.isConnected||input.value!==place.label)return;
  if(found){farmFormLocation={latitude:found.latitude,longitude:found.longitude,label:place.label}}
  else toast('이 지역의 위치를 찾지 못했어요. 지역명만 저장되고, 날씨는 다른 지역을 고르거나 현재 위치 버튼으로 지정해 주세요.');
});
app.addEventListener('click',event=>{
  const button=event.target.closest('[data-feature="farm-location"]');
  if(!button)return;
  if(!navigator.geolocation){toast('이 브라우저에서는 현재 위치를 사용할 수 없어요. 지역을 직접 입력해 주세요.');return;}
  const input=document.querySelector('#farm-region');
  button.disabled=true;
  button.textContent='위치 확인 중…';
  const previousValue=input.value;
  navigator.geolocation.getCurrentPosition(async position=>{
    if(!input.isConnected)return;
    button.textContent='지역명 확인 중…';
    try{
      const latitude=Number(position.coords.latitude.toFixed(4)),longitude=Number(position.coords.longitude.toFixed(4));
      const label=await GardenWeather.reverseGeocode(latitude,longitude);
      if(!input.isConnected||input.value!==previousValue)return;
      farmFormLocation={latitude,longitude,label};
      input.value=label;
      button.textContent='⌖ 위치 설정됨';
      toast(`${label} 지역으로 설정했어요.`);
    }catch{
      if(button.isConnected){button.textContent='⌖ 현재 위치';toast('지역명을 확인하지 못했어요. 다시 시도하거나 지역을 직접 입력해 주세요.')}
    }finally{if(button.isConnected){button.disabled=false;button.textContent=farmFormLocation&&input.value===farmFormLocation.label?'⌖ 위치 설정됨':'⌖ 현재 위치'}}
  },error=>{
    if(!button.isConnected)return;
    button.disabled=false;
    button.textContent='⌖ 현재 위치';
    toast(error.code===1?'브라우저 위치 권한을 허용하거나 지역을 직접 입력해 주세요.':'현재 위치를 확인하지 못했어요. 다시 시도하거나 지역을 입력해 주세요.');
  },{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
});
let growthDate=day();
function refreshGrowth(){
  if(day()!==growthDate){growthDate=day();render();}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshGrowth();});
setInterval(refreshGrowth,60000);
const categories={lettuce:'leaf',cucumber:'fruit',pepper:'fruit',eggplant:'fruit',zucchini:'fruit',tomato:'fruit'};
const careItems=(p,date=day())=>p.harvestedAt&&date>p.harvestedAt?[]:[['water','물주기 확인','흙이 말랐는지 손가락으로 확인해요'],['care',p.kind==='tomato'?'곁순 따기':'겉잎 상태 보기',p.kind==='tomato'?'아래쪽 곁순을 손으로 떼어주세요':'시든 잎이 있으면 떼어주세요'],['diagnosis','AI 상세 진단','사진과 증상을 입력하고 AI 진단을 요청해요']];
const completed=(p,key,date=day())=>p.taskChecks?.[date]?.includes(key)||key==='water'&&p.wateredAt===date;
const leafStatuses=[['healthy','건강해요'],['yellow','잎이 노래요'],['spots','반점이 있어요'],['wilted','시들었어요'],['other','기타 변화가 있어요']];
const harvestReady=p=>GardenGrowth.elapsed(p.plantedAt,day())>=meta(p).days;
function leafStatusSection(p){return `<section class="leaf-observation" aria-label="잎 상태 관찰"><div class="field-label">직접 확인한 잎 상태 <span class="count">선택</span></div><p class="help">잎을 살펴보고 해당하는 상태를 골라주세요. 사진만 기록해도 돼요.</p><div class="leaf-status-options">${leafStatuses.map(([key,label])=>`<button type="button" class="leaf-status-option ${p.draftLeafStatus===key?'active':''}" data-feature="leaf-status" data-value="${key}" aria-pressed="${p.draftLeafStatus===key}">${label}</button>`).join('')}</div>${p.draftLeafStatus==='other'?`<div class="field leaf-other-field"><label class="field-label" for="leaf-other">어떤 변화가 있었나요?</label><textarea id="leaf-other" maxlength="200" placeholder="예: 잎 끝이 갈색으로 변했어요.">${esc(p.draftLeafOther||'')}</textarea></div>`:''}</section>`}
function photoSection(photos=[]){return `<div class="field"><div class="field-label">사진 <span class="count">사진과 함께 기록해요</span></div><div class="photo-strip">${photos.map((src,i)=>`<button class="photo-thumb" data-feature="remove-photo" data-index="${i}" aria-label="사진 ${i+1} 삭제">${journalPhoto(src)}<span>×</span></button>`).join('')}<label class="photo-add"><span class="photo-add-icon" aria-hidden="true">📷</span><span class="photo-add-label">사진 추가</span><input id="feature-photo" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div></div>`}
function selectionPage(){const f=current();if(!f)return farmsPage();return `<main class="page crop-selection-page">${head('작물 선택','garden')}<p class="help">${esc(f.name)} · ${pendingPlot+1}번째 칸에 심어요</p><div class="feature-tabs">${[['seed','씨앗','씨앗부터 심어요'],['seedling','모종','모종부터 심어요']].map(([key,label,sub])=>`<button data-feature="method" data-value="${key}" class="${plantingMethod===key?'active':''}"${allowedMethods(chosenCrop).includes(key)?'':' disabled'}><b>${label}</b><small>${allowedMethods(chosenCrop).includes(key)?sub:'이 작물은 선택할 수 없어요'}</small></button>`).join('')}</div><input id="crop-search" placeholder="작물 이름을 검색하세요" value="${esc(cropQuery)}"><div class="category-tabs">${categoryTabs().map(([key,label])=>`<button data-feature="category" data-value="${key}" class="${cropCategory===key?'active':''}">${label}</button>`).join('')}</div><p class="help">수확 기간은 환경과 품종에 따라 달라요</p><div id="selection-results">${cropCards()}</div></main>${footer(`<button class="primary" data-feature="prepare">선택한 작물로 계속 (${CROPS.find(c=>c.id===chosenCrop).name} · ${plantingMethod==='seed'?'씨앗':'모종'})</button>`)}`}
function cropCards(){
  const available=CROPS.filter(c=>(cropCategory==='all'||categories[c.id]===cropCategory)&&c.name.includes(cropQuery));
  if(!available.length)return '<p class="help">검색 결과가 없어요.</p>';
  const cards=available.map(c=>`<button class="selection-card ${chosenCrop===c.id?'active':''}" data-feature="choose" data-value="${c.id}" aria-pressed="${chosenCrop===c.id}"><span class="selection-art">${CropArt.svg(c.id,5,true)}</span><b>${c.name}</b><small>수확 약 ${c.days}일 · ${CATEGORY_LABELS[categories[c.id]]||'기타'}${methodNote(c.id)}</small>${chosenCrop===c.id?'<span class="selected-mark" aria-hidden="true">✓</span>':''}</button>`).join('');
  return `<div class="selection-grid" id="selection-grid">${cards}</div>`;
}
// 되돌릴 수 없는 동작 전에 한 번 더 묻는 앱 안의 확인 창(바깥을 누르거나 Esc를 누르면 취소). 누르면 true, 취소하면 false를 돌려준다
function askConfirm({title,message,confirmLabel='확인'}){
  return new Promise(resolve=>{
    const root=document.createElement('div');
    root.className='confirm-backdrop';
    root.innerHTML=`<div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><p id="confirm-title" class="confirm-title">${esc(title)}</p>${message?`<p class="confirm-message">${esc(message)}</p>`:''}<div class="confirm-actions"><button type="button" class="confirm-cancel">취소</button><button type="button" class="confirm-ok">${esc(confirmLabel)}</button></div></div>`;
    let hostWindow=null;
    try{if(window.parent!==window&&window.frameElement&&window.parent.location.origin===location.origin)hostWindow=window.parent}catch{}
    const position=()=>{
      if(!hostWindow){root.style.inset='0';return}
      const frame=window.frameElement.getBoundingClientRect();
      const scale=frame.height/window.innerHeight||1;
      const viewport=hostWindow.visualViewport;
      const viewportTop=viewport?.offsetTop||0;
      const top=Math.max(0,(viewportTop-frame.top)/scale);
      const bottom=Math.min(window.innerHeight,(viewportTop+(viewport?.height||hostWindow.innerHeight)-frame.top)/scale);
      root.style.inset=bottom>top?`${top}px 0 ${Math.max(0,window.innerHeight-bottom)}px 0`:'0';
    };
    const onKey=e=>{if(e.key==='Escape')done(false)};
    const done=v=>{
      document.removeEventListener('keydown',onKey);
      window.removeEventListener('resize',position);
      window.removeEventListener('scroll',position);
      window.visualViewport?.removeEventListener('resize',position);
      window.visualViewport?.removeEventListener('scroll',position);
      hostWindow?.removeEventListener('scroll',position);
      hostWindow?.removeEventListener('resize',position);
      hostWindow?.visualViewport?.removeEventListener('resize',position);
      hostWindow?.visualViewport?.removeEventListener('scroll',position);
      root.remove();
      resolve(v);
    };
    root.addEventListener('click',e=>{if(e.target===root)done(false)});
    root.querySelector('.confirm-cancel').addEventListener('click',()=>done(false));
    root.querySelector('.confirm-ok').addEventListener('click',()=>done(true));
    document.addEventListener('keydown',onKey);
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,{passive:true});
    window.visualViewport?.addEventListener('resize',position);
    window.visualViewport?.addEventListener('scroll',position);
    hostWindow?.addEventListener('scroll',position,{passive:true});
    hostWindow?.addEventListener('resize',position);
    hostWindow?.visualViewport?.addEventListener('resize',position);
    hostWindow?.visualViewport?.addEventListener('scroll',position);
    document.body.append(root);
    position();
    root.querySelector('.confirm-cancel').focus();
  });
}
function preparationPage(){const ready=[0,1,2].every(i=>plantingDraft.checks.includes(i));return `<main class="page">${head('심기 전 준비','select')}<div class="seed-sign"><b>${CROPS.find(c=>c.id===chosenCrop).name}</b><small>${plantingMethod==='seed'?'씨앗':'모종'}으로 시작 · ${pendingPlot+1}번째 칸</small></div><h3>미리 해 두면 좋아요</h3>${[['흙 고르기','삽으로 흙을 부드럽게 갈아주세요'],['간격 맞추기','품종에 맞는 간격을 확인해 주세요'],['준비물 챙기기',plantingMethod==='seed'?'씨앗 · 물뿌리개 · 모종삽':'모종 · 물뿌리개 · 모종삽']].map(([label,sub],i)=>`<button class="check-card" data-feature="precheck" data-index="${i}"><span class="check-box ${plantingDraft.checks.includes(i)?'checked':''}">${plantingDraft.checks.includes(i)?'✓':''}</span><span><b>${label}</b><small>${sub}</small></span></button>`).join('')}${photoSection(plantingDraft.photos)}<div class="field"><label class="field-label" for="feature-memo">메모</label><textarea id="feature-memo" maxlength="500" placeholder="준비하면서 한 일을 적어보세요 (선택)">${esc(plantingDraft.memo)}</textarea></div><div class="info">ⓘ ${ready?'준비가 끝났어요. 아래 버튼을 누르면 오늘부터 재배가 시작돼요.':'준비 항목 3개를 모두 체크하면 작물을 심을 수 있어요.'}</div></main>${footer(`<button class="primary" data-feature="plant" ${ready?'':'disabled'}>심었어요</button>`)}`}
detailPage=function(){
  const f=current(),p=f?.plots[plotIndex];
  if(!p)return gardenPage();
  const items=careItems(p),pending=items.filter(([key])=>!completed(p,key)),days=GardenGrowth.elapsed(p.plantedAt,day()),remaining=Math.max(0,meta(p).days-days);
  const ready=harvestReady(p);
  return `<main class="page">${head(meta(p).name,'garden')}
    <div class="detail-subhead"><small>${esc(f.name)} · 심은 지 ${days+1}일</small><span class="pill">${p.harvestedAt?'수확 완료':GardenGrowth.labels[p.stage-1]+' · '+p.stage+'/5단계'}</span><button class="icon-btn" data-feature="delete-crop" aria-label="작물 삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/></svg></button></div>
    ${p.lastLeafObservation?`<div class="leaf-status-summary"><b>최근 잎 관찰 · ${esc(p.lastLeafObservation.date)}</b><span>${esc(p.lastLeafObservation.label||'사진 기록')}</span></div>`:''}
    ${p.harvestedAt?`<div class="harvest-banner"><b>수확을 마쳤어요</b><p>${esc(p.harvestedAt)}에 수확했어요. 재배일지는 계속 남길 수 있어요.</p></div>`:ready?`<div class="harvest-banner"><b>수확할 때가 됐어요</b><p>재배기간 ${meta(p).days}일을 채웠어요. 작물 상태를 살핀 뒤 수확해 주세요.</p><button class="primary" data-feature="harvest">수확하기</button></div>`:`<p class="help">수확까지 약 ${remaining}일 남았어요. 재배기간은 환경과 품종에 따라 달라질 수 있어요.</p>`}
    ${items.length?`<div class="field-label">오늘 할 일 <span class="count">완료 ${pending.length?`${items.length-pending.length} / ${items.length}`:'0 / 0'}</span></div>${pending.length?pending.map(([key,label,sub])=>`<div class="check-card"><button class="check-hit" data-feature="${key==='diagnosis'?'diagnosis':'check'}" data-value="${key}" aria-label="${label}" aria-pressed="false"><span class="check-box"></span></button><button class="task-content" data-feature="${key==='diagnosis'?'diagnosis':'check'}" data-value="${key}"><b>${label}${key==='diagnosis'?'<span class="pill">AI 상세 진단</span>':''}</b><small>${sub}</small></button></div>`).join(''):'<div class="tk-empty-task"><span class="tk-empty-icon" aria-hidden="true">🌱</span><div><strong>오늘 할 일 끝!</strong><p>지금 할 일은 모두 마쳤어요.</p></div></div>'}`:''}
    ${photoSection(p.draftPhotos)}
    <div class="field"><label class="field-label" for="feature-memo">메모</label><textarea id="feature-memo" maxlength="500" placeholder="오늘 텃밭 상태를 적어보세요 (선택)">${esc(p.draftMemo||'')}</textarea></div>
  </main>${footer('<button class="secondary diagnosis-button" data-feature="diagnosis">AI 상세 진단</button><button class="primary" data-feature="journal">일지 올리기</button>')}`};
function leafPage(){const p=current()?.plots[plotIndex];if(!p)return gardenPage();const editing=!!journalEdit&&!!journalEntries().find(r=>r.id===journalEdit)?.leaf;return `<main class="page leaf-page">${head(editing?'잎 관찰 수정':'잎 관찰하기',editing&&journalFlowOrigin==='journal'?'journal':'detail')}<p class="help">잎 사진을 찍거나 올린 뒤 상태를 기록해 주세요.</p>${photoSection(p.leafDraftPhotos||[])}${leafStatusSection(p)}<div class="info">ⓘ 사진을 올려도 자동 판정은 아직 진행되지 않아요. 기록한 내용은 재배일지에 남습니다.</div></main>${footer(`<button class="primary" data-feature="leaf-save">${editing?'수정 완료':'관찰 기록하기'}</button>`)}`}
function leafResultPage(){const p=current()?.plots[plotIndex],observation=p?.lastLeafObservation;if(!observation)return leafPage();return `<main class="page leaf-result-page">${head('잎 관찰 결과',journalFlowOrigin==='journal'?'journal':'garden')}<span class="pill">관찰 완료</span><div class="leaf-result-image">${observation.photo?`<img src="${esc(observation.photo)}" alt="기록한 잎 사진">`:'<span aria-hidden="true">🌿</span>'}</div><div class="leaf-result-card"><b>${observation.label?esc(observation.label):'잎 사진을 기록했어요'}</b><p>${esc(observation.date)}에 직접 관찰한 내용이에요. AI 판정 결과는 아직 연결되지 않았어요.</p></div><p class="help">상태가 달라지면 다시 관찰해 기록할 수 있어요.</p></main>${footer(`<button class="primary" data-feature="diagnosis">AI 진단 화면 보기</button><button class="secondary" data-feature="observe">다시 관찰하기</button><button class="secondary" data-feature="leaf-back">${journalFlowOrigin==='journal'?'재배일지로 돌아가기':'텃밭으로 돌아가기'}</button>`)}`}
const baseExtraPage=extraPage;
extraPage=function(){if(view==='leaf')return leafPage();if(view==='leaf-result')return leafResultPage();return baseExtraPage()};
tasksPage=function(){const date=taskMode==='calendar'?taskDate:day();return `<main class="page">${head('오늘 할 일',tasksBack==='garden'&&current()?'garden':'farms')}<div class="feature-tabs">${[['list','목록'],['calendar','캘린더']].map(([key,label])=>`<button data-feature="task-mode" data-value="${key}" class="${taskMode===key?'active':''}">${label}</button>`).join('')}</div>${taskMode==='calendar'?`<label class="field-label" for="task-date">날짜 선택</label><input id="task-date" type="date" value="${date}" max="${day()}">`:''}${state.farms.map(f=>{const tasks=f.plots.flatMap((p,i)=>p&&p.plantedAt<=date&&(!p.harvestedAt||date<=p.harvestedAt)?careItems(p,date).filter(([key])=>!completed(p,key,date)).map(([key,label,sub])=>({p,i,key,label,sub})):[]);return `<h3>${esc(f.name)} <span class="task-count">${tasks.length}</span></h3>${tasks.length?tasks.map(t=>`<button class="check-card" data-feature="open-task" data-id="${esc(f.id)}" data-index="${t.i}"><span class="check-box"></span><span><b>${t.label}</b><small>${meta(t.p).name} · ${t.sub}</small></span><span class="chevron">›</span></button>`).join(''):'<div class="no-tasks">이 날짜에 남은 할 일이 없어요</div>'}`}).join('')}<p class="help">할 일을 누르면 작물 관리 화면으로 이동해요.</p></main>`};
app.addEventListener('input',e=>{if(e.target.id==='crop-search'){cropQuery=e.target.value;document.querySelector('#selection-results').innerHTML=cropCards()}if(e.target.id==='feature-memo'){if(view==='prepare')plantingDraft.memo=e.target.value;else if(view==='detail')current().plots[plotIndex].draftMemo=e.target.value}if(e.target.id==='leaf-other'&&view==='leaf')current().plots[plotIndex].draftLeafOther=e.target.value});
app.addEventListener('change',async e=>{if(e.target.id==='task-date'){taskDate=e.target.value;render()}if(e.target.id!=='feature-photo')return;const farm=current(),p=(view==='detail'||view==='leaf')?farm.plots[plotIndex]:plantingDraft;const preparing=view==='prepare';const photos=preparing?p.photos:view==='leaf'?(p.leafDraftPhotos||=[]):(p.draftPhotos||=[]);try{for(const file of Array.from(e.target.files).slice(0,4-photos.length)){if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('JPG, PNG, WEBP 사진을 선택해 주세요.');continue}if(file.size>10*1024*1024){toast('사진은 10MB 이하로 선택해 주세요.');continue}const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const preview=canvas.toDataURL('image/jpeg',.7);await window.GardenOriginalPhotos.save(preview,file);photos.push(preview)}if(view==='detail'||view==='leaf')save();if(current()===farm&&(preparing?view==='prepare':(view==='detail'||view==='leaf')&&farm.plots[plotIndex]===p))render()}catch(error){toast(error.message||'사진을 읽지 못했어요. 다른 사진을 선택해 주세요.')}});
app.addEventListener('click',e=>{const b=e.target.closest('[data-feature]');if(!b)return;const p=current()?.plots[plotIndex];switch(b.dataset.feature){case 'harvest':{if(!p||!harvestReady(p)||p.harvestedAt)return;if(confirm(`${meta(p).name} 수확을 기록할까요?`)){p.harvestedAt=day();addRecord(current(),p,'수확을 마쳤어요.');save();render()}break}case 'method':if(allowedMethods(chosenCrop).includes(b.dataset.value)){plantingMethod=b.dataset.value;render()}break;case 'category':cropCategory=b.dataset.value;render();break;case 'choose':{chosenCrop=b.dataset.value;const m=allowedMethods(chosenCrop);if(!m.includes(plantingMethod))plantingMethod=m[0];render();break}case 'prepare':if(!allowedMethods(chosenCrop).includes(plantingMethod)){toast('이 작물은 선택한 방식으로 심을 수 없어요.');break}navigate('prepare');break;case 'precheck':{const i=Number(b.dataset.index);plantingDraft.checks=plantingDraft.checks.includes(i)?plantingDraft.checks.filter(x=>x!==i):[...plantingDraft.checks,i];render();break}case 'plant':{if(!(typeof isTaskKind==='function'&&isTaskKind(chosenCrop))&&![0,1,2].every(i=>plantingDraft.checks.includes(i))){toast('심기 전 준비 항목을 모두 체크해 주세요.');break}if(current().plots[pendingPlot]){toast('이미 작물이 심어진 칸이에요.');navigate('garden');break}const next=crop(chosenCrop,plantingMethod==='seed'?1:3,true);next.method=plantingMethod;current().plots[pendingPlot]=next;addRecord(current(),next,plantingDraft.memo.trim());state.records.at(-1).event='planting';state.records.at(-1).plantingMethod=plantingMethod;state.records.at(-1).photos=plantingDraft.photos;journalMarkPlantingRecord(state.records.length-1,plantingMethod);plantingDraft={checks:[],photos:[],memo:''};plotIndex=pendingPlot;save();navigate('garden');break}case 'check':{if(!p||p.harvestedAt&&day()>p.harvestedAt)return;const key=b.dataset.value;if(key==='observe'){navigate('leaf');break}p.taskChecks||={};const checks=p.taskChecks[day()]||=[];p.taskChecks[day()]=checks;if(completed(p,key)){p.taskChecks[day()]=checks.filter(x=>x!==key);if(key==='water')p.wateredAt=null}else{checks.push(key);if(key==='water'){p.wateredAt=day();p.needsWater=false}}save();render();break}case 'observe':{if(!p)break;const existing=journalTodayEntry('leaf',current(),p);if(existing)journalBegin(existing.id,view==='leaf-result'?journalFlowOrigin:'garden');else{journalEdit=null;journalFlowOrigin=view==='leaf-result'?journalFlowOrigin:'garden';navigate('leaf')}break}case 'leaf-status':{if(!p||!leafStatuses.some(([key])=>key===b.dataset.value))break;p.draftLeafStatus=b.dataset.value;save();render();break}case 'remove-photo':(view==='prepare'?plantingDraft.photos:view==='leaf'?p.leafDraftPhotos:p.draftPhotos).splice(Number(b.dataset.index),1);if(view==='leaf'||view==='detail')save();render();break;case 'leaf-save':{if(!p)break;const label=leafStatuses.find(([key])=>key===p.draftLeafStatus)?.[1],detail=p.draftLeafStatus==='other'?p.draftLeafOther?.trim():'',photos=p.leafDraftPhotos||[];if(!label&&!photos.length){toast('잎 사진을 추가하거나 상태를 선택해 주세요.');break}if(p.draftLeafStatus==='other'&&!detail){toast('관찰한 변화를 입력해 주세요.');document.querySelector('#leaf-other')?.focus();break}const description=detail?`${label}: ${detail}`:label||'';if(journalEdit&&journalEntries().find(r=>r.id===journalEdit)?.leaf){if(journalUpdateSpecial('leaf',description||journalEntries().find(r=>r.id===journalEdit)?.leaf,photos,detail,null)){p.lastLeafObservation={date:day(),label:description,photo:photos[0]||''};if(label)p.lastLeafStatus={key:p.draftLeafStatus,label:description,date:day()};p.draftLeafStatus=null;p.draftLeafOther='';p.leafDraftPhotos=[];save();navigate('leaf-result')}break}p.lastLeafObservation={date:day(),label:description,photo:photos[0]||''};if(label)p.lastLeafStatus={key:p.draftLeafStatus,label:description,date:day()};addRecord(current(),p,description?`잎 관찰: ${description}`:'잎 사진을 기록했어요.');state.records.at(-1).photos=photos;p.taskChecks||={};const checks=p.taskChecks[day()]||[];p.taskChecks[day()]=checks;if(!checks.includes('observe'))checks.push('observe');p.draftLeafStatus=null;p.draftLeafOther='';p.leafDraftPhotos=[];save();navigate('leaf-result');break}case 'leaf-back':navigate(journalFlowOrigin==='journal'?'journal':'garden');break;case 'journal':{const memo=p.draftMemo?.trim();if(!memo&&!p.draftPhotos?.length){toast('메모나 사진을 추가해 주세요.');return}addRecord(current(),p,memo||'오늘의 작물 사진을 남겼어요.');state.records.at(-1).photos=p.draftPhotos||[];p.draftMemo='';p.draftPhotos=[];save();render();toast('재배일지에 저장했어요.');break}case 'diagnosis':{const existing=p&&journalTodayEntry('diagnosis',current(),p);if(existing)journalBegin(existing.id,view==='leaf-result'?journalFlowOrigin:'garden');else if(p&&window.parent!==window){journalEdit=null;journalFlowOrigin=view==='leaf-result'?journalFlowOrigin:'garden';window.parent.postMessage({type:'garden:navigate',to:'/diagnosis',farmId:current().id,plotNumber:plotIndex+1},window.location.origin)}break}case 'delete-crop':{const farm=current(),index=plotIndex;askConfirm({title:'작물을 삭제할까요?',message:'남긴 일지는 유지돼요.',confirmLabel:'삭제'}).then(ok=>{if(!ok||!farm)return;if(!journalArchiveRemovedCrop(farm,p,index))return;farm.plots[index]=null;save();navigate('garden')});break}case 'open-task':selected=b.dataset.id;plotIndex=Number(b.dataset.index);navigate('detail');break;case 'task-mode':taskMode=b.dataset.value;render();break}});
const originalJournalPage=journalPage;
journalPage=function(){const html=originalJournalPage();let i=state.records.length;return html.replace(/<\/article>/g,()=>{const r=state.records[--i];return `${r.photos?.length?`<div class="photo-strip">${r.photos.map(src=>`<img class="journal-photo" src="${esc(src)}" alt="재배 기록 사진">`).join('')}</div>`:''}</article>`})};
function journalDemoEditPage(){
  const r=journalEntries().find(entry=>entry.id===journalEdit);
  if(!r)return journalPage();
  const leaf=!!r.leaf;
  const symptoms=[['yellow','잎이 변색'],['wilted','시듦'],['spots','잎의 반점'],['holes','구멍'],['slow','성장 느림'],['fruit','과실 이상'],['other','기타']];
  return `<main class="page jr-write-page"><header class="page-head"><div class="back-title"><button class="icon-btn" data-action="nav" data-to="journal" aria-label="뒤로 가기">‹</button><h1>${leaf?'잎 관찰 수정':'AI 진단 수정'}</h1></div></header><p class="help">${esc(r.crop)} · ${esc(r.farm)}</p>${leaf?`<div class="field-label">직접 확인한 잎 상태</div><div class="leaf-status-options">${leafStatuses.map(([key,label])=>`<button type="button" class="leaf-status-option ${journalDraft.memo===label?'active':''}" data-jr="demo-leaf-status" data-value="${key}" aria-pressed="${journalDraft.memo===label}">${label}</button>`).join('')}</div><div class="field"><label class="field-label" for="jr-demo-detail">관찰 메모</label><textarea id="jr-demo-detail" maxlength="500">${esc(journalDraft.detail||'')}</textarea></div>`:`<div class="field-label">선택한 증상</div><div class="leaf-status-options">${symptoms.map(([key,label])=>`<button type="button" class="leaf-status-option ${journalDraft.symptoms.includes(key)?'active':''}" data-jr="demo-symptom" data-value="${key}" aria-pressed="${journalDraft.symptoms.includes(key)}">${label}</button>`).join('')}</div><div class="field"><label class="field-label" for="jr-demo-result">기록된 진단 결과</label><textarea id="jr-demo-result" maxlength="500">${esc(journalDraft.memo)}</textarea></div>`}<div class="field"><div class="field-label">사진</div><div class="jr-uploads">${journalDraft.photos.map((src,i)=>`<button data-jr="remove-photo" data-index="${i}" aria-label="사진 ${i+1} 삭제"><img src="${esc(src)}" alt="첨부 사진"><span>×</span></button>`).join('')}<label><span class="jr-photo-add-icon" aria-hidden="true">📷</span><small>사진 추가</small><input id="jr-photo" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div></div></main>${footer('<button class="primary" data-jr="demo-save">수정 완료</button>')}`;
}
function journalDemoSave(){
  const r=journalEntries().find(entry=>entry.id===journalEdit);
  if(!r)return;
  const value=journalDraft.memo.trim();
  if(!value){toast('내용을 입력해 주세요.');return}
  journalUpdateSpecial(r.leaf?'leaf':'diagnosis',value,journalDraft.photos,journalDraft.detail,'journal');
}
document.addEventListener('click',e=>{const picker=document.querySelector('.jr-farm-picker[open]');if(picker&&!picker.contains(e.target))picker.open=false});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const picker=document.querySelector('.jr-farm-picker[open]');if(picker){picker.open=false;picker.querySelector('summary')?.focus()}});
app.addEventListener('wheel',e=>{const strip=e.target.closest?.('.jr-filters');if(!strip||strip.scrollWidth<=strip.clientWidth)return;const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;const next=Math.max(0,Math.min(strip.scrollWidth-strip.clientWidth,strip.scrollLeft+delta));if(next===strip.scrollLeft)return;e.preventDefault();strip.scrollLeft=next},{passive:false});
if(!window.GARDEN_DEFER_RENDER)render();

// 재배일지 예시 UI: 작성·수정 내용은 이 브라우저에만 보관하고 서버 상태는 변경하지 않는다.
const journalStorageKey=`${STORAGE_KEY}-journal-preview`;
let journalLocal={entries:[],overrides:{},taskHistory:{}};
try{const stored=JSON.parse(localStorage.getItem(journalStorageKey));if(stored&&Array.isArray(stored.entries)&&stored.overrides&&typeof stored.overrides==='object')journalLocal=stored}catch{}
journalLocal.taskHistory||={};
journalLocal.plotRefs||={};
function journalPlotCandidates(r){
  const farm=state.farms.find(f=>f.name===r.farm),date=journalDayKey(r.date);
  return farm?.plots.flatMap((p,i)=>p&&meta(p)?.name===r.crop&&(!p.plantedAt||journalDayKey(p.plantedAt)<=date)&&(!p.harvestedAt||journalDayKey(p.harvestedAt)>=date)?[{farm,plant:p,index:i}]:[])||[];
}
function journalPlotRef(r){
  if(r.plotRef)return r.plotRef;
  const candidates=journalPlotCandidates(r);
  return candidates.length===1?`${candidates[0].farm.id}:${candidates[0].index+1}`:'';
}
function journalPlotLabel(r){const ref=journalPlotRef(r),number=Number(ref.split(':').at(-1));return ref&&Number.isInteger(number)&&number>0?`${number}번 칸`:'칸 미확인'}
function journalCropKey(r){return `${journalPlotRef(r)||`unknown|${r.farm}|${r.crop}`}|${r.plantingId||r.archiveCycleId||'current'}`}
function journalMarkRecordPlot(index,f,p){
  const position=f.plots.indexOf(p);
  if(position<0)return;
  const r=state.records[index];
  r.plotRef=`${f.id}:${position+1}`;
  if(p.plantingId)r.plantingId=p.plantingId;
  journalLocal.plotRefs[`base-${index}`]={ref:`${f.id}:${position+1}`,farm:r.farm,crop:r.crop,date:r.date};
  journalPersist();
}
function journalMarkPlantingRecord(index,method){
  const id=`base-${index}`;
  state.records[index].event='planting';
  state.records[index].plantingMethod=method;
  journalLocal.overrides[id]={...(journalLocal.overrides[id]||{}),event:'planting',plantingMethod:method};
  journalPersist();
}
function journalBasePlotRef(r,i){
  const saved=journalLocal.plotRefs[`base-${i}`];
  return saved&&saved.farm===r.farm&&saved.crop===r.crop&&saved.date===r.date?saved.ref:'';
}
function journalPreferredFarm(){try{const resume=JSON.parse(sessionStorage.getItem('garden-resume'));if(Date.now()-resume?.at<1800000)return state.farms.find(f=>f.id===resume.selected)?.name||current()?.name||'all'}catch{}return current()?.name||'all'}
let journalFarm=journalPreferredFarm(),journalTab='active',journalCrop='all';
try{const key=`${journalStorageKey}-focus`,focus=JSON.parse(sessionStorage.getItem(key));if(focus&&Date.now()-focus.at<300000){journalFarm=focus.farm||'all';journalTab=focus.archived?'archived':'active';sessionStorage.removeItem(key)}}catch{}
let journalOpen=new Set(),journalMenu=null,journalEdit=null,journalFlowOrigin='garden',journalDraft={farm:'',crop:'',memo:'',photos:[]};
function closeJournalMenu(){if(journalMenu===null)return;journalMenu=null;render()}
document.addEventListener('click',event=>{
  if(journalMenu===null||event.target.closest?.('[data-jr="menu"], .jr-menu'))return;
  closeJournalMenu();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeJournalMenu()});
window.addEventListener('blur',closeJournalMenu);
function journalPlantingRecord(r,i){
  if(r.event==='planting')return {event:'planting',plantingMethod:r.plantingMethod};
  if(!String(r.text||'').trim()&&!(r.photos||[]).length)return {event:'planting',plantingMethod:journalLocal.overrides[`base-${i}`]?.plantingMethod};
  const ref=journalBasePlotRef(r,i)||journalLocal.overrides[`base-${i}`]?.plotRef||journalPlotRef(r),date=journalDayKey(r.date);
  const matches=journalPlotCandidates(r).filter(({farm,plant,index})=>journalDayKey(plant.plantedAt)===date&&(!ref||ref===`${farm.id}:${index+1}`));
  if(matches.length!==1)return {};
  const {farm,plant,index}=matches[0],plotRef=`${farm.id}:${index+1}`;
  if(state.records.slice(0,i).some((previous,j)=>!journalLocal.overrides[`base-${j}`]?.archiveCycleId&&(!r.plantingId||!previous.plantingId||previous.plantingId===r.plantingId)&&previous.farm===r.farm&&previous.crop===r.crop&&journalDayKey(previous.date)===date&&(journalBasePlotRef(previous,j)||journalLocal.overrides[`base-${j}`]?.plotRef||journalPlotRef(previous))===plotRef))return {};
  return {event:'planting',plantingMethod:plant.method};
}
function journalEntries(){const base=state.records.map((r,i)=>({id:`base-${i}`,...r,photos:r.photos||[],plotRef:journalBasePlotRef(r,i)||r.plotRef||'',...journalPlantingRecord(r,i),...journalLocal.overrides[`base-${i}`]}));const seen=new Set();return [...base,...journalLocal.entries].filter(r=>!r.hidden).map(journalSeparateObservations).filter(r=>{const kind=r.leaf?'leaf':r.diagnosis?'diagnosis':null;if(!kind)return true;const key=`${journalDayKey(r.date)}|${r.farm}|${r.crop}|${journalCropKey(r)}|${kind}${r.diagnosisRequestId?`|${r.diagnosisRequestId}`:''}`;if(seen.has(key))return false;seen.add(key);return true})}
// 텃밭 선택에는 지금 있는 텃밭만 보인다. 삭제한 텃밭의 기록은 '지난 재배'의 '전체 텃밭'에 모인다(journalArchived)
function journalFarms(){return [...new Set(state.farms.map(f=>f.name).filter(Boolean))]}
function journalArchived(r){if(r.archiveCycleId)return true;const f=state.farms.find(f=>f.name===r.farm),ref=journalPlotRef(r),date=journalDayKey(r.date);if(!f)return true;if(ref){const [farmId,position]=ref.split(':'),p=f.id===farmId?f.plots[Number(position)-1]:null;return !p||r.plantingId&&p.plantingId&&r.plantingId!==p.plantingId||meta(p)?.name!==r.crop||!!p.harvestedAt||!!p.plantedAt&&journalDayKey(p.plantedAt)>date}return !f.plots.some(p=>p&&meta(p)?.name===r.crop&&!p.harvestedAt&&(!p.plantedAt||journalDayKey(p.plantedAt)<=date))}
function journalDateLabel(value){const d=new Date(value);if(!Number.isNaN(d.getTime()))return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric'}).format(d);const match=String(value||'').match(/\d{4}\.\s*(\d{1,2})\.\s*(\d{1,2})/);return match?`${Number(match[1])}월 ${Number(match[2])}일`:String(value||'오늘')}
function journalPersist(){try{localStorage.setItem(journalStorageKey,JSON.stringify(journalLocal));return true}catch{toast('사진 용량이 커서 이 브라우저에 저장하지 못했어요.');return false}}
function journalDayKey(value){const d=new Date(value);if(String(value||'').includes('T')&&!Number.isNaN(d.getTime()))return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);const match=String(value||'').match(/^(\d{4})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})/);if(match)return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;return Number.isNaN(d.getTime())?String(value||''):new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function journalCaptureTasks(f,p,titles,previousCount=state.records.length){
  const position=f.plots.indexOf(p);
  if(position<0)return;
  const ref=`${f.id}:${position+1}`,date=day();
  const index=state.records.findLastIndex((r,i)=>i>=previousCount&&r.farm===f.name&&r.crop===meta(p).name&&journalDayKey(r.date)===date&&!journalLocal.plotRefs[`base-${i}`]);
  if(index>=0)journalMarkRecordPlot(index,f,p);
  if(!titles.length)return;
  const key=`${date}|${ref}`,before=[...(journalLocal.taskHistory[key]||[])];
  journalLocal.taskHistory[key]=[...new Set([...before,...titles])];
  if(!journalPersist())journalLocal.taskHistory[key]=before;
}
function journalTaskTitles(r){
  if(r.archivedTags)return r.archivedTags;
  const date=journalDayKey(r.date),ref=journalPlotRef(r),farm=state.farms.find(f=>f.name===r.farm);
  const legacyKey=`${date}|${r.farm}|${r.crop}`;
  const titles=[...(r.tags||[]),...(journalLocal.taskHistory[`${date}|${ref}`]||[]),...(journalPlotCandidates(r).length===1?journalLocal.taskHistory[legacyKey]||[]:[])];
  if(r.event==='planting'){
    const kind=CROPS.find(c=>c.name===r.crop)?.id;
    const method=journalPlantingMethod(r);
    const first=method==='seed'?cropInfo?.[kind]?.plant:cropInfo?.[kind]?.transplant;
    if(first?.title)titles.push(first.title);
  }
  for(const [i,p] of (farm?.plots||[]).entries()){
    if(!p||meta(p)?.name!==r.crop||ref&&`${farm.id}:${i+1}`!==ref||p.plantedAt&&journalDayKey(p.plantedAt)>date||p.harvestedAt&&journalDayKey(p.harvestedAt)<date)continue;
    if(!ref&&journalPlotCandidates(r).length!==1)continue;
    const done=p.taskChecks?.[date]||[];
    for(const [key,label] of careItems(p,date))if(done.includes(key)||key==='water'&&p.wateredAt===date)titles.push(label);
  }
  return [...new Set(titles)];
}
function journalArchiveRemovedCrop(f,p,index){
  const ref=`${f.id}:${index+1}`,cropName=meta(p)?.name;
  const entries=journalEntries().filter(r=>r.farm===f.name&&r.crop===cropName&&journalPlotRef(r)===ref&&!journalArchived(r));
  if(!entries.length)return true;
  const before=JSON.stringify(journalLocal),cycleId=`removed-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  for(const entry of entries){
    const changes={archiveCycleId:cycleId,archivedTags:journalTaskTitles(entry)};
    if(entry.id.startsWith('base-'))journalLocal.overrides[entry.id]={...(journalLocal.overrides[entry.id]||{}),...changes};
    else Object.assign(journalLocal.entries.find(r=>r.id===entry.id)||{},changes);
  }
  for(const key of Object.keys(journalLocal.taskHistory))if(key.endsWith(`|${ref}`))delete journalLocal.taskHistory[key];
  if(!journalPersist()){journalLocal=JSON.parse(before);return false}
  return true;
}
function journalPlantingText(text){return /^\uC0C8 \uC791\uBB3C\uC744 \uC2EC\uC5C8\uC5B4\uC694\.?(?: 🌱)?$/.test(String(text||''))}
function journalPlantingMethod(r){if(r.plantingMethod==='seed'||r.plantingMethod==='seedling')return r.plantingMethod;const [farmId,position]=journalPlotRef(r).split(':'),farm=state.farms.find(f=>f.id===farmId),plant=farm?.plots[Number(position)-1];return plant?.method==='seed'||plant?.method==='seedling'?plant.method:null}
function journalSeparateObservations(r){const text=String(r.text||'');if(r.event==='planting')return {...r,text:journalPlantingText(text)||text==='오늘의 작물 사진을 남겼어요.'?'':text};if(r.leaf||r.diagnosis)return r;if(journalPlantingText(text))return {...r,event:'planting',text:''};if(text.startsWith('잎 관찰:'))return {...r,leaf:text.slice('잎 관찰:'.length).trim(),text:''};if(text==='잎 사진을 기록했어요.')return {...r,leaf:'잎 사진을 기록했어요',text:''};if(text.startsWith('AI진단 결과:'))return {...r,diagnosis:text.slice('AI진단 결과:'.length).trim(),text:''};return r}
function journalVisibleMemo(r){const text=String(r.text||'').trim();return text==='오늘의 작물 사진을 남겼어요.'?'':text}
function journalGroupRecords(records){const groups=new Map();for(const raw of records){const r=journalSeparateObservations(raw),key=`${journalDayKey(r.date)}|${r.farm}|${r.crop}|${journalPlotRef(r)||r.id}|${r.plantingId||r.archiveCycleId||'current'}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}return [...groups.entries()].map(([key,entries])=>{const tags=[...new Set(entries.flatMap(journalTaskTitles))];if(entries.length===1)return {...entries[0],tags,text:journalVisibleMemo(entries[0])};return {...entries.at(-1),id:`group-${key}`,entries,photos:entries.flatMap(r=>r.photos||[]),text:[...new Set(entries.map(journalVisibleMemo).filter(Boolean))].join('\n\n'),tags,event:entries.some(r=>r.event==='planting')?'planting':undefined,plantingMethod:entries.find(r=>r.event==='planting')?.plantingMethod,leaf:entries.map(r=>r.leaf).filter(Boolean).at(-1),leafDetail:entries.map(r=>r.leafDetail).filter(Boolean).at(-1),diagnosis:entries.map(r=>r.diagnosis).filter(Boolean).at(-1)}})}
function journalNewestFirst(records){return records.map((record,index)=>({record,index})).sort((a,b)=>journalDayKey(b.record.date).localeCompare(journalDayKey(a.record.date))||b.index-a.index).map(({record})=>record)}
function journalEditableEntries(r){
  const entries=(r.entries||[r]).filter(entry=>!entry.id?.startsWith('sample-'));
  const ordinary=entries.filter(entry=>!entry.leaf&&!entry.diagnosis);
  const planting=ordinary.filter(entry=>entry.event==='planting');
  const records=ordinary.filter(entry=>entry.event!=='planting');
  return [...planting,...(records.length?[{...records.at(-1),groupIds:records.map(entry=>entry.id)}]:[]),...entries.filter(entry=>entry.leaf||entry.diagnosis)];
}
let journalGroupEditIds=null;
function journalGroupOrdinaryRecords(groupId){
  const group=journalGroupRecords(journalEntries()).find(record=>record.id===groupId);
  return (group?.entries||[]).filter(entry=>entry.event!=='planting'&&!entry.leaf&&!entry.diagnosis);
}
function journalBeginCombined(groupId){
  const entries=journalGroupOrdinaryRecords(groupId);
  if(entries.length<2)return;
  journalBegin(entries.at(-1).id);
  journalGroupEditIds=entries.map(entry=>entry.id);
  journalDraft.memo=[...new Set(entries.map(journalVisibleMemo).filter(Boolean))].join('\n\n');
  journalDraft.photos=entries.flatMap(entry=>entry.photos||[]);
  render();
}
function journalDeleteSelected(ids){
  const entries=journalEntries(),allowed=ids.filter(id=>entries.some(entry=>entry.id===id));
  if(!allowed.length)return;
  askConfirm({title:'이 일지를 삭제할까요?',message:'삭제한 일지는 다시 볼 수 없어요.',confirmLabel:'삭제'}).then(ok=>{
    if(!ok)return;
    const before=JSON.stringify(journalLocal);
    for(const id of allowed){
      if(id.startsWith('base-'))journalLocal.overrides[id]={...(journalLocal.overrides[id]||{}),hidden:true};
      else journalLocal.entries=journalLocal.entries.filter(entry=>entry.id!==id);
    }
    if(!journalPersist())journalLocal=JSON.parse(before);
    journalMenu=null;
    render();
  });
}
function journalCard(r){const open=journalOpen.has(r.id),menu=journalMenu===r.id,photos=Array.isArray(r.photos)?r.photos:[],plantingMethod=r.event==='planting'?journalPlantingMethod(r):null,canExpand=(r.text||'').length>65||(r.text||'').includes('\n\n')||r.leaf||r.diagnosis||photos.length>3;return `<article class="jr-card"><div class="jr-card-head"><b>${esc(journalDateLabel(r.date))}</b><small>${esc(r.crop||'작물')} · ${esc(r.farm||'텃밭')} · ${esc(journalPlotLabel(r))}</small>${journalEditableEntries(r).length>1?`<em class="jr-group-count">${journalEditableEntries(r).length}개</em>`:''}${!journalEditableEntries(r).length?'':`<button data-jr="menu" data-id="${esc(r.id)}" aria-label="일지 메뉴" aria-expanded="${menu}">•••</button>`}</div>${menu?`<div class="jr-menu jr-group-menu">${journalEditableEntries(r).map(entry=>`<div class="jr-group-menu-row"><small>${entry.leaf?'잎 관찰':entry.diagnosis?'AI 진단':entry.event==='planting'?'재배 시작':'재배 기록'} · ${esc(entry.crop||'작물')}</small><div><button data-jr="edit" data-id="${esc(entry.id)}" ${entry.groupIds?.length>1?`data-group="${esc(r.id)}"`:""}>수정</button><button data-jr="delete" data-id="${esc(entry.id)}" ${entry.groupIds?.length>1?`data-group="${esc(r.id)}"`:""}>삭제</button></div></div>`).join('')}</div>`:''}<div class="jr-images">${photos.slice(0,open?photos.length:3).map(journalPhotoTile).join('')}${!photos.length&&(r.id?.startsWith('sample-')||r.event==='planting')?`<span>${r.crop==='방울토마토'?'🍅':'🌿'}</span>`:''}</div>${r.event==='planting'?`<div class="jr-planting" aria-label="재배 시작 기록"><span aria-hidden="true">🌱</span><b>${esc(r.crop||'작물')} 재배 시작</b><small>${plantingMethod==='seed'?'씨앗으로 심었어요':plantingMethod==='seedling'?'모종으로 심었어요':'심은 방식 미기록'}</small></div>`:''}${r.tags?.length?`<div class="jr-task-list"><b>오늘 한 일</b><div class="jr-tags">${r.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div></div>`:''}${r.leaf?`<section class="jr-note jr-note-leaf" aria-label="잎 관찰"><b>잎 관찰 · ${esc(r.leaf)}</b>${open?`<small>${esc(r.leafDetail||'잎 상태를 직접 기록했어요.')}</small>`:''}</section>`:''}${r.diagnosis?`<section class="jr-note jr-note-ai" aria-label="AI 진단"><b>AI진단 결과 · ${esc(String(r.diagnosis).split('\n')[0])}</b><button type="button" class="jr-diagnosis-link" data-jr="diagnosis-result" data-id="${esc((r.entries||[r]).filter(entry=>entry.diagnosis).at(-1)?.id||r.id)}">상세 결과 보기 ›</button></section>`:''}${r.text&&r.event==='planting'?'<span class="jr-memo-label">메모</span>':''}${r.text?`<p class="jr-text ${open?'open':canExpand?'':'open'}">${esc(r.text)}</p>`:''}${canExpand?`<button class="jr-expand" data-jr="expand" data-id="${esc(r.id)}" aria-expanded="${open}"><span>${open?'접기':'더 보기'}</span><svg class="jr-expand-arrow ${open?'up':''}" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>`:''}</article>`}
function journalArchiveCropKey(r){return `${r.farm}|${r.crop}|${journalCropKey(r)}`}
function journalArchiveCrops(rows){const groups=new Map();for(const r of rows){const key=journalArchiveCropKey(r);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}return [...groups.values()].map(list=>{const r=list[0],plant=state.farms.find(f=>f.name===r.farm)?.plots[Number(journalPlotRef(r).split(':').at(-1))-1],key=`group:${r.farm}|${r.crop}|${journalCropKey(r)}`,open=journalOpen.has(key),photos=list.reduce((n,x)=>n+(x.photos?.length||0),0);return `<section class="jr-archive"><div><b>${esc(r.crop||'작물')} · ${esc(journalPlotLabel(r))}</b><span>${plant?.harvestedAt?'수확 완료':'지난 재배'}</span><button type="button" class="jr-archive-delete" data-jr="delete-archive-crop" data-key="${esc(journalArchiveCropKey(r))}" aria-label="${esc(r.crop||'작물')} ${esc(journalPlotLabel(r))} 지난 재배 기록 전체 삭제" title="이 작물 기록 전체 삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/></svg></button></div><p>일지 ${list.reduce((n,r)=>n+(r.entries?.length||1),0)}개　 사진 ${photos}장</p><button class="jr-archive-expand" data-jr="expand" data-id="${esc(key)}" aria-expanded="${open}"><span>일지 모아보기</span><svg class="jr-expand-arrow ${open?'up':''}" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>${open?list.map(journalCard).join(''):''}</section>`}).join('')}
// 지난 재배는 텃밭별로 묶어서 보여 준다(지금 있는 텃밭이 먼저, 삭제한 텃밭은 뒤에 '삭제한 텃밭' 표시와 함께).
// 텃밭 제목을 눌러 펼치고 접을 수 있다. 처음에는 지금 있는 텃밭만 펼쳐져 있고 삭제한 텃밭은 접혀 있다.
let journalFarmFold={};
const journalFarmOpen=(farm,names)=>journalFarmFold[farm]??names.includes(farm);
function journalArchive(rows){const byFarm=new Map(),names=state.farms.map(f=>f.name);for(const r of rows){const farm=r.farm||'텃밭';if(!byFarm.has(farm))byFarm.set(farm,[]);byFarm.get(farm).push(r)}const order=[...byFarm.keys()].sort((a,b)=>{const ia=names.indexOf(a),ib=names.indexOf(b);return (ia<0?names.length:ia)-(ib<0?names.length:ib)});return order.map(farm=>{const list=byFarm.get(farm),open=journalFarmOpen(farm,names),crops=new Set(list.map(r=>r.crop||'작물')).size;return `<section class="jr-archive-farm"><h3><b>${esc(farm)}</b>${names.includes(farm)?'':'<span>삭제한 텃밭</span>'}<button type="button" data-jr="farm-fold" data-value="${esc(farm)}" aria-expanded="${open}" aria-label="${esc(farm)} 지난 재배 ${open?'접기':'펼치기'}"><em>작물 ${crops}종</em><svg class="jr-expand-arrow ${open?'up':''}" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button></h3>${open?journalArchiveCrops(list):''}</section>`}).join('')}
function journalRebaseBaseRecords(nextRecords){
  const nextIndex=new Map(nextRecords.map((record,index)=>[record.journalId,index]).filter(([id])=>Number.isInteger(id)));
  for(const field of ['overrides','plotRefs']){
    const old=journalLocal[field]||{},rebased={};
    for(const [key,value] of Object.entries(old)){
      const match=/^base-(\d+)$/.exec(key);
      if(!match){rebased[key]=value;continue}
      const journalId=state.records[Number(match[1])]?.journalId;
      if(nextIndex.has(journalId))rebased[`base-${nextIndex.get(journalId)}`]=value;
    }
    journalLocal[field]=rebased;
  }
}
function journalDeleteArchiveCrop(key){
  const targets=journalEntries().filter(entry=>journalArchived(entry)&&journalArchiveCropKey(entry)===key);
  if(!targets.length)return;
  const crop=targets[0];
  const serverReady=Number.isInteger(crop.plantingId)&&targets.every(entry=>entry.plantingId===crop.plantingId)&&window.parent!==window;
  askConfirm({title:`${crop.crop}의 기록을 모두 삭제할까요?`,message:`${crop.farm} · ${journalPlotLabel(crop)}의 지난 재배 기록 ${targets.length}개를 ${serverReady?'서버에서 삭제해요.':'이 브라우저에서 숨겨요.'}`,confirmLabel:'전체 삭제'}).then(async ok=>{
    if(!ok)return;
    const plantingId=crop.plantingId;
    if(serverReady){
      try{
        const result=await hostApi('deleteHistory',{plantingId});
        journalRebaseBaseRecords(result.state.records);
        const deleted=new Set(targets.map(entry=>entry.id));
        journalLocal.entries=journalLocal.entries.filter(entry=>!deleted.has(entry.id));
        journalPersist();
        journalOpen.clear();journalMenu=null;applyServerState(result.state);
      }catch(error){toast(error.message||'재배 이력을 삭제하지 못했어요.')}
      return;
    }
    const before=JSON.stringify(journalLocal);
    for(const entry of targets){
      if(entry.id.startsWith('base-'))journalLocal.overrides[entry.id]={...(journalLocal.overrides[entry.id]||{}),hidden:true};
      else journalLocal.entries=journalLocal.entries.filter(record=>record.id!==entry.id);
    }
    if(!journalPersist()){journalLocal=JSON.parse(before);return}
    journalOpen.clear();journalMenu=null;render();
  });
}
app.addEventListener('click',e=>{const b=e.target.closest('[data-jr="farm-fold"]');if(!b)return;const names=state.farms.map(f=>f.name);journalFarmFold[b.dataset.value]=!journalFarmOpen(b.dataset.value,names);render()});
journalPage=function(){const farms=journalFarms();if(journalFarm!=='all'&&!farms.includes(journalFarm))journalFarm='all';const all=journalEntries(),filtered=all.filter(r=>(journalFarm==='all'||r.farm===journalFarm)&&journalArchived(r)===(journalTab==='archived'));const crops=[...new Set(filtered.map(r=>r.crop).filter(Boolean))],rows=journalNewestFirst(journalGroupRecords(filtered.filter(r=>journalCrop==='all'||r.crop===journalCrop)));return `<main class="page jr-page"><header class="page-head jr-head"><div class="back-title"><button class="icon-btn" data-action="nav" data-to="menu" aria-label="뒤로 가기">‹</button><h1>재배일지</h1></div><div class="jr-head-actions"><button class="jr-write" data-jr="write">일지 쓰기</button></div></header><div class="jr-farm-label">텃밭 선택</div><details class="jr-farm-picker"><summary><span>${esc(journalFarm==='all'?'전체 텃밭':journalFarm)}</span><svg class="jr-farm-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="jr-farm-options" role="group" aria-label="텃밭 목록">${[['all','전체 텃밭'],...farms.map(f=>[f,f])].map(([value,label])=>`<button type="button" data-jr="farm" data-value="${esc(value)}" class="${journalFarm===value?'active':''}" aria-pressed="${journalFarm===value}"><span>${esc(label)}</span>${journalFarm===value?'<span aria-hidden="true">&#10003;</span>':''}</button>`).join('')}</div></details><div class="jr-tabs"><button data-jr="tab" data-value="active" class="${journalTab==='active'?'active':''}">진행 중</button><button data-jr="tab" data-value="archived" class="${journalTab==='archived'?'active':''}">지난 재배</button></div>${journalTab==='active'?`<div class="jr-filters">${[['all','전체'],...crops.map(crop=>[crop,crop])].map(([value,label])=>`<button data-jr="filter" data-value="${esc(value)}" class="${journalCrop===value?'active':''}">${esc(label)}</button>`).join('')}</div>`:''}${rows.length?(journalTab==='archived'?journalArchive(rows):rows.map(journalCard).join('')):`<div class="jr-empty"><b>${journalTab==='archived'?'지난 재배 기록이 없어요':'아직 재배일지가 없어요'}</b><p>일지 쓰기로 오늘의 텃밭을 기록해 보세요.</p></div>`}</main>`};
const renderJournalCard=journalCard;
journalCard=function(record){
  return renderJournalCard(record).replace(/<button data-jr="edit" data-id="([^"]+)"[^>]*>수정<\/button>/g,(button,id)=>{
    const entry=(record.entries||[record]).find(item=>esc(item.id)===id);
    return entry?.diagnosis?`<button data-jr="diagnosis-result" data-id="${id}">결과 보기</button>`:button;
  });
};
function journalCropChoices(){return state.farms.flatMap(f=>f.plots.map((p,i)=>p?{farm:f,plant:p,index:i}:null).filter(Boolean))}

function journalWritePage(){const existing=journalEdit?journalEntries().find(x=>x.id===journalEdit):null,crops=journalCropChoices().filter(x=>journalFarm==='all'||x.farm.name===journalFarm),selected=existing||crops.find(x=>`${x.farm.id}:${x.index}`===journalDraft.crop);return `<main class="page jr-write-page">${head(journalEdit?'일지 수정':'일지 쓰기','journal')}<time>${journalDateLabel(new Date())}</time><h3>${journalEdit?'작물':'어떤 작물인가요?'}</h3><div class="jr-choices">${journalEdit?`<div class="jr-choice active jr-choice-readonly"><i></i><span><b>${esc(existing?.crop||'')}</b><small>${esc(existing?.farm||'')} · ${esc(journalPlotLabel(existing))}</small></span></div>`:crops.length?crops.map(({farm,plant,index})=>{const value=`${farm.id}:${index}`,active=journalDraft.crop===value;return `<button class="jr-choice ${active?'active':''}" data-jr="crop" data-value="${esc(value)}" aria-pressed="${active}" ${journalEdit?'disabled':''}><i></i><span><b>${esc(meta(plant).name)}</b><small>${esc(farm.name)} · ${index+1}번 칸 · 심은 지 ${Math.max(1,Math.floor((new Date(day())-new Date(plant.plantedAt))/86400000)+1)}일</small></span></button>`}).join(''):'<p class="help">심은 작물이 없어요. 작물을 심은 뒤 일지를 쓸 수 있어요.</p>'}</div><div class="field"><div class="field-label">사진 <span class="count">사진을 함께 남겨요</span></div><div class="jr-uploads">${journalDraft.photos.map((src,i)=>`<button data-jr="remove-photo" data-index="${i}" aria-label="사진 ${i+1} 삭제"><img src="${esc(src)}" alt="첨부 사진"><span>×</span></button>`).join('')}<label><span class="jr-photo-add-icon" aria-hidden="true">📷</span><small>사진 추가</small><input id="jr-photo" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div></div><div class="field"><label class="field-label" for="jr-memo">메모</label><textarea id="jr-memo" maxlength="500" placeholder="오늘 텃밭 상태를 적어보세요 (선택)">${esc(journalDraft.memo)}</textarea></div></main>${footer(`<div class="jr-footer"><button class="primary" data-jr="save" ${selected?'':'disabled'}>${journalEdit?'수정 완료':'일지 올리기'}</button><small>잎 관찰·AI진단은 각 상세에서 할 수 있어요</small></div>`)}`}
function journalPhoto(src){
  const match=/^assets\/crops\/([a-z][a-z-]*-[1-4])\.png$/.exec(src);
  const bounds=match&&window.GardenCropBounds?.[match[1]];
  if(!bounds)return `<img src="${esc(src)}" alt="재배일지 사진">`;
  return `<span class="jr-crop-preview" role="img" aria-label="재배일지 작물 사진"><svg viewBox="${bounds.viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><image href="${esc(src)}" width="${bounds.width}" height="${bounds.height}"/></svg></span>`;
}
function journalPhotoTile(src){
  const image=journalPhoto(src);
  return /^data:image\//.test(src)?`<button type="button" class="jr-image-open" data-jr-photo-open aria-label="사진 확대 및 다운로드">${image}</button>`:image;
}
document.addEventListener('click',async event=>{
  const button=event.target.closest?.('[data-jr-photo-open]');
  if(!button)return;
  const preview=button.querySelector('img')?.getAttribute('src');
  if(!preview)return;
  let original=null;
  try{original=await window.GardenOriginalPhotos.load(preview)}catch{}
  const name=original?.name||'재배일지-사진.jpg';
  if(window.parent!==window){
    window.parent.postMessage({type:'garden:photo-open',blob:original?.blob||null,preview:original?null:preview,name},window.location.origin);
    return;
  }
  const url=original?.blob?URL.createObjectURL(original.blob):preview;
  const dialog=document.createElement('dialog');
  dialog.className='jr-photo-dialog';
  dialog.innerHTML=`<div><div class="jr-photo-dialog-actions"><a href="${esc(url)}" download="${esc(name)}">사진 다운로드</a><button type="button" aria-label="닫기">×</button></div><img src="${esc(url)}" alt="재배일지 사진"></div>`;
  document.body.append(dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog||e.target.closest('button'))dialog.close()});
  dialog.addEventListener('close',()=>{if(original?.blob)URL.revokeObjectURL(url);dialog.remove()});
  dialog.showModal();
});
const journalExtraPage=extraPage;
extraPage=function(){return view==='journal-write'?journalWritePage():view==='journal-demo-edit'?journalDemoEditPage():journalExtraPage()};
let journalDiagnosisResultId=null;
const journalPageWithoutDiagnosisResult=extraPage;
function journalDiagnosisResultPage(){
  const record=journalEntries().find(entry=>entry.id===journalDiagnosisResultId&&entry.diagnosis);
  if(!record)return journalPage();
  const symptomLabels={yellow:'잎이 변색',wilted:'시듦',spots:'잎의 반점',holes:'구멍',slow:'성장 느림',fruit:'과실 이상',other:'기타'};
  const symptoms=(record.diagnosisSymptoms||[]).map(key=>symptomLabels[key]||key);
  const photos=record.photos||[];
  return `<main class="page jr-write-page jr-diagnosis-result">${head('진단 결과 확인','journal')}<p class="help">${esc(record.crop||'작물')} · ${esc(record.farm||'텃밭')} · ${esc(journalDateLabel(record.date))}</p><section class="jr-diagnosis-card"><h2>진단 결과</h2><p class="jr-diagnosis-text">${esc(record.diagnosis)}</p><small>재배일지에 저장된 진단 결과입니다.</small></section>${symptoms.length?`<section class="jr-diagnosis-card"><h2>기록된 증상</h2><p>${symptoms.map(esc).join(' · ')}</p></section>`:''}${photos.length?`<section class="jr-diagnosis-card"><h2>기록된 사진</h2><div class="jr-diagnosis-photos">${photos.map((src,i)=>`<img src="${esc(src)}" alt="진단 기록 사진 ${i+1}">`).join('')}</div></section>`:''}</main>${footer('<button class="primary" data-jr="diagnosis-back">재배일지로 돌아가기</button>')}`;
}
extraPage=function(){return view==='journal-diagnosis-result'?journalDiagnosisResultPage():journalPageWithoutDiagnosisResult()};
const editJournalEntry=journalBegin;
journalBegin=function(id,origin){
  const diagnosis=id&&journalEntries().find(entry=>entry.id===id&&entry.diagnosis);
  if(diagnosis){
    if(window.parent!==window){
      window.parent.postMessage({type:'garden:navigate',to:'/diagnosis/history',cropName:diagnosis.crop,...(diagnosis.diagnosisRequestId?{requestId:diagnosis.diagnosisRequestId}:{})},window.location.origin);
      return;
    }
    journalDiagnosisResultId=id;
    journalMenu=null;
    navigate('journal-diagnosis-result');
    return;
  }
  editJournalEntry(id,origin);
};
app.addEventListener('click',event=>{
  const button=event.target.closest('[data-jr="diagnosis-result"], [data-jr="diagnosis-back"]');
  if(!button)return;
  if(button.dataset.jr==='diagnosis-back')navigate('journal');
  else journalBegin(button.dataset.id);
});
function journalTodayEntry(kind,f,p){const ref=`${f.id}:${f.plots.indexOf(p)+1}`;return journalEntries().find(r=>journalDayKey(r.date)===day()&&r.farm===f.name&&r.crop===meta(p).name&&journalPlotRef(r)===ref&&r[kind])}
function journalUpdateSpecial(kind,value,photos,detail='',returnTo='journal'){const r=journalEntries().find(x=>x.id===journalEdit);if(!r||!value?.trim()){toast('내용을 입력해 주세요.');return}const before=JSON.stringify(journalLocal),changes={text:'',photos:[...photos],...(kind==='leaf'?{leaf:value.trim(),leafDetail:detail}:{diagnosis:value.trim(),diagnosisSymptoms:[...journalDraft.symptoms]})};if(journalEdit.startsWith('base-'))journalLocal.overrides[journalEdit]={...(journalLocal.overrides[journalEdit]||{}),...changes};else{const target=journalLocal.entries.find(x=>x.id===journalEdit);if(target)Object.assign(target,changes)}if(!journalPersist()){journalLocal=JSON.parse(before);return}journalFarm=r.farm;journalTab='active';journalCrop='all';journalEdit=null;if(returnTo)navigate(returnTo);toast('기록을 수정했어요.');return true};
function journalBegin(id=null,origin='journal'){journalGroupEditIds=null;journalEdit=id;journalFlowOrigin=origin;const r=journalEntries().find(x=>x.id===id),f=r&&state.farms.find(x=>x.name===r.farm),ref=r&&journalPlotRef(r),i=ref&&f?.id===ref.split(':')[0]?Number(ref.split(':')[1])-1:-1;journalDraft={farm:r?.farm||'',crop:i>=0?`${f.id}:${i}`:'',memo:r?.leaf||r?.diagnosis||(r?journalVisibleMemo(r):''),detail:r?.leafDetail||'',symptoms:[...(r?.diagnosisSymptoms||[])],plantingMethod:r?.event==='planting'?journalPlantingMethod(r)||'':'',photos:[...(r?.photos||[])]};if(r?.leaf||r?.diagnosis){if(!f||i<0||!f.plots[i]){navigate('journal-demo-edit');return}selected=f.id;plotIndex=i;const p=f.plots[i];if(r.leaf){const status=leafStatuses.find(([,label])=>r.leaf===label||r.leaf.startsWith(label+':'));p.draftLeafStatus=status?.[0]||'other';p.draftLeafOther=status?.[0]==='other'?r.leaf.replace(/^.*?:\s*/,''):'';p.leafDraftPhotos=[...(r.photos||[])];navigate('leaf')}return}if(!id&&current()?.plots[plotIndex]&&(journalFarm==='all'||current().name===journalFarm))journalDraft.crop=`${current().id}:${plotIndex}`;navigate('journal-write')}
app.addEventListener('click',e=>{const b=e.target.closest('[data-jr]');if(!b)return;const action=b.dataset.jr,id=b.dataset.id;if(action==='write')journalBegin();else if(action==='demo-save')journalDemoSave();else if(action==='demo-leaf-status'){journalDraft.memo=leafStatuses.find(([key])=>key===b.dataset.value)?.[1]||'';render()}else if(action==='demo-symptom'){const key=b.dataset.value;journalDraft.symptoms=journalDraft.symptoms.includes(key)?journalDraft.symptoms.filter(x=>x!==key):[...journalDraft.symptoms,key];render()}else if(action==='tab'){journalTab=b.dataset.value;journalCrop='all';journalOpen.clear();render()}else if(action==='farm'){journalFarm=b.dataset.value;journalCrop='all';render()}else if(action==='filter'){const left=b.closest('.jr-filters')?.scrollLeft||0;journalCrop=b.dataset.value;render();const strip=document.querySelector('.jr-filters');if(strip)strip.scrollLeft=left}else if(action==='expand'){journalOpen.has(id)?journalOpen.delete(id):journalOpen.add(id);render()}else if(action==='menu'){journalMenu=journalMenu===id?null:id;render()}else if(action==='delete-archive-crop')journalDeleteArchiveCrop(b.dataset.key);else if(action==='edit'){if(b.dataset.group)journalBeginCombined(b.dataset.group);else journalBegin(id)}else if(action==='delete')journalDeleteSelected(b.dataset.group?journalGroupOrdinaryRecords(b.dataset.group).map(entry=>entry.id):[id]);else if(action==='crop'){if(journalEdit)return;journalDraft.crop=b.dataset.value;render()}else if(action==='remove-photo'){journalDraft.photos.splice(Number(b.dataset.index),1);render()}else if(action==='save'){const previous=journalEdit?journalEntries().find(x=>x.id===journalEdit):null,[farmId,index]=journalDraft.crop.split(':'),f=state.farms.find(x=>x.id===farmId),p=f?.plots[Number(index)];if(!previous&&!p){toast('작물을 선택해 주세요.');return}if(journalEdit&&!previous)return;const memo=journalDraft.memo.trim();if(!memo&&!journalDraft.photos.length&&!previous?.leaf&&!previous?.diagnosis&&previous?.event!=='planting'){toast('사진이나 메모를 추가해 주세요.');return}const before=JSON.stringify(journalLocal),entry={date:journalEdit?previous?.date||new Date().toISOString():new Date().toISOString(),farm:previous?.farm||f.name,crop:previous?.crop||meta(p).name,plotRef:previous?journalPlotRef(previous):journalDraft.crop.replace(/:(\d+)$/,(_,n)=>`:${Number(n)+1}`),text:memo||(previous?.leaf||previous?.diagnosis||previous?.event==='planting'?'':'오늘의 작물 사진을 남겼어요.'),photos:[...journalDraft.photos],...(previous?.event==='planting'?{event:'planting',plantingMethod:previous.plantingMethod}:{}),...(previous?.leaf?{leaf:previous.leaf}:{}),...(previous?.leafDetail?{leafDetail:previous.leafDetail}:{}),...(previous?.diagnosis?{diagnosis:previous.diagnosis}:{})};if(journalEdit?.startsWith('base-')){const override={...(journalLocal.overrides[journalEdit]||{}),...entry};delete override.date;delete override.farm;delete override.crop;journalLocal.overrides[journalEdit]=override}else if(journalEdit){const target=journalLocal.entries.find(x=>x.id===journalEdit);if(target)Object.assign(target,entry)}else state.records.push({...entry,plantingId:p?.plantingId||undefined});for(const otherId of journalGroupEditIds||[]){if(otherId===journalEdit)continue;if(otherId.startsWith('base-'))journalLocal.overrides[otherId]={...(journalLocal.overrides[otherId]||{}),hidden:true};else journalLocal.entries=journalLocal.entries.filter(record=>record.id!==otherId)}if(!journalPersist()){journalLocal=JSON.parse(before);if(!journalEdit)state.records.pop();return}if(!journalEdit)save();journalGroupEditIds=null;journalFarm=entry.farm;journalTab='active';journalCrop='all';navigate('journal');toast(journalEdit?'일지를 수정했어요.':'일지를 올렸어요.')}});
app.addEventListener('change',async e=>{if(e.target.id==='jr-farm'){journalFarm=e.target.value;journalCrop='all';render();return}if(e.target.id!=='jr-photo')return;try{for(const file of [...e.target.files].slice(0,4-journalDraft.photos.length)){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){toast('10MB 이하 JPG, PNG, WEBP 사진을 선택해 주세요.');continue}const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const preview=canvas.toDataURL('image/jpeg',.7);await window.GardenOriginalPhotos.save(preview,file);journalDraft.photos.push(preview)}render()}catch(error){toast(error.message||'사진을 읽지 못했어요. 다른 사진을 선택해 주세요.')}});
app.addEventListener('input',e=>{if(e.target.id==='jr-memo'||e.target.id==='jr-demo-result')journalDraft.memo=e.target.value;if(e.target.id==='jr-demo-detail')journalDraft.detail=e.target.value});
if(!window.GARDEN_DEFER_RENDER)render();
