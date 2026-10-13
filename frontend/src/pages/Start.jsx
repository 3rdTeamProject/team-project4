import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, kakaoAuthorizeUrl, storage } from '../api.js'
import LoginScene from '../components/LoginScene.jsx'

export default function Start() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function startAsGuest() {
    setLoading(true)
    setError('')
    try {
      const data = await api.guestLogin(storage.guestToken)
      storage.saveLogin(data.access_token, 'guest')
      storage.saveGuestToken(data.guest_token)
      navigate('/home')
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

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
      onKakao={() => (window.location.href = kakaoAuthorizeUrl())}
      onGuest={startAsGuest}
      onEnter={() => navigate('/home')}
    />
  )
}
