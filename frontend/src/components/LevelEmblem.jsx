import { levelTier } from '../constants/level.js'

export default function LevelEmblem({ level, size = 36, className = '' }) {
  const tier = levelTier(level)
  return <img
    className={`level-emblem ${className}`.trim()}
    src={`/level-icons/tier-${tier}.png`}
    alt={`${tier}등급 농부 이미지`}
    width={size}
    height={size}
    draggable="false"
  />
}
