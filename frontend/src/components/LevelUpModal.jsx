import { useEffect, useRef } from 'react'
import { levelTier, levelTitle } from '../constants/level.js'
import LevelBadge from './LevelBadge.jsx'
import './LevelUpModal.css'

// 메달 둘레로 퍼지는 반짝이는 점. 위치는 em 단위(점 크기 기준)로 흩어진다
const SPARKS = Array.from({ length: 12 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 12
  const radius = index % 2 ? 4.2 : 3.2
  return {
    dx: `${(Math.cos(angle) * radius).toFixed(2)}em`,
    dy: `${(Math.sin(angle) * radius).toFixed(2)}em`,
    delay: `${(index % 4) * 90}ms`,
  }
})

/** 레벨업 팝업. 확인 버튼·배경 누르기·Esc로 닫는다. from/to는 올라가기 전·후 레벨 */
export default function LevelUpModal({ from, to, motion = true, onClose }) {
  const button = useRef(null)
  const newTitle = levelTier(to) > levelTier(from)

  useEffect(() => {
    button.current?.focus()
    const closeOnEscape = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="levelup-backdrop" data-motion={motion ? 'on' : 'off'} onClick={onClose}>
      <div
        className="levelup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="levelup-title"
        onClick={event => event.stopPropagation()}
      >
        <h2 id="levelup-title" className="levelup-heading">레벨 업!</h2>
        <div className="levelup-medal-wrap">
          <div className="levelup-medal"><span>Lv</span><b>{to}</b></div>
          {SPARKS.map((spark, index) => (
            <span
              key={index}
              className="levelup-spark"
              aria-hidden="true"
              style={{ '--dx': spark.dx, '--dy': spark.dy, '--delay': spark.delay }}
            >
              ✦
            </span>
          ))}
        </div>
        <p className="levelup-change">Lv.{from} → Lv.{to}</p>
        <LevelBadge level={to} />
        {newTitle && <p className="levelup-new">새 별칭을 얻었어요! {levelTitle(from)} → {levelTitle(to)}</p>}
        <button ref={button} type="button" className="btn primary" onClick={onClose}>확인</button>
      </div>
    </div>
  )
}
