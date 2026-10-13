"""User-owned garden snapshots. Existing login and menu APIs remain authoritative."""
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import Column, ForeignKey, Integer, JSON, Table, insert, select, update

class Plant(BaseModel):
    kind: Literal['lettuce', 'cucumber', 'pepper', 'eggplant', 'zucchini', 'tomato', 'potato']
    stage: int = Field(ge=1, le=4)
    needsWater: bool = False
    wateredAt: date | None = None
    plantedAt: date

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

class Settings(BaseModel):
    motion: bool = True

class GardenState(BaseModel):
    farms: list[Farm] = Field(max_length=100)
    records: list[Record] = Field(max_length=10000)
    settings: Settings = Field(default_factory=Settings)
    # Client points are deliberately ignored; real point balances belong to /me.
    @model_validator(mode='after')
    def unique_ids(self):
        for items in (self.farms,):
            if len({item.id for item in items}) != len(items):
                raise ValueError('중복된 ID가 있습니다.')
        return self

class SaveGarden(BaseModel):
    revision: int = Field(ge=0)
    state: GardenState

def register_garden(app, metadata, engine, get_current_user):
    table = Table('garden_states', metadata,
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        Column('revision', Integer, nullable=False, default=0),
        Column('state', JSON, nullable=False))
    router = APIRouter(prefix='/garden', tags=['garden'])
    empty = {'farms': [], 'records': [], 'settings': {'motion': True}}

    @router.get('/state')
    def read_state(user=Depends(get_current_user)):
        with engine.begin() as conn:
            row = conn.execute(select(table).where(table.c.user_id == user['id'])).mappings().first()
            if row is None:
                conn.execute(insert(table).values(user_id=user['id'], revision=0, state=empty))
                return {'revision': 0, 'state': {**empty, 'points': user['point']}}
            return {'revision': row['revision'], 'state': {**row['state'], 'points': user['point']}}

    @router.put('/state')
    def save_state(body: SaveGarden, user=Depends(get_current_user)):
        state = body.state.model_dump(mode='json', exclude_none=True)
        # CAS prevents one tab from silently overwriting changes made in another tab.
        with engine.begin() as conn:
            result = conn.execute(update(table).where(
                table.c.user_id == user['id'], table.c.revision == body.revision
            ).values(state=state, revision=body.revision + 1))
            if result.rowcount != 1:
                raise HTTPException(409, '다른 화면에서 농장이 변경되었습니다. 새로고침 후 다시 시도해 주세요.')
        return {'revision': body.revision + 1}

    app.include_router(router)
    return table

def summarize_state(state):
    state = state or {}
    farms = state.get('farms', [])
    records = state.get('records', [])
    return {'farms': len(farms), 'growing_crops': sum(p is not None for f in farms for p in f['plots']),
            'journals': len(records), 'harvested': sum('수확을 마쳤어요' in r['text'] for r in records)}
