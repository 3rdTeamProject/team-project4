import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { api, storage } from '../api.js'
import { CoinIcon } from '../components/Icons.jsx'
import GuestNotice from '../components/GuestNotice.jsx'
import RewardIcon from '../components/RewardIcon.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import { useMe } from '../hooks/useMe.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'
import './pointshop.css'

const TABS = ['전체', '씨앗', '도구', '기능']
const TOAST_MS = 1800
const LINK_FAILED = '연동하지 못했어요. 다시 시도해 주세요'

function CartIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h2l2.4 11h10.2L20 7H6.5" />
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
    </svg>
  )
}

export default function PointShop() {
  const { me, error: meError } = useMe()
  const [rewards, setRewards] = useState(null)
  const [cartCount, setCartCount] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState('전체')
  const [query, setQuery] = useState('')
  const state = useLocation().state
  // 교환을 마치고 오면 '교환했어요', 카카오 연동에 실패하고 오면 환경설정과 같은 안내
  const [toast, setToast] = useToast(state?.toast ?? (state?.linkFailed ? LINK_FAILED : ''), TOAST_MS)
  const goBack = useGoBack('/menu')
  const isGuest = me?.login_type === 'guest'

  useEffect(() => {
    api.rewards().then(setRewards).catch((e) => setLoadError(e.message))
    api
      .cart()
      .then((items) => setCartCount(items.reduce((sum, item) => sum + item.quantity, 0)))
      .catch(() => {})
  }, [])

  if (!storage.token) return <Navigate to="/" replace />

  const q = query.trim().toLowerCase()
  const shown = (rewards ?? []).filter(
    (r) => (tab === '전체' || r.category === tab) && (!q || `${r.name} ${r.category}`.toLowerCase().includes(q)),
  )

  function addToCart(reward) {
    api
      .addToCart(reward.id)
      .then(() => {
        setCartCount((n) => n + 1)
        setToast('장바구니에 담았어요')
      })
      .catch((e) => setToast(e.message))
  }

  return (
    <div className="screen">
      <header className="screen-header shop-header">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="돌아가기">‹</button>
        <h1 className="screen-title shop-title">포인트샵</h1>
        <Link className="icon-btn shop-cart" to="/cart" aria-label="장바구니">
          <CartIcon size={26} />
          {cartCount > 0 && <span className="shop-badge">{cartCount}</span>}
        </Link>
        {me && (
          <span className="shop-points">
            <CoinIcon size={28} />
            {me.point.toLocaleString()}P
          </span>
        )}
      </header>

      {(meError || loadError) && <p className="error">{meError || loadError}</p>}

      {isGuest && <GuestNotice />}

      <div className="shop-search">
        <label htmlFor="shop-search" className="sr-only">상품 검색</label>
        <svg className="shop-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          id="shop-search"
          className="shop-search-input"
          type="text"
          autoComplete="off"
          placeholder="씨앗, 도구, 기능 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="shop-search-clear" aria-label="검색어 지우기" onClick={() => setQuery('')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      <div className="shop-tabs" role="group" aria-label="상품 종류">
        {TABS.map((name) => (
          <button key={name} type="button" className="shop-tab" aria-pressed={tab === name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>

      {rewards && <p className="shop-count" aria-live="polite">상품 {shown.length}개</p>}

      {rewards && shown.length > 0 && (
        <div className="shop-grid">
          {shown.map((r) => (
            <div key={r.id} className="shop-card">
              <Link className="shop-card-link" to={isGuest ? '/pointshop/blocked' : `/pointshop/exchange/${r.id}`}>
                <div className="shop-thumb"><RewardIcon iconKey={r.icon_key} /></div>
                <span className="shop-cat">{r.category}</span>
                <span className="shop-name">{r.name}</span>
                <span className="shop-price">{r.price.toLocaleString()}P</span>
              </Link>
              <button type="button" className="shop-add" onClick={() => addToCart(r)}>
                <CartIcon size={16} />
                장바구니 담기
              </button>
            </div>
          ))}
        </div>
      )}

      {rewards && shown.length === 0 && (
        <div className="shop-empty">
          <div className="shop-empty-art">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
              <path d="M11 14v-4M11 10c0-2 1.5-3 3-3 0 2-1 3-3 3zM11 11c0-1.5-1-2.5-2.5-2.5 0 1.5 1 2.5 2.5 2.5z" />
            </svg>
          </div>
          <p className="shop-empty-title">찾는 상품이 없어요</p>
          <p className="shop-empty-sub">다른 검색어로 찾아보거나<br />전체 상품을 확인해보세요</p>
          <button type="button" className="shop-reset" onClick={() => { setQuery(''); setTab('전체') }}>전체 상품 보기</button>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
