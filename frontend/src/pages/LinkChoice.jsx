import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import { CoinIcon, SproutIcon } from '../components/Icons.jsx'
import { levelProgress } from '../constants/level.js'
import './link-choice.css'

// 선택 카드: 닉네임 + 레벨·포인트 박스 + 농장/재배 중 작물/일지 수
function RecordCard({ value, checked, onChange, kind, label, summary }) {
  const progress = levelProgress(summary.exp)
  return (
    <label className={`choice-card${checked ? ' checked' : ''}`}>
      <input
        className="sr-only"
        type="radio"
        name="pick"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <div className="choice-card-body">
        <div className="choice-head">
          <span className={`choice-avatar ${kind}`} aria-hidden="true">
            {kind === 'kakao' ? <KakaoBubble /> : <LeafIcon />}
          </span>
          <div className="choice-who">
            <span className="choice-name">{summary.nickname}</span>
            <span className="choice-kind">{label}</span>
          </div>
          <span className="choice-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        </div>

        <div className="choice-level-box">
          <div className="choice-level">
            <div className="choice-level-row">
              <SproutIcon size={28} />
              <span className="choice-level-label">Lv.{progress.level}</span>
            </div>
            <div className="choice-bar" aria-hidden="true">
              <i style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
            <span className="choice-level-next">
              {progress.next === null ? '최고 레벨이에요' : `다음 레벨까지 ${progress.remaining.toLocaleString()} EXP`}
            </span>
          </div>
          <span className="choice-divider" />
          <div className="choice-point">
            <CoinIcon size={32} />
            <div>
              <span className="choice-point-label">보유 포인트</span>
              <span className="choice-point-value">{summary.point.toLocaleString()}P</span>
            </div>
          </div>
        </div>

        <div className="choice-stats">
          <div className="choice-stat"><b>{summary.farms}</b><span>농장</span></div>
          <div className="choice-stat"><b>{summary.growing_crops}</b><span>재배 중 작물</span></div>
          <div className="choice-stat"><b>{summary.journals}</b><span>일지</span></div>
        </div>
      </div>
    </label>
  )
}

function KakaoBubble() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1f2a1c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4C7.6 4 4 6.9 4 10.4c0 2.2 1.4 4.2 3.6 5.3L6.8 19l3.6-2.2c.5.1 1.1.2 1.6.2 4.4 0 8-2.9 8-6.6S16.4 4 12 4z" />
    </svg>
  )
}

// 사람 모양 아바타를 쓰지 않기로 해서(캔버스의 사람 아이콘 대신) 잎 아이콘을 쓴다
function LeafIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2f7d32" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19c3-4 6-7 10-9" />
    </svg>
  )
}

// 비회원 → 카카오 전환 시, 카카오 계정에 이미 기록이 있을 때 나오는 데이터 선택 화면.
// KakaoCallback이 choice_required 응답을 location.state로 넘겨 준다.
export default function LinkChoice() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const [pick, setPick] = useState('kakao') // 기본 선택은 카카오 기록
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 새로고침 등으로 state를 잃었거나, 비회원 로그인이 아니면 처음으로
  if (!state?.link_ticket || !storage.token) return <Navigate to="/" replace />

  async function submit() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const data = await api.linkKakao({ link_ticket: state.link_ticket, choice: pick })
      storage.clearGuestToken() // 비회원 아이디는 어느 쪽을 골라도 삭제됨
      storage.saveLogin(data.access_token, 'kakao')
      navigate(state.returnTo || '/settings', { replace: true, state: { linked: true } })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="choice-screen">
      <header className="choice-header">
        <Link className="choice-back" to={state.returnTo || '/settings'} aria-label="돌아가기">‹</Link>
        <h1 className="choice-title">데이터 선택</h1>
      </header>

      <div className="choice-content">
        <div>
          <h2 className="choice-lead">이미 쓰던 카카오 계정이에요</h2>
          <p className="choice-sub">비회원으로 쓰던 기록과 카카오 계정의 기록 중 하나를 골라 이어서 쓸 수 있어요</p>
        </div>

        <RecordCard value="guest" checked={pick === 'guest'} onChange={setPick} kind="guest" label="비회원" summary={state.guest} />
        <RecordCard value="kakao" checked={pick === 'kakao'} onChange={setPick} kind="kakao" label="카카오 계정" summary={state.kakao} />

        <div className="choice-warn" role="note">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7a4b00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />
          </svg>
          <span>고르지 않은 쪽 기록은 삭제되고 되돌릴 수 없어요</span>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="choice-footer">
        <button type="button" className="choice-submit" onClick={submit} disabled={saving}>
          {saving ? '처리 중...' : '이 기록으로 계속하기'}
        </button>
      </div>
    </div>
  )
}
