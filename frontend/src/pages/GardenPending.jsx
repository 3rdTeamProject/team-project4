import { Navigate } from 'react-router-dom'
import { storage } from '../api.js'
import { useGoBack } from '../hooks/useGoBack.js'
import './screens.css'

export default function GardenPending({ title, description }) {
  // 닫기: 메뉴에서 열었다면 한 단계 뒤로(메뉴로). 주소로 바로 들어왔으면 메뉴로 이동
  const close = useGoBack('/menu')
  if (!storage.token) return <Navigate to="/" replace />
  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title">{title}</h1>
        <button type="button" className="icon-btn" onClick={close} aria-label="메뉴로 돌아가기">✕</button>
      </header>
      <p className="muted">{description}</p>
    </div>
  )
}
