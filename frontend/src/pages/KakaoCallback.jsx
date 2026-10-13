import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, storage } from '../api.js'
import { pathAfterLogin } from '../intro.js'
import { NOTICE_KAKAO_CANCELLED, NOTICE_LOGIN_FAILED } from '../loginNotice.js'

// 인가 코드는 1회용이라 StrictMode의 effect 이중 실행에서도 한 번만 호출한다
const handledCodes = new Set()

export default function KakaoCallback() {
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // 실패/취소는 시작 화면으로 돌려보내고 안내 문구를 넘긴다
    const backToStart = (notice) => navigate('/', { replace: true, state: { notice } })

    const params = new URLSearchParams(window.location.search)
    // 카카오 화면에서 취소하거나 동의를 거부하면 ?error=access_denied 로 돌아온다
    if (params.get('error')) {
      backToStart(NOTICE_KAKAO_CANCELLED)
      return
    }
    const code = params.get('code')
    if (!code || handledCodes.has(code)) {
      backToStart(NOTICE_LOGIN_FAILED)
      return
    }
    handledCodes.add(code)

    async function login() {
      try {
        let data
        if (storage.token && storage.loginType === 'guest') {
          try {
            data = await api.linkKakao(code)
          } catch (e) {
            // 비회원 토큰이 만료/무효(401)면 일반 카카오 로그인으로 진행
            if (!(e instanceof ApiError) || e.status !== 401) throw e
            data = await api.kakaoLogin(code)
          }
          storage.clearGuestToken() // 전환/병합 후 비회원 행은 더 이상 없음
        } else {
          data = await api.kakaoLogin(code)
        }
        storage.saveLogin(data.access_token, 'kakao')
        navigate(pathAfterLogin(), { replace: true })
      } catch {
        // 인가 코드가 이미 쓰였거나 만료(400), 서버 꺼짐, 네트워크 오류 모두 같은 안내
        backToStart(NOTICE_LOGIN_FAILED)
      }
    }
    login()
  }, [navigate])

  return (
    <div className="card">
      <p className="muted">카카오 로그인 중...</p>
    </div>
  )
}
