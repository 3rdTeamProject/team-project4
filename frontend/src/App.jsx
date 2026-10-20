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

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/auth/kakao/callback" element={<KakaoCallback />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/home" element={<Home key="farms" />} />
        <Route path="/journals" element={<Home key="journals" gardenView="journal" />} />
        <Route path="/diagnosis" element={<Diagnosis />} />
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
        <Route path="/link-choice" element={<LinkChoice />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/shipping" element={<ShippingAddress />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
