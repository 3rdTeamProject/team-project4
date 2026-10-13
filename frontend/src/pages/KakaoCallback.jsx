import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api, storage } from '../api.js'

// 인가 코드는 1회용이라 StrictMode의 effect 이중 실행에서도 한 번만 호출한다
const handledCodes = new Set()

// 환경설정의 "카카오톡으로 연동하기"에서 시작했는지 (sessionStorage에 표시해 둠)
function takeLinkFlow() {
  try {
    const isLink = sessionStorage.getItem('kakao_flow') === 'link'
    sessionStorage.removeItem('kakao_flow')
    return isLink
  } catch {
    return false
  }
}

export default function KakaoCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const fromSettings = takeLinkFlow()
    // 연동 도중 취소·실패: 아무것도 바뀐 게 없으니 환경설정으로 돌아가 안내만 보여 준다
    const backToSettings = () => navigate('/settings', { replace: true, state: { linkFailed: true } })

    const code = new URLSearchParams(window.location.search).get('code')
    if (!code || handledCodes.has(code)) {
      if (fromSettings) backToSettings()
      else setError('카카오 인가 코드가 없습니다.')
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
            navigate('/link-choice', { replace: true, state: data })
            return
          }
          storage.clearGuestToken() // 전환/병합 후 비회원 행은 더 이상 없음
        } else {
          data = await api.kakaoLogin(code)
        }
        storage.saveLogin(data.access_token, 'kakao')
        if (fromSettings) navigate('/settings', { replace: true, state: { linked: true } })
        else navigate('/home', { replace: true })
      } catch (e) {
        if (fromSettings) backToSettings()
        else setError(e.message)
      }
    }
    login()
  }, [navigate])

  if (error) {
    return (
      <div className="card">
        <h1>로그인 실패</h1>
        <p className="error">{error}</p>
        <Link className="btn primary" to="/">처음으로</Link>
      </div>
    )
  }
  return (
    <div className="card">
      <p className="muted">카카오 로그인 중...</p>
    </div>
  )
}
