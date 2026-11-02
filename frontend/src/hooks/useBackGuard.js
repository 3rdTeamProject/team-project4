import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// 카카오 로그인 화면은 다른 사이트라 브라우저 기록에서 지울 수 없다.
// 기록 맨 앞(idx 0)에 도착하면 같은 화면을 한 칸 더 쌓아, 폰의 뒤로가기가 카카오 화면으로 나가지 않게 막는다.
// 카카오를 다녀온 탭에서만 동작한다(sessionStorage에 표시). 비회원은 평소처럼 뒤로가기로 앱을 닫을 수 있다.
const KEY = 'kakao-in-history'
const OPEN_PATHS = ['/', '/auth/kakao/callback'] // 로그인 전 화면은 막지 않는다

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

  useEffect(() => {
    if (OPEN_PATHS.includes(pathname) || window.history.state?.idx || !kakaoInHistory()) return
    navigate(`${pathname}${search}`, { state })
  }, [key, navigate, pathname, search, state])
}
