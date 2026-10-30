"""사용자별 텃밭 저장. 공통 설계의 farms / plots / crops / crop_stages / plantings / journals 테이블에 저장한다.

홈 화면(frontend/public/garden)은 농장 전체를 하나의 문서(JSON)로 주고받는다. 그 방식은 그대로 두고,
서버가 문서를 받을 때 테이블로 나눠 저장하고, 줄 때 테이블에서 다시 조립한다(GET/PUT /garden/state).
화면에는 있지만 공통 설계에 없는 값은 설계 테이블에 컬럼을 덧붙여 저장한다(아래 '설계 밖 컬럼' 참고).
"""
import hashlib
import io
import json
import math
import os
import re
from datetime import date, timedelta
from typing import Literal
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    and_,
    delete,
    func,
    insert,
    or_,
    select,
    text,
    update,
)

from tasks import TRANSPLANT_STAGE_NO, crops_with_tasks, method_of, register_tasks, start_planting, today_kst

# 홈 화면의 작물 종류(kind) ↔ crops 테이블의 이름. 오이는 봄/여름 두 작물로 나뉜다.
# 작물별 단계·할 일은 crops / crop_stages / crop_tasks 행(Supabase에 SQL로 입력)이 정한다.
# 재배 일수(예상 수확까지)는 새 작물 행을 만들 때의 임시 값이고, 오이는 DB 행의 total_days를 쓰지 않는다.
KIND_CROPS = {
    'tomato': '방울토마토',
    'lettuce': '상추',
    'cucumber_spring': '오이(봄)',
    'cucumber_summer': '오이(여름)',
    'pepper': '고추',
    'eggplant': '가지',
    'zucchini': '애호박',
}
KIND_DAYS = {
    '방울토마토': 90, '상추': 45, '오이(봄)': 60, '오이(여름)': 70, '고추': 90, '가지': 85, '애호박': 60,
}
NAME_TO_KIND = {name: kind for kind, name in KIND_CROPS.items()}
# 예전 '오이' 행은 오이(봄)으로 이름을 바꿔 쓴다. 바꾸기 전에도 같은 작물로 보고, 새 행을 따로 만들지 않는다.
LEGACY_NAMES = {'오이(봄)': '오이'}
NAME_TO_KIND['오이'] = 'cucumber_spring'


# 작물 선택 화면의 분류. 계절이 붙은 이름은 괄호를 떼고 찾는다(예: 무(봄) → 무). 표에 없는 작물은 'other'
CROP_CATEGORIES = {
    'leaf': ('상추', '시금치', '근대', '쑥갓', '아욱', '갓', '신선초', '부추', '미나리'),  # 잎채소
    'fruit': ('방울토마토', '오이', '고추', '가지', '애호박', '딸기'),  # 과일채소(열매를 먹는 채소)
    'root': ('당근', '무', '비트', '마늘', '생강'),  # 뿌리채소
    'stem': ('셀러리', '브로콜리', '아스파라거스'),  # 줄기·꽃채소
    'wild': ('곰취', '두릅', '고사리', '냉이', '고들빼기'),  # 산나물
}
CATEGORY_OF_NAME = {name: category for category, names in CROP_CATEGORIES.items() for name in names}


def category_of_crop(name: str) -> str:
    return CATEGORY_OF_NAME.get(re.sub(r'\(.*\)$', '', name), 'other')


def kind_of_crop(crop_id: int, name: str) -> str:
    """crops 행 하나를 화면이 쓰는 종류 이름표로 바꾼다. 처음 7종은 예전 이름표, 나머지는 'crop-<id>'."""
    return NAME_TO_KIND.get(name) or f'crop-{crop_id}'


def check_method(crop: dict, method: str) -> None:
    """그 작물이 허용하지 않는 방식(씨앗/모종)이면 거부한다."""
    allowed = {'seed': crop['allow_seed'], 'seedling': crop['allow_seedling']}
    if method not in allowed:
        raise HTTPException(422, '심는 방식은 씨앗 또는 모종이어야 해요.')
    if not allowed[method]:
        only = '모종' if method == 'seed' else '씨앗'
        raise HTTPException(422, f"{crop['name']}은(는) {only}으로만 심을 수 있어요.")


class Plant(BaseModel):
    kind: str  # 처음 7종은 KIND_CROPS의 이름표, 그 밖의 작물은 'crop-<crops.id>'
    # 단계는 재배 기간으로 화면이 계산한다. 할 일이 있는 작물은 서버가 정한 값을 쓴다(씨앗을 옮겨심기 전에는 0단계).
    stage: int = Field(ge=0, le=5)
    needsWater: bool = False
    wateredAt: date | None = None
    plantedAt: date
    method: Literal['seed', 'seedling'] | None = None
    harvestedAt: date | None = None
    lastHarvestedAt: date | None = None  # 서버가 정한다(마지막 수확일). 화면이 보낸 값은 쓰지 않는다
    taskChecks: dict[str, list[Literal['water', 'care', 'observe']]] = Field(default_factory=dict)
    draftMemo: str = Field(default='', max_length=500)
    draftPhotos: list[str] = Field(default_factory=list, max_length=4)

    @field_validator('kind')
    @classmethod
    def validate_kind(cls, kind):
        if kind not in KIND_CROPS and not re.fullmatch(r'crop-\d{1,9}', kind):
            raise ValueError('알 수 없는 작물이에요.')
        return kind

    @field_validator('draftPhotos')
    @classmethod
    def validate_draft_photos(cls, photos):
        if any(not photo.startswith('data:image/jpeg;base64,') or len(photo) > 2000000 for photo in photos):
            raise ValueError('유효한 JPG 사진만 저장할 수 있어요.')
        return photos


KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json'
KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json'


class Location(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    label: str = Field(max_length=120)


class Farm(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=12)
    region: str = Field(max_length=40)
    plots: list[Plant | None] = Field(min_length=6, max_length=6)
    weatherLocation: Location | None = None

    @field_validator('name')
    @classmethod
    def trim_name(cls, value):
        if not value.strip():
            raise ValueError('농장 이름을 입력해 주세요.')
        return value.strip()


class Record(BaseModel):
    farm: str = Field(max_length=12)
    crop: str = Field(max_length=20)
    text: str = Field(max_length=500)
    date: str = Field(max_length=80)
    photos: list[str] = Field(default_factory=list, max_length=4)
    journalId: int | None = Field(default=None, ge=1)
    plantingId: int | None = Field(default=None, ge=1)
    event: Literal['planting', 'journal'] | None = None
    plantingMethod: Literal['seed', 'seedling'] | None = None
    plotRef: str | None = Field(default=None, max_length=80)

    @field_validator('photos')
    @classmethod
    def validate_photos(cls, photos):
        if any(not photo.startswith('data:image/jpeg;base64,') or len(photo) > 2000000 for photo in photos):
            raise ValueError('유효한 JPG 사진만 저장할 수 있어요.')
        return photos


class Settings(BaseModel):
    motion: bool = True


class GardenState(BaseModel):
    farms: list[Farm] = Field(max_length=100)
    records: list[Record] = Field(max_length=10000)
    settings: Settings = Field(default_factory=Settings)

    # 화면이 보내는 points는 무시한다(실제 포인트는 /me의 users.point).
    @model_validator(mode='after')
    def unique_ids(self):
        if len({item.id for item in self.farms}) != len(self.farms):
            raise ValueError('중복된 ID가 있습니다.')
        return self


class SaveGarden(BaseModel):
    # 저장할 때 마지막으로 받은 revision(현재 저장된 내용의 지문)을 그대로 돌려보낸다. 다른 탭에서 바뀌었으면 409.
    revision: str = Field(min_length=1, max_length=64)
    state: GardenState


def revision_of(state: dict) -> str:
    """저장된 내용의 지문. 내용이 같으면 같고, 바뀌면 달라진다(포인트와 성장 단계는 포함하지 않는다)."""
    # 성장 단계는 서버가 정하므로(시간·할 일 완료로 바뀜) 지문에 넣지 않는다
    plain = {**state, 'farms': [
        {**farm, 'plots': [None if plant is None else {k: v for k, v in plant.items() if k != 'stage'} for plant in farm['plots']]}
        for farm in state['farms']
    ]}
    raw = json.dumps(plain, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]


def register_garden(app, metadata, engine, get_current_user, users):
    farms = Table(
        'farms', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('name', String(12), nullable=False),
        Column('region', String(40), nullable=True),
        Column('created_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
        # 설계 밖 컬럼: 홈 화면이 정한 농장 ID(문자열), 날씨 조회 위치(위도·경도·이름)
        Column('client_id', String(64), nullable=False),
        Column('weather_location', JSON(none_as_null=True), nullable=True),
        UniqueConstraint('user_id', 'client_id', name='farms_user_client_uq'),
    )
    plots = Table(
        'plots', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('farm_id', Integer, ForeignKey('farms.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('position', SmallInteger, nullable=False),
        CheckConstraint('position BETWEEN 1 AND 6', name='plots_position_check'),
        UniqueConstraint('farm_id', 'position', name='plots_farm_position_uq'),
    )
    crops = Table(
        'crops', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('name', String(50), nullable=False, unique=True),
        Column('total_days', Integer, nullable=True),  # 쓰지 않음(성장 단계 계산에 안 씀)
        Column('pest_diagnosable', Boolean, nullable=False, default=False, server_default=text('false')),
        # 심는 방식 제한: 직파 작물은 allow_seedling=false, 모종만 가능한 작물은 allow_seed=false
        Column('allow_seed', Boolean, nullable=False, default=True, server_default=text('true')),
        Column('allow_seedling', Boolean, nullable=False, default=True, server_default=text('true')),
        # 작물 도감용 정보(Supabase에 SQL로 입력). 값이 없는 작물은 null
        Column('sow_months', ARRAY(Integer).with_variant(JSON, 'sqlite'), nullable=True),  # 심는 달(1~12)
        Column('harvest_months', ARRAY(Integer).with_variant(JSON, 'sqlite'), nullable=True),  # 거두는 달(1~12)
        Column('germ_temp', Text, nullable=True),
        Column('grow_temp', Text, nullable=True),
        Column('soil', Text, nullable=True),
        Column('summary', Text, nullable=True),
    )
    crop_tasks = Table(
        'crop_tasks', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('crop_id', Integer, ForeignKey('crops.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('title', String(100), nullable=False),
        Column('points', Integer, nullable=False, default=0, server_default=text('0')),
        Column('seed_only', Boolean, nullable=False, default=False, server_default=text('false')),
        # 체크하는 할 일이 아니라 '심기 전 준비' 화면에 바로 보여주기만 하는 안내(예: 밭에 석회·퇴비 섞기)
        Column('info_only', Boolean, nullable=False, default=False, server_default=text('false')),
        # 씨앗으로 심을 때 '심었어요'를 누르는 순간 완료되는 작업(예: 포트에 씨앗 심기). 오늘 할 일에는 나오지 않는다
        Column('plant_task', Boolean, nullable=False, default=False, server_default=text('false')),
        Column('anchor', String(10), nullable=False),  # 'sow'(파종일) / 'transplant'(옮겨심은 날)
        Column('start_day', Integer, nullable=True),
        Column('end_day', Integer, nullable=True),
        Column('repeat_min_days', Integer, nullable=True),
        Column('repeat_max_days', Integer, nullable=True),
        Column('after_task_id', Integer, ForeignKey('crop_tasks.id', ondelete='SET NULL'), nullable=True),
        Column('tip', Text, nullable=True),
        Column('how_to', Text, nullable=True),
        Column('image_url', Text, nullable=True),
        CheckConstraint("anchor IN ('sow', 'transplant')", name='crop_tasks_anchor_check'),
    )
    crop_stages = Table(
        'crop_stages', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('crop_id', Integer, ForeignKey('crops.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('stage_no', SmallInteger, nullable=False),
        Column('start_day', Integer, nullable=True),  # 씨앗으로 심었을 때 파종 후 며칠(시간으로 올라가는 단계만)
        Column('name', String(50), nullable=False),
        Column('trigger_task_id', Integer, ForeignKey('crop_tasks.id', ondelete='SET NULL'), nullable=True),
        CheckConstraint('stage_no BETWEEN 1 AND 5', name='crop_stages_stage_no_check'),
        UniqueConstraint('crop_id', 'stage_no', name='crop_stages_crop_stage_uq'),
    )
    plantings = Table(
        'plantings', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        # 농장을 삭제하면 칸이 지워지므로 plot_id는 비운다(재배 줄은 남기고 ended로 바꿈)
        Column('plot_id', Integer, ForeignKey('plots.id', ondelete='SET NULL'), nullable=True, index=True),
        Column('crop_id', Integer, ForeignKey('crops.id'), nullable=False),
        Column('status', String(10), nullable=False, default='growing', server_default=text("'growing'")),
        Column('planted_at', Date, nullable=False),
        # 설계 밖 컬럼: 홈 화면이 직접 정하는 성장 단계와 물주기 상태
        Column('stage', SmallInteger, nullable=False, default=1, server_default=text('1')),
        Column('needs_water', Boolean, nullable=False, default=False, server_default=text('false')),
        Column('watered_at', Date, nullable=True),
        CheckConstraint("status IN ('signed', 'growing', 'harvested', 'ended')", name='plantings_status_check'),
        CheckConstraint('stage BETWEEN 1 AND 5', name='plantings_stage_check'),
    )
    # ended가 아닌 재배는 한 칸에 하나만
    Index(
        'plantings_one_active_per_plot', plantings.c.plot_id, unique=True,
        postgresql_where=text("status <> 'ended'"), sqlite_where=text("status <> 'ended'"),
    )
    journals = Table(
        'journals', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        # 설계는 필수 FK지만, 홈 화면의 기록은 재배와 연결 정보가 없을 수 있어 비울 수 있게 한다
        Column('planting_id', Integer, ForeignKey('plantings.id', ondelete='SET NULL'), nullable=True, index=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('content', Text, nullable=False),
        Column('photo_url', Text, nullable=True),
        Column('created_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
        Column('updated_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
        # 설계 밖 컬럼: 홈 화면 기록에 적힌 농장 이름·작물 이름·날짜 글자(농장을 지워도 기록은 남는다)
        Column('farm_name', String(12), nullable=True),
        Column('crop_name', String(20), nullable=True),
        Column('date_label', String(80), nullable=True),
    )
    journal_meta = Table(
        'garden_journal_meta', metadata,
        Column('journal_id', Integer, ForeignKey('journals.id', ondelete='CASCADE'), primary_key=True),
        Column('record_type', String(16), nullable=False, server_default='journal'),
        Column('planting_method', String(16), nullable=True),
        Column('plot_ref', String(80), nullable=True),
    )
    original_photos = Table(
        'garden_original_photos', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('journal_id', Integer, ForeignKey('journals.id', ondelete='SET NULL'), nullable=True, index=True),
        Column('preview_hash', String(64), nullable=False),
        Column('storage_path', Text, nullable=False),  # 기존 Storage 스키마 호환용, DB 저장 시 빈 문자열
        Column('photo_data', LargeBinary, nullable=True),
        Column('filename', String(255), nullable=False),
        Column('content_type', String(32), nullable=False),
        UniqueConstraint('user_id', 'preview_hash', name='garden_original_photos_owner_preview_uq'),
    )
    care = Table(
        'garden_plant_care', metadata,
        Column('planting_id', Integer, ForeignKey('plantings.id', ondelete='CASCADE'), primary_key=True),
        Column('details', JSON, nullable=False),  # method, harvestedAt, taskChecks, draftMemo, draftPhotos
    )
    task_logs = Table(
        'task_logs', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('planting_id', Integer, ForeignKey('plantings.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('crop_task_id', Integer, ForeignKey('crop_tasks.id'), nullable=False),
        Column('start_date', Date, nullable=False),
        Column('end_date', Date, nullable=True),
        Column('completed_at', DateTime, nullable=True),
        Column('photo_url', Text, nullable=True),
        Column('journal_id', Integer, ForeignKey('journals.id', ondelete='SET NULL'), nullable=True),
    )
    # 같은 재배에서 같은 할 일의 미완료 행은 하나만
    Index(
        'task_logs_one_open_uq', task_logs.c.planting_id, task_logs.c.crop_task_id, unique=True,
        postgresql_where=text('completed_at IS NULL'), sqlite_where=text('completed_at IS NULL'),
    )
    harvests = Table(
        'harvests', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('planting_id', Integer, ForeignKey('plantings.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('harvested_at', DateTime, nullable=False, server_default=func.now()),
    )

    router = APIRouter(prefix='/garden', tags=['garden'])

    def ensure_crops(conn) -> dict:
        """crops에 지금 화면이 쓰는 작물이 없으면 넣는다(있으면 그대로). 이름 → crops.id를 돌려준다.

        작물별 단계(crop_stages)와 할 일(crop_tasks)의 실제 값은 SQL로 넣는다. 여기서 새로 만드는 작물에는
        이름만 붙인 1~5단계를 넣어 둔다. 예전 '오이' 행이 있으면 오이(봄)으로 보고 새로 만들지 않는다.
        """
        have = {r['name']: r['id'] for r in conn.execute(select(crops.c.id, crops.c.name)).mappings()}
        for name in KIND_CROPS.values():
            if name in have:
                continue
            if LEGACY_NAMES.get(name) in have:
                have[name] = have[LEGACY_NAMES[name]]
                continue
            days = KIND_DAYS[name]
            crop_id = conn.execute(insert(crops).values(name=name, total_days=days)).inserted_primary_key[0]
            # 단계별 시작일은 임시 값(재배 일수의 0·10·30·65·100%). 실제 값은 작물 자료 정리 후 교체한다.
            conn.execute(insert(crop_stages), [
                {'crop_id': crop_id, 'stage_no': n, 'start_day': math.ceil(days * (0, .1, .3, .65, 1)[n - 1]), 'name': ('심음', '새싹', '성장', '개화', '열매')[n - 1]}
                for n in range(1, 6)
            ])
            have[name] = crop_id
        return have

    def load_rows(conn, user_id: int) -> dict:
        """저장된 내용을 한 번에 읽어 온다(쿼리 5번, 농장 수와 상관없음). 비교와 조립은 메모리에서 한다."""
        farm_rows = [dict(r) for r in conn.execute(
            select(farms).where(farms.c.user_id == user_id).order_by(farms.c.id)).mappings()]
        farm_ids = [r['id'] for r in farm_rows]
        plot_rows = [dict(r) for r in conn.execute(
            select(plots).where(plots.c.farm_id.in_(farm_ids))).mappings()] if farm_ids else []
        active = [dict(r) for r in conn.execute(
            select(plantings, crops.c.name.label('crop_name'))
            .join(crops, plantings.c.crop_id == crops.c.id)
            .where(plantings.c.user_id == user_id, plantings.c.status != 'ended', plantings.c.plot_id.is_not(None))
        ).mappings()]
        journal_rows = [dict(r) for r in conn.execute(
            select(journals.c.id, journals.c.planting_id, journals.c.farm_name, journals.c.crop_name,
                   journals.c.content, journals.c.date_label, journals.c.photo_url,
                   journal_meta.c.record_type, journal_meta.c.planting_method, journal_meta.c.plot_ref)
            .outerjoin(journal_meta, journal_meta.c.journal_id == journals.c.id)
            .where(journals.c.user_id == user_id).order_by(journals.c.id)).mappings()]
        motion = conn.execute(select(users.c.motion_effects).where(users.c.id == user_id)).scalar_one()
        care_rows = {r['planting_id']: r['details'] for r in conn.execute(select(care).join(plantings, care.c.planting_id == plantings.c.id).where(plantings.c.user_id == user_id)).mappings()}
        harvest_days = {r[0]: (str(r[1])[:10], str(r[2])[:10]) for r in conn.execute(
            select(harvests.c.planting_id, func.min(harvests.c.harvested_at), func.max(harvests.c.harvested_at))
            .where(harvests.c.planting_id.in_([a['id'] for a in active])).group_by(harvests.c.planting_id))} if active else {}
        # 단계는 날짜로도 정해진다: 3·4·5단계를 올리는 할 일이 시작되는 날(옮겨심은 날 기준 며칠째)이 그 단계의 시작일이다
        stage_dates: dict[int, dict[int, tuple]] = {}
        if active:
            for r in conn.execute(
                select(task_logs.c.planting_id, crop_stages.c.stage_no, func.min(task_logs.c.start_date), func.min(task_logs.c.completed_at))
                .join(plantings, plantings.c.id == task_logs.c.planting_id)
                .join(crop_stages, and_(crop_stages.c.crop_id == plantings.c.crop_id, crop_stages.c.trigger_task_id == task_logs.c.crop_task_id))
                .join(crop_tasks, crop_tasks.c.id == task_logs.c.crop_task_id)
                .where(task_logs.c.planting_id.in_([a['id'] for a in active]), crop_stages.c.stage_no.in_((3, 4, 5)),
                       or_(crop_stages.c.stage_no == 3, crop_tasks.c.start_day.is_not(None)))  # 시작일이 정해지지 않은 할 일은 날짜로 쓰지 않는다
                .group_by(task_logs.c.planting_id, crop_stages.c.stage_no)):
                stage_dates.setdefault(r[0], {})[r[1]] = (r[2], r[3])
        # 옮겨심기(모종 옮겨심기 같은 씨앗 전용 할 일)가 3단계를 올리는 작물만 씨앗 단계에서 포트 그림으로 보인다. 직파 작물은 해당 없음
        transplant_crops = {r[0] for r in conn.execute(
            select(crop_stages.c.crop_id).join(crop_tasks, crop_tasks.c.id == crop_stages.c.trigger_task_id)
            .where(crop_stages.c.stage_no == TRANSPLANT_STAGE_NO, crop_tasks.c.seed_only.is_(True)))}
        stage2_days = {r[0]: r[1] for r in conn.execute(
            select(crop_stages.c.crop_id, crop_stages.c.start_day).where(crop_stages.c.stage_no == 2, crop_stages.c.start_day.is_not(None)))}
        first_harvest = {k: v[0] for k, v in harvest_days.items()}
        last_harvest = {k: v[1] for k, v in harvest_days.items()}
        return {'care': care_rows, 'transplant_crops': transplant_crops, 'stage2_days': stage2_days, 'first_harvest': first_harvest, 'last_harvest': last_harvest, 'tasked': crops_with_tasks(conn, t), 'stage_dates': stage_dates, 'today': today_kst(), 'farms': farm_rows,
                'plots': plot_rows, 'active': active, 'journals': journal_rows, 'motion': bool(motion)}

    def stage_by_date(row: dict, dates: dict, today: date, direct: bool, stage2_day: int | None) -> int:
        """날짜로 정한 성장 단계. 할 일을 체크하지 않아도 날이 되면 올라간다.

        5·4단계는 그 단계를 올리는 할 일의 시작일이다. 4단계 시작일이 정해져 있지 않으면 시작 기준일과 5단계 시작일의 가운데로 한다.
        옮겨심기가 있는 작물은 옮겨심은 날이 기준이고, 직파 작물(옮겨심기 없음)은 심은 날이 기준이라 2·3단계도 날짜로 정한다.
        """
        start5 = dates.get(5, (None, None))[0]
        start4 = dates.get(4, (None, None))[0]
        start3 = dates.get(3, (None, None))[0]
        done = dates.get(3, (None, None))[1]
        base = row['planted_at'] if direct or not done else done.date()
        if start5 and not start4:
            start4 = base + timedelta(days=(start5 - base).days // 2)
        if start5 and today >= start5:
            return 5
        if start4 and today >= start4:
            return 4
        if direct and start3 and today >= start3:
            return 3
        if stage2_day is not None and today >= row['planted_at'] + timedelta(days=stage2_day):
            return 2  # 포트에서 키우는 작물도 심은 날부터 날짜로 2단계가 된다(3단계는 옮겨심기가 올린다)
        return 0

    def build_state(rows: dict) -> dict:
        """읽어 온 내용을 홈 화면이 쓰는 문서 모양으로 조립한다."""
        plant_by_plot = {r['plot_id']: r for r in rows['active']}
        plot_by_farm: dict[int, dict[int, int]] = {}
        for p in rows['plots']:
            plot_by_farm.setdefault(p['farm_id'], {})[p['position']] = p['id']

        def plant_of(plot_id):
            row = plant_by_plot.get(plot_id)
            if not row:
                return None
            kind = kind_of_crop(row['crop_id'], row['crop_name'])
            plant = {
                'plantingId': row['id'], 'kind': kind, 'stage': row['stage'], 'needsWater': bool(row['needs_water']),
                'plantedAt': row['planted_at'].isoformat(),
            }
            if row['watered_at'] is not None:
                plant['wateredAt'] = row['watered_at'].isoformat()
            plant.update(rows['care'].get(row['id'], {}))
            if row['id'] in rows['first_harvest']:  # 첫 수확일은 서버(harvests)가 정한다
                plant['harvestedAt'] = rows['first_harvest'][row['id']]
                plant['lastHarvestedAt'] = rows['last_harvest'][row['id']]  # 마지막 수확일: 같은 날 또 수확하지 못하게 화면이 쓴다
            # 씨앗으로 심고 아직 옮겨심기 전인 칸도 다른 작물처럼 1단계에서 날짜로 2단계가 된다(1단계 그림만 포트)
            # 직파 작물(옮겨심기 없음)은 3단계도 날짜로 오른다
            direct = row['crop_id'] not in rows['transplant_crops']
            if row['crop_id'] in rows['tasked']:
                plant['stage'] = max(plant['stage'], stage_by_date(
                    row, rows['stage_dates'].get(row['id'], {}), rows['today'], direct, rows['stage2_days'].get(row['crop_id'])))
            return plant

        farm_docs = []
        for r in rows['farms']:
            positions = plot_by_farm.get(r['id'], {})
            doc = {
                'id': r['client_id'], 'name': r['name'], 'region': r['region'] or '',
                'plots': [plant_of(positions.get(i)) for i in range(1, 7)],
            }
            if r['weather_location']:
                doc['weatherLocation'] = r['weather_location']
            farm_docs.append(doc)
        return {
            'farms': farm_docs,
            'records': [
                {'journalId': j['id'], 'plantingId': j['planting_id'], 'farm': j['farm_name'] or '',
                 'crop': j['crop_name'] or '', 'text': j['content'], 'date': j['date_label'] or '',
                 **({'photos': json.loads(j['photo_url'])} if j['photo_url'] else {}),
                 **({'event': j['record_type']} if j['record_type'] else {}),
                 **({'plantingMethod': j['planting_method']} if j['planting_method'] else {}),
                 **({'plotRef': j['plot_ref']} if j['plot_ref'] else {})}
                for j in rows['journals']
            ],
            'settings': {'motion': rows['motion']},
        }

    def apply_state(conn, user_id: int, new: dict, rows: dict) -> None:
        """받은 내용과 저장된 내용(rows)을 비교해서 바뀐 행만 쓴다."""
        crop_ids = ensure_crops(conn)
        catalog = {r['id']: dict(r) for r in conn.execute(
            select(crops.c.id, crops.c.name, crops.c.allow_seed, crops.c.allow_seedling)).mappings()}
        tasked_crops = crops_with_tasks(conn, t)
        existing = {r['client_id']: r for r in rows['farms']}
        keep = {f['id'] for f in new['farms']}
        positions_by_farm: dict[int, dict[int, int]] = {}
        for p in rows['plots']:
            positions_by_farm.setdefault(p['farm_id'], {})[p['position']] = p['id']
        active_by_plot = {r['plot_id']: r for r in rows['active']}

        # 지워진 농장: 칸을 지우고, 진행 중인 재배는 ended로 바꿔 남긴다(일지는 그대로 남음)
        removed = [row['id'] for client_id, row in existing.items() if client_id not in keep]
        if removed:
            removed_plots = [p['id'] for p in rows['plots'] if p['farm_id'] in removed]
            if removed_plots:
                conn.execute(update(plantings).where(plantings.c.plot_id.in_(removed_plots)).values(status='ended', plot_id=None))
            conn.execute(delete(plots).where(plots.c.farm_id.in_(removed)))
            conn.execute(delete(farms).where(farms.c.id.in_(removed)))

        end_ids, fresh_plantings, changed = [], [], []
        farm_pk_by_client = {}
        for f in new['farms']:
            values = {'name': f['name'], 'region': f.get('region') or None, 'weather_location': f.get('weatherLocation')}
            row = existing.get(f['id'])
            if row:
                pk = row['id']
                if (row['name'], row['region'], row['weather_location'] or None) != (values['name'], values['region'], values['weather_location']):
                    conn.execute(update(farms).where(farms.c.id == pk).values(**values))
                positions = positions_by_farm.get(pk, {})
            else:
                pk = conn.execute(insert(farms).values(user_id=user_id, client_id=f['id'], **values)).inserted_primary_key[0]
                conn.execute(insert(plots), [{'farm_id': pk, 'position': i} for i in range(1, 7)])
                positions = {}
                if any(f['plots']):  # 작물이 있어야 칸 번호가 필요하다
                    positions = {p['position']: p['id'] for p in conn.execute(select(plots).where(plots.c.farm_id == pk)).mappings()}
            farm_pk_by_client[f['id']] = pk

            for position, plant in enumerate(f['plots'], start=1):
                plot_id = positions.get(position)
                current = active_by_plot.get(plot_id)
                if plant is None:
                    if current:
                        end_ids.append(current['id'])
                    continue
                if plant['kind'] in KIND_CROPS:
                    crop_id = crop_ids[KIND_CROPS[plant['kind']]]
                else:  # 'crop-<id>'
                    crop_id = int(plant['kind'][5:])
                    if crop_id not in catalog:
                        raise HTTPException(422, '알 수 없는 작물이에요.')
                tasked = crop_id in tasked_crops
                values = {
                    'status': 'harvested' if plant.get('harvestedAt') else 'growing',
                    'needs_water': plant.get('needsWater', False),
                    'watered_at': date.fromisoformat(plant['wateredAt']) if plant.get('wateredAt') else None,
                    'planted_at': date.fromisoformat(plant['plantedAt']),
                }
                if not tasked:  # 할 일이 있는 작물의 단계는 서버가 정한다(화면이 보낸 값은 무시)
                    values['stage'] = plant['stage']
                if current and current['crop_id'] == crop_id and current['planted_at'] == values['planted_at']:
                    if any(current[key] != value for key, value in values.items()):
                        changed.append((current['id'], values))
                    continue
                if current:  # 같은 칸에 다른 작물을 새로 심음
                    end_ids.append(current['id'])
                check_method(catalog[crop_id], plant.get('method') or 'seed')  # 그 작물이 허용하지 않는 방식이면 거부
                fresh_plantings.append({
                    'method': plant.get('method') or 'seed', 'tasked': tasked,
                    'row': {'user_id': user_id, 'plot_id': plot_id, 'crop_id': crop_id, **values},
                })

        # 끝낸 재배를 먼저 처리해야 같은 칸에 새로 심을 수 있다(칸당 진행 중인 재배는 하나)
        if end_ids:
            conn.execute(update(plantings).where(plantings.c.id.in_(end_ids)).values(status='ended'))
        for planting_id, values in changed:
            conn.execute(update(plantings).where(plantings.c.id == planting_id).values(**values))
        for fresh_planting in fresh_plantings:
            row = fresh_planting['row']
            planting_id = conn.execute(insert(plantings).values(**row)).inserted_primary_key[0]
            if fresh_planting['tasked']:  # 심기 시작: 처음 할 일을 만들고 시작 단계를 정한다
                stage = start_planting(conn, t, planting_id, row['crop_id'], fresh_planting['method'], row['planted_at'], user_id)
                if stage != 1:
                    conn.execute(update(plantings).where(plantings.c.id == planting_id).values(stage=stage))

        # 일지: 기록은 뒤에 덧붙기만 하므로 앞부분이 같으면 새 기록만 넣고, 다르면 전부 다시 쓴다
        active_rows = list(conn.execute(select(plantings.c.id, plantings.c.plot_id, plantings.c.crop_id).where(plantings.c.user_id == user_id, plantings.c.status != 'ended')).mappings())
        active_now = {r['plot_id']: r['id'] for r in active_rows}
        crop_of_planting = {r['id']: r['crop_id'] for r in active_rows}
        for farm_doc in new['farms']:
            positions = {r['position']: r['id'] for r in conn.execute(select(plots).where(plots.c.farm_id == farm_pk_by_client[farm_doc['id']])).mappings()}
            for position, plant_doc in enumerate(farm_doc['plots'], 1):
                if not plant_doc:
                    continue
                planting_id = active_now[positions[position]]
                details = {key: plant_doc[key] for key in ('method', 'harvestedAt', 'taskChecks', 'draftMemo', 'draftPhotos') if plant_doc.get(key)}
                if details == (rows['care'].get(planting_id) or {}):  # 바뀐 게 없으면 다시 쓰지 않는다
                    continue
                if details.get('method') and details['method'] != (rows['care'].get(planting_id) or {}).get('method'):
                    check_method(catalog[crop_of_planting[planting_id]], details['method'])  # 심는 방식을 바꾸는 저장도 같은 규칙을 따른다
                conn.execute(delete(care).where(care.c.planting_id == planting_id))
                if details:
                    conn.execute(insert(care).values(planting_id=planting_id, details=details))

        saved_by_id = {j['id']: j for j in rows['journals']}
        saved_by_position = rows['journals']
        used_ids = set()
        planting_owner = {r[0] for r in conn.execute(select(plantings.c.id).where(plantings.c.user_id == user_id))}
        plot_planting = {}
        for farm_doc in new['farms']:
            farm_pk = farm_pk_by_client[farm_doc['id']]
            for position, plot_pk in conn.execute(select(plots.c.position, plots.c.id).where(plots.c.farm_id == farm_pk)):
                if plot_pk in active_now:
                    plot_planting[f"{farm_doc['id']}:{position}"] = active_now[plot_pk]
        planting_candidates = {}
        for planting_pk, farm_name, crop_name in conn.execute(
            select(plantings.c.id, farms.c.name, crops.c.name)
            .join(plots, plots.c.id == plantings.c.plot_id)
            .join(farms, farms.c.id == plots.c.farm_id)
            .join(crops, crops.c.id == plantings.c.crop_id)
            .where(plantings.c.user_id == user_id)
        ):
            planting_candidates.setdefault((farm_name, crop_name), []).append(planting_pk)

        def record_values(record):
            return {
                'farm_name': record['farm'], 'crop_name': record['crop'], 'content': record['text'],
                'date_label': record['date'], 'photo_url': json.dumps(record['photos']) if record.get('photos') else None,
            }

        def same_content(row, values):
            return all(row[key] == value for key, value in values.items())

        for index, record in enumerate(new['records']):
            values = record_values(record)
            journal_id = record.get('journalId')
            if journal_id is not None and journal_id not in saved_by_id:
                raise HTTPException(409, '다른 화면에서 일지가 변경되었습니다. 새로고침 후 다시 시도해 주세요.')
            if journal_id is None and index < len(saved_by_position):
                candidate = saved_by_position[index]
                if candidate['id'] not in used_ids and same_content(candidate, values):
                    journal_id = candidate['id']
            if journal_id in used_ids:
                raise HTTPException(422, '중복된 일지 ID가 있습니다.')
            planting_id = record.get('plantingId') or plot_planting.get(record.get('plotRef'))
            if planting_id is None:
                candidates = planting_candidates.get((record['farm'], record['crop']), [])
                if len(candidates) == 1:
                    planting_id = candidates[0]
            if planting_id is not None and planting_id not in planting_owner:
                raise HTTPException(422, '이 재배에 일지를 연결할 수 없습니다.')
            if journal_id is None:
                journal_id = conn.execute(insert(journals).values(user_id=user_id, planting_id=planting_id, **values)).inserted_primary_key[0]
            else:
                old = saved_by_id[journal_id]
                changes = {key: value for key, value in values.items() if old[key] != value}
                if planting_id is not None and old['planting_id'] != planting_id:
                    changes['planting_id'] = planting_id
                if changes:
                    conn.execute(update(journals).where(journals.c.id == journal_id).values(**changes))
            used_ids.add(journal_id)
            meta_values = {
                'record_type': record.get('event') or (saved_by_id.get(journal_id) or {}).get('record_type') or 'journal',
                'planting_method': record.get('plantingMethod'),
                'plot_ref': record.get('plotRef'),
            }
            old_meta = saved_by_id.get(journal_id)
            if old_meta and old_meta['record_type'] is not None:
                changes = {key: value for key, value in meta_values.items() if old_meta[key] != value and value is not None}
                if changes:
                    conn.execute(update(journal_meta).where(journal_meta.c.journal_id == journal_id).values(**changes))
            elif any(value is not None for key, value in meta_values.items() if key != 'record_type') or record.get('event'):
                conn.execute(insert(journal_meta).values(journal_id=journal_id, **meta_values))
            for preview in record.get('photos') or []:
                digest = hashlib.sha256(preview.encode('utf-8')).hexdigest()
                conn.execute(update(original_photos).where(original_photos.c.user_id == user_id,
                    original_photos.c.preview_hash == digest).values(journal_id=journal_id))
        removed_ids = set(saved_by_id) - used_ids
        if removed_ids:
            conn.execute(delete(journals).where(journals.c.user_id == user_id, journals.c.id.in_(removed_ids)))

        if rows['motion'] != new['settings']['motion']:
            conn.execute(update(users).where(users.c.id == user_id).values(motion_effects=new['settings']['motion']))

    def full_state(conn, user_id: int) -> dict:
        """GET /garden/state와 같은 응답(포인트는 지금 값을 다시 읽는다)."""
        state = build_state(load_rows(conn, user_id))
        point = conn.execute(select(users.c.point).where(users.c.id == user_id)).scalar_one()
        return {'revision': revision_of(state), 'state': {**state, 'points': point}}

    @router.get('/crops')
    def read_crops(user=Depends(get_current_user)):
        """작물 선택 화면용: 작물 종류(kind), 이름, 예상 재배 일수(비어 있을 수 있음), 할 일 데이터 유무, 심기 전 안내 작업."""
        crop_tasks = t['crop_tasks']
        with engine.connect() as conn:
            all_rows = [dict(r) for r in conn.execute(
                select(crops.c.id, crops.c.name, crops.c.total_days, crops.c.allow_seed, crops.c.allow_seedling).order_by(crops.c.id)).mappings()]
            rows = {r['name']: r for r in all_rows}
            tasked = crops_with_tasks(conn, t)
            prep: dict[int, list] = {}
            plant: dict[int, dict] = {}
            for r in conn.execute(
                    select(crop_tasks.c.crop_id, crop_tasks.c.title, crop_tasks.c.how_to, crop_tasks.c.tip, crop_tasks.c.points,
                           crop_tasks.c.info_only, crop_tasks.c.plant_task)
                    .where(crop_tasks.c.info_only.is_(True) | crop_tasks.c.plant_task.is_(True)).order_by(crop_tasks.c.id)).mappings():
                item = {'title': r['title'], 'howTo': r['how_to'], 'tip': r['tip'], 'points': r['points']}
                if r['plant_task']:
                    plant[r['crop_id']] = item
                else:
                    prep.setdefault(r['crop_id'], []).append(item)
            moving: dict[int, dict] = {}  # 모종으로 시작할 때 '심었어요'가 곧 이 작업
            has_transplant: set[int] = set()  # 3단계를 올리는 할 일이 씨앗 전용 '옮겨심기'인 작물(직파 작물은 없음)
            for r in conn.execute(  # 작물마다 따로 묻지 않고 한 번에 읽는다
                    select(crop_stages.c.crop_id, crop_tasks.c.title, crop_tasks.c.how_to, crop_tasks.c.tip, crop_tasks.c.points, crop_tasks.c.seed_only)
                    .join(crop_tasks, crop_tasks.c.id == crop_stages.c.trigger_task_id)
                    .where(crop_stages.c.stage_no == TRANSPLANT_STAGE_NO)).mappings():
                moving[r['crop_id']] = {'title': r['title'], 'howTo': r['how_to'], 'tip': r['tip'], 'points': r['points']}
                if r['seed_only']:
                    has_transplant.add(r['crop_id'])

        def item_of(kind: str, name: str, row: dict | None, default_days: int) -> dict:
            return {
                'kind': kind, 'name': name, 'days': row['total_days'] if row and row['total_days'] else default_days,
                'hasTasks': bool(row and row['id'] in tasked), 'prep': prep.get(row['id'], []) if row else [],
                'plant': plant.get(row['id']) if row else None, 'transplant': moving.get(row['id']) if row else None,
                'hasTransplant': bool(row and row['id'] in has_transplant), 'category': category_of_crop(name),
                'allowSeed': bool(row['allow_seed']) if row else True, 'allowSeedling': bool(row['allow_seedling']) if row else True,
            }

        items, used = [], set()
        for kind, name in KIND_CROPS.items():  # 처음 7종은 예전 이름표와 순서를 그대로 쓴다
            row = rows.get(name) or rows.get(LEGACY_NAMES.get(name, ''))
            if row:
                used.add(row['id'])
            items.append({**item_of(kind, name, row, KIND_DAYS[name]), 'days': row['total_days'] if row else KIND_DAYS[name]})
        for row in all_rows:  # 그 밖의 작물은 할 일 데이터가 있는 것만 보여 준다(DB에 넣은 순서대로)
            if row['id'] not in used and row['id'] in tasked:
                items.append(item_of(kind_of_crop(row['id'], row['name']), row['name'], row, 90))
        return {'crops': items}

    @router.get('/dex')
    def read_dex(user=Depends(get_current_user)):
        """작물 도감용(읽기 전용): 모든 작물의 도감 정보와 할 일·성장 단계. 날짜 계산은 화면이 한다."""
        crop_tasks = t['crop_tasks']
        with engine.connect() as conn:
            items = [{
                'id': r['id'], 'name': r['name'], 'totalDays': r['total_days'],
                'allowSeed': bool(r['allow_seed']), 'allowSeedling': bool(r['allow_seedling']),
                'sowMonths': list(r['sow_months'] or []), 'harvestMonths': list(r['harvest_months'] or []),
                'germTemp': r['germ_temp'], 'growTemp': r['grow_temp'], 'soil': r['soil'], 'summary': r['summary'],
                'tasks': [], 'stages': [],
            } for r in conn.execute(select(
                crops.c.id, crops.c.name, crops.c.total_days, crops.c.allow_seed, crops.c.allow_seedling, crops.c.sow_months,
                crops.c.harvest_months, crops.c.germ_temp, crops.c.grow_temp, crops.c.soil, crops.c.summary).order_by(crops.c.id)).mappings()]
            by_id = {item['id']: item for item in items}
            for r in conn.execute(select(crop_tasks).order_by(crop_tasks.c.id)).mappings():
                if r['crop_id'] in by_id:
                    by_id[r['crop_id']]['tasks'].append({
                        'id': r['id'], 'title': r['title'], 'tip': r['tip'], 'howTo': r['how_to'], 'anchor': r['anchor'],
                        'startDay': r['start_day'], 'endDay': r['end_day'], 'repeatMinDays': r['repeat_min_days'],
                        'repeatMaxDays': r['repeat_max_days'], 'afterTaskId': r['after_task_id'], 'seedOnly': bool(r['seed_only']),
                        'infoOnly': bool(r['info_only']), 'plantTask': bool(r['plant_task']),
                    })
            for r in conn.execute(select(crop_stages).order_by(crop_stages.c.crop_id, crop_stages.c.stage_no)).mappings():
                if r['crop_id'] in by_id:
                    by_id[r['crop_id']]['stages'].append({'stageNo': r['stage_no'], 'name': r['name'], 'triggerTaskId': r['trigger_task_id']})
        return {'crops': items}

    @router.get('/places')
    def search_places(q: str = Query(min_length=2, max_length=40), user=Depends(get_current_user)):
        """농장 지역 입력 자동완성: 카카오 주소 검색에서 시·군·구·동 단위(REGION) 결과만 돌려준다. 키는 서버에만 둔다."""
        key = os.getenv('KAKAO_REST_API_KEY')
        if not key:
            raise HTTPException(503, '지역 검색이 설정되어 있지 않아요.')
        words = q.split()
        if not words:
            return {'places': []}

        def kakao(client, url, size):
            res = client.get(url, params={'query': ' '.join(words), 'size': size})
            if res.status_code != 200:
                raise HTTPException(502, '지역을 검색하지 못했어요. 잠시 후 다시 시도해 주세요.')
            return res.json().get('documents', [])

        try:
            with httpx.Client(headers={'Authorization': f'KakaoAK {key}'}, timeout=5) as client:
                regions = kakao(client, KAKAO_ADDRESS_URL, 15)
                spots = kakao(client, KAKAO_KEYWORD_URL, 15)
        except httpx.HTTPError:
            raise HTTPException(502, '지역 검색 서버에 연결하지 못했어요.')
        places: dict[str, dict | None] = {}
        # 1) 시·군·구·동 이름 그대로 찾은 결과(좌표 있음)
        for d in regions:
            label = d.get('address_name') or ''
            if d.get('address_type') == 'REGION' and label:
                places.setdefault(label, {'latitude': float(d['y']), 'longitude': float(d['x'])})
        # 2) 장소 검색 결과의 주소에서 지역 이름만 뽑는다: 검색어가 들어 있는 칸까지(최소 2칸: 시·도 + 시·군·구)
        for d in spots:
            parts = (d.get('address_name') or '').split()
            at = next((i for i, p in enumerate(parts) if words[-1] in p), None)
            if at is None or any(w not in ' '.join(parts) for w in words):
                continue
            places.setdefault(' '.join(parts[:max(2, at + 1)]), None)
        # 큰 단위(시·도, 시·군·구)가 먼저 오도록 칸 수로 정렬한다(같으면 찾은 순서). 좌표를 아직 모르는 후보는 null로 보낸다
        # (고를 때 같은 API로 이름을 다시 검색해 좌표를 받는다)
        ordered = sorted(places.items(), key=lambda item: len(item[0].split()))
        return {'places': [{'label': label, **(loc or {'latitude': None, 'longitude': None})} for label, loc in ordered][:8]}

    @router.get('/state')
    def read_state(user=Depends(get_current_user)):
        with engine.begin() as conn:
            return full_state(conn, user['id'])

    @router.post('/photos/original')
    async def save_original_photo(preview: str = Form(...), photo: UploadFile = File(...), user=Depends(get_current_user)):
        if not preview.startswith('data:image/jpeg;base64,') or len(preview) > 2_000_000:
            raise HTTPException(422, '일지 미리보기 사진을 확인해 주세요.')
        digest = hashlib.sha256(preview.encode('utf-8')).hexdigest()
        with engine.begin() as conn:
            existing_photo = conn.execute(select(original_photos.c.id).where(
                original_photos.c.user_id == user['id'], original_photos.c.preview_hash == digest)).first()
        if existing_photo:
            return {'previewHash': digest}
        content = await photo.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024 or not content:
            raise HTTPException(422, '사진은 10MB 이하만 올릴 수 있어요.')
        try:
            with Image.open(io.BytesIO(content)) as image:
                valid_image = image.format == 'JPEG' and max(image.size) <= 2000
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError) as error:
            raise HTTPException(422, '사진 파일을 읽을 수 없어요.') from error
        if not valid_image or photo.content_type != 'image/jpeg':
            raise HTTPException(422, '사진을 2000px 이하 JPEG로 줄여서 올려 주세요.')
        filename = (photo.filename or 'photo.jpg').split('/')[-1].split('\\')[-1][:255]
        with engine.begin() as conn:
            conn.execute(insert(original_photos).values(
                user_id=user['id'], preview_hash=digest, storage_path='', photo_data=content,
                filename=filename, content_type='image/jpeg'))
        return {'previewHash': digest}

    @router.get('/photos/original/{preview_hash}')
    def read_original_photo(preview_hash: str, download: bool = False, user=Depends(get_current_user)):
        if not re.fullmatch(r'[a-f0-9]{64}', preview_hash):
            raise HTTPException(404, '사진을 찾을 수 없어요.')
        with engine.begin() as conn:
            photo = conn.execute(select(original_photos).where(
                original_photos.c.user_id == user['id'], original_photos.c.preview_hash == preview_hash)).mappings().first()
        if not photo:
            raise HTTPException(404, '사진을 찾을 수 없어요.')
        content = photo['photo_data']
        if content is None:
            raise HTTPException(404, '저장된 사진을 찾을 수 없어요.')
        disposition = 'attachment' if download else 'inline'
        safe_name = re.sub(r'[^A-Za-z0-9._-]', '_', photo['filename']) or 'journal-photo'
        return Response(bytes(content), media_type=photo['content_type'], headers={
            'Content-Disposition': f"{disposition}; filename=\"{safe_name}\"; filename*=UTF-8''{quote(photo['filename'])}",
            'Cache-Control': 'private, no-store',
        })

    @router.delete('/history/{planting_id}')
    def delete_past_cultivation(planting_id: int, user=Depends(get_current_user)):
        with engine.begin() as conn:
            planting = conn.execute(select(plantings.c.id, plantings.c.status).where(
                plantings.c.id == planting_id, plantings.c.user_id == user['id']).with_for_update()).mappings().first()
            if not planting:
                raise HTTPException(404, '재배 이력을 찾을 수 없어요.')
            if planting['status'] not in ('ended', 'harvested'):
                raise HTTPException(409, '진행 중인 재배는 지난 재배에서 삭제할 수 없어요.')
            removed_journals = conn.execute(select(journals.c.id, journals.c.photo_url).where(
                journals.c.user_id == user['id'], journals.c.planting_id == planting_id)).mappings().all()
            journal_ids = [row['id'] for row in removed_journals]
            if journal_ids:
                candidate_hashes = {hashlib.sha256(preview.encode('utf-8')).hexdigest()
                    for row in removed_journals for preview in json.loads(row['photo_url'] or '[]')}
                candidate_hashes.update(conn.execute(select(original_photos.c.preview_hash).where(
                    original_photos.c.user_id == user['id'], original_photos.c.journal_id.in_(journal_ids))).scalars())
                conn.execute(delete(journals).where(journals.c.user_id == user['id'], journals.c.id.in_(journal_ids)))
                remaining_refs = {}
                for row in conn.execute(select(journals.c.id, journals.c.photo_url).where(
                    journals.c.user_id == user['id'], journals.c.photo_url.is_not(None))).mappings():
                    for preview in json.loads(row['photo_url']):
                        remaining_refs[hashlib.sha256(preview.encode('utf-8')).hexdigest()] = row['id']
                orphan_hashes = candidate_hashes - remaining_refs.keys()
                if orphan_hashes:
                    conn.execute(delete(original_photos).where(original_photos.c.user_id == user['id'],
                        original_photos.c.preview_hash.in_(orphan_hashes)))
                for digest in candidate_hashes & remaining_refs.keys():
                    conn.execute(update(original_photos).where(original_photos.c.user_id == user['id'],
                        original_photos.c.preview_hash == digest).values(journal_id=remaining_refs[digest]))
            conn.execute(delete(plantings).where(plantings.c.id == planting_id, plantings.c.user_id == user['id']))
            result = full_state(conn, user['id'])
        return {**result, 'photoCleanupPending': False, 'deletedJournalCount': len(journal_ids)}

    @router.put('/state')
    def save_state(body: SaveGarden, user=Depends(get_current_user)):
        new = body.state.model_dump(mode='json', exclude_none=True)
        with engine.begin() as conn:
            # 같은 사용자의 저장이 동시에 들어와도 한 번에 하나씩 처리한다
            conn.execute(select(users.c.id).where(users.c.id == user['id']).with_for_update())
            rows = load_rows(conn, user['id'])
            # 마지막으로 받은 내용에서 바뀌었으면(다른 탭에서 저장) 덮어쓰지 않는다
            if revision_of(build_state(rows)) != body.revision:
                raise HTTPException(409, '다른 화면에서 농장이 변경되었습니다. 새로고침 후 다시 시도해 주세요.')
            apply_state(conn, user['id'], new, rows)
            revision = revision_of(build_state(load_rows(conn, user['id'])))
        return {'revision': revision}

    app.include_router(router)
    t = {
        'farms': farms, 'plots': plots, 'crops': crops, 'crop_tasks': crop_tasks, 'crop_stages': crop_stages,
        'plantings': plantings, 'journals': journals, 'garden_original_photos': original_photos,
        'garden_plant_care': care, 'task_logs': task_logs,
        'harvests': harvests, 'users': users, 'metadata': metadata,
    }
    register_tasks(app, engine, get_current_user, t, full_state)
    return {k: v for k, v in t.items() if k not in ('users', 'metadata')}
