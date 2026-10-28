"""작물별 할 일·성장 단계·수확 검사. 임시 SQLite DB를 쓰고 .env의 실제 DB는 건드리지 않는다."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

_temp = tempfile.TemporaryDirectory()
os.environ.setdefault('DATABASE_URL', 'sqlite:///' + str(Path(_temp.name) / 'tasks.db'))
os.environ.setdefault('JWT_SECRET', 'integration-tests-only-32-character-secret')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from sqlalchemy import text
from main import app, engine

DAY0 = datetime(2026, 10, 15, 10, 0, 0)

# (키, 제목, 포인트, 씨앗 전용, 기준, 시작, 끝, 반복 min, 반복 max, 완료 후 시작할 키)
TASKS = [
    ('sow', '씨앗 심기', 5, True, 'sow', 0, 3, None, None, None),
    ('lime', '석회·퇴비 섞기', 5, True, 'sow', 0, 7, None, None, None),
    ('pot_water', '모종 물 주기', 3, True, 'sow', 3, 25, 2, None, None),
    ('transplant', '모종 옮겨심기', 10, True, 'sow', 28, 32, None, None, None),
    ('plant_water', '심은 자리 물 주기', 2, False, 'transplant', 0, 1, None, None, None),
    ('support', '지지대 세우기', 10, False, 'transplant', 7, 10, None, None, None),
    ('feed', '첫 웃거름 주기', 10, False, 'transplant', 25, 35, None, None, None),
    ('feed_more', '웃거름 주기 (수확 중)', 4, False, 'transplant', None, None, 7, 10, 'feed'),
    ('water', '물 주기', 2, False, 'transplant', 3, None, 3, None, None),
]


def rows(sql, **params):
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings()]


def run(sql, **params):
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def run_returning(sql, **params):
    with engine.begin() as conn:
        return conn.execute(text(sql), params).scalar()


def farm(plots=None):
    return {'id': 'garden-1', 'name': '우리 농장', 'region': '경기', 'plots': plots if plots is not None else [None] * 6}


def cucumber(method='seed', **extra):
    return {'kind': 'cucumber_spring', 'stage': 1, 'needsWater': False, 'plantedAt': DAY0.date().isoformat(),
            'method': method, **extra}


class TaskTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        self.now = DAY0
        patcher = patch('tasks.now_kst', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(lambda: self._ctx.__exit__(None, None, None))
        data = self.client.post('/auth/guest', json={}).json()
        self.h = {'Authorization': 'Bearer ' + data['access_token']}
        self.uid = rows('SELECT id FROM users WHERE guest_token = :t', t=data['guest_token'])[0]['id']
        # 작물 행을 만든 뒤(빈 농장 저장) 이 시험용 단계·할 일로 바꿔 둔다
        self.save(farm())
        self.install_tasks()

    def install_tasks(self):
        run('DELETE FROM task_logs')
        run('UPDATE crop_stages SET trigger_task_id = NULL, start_day = NULL')
        run('DELETE FROM crop_tasks')
        crop = rows("SELECT id FROM crops WHERE name = '오이(봄)'")[0]['id']
        self.crop = crop
        self.ids = {}
        for key, title, points, seed_only, anchor, start, end, rmin, rmax, after in TASKS:
            run('INSERT INTO crop_tasks (crop_id, title, points, seed_only, anchor, start_day, end_day, repeat_min_days, '
                'repeat_max_days, after_task_id) VALUES (:c, :t, :p, :s, :a, :sd, :ed, :rmin, :rmax, :after)',
                c=crop, t=title, p=points, s=seed_only, a=anchor, sd=start, ed=end, rmin=rmin, rmax=rmax,
                after=self.ids[after] if after else None)
            self.ids[key] = rows('SELECT id FROM crop_tasks WHERE title = :t AND crop_id = :c', t=title, c=crop)[0]['id']
        run('UPDATE crop_tasks SET info_only = :t WHERE id = :i', t=True, i=self.ids['lime'])
        run('UPDATE crop_tasks SET plant_task = :t WHERE id = :i', t=True, i=self.ids['sow'])
        run('UPDATE crop_stages SET start_day = 5 WHERE crop_id = :c AND stage_no = 2', c=crop)
        for no, key in ((3, 'transplant'), (4, 'support'), (5, 'feed')):
            run('UPDATE crop_stages SET trigger_task_id = :t WHERE crop_id = :c AND stage_no = :n', t=self.ids[key], c=crop, n=no)

    def load(self):
        return self.client.get('/garden/state', headers=self.h).json()

    def save(self, f, expect=200):
        loaded = self.load()
        res = self.client.put('/garden/state', headers=self.h, json={
            'revision': loaded['revision'], 'state': {'farms': [f], 'records': loaded['state']['records'], 'settings': {'motion': True}}})
        self.assertEqual(res.status_code, expect, res.text)

    def plant(self, method='seed', **extra):
        self.save(farm([cucumber(method, **extra)] + [None] * 5))

    def goto(self, days):
        self.now = DAY0 + timedelta(days=days)

    def titles(self):
        return {t['title']: t for t in self.client.get('/garden/tasks', headers=self.h).json()['tasks']}

    def planting_id(self):
        return rows('SELECT id FROM plantings WHERE user_id = :u ORDER BY id DESC', u=self.uid)[0]['id']

    def complete(self, *titles, expect=200, content='일지를 올려요', harvest=False):
        by_title = self.titles()
        res = self.client.post('/garden/tasks/complete', headers=self.h, json={
            'planting_id': self.planting_id(), 'task_log_ids': [by_title[t]['id'] for t in titles],
            'content': content, 'harvest': harvest})
        self.assertEqual(res.status_code, expect, res.text)
        return res.json()

    def logs(self, key=None):
        sql = 'SELECT * FROM task_logs'
        return [r for r in rows(sql + ' ORDER BY id') if key is None or r['crop_task_id'] == self.ids[key]]

    def stage(self):
        return rows('SELECT stage FROM plantings WHERE user_id = :u ORDER BY id DESC', u=self.uid)[0]['stage']

    def user(self):
        return rows('SELECT point, exp FROM users WHERE id = :u', u=self.uid)[0]

    def test_seed_starts_with_sowing_tasks_only(self):
        self.plant('seed')
        self.assertEqual({r['crop_task_id'] for r in self.logs()}, {self.ids['sow'], self.ids['lime'], self.ids['pot_water'], self.ids['transplant']})
        self.assertEqual(self.stage(), 1)
        self.assertEqual(rows('SELECT details FROM garden_plant_care')[-1]['details'].count('seed'), 1)
        # 시점이 되기 전에는 보이지 않는다
        self.assertEqual(set(self.titles()), {'석회·퇴비 섞기'})  # 씨앗 심기는 '심었어요'로 이미 완료돼 오늘 할 일에 없다
        self.assertTrue(self.titles()['석회·퇴비 섞기']['infoOnly'])
        sown = self.logs('sow')[0]
        self.assertIsNotNone(sown['completed_at'])
        self.assertEqual(self.user(), {'point': 5, 'exp': 5})  # 심은 순간 그 작업의 포인트를 받는다
        self.assertEqual(rows('SELECT reason FROM point_logs WHERE user_id = :u', u=self.uid), [{'reason': '할 일 완료: 씨앗 심기'}])

    def test_seedling_skips_seed_only_and_starts_at_stage_3(self):
        self.plant('seedling')
        self.assertEqual({r['crop_task_id'] for r in self.logs()},
                         {self.ids['transplant'], self.ids['plant_water'], self.ids['support'], self.ids['feed'], self.ids['water']})  # 웃거름(수확 중)은 완료 후
        moved = self.logs('transplant')[0]  # '심었어요'가 곧 모종 옮겨심기라서 바로 완료로 기록되고 포인트를 받는다
        self.assertIsNotNone(moved['completed_at'])
        self.assertEqual(self.user(), {'point': 10, 'exp': 10})
        self.assertEqual(rows('SELECT reason FROM point_logs WHERE user_id = :u', u=self.uid), [{'reason': '할 일 완료: 모종 옮겨심기'}])
        self.assertEqual(self.stage(), 3)
        self.assertEqual(self.load()['state']['farms'][0]['plots'][0]['method'], 'seedling')

    def test_only_started_and_uncompleted_tasks_show_even_after_the_window(self):
        self.plant('seed')
        self.goto(3)
        self.assertEqual(set(self.titles()), {'석회·퇴비 섞기', '모종 물 주기'})
        self.goto(20)
        self.assertIn('석회·퇴비 섞기', self.titles())  # 구간이 지나도 완료 전까지 보인다

    def test_completing_creates_journal_points_and_next_repeat(self):
        self.plant('seed')
        self.goto(3)
        result = self.complete('모종 물 주기', content='물을 줬어요')
        self.assertEqual(result['earned'], 3)
        self.assertEqual(result['state']['points'], 8)  # 심을 때 5 + 3
        self.assertEqual(result['state']['records'][-1]['text'], '물을 줬어요')
        self.assertEqual(self.user(), {'point': 8, 'exp': 8})  # 심을 때 5 + 모종 물 주기 3
        done = [r for r in self.logs('pot_water') if r['completed_at']][0]
        self.assertIsNotNone(done['journal_id'])
        journal = rows('SELECT * FROM journals WHERE id = :i', i=done['journal_id'])[0]
        self.assertEqual((journal['crop_name'], journal['farm_name']), ('오이(봄)', '우리 농장'))
        # 완료한 날(3일) 기준 2일 뒤 하루짜리 다음 행
        nxt = [r for r in self.logs('pot_water') if not r['completed_at']][0]
        self.assertEqual((str(nxt['start_date']), str(nxt['end_date'])), ('2026-10-20', '2026-10-20'))
        self.assertEqual(rows('SELECT amount FROM point_logs WHERE user_id = :u', u=self.uid), [{'amount': 5}, {'amount': 3}])

    def test_transplant_starts_the_rest_and_stages_only_go_up(self):
        self.plant('seed')
        self.assertEqual(self.load()['state']['farms'][0]['plots'][0]['stage'], 0)  # 옮겨심기 전에는 싹 없는 0단계(포트)
        self.goto(29)
        self.assertNotIn('모종 물 주기', self.titles())  # 옮겨심을 때가 되면 포트 물 주기는 더 보이지 않는다
        self.complete('모종 옮겨심기')
        self.assertEqual(self.stage(), 3)
        self.assertEqual(self.load()['state']['farms'][0]['plots'][0]['stage'], 3)
        starts = {r['crop_task_id']: str(r['start_date']) for r in self.logs() if not r['completed_at']}
        self.assertEqual(starts[self.ids['plant_water']], '2026-11-13')  # 옮겨심은 날(29일) 기준
        self.assertEqual(starts[self.ids['support']], '2026-11-20')
        self.assertNotIn(self.ids['feed_more'], starts)
        self.assertNotIn(self.ids['pot_water'], starts)  # 옮겨심기 전 작업은 못 마쳤어도 정리된다(반복·씨앗 심기 모두)
        self.assertNotIn(self.ids['sow'], starts)
        self.assertNotIn(self.ids['lime'], starts)
        self.goto(36)
        self.complete('지지대 세우기')
        self.assertEqual(self.stage(), 4)
        self.goto(54)
        self.complete('첫 웃거름 주기')
        self.assertEqual(self.stage(), 5)
        more = self.logs('feed_more')[0]  # 완료한 날(54일) 기준 7~10일 뒤
        self.assertEqual((str(more['start_date']), str(more['end_date'])), ('2026-12-15', '2026-12-18'))
        self.goto(0)
        self.assertEqual(self.stage(), 5)  # 단계는 내려가지 않는다

    def test_stage_follows_the_date_without_checking_tasks(self):
        self.plant('seedling')
        shown = lambda: self.load()['state']['farms'][0]['plots'][0]['stage']
        self.assertEqual(shown(), 3)
        self.goto(6)
        self.assertEqual(shown(), 3)
        self.goto(7)  # 지지대 세우기가 시작되는 날 = 4단계
        self.assertEqual(shown(), 4)
        self.goto(24)
        self.assertEqual(shown(), 4)
        self.goto(25)  # 첫 웃거름이 시작되는 날 = 5단계
        self.assertEqual(shown(), 5)
        self.assertEqual(self.stage(), 3)  # 할 일을 체크하지 않았으니 저장된 단계는 그대로다

    def test_direct_sow_crop_has_no_pot_and_grows_by_date_from_sowing(self):
        carrot = run_returning("INSERT INTO crops (name, allow_seed, allow_seedling) VALUES ('당근(봄)', :t, :f) RETURNING id", t=True, f=False)

        def cleanup():
            run('DELETE FROM plantings WHERE crop_id = :c', c=carrot)
            run('DELETE FROM crop_stages WHERE crop_id = :c', c=carrot)
            run('DELETE FROM crops WHERE id = :c', c=carrot)
        self.addCleanup(cleanup)
        ids = {}
        for key, title, start, plant_task in (('sow', '씨앗 뿌리기', 0, True), ('thin', '솎아내기 (1차)', 30, False),
                                              ('feed', '웃거름 주기 (2차)', 40, False), ('pull', '당근 뽑기', 120, False)):
            ids[key] = run_returning("INSERT INTO crop_tasks (crop_id, title, anchor, start_day, plant_task) VALUES (:c, :t, 'sow', :s, :p) RETURNING id",
                                     c=carrot, t=title, s=start, p=plant_task)
        for no, trigger, start in ((1, None, None), (2, None, 5), (3, ids['thin'], None), (4, ids['feed'], None), (5, ids['pull'], None)):
            run('INSERT INTO crop_stages (crop_id, stage_no, name, start_day, trigger_task_id) VALUES (:c, :n, :m, :s, :t)',
                c=carrot, n=no, m=str(no), s=start, t=trigger)
        doc = lambda method: {'kind': f'crop-{carrot}', 'stage': 1, 'needsWater': False, 'plantedAt': DAY0.date().isoformat(), 'method': method}
        self.save(farm([doc('seedling')] + [None] * 5), expect=422)  # 직파 작물은 모종으로 심을 수 없다
        self.save(farm([doc('seed')] + [None] * 5))
        shown = lambda: self.load()['state']['farms'][0]['plots'][0]['stage']
        self.assertEqual(shown(), 1)  # 옮겨심기가 없으니 포트(0단계)로 보이지 않는다
        for day, expected in ((4, 1), (5, 2), (29, 2), (30, 3), (39, 3), (40, 4), (119, 4), (120, 5)):
            self.goto(day)
            self.assertEqual(shown(), expected, f'{day}일째')

    def test_screen_cannot_set_the_stage_of_a_task_crop(self):
        self.plant('seedling')
        self.save(farm([cucumber('seedling', stage=5)] + [None] * 5))
        self.assertEqual(self.stage(), 3)

    def test_harvest_is_recorded_with_the_journal_and_bonus_is_given_once(self):
        self.plant('seedling')
        first = self.complete(content='수확했어요', harvest=True)
        self.assertEqual((first['firstHarvest'], first['bonus'], first['earned'], first['state']['points']), (True, 120, 120, 130))
        plot = first['state']['farms'][0]['plots'][0]
        self.assertEqual(plot['harvestedAt'], DAY0.date().isoformat())  # 첫 수확일이 칸 정보로 내려간다
        self.assertEqual(plot['lastHarvestedAt'], DAY0.date().isoformat())
        self.assertEqual(self.stage(), 5)  # 수확하면 열매 단계(5)로 올라간다
        self.complete(content='같은 날 또 수확', harvest=True, expect=409)  # 수확은 하루에 한 번만 기록한다
        self.goto(1)
        second = self.complete(content='또 수확', harvest=True)
        self.assertEqual((second['firstHarvest'], second['state']['points']), (False, 130))
        self.assertEqual(rows('SELECT COUNT(*) AS n FROM harvests h JOIN plantings p ON p.id = h.planting_id WHERE p.user_id = :u', u=self.uid)[0]['n'], 2)
        self.assertEqual(rows("SELECT status FROM plantings WHERE user_id = :u", u=self.uid)[-1]['status'], 'harvested')
        # 수확 버튼만으로는 할 일이 완료되지 않는다
        self.assertEqual(len([r for r in self.logs() if r['completed_at']]), 1)  # 모종 옮겨심기만 심을 때 완료됐다
        # 수확한 뒤에도 할 일은 이어지고, 칸을 정리하면 끝난다
        self.goto(10)
        self.assertIn('물 주기', self.titles())
        self.save(farm())
        self.assertEqual(self.titles(), {})

    def test_complete_reports_the_level_before_and_after_the_points(self):
        self.plant('seed')  # 심을 때 5exp
        self.goto(3)
        small = self.complete('모종 물 주기')
        self.assertEqual(small['level'], {'exp': 8, 'before': 1, 'after': 1, 'leveledUp': False})
        self.goto(5)  # 다음 물 주기는 완료한 날 2일 뒤에 열린다
        more = self.complete('모종 물 주기')
        self.assertEqual(more['level'], {'exp': 11, 'before': 1, 'after': 1, 'leveledUp': False})

    def test_complete_reports_a_level_up(self):
        self.plant('seedling')  # 심을 때 10exp
        harvest = self.complete(content='수확했어요', harvest=True)  # +120 → 130exp, 1레벨에서 2레벨로
        self.assertEqual(harvest['level'], {'exp': 130, 'before': 1, 'after': 2, 'leveledUp': True})
        self.assertEqual(self.user()['exp'], 130)
        self.goto(1)
        again = self.complete(content='또 수확', harvest=True)  # 보너스는 첫 수확에만
        self.assertEqual(again['level'], {'exp': 130, 'before': 2, 'after': 2, 'leveledUp': False})

    def test_journal_without_text_gets_a_default_and_empty_request_is_rejected(self):
        self.plant('seedling')
        res = self.complete('심은 자리 물 주기', content='')
        self.assertIn('심은 자리 물 주기 완료', res['state']['records'][-1]['text'])
        empty = self.client.post('/garden/tasks/complete', headers=self.h, json={'planting_id': self.planting_id(), 'content': ' '})
        self.assertEqual(empty.status_code, 422)

    def test_tasks_tell_which_stage_they_raise(self):
        self.plant('seed')
        self.goto(29)
        self.assertEqual(self.titles()['모종 옮겨심기']['triggersStage'], 3)
        self.assertIsNone(self.titles()['석회·퇴비 섞기']['triggersStage'])

    def test_dev_day_tool_is_only_for_dev_accounts(self):
        import tasks
        self.addCleanup(lambda: setattr(tasks, '_day_offset', 0))
        # 일반 계정: 패널이 꺼져 있고(enabled false) 날짜를 옮길 수 없다
        self.assertFalse(self.client.get('/garden/dev/day', headers=self.h).json()['enabled'])
        self.assertEqual(self.client.post('/garden/dev/day', headers=self.h, json={'offset': 5}).status_code, 403)
        self.assertEqual(tasks._day_offset, 0)
        # 개발용 계정(users.is_dev)만 켜지고 옮길 수 있다
        run('UPDATE users SET is_dev = :d WHERE id = :u', d=True, u=self.uid)
        self.assertTrue(self.client.get('/garden/dev/day', headers=self.h).json()['enabled'])
        self.assertEqual(self.client.post('/garden/dev/day', headers=self.h, json={'offset': 5}).status_code, 200)

    def test_dev_day_tool_moves_the_server_clock(self):
        import tasks
        self.addCleanup(lambda: setattr(tasks, '_day_offset', 0))
        run('UPDATE users SET is_dev = :d WHERE id = :u', d=True, u=self.uid)
        res = self.client.post('/garden/dev/day', headers=self.h, json={'offset': 5})
        self.assertEqual((res.status_code, res.json()['offset']), (200, 5))
        self.assertEqual(self.client.get('/garden/dev/day', headers=self.h).json()['offset'], 5)
        self.assertEqual(self.client.post('/garden/dev/day', headers=self.h, json={'offset': -1}).status_code, 422)
        patch.stopall()  # setUp에서 고정한 시계를 풀고 진짜 now_kst를 확인한다
        shifted = tasks.now_kst()
        tasks._day_offset = 0
        self.assertAlmostEqual((shifted - tasks.now_kst()).total_seconds(), 5 * 86400, delta=5)

    def test_photos_ride_along_with_the_journal(self):
        self.plant('seedling')
        photo = 'data:image/jpeg;base64,/9j/2Q=='
        res = self.client.post('/garden/tasks/complete', headers=self.h, json={
            'planting_id': self.planting_id(), 'content': '사진 일지', 'photos': [photo]})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state']['records'][-1]['photos'], [photo])
        bad = self.client.post('/garden/tasks/complete', headers=self.h, json={
            'planting_id': self.planting_id(), 'content': '사진 일지', 'photos': ['http://x/y.png']})
        self.assertEqual(bad.status_code, 422)

    def test_crops_list_tells_which_crops_have_tasks_and_prep_notes(self):
        crops = {c['kind']: c for c in self.client.get('/garden/crops', headers=self.h).json()['crops']}
        self.assertEqual(len(crops), 7)
        self.assertTrue(crops['cucumber_spring']['hasTasks'])
        self.assertEqual([x['title'] for x in crops['cucumber_spring']['prep']], ['석회·퇴비 섞기'])
        self.assertEqual(crops['cucumber_spring']['transplant']['title'], '모종 옮겨심기')  # 모종으로 시작할 때 '심었어요'가 곧 이 작업
        self.assertEqual((crops['cucumber_spring']['plant']['title'], crops['cucumber_spring']['plant']['points']), ('씨앗 심기', 5))
        self.assertIsNone(crops['lettuce']['plant'])
        self.assertFalse(crops['lettuce']['hasTasks'])
        self.assertEqual(crops['lettuce']['prep'], [])

    def test_complete_rejects_bad_requests(self):
        self.plant('seed')
        ids = [t['id'] for t in self.client.get('/garden/tasks', headers=self.h).json()['tasks']]
        pid = self.planting_id()
        post = lambda body, headers=None: self.client.post('/garden/tasks/complete', headers=headers or self.h, json={'planting_id': pid, **body})
        self.assertEqual(post({'task_log_ids': [999999], 'content': '일지'}).status_code, 404)
        self.assertEqual(post({'planting_id': 999999, 'content': '일지'}).status_code, 404)
        future = self.logs('transplant')[0]['id']
        self.assertEqual(post({'task_log_ids': [future], 'content': '일지'}).status_code, 409)  # 아직 시작 전
        other = self.client.post('/auth/guest', json={}).json()
        self.assertEqual(post({'task_log_ids': ids, 'content': '일지'}, {'Authorization': 'Bearer ' + other['access_token']}).status_code, 404)
        self.assertEqual(post({'task_log_ids': ids, 'content': '일지'}).status_code, 200)
        self.assertEqual(post({'task_log_ids': ids, 'content': '일지'}).status_code, 409)  # 이미 완료
        self.assertEqual(self.client.get('/garden/tasks').status_code, 401)


if __name__ == '__main__':
    unittest.main()
