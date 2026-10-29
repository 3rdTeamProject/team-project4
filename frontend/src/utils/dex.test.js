import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays, baseName, buildSchedule, defaultTransplantDate, formatMonths, formatSpan, groupByMonth, groupCrops, matchesSearch,
  parseDate, plantingMethods, repeatLabel, seasonOf, periodSpan, periodWord, sinceLabel, sowableNow, summarizeSchedule, toIso, whenLabel,
} from './dex.js'

const crop = (name, extra = {}) => ({
  id: 1, name, totalDays: null, allowSeed: true, allowSeedling: true, sowMonths: [], harvestMonths: [],
  germTemp: null, growTemp: null, soil: null, summary: null, tasks: [], stages: [], ...extra,
})
const task = (id, extra = {}) => ({
  id, title: `할 일 ${id}`, tip: null, howTo: null, anchor: 'sow', startDay: null, endDay: null, repeatMinDays: null,
  repeatMaxDays: null, afterTaskId: null, seedOnly: false, infoOnly: false, plantTask: false, ...extra,
})

test('이름에서 괄호 앞부분과 계절을 뽑는다', () => {
  assert.equal(baseName('무(봄)'), '무')
  assert.equal(baseName('시금치 (봄/여름/가을)'), '시금치')
  assert.equal(baseName('감자'), '감자')
  assert.equal(seasonOf('무(가을)'), '가을')
  assert.equal(seasonOf('시금치(봄/여름/가을)'), '봄/여름/가을')
  assert.equal(seasonOf('감자'), null)
})

test('괄호 앞 이름이 같은 작물은 카드 하나로 묶고 괄호가 없으면 그대로 둔다', () => {
  const groups = groupCrops([
    crop('무(가을)', { id: 2, summary: '소개' }), crop('무(봄)', { id: 1, summary: '서늘해요' }), crop('마늘', { id: 3, summary: '소개' }),
    crop('오이(여름)', { id: 5, tasks: [task(1)] }), crop('오이(봄)', { id: 6, tasks: [task(2)] }),
    crop('갓(봄)', { id: 7, summary: '소개' }), // 혼자 있는 계절 작물은 이름 그대로
  ])
  assert.deepEqual(groups.map((g) => g.name), ['갓(봄)', '마늘', '무', '오이'])
  const radish = groups.find((g) => g.key === '무')
  assert.deepEqual(radish.rows.map((r) => r.name), ['무(봄)', '무(가을)'])
  assert.equal(radish.summary, '서늘해요')
  assert.deepEqual(groups.find((g) => g.key === '오이').rows.map((r) => r.name), ['오이(봄)', '오이(여름)'])
  assert.equal(groups.find((g) => g.key === '마늘').rows.length, 1)
})

test('도감 정보도 할 일도 없는 작물은 빼고, 채워지면 나온다', () => {
  const names = (crops) => groupCrops(crops).map((g) => g.name)
  assert.deepEqual(names([crop('감자'), crop('오이'), crop('상추', { tasks: [task(1)] })]), ['상추'])
  assert.deepEqual(names([crop('감자', { sowMonths: [3] })]), ['감자'])
  assert.deepEqual(names([crop('감자', { soil: '약산성 흙' })]), ['감자'])
  const [cucumber] = groupCrops([crop('오이'), crop('오이(봄)', { tasks: [task(1)] })]) // 할 일 없는 옛 행은 같은 작물 안에서도 빠진다
  assert.deepEqual(cucumber.rows.map((r) => r.name), ['오이(봄)'])
})

test('할 일이 있는 계절 없는 행은 묶음에서 빠지지 않는다', () => {
  const [group] = groupCrops([crop('오이', { tasks: [task(1)] }), crop('오이(봄)', { tasks: [task(2)] })])
  assert.equal(group.rows.length, 2)
})

test('지금 심기 좋은 작물은 심는 달에 오늘 달이 들어 있으면 true, 묶음은 하나라도 해당되면 true', () => {
  const [radish] = groupCrops([crop('무(봄)', { sowMonths: [2, 3, 4] }), crop('무(가을)', { sowMonths: [7, 8, 9] })])
  assert.equal(sowableNow(radish, 10), false)
  assert.equal(sowableNow(radish, 8), true)
  assert.equal(sowableNow(radish, 3), true)
  const [empty] = groupCrops([crop('오이(봄)', { tasks: [task(1)] }), crop('오이(여름)', { tasks: [task(2)] })]) // 심는 달 정보가 없는 작물
  assert.equal(sowableNow(empty, 10), false)
})

test('이름 검색은 묶음 이름과 계절 이름 모두에서 찾는다', () => {
  const [radish] = groupCrops([crop('무(봄)', { summary: '소개' }), crop('무(가을)', { summary: '소개' })])
  assert.equal(matchesSearch(radish, ''), true)
  assert.equal(matchesSearch(radish, ' 무 '), true)
  assert.equal(matchesSearch(radish, '가을'), true)
  assert.equal(matchesSearch(radish, '배추'), false)
})

test('심는 방식은 허용된 것만 나온다', () => {
  assert.deepEqual(plantingMethods(crop('당근', { allowSeedling: false })), ['seed'])
  assert.deepEqual(plantingMethods(crop('고사리', { allowSeed: false })), ['seedling'])
  assert.deepEqual(plantingMethods(crop('방울토마토')), ['seed', 'seedling'])
})

test('날짜 글자는 11/4, 11/4~7, 11/28~12/2 모양이다', () => {
  const day = (iso) => parseDate(iso)
  assert.equal(formatSpan(day('2026-11-04'), null), '11/4')
  assert.equal(formatSpan(day('2026-11-04'), day('2026-11-04')), '11/4')
  assert.equal(formatSpan(day('2026-11-04'), day('2026-11-07')), '11/4~7')
  assert.equal(formatSpan(day('2026-11-28'), day('2026-12-02')), '11/28~12/2')
  assert.equal(toIso(addDays(day('2026-10-30'), 3)), '2026-11-02')
  assert.equal(repeatLabel(task(1, { repeatMinDays: 3 })), '3일마다')
  assert.equal(repeatLabel(task(1, { repeatMinDays: 3, repeatMaxDays: 4 })), '3~4일마다')
  assert.equal(repeatLabel(task(1, { repeatMinDays: 3, repeatMaxDays: 3 })), '3일마다')
  assert.equal(repeatLabel(task(1)), null)
})

// 방울토마토 모양: 씨앗 전용(포트·모종 물·옮겨심기) + 옮겨심은 날 기준(물·웃거름·따기)
const tomato = crop('방울토마토', {
  tasks: [
    task(1, { infoOnly: true, startDay: 0 }),
    task(2, { seedOnly: true, plantTask: true, startDay: 0 }),
    task(3, { seedOnly: true, startDay: 3, endDay: 38, repeatMinDays: 2 }),
    task(4, { seedOnly: true, startDay: 40, endDay: 50 }),
    task(5, { anchor: 'transplant', startDay: 7, repeatMinDays: 3, repeatMaxDays: 4 }),
    task(6, { anchor: 'transplant', startDay: 25, endDay: 30 }),
    task(7, { anchor: 'transplant', startDay: 55, repeatMinDays: 2 }),
    task(8, { anchor: 'transplant', afterTaskId: 6, repeatMinDays: 20, repeatMaxDays: 25 }),
  ],
  stages: [
    { stageNo: 3, name: '어린잎', triggerTaskId: 4 }, { stageNo: 4, name: '꽃 핀 줄기', triggerTaskId: 6 },
    { stageNo: 5, name: '열매', triggerTaskId: 7 },
  ],
})
const datesOf = (schedule, id) => schedule.days.flatMap((d) => d.items.filter((i) => i.task.id === id).map((i) => i.date))

test('씨앗으로 시작하면 옮겨심은 날 기본값은 옮겨심기 예정일이다', () => {
  const sow = parseDate('2026-03-01')
  assert.equal(toIso(defaultTransplantDate(tomato, sow)), '2026-04-10')
  assert.equal(toIso(defaultTransplantDate(crop('당근'), sow)), '2026-03-01') // 옮겨심기가 없으면 씨 뿌린 날
})

test('씨앗 시작: 날짜 범위, 미리 알아두기, 수확 시점에서 끝나는 반복', () => {
  const baseDate = parseDate('2026-03-01')
  const transplantDate = parseDate('2026-04-10')
  const schedule = buildSchedule(tomato, { method: 'seed', baseDate, transplantDate })
  assert.deepEqual(schedule.prep.map((t) => t.id), [1])
  assert.equal(toIso(schedule.harvestDate), '2026-06-04') // 옮겨심은 날 + 55일(5단계를 올리는 할 일)
  const first = schedule.days.flatMap((d) => d.items).find((i) => i.task.id === 6)
  assert.equal(formatSpan(first.date, first.endDate), '5/5~10') // 옮겨심은 날 + 25~30일
  // 옮겨심은 날 기준 반복: 첫 번째는 +7일, 3일마다, 수확 시점(6/4)을 넘지 않는다
  const water = datesOf(schedule, 5)
  assert.equal(toIso(water[0]), '2026-04-17')
  assert.equal(water.length, 17)
  assert.ok(water.every((d) => d <= schedule.harvestDate))
  assert.ok(addDays(water.at(-1), 3) > schedule.harvestDate)
  // 씨앗 전용 반복(모종 물 주기)은 옮겨심은 날에서 끝난다
  const seedling = datesOf(schedule, 3)
  assert.equal(toIso(seedling[0]), '2026-03-04')
  assert.ok(seedling.every((d) => d <= transplantDate))
  assert.equal(toIso(seedling.at(-1)), '2026-04-09') // 3/4부터 2일마다 → 옮겨심은 날(4/10) 전날이 마지막
  // 수확 작업 자체는 한 번만(반복 표시만 붙는다)
  assert.equal(datesOf(schedule, 7).length, 1)
  assert.equal(schedule.days.flatMap((d) => d.items).find((i) => i.task.id === 7).repeat, true)
})

test('다른 할 일 뒤에 시작하는 반복은 그 할 일이 시작된 날 + 간격에서 시작한다', () => {
  const schedule = buildSchedule(tomato, { method: 'seed', baseDate: parseDate('2026-03-01'), transplantDate: parseDate('2026-04-10') })
  // 첫 웃거름(옮겨심은 날 + 25 = 5/5) + 20일 = 5/25. 다음 반복은 수확 시점을 넘으므로 한 번만 보인다
  assert.deepEqual(datesOf(schedule, 8).map(toIso), ['2026-05-25'])
})

test('옮겨심은 날을 바꾸면 그 날 기준 할 일만 움직인다', () => {
  const baseDate = parseDate('2026-03-01')
  const early = buildSchedule(tomato, { method: 'seed', baseDate, transplantDate: parseDate('2026-04-10') })
  const late = buildSchedule(tomato, { method: 'seed', baseDate, transplantDate: parseDate('2026-04-20') })
  assert.equal(toIso(datesOf(late, 6)[0]), '2026-05-15')
  assert.equal(toIso(datesOf(early, 4)[0]), toIso(datesOf(late, 4)[0])) // 씨 뿌린 날 기준 할 일은 그대로
})

test('모종 시작: 씨앗 전용 할 일은 숨기고 심은 날 기준으로 계산한다', () => {
  const baseDate = parseDate('2026-04-10')
  const schedule = buildSchedule(tomato, { method: 'seedling', baseDate, transplantDate: baseDate })
  const ids = schedule.days.flatMap((d) => d.items.map((i) => i.task.id))
  assert.ok(![2, 3, 4].some((id) => ids.includes(id)))
  assert.equal(toIso(datesOf(schedule, 5)[0]), '2026-04-17')
  assert.equal(toIso(schedule.harvestDate), '2026-06-04')
})

test('수확 할 일이 없으면 심은 날 + 키우는 기간까지만 반복한다', () => {
  const plain = crop('상추', { totalDays: 10, tasks: [task(1, { startDay: 0, repeatMinDays: 3 })] })
  const schedule = buildSchedule(plain, { method: 'seed', baseDate: parseDate('2026-03-01'), transplantDate: parseDate('2026-03-01') })
  assert.deepEqual(datesOf(schedule, 1).map(toIso), ['2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10'])
  const noEnd = buildSchedule(crop('감자', { tasks: [task(1, { startDay: 0, repeatMinDays: 3 })] }),
    { method: 'seed', baseDate: parseDate('2026-03-01'), transplantDate: parseDate('2026-03-01') })
  assert.equal(datesOf(noEnd, 1).length, 1) // 수확 시점을 알 수 없으면 첫 번째만
})

test('할 일이 없는 작물은 빈 일정이다', () => {
  const schedule = buildSchedule(crop('오이(봄)', { tasks: [] }), { method: 'seed', baseDate: parseDate('2026-03-01'), transplantDate: parseDate('2026-03-01') })
  assert.deepEqual([schedule.prep, schedule.days], [[], []])
})

test('개월 글자는 이어진 달을 ~로 묶고 12월과 1월이 이어지면 한 덩어리로 본다', () => {
  assert.equal(formatMonths([9, 10, 11]), '9~11월')
  assert.equal(formatMonths([10, 11, 12, 1, 2, 3]), '10~3월')
  assert.equal(formatMonths([11, 12, 1, 2, 3, 4]), '11~4월')
  assert.equal(formatMonths([1, 2, 5, 6]), '1~2월, 5~6월')
  assert.equal(formatMonths([7]), '7월')
  assert.equal(formatMonths([]), '')
})

test('설명용 요약은 할 일마다 한 줄이고 반복은 처음~마지막 날짜로 합친다', () => {
  const schedule = buildSchedule(tomato, { method: 'seed', baseDate: parseDate('2026-03-01'), transplantDate: parseDate('2026-04-10') })
  const rows = summarizeSchedule(schedule)
  assert.equal(rows.length, new Set(rows.map((r) => r.task.id)).size) // 한 할 일은 한 줄
  assert.equal(rows.length, 7) // 미리 알아두기(1번)를 뺀 나머지
  const water = rows.find((r) => r.task.id === 5)
  assert.deepEqual([toIso(water.date), toIso(water.lastDate), water.repeat], ['2026-04-17', '2026-06-04', true])
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].date <= r.date)) // 처음 날짜 순
})

test('초순·중순·하순과 심은 뒤 시간 글자', () => {
  const day = parseDate
  assert.deepEqual(['2026-11-01', '2026-11-10', '2026-11-11', '2026-11-20', '2026-11-21', '2026-11-30'].map((d) => periodWord(day(d))),
    ['초순', '초순', '중순', '중순', '하순', '하순'])
  assert.equal(periodSpan(day('2026-11-13'), day('2026-11-18')), '중순')
  assert.equal(periodSpan(day('2026-11-13'), day('2026-11-23')), '중순~하순')
  assert.equal(periodSpan(day('2026-11-28'), day('2026-12-02')), '하순~12월 초순')
  assert.equal(periodSpan(day('2026-11-13'), null), '중순')
  assert.deepEqual([0, 2, 3, 7, 14, 30, 59, 60, 120].map(sinceLabel), ['바로', '바로', '1주 뒤', '1주 뒤', '2주 뒤', '4주 뒤', '8주 뒤', '2개월 뒤', '4개월 뒤'])
})

test('한 줄 설명과 달별 묶음: 반복은 합치고 해가 바뀌면 해를 붙인다', () => {
  const schedule = buildSchedule(tomato, { method: 'seed', baseDate: parseDate('2026-11-01'), transplantDate: parseDate('2026-12-11') })
  const steps = summarizeSchedule(schedule)
  const water = steps.find((s) => s.task.id === 5)
  assert.equal(whenLabel(water), '중순부터 · 3~4일마다 · 2월 초순까지') // 12/18부터 3일마다 수확 시점(2/5)까지
  assert.equal(whenLabel(steps.find((s) => s.task.id === 6)), '초순') // 1/5~10
  const harvest = steps.find((s) => s.task.id === 7)
  assert.equal(whenLabel(harvest), '초순 · 2일마다') // 수확 할 일은 한 번만이라 끝나는 때를 붙이지 않는다
  const months = groupByMonth(steps, parseDate('2026-11-01'))
  assert.deepEqual(months.map((m) => m.label), ['11월', '12월', '2027년 1월', '2027년 2월'])
  assert.ok(months.every((m) => m.steps.every((s) => typeof s.since === 'string')))
  assert.equal(months[0].steps[0].since, '바로')
})
