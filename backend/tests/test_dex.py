"""작물 도감 API(GET /garden/dex) 검사. 임시 SQLite DB만 쓴다."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

_temp = tempfile.TemporaryDirectory()
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(_temp.name) / 'dex.db')
os.environ['JWT_SECRET'] = 'integration-tests-only-32-character-secret'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from sqlalchemy import text
from main import app, engine


class DexTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        data = self.client.post('/auth/guest', json={}).json()
        self.headers = {'Authorization': 'Bearer ' + data['access_token']}

    def tearDown(self):
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM crop_stages WHERE crop_id IN (SELECT id FROM crops WHERE name = '도감시험(봄)')"))
            conn.execute(text("DELETE FROM crop_tasks WHERE crop_id IN (SELECT id FROM crops WHERE name = '도감시험(봄)')"))
            conn.execute(text("DELETE FROM crops WHERE name IN ('도감시험(봄)', '도감빈칸')"))
        self._ctx.__exit__(None, None, None)

    def test_requires_login(self):
        self.assertEqual(self.client.get('/garden/dex').status_code, 401)

    def test_returns_dex_fields_tasks_and_stages(self):
        with engine.begin() as conn:
            crop_id = conn.execute(text(
                "INSERT INTO crops (name, total_days, allow_seed, allow_seedling, sow_months, harvest_months, germ_temp, soil, summary) "
                "VALUES ('도감시험(봄)', 60, true, false, '[3, 4]', '[11, 12, 1]', '15~25℃', '약산성 흙', '한 줄 소개') RETURNING id")).scalar_one()
            task_id = conn.execute(text(
                "INSERT INTO crop_tasks (crop_id, title, anchor, start_day, end_day, repeat_min_days, repeat_max_days, tip, how_to) "
                "VALUES (:c, '물 주기', 'sow', 3, 7, 2, 4, '팁', '방법') RETURNING id"), {'c': crop_id}).scalar_one()
            conn.execute(text("INSERT INTO crop_stages (crop_id, stage_no, name, trigger_task_id) VALUES (:c, 3, '자라는 중', :t)"),
                         {'c': crop_id, 't': task_id})
        crops = {c['name']: c for c in self.client.get('/garden/dex', headers=self.headers).json()['crops']}

        crop = crops['도감시험(봄)']
        self.assertEqual((crop['sowMonths'], crop['harvestMonths']), ([3, 4], [11, 12, 1]))
        self.assertEqual((crop['allowSeed'], crop['allowSeedling'], crop['totalDays']), (True, False, 60))
        self.assertEqual((crop['germTemp'], crop['growTemp'], crop['soil'], crop['summary']), ('15~25℃', None, '약산성 흙', '한 줄 소개'))
        self.assertEqual(len(crop['tasks']), 1)
        task = crop['tasks'][0]
        self.assertEqual((task['title'], task['anchor'], task['startDay'], task['endDay']), ('물 주기', 'sow', 3, 7))
        self.assertEqual((task['repeatMinDays'], task['repeatMaxDays'], task['afterTaskId']), (2, 4, None))
        self.assertEqual((task['seedOnly'], task['infoOnly'], task['tip'], task['howTo']), (False, False, '팁', '방법'))
        self.assertEqual(crop['stages'], [{'stageNo': 3, 'name': '자라는 중', 'triggerTaskId': task['id']}])

    def test_crop_without_dex_info_is_listed_with_empty_values(self):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO crops (name) VALUES ('도감빈칸')"))  # 도감 정보를 아직 채우지 않은 작물
        crops = {c['name']: c for c in self.client.get('/garden/dex', headers=self.headers).json()['crops']}
        blank = crops['도감빈칸']
        self.assertEqual((blank['sowMonths'], blank['harvestMonths'], blank['tasks'], blank['stages']), ([], [], [], []))
        self.assertEqual((blank['germTemp'], blank['growTemp'], blank['soil'], blank['summary']), (None, None, None, None))


if __name__ == '__main__':
    unittest.main()
