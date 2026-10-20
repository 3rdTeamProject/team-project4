"""Diagnosis quota tests use an isolated temporary SQLite database."""
import os
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

_temp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_temp.name) / "diagnosis.db")
os.environ["JWT_SECRET"] = "diagnosis-tests-only-32-character-secret"
os.environ["APP_ENV"] = "test"
os.environ["DIAGNOSIS_TEST_MODE"] = "true"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import text
from diagnosis import now_kst
from main import JWT_ALGORITHM, JWT_SECRET, app, engine
import jwt

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


class DiagnosisQuotaTest(unittest.TestCase):
    def setUp(self):
        self.context = TestClient(app)
        self.client = self.context.__enter__()
        app.state.diagnosis_service.calls = 0  # 서비스는 앱 단위라 앞선 테스트의 호출 횟수가 남지 않게 한다

    def tearDown(self):
        self.context.__exit__(None, None, None)

    def create_growing_plant(self):
        login = self.client.post("/auth/guest", json={}).json()
        headers = {"Authorization": "Bearer " + login["access_token"]}
        state = self.client.get("/garden/state", headers=headers).json()
        result = self.client.put(
            "/garden/state",
            headers=headers,
            json={
                "revision": state["revision"],
                "state": {
                    "farms": [{
                        "id": "farm-client-id",
                        "name": "내 농장",
                        "region": "경기",
                        "plots": [{
                            "kind": "lettuce",
                            "stage": 1,
                            "plantedAt": "2026-10-01",
                        }] + [None] * 5,
                    }],
                    "records": [],
                    "settings": {"motion": True},
                },
            },
        )
        self.assertEqual(result.status_code, 200, result.text)
        user_id = int(jwt.decode(login["access_token"], JWT_SECRET, algorithms=[JWT_ALGORITHM])["sub"])
        with engine.connect() as conn:
            planting_id = conn.execute(
                text("SELECT id FROM plantings WHERE user_id = :user_id AND status = 'growing'"),
                {"user_id": user_id},
            ).scalar_one()
        return headers, planting_id

    def post_diagnosis(self, headers, planting_id, key, outcome="diagnosed", photos=None):
        files = {"close_photo": ("close.png", PNG, "image/png")}
        if photos:
            files = photos
        data = {
            "planting_id": str(planting_id),
            "symptoms": "잎 변색",
            "description": "잎에 변화가 보여요.",
            "test_outcome": outcome,
        }
        return self.client.post(
            "/diagnoses",
            headers={**headers, "Idempotency-Key": key},
            data=data,
            files=files,
        )

    def quota(self, headers):
        response = self.client.get("/diagnoses/quota", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_daily_quota_consumption_and_fourth_request_rejection(self):
        headers, planting_id = self.create_growing_plant()
        self.assertEqual(self.quota(headers)["remaining_count"], 3)
        for index in range(3):
            response = self.post_diagnosis(headers, planting_id, f"daily-use-{index:02d}")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()["is_demo"])
        self.assertEqual(self.quota(headers)["remaining_count"], 0)

        service_calls = app.state.diagnosis_service.calls
        limited = self.post_diagnosis(headers, planting_id, "daily-use-04")
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json()["status"], "limit_exceeded")
        self.assertEqual(app.state.diagnosis_service.calls, service_calls)

    def test_quota_resets_at_korean_midnight(self):
        headers, planting_id = self.create_growing_plant()
        prior_day = datetime(2026, 10, 16, 23, 59, tzinfo=now_kst().tzinfo)
        with patch("diagnosis.now_kst", return_value=prior_day):
            for index in range(3):
                response = self.post_diagnosis(headers, planting_id, f"before-midnight-{index:02d}")
                self.assertEqual(response.status_code, 200, response.text)

        after_midnight = datetime(2026, 10, 17, 0, 0, tzinfo=now_kst().tzinfo)
        with patch("diagnosis.now_kst", return_value=after_midnight):
            quota = self.quota(headers)
        self.assertEqual(quota["remaining_count"], 3)
        self.assertEqual(quota["reset_at"], "2026-10-18T00:00:00+09:00")

    def test_users_have_independent_quotas(self):
        first_headers, first_plant = self.create_growing_plant()
        second_headers, _ = self.create_growing_plant()
        for index in range(2):
            response = self.post_diagnosis(first_headers, first_plant, f"first-user-{index:02d}")
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.quota(first_headers)["remaining_count"], 1)
        self.assertEqual(self.quota(second_headers)["remaining_count"], 3)

    def test_idempotency_replays_completed_response_without_second_use(self):
        headers, planting_id = self.create_growing_plant()
        first = self.post_diagnosis(headers, planting_id, "same-request-0001")
        replay = self.post_diagnosis(headers, planting_id, "same-request-0001")
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(first.json()["request_id"], replay.json()["request_id"])
        self.assertTrue(replay.json()["replayed"])
        self.assertEqual(self.quota(headers)["used_count"], 1)

    def test_concurrent_requests_never_reserve_more_than_three(self):
        headers, planting_id = self.create_growing_plant()

        def submit(index):
            return self.post_diagnosis(headers, planting_id, f"parallel-request-{index:02d}")

        with ThreadPoolExecutor(max_workers=6) as executor:
            responses = list(executor.map(submit, range(6)))
        self.assertEqual(sum(response.status_code == 200 for response in responses), 3)
        self.assertEqual(sum(response.status_code == 429 for response in responses), 3)
        self.assertEqual(self.quota(headers)["used_count"], 3)

    def test_authentication_and_other_users_plant_are_rejected(self):
        owner_headers, planting_id = self.create_growing_plant()
        other_headers, _ = self.create_growing_plant()
        self.assertEqual(self.client.get("/diagnoses/quota").status_code, 401)
        denied = self.post_diagnosis(other_headers, planting_id, "other-users-plant")
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(self.quota(owner_headers)["used_count"], 0)

    def test_validation_failure_does_not_consume_quota(self):
        headers, planting_id = self.create_growing_plant()
        response = self.client.post(
            "/diagnoses",
            headers={**headers, "Idempotency-Key": "missing-photo-0001"},
            data={"planting_id": str(planting_id), "symptoms": "잎 변색"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.quota(headers)["used_count"], 0)

        invalid_image = self.post_diagnosis(
            headers,
            planting_id,
            "invalid-image-0001",
            photos={"close_photo": ("close.png", b"not an image", "image/png")},
        )
        self.assertEqual(invalid_image.status_code, 415)
        self.assertEqual(self.quota(headers)["used_count"], 0)

    def test_pre_analysis_error_releases_reservation(self):
        headers, planting_id = self.create_growing_plant()
        response = self.post_diagnosis(
            headers, planting_id, "before-analysis-001", "error_before_analysis"
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["status"], "failed_before_analysis")
        self.assertEqual(self.quota(headers)["used_count"], 0)
        request = self.client.get(response.json()["status_url"], headers=headers).json()
        self.assertFalse(request["quota_reserved"])
        self.assertFalse(request["quota_consumed"])

    def test_uncertain_is_consumed_and_server_error_stays_reserved(self):
        headers, planting_id = self.create_growing_plant()
        uncertain = self.post_diagnosis(headers, planting_id, "uncertain-case-01", "uncertain")
        self.assertEqual(uncertain.status_code, 200, uncertain.text)
        self.assertEqual(uncertain.json()["status"], "uncertain")
        self.assertTrue(uncertain.json()["is_demo"])
        self.assertEqual(self.quota(headers)["used_count"], 1)

        failed = self.post_diagnosis(
            headers, planting_id, "during-error-001", "error_during_analysis"
        )
        self.assertEqual(failed.status_code, 502)
        status = self.client.get(failed.json()["status_url"], headers=headers).json()
        self.assertEqual(status["status"], "unknown")
        self.assertTrue(status["quota_reserved"])
        self.assertFalse(status["quota_consumed"])
        quota = self.quota(headers)
        self.assertEqual(quota["used_count"], 2)
        self.assertEqual(quota["reserved_count"], 1)

        replay = self.post_diagnosis(
            headers, planting_id, "during-error-001", "error_during_analysis"
        )
        self.assertEqual(replay.status_code, 202)
        self.assertEqual(replay.json()["status"], "unknown")
        self.assertEqual(app.state.diagnosis_service.calls, 2)


if __name__ == "__main__":
    unittest.main()
