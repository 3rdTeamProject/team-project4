"""Daily quota and development-only diagnosis request endpoints."""
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, time, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
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

DAILY_LIMIT = 3
MAX_PHOTO_BYTES = 8 * 1024 * 1024
KST = ZoneInfo("Asia/Seoul")
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
ALLOWED_SYMPTOMS = {"잎 변색", "시듦", "잎에 반점", "구멍", "벌레 보임", "곰팡이", "기타"}


class DiagnosisServiceError(Exception):
    def __init__(self, message: str, analysis_started: bool):
        super().__init__(message)
        self.analysis_started = analysis_started


def now_kst() -> datetime:
    return datetime.now(KST)


def quota_snapshot(conn, requests: Table, user_id: int, current: datetime) -> dict:
    usage_date = current.date()
    rows = conn.execute(
        select(requests.c.quota_reserved, requests.c.quota_consumed).where(
            requests.c.user_id == user_id,
            requests.c.usage_date == usage_date,
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


class DevelopmentDiagnosisService:
    """Explicitly enabled demo responder. It never contacts an external provider."""

    def __init__(self):
        self.calls = 0

    def analyze(self, outcome: str, on_start: Callable[[], None]) -> dict:
        if outcome == "error_before_analysis":
            raise DiagnosisServiceError("테스트 입력 오류입니다.", analysis_started=False)

        on_start()
        self.calls += 1
        if outcome == "error_during_analysis":
            raise DiagnosisServiceError("테스트 분석 오류입니다.", analysis_started=True)
        if outcome == "uncertain":
            return {
                "status": "uncertain",
                "is_demo": True,
                "reason": "데모 예시 사유이며 실제 AI 응답이 아닙니다.",
                "retake_guidance": ["데모 예시 촬영 안내입니다."],
                "additional_checks": ["데모 예시 확인 항목입니다."],
            }
        return {
            "status": "diagnosed",
            "is_demo": True,
            "disease_name": "데모 결과 예시 (실제 병해충명 아님)",
            "evidence": ["데모 예시 근거이며 실제 사진을 분석하지 않았습니다."],
            "management": ["실제 AI 분석 결과가 아닙니다."],
            "additional_checks": ["실제 AI 분석 결과가 아닙니다."],
        }


def register_diagnoses(
    app,
    metadata: MetaData,
    engine,
    get_current_user,
    users: Table,
    plantings: Table,
    crops: Table,
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
        Column("created_at", DateTime(timezone=True), nullable=False, server_default=func_now()),
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
    service = DevelopmentDiagnosisService() if demo_enabled else None
    app.state.diagnosis_service = service

    router = APIRouter(prefix="/diagnoses", tags=["diagnoses"])

    @router.get("/quota")
    def read_quota(user=Depends(get_current_user)):
        with engine.connect() as conn:
            return quota_snapshot(conn, requests, user["id"], now_kst())

    @router.post("")
    async def create_diagnosis(
        planting_id: int = Form(..., gt=0),
        symptoms: list[str] = Form(...),
        description: str = Form(""),
        close_photo: UploadFile = File(...),
        whole_photo: UploadFile | None = File(None),
        back_photo: UploadFile | None = File(None),
        test_outcome: str = Form("diagnosed"),
        idempotency_key: str = Header(..., alias="Idempotency-Key"),
        user=Depends(get_current_user),
    ):
        if service is None:
            raise HTTPException(503, "AI 진단 서비스가 아직 활성화되지 않았습니다.")
        if not IDEMPOTENCY_KEY_PATTERN.fullmatch(idempotency_key):
            raise HTTPException(422, "Idempotency-Key는 8~128자의 영문·숫자·._:-만 사용할 수 있습니다.")
        if not symptoms or len(symptoms) > len(ALLOWED_SYMPTOMS):
            raise HTTPException(422, "증상을 하나 이상 선택해 주세요.")
        if len(set(symptoms)) != len(symptoms) or any(item not in ALLOWED_SYMPTOMS for item in symptoms):
            raise HTTPException(422, "증상 선택 값이 올바르지 않습니다.")
        description = description.strip()
        if len(description) > 1000:
            raise HTTPException(422, "증상 설명은 1000자 이하로 입력해 주세요.")
        if test_outcome not in {"diagnosed", "uncertain", "error_before_analysis", "error_during_analysis"}:
            raise HTTPException(422, "테스트 응답 유형이 올바르지 않습니다.")

        photos = {
            "close": await read_photo(close_photo, "잎 가까이", required=True),
            "whole": await read_photo(whole_photo, "전체 모습", required=False),
            "back": await read_photo(back_photo, "잎 뒷면", required=False),
        }
        fingerprint = request_fingerprint(planting_id, symptoms, description, photos)
        current = now_kst()
        request_id = str(uuid.uuid4())

        with engine.begin() as conn:
            # A write lock on the user's row serializes quota reservations on PostgreSQL and SQLite.
            locked = conn.execute(
                update(users).where(users.c.id == user["id"]).values(id=users.c.id)
            ).rowcount
            if not locked:
                raise HTTPException(401, "사용자를 찾을 수 없습니다.")

            existing = conn.execute(
                select(requests).where(
                    requests.c.user_id == user["id"],
                    requests.c.idempotency_key == idempotency_key,
                )
            ).mappings().first()
            if existing:
                if existing["request_fingerprint"] != fingerprint:
                    raise HTTPException(409, "같은 Idempotency-Key로 다른 진단 내용을 요청할 수 없습니다.")
                return replay_response(existing)

            planting = conn.execute(
                select(plantings.c.id)
                .join(crops, crops.c.id == plantings.c.crop_id)
                .where(
                    plantings.c.id == planting_id,
                    plantings.c.user_id == user["id"],
                    plantings.c.status == "growing",
                )
            ).scalar_one_or_none()
            if planting is None:
                raise HTTPException(404, "사용자 소유의 재배 중인 작물을 찾을 수 없습니다.")

            quota = quota_snapshot(conn, requests, user["id"], current)
            if quota["remaining_count"] == 0:
                return JSONResponse(status_code=429, content={"status": "limit_exceeded", **quota})

            conn.execute(insert(requests).values(
                request_id=request_id,
                user_id=user["id"],
                planting_id=planting,
                usage_date=current.date(),
                status="reserved",
                idempotency_key=idempotency_key,
                request_fingerprint=fingerprint,
                quota_reserved=True,
                quota_consumed=False,
                is_demo=True,
            ))

        def mark_analysis_started():
            started = now_kst()
            with engine.begin() as conn:
                conn.execute(
                    update(requests)
                    .where(requests.c.request_id == request_id, requests.c.status == "reserved")
                    .values(status="processing", analysis_started_at=started)
                )

        try:
            result = service.analyze(test_outcome, mark_analysis_started)
        except DiagnosisServiceError as error:
            if error.analysis_started:
                next_status = "unknown"
                release_reservation = False
            else:
                next_status = "failed_before_analysis"
                release_reservation = True
            completed = now_kst()
            with engine.begin() as conn:
                conn.execute(
                    update(requests)
                    .where(requests.c.request_id == request_id)
                    .values(
                        status=next_status,
                        quota_reserved=not release_reservation,
                        error_message=str(error),
                        completed_at=completed,
                    )
                )
            status_code = 502 if error.analysis_started else 422
            return JSONResponse(status_code=status_code, content={
                "status": next_status,
                "request_id": request_id,
                "is_demo": True,
                "detail": str(error),
                "status_url": f"/diagnoses/requests/{request_id}",
            })
        except Exception:
            completed = now_kst()
            with engine.begin() as conn:
                analysis_started = conn.execute(
                    select(requests.c.analysis_started_at).where(requests.c.request_id == request_id)
                ).scalar_one_or_none() is not None
                conn.execute(
                    update(requests)
                    .where(requests.c.request_id == request_id)
                    .values(
                        status="unknown" if analysis_started else "failed_before_analysis",
                        quota_reserved=analysis_started,
                        error_message="진단 서비스 처리 중 오류가 발생했습니다.",
                        completed_at=completed,
                    )
                )
            return JSONResponse(status_code=502, content={
                "status": "unknown" if analysis_started else "failed_before_analysis",
                "request_id": request_id,
                "is_demo": True,
                "detail": "진단 서비스 처리 중 오류가 발생했습니다.",
                "status_url": f"/diagnoses/requests/{request_id}",
            })

        completed = now_kst()
        with engine.begin() as conn:
            conn.execute(
                update(requests)
                .where(requests.c.request_id == request_id, requests.c.status == "processing")
                .values(
                    status="completed",
                    outcome=result["status"],
                    result=result,
                    quota_reserved=False,
                    quota_consumed=True,
                    completed_at=completed,
                )
            )
            quota = quota_snapshot(conn, requests, user["id"], completed)
        return {
            **result,
            "request_id": request_id,
            "quota": quota,
        }

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
            "request_id": row["request_id"],
            "status": row["status"],
            "outcome": row["outcome"],
            "is_demo": row["is_demo"],
            "quota_reserved": row["quota_reserved"],
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


def func_now():
    from sqlalchemy import func

    return func.now()
