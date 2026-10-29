import { Navigate, useLocation } from 'react-router-dom'
import { storage } from '../api.js'
import CloudTransition from '../components/CloudTransition.jsx'
import { GardenFooterBar, GardenFrame, GardenSaveError, useGardenHost } from '../components/GardenHost.jsx'
import { useMediaQuery } from '../hooks/useMediaQuery.js'
import './garden-host.css'

/** 농장 화면. 서버 연결은 GardenHost가 맡고, 여기서는 모바일 화면과 PC 오른쪽 패널 배치만 정한다. */
export default function Home({ gardenView = 'farms' }) {
  const host = useGardenHost()
  const wide = useMediaQuery('(min-width: 1024px)')
  const location = useLocation()
  const show = location.state?.show // PC: 가운데 장면이나 왼쪽 메뉴에서 열라고 한 화면(없으면 오늘 할 일)
  const mobileScene = location.state?.scene ?? host.sceneState

  if (!storage.token) return <Navigate to="/" replace />

  // PC: 가운데 농장 장면은 PcShell이 띄우고, 여기서는 오른쪽 패널에 들어갈 농장 화면(오늘 할 일·전체 농장·칸 상세·재배일지)을 띄운다
  if (wide) {
    return <section className="pc-garden-panel">
      <GardenFrame
        name="panel"
        role="panel"
        view={show?.view ?? (gardenView === 'journal' ? 'journal' : 'tasks')}
        gardenView={gardenView}
        show={show}
        title="우리텃밭 농장 패널"
        style={{display: host.loaded ? 'block' : 'none'}}
      />
      <GardenFooterBar />
    </section>
  }

  return <section className="garden-host">
    <GardenSaveError />
    {!host.loaded && !host.error && <p className="muted garden-loading">내 농장을 불러오는 중…</p>}
    {/* 농장 카드를 눌러 작물 6칸 화면으로 들어갈 때 쓰는 구름 전환(농장 화면 iframe이 덮기/열기를 요청한다) */}
    <div className="garden-zoom" data-cloud={host.cloud.phase} style={host.cloud.timing}>
      <GardenFrame name="main" view={gardenView === 'farms' ? mobileScene?.view || gardenView : gardenView} gardenView={gardenView} show={mobileScene} title="우리텃밭 농장 관리" allow="geolocation 'self'" style={{height: host.height, display: host.loaded ? 'block' : 'none'}} />
    </div>
    <CloudTransition phase={host.cloud.phase} timing={host.cloud.timing} />
    <GardenFooterBar />
  </section>
}
