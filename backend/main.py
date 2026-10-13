import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    delete,
    func,
    insert,
    inspect,
    select,
    text,
    update,
)
from pydantic import BaseModel

from level import level_from_exp

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL이 .env에 설정되어 있지 않습니다.")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET이 .env에 설정되어 있지 않습니다.")

if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(DATABASE_URL)
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
    return {"kakao_id": str(info["id"]), "nickname": nickname or "카카오유저"}


# user_id를 가진 데이터 테이블 목록. 카카오 전환 때 비회원 데이터를 옮기거나 지울 때 이 목록을 쓴다.
# 새 테이블을 만들면 ("테이블명", "user_id 컬럼명")만 추가하면 된다. 아직 DB에 없는 테이블은 자동으로 건너뛴다.
# 목록 순서대로 삭제하므로 자식 테이블(다른 테이블을 참조하는 쪽)을 앞에 둔다.
# user_id가 없는 테이블(plots, harvests, task_logs, pest_diagnoses)은 부모 행 삭제 시 ON DELETE CASCADE로 지워져야 한다.
GUEST_DATA_TABLES = [
    ("point_logs", "user_id"),
    ("reward_exchanges", "user_id"),
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
    """GUEST_DATA_TABLES 기준으로 해당 사용자의 데이터를 지우고 포인트·경험치를 0으로 되돌린다."""
    for table_name, column in _existing_data_tables(conn):
        conn.execute(text(f'DELETE FROM "{table_name}" WHERE "{column}" = :uid'), {"uid": user_id})
    conn.execute(update(users).where(users.c.id == user_id).values(point=0, exp=0))


def move_user_data(conn, from_id: int, to_id: int) -> None:
    """from_id의 데이터를 to_id로 옮긴다. 포인트·경험치는 from_id 값이 to_id의 값이 된다."""
    for table_name, column in _existing_data_tables(conn):
        conn.execute(
            text(f'UPDATE "{table_name}" SET "{column}" = :to WHERE "{column}" = :frm'),
            {"to": to_id, "frm": from_id},
        )
    src = conn.execute(select(users).where(users.c.id == from_id)).mappings().one()
    conn.execute(update(users).where(users.c.id == to_id).values(point=src["point"], exp=src["exp"]))


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
    }
