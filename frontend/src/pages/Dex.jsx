import { useEffect, useMemo, useRef, useState } from 'react'
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
  const monthPickerRef = useRef(null)
  const month = thisMonth()
  const groups = useMemo(() => (crops ? groupCrops(crops) : []), [crops])
  const otherMonth = pickedMonth !== null && pickedMonth !== month // 이번 달이 아닌 다른 달을 골랐는지
  const shown = groups.filter((group) => matchesSearch(group, query) && (pickedMonth === null || sowableNow(group, pickedMonth)))

  useEffect(() => {
    const closeOnOutsideClick = event => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(event.target)) monthPickerRef.current.open = false
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape' && monthPickerRef.current?.open) {
        monthPickerRef.current.open = false
        monthPickerRef.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const chooseMonth = value => {
    setPickedMonth(value)
    if (monthPickerRef.current) monthPickerRef.current.open = false
  }

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
        <button type="button" className="dex-chip" aria-pressed={pickedMonth === null} onClick={() => chooseMonth(null)}>
          전체
        </button>
        <button type="button" className="dex-chip" aria-label={`이번 달 (${month}월)`} aria-pressed={pickedMonth === month} onClick={() => chooseMonth(pickedMonth === month ? null : month)}>
          이번 달
        </button>
        <details className="dex-select" data-active={otherMonth} ref={monthPickerRef}>
          <summary aria-label="다른 달 선택">{otherMonth ? `${pickedMonth}월` : '다른 달'}</summary>
          <div className="dex-month-options" role="group" aria-label="심을 달 선택">
            {MONTHS.filter((m) => m !== month).map((m) => (
              <button key={m} type="button" className={pickedMonth === m ? 'is-selected' : ''} aria-pressed={pickedMonth === m} onClick={() => chooseMonth(m)}>{m}월</button>
            ))}
          </div>
        </details>
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
