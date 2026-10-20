import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import DiagnosisFailure from './DiagnosisFailure.jsx'
import DiagnosisLoading from './DiagnosisLoading.jsx'
import DiagnosisResult from './DiagnosisResult.jsx'

const CROP_NAMES = {
  tomato: '방울토마토',
  lettuce: '상추',
  cucumber: '오이',
  pepper: '고추',
  eggplant: '가지',
  zucchini: '애호박',
}

const SYMPTOMS = ['잎 변색', '시듦', '잎에 반점', '구멍', '벌레 보임', '곰팡이', '기타']

const PHOTO_SLOTS = [
  { id: 'close', title: '잎 가까이', requirement: '필수', description: '증상이 있는 잎을 가까이에서 선명하게 촬영해 주세요.' },
  { id: 'whole', title: '전체 모습', requirement: '권장', description: '작물 전체와 주변 잎 상태가 보이도록 촬영해 주세요.' },
  { id: 'back', title: '잎 뒷면', requirement: '권장', description: '잎 뒷면의 병징이나 해충 흔적을 촬영해 주세요.' },
]

const DIAGNOSIS_DEMOS = {
  diagnosed: {
    status: 'diagnosed',
    diseaseName: '데모 예시 병해충명',
    evidence: ['데모 예시 분석 근거입니다. 실제 사진 분석에서 나온 내용이 아닙니다.'],
    management: ['실제 진단 데이터가 연결되면 AI가 제시한 관리 방법이 이곳에 표시됩니다.'],
    additionalChecks: ['실제 진단 데이터가 연결되면 AI가 제시한 추가 확인 사항이 표시됩니다.'],
  },
  uncertain: {
    status: 'uncertain',
    reason: '데모 예시 판단 사유입니다. 실제 분석 응답이 아닙니다.',
    retakeGuidance: ['데모 예시 추가 촬영 방법입니다. 실제 AI 안내가 아닙니다.'],
    additionalChecks: ['데모 예시 확인 사항입니다. 실제 AI 안내가 아닙니다.'],
  },
  limit: {
    status: 'limit',
    remainingCount: 0,
  },
}

const DEMO_ERROR_MESSAGE = '데모용 서버 오류 안내입니다. 실제 서버 요청이나 진단은 수행하지 않았습니다.'

function PhotoMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="28" height="24" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="13" cy="14" r="2.5" fill="currentColor" />
      <path d="m7 26 8-8 5 5 4-4 6 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getGrowingCrops(farms) {
  if (!Array.isArray(farms)) return []
  return farms.flatMap(farm => (farm.plots ?? []).flatMap((plant, index) => (
    plant
      ? [{
          id: `${farm.id}:${index + 1}`,
          farmName: farm.name,
          farmRegion: farm.region,
          plotNumber: index + 1,
          cropName: CROP_NAMES[plant.kind] ?? '알 수 없는 작물',
        }]
      : []
  )))
}

export default function DiagnosisDetails({ onBack, onRestartObservation }) {
  const [diagnosisInput, setDiagnosisInput] = useState({ cropId: '', symptoms: [], description: '' })
  const [photos, setPhotos] = useState({})
  const [farms, setFarms] = useState([])
  const [gardenLoading, setGardenLoading] = useState(true)
  const [gardenError, setGardenError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [notice, setNotice] = useState('')
  const [flow, setFlow] = useState({ screen: 'form' })
  const ownedPhotoUrls = useRef({})
  const crops = useMemo(() => getGrowingCrops(farms), [farms])
  const selectedCrop = crops.find(crop => crop.id === diagnosisInput.cropId)

  useEffect(() => {
    let cancelled = false

    api.gardenState()
      .then(data => {
        if (!cancelled) setFarms(data.state?.farms ?? [])
      })
      .catch(error => {
        if (!cancelled) setGardenError(`농장 작물을 불러오지 못했어요. ${error.message}`)
      })
      .finally(() => {
        if (!cancelled) setGardenLoading(false)
      })

    api.mySummary()
      .then(data => {
        if (!cancelled) setSummary(data)
      })
      .catch(error => {
        if (!cancelled) setSummaryError(`진단 기록 정보를 불러오지 못했어요. ${error.message}`)
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false)
      })

    return () => {
      cancelled = true
      Object.values(ownedPhotoUrls.current).forEach(url => URL.revokeObjectURL(url))
      ownedPhotoUrls.current = {}
    }
  }, [reloadKey])

  function toggleSymptom(symptom) {
    setDiagnosisInput(current => ({
      ...current,
      symptoms: current.symptoms.includes(symptom)
        ? current.symptoms.filter(item => item !== symptom)
        : [...current.symptoms, symptom],
    }))
    setNotice('')
  }

  function selectPhoto(event, slotId) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setPhotoError('이미지 파일을 선택해 주세요.')
      return
    }

    if (ownedPhotoUrls.current[slotId]) {
      URL.revokeObjectURL(ownedPhotoUrls.current[slotId])
    }

    const url = URL.createObjectURL(file)
    ownedPhotoUrls.current[slotId] = url
    setPhotos(current => ({ ...current, [slotId]: { file, url, name: file.name } }))
    setPhotoError('')
    setNotice('')
  }

  function removePhoto(slotId) {
    if (ownedPhotoUrls.current[slotId]) {
      URL.revokeObjectURL(ownedPhotoUrls.current[slotId])
      delete ownedPhotoUrls.current[slotId]
    }

    setPhotos(current => {
      const next = { ...current }
      delete next[slotId]
      return next
    })
    setNotice('')
  }

  function submitDiagnosis(event) {
    event.preventDefault()
    if (!canRequest) return
    setNotice('외부 AI 진단 서버가 아직 연결되지 않아 실제 분석 요청, 이용 횟수 확인 및 차감은 진행하지 않았어요. 화면 확인은 아래 개발용 데모를 선택해 주세요.')
  }

  function openDemo(screen) {
    setNotice('')
    setFlow({ screen, source: 'demo' })
  }

  function chooseDemoOutcome(outcome) {
    if (outcome === 'error') {
      setFlow({ screen: 'error', source: 'demo', message: DEMO_ERROR_MESSAGE })
      return
    }
    setFlow({ screen: 'result', source: 'demo', result: DIAGNOSIS_DEMOS[outcome] })
  }

  function returnToForm() {
    setFlow({ screen: 'form' })
    setNotice('')
  }

  const canRequest = Boolean(
    diagnosisInput.cropId
    && diagnosisInput.symptoms.length > 0
    && photos.close
  )

  if (flow.screen === 'loading') {
    return (
      <DiagnosisLoading
        source={flow.source}
        onChooseDemoOutcome={chooseDemoOutcome}
      />
    )
  }

  if (flow.screen === 'error') {
    return (
      <DiagnosisFailure
        message={flow.message}
        isDemo={flow.source === 'demo'}
        onRetry={returnToForm}
      />
    )
  }

  if (flow.screen === 'result') {
    return (
      <DiagnosisResult
        result={flow.result}
        cropName={selectedCrop?.cropName}
        source={flow.source}
        onRetake={returnToForm}
        onRestartObservation={onRestartObservation}
      />
    )
  }

  return (
    <form className="diagnosis-details" onSubmit={submitDiagnosis}>
      <section className="diagnosis-copy">
        <span className="diagnosis-eyebrow">AI 상세 진단</span>
        <h2>작물 상태를 자세히 알려주세요</h2>
        <p>입력 정보와 사진은 향후 외부 AI 분석을 위해 사용될 수 있습니다. 현재는 분석 서버에 전송되지 않습니다.</p>
      </section>

      <section className="diagnosis-detail-card">
        <div className="diagnosis-detail-heading">
          <span className="diagnosis-step-number">1</span>
          <h2>어떤 작물인가요?</h2>
        </div>
        {gardenLoading && <p className="diagnosis-detail-muted" role="status">내 농장 작물을 불러오는 중이에요.</p>}
        {gardenError && (
          <div className="diagnosis-detail-empty" role="alert">
            <p>{gardenError}</p>
            <button type="button" className="diagnosis-inline-retry" onClick={() => {
              setGardenError('')
              setGardenLoading(true)
              setSummary(null)
              setSummaryError('')
              setSummaryLoading(true)
              setReloadKey(value => value + 1)
            }}>다시 불러오기</button>
          </div>
        )}
        {!gardenLoading && !gardenError && crops.length === 0 && (
          <div className="diagnosis-detail-empty">
            <strong>선택할 수 있는 작물이 없어요</strong>
            <p>농장에 재배 중인 작물을 등록한 뒤 다시 확인해 주세요.</p>
          </div>
        )}
        {crops.length > 0 && (
          <div className="diagnosis-crop-options" role="group" aria-label="진단할 작물 선택">
            {crops.map(crop => (
              <button
                key={crop.id}
                type="button"
                className={`diagnosis-crop-option${diagnosisInput.cropId === crop.id ? ' is-selected' : ''}`}
                aria-pressed={diagnosisInput.cropId === crop.id}
                onClick={() => {
                  setDiagnosisInput(current => ({ ...current, cropId: crop.id }))
                  setNotice('')
                }}
              >
                <span className="diagnosis-crop-option-name">{crop.cropName}</span>
                <span>{crop.farmName} · {crop.plotNumber}번 칸</span>
                {crop.farmRegion && <span>{crop.farmRegion}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="diagnosis-detail-card">
        <div className="diagnosis-detail-heading">
          <span className="diagnosis-step-number">2</span>
          <h2>어떤 증상이 있나요?</h2>
        </div>
        <div className="diagnosis-symptom-options">
          {SYMPTOMS.map(symptom => (
            <label key={symptom} className={`diagnosis-symptom-option${diagnosisInput.symptoms.includes(symptom) ? ' is-selected' : ''}`}>
              <input
                type="checkbox"
                checked={diagnosisInput.symptoms.includes(symptom)}
                onChange={() => toggleSymptom(symptom)}
              />
              <span>{symptom}</span>
            </label>
          ))}
        </div>
        <label className="diagnosis-description-label" htmlFor="diagnosis-description">
          증상 설명
          <span>언제 시작됐고 어떻게 변했는지 적어 주세요. (선택)</span>
        </label>
        <textarea
          id="diagnosis-description"
          className="diagnosis-description"
          value={diagnosisInput.description}
          maxLength={1000}
          onChange={event => {
            setDiagnosisInput(current => ({ ...current, description: event.target.value }))
            setNotice('')
          }}
          placeholder="예: 며칠 전부터 잎 끝이 노랗게 변했고 점점 넓어지고 있어요."
          rows={4}
        />
        <span className="diagnosis-character-count">{diagnosisInput.description.length}/1000</span>
      </section>

      <section className="diagnosis-detail-card">
        <div className="diagnosis-detail-heading">
          <span className="diagnosis-step-number">3</span>
          <div>
            <h2>사진을 찍어주세요</h2>
            <p>잎 가까이 사진은 필수이며, 나머지는 선택 사항이에요.</p>
          </div>
        </div>
        <div className="diagnosis-detail-photo-list">
          {PHOTO_SLOTS.map(slot => {
            const photo = photos[slot.id]
            return (
              <section key={slot.id} className="diagnosis-detail-photo-card">
                <div className="diagnosis-detail-photo-heading">
                  <div>
                    <h3>{slot.title}</h3>
                    <span className={slot.requirement === '필수' ? 'is-required' : ''}>{slot.requirement}</span>
                  </div>
                  <p>{slot.description}</p>
                </div>
                {photo ? (
                  <>
                    <div className="diagnosis-detail-photo-preview">
                      <img src={photo.url} alt={`${slot.title} 사진 미리보기`} />
                      <span>{photo.name}</span>
                    </div>
                    <div className="diagnosis-detail-photo-actions">
                      <label className="diagnosis-photo-action">
                        교체
                        <input type="file" accept="image/*" capture="environment" onChange={event => selectPhoto(event, slot.id)} />
                      </label>
                      <button type="button" className="diagnosis-photo-action is-remove" onClick={() => removePhoto(slot.id)}>삭제</button>
                    </div>
                  </>
                ) : (
                  <label className="diagnosis-upload diagnosis-detail-upload">
                    <input type="file" accept="image/*" capture="environment" onChange={event => selectPhoto(event, slot.id)} />
                    <PhotoMark />
                    <strong>사진 촬영·선택</strong>
                    <span>눌러서 카메라를 열거나 사진을 선택해 주세요</span>
                  </label>
                )}
              </section>
            )
          })}
        </div>
        {photoError && <p className="diagnosis-error" role="alert">{photoError}</p>}
        {!photos.close && <p className="diagnosis-required-note" role="status">AI 진단을 요청하려면 ‘잎 가까이’ 사진이 필요해요.</p>}
      </section>

      <aside className="diagnosis-photo-guide">
        <strong>이렇게 찍으면 더 정확해요</strong>
        <p>아래 방법은 사진 품질을 높이기 위한 권장 사항이며, 분석 정확도를 보장하지 않습니다.</p>
        <ul>
          <li>밝은 곳에서 흔들리지 않게 촬영해 주세요.</li>
          <li>증상이 있는 부분에 초점을 맞춰 주세요.</li>
          <li>잎 앞면과 뒷면을 함께 촬영하면 분석에 도움이 됩니다.</li>
          <li>가능하면 작물 전체 모습도 함께 올려 주세요.</li>
        </ul>
      </aside>

      <section className="diagnosis-demo-panel">
        <h2>후속 화면 UI 데모</h2>
        <p>아래 선택은 데모 화면만 보여주며, 실제 분석 요청·결과 저장·진단 횟수 차감은 발생하지 않습니다.</p>
        <button type="button" className="btn secondary" onClick={() => openDemo('loading')}>분석 로딩 데모 보기</button>
        <div className="diagnosis-demo-response-options">
          <button type="button" className="btn secondary" onClick={() => chooseDemoOutcome('diagnosed')}>진단 결과 데모</button>
          <button type="button" className="btn secondary" onClick={() => chooseDemoOutcome('uncertain')}>판단 어려움 데모</button>
          <button type="button" className="btn secondary" onClick={() => chooseDemoOutcome('limit')}>횟수 초과 데모</button>
          <button type="button" className="btn secondary" onClick={() => chooseDemoOutcome('error')}>네트워크·서버 오류 데모</button>
        </div>
      </section>

      <section className="diagnosis-recent-section">
        <h2>최근 진단</h2>
        {summaryLoading && <p role="status">진단 기록을 확인하는 중이에요.</p>}
        {summaryError && <p className="diagnosis-detail-error" role="alert">{summaryError}</p>}
        {!summaryLoading && !summaryError && summary?.diagnoses === 0 && (
          <p>아직 진단 기록이 없어요.</p>
        )}
        {!summaryLoading && !summaryError && Number(summary?.diagnoses) > 0 && (
          <p>진단 기록 {summary.diagnoses}건이 있어요. 최근 진단의 작물명·병해충명·날짜를 조회하는 API는 아직 연결되지 않았습니다.</p>
        )}
      </section>

      <div className="diagnosis-detail-actions">
        <button type="submit" className="btn primary" disabled={!canRequest}>AI 진단하기</button>
        {!canRequest && <p>작물·증상을 선택하고 필수 사진을 추가하면 진단 요청 버튼을 사용할 수 있어요.</p>}
        {notice && <p className="diagnosis-detail-notice" role="status">{notice}</p>}
        <button type="button" className="btn secondary" onClick={onBack}>이전 화면으로</button>
      </div>
    </form>
  )
}
