// 레벨 구간 (10레벨). 초반은 금방 오르고 뒤로 갈수록 오래 걸린다. 레벨은 users.exp(누적 경험치)로만 계산하고, 바꿀 때는 이 파일만 고친다.
// LEVEL_MIN_EXP[i] = 레벨 i+1이 되기 위한 최소 누적 경험치.
// backend/level.py와 같은 값으로 맞춰야 한다.
export const LEVEL_MIN_EXP = [0, 120, 320, 600, 1000, 1600, 2400, 3400, 4600, 6000]

// 별칭(농부 계급)은 2레벨마다 바뀐다: 1~2 견습, 3~4 초보, 5~6 숙련, 7~8 베테랑, 9~10 달인
export const LEVEL_TITLES = ['견습 농부', '초보 농부', '숙련 농부', '베테랑 농부', '농사 달인']

// 별칭 단계(1~5). 배지 색을 고를 때도 쓴다.
export function levelTier(level) {
  return Math.max(0, Math.min(Math.floor((level - 1) / 2), LEVEL_TITLES.length - 1)) + 1
}

export function levelTitle(level) {
  return LEVEL_TITLES[levelTier(level) - 1]
}

export function levelFromExp(exp) {
  let level = 1
  LEVEL_MIN_EXP.forEach((minExp, i) => {
    if (exp >= minExp) level = i + 1
  })
  return level
}

// 현재 레벨 안에서의 진행도. 최고 레벨이면 next가 null.
export function levelProgress(exp) {
  const level = levelFromExp(exp)
  const title = levelTitle(level)
  const min = LEVEL_MIN_EXP[level - 1]
  const next = level < LEVEL_MIN_EXP.length ? LEVEL_MIN_EXP[level] : null
  if (next === null) return { level, title, ratio: 1, remaining: 0, next: null }
  return { level, title, ratio: (exp - min) / (next - min), remaining: next - exp, next }
}
