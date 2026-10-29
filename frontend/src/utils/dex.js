// 작물 도감 계산: 계절 이름 묶기, 지금 심기 좋은 작물, 심은 날 기준 할 일 날짜.
// 서버(GET /garden/dex)가 준 작물 행을 그대로 받아 계산만 한다. 규칙은 backend/tasks.py의 할 일 생성과 같다.

const SEASON_ORDER = ['봄', '여름', '가을', '겨울']

export function baseName(name) {
  return name.trim().replace(/\s*\([^)]*\)\s*$/, '')
}

// "무(봄)" → "봄", 괄호가 없으면 null
export function seasonOf(name) {
  const match = name.match(/\(([^)]*)\)\s*$/)
  return match ? match[1].trim() : null
}

function seasonRank(season) {
  const rank = SEASON_ORDER.indexOf(season)
  return rank === -1 ? SEASON_ORDER.length : rank
}

/**
 * 괄호 앞 이름이 같은 작물을 카드 하나로 묶는다. 괄호가 없으면 그대로 카드 하나.
 * 도감 정보(심는·거두는 달, 온도, 흙, 소개)도 할 일도 없는 작물은 보여 줄 내용이 없어서 뺀다(예: 감자, 옛 오이 행).
 * 데이터가 채워지면 자동으로 나온다.
 * 반환: [{ key(괄호 앞 이름), name(카드에 쓰는 이름), rows(봄→여름→가을 순), summary(첫 소개) }] 가나다 순
 */
// 도감에 보여 줄 내용이 하나라도 있는지(도감 정보 또는 할 일)
function hasContent(crop) {
  return crop.tasks.length > 0 || crop.sowMonths.length > 0 || crop.harvestMonths.length > 0
    || Boolean(crop.germTemp || crop.growTemp || crop.soil || crop.summary)
}

export function groupCrops(crops) {
  const byBase = new Map()
  for (const crop of crops.filter(hasContent)) {
    const key = baseName(crop.name)
    if (!byBase.has(key)) byBase.set(key, [])
    byBase.get(key).push(crop)
  }
  const groups = []
  for (const [key, all] of byBase) {
    const rows = all
      .sort((a, b) => seasonRank(seasonOf(a.name)) - seasonRank(seasonOf(b.name)))
    groups.push({
      key,
      name: rows.length > 1 ? key : rows[0].name,
      rows,
      summary: rows.map((crop) => crop.summary).find(Boolean) ?? null,
    })
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

// 오늘 달(1~12)이 심는 달에 들어 있는지. 묶음이면 계절 행 중 하나라도 해당되면 true
export function sowableNow(group, month) {
  return group.rows.some((crop) => crop.sowMonths.includes(month))
}

export function matchesSearch(group, query) {
  const q = query.trim()
  return !q || group.name.includes(q) || group.rows.some((crop) => crop.name.includes(q))
}

// 씨앗/모종 중 이 작물이 허용하는 심는 방식. 둘 다 막혀 있는 잘못된 데이터는 씨앗으로 본다
export function plantingMethods(crop) {
  const methods = []
  if (crop.allowSeed) methods.push('seed')
  if (crop.allowSeedling) methods.push('seedling')
  return methods.length ? methods : ['seed']
}

// ---------- 날짜 ----------

export function parseDate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day, 12) // 정오로 맞춰 여름·겨울 시간 변경에도 날짜가 밀리지 않게 한다
}

export function toIso(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// "11/4", 기간이면 "11/4~7"(달이 바뀌면 "11/28~12/2")
export function formatSpan(start, end) {
  const from = `${start.getMonth() + 1}/${start.getDate()}`
  if (!end || end.getTime() === start.getTime()) return from
  const sameMonth = start.getMonth() === end.getMonth()
  return `${from}~${sameMonth ? end.getDate() : `${end.getMonth() + 1}/${end.getDate()}`}`
}

export function repeatLabel(task) {
  if (task.repeatMinDays == null) return null
  const { repeatMinDays: min, repeatMaxDays: max } = task
  return max != null && max !== min ? `${min}~${max}일마다` : `${min}일마다`
}

// ---------- 할 일 캘린더 ----------

// 옮겨심은 날의 기본값: 씨 뿌린 날 기준으로 잡힌 '옮겨심기'(3단계를 올리는 할 일)의 예정일. 없으면 씨 뿌린 날
export function defaultTransplantDate(crop, sowDate) {
  const stage = crop.stages.find((s) => s.stageNo === 3)
  const task = stage && crop.tasks.find((t) => t.id === stage.triggerTaskId)
  return task && task.anchor === 'sow' ? addDays(sowDate, task.startDay ?? 0) : sowDate
}

/**
 * 심은 날 기준 할 일 일정.
 * method: 'seed' | 'seedling'. baseDate: 씨 뿌린 날(모종이면 심은 날). transplantDate: 씨앗으로 시작할 때 옮겨심은 날.
 * 반환: { prep: 날짜 없는 '미리 알아두기', days: [{ key, date, items: [{ task, date, endDate, repeat, first }] }], harvestDate }
 * - 씨앗 전용(seedOnly) 할 일은 모종으로 시작하면 뺀다.
 * - 반복 할 일의 첫 번째는 항상 보여 주고, 이어지는 반복은 수확 시점까지만 만든다. (수확 시점 = 5단계를 올리는 할 일의 날, 없으면 심은 날 + 키우는 기간)
 *   씨앗 전용 반복(모종 물 주기 등)은 옮겨심은 날까지만 만든다.
 * - 다른 할 일 뒤(afterTaskId)에 시작하는 할 일은 그 할 일이 시작된 날 + 반복 간격에서 시작한다.
 */
export function buildSchedule(crop, { method, baseDate, transplantDate }) {
  const tasks = crop.tasks.filter((task) => !(method === 'seedling' && task.seedOnly))
  const prep = tasks.filter((task) => task.infoOnly)
  const timed = tasks.filter((task) => !task.infoOnly)

  const anchorOf = (task) => (method === 'seed' && task.anchor === 'transplant' ? transplantDate : baseDate)
  const spans = new Map() // 할 일 id → { start, end }
  const spanOf = (task, seen = new Set()) => {
    if (spans.has(task.id)) return spans.get(task.id)
    if (seen.has(task.id)) return null
    seen.add(task.id)
    let span = null
    if (task.afterTaskId == null) {
      const anchor = anchorOf(task)
      span = {
        start: addDays(anchor, task.startDay ?? 0),
        end: task.endDay != null ? addDays(anchor, task.endDay) : null,
      }
    } else {
      const parent = timed.find((x) => x.id === task.afterTaskId)
      const parentSpan = parent && spanOf(parent, seen)
      if (parentSpan) {
        const gap = task.repeatMinDays ?? task.startDay ?? 0
        const lastGap = task.repeatMinDays != null ? task.repeatMaxDays ?? gap : task.endDay
        span = { start: addDays(parentSpan.start, gap), end: lastGap != null && lastGap !== gap ? addDays(parentSpan.start, lastGap) : null }
      }
    }
    spans.set(task.id, span)
    return span
  }

  const stage5 = crop.stages.find((s) => s.stageNo === 5)
  const harvestTask = stage5 && timed.find((task) => task.id === stage5.triggerTaskId)
  let harvestDate = (harvestTask && spanOf(harvestTask)?.start) || null
  if (!harvestDate && crop.totalDays) harvestDate = addDays(baseDate, crop.totalDays)

  const stage3 = crop.stages.find((s) => s.stageNo === 3)
  const transplantTask = method === 'seed' && stage3 && timed.find((task) => task.id === stage3.triggerTaskId && task.seedOnly)

  const byDay = new Map()
  const put = (item) => {
    const key = toIso(item.date)
    if (!byDay.has(key)) byDay.set(key, { key, date: item.date, items: [] })
    byDay.get(key).items.push(item)
  }
  for (const task of timed) {
    const span = spanOf(task)
    if (!span) continue
    const repeat = task.repeatMinDays != null && task.repeatMinDays > 0
    put({ task, date: span.start, endDate: span.end, repeat, first: true })
    const limit = task.seedOnly && transplantTask ? transplantDate : harvestDate
    if (!repeat || !limit) continue
    let last = span.start
    for (let i = 0; i < 400; i++) {
      last = addDays(last, task.repeatMinDays)
      if (last.getTime() > limit.getTime()) break
      put({ task, date: last, endDate: null, repeat, first: false })
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.date - b.date)
  return { prep, days, harvestDate, harvestTaskId: harvestTask?.id ?? null }
}

// 오늘이 몇 월인지(1~12)
export function thisMonth() {
  return new Date().getMonth() + 1
}

// "9~11월", 12월과 1월이 이어지면 "11~4월", 떨어져 있으면 "1~2월, 5~6월"
export function formatMonths(months) {
  const sorted = [...new Set(months)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const runs = []
  for (const month of sorted) {
    const last = runs.at(-1)
    if (last && month === last[1] + 1) last[1] = month
    else runs.push([month, month])
  }
  if (runs.length > 1 && runs[0][0] === 1 && runs.at(-1)[1] === 12) {
    const first = runs.shift()
    runs.at(-1)[1] = first[1] + 12 // 12월 다음 달로 이어 붙인다
  }
  return runs
    .map(([from, to]) => {
      const end = to > 12 ? to - 12 : to
      return from === end ? `${from}월` : `${from}~${end}월`
    })
    .join(', ')
}

/**
 * 할 일 일정을 "이렇게 하면 돼요" 설명용으로 합친다. 할 일마다 한 줄(처음 날짜 + 반복이면 마지막 날짜).
 * 반환: [{ task, date, endDate, repeat, lastDate }] 처음 날짜 순
 */
export function summarizeSchedule(schedule) {
  const byTask = new Map()
  for (const day of schedule.days) {
    for (const item of day.items) {
      const entry = byTask.get(item.task.id)
      if (!entry) byTask.set(item.task.id, { task: item.task, date: item.date, endDate: item.endDate, repeat: item.repeat, lastDate: item.date })
      else if (item.date > entry.lastDate) entry.lastDate = item.date
    }
  }
  return [...byTask.values()].sort((a, b) => a.date - b.date)
}

// ---------- 한눈에 보는 때(초순·중순·하순) ----------

// 1~10일 초순, 11~20일 중순, 21일~ 하순
export function periodWord(date) {
  const day = date.getDate()
  return day <= 10 ? '초순' : day <= 20 ? '중순' : '하순'
}

// "중순", "중순~하순", 달이 바뀌면 "하순~12월 초순"
export function periodSpan(start, end) {
  const from = periodWord(start)
  if (!end) return from
  const to = periodWord(end)
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) return from === to ? from : `${from}~${to}`
  return `${from}~${end.getMonth() + 1}월 ${to}`
}

// 심은 날로부터 얼마 뒤인지: "바로", "3주 뒤", "2개월 뒤"
export function sinceLabel(days) {
  if (days <= 2) return '바로'
  if (days < 60) return `${Math.max(1, Math.round(days / 7))}주 뒤`
  return `${Math.round(days / 30)}개월 뒤`
}

// 한 줄 설명: 반복이면 "초순부터 · 3~4일마다 · 12월 하순까지", 아니면 "중순~하순"
export function whenLabel({ task, date, endDate, repeat, lastDate }) {
  if (!repeat) return periodSpan(date, endDate)
  const parts = [periodSpan(date, endDate), repeatLabel(task)]
  if (lastDate > date && (lastDate.getMonth() !== date.getMonth() || periodWord(lastDate) !== periodWord(date))) {
    parts[0] = `${periodWord(date)}부터`
    parts.push(`${lastDate.getMonth() + 1}월 ${periodWord(lastDate)}까지`)
  }
  return parts.join(' · ')
}

/**
 * 요약한 할 일을 시작하는 달로 묶는다. baseDate가 속한 해가 아니면 "2027년 1월"처럼 해를 붙인다.
 * 반환: [{ key('2026-11'), label('11월'), steps: [{ ...step, since }] }]
 */
export function groupByMonth(steps, baseDate) {
  const months = new Map()
  for (const step of steps) {
    const key = `${step.date.getFullYear()}-${String(step.date.getMonth() + 1).padStart(2, '0')}`
    if (!months.has(key)) {
      const year = step.date.getFullYear() === baseDate.getFullYear() ? '' : `${step.date.getFullYear()}년 `
      months.set(key, { key, label: `${year}${step.date.getMonth() + 1}월`, steps: [] })
    }
    const days = Math.round((step.date - baseDate) / 86400000)
    months.get(key).steps.push({ ...step, since: sinceLabel(days) })
  }
  return [...months.values()]
}
