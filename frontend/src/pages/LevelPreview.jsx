import { useState } from 'react'
import { Link } from 'react-router-dom'
import LevelBadge from '../components/LevelBadge.jsx'
import LevelEmblem from '../components/LevelEmblem.jsx'
import { levelTitle } from '../constants/level.js'
import './screens.css'
import './level-preview.css'

export default function LevelPreview() {
  const [selectedLevel, setSelectedLevel] = useState(1)

  return <main className="screen level-preview-page">
    <header className="screen-header">
      <Link className="icon-btn" to="/menu" aria-label="메뉴로 돌아가기">‹</Link>
      <h1 className="screen-title">등급 이미지 예시</h1>
      <span className="icon-btn-spacer" />
    </header>

    <section className="profile-card level-preview-card" aria-label="메뉴 표시 예시">
      <div className="profile-card-top"><span className="profile-name">메뉴 표시 예시</span></div>
      <div className="profile-stats">
        <span className="profile-stat profile-stat-level">
          <span className="profile-stat-value"><LevelEmblem level={selectedLevel} size={36} /> Lv.{selectedLevel}</span>
          <LevelBadge level={selectedLevel} />
        </span>
        <span className="profile-stats-divider" />
        <span className="profile-stat profile-stat-point">레벨에 따라<br />엠블렘 변경</span>
      </div>
    </section>

    <p className="level-preview-hint">레벨을 누르면 위의 메뉴 표시가 바뀝니다.</p>
    <div className="level-preview-list">
      {[1, 2, 3, 4, 5].map(tier => {
        const firstLevel = tier * 2 - 1
        return <section className="level-preview-tier" key={tier}>
          <LevelEmblem level={firstLevel} size={52} />
          <div className="level-preview-tier-info">
            <strong>{levelTitle(firstLevel)}</strong>
            <span>Lv.{firstLevel}~{firstLevel + 1}</span>
          </div>
          <div className="level-preview-buttons">
            {[firstLevel, firstLevel + 1].map(level => <button key={level} type="button" className={selectedLevel === level ? 'is-selected' : ''} onClick={() => setSelectedLevel(level)} aria-pressed={selectedLevel === level}>Lv.{level}</button>)}
          </div>
        </section>
      })}
    </div>
  </main>
}
