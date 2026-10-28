import { levelTier, levelTitle } from '../constants/level.js'
import './LevelBadge.css'

// 레벨 별칭 배지(견습 농부 ~ 농사 달인). 메뉴·마이페이지·계정 연동·레벨업 팝업이 같이 쓴다.
export default function LevelBadge({ level, className = '' }) {
  return <span className={`level-badge tier-${levelTier(level)} ${className}`.trim()}>{levelTitle(level)}</span>
}
