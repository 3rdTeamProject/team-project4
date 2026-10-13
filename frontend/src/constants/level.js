// 레벨 구간 (미정: 임시 값). 레벨은 users.exp(누적 경험치)로만 계산하고, 바꿀 때는 이 파일만 고친다.
// LEVEL_MIN_EXP[i] = 레벨 i+1이 되기 위한 최소 누적 경험치.
// backend/level.py와 같은 값으로 맞춰야 한다.
export const LEVEL_MIN_EXP = [0, 100, 300, 600, 1000]

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
  const min = LEVEL_MIN_EXP[level - 1]
  const next = level < LEVEL_MIN_EXP.length ? LEVEL_MIN_EXP[level] : null
  if (next === null) return { level, ratio: 1, remaining: 0, next: null }
  return { level, ratio: (exp - min) / (next - min), remaining: next - exp, next }
}
