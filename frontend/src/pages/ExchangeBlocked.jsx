import { Navigate, useNavigate } from 'react-router-dom'
import { storage } from '../api.js'
import { CoinIcon, KakaoIcon } from '../components/Icons.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import { useKakaoLink } from '../hooks/useKakaoLink.js'
import { useMe } from '../hooks/useMe.js'
import './screens.css'
import './exchange.css'

// 비회원이 교환을 시도하면 오는 "교환 불가" 화면
export default function ExchangeBlocked() {
  const navigate = useNavigate()
  const goBack = useGoBack('/pointshop')
  const { me, error } = useMe()
  const { linking, startLink } = useKakaoLink('/pointshop') // 연동이 끝나면 포인트샵으로 돌아온다

  if (!storage.token) return <Navigate to="/" replace />
  // 회원이 주소로 들어오면 포인트샵으로
  if (me && me.login_type !== 'guest') return <Navigate to="/pointshop" replace />

  return (
    <div className="screen ex-screen">
      <header className="screen-header journal-aligned-header">
        <div className="journal-aligned-title">
          <button type="button" className="icon-btn journal-aligned-back" onClick={goBack} aria-label="돌아가기" />
          <h1 className="screen-title">포인트 교환</h1>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="block-body">
        <div className="block-art">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2.5" />
            <path d="M8 11V8a4 4 0 018 0v3" />
            <path d="M12 15v2.5" />
          </svg>
        </div>
        <p className="block-title">카카오톡을 연동하면<br />교환할 수 있어요</p>
        <p className="block-sub">비회원은 이 기기에만 기록이 저장돼요.<br />연동하면 지금까지 모은 포인트도<br />카카오 계정으로 그대로 옮겨져요.</p>
        {me && (
          <span className="block-points">
            <CoinIcon size={28} />
            {me.point.toLocaleString()}P
          </span>
        )}
      </div>

      <div className="ex-footer">
        <button type="button" className="block-kakao" onClick={startLink} disabled={linking}>
          <KakaoIcon />
          {linking ? '연동 중…' : '카카오톡으로 연동하기'}
        </button>
        <button type="button" className="block-later" onClick={() => navigate('/pointshop', { replace: true })}>나중에 할게요</button>
      </div>
    </div>
  )
}
