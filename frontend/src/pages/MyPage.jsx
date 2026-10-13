import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { CoinIcon, SproutIcon } from '../components/Icons.jsx'
import NicknameSheet from '../components/NicknameSheet.jsx'
import { levelProgress } from '../constants/level.js'
import { useMe } from '../hooks/useMe.js'
import './screens.css'

function formatDate(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function formatAmount(amount) {
  const abs = Math.abs(amount).toLocaleString()
  return amount < 0 ? `−${abs}P` : `+${abs}P`
}

export default function MyPage() {
  const navigate = useNavigate()
  const { me, setMe, error } = useMe()
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    api
      .mySummary()
      .then(setSummary)
      .catch((e) => {
        if (e.status !== 401) setSummaryError(e.message)
      })
  }, [])

  if (!storage.token) return <Navigate to="/" replace />

  const progress = me ? levelProgress(me.exp) : null
  const isKakao = me?.login_type === 'kakao'

  return (
    <div className="screen">
      <header className="screen-header">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="뒤로가기">‹</button>
        <h1 className="screen-title">마이페이지</h1>
        <span className="icon-btn-spacer" />
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
            <li>지금까지의 기록이 카카오 계정에 안전하게 저장돼요</li>
            <li>기기를 바꿔도 같은 기록을 이어서 쓸 수 있어요</li>
          </ul>
          <Link className="link-promo-btn" to="/settings">카카오톡 연동하기</Link>
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
            <Link className="shortcut" to="/diagnosis">
              <span className="shortcut-title">진단 기록</span>
              <span className="shortcut-sub">
                {summary.diagnoses > 0 ? `${summary.diagnoses}번 진단했어요` : '아직 진단한 적이 없어요'}
              </span>
            </Link>
          </section>

          <section className="log-section">
            <h2 className="log-title">포인트 내역</h2>
            {summary.point_logs.length === 0 ? (
              <p className="log-empty">아직 받은 포인트가 없어요</p>
            ) : (
              <ul className="log-list">
                {summary.point_logs.map((log, i) => (
                  <li key={i} className="log-item">
                    <div className="log-main">
                      <span className="log-name">{log.name}</span>
                      <span className="log-date">{formatDate(log.created_at)}</span>
                    </div>
                    <span className={`log-amount${log.amount < 0 ? ' minus' : ''}`}>{formatAmount(log.amount)}</span>
                  </li>
                ))}
              </ul>
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
    </div>
  )
}
