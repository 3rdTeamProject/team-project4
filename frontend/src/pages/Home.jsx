import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import './garden-host.css'

/** Isolated garden scene, with server persistence through the existing authenticated API. */
export default function Home({ gardenView = 'farms' }) {
  const navigate = useNavigate()
  const frame = useRef(null)
  const session = useRef(null)
  const ready = useRef(false)
  const latest = useRef(null)
  const busy = useRef(false)
  const destination = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [height, setHeight] = useState(700)

  useEffect(() => {
    if (!storage.token) return
    let cancelled = false
    Promise.all([api.me(), api.gardenState()]).then(([me, data]) => {
      if (cancelled) return
      session.current = { userId: me.id, ...data }
      setLoaded(true)
    }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  async function flush() {
    if (busy.current || !session.current) return
    busy.current = true
    setSaving(true)
    setError('')
    try {
      while (latest.current) {
        const snapshot = latest.current
        const result = await api.saveGarden(session.current.revision, snapshot)
        session.current.revision = result.revision
        session.current.state = snapshot
        if (latest.current === snapshot) latest.current = null
      }
      if (destination.current) navigate(destination.current)
    } catch (e) {
      setError(e.status === 409 ? e.message : '농장을 서버에 저장하지 못했어요. 화면을 닫기 전에 다시 저장해 주세요.')
      destination.current = null
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  useEffect(() => {
    const onMessage = event => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      const message = event.data
      if (message?.type === 'garden:ready' && session.current && !ready.current) {
        ready.current = true
        frame.current.contentWindow.postMessage({type:'garden:init', ...session.current, view:gardenView}, window.location.origin)
      } else if (message?.type === 'garden:height' && Number.isFinite(message.height)) {
        setHeight(Math.max(320, Math.min(message.height, 20000)))
      } else if (message?.type === 'garden:save' && message.state) {
        latest.current = message.state
        flush()
      } else if (message?.type === 'garden:navigate' && message.to === '/menu') {
        destination.current = '/menu'
        flush()
      }
    }
    const beforeLeave = event => {
      if (latest.current || busy.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('beforeunload', beforeLeave)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('beforeunload', beforeLeave)
    }
  }, [gardenView, navigate])

  if (!storage.token) return <Navigate to="/" replace />
  return <section className="garden-host">
    {error && <div className="garden-save-error" role="alert">{error}
      <button className="btn secondary" disabled={saving} onClick={() => latest.current ? flush() : window.location.reload()}>다시 시도</button>
    </div>}
    {!loaded && !error && <p className="muted">내 농장을 불러오는 중…</p>}
    {loaded && <iframe ref={frame} title="우리텃밭 농장 관리" allow="geolocation 'self'" src={`${import.meta.env.BASE_URL}garden/index.html`} style={{height}} />}
    <span className="garden-save-status" role="status" aria-live="polite">{saving ? '저장 중…' : ''}</span>
  </section>
}
