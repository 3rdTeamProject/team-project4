import { useEffect, useState } from 'react'

// 화면 폭 같은 조건이 맞는지 알려 준다(조건이 바뀌면 다시 그린다). 예: useMediaQuery('(min-width: 1024px)')
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}
