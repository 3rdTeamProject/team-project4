import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { CoinIcon } from '../components/Icons.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import GuestNotice from '../components/GuestNotice.jsx'
import RewardIcon from '../components/RewardIcon.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import { useMe } from '../hooks/useMe.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'
import './pointshop.css'
import './exchange.css'
import './cart.css'

const MAX_QUANTITY = 9 // 서버(CART_MAX_QUANTITY)와 같다

export default function Cart() {
  const { me, error: meError } = useMe()
  const [items, setItems] = useState(null)
  const [selected, setSelected] = useState(() => new Set()) // 체크된 상품의 reward_id
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useToast()
  const [pendingRemove, setPendingRemove] = useState(null) // 삭제 확인을 기다리는 { ids, message }
  const goBack = useGoBack('/pointshop')
  const isGuest = me?.login_type === 'guest'

  useEffect(() => {
    api
      .cart()
      .then((list) => {
        setItems(list)
        setSelected(new Set(list.map((i) => i.reward_id))) // 처음에는 모두 선택
      })
      .catch((e) => setLoadError(e.message))
  }, [])

  if (!storage.token) return <Navigate to="/" replace />

  const list = items ?? []
  const picked = list.filter((i) => selected.has(i.reward_id))
  const total = picked.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const point = me?.point ?? 0
  const noneSelected = picked.length === 0
  const insufficient = total > point
  const canExchange = !noneSelected && !insufficient
  const allChecked = list.length > 0 && picked.length === list.length

  // 화면을 먼저 바꾸고 서버에 저장한다. 실패하면 서버 값으로 되돌린다.
  function apply(next, request) {
    setItems(next)
    request().catch((e) => {
      setToast(e.message)
      api.cart().then(setItems).catch(() => {})
    })
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(list.map((i) => i.reward_id)))

  function changeQuantity(item, quantity) {
    apply(list.map((i) => (i.reward_id === item.reward_id ? { ...i, quantity } : i)), () => api.setCartQuantity(item.reward_id, quantity))
  }

  function askRemove(ids, message) {
    if (ids.length > 0) setPendingRemove({ ids, message })
  }

  function remove(ids) {
    setPendingRemove(null)
    apply(list.filter((i) => !ids.includes(i.reward_id)), () => api.removeFromCart(ids))
    setToast('삭제했어요')
  }

  return (
    <div className="screen ex-screen">
      <header className="screen-header shop-header">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="돌아가기">‹</button>
        <h1 className="screen-title shop-title">장바구니</h1>
        {me && (
          <span className="shop-points">
            <CoinIcon size={28} />
            {me.point.toLocaleString()}P
          </span>
        )}
      </header>

      {(meError || loadError) && <p className="error">{meError || loadError}</p>}

      {isGuest && <GuestNotice />}

      {items && list.length > 0 && (
        <>
          <div className="cart-bar">
            <label className="cart-all">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              전체 선택 <span className="cart-all-count">({picked.length}/{list.length})</span>
            </label>
            <button type="button" className="cart-remove-selected" onClick={() => askRemove(picked.map((i) => i.reward_id), `선택한 상품 ${picked.length}개`)}>
              선택 삭제
            </button>
          </div>

          <ul className="cart-list">
            {list.map((item) => (
              <li key={item.reward_id} className="cart-row">
                <label className="cart-check">
                  <input type="checkbox" aria-label={`${item.name} 선택`} checked={selected.has(item.reward_id)} onChange={() => toggle(item.reward_id)} />
                </label>
                <div className="cart-thumb"><RewardIcon iconKey={item.icon_key} /></div>
                <div className="cart-info">
                  <div className="cart-name-box">
                    <span className="cart-cat">{item.category}</span>
                    <span className="cart-name">{item.name}</span>
                  </div>
                  <div className="cart-line">
                    <div className="cart-qty">
                      <button type="button" className="cart-step" aria-label="수량 줄이기" disabled={item.quantity <= 1}
                        onClick={() => changeQuantity(item, item.quantity - 1)}>
                        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></span>
                      </button>
                      <span className="cart-qty-num">{item.quantity}</span>
                      <button type="button" className="cart-step" aria-label="수량 늘리기" disabled={item.quantity >= MAX_QUANTITY}
                        onClick={() => changeQuantity(item, item.quantity + 1)}>
                        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span>
                      </button>
                    </div>
                    <span className="cart-price">{(item.price * item.quantity).toLocaleString()}P</span>
                  </div>
                </div>
                <button type="button" className="cart-delete" aria-label={`${item.name} 삭제`} onClick={() => askRemove([item.reward_id], item.name)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </li>
            ))}
          </ul>

          <div className="ex-footer">
            <div className="cart-total"><span>선택 {picked.length}개 · 합계</span><span className="cart-total-num">{total.toLocaleString()}P</span></div>
            <div className="cart-point">
              <span>내 포인트 {point.toLocaleString()}P</span>
              {insufficient && <span className="cart-short">{(total - point).toLocaleString()}P 부족해요</span>}
              {canExchange && <span>교환 후 {(point - total).toLocaleString()}P</span>}
            </div>
            {canExchange ? (
              <Link className="ex-submit cart-go" to={isGuest ? '/pointshop/blocked' : '/cart/exchange'} state={{ ids: picked.map((i) => i.reward_id) }}>선택 상품 교환하기</Link>
            ) : (
              <div className="cart-disabled">{noneSelected ? '상품을 선택해 주세요' : '포인트가 부족해요'}</div>
            )}
          </div>
        </>
      )}

      {items && list.length === 0 && (
        <div className="cart-empty">
          <div className="cart-empty-art">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4h2l2.4 11h10.2L20 7H6.5" />
              <circle cx="9" cy="20" r="1.4" />
              <circle cx="17" cy="20" r="1.4" />
            </svg>
          </div>
          <p className="cart-empty-title">장바구니가 비어 있어요</p>
          <p className="cart-empty-sub">포인트샵에서 마음에 드는 상품을<br />담아 보세요</p>
          <Link className="cart-empty-go" to="/pointshop">포인트샵 가기</Link>
        </div>
      )}

      {pendingRemove && (
        <ConfirmDialog message={pendingRemove.message} onConfirm={() => remove(pendingRemove.ids)} onCancel={() => setPendingRemove(null)} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
