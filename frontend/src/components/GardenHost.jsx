import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { useCloudTransition } from '../hooks/useCloudTransition.js'
import { useGoBack } from '../hooks/useGoBack.js'
import '../pages/garden-host.css'

/**
 * 농장 화면(iframe)과 서버를 이어 주는 곳. 서버 저장·할 일 같은 요청을 대신 처리하고, 화면(iframe)들의 메시지를 전달한다.
 * 모바일은 농장 화면이 하나(main)이고, PC 레이아웃(1024px 이상)은 가운데 장면(main, role=scene)과 오른쪽 패널(panel, role=panel) 둘이다.
 * 화면은 GardenFrame으로 띄우면 알아서 등록된다. 모든 로그인 후 화면을 감싸서, PC에서 화면을 옮겨 다녀도 가운데 장면이 유지된다.
 */
const GardenHostContext = createContext(null)
export const useGardenHost = () => useContext(GardenHostContext)

// 작물 목록(작물 종류·할 일 여부·심는 방식 제한)은 거의 바뀌지 않는데 크기가 커서(약 28KB),
// 농장 화면에 들어올 때마다 다시 받지 않도록 한 번 받은 것을 기억한다(새로고침하면 다시 받는다)
let cropsPromise = null
function loadCrops() {
  cropsPromise ??= api.gardenCrops().catch(error => { cropsPromise = null; throw error })
  return cropsPromise
}

const ORIGIN = window.location.origin

export function GardenHostProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  // 재배일지처럼 메뉴에서 열린 화면의 뒤로가기는 메뉴로 새로 이동하지 않고 한 단계 뒤로 간다(기록이 쌓여 갇히는 것을 막음)
  const goBack = useGoBack('/menu')
  const cloud = useCloudTransition()
  const live = useRef({})
  live.current = { navigate, goBack, cloud, pathname: location.pathname }

  // frames: 이름('main' | 'panel') → { el, getOpts, ready, inited }
  const frames = useRef({})
  const session = useRef(null)
  const sessionState = useRef('idle') // idle → loading → ready (실패하면 failed)
  const loadId = useRef(0)
  const latest = useRef(null)
  const busy = useRef(false)
  const destination = useRef(null)
  const lastSaver = useRef('main')
  const footerFrame = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [height, setHeight] = useState(700)
  // 농장 화면(iframe) 아래 버튼. iframe 안에서는 스크롤을 따라오지 못해서 바깥에서 하단 고정 막대로 보여 준다
  const [footerButtons, setFooterButtons] = useState([])
  // PC: 오른쪽 패널의 농장 화면이 지금 어느 화면인지(왼쪽 메뉴 강조용), 개발용 날짜·날씨 값
  const [panelView, setPanelView] = useState(null)
  const [sceneState, setSceneState] = useState(null)
  const [dev, setDev] = useState(null)

  const tell = (name, body) => frames.current[name]?.el?.contentWindow?.postMessage(body, ORIGIN)
  const tellOthers = (from, body) => Object.keys(frames.current).forEach(name => { if (name !== from) tell(name, body) })

  // 화면이 준비됐다는 신호(garden:ready)와 데이터 도착 중 늦은 쪽이 올 때 처음 한 번만 데이터를 보낸다
  function sendInit(name) {
    const f = frames.current[name]
    if (!f || !f.ready || f.inited || !session.current) return
    f.inited = true
    const { role, show, view: wanted } = f.getOpts()
    // PC 패널은 농장이 하나도 없으면 오늘 할 일(비어 있음) 대신 '첫 농장 만들기'가 있는 전체 농장 화면부터 보여 준다
    const view = role === 'panel' && !show && wanted === 'tasks' && session.current.state.farms.length === 0 ? 'farms' : wanted
    f.el.contentWindow?.postMessage({ type: 'garden:init', ...session.current, view, role, show }, ORIGIN)
  }

  function loadSession() {
    if (sessionState.current !== 'idle' || !storage.token) return
    sessionState.current = 'loading'
    const id = ++loadId.current
    loadCrops().catch(() => {}) // 농장 화면(iframe)이 물어보기 전에 미리 받아 둔다(실패하면 화면이 물어볼 때 다시 시도한다)
    Promise.all([api.me(), api.gardenState()]).then(([me, data]) => {
      if (id !== loadId.current) return
      session.current = { userId: me.id, ...data }
      sessionState.current = 'ready'
      setLoaded(true)
      Object.keys(frames.current).forEach(sendInit)
    }).catch(e => {
      if (id !== loadId.current) return
      sessionState.current = 'failed'
      setError(e.message)
    })
  }

  // 농장 화면이 하나도 없으면(농장 화면을 떠나면) 다음에 열 때 서버에서 새로 받는다
  function reset() {
    loadId.current++
    session.current = null
    sessionState.current = 'idle'
    latest.current = null
    setLoaded(false)
    setError('')
    setFooterButtons([])
    setPanelView(null)
    setSceneState(null)
    setDev(null)
  }

  const registerFrame = useCallback((name, el, getOpts) => {
    frames.current[name] = { el, getOpts, ready: false, inited: false }
    loadSession()
    return () => {
      if (frames.current[name]?.el !== el) return
      delete frames.current[name]
      if (footerFrame.current === name) { footerFrame.current = null; setFooterButtons([]) }
      if (name === 'panel') setPanelView(null)
      // 화면 폭 변경으로 iframe이 교체되는 동안에는 새 화면의 등록을 기다린다.
      if (!Object.keys(frames.current).length) queueMicrotask(() => {
        if (!Object.keys(frames.current).length) reset()
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      // PC: 저장이 끝나면 저장하지 않은 쪽 농장 화면도 서버 내용으로 맞춘다
      tellOthers(lastSaver.current, { type: 'garden:pc-refresh' })
      if (destination.current === 'back') live.current.goBack()
      else if (destination.current) live.current.navigate(destination.current)
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

  // PC: 오른쪽 패널에 농장 화면(오늘 할 일·전체 농장·칸 상세 등)을 연다. 패널이 없는 화면(메뉴 등)에 있으면 먼저 /home으로 간다
  const openPanel = useCallback(show => {
    if (live.current.pathname === '/home' && frames.current.panel?.inited) {
      tell('panel', { ...show, type: 'garden:pc-show' })
    } else {
      live.current.navigate('/home', { state: { show }, replace: live.current.pathname === '/home' })
    }
  }, [])

  const sendDev = useCallback(action => tell('main', { type: 'garden:pc-dev', ...action }), [])
  const clickFooter = useCallback(index => tell(footerFrame.current, { type: 'garden:footer-click', index }), [])
  const retrySave = useCallback(() => (latest.current ? flush() : window.location.reload()), []) // eslint-disable-line react-hooks/exhaustive-deps

  // 메시지는 한 곳에서만 받고, 최신 값은 ref로 읽는다
  const handler = useRef(null)
  handler.current = event => {
    const from = Object.keys(frames.current).find(name => frames.current[name].el?.contentWindow === event.source)
    if (event.origin !== ORIGIN || !from) return
    const opts = frames.current[from].getOpts()
    const reply = body => event.source.postMessage(body, ORIGIN)
    const message = event.data
    if (message?.type === 'garden:ready') {
      frames.current[from].ready = true
      sendInit(from)
    } else if (message?.type === 'garden:height' && Number.isFinite(message.height)) {
      if (!opts.role) setHeight(Math.max(320, Math.min(message.height, 20000)))
    } else if (message?.type === 'garden:save' && message.state) {
      latest.current = message.state
      lastSaver.current = from
      flush()
    } else if (message?.type === 'garden:api' && Object.hasOwn(gardenOps, message.op)) {
      gardenOps[message.op](message.payload).then(data => {
        reply({ type: 'garden:api-result', id: message.id, ok: true, data })
        // 할 일 완료·날짜 이동은 서버를 바로 바꾸므로 다른 쪽 농장 화면도 맞춘다
        if (message.op === 'complete' || message.op === 'devdayset') tellOthers(from, { type: 'garden:pc-refresh' })
      }, e => reply({ type: 'garden:api-result', id: message.id, ok: false, error: e.message, status: e.status }))
    } else if (message?.type === 'garden:footer' && Array.isArray(message.buttons)) {
      if (opts.role === 'scene') return // PC에서는 오른쪽 패널의 버튼만 아래 막대로 보여 준다
      footerFrame.current = from
      setFooterButtons(message.buttons.slice(0, 3).map(b => ({
        index: Number(b.index), label: String(b.label), kind: b.kind === 'primary' ? 'primary' : 'secondary', disabled: Boolean(b.disabled),
      })))
    } else if (message?.type === 'garden:cloud-close') {
      live.current.cloud.close().then(() => reply({ type: 'garden:cloud-closed' }))
    } else if (message?.type === 'garden:cloud-open') {
      live.current.cloud.open()
    } else if (message?.type === 'garden:scroll-top') {
      if (!opts.role) window.scrollTo({top: 0, behavior: 'instant'})
    } else if (message?.type === 'garden:navigate' && message.to === '/menu') {
      // 농장 화면의 ☰는 메뉴를 새로 연다. 일지 등 메뉴에서 열린 화면의 ‹는 이전(메뉴)으로 돌아간다
      destination.current = opts.gardenView === 'farms' ? '/menu' : 'back'
      flush()
    } else if (message?.type === 'garden:navigate' && message.to === '/diagnosis/history' && typeof message.cropName === 'string') {
      destination.current = `/diagnosis/history?${new URLSearchParams({ crop_name: message.cropName, from: 'journal' })}`
      flush()
    } else if (message?.type === 'garden:pc-open' && from === 'main') {
      openPanel(message) // 가운데 장면에서 누른 칸·농장 수정 같은 요청은 오른쪽 패널에 연다
    } else if (message?.type === 'garden:pc-select' && from === 'panel') {
      tell('main', message)
    } else if (message?.type === 'garden:pc-view' && from === 'panel') {
      setPanelView(message.view)
    } else if (message?.type === 'garden:pc-view' && from === 'main' && opts.role === 'scene') {
      setSceneState({ view: message.view, selected: message.selected, plotIndex: message.plotIndex, pendingPlot: message.pendingPlot })
    } else if (message?.type === 'garden:pc-changed' && from === 'main') {
      tell('panel', { type: 'garden:pc-refresh' })
    } else if (message?.type === 'garden:dev' && from === 'main') {
      setDev(message.dev)
    }
  }

  useEffect(() => {
    const onMessage = event => handler.current(event)
    const beforeLeave = event => {
      if (latest.current || busy.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('beforeunload', beforeLeave)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('beforeunload', beforeLeave)
    }
  }, [])

  const value = { loaded, error, saving, height, footerButtons, panelView, sceneState, dev, cloud, registerFrame, openPanel, sendDev, clickFooter, retrySave }
  return <GardenHostContext.Provider value={value}>
    {children}
    <span className="garden-save-status" role="status" aria-live="polite">{saving ? '저장 중…' : ''}</span>
  </GardenHostContext.Provider>
}

/** 농장 화면(iframe). 띄우면 GardenHostProvider에 등록되어 서버와 이어진다. role: 없음(모바일) / 'scene' / 'panel' */
export function GardenFrame({ name, role, view, gardenView = 'farms', show, ...props }) {
  const host = useGardenHost()
  const ref = useRef(null)
  const opts = useRef({})
  opts.current = { role, view, gardenView, show }
  const { registerFrame } = host
  useEffect(() => registerFrame(name, ref.current, () => opts.current), [registerFrame, name])
  return <iframe ref={ref} src={`${import.meta.env.BASE_URL}garden/index.html`} {...props} />
}

/** 서버에 저장하지 못했을 때 알림과 다시 시도 */
export function GardenSaveError() {
  const { error, saving, retrySave } = useGardenHost()
  if (!error) return null
  return <div className="garden-save-error" role="alert">{error}
    <button className="btn secondary" disabled={saving} onClick={retrySave}>다시 시도</button>
  </div>
}

/** 농장 화면 아래 버튼을 바깥에서 하단 고정 막대로 보여 준다 */
export function GardenFooterBar() {
  const { loaded, footerButtons, clickFooter } = useGardenHost()
  if (!loaded || footerButtons.length === 0) return null
  return (
    <div className="garden-footer-bar">
      {footerButtons.map(b => (
        <button key={b.index} type="button" className={`btn ${b.kind}`} disabled={b.disabled} onClick={() => clickFooter(b.index)}>{b.label}</button>
      ))}
    </div>
  )
}
