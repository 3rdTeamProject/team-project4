import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { useGoBack } from '../hooks/useGoBack.js'
import './garden-host.css'

/** Isolated garden scene, with server persistence through the existing authenticated API. */
export default function Home({ gardenView = 'farms' }) {
  const navigate = useNavigate()
  // 재배일지처럼 메뉴에서 열린 화면의 뒤로가기는 메뉴로 새로 이동하지 않고 한 단계 뒤로 간다(기록이 쌓여 갇히는 것을 막음)
  const goBack = useGoBack('/menu')
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
      if (destination.current === 'back') goBack()
      else if (destination.current) navigate(destination.current)
    } catch (e) {
      setError(e.status === 409 ? e.message : '농장을 서버에 저장하지 못했어요. 화면을 닫기 전에 다시 저장해 주세요.')
      destination.current = null
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  // 저장하지 않은 변경이 서버에 올라갈 때까지 기다린다(할 일 완료·수확은 저장된 농장을 기준으로 처리되므로)
  async function settle() {
    for (let i = 0; i < 200 && (latest.current || busy.current); i++) {
      if (busy.current) await new Promise(resolve => setTimeout(resolve, 50))
      else await flush()
    }
    if (latest.current || busy.current) throw new Error('농장을 서버에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }

  function remember(data) {
    session.current.revision = data.revision
    session.current.state = data.state
    return data
  }

  // 농장 화면(iframe)이 요청하는 서버 작업. 할 일 목록 / 서버 내용 다시 받기 / 일지 올리기(수확 포함)
  const gardenOps = {
    crops: () => api.gardenCrops(),
    places: body => api.gardenPlaces(body.q),
    tasks: () => api.gardenTasks(),
    devday: () => api.gardenDevDay(),
    devdayset: body => api.setGardenDevDay(body.offset),
    refresh: async () => { await settle(); return remember(await api.gardenState()) },
    complete: async body => { await settle(); return remember(await api.completeGardenTasks(body)) },
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
      } else if (message?.type === 'garden:api' && Object.hasOwn(gardenOps, message.op)) {
        const reply = result => frame.current?.contentWindow?.postMessage({ type: 'garden:api-result', id: message.id, ...result }, window.location.origin)
        gardenOps[message.op](message.payload).then(data => reply({ ok: true, data }), e => reply({ ok: false, error: e.message, status: e.status }))
      } else if (message?.type === 'garden:scroll-top') {
        window.scrollTo({top: 0, behavior: 'instant'})
      } else if (message?.type === 'garden:navigate' && message.to === '/menu') {
        // 농장 화면의 ☰는 메뉴를 새로 연다. 일지 등 메뉴에서 열린 화면의 ‹는 이전(메뉴)으로 돌아간다
        destination.current = gardenView === 'farms' ? '/menu' : 'back'
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
