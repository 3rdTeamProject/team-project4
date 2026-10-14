import { formatLogAmount, formatLogDate } from '../constants/pointLog.js'

export default function PointLogList({ logs }) {
  return (
    <ul className="log-list">
      {logs.map((log, i) => (
        <li key={i} className="log-item">
          <div className="log-main">
            <span className="log-name">{log.name}</span>
            <span className="log-date">{formatLogDate(log.created_at)}</span>
          </div>
          <span className={`log-amount${log.amount < 0 ? ' minus' : ''}`}>{formatLogAmount(log.amount)}</span>
        </li>
      ))}
    </ul>
  )
}
