"""Integration checks use a temporary SQLite database, never the uploaded .env DB."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_temp = tempfile.TemporaryDirectory()
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(_temp.name) / 'garden.db')
os.environ['JWT_SECRET'] = 'integration-tests-only-32-character-secret'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from sqlalchemy import text
from main import app, engine


def rows(sql, **params):
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings()]


def farm(farm_id='garden-1', name='우리 농장', plots=None, **extra):
    return {'id': farm_id, 'name': name, 'region': '경기 양평군',
            'plots': plots if plots is not None else [None] * 6, **extra}


def plant(kind='lettuce', stage=2, **extra):
    return {'kind': kind, 'stage': stage, 'needsWater': False, 'plantedAt': '2026-10-13',
            'wateredAt': '2026-10-13', **extra}


def record(text_, crop='상추', farm_name='우리 농장'):
    return {'farm': farm_name, 'crop': crop, 'text': text_, 'date': '2026. 10. 13.'}


class GardenIntegrationTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def guest(self):
        data = self.client.post('/auth/guest', json={}).json()
        return data, {'Authorization': 'Bearer ' + data['access_token']}

    def load(self, headers):
        return self.client.get('/garden/state', headers=headers).json()

    def save(self, headers, revision, state, expect=200):
        state = {'settings': {'motion': True}, **state}
        res = self.client.put('/garden/state', headers=headers, json={'revision': revision, 'state': state})
        self.assertEqual(res.status_code, expect, res.text)
        return res.json()

    def test_z_care_photos_and_harvest_survive_reload(self):
        _, headers = self.guest()
        photo = 'data:image/jpeg;base64,/9j/2Q=='
        crop_doc = plant(stage=5, method='seedling', taskChecks={'2026-10-14': ['care']},
                         draftMemo='잎 관찰', draftPhotos=[photo], harvestedAt='2026-10-14')
        journal = {**record('사진 일지'), 'photos': [photo]}
        state = {'farms': [farm(plots=[crop_doc] + [None] * 5)], 'records': [journal]}
        revision = self.save(headers, self.load(headers)['revision'], state)['revision']
        loaded = self.load(headers)
        self.assertEqual(loaded['revision'], revision)
        actual = loaded['state']['farms'][0]['plots'][0]
        for key in ('method', 'taskChecks', 'draftMemo', 'draftPhotos', 'harvestedAt'):
            self.assertEqual(actual[key], crop_doc[key])
        self.assertEqual(loaded['state']['records'][0]['photos'], [photo])
        self.save(headers, revision, loaded['state'])
        self.assertEqual(len(self.load(headers)['state']['records']), 1)
        self.assertEqual(self.load(self.guest()[1])['state']['records'], [])

    def set_allow(self, name, seed=True, seedling=True):
        with engine.begin() as conn:
            conn.execute(text('UPDATE crops SET allow_seed = :a, allow_seedling = :b WHERE name = :n'), {'a': seed, 'b': seedling, 'n': name})

    def test_planting_method_must_be_allowed_by_the_crop(self):
        _, headers = self.guest()
        self.save(headers, self.load(headers)['revision'], {'farms': [farm(plots=[plant('lettuce', method='seed')] + [None] * 5)], 'records': []})
        self.addCleanup(self.set_allow, '상추')
        self.addCleanup(self.set_allow, '고추')
        self.set_allow('상추', seedling=False)  # 직파 작물
        self.set_allow('고추', seed=False)  # 모종만 가능한 작물
        revision = self.load(headers)['revision']
        one = lambda *plots: {'farms': [farm(plots=list(plots) + [None] * (6 - len(plots)))], 'records': []}
        # 새로 심을 때
        self.save(headers, revision, one(plant('pepper', method='seed')), expect=422)
        self.save(headers, revision, one(plant('pepper')), expect=422)  # 방식을 안 보내면 씨앗으로 본다
        revision = self.save(headers, revision, one(plant('pepper', method='seedling')))['revision']
        # 이미 심은 작물의 방식을 허용되지 않는 쪽으로 바꾸는 저장도 거부한다
        self.save(headers, revision, one(plant('pepper', method='seed')), expect=422)
        crops = {c['kind']: c for c in self.client.get('/garden/crops', headers=headers).json()['crops']}
        self.assertEqual((crops['lettuce']['allowSeed'], crops['lettuce']['allowSeedling']), (True, False))
        self.assertEqual((crops['pepper']['allowSeed'], crops['pepper']['allowSeedling']), (False, True))
        self.assertEqual((crops['tomato']['allowSeed'], crops['tomato']['allowSeedling']), (True, True))

    def test_crops_outside_the_first_seven_are_listed_and_plantable(self):
        _, headers = self.guest()
        self.save(headers, self.load(headers)['revision'], {'farms': [farm()], 'records': []})  # 처음 7종 행을 만든다
        with engine.begin() as conn:
            carrot = conn.execute(text("INSERT INTO crops (name, allow_seed, allow_seedling) VALUES ('당근(봄)', :t, :f) RETURNING id"),
                                  {'t': True, 'f': False}).scalar()
            conn.execute(text("INSERT INTO crop_tasks (crop_id, title, anchor, start_day) VALUES (:c, '솎아내기', 'sow', 30)"), {'c': carrot})
            conn.execute(text("INSERT INTO crops (name) VALUES ('감자')"))  # 할 일이 없는 옛 작물은 보이지 않는다

        def cleanup():
            with engine.begin() as conn:
                conn.execute(text('DELETE FROM plantings WHERE crop_id IN (SELECT id FROM crops WHERE name IN (:a, :b))'), {'a': '당근(봄)', 'b': '감자'})
                conn.execute(text('DELETE FROM crops WHERE name IN (:a, :b)'), {'a': '당근(봄)', 'b': '감자'})
        self.addCleanup(cleanup)
        listed = self.client.get('/garden/crops', headers=headers).json()['crops']
        self.assertEqual([c['name'] for c in listed if c['kind'] == f'crop-{carrot}'], ['당근(봄)'])
        self.assertNotIn('감자', [c['name'] for c in listed])
        item = next(c for c in listed if c['kind'] == f'crop-{carrot}')
        self.assertEqual((item['allowSeed'], item['allowSeedling'], item['hasTasks'], item['hasTransplant']), (True, False, True, False))
        kind = f'crop-{carrot}'
        revision = self.load(headers)['revision']
        one = lambda **extra: {'farms': [farm(plots=[plant(kind, stage=1, **extra)] + [None] * 5)], 'records': []}
        self.save(headers, revision, one(method='seedling'), expect=422)  # 모종은 허용되지 않는다
        self.save(headers, revision, {'farms': [farm(plots=[plant('crop-999999', method='seed')] + [None] * 5)], 'records': []}, expect=422)
        self.save(headers, revision, {'farms': [farm(plots=[plant('carrot', method='seed')] + [None] * 5)], 'records': []}, expect=422)
        self.save(headers, revision, one(method='seed'))
        self.assertEqual(self.load(headers)['state']['farms'][0]['plots'][0]['kind'], kind)

    def test_requires_login(self):
        self.assertEqual(self.client.get('/garden/state').status_code, 401)

    def test_new_user_starts_empty_and_data_lands_in_design_tables(self):
        a, ah = self.guest()
        initial = self.load(ah)
        self.assertEqual(initial['state']['farms'], [])
        self.assertEqual(initial['state']['records'], [])

        state = {'farms': [farm(plots=[plant()] + [None] * 5)], 'records': [record('물을 주었어요. 💧')], 'points': 999999}
        revision = self.save(ah, initial['revision'], state)['revision']

        # 공통 설계 테이블에 나뉘어 저장된다
        uid = a and rows('SELECT id FROM users WHERE guest_token = :t', t=a['guest_token'])[0]['id']
        self.assertEqual(len(rows('SELECT * FROM farms WHERE user_id = :u', u=uid)), 1)
        self.assertEqual(len(rows('SELECT p.* FROM plots p JOIN farms f ON f.id = p.farm_id WHERE f.user_id = :u', u=uid)), 6)
        planting = rows('SELECT pl.*, c.name AS crop FROM plantings pl JOIN crops c ON c.id = pl.crop_id WHERE pl.user_id = :u', u=uid)
        self.assertEqual((len(planting), planting[0]['status'], planting[0]['crop']), (1, 'growing', '상추'))
        journal = rows('SELECT * FROM journals WHERE user_id = :u', u=uid)
        self.assertEqual((len(journal), journal[0]['planting_id']), (1, planting[0]['id']))
        self.assertEqual(len(rows('SELECT * FROM crop_stages WHERE crop_id = (SELECT id FROM crops WHERE name = :n)', n='상추')), 5)

        loaded = self.load(ah)
        self.assertEqual(loaded['revision'], revision)
        self.assertEqual(loaded['state']['farms'][0]['name'], '우리 농장')
        self.assertEqual(loaded['state']['farms'][0]['plots'][0]['kind'], 'lettuce')
        self.assertEqual(loaded['state']['farms'][0]['plots'][0]['stage'], 2)
        self.assertEqual(loaded['state']['records'][0]['text'], '물을 주었어요. 💧')
        self.assertEqual(loaded['state']['points'], 0)  # 서버의 포인트는 화면이 위조할 수 없다

    def test_users_are_isolated_and_summary_counts_tables(self):
        _, ah = self.guest()
        _, bh = self.guest()
        state = {'farms': [farm(plots=[plant()] + [None] * 5)], 'records': [record('메모')]}
        self.save(ah, self.load(ah)['revision'], state)
        self.assertEqual(self.load(bh)['state']['farms'], [])
        summary = self.client.get('/me/summary', headers=ah).json()
        self.assertEqual((summary['farms'], summary['growing_crops'], summary['journals']), (1, 1, 1))
        self.assertEqual(self.client.get('/me/summary', headers=bh).json()['farms'], 0)

    def test_stale_revision_and_invalid_data_are_rejected(self):
        _, ah = self.guest()
        first = self.load(ah)['revision']
        self.save(ah, first, {'farms': [farm()], 'records': []})
        self.save(ah, first, {'farms': [farm()], 'records': []}, expect=409)  # 오래된 revision
        current = self.load(ah)['revision']
        self.save(ah, current, {'farms': [farm(plots=[plant(stage=8)] + [None] * 5)], 'records': []}, expect=422)

    def test_harvest_keeps_the_planting_and_journal_and_replant_works(self):
        _, ah = self.guest()
        rev = self.load(ah)['revision']
        rev = self.save(ah, rev, {'farms': [farm(plots=[plant()] + [None] * 5)], 'records': []})['revision']
        # 수확: 수확 버튼(harvests 행) 뒤 칸을 비우고 기록을 남긴다 → 재배 줄은 지우지 않고 ended
        planting_id = rows("SELECT id FROM plantings WHERE status = 'growing'")[0]['id']
        done = self.client.post('/garden/tasks/complete', headers=ah, json={'planting_id': planting_id, 'harvest': True, 'content': '수확을 마쳤어요! 🧺'})
        self.assertEqual(done.status_code, 200, done.text)
        rev = done.json()['revision']  # 일지가 서버에서 생겼으니 새 revision으로 이어 간다
        rev = self.save(ah, rev, {'farms': [farm()], 'records': [record('수확을 마쳤어요! 🧺')]})['revision']
        plantings = rows('SELECT status FROM plantings')
        self.assertEqual([p['status'] for p in plantings][-1], 'ended')
        self.assertEqual(self.client.get('/me/summary', headers=ah).json()['harvested'], 1)
        self.assertEqual(self.client.get('/me/summary', headers=ah).json()['growing_crops'], 0)
        journal = rows("SELECT planting_id FROM journals WHERE content LIKE '%수확%'")[0]
        self.assertIsNotNone(journal['planting_id'])  # 끝난 재배에도 연결된다
        # 같은 칸에 다른 작물을 다시 심는다 (칸당 진행 중인 재배는 하나)
        self.save(ah, rev, {'farms': [farm(plots=[plant('tomato', 1)] + [None] * 5)], 'records': [record('수확을 마쳤어요! 🧺')]})
        active = rows("SELECT COUNT(*) AS n FROM plantings WHERE status <> 'ended'")[0]['n']
        self.assertGreaterEqual(active, 1)
        self.assertEqual(self.load(ah)['state']['farms'][0]['plots'][0]['kind'], 'tomato')

    def test_farm_delete_ends_plantings_but_keeps_journals(self):
        _, ah = self.guest()
        rev = self.load(ah)['revision']
        rev = self.save(ah, rev, {'farms': [farm(plots=[plant()] + [None] * 5), farm('garden-2', '두번째')],
                                  'records': [record('첫 기록')]})['revision']
        self.save(ah, rev, {'farms': [farm('garden-2', '두번째')], 'records': [record('첫 기록')]})
        state = self.load(ah)['state']
        self.assertEqual([f['name'] for f in state['farms']], ['두번째'])
        self.assertEqual(len(state['records']), 1)  # 일지는 남는다
        self.assertEqual(self.client.get('/me/summary', headers=ah).json()['growing_crops'], 0)
        self.assertEqual(rows("SELECT COUNT(*) AS n FROM plantings WHERE status <> 'ended'")[0]['n'], 0)

    def test_weather_location_and_motion_setting_round_trip(self):
        _, ah = self.guest()
        place = {'latitude': 37.49, 'longitude': 127.49, 'label': '양평'}
        rev = self.load(ah)['revision']
        state = {'farms': [farm(weatherLocation=place)], 'records': [], 'settings': {'motion': False}}
        res = self.client.put('/garden/state', headers=ah, json={'revision': rev, 'state': state})
        self.assertEqual(res.status_code, 200, res.text)
        loaded = self.load(ah)['state']
        self.assertEqual(loaded['farms'][0]['weatherLocation'], place)
        self.assertFalse(loaded['settings']['motion'])

    def test_records_append_without_rewriting_existing_journals(self):
        a, ah = self.guest()
        uid = rows('SELECT id FROM users WHERE guest_token = :t', t=a['guest_token'])[0]['id']
        rev = self.load(ah)['revision']
        rev = self.save(ah, rev, {'farms': [farm()], 'records': [record('하나')]})['revision']
        first_id = rows('SELECT id FROM journals WHERE user_id = :u', u=uid)[0]['id']
        self.save(ah, rev, {'farms': [farm()], 'records': [record('하나'), record('둘')]})
        ids = [r['id'] for r in rows('SELECT id FROM journals WHERE user_id = :u ORDER BY id', u=uid)]
        self.assertEqual(ids[0], first_id)  # 기존 일지는 그대로
        self.assertEqual(len(ids), 2)

    def test_kakao_link_choice_moves_or_deletes_design_tables(self):
        a, ah = self.guest()
        state = {'farms': [farm(plots=[plant()] + [None] * 5)], 'records': [record('게스트 기록')]}
        self.save(ah, self.load(ah)['revision'], state)
        with patch('main.fetch_kakao_profile', return_value={'kakao_id': 'test-kakao', 'nickname': '테스트'}):
            kakao = self.client.post('/auth/kakao', json={'code': 'test'}).json()
            kh = {'Authorization': 'Bearer ' + kakao['access_token']}
            # 카카오 쪽에 기록이 없으면 선택 없이 바로 옮겨진다
            linked = self.client.post('/auth/link-kakao', headers=ah, json={'code': 'test'})
            self.assertEqual(linked.status_code, 200, linked.text)
            self.assertEqual(linked.json()['status'], 'linked')
            newh = {'Authorization': 'Bearer ' + linked.json()['access_token']}
            moved = self.load(newh)['state']
            self.assertEqual((len(moved['farms']), len(moved['records'])), (1, 1))
            self.assertEqual(self.client.get('/garden/state', headers=ah).status_code, 401)  # 비회원 계정은 삭제됨

            # 이번엔 양쪽에 기록이 있는 경우: choice 없이 부르면 요약만, kakao를 고르면 카카오 기록이 남는다
            b, bh = self.guest()
            self.save(bh, self.load(bh)['revision'], {'farms': [farm('g-b', '다른 농장')], 'records': []})
            asked = self.client.post('/auth/link-kakao', headers=bh, json={'code': 'test'})
            self.assertEqual(asked.json()['status'], 'choice_required')
            self.assertEqual((asked.json()['guest']['farms'], asked.json()['kakao']['farms']), (1, 1))
            done = self.client.post('/auth/link-kakao', headers=bh, json={'link_ticket': asked.json()['link_ticket'], 'choice': 'kakao'})
            self.assertEqual(done.status_code, 200, done.text)
            kept = self.load({'Authorization': 'Bearer ' + done.json()['access_token']})['state']
            self.assertEqual([f['name'] for f in kept['farms']], ['우리 농장'])  # 카카오 기록 유지
            self.assertEqual(rows("SELECT COUNT(*) AS n FROM farms WHERE name = '다른 농장'")[0]['n'], 0)  # 비회원 기록 삭제


if __name__ == '__main__':
    unittest.main()


def tearDownModule():
    engine.dispose()
    _temp.cleanup()
