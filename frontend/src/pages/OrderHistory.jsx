import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { ReceiptIcon } from '../components/Icons.jsx'
import OrderStatusChip from '../components/OrderStatusChip.jsx'
import RewardIcon from '../components/RewardIcon.jsx'
import { ORDER_STATUS, formatOrderDate } from '../constants/order.js'
import { useGoBack } from '../hooks/useGoBack.js'
import './screens.css'
import './pointshop.css'
import './orders.css'

const FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'ing', label: '진행 중' },
  { id: 'done', label: '완료' },
]

// 카드 보조 문구: 여러 상품이면 "상품 3개", 하나면 분류(기능 상품은 "기능 · 바로 적용")
function subText(order) {
  if (order.item_count > 1) return `상품 ${order.item_count}개`
  return order.first_item_category === '기능' ? '기능 · 바로 적용' : order.first_item_category
}

// 상품명: 여러 상품이면 "가상 토마토 모종 외 2건"
function nameText(order) {
  return order.item_count > 1 ? `${order.first_item_name} 외 ${order.item_count - 1}건` : order.first_item_name
}

export default function OrderHistory() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const goBack = useGoBack('/pointshop')

  // 개수를 세 탭에 모두 보여 주려고 전체를 한 번 받아 화면에서 나눈다
  useEffect(() => {
    api.orders().then(setOrders).catch((e) => setError(e.message))
  }, [])

  if (!storage.token) return <Navigate to="/" replace />

  const list = orders ?? []
  const inGroup = (order, group) => ORDER_STATUS[order.status]?.group === group
  const counts = { all: list.length, ing: list.filter((o) => inGroup(o, 'ing')).length, done: list.filter((o) => inGroup(o, 'done')).length }
  const shown = filter === 'all' ? list : list.filter((o) => inGroup(o, filter))

  return (
    <div className="screen ex-screen">
      <header className="screen-header">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="돌아가기">‹</button>
        <h1 className="screen-title">주문 내역</h1>
        <span className="icon-btn-spacer" />
      </header>

      {error && <p className="error">{error}</p>}

      {orders && list.length > 0 && (
        <>
          <div className="order-tabs" role="group" aria-label="주문 상태">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="shop-tab" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} {counts[f.id]}
              </button>
            ))}
          </div>

          <ul className="order-list">
            {shown.map((order) => (
              <li key={order.id}>
                <Link className="order-card" to={`/pointshop/orders/${order.id}`}>
                  <div className="order-card-top">
                    <span className="order-date">{formatOrderDate(order.created_at)}</span>
                    <OrderStatusChip status={order.status} />
                  </div>
                  <div className="order-card-body">
                    <div className="order-thumb"><RewardIcon iconKey={order.first_item_icon_key} /></div>
                    <div className="order-main">
                      <span className="order-name">{nameText(order)}</span>
                      <span className="order-sub">{subText(order)}</span>
                    </div>
                    <span className="order-price">{order.total_points.toLocaleString()}P</span>
                    <svg className="order-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {orders && list.length === 0 && (
        <div className="order-empty">
          <div className="order-empty-art"><ReceiptIcon size={52} /></div>
          <p className="order-empty-title">아직 교환한 상품이 없어요</p>
          <p className="order-empty-sub">포인트샵에서 첫 상품을<br />교환해 보세요</p>
          <Link className="order-empty-go" to="/pointshop">포인트샵 가기</Link>
        </div>
      )}
    </div>
  )
}
