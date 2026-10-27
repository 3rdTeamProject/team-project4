import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import AddressFields from '../components/AddressFields.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'
import './shipping.css'

const EMPTY = { recipient: '', phone: '', zip: '', address: '', address_detail: '' }

export default function ShippingAddress() {
  const [form, setForm] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const navigate = useNavigate()
  const [toast, setToast] = useToast()
  const goBack = useGoBack('/settings')

  useEffect(() => {
    api
      .shippingAddress()
      .then((saved) => saved && setForm({ ...EMPTY, ...saved }))
      .catch((e) => setToast(e.message))
      .finally(() => setLoaded(true))
  }, [setToast])

  if (!storage.token) return <Navigate to="/" replace />

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // 저장·삭제가 끝나면 안내 토스트와 함께 환경설정으로 돌아간다
  function run(action, message) {
    setAskDelete(false)
    setBusy(true)
    action()
      .then(() => navigate('/settings', { replace: true, state: { toast: message } }))
      .catch((e) => {
        setToast(e.message)
        setBusy(false)
      })
  }

  return (
    <div className="screen">
      <header className="screen-header journal-aligned-header">
        <div className="journal-aligned-title">
          <button type="button" className="icon-btn journal-aligned-back" onClick={goBack} aria-label="뒤로가기" />
          <h1 className="screen-title">배송지 관리</h1>
        </div>
      </header>

      <section className="ship-card">
        <AddressFields form={form} onChange={set} idPrefix="ship" />
      </section>

      <div className="ship-actions">
        <button type="button" className="ship-delete" disabled={busy || !loaded} onClick={() => setAskDelete(true)}>삭제</button>
        <button type="button" className="ship-save" disabled={busy || !loaded} onClick={() => run(() => api.saveShippingAddress(form), '배송지를 저장했어요')}>저장</button>
      </div>

      {askDelete && (
        <ConfirmDialog onConfirm={() => run(api.deleteShippingAddress, '배송지를 삭제했어요')} onCancel={() => setAskDelete(false)} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
