import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// 홈 화면에 추가해 앱처럼 쓰기 위한 서비스 워커(개발 중에는 화면이 안 바뀌는 문제가 생기므로 배포 빌드에서만 등록한다)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {}) // 등록에 실패해도 앱은 그대로 동작한다
  })
}
