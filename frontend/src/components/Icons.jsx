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

// 씨앗 단계(작은 씨앗 두 알). 다른 단계 그림처럼 바닥에 붙는다. 색은 앱 토큰에서 섞어 쓴다
export function SeedIcon({ size = 24 }) {
  const body = 'color-mix(in srgb, var(--color-soil) 55%, var(--color-point-chip))'
  const edge = 'color-mix(in srgb, var(--color-soil) 70%, var(--color-text))'
  const seed = (
    <>
      <path d="M0-11C8-7 11 3 6 10C1 13-5 8-5 1C-5-4-3-9 0-11Z" style={{ fill: body, stroke: edge }} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M0-7C3-3 4 3 2 8" fill="none" style={{ stroke: edge }} strokeWidth="1" strokeLinecap="round" opacity="0.5" />
      <ellipse cx="-1.5" cy="-1" rx="1.3" ry="3" transform="rotate(12 -1.5 -1)" style={{ fill: 'var(--color-card)' }} opacity="0.6" />
    </>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <g transform="translate(24 50) rotate(-18)">{seed}</g>
      <g transform="translate(42 54) rotate(24) scale(0.75)">{seed}</g>
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

export function DexIcon({ size = 24 }) {
  return <LineIcon size={size}><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M12 6.5c0 2-1.5 3-3.5 3 0-2 1.5-3 3.5-3z" /></LineIcon>
}

export function DiagnosisIcon({ size = 24 }) {
  return <LineIcon size={size}><path d="M12 21V9M12 9c0-4 3-6 7-6 0 4-3 6-7 6zM12 13c0-3-2-5-6-5 0 3 2 5 6 5z" /></LineIcon>
}

export function ShopIcon({ size = 24 }) {
  return <LineIcon size={size}><path d="M4 8h16v12H4zM4 8l2-4h12l2 4M10 12h4" /></LineIcon>
}

export function SettingsIcon({ size = 24 }) {
  return <LineIcon size={size} strokeWidth={1.8}>
    <path d="M10 2h4l.4 2.1c.6.2 1.2.4 1.7.7l1.8-1.2 2.5 2.5-1.2 1.8c.3.5.5 1.1.7 1.7L22 10v4l-2.1.4c-.2.6-.4 1.2-.7 1.7l1.2 1.8-2.5 2.5-1.8-1.2c-.5.3-1.1.5-1.7.7L14 22h-4l-.4-2.1c-.6-.2-1.2-.4-1.7-.7l-1.8 1.2-2.5-2.5 1.2-1.8c-.3-.5-.5-1.1-.7-1.7L2 14v-4l2.1-.4c.2-.6.4-1.2.7-1.7L3.6 6.1l2.5-2.5 1.8 1.2c.5-.3 1.1-.5 1.7-.7Z" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" />
  </LineIcon>
}

// 메뉴 프로필의 레벨 표시: 초록 선 새싹
export function LevelIcon({ size = 20 }) {
  return <LineIcon size={size}><path d="M12 21V9M12 9c0-4 3-6 7-6 0 4-3 6-7 6zM12 13c0-3-2-5-6-5 0 3 2 5 6 5z" /></LineIcon>
}

export function ChevronRightIcon({ size = 18 }) {
  return <LineIcon size={size} strokeWidth={2.4}><path d="M9 6l6 6-6 6" /></LineIcon>
}

export function CloseIcon({ size = 24 }) {
  return <LineIcon size={size} strokeWidth={2.4}><path d="M6 6l12 12M18 6L6 18" /></LineIcon>
}
