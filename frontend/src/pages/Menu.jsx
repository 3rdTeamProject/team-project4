import { Link, Navigate, useNavigate } from 'react-router-dom'
import { storage } from '../api.js'
import { CoinIcon, SproutIcon } from '../components/Icons.jsx'
import { levelFromExp } from '../constants/level.js'
import { useMe } from '../hooks/useMe.js'
import './screens.css'

const MENU_ITEMS = [
  { label: '재배일지', to: '/journals' },
  { label: 'AI진단', to: '/diagnosis' },
  { label: '포인트샵', to: '/pointshop' },
  { label: '환경설정', to: '/settings' },
]

export default function Menu() {
  const navigate = useNavigate()
  const { me, error } = useMe()

  // 닫기: 메뉴를 열기 전 화면으로 돌아간다. 이전 기록이 없으면(주소로 바로 들어온 경우 등) 홈으로
  function close() {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/home', { replace: true })
  }

  if (!storage.token) return <Navigate to="/" replace />

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title">메뉴</h1>
        <button type="button" className="icon-btn" onClick={close} aria-label="닫기">✕</button>
      </header>

      {error && <p className="error">{error}</p>}
      {me && (
        <Link className="profile-card" to="/mypage">
          <div className="profile-card-top">
            <span className="profile-name">{me.nickname}님</span>
            <span className="profile-more">내 정보 ›</span>
          </div>
          <div className="profile-stats">
            <span className="profile-stat"><SproutIcon /> Lv.{levelFromExp(me.exp)}</span>
            <span className="profile-stats-divider" />
            <span className="profile-stat"><CoinIcon /> {me.point.toLocaleString()}P</span>
          </div>
        </Link>
      )}

      <nav className="menu-list">
        {MENU_ITEMS.map((item) => (
          <Link key={item.to} className="menu-item" to={item.to}>
            <span>{item.label}</span>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
