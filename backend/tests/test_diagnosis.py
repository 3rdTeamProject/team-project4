"""Diagnosis API tests use a fresh SQLite database and mocked analysis service per test."""
import asyncio
import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.testclient import TestClient
from httpx import AsyncClient, MockTransport, ReadTimeout, Request, Response
from openai import AsyncOpenAI
from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    insert,
    select,
)
from sqlalchemy.pool import NullPool
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
        on_start()
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
            connect_args={"check_same_thread": False, "timeout": 15},
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
                    lambda: None,
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
            lambda: started.append(True),
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
