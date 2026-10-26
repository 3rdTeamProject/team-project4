import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, storage } from '../api.js'
import { ExchangeCard, ExchangeFooter, ExchangeLine, PointsCard, RefundNotice, ShippingBlock } from '../components/ExchangeParts.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import { useMe } from '../hooks/useMe.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'
import './shipping.css'
import './exchange.css'

const EMPTY = { recipient: '', phone: '', zip: '', address: '', address_detail: '' }

// 상품 하나 교환. 씨앗·도구는 배송지(저장된 것이 있으면 그것)를, 기능 상품은 배송지 없이 포인트만 쓴다.
export default function PointExchange() {
  const { rewardId } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack('/pointshop')
  const { me, error: meError } = useMe()
  const [reward, setReward] = useState(null) // undefined: 없는 상품
  const [saved, setSaved] = useState(undefined) // undefined: 불러오는 중, null: 저장된 배송지 없음
  const [editing, setEditing] = useState(false) // 저장된 배송지가 있어도 "변경"을 눌렀을 때
  const [form, setForm] = useState(EMPTY)
  const [note, setNote] = useState('')
  const [saveAddress, setSaveAddress] = useState(true)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitLock = useRef(false)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useToast()

  useEffect(() => {
    api
      .rewards()
      .then((list) => setReward(list.find((r) => String(r.id) === rewardId)))
      .catch((e) => setLoadError(e.message))
    api.shippingAddress().then(setSaved).catch((e) => setLoadError(e.message))
  }, [rewardId])

  if (!storage.token) return <Navigate to="/" replace />
  if (me?.login_type === 'guest') return <Navigate to="/pointshop/blocked" replace />

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const ready = me && saved !== undefined && reward !== null
  const useSaved = !!saved && !editing

  function submit() {
    if (!agree || submitLock.current) return
    const body = { items: [{ reward_id: reward.id, quantity: 1 }], request_note: note }
    if (reward.is_shipping) {
      body.address = useSaved ? saved : form
      body.save_address = !useSaved && saveAddress
    }
    completePurchase(body)
  }

  async function completePurchase(body) {
    if (submitLock.current) return
    submitLock.current = true
    setBusy(true)
    try {
      const result = await api.exchange(body)
      if (result) navigate('/pointshop', { replace: true, state: { toast: '교환했어요' } })
    } catch (error) {
      const uncertain = !error.status || error.status >= 500
      setToast(error.message)
      if (uncertain) {
        // Without purchase idempotency, never offer an automatic POST retry.
        navigate('/pointshop', { replace: true, state: { purchaseUncertain: true } })
      } else {
        submitLock.current = false
        setBusy(false)
      }
    }
  }

  return (
    <div className="screen ex-screen">
      <header className="screen-header">
        <h1 className="screen-title">포인트 교환</h1>
      </header>

      {(meError || loadError) && <p className="error">{meError || loadError}</p>}
      {ready && reward === undefined && (
        <>
          <p className="error">상품을 찾을 수 없어요.</p>
          <button type="button" className="ex-cancel" onClick={goBack}>취소</button>
        </>
      )}

      {ready && reward && (
        <>
          <ExchangeCard title="교환 상품">
            <ExchangeLine
              category={reward.category}
              name={reward.name}
              sub={reward.is_shipping ? '수량 1개' : '교환하면 바로 쓸 수 있어요'}
              price={reward.price}
            />
          </ExchangeCard>

          {reward.is_shipping && (
            <ShippingBlock
              useSaved={useSaved} saved={saved} onEdit={() => setEditing(true)}
              form={form} onField={set} note={note} onNote={setNote}
              saveAddress={saveAddress} onSaveAddress={setSaveAddress}
            />
          )}

          <PointsCard costLabel="상품 포인트" cost={reward.price} point={me.point} />
          <RefundNotice />

          <ExchangeFooter
            agreeLabel={reward.is_shipping ? '배송지와 교환 내용을 확인했어요' : '교환 내용을 확인했어요'}
            agree={agree}
            onAgree={setAgree}
            price={reward.price}
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
