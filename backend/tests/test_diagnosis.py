"""Diagnosis API tests use a fresh SQLite database and mocked analysis service per test."""
import asyncio
import json
import os
import tempfile
import threading
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient, MockTransport, ReadTimeout, Request, Response
from openai import APIStatusError, AsyncOpenAI
from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    event,
    insert,
    select,
)
from sqlalchemy.pool import NullPool
from sqlalchemy.exc import SQLAlchemyError
from diagnosis import (
    DiagnosisAnalysis,
    DiagnosisServiceError,
    DevelopmentDiagnosisService,
    OpenAIDiagnosisService,
    now_kst,
    register_diagnoses,
)
from fastapi import FastAPI

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


class FakeDiagnosisService:
    is_demo = False

    def __init__(self):
        self.calls = 0
        self.failure = None
        self.lock = threading.Lock()

    def prepare(self):
        if self.failure == "prepare":
            self.failure = None
            raise DiagnosisServiceError("mock service is unavailable", analysis_started=False)
        return None

    async def analyze(self, crop_name, symptoms, description, photos, on_start):
        if self.failure == "before":
            self.failure = None
            raise DiagnosisServiceError("mock failure before analysis", analysis_started=False)
        await on_start()
        with self.lock:
            self.calls += 1
        if self.failure == "after":
            self.failure = None
            raise DiagnosisServiceError("mock response unavailable", analysis_started=True)
        if self.failure == "unexpected":
            self.failure = None
            raise RuntimeError("must not leak this provider exception")
        if self.failure == "uncertain":
            self.failure = None
            return {
                "status": "uncertain",
                "disease_name": None,
                "evidence": [],
                "management": [],
                "additional_checks": ["잎 뒷면의 흔적을 확인해 주세요."],
                "reason": "사진에서 판단 근거가 충분하지 않습니다.",
                "retake_guidance": ["증상 부위를 밝은 곳에서 가까이 촬영해 주세요."],
            }
        return {
            "status": "diagnosed",
            "disease_name": "의심 결과 예시",
            "evidence": ["업로드된 사진의 색 변화가 관찰됩니다."],
            "management": ["전문가 확인 전에는 방제제를 사용하지 마세요."],
            "additional_checks": ["잎 뒷면을 확인해 주세요."],
            "reason": None,
            "retake_guidance": [],
        }


class DiagnosisQuotaTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{Path(self.temp_dir.name) / 'diagnosis.db'}",
            connect_args={"check_same_thread": True, "timeout": 15},
            poolclass=NullPool,
        )
        self.metadata = MetaData()
        self.users = Table("users", self.metadata, Column("id", Integer, primary_key=True))
        self.farms = Table(
            "farms",
            self.metadata,
            Column("id", Integer, primary_key=True),
            Column("user_id", Integer, ForeignKey("users.id"), nullable=False),
            Column("client_id", String(64), nullable=False),
        )
        self.plots = Table(
            "plots",
            self.metadata,
            Column("id", Integer, primary_key=True),
            Column("farm_id", Integer, ForeignKey("farms.id"), nullable=False),
            Column("position", Integer, nullable=False),
        )
        self.crops = Table(
            "crops",
            self.metadata,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
        )
        self.plantings = Table(
            "plantings",
            self.metadata,
            Column("id", Integer, primary_key=True),
            Column("user_id", Integer, ForeignKey("users.id"), nullable=False),
            Column("plot_id", Integer, ForeignKey("plots.id")),
            Column("crop_id", Integer, ForeignKey("crops.id"), nullable=False),
            Column("status", String(16), nullable=False),
        )
        self.metadata.create_all(self.engine)

        self.analysis = FakeDiagnosisService()
        self.app = FastAPI()
        bearer = HTTPBearer()

        def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
            try:
                user_id = int(credentials.credentials)
            except ValueError as error:
                raise HTTPException(401, "invalid test token") from error
            with self.engine.connect() as conn:
                exists = conn.execute(select(self.users.c.id).where(self.users.c.id == user_id)).first()
            if exists is None:
                raise HTTPException(401, "missing test user")
            return {"id": user_id}

        with patch.dict(os.environ, {"APP_ENV": "test", "DIAGNOSIS_TEST_MODE": "true"}):
            self.requests = register_diagnoses(
                self.app,
                self.metadata,
                self.engine,
                current_user,
                self.users,
                self.plantings,
                self.crops,
                self.farms,
                self.plots,
                analysis_service=self.analysis,
                demo_service=DevelopmentDiagnosisService(),
            )
        self.metadata.create_all(self.engine)
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.engine.dispose()
        self.temp_dir.cleanup()

    def add_growing_plant(self, user_id=1, client_id="farm-client-id", position=1, state="growing"):
        with self.engine.begin() as conn:
            if conn.execute(select(self.users.c.id).where(self.users.c.id == user_id)).first() is None:
                conn.execute(insert(self.users).values(id=user_id))
            farm_id = conn.execute(
                insert(self.farms).values(user_id=user_id, client_id=client_id)
            ).inserted_primary_key[0]
            plot_id = conn.execute(
                insert(self.plots).values(farm_id=farm_id, position=position)
            ).inserted_primary_key[0]
            crop_id = conn.execute(
                insert(self.crops).values(name="상추")
            ).inserted_primary_key[0]
            planting_id = conn.execute(
                insert(self.plantings).values(
                    user_id=user_id,
                    plot_id=plot_id,
                    crop_id=crop_id,
                    status=state,
                )
            ).inserted_primary_key[0]
        return planting_id

    @staticmethod
    def headers(user_id=1):
        return {"Authorization": f"Bearer {user_id}"}

    def post_diagnosis(
        self,
        key,
        user_id=1,
        farm_client_id="farm-client-id",
        plot_number=1,
        outcome="diagnosed",
        path="/diagnoses",
        photos=None,
        symptoms="잎 변색",
    ):
        files = {"close_photo": ("close.png", PNG, "image/png")}
        if photos is not None:
            files = photos
        data = {
            "farm_client_id": farm_client_id,
            "plot_number": str(plot_number),
            "symptoms": symptoms,
            "description": "잎에 변화가 보여요.",
        }
        if path.endswith("/demo"):
            data["test_outcome"] = outcome
        return self.client.post(
            path,
            headers={**self.headers(user_id), "Idempotency-Key": key},
            data=data,
            files=files,
        )

    def quota(self, user_id=1):
        response = self.client.get("/diagnoses/quota", headers=self.headers(user_id))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_read_only_key_lookup_recovers_saved_result_without_analysis_or_quota_change(self):
        self.add_growing_plant()
        result = self.post_diagnosis("lost-response-key").json()
        before = self.quota()
        for _ in range(2):
            response = self.client.get("/diagnoses/requests/by-idempotency-key", headers={
                **self.headers(), "Idempotency-Key": "lost-response-key",
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["request_id"], result["request_id"])
            self.assertEqual(response.json()["status"], "completed")
            self.assertEqual(response.json()["result"]["status"], "diagnosed")
        self.assertEqual(self.analysis.calls, 1)
        self.assertEqual(self.quota(), before)

    def test_key_lookup_is_owned_validated_and_never_creates_a_request(self):
        self.add_growing_plant()
        self.add_growing_plant(user_id=2)
        self.post_diagnosis("private-lookup-key")
        for key, user_id, expected in [
            ("private-lookup-key", 2, 404), ("not-submitted-key", 1, 404), ("bad", 1, 422),
        ]:
            response = self.client.get("/diagnoses/requests/by-idempotency-key", headers={
                **self.headers(user_id), "Idempotency-Key": key,
            })
            self.assertEqual(response.status_code, expected, response.text)
        self.assertEqual(self.analysis.calls, 1)
        self.assertEqual(self.quota()["used_count"], 1)

    def test_key_lookup_returns_pending_unknown_and_preanalysis_failure_without_reexecution(self):
        self.add_growing_plant()
        result = self.post_diagnosis("lookup-states-key").json()
        for status in ["reserved", "processing", "unknown", "failed_before_analysis"]:
            with self.engine.begin() as conn:
                conn.execute(self.requests.update().where(
                    self.requests.c.request_id == result["request_id"]
                ).values(status=status))
            response = self.client.get("/diagnoses/requests/by-idempotency-key", headers={
                **self.headers(), "Idempotency-Key": "lookup-states-key",
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["status"], status)
        self.assertEqual(self.analysis.calls, 1)

    def test_key_lookup_while_initial_post_is_waiting_never_restarts_analysis(self):
        self.add_growing_plant()
        original = self.analysis.analyze

        async def exercise():
            started, finish = asyncio.Event(), asyncio.Event()

            async def delayed(crop, symptoms, description, photos, on_start):
                async def notify():
                    await on_start()
                    started.set()
                    await finish.wait()
                return await original(crop, symptoms, description, photos, notify)

            async with AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test") as client:
                with patch.object(self.analysis, "analyze", side_effect=delayed):
                    headers = {**self.headers(), "Idempotency-Key": "waiting-post-key"}
                    pending = asyncio.create_task(client.post("/diagnoses", headers=headers,
                        data={"farm_client_id": "farm-client-id", "plot_number": "1", "symptoms": "잎 변색"},
                        files={"close_photo": ("close.png", PNG, "image/png")}))
                    try:
                        await asyncio.wait_for(started.wait(), 5)
                        for _ in range(2):
                            response = await asyncio.wait_for(client.get(
                                "/diagnoses/requests/by-idempotency-key", headers=headers), 5)
                            self.assertEqual(response.status_code, 200, response.text)
                            self.assertEqual(response.json()["status"], "processing")
                            self.assertFalse(pending.done())
                    finally:
                        finish.set()
                        completed = await asyncio.wait_for(pending, 5)
                    recovered = await client.get("/diagnoses/requests/by-idempotency-key", headers=headers)
                    self.assertEqual(recovered.json()["result"], {
                        k: v for k, v in completed.json().items()
                        if k not in ("request_id", "quota")
                    })

        asyncio.run(exercise())
        self.assertEqual(self.analysis.calls, 1)
        self.assertEqual(self.quota()["used_count"], 1)

    def test_history_metadata_ownership_filter_and_pagination(self):
        first_planting = self.add_growing_plant()
        second_planting = self.add_growing_plant(client_id="other-farm")
        self.add_growing_plant(user_id=2)
        first = self.post_diagnosis("history-first").json()
        self.analysis.failure = "uncertain"
        second = self.post_diagnosis("history-second", farm_client_id="other-farm").json()
        self.post_diagnosis("history-other-user", user_id=2)
        self.post_diagnosis("history-demo", path="/diagnoses/demo")
        self.analysis.failure = "after"
        self.post_diagnosis("history-unknown")

        history = self.client.get("/diagnoses/history?page_size=1", headers=self.headers()).json()
        self.assertEqual(history["total"], 2)
        self.assertEqual(len(history["items"]), 1)
        self.assertEqual(history["items"][0]["request_id"], second["request_id"])
        self.assertEqual(history["items"][0]["outcome"], "uncertain")
        self.assertEqual(history["items"][0]["symptoms"], ["잎 변색"])
        next_page = self.client.get("/diagnoses/history?page_size=1&page=2", headers=self.headers()).json()
        self.assertEqual(next_page["items"][0]["request_id"], first["request_id"])
        self.assertEqual({p["planting_id"] for p in history["plantings"]}, {first_planting, second_planting})
        filtered = self.client.get(f"/diagnoses/history?planting_id={first_planting}", headers=self.headers()).json()
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(filtered["items"][0]["request_id"], first["request_id"])
        detail = self.client.get(f"/diagnoses/requests/{first['request_id']}", headers=self.headers()).json()
        self.assertEqual(detail["crop_name"], "상추")
        self.assertEqual(detail["description"], "잎에 변화가 보여요.")
        denied = self.client.get(f"/diagnoses/requests/{first['request_id']}", headers=self.headers(2))
        self.assertEqual(denied.status_code, 404)
        self.assertNotEqual(self.client.get("/diagnoses/history").status_code, 200)
        self.assertEqual(self.client.get("/diagnoses/history?page=0", headers=self.headers()).status_code, 422)
        self.assertEqual(self.client.get("/diagnoses/history?page_size=51", headers=self.headers()).status_code, 422)

        # A planting deleted later must not erase the saved name or analysis.
        with self.engine.begin() as conn:
            conn.execute(self.requests.update().where(
                self.requests.c.request_id == first["request_id"]
            ).values(planting_id=None))
        saved = self.client.get(f"/diagnoses/requests/{first['request_id']}", headers=self.headers()).json()
        self.assertIsNone(saved["planting_id"])
        self.assertEqual(saved["crop_name"], "상추")
        self.assertEqual(saved["result"]["status"], "diagnosed")

    def test_history_handles_legacy_metadata_and_deleted_planting(self):
        self.add_growing_plant()
        response = self.post_diagnosis("history-legacy").json()
        with self.engine.begin() as conn:
            row = conn.execute(select(self.requests)).mappings().one()
            legacy_result = dict(row["result"])
            legacy_result.pop("metadata")
            conn.execute(self.requests.update().values(result=legacy_result, planting_id=None))
        history = self.client.get("/diagnoses/history", headers=self.headers()).json()
        self.assertEqual(history["total"], 1)
        self.assertIsNone(history["items"][0]["crop_name"])
        self.assertEqual(history["items"][0]["symptoms"], [])
        self.assertEqual(history["plantings"], [])
        detail = self.client.get(f"/diagnoses/requests/{response['request_id']}", headers=self.headers()).json()
        self.assertEqual(detail["result"]["status"], "diagnosed")
        self.assertEqual(detail["description"], "")

    def test_initial_quota_and_three_uses_reject_fourth_without_call(self):
        self.add_growing_plant()
        self.assertEqual(self.quota()["remaining_count"], 3)
        for index in range(3):
            response = self.post_diagnosis(f"daily-use-{index:02d}")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertFalse(response.json()["is_demo"])
        calls_before_limit = self.analysis.calls
        limited = self.post_diagnosis("daily-use-04")
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json()["status"], "limit_exceeded")
        self.assertEqual(self.analysis.calls, calls_before_limit)
        self.assertEqual(self.quota()["remaining_count"], 0)

    def test_quota_resets_at_korean_midnight(self):
        self.add_growing_plant()
        prior_day = datetime(2026, 10, 18, 23, 59, tzinfo=now_kst().tzinfo)
        with patch("diagnosis.now_kst", return_value=prior_day):
            for index in range(3):
                self.assertEqual(
                    self.post_diagnosis(f"before-midnight-{index:02d}").status_code, 200
                )
        after_midnight = datetime(2026, 10, 19, 0, 0, tzinfo=now_kst().tzinfo)
        with patch("diagnosis.now_kst", return_value=after_midnight):
            quota = self.quota()
        self.assertEqual(quota["remaining_count"], 3)
        self.assertEqual(quota["reset_at"], "2026-10-20T00:00:00+09:00")

    def test_users_have_independent_quotas(self):
        self.add_growing_plant()
        self.add_growing_plant(user_id=2, client_id="other-farm")
        for index in range(2):
            self.assertEqual(self.post_diagnosis(f"first-user-{index:02d}").status_code, 200)
        self.assertEqual(self.quota()["remaining_count"], 1)
        self.assertEqual(self.quota(2)["remaining_count"], 3)

    def test_idempotency_replays_response_and_rejects_changed_payload(self):
        self.add_growing_plant()
        first = self.post_diagnosis("same-request-0001")
        replay = self.post_diagnosis("same-request-0001")
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(first.json()["request_id"], replay.json()["request_id"])
        self.assertTrue(replay.json()["replayed"])
        self.assertEqual(self.quota()["used_count"], 1)

        different = self.post_diagnosis("same-request-0001", symptoms="시듦")
        self.assertEqual(different.status_code, 409)
        self.assertEqual(self.analysis.calls, 1)

    def test_concurrent_same_idempotency_key_replays_inflight_request_once(self):
        self.add_growing_plant()
        analysis_started = threading.Event()
        release_analysis = threading.Event()
        original_analyze = self.analysis.analyze

        async def blocked_analyze(*args):
            analysis_started.set()
            if not await asyncio.to_thread(release_analysis.wait, timeout=10):
                raise TimeoutError("test did not release the mocked analysis")
            return await original_analyze(*args)

        self.analysis.analyze = blocked_analyze
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=2) as executor:
            first_future = executor.submit(self.post_diagnosis, "same-concurrent-key-01")
            self.assertTrue(analysis_started.wait(timeout=5))
            try:
                replay = self.post_diagnosis("same-concurrent-key-01")
            finally:
                release_analysis.set()
            first = first_future.result(timeout=15)

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(replay.status_code, 202, replay.text)
        self.assertEqual(first.json()["request_id"], replay.json()["request_id"])
        self.assertEqual(self.analysis.calls, 1)
        quota = self.quota()
        self.assertEqual(quota["used_count"], 1)
        self.assertEqual(quota["remaining_count"], 2)

    def test_concurrent_requests_reserve_at_most_three_uses(self):
        self.add_growing_plant()

        def submit(index):
            return self.post_diagnosis(f"parallel-request-{index:02d}")

        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=6) as executor:
            responses = list(executor.map(submit, range(6)))
        self.assertEqual(sum(response.status_code == 200 for response in responses), 3)
        self.assertEqual(sum(response.status_code == 429 for response in responses), 3)
        self.assertEqual(self.quota()["used_count"], 3)

    def test_authentication_ownership_and_ended_planting_are_rejected(self):
        self.add_growing_plant()
        self.add_growing_plant(user_id=2, client_id="other-farm", position=2)
        self.assertEqual(self.client.get("/diagnoses/quota").status_code, 401)
        denied = self.post_diagnosis("other-users-plant", user_id=2, plot_number=1)
        self.assertEqual(denied.status_code, 404)
        self.add_growing_plant(user_id=1, client_id="ended-farm", position=3, state="ended")
        ended = self.post_diagnosis("ended-planting-01", farm_client_id="ended-farm", plot_number=3)
        self.assertEqual(ended.status_code, 404)
        self.assertEqual(self.quota()["used_count"], 0)

    def test_invalid_input_and_photo_do_not_consume_quota(self):
        self.add_growing_plant()
        missing_photo = self.client.post(
            "/diagnoses",
            headers={**self.headers(), "Idempotency-Key": "missing-photo-0001"},
            data={
                "farm_client_id": "farm-client-id",
                "plot_number": "1",
                "symptoms": "잎 변색",
            },
        )
        self.assertEqual(missing_photo.status_code, 422)
        invalid_image = self.post_diagnosis(
            "invalid-image-0001",
            photos={"close_photo": ("close.png", b"not an image", "image/png")},
        )
        self.assertEqual(invalid_image.status_code, 415)
        self.assertEqual(self.quota()["used_count"], 0)

    def test_analysis_preflight_error_releases_reservation(self):
        self.add_growing_plant()
        self.analysis.failure = "before"
        response = self.post_diagnosis("before-analysis-001")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["status"], "failed_before_analysis")
        self.assertEqual(self.quota()["used_count"], 0)
        request = self.client.get(response.json()["status_url"], headers=self.headers()).json()
        self.assertFalse(request["quota_reserved"])
        self.assertFalse(request["quota_consumed"])

    def test_service_configuration_failure_does_not_reserve_quota(self):
        self.add_growing_plant()
        self.analysis.failure = "prepare"
        response = self.post_diagnosis("service-config-error-01")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.quota()["used_count"], 0)
        self.assertEqual(self.analysis.calls, 0)

    def test_uncertain_result_consumes_one_use(self):
        self.add_growing_plant()
        self.analysis.failure = "uncertain"
        response = self.post_diagnosis("uncertain-case-01")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "uncertain")
        self.assertFalse(response.json()["is_demo"])
        self.assertEqual(self.quota()["used_count"], 1)

    def test_confirmed_precreation_rejections_have_explicit_marker(self):
        self.add_growing_plant()
        for status, kwargs, failure in [
            (422, {"symptoms": "invalid-symptom"}, None),
            (404, {"farm_client_id": "missing-farm"}, None),
            (503, {}, "prepare"),
        ]:
            with self.subTest(status=status):
                self.analysis.failure = failure
                response = self.post_diagnosis(f"rejected-status-{status}", **kwargs)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json().get("status"), "rejected_before_creation")
                self.assertIs(response.json().get("request_created"), False)
                self.assertNotIn("request_id", response.json())
        self.assertEqual(self.quota()["used_count"], 0)
        self.assertEqual(self.analysis.calls, 0)

    def test_preflight_rejection_on_replay_preserves_existing_request(self):
        self.add_growing_plant()
        first = self.post_diagnosis("existing-replay-key").json()
        self.analysis.failure = "prepare"
        rejected = self.post_diagnosis("existing-replay-key")
        # P2 now bypasses preflight for an existing key. Preserve P1's intent:
        # never discard the existing record or run a duplicate analysis.
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.json().get("status"), "diagnosed")
        self.assertTrue(rejected.json().get("replayed"))
        self.assertEqual(rejected.json().get("request_id"), first["request_id"])
        saved = self.client.get(f"/diagnoses/requests/{first['request_id']}", headers=self.headers()).json()
        self.assertEqual(saved["status"], "completed")
        self.assertEqual(self.analysis.calls, 1)
        new_request = self.post_diagnosis("new-preflight-failure")
        self.assertEqual(new_request.status_code, 503)
        self.assertEqual(new_request.json()["status"], "rejected_before_creation")
        self.assertIs(new_request.json()["request_created"], False)

    def test_provider_http_errors_preserve_existing_reservation_policy(self):
        self.add_growing_plant()
        for provider_status in (429, 500, 503):
            with self.subTest(provider_status=provider_status):
                parse = AsyncMock(side_effect=APIStatusError(
                    "mock provider error",
                    response=Response(provider_status, request=Request("POST", "https://mock.invalid")),
                    body={},
                ))
                service = OpenAIDiagnosisService(client=SimpleNamespace(
                    chat=SimpleNamespace(completions=SimpleNamespace(parse=parse))
                ))
                self.analysis.analyze = service.analyze
                response = self.post_diagnosis(f"provider-status-{provider_status}")
                self.assertEqual(response.status_code, 502)
                expected = "unknown" if provider_status >= 500 else "failed_before_analysis"
                self.assertEqual(response.json()["status"], expected)
                saved = self.client.get(response.json()["status_url"], headers=self.headers()).json()
                self.assertEqual(saved["quota_reserved"], provider_status >= 500)
                self.assertFalse(saved["quota_consumed"])
                self.assertEqual(parse.await_count, 1)

    def test_p2_completed_replay_survives_deleted_planting(self):
        planting_id = self.add_growing_plant()
        first = self.post_diagnosis("p2-deleted-plant").json()
        with self.engine.begin() as conn:
            conn.execute(self.requests.update().values(planting_id=None))
            conn.execute(self.plantings.delete().where(self.plantings.c.id == planting_id))
        replay = self.post_diagnosis("p2-deleted-plant")
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["request_id"], first["request_id"])
        self.assertEqual(replay.json()["disease_name"], first["disease_name"])
        self.assertEqual(self.analysis.calls, 1)
        self.assertEqual(self.quota()["used_count"], 1)
        self.assertEqual(self.post_diagnosis("p2-deleted-new-key").status_code, 404)
        conflict = self.post_diagnosis("p2-deleted-plant", symptoms="시듦")
        self.assertEqual(conflict.status_code, 409)
        conflict = self.post_diagnosis("p2-deleted-plant", farm_client_id="different-farm")
        self.assertEqual(conflict.status_code, 409)

    def test_p2_replay_survives_service_failure_and_harvest(self):
        planting_id = self.add_growing_plant()
        first = self.post_diagnosis("p2-service-replay").json()
        with self.engine.begin() as conn:
            conn.execute(self.plantings.update().where(self.plantings.c.id == planting_id).values(status="ended"))
        self.analysis.failure = "prepare"
        replay = self.post_diagnosis("p2-service-replay")
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["request_id"], first["request_id"])
        self.assertEqual(self.analysis.failure, "prepare", "replay must not prepare the service")
        self.assertEqual(self.analysis.calls, 1)
        self.assertEqual(self.quota()["used_count"], 1)
        self.assertEqual(self.post_diagnosis("p2-service-new-key").status_code, 503)

    def test_p2_replay_ownership_and_noncompleted_states(self):
        self.add_growing_plant()
        self.add_growing_plant(user_id=2, client_id="user-two-farm")
        first = self.post_diagnosis("p2-shared-key").json()
        second = self.post_diagnosis("p2-shared-key", user_id=2, farm_client_id="user-two-farm").json()
        self.assertNotEqual(first["request_id"], second["request_id"])
        self.assertEqual(self.client.get(f"/diagnoses/requests/{first['request_id']}", headers=self.headers(2)).status_code, 404)
        for state, reserved, expected_code in [
            ("unknown", True, 202), ("processing", True, 202), ("failed_before_analysis", False, 422),
        ]:
            with self.subTest(state=state):
                with self.engine.begin() as conn:
                    conn.execute(self.requests.update().where(self.requests.c.request_id == first["request_id"]).values(
                        status=state, quota_reserved=reserved, quota_consumed=False,
                    ))
                self.analysis.failure = "prepare"
                replay = self.post_diagnosis("p2-shared-key")
                self.assertEqual(replay.status_code, expected_code)
                self.assertEqual(replay.json()["status"], state)
                self.assertEqual(replay.json()["request_id"], first["request_id"])
        self.assertEqual(self.analysis.calls, 2)

    def test_p2_deleted_unknown_retains_replay_identity_without_result(self):
        planting_id = self.add_growing_plant()
        self.analysis.failure = "after"
        first = self.post_diagnosis("p2-deleted-unknown").json()
        with self.engine.begin() as conn:
            conn.execute(self.requests.update().values(planting_id=None))
            conn.execute(self.plantings.delete().where(self.plantings.c.id == planting_id))
        self.analysis.failure = "prepare"
        replay = self.post_diagnosis("p2-deleted-unknown")
        self.assertEqual(replay.status_code, 202)
        self.assertEqual(replay.json()["request_id"], first["request_id"])
        self.assertEqual(replay.json()["status"], "unknown")
        self.assertEqual(self.analysis.calls, 1)
        self.assertEqual(self.quota()["reserved_count"], 1)

    def test_p2_legacy_deleted_result_uses_saved_planting_id(self):
        planting_id = self.add_growing_plant()
        first = self.post_diagnosis("p2-legacy-deleted").json()
        with self.engine.begin() as conn:
            row = conn.execute(select(self.requests)).mappings().one()
            result = dict(row["result"])
            result["metadata"] = dict(result["metadata"])
            result["metadata"].pop("farm_client_id")
            result["metadata"].pop("plot_number")
            conn.execute(self.requests.update().values(planting_id=None, result=result))
            conn.execute(self.plantings.delete().where(self.plantings.c.id == planting_id))
        replay = self.post_diagnosis("p2-legacy-deleted")
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["request_id"], first["request_id"])
        self.assertEqual(self.analysis.calls, 1)
        # An older record with neither the FK nor the original ID cannot have
        # its fingerprint verified safely. The request-ID GET still works.
        with self.engine.begin() as conn:
            result["metadata"].pop("planting_id")
            conn.execute(self.requests.update().values(result=result))
        self.assertEqual(self.post_diagnosis("p2-legacy-deleted").status_code, 409)
        saved = self.client.get(f"/diagnoses/requests/{first['request_id']}", headers=self.headers()).json()
        self.assertEqual(saved["status"], "completed")

    @contextmanager
    def result_storage_fault(self, mode):
        """Inject only after a successful fake analysis, leaving preflight intact."""
        real_begin, real_connect = self.engine.begin, self.engine.connect
        real_analyze = self.analysis.analyze
        observed = {"analyzed": False, "injected": False, "read_failed": False, "reads": 0, "rowcounts": []}

        async def analyze(*args):
            result = await real_analyze(*args)
            observed["analyzed"] = True
            return result

        def connect(*args, **kwargs):
            if observed["injected"]:
                observed["reads"] += 1
            if observed["read_failed"]:
                raise SQLAlchemyError("mock fresh connection unavailable")
            return real_connect(*args, **kwargs)

        @contextmanager
        def begin():
            inject = observed["analyzed"] and not observed["injected"]
            with real_begin() as conn:
                if not inject:
                    yield conn
                    return
                observed["injected"] = True
                execute = conn.execute

                def result_execute(statement, *args, **kwargs):
                    if getattr(statement, "is_update", False):
                        if mode == "update_error":
                            raise SQLAlchemyError("mock result UPDATE failure")
                        if mode == "zero_rows":
                            observed["rowcounts"].append(0)
                            return SimpleNamespace(rowcount=0)
                        if mode == "owner_mismatch":
                            execute(self.requests.update().values(user_id=2))
                        updated = execute(statement, *args, **kwargs)
                        count = 2 if mode == "unexpected_rows" else updated.rowcount
                        observed["rowcounts"].append(count)
                        return SimpleNamespace(rowcount=count)
                    return execute(statement, *args, **kwargs)

                with patch.object(conn, "execute", side_effect=result_execute):
                    yield conn
                if mode == "before_commit":
                    raise SQLAlchemyError("mock failure before commit")
            # The real SQLite commit has finished; only its acknowledgement is
            # lost. A new connection must distinguish this from a rollback.
            if inject and mode in {"after_commit", "after_commit_changed", "recheck_unavailable", "invalid_saved_json"}:
                if mode in {"invalid_saved_json", "after_commit_changed"}:
                    with real_begin() as conn:
                        saved_result = dict(conn.execute(select(self.requests.c.result)).scalar_one())
                        saved_result = {"status": "diagnosed"} if mode == "invalid_saved_json" else {
                            **saved_result, "disease_name": "durable-only-result",
                        }
                        conn.execute(self.requests.update().values(result=saved_result))
                observed["read_failed"] = mode == "recheck_unavailable"
                raise SQLAlchemyError("mock commit acknowledgement lost")

        with patch.object(self.analysis, "analyze", side_effect=analyze), \
                patch.object(self.engine, "begin", side_effect=begin), \
                patch.object(self.engine, "connect", side_effect=connect):
            yield observed

    def post_storage_case(self, mode, key):
        with self.result_storage_fault(mode) as observed:
            with TestClient(self.app, raise_server_exceptions=False) as client:
                with patch.object(self, "client", client):
                    response = self.post_diagnosis(key)
        return response, observed

    def assert_storage_unknown(self, response, key):
        self.assertEqual(response.status_code, 503, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "unknown")
        self.assertIn("request_id", payload)
        self.assertNotIn("request_created", payload)
        self.assertNotIn("result", payload)
        self.assertNotIn("disease_name", payload)
        with self.engine.connect() as conn:
            saved = conn.execute(select(self.requests).where(self.requests.c.request_id == payload["request_id"])).mappings().one()
        self.assertEqual(saved["status"], "processing")
        self.assertTrue(saved["quota_reserved"])
        self.assertFalse(saved["quota_consumed"])
        self.assertNotIn("disease_name", saved["result"])
        self.assertEqual(self.quota()["reserved_count"], 1)
        self.assertEqual(self.quota()["used_count"], 1)
        self.assertEqual(self.client.get("/diagnoses/history", headers=self.headers()).json()["total"], 0)
        replay = self.post_diagnosis(key)
        self.assertEqual(replay.status_code, 202)
        self.assertEqual(replay.json()["request_id"], payload["request_id"])
        self.assertEqual(self.analysis.calls, 1)

    def test_storage_one_row_commit_preserves_result_quota_and_history(self):
        self.add_growing_plant()
        response, observed = self.post_storage_case("observe", "storage-normal")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(observed["rowcounts"], [1])
        saved = self.client.get(f"/diagnoses/requests/{response.json()['request_id']}", headers=self.headers()).json()
        self.assertEqual(saved["status"], "completed")
        self.assertEqual(saved["result"]["disease_name"], response.json()["disease_name"])
        self.assertFalse(saved["quota_reserved"])
        self.assertTrue(saved["quota_consumed"])
        self.assertEqual(self.quota()["used_count"], 1)
        self.assertEqual(self.client.get("/diagnoses/history", headers=self.headers()).json()["total"], 1)

    def test_storage_zero_rows_blocks_success(self):
        self.add_growing_plant()
        response, _ = self.post_storage_case("zero_rows", "storage-zero")
        self.assert_storage_unknown(response, "storage-zero")

    def test_storage_unexpected_rows_rolls_back_all_changes(self):
        self.add_growing_plant()
        response, _ = self.post_storage_case("unexpected_rows", "storage-unexpected")
        self.assert_storage_unknown(response, "storage-unexpected")

    def test_storage_update_exception_keeps_reservation_and_replay(self):
        self.add_growing_plant()
        response, observed = self.post_storage_case("update_error", "storage-update-error")
        self.assert_storage_unknown(response, "storage-update-error")
        self.assertGreaterEqual(observed["reads"], 1)

    def test_storage_before_commit_rolls_back_and_checks_fresh_connection(self):
        self.add_growing_plant()
        response, observed = self.post_storage_case("before_commit", "storage-precommit")
        self.assert_storage_unknown(response, "storage-precommit")
        self.assertGreaterEqual(observed["reads"], 1)

    def test_storage_lost_commit_ack_recovers_only_persisted_result(self):
        self.add_growing_plant()
        response, observed = self.post_storage_case("after_commit", "storage-committed")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreaterEqual(observed["reads"], 1)
        with self.engine.connect() as conn:
            saved = conn.execute(select(self.requests)).mappings().one()
        self.assertEqual(saved["status"], "completed")
        self.assertEqual(response.json()["disease_name"], saved["result"]["disease_name"])
        self.assertEqual(self.post_diagnosis("storage-committed").status_code, 200)
        self.assertEqual(self.analysis.calls, 1)
        self.assertEqual(self.quota()["used_count"], 1)
        self.assertEqual(self.client.get("/diagnoses/history", headers=self.headers()).json()["total"], 1)

    def test_storage_uncertain_commit_and_failed_recheck_never_claims_success(self):
        self.add_growing_plant()
        response, observed = self.post_storage_case("recheck_unavailable", "storage-unconfirmed")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertNotIn("request_created", response.json())
        self.assertNotIn("disease_name", response.json())
        self.assertGreaterEqual(observed["reads"], 1)
        # The acknowledgement was lost, but SQLite did commit. Recovery after
        # connectivity returns must reuse that row and never analyze again.
        replay = self.post_diagnosis("storage-unconfirmed")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["request_id"], response.json()["request_id"])
        self.assertEqual(self.analysis.calls, 1)

    def test_storage_recheck_rejects_invalid_completed_json(self):
        self.add_growing_plant()
        response, _ = self.post_storage_case("invalid_saved_json", "storage-invalid-json")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertNotIn("disease_name", response.json())
        self.assertEqual(self.analysis.calls, 1)

    def test_storage_update_requires_original_user_ownership(self):
        self.add_growing_plant()
        self.add_growing_plant(user_id=2, client_id="other-farm")
        response, observed = self.post_storage_case("owner_mismatch", "storage-owner")
        self.assertEqual(observed["rowcounts"], [0])
        self.assert_storage_unknown(response, "storage-owner")

    def test_storage_recovery_returns_db_result_not_analysis_memory(self):
        self.add_growing_plant()
        response, _ = self.post_storage_case("after_commit_changed", "storage-durable-only")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["disease_name"], "durable-only-result")
        self.assertEqual(self.analysis.calls, 1)

    def test_db_delays_do_not_block_the_event_loop(self):
        self.add_growing_plant()
        for stage in ("reservation", "started", "service_failure", "unexpected_failure", "result", "recheck", "preflight_lookup"):
            with self.subTest(stage=stage):
                entered, release, heartbeat = threading.Event(), threading.Event(), threading.Event()
                observed = {"responsive": False, "timed_out": False}
                self.analysis.failure = {"service_failure": "after", "unexpected_failure": "unexpected", "preflight_lookup": "prepare"}.get(stage)

                def delay(conn, cursor, statement, parameters, context, executemany):
                    if entered.is_set():
                        return
                    values = context.compiled_parameters[0] if context.compiled_parameters else {}
                    clause = getattr(context.compiled, "statement", None)
                    columns = [c.name for c in clause.selected_columns] if getattr(clause, "is_select", False) else []
                    match = (
                        (stage == "reservation" and statement.startswith("UPDATE users"))
                        or (stage == "started" and values.get("status") == "processing")
                        or (stage in {"service_failure", "unexpected_failure"} and values.get("status") == "unknown")
                        or (stage == "result" and values.get("status") == "completed")
                        or (stage == "recheck" and fault["injected"] and len(columns) > 1 and columns[0] == "request_id")
                        or (stage == "preflight_lookup" and columns == ["request_id"])
                    )
                    if match:
                        entered.set()
                        if not release.wait(timeout=5):
                            raise RuntimeError("test observer did not release DB delay")

                async def exercise():
                    loop = asyncio.get_running_loop()

                    def observer():
                        if not entered.wait(timeout=5):
                            observed["timed_out"] = True
                        else:
                            loop.call_soon_threadsafe(heartbeat.set)
                            observed["responsive"] = heartbeat.wait(timeout=1)
                        release.set()

                    watcher = threading.Thread(target=observer)
                    watcher.start()
                    try:
                        async with AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test") as client:
                            return await client.post(
                                "/diagnoses", headers={**self.headers(), "Idempotency-Key": f"loop-delay-{stage}"},
                                data={"farm_client_id": "farm-client-id", "plot_number": "1", "symptoms": "잎 변색"},
                                files={"close_photo": ("close.png", PNG, "image/png")},
                            )
                    finally:
                        release.set()
                        watcher.join(timeout=6)

                # Each scenario has its own quota rows; the fake analysis never
                # contacts OpenAI. Only the result recheck injects a rollback.
                with self.engine.begin() as conn:
                    conn.execute(self.requests.delete())
                fault = {"injected": False}
                event.listen(self.engine, "before_cursor_execute", delay)
                try:
                    if stage == "recheck":
                        with self.result_storage_fault("before_commit") as fault:
                            response = asyncio.run(exercise())
                    else:
                        response = asyncio.run(exercise())
                finally:
                    event.remove(self.engine, "before_cursor_execute", delay)
                self.assertFalse(observed["timed_out"], stage)
                self.assertTrue(entered.is_set(), stage)
                self.assertTrue(observed["responsive"], f"event loop was blocked during {stage}")
                self.assertIn(response.status_code, (200, 422, 502, 503))

    def test_slow_user_reservation_does_not_stop_another_user(self):
        self.add_growing_plant()
        self.add_growing_plant(user_id=2, client_id="other-farm")
        entered, release, second_started = threading.Event(), threading.Event(), threading.Event()
        observed = {"second_progressed": False}
        original = self.analysis.analyze

        async def analyze(crop, symptoms, description, photos, on_start):
            if description == "second-user":
                second_started.set()
            return await original(crop, symptoms, description, photos, on_start)

        def delay(conn, cursor, statement, parameters, context, executemany):
            values = context.compiled_parameters[0] if context.compiled_parameters else {}
            if statement.startswith("UPDATE users") and values.get("id_1") == 1 and not entered.is_set():
                entered.set()
                if not release.wait(timeout=5):
                    raise RuntimeError("test did not release user-one delay")

        async def exercise():
            def observer():
                if entered.wait(timeout=5):
                    observed["second_progressed"] = second_started.wait(timeout=1)
                release.set()

            watcher = threading.Thread(target=observer)
            watcher.start()
            try:
                async with AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test") as client:
                    async def post(user_id, farm, description):
                        return await client.post("/diagnoses",
                            headers={**self.headers(user_id), "Idempotency-Key": f"independent-user-{user_id}"},
                            data={"farm_client_id": farm, "plot_number": "1", "symptoms": "잎 변색", "description": description},
                            files={"close_photo": ("close.png", PNG, "image/png")})
                    return await asyncio.gather(post(1, "farm-client-id", "first-user"), post(2, "other-farm", "second-user"))
            finally:
                release.set()
                watcher.join(timeout=6)

        event.listen(self.engine, "before_cursor_execute", delay)
        try:
            with patch.object(self.analysis, "analyze", side_effect=analyze):
                responses = asyncio.run(exercise())
        finally:
            event.remove(self.engine, "before_cursor_execute", delay)
        self.assertTrue(observed["second_progressed"], "unrelated user could not progress while the first DB operation waited")
        self.assertEqual([r.status_code for r in responses], [200, 200])
        self.assertEqual(self.analysis.calls, 2)

    def test_connections_stay_on_owning_thread_and_close_before_analysis(self):
        self.add_growing_plant()
        active, violations, db_threads = set(), [], set()
        mutex = threading.Lock()
        loop_thread = None
        original = self.analysis.analyze

        def opened(dbapi_conn, record):
            record.info["test_owner_thread"] = threading.get_ident()
            with mutex:
                active.add(id(dbapi_conn))

        def closed(dbapi_conn, record):
            if record.info["test_owner_thread"] != threading.get_ident():
                violations.append("close on different thread")
            with mutex:
                active.discard(id(dbapi_conn))

        def operation(conn, *args):
            identity = threading.get_ident()
            db_threads.add(identity)
            if conn.info["test_owner_thread"] != identity:
                violations.append("connection used on different thread")
            if identity == loop_thread:
                violations.append("DB operation on event loop")

        async def analyze(crop, symptoms, description, photos, on_start):
            self.assertEqual(threading.get_ident(), loop_thread)
            self.assertFalse(active, "reservation connection still open during async analysis")

            async def started():
                await on_start()
                self.assertFalse(active, "analysis-start transaction still open")
                self.assertEqual(threading.get_ident(), loop_thread)

            return await original(crop, symptoms, description, photos, started)

        async def exercise():
            nonlocal loop_thread
            loop_thread = threading.get_ident()
            async with AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test") as client:
                return await client.post("/diagnoses",
                    headers={**self.headers(), "Idempotency-Key": "connection-ownership"},
                    data={"farm_client_id": "farm-client-id", "plot_number": "1", "symptoms": "잎 변색"},
                    files={"close_photo": ("close.png", PNG, "image/png")})

        listeners = [("connect", opened), ("close", closed), ("before_cursor_execute", operation), ("commit", operation), ("rollback", operation)]
        for name, listener in listeners:
            event.listen(self.engine, name, listener)
        try:
            with patch.object(self.analysis, "analyze", side_effect=analyze):
                response = asyncio.run(exercise())
        finally:
            for name, listener in listeners:
                event.remove(self.engine, name, listener)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(db_threads)
        self.assertEqual(violations, [])
        self.assertEqual(active, set())

    def test_unknown_request_reserves_quota_only_until_korean_midnight(self):
        self.add_growing_plant()
        self.analysis.failure = "after"
        failed = self.post_diagnosis("unknown-request-001")
        self.assertEqual(failed.status_code, 502)
        status_response = self.client.get(failed.json()["status_url"], headers=self.headers()).json()
        self.assertEqual(status_response["status"], "unknown")
        self.assertTrue(status_response["quota_reserved"])
        self.assertFalse(status_response["quota_consumed"])
        self.assertEqual(self.quota()["reserved_count"], 1)

        replay = self.post_diagnosis("unknown-request-001")
        self.assertEqual(replay.status_code, 202)
        self.assertEqual(self.analysis.calls, 1)
        tomorrow = now_kst().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        with patch("diagnosis.now_kst", return_value=tomorrow):
            self.assertEqual(self.quota()["remaining_count"], 3)

    def test_openai_timeout_keeps_request_unknown_and_reserves_quota(self):
        self.add_growing_plant()
        timeout_calls = []

        async def timeout_handler(request):
            timeout_calls.append(request)
            raise ReadTimeout("simulated network timeout", request=request)

        async def analyze_with_timeout(crop_name, symptoms, description, photos, on_start):
            http_client = AsyncClient(
                transport=MockTransport(timeout_handler),
                timeout=0.01,
            )
            sdk_client = AsyncOpenAI(
                api_key="test-key-not-a-real-secret",
                max_retries=0,
                http_client=http_client,
            )
            try:
                service = OpenAIDiagnosisService(client=sdk_client)
                return await service.analyze(
                    crop_name, symptoms, description, photos, on_start
                )
            finally:
                await sdk_client.close()

        self.analysis.analyze = analyze_with_timeout
        response = self.post_diagnosis("timeout-request-0001")

        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertEqual(len(timeout_calls), 1)
        status_response = self.client.get(
            response.json()["status_url"], headers=self.headers()
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        self.assertEqual(status_response.json()["status"], "unknown")
        self.assertTrue(status_response.json()["quota_reserved"])
        self.assertFalse(status_response.json()["quota_consumed"])
        quota = self.quota()
        self.assertEqual(quota["reserved_count"], 1)
        self.assertEqual(quota["used_count"], 1)
        self.assertEqual(quota["remaining_count"], 2)

    def test_unexpected_provider_error_is_sanitized_and_kept_unknown(self):
        self.add_growing_plant()
        self.analysis.failure = "unexpected"
        response = self.post_diagnosis("unexpected-error-001")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertNotIn("provider exception", response.text)
        self.assertEqual(self.quota()["reserved_count"], 1)

    def test_demo_and_real_requests_cannot_replay_each_others_results(self):
        self.add_growing_plant()
        demo = self.post_diagnosis(
            "same-cross-mode-key-01",
            path="/diagnoses/demo",
            outcome="diagnosed",
        )
        self.assertEqual(demo.status_code, 200, demo.text)
        real = self.post_diagnosis("same-cross-mode-key-01")
        self.assertEqual(real.status_code, 409)
        self.assertEqual(self.analysis.calls, 0)
        self.assertEqual(self.quota()["used_count"], 0)

    def test_demo_endpoint_is_explicit_and_does_not_consume_quota(self):
        self.add_growing_plant()
        response = self.post_diagnosis(
            "demo-diagnosis-001",
            path="/diagnoses/demo",
            outcome="diagnosed",
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["is_demo"])
        self.assertIsNone(response.json()["quota"])
        self.assertEqual(self.quota()["used_count"], 0)
        self.assertEqual(self.analysis.calls, 0)

    def test_demo_endpoint_is_absent_without_explicit_development_flag(self):
        metadata = MetaData()
        isolated_users = Table("users", metadata, Column("id", Integer, primary_key=True))
        isolated_farms = Table(
            "farms", metadata, Column("id", Integer, primary_key=True),
            Column("user_id", Integer), Column("client_id", String(64)),
        )
        isolated_plots = Table(
            "plots", metadata, Column("id", Integer, primary_key=True),
            Column("farm_id", Integer), Column("position", Integer),
        )
        isolated_crops = Table(
            "crops", metadata, Column("id", Integer, primary_key=True), Column("name", String(50)),
        )
        isolated_plantings = Table(
            "plantings", metadata, Column("id", Integer, primary_key=True),
            Column("user_id", Integer), Column("plot_id", Integer), Column("crop_id", Integer),
            Column("status", String(16)),
        )
        app = FastAPI()
        with patch.dict(os.environ, {"APP_ENV": "production", "DIAGNOSIS_TEST_MODE": "true"}):
            register_diagnoses(
                app,
                metadata,
                self.engine,
                lambda: {"id": 1},
                isolated_users,
                isolated_plantings,
                isolated_crops,
                isolated_farms,
                isolated_plots,
                analysis_service=self.analysis,
                demo_service=DevelopmentDiagnosisService(),
            )
        self.assertNotIn("/diagnoses/demo", app.openapi()["paths"])


class OpenAIDiagnosisServiceTest(unittest.TestCase):
    def test_sdk_sends_structured_vision_request_without_network_access(self):
        requests = []
        structured_result = {
            "status": "diagnosed",
            "disease_name": "의심 결과",
            "evidence": ["사진에서 잎의 반점이 관찰됩니다."],
            "management": ["전문가와 확인하세요."],
            "additional_checks": ["잎 뒷면을 확인하세요."],
            "reason": None,
            "retake_guidance": [],
        }

        async def handler(request: Request):
            requests.append(json.loads(request.content))
            return Response(200, json={
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "created": 0,
                "model": "gpt-4.1-mini",
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(structured_result, ensure_ascii=False),
                        "refusal": None,
                    },
                    "finish_reason": "stop",
                }],
            })

        async def execute():
            http_client = AsyncClient(transport=MockTransport(handler))
            sdk_client = AsyncOpenAI(
                api_key="test-key-not-a-real-secret",
                max_retries=0,
                http_client=http_client,
            )
            try:
                service = OpenAIDiagnosisService(client=sdk_client)
                return await service.analyze(
                    "상추",
                    ["잎에 반점"],
                    "최근 잎에 점이 생겼어요.",
                    {"close": PNG, "whole": PNG, "back": None},
                    AsyncMock(return_value=None),
                )
            finally:
                await sdk_client.close()

        result = asyncio.run(execute())
        self.assertEqual(result["status"], "diagnosed")
        self.assertEqual(len(requests), 1)
        request_body = requests[0]
        self.assertEqual(request_body["model"], "gpt-4.1-mini")
        self.assertEqual(request_body["response_format"]["type"], "json_schema")
        input_content = request_body["messages"][1]["content"]
        self.assertEqual(sum(item["type"] == "image_url" for item in input_content), 2)
        self.assertIn("data:image/png;base64,", input_content[1]["image_url"]["url"])

    def test_structured_vision_request_uses_model_and_passes_all_images(self):
        parsed = DiagnosisAnalysis(
            status="diagnosed",
            disease_name="의심 결과",
            evidence=["사진에서 잎의 반점이 관찰됩니다."],
            management=["전문가와 확인하세요."],
            additional_checks=["잎 뒷면을 확인하세요."],
            reason=None,
            retake_guidance=[],
        )
        parse = AsyncMock(return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(parsed=parsed, refusal=None))]
        ))
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse)))
        service = OpenAIDiagnosisService(client=client)
        started = []
        result = asyncio.run(service.analyze(
            "상추",
            ["잎에 반점"],
            "최근 잎에 점이 생겼어요.",
            {"close": PNG, "whole": PNG, "back": None},
            AsyncMock(side_effect=lambda: started.append(True)),
        ))

        self.assertEqual(result["disease_name"], "의심 결과")
        self.assertEqual(started, [True])
        kwargs = parse.await_args.kwargs
        self.assertEqual(kwargs["model"], "gpt-4.1-mini")
        self.assertIs(kwargs["response_format"], DiagnosisAnalysis)
        user_content = kwargs["messages"][1]["content"]
        self.assertEqual(sum(item["type"] == "image_url" for item in user_content), 2)
        self.assertTrue(any("상추" in item.get("text", "") for item in user_content))

    def test_sdk_retries_are_disabled(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key-not-a-real-secret"}):
            with patch("diagnosis.AsyncOpenAI") as openai_client:
                service = OpenAIDiagnosisService()
                service.prepare()
        self.assertEqual(openai_client.call_args.kwargs["max_retries"], 0)
        self.assertEqual(openai_client.call_args.kwargs["timeout"], 60.0)

    def test_missing_api_key_fails_before_provider_call(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            with self.assertRaises(DiagnosisServiceError) as raised:
                OpenAIDiagnosisService().prepare()
        self.assertFalse(raised.exception.analysis_started)

    def test_diagnosis_schema_rejects_incomplete_outcomes(self):
        with self.assertRaises(ValueError):
            DiagnosisAnalysis(
                status="diagnosed",
                disease_name=None,
                evidence=[],
                management=[],
                additional_checks=[],
                reason=None,
                retake_guidance=[],
            )


if __name__ == "__main__":
    unittest.main()
