import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, storage } from '../api.js'
import DiagnosisResult from '../components/DiagnosisResult.jsx'
import { recordDiagnosisInJournal } from '../utils/diagnosisJournal.js'
import './screens.css'
import './diagnosis.css'
import './diagnosis-history.css'

function diagnosisDay(value) {
  if (!value) return '기록 없음'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '기록 없음' : new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
  }).format(date)
}

function RecordInfo({ record, farmName, detail = false }) {
  return <dl className="diagnosis-history-info">
    {detail && <div><dt>농장명</dt><dd>{farmName || '기록 없음'}</dd></div>}
    <div><dt>작물명</dt><dd>{record.crop_name || '기록 없음'}</dd></div>
    <div><dt>진단일</dt><dd>{diagnosisDay(record.completed_at || record.created_at)}</dd></div>
    <div><dt>선택 증상</dt><dd>{record.symptoms?.length ? record.symptoms.join(', ') : '기록 없음'}</dd></div>
  </dl>
}

async function loadCropHistory(cropName) {
  const first = await api.diagnosisHistory(1, '', 50)
  const pageCount = Math.ceil(first.total / 50)
  const remaining = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => (
    api.diagnosisHistory(index + 2, '', 50)
  )))
  const items = [first, ...remaining].flatMap(result => result.items)
    .filter(record => record.crop_name === cropName)
  return { ...first, items }
}

export default function DiagnosisHistory() {
  const navigate = useNavigate()
  const { requestId } = useParams()
  const [searchParams] = useSearchParams()
  const cropName = searchParams.get('crop_name')?.trim() || ''
  const fromJournal = searchParams.get('from') === 'journal'
  const historyParams = new URLSearchParams({ ...(cropName ? { crop_name: cropName } : {}), ...(fromJournal ? { from: 'journal' } : {}) })
  const historySearch = historyParams.size ? `?${historyParams}` : ''
  const [page, setPage] = useState(1)
  const [plantingId, setPlantingId] = useState('')
  const [state, setState] = useState({ loading: true })
  const [reload, setReload] = useState(0)
  const [journalSaving, setJournalSaving] = useState(false)
  const [journalError, setJournalError] = useState('')
  const [gardenFarms, setGardenFarms] = useState([])
  const cropHistoryCache = useRef({ key: '', promise: null })
  const filterRef = useRef(null)
  const token = storage.token
  const queryKey = JSON.stringify([requestId, page, plantingId, cropName, reload, token])

  useEffect(() => { setPage(1); setPlantingId('') }, [cropName])

  useEffect(() => {
    if (!requestId || !token) return
    let cancelled = false
    api.gardenState().then(result => {
      if (!cancelled) setGardenFarms(result.state?.farms || [])
    }).catch(() => { if (!cancelled) setGardenFarms([]) })
    return () => { cancelled = true }
  }, [requestId, token])

  useEffect(() => {
    const closeOnOutsideClick = event => {
      if (filterRef.current && !filterRef.current.contains(event.target)) filterRef.current.open = false
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape' && filterRef.current?.open) {
        filterRef.current.open = false
        filterRef.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let load
    if (requestId) load = api.diagnosisRequest(requestId)
    else if (cropName) {
      const cacheKey = JSON.stringify([token, cropName, reload])
      if (cropHistoryCache.current.key !== cacheKey) {
        cropHistoryCache.current = { key: cacheKey, promise: loadCropHistory(cropName) }
      }
      load = cropHistoryCache.current.promise.then(history => {
        const records = history.items.filter(record => !plantingId || String(record.planting_id) === String(plantingId))
        return { ...history, items: records.slice((page - 1) * 10, page * 10), total: records.length, page, page_size: 10 }
      })
    } else load = api.diagnosisHistory(page, plantingId)
    load.then(data => {
      if (!cancelled) setState({ data, queryKey })
    }).catch(error => {
      if (!cancelled) setState({ queryKey, error: error.status === 404
        ? '진단 기록을 찾을 수 없습니다.' : '진단 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    })
    return () => { cancelled = true }
  }, [requestId, page, plantingId, cropName, reload, token, queryKey])

  if (!token) return <Navigate to="/" replace />
  const loading = state.queryKey !== queryKey
  const { data, error } = loading ? {} : state
  const completed = data?.status === 'completed' && !data?.isDemo
    && ['diagnosed', 'uncertain'].includes(data?.outcome) && data?.result
  const farmName = requestId && data ? gardenFarms.find(farm =>
    (farm.plots || []).some(plant => plant && String(plant.plantingId) === String(data.planting_id)),
  )?.name || gardenFarms.find(farm => farm.id === data.result?.metadata?.farm_client_id)?.name : ''
  const visiblePlantings = !requestId ? (data?.plantings ?? []).filter(plant => !cropName || plant.crop_name === cropName) : []
  const selectedPlanting = visiblePlantings.find(plant => String(plant.planting_id) === String(plantingId))
  const allPlantingsLabel = cropName ? `${cropName} 전체 재배` : '전체 작물'
  const plantingLabel = plant => `${plant.crop_name || '작물명 기록 없음'} · 재배 #${plant.planting_id}`

  function selectPlanting(id) {
    setPlantingId(String(id))
    setPage(1)
    if (filterRef.current) filterRef.current.open = false
  }

  async function saveDiagnosisToJournal() {
    if (!completed || journalSaving) return
    setJournalSaving(true)
    setJournalError('')
    try {
      const [me, gardenState] = await Promise.all([api.me(), api.gardenState().catch(() => null)])
      recordDiagnosisInJournal({ userId: me.id, record: data, gardenState, localStore: localStorage, sessionStore: sessionStorage })
      navigate('/journals')
    } catch {
      setJournalError('재배일지에 기록하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setJournalSaving(false)
    }
  }

  return <main className="screen diagnosis-screen diagnosis-history-screen">
    <header className="screen-header journal-aligned-header">
      <div className="journal-aligned-title">
        <Link className="icon-btn journal-aligned-back" to={requestId ? `/diagnosis/history${historySearch}` : fromJournal ? '/journals' : '/menu'} aria-label="뒤로 가기" />
        <h1 className="screen-title">{requestId ? 'AI 진단 상세 결과' : '나의 AI 진단 이력'}</h1>
      </div>
    </header>
    {loading && <p className="diagnosis-history-feedback" role="status">진단 이력을 불러오는 중이에요.</p>}
    {error && <div className="diagnosis-card diagnosis-history-feedback" role="alert"><p>{error}</p><button className="btn secondary" onClick={() => setReload(value => value + 1)}>다시 시도</button></div>}
    {!requestId && cropName && <p className="diagnosis-history-selected-crop">{cropName} 진단 이력 <Link to="/diagnosis/history">전체 작물 보기</Link></p>}
    {!loading && !error && data && (requestId ? (
      completed ? <>
        <section className="diagnosis-card">
          <RecordInfo record={data} farmName={farmName} detail />
          <p className="diagnosis-history-description">추가 설명: {data.description || '기록 없음'}</p>
        </section>
        <DiagnosisResult result={data.result} cropName={data.crop_name} showActions={false} />
        <button type="button" className="btn primary diagnosis-history-journal-action" onClick={saveDiagnosisToJournal} disabled={journalSaving}>
          {journalSaving ? '기록하는 중…' : '재배일지에 기록하기'}
        </button>
        {journalError && <p className="diagnosis-history-feedback" role="alert">{journalError}</p>}
      </> : <p className="diagnosis-history-feedback" role="status">완료된 AI 진단 결과가 없습니다.</p>
    ) : <>
      <div className="diagnosis-history-filter">
        <span id="diagnosis-history-filter-label">작물별 보기</span>
        <details className="diagnosis-history-filter-picker" ref={filterRef}>
          <summary aria-labelledby="diagnosis-history-filter-label">
            <span>{selectedPlanting ? plantingLabel(selectedPlanting) : allPlantingsLabel}</span>
            <span className="diagnosis-history-filter-chevron" aria-hidden="true" />
          </summary>
          <div className="diagnosis-history-filter-options" role="group" aria-label="작물별 보기 선택">
            <button type="button" className={!plantingId ? 'is-selected' : ''} aria-pressed={!plantingId} onClick={() => selectPlanting('')}>{allPlantingsLabel}</button>
            {visiblePlantings.map(plant => {
              const selected = String(plant.planting_id) === String(plantingId)
              return <button key={plant.planting_id} type="button" className={selected ? 'is-selected' : ''} aria-pressed={selected} onClick={() => selectPlanting(plant.planting_id)}>{plantingLabel(plant)}</button>
            })}
          </div>
        </details>
      </div>
      {data.items.length === 0 ? <section className="diagnosis-card diagnosis-history-empty">
        <p>{plantingId || cropName ? '선택한 작물의 AI 진단 이력이 없습니다' : '아직 AI 진단 이력이 없습니다'}</p>
        <Link className="btn primary" to="/diagnosis?mode=detail">AI 상세 진단하기</Link>
      </section> : <>
        <p className="diagnosis-history-count">총 {data.total}건</p>
        <ul className="diagnosis-history-list">
          {data.items.map(record => <li key={record.request_id}>
            <Link className="diagnosis-card diagnosis-history-record" to={`/diagnosis/history/${encodeURIComponent(record.request_id)}${historySearch}`}>
              <span className="diagnosis-status-pill">{record.outcome === 'uncertain' ? '판단 어려움' : '진단 완료'}</span>
              <RecordInfo record={record} />
              <p className="diagnosis-history-description">{record.result?.disease_name || record.result?.reason || '결과 요약 기록 없음'}</p>
              <span className="diagnosis-history-link">상세 결과 보기 ›</span>
            </Link>
          </li>)}
        </ul>
      </>}
      {data.total > 0 && <nav className="diagnosis-history-pagination" aria-label="진단 이력 페이지">
        <button className="btn secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>이전</button>
        <span aria-live="polite">{page} / {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
        <button className="btn secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(value => value + 1)}>다음</button>
      </nav>}
    </>)}
  </main>
}
