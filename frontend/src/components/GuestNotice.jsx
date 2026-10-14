import { Link } from 'react-router-dom'
import '../pages/exchange.css'

// 비회원 포인트샵·장바구니 위의 한 줄 안내. "카카오톡 연동"을 누르면 (비회원) 환경설정으로 간다.
export default function GuestNotice() {
  return (
    <div className="guest-notice">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <div>
        교환하려면 <Link className="guest-notice-link" to="/settings">카카오톡 연동</Link>이 필요해요
      </div>
    </div>
  )
}
