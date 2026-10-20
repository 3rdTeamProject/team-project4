"""포인트샵: 상품 조회, 배송지, 장바구니, 포인트 교환, 주문 내역."""
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    UniqueConstraint,
    delete,
    func,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.exc import IntegrityError

CART_MAX_QUANTITY = 9  # 한 상품당 장바구니 최대 수량

KST = timezone(timedelta(hours=9))  # 한국 시간(주문번호의 날짜 기준)

# 주문 상태(고정). 앱에서는 바꾸지 않고 Supabase에서 직접 바꾼다.
ORDER_STATUSES = ('received', 'preparing', 'shipping', 'delivered', 'completed')
# GET /me/orders의 status 값 -> 포함할 상태 (all은 제한 없음)
ORDER_FILTERS = {
    'all': None,
    'ing': ('received', 'preparing', 'shipping'),  # 진행 중
    'done': ('delivered', 'completed'),  # 완료
}
ORDER_SHIPPING_KEYS = ('recipient_name', 'recipient_phone', 'zip', 'address', 'address_detail', 'request_memo')

# 배송지 입력 항목: (키, 화면 이름, 최대 글자 수, 필수 여부). 최대 글자 수는 shipping_addresses 컬럼 길이와 같다.
ADDRESS_FIELDS = [
    ('recipient', '받는 분', 50, True),
    ('phone', '연락처', 30, True),
    ('zip', '우편번호', 10, True),
    ('address', '기본 주소', 200, True),
    ('address_detail', '상세 주소', 100, False),
]


class AddressBody(BaseModel):
    recipient: str = ''
    phone: str = ''
    zip: str = ''
    address: str = ''
    address_detail: str = ''


class ExchangeItem(BaseModel):
    reward_id: int
    quantity: int = 1


class ExchangeBody(BaseModel):
    items: list[ExchangeItem] = Field(max_length=50)
    address: AddressBody | None = None  # 없으면 저장된 배송지를 쓴다 (배송 상품이 있을 때만 사용)
    request_note: str = ''  # 배송 요청사항
    save_address: bool = False  # address를 다음에도 쓰도록 저장
    remove_from_cart: bool = False  # 교환한 상품을 장바구니에서 지운다


def valid_phone(value: str) -> bool:
    """숫자와 하이픈만, 숫자는 9~11자리 (예: 010-1234-5678, 01012345678, 02-123-4567)."""
    return bool(re.fullmatch(r'[0-9]+(-[0-9]+){0,2}', value)) and 9 <= len(value.replace('-', '')) <= 11


def valid_zip(value: str) -> bool:
    """우편번호는 숫자 5자리."""
    return bool(re.fullmatch(r'[0-9]{5}', value))


def josa(word: str, with_final: str, without_final: str) -> str:
    """마지막 글자에 받침이 있으면 with_final, 없으면 without_final (예: 분+을, 처+를)."""
    code = ord(word[-1]) - 0xAC00
    return with_final if 0 <= code < 11172 and code % 28 else without_final


ADDRESS_FORMATS = {'phone': valid_phone, 'zip': valid_zip}


def clean_address(body: AddressBody) -> dict:
    """앞뒤 공백을 지우고 필수 항목·길이를 검사한다. 어긋나면 400."""
    values = {}
    for key, label, max_len, required in ADDRESS_FIELDS:
        value = getattr(body, key).strip()
        if required and not value:
            raise HTTPException(400, f'{label}{josa(label, "을", "를")} 입력해 주세요.')
        if len(value) > max_len:
            raise HTTPException(400, f'{label}{josa(label, "은", "는")} {max_len}자 이하로 입력해 주세요.')
        if value and key in ADDRESS_FORMATS and not ADDRESS_FORMATS[key](value):
            raise HTTPException(400, f'{label}{josa(label, "을", "를")} 올바르게 입력해 주세요.')
        values[key] = value
    return values


def next_order_no(conn, orders, user_id: int, skip: int = 0) -> str:
    """주문번호: 한국 날짜-유저ID(4자리)-그날 그 사용자의 순번(2자리). 예: 20261014-0014-01.
    같은 사용자가 같은 순간에 두 번 교환해 번호가 겹치면(UNIQUE 위반) skip을 늘려 다시 만든다."""
    prefix = f'{datetime.now(KST):%Y%m%d}-{user_id:04d}-'
    used = conn.execute(select(orders.c.order_no).where(orders.c.order_no.like(prefix + '%'))).scalars().all()
    last = max((int(no[len(prefix):]) for no in used if no[len(prefix):].isdigit()), default=0)
    return f'{prefix}{last + 1 + skip:02d}'


def register_shop(app, metadata, engine, get_current_user, users):
    rewards = Table(
        'rewards', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('name', String(100), nullable=False),
        Column('category', String(10), nullable=False),  # 씨앗 / 도구 / 기능
        Column('price', Integer, nullable=False),
        Column('is_shipping', Boolean, nullable=False),  # 씨앗·도구는 배송, 기능은 바로 적용
        Column('grant_count', Integer, nullable=True),  # 기능 상품이 충전하는 AI진단 횟수
        Column('icon_key', String(30), nullable=True),
        Column('is_active', Boolean, nullable=False, default=True),
        Column('sort_order', Integer, nullable=False, default=0),
        Column('created_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
        CheckConstraint("category IN ('씨앗','도구','기능')", name='rewards_category_check'),
        CheckConstraint('price > 0', name='rewards_price_check'),
    )

    shipping_addresses = Table(
        'shipping_addresses', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),  # 사용자당 1개
        Column('recipient', String(50), nullable=False),
        Column('phone', String(30), nullable=False),
        Column('zip', String(10), nullable=False),
        Column('address', String(200), nullable=False),
        Column('address_detail', String(100), nullable=False, default='', server_default=''),
        Column('updated_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
    )

    cart_items = Table(
        'cart_items', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        Column('reward_id', Integer, ForeignKey('rewards.id', ondelete='CASCADE'), nullable=False),
        Column('quantity', Integer, nullable=False, default=1, server_default=text('1')),
        Column('created_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
        UniqueConstraint('user_id', 'reward_id', name='cart_items_user_reward_uq'),
        CheckConstraint(f'quantity BETWEEN 1 AND {CART_MAX_QUANTITY}', name='cart_items_quantity_check'),
    )

    orders = Table(
        'orders', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        Column('order_no', String(30), nullable=False, unique=True),
        Column('status', String(20), nullable=False, default='received', server_default='received'),
        Column('total_points', Integer, nullable=False),
        # 주문할 때 복사한 배송지. 배송 상품이 없으면 비운다
        Column('recipient_name', String(50), nullable=True),
        Column('recipient_phone', String(30), nullable=True),
        Column('zip', String(10), nullable=True),
        Column('address', String(200), nullable=True),
        Column('address_detail', String(100), nullable=True),
        Column('request_memo', String(200), nullable=True),
        # 아래 네 값은 운영하는 사람이 Supabase에서 직접 넣는다(앱에서 바꾸는 API 없음)
        Column('courier', String(50), nullable=True),
        Column('tracking_no', String(50), nullable=True),
        Column('created_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
        Column('shipped_at', DateTime(timezone=True), nullable=True),
        Column('delivered_at', DateTime(timezone=True), nullable=True),
        CheckConstraint(f'status IN {ORDER_STATUSES}', name='orders_status_check'),
        CheckConstraint('total_points >= 0', name='orders_total_points_check'),
    )
    reward_exchanges = Table(
        'reward_exchanges', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('reward_id', Integer, ForeignKey('rewards.id'), nullable=False),
        Column('order_id', Integer, ForeignKey('orders.id', ondelete='CASCADE'), nullable=False, index=True),
        Column('quantity', Integer, nullable=False),
        Column('unit_price', Integer, nullable=False),
        Column('total_point', Integer, nullable=False),
        Column('created_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
    )
    point_logs = Table(
        'point_logs', metadata,
        Column('id', Integer, primary_key=True, autoincrement=True),
        Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        Column('amount', Integer, nullable=False),  # 음수면 사용
        Column('reason', String(100), nullable=False),
        Column('created_at', DateTime(timezone=True), nullable=False, server_default=func.now()),
        Index('point_logs_user_created_ix', 'user_id', 'created_at'),  # 포인트 내역은 사용자별 최신순으로 읽는다
    )

    def address_json(row):
        return {key: row[key] for key, *_ in ADDRESS_FIELDS}

    def upsert_address(conn, user_id, values):
        where = shipping_addresses.c.user_id == user_id
        changed = conn.execute(update(shipping_addresses).where(where).values(**values, updated_at=func.now())).rowcount
        if not changed:
            conn.execute(insert(shipping_addresses).values(user_id=user_id, **values))

    router = APIRouter(tags=['shop'])

    @router.get('/rewards')
    def list_rewards(_user=Depends(get_current_user)):
        """판매 중인 상품 목록. 비회원도 볼 수 있다."""
        with engine.connect() as conn:
            rows = conn.execute(
                select(rewards).where(rewards.c.is_active.is_(True)).order_by(rewards.c.sort_order, rewards.c.id)
            ).mappings()
            return [
                {
                    'id': r['id'],
                    'name': r['name'],
                    'category': r['category'],
                    'price': r['price'],
                    'is_shipping': r['is_shipping'],
                    'grant_count': r['grant_count'],
                    'icon_key': r['icon_key'],
                }
                for r in rows
            ]

    @router.get('/shipping-address')
    def read_shipping_address(user=Depends(get_current_user)):
        """저장된 배송지. 없으면 null."""
        with engine.connect() as conn:
            row = conn.execute(select(shipping_addresses).where(shipping_addresses.c.user_id == user['id'])).mappings().first()
        return address_json(row) if row else None

    @router.put('/shipping-address')
    def save_shipping_address(body: AddressBody, user=Depends(get_current_user)):
        """배송지를 저장한다. 이미 있으면 덮어쓴다(사용자당 1개)."""
        values = clean_address(body)
        with engine.begin() as conn:
            upsert_address(conn, user['id'], values)
        return values

    @router.delete('/shipping-address')
    def delete_shipping_address(user=Depends(get_current_user)):
        """배송지를 지운다. 없어도 성공으로 처리한다."""
        with engine.begin() as conn:
            conn.execute(delete(shipping_addresses).where(shipping_addresses.c.user_id == user['id']))
        return {'deleted': True}

    @router.get('/cart')
    def read_cart(user=Depends(get_current_user)):
        """장바구니 목록(담은 순서). 판매가 끝난 상품은 빠진다. 비회원도 쓸 수 있다."""
        query = (
            select(cart_items.c.reward_id, cart_items.c.quantity, rewards)
            .join(rewards, rewards.c.id == cart_items.c.reward_id)
            .where(cart_items.c.user_id == user['id'], rewards.c.is_active.is_(True))
            .order_by(cart_items.c.created_at, cart_items.c.id)
        )
        with engine.connect() as conn:
            return [
                {
                    'reward_id': r['reward_id'],
                    'quantity': r['quantity'],
                    'name': r['name'],
                    'category': r['category'],
                    'price': r['price'],
                    'is_shipping': r['is_shipping'],
                    'icon_key': r['icon_key'],
                }
                for r in conn.execute(query).mappings()
            ]

    class CartAddBody(BaseModel):
        reward_id: int

    @router.post('/cart/items')
    def add_to_cart(body: CartAddBody, user=Depends(get_current_user)):
        """상품을 장바구니에 1개 담는다. 이미 있으면 수량이 1 늘어난다."""
        with engine.begin() as conn:
            found = conn.execute(
                select(rewards.c.id).where(rewards.c.id == body.reward_id, rewards.c.is_active.is_(True))
            ).first()
            if not found:
                raise HTTPException(404, '상품을 찾을 수 없어요.')
            where = (cart_items.c.user_id == user['id']) & (cart_items.c.reward_id == body.reward_id)
            quantity = conn.execute(select(cart_items.c.quantity).where(where)).scalar_one_or_none()
            if quantity is None:
                conn.execute(insert(cart_items).values(user_id=user['id'], reward_id=body.reward_id, quantity=1))
                quantity = 1
            elif quantity >= CART_MAX_QUANTITY:
                raise HTTPException(409, f'한 상품은 {CART_MAX_QUANTITY}개까지 담을 수 있어요.')
            else:
                quantity += 1
                conn.execute(update(cart_items).where(where).values(quantity=quantity))
        return {'reward_id': body.reward_id, 'quantity': quantity}

    class CartQuantityBody(BaseModel):
        quantity: int

    @router.patch('/cart/items/{reward_id}')
    def set_cart_quantity(reward_id: int, body: CartQuantityBody, user=Depends(get_current_user)):
        """장바구니 상품의 수량을 바꾼다(1~9)."""
        if body.quantity < 1 or body.quantity > CART_MAX_QUANTITY:
            raise HTTPException(400, f'수량은 1~{CART_MAX_QUANTITY}개로 정해 주세요.')
        with engine.begin() as conn:
            changed = conn.execute(
                update(cart_items)
                .where(cart_items.c.user_id == user['id'], cart_items.c.reward_id == reward_id)
                .values(quantity=body.quantity)
            ).rowcount
        if not changed:
            raise HTTPException(404, '장바구니에 없는 상품이에요.')
        return {'reward_id': reward_id, 'quantity': body.quantity}

    @router.delete('/cart/items')
    def remove_from_cart(reward_ids: list[int] = Query(), user=Depends(get_current_user)):
        """장바구니에서 상품을 지운다. 개별 삭제와 선택 삭제를 같이 쓴다(reward_ids를 여러 개 보낼 수 있다). 없어도 성공."""
        with engine.begin() as conn:
            conn.execute(delete(cart_items).where(cart_items.c.user_id == user['id'], cart_items.c.reward_id.in_(reward_ids)))
        return {'deleted': reward_ids}

    @router.post('/exchanges')
    def exchange(body: ExchangeBody, user=Depends(get_current_user)):
        """상품을 포인트로 교환한다. 포인트 차감, 교환 기록, 포인트 내역(음수), 배송지 저장, 장바구니 정리를 한 번에 처리한다.
        하나라도 실패하면 전부 취소된다. 비회원은 교환할 수 없다."""
        if user['login_type'] == 'guest':
            raise HTTPException(403, '카카오톡 연동 후 교환할 수 있어요.')

        quantities: dict[int, int] = {}
        for item in body.items:
            quantities[item.reward_id] = quantities.get(item.reward_id, 0) + item.quantity
        if not quantities:
            raise HTTPException(400, '교환할 상품을 선택해 주세요.')
        if any(q < 1 or q > CART_MAX_QUANTITY for q in quantities.values()):
            raise HTTPException(400, '수량이 올바르지 않아요.')
        note = body.request_note.strip()
        if len(note) > 200:
            raise HTTPException(400, '배송 요청사항은 200자 이하로 입력해 주세요.')
        new_address = clean_address(body.address) if body.address is not None else None

        for attempt in range(3):
            try:
                with engine.begin() as conn:
                    result = place_order(conn, user, body, quantities, note, new_address, attempt)
                return result
            except IntegrityError as e:
                # 같은 사용자가 같은 순간 두 번 교환해 주문번호가 겹친 경우: 전부 취소됐으니 번호를 바꿔 다시 시도한다
                if 'order_no' not in str(e) or attempt == 2:
                    raise

    def place_order(conn, user, body, quantities, note, new_address, attempt):
        """교환 한 번 = 주문 하나. 포인트 차감, 주문, 교환 기록, 포인트 내역, 배송지 저장, 장바구니 정리를 한 트랜잭션에서 처리한다."""
        found = conn.execute(
            select(rewards).where(rewards.c.id.in_(list(quantities)), rewards.c.is_active.is_(True)).order_by(rewards.c.id)
        ).mappings().all()
        if len(found) != len(quantities):
            raise HTTPException(404, '상품을 찾을 수 없어요.')

        has_shipping = any(r['is_shipping'] for r in found)
        address = None  # 배송 상품이 있을 때 쓸 배송지
        if has_shipping:
            if new_address is not None:
                address = new_address
                if body.save_address:
                    upsert_address(conn, user['id'], new_address)
            else:
                saved = conn.execute(
                    select(shipping_addresses).where(shipping_addresses.c.user_id == user['id'])
                ).mappings().first()
                if not saved:
                    raise HTTPException(400, '배송지를 입력해 주세요.')
                address = address_json(saved)

        total = sum(r['price'] * quantities[r['id']] for r in found)
        # 부족 여부 검사와 차감을 한 문장으로 처리해 동시에 눌러도 포인트가 마이너스가 되지 않는다
        paid = conn.execute(
            update(users).where(users.c.id == user['id'], users.c.point >= total).values(point=users.c.point - total)
        ).rowcount
        if not paid:
            raise HTTPException(400, '포인트가 부족해요.')

        charge = sum((r['grant_count'] or 0) * quantities[r['id']] for r in found if not r['is_shipping'])
        if charge:
            conn.execute(update(users).where(users.c.id == user['id']).values(diag_credits=users.c.diag_credits + charge))

        # 배송 상품이 하나라도 있으면 접수(received)로 시작, 기능 상품만이면 바로 충전 완료(completed)
        order_no = next_order_no(conn, orders, user['id'], attempt)
        order_id = conn.execute(
            insert(orders).values(
                user_id=user['id'], order_no=order_no, status='received' if has_shipping else 'completed', total_points=total,
                # 배송지는 주문 시점 값을 복사해 둔다(나중에 배송지를 바꿔도 지난 주문은 그대로)
                recipient_name=address['recipient'] if address else None,
                recipient_phone=address['phone'] if address else None,
                zip=address['zip'] if address else None,
                address=address['address'] if address else None,
                address_detail=address['address_detail'] if address else None,
                request_memo=(note or None) if address else None,
            ).returning(orders.c.id)
        ).scalar_one()

        for r in found:
            quantity = quantities[r['id']]
            line_total = r['price'] * quantity
            conn.execute(insert(reward_exchanges).values(
                user_id=user['id'], reward_id=r['id'], order_id=order_id,
                quantity=quantity, unit_price=r['price'], total_point=line_total,
            ))
            reason = f"{r['name']} 교환" if quantity == 1 else f"{r['name']} {quantity}개 교환"
            conn.execute(insert(point_logs).values(user_id=user['id'], amount=-line_total, reason=reason))

        if body.remove_from_cart:
            conn.execute(delete(cart_items).where(cart_items.c.user_id == user['id'], cart_items.c.reward_id.in_(list(quantities))))

        point = conn.execute(select(users.c.point).where(users.c.id == user['id'])).scalar_one()
        return {'order_id': order_id, 'order_no': order_no, 'total': total, 'point': point}

    def order_items(conn, order_ids):
        """주문별 상품 줄 {order_id: [item, ...]} (교환 기록 순서)."""
        grouped = {oid: [] for oid in order_ids}
        if not order_ids:
            return grouped
        rows = conn.execute(
            select(reward_exchanges.c.order_id, reward_exchanges.c.quantity, reward_exchanges.c.total_point, rewards)
            .join(rewards, rewards.c.id == reward_exchanges.c.reward_id)
            .where(reward_exchanges.c.order_id.in_(order_ids))
            .order_by(reward_exchanges.c.id)
        ).mappings()
        for r in rows:
            grouped[r['order_id']].append({
                'name': r['name'],
                'category': r['category'],
                'quantity': r['quantity'],
                'points': r['total_point'],
                'is_shipping': r['is_shipping'],
                'icon_key': r['icon_key'],
                'grant_count': r['grant_count'],  # 기능 상품이 충전하는 AI진단 횟수(배송 상품은 null)
            })
        return grouped

    @router.get('/me/orders')
    def list_orders(status: str = 'all', user=Depends(get_current_user)):
        """내 주문 목록(최근 순). status: all / ing(진행 중) / done(완료). 비회원은 빈 목록."""
        if status not in ORDER_FILTERS:
            raise HTTPException(400, '주문 상태 값이 올바르지 않아요.')
        if user['login_type'] == 'guest':
            return []
        query = select(orders).where(orders.c.user_id == user['id'])
        if ORDER_FILTERS[status]:
            query = query.where(orders.c.status.in_(ORDER_FILTERS[status]))
        query = query.order_by(orders.c.created_at.desc(), orders.c.id.desc())
        with engine.connect() as conn:
            rows = conn.execute(query).mappings().all()
            items = order_items(conn, [r['id'] for r in rows])
        return [
            {
                'id': r['id'],
                'order_no': r['order_no'],
                'created_at': r['created_at'].isoformat(),
                'status': r['status'],
                'total_points': r['total_points'],
                'first_item_name': items[r['id']][0]['name'] if items[r['id']] else None,
                'first_item_icon_key': items[r['id']][0]['icon_key'] if items[r['id']] else None,
                'first_item_category': items[r['id']][0]['category'] if items[r['id']] else None,
                'item_count': len(items[r['id']]),
                'has_shipping': any(i['is_shipping'] for i in items[r['id']]),
            }
            for r in rows
        ]

    @router.get('/me/orders/{order_id}')
    def read_order(order_id: int, user=Depends(get_current_user)):
        """주문 상세. 내 주문이 아니면 404."""
        with engine.connect() as conn:
            row = conn.execute(
                select(orders).where(orders.c.id == order_id, orders.c.user_id == user['id'])
            ).mappings().first()
            if not row:
                raise HTTPException(404, '주문을 찾을 수 없어요.')
            items = order_items(conn, [order_id])[order_id]
        return {
            'id': row['id'],
            'order_no': row['order_no'],
            'created_at': row['created_at'].isoformat(),
            'status': row['status'],
            'total_points': row['total_points'],
            'courier': row['courier'],
            'tracking_no': row['tracking_no'],
            # 배송 상품이 없으면 배송지도 없다
            'shipping': {key: row[key] for key in ORDER_SHIPPING_KEYS} if any(i['is_shipping'] for i in items) else None,
            'items': items,
        }

    app.include_router(router)
