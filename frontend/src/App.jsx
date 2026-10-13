import { Navigate, Route, Routes } from 'react-router-dom'
import Start from './pages/Start.jsx'
import KakaoCallback from './pages/KakaoCallback.jsx'
import Home from './pages/Home.jsx'
import Menu from './pages/Menu.jsx'
import MyPage from './pages/MyPage.jsx'
import LinkChoice from './pages/LinkChoice.jsx'
import Settings from './pages/Settings.jsx'
import Intro from './pages/Intro.jsx'
import GardenPending from './pages/GardenPending.jsx'

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/auth/kakao/callback" element={<KakaoCallback />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/home" element={<Home key="farms" />} />
        <Route path="/journals" element={<Home key="journals" gardenView="journal" />} />
        <Route path="/diagnosis" element={<GardenPending title="AI 진단" description="사진 진단은 AI 서비스 연결 후 사용할 수 있어요." />} />
        <Route path="/pointshop" element={<GardenPending title="포인트샵" description="포인트 상품 교환 기능은 아직 준비 중이에요." />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/mypage" element={<MyPage />} />
        <Route path="/link-choice" element={<LinkChoice />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
