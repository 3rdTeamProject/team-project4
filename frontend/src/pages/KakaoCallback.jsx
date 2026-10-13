import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, storage } from '../api.js'
import { pathAfterLogin } from '../intro.js'
import { NOTICE_KAKAO_CANCELLED, NOTICE_LOGIN_FAILED } from '../loginNotice.js'

// 인가 코드는 1회용이라 StrictMode의 effect 이중 실행에서도 한 번만 호출한다
const handledCodes = new Set()

// "카카오톡 연동하기" 버튼(환경설정·마이페이지)에서 시작했다면 돌아갈 화면을 돌려준다 (sessionStorage에 표시해 둠)
function takeLinkFlow() {
  try {
    const isLink = sessionStorage.getItem('kakao_flow') === 'link'
    const returnTo = sessionStorage.getItem('kakao_return') || '/settings'
    sessionStorage.removeItem('kakao_flow')
    sessionStorage.removeItem('kakao_return')
    return isLink ? returnTo : null
  } catch {
    return null
  }
}

export default function KakaoCallback() {
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const returnTo = takeLinkFlow() // 연동 버튼에서 시작했다면 돌아갈 화면, 아니면 null

    // 실패/취소: 연동 버튼에서 시작했다면 그 화면으로(아무것도 바뀐 게 없음), 아니면 시작 화면으로 안내 문구를 넘긴다
    const fail = (notice) => {
      if (returnTo) navigate(returnTo, { replace: true, state: { linkFailed: true } })
      else navigate('/', { replace: true, state: { notice } })
    }

    const params = new URLSearchParams(window.location.search)
    // 카카오 화면에서 취소하거나 동의를 거부하면 ?error=access_denied 로 돌아온다
    if (params.get('error')) {
      fail(NOTICE_KAKAO_CANCELLED)
      return
    }
    const code = params.get('code')
    if (!code || handledCodes.has(code)) {
      fail(NOTICE_LOGIN_FAILED)
      return
    }
    handledCodes.add(code)

    async function login() {
      try {
        let data
        if (storage.token && storage.loginType === 'guest') {
          try {
            data = await api.linkKakao({ code })
          } catch (e) {
            // 비회원 토큰이 만료/무효(401)면 일반 카카오 로그인으로 진행
            if (!(e instanceof ApiError) || e.status !== 401) throw e
            data = await api.kakaoLogin(code)
          }
          if (data.status === 'choice_required') {
            // 카카오 계정에 이미 기록이 있음: 아무것도 바뀌지 않았으니 비회원 로그인은 그대로 두고 선택 화면으로
            navigate('/link-choice', { replace: true, state: { ...data, returnTo } })
            return
          }
          storage.clearGuestToken() // 전환/병합 후 비회원 행은 더 이상 없음
        } else {
          data = await api.kakaoLogin(code)
        }
        storage.saveLogin(data.access_token, 'kakao')
        if (returnTo) {
          // 연동 완료: 카카오 로그인된 상태로 앱을 새로 시작한다(시작 화면의 환영 인사 → 내 텃밭)
          window.location.replace('/')
        } else {
          navigate(pathAfterLogin(), { replace: true })
        }
      } catch {
        // 인가 코드가 이미 쓰였거나 만료(400), 서버 꺼짐, 네트워크 오류 모두 같은 안내
        fail(NOTICE_LOGIN_FAILED)
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
