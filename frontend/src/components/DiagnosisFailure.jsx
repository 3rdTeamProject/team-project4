export default function DiagnosisFailure({ message, isDemo, onRetry }) {
  return (
    <section className="diagnosis-flow-screen">
      {isDemo && <p className="diagnosis-demo-banner">데모 화면 / 실제 AI 진단 아님 · 횟수 차감 없음</p>}
      <section className="diagnosis-result-card diagnosis-failure-card" role="alert">
        <span className="diagnosis-result-icon is-error" aria-hidden="true">!</span>
        <h2>AI 진단을 완료하지 못했어요</h2>
        <p>AI 진단 요청을 완료하지 못했어요. 진단 횟수 사용 여부는 서버에서 확인할 수 있으며, 문제가 계속되면 잠시 후 다시 시도해 주세요.</p>
        {isDemo && <p className="diagnosis-result-note">{message}</p>}
        <button type="button" className="btn primary" onClick={onRetry}>입력 화면으로 돌아가기</button>
      </section>
    </section>
  )
}
