import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, storage } from '../api.js'
import DiagnosisResult from '../components/DiagnosisResult.jsx'
import './screens.css'
import './diagnosis.css'
import './diagnosis-history.css'

function diagnosisDate(value) {
  if (!value) return '기록 없음'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '기록 없음' : date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

function RecordInfo({ record }) {
  return <div className="diagnosis-history-info">
    <p>작물명: {record.crop_name || '기록 없음'}</p>
    <p>진단 일시: {diagnosisDate(record.completed_at || record.created_at)} (한국 시간)</p>
    <p>선택 증상: {record.symptoms?.length ? record.symptoms.join(', ') : '기록 없음'}</p>
  </div>
}

export default function DiagnosisHistory() {
  const { requestId } = useParams()
  const [page, setPage] = useState(1)
  const [plantingId, setPlantingId] = useState('')
  const [state, setState] = useState({ loading: true })
  const [reload, setReload] = useState(0)
  const token = storage.token
  const queryKey = JSON.stringify([requestId, page, plantingId, reload, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = requestId ? api.diagnosisRequest(requestId) : api.diagnosisHistory(page, plantingId)
    load.then(data => {
      if (!cancelled) setState({ data, queryKey })
    }).catch(error => {
      if (!cancelled) setState({ queryKey, error: error.status === 404
        ? '진단 기록을 찾을 수 없습니다.' : '진단 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    })
    return () => { cancelled = true }
  }, [requestId, page, plantingId, reload, token, queryKey])

  if (!token) return <Navigate to="/" replace />
  const loading = state.queryKey !== queryKey
  const { data, error } = loading ? {} : state
  const completed = data?.status === 'completed' && !data?.isDemo
    && ['diagnosed', 'uncertain'].includes(data?.outcome) && data?.result

  return <main className="screen diagnosis-screen diagnosis-history-screen">
    <header className="screen-header">
      <Link className="icon-btn" to={requestId ? '/diagnosis/history' : '/menu'} aria-label="뒤로 가기">‹</Link>
      <h1 className="screen-title">{requestId ? 'AI 진단 상세 결과' : '나의 AI 진단 이력'}</h1>
      <span className="icon-btn-spacer" aria-hidden="true" />
    </header>
    {loading && <p role="status">진단 이력을 불러오는 중이에요.</p>}
    {error && <div role="alert"><p>{error}</p><button className="btn secondary" onClick={() => setReload(value => value + 1)}>다시 시도</button></div>}
    {!loading && !error && data && (requestId ? (
      completed ? <>
        <section className="diagnosis-card">
          <RecordInfo record={data} />
          <p className="diagnosis-history-description">추가 설명: {data.description || '기록 없음'}</p>
        </section>
        <DiagnosisResult result={data.result} cropName={data.crop_name} showActions={false} />
      </> : <p role="status">완료된 AI 진단 결과가 없습니다.</p>
    ) : <>
      <label className="diagnosis-history-filter">작물별 보기
        <select value={plantingId} onChange={event => { setPlantingId(event.target.value); setPage(1) }}>
          <option value="">전체 작물</option>
          {data.plantings.map(plant => <option key={plant.planting_id} value={plant.planting_id}>
            {plant.crop_name || '작물명 기록 없음'} · 재배 #{plant.planting_id}
          </option>)}
        </select>
      </label>
      {data.items.length === 0 ? <section className="diagnosis-card">
        <p>{plantingId ? '선택한 작물의 AI 진단 이력이 없습니다' : '아직 AI 진단 이력이 없습니다'}</p>
        <Link className="btn primary" to="/diagnosis?mode=detail">AI 상세 진단하기</Link>
      </section> : <>
        <p>총 {data.total}건</p>
        <ul className="diagnosis-history-list">
          {data.items.map(record => <li key={record.request_id}>
            <Link className="diagnosis-card diagnosis-history-record" to={`/diagnosis/history/${encodeURIComponent(record.request_id)}`}>
              <span className="diagnosis-status-pill">{record.outcome === 'uncertain' ? '판단 어려움' : '진단 완료'}</span>
              <RecordInfo record={record} />
              <p className="diagnosis-history-description">{record.result?.disease_name || record.result?.reason || '결과 요약 기록 없음'}</p>
              <span>상세 결과 보기 ›</span>
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
