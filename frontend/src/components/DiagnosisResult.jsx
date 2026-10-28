import { Link } from 'react-router-dom'

function ResultList({ title, items }) {
  const visibleItems = Array.isArray(items)
    ? items.filter(item => typeof item === 'string' && item.trim())
    : []
  if (visibleItems.length === 0) return null

  return (
    <section className="diagnosis-result-section">
      <h3>{title}</h3>
      <ul>
        {visibleItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </section>
  )
}

function ExpertGuidance() {
  return (
    <aside className="diagnosis-expert-guidance">
      가까운 시·군 농업기술센터 또는 농촌진흥기관의 공식 홈페이지에서 상담 창구를 확인해 주세요. 문의 시 작물 사진과 재배 환경 정보를 함께 준비하면 도움이 됩니다.
    </aside>
  )
}

export default function DiagnosisResult({
  result,
  cropName,
  showActions = true,
  onRetake,
}) {
  if (!result) {
    return (
      <section className="diagnosis-result-card" aria-live="polite">
        <span className="diagnosis-result-icon" aria-hidden="true">…</span>
        <h2>AI 분석 기능을 준비하고 있어요</h2>
        <p>현재는 진단 서버가 연결되지 않아 결과를 확인할 수 없습니다.</p>
        <p className="diagnosis-result-note">선택한 사진은 서버로 전송되지 않았어요.</p>
      </section>
    )
  }

  const hasDiagnosisName = typeof result.diseaseName === 'string' && result.diseaseName.trim().length > 0
  const hasUncertaintyReason = typeof result.reason === 'string' && result.reason.trim().length > 0

  if (
    result.status === 'limit'
    || (result.status === 'diagnosed' && hasDiagnosisName)
    || (result.status === 'uncertain' && hasUncertaintyReason)
  ) {
    return (
    <section className="diagnosis-flow-screen">
      <section className="diagnosis-result-card diagnosis-result-detail">
        {result.status === 'limit' ? (
          <>
            <span className="diagnosis-status-pill is-warning">외부 AI 이용 횟수 안내</span>
            <h2>AI 상세 진단 이용 횟수를 모두 사용했어요</h2>
            <p>외부 AI 상세 진단 이용 가능 횟수가 남아 있지 않아요.</p>
            {Number.isFinite(result.remainingCount) && result.remainingCount >= 0 && (
              <p>남은 외부 AI 진단 횟수: {result.remainingCount}회</p>
            )}
            {result.nextAvailableAt && (
              <p>
                다음 무료 횟수 초기화: {new Date(result.nextAvailableAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간)
              </p>
            )}
            <Link className="btn primary diagnosis-journal-link" to="/journals">재배일지 작성하기</Link>
            <ExpertGuidance />
          </>
        ) : result.status === 'uncertain' ? (
          <>
            <span className="diagnosis-status-pill is-warning">확인이 필요해요</span>
            <h2>현재 사진만으로는 판단하기 어려워요</h2>
            {cropName && <p className="diagnosis-result-crop">선택 작물: {cropName}</p>}
            {result.reason && <p>{result.reason}</p>}
            <ResultList title="추가 촬영 방법" items={result.retakeGuidance} />
            <ResultList title="추가 확인 사항" items={result.additionalChecks} />
            {showActions && <button type="button" className="btn primary" onClick={onRetake}>사진 다시 촬영하기</button>}
            <ExpertGuidance />
          </>
        ) : (
          <>
            <span className="diagnosis-status-pill">AI 분석 결과 · 의심</span>
            <p className="diagnosis-result-caution">AI가 제시한 의심 결과이며 확정 진단이 아닙니다.</p>
            {cropName && <p className="diagnosis-result-crop">선택 작물: {cropName}</p>}
            <h2>{result.diseaseName}</h2>
            <ResultList title="AI 판단 근거" items={result.evidence} />
            <ResultList title="권장 관리 방법" items={result.management} />
            <ResultList title="추가 확인 사항" items={result.additionalChecks} />
            {showActions && <>
            <button type="button" className="btn secondary" onClick={onRetake}>사진 다시 촬영하기</button>
            <Link className="btn primary diagnosis-journal-link" to="/journals">재배일지에 기록하기</Link>
            <p className="diagnosis-result-note">재배일지 작성 화면으로 이동합니다. 진단 결과를 자동으로 저장하지 않습니다.</p>
            </>}
          </>
        )}
      </section>
    </section>
    )
  }

  return (
    <section className="diagnosis-flow-screen">
    <section className="diagnosis-result-card" role="alert">
      <h2>진단 결과를 표시할 수 없어요</h2>
      <p>분석 응답 형식을 확인한 뒤 다시 시도해 주세요.</p>
      <button type="button" className="btn secondary" onClick={onRetake}>입력 화면으로 돌아가기</button>
    </section>
    </section>
  )
}
