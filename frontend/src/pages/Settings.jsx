import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { useKakaoLink } from '../hooks/useKakaoLink.js'
import { useMe } from '../hooks/useMe.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'
import './settings.css'

const LINK_FAILED = '연동하지 못했어요. 다시 시도해 주세요'

const NOTIFY_ROWS = [
  { key: 'notify_todo', title: '오늘 할 일 알림', sub: '매일 오전 9시' },
  { key: 'notify_weather', title: '서리·비 예보 알림', sub: '내 농장 지역 기준' },
  { key: 'notify_point', title: '포인트 소식' },
]

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c8a74" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function KakaoBubble() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919" aria-hidden="true">
      <path d="M12 4C7.6 4 4 6.9 4 10.4c0 2.2 1.4 4.2 3.6 5.3L6.8 19l3.6-2.2c.5.1 1.1.2 1.6.2 4.4 0 8-2.9 8-6.6S16.4 4 12 4z" />
    </svg>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const location = useLocation()
  const { me, setMe, error } = useMe()
  const [toast, setToast] = useToast(location.state?.linkFailed ? LINK_FAILED : '')
  const { linking, startLink } = useKakaoLink('/settings')

  if (!storage.token) return <Navigate to="/" replace />

  function toggle(key) {
    const next = !me[key]
    setMe((m) => ({ ...m, [key]: next })) // 즉시 반영
    api.updateNotifications({ [key]: next }).catch(() => {
      setMe((m) => ({ ...m, [key]: !next })) // 저장 실패: 원래 값으로
      setToast('저장하지 못했어요')
    })
  }

  function logout() {
    storage.logout() // guest_token은 남겨 둬서 같은 기기에서 비회원으로 다시 시작하면 기록을 이어 쓴다
    navigate('/', { replace: true })
  }

  const comingSoon = () => setToast('준비 중이에요')
  const isGuest = me?.login_type === 'guest'

  return (
    <div className="screen">
      <header className="screen-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/menu')} aria-label="뒤로가기">‹</button>
        <h1 className="screen-title">환경설정</h1>
        <span className="icon-btn-spacer" />
      </header>

      {error && <p className="error">{error}</p>}

      {me && (
        <>
          <section className="set-group">
            <h2 className="set-label">알림</h2>
            <div className="set-card">
              {NOTIFY_ROWS.map((row) => (
                <div key={row.key} className="set-row">
                  <div className="set-text">
                    <span id={`${row.key}-label`} className="set-title">{row.title}</span>
                    {row.sub && <span className="set-sub">{row.sub}</span>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={me[row.key]}
                    aria-labelledby={`${row.key}-label`}
                    className={`switch${me[row.key] ? ' on' : ''}`}
                    onClick={() => toggle(row.key)}
                  >
                    <span className="switch-track"><span className="switch-knob" /></span>
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="set-group">
            <h2 className="set-label">계정</h2>
            <div className="set-card">
              {isGuest ? (
                <div className="set-account">
                  <div className="set-text">
                    <span className="set-title">로그인 방식</span>
                    <span className="set-sub">비회원 · 지금은 이 기기에만 기록이 저장돼요</span>
                  </div>
                  <button type="button" className="kakao-link-btn" onClick={startLink} disabled={linking}>
                    <KakaoBubble />
                    {linking ? '연동 중…' : '카카오톡으로 연동하기'}
                  </button>
                  <p className="set-note">연동하면 지금까지의 기록이 카카오 계정으로 옮겨져요</p>
                </div>
              ) : (
                <div className="set-row">
                  <span className="kakao-badge" aria-hidden="true"><KakaoBubble /></span>
                  <span className="set-title">카카오톡 연동됨</span>
                </div>
              )}
            </div>
          </section>

          <section className="set-group">
            <h2 className="set-label">앱 정보</h2>
            <div className="set-card">
              <button type="button" className="set-row set-link" onClick={comingSoon}>
                <span className="set-title">이용약관</span>
                <Chevron />
              </button>
              <button type="button" className="set-row set-link" onClick={comingSoon}>
                <span className="set-title">개인정보처리방침</span>
                <Chevron />
              </button>
              <div className="set-row">
                <span className="set-title">앱 버전</span>
                <span className="set-value">1.0.0</span>
              </div>
            </div>
          </section>

          <section className="set-group">
            <h2 className="set-label">도움</h2>
            <div className="set-card">
              <button type="button" className="set-row set-link" onClick={comingSoon}>
                <span className="set-title">문의·피드백</span>
                <Chevron />
              </button>
            </div>
          </section>

          <button type="button" className="logout-btn" onClick={logout}>로그아웃</button>
        </>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
