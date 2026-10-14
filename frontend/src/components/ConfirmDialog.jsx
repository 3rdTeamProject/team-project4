import { useEffect, useRef } from 'react'
import '../pages/confirm.css'

// 삭제 같은 되돌릴 수 없는 동작 전에 한 번 더 묻는 창. 바깥을 누르거나 Esc를 누르면 취소.
export default function ConfirmDialog({ title = '삭제하시겠습니까?', message, confirmLabel = '확인', onConfirm, onCancel }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus() // 실수로 바로 확인을 누르지 않게 취소에 먼저 초점을 둔다
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <p id="confirm-title" className="confirm-title">{title}</p>
        {message && <p className="confirm-message">{message}</p>}
        <div className="confirm-actions">
          <button type="button" ref={cancelRef} className="confirm-cancel" onClick={onCancel}>취소</button>
          <button type="button" className="confirm-ok" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
