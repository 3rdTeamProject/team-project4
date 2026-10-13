import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

database_url = os.getenv("DATABASE_URL")

if not database_url:
    raise SystemExit("DATABASE_URL이 .env에 설정되어 있지 않습니다.")

if database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(database_url)

with engine.connect() as conn:
    result = conn.execute(text("SELECT 1"))
    print("DB 연결 성공:", result.scalar())
