import { useEffect, useState } from 'react'
import { kakaoAuthorizeUrl } from '../api.js'

// 비회원 → 카카오 연동 시작. 카카오 로그인으로 이동하고, 끝나면(성공·취소·실패·선택 화면 후)
// KakaoCallback과 LinkChoice가 returnTo 화면으로 돌려보낸다.
export function useKakaoLink(returnTo) {
  const [linking, setLinking] = useState(false)

  // 카카오 화면에서 뒤로가기로 돌아오면(bfcache) 버튼을 다시 쓸 수 있게
  useEffect(() => {
    const onShow = (e) => e.persisted && setLinking(false)
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  function startLink() {
    if (linking) return
    setLinking(true)
    try {
      sessionStorage.setItem('kakao_flow', 'link')
      sessionStorage.setItem('kakao_return', returnTo)
    } catch {
      // 저장소를 못 쓰면 돌아올 곳 안내만 못 한다
    }
    window.location.href = kakaoAuthorizeUrl()
  }

  return { linking, startLink }
}
