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
