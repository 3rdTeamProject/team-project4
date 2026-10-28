# 레벨 구간 (10레벨). 초반은 금방 오르고 뒤로 갈수록 오래 걸린다. 레벨은 users.exp(누적 경험치)로만 계산하고, 바꿀 때는 이 파일만 고친다.
# LEVEL_MIN_EXP[i] = 레벨 i+1이 되기 위한 최소 누적 경험치.
# 프론트의 frontend/src/constants/level.js와 같은 값으로 맞춰야 한다.
LEVEL_MIN_EXP = [0, 60, 160, 300, 500, 800, 1200, 1700, 2300, 3000]


def level_from_exp(exp: int) -> int:
    level = 1
    for i, min_exp in enumerate(LEVEL_MIN_EXP):
        if exp >= min_exp:
            level = i + 1
    return level
