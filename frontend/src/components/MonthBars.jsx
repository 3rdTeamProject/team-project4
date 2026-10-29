import { formatMonths } from '../utils/dex.js'
import './month-bars.css'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function Track({ kind, label, months }) {
  return (
    <div className="month-track" data-kind={kind} role="img" aria-label={`${label} ${formatMonths(months)}`}>
      {MONTHS.map((month) => (
        <span key={month} className="month-cell" data-on={months.includes(month) ? 'true' : 'false'} />
      ))}
    </div>
  )
}

/**
 * 1~12월 막대 두 줄(위: 심는 달 초록, 아래: 거두는 달 주황), 아래에 월 숫자와 범례("심기 9~11월").
 * 값이 없는 줄은 숨기고 범례도 같이 뺀다. currentMonth: 오늘 달(1~12)을 숫자에 표시한다.
 */
export default function MonthBars({ sowMonths, harvestMonths, currentMonth }) {
  const hasSow = sowMonths.length > 0
  const hasHarvest = harvestMonths.length > 0
  if (!hasSow && !hasHarvest) return null
  return (
    <div className="month-bars">
      <div className="month-tracks">
        {hasSow && <Track kind="sow" label="심기" months={sowMonths} />}
        {hasHarvest && <Track kind="harvest" label="거두기" months={harvestMonths} />}
      </div>
      <div className="month-scale" aria-hidden="true">
        {MONTHS.map((month) => (
          <span key={month} className={month === currentMonth ? 'is-now' : undefined}>{month}</span>
        ))}
      </div>
      <ul className="month-legend">
        {hasSow && <li><i data-kind="sow" />심기 <b>{formatMonths(sowMonths)}</b></li>}
        {hasHarvest && <li><i data-kind="harvest" />거두기 <b>{formatMonths(harvestMonths)}</b></li>}
      </ul>
    </div>
  )
}
