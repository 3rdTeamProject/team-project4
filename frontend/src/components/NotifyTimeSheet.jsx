import { useState } from 'react'
import '../pages/screens.css'

// 오늘 할 일 알림 시간을 고르는 시트. value·onSave는 'HH:MM' 문자열을 주고받는다.
export default function NotifyTimeSheet({ value, onSave, onClose }) {
  const [time, setTime] = useState(value)

  function save(e) {
    e.preventDefault()
    onSave(time)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notify-time-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="notify-time-title" className="sheet-title">알림 시간</h2>
        <input
          className="sheet-input"
          type="time"
          value={time}
          aria-label="알림 시간"
          required
          onChange={(e) => setTime(e.target.value)}
        />
        <p className="sheet-hint">매일 이 시간에 오늘 할 일을 알려 드려요</p>
        <div className="sheet-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn primary" disabled={!time}>저장</button>
        </div>
      </form>
    </div>
  )
}
