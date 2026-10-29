import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { storage } from '../api.js'
import CropImage from '../components/CropImage.jsx'
import { ChevronRightIcon } from '../components/Icons.jsx'
import { useDex } from '../hooks/useDex.js'
import { useGoBack } from '../hooks/useGoBack.js'
import { groupCrops, matchesSearch, sowableNow, thisMonth } from '../utils/dex.js'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
import './screens.css'
import './dex.css'

export default function Dex() {
  const goBack = useGoBack('/menu')
  const { crops, error } = useDex()
  const [query, setQuery] = useState('')
  const [pickedMonth, setPickedMonth] = useState(null) // null이면 전체, 아니면 그 달에 심을 수 있는 작물만
  const month = thisMonth()
  const groups = useMemo(() => (crops ? groupCrops(crops) : []), [crops])
  const otherMonth = pickedMonth !== null && pickedMonth !== month // 이번 달이 아닌 다른 달을 골랐는지
  const shown = groups.filter((group) => matchesSearch(group, query) && (pickedMonth === null || sowableNow(group, pickedMonth)))

  if (!storage.token) return <Navigate to="/" replace />

  return (
    <div className="screen dex">
      <header className="screen-header journal-aligned-header">
        <div className="journal-aligned-title">
          <button type="button" className="icon-btn journal-aligned-back" onClick={goBack} aria-label="뒤로가기" />
          <h1 className="screen-title">작물 도감</h1>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <input
        type="search"
        className="dex-search"
        placeholder="작물 이름을 검색해요"
        aria-label="작물 이름 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="dex-filters" role="group" aria-label="심을 달로 찾기">
        <button type="button" className="dex-chip" aria-pressed={pickedMonth === null} onClick={() => setPickedMonth(null)}>
          전체
        </button>
        <button type="button" className="dex-chip" aria-label={`이번 달 (${month}월)`} aria-pressed={pickedMonth === month} onClick={() => setPickedMonth(pickedMonth === month ? null : month)}>
          이번 달
        </button>
        <label className="dex-select" data-active={otherMonth}>
          <span className="visually-hidden">다른 달 선택</span>
          <select value={otherMonth ? pickedMonth : ''} onChange={(e) => setPickedMonth(e.target.value ? Number(e.target.value) : null)}>
            <option value="" disabled={!otherMonth}>{otherMonth ? '전체 달' : '다른 달'}</option>
            {MONTHS.filter((m) => m !== month).map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
        </label>
      </div>

      {crops && (
        <>
          <p className="dex-count" role="status">
            {pickedMonth !== null ? `${pickedMonth}월에 심기 좋은 작물` : '전체 작물'} · {shown.length}개
          </p>
          {shown.length === 0 ? (
            <p className="dex-empty">맞는 작물이 없어요</p>
          ) : (
            <ul className="dex-list">
              {shown.map((group) => (
                <li key={group.key}>
                  <Link className="dex-card" to={`/dex/${encodeURIComponent(group.key)}`}>
                    <span className="dex-thumb"><CropImage name={group.key} /></span>
                    <span className="dex-card-body">
                      <span className="dex-card-head">
                        <span className="dex-card-name">{group.name}</span>
                        {sowableNow(group, month) && <span className="dex-badge">지금 심기 좋아요</span>}
                      </span>
                      {group.summary && <span className="dex-card-summary">{group.summary}</span>}
                    </span>
                    <span className="dex-card-arrow"><ChevronRightIcon /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
