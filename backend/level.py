# 레벨 구간 (미정: 임시 값). 레벨은 users.exp(누적 경험치)로만 계산하고, 바꿀 때는 이 파일만 고친다.
# LEVEL_MIN_EXP[i] = 레벨 i+1이 되기 위한 최소 누적 경험치.
# 프론트의 frontend/src/constants/level.js와 같은 값으로 맞춰야 한다.
LEVEL_MIN_EXP = [0, 100, 300, 600, 1000]


def level_from_exp(exp: int) -> int:
    level = 1
    for i, min_exp in enumerate(LEVEL_MIN_EXP):
        if exp >= min_exp:
            level = i + 1
    return level
