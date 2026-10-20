import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import CloudTransition from '../components/CloudTransition.jsx'
import { useCloudTransition } from '../hooks/useCloudTransition.js'
import { useGoBack } from '../hooks/useGoBack.js'
import './garden-host.css'

/** Isolated garden scene, with server persistence through the existing authenticated API. */
// 작물 목록(작물 종류·할 일 여부·심는 방식 제한)은 거의 바뀌지 않는데 크기가 커서(약 28KB),
// 농장 화면에 들어올 때마다 다시 받지 않도록 한 번 받은 것을 기억한다(새로고침하면 다시 받는다)
let cropsPromise = null
function loadCrops() {
  cropsPromise ??= api.gardenCrops().catch(error => { cropsPromise = null; throw error })
  return cropsPromise
}

export default function Home({ gardenView = 'farms' }) {
  const navigate = useNavigate()
  // 재배일지처럼 메뉴에서 열린 화면의 뒤로가기는 메뉴로 새로 이동하지 않고 한 단계 뒤로 간다(기록이 쌓여 갇히는 것을 막음)
  const goBack = useGoBack('/menu')
  const frame = useRef(null)
  const session = useRef(null)
  const ready = useRef(false)
  const frameReady = useRef(false)
  // 농장 화면(iframe)은 데이터를 기다리지 않고 바로 띄워 스크립트를 미리 받게 한다.
  // 화면이 준비됐다는 신호(garden:ready)와 데이터 도착 중 늦은 쪽이 올 때 처음 한 번만 데이터를 보낸다
  const sendInit = useRef(null)
  sendInit.current = () => {
    if (!frameReady.current || !session.current || ready.current) return
    ready.current = true
    frame.current?.contentWindow?.postMessage({ type: 'garden:init', ...session.current, view: gardenView }, window.location.origin)
  }
  const latest = useRef(null)
  const busy = useRef(false)
  const destination = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [height, setHeight] = useState(700)
  // 농장 화면(iframe) 아래 버튼. iframe 안에서는 스크롤을 따라오지 못해서 여기서 하단 고정 막대로 보여 준다
  const [footerButtons, setFooterButtons] = useState([])
  // 농장 카드를 눌러 작물 6칸 화면으로 들어갈 때 쓰는 구름 전환(농장 화면 iframe이 덮기/열기를 요청한다)
  const cloud = useCloudTransition()

  useEffect(() => {
    if (!storage.token) return
    let cancelled = false
    loadCrops().catch(() => {}) // 농장 화면(iframe)이 물어보기 전에 미리 받아 둔다(실패하면 화면이 물어볼 때 다시 시도한다)
    Promise.all([api.me(), api.gardenState()]).then(([me, data]) => {
      if (cancelled) return
      session.current = { userId: me.id, ...data }
      setLoaded(true)
      sendInit.current()
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
    crops: () => loadCrops(),
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
      if (message?.type === 'garden:ready') {
        frameReady.current = true
        sendInit.current()
      } else if (message?.type === 'garden:height' && Number.isFinite(message.height)) {
        setHeight(Math.max(320, Math.min(message.height, 20000)))
      } else if (message?.type === 'garden:save' && message.state) {
        latest.current = message.state
        flush()
      } else if (message?.type === 'garden:api' && Object.hasOwn(gardenOps, message.op)) {
        const reply = result => frame.current?.contentWindow?.postMessage({ type: 'garden:api-result', id: message.id, ...result }, window.location.origin)
        gardenOps[message.op](message.payload).then(data => reply({ ok: true, data }), e => reply({ ok: false, error: e.message, status: e.status }))
      } else if (message?.type === 'garden:footer' && Array.isArray(message.buttons)) {
        setFooterButtons(message.buttons.slice(0, 3).map(b => ({
          index: Number(b.index), label: String(b.label), kind: b.kind === 'primary' ? 'primary' : 'secondary', disabled: Boolean(b.disabled),
        })))
      } else if (message?.type === 'garden:cloud-close') {
        cloud.close().then(() => frame.current?.contentWindow?.postMessage({ type: 'garden:cloud-closed' }, window.location.origin))
      } else if (message?.type === 'garden:cloud-open') {
        cloud.open()
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
  }, [gardenView, navigate, cloud.close, cloud.open])

  if (!storage.token) return <Navigate to="/" replace />
  return <section className="garden-host">
    {error && <div className="garden-save-error" role="alert">{error}
      <button className="btn secondary" disabled={saving} onClick={() => latest.current ? flush() : window.location.reload()}>다시 시도</button>
    </div>}
    {!loaded && !error && <p className="muted">내 농장을 불러오는 중…</p>}
    <div className="garden-zoom" data-cloud={cloud.phase} style={cloud.timing}>
      <iframe ref={frame} title="우리텃밭 농장 관리" allow="geolocation 'self'" src={`${import.meta.env.BASE_URL}garden/index.html`} style={{height, display: loaded ? 'block' : 'none'}} />
    </div>
    <CloudTransition phase={cloud.phase} timing={cloud.timing} />
    {loaded && footerButtons.length > 0 && (
      <div className="garden-footer-bar">
        {footerButtons.map(b => (
          <button
            key={b.index}
            type="button"
            className={`btn ${b.kind}`}
            disabled={b.disabled}
            onClick={() => frame.current?.contentWindow?.postMessage({ type: 'garden:footer-click', index: b.index }, window.location.origin)}
          >{b.label}</button>
        ))}
      </div>
    )}
    <span className="garden-save-status" role="status" aria-live="polite">{saving ? '저장 중…' : ''}</span>
  </section>
}
