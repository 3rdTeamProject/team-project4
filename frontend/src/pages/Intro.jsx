import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { storage } from '../api.js'
import { intro } from '../intro.js'
import './Intro.css'

function SproutArt() {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <path d="M30 118 Q80 98 130 118 L130 134 Q80 150 30 134Z" fill="#8a5e47" />
      <path d="M30 118 Q80 98 130 118 Q80 108 30 118Z" fill="#a67357" />
      <path d="M80 112 C80 92 80 78 80 62" stroke="#2e8b3d" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M80 78 C60 78 46 66 44 48 C64 48 78 60 80 78Z" fill="#43a047" />
      <path d="M80 66 C98 66 112 54 116 38 C98 38 84 50 80 66Z" fill="#6fb06b" />
    </svg>
  )
}

function CalendarArt() {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <rect x="32" y="40" width="96" height="88" rx="12" fill="#fffdf6" stroke="#2f7d32" strokeWidth="4" />
      <path d="M32 62h96v-10a12 12 0 0 0-12-12H44a12 12 0 0 0-12 12z" fill="#2f7d32" />
      <rect x="52" y="30" width="6" height="18" rx="3" fill="#1e5a21" />
      <rect x="102" y="30" width="6" height="18" rx="3" fill="#1e5a21" />
      <g fill="#c9d6be">
        <rect x="46" y="74" width="14" height="10" rx="3" />
        <rect x="73" y="74" width="14" height="10" rx="3" />
        <rect x="100" y="74" width="14" height="10" rx="3" />
        <rect x="46" y="98" width="14" height="10" rx="3" />
        <rect x="100" y="98" width="14" height="10" rx="3" />
      </g>
      <path d="M80 92 C80 92 70 104 70 111 a10 10 0 0 0 20 0 C90 104 80 92 80 92Z" fill="#4aa3df" />
    </svg>
  )
}

function NoteArt() {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <rect x="38" y="28" width="80" height="102" rx="10" fill="#fffdf6" stroke="#2f7d32" strokeWidth="4" />
      <g stroke="#c9d6be" strokeWidth="4" strokeLinecap="round">
        <path d="M52 56h52M52 74h52M52 92h30" />
      </g>
      <circle cx="116" cy="108" r="22" fill="#f5a623" />
      <circle cx="116" cy="108" r="22" fill="none" stroke="#fff" strokeWidth="3" />
      <path
        d="M116 95l4.2 8.6 9.5 1.4-6.9 6.7 1.6 9.4-8.4-4.4-8.4 4.4 1.6-9.4-6.9-6.7 9.5-1.4z"
        fill="#fff"
      />
    </svg>
  )
}

const SLIDES = [
  {
    Art: SproutArt,
    title: ['내 텃밭을', '만들어 봐요'],
    desc: ['농장을 만들면 6칸 텃밭이 생겨요.', '칸마다 작물을 골라 심고 키워요.'],
    button: '다음',
  },
  {
    Art: CalendarArt,
    title: ['칸마다 키우고', '할 일을 챙겨요'],
    desc: ['심은 작물에 맞춰 관리 시기를 알려 드려요.', '오늘 할 일은 한곳에 모아 봐요.'],
    button: '다음',
  },
  {
    Art: NoteArt,
    title: ['기록하고', '포인트도 받아요'],
    desc: ['일지를 쓰면 포인트가 쌓이고,', '잎이 이상하면 AI진단으로 확인해요.'],
    button: '시작하기',
  },
]

const SLIDE_OFFSET = 48

export default function Intro() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1) // 1: 다음(오른쪽에서 들어옴), -1: 이전(왼쪽에서 들어옴)
  const [params, setParams] = useSearchParams()

  // /intro?reset: 완료 표시를 지워 안내를 다시 볼 수 있게 하고, 주소에서 reset을 뗀다
  // (새로고침해도 다시 지워지지 않도록). 토큰이 없어도 지워 두면 로그인 뒤 안내가 다시 나온다.
  useEffect(() => {
    if (!params.has('reset')) return
    intro.reset()
    // 토큰이 없으면 아래에서 /로 보내므로 주소는 건드리지 않는다(이동이 덮어써지지 않게)
    if (storage.token) setParams({}, { replace: true })
  }, [params, setParams])

  if (!storage.token) return <Navigate to="/" replace />

  const last = SLIDES.length - 1
  const { Art, title, desc, button } = SLIDES[index]

  function finish() {
    intro.markDone()
    navigate('/home', { replace: true })
  }

  function next() {
    if (index === last) {
      finish()
      return
    }
    setDir(1)
    setIndex(index + 1)
  }

  function prev() {
    if (index === 0) return
    setDir(-1)
    setIndex(index - 1)
  }

  // 모션 줄이기: 옆으로 넘기는 효과 없이 바로 바꾼다
  const slide = reduce
    ? { initial: false, animate: {}, exit: undefined, transition: { duration: 0 } }
    : {
        variants: {
          enter: (d) => ({ opacity: 0, x: d * SLIDE_OFFSET }),
          center: { opacity: 1, x: 0 },
          exit: (d) => ({ opacity: 0, x: -d * SLIDE_OFFSET }),
        },
        initial: 'enter',
        animate: 'center',
        exit: 'exit',
        custom: dir,
        transition: { duration: 0.22, ease: [0.42, 0, 0.58, 1] },
      }

  return (
    <div className="intro">
      <div className="intro-top">
        <button
          type="button"
          className="intro-prev"
          onClick={prev}
          aria-label="이전 안내"
          hidden={index === 0}
        >
          ‹ 이전
        </button>
        <button type="button" className="intro-skip" onClick={finish}>
          건너뛰기
        </button>
      </div>

      <div className="intro-body">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={index}
            className="intro-slide"
            aria-live="polite"
            {...slide}
          >
            <div className="intro-circle">
              <Art />
            </div>
            <h1 className="intro-title">
              {title[0]}
              <br />
              {title[1]}
            </h1>
            <p className="intro-desc">
              {desc[0]}
              <br />
              {desc[1]}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="intro-dots" role="img" aria-label={`${index + 1}/${SLIDES.length}`}>
        {SLIDES.map((_, i) => (
          <span key={i} className={`intro-dot${i === index ? ' on' : ''}`} />
        ))}
      </div>

      <button type="button" className="intro-next" onClick={next}>
        {button}
      </button>
    </div>
  )
}
