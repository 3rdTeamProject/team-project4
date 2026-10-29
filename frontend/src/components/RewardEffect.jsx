import { useEffect, useState } from 'react'
import { levelProgress } from '../constants/level.js'
import LevelBadge from './LevelBadge.jsx'
import LevelUpModal from './LevelUpModal.jsx'
import './RewardEffect.css'

const SHOW_MS = 2800 // 카드가 떠 있는 시간
const SHOW_MS_STILL = 1800 // 움직임을 끈 경우(눈으로 읽을 시간만)

// 반짝이는 점: 위치는 em 단위(점 크기 기준)로 흩어진다
const SPARKS = [
  { dx: '-3.2em', dy: '-1.6em', delay: '0ms' },
  { dx: '3.2em', dy: '-1.8em', delay: '80ms' },
  { dx: '-2em', dy: '-3em', delay: '160ms' },
  { dx: '2.2em', dy: '-3.2em', delay: '240ms' },
  { dx: '0em', dy: '-3.8em', delay: '120ms' },
]

/**
 * 일지를 올린 순간의 연출. "일지를 올렸어요"와 함께 +P가 떠오르고, 경험치 막대가 차오른다.
 * 포인트가 0이면 문구만 보여 준다. 레벨이 올랐다면 카드가 끝난 뒤 레벨업 팝업을 이어서 보여 준다.
 * reward: { earned, bonus, firstHarvest, grownTo(단계가 오른 경우 새 단계), level: { exp, before, after, leveledUp } | null, motion }
 */
export default function RewardEffect({ reward, onDone }) {
  const [phase, setPhase] = useState('points')
  const [filled, setFilled] = useState(!reward.motion) // 움직임을 끄면 처음부터 채운 상태로 보여 준다
  const level = reward.level
  const leveledUp = !!level?.leveledUp
  const before = level ? levelProgress(level.exp - reward.earned) : null
  const after = level ? levelProgress(level.exp) : null
  const showMs = reward.motion ? SHOW_MS : SHOW_MS_STILL

  // 처음 한 번만 실행한다(연출 하나는 key가 바뀌면 새로 만들어진다)
  useEffect(() => {
    // 막대가 이전 값에서 새 값으로 차오르도록 한 프레임 뒤에 값을 바꾼다
    const frame = requestAnimationFrame(() => setFilled(true))
    const timer = setTimeout(() => (leveledUp ? setPhase('levelup') : onDone()), showMs)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'levelup') {
    return <LevelUpModal from={level.before} to={level.after} motion={reward.motion} onClose={onDone} />
  }

  const startRatio = before ? before.ratio : 0
  const endRatio = leveledUp ? 1 : after ? after.ratio : 0
  const width = `${Math.round((filled ? endRatio : startRatio) * 100)}%`

  return (
    <div
      className="reward-effect"
      data-motion={reward.motion ? 'on' : 'off'}
      style={{ '--reward-show': `${showMs}ms` }}
      role="status"
      aria-live="polite"
    >
      <div className="reward-points">
        <span className="reward-done">일지를 올렸어요 ✓</span>
        {reward.earned > 0 && <span className="reward-plus">+{reward.earned}P</span>}
        {reward.firstHarvest && reward.bonus > 0 && (
          <span className="reward-bonus">첫 수확 보너스 +{reward.bonus}P 포함</span>
        )}
        {reward.firstHarvest ? (
          <span className="reward-bonus">첫 수확을 축하해요 🧺</span>
        ) : (
          reward.grownTo && <span className="reward-bonus">{reward.grownTo}단계로 자랐어요 🌱</span>
        )}
        {SPARKS.map((spark, index) => (
          <span
            key={index}
            className="reward-spark"
            aria-hidden="true"
            style={{ '--dx': spark.dx, '--dy': spark.dy, '--delay': spark.delay }}
          >
            ✦
          </span>
        ))}
      </div>
      {level && reward.earned > 0 && (
        <div className="reward-exp">
          <div className="reward-exp-head">
            <b className="reward-level">Lv.{before.level}</b>
            <LevelBadge level={before.level} />
            <span className="reward-exp-gain">+{reward.earned} EXP</span>
          </div>
          <div
            className="reward-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(endRatio * 100)}
            aria-label="경험치"
          >
            <i style={{ width }} />
          </div>
        </div>
      )}
    </div>
  )
}
