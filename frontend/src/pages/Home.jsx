import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, storage } from '../api.js'

export default function Home() {
  const navigate = useNavigate()
  const token = storage.token
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    api
      .me()
      .then(setMe)
      .catch((e) => {
        // 401은 api.js가 토큰을 지우고 /로 보낸다
        if (e.status !== 401) setError(e.message)
      })
  }, [token])

  if (!token) return <Navigate to="/" replace />

  function logout() {
    storage.logout()
    navigate('/', { replace: true })
  }

  return (
    <div className="card">
      <h1>홈</h1>
      {error && <p className="error">{error}</p>}
      {me ? (
        <dl>
          <dt>닉네임</dt>
          <dd>{me.nickname}</dd>
          <dt>login_type</dt>
          <dd>{me.login_type}</dd>
        </dl>
      ) : (
        !error && <p className="muted">불러오는 중...</p>
      )}
      <Link className="btn secondary" to="/menu">메뉴</Link>
      <button className="btn primary" onClick={logout}>로그아웃</button>
    </div>
  )
}
