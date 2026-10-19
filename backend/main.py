import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    delete,
    event,
    func,
    insert,
    inspect,
    select,
    text,
    update,
)
from pydantic import BaseModel

from level import level_from_exp
from garden import register_garden
from shop import register_shop
from diagnosis import register_diagnoses

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30
NICKNAME_MAX_LENGTH = 10  # 화면에 보이는 글자 기준(이모티콘도 1자). 프론트 NicknameSheet와 같게 유지

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL이 .env에 설정되어 있지 않습니다.")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET이 .env에 설정되어 있지 않습니다.")

if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(DATABASE_URL)

if DATABASE_URL.startswith("sqlite"):
    # 테스트용 SQLite도 실제 DB(PostgreSQL)처럼 외래키 연쇄 삭제를 적용한다
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("nickname", String(50), nullable=False),
    Column("kakao_id", String(64), nullable=True, unique=True),
    Column("login_type", String(10), nullable=False),
    Column("guest_token", String(64), nullable=True, unique=True),
    Column("region", String(50), nullable=True),
    Column("point", Integer, nullable=False, default=0, server_default=text("0")),  # 현재 포인트(교환하면 줄어듦)
    Column("exp", Integer, nullable=False, default=0, server_default=text("0")),  # 누적 경험치(안 줄어듦)
    Column("diag_credits", Integer, nullable=False, default=0, server_default=text("0")),  # AI진단 남은 횟수(포인트샵 기능 상품으로 충전)
    # 알림 설정 (실제 푸시 발송은 아직 없음, 설정값만 저장)
    Column("notify_todo", Boolean, nullable=False, default=True, server_default=text("true")),
    Column("notify_todo_time", String(5), nullable=False, default="09:00", server_default=text("'09:00'")),  # 오늘 할 일 알림 시간 (HH:MM)
    Column("notify_weather", Boolean, nullable=False, default=True, server_default=text("true")),
    Column("notify_point", Boolean, nullable=False, default=False, server_default=text("false")),
    # 텃밭 화면의 움직임 효과 켜짐/꺼짐
    Column("motion_effects", Boolean, nullable=False, default=True, server_default=text("true")),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint("login_type IN ('guest', 'kakao')", name="users_login_type_check"),
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    metadata.create_all(engine)  # 테이블이 없을 때만 생성
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
bearer = HTTPBearer()


def create_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")

    with engine.connect() as conn:
        row = conn.execute(select(users).where(users.c.id == user_id)).mappings().first()
    if row is None:
        raise HTTPException(status_code=401, detail="존재하지 않는 사용자입니다.")
    return row


@app.get("/")
def read_root():
    return {"status": "ok"}


class GuestRequest(BaseModel):
    guest_token: str | None = None


@app.post("/auth/guest")
def auth_guest(body: GuestRequest | None = None):
    guest_token = body.guest_token if body else None
    with engine.begin() as conn:
        user_id = None
        if guest_token:
            user_id = conn.execute(
                select(users.c.id).where(
                    users.c.guest_token == guest_token,
                    users.c.login_type == "guest",
                )
            ).scalar_one_or_none()
        if user_id is None:
            guest_token = secrets.token_urlsafe(32)
            user_id = conn.execute(
                insert(users)
                .values(
                    nickname=f"게스트{secrets.randbelow(10**6):06d}",
                    login_type="guest",
                    guest_token=guest_token,
                )
                .returning(users.c.id)
            ).scalar_one()
    return {
        "access_token": create_token(user_id),
        "token_type": "bearer",
        "guest_token": guest_token,
    }


KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"
KAKAO_USER_URL = "https://kapi.kakao.com/v2/user/me"


class KakaoCodeRequest(BaseModel):
    code: str


def fetch_kakao_profile(code: str) -> dict:
    """인가 코드로 카카오 토큰을 받고 {"kakao_id", "nickname"}을 돌려준다."""
    api_key = os.getenv("KAKAO_REST_API_KEY")
    redirect_uri = os.getenv("KAKAO_REDIRECT_URI")
    if not api_key or not redirect_uri:
        raise HTTPException(500, "KAKAO_REST_API_KEY / KAKAO_REDIRECT_URI가 .env에 없습니다.")

    data = {
        "grant_type": "authorization_code",
        "client_id": api_key,
        "redirect_uri": redirect_uri,
        "code": code,
    }
    if os.getenv("KAKAO_CLIENT_SECRET"):
        data["client_secret"] = os.getenv("KAKAO_CLIENT_SECRET")

    try:
        with httpx.Client(timeout=10) as client:
            token_res = client.post(KAKAO_TOKEN_URL, data=data)
            if token_res.status_code != 200:
                raise HTTPException(400, f"카카오 토큰 발급 실패: {token_res.text}")
            kakao_access = token_res.json()["access_token"]

            user_res = client.get(
                KAKAO_USER_URL, headers={"Authorization": f"Bearer {kakao_access}"}
            )
            if user_res.status_code != 200:
                raise HTTPException(502, f"카카오 사용자 조회 실패: {user_res.text}")
    except httpx.HTTPError:
        raise HTTPException(502, "카카오 서버와 통신할 수 없습니다.")

    info = user_res.json()
    profile = (info.get("kakao_account") or {}).get("profile") or {}
    nickname = profile.get("nickname") or (info.get("properties") or {}).get("nickname")
    # 기본 닉네임은 거부 규칙 없이 앞 NICKNAME_MAX_LENGTH자만 잘라 저장한다
    return {"kakao_id": str(info["id"]), "nickname": (nickname or "카카오유저")[:NICKNAME_MAX_LENGTH]}


# user_id를 가진 데이터 테이블 목록. 카카오 전환 때 비회원 데이터를 옮기거나 지울 때 이 목록을 쓴다.
# 새 테이블을 만들면 ("테이블명", "user_id 컬럼명")만 추가하면 된다. 아직 DB에 없는 테이블은 자동으로 건너뛴다.
# 목록 순서대로 삭제하므로 자식 테이블(다른 테이블을 참조하는 쪽)을 앞에 둔다.
# user_id가 없는 테이블(plots, harvests, task_logs, pest_diagnoses)은 부모 행 삭제 시 ON DELETE CASCADE로 지워져야 한다.
GUEST_DATA_TABLES = [
    ("cart_items", "user_id"),  # 비회원 장바구니: 카카오 연동 때 이 목록 처리로 함께 옮겨지거나(비회원 선택) 지워진다(카카오 선택)
    ("shipping_addresses", "user_id"),
    ("point_logs", "user_id"),
    ("reward_exchanges", "user_id"),
    ("orders", "user_id"),  # reward_exchanges가 orders를 참조하므로 reward_exchanges 다음에 둔다
    ("daily_diagnosis_requests", "user_id"),
    ("journals", "user_id"),
    ("plantings", "user_id"),
    ("farms", "user_id"),
]

LINK_TICKET_EXPIRE_MINUTES = 5


def _existing_data_tables(conn) -> list[tuple[str, str]]:
    existing = set(inspect(conn).get_table_names())
    return [(t, c) for t, c in GUEST_DATA_TABLES if t in existing]


def _count(conn, table: str, column: str, user_id: int, extra: str = "") -> int:
    return conn.execute(
        text(f'SELECT COUNT(*) FROM "{table}" WHERE "{column}" = :uid {extra}'),
        {"uid": user_id},
    ).scalar_one()


def summarize_user_data(conn, user_id: int) -> dict:
    """선택 화면에 보여줄 요약: 닉네임, 농장 수, 재배 중 작물 수, 일지 수, 레벨, 경험치, 포인트."""
    tables = dict(_existing_data_tables(conn))
    row = conn.execute(select(users).where(users.c.id == user_id)).mappings().one()
    return {
        "nickname": row["nickname"],
        "farms": _count(conn, "farms", tables["farms"], user_id) if "farms" in tables else 0,
        "growing_crops": (
            _count(conn, "plantings", tables["plantings"], user_id, "AND status = 'growing'")
            if "plantings" in tables
            else 0
        ),
        "journals": _count(conn, "journals", tables["journals"], user_id) if "journals" in tables else 0,
        "level": level_from_exp(row["exp"]),
        "exp": row["exp"],
        "point": row["point"],
    }


def user_info(user_id: int) -> dict:
    with engine.connect() as conn:
        row = conn.execute(select(users).where(users.c.id == user_id)).mappings().one()
    return {
        "id": row["id"],
        "nickname": row["nickname"],
        "login_type": row["login_type"],
        "region": row["region"],
        "point": row["point"],
        "exp": row["exp"],
        "level": level_from_exp(row["exp"]),
    }


def has_data(summary: dict) -> bool:
    return any(summary[k] > 0 for k in ("farms", "growing_crops", "journals", "exp", "point"))


def delete_user_data(conn, user_id: int) -> None:
    """GUEST_DATA_TABLES 기준으로 해당 사용자의 데이터를 지우고 포인트·경험치·AI진단 횟수를 0으로 되돌린다."""
    for table_name, column in _existing_data_tables(conn):
        conn.execute(text(f'DELETE FROM "{table_name}" WHERE "{column}" = :uid'), {"uid": user_id})
    conn.execute(update(users).where(users.c.id == user_id).values(point=0, exp=0, diag_credits=0))


def move_user_data(conn, from_id: int, to_id: int) -> None:
    """from_id의 데이터를 to_id로 옮긴다. 포인트·경험치는 from_id 값이 to_id의 값이 된다."""
    for table_name, column in _existing_data_tables(conn):
        conn.execute(
            text(f'UPDATE "{table_name}" SET "{column}" = :to WHERE "{column}" = :frm'),
            {"to": to_id, "frm": from_id},
        )
    src = conn.execute(select(users).where(users.c.id == from_id)).mappings().one()
    conn.execute(
        update(users).where(users.c.id == to_id).values(point=src["point"], exp=src["exp"], diag_credits=src["diag_credits"])
    )


def create_link_ticket(guest_id: int, kakao_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "link-kakao",
        "guest_id": guest_id,
        "kakao_id": kakao_id,
        "iat": now,
        "exp": now + timedelta(minutes=LINK_TICKET_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def read_link_ticket(ticket: str, guest_id: int) -> str:
    """link_ticket을 검증하고 kakao_id를 돌려준다."""
    try:
        payload = jwt.decode(ticket, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(400, "link_ticket이 만료되었거나 유효하지 않습니다.")
    if payload.get("purpose") != "link-kakao" or payload.get("guest_id") != guest_id:
        raise HTTPException(400, "link_ticket이 유효하지 않습니다.")
    return payload["kakao_id"]


@app.post("/auth/kakao")
def auth_kakao(body: KakaoCodeRequest):
    profile = fetch_kakao_profile(body.code)
    with engine.begin() as conn:
        user_id = conn.execute(
            select(users.c.id).where(users.c.kakao_id == profile["kakao_id"])
        ).scalar_one_or_none()
        if user_id is None:
            user_id = conn.execute(
                insert(users)
                .values(
                    nickname=profile["nickname"],
                    kakao_id=profile["kakao_id"],
                    login_type="kakao",
                )
                .returning(users.c.id)
            ).scalar_one()
    return {"access_token": create_token(user_id), "token_type": "bearer"}


class LinkKakaoRequest(BaseModel):
    code: str | None = None  # 카카오 인가 코드 (첫 호출)
    link_ticket: str | None = None  # choice_required 응답으로 받은 값 (선택 후 호출, 인가 코드는 재사용 불가)
    choice: Literal["guest", "kakao"] | None = None


@app.post("/auth/link-kakao")
def auth_link_kakao(body: LinkKakaoRequest, guest=Depends(get_current_user)):
    if guest["login_type"] != "guest":
        raise HTTPException(400, "비회원 토큰으로만 호출할 수 있습니다.")

    if body.link_ticket:
        kakao_id, nickname = read_link_ticket(body.link_ticket, guest["id"]), None
    elif body.code:
        profile = fetch_kakao_profile(body.code)
        kakao_id, nickname = profile["kakao_id"], profile["nickname"]
    else:
        raise HTTPException(422, "code 또는 link_ticket이 필요합니다.")

    # 전환·삭제·이동은 한 트랜잭션: 중간에 실패하면 전부 취소된다.
    with engine.begin() as conn:
        existing_id = conn.execute(
            select(users.c.id).where(users.c.kakao_id == kakao_id)
        ).scalar_one_or_none()

        if existing_id is None:
            # 새 카카오 계정: 현재 비회원 행을 카카오 회원으로 전환 (데이터 그대로)
            conn.execute(
                update(users)
                .where(users.c.id == guest["id"])
                .values(
                    nickname=nickname or guest["nickname"],
                    kakao_id=kakao_id,
                    login_type="kakao",
                    guest_token=None,
                )
            )
            user_id = guest["id"]
        else:
            kakao_summary = summarize_user_data(conn, existing_id)
            if has_data(kakao_summary) and body.choice is None:
                # 아무것도 바꾸지 않고 양쪽 요약만 돌려준다.
                return {
                    "status": "choice_required",
                    "link_ticket": create_link_ticket(guest["id"], kakao_id),
                    "guest": summarize_user_data(conn, guest["id"]),
                    "kakao": kakao_summary,
                }

            if body.choice == "kakao":
                delete_user_data(conn, guest["id"])  # 카카오 데이터는 그대로 유지
            else:
                # 카카오 데이터가 없거나 "guest" 선택: 카카오 쪽을 비우고 비회원 데이터를 옮김
                delete_user_data(conn, existing_id)
                move_user_data(conn, guest["id"], existing_id)
            conn.execute(delete(users).where(users.c.id == guest["id"]))
            user_id = existing_id
    return {
        "status": "linked",
        "access_token": create_token(user_id),
        "token_type": "bearer",
        "user": user_info(user_id),
    }


@app.get("/me")
def read_me(user=Depends(get_current_user)):
    return {
        "id": user["id"],
        "nickname": user["nickname"],
        "login_type": user["login_type"],
        "region": user["region"],
        "point": user["point"],
        "exp": user["exp"],
        "notify_todo": user["notify_todo"],
        "notify_todo_time": user["notify_todo_time"],
        "notify_weather": user["notify_weather"],
        "notify_point": user["notify_point"],
    }


# 줄바꿈으로 취급하는 문자 (닉네임에 들어 있으면 거부)
NICKNAME_LINE_BREAKS = {"\n", "\r", "\x0b", "\x0c", "\x85", "\u2028", "\u2029"}


class NicknameRequest(BaseModel):
    nickname: str


def validate_nickname(raw: str) -> str:
    """직접 바꾸는 닉네임 검사. 앞뒤 공백을 뺀 값을 돌려주고, 규칙에 어긋나면 400."""
    nickname = raw.strip()
    if not nickname:
        raise HTTPException(400, "닉네임을 입력해 주세요.")
    if any(ch in NICKNAME_LINE_BREAKS for ch in nickname):
        raise HTTPException(400, "닉네임에는 줄바꿈을 넣을 수 없어요.")
    if len(nickname) > NICKNAME_MAX_LENGTH:  # 이모티콘도 한 글자
        raise HTTPException(400, f"닉네임은 1~{NICKNAME_MAX_LENGTH}자로 입력해 주세요.")
    return nickname


@app.patch("/me/nickname")
def update_nickname(body: NicknameRequest, user=Depends(get_current_user)):
    nickname = validate_nickname(body.nickname)
    with engine.begin() as conn:
        conn.execute(update(users).where(users.c.id == user["id"]).values(nickname=nickname))
    return {"nickname": nickname}


@app.get("/me/summary")
def read_my_summary(user=Depends(get_current_user)):
    """마이페이지용 통계와 최근 포인트 내역. 아직 만들어지지 않은 테이블은 0/빈 목록으로 돌려준다."""
    uid = {"uid": user["id"]}
    with engine.connect() as conn:
        names = set(inspect(conn).get_table_names())  # 테이블 존재 확인은 한 번만 조회한다
        def count(table: str, sql: str) -> int:
            if not (table in names):
                return 0
            return conn.execute(text(sql), uid).scalar_one()

        has_plantings = ("plantings" in names)
        farms = count("farms", "SELECT COUNT(*) FROM farms WHERE user_id = :uid")
        growing = count("plantings", "SELECT COUNT(*) FROM plantings WHERE user_id = :uid AND status = 'growing'")
        if has_plantings and ("harvests" in names):
            harvested = conn.execute(
                text(
                    "SELECT COUNT(*) FROM harvests h JOIN plantings p ON p.id = h.planting_id "
                    "WHERE p.user_id = :uid"
                ),
                uid,
            ).scalar_one()
        else:
            # harvests 테이블이 생기기 전에는 텃밭 화면이 남기는 "수확을 마쳤어요" 기록 수로 센다
            harvested = count("journals", "SELECT COUNT(*) FROM journals WHERE user_id = :uid AND content LIKE '%수확을 마쳤어요%'")
        journals = count("journals", "SELECT COUNT(*) FROM journals WHERE user_id = :uid")
        diagnoses = (
            conn.execute(
                text(
                    "SELECT COUNT(*) FROM pest_diagnoses d JOIN plantings p ON p.id = d.planting_id "
                    "WHERE p.user_id = :uid"
                ),
                uid,
            ).scalar_one()
            if has_plantings and ("pest_diagnoses" in names)
            else 0
        )
        point_logs = []
        if ("point_logs" in names):
            rows = conn.execute(
                text(
                    "SELECT reason, amount, created_at FROM point_logs "
                    "WHERE user_id = :uid ORDER BY created_at DESC, id DESC LIMIT 5"
                ),
                uid,
            ).mappings()
            point_logs = [
                {"name": r["reason"], "amount": r["amount"], "created_at": (r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else r["created_at"])}
                for r in rows
            ]
    return {
        "farms": farms,
        "growing_crops": growing,
        "harvested": harvested,
        "journals": journals,
        "diagnoses": diagnoses,
        "point_logs": point_logs,  # 최근 5건, 최신순 (경험치는 내려주지 않음)
    }


@app.get("/me/point-logs")
def read_point_logs(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    user=Depends(get_current_user),
):
    """포인트 내역 전체 보기. offset부터 limit건씩 최신순으로 내려주고, 더 있는지(has_more)도 알려준다."""
    with engine.connect() as conn:
        if "point_logs" not in set(inspect(conn).get_table_names()):
            return {"items": [], "has_more": False}
        rows = conn.execute(
            text(
                "SELECT reason, amount, created_at FROM point_logs "
                "WHERE user_id = :uid ORDER BY created_at DESC, id DESC LIMIT :n OFFSET :off"
            ).columns(reason=String, amount=Integer, created_at=DateTime),  # 날짜를 DB 종류와 무관하게 datetime으로 받는다
            {"uid": user["id"], "n": limit + 1, "off": offset},  # 한 건 더 읽어 다음 페이지 유무를 안다
        ).mappings().all()
    return {
        "items": [
            {"name": r["reason"], "amount": r["amount"], "created_at": r["created_at"].isoformat()}
            for r in rows[:limit]
        ],
        "has_more": len(rows) > limit,
    }


class NotificationRequest(BaseModel):
    # 보낸 항목만 바꾼다
    notify_todo: bool | None = None
    notify_todo_time: str | None = None  # HH:MM (24시간)
    notify_weather: bool | None = None
    notify_point: bool | None = None


@app.patch("/me/notifications")
def update_notifications(body: NotificationRequest, user=Depends(get_current_user)):
    values = body.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(400, "바꿀 알림 설정을 보내 주세요.")
    if "notify_todo_time" in values and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", values["notify_todo_time"]):
        raise HTTPException(400, "알림 시간은 HH:MM 형식으로 보내 주세요.")
    with engine.begin() as conn:
        conn.execute(update(users).where(users.c.id == user["id"]).values(**values))
        row = conn.execute(select(users).where(users.c.id == user["id"])).mappings().one()
    return {k: row[k] for k in ("notify_todo", "notify_todo_time", "notify_weather", "notify_point")}


# Registered before lifespan creates the tables.
garden_tables = register_garden(app, metadata, engine, get_current_user, users)
register_shop(app, metadata, engine, get_current_user, users)
register_diagnoses(
    app,
    metadata,
    engine,
    get_current_user,
    users,
    garden_tables["plantings"],
    garden_tables["crops"],
)
