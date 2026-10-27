// 포인트샵 상품 그림. 상품의 icon_key(DB 값)로 고른다.
import ObservationLeafArt from './ObservationLeafArt.jsx'

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

function GardenGlove({ transform }) {
  return (
    <g transform={transform}>
      <path d="M8 45C5 41 2 35 1 30l-1-4c-1-3 1-5 4-4 2 1 3 3 5 5L8 11c0-3 2-4 4-4s3 2 3 4V7c0-3 2-4 4-3 2 0 3 2 3 4v2c0-3 2-4 4-3 2 1 2 3 2 6v2c1-3 3-3 5-1s1 4 1 7l-3 16c-1 4-3 7-5 8Z" fill="#6eaa6f" stroke="#447b50" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M15 12v13m7-16v16m6-11v13M11 31c3 5 8 8 14 8" fill="none" stroke="#4d8657" strokeWidth="1" strokeLinecap="round" />
      <path d="M8 44h19v9H8Z" fill="#3f754b" stroke="#356641" strokeWidth="1.2" />
      <path d="M9 51h17" stroke="#d9c579" strokeWidth="1.6" strokeLinecap="round" />
    </g>
  )
}

function ToolIcon({ kind }) {
  return (
    <svg width="78" height="78" viewBox="0 0 72 72" role="img" aria-label={kind === 'can' ? '물뿌리개' : kind === 'trowel' ? '모종삽' : '장갑'}>
      <circle cx="36" cy="36" r="35" fill="#e9f3de" />
      {kind === 'can' && <g>
        <path d="M19 33c-4-4-9-2-9 5 0 6 3 10 9 11" fill="none" stroke="#5c9d7b" strokeWidth="3" strokeLinecap="round" />
        <path d="M27 30c0-8 3-13 8-13s8 5 8 13" fill="none" stroke="#5c9d7b" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M46 40 59 27l2 3-12 15Z" fill="#85b9a5" stroke="#5c9d7b" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="m50 39 9-10" stroke="#b9ddc4" strokeWidth="1.2" strokeLinecap="round" />
        <g transform="translate(-1 1) rotate(-32 64 25)">
          <ellipse cx="63.3" cy="25.7" rx="4.2" ry="7.4" fill="#74aa88" stroke="#5c9d7b" strokeWidth="1" />
          <ellipse cx="64.4" cy="24.8" rx="3.6" ry="6.6" fill="#dde8d6" stroke="#5c9d7b" strokeWidth="0.9" />
          <circle cx="63.6" cy="20.5" r="0.5" fill="#8aaf91" />
          <circle cx="65.2" cy="22" r="0.5" fill="#8aaf91" />
          <circle cx="63.2" cy="23.8" r="0.5" fill="#8aaf91" />
          <circle cx="65.4" cy="25" r="0.5" fill="#8aaf91" />
          <circle cx="63.5" cy="27" r="0.5" fill="#8aaf91" />
          <circle cx="65" cy="28.6" r="0.5" fill="#8aaf91" />
        </g>
        <path d="M19 31c0-5 30-5 30 0v24c0 5-30 5-30 0Z" fill="#83b8a7" />
        <path d="M19 53c6 3 24 3 30 0v3c0 5-30 5-30 0Z" fill="#6da58e" />
        <ellipse cx="34" cy="31" rx="15" ry="3.5" fill="#a9d2b7" stroke="#5c9d7b" strokeWidth="1.3" />
        <path d="M23 37v14" stroke="#b9deca" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="26" cy="30" r="1.2" fill="#e0f0d5" />
      </g>}
      {kind === 'trowel' && <image href="/shop/trowel.png" x="7" y="7" width="58" height="58" preserveAspectRatio="xMidYMid meet" style={{ filter: 'drop-shadow(0 0 1px rgba(58, 68, 62, 0.8))' }} />}
      {kind === 'glove' && <>
        <GardenGlove transform="translate(4 8) scale(.94) rotate(-8 17 27)" />
        <GardenGlove transform="translate(35 8) scale(.94) rotate(8 17 27)" />
      </>}
    </svg>
  )
}

function DiagnosisIcon({ count }) {
  return (
    <svg width="78" height="78" viewBox="0 0 72 72" role="img" aria-label={`AI 진단 ${count}회`}>
      <circle cx="36" cy="36" r="35" fill="#e9f3de" />
      <ObservationLeafArt x="3" y="6" width="66" height="54" magnifierScale={1.16} />
      <circle cx="57" cy="14" r="10.5" fill="#3b8550" stroke="#e9f3de" strokeWidth="1.5" />
      <text x="57" y="14" textAnchor="middle" dominantBaseline="central" fontSize="10.5" fontWeight="700" fill="#fff">×{count}</text>
    </svg>
  )
}

export default function RewardIcon({ iconKey }) {
  if (CROP_IMAGES[iconKey] || iconKey === 'sunflower') return <SeedPacket crop={iconKey} />
  if (['can', 'trowel', 'glove'].includes(iconKey)) return <ToolIcon kind={iconKey} />
  if (iconKey === 'diag1' || iconKey === 'diag5') return <DiagnosisIcon count={iconKey === 'diag5' ? 5 : 1} />
  return null
}
