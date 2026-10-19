"""사용자별 텃밭 저장. 공통 설계의 farms / plots / crops / crop_stages / plantings / journals 테이블에 저장한다.

홈 화면(frontend/public/garden)은 농장 전체를 하나의 문서(JSON)로 주고받는다. 그 방식은 그대로 두고,
서버가 문서를 받을 때 테이블로 나눠 저장하고, 줄 때 테이블에서 다시 조립한다(GET/PUT /garden/state).
화면에는 있지만 공통 설계에 없는 값은 설계 테이블에 컬럼을 덧붙여 저장한다(아래 '설계 밖 컬럼' 참고).
"""
import hashlib
import json
import math
import os
from datetime import date
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
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
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    delete,
    func,
    insert,
    select,
    text,
    update,
)

from tasks import crops_with_tasks, method_of, register_tasks, start_planting, transplant_task_id

# 홈 화면의 작물 종류(kind) ↔ crops 테이블의 이름. 오이는 봄/여름 두 작물로 나뉜다.
# 작물별 단계·할 일은 crops / crop_stages / crop_tasks 행(Supabase에 SQL로 입력)이 정한다.
# 재배 일수(예상 수확까지)는 새 작물 행을 만들 때의 임시 값이고, 오이는 DB 행의 total_days를 쓰지 않는다.
KIND_CROPS = {
    'tomato': '방울토마토',
    'lettuce': '상추',
    'cucumber_spring': '오이(봄)',
    'cucumber_summer': '오이(여름)',
    'pepper': '고추',
    'potato': '감자',
    'eggplant': '가지',
    'zucchini': '애호박',
}
KIND_DAYS = {
    '방울토마토': 90, '상추': 45, '오이(봄)': 60, '오이(여름)': 70, '고추': 90, '감자': 100, '가지': 85, '애호박': 60,
}
NAME_TO_KIND = {name: kind for kind, name in KIND_CROPS.items()}
# 예전 '오이' 행은 오이(봄)으로 이름을 바꿔 쓴다. 바꾸기 전에도 같은 작물로 보고, 새 행을 따로 만들지 않는다.
LEGACY_NAMES = {'오이(봄)': '오이'}
NAME_TO_KIND['오이'] = 'cucumber_spring'


class Plant(BaseModel):
    kind: Literal['lettuce', 'cucumber_spring', 'cucumber_summer', 'pepper', 'eggplant', 'zucchini', 'tomato', 'potato']
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
            select(journals.c.farm_name, journals.c.crop_name, journals.c.content, journals.c.date_label, journals.c.photo_url)
            .where(journals.c.user_id == user_id).order_by(journals.c.id)).mappings()]
        motion = conn.execute(select(users.c.motion_effects).where(users.c.id == user_id)).scalar_one()
        care_rows = {r['planting_id']: r['details'] for r in conn.execute(select(care).join(plantings, care.c.planting_id == plantings.c.id).where(plantings.c.user_id == user_id)).mappings()}
        harvest_days = {r[0]: (str(r[1])[:10], str(r[2])[:10]) for r in conn.execute(
            select(harvests.c.planting_id, func.min(harvests.c.harvested_at), func.max(harvests.c.harvested_at))
            .where(harvests.c.planting_id.in_([a['id'] for a in active])).group_by(harvests.c.planting_id))} if active else {}
        first_harvest = {k: v[0] for k, v in harvest_days.items()}
        last_harvest = {k: v[1] for k, v in harvest_days.items()}
        return {'care': care_rows, 'first_harvest': first_harvest, 'last_harvest': last_harvest, 'tasked': crops_with_tasks(conn, t), 'farms': farm_rows,
                'plots': plot_rows, 'active': active, 'journals': journal_rows, 'motion': bool(motion)}

    def build_state(rows: dict) -> dict:
        """읽어 온 내용을 홈 화면이 쓰는 문서 모양으로 조립한다."""
        plant_by_plot = {r['plot_id']: r for r in rows['active']}
        plot_by_farm: dict[int, dict[int, int]] = {}
        for p in rows['plots']:
            plot_by_farm.setdefault(p['farm_id'], {})[p['position']] = p['id']

        def plant_of(plot_id):
            row = plant_by_plot.get(plot_id)
            kind = NAME_TO_KIND.get(row['crop_name']) if row else None
            if not kind:
                return None
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
            # 씨앗으로 심고 아직 옮겨심기 전인 칸은 싹이 없는 0단계(포트)로 보여준다(DB에는 1단계로 저장)
            if row['crop_id'] in rows['tasked'] and plant.get('method') == 'seed' and row['stage'] < 3:
                plant['stage'] = 0
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
                {'farm': j['farm_name'] or '', 'crop': j['crop_name'] or '', 'text': j['content'], 'date': j['date_label'] or '', **({'photos': json.loads(j['photo_url'])} if j['photo_url'] else {})}
                for j in rows['journals']
            ],
            'settings': {'motion': rows['motion']},
        }

    def apply_state(conn, user_id: int, new: dict, rows: dict) -> None:
        """받은 내용과 저장된 내용(rows)을 비교해서 바뀐 행만 쓴다."""
        crop_ids = ensure_crops(conn)
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
                crop_id = crop_ids[KIND_CROPS[plant['kind']]]
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
        active_now = {r['plot_id']: r['id'] for r in conn.execute(select(plantings.c.id, plantings.c.plot_id).where(plantings.c.user_id == user_id, plantings.c.status != 'ended')).mappings()}
        for farm_doc in new['farms']:
            positions = {r['position']: r['id'] for r in conn.execute(select(plots).where(plots.c.farm_id == farm_pk_by_client[farm_doc['id']])).mappings()}
            for position, plant_doc in enumerate(farm_doc['plots'], 1):
                if not plant_doc:
                    continue
                planting_id = active_now[positions[position]]
                details = {key: plant_doc[key] for key in ('method', 'harvestedAt', 'taskChecks', 'draftMemo', 'draftPhotos') if plant_doc.get(key)}
                conn.execute(delete(care).where(care.c.planting_id == planting_id))
                if details:
                    conn.execute(insert(care).values(planting_id=planting_id, details=details))

        incoming = [(r['farm'], r['crop'], r['text'], r['date'], json.dumps(r['photos']) if r.get('photos') else None) for r in new['records']]
        saved = [(j['farm_name'] or '', j['crop_name'] or '', j['content'], j['date_label'] or '', j['photo_url']) for j in rows['journals']]
        if incoming[:len(saved)] != saved:
            conn.execute(delete(journals).where(journals.c.user_id == user_id))
            saved = []
        fresh = incoming[len(saved):]
        if fresh:
            # 기록에 연결할 재배: 그 농장에서 가장 최근에 심은 같은 이름의 작물(수확해서 끝난 것 포함). 한 번에 조회한다.
            latest = {}
            for planting_id, farm_id, crop_name in conn.execute(
                select(plantings.c.id, plots.c.farm_id, crops.c.name)
                .join(plots, plantings.c.plot_id == plots.c.id)
                .join(crops, plantings.c.crop_id == crops.c.id)
                .where(plantings.c.user_id == user_id).order_by(plantings.c.id)
            ):
                latest[(farm_id, crop_name)] = planting_id
            pks_by_name: dict[str, list[int]] = {}
            for f in new['farms']:
                pks_by_name.setdefault(f['name'], []).append(farm_pk_by_client[f['id']])
            batch = []
            for farm_name, crop_name, content, date_label, photo_url in fresh:
                found = [latest[(pk, crop_name)] for pk in pks_by_name.get(farm_name, []) if (pk, crop_name) in latest]
                batch.append({
                    'user_id': user_id, 'planting_id': max(found) if found else None,
                    'photo_url': photo_url, 'content': content, 'farm_name': farm_name, 'crop_name': crop_name, 'date_label': date_label,
                })
            conn.execute(insert(journals), batch)

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
            rows = {r['name']: dict(r) for r in conn.execute(select(crops.c.id, crops.c.name, crops.c.total_days)).mappings()}
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
            for crop_id in {r['id'] for r in rows.values()}:
                move_id = transplant_task_id(conn, t, crop_id)
                task = conn.execute(select(crop_tasks.c.title, crop_tasks.c.how_to, crop_tasks.c.tip, crop_tasks.c.points)
                                    .where(crop_tasks.c.id == move_id)).mappings().first() if move_id else None
                if task:
                    moving[crop_id] = {'title': task['title'], 'howTo': task['how_to'], 'tip': task['tip'], 'points': task['points']}
        items = []
        for kind, name in KIND_CROPS.items():
            row = rows.get(name) or rows.get(LEGACY_NAMES.get(name, ''))
            items.append({
                'kind': kind, 'name': name, 'days': row['total_days'] if row else KIND_DAYS[name],
                'hasTasks': bool(row and row['id'] in tasked), 'prep': prep.get(row['id'], []) if row else [],
                'plant': plant.get(row['id']) if row else None, 'transplant': moving.get(row['id']) if row else None,
            })
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
        'plantings': plantings, 'journals': journals, 'garden_plant_care': care, 'task_logs': task_logs,
        'harvests': harvests, 'users': users, 'metadata': metadata,
    }
    register_tasks(app, engine, get_current_user, t, full_state)
    return {k: v for k, v in t.items() if k not in ('users', 'metadata')}
