import { useId } from 'react'

export default function ObservationLeafArt({ magnifierScale = 1, ...props }) {
  const leafId = useId().replaceAll(':', '')

  return (
    <svg viewBox="0 0 128 104" fill="none" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={`${leafId}-color`} x1="20" y1="25" x2="95" y2="85" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9bd477" />
          <stop offset="0.55" stopColor="#80c45f" />
          <stop offset="1" stopColor="#6db353" />
        </linearGradient>
        <clipPath id={`${leafId}-clip`}>
          <path d="M19 82C10 65 18 40 43 25c20-12 45-10 70-15-4 34-12 59-36 76-22 15-46 10-58-4Z" />
        </clipPath>
      </defs>
      <path d="M4 90 19 82" stroke="#4f9142" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M19 82C10 65 18 40 43 25c20-12 45-10 70-15-4 34-12 59-36 76-22 15-46 10-58-4Z" fill={`url(#${leafId}-color)`} />
      <g clipPath={`url(#${leafId}-clip)`}>
        <path d="M19 82C43 69 74 43 112 10" stroke="#397d3e" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M34 73C31 63 30 52 31 44M48 63C44 53 43 42 45 32M62 52C59 42 60 31 65 22M78 39C76 31 79 23 84 17M94 25C94 20 98 15 102 12" stroke="#428d43" strokeWidth="1.1" strokeLinecap="round" opacity="0.78" />
        <path d="M37 70C45 78 54 85 62 90M51 61C60 67 71 76 80 81M66 49C75 55 88 62 97 68M82 36C90 41 99 47 105 52M99 22C104 27 109 33 111 37" stroke="#428d43" strokeWidth="1.1" strokeLinecap="round" opacity="0.78" />
        <path d="M66 56c2-4 6-5 9-3 3 2 4 6 2 9-2 3-6 4-9 2-3-2-4-5-2-8Z" fill="#d4b56b" />
        <path d="M68 56c2-2 5-2 7 0 2 2 1 5-1 6-3 1-5 0-6-2-1-1-1-3 0-4Z" fill="#b78043" />
        <path d="M60 67c2-2 4-1 5 1 1 2-1 4-3 4s-4-3-2-5Z" fill="#c08c4b" />
      </g>
      <g transform={`translate(69 56) scale(${magnifierScale}) translate(-69 -56)`}>
        <circle cx="69" cy="56" r="14" fill="#ffffff12" stroke="#3b8050" strokeWidth="2.6" />
        <path d="m79 66 12 12" stroke="#3b8050" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M59 50c3-4 6-6 10-6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      </g>
    </svg>
  )
}
