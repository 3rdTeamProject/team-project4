import { Navigate, Route, Routes } from 'react-router-dom'
import Start from './pages/Start.jsx'
import KakaoCallback from './pages/KakaoCallback.jsx'
import Home from './pages/Home.jsx'
import Menu from './pages/Menu.jsx'
import MyPage from './pages/MyPage.jsx'

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/auth/kakao/callback" element={<KakaoCallback />} />
        <Route path="/home" element={<Home />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/mypage" element={<MyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
