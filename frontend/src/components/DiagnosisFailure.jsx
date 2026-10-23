export default function DiagnosisFailure({
  message,
  isDemo,
  status,
  retryLabel = '다시 시도하기',
  onRetry,
  onBack,
}) {
  return (
    <section className="diagnosis-flow-screen">
      {isDemo && <p className="diagnosis-demo-banner">데모 화면 / 실제 AI 진단 아님 · 횟수 차감 없음</p>}
      <section className="diagnosis-result-card diagnosis-failure-card" role="alert">
        <span className="diagnosis-result-icon is-error" aria-hidden="true">!</span>
        <h2>{status === 'unknown' ? '진단 요청 상태를 확인하고 있어요' : 'AI 진단을 완료하지 못했어요'}</h2>
        <p>
          {status === 'unknown'
            ? '중복 분석 요청을 보내지 않도록 기존 요청 상태를 확인해 주세요. 결과가 불명확한 경우 해당 날짜의 이용 가능 횟수에 반영될 수 있어요.'
            : 'AI 진단 요청을 완료하지 못했어요. 진단 횟수 사용 여부는 서버에서 확인할 수 있으며, 문제가 계속되면 잠시 후 다시 시도해 주세요.'}
        </p>
        {isDemo && <p className="diagnosis-result-note">{message}</p>}
        {!isDemo && message && <p className="diagnosis-result-note">{message}</p>}
        <button type="button" className="btn primary" onClick={onRetry}>{retryLabel}</button>
        {onBack && <button type="button" className="btn secondary" onClick={onBack}>입력 화면으로 돌아가기</button>}
      </section>
    </section>
  )
}
