import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// 뒤로가기/닫기는 브라우저 기록이 아니라 "정해진 상위 화면"으로 올라간다.
// 상위 화면으로만 올라가므로 메뉴와 하위 화면을 오가는 순환이 생기지 않는다(기록이 어떻게 쌓였든 갇히지 않는다).
//  - 상위 화면은 호출하는 쪽이 parent로 넘긴다. 들어온 경로에 따라 다르면 이동할 때 state.from으로 알려 준다.
//  - 바로 앞 기록이 이미 그 상위 화면이면 한 칸 되돌아가서 기록을 깔끔하게 유지하고, 아니면 현재 기록을 상위 화면으로 바꿔치기한다.
// 어떤 화면을 어느 기록 번호에서 열었는지는 sessionStorage에 적어 둔다(저장소를 못 써도 바꿔치기로 동작한다).
const KEY = 'nav-paths'

function readPaths() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) ?? {}
  } catch {
    return {}
  }
}

function writePath(idx, path) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readPaths(), [idx]: path }))
  } catch { /* 기록 번호를 못 적어도 뒤로가기는 동작한다 */ }
}

export function useGoBack(parent) {
  const navigate = useNavigate()
  const { pathname, state } = useLocation()
  const idx = window.history.state?.idx ?? 0

  useEffect(() => {
    writePath(idx, pathname)
  }, [idx, pathname])

  return () => {
    const target = state?.from ?? parent
    if (idx > 0 && readPaths()[idx - 1] === target) navigate(-1)
    else navigate(target, { replace: true })
  }
}
