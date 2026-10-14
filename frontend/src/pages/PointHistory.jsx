import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api, storage } from '../api.js'
import PointLogList from '../components/PointLogList.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import './screens.css'

const PAGE_SIZE = 20

export default function PointHistory() {
  const [logs, setLogs] = useState(null) // 첫 페이지를 받기 전에는 null
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const goBack = useGoBack('/mypage')

  useEffect(() => {
    api
      .pointLogs(0, PAGE_SIZE)
      .then((page) => {
        setLogs(page.items)
        setHasMore(page.has_more)
      })
      .catch((e) => {
        if (e.status !== 401) setError(e.message)
      })
  }, [])

  async function loadMore() {
    setLoadingMore(true)
    setError('')
    try {
      const page = await api.pointLogs(logs.length, PAGE_SIZE)
      setLogs([...logs, ...page.items])
      setHasMore(page.has_more)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  if (!storage.token) return <Navigate to="/" replace />

  return (
    <div className="screen">
      <header className="screen-header">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="뒤로가기">‹</button>
        <h1 className="screen-title">포인트 내역</h1>
        <span className="icon-btn-spacer" />
      </header>

      {error && <p className="error">{error}</p>}

      {logs && (
        <section className="log-section">
          {logs.length === 0 ? (
            <p className="log-empty">아직 받은 포인트가 없어요</p>
          ) : (
            <PointLogList logs={logs} />
          )}
          {hasMore && (
            <button type="button" className="log-more-btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '불러오는 중…' : '더보기'}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
