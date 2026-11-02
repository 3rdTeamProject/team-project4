import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// 카카오 로그인 화면은 다른 사이트라 브라우저 기록에서 지울 수 없다.
// 기록 맨 앞(idx 0)에 같은 화면을 한 칸 더 쌓아, 폰의 뒤로가기가 카카오 화면으로 나가지 않게 막는다.
// 브라우저는 터치 없이 쌓은 기록을 뒤로가기에서 건너뛰므로 첫 터치 때 쌓고, 맨 앞에 다시 닿으면 앞으로 한 칸 간다.
// 카카오를 다녀온 탭에서만 동작한다(sessionStorage에 표시). 비회원은 평소처럼 뒤로가기로 앱을 닫을 수 있다.
const KEY = 'kakao-in-history'
const OPEN_PATHS = ['/', '/auth/kakao/callback'] // 로그인 전 화면은 막지 않는다
export const GARDEN_TOUCH = 'garden-touch' // 농장 화면(iframe) 안의 터치는 바깥 창에 안 잡혀서 따로 알려 받는다

export function markKakaoInHistory() {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch { /* 저장소를 못 쓰면 뒤로가기를 막지 못할 뿐 로그인은 동작한다 */ }
}

function kakaoInHistory() {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function useBackGuard() {
  const navigate = useNavigate()
  const { key, pathname, search, state } = useLocation()
  const stacked = useRef(false)

  useEffect(() => {
    if (OPEN_PATHS.includes(pathname) || window.history.state?.idx || !kakaoInHistory()) return
    if (stacked.current) {
      navigate(1)
      return
    }
    const stack = () => {
      stacked.current = true
      navigate(`${pathname}${search}`, { state })
    }
    window.addEventListener('click', stack, { capture: true, once: true })
    window.addEventListener(GARDEN_TOUCH, stack, { once: true })
    return () => {
      window.removeEventListener('click', stack, { capture: true })
      window.removeEventListener(GARDEN_TOUCH, stack)
    }
  }, [key, navigate, pathname, search, state])
}
