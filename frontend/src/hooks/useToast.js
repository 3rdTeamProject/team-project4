import { useEffect, useState } from 'react'

// 잠깐 보였다 사라지는 안내 문구
export function useToast(initial = '', duration = 2500) {
  const [toast, setToast] = useState(initial)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), duration)
    return () => clearTimeout(timer)
  }, [toast, duration])
  return [toast, setToast]
}
