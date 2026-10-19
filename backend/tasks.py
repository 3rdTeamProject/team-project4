"""작물별 할 일(task_logs) 생성·완료·반복, 성장 단계, 첫 수확 처리.

규칙은 노션 설계와 팀 결정을 따른다.
- task_logs는 한꺼번에 만들지 않는다. 심기 시작 때 첫 할 일만 만들고, 이어지는 할 일은 완료할 때 만든다.
- 할 일은 '일지 올리기'로만 완료된다(일지 생성 + 포인트 지급이 한 번에 일어남).
- 수확도 '일지 올리기'에 실려 온다. 수확 버튼은 화면에서 표시만 하고, 일지를 올릴 때 수확 기록과 첫 수확 보너스가 생긴다.
- 성장 단계는 올라가기만 한다. 단계를 올리는 것은 crop_stages.trigger_task_id(할 일 완료)다.
  씨앗으로 심은 칸은 모종을 밭에 옮겨심기 전까지 화면에 0단계(포트)로 보이고, 옮겨심기를 마치면 3단계가 된다.
- crop_tasks가 하나도 없는 작물은 예전 방식(화면이 정한 단계)을 그대로 쓴다.
"""
import json
import os
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import and_, delete, insert, select, update

KST = timezone(timedelta(hours=9))
TRANSPLANT_STAGE_NO = 3  # 이 단계를 올리는 할 일이 '모종 옮겨심기'
FIRST_HARVEST_BONUS = 120
ACTIVE_STATUSES = ('growing', 'harvested')


# 개발용: 서버 시계를 며칠 앞으로 보낸다. 화면의 '개발용' 줄 버튼으로 바꾸고(서버를 다시 켜면 0), 처음 값은 .env의 GARDEN_DAY_OFFSET으로 정할 수도 있다.
_day_offset = int(os.getenv('GARDEN_DAY_OFFSET') or 0)


def now_kst() -> datetime:
    """지금(한국 시간). 개발 중에는 _day_offset만큼 앞으로 간 시간이다.

    할 일 시점, 단계(파종 5일 뒤), 반복 할 일, 완료·수확 날짜가 모두 이 시간을 기준으로 한다. 실제 서비스에서는 0이다.
    """
    return datetime.now(KST).replace(tzinfo=None) + timedelta(days=_day_offset)


def today_kst() -> date:
    return now_kst().date()


def date_label(moment: datetime) -> str:
    """홈 화면 기록의 날짜 글자와 같은 모양(예: 2026. 10. 15. 오후 3:20:05)."""
    hour = moment.hour % 12 or 12
    return f"{moment.year}. {moment.month}. {moment.day}. {'오전' if moment.hour < 12 else '오후'} {hour}:{moment:%M:%S}"


def method_of(details) -> str | None:
    return details.get('method') if isinstance(details, dict) and details.get('method') in ('seed', 'seedling') else None


def crop_tasks_of(conn, t, crop_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute(
        select(t['crop_tasks']).where(t['crop_tasks'].c.crop_id == crop_id).order_by(t['crop_tasks'].c.id)).mappings()]


def crops_with_tasks(conn, t) -> set[int]:
    return {r[0] for r in conn.execute(select(t['crop_tasks'].c.crop_id).distinct())}


def _log_row(planting_id: int, task: dict, start: date, end: date | None) -> dict:
    return {'planting_id': planting_id, 'crop_task_id': task['id'], 'start_date': start, 'end_date': end}


def _first_span(base: date, task: dict) -> tuple[date, date | None]:
    start = base + timedelta(days=task['start_day'] or 0)
    end = base + timedelta(days=task['end_day']) if task['end_day'] is not None else None
    return start, end


def _next_span(done_on: date, task: dict) -> tuple[date, date]:
    """완료한 날 기준으로 min일 뒤 ~ max일 뒤(max가 비면 min일 뒤 하루)."""
    start = done_on + timedelta(days=task['repeat_min_days'])
    return start, done_on + timedelta(days=task['repeat_max_days'] or task['repeat_min_days'])


def transplant_task_id(conn, t, crop_id: int) -> int | None:
    """'모종 옮겨심기' 할 일(3단계를 올리는 할 일)의 id. 없으면 None."""
    stages = t['crop_stages']
    return conn.execute(select(stages.c.trigger_task_id).where(stages.c.crop_id == crop_id, stages.c.stage_no == TRANSPLANT_STAGE_NO)).scalar()


def start_planting(conn, t, planting_id: int, crop_id: int, method: str, planted_at: date, user_id: int) -> int:
    """심기 시작: 처음 만들 할 일을 넣고 시작 단계를 돌려준다. 심었어요로 끝나는 작업(plant_task)은 바로 완료로 기록한다.

    씨앗(seed)은 파종일 기준 할 일, 모종(seedling)은 씨앗 전용 할 일을 건너뛰고 옮겨심은 날(planted_at) 기준 할 일을 만든다.
    모종은 '심었어요'를 누른 것이 곧 '모종 옮겨심기'라서 그 작업도 바로 완료로 기록한다.
    """
    tasks = [x for x in crop_tasks_of(conn, t, crop_id) if x['after_task_id'] is None]
    if method == 'seed':
        mine = [x for x in tasks if x['anchor'] == 'sow']
    else:
        mine = [x for x in tasks if x['anchor'] == 'transplant' and not x['seed_only']]
    rows, done_now = [], []
    if method == 'seedling':
        moving = next((x for x in crop_tasks_of(conn, t, crop_id) if x['id'] == transplant_task_id(conn, t, crop_id)), None)
        if moving:
            rows.append({**_log_row(planting_id, moving, planted_at, planted_at), 'completed_at': now_kst()})
            done_now.append(moving)
    for x in mine:
        row = {**_log_row(planting_id, x, *_first_span(planted_at, x)), 'completed_at': None}
        if method == 'seed' and x['plant_task']:  # '심었어요'를 누른 것이 곧 이 작업(예: 포트에 씨앗 심기)
            row['completed_at'] = now_kst()
            done_now.append(x)
        rows.append(row)
    if rows:
        conn.execute(insert(t['task_logs']), rows)
    for x in done_now:
        grant_points(conn, t, user_id, x['points'], f"할 일 완료: {x['title']}")
    return TRANSPLANT_STAGE_NO if method == 'seedling' and tasks else 1


def grant_points(conn, t, user_id: int, amount: int, reason: str) -> None:
    """포인트와 경험치를 같이 올리고 내역을 남긴다(경험치는 번 포인트만큼 쌓이고 줄지 않는다)."""
    if amount <= 0:
        return
    users = t['users']
    conn.execute(update(users).where(users.c.id == user_id).values(point=users.c.point + amount, exp=users.c.exp + amount))
    conn.execute(insert(t['metadata'].tables['point_logs']).values(user_id=user_id, amount=amount, reason=reason[:100]))


def _complete_follow_ups(conn, t, planting: dict, method: str, task: dict, done_on: date, tasks: list[dict], stages: list[dict]) -> None:
    """할 일 하나를 완료한 뒤 이어서 생길 것: 다음 반복, '완료 후' 시작 할 일, 옮겨심기 이후 할 일, 단계."""
    logs, planting_id = t['task_logs'], planting['id']
    transplant_id = next((s['trigger_task_id'] for s in stages if s['stage_no'] == TRANSPLANT_STAGE_NO), None)
    transplanted = method == 'seedling' or (
        transplant_id is not None and conn.execute(
            select(logs.c.id).where(logs.c.planting_id == planting_id, logs.c.crop_task_id == transplant_id,
                                    logs.c.completed_at.is_not(None)).limit(1)).first() is not None)

    def has_open(task_id):
        return conn.execute(select(logs.c.id).where(
            logs.c.planting_id == planting_id, logs.c.crop_task_id == task_id, logs.c.completed_at.is_(None)).limit(1)).first() is not None

    def has_any(task_id):
        return conn.execute(select(logs.c.id).where(
            logs.c.planting_id == planting_id, logs.c.crop_task_id == task_id).limit(1)).first() is not None

    # 1) 반복 할 일: 완료한 날 기준 다음 행 하나(씨앗 전용 반복은 옮겨심은 뒤에는 만들지 않음)
    if task['repeat_min_days'] is not None and not (task['seed_only'] and transplanted) and not has_open(task['id']):
        conn.execute(insert(logs).values(**_log_row(planting_id, task, *_next_span(done_on, task))))

    # 2) '이 할 일을 완료한 뒤' 시작하는 할 일
    for follower in tasks:
        if follower['after_task_id'] != task['id'] or has_any(follower['id']):
            continue
        if follower['repeat_min_days'] is not None:
            span = _next_span(done_on, follower)
        else:
            span = _first_span(done_on, follower)
        conn.execute(insert(logs).values(**_log_row(planting_id, follower, *span)))

    # 3) 씨앗으로 심은 경우 '모종 옮겨심기'를 마치면 그날 기준 할 일이 시작된다
    if method == 'seed' and task['id'] == transplant_id:
        rows = [_log_row(planting_id, x, *_first_span(done_on, x)) for x in tasks
                if x['anchor'] == 'transplant' and x['after_task_id'] is None and not x['seed_only'] and not has_any(x['id'])]
        if rows:
            conn.execute(insert(logs), rows)
        # 옮겨심기 전에만 하던 작업(씨앗 심기, 석회·퇴비, 밑거름, 모종 물 주기 등)은 마치지 못했어도 더 보이지 않게 정리한다
        stale = [x['id'] for x in tasks if x['seed_only']]
        if stale:
            conn.execute(delete(logs).where(logs.c.planting_id == planting_id, logs.c.crop_task_id.in_(stale), logs.c.completed_at.is_(None)))

    # 4) 단계: 올라가기만 한다
    for stage in stages:
        if stage['trigger_task_id'] == task['id']:
            conn.execute(update(t['plantings']).where(t['plantings'].c.id == planting_id, t['plantings'].c.stage < stage['stage_no'])
                         .values(stage=stage['stage_no']))


class CompleteTasks(BaseModel):
    planting_id: int
    task_log_ids: list[int] = Field(default_factory=list, max_length=30)
    content: str = Field(default='', max_length=500)
    photos: list[str] = Field(default_factory=list, max_length=4)  # data:image/jpeg;base64,... (화면이 줄여서 보냄)
    harvest: bool = False  # 이 일지와 함께 수확을 기록한다

    @field_validator('content')
    @classmethod
    def strip_content(cls, value):
        return value.strip()

    @field_validator('photos')
    @classmethod
    def validate_photos(cls, photos):
        if any(not photo.startswith('data:image/jpeg;base64,') or len(photo) > 2000000 for photo in photos):
            raise ValueError('유효한 JPG 사진만 저장할 수 있어요.')
        return photos

    @model_validator(mode='after')
    def not_empty(self):
        if not (self.task_log_ids or self.harvest or self.content):
            raise ValueError('일지 내용이나 완료한 할 일을 골라 주세요.')
        return self


class DevDay(BaseModel):
    offset: int = Field(ge=0, le=3650)


def register_tasks(app, engine, get_current_user, t, full_state):
    """t: 테이블 모음. full_state(conn, user): GET /garden/state와 같은 응답을 만든다."""
    router = APIRouter(prefix='/garden', tags=['garden'])

    def lock_user(conn, user_id):
        conn.execute(select(t['users'].c.id).where(t['users'].c.id == user_id).with_for_update())

    def dev_day():
        return {'enabled': True, 'offset': _day_offset, 'today': today_kst().isoformat()}

    @router.get('/dev/day')
    def read_dev_day(user=Depends(get_current_user)):
        """개발용: 서버 시계가 지금 며칠 앞인지."""
        return dev_day()

    @router.post('/dev/day')
    def set_dev_day(body: DevDay, user=Depends(get_current_user)):
        """개발용: 서버 시계를 body.offset일 앞으로 맞춘다(서버를 다시 켜면 .env 값으로 돌아간다)."""
        global _day_offset
        _day_offset = body.offset
        return dev_day()

    @router.get('/tasks')
    def today_tasks(user=Depends(get_current_user)):
        """오늘 할 일: 시점이 지났고 아직 완료하지 않은 것(구간이 지나도 완료 전까지 계속 보임)."""
        logs, ct, pl, plots, farms, crops = (t[k] for k in ('task_logs', 'crop_tasks', 'plantings', 'plots', 'farms', 'crops'))
        stages = t['crop_stages']
        with engine.begin() as conn:
            rows = conn.execute(
                select(logs.c.id, logs.c.planting_id, logs.c.start_date, logs.c.end_date,
                       ct.c.title, ct.c.points, ct.c.tip, ct.c.how_to, ct.c.image_url, ct.c.info_only, ct.c.seed_only, ct.c.repeat_min_days,
                       crops.c.name.label('crop_name'), farms.c.client_id.label('farm'), farms.c.name.label('farm_name'),
                       plots.c.position, stages.c.stage_no.label('triggers_stage'))
                .join(ct, ct.c.id == logs.c.crop_task_id)
                .outerjoin(stages, stages.c.trigger_task_id == ct.c.id)
                .join(pl, pl.c.id == logs.c.planting_id)
                .join(crops, crops.c.id == pl.c.crop_id)
                .join(plots, plots.c.id == pl.c.plot_id)
                .join(farms, farms.c.id == plots.c.farm_id)
                .where(pl.c.user_id == user['id'], pl.c.status.in_(ACTIVE_STATUSES),
                       logs.c.completed_at.is_(None), logs.c.start_date <= today_kst())
                .order_by(logs.c.start_date, logs.c.id)).mappings().all()
        # 모종 옮겨심기를 할 때가 된 작물은 포트 물 주기 같은 '옮기기 전' 반복 할 일을 더 보여 주지 않는다(옮겨심는 날 포트에 물 줄 일은 없다)
        moving = {r['planting_id'] for r in rows if r['triggers_stage'] == TRANSPLANT_STAGE_NO}
        rows = [r for r in rows if not (r['planting_id'] in moving and r['seed_only'] and r['repeat_min_days'] is not None)]
        return {'tasks': [{
            'id': r['id'], 'plantingId': r['planting_id'], 'farm': r['farm'], 'farmName': r['farm_name'], 'position': r['position'],
            'crop': r['crop_name'], 'title': r['title'], 'points': r['points'], 'tip': r['tip'], 'howTo': r['how_to'],
            'imageUrl': r['image_url'], 'infoOnly': bool(r['info_only']), 'triggersStage': r['triggers_stage'], 'startDate': r['start_date'].isoformat(),
            'endDate': r['end_date'].isoformat() if r['end_date'] else None,
        } for r in rows]}

    @router.post('/tasks/complete')
    def complete_tasks(body: CompleteTasks, user=Depends(get_current_user)):
        """일지 올리기: 일지를 만들고, 체크한 할 일을 완료하고, 포인트를 주고, 이어지는 할 일·단계를 처리한다.

        harvest가 true이면 수확도 함께 기록한다(첫 수확이면 status를 harvested로 바꾸고 보너스를 한 번만 준다).
        """
        logs, ct, pl, plots, farms, crops = (t[k] for k in ('task_logs', 'crop_tasks', 'plantings', 'plots', 'farms', 'crops'))
        ids = list(dict.fromkeys(body.task_log_ids))
        moment, today = now_kst(), today_kst()
        with engine.begin() as conn:
            lock_user(conn, user['id'])
            planting = conn.execute(
                select(pl.c.id, pl.c.status, pl.c.crop_id, pl.c.planted_at)
                .where(pl.c.id == body.planting_id, pl.c.user_id == user['id'])).mappings().first()
            if not planting:
                raise HTTPException(404, '작물을 찾을 수 없어요.')
            if planting['status'] not in ACTIVE_STATUSES:
                raise HTTPException(409, '이미 끝난 작물이에요.')
            planting = dict(planting)
            found = [dict(r) for r in conn.execute(
                select(logs.c.id, logs.c.start_date, logs.c.completed_at, logs.c.crop_task_id)
                .where(logs.c.id.in_(ids), logs.c.planting_id == planting['id'])).mappings()] if ids else []
            if len(found) != len(ids):
                raise HTTPException(404, '할 일을 찾을 수 없어요.')
            if any(r['completed_at'] is not None for r in found):
                raise HTTPException(409, '이미 완료한 할 일이에요.')
            if any(r['start_date'] > today for r in found):
                raise HTTPException(409, '아직 시작할 때가 되지 않은 할 일이에요.')
            if body.harvest and conn.execute(
                    select(t['harvests'].c.id).where(t['harvests'].c.planting_id == planting['id'],
                                                     t['harvests'].c.harvested_at >= datetime.combine(today, datetime.min.time())).limit(1)).first():
                raise HTTPException(409, '오늘은 이미 수확을 기록했어요. 내일 다시 기록할 수 있어요.')

            tasks = crop_tasks_of(conn, t, planting['crop_id'])
            by_id = {x['id']: x for x in tasks}
            content = body.content or ' · '.join(
                [by_id[r['crop_task_id']]['title'] + ' 완료' for r in found] + (['수확했어요 🧺'] if body.harvest else []))
            photo_json = json.dumps(body.photos) if body.photos else None
            names = conn.execute(
                select(farms.c.name.label('farm_name'), crops.c.name.label('crop_name'))
                .select_from(pl).join(crops, crops.c.id == pl.c.crop_id)
                .outerjoin(plots, plots.c.id == pl.c.plot_id).outerjoin(farms, farms.c.id == plots.c.farm_id)
                .where(pl.c.id == planting['id'])).mappings().one()
            journal_id = conn.execute(insert(t['journals']).values(
                planting_id=planting['id'], user_id=user['id'], content=content[:500], photo_url=photo_json,
                farm_name=names['farm_name'], crop_name=names['crop_name'], date_label=date_label(moment),
            )).inserted_primary_key[0]

            stages = [dict(r) for r in conn.execute(
                select(t['crop_stages']).where(t['crop_stages'].c.crop_id == planting['crop_id'])).mappings()]
            care = conn.execute(select(t['garden_plant_care'].c.details).where(t['garden_plant_care'].c.planting_id == planting['id'])).scalar()
            method = method_of(care) or 'seedling'

            earned = 0
            # 옮겨심기가 같이 체크되어도 이어지는 할 일이 올바른 날짜로 만들어지도록 id 순서로 처리한다
            for row in sorted(found, key=lambda r: r['id']):
                task = by_id[row['crop_task_id']]
                conn.execute(update(logs).where(logs.c.id == row['id'], logs.c.completed_at.is_(None))
                             .values(completed_at=moment, journal_id=journal_id, photo_url=photo_json))
                grant_points(conn, t, user['id'], task['points'], f"할 일 완료: {task['title']}")
                earned += task['points']
                _complete_follow_ups(conn, t, planting, method, task, moment.date(), tasks, stages)

            first, bonus = False, 0
            if body.harvest:
                conn.execute(insert(t['harvests']).values(planting_id=planting['id'], harvested_at=moment))
                first = conn.execute(update(pl).where(pl.c.id == planting['id'], pl.c.status == 'growing').values(status='harvested')).rowcount == 1
                if first:
                    bonus = FIRST_HARVEST_BONUS
                    grant_points(conn, t, user['id'], bonus, '첫 수확 보너스')
            result = full_state(conn, user['id'])
        return {**result, 'earned': earned + bonus, 'taskPoints': earned, 'firstHarvest': first, 'bonus': bonus}

    app.include_router(router)
