"""레벨 구간 검사. 프론트의 frontend/src/constants/level.js와 같은 값이어야 한다(두 곳 모두 같은 표를 검사한다)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from level import LEVEL_MIN_EXP, level_from_exp

# (exp, 레벨): 구간 경계 바로 아래와 위
CASES = [(0, 1), (119, 1), (120, 2), (319, 2), (320, 3), (599, 3), (600, 4), (999, 4), (1000, 5),
         (1599, 5), (1600, 6), (2399, 6), (2400, 7), (3399, 7), (3400, 8), (4599, 8), (4600, 9), (5999, 9), (6000, 10), (99999, 10)]


class LevelTest(unittest.TestCase):
    def test_boundaries(self):
        for exp, level in CASES:
            self.assertEqual(level_from_exp(exp), level, f'{exp}exp')

    def test_table_has_ten_increasing_levels(self):
        self.assertEqual(len(LEVEL_MIN_EXP), 10)
        gaps = [b - a for a, b in zip(LEVEL_MIN_EXP, LEVEL_MIN_EXP[1:])]
        self.assertEqual(gaps, sorted(gaps))  # 올라갈수록 필요한 경험치가 늘어난다
        self.assertEqual(gaps[0], 120)  # 첫 레벨업은 할 일 12번 정도면 된다


if __name__ == '__main__':
    unittest.main()
