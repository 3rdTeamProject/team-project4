import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

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
    Column("point_balance", Integer, nullable=False, default=0, server_default=text("0")),
    Column("total_points", Integer, nullable=False, default=0, server_default=text("0")),
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


# 비회원 데이터를 카카오 계정으로 옮길 때 user_id를 가진 테이블 목록.
# 새 테이블(예: 인증 기록, 포인트 내역)을 만들면 ("테이블명", "user_id 컬럼명")만 추가하면 된다.
# 아직 DB에 없는 테이블은 자동으로 건너뛴다.
GUEST_DATA_TABLES = [
    # ("checkins", "user_id"),
    # ("point_logs", "user_id"),
]


def transfer_guest_data(conn, guest_id: int, user_id: int) -> None:
    """비회원(guest_id)의 데이터를 기존 카카오 계정(user_id)으로 옮기고 비회원 행을 삭제한다."""
    existing = set(inspect(conn).get_table_names())
    for table_name, column in GUEST_DATA_TABLES:
        if table_name not in existing:
            continue
        conn.execute(
            text(f'UPDATE "{table_name}" SET "{column}" = :to WHERE "{column}" = :frm'),
            {"to": user_id, "frm": guest_id},
        )

    # users 행 자체에 들어 있는 포인트는 카카오 계정에 합산
    guest = conn.execute(select(users).where(users.c.id == guest_id)).mappings().one()
    conn.execute(
        update(users)
        .where(users.c.id == user_id)
        .values(
            point_balance=users.c.point_balance + guest["point_balance"],
            total_points=users.c.total_points + guest["total_points"],
        )
    )
    conn.execute(delete(users).where(users.c.id == guest_id))


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


@app.post("/auth/link-kakao")
def auth_link_kakao(body: KakaoCodeRequest, guest=Depends(get_current_user)):
    if guest["login_type"] != "guest":
        raise HTTPException(400, "비회원 토큰으로만 호출할 수 있습니다.")

    profile = fetch_kakao_profile(body.code)
    with engine.begin() as conn:
        existing_id = conn.execute(
            select(users.c.id).where(users.c.kakao_id == profile["kakao_id"])
        ).scalar_one_or_none()
        if existing_id is None:
            # 새 카카오 계정: 현재 비회원 행을 카카오 회원으로 전환
            conn.execute(
                update(users)
                .where(users.c.id == guest["id"])
                .values(
                    nickname=profile["nickname"],
                    kakao_id=profile["kakao_id"],
                    login_type="kakao",
                    guest_token=None,
                )
            )
            user_id = guest["id"]
        else:
            # 이미 있는 카카오 계정: 데이터를 옮기고 비회원 행 삭제
            transfer_guest_data(conn, guest["id"], existing_id)
            user_id = existing_id
    return {"access_token": create_token(user_id), "token_type": "bearer"}


@app.get("/me")
def read_me(user=Depends(get_current_user)):
    return {
        "id": user["id"],
        "nickname": user["nickname"],
        "login_type": user["login_type"],
        "region": user["region"],
        "point_balance": user["point_balance"],
        "total_points": user["total_points"],
    }
