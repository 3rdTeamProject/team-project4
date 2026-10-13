import { useState } from 'react'
import { api } from '../api.js'

const MAX_LENGTH = 10 // backend NICKNAME_MAX_LENGTH와 같게 유지

// 닉네임 변경 바텀 시트
export default function NicknameSheet({ current, onClose, onSaved }) {
  const [value, setValue] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    const nickname = value.trim()
    if (!nickname) {
      setError('닉네임을 입력해 주세요.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const data = await api.updateNickname(nickname)
      onSaved(data.nickname)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="닉네임 변경"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
      >
        <h2 className="sheet-title">닉네임 변경</h2>
        <input
          className="sheet-input"
          value={value}
          maxLength={MAX_LENGTH}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="sheet-count">{value.trim().length}/{MAX_LENGTH}</p>
        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>취소</button>
          <button type="submit" className="btn primary" disabled={saving}>저장</button>
        </div>
      </form>
    </div>
  )
}
