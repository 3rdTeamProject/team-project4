import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import './LoginScene.css'
import fenceImg from '../assets/login/fence.png'
import bushImg from '../assets/login/bush.png'
import tomatoImg from '../assets/login/tomato.png'
import soilImg from '../assets/login/soil.png'
import canImg from '../assets/login/can.png'
import drop1Img from '../assets/login/drop1.png'
import drop2Img from '../assets/login/drop2.png'
import drop3Img from '../assets/login/drop3.png'

// login-animation.html의 CSS 이징을 그대로 옮긴 값
const EASE_OUT = [0, 0, 0.58, 1]
const EASE_IN = [0.42, 0, 1, 1]
const EASE_IN_OUT = [0.42, 0, 0.58, 1]

const AUTO_START_MS = 6600 // 장면이 끝난 뒤 자동 이동 카운트 시작
const AUTO_GO_MS = 3000

function Flower({ style, delay }) {
  const reduce = useReducedMotion()
  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, scale: 0.1 },
        animate: { opacity: [0, 1, 1], scale: [0.1, 1] },
        transition: {
          opacity: { times: [0, 0.3, 1], duration: 0.9, delay, ease: [0.2, 1.4, 0.4, 1] },
          scale: { duration: 0.9, delay, ease: [0.2, 1.4, 0.4, 1] },
        },
      }
  return (
    <motion.div className="ls-L ls-flower" style={{ ...style, transformOrigin: '50% 100%' }} {...motionProps}>
      <svg viewBox="0 0 100 160" aria-hidden="true">
        <path d="M50 78 C50 110 46 135 50 160" stroke="#2E8B3D" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M50 128 C34 126 24 116 22 104 C38 104 48 114 50 128Z" fill="#43A047" />
        <path d="M50 138 C66 136 76 128 80 116 C64 116 52 124 50 138Z" fill="#6FB06B" />
        <g fill="#FFFFFF" stroke="#E6DFC9" strokeWidth="2">
          <circle cx="50" cy="30" r="17" />
          <circle cx="73" cy="47" r="17" />
          <circle cx="64" cy="74" r="17" />
          <circle cx="36" cy="74" r="17" />
          <circle cx="27" cy="47" r="17" />
        </g>
        <circle cx="50" cy="55" r="13" fill="#F5A623" />
      </svg>
    </motion.div>
  )
}

function CloudSvg() {
  return (
    <svg viewBox="0 0 100 56">
      <g fill="#FFFDF6">
        <circle cx="30" cy="34" r="16" />
        <circle cx="52" cy="24" r="21" />
        <circle cx="74" cy="34" r="16" />
        <rect x="14" y="34" width="76" height="16" rx="8" />
      </g>
    </svg>
  )
}

/**
 * 로그인 시작 화면의 그림과 팻말(표현만 담당).
 * 로그인 동작은 부모(Start)가 props로 넘긴 함수를 그대로 호출한다.
 *  - me: GET /me 성공 시의 내 정보(없으면 null)
 *  - onKakao / onGuest: 기존 버튼 핸들러
 *  - onEnter: '내 텃밭으로 가기' 및 자동 이동
 */
export default function LoginScene({ me, loading, error, onKakao, onGuest, onEnter }) {
  const reduce = useReducedMotion()
  const [autoOn, setAutoOn] = useState(false)
  const timers = useRef([])
  const onEnterRef = useRef(onEnter)
  useEffect(() => {
    onEnterRef.current = onEnter
  })

  // 로그인된 상태: 장면이 끝난 뒤 3초 카운트 → 자동으로 /home
  useEffect(() => {
    if (!me) return
    const start = setTimeout(
      () => {
        setAutoOn(true)
        timers.current.push(setTimeout(() => onEnterRef.current(), AUTO_GO_MS))
      },
      reduce ? 0 : AUTO_START_MS,
    )
    timers.current.push(start)
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [me, reduce])

  function goNow() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setAutoOn(false)
    onEnter()
  }

  // 모션 줄이기: 애니메이션 없이 완성된 장면만 보여준다
  const m = (props) => (reduce ? {} : props)

  const btnPop = (delay) =>
    m({
      animate: { scale: [1, 1.05, 1] },
      transition: { duration: 0.6, delay, ease: EASE_OUT, times: [0, 0.4, 1] },
    })

  return (
    <div className="ls-scene">
      <div className="ls-sky" aria-hidden="true">
        <motion.div
          className="ls-sun"
          {...m({
            initial: { opacity: 0, scale: 0.4 },
            animate: { opacity: 1, scale: 1 },
            transition: { duration: 1, delay: 0.2, ease: [0.2, 1.3, 0.4, 1] },
          })}
        >
          <svg viewBox="0 0 100 100">
            <g stroke="#F6C662" strokeWidth="6" strokeLinecap="round">
              <path d="M50 4v10M50 86v10M4 50h10M86 50h10M17 17l7 7M76 76l7 7M83 17l-7 7M24 76l-7 7" />
            </g>
            <circle cx="50" cy="50" r="30" fill="#FBE3A0" />
            <circle cx="50" cy="50" r="22" fill="#F6C662" />
          </svg>
        </motion.div>
        <motion.div
          className="ls-cloud c1"
          {...m({
            initial: { x: -10 },
            animate: { x: [-10, 14] },
            transition: { duration: 7, ease: EASE_IN_OUT, repeat: Infinity, repeatType: 'reverse' },
          })}
        >
          <CloudSvg />
        </motion.div>
        <motion.div
          className="ls-cloud c2"
          {...m({
            initial: { x: 14 },
            animate: { x: [14, -10] },
            transition: { duration: 9, ease: EASE_IN_OUT, repeat: Infinity, repeatType: 'reverse' },
          })}
        >
          <CloudSvg />
        </motion.div>
      </div>

      <motion.div
        className="ls-head"
        {...m({
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, delay: 5, ease: EASE_OUT },
        })}
      >
        <p className="ls-tagline">심고 · 가꾸고 · 기록하는 우리 텃밭</p>
        <h1 className="ls-title">텃밭에 온 걸 환영해요</h1>
        <p className="ls-lead">물을 주면 작은 싹이 텃밭이 돼요.</p>
      </motion.div>

      <div
        className="ls-stage"
        role="img"
        aria-label="물뿌리개로 물을 주면 싹이 자라서 채소와 토마토가 가득한 울타리 텃밭이 되는 그림"
      >
        <motion.div
          className="ls-meadow b"
          {...m({
            initial: { opacity: 0, y: 40 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 1.6, ease: EASE_OUT },
          })}
        />
        <motion.div
          className="ls-meadow a"
          {...m({
            initial: { opacity: 0, y: 40 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 1.6, delay: 0.3, ease: EASE_OUT },
          })}
        />

        <div className="ls-L ls-fence" style={{ left: '15.726%', top: '56.574%', width: '68.549%' }}>
          <motion.img
            alt=""
            src={fenceImg}
            {...m({
              initial: { opacity: 0, y: '18%' },
              animate: { opacity: 1, y: '0%' },
              transition: { duration: 0.9, delay: 3.4, ease: [0.2, 0.9, 0.3, 1.1] },
            })}
          />
        </div>

        <motion.div
          className="ls-L ls-bush"
          style={{ left: '12.759%', top: '26.820%', width: '47.480%', transformOrigin: '50% 100%' }}
          {...m({
            initial: { rotate: -0.8 },
            animate: { rotate: [-0.8, 0.8] },
            transition: { duration: 4.2, delay: 6, ease: EASE_IN_OUT, repeat: Infinity, repeatType: 'reverse' },
          })}
        >
          <motion.img
            alt=""
            src={bushImg}
            {...m({
              initial: { opacity: 0, scale: 0.12 },
              animate: { opacity: [0, 1, 1], scale: [0.12, 1] },
              transition: {
                opacity: { times: [0, 0.25, 1], duration: 1.5, delay: 3.8, ease: [0.2, 1.25, 0.4, 1] },
                scale: { duration: 1.5, delay: 3.8, ease: [0.2, 1.25, 0.4, 1] },
              },
            })}
          />
        </motion.div>

        <motion.div
          className="ls-L ls-tomato"
          style={{ left: '61.005%', top: '17.713%', width: '25.586%', transformOrigin: '50% 100%' }}
          {...m({
            initial: { rotate: 0.8 },
            animate: { rotate: [0.8, -0.8] },
            transition: { duration: 3.6, delay: 6.2, ease: EASE_IN_OUT, repeat: Infinity, repeatType: 'reverse' },
          })}
        >
          <motion.img
            alt=""
            src={tomatoImg}
            {...m({
              initial: { opacity: 0, scale: 0.12 },
              animate: { opacity: [0, 1, 1], scale: [0.12, 1] },
              transition: {
                opacity: { times: [0, 0.25, 1], duration: 1.5, delay: 4.5, ease: [0.2, 1.25, 0.4, 1] },
                scale: { duration: 1.5, delay: 4.5, ease: [0.2, 1.25, 0.4, 1] },
              },
            })}
          />
        </motion.div>

        <Flower style={{ left: '20.73%', top: '72.39%', width: '7.50%' }} delay={5.2} />
        <Flower style={{ left: '49.44%', top: '73.97%', width: '7.02%' }} delay={5.35} />
        <Flower style={{ left: '58.61%', top: '75.02%', width: '6.70%' }} delay={5.5} />
        <Flower style={{ left: '78.55%', top: '72.39%', width: '7.50%' }} delay={5.65} />

        {/* 흙·물뿌리개는 인트로에만 나온다(모션 줄이기에서는 그리지 않는다) */}
        {!reduce && (
          <>
            <motion.div
              className="ls-L ls-soil"
              style={{ left: '36.280%', top: '53.538%', width: '27.440%' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{ duration: 3.7, delay: 0, ease: EASE_IN_OUT, times: [0, 0.08, 0.78, 1] }}
            >
              <motion.img
                alt=""
                src={soilImg}
                initial={{ scale: 0.35 }}
                animate={{ scale: [0.35, 0.55, 1, 1.05] }}
                transition={{ duration: 3.7, delay: 0, ease: [0.3, 0.8, 0.3, 1], times: [0, 0.12, 0.6, 1] }}
              />
            </motion.div>

            <motion.div
              className="ls-L ls-can"
              style={{ left: '50.239%', top: '2.459%', width: '43.780%' }}
              initial={{ opacity: 0, x: '30%', y: '-30%', rotate: 14 }}
              animate={{
                opacity: [0, 1, 1, 0],
                x: ['30%', '0%', '0%', '0%', '0%', '0%', '30%'],
                y: ['-30%', '0%', '0%', '0%', '0%', '0%', '-30%'],
                rotate: [14, 0, -2, 0, -2, 0, 12],
              }}
              transition={{
                opacity: { duration: 3.4, delay: 0.2, ease: EASE_IN_OUT, times: [0, 0.18, 0.72, 1] },
                x: { duration: 3.4, delay: 0.2, ease: EASE_IN_OUT, times: [0, 0.18, 0.3, 0.44, 0.58, 0.72, 1] },
                y: { duration: 3.4, delay: 0.2, ease: EASE_IN_OUT, times: [0, 0.18, 0.3, 0.44, 0.58, 0.72, 1] },
                rotate: { duration: 3.4, delay: 0.2, ease: EASE_IN_OUT, times: [0, 0.18, 0.3, 0.44, 0.58, 0.72, 1] },
              }}
            >
              <img alt="" src={canImg} />
              {[
                { src: drop1Img, cls: 'd1', style: { left: '11.29%', top: '49.53%', width: '10.75%' }, delay: 0.9 },
                { src: drop2Img, cls: 'd2', style: { left: '5.83%', top: '66.82%', width: '8.93%' }, delay: 1.15 },
                { src: drop3Img, cls: 'd3', style: { left: '0.09%', top: '85.40%', width: '9.11%' }, delay: 1.4 },
              ].map((d) => (
                <div key={d.cls} className={`part drop ${d.cls}`} style={d.style}>
                  <motion.img
                    alt=""
                    src={d.src}
                    initial={{ opacity: 0, y: '-40%' }}
                    animate={{ opacity: [0, 1, 1, 0], y: ['-40%', '330%'] }}
                    transition={{
                      opacity: { duration: 0.95, delay: d.delay, ease: EASE_IN, times: [0, 0.2, 0.8, 1], repeat: 2 },
                      y: { duration: 0.95, delay: d.delay, ease: EASE_IN, repeat: 2 },
                    }}
                  />
                </div>
              ))}
            </motion.div>
          </>
        )}
      </div>

      <motion.div
        className="ls-signwrap"
        {...m({
          initial: { opacity: 0, y: 70 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.9, delay: 5.3, ease: [0.2, 0.9, 0.3, 1.1] },
        })}
      >
        <div className="ls-sign">
          {me ? (
            <div className="ls-state in">
              <p className="ls-intro">
                <span className="ls-intro-name">{me.nickname}님,</span>
                <span>오늘도 반가워요</span>
              </p>
              <motion.button type="button" className="ls-btn go" onClick={goNow} {...btnPop(6.3)}>
                내 텃밭으로 가기
              </motion.button>
              <div className="ls-auto" aria-hidden="true">
                <motion.i
                  initial={{ width: '0%' }}
                  animate={{ width: autoOn ? '100%' : '0%' }}
                  transition={{ duration: autoOn && !reduce ? AUTO_GO_MS / 1000 : 0, ease: 'linear' }}
                />
              </div>
              <p className="ls-msg" role="status">
                잠시 후 자동으로 들어가요.
              </p>
            </div>
          ) : (
            <div className="ls-state out">
              <p className="ls-intro">로그인</p>
              <motion.button type="button" className="ls-btn kakao" onClick={onKakao} {...btnPop(6.3)}>
                카카오톡으로 시작하기
              </motion.button>
              <motion.button
                type="button"
                className="ls-btn guest"
                onClick={onGuest}
                disabled={loading}
                {...btnPop(6.45)}
              >
                비회원으로 시작하기
              </motion.button>
              <p className={`ls-msg${error ? ' error' : ''}`} role="status">
                {error || '비회원은 기기를 바꾸면 기록이 사라져요.'}
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
