import { Link, Navigate } from 'react-router-dom'
import { storage } from '../api.js'
import { ChevronRightIcon, CloseIcon, CoinIcon, DiagnosisIcon, JournalIcon, LevelIcon, SettingsIcon, ShopIcon } from '../components/Icons.jsx'
import { levelFromExp } from '../constants/level.js'
import { useGoBack } from '../hooks/useGoBack.js'
import { useMe } from '../hooks/useMe.js'
import './screens.css'

const MENU_ITEMS = [
  { label: '재배일지', to: '/journals', Icon: JournalIcon },
  { label: 'AI진단', to: '/diagnosis', Icon: DiagnosisIcon },
  { label: '포인트샵', to: '/pointshop', Icon: ShopIcon },
  { label: '환경설정', to: '/settings', Icon: SettingsIcon },
]

export default function Menu() {
  const { me, error } = useMe()
  // 닫기: 메뉴를 열기 전 화면으로 돌아간다. 이전 기록이 없으면 홈으로
  const close = useGoBack('/home')

  if (!storage.token) return <Navigate to="/" replace />

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title menu-title">메뉴</h1>
        <button type="button" className="icon-btn" onClick={close} aria-label="닫기"><CloseIcon /></button>
      </header>

      {error && <p className="error">{error}</p>}
      {me && (
        <Link className="profile-card" to="/mypage">
          <div className="profile-card-top">
            <span className="profile-name">{me.nickname}님</span>
            <span className="profile-more">내 정보<ChevronRightIcon /></span>
          </div>
          <div className="profile-stats">
            <span className="profile-stat profile-stat-level"><LevelIcon size={20} /> Lv.{levelFromExp(me.exp)}</span>
            <span className="profile-stats-divider" />
            <span className="profile-stat profile-stat-point"><CoinIcon size={22} /> {me.point.toLocaleString()}P</span>
          </div>
        </Link>
      )}

      <nav className="menu-list">
        {MENU_ITEMS.map(({ label, to, Icon }) => (
          <Link key={to} className="menu-item" to={to}>
            <span className="menu-item-icon"><Icon /></span>
            <span className="menu-item-label">{label}</span>
            <span className="menu-item-arrow"><ChevronRightIcon /></span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
