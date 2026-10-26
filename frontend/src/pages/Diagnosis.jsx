import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { storage } from '../api.js'
import DiagnosisResult from '../components/DiagnosisResult.jsx'
import DiagnosisDetails from '../components/DiagnosisDetails.jsx'
import { useGoBack } from '../hooks/useGoBack.js'
import './diagnosis.css'

const STEPS = [
  { id: 'plant', label: '사진 준비' },
  { id: 'leaf', label: '잎 관찰' },
  { id: 'detail', label: 'AI 상세 진단' },
]

function PhotoMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="28" height="24" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="13" cy="14" r="2.5" fill="currentColor" />
      <path d="m7 26 8-8 5 5 4-4 6 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CameraMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export default function Diagnosis() {
  // 메뉴에서 'AI 상세 진단'으로 바로 들어오면 사진 준비 단계를 건너뛴다
  const [searchParams] = useSearchParams()
  const direct = searchParams.get('mode') === 'detail'
  const [step, setStep] = useState(direct ? 'detail' : 'plant')
  const [plantPhoto, setPlantPhoto] = useState(null)
  const [detailPhoto, setDetailPhoto] = useState(null)
  const [error, setError] = useState('')
  const plantUrl = useRef(null)
  const detailUrl = useRef(null)
  const close = useGoBack('/menu')

  useEffect(() => () => {
    if (plantUrl.current) URL.revokeObjectURL(plantUrl.current)
    if (detailUrl.current) URL.revokeObjectURL(detailUrl.current)
  }, [])

  if (!storage.token) return <Navigate to="/" replace />

  function selectPhoto(event, kind) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일을 선택해 주세요.')
      return
    }

    const urlRef = kind === 'plant' ? plantUrl : detailUrl
    const setPhoto = kind === 'plant' ? setPlantPhoto : setDetailPhoto
    const nextUrl = URL.createObjectURL(file)
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = nextUrl
    setPhoto({ url: nextUrl, name: file.name })
    setError('')
  }

  function goBack() {
    if (step === 'result') setStep('detail')
    else if (step === 'detail') direct ? close() : setStep('leaf')
    else if (step === 'leaf') setStep('plant')
    else close()
  }

  function restartLeafObservation() {
    setError('')
    setStep('plant')
  }

  const activeIndex = step === 'plant' ? 0 : step === 'leaf' ? 1 : 2

  return (
    <main className="screen diagnosis-screen">
      <header className="screen-header">
        <button
          type="button"
          className="icon-btn diagnosis-back"
          onClick={goBack}
          aria-label={step === 'plant' ? '메뉴로 돌아가기' : '이전 단계'}
        >
          {step === 'plant' ? '✕' : '‹'}
        </button>
        <h1 className="screen-title">{step === 'plant' || step === 'leaf' ? '잎 관찰하기' : 'AI 진단'}</h1>
        <span className="icon-btn-spacer" aria-hidden="true" />
      </header>

      <ol className="diagnosis-progress" aria-label="진단 진행 단계">
        {STEPS.map((item, index) => (
          <li key={item.id} className={index <= activeIndex ? 'is-active' : ''}>
            <span>{index + 1}</span>{item.label}
          </li>
        ))}
      </ol>

      {step === 'plant' && (
        <>
          <section className="diagnosis-intro-card">
            <div className="diagnosis-leaf-art" aria-hidden="true">
              <svg viewBox="0 0 128 96" fill="none">
                <path d="M20 75C25 36 54 14 112 16c-4 46-31 70-69 66-11-1-18-3-23-7Z" fill="#75BD55" />
                <path d="M27 75c21-17 39-32 76-52M48 63l-2-20m17 9 2-20m-3 45 18-2" stroke="#3B8B3C" strokeWidth="3" strokeLinecap="round" />
                <circle cx="77" cy="40" r="4" fill="#B98138" />
                <circle cx="52" cy="57" r="3.5" fill="#B98138" />
              </svg>
            </div>
            <h2>작물 사진을 준비해 주세요</h2>
            <p>사진을 선택하거나 촬영한 뒤 잎 상태를 관찰할 수 있어요.</p>
          </section>

          <section className="diagnosis-card">
            <div className="diagnosis-card-heading">
              <span className="diagnosis-step-number">1</span>
              <div><h2>작물 전체 사진</h2><p>작물과 잎 모양이 보이게 찍어 주세요.</p></div>
            </div>
            {plantPhoto && (
              <div className="diagnosis-photo-preview">
                <img src={plantPhoto.url} alt="선택한 작물 전체 사진 미리보기" />
                <span className="diagnosis-photo-name">{plantPhoto.name}</span>
              </div>
            )}
            <div className="diagnosis-photo-input-options">
              <label className="diagnosis-photo-input-option">
                <input type="file" accept="image/*" onChange={event => selectPhoto(event, 'plant')} />
                <PhotoMark />
                <strong>사진 선택</strong>
                <span>갤러리 또는 기기에서 선택</span>
              </label>
              <label className="diagnosis-photo-input-option">
                <input type="file" accept="image/*" capture="environment" onChange={event => selectPhoto(event, 'plant')} />
                <CameraMark />
                <strong>카메라 촬영</strong>
                <span>{plantPhoto ? '사진을 다시 촬영할 수 있어요' : '기기·브라우저에 따라 실행 방식이 달라요'}</span>
              </label>
            </div>
          </section>
          <div className="diagnosis-actions">
            {error && <p className="diagnosis-error" role="alert">{error}</p>}
            <button type="button" className="btn primary" disabled={!plantPhoto} onClick={() => setStep('leaf')}>
              잎 관찰하기
            </button>
            <p className="diagnosis-privacy-note">사진은 이 화면에서 미리보기만 할 수 있어요.</p>
          </div>
        </>
      )}

      {step === 'leaf' && (
        <>
          <section className="diagnosis-copy">
            <span className="diagnosis-eyebrow">1단계 · 작물 사진</span>
            <h2>잎 관찰</h2>
            <p>사진에서 이상 의심 잎이 있는지 확인해요. 병명이나 증상 종류는 판단하지 않습니다.</p>
          </section>
          <div className="diagnosis-photo-stage">
            <img src={plantPhoto.url} alt="선택한 작물 전체 사진" />
          </div>
          <aside className="diagnosis-notice" role="status">
            <strong>모델 미연결</strong>
            <p>사진을 업로드해도 아직 잎 이상을 분석하지 않습니다.</p>
          </aside>
          <div className="diagnosis-actions">
            <button type="button" className="btn secondary" onClick={() => setStep('plant')}>작물 사진 다시 선택</button>
          </div>
        </>
      )}

      {step === 'detail' && (
        <DiagnosisDetails
          onBack={() => (direct ? close() : setStep('leaf'))}
          onRestartObservation={restartLeafObservation}
        />
      )}

      {step === 'result' && (
        <>
          <section className="diagnosis-copy">
            <span className="diagnosis-eyebrow">결과 안내</span>
            <h2>사진을 준비했어요</h2>
            <p>AI 분석 결과를 연결하기 전까지는 진단을 제공하지 않습니다.</p>
          </section>
          <div className="diagnosis-result-photo">
            <img src={detailPhoto.url} alt="분석을 위해 선택한 상세 사진" />
            <span>선택한 상세 사진</span>
          </div>
          <DiagnosisResult result={null} onRetake={() => setStep('detail')} />
          <aside className="diagnosis-notice is-info" role="note">
            외부 AI API를 호출하지 않았으며, 실제 병해충 진단 결과나 관리 방법은 표시하지 않습니다.
          </aside>
          <div className="diagnosis-actions">
            <Link className="btn primary" to="/journals">재배일지 작성하기</Link>
            <button type="button" className="btn secondary" onClick={() => setStep('detail')}>사진 다시 확인하기</button>
          </div>
        </>
      )}
    </main>
  )
}
