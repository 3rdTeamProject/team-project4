import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, kakaoAuthorizeUrl, storage } from '../api.js'
import LoginScene from '../components/LoginScene.jsx'
import { pathAfterLogin } from '../intro.js'
import { NOTICE_LOGIN_FAILED } from '../loginNotice.js'

export default function Start() {
  const navigate = useNavigate()
  const location = useLocation()
  // 카카오 콜백에서 돌아왔다면 넘어온 안내(취소/실패)를 보여준다
  const [error, setError] = useState(location.state?.notice ?? '')
  const [loading, setLoading] = useState(false)
  // state 갱신은 비동기라 빠른 더블 클릭을 못 막으므로 ref로도 막는다
  const busy = useRef(false)

  async function startAsGuest() {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    try {
      const data = await api.guestLogin(storage.guestToken)
      storage.saveLogin(data.access_token, 'guest')
      storage.saveGuestToken(data.guest_token)
      navigate(pathAfterLogin())
    } catch {
      // 서버 꺼짐·네트워크 오류·400 모두 같은 안내. 버튼은 다시 누를 수 있게 푼다
      setError(NOTICE_LOGIN_FAILED)
      busy.current = false
      setLoading(false)
    }
  }

  function startWithKakao() {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    window.location.href = kakaoAuthorizeUrl()
  }

  // 카카오 화면에서 '뒤로 가기'로 돌아오면(bfcache) 눌린 상태가 남지 않게 푼다
  useEffect(() => {
    const onShow = (e) => {
      if (e.persisted) {
        busy.current = false
        setLoading(false)
      }
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  // 이미 로그인된 토큰이 있고 GET /me가 성공하면 환영 문구와 자동 이동을 보여준다
  const [me, setMe] = useState(null)
  useEffect(() => {
    const token = storage.token
    if (!token) return
    let cancelled = false
    api
      .me()
      .then((data) => {
        if (!cancelled) setMe(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <LoginScene
      me={me}
      loading={loading}
      error={error}
      onKakao={startWithKakao}
      onGuest={startAsGuest}
      onEnter={() => navigate(pathAfterLogin())}
    />
  )
}
