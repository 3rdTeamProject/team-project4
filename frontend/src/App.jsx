import { Navigate, Route, Routes } from 'react-router-dom'
import Start from './pages/Start.jsx'
import KakaoCallback from './pages/KakaoCallback.jsx'
import Home from './pages/Home.jsx'
import Menu from './pages/Menu.jsx'
import MyPage from './pages/MyPage.jsx'
import PointHistory from './pages/PointHistory.jsx'
import LinkChoice from './pages/LinkChoice.jsx'
import Settings from './pages/Settings.jsx'
import PointShop from './pages/PointShop.jsx'
import PointExchange from './pages/PointExchange.jsx'
import ExchangeBlocked from './pages/ExchangeBlocked.jsx'
import OrderHistory from './pages/OrderHistory.jsx'
import OrderDetail from './pages/OrderDetail.jsx'
import Cart from './pages/Cart.jsx'
import CartExchange from './pages/CartExchange.jsx'
import ShippingAddress from './pages/ShippingAddress.jsx'
import Intro from './pages/Intro.jsx'
import Diagnosis from './pages/Diagnosis.jsx'
import DiagnosisHistory from './pages/DiagnosisHistory.jsx'
import Dex from './pages/Dex.jsx'
import DexDetail from './pages/DexDetail.jsx'
import { GardenHostProvider } from './components/GardenHost.jsx'
import PcShell from './components/PcShell.jsx'

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/auth/kakao/callback" element={<KakaoCallback />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/link-choice" element={<LinkChoice />} />
        {/* 로그인 후 화면: PC에서는 왼쪽 메뉴·가운데 농장 장면이 계속 보이고 화면은 오른쪽 패널에 뜬다 */}
        <Route element={<GardenHostProvider><PcShell /></GardenHostProvider>}>
          <Route path="/home" element={<Home key="farms" />} />
          <Route path="/journals" element={<Home key="journals" gardenView="journal" />} />
          <Route path="/dex" element={<Dex />} />
          <Route path="/dex/:cropKey" element={<DexDetail />} />
          <Route path="/diagnosis" element={<Diagnosis />} />
          <Route path="/diagnosis/history" element={<DiagnosisHistory />} />
          <Route path="/diagnosis/history/:requestId" element={<DiagnosisHistory />} />
          <Route path="/pointshop" element={<PointShop />} />
          <Route path="/pointshop/orders" element={<OrderHistory />} />
          <Route path="/pointshop/orders/:orderId" element={<OrderDetail />} />
          <Route path="/pointshop/blocked" element={<ExchangeBlocked />} />
          <Route path="/pointshop/exchange/:rewardId" element={<PointExchange />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/cart/exchange" element={<CartExchange />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/mypage" element={<MyPage />} />
          <Route path="/mypage/points" element={<PointHistory />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/shipping" element={<ShippingAddress />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
