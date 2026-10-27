import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { api, storage } from '../api.js'
import { CoinIcon, ReceiptIcon, SproutIcon } from '../components/Icons.jsx'
import NicknameSheet from '../components/NicknameSheet.jsx'
import PointLogList from '../components/PointLogList.jsx'
import { levelProgress } from '../constants/level.js'
import { useGoBack } from '../hooks/useGoBack.js'
import { useKakaoLink } from '../hooks/useKakaoLink.js'
import { useMe } from '../hooks/useMe.js'
import { useToast } from '../hooks/useToast.js'
import './screens.css'

export default function MyPage() {
  const location = useLocation()
  const { me, setMe, error } = useMe()
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [ingOrders, setIngOrders] = useState(null) // 진행 중인 주문 수 (불러오기 전에는 null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toast] = useToast(location.state?.linkFailed ? '연동하지 못했어요. 다시 시도해 주세요' : '')
  const { linking, startLink } = useKakaoLink('/mypage')
  const goBack = useGoBack('/menu')

  useEffect(() => {
    api
      .mySummary()
      .then(setSummary)
      .catch((e) => {
        if (e.status !== 401) setSummaryError(e.message)
      })
  }, [])

  const isKakao = me?.login_type === 'kakao'

  // 주문은 카카오 회원만 만들 수 있어서 비회원은 부르지 않는다. 개수는 GET /me/orders?status=ing 결과의 길이.
  useEffect(() => {
    if (!isKakao) return
    api.orders('ing').then((list) => setIngOrders(list.length)).catch(() => {})
  }, [isKakao])

  if (!storage.token) return <Navigate to="/" replace />

  const progress = me ? levelProgress(me.exp) : null

  return (
    <div className="screen">
      <header className="screen-header journal-aligned-header">
        <div className="journal-aligned-title">
          <button type="button" className="icon-btn journal-aligned-back" onClick={goBack} aria-label="뒤로가기" />
          <h1 className="screen-title">마이페이지</h1>
        </div>
      </header>

      {(error || summaryError) && <p className="error">{error || summaryError}</p>}

      {me && (
        <section className="mypage-card">
          <div className="mypage-name-row">
            <span className="mypage-name">{me.nickname}님</span>
            <button type="button" className="pill-btn" onClick={() => setSheetOpen(true)}>✎ 변경</button>
          </div>

          <span className={`login-pill${isKakao ? ' kakao' : ''}`}>
            {isKakao ? '카카오톡으로 로그인됨' : '비회원으로 이용 중'}
          </span>

          <div className="level-box">
            <div className="level-side">
              <SproutIcon size={28} />
              <span className="level-label">Lv.{progress.level}</span>
              <div
                className="level-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.ratio * 100)}
                aria-label="다음 레벨까지 진행도"
              >
                <i style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
              </div>
              <span className="level-next">
                {progress.next === null ? '최고 레벨이에요' : `다음 레벨까지 ${progress.remaining.toLocaleString()} EXP`}
              </span>
            </div>
            <div className="level-divider" />
            <div className="point-side">
              <CoinIcon size={28} />
              <span className="point-label">보유 포인트</span>
              <span className="point-value">{me.point.toLocaleString()}P</span>
            </div>
          </div>
        </section>
      )}

      {me && me.login_type === 'guest' && (
        <section className="link-promo" aria-label="카카오톡 연동 안내">
          <div className="link-promo-head">
            <span className="kakao-badge" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919">
                <path d="M12 4C7.6 4 4 6.9 4 10.4c0 2.2 1.4 4.2 3.6 5.3L6.8 19l3.6-2.2c.5.1 1.1.2 1.6.2 4.4 0 8-2.9 8-6.6S16.4 4 12 4z" />
              </svg>
            </span>
            <h2 className="link-promo-title">카카오톡으로 연동해 보세요</h2>
          </div>
          <ul className="link-promo-list">
            <li>기록이 내 계정에 안전하게 저장돼요</li>
            <li>기기를 바꿔도 이어서 쓸 수 있어요</li>
          </ul>
          <button type="button" className="link-promo-btn" onClick={startLink} disabled={linking}>
            {linking ? '연동 중…' : '카카오톡 연동하기'}
          </button>
        </section>
      )}

      {summary && (
        <>
          <section className="stat-row" aria-label="내 활동 통계">
            <div className="stat-cell">
              <span className="stat-value">{summary.farms}</span>
              <span className="stat-label">내 농장</span>
            </div>
            <div className="stat-cell">
              <span className="stat-value">{summary.growing_crops}</span>
              <span className="stat-label">재배 중 작물</span>
            </div>
            <div className="stat-cell">
              <span className="stat-value">{summary.harvested}</span>
              <span className="stat-label">수확 완료</span>
            </div>
          </section>

          <section className="shortcut-row">
            <Link className="shortcut" to="/journals">
              <span className="shortcut-title">재배일지</span>
              <span className="shortcut-sub">
                {summary.journals > 0 ? `지금까지 ${summary.journals}개` : '아직 쓴 일지가 없어요'}
              </span>
            </Link>
            <Link className="shortcut" to="/diagnosis/history">
              <span className="shortcut-title">진단 기록</span>
              <span className="shortcut-sub">
                {summary.diagnoses > 0 ? `${summary.diagnoses}번 진단했어요` : '아직 진단한 적이 없어요'}
              </span>
            </Link>
          </section>

          {isKakao && (
            <Link className="order-shortcut" to="/pointshop/orders" state={{ from: '/mypage' }}>
              <span className="order-shortcut-icon"><ReceiptIcon size={20} /></span>
              <span className="order-shortcut-text">
                <span className="shortcut-title">주문 내역</span>
                {ingOrders !== null && <span className="shortcut-sub">진행 중 {ingOrders}건</span>}
              </span>
              <svg className="order-shortcut-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          )}

          <section className="log-section">
            <h2 className="log-title">포인트 내역</h2>
            {summary.point_logs.length === 0 ? (
              <p className="log-empty">아직 받은 포인트가 없어요</p>
            ) : (
              <PointLogList logs={summary.point_logs} />
            )}
            {summary.point_logs.length > 0 && (
              <Link className="log-more-link" to="/mypage/points">포인트 내역 자세히 보기</Link>
            )}
          </section>
        </>
      )}

      {sheetOpen && me && (
        <NicknameSheet
          current={me.nickname}
          onClose={() => setSheetOpen(false)}
          onSaved={(nickname) => {
            setMe({ ...me, nickname })
            setSheetOpen(false)
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
