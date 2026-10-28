"""레벨 구간 검사. 프론트의 frontend/src/constants/level.js와 같은 값이어야 한다(두 곳 모두 같은 표를 검사한다)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from level import LEVEL_MIN_EXP, level_from_exp

# (exp, 레벨): 구간 경계 바로 아래와 위
CASES = [(0, 1), (59, 1), (60, 2), (159, 2), (160, 3), (299, 3), (300, 4), (499, 4), (500, 5),
         (799, 5), (800, 6), (1199, 6), (1200, 7), (1699, 7), (1700, 8), (2299, 8), (2300, 9), (2999, 9), (3000, 10), (99999, 10)]


class LevelTest(unittest.TestCase):
    def test_boundaries(self):
        for exp, level in CASES:
            self.assertEqual(level_from_exp(exp), level, f'{exp}exp')

    def test_table_has_ten_increasing_levels(self):
        self.assertEqual(len(LEVEL_MIN_EXP), 10)
        gaps = [b - a for a, b in zip(LEVEL_MIN_EXP, LEVEL_MIN_EXP[1:])]
        self.assertEqual(gaps, sorted(gaps))  # 올라갈수록 필요한 경험치가 늘어난다
        self.assertEqual(gaps[0], 60)  # 첫 레벨업은 할 일 6번 정도면 된다


if __name__ == '__main__':
    unittest.main()
