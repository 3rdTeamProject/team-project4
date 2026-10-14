import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { ExchangeCard, ExchangeFooter, ExchangeLine, PointsCard, RefundNotice, ShippingBlock } from '../components/ExchangeParts.jsx'
import RewardIcon from '../components/RewardIcon.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import { useMe } from '../hooks/useMe.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'
import './exchange.css'

const EMPTY = { recipient: '', phone: '', zip: '', address: '', address_detail: '' }

// 장바구니에서 고른 여러 상품을 한 번에 교환한다. 씨앗·도구는 배송, 기능 상품은 바로 적용된다.
export default function CartExchange() {
  const ids = useLocation().state?.ids // 장바구니에서 체크한 상품의 reward_id
  const navigate = useNavigate()
  const goBack = useGoBack('/cart')
  const { me, error: meError } = useMe()
  const [items, setItems] = useState(null)
  const [saved, setSaved] = useState(undefined) // undefined: 불러오는 중, null: 저장된 배송지 없음
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [note, setNote] = useState('')
  const [saveAddress, setSaveAddress] = useState(true)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useToast()

  useEffect(() => {
    api.cart().then((list) => setItems(list.filter((i) => ids?.includes(i.reward_id)))).catch((e) => setLoadError(e.message))
    api.shippingAddress().then(setSaved).catch((e) => setLoadError(e.message))
  }, [ids])

  if (!storage.token) return <Navigate to="/" replace />
  if (me?.login_type === 'guest') return <Navigate to="/pointshop/blocked" replace />
  // 주소로 바로 들어왔거나, 고른 상품이 장바구니에서 사라졌으면 장바구니로 보낸다
  if (!ids?.length || (items && items.length === 0)) return <Navigate to="/cart" replace />

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const ready = me && items && saved !== undefined
  const useSaved = !!saved && !editing
  const hasShipping = items?.some((i) => i.is_shipping)
  const hasInstant = items?.some((i) => !i.is_shipping)
  const total = items?.reduce((sum, i) => sum + i.price * i.quantity, 0) ?? 0

  function submit() {
    const body = {
      items: items.map((i) => ({ reward_id: i.reward_id, quantity: i.quantity })),
      request_note: note,
      remove_from_cart: true, // 교환한 항목은 장바구니에서 빠진다
    }
    if (hasShipping && !useSaved) {
      body.address = form
      body.save_address = saveAddress
    }
    setBusy(true)
    api
      .exchange(body)
      .then(() => navigate('/pointshop', { replace: true, state: { toast: '교환했어요', afterAction: true } }))
      .catch((e) => {
        setToast(e.message)
        setBusy(false)
      })
  }

  return (
    <div className="screen ex-screen">
      <header className="screen-header">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="돌아가기">‹</button>
        <h1 className="screen-title">포인트 교환</h1>
        <span className="icon-btn-spacer" />
      </header>

      {(meError || loadError) && <p className="error">{meError || loadError}</p>}

      {ready && (
        <>
          <ExchangeCard title={`교환 상품 ${items.length}개`}>
            {items.map((item) => (
              <ExchangeLine
                key={item.reward_id}
                thumb={<RewardIcon iconKey={item.icon_key} />}
                name={item.name}
                badge={item.is_shipping ? '배송' : '바로 적용'}
                badgeClass={item.is_shipping ? '' : 'ex-badge-now'}
                sub={`수량 ${item.quantity}개`}
                price={item.price * item.quantity}
              />
            ))}
          </ExchangeCard>

          {hasShipping && (
            <ShippingBlock
              useSaved={useSaved} saved={saved} onEdit={() => setEditing(true)}
              form={form} onField={set} note={note} onNote={setNote}
              saveAddress={saveAddress} onSaveAddress={setSaveAddress} onFind={() => setToast('준비 중이에요')}
              hint={hasInstant ? '씨앗·도구 상품만 배송돼요. 기능 상품은 교환 후 바로 쓸 수 있어요.' : undefined}
            />
          )}

          <PointsCard costLabel={`상품 포인트 (${items.length}개)`} cost={total} point={me.point} />
          <RefundNotice />

          <ExchangeFooter
            agreeLabel={hasShipping ? '배송지와 교환 내용을 확인했어요' : '교환 내용을 확인했어요'}
            agree={agree}
            onAgree={setAgree}
            price={total}
            busy={busy}
            onCancel={goBack}
            onSubmit={submit}
          />
        </>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
