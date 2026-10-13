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

  if (!storage.token) return <Navigate to="/" replace />

  function logout() {
    storage.logout()
    navigate('/', { replace: true })
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title">메뉴</h1>
        <Link className="icon-btn" to="/home" aria-label="닫기">✕</Link>
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

      <button type="button" className="logout-link" onClick={logout}>로그아웃</button>
    </div>
  )
}
