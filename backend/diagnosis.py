"""Daily diagnosis quota and OpenAI-backed diagnosis endpoints."""
import base64
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, time, timedelta
from threading import Lock
from typing import Awaitable, Callable, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from openai import APIStatusError, AsyncOpenAI, OpenAIError
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    insert,
    select,
    update,
)
from sqlalchemy.sql import func

DAILY_LIMIT = 3
MAX_PHOTO_BYTES = 8 * 1024 * 1024
KST = ZoneInfo("Asia/Seoul")
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
ALLOWED_SYMPTOMS = {"잎 변색", "시듦", "잎에 반점", "구멍", "벌레 보임", "곰팡이", "기타"}
OPENAI_MODEL = "gpt-4.1-mini"
OPENAI_TIMEOUT_SECONDS = 60.0


class DiagnosisServiceError(Exception):
    def __init__(self, message: str, analysis_started: bool, response_status: int | None = None):
        super().__init__(message)
        self.analysis_started = analysis_started
        self.response_status = response_status


class DiagnosisAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["diagnosed", "uncertain"]
    disease_name: str | None
    evidence: list[str]
    management: list[str]
    additional_checks: list[str]
    reason: str | None
    retake_guidance: list[str]

    @model_validator(mode="after")
    def validate_outcome(self):
        if self.status == "diagnosed":
            if not self.disease_name or not self.evidence:
                raise ValueError("진단 결과에는 의심 병해충명과 근거가 필요합니다.")
        elif not self.reason or not self.retake_guidance:
            raise ValueError("판단 어려움 결과에는 사유와 추가 촬영 안내가 필요합니다.")
        return self


def now_kst() -> datetime:
    return datetime.now(KST)


def quota_snapshot(conn, requests: Table, user_id: int, current: datetime) -> dict:
    usage_date = current.astimezone(KST).date()
    rows = conn.execute(
        select(requests.c.quota_reserved, requests.c.quota_consumed).where(
            requests.c.user_id == user_id,
            requests.c.usage_date == usage_date,
            requests.c.is_demo.is_(False),
        )
    )
    reserved_count = 0
    consumed_count = 0
    for reserved, consumed in rows:
        if reserved:
            reserved_count += 1
        elif consumed:
            consumed_count += 1

    used_count = reserved_count + consumed_count
    reset_at = datetime.combine(usage_date + timedelta(days=1), time.min, tzinfo=KST)
    return {
        "daily_limit": DAILY_LIMIT,
        "used_count": used_count,
        "remaining_count": max(0, DAILY_LIMIT - used_count),
        "reserved_count": reserved_count,
        "reset_at": reset_at.isoformat(),
    }


def image_format(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def read_photo(upload: UploadFile | None, slot: str, required: bool) -> bytes | None:
    if upload is None:
        if required:
            raise HTTPException(422, f"{slot} 사진은 필수입니다.")
        return None

    data = await upload.read(MAX_PHOTO_BYTES + 1)
    if not data:
        raise HTTPException(422, f"{slot} 사진이 비어 있습니다.")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, f"{slot} 사진은 8MB 이하로 올려 주세요.")

    actual_type = image_format(data)
    if actual_type is None or upload.content_type != actual_type:
        raise HTTPException(415, f"{slot} 사진은 PNG, JPEG, WebP 형식이어야 합니다.")
    return data


def request_fingerprint(
    planting_id: int,
    symptoms: list[str],
    description: str,
    photos: dict[str, bytes | None],
) -> str:
    digest = hashlib.sha256()
    digest.update(json.dumps({
        "planting_id": planting_id,
        "symptoms": symptoms,
        "description": description,
    }, ensure_ascii=False, sort_keys=True).encode("utf-8"))
    for slot in ("close", "whole", "back"):
        data = photos[slot]
        digest.update(slot.encode("ascii"))
        digest.update(hashlib.sha256(data or b"").digest())
    return digest.hexdigest()


class OpenAIDiagnosisService:
    """Calls the OpenAI vision model with a strict, validated response schema."""

    is_demo = False

    def __init__(self, client: AsyncOpenAI | None = None):
        self._client = client
        self._prepare_lock = Lock()

    def prepare(self) -> None:
        with self._prepare_lock:
            if self._client is not None:
                return
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise DiagnosisServiceError("진단 서비스를 사용할 수 없습니다.", analysis_started=False)
            self._client = AsyncOpenAI(
                api_key=api_key,
                max_retries=0,
                timeout=OPENAI_TIMEOUT_SECONDS,
            )

    async def analyze(
        self,
        crop_name: str,
        symptoms: list[str],
        description: str,
        photos: dict[str, bytes | None],
        on_start: Callable[[], Awaitable[None]],
    ) -> dict:
        if self._client is None:
            raise DiagnosisServiceError("진단 서비스가 준비되지 않았습니다.", analysis_started=False)

        instructions = (
            "당신은 작물 병해충 사진을 검토하는 보조 도구입니다. 확정 진단이나 처방을 하지 말고 "
            "의심 결과 또는 판단 어려움만 반환하세요. 사진에서 직접 관찰한 내용과 사용자가 입력한 "
            "증상을 구분하세요. 사진에서 관찰되지 않는 병징, 해충, 증상을 사실처럼 만들어내지 마세요. "
            "작물·증상·사진만으로 근거가 부족하거나 사진 품질이 낮으면 status를 uncertain으로 선택하고, "
            "판단이 어려운 구체적 이유와 다시 촬영할 방법을 제공하세요. diagnosed인 경우에도 disease_name은 "
            "의심 병해충명으로 작성하고 evidence에는 실제 사진이나 입력에서 근거를 제시하세요. "
            "관리 방법은 일반적인 안전 안내로 한정하고 농약의 임의 사용량·희석 비율을 만들지 마세요. "
            "모든 응답은 요구된 JSON 스키마를 따르세요."
        )
        user_text = (
            f"작물명: {crop_name}\n"
            f"사용자가 선택한 증상: {json.dumps(symptoms, ensure_ascii=False)}\n"
            f"사용자 설명: {description or '없음'}\n"
            "사진별로 관찰되는 사실만 반영하고, 제공되지 않은 정보는 추정하지 마세요."
        )
        content: list[dict] = [{"type": "text", "text": user_text}]
        for slot in ("close", "whole", "back"):
            data = photos[slot]
            if data is None:
                continue
            media_type = image_format(data)
            if media_type is None:
                raise DiagnosisServiceError("사진 형식을 확인할 수 없습니다.", analysis_started=False)
            encoded = base64.b64encode(data).decode("ascii")
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{media_type};base64,{encoded}",
                    "detail": "high",
                },
            })

        await on_start()
        try:
            completion = await self._client.chat.completions.parse(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": content},
                ],
                response_format=DiagnosisAnalysis,
            )
        except APIStatusError as error:
            # A definitive provider rejection did not return a model result; timeouts and 5xx remain unknown.
            started = error.status_code >= 500
            raise DiagnosisServiceError(
                "외부 AI 분석 요청을 처리하지 못했습니다.",
                analysis_started=started,
                response_status=502,
            ) from error
        except OpenAIError as error:
            raise DiagnosisServiceError(
                "외부 AI 분석 결과를 확인할 수 없습니다.",
                analysis_started=True,
            ) from error

        message = completion.choices[0].message
        if message.refusal or message.parsed is None:
            raise DiagnosisServiceError(
                "외부 AI가 구조화된 진단 응답을 반환하지 않았습니다.",
                analysis_started=True,
            )
        return message.parsed.model_dump(mode="json")


class DevelopmentDiagnosisService:
    """Explicitly enabled demo responder; it never contacts an external provider."""

    is_demo = True

    def __init__(self):
        self.calls = 0

    def prepare(self) -> None:
        return None

    async def analyze(
        self,
        crop_name: str,
        symptoms: list[str],
        description: str,
        photos: dict[str, bytes | None],
        on_start: Callable[[], Awaitable[None]],
        outcome: str,
    ) -> dict:
        if outcome == "error_before_analysis":
            raise DiagnosisServiceError("데모 입력 오류입니다.", analysis_started=False)

        await on_start()
        self.calls += 1
        if outcome == "error_during_analysis":
            raise DiagnosisServiceError("데모 분석 오류입니다.", analysis_started=True)
        if outcome == "uncertain":
            return {
                "status": "uncertain",
                "disease_name": None,
                "evidence": [],
                "management": [],
                "additional_checks": ["데모 예시 확인 항목입니다."],
                "reason": "데모 예시 사유이며 실제 AI 응답이 아닙니다.",
                "retake_guidance": ["데모 예시 촬영 안내입니다."],
            }
        return {
            "status": "diagnosed",
            "disease_name": "데모 결과 예시 (실제 병해충명 아님)",
            "evidence": ["데모 예시이며 실제 사진 분석 근거가 아닙니다."],
            "management": ["실제 AI 분석 결과가 아닙니다."],
            "additional_checks": ["실제 AI 분석 결과가 아닙니다."],
            "reason": None,
            "retake_guidance": [],
        }


def register_diagnoses(
    app,
    metadata: MetaData,
    engine,
    get_current_user,
    users: Table,
    plantings: Table,
    crops: Table,
    farms: Table,
    plots: Table,
    analysis_service=None,
    demo_service=None,
):
    requests = Table(
        "daily_diagnosis_requests",
        metadata,
        Column("request_id", String(36), primary_key=True),
        Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        Column("planting_id", Integer, ForeignKey("plantings.id", ondelete="SET NULL"), nullable=True),
        Column("usage_date", Date, nullable=False),
        Column("status", String(32), nullable=False),
        Column("idempotency_key", String(128), nullable=False),
        Column("request_fingerprint", String(64), nullable=False),
        Column("quota_reserved", Boolean, nullable=False, default=True),
        Column("quota_consumed", Boolean, nullable=False, default=False),
        Column("is_demo", Boolean, nullable=False, default=False),
        Column("outcome", String(32), nullable=True),
        Column("result", JSON, nullable=True),
        Column("error_message", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
        Column("analysis_started_at", DateTime(timezone=True), nullable=True),
        Column("completed_at", DateTime(timezone=True), nullable=True),
        UniqueConstraint("user_id", "idempotency_key", name="daily_diag_user_idempotency_uq"),
        CheckConstraint(
            "status IN ('reserved', 'processing', 'completed', 'failed_before_analysis', 'unknown')",
            name="daily_diag_status_check",
        ),
        Index("daily_diag_user_date_ix", "user_id", "usage_date"),
    )

    environment = os.getenv("APP_ENV", "").lower()
    demo_enabled = (
        environment in {"development", "test"}
        and os.getenv("DIAGNOSIS_TEST_MODE", "").lower() in {"1", "true", "yes"}
    )
    actual_service = analysis_service or OpenAIDiagnosisService()
    demo_service = demo_service or (DevelopmentDiagnosisService() if demo_enabled else None)
    app.state.diagnosis_service = actual_service
    app.state.diagnosis_demo_service = demo_service

    router = APIRouter(prefix="/diagnoses", tags=["diagnoses"])

    @router.get("/quota")
    def read_quota(user=Depends(get_current_user)):
        with engine.connect() as conn:
            return quota_snapshot(conn, requests, user["id"], now_kst())

    async def process_request(
        *,
        farm_client_id: str,
        plot_number: int,
        symptoms: list[str],
        description: str,
        close_photo: UploadFile,
        whole_photo: UploadFile | None,
        back_photo: UploadFile | None,
        idempotency_key: str,
        user,
        service,
        demo_outcome: str | None = None,
    ):
        if not IDEMPOTENCY_KEY_PATTERN.fullmatch(idempotency_key):
            raise HTTPException(422, "Idempotency-Key는 8~128자의 영문·숫자·._:-만 사용할 수 있습니다.")
        if not farm_client_id or len(farm_client_id) > 64 or plot_number < 1 or plot_number > 6:
            raise HTTPException(422, "진단할 작물 정보가 올바르지 않습니다.")
        if not symptoms or len(symptoms) > len(ALLOWED_SYMPTOMS):
            raise HTTPException(422, "증상을 하나 이상 선택해 주세요.")
        if len(set(symptoms)) != len(symptoms) or any(item not in ALLOWED_SYMPTOMS for item in symptoms):
            raise HTTPException(422, "증상 선택 값이 올바르지 않습니다.")
        description = description.strip()
        if len(description) > 1000:
            raise HTTPException(422, "증상 설명은 1000자 이하로 입력해 주세요.")
        if demo_outcome is not None and demo_outcome not in {
            "diagnosed", "uncertain", "error_before_analysis", "error_during_analysis"
        }:
            raise HTTPException(422, "테스트 응답 유형이 올바르지 않습니다.")

        photos = {
            "close": await read_photo(close_photo, "잎 가까이", required=True),
            "whole": await read_photo(whole_photo, "전체 모습", required=False),
            "back": await read_photo(back_photo, "잎 뒷면", required=False),
        }
        request_id = str(uuid.uuid4())

        def reserve_request():
            """Own the connection, user lock and commit in one worker thread."""
            with engine.begin() as conn:
                locked = conn.execute(
                    update(users).where(users.c.id == user["id"]).values(id=users.c.id)
                ).rowcount
                if not locked:
                    raise HTTPException(401, "사용자를 찾을 수 없습니다.")
                current = now_kst()

                # Replay lookup and reservation stay under the same user lock.
                existing = conn.execute(
                    select(requests).where(
                        requests.c.user_id == user["id"],
                        requests.c.idempotency_key == idempotency_key,
                    )
                ).mappings().first()
                if existing:
                    if existing["is_demo"] != service.is_demo:
                        raise HTTPException(409, "데모와 실제 진단 요청은 같은 Idempotency-Key를 공유할 수 없습니다.")
                    saved_result = existing["result"] if isinstance(existing["result"], dict) else {}
                    saved = saved_result.get("metadata", {})
                    saved = saved if isinstance(saved, dict) else {}
                    original_planting_id = existing["planting_id"] or saved.get("planting_id")
                    if original_planting_id is None:
                        raise HTTPException(409, "기존 요청의 작물 정보를 확인할 수 없습니다. 요청 ID로 상태를 확인해 주세요.")
                    if "farm_client_id" in saved and (
                        saved["farm_client_id"] != farm_client_id or saved.get("plot_number") != plot_number
                    ):
                        raise HTTPException(409, "같은 Idempotency-Key로 다른 진단 내용을 요청할 수 없습니다.")
                    if "farm_client_id" not in saved:
                        # Validate legacy coordinates where still available, even
                        # after harvest. Deleted completed records retain their
                        # original planting ID in the result metadata.
                        target = conn.execute(
                            select(farms.c.client_id, plots.c.position)
                            .select_from(plantings)
                            .join(plots, plots.c.id == plantings.c.plot_id)
                            .join(farms, farms.c.id == plots.c.farm_id)
                            .where(plantings.c.id == original_planting_id, farms.c.user_id == user["id"])
                        ).first()
                        if target is not None and tuple(target) != (farm_client_id, plot_number):
                            raise HTTPException(409, "같은 Idempotency-Key로 다른 진단 내용을 요청할 수 없습니다.")
                    fingerprint = request_fingerprint(original_planting_id, symptoms, description, photos)
                    if existing["request_fingerprint"] != fingerprint:
                        raise HTTPException(409, "같은 Idempotency-Key로 다른 진단 내용을 요청할 수 없습니다.")
                    return None, replay_response(existing)

                # Only new diagnoses need provider preparation and a growing crop.
                try:
                    service.prepare()
                except DiagnosisServiceError as error:
                    raise HTTPException(503, str(error)) from error

                planting = conn.execute(
                    select(plantings.c.id, crops.c.name)
                    .join(crops, crops.c.id == plantings.c.crop_id)
                    .join(plots, plots.c.id == plantings.c.plot_id)
                    .join(farms, farms.c.id == plots.c.farm_id)
                    .where(
                        farms.c.client_id == farm_client_id,
                        farms.c.user_id == user["id"],
                        plots.c.position == plot_number,
                        plantings.c.user_id == user["id"],
                        plantings.c.status == "growing",
                    )
                ).first()
                if planting is None:
                    raise HTTPException(404, "사용자 소유의 재배 중인 작물을 찾을 수 없습니다.")
                planting_id, crop_name = planting
                fingerprint = request_fingerprint(planting_id, symptoms, description, photos)
                request_metadata = {
                    "planting_id": planting_id,
                    "crop_name": crop_name,
                    "farm_client_id": farm_client_id,
                    "plot_number": plot_number,
                    "symptoms": symptoms,
                    "description": description,
                }

                quota = quota_snapshot(conn, requests, user["id"], current)
                if not service.is_demo and quota["remaining_count"] == 0:
                    return None, JSONResponse(status_code=429, content={"status": "limit_exceeded", **quota})

                conn.execute(insert(requests).values(
                    request_id=request_id,
                    user_id=user["id"],
                    planting_id=planting_id,
                    usage_date=current.astimezone(KST).date(),
                    created_at=current,
                    status="reserved",
                    idempotency_key=idempotency_key,
                    request_fingerprint=fingerprint,
                    quota_reserved=not service.is_demo,
                    quota_consumed=False,
                    is_demo=service.is_demo,
                    result={"metadata": request_metadata},
                ))
            return request_metadata, None

        request_metadata, early_response = await run_in_threadpool(reserve_request)
        if early_response is not None:
            return early_response
        crop_name = request_metadata["crop_name"]

        def mark_analysis_started_db():
            started = now_kst()
            with engine.begin() as conn:
                conn.execute(
                    update(requests)
                    .where(requests.c.request_id == request_id, requests.c.status == "reserved")
                    .values(status="processing", analysis_started_at=started)
                )

        async def mark_analysis_started():
            await run_in_threadpool(mark_analysis_started_db)

        try:
            if service.is_demo:
                result = await service.analyze(
                    crop_name, symptoms, description, photos, mark_analysis_started, demo_outcome
                )
            else:
                result = await service.analyze(
                    crop_name, symptoms, description, photos, mark_analysis_started
                )
        except DiagnosisServiceError as error:
            next_status = "unknown" if error.analysis_started else "failed_before_analysis"
            completed = now_kst()

            def record_service_failure():
                with engine.begin() as conn:
                    conn.execute(
                        update(requests)
                        .where(requests.c.request_id == request_id)
                        .values(
                            status=next_status,
                            quota_reserved=error.analysis_started and not service.is_demo,
                            error_message=str(error),
                            completed_at=completed,
                        )
                    )

            await run_in_threadpool(record_service_failure)
            status_code = error.response_status or (502 if error.analysis_started else 422)
            return JSONResponse(status_code=status_code, content={
                "status": next_status,
                "request_id": request_id,
                "is_demo": service.is_demo,
                "detail": str(error),
                "status_url": f"/diagnoses/requests/{request_id}",
            })
        except Exception:
            completed = now_kst()

            def record_unexpected_failure():
                with engine.begin() as conn:
                    analysis_started = conn.execute(
                        select(requests.c.analysis_started_at).where(requests.c.request_id == request_id)
                    ).scalar_one_or_none() is not None
                    conn.execute(
                        update(requests)
                        .where(requests.c.request_id == request_id)
                        .values(
                            status="unknown" if analysis_started else "failed_before_analysis",
                            quota_reserved=analysis_started and not service.is_demo,
                            error_message="진단 서비스 처리 중 오류가 발생했습니다.",
                            completed_at=completed,
                        )
                    )
                return analysis_started

            analysis_started = await run_in_threadpool(record_unexpected_failure)
            return JSONResponse(status_code=502, content={
                "status": "unknown" if analysis_started else "failed_before_analysis",
                "request_id": request_id,
                "is_demo": service.is_demo,
                "detail": "진단 서비스 처리 중 오류가 발생했습니다.",
                "status_url": f"/diagnoses/requests/{request_id}",
            })

        def save_result():
            """Commit or confirm durable data without crossing thread boundaries."""
            completed = now_kst()
            result["is_demo"] = service.is_demo
            result["metadata"] = request_metadata
            unexpected_row_count = False
            try:
                with engine.begin() as conn:
                    written = conn.execute(
                        update(requests)
                        .where(
                            requests.c.request_id == request_id,
                            requests.c.user_id == user["id"],
                            requests.c.status == "processing",
                        )
                        .values(
                            status="completed",
                            outcome=result["status"],
                            result=result,
                            quota_reserved=False,
                            quota_consumed=not service.is_demo,
                            completed_at=completed,
                        )
                    )
                    if written.rowcount != 1:
                        unexpected_row_count = True
                        raise RuntimeError("Diagnosis result UPDATE did not affect exactly one row")
                    quota = quota_snapshot(conn, requests, user["id"], completed)
            except Exception:
                # The transaction context has rolled back/closed. A lost commit
                # acknowledgement is not proof of rollback; never reuse its failed
                # connection or retry analysis. Verify only durable, owned data.
                try:
                    with engine.connect() as conn:
                        saved = conn.execute(select(requests).where(
                            requests.c.request_id == request_id,
                            requests.c.user_id == user["id"],
                        )).mappings().first()
                        if (
                            not unexpected_row_count
                            and saved is not None and saved["status"] == "completed"
                            and saved["is_demo"] == service.is_demo
                            and not saved["quota_reserved"]
                            and saved["quota_consumed"] == (not service.is_demo)
                            and isinstance(saved["result"], dict)
                        ):
                            stored_result = saved["result"]
                            validated = DiagnosisAnalysis.model_validate({
                                key: stored_result[key] for key in DiagnosisAnalysis.model_fields
                                if key in stored_result
                            })
                            if saved["outcome"] == validated.status and stored_result.get("is_demo") == service.is_demo:
                                confirmed_quota = quota_snapshot(conn, requests, user["id"], now_kst())
                                return {
                                    **stored_result,
                                    "request_id": request_id,
                                    "quota": confirmed_quota if not service.is_demo else None,
                                }
                except Exception:
                    # Unavailable DB or invalid/incomplete saved JSON: no success
                    # claim and no invented result from the in-memory analysis.
                    pass
                return JSONResponse(status_code=503, content={
                    "status": "unknown",
                    "request_id": request_id,
                    "is_demo": service.is_demo,
                    "detail": "진단 결과의 저장 여부를 확인하지 못했습니다. 기존 요청의 상태를 다시 확인해 주세요.",
                    "status_url": f"/diagnoses/requests/{request_id}",
                })
            return {
                **result,
                "request_id": request_id,
                "quota": quota if not service.is_demo else None,
            }

        return await run_in_threadpool(save_result)

    @router.post("")
    async def create_diagnosis(
        farm_client_id: str = Form(..., min_length=1, max_length=64),
        plot_number: int = Form(..., ge=1, le=6),
        symptoms: list[str] = Form(...),
        description: str = Form(""),
        close_photo: UploadFile = File(...),
        whole_photo: UploadFile | None = File(None),
        back_photo: UploadFile | None = File(None),
        idempotency_key: str = Header(..., alias="Idempotency-Key"),
        user=Depends(get_current_user),
    ):
        try:
            return await process_request(
                farm_client_id=farm_client_id,
                plot_number=plot_number,
                symptoms=symptoms,
                description=description,
                close_photo=close_photo,
                whole_photo=whole_photo,
                back_photo=back_photo,
                idempotency_key=idempotency_key,
                user=user,
                service=actual_service,
            )
        except HTTPException as error:
            if error.status_code not in {404, 409, 413, 415, 422, 503}:
                raise
            # A preflight rejection can also happen on a replay. Only promise
            # "not created" after checking this user's exact key in storage.
            def read_existing_request_id():
                with engine.connect() as conn:
                    existing_id = conn.execute(
                        select(requests.c.request_id).where(
                            requests.c.user_id == user["id"],
                            requests.c.idempotency_key == idempotency_key,
                        )
                    ).scalar_one_or_none()
                return existing_id

            existing_id = await run_in_threadpool(read_existing_request_id)
            content = {
                "detail": error.detail,
                "status": "unknown" if existing_id else "rejected_before_creation",
                "request_created": existing_id is not None,
            }
            if existing_id:
                content["request_id"] = existing_id
            return JSONResponse(status_code=error.status_code, content=content, headers=error.headers)

    if demo_enabled and demo_service is not None:
        @router.post("/demo")
        async def create_demo_diagnosis(
            farm_client_id: str = Form(..., min_length=1, max_length=64),
            plot_number: int = Form(..., ge=1, le=6),
            symptoms: list[str] = Form(...),
            description: str = Form(""),
            close_photo: UploadFile = File(...),
            whole_photo: UploadFile | None = File(None),
            back_photo: UploadFile | None = File(None),
            test_outcome: str = Form("diagnosed"),
            idempotency_key: str = Header(..., alias="Idempotency-Key"),
            user=Depends(get_current_user),
        ):
            return await process_request(
                farm_client_id=farm_client_id,
                plot_number=plot_number,
                symptoms=symptoms,
                description=description,
                close_photo=close_photo,
                whole_photo=whole_photo,
                back_photo=back_photo,
                idempotency_key=idempotency_key,
                user=user,
                service=demo_service,
                demo_outcome=test_outcome,
            )

    def history_metadata(row):
        result = row["result"] if isinstance(row["result"], dict) else {}
        saved = result.get("metadata")
        saved = saved if isinstance(saved, dict) else {}
        return {
            "planting_id": row["planting_id"],
            "crop_name": saved.get("crop_name") if isinstance(saved.get("crop_name"), str) else None,
            "symptoms": [s for s in saved.get("symptoms", []) if isinstance(s, str)]
            if isinstance(saved.get("symptoms"), list) else [],
            "description": saved.get("description") if isinstance(saved.get("description"), str) else "",
        }

    @router.get("/history")
    def read_diagnosis_history(
        page: int = Query(1, ge=1),
        page_size: int = Query(10, ge=1, le=50),
        planting_id: int | None = Query(None, ge=1),
        user=Depends(get_current_user),
    ):
        conditions = [
            requests.c.user_id == user["id"],
            requests.c.status == "completed",
            requests.c.outcome.in_(["diagnosed", "uncertain"]),
            requests.c.is_demo.is_(False),
        ]
        with engine.connect() as conn:
            # Options cover all of this user's history, independently of the current page/filter.
            options = conn.execute(
                select(requests).where(*conditions)
                .order_by(requests.c.created_at.desc(), requests.c.request_id.desc())
            ).mappings().all()
            if planting_id is not None:
                conditions.append(requests.c.planting_id == planting_id)
            total = conn.execute(select(func.count()).select_from(requests).where(*conditions)).scalar_one()
            rows = conn.execute(
                select(requests).where(*conditions)
                .order_by(requests.c.created_at.desc(), requests.c.request_id.desc())
                .offset((page - 1) * page_size).limit(page_size)
            ).mappings().all()
        filters = {}
        for row in options:
            info = history_metadata(row)
            if row["planting_id"] is not None:
                filters.setdefault(row["planting_id"], info)
        return {
            "items": [{
                "request_id": row["request_id"],
                "outcome": row["outcome"],
                "created_at": row["created_at"].isoformat(),
                "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
                "result": row["result"],
                **history_metadata(row),
            } for row in rows],
            "total": total, "page": page, "page_size": page_size,
            "plantings": list(filters.values()),
        }

    @router.get("/requests/by-idempotency-key")
    def read_diagnosis_request_by_key(
        idempotency_key: str = Header(..., alias="Idempotency-Key"),
        user=Depends(get_current_user),
    ):
        if not IDEMPOTENCY_KEY_PATTERN.fullmatch(idempotency_key):
            raise HTTPException(422, "올바른 Idempotency-Key가 필요합니다.")
        with engine.connect() as conn:
            request_id = conn.execute(select(requests.c.request_id).where(
                requests.c.user_id == user["id"],
                requests.c.idempotency_key == idempotency_key,
            )).scalar_one_or_none()
        if request_id is None:
            # Not found is an observation, not proof that an in-flight POST
            # cannot commit later. This endpoint never reserves or analyzes.
            raise HTTPException(404, "접수된 요청을 현재 확인할 수 없습니다.")
        return read_diagnosis_request(request_id, user)

    @router.get("/requests/{request_id}")
    def read_diagnosis_request(request_id: str, user=Depends(get_current_user)):
        with engine.connect() as conn:
            row = conn.execute(
                select(requests).where(
                    requests.c.request_id == request_id,
                    requests.c.user_id == user["id"],
                )
            ).mappings().first()
        if row is None:
            raise HTTPException(404, "진단 요청을 찾을 수 없습니다.")
        return {
            **history_metadata(row),
            "request_id": row["request_id"],
            "status": row["status"],
            "outcome": row["outcome"],
            "is_demo": row["is_demo"],
            "quota_reserved": bool(
                row["quota_reserved"]
                and not row["is_demo"]
                and row["usage_date"] == now_kst().date()
            ),
            "quota_consumed": row["quota_consumed"],
            "result": row["result"],
            "error": row["error_message"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "analysis_started_at": row["analysis_started_at"].isoformat() if row["analysis_started_at"] else None,
            "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
        }

    app.include_router(router)
    return requests


def replay_response(row):
    if row["status"] == "completed":
        return {**row["result"], "request_id": row["request_id"], "replayed": True}
    if row["status"] == "failed_before_analysis":
        return JSONResponse(status_code=422, content={
            "status": row["status"],
            "request_id": row["request_id"],
            "is_demo": row["is_demo"],
            "detail": row["error_message"],
        })
    return JSONResponse(status_code=202, content={
        "status": row["status"],
        "request_id": row["request_id"],
        "is_demo": row["is_demo"],
        "quota_reserved": row["quota_reserved"],
        "status_url": f"/diagnoses/requests/{row['request_id']}",
    })
