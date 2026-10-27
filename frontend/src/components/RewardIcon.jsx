// 포인트샵 상품 그림. 상품의 icon_key(DB 값)로 고른다.
const CROP_IMAGES = {
  tomato: '/garden/assets/crops/tomato-4.png',
  lettuce: '/garden/assets/crops/lettuce-4.png',
  pepper: '/garden/assets/crops/pepper-4.png',
}
const CROP_NAMES = { tomato: '토마토', lettuce: '상추', pepper: '고추', sunflower: '해바라기' }

function SeedPacket({ crop }) {
  return (
    <svg width="70" height="70" viewBox="0 0 72 72" role="img" aria-label={`${CROP_NAMES[crop]} 씨앗 봉투`}>
      <rect x="11" y="6" width="50" height="62" rx="5" fill="#fff9e9" stroke="#d7c9a5" strokeWidth="1.5" />
      <path d="M16 6h40a5 5 0 0 1 5 5v12H11V11a5 5 0 0 1 5-5Z" fill="#4b9344" />
      <text x="36" y="18" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">씨앗</text>
      <rect x="17" y="27" width="38" height="30" rx="8" fill="#e9f3d9" />
      {crop === 'sunflower' ? (
        <g>
          <path d="M36 54V43" stroke="#3c8b3f" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M36 49c-3-4-6-4-8-2 2 3 5 4 8 4m0-5c3-4 6-4 8-2-2 3-5 4-8 4" fill="#6eae4b" />
          {Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx="36" cy="33" rx="3" ry="6" transform={`rotate(${i * 45} 36 40)`} fill="#f6c34c" />)}
          <circle cx="36" cy="40" r="5" fill="#8f5a31" />
          <circle cx="34" cy="38" r="1" fill="#c58d48" />
        </g>
      ) : <image href={CROP_IMAGES[crop]} x="18" y="26" width="36" height="32" preserveAspectRatio="xMidYMid meet" />}
      <ellipse cx="30" cy="62" rx="2.5" ry="1.4" fill="#b79e69" />
      <ellipse cx="36" cy="62" rx="2.5" ry="1.4" fill="#b79e69" />
      <ellipse cx="42" cy="62" rx="2.5" ry="1.4" fill="#b79e69" />
    </svg>
  )
}

function ToolIcon({ kind }) {
  return (
    <svg width="70" height="70" viewBox="0 0 72 72" role="img" aria-label={kind === 'can' ? '물뿌리개' : kind === 'trowel' ? '모종삽' : '장갑'}>
      <circle cx="36" cy="36" r="31" fill="#e9f3de" />
      {kind === 'can' && <g>
        <path d="M18 35c-6-2-9-5-8-10 1-6 9-8 14-3" fill="none" stroke="#478d7a" strokeWidth="4" strokeLinecap="round" />
        <path d="M46 33 59 24a3 3 0 0 1 4 1l2 3-14 13Z" fill="#77af9d" stroke="#478d7a" strokeWidth="2" strokeLinejoin="round" />
        <path d="M20 32h26c4 0 6 3 6 7l-3 15c-.5 3-2 5-6 5H23c-3 0-5-2-6-5l-3-15c-1-4 2-7 6-7Z" fill="#83b9a8" stroke="#478d7a" strokeWidth="2" />
        <path d="M23 32v-5c0-5 4-8 10-8s10 3 10 8v5" fill="none" stroke="#478d7a" strokeWidth="3" />
        <path d="M24 40h20" stroke="#c6e5d6" strokeWidth="3" strokeLinecap="round" />
        <circle cx="62" cy="35" r="1.8" fill="#75badd" /><circle cx="65" cy="41" r="1.8" fill="#75badd" />
      </g>}
      {kind === 'trowel' && <g transform="rotate(26 36 36)">
        <rect x="31" y="9" width="10" height="31" rx="5" fill="#b7834b" stroke="#8b5e34" strokeWidth="1.5" />
        <path d="M34 15v15" stroke="#ddb482" strokeWidth="2" strokeLinecap="round" />
        <rect x="29" y="36" width="14" height="6" rx="2" fill="#718f89" />
        <path d="M27 42c0-2 4-4 9-4s9 2 9 4c0 10-3 19-9 23-6-4-9-13-9-23Z" fill="#aebfbb" stroke="#718f89" strokeWidth="2" />
        <path d="M36 45v13" stroke="#dbe7de" strokeWidth="2" strokeLinecap="round" />
      </g>}
      {kind === 'glove' && <g transform="rotate(-10 36 36)">
        <rect x="22" y="19" width="8" height="29" rx="4" fill="#f5c460" stroke="#cf9b3f" strokeWidth="1.5" />
        <rect x="30" y="14" width="8" height="34" rx="4" fill="#f5c460" stroke="#cf9b3f" strokeWidth="1.5" />
        <rect x="38" y="17" width="8" height="31" rx="4" fill="#f5c460" stroke="#cf9b3f" strokeWidth="1.5" />
        <rect x="46" y="23" width="8" height="25" rx="4" fill="#f5c460" stroke="#cf9b3f" strokeWidth="1.5" />
        <path d="M25 35c-5-8-11-6-11-1 0 5 7 12 10 19 2 5 7 7 13 7h6c9 0 14-6 14-14V36c-8 2-24 3-32-1Z" fill="#f5c460" stroke="#cf9b3f" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M24 52h31v10H27c-2 0-3-1-3-3Z" fill="#78a84d" stroke="#5b873d" strokeWidth="1.5" />
        <path d="M29 55h20" stroke="#a9d179" strokeWidth="2" strokeLinecap="round" />
      </g>}
    </svg>
  )
}

function DiagnosisIcon({ count }) {
  return (
    <svg width="70" height="70" viewBox="0 0 72 72" role="img" aria-label={`AI 진단 ${count}회`}>
      <circle cx="36" cy="36" r="31" fill="#e9f3de" />
      <path d="M14 48C15 29 30 16 50 16c-1 20-14 34-34 33Z" fill="#79bd58" />
      <path d="M17 44c7-14 18-21 30-23-3 15-13 25-28 26Z" fill="#99d675" />
      <path d="M12 53c13-13 23-23 36-32m-21 20-2-12m11 5 8 2" fill="none" stroke="#438f46" strokeWidth="2" strokeLinecap="round" />
      <circle cx="45" cy="46" r="10" fill="#ffffffd9" stroke="#3b8550" strokeWidth="2.5" />
      <path d="m52 53 7 7" stroke="#3b8550" strokeWidth="4" strokeLinecap="round" />
      {count > 1 && <g><circle cx="56" cy="15" r="12" fill="#3b8550" /><text x="56" y="19" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">×5</text></g>}
    </svg>
  )
}

export default function RewardIcon({ iconKey }) {
  if (CROP_IMAGES[iconKey] || iconKey === 'sunflower') return <SeedPacket crop={iconKey} />
  if (['can', 'trowel', 'glove'].includes(iconKey)) return <ToolIcon kind={iconKey} />
  if (iconKey === 'diag1' || iconKey === 'diag5') return <DiagnosisIcon count={iconKey === 'diag5' ? 5 : 1} />
  return null
}
