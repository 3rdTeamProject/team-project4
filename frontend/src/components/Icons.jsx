// 레벨(새싹)·포인트(코인) 아이콘. 사진/사람 모양 아바타는 쓰지 않는다.
export function SproutIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21v-9" stroke="#2f7d32" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 13C12 8 8.5 5.5 4 5.5 4 10 7 13 12 13Z" fill="#a7d083" stroke="#6fb06b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M12 11c0-4 3-6.5 8-6.5 0 4-3 6.5-8 6.5Z" fill="#6fb06b" stroke="#2f7d32" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function CoinIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#f6c662" stroke="#d9a33a" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="#d9a33a" strokeWidth="1.2" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="#b9801f">P</text>
    </svg>
  )
}

export function KakaoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#191919" aria-hidden="true">
      <path d="M12 4C7.6 4 4 6.9 4 10.4c0 2.2 1.4 4.2 3.6 5.3L6.8 19l3.6-2.2c.5.1 1.1.2 1.6.2 4.4 0 8-2.9 8-6.6S16.4 4 12 4z" />
    </svg>
  )
}

export function ReceiptIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" />
    </svg>
  )
}

// 메뉴 항목 아이콘과 화살표·닫기 (선 아이콘: 색은 글자색을 따라간다)
function LineIcon({ size, strokeWidth = 2.2, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export function JournalIcon({ size = 24 }) {
  return <LineIcon size={size}><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h3" /></LineIcon>
}

export function DiagnosisIcon({ size = 24 }) {
  return <LineIcon size={size}><path d="M12 21V9M12 9c0-4 3-6 7-6 0 4-3 6-7 6zM12 13c0-3-2-5-6-5 0 3 2 5 6 5z" /></LineIcon>
}

export function ShopIcon({ size = 24 }) {
  return <LineIcon size={size}><path d="M4 8h16v12H4zM4 8l2-4h12l2 4M10 12h4" /></LineIcon>
}

export function SettingsIcon({ size = 24 }) {
  return <LineIcon size={size}><path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z" /></LineIcon>
}

export function ChevronRightIcon({ size = 18 }) {
  return <LineIcon size={size} strokeWidth={2.4}><path d="M9 6l6 6-6 6" /></LineIcon>
}

export function CloseIcon({ size = 24 }) {
  return <LineIcon size={size} strokeWidth={2.4}><path d="M6 6l12 12M18 6L6 18" /></LineIcon>
}
