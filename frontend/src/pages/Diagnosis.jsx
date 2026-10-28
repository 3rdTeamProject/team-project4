import { Navigate } from 'react-router-dom'
import { storage } from '../api.js'
import DiagnosisDetails from '../components/DiagnosisDetails.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import './diagnosis.css'

export default function Diagnosis() {
  const close = useGoBack('/menu')

  if (!storage.token) return <Navigate to="/" replace />

  return (
    <main className="screen diagnosis-screen">
      <header className="screen-header journal-aligned-header">
        <div className="journal-aligned-title">
          <button
            type="button"
            className="icon-btn journal-aligned-back"
            onClick={close}
            aria-label="메뉴로 돌아가기"
          />
          <h1 className="screen-title">AI 진단</h1>
        </div>
      </header>

      <DiagnosisDetails onBack={close} />
    </main>
  )
}
