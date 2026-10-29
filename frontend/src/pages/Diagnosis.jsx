import { Navigate } from 'react-router-dom'
import { storage } from '../api.js'
import DiagnosisDetails from '../components/DiagnosisDetails.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import './diagnosis.css'

export default function Diagnosis() {
  const close = useGoBack('/home')

  if (!storage.token) return <Navigate to="/" replace />

  return (
    <main className="screen diagnosis-screen">
      <header className="screen-header">
        <button type="button" className="icon-btn diagnosis-back" onClick={close} aria-label="이전 화면으로 돌아가기">‹</button>
        <h1 className="screen-title">AI 상세 진단</h1>
        <span className="icon-btn-spacer" aria-hidden="true" />
      </header>
      <DiagnosisDetails onBack={close} />
    </main>
  )
}
