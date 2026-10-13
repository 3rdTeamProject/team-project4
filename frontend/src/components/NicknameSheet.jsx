import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

const MAX_LENGTH = 10 // backend NICKNAME_MAX_LENGTH와 같게 유지

// 화면에 보이는 글자 수(이모티콘도 1자). maxlength는 UTF-16 기준이라 쓰지 않는다.
const countChars = (text) => [...text].length

// 줄바꿈으로 취급하는 문자 코드 (backend NICKNAME_LINE_BREAKS와 같게 유지)
const LINE_BREAK_CODES = [0x0a, 0x0d, 0x0b, 0x0c, 0x85, 0x2028, 0x2029]

// 닉네임 변경 바텀 시트
export default function NicknameSheet({ current, onClose, onSaved }) {
  const [value, setValue] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const trimmed = value.trim()
  const length = countChars(trimmed)
  const tooLong = length > MAX_LENGTH
  const hasLineBreak = [...trimmed].some((ch) => LINE_BREAK_CODES.includes(ch.codePointAt(0)))

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  function validate() {
    if (!trimmed) return '닉네임을 입력해 주세요.'
    if (hasLineBreak) return '닉네임에는 줄바꿈을 넣을 수 없어요.'
    if (tooLong) return `닉네임은 1~${MAX_LENGTH}자로 입력해 주세요.`
    return ''
  }

  async function save(e) {
    e.preventDefault()
    if (saving) return
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    setSaving(true)
    setError('')
    try {
      const data = await api.updateNickname(trimmed)
      onSaved(data.nickname)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={() => !saving && onClose()}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-sheet-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="nickname-sheet-title" className="sheet-title">닉네임 변경</h2>
        <input
          ref={inputRef}
          className="sheet-input"
          value={value}
          aria-label="닉네임"
          aria-invalid={tooLong || undefined}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
        />
        <div className="sheet-hint-row">
          <p className="sheet-hint">1~10자로 입력해주세요 (앞뒤 공백은 빼고 저장돼요)</p>
          <p className={`sheet-count${tooLong ? ' over' : ''}`}>{length}/{MAX_LENGTH}</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>취소</button>
          <button type="submit" className="btn primary" disabled={saving || !trimmed || tooLong}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
