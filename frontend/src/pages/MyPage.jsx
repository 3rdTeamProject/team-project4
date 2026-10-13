import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { storage } from '../api.js'
import NicknameSheet from '../components/NicknameSheet.jsx'
import { useMe } from '../hooks/useMe.js'
import './screens.css'

export default function MyPage() {
  const navigate = useNavigate()
  const { me, setMe, error } = useMe()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!storage.token) return <Navigate to="/" replace />

  return (
    <div className="screen">
      <header className="screen-header">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="뒤로가기">‹</button>
        <h1 className="screen-title">마이페이지</h1>
        <span className="icon-btn-spacer" />
      </header>

      {error && <p className="error">{error}</p>}
      {me && (
        <section className="mypage-card">
          <div className="mypage-name-row">
            <span className="mypage-name">{me.nickname}님</span>
            <button type="button" className="pill-btn" onClick={() => setSheetOpen(true)}>✎ 변경</button>
          </div>
        </section>
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
