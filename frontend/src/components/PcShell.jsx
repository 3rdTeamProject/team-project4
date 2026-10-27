import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMediaQuery } from '../hooks/useMediaQuery.js'
import CloudTransition from './CloudTransition.jsx'
import { GardenFrame, GardenSaveError, useGardenHost } from './GardenHost.jsx'
import PcSideNav from './PcSideNav.jsx'
import '../pages/pc-layout.css'

/**
 * 로그인 후 모든 화면을 감싸는 틀. PC(1024px 이상)에서만 왼쪽 메뉴 / 가운데 농장 장면 / 오른쪽 패널 3단으로 만들고,
 * 각 화면(Outlet)을 오른쪽 패널 안에 보여 준다. 모바일은 화면(Outlet)만 그대로 보여 준다.
 */
export default function PcShell() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const host = useGardenHost()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const wasWide = useRef(wide)
  useEffect(() => {
    if (wasWide.current && !wide && pathname === '/menu') {
      navigate('/home', { replace: true, state: { scene: host.sceneState } })
    }
    wasWide.current = wide
  }, [wide, pathname, navigate, host.sceneState])
  return wide ? <PcLayout /> : <Outlet />
}

function PcLayout() {
  const host = useGardenHost()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 농장 화면(/home)은 패널 안 농장 화면이 어느 화면인지에 따라, 그 밖의 화면(메뉴·재배일지·포인트샵…)은 메뉴를 강조한다
  const active = pathname === '/home' ? (['farms', 'tasks'].includes(host.panelView) ? host.panelView : null) : 'menu'
  const select = key => {
    if (key === 'menu') { if (pathname !== '/menu') navigate('/menu') } else host.openPanel({ view: key })
  }

  return <div className="pc-shell">
    <div className="pc-scene">
      {!host.loaded && !host.error && <p className="muted">내 농장을 불러오는 중…</p>}
      <GardenFrame name="main" role="scene" view="garden" title="우리텃밭 농장 관리" allow="geolocation 'self'" style={{display: host.loaded ? 'block' : 'none'}} />
    </div>
    <div className="pc-cloud-area"><CloudTransition phase={host.cloud.phase} timing={host.cloud.timing} /></div>
    <PcSideNav active={active} onSelect={select} dev={host.dev} onDev={host.sendDev} />
    <section className="pc-panel">
      <GardenSaveError />
      <div className="pc-panel-body"><div className="app"><Outlet /></div></div>
    </section>
  </div>
}
