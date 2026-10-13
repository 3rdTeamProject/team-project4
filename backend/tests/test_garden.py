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
from main import app

class GardenIntegrationTest(unittest.TestCase):
    def test_saved_garden_user_isolation_validation_summary_and_account_link(self):
        with TestClient(app) as client:
            def guest():
                data = client.post('/auth/guest', json={}).json()
                return data, {'Authorization': 'Bearer ' + data['access_token']}
            a, ah = guest()
            b, bh = guest()
            self.assertEqual(client.get('/garden/state').status_code, 401)
            initial = client.get('/garden/state', headers=ah).json()
            self.assertEqual(initial['state']['farms'], [])
            self.assertEqual(initial['revision'], 0)
            state = {
                'farms': [{'id': 'garden-1', 'name': '우리 농장', 'region': '경기 양평군',
                           'plots': [{'kind': 'lettuce', 'stage': 2, 'needsWater': False,
                                      'plantedAt': '2026-10-13', 'wateredAt': '2026-10-13'}] + [None] * 5}],
                'records': [{'farm': '우리 농장', 'crop': '상추', 'text': '물을 주었어요. 💧', 'date': '2026. 10. 13.'}],
                'settings': {'motion': True}, 'points': 999999,
            }
            saved = client.put('/garden/state', headers=ah, json={'revision': 0, 'state': state})
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(saved.json()['revision'], 1)
            loaded = client.get('/garden/state', headers=ah).json()
            self.assertEqual(loaded['state']['farms'][0]['name'], '우리 농장')
            self.assertEqual(loaded['state']['points'], 0)  # server balance cannot be forged
            self.assertEqual(client.get('/garden/state', headers=bh).json()['state']['farms'], [])
            summary = client.get('/me/summary', headers=ah).json()
            self.assertEqual((summary['farms'], summary['growing_crops'], summary['journals']), (1, 1, 1))
            self.assertEqual(client.put('/garden/state', headers=ah, json={'revision': 0, 'state': state}).status_code, 409)
            state['farms'][0]['plots'][0]['stage'] = 8
            self.assertEqual(client.put('/garden/state', headers=ah, json={'revision': 1, 'state': state}).status_code, 422)
            state['farms'][0]['plots'][0]['stage'] = 4
            state['farms'][0]['plots'][0] = None
            state['records'].append({'farm': '우리 농장', 'crop': '상추', 'text': '수확을 마쳤어요! 🧺', 'date': '2026. 10. 13.'})
            self.assertEqual(client.put('/garden/state', headers=ah, json={'revision': 1, 'state': state}).status_code, 200)
            summary = client.get('/me/summary', headers=ah).json()
            self.assertEqual((summary['growing_crops'], summary['harvested']), (0, 1))
            # Existing Kakao identity: choice flow must transfer this new table, too.
            with patch('main.fetch_kakao_profile', return_value={'kakao_id': 'test-kakao', 'nickname': '테스트'}):
                kakao = client.post('/auth/kakao', json={'code': 'test'}).json()
                kh = {'Authorization': 'Bearer ' + kakao['access_token']}
                client.get('/garden/state', headers=kh)
                linked = client.post('/auth/link-kakao', headers=ah, json={'code': 'test', 'choice': 'guest'})
                self.assertEqual(linked.status_code, 200, linked.text)
                newh = {'Authorization': 'Bearer ' + linked.json()['access_token']}
                self.assertEqual(len(client.get('/garden/state', headers=newh).json()['state']['farms']), 1)
                self.assertEqual(client.get('/garden/state', headers=ah).status_code, 401)
            self.assertEqual(client.get('/garden/state', headers=bh).json()['state']['farms'], [])

if __name__ == '__main__':
    unittest.main()
