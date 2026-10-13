import { useEffect, useState } from 'react'

// 잠깐 보였다 사라지는 안내 문구
export function useToast(initial = '') {
  const [toast, setToast] = useState(initial)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(timer)
  }, [toast])
  return [toast, setToast]
}
