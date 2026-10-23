export default function DiagnosisLoading({
  source,
  onChooseDemoOutcome,
  onCheckStatus,
  statusCheckDelayed = false,
}) {
  const isDemo = source === 'demo'

  return (
    <section className="diagnosis-flow-screen" aria-live="polite">
      {isDemo && <p className="diagnosis-demo-banner">데모 화면 / 실제 AI 진단 아님 · 횟수 차감 없음</p>}
      <div className="diagnosis-loading-card">
        <div className="diagnosis-loading-visual" aria-hidden="true">
          <span className="diagnosis-loading-leaf">🌿</span>
          <span className="diagnosis-loading-ring" />
          <span className="diagnosis-loading-dot diagnosis-loading-dot-one" />
          <span className="diagnosis-loading-dot diagnosis-loading-dot-two" />
        </div>
        <h2>AI가 잎을 살펴보고 있어요</h2>
        <p>사진과 입력하신 증상을 함께 분석하고 있어요</p>
        <div className="diagnosis-loading-progress is-indeterminate" role="status" aria-label="진행률이 아닌 분석 중 표시">
          <span />
        </div>
        <span className="diagnosis-loading-status">
          {statusCheckDelayed ? '응답 확인이 지연되고 있어요' : '분석 중'}
        </span>
      </div>
      {!isDemo && onCheckStatus && (
        <div className="diagnosis-demo-response-picker">
          <p>요청 상태는 서버 응답으로 확인합니다. 확인이 늦어지면 상태를 다시 조회해 주세요.</p>
          <button type="button" className="btn secondary" onClick={onCheckStatus}>
            진행 상태 다시 확인
          </button>
        </div>
      )}
      {isDemo && (
        <section className="diagnosis-demo-response-picker">
          <h3>데모 응답을 선택해 화면을 확인하세요</h3>
          <p>자동 완료 타이머 없이 선택한 응답 화면으로 이동합니다.</p>
          <div className="diagnosis-demo-response-options">
            <button type="button" className="btn secondary" onClick={() => onChooseDemoOutcome('diagnosed')}>진단 결과 데모</button>
            <button type="button" className="btn secondary" onClick={() => onChooseDemoOutcome('uncertain')}>판단 어려움 데모</button>
            <button type="button" className="btn secondary" onClick={() => onChooseDemoOutcome('limit')}>횟수 초과 데모</button>
            <button type="button" className="btn secondary" onClick={() => onChooseDemoOutcome('error')}>서버 오류 데모</button>
          </div>
        </section>
      )}
    </section>
  )
}
