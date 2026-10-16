import { useRef, useState } from 'react'
import '../pages/screens.css'

const PRESETS = [
  { time: '07:00', label: '오전 7시' },
  { time: '09:00', label: '오전 9시' },
  { time: '12:00', label: '낮 12시' },
  { time: '18:00', label: '오후 6시' },
  { time: '21:00', label: '오후 9시' },
]

// 오늘 할 일 알림 시간을 고르는 시트. value·onSave는 'HH:MM' 문자열을 주고받는다.
// 자주 쓰는 시간은 칩으로 고르고, 그 밖의 시간은 '직접 선택'으로 시간 입력란을 연다.
export default function NotifyTimeSheet({ value, onSave, onClose }) {
  const [time, setTime] = useState(value)
  const [custom, setCustom] = useState(!PRESETS.some((p) => p.time === value))
  const inputRef = useRef(null)

  // 입력란 어디를 눌러도 시간 선택 창이 열리게 한다(지원하지 않는 브라우저는 기본 동작 그대로).
  function openPicker() {
    try { inputRef.current?.showPicker() } catch { /* 이미 열려 있거나 지원 안 함 */ }
  }

  function pickPreset(t) {
    setTime(t)
    setCustom(false)
  }

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
        <div className="time-chips">
          {PRESETS.map((p) => (
            <button
              key={p.time}
              type="button"
              className={`time-chip${!custom && time === p.time ? ' on' : ''}`}
              aria-pressed={!custom && time === p.time}
              onClick={() => pickPreset(p.time)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={`time-chip${custom ? ' on' : ''}`}
            aria-pressed={custom}
            onClick={() => setCustom(true)}
          >
            직접 선택
          </button>
        </div>
        {custom && (
          <input
            ref={inputRef}
            className="sheet-input time-input"
            type="time"
            value={time}
            aria-label="알림 시간 직접 선택"
            required
            autoFocus
            onClick={openPicker}
            onChange={(e) => setTime(e.target.value)}
          />
        )}
        <p className="sheet-hint">매일 이 시간에 오늘 할 일을 알려 드려요</p>
        <div className="sheet-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn primary" disabled={!time}>저장</button>
        </div>
      </form>
    </div>
  )
}
