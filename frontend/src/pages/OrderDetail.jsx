import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, storage } from '../api.js'
import OrderStatusChip from '../components/OrderStatusChip.jsx'
import RewardIcon from '../components/RewardIcon.jsx'
import { SHIPPING_HEADLINE, SHIPPING_STEPS, SHIPPING_STEP_INDEX, formatOrderDateTime } from '../constants/order.js'
import { useGoBack } from '../hooks/useGoBack.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'
import './exchange.css'
import './orders.css'

function Check({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  )
}

// 운송장 번호를 클립보드에 복사한다. 보안 문맥이 아니면 임시 입력란을 써서 복사한다.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const box = document.createElement('textarea')
    box.value = text
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand('copy')
    box.remove()
    return ok
  }
}

function OrderInfoCard({ order }) {
  return (
    <section className="ex-card">
      <div className="od-head">
        <h2 className="ex-card-title">주문 정보</h2>
        <OrderStatusChip status={order.status} />
      </div>
      <div className="od-row"><span>주문일시</span><span>{formatOrderDateTime(order.created_at)}</span></div>
      <div className="od-row"><span>주문번호</span><span>{order.order_no}</span></div>
    </section>
  )
}

function PointsCard({ order }) {
  const sum = order.items.reduce((total, item) => total + item.points, 0)
  return (
    <section className="ex-card">
      <h2 className="ex-card-title">포인트 사용</h2>
      <div className="od-row"><span>상품 포인트</span><span className="od-sum-num">{sum.toLocaleString()}P</span></div>
      <hr className="ex-divider" />
      <div className="od-total"><span>사용한 포인트</span><span className="od-total-num">{order.total_points.toLocaleString()}P</span></div>
    </section>
  )
}

// 배송 진행 상태: 주문 접수 -> 상품 준비 -> 배송 중 -> 배송 완료, 택배사·운송장 번호
function ShippingProgress({ order, onCopied }) {
  const current = SHIPPING_STEP_INDEX[order.status] ?? 0
  const allDone = order.status === 'delivered' || order.status === 'completed'

  async function copy() {
    onCopied((await copyText(order.tracking_no)) ? '운송장 번호를 복사했어요' : '복사하지 못했어요')
  }

  return (
    <section className="ex-card">
      <h2 className="ex-card-title">배송 진행 상태</h2>
      <p className="od-headline">{SHIPPING_HEADLINE[order.status] ?? ''}</p>
      <ol className="od-steps">
        {SHIPPING_STEPS.map((label, i) => {
          const done = i < current || allDone
          const isCurrent = i === current
          return (
            <li key={label} className={`od-step${done ? ' done' : ''}${isCurrent ? ' current' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
              {i < SHIPPING_STEPS.length - 1 && <div className="od-step-line" />}
              <div className="od-dot">{done ? <Check size={16} /> : isCurrent ? <span className="od-dot-core" /> : null}</div>
              <div className="od-step-label">{label}</div>
            </li>
          )
        })}
      </ol>
      {order.tracking_no ? (
        <div className="od-track">
          <div className="od-track-text">
            <span className="od-track-label">{order.courier ? `${order.courier} · ` : ''}운송장 번호</span>
            <span className="od-track-no">{order.tracking_no}</span>
          </div>
          <button type="button" className="od-copy" onClick={copy}>복사</button>
        </div>
      ) : (
        <p className="od-track-empty">운송장 번호가 아직 등록되지 않았어요</p>
      )}
    </section>
  )
}

function ItemsCard({ order, shipping }) {
  return (
    <section className="ex-card">
      <h2 className="ex-card-title">{shipping ? `주문 상품 ${order.items.length}개` : '주문 상품'}</h2>
      {order.items.map((item, i) => (
        <div key={i} className="od-item">
          <div className="order-thumb"><RewardIcon iconKey={item.icon_key} /></div>
          <div className="od-item-main">
            <span className="od-item-cat">{item.category}</span>
            <span className="od-item-name">{item.name}</span>
            <span className="od-item-sub">
              {item.is_shipping ? `수량 ${item.quantity}개` : shipping ? '배송 없이 바로 적용' : '배송지 없이 바로 적용돼요'}
            </span>
          </div>
          <div className="od-item-side">
            <span className="od-item-price">{item.points.toLocaleString()}P</span>
            {shipping && <span className={`od-item-chip ${item.is_shipping ? 'info' : 'done'}`}>{item.is_shipping ? '배송' : '충전 완료'}</span>}
          </div>
        </div>
      ))}
    </section>
  )
}

function ShippingAddressCard({ shipping }) {
  return (
    <section className="ex-card">
      <h2 className="ex-card-title">배송지</h2>
      <div className="od-ship-box">
        <div className="od-ship-name">{shipping.recipient_name} <span className="od-ship-phone">{shipping.recipient_phone}</span></div>
        <div className="od-ship-address">
          {shipping.address}
          {shipping.address_detail && (
            <>
              <br />
              {shipping.address_detail}
            </>
          )}
        </div>
        {shipping.request_memo && <div className="od-ship-memo">배송 요청사항 · {shipping.request_memo}</div>}
      </div>
    </section>
  )
}

export default function OrderDetail() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack('/pointshop/orders')
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useToast()

  useEffect(() => {
    api
      .order(orderId)
      .then(setOrder)
      .catch((e) => {
        // 없는 주문이거나 내 주문이 아니면 주문 내역으로 돌려보낸다
        if (e.status === 404 || e.status === 422) navigate('/pointshop/orders', { replace: true })
        else setError(e.message)
      })
  }, [orderId, navigate])

  if (!storage.token) return <Navigate to="/" replace />

  const shipping = order?.items.some((item) => item.is_shipping)
  // 기능 상품이 충전하는 AI진단 횟수 합계
  const charged = order?.items.reduce((total, item) => total + (item.grant_count ?? 0) * item.quantity, 0) ?? 0

  return (
    <div className="screen">
      <header className="screen-header journal-aligned-header">
        <div className="journal-aligned-title">
          <button type="button" className="icon-btn journal-aligned-back" onClick={goBack} aria-label="돌아가기" />
          <h1 className="screen-title">주문 상세</h1>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {order && (
        <>
          <OrderInfoCard order={order} />

          {shipping ? (
            <ShippingProgress order={order} onCopied={setToast} />
          ) : (
            <section className="od-hero">
              <div className="od-hero-check"><Check size={36} /></div>
              <p className="od-hero-title">충전이 완료됐어요</p>
              <p className="od-hero-sub">{charged > 0 ? `AI진단 ${charged}회를 바로 쓸 수 있어요` : '교환한 상품을 바로 쓸 수 있어요'}</p>
              <Link className="od-go" to="/diagnosis">AI진단 하러 가기</Link>
            </section>
          )}

          <ItemsCard order={order} shipping={shipping} />
          {shipping && order.shipping && <ShippingAddressCard shipping={order.shipping} />}
          <PointsCard order={order} />
        </>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
