// 포인트샵 상품 그림. 상품의 icon_key(DB 값)로 고른다. 모르는 키는 그리지 않는다.
const ICONS = {
  tomato: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 62V10" stroke="#4C9A3A" strokeWidth="3" strokeLinecap="round" fill="none" />
      <ellipse cx="22" cy="52" rx="10" ry="5" transform="rotate(-28 22 52)" fill="#7BC95A" />
      <ellipse cx="42" cy="52" rx="10" ry="5" transform="rotate(28 42 52)" fill="#6FBF4F" />
      <ellipse cx="22" cy="40" rx="9" ry="4.5" transform="rotate(-28 22 40)" fill="#6FBF4F" />
      <ellipse cx="42" cy="40" rx="9" ry="4.5" transform="rotate(28 42 40)" fill="#7BC95A" />
      <circle cx="19" cy="47" r="4" fill="#E5493A" />
      <circle cx="46" cy="45" r="4" fill="#E5493A" />
      <circle cx="44" cy="31" r="3.5" fill="#E5493A" />
    </svg>
  ),
  sunflower: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="12" cy="52" rx="6" ry="10" transform="rotate(-60 12 52)" fill="#E0A230" />
      <ellipse cx="52" cy="52" rx="6" ry="10" transform="rotate(60 52 52)" fill="#E0A230" />
      <ellipse cx="20" cy="46" rx="8" ry="14" transform="rotate(-35 20 46)" fill="#F6C662" />
      <ellipse cx="44" cy="46" rx="8" ry="14" transform="rotate(35 44 46)" fill="#F6C662" />
      <ellipse cx="32" cy="40" rx="9" ry="16" fill="#F6C662" />
    </svg>
  ),
  lettuce: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="46" rx="22" ry="11" fill="#6FBF4F" />
      <ellipse cx="20" cy="36" rx="9" ry="15" transform="rotate(-28 20 36)" fill="#7BC95A" />
      <ellipse cx="44" cy="36" rx="9" ry="15" transform="rotate(28 44 36)" fill="#7BC95A" />
      <ellipse cx="32" cy="32" rx="10" ry="17" fill="#A6E07F" />
      <path d="M32 18v28" stroke="#4C9A3A" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  ),
  pepper: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 62V12" stroke="#4C9A3A" strokeWidth="3" strokeLinecap="round" fill="none" />
      <ellipse cx="22" cy="54" rx="9" ry="4.5" transform="rotate(-28 22 54)" fill="#7BC95A" />
      <ellipse cx="42" cy="48" rx="9" ry="4.5" transform="rotate(28 42 48)" fill="#6FBF4F" />
      <ellipse cx="20" cy="34" rx="4" ry="11" transform="rotate(14 20 34)" fill="#E5493A" />
      <ellipse cx="45" cy="30" rx="4" ry="11" transform="rotate(-14 45 30)" fill="#D63A2C" />
      <ellipse cx="26" cy="20" rx="8" ry="4" transform="rotate(-28 26 20)" fill="#7BC95A" />
    </svg>
  ),
  can: (
    <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#2F7D32" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h12l2 8H6zM16 12l5-4M10 12V8h4" />
    </svg>
  ),
  trowel: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M12 52l20-20" stroke="#A9783F" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M30 30c6-8 18-10 24-4-1 10-8 18-18 20-5-4-8-10-6-16z" fill="#8A9AA3" />
      <path d="M34 36c4-4 9-6 14-6" stroke="#6C7C85" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  ),
  glove: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="18" y="34" width="30" height="22" rx="8" fill="#E0A230" />
      <rect x="18" y="12" width="7" height="30" rx="3.5" fill="#F6C662" />
      <rect x="26" y="8" width="7" height="34" rx="3.5" fill="#F6C662" />
      <rect x="34" y="10" width="7" height="32" rx="3.5" fill="#F6C662" />
      <rect x="42" y="16" width="7" height="26" rx="3.5" fill="#F6C662" />
      <ellipse cx="16" cy="40" rx="5" ry="10" transform="rotate(-30 16 40)" fill="#F6C662" />
      <rect x="18" y="48" width="30" height="8" rx="4" fill="#D9A63A" />
    </svg>
  ),
  diag1: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M10 38c0-14 10-24 26-24 0 16-10 26-26 24z" fill="#7BC95A" />
      <path d="M10 38l14-14" stroke="#4C9A3A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="40" cy="40" r="11" fill="#fff" fillOpacity="0.6" stroke="#2F7D32" strokeWidth="3.5" />
      <path d="M48 48l9 9" stroke="#2F7D32" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    </svg>
  ),
  diag5: (
    <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 40c0-14 10-24 26-24 0 16-10 26-26 24z" fill="#7BC95A" />
      <path d="M8 40l14-14" stroke="#4C9A3A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="38" cy="42" r="11" fill="#fff" fillOpacity="0.6" stroke="#2F7D32" strokeWidth="3.5" />
      <path d="M46 50l9 9" stroke="#2F7D32" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <circle cx="50" cy="14" r="11" fill="#2F7D32" />
      <text x="50" y="19.5" textAnchor="middle" fontFamily="Do Hyeon, sans-serif" fontSize="15" fill="#fff">x5</text>
    </svg>
  ),
}

export default function RewardIcon({ iconKey }) {
  return ICONS[iconKey] ?? null
}
