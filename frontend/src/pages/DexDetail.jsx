import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { storage } from '../api.js'
import CropImage from '../components/CropImage.jsx'
import MonthBars from '../components/MonthBars.jsx'
import { useDex } from '../hooks/useDex.js'
import { useGoBack } from '../hooks/useGoBack.js'
import {
  buildSchedule, defaultTransplantDate, groupByMonth, groupCrops, parseDate, periodWord, plantingMethods,
  seasonOf, sowableNow, summarizeSchedule, thisMonth, toIso, whenLabel,
} from '../utils/dex.js'
import './screens.css'
import './dex.css'

const METHOD_LABEL = { seed: '씨앗으로 심기', seedling: '모종으로 심기' }

function TaskText({ task }) {
  return (
    <>
      {task.tip && <span className="dex-task-tip">{task.tip}</span>}
      {task.howTo && (
        <details className="dex-howto">
          <summary>방법 보기</summary>
          <p>{task.howTo}</p>
        </details>
      )}
    </>
  )
}

export default function DexDetail() {
  const { cropKey } = useParams()
  const goBack = useGoBack('/dex')
  const { crops, error } = useDex()
  const month = thisMonth()
  const [pickedId, setPickedId] = useState(null)
  const [pickedMethod, setPickedMethod] = useState(null)
  const [sowIso, setSowIso] = useState(() => toIso(new Date()))

  const group = useMemo(() => (crops ? groupCrops(crops).find((g) => g.key === cropKey) : null), [crops, cropKey])
  const row = group ? group.rows.find((crop) => crop.id === pickedId) ?? group.rows.find((crop) => crop.sowMonths.includes(month)) ?? group.rows[0] : null
  const methods = row ? plantingMethods(row) : []
  const method = methods.includes(pickedMethod) ? pickedMethod : methods[0]
  const sowDate = sowIso ? parseDate(sowIso) : null
  // 포트에서 키워 옮겨심는 작물은 옮겨심는 날을 따로 묻지 않고 옮겨심기 예정일(씨 뿌린 뒤 정해진 날수)로 계산한다
  const transplantDate = row && sowDate ? defaultTransplantDate(row, sowDate) : null
  const schedule = useMemo(
    () => (row && sowDate ? buildSchedule(row, { method, baseDate: sowDate, transplantDate }) : null),
    // sowDate·transplantDate는 렌더마다 새로 만들어지므로 글자 값(sowIso)으로 비교한다
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [row, method, sowIso],
  )

  const months = schedule && sowDate ? groupByMonth(summarizeSchedule(schedule), sowDate) : []
  const sinceBase = method === 'seed' ? '씨 뿌리고' : '심고'

  if (!storage.token) return <Navigate to="/" replace />

  const header = (
    <header className="screen-header journal-aligned-header">
      <div className="journal-aligned-title">
        <button type="button" className="icon-btn journal-aligned-back" onClick={goBack} aria-label="뒤로가기" />
        <h1 className="screen-title">{group ? group.name : '작물 도감'}</h1>
      </div>
    </header>
  )

  if (!group || !row) {
    return (
      <div className="screen dex">
        {header}
        {error && <p className="error">{error}</p>}
        {crops && <p className="dex-empty">작물을 찾을 수 없어요</p>}
      </div>
    )
  }

  const hasInfo = row.germTemp || row.growTemp || row.soil || row.totalDays != null

  return (
    <div className="screen dex">
      {header}
      {error && <p className="error">{error}</p>}

      <section className="dex-hero">
        <span className="dex-hero-art"><CropImage name={group.key} alt={`${group.name} 다 자란 모습`} /></span>
        <h2 className="dex-hero-name">{group.name}</h2>
        {sowableNow(group, month) && <span className="dex-badge">지금 심기 좋아요</span>}
        {row.summary && <p className="dex-hero-summary">{row.summary}</p>}
      </section>

      {group.rows.length > 1 && (
        <div className="dex-chips" role="group" aria-label="계절 선택">
          {group.rows.map((crop) => (
            <button
              key={crop.id}
              type="button"
              className="dex-chip"
              aria-pressed={crop.id === row.id}
              onClick={() => setPickedId(crop.id)}
            >
              {seasonOf(crop.name) ?? '기본'}
            </button>
          ))}
        </div>
      )}

      <section className="dex-section">
        <h2 className="dex-section-title">언제 심고 거둘까요</h2>
        {row.sowMonths.length > 0 || row.harvestMonths.length > 0 ? (
          <MonthBars sowMonths={row.sowMonths} harvestMonths={row.harvestMonths} currentMonth={month} />
        ) : (
          <p className="dex-note">심고 거두는 때는 곧 채워져요</p>
        )}
      </section>

      <section className="dex-section">
        <h2 className="dex-section-title">키우기 정보</h2>
        <ul className="dex-info">
          {row.germTemp && <li><span>싹 트는 온도</span><b>{row.germTemp}</b></li>}
          {row.growTemp && <li><span>자라는 온도</span><b>{row.growTemp}</b></li>}
          {row.soil && <li><span>알맞은 흙</span><b>{row.soil}</b></li>}
          <li><span>심는 방식</span><b>{methods.map((m) => METHOD_LABEL[m]).join(' · ')}</b></li>
          {row.totalDays != null && <li><span>키우는 기간</span><b>약 {row.totalDays}일</b></li>}
        </ul>
        {!hasInfo && <p className="dex-note">자세한 키우기 정보는 곧 채워져요</p>}
      </section>

      <section className="dex-section">
        <h2 className="dex-section-title">할 일 캘린더</h2>
        {row.tasks.length === 0 ? (
          <p className="dex-note">할 일 정보가 아직 없어요</p>
        ) : (
          <>
            {methods.length > 1 && (
              <div className="dex-chips" role="group" aria-label="심는 방식 선택">
                {methods.map((m) => (
                  <button key={m} type="button" className="dex-chip" aria-pressed={m === method} onClick={() => setPickedMethod(m)}>
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            )}
            <div className="dex-dates">
              <label className="dex-field">
                <span>{method === 'seed' ? '씨 뿌린 날' : '모종 심은 날'}</span>
                <input type="date" value={sowIso} onChange={(e) => e.target.value && setSowIso(e.target.value)} />
              </label>
            </div>
            <p className="dex-note">
              대략 이렇게 하면 돼요{schedule?.harvestDate && ` · 수확은 ${schedule.harvestDate.getMonth() + 1}월 ${periodWord(schedule.harvestDate)}쯤이에요`}
            </p>

            {schedule?.prep.length > 0 && (
              <details className="dex-prep">
                <summary>미리 알아두기 · {schedule.prep.length}개</summary>
                <ul>
                  {schedule.prep.map((task) => (
                    <li key={task.id}>
                      <b>{task.title}</b>
                      <TaskText task={task} />
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="dex-timeline">
              {months.map((month) => (
                <section key={month.key} className="dex-tl-month">
                  <h3 className="dex-tl-title">{month.label}</h3>
                  <ol className="dex-tl-steps">
                    {month.steps.map((step) => {
                      const harvest = step.task.id === schedule.harvestTaskId
                      return (
                        <li key={step.task.id} className="dex-task" data-harvest={harvest}>
                          <span className="dex-task-head">
                            <b>{step.task.title}</b>
                            {harvest && <span className="dex-tag dex-tag-harvest">수확</span>}
                          </span>
                          <span className="dex-task-when">
                            <span className="dex-when">{whenLabel(step)}</span>
                            <span className="dex-since">{sinceBase} {step.since}</span>
                          </span>
                          <TaskText task={step.task} />
                        </li>
                      )
                    })}
                  </ol>
                </section>
              ))}
            </div>
          </>
        )}
      </section>

      {row.stages.length > 0 && (
        <section className="dex-section">
          <h2 className="dex-section-title">성장 단계</h2>
          <ol className="dex-stages">
            {row.stages.map((stage) => (
              <li key={stage.stageNo}>
                <span className="dex-stage-art"><CropImage name={group.key} stage={stage.stageNo} /></span>
                <span className="dex-stage-no">{stage.stageNo}단계</span>
                <span className="dex-stage-name">{stage.name}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
