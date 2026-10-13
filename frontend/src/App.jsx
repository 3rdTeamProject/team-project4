import { Navigate, Route, Routes } from 'react-router-dom'
import Start from './pages/Start.jsx'
import KakaoCallback from './pages/KakaoCallback.jsx'
import Home from './pages/Home.jsx'

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/auth/kakao/callback" element={<KakaoCallback />} />
        <Route path="/home" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
