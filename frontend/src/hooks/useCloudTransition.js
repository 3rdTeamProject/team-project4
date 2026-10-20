import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// 구름 전환: 구름이 양쪽에서 모여 화면을 덮고(close), 준비가 되면 양쪽으로 열린다(open).
// 시간은 여기서 한 번만 정해서 CSS 변수로 내려 준다(CloudTransition.css가 그대로 쓴다).
const FRONT_DELAY_MS = 70      // 앞쪽 구름이 뒤쪽 구름을 따라오는 시간
const CLOSE_MS = 350
const OPEN_MS = 500
const REDUCED_CLOSE_MS = 150   // 동작 줄이기: 구름 이동 대신 짧은 페이드
const REDUCED_OPEN_MS = 200
const MAX_CLOSED_MS = 8000     // 열라는 신호가 끝내 오지 않아도 화면이 영원히 덮여 있지 않게 한다

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// phase: 'idle'(구름 없음) → 'closing' → 'closed' → 'opening' → 'idle'
export function useCloudTransition() {
  const [phase, setPhase] = useState('idle')
  const [reduced, setReduced] = useState(false)
  const phaseRef = useRef('idle')
  const timers = useRef([])
  const closedPromise = useRef(null)

  const go = useCallback(next => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const later = useCallback((fn, ms) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])

  // 덮기: 다 덮이면 풀리는 약속을 돌려준다. 이미 덮는 중이면 같은 약속을 돌려준다
  const close = useCallback(() => {
    if (closedPromise.current) return closedPromise.current
    const quick = prefersReducedMotion()
    setReduced(quick)
    go('closing')
    closedPromise.current = new Promise(resolve => {
      later(() => { go('closed'); resolve() }, (quick ? REDUCED_CLOSE_MS : CLOSE_MS + FRONT_DELAY_MS))
    })
    later(() => open(), MAX_CLOSED_MS)
    return closedPromise.current
  }, [go, later]) // eslint-disable-line react-hooks/exhaustive-deps

  // 열기: 다 열리면 구름을 없앤다
  const open = useCallback(() => {
    if (!closedPromise.current || phaseRef.current === 'opening' || phaseRef.current === 'idle') return
    timers.current.forEach(clearTimeout)
    timers.current = []
    const quick = prefersReducedMotion()
    setReduced(quick)
    go('opening')
    later(() => {
      closedPromise.current = null
      go('idle')
    }, quick ? REDUCED_OPEN_MS : OPEN_MS + FRONT_DELAY_MS)
  }, [go, later])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const timing = useMemo(() => ({
    '--cloud-close': `${reduced ? REDUCED_CLOSE_MS : CLOSE_MS}ms`,
    '--cloud-open': `${reduced ? REDUCED_OPEN_MS : OPEN_MS}ms`,
    '--cloud-front-delay': `${reduced ? 0 : FRONT_DELAY_MS}ms`,
  }), [reduced])

  return { phase, timing, close, open }
}
