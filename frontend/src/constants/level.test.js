import assert from 'node:assert/strict'
import test from 'node:test'
import { LEVEL_MIN_EXP, levelFromExp, levelProgress, levelTier, levelTitle } from './level.js'

// backend/tests/test_level.py와 같은 값을 검사한다(두 표가 어긋나면 한쪽이 실패한다)
test('경계값마다 레벨이 바뀐다', () => {
  const cases = [[0, 1], [119, 1], [120, 2], [319, 2], [320, 3], [599, 3], [600, 4], [999, 4], [1000, 5],
    [1599, 5], [1600, 6], [2399, 6], [2400, 7], [3399, 7], [3400, 8], [4599, 8], [4600, 9], [5999, 9], [6000, 10], [99999, 10]]
  for (const [exp, level] of cases) assert.equal(levelFromExp(exp), level, `${exp}exp`)
})

test('10레벨이고 올라갈수록 필요한 경험치가 늘어난다', () => {
  assert.equal(LEVEL_MIN_EXP.length, 10)
  const gaps = LEVEL_MIN_EXP.slice(1).map((min, i) => min - LEVEL_MIN_EXP[i])
  assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b))
  assert.equal(gaps[0], 120)
})

test('별칭은 2레벨마다 바뀌고 5개다', () => {
  const titles = Array.from({ length: 10 }, (_, i) => levelTitle(i + 1))
  assert.deepEqual(titles, [
    '견습 농부', '견습 농부', '초보 농부', '초보 농부', '숙련 농부', '숙련 농부',
    '베테랑 농부', '베테랑 농부', '농사 달인', '농사 달인',
  ])
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(levelTier), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  assert.equal(levelTier(99), 5)
  assert.equal(levelTier(0), 1)
})

test('진행도는 현재 레벨 안에서 계산하고 최고 레벨은 가득 찬다', () => {
  assert.deepEqual(levelProgress(60), { level: 1, title: '견습 농부', ratio: 0.5, remaining: 60, next: 120 })
  assert.deepEqual(levelProgress(6000), { level: 10, title: '농사 달인', ratio: 1, remaining: 0, next: null })
})
