"""포인트샵 검사. 임시 SQLite만 쓰고 .env의 실제 DB는 건드리지 않는다."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_temp = tempfile.TemporaryDirectory()
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(_temp.name) / 'shop.db')
os.environ['JWT_SECRET'] = 'integration-tests-only-32-character-secret'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from sqlalchemy import text
from main import app, engine

ADDRESS = {'recipient': ' 홍길동 ', 'phone': '010-1234-5678', 'zip': '12345', 'address': '서울시 어딘가 12', 'address_detail': '101동 202호'}


def rows(sql, **params):
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings()]


class ShopTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        with engine.begin() as conn:
            for table in ('reward_exchanges', 'orders', 'point_logs', 'cart_items', 'shipping_addresses', 'rewards'):
                conn.execute(text(f'DELETE FROM {table}'))
            conn.execute(text(
                "INSERT INTO rewards (name, category, price, is_shipping, grant_count, icon_key, is_active, sort_order) VALUES "
                "('물뿌리개', '도구', 400, 1, NULL, 'can', 1, 2), ('숨김', '도구', 10, 1, NULL, 'x', 0, 1), "
                "('AI진단 1회 충전', '기능', 100, 0, 1, 'diag1', 1, 3)"
            ))

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def guest(self):
        data = self.client.post('/auth/guest', json={}).json()
        return {'Authorization': 'Bearer ' + data['access_token']}

    _kakao_seq = 0

    def member(self, point=1250):
        """카카오 회원 한 명을 만들어 인증 헤더와 사용자 id를 돌려준다."""
        ShopTest._kakao_seq += 1
        h = self.guest()
        with patch('main.fetch_kakao_profile', return_value={'kakao_id': f'k{ShopTest._kakao_seq}', 'nickname': '회원'}):
            linked = self.client.post('/auth/link-kakao', headers=h, json={'code': 'x'}).json()
        uid = linked['user']['id']
        with engine.begin() as conn:
            conn.execute(text('UPDATE users SET point = :p WHERE id = :u'), {'p': point, 'u': uid})
        return {'Authorization': 'Bearer ' + linked['access_token']}, uid

    def test_point_logs_paging(self):
        h, uid = self.member()
        other_h, other_uid = self.member()
        with engine.begin() as conn:
            for i in range(7):
                conn.execute(text("INSERT INTO point_logs (user_id, amount, reason, created_at) VALUES (:u, :a, :r, :t)"),
                             {'u': uid, 'a': 10, 'r': f'로그{i}', 't': f'2026-10-0{i + 1} 09:00:00'})
            conn.execute(text("INSERT INTO point_logs (user_id, amount, reason) VALUES (:u, 5, '남의 로그')"), {'u': other_uid})
        first = self.client.get('/me/point-logs?offset=0&limit=5', headers=h).json()
        self.assertEqual([x['name'] for x in first['items']], ['로그6', '로그5', '로그4', '로그3', '로그2'])
        self.assertTrue(first['has_more'])
        second = self.client.get('/me/point-logs?offset=5&limit=5', headers=h).json()
        self.assertEqual([x['name'] for x in second['items']], ['로그1', '로그0'])
        self.assertFalse(second['has_more'])
        self.assertEqual(self.client.get('/me/point-logs', headers=h).status_code, 200)
        self.assertEqual(self.client.get('/me/point-logs?limit=0', headers=h).status_code, 422)
        self.assertEqual(self.client.get('/me/point-logs').status_code, 401)

    def reward_id(self, name):
        return rows('SELECT id FROM rewards WHERE name = :n', n=name)[0]['id']

    def test_exchange_shipping_item_with_new_address(self):
        h, uid = self.member()
        rid = self.reward_id('물뿌리개')

        # 배송지가 없으면 거절
        res = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': rid, 'quantity': 1}]})
        self.assertEqual((res.status_code, res.json()['detail']), (400, '배송지를 입력해 주세요.'))
        self.assertEqual(rows('SELECT point FROM users WHERE id = :u', u=uid)[0]['point'], 1250)

        body = {'items': [{'reward_id': rid, 'quantity': 2}], 'address': ADDRESS, 'request_note': ' 문 앞에 ', 'save_address': True}
        res = self.client.post('/exchanges', headers=h, json=body)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()['total'], res.json()['point']), (800, 450))

        ex = rows('SELECT * FROM reward_exchanges WHERE user_id = :u', u=uid)
        self.assertEqual((len(ex), ex[0]['quantity'], ex[0]['unit_price'], ex[0]['total_point']), (1, 2, 400, 800))
        # 교환 한 번 = 주문 하나. 배송지는 주문에 복사되고, 배송 상품이 있으니 접수(received)로 시작한다
        order = rows('SELECT * FROM orders WHERE user_id = :u', u=uid)
        self.assertEqual(len(order), 1)
        self.assertEqual(ex[0]['order_id'], order[0]['id'])
        self.assertEqual((order[0]['status'], order[0]['total_points']), ('received', 800))
        self.assertEqual((order[0]['recipient_name'], order[0]['recipient_phone'], order[0]['zip']), ('홍길동', '010-1234-5678', '12345'))
        self.assertEqual((order[0]['address'], order[0]['address_detail'], order[0]['request_memo']), ('서울시 어딘가 12', '101동 202호', '문 앞에'))
        self.assertEqual((res.json()['order_id'], res.json()['order_no']), (order[0]['id'], order[0]['order_no']))
        self.assertRegex(order[0]['order_no'], rf'^\d{{8}}-{uid:04d}-01$')
        log = rows('SELECT * FROM point_logs WHERE user_id = :u', u=uid)
        self.assertEqual([(l['amount'], l['reason']) for l in log], [(-800, '물뿌리개 2개 교환')])
        self.assertEqual(self.client.get('/shipping-address', headers=h).json()['recipient'], '홍길동')  # 저장됨

        # 주소를 보내지 않으면 저장된 배송지를 쓴다
        res = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': rid}], 'request_note': ''})
        self.assertEqual((res.status_code, res.json()['point']), (200, 50))
        newest = rows('SELECT * FROM orders ORDER BY id DESC LIMIT 1')[0]
        self.assertEqual((newest['recipient_name'], newest['request_memo']), ('홍길동', None))  # 저장된 배송지가 주문에 복사되고, 빈 요청사항은 비움
        self.assertRegex(newest['order_no'], rf'^\d{{8}}-{uid:04d}-02$')  # 같은 날 두 번째 주문

    def test_exchange_does_not_save_address_unless_asked(self):
        h, _ = self.member()
        rid = self.reward_id('물뿌리개')
        self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': rid}], 'address': ADDRESS, 'save_address': False})
        self.assertIsNone(self.client.get('/shipping-address', headers=h).json())

    def test_exchange_rejects_guest_and_insufficient_points_without_side_effects(self):
        rid = self.reward_id('물뿌리개')
        guest = self.guest()
        res = self.client.post('/exchanges', headers=guest, json={'items': [{'reward_id': rid}], 'address': ADDRESS})
        self.assertEqual(res.status_code, 403)

        h, uid = self.member(point=399)
        res = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': rid}], 'address': ADDRESS, 'save_address': True})
        self.assertEqual((res.status_code, res.json()['detail']), (400, '포인트가 부족해요.'))
        self.assertEqual(rows('SELECT point FROM users WHERE id = :u', u=uid)[0]['point'], 399)
        self.assertEqual(rows('SELECT * FROM reward_exchanges'), [])
        self.assertEqual(rows('SELECT * FROM orders'), [])  # 실패하면 주문도 남지 않는다
        self.assertEqual(rows('SELECT * FROM point_logs'), [])
        self.assertIsNone(self.client.get('/shipping-address', headers=h).json())  # 실패하면 배송지도 저장되지 않는다

        bad = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': rid}, {'reward_id': 99999}], 'address': ADDRESS})
        self.assertEqual(bad.status_code, 404)
        self.assertEqual(self.client.post('/exchanges', headers=h, json={'items': []}).status_code, 400)
        self.assertEqual(self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': rid, 'quantity': 10}], 'address': ADDRESS}).status_code, 400)

    def test_exchange_feature_item_charges_diagnosis_without_address(self):
        h, uid = self.member()
        rid = self.reward_id('AI진단 1회 충전')
        res = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': rid, 'quantity': 3}]})
        self.assertEqual((res.status_code, res.json()['point']), (200, 950))
        self.assertEqual(rows('SELECT diag_credits FROM users WHERE id = :u', u=uid)[0]['diag_credits'], 3)
        # 기능 상품만 있으면 배송지 없이 주문이 바로 충전 완료(completed)가 된다
        order = rows('SELECT * FROM orders WHERE user_id = :u', u=uid)[0]
        self.assertEqual((order['status'], order['total_points'], order['recipient_name'], order['request_memo']), ('completed', 300, None, None))

    def test_exchange_from_cart_removes_only_exchanged_items(self):
        h, uid = self.member()
        can, diag = self.reward_id('물뿌리개'), self.reward_id('AI진단 1회 충전')
        with engine.begin() as conn:
            conn.execute(text('DELETE FROM rewards WHERE name = :n'), {'n': '숨김'})
            conn.execute(text("INSERT INTO rewards (name, category, price, is_shipping, is_active, sort_order) VALUES ('모종삽', '도구', 350, 1, 1, 4)"))
        shovel = self.reward_id('모종삽')
        for rid in (can, diag, shovel):
            self.client.post('/cart/items', headers=h, json={'reward_id': rid})

        body = {'items': [{'reward_id': can, 'quantity': 1}, {'reward_id': diag, 'quantity': 1}], 'address': ADDRESS, 'remove_from_cart': True}
        res = self.client.post('/exchanges', headers=h, json=body)
        self.assertEqual((res.status_code, res.json()['total'], res.json()['point']), (200, 500, 750))
        self.assertEqual([c['name'] for c in self.client.get('/cart', headers=h).json()], ['모종삽'])
        self.assertEqual(len(rows('SELECT DISTINCT order_id FROM reward_exchanges WHERE user_id = :u', u=uid)), 1)  # 한 주문으로 묶임
        order = rows('SELECT * FROM orders WHERE user_id = :u', u=uid)
        self.assertEqual((len(order), order[0]['status'], order[0]['total_points']), (1, 'received', 500))  # 기능 상품이 섞여도 배송이 있으면 접수
        self.assertEqual(len(rows('SELECT * FROM point_logs WHERE user_id = :u', u=uid)), 2)

    def exchange(self, h, name, quantity=1, **extra):
        res = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': self.reward_id(name), 'quantity': quantity}], 'address': ADDRESS, **extra})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_order_number_retries_when_it_collides(self):
        h, uid = self.member()
        prefix = rows('SELECT order_no FROM orders') or None
        first = self.exchange(h, '물뿌리개')
        # 번호가 겹치면(다른 요청이 먼저 같은 번호를 쓴 경우) 전부 취소하고 번호를 바꿔 다시 시도한다
        with patch('shop.next_order_no', side_effect=[first['order_no'], first['order_no'][:-2] + '09']):
            second = self.exchange(h, '물뿌리개')
        self.assertTrue(second['order_no'].endswith('-09'))
        self.assertEqual(len(rows('SELECT * FROM orders WHERE user_id = :u', u=uid)), 2)
        self.assertEqual(len(rows('SELECT * FROM point_logs WHERE user_id = :u', u=uid)), 2)  # 겹친 시도의 차감은 남지 않는다
        self.assertEqual(rows('SELECT point FROM users WHERE id = :u', u=uid)[0]['point'], 1250 - 800)

    def test_order_number_is_unique_per_user_and_day(self):
        (a, _), (b, _) = self.member(), self.member()
        numbers = [self.exchange(a, '물뿌리개')['order_no'], self.exchange(b, '물뿌리개')['order_no'], self.exchange(a, '물뿌리개')['order_no']]
        self.assertEqual(len(set(numbers)), 3)
        self.assertEqual([n[-2:] for n in numbers], ['01', '01', '02'])  # 사용자마다 그날 순번이 따로 올라간다

    def test_my_orders_list_filters_and_item_fields(self):
        h, uid = self.member(point=5000)
        can, diag = self.reward_id('물뿌리개'), self.reward_id('AI진단 1회 충전')
        shipping = self.exchange(h, '물뿌리개')  # 배송 상품 -> received
        feature = self.exchange(h, 'AI진단 1회 충전', 2)  # 기능만 -> completed
        mixed = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': can}, {'reward_id': diag}], 'address': ADDRESS}).json()

        orders = self.client.get('/me/orders', headers=h).json()
        self.assertEqual([o['id'] for o in orders], [mixed['order_id'], feature['order_id'], shipping['order_id']])  # 최근 순
        first = orders[0]
        self.assertEqual(set(first), {'id', 'order_no', 'created_at', 'status', 'total_points', 'first_item_name', 'first_item_icon_key', 'first_item_category', 'item_count', 'has_shipping'})
        self.assertEqual((first['first_item_name'], first['first_item_icon_key'], first['first_item_category'], first['item_count'], first['has_shipping']), ('물뿌리개', 'can', '도구', 2, True))
        self.assertEqual((orders[1]['status'], orders[1]['has_shipping'], orders[1]['item_count'], orders[1]['total_points']), ('completed', False, 1, 200))

        # 진행 중 / 완료 필터. Supabase에서 상태를 바꾸면 목록이 따라 바뀐다
        with engine.begin() as conn:
            conn.execute(text("UPDATE orders SET status = 'shipping' WHERE id = :i"), {'i': shipping['order_id']})
            conn.execute(text("UPDATE orders SET status = 'delivered' WHERE id = :i"), {'i': mixed['order_id']})
        ids = lambda status: sorted(o['id'] for o in self.client.get(f'/me/orders?status={status}', headers=h).json())
        self.assertEqual(ids('ing'), [shipping['order_id']])
        self.assertEqual(ids('done'), sorted([mixed['order_id'], feature['order_id']]))
        self.assertEqual(len(ids('all')), 3)
        self.assertEqual(self.client.get('/me/orders?status=weird', headers=h).status_code, 400)
        self.assertEqual(self.client.get('/me/orders').status_code, 401)

    def test_my_orders_are_private_and_guest_gets_empty_list(self):
        h, _ = self.member()
        order = self.exchange(h, '물뿌리개')
        other, _ = self.member()
        self.assertEqual(self.client.get('/me/orders', headers=other).json(), [])
        self.assertEqual(self.client.get(f"/me/orders/{order['order_id']}", headers=other).status_code, 404)  # 남의 주문
        self.assertEqual(self.client.get('/me/orders/99999', headers=h).status_code, 404)
        guest = self.guest()
        self.assertEqual(self.client.get('/me/orders', headers=guest).json(), [])
        self.assertEqual(self.client.get('/me/orders?status=ing', headers=guest).json(), [])

    def test_order_detail_shipping_and_feature(self):
        h, _ = self.member(point=5000)
        shipping = self.exchange(h, '물뿌리개', 2, request_note='문 앞에')
        with engine.begin() as conn:
            conn.execute(text("UPDATE orders SET status = 'shipping', courier = '○○택배', tracking_no = '1234-5678-9012' WHERE id = :i"), {'i': shipping['order_id']})
        detail = self.client.get(f"/me/orders/{shipping['order_id']}", headers=h).json()
        self.assertEqual((detail['status'], detail['courier'], detail['tracking_no'], detail['total_points']), ('shipping', '○○택배', '1234-5678-9012', 800))
        self.assertEqual(detail['shipping'], {'recipient_name': '홍길동', 'recipient_phone': '010-1234-5678', 'zip': '12345',
                                              'address': '서울시 어딘가 12', 'address_detail': '101동 202호', 'request_memo': '문 앞에'})
        self.assertEqual(detail['items'], [{'name': '물뿌리개', 'category': '도구', 'quantity': 2, 'points': 800, 'is_shipping': True, 'icon_key': 'can', 'grant_count': None}])

        # 배송지를 바꾸거나 지워도 지난 주문의 배송지는 그대로
        self.client.put('/shipping-address', headers=h, json={**ADDRESS, 'recipient': '김철수'})
        self.client.delete('/shipping-address', headers=h)
        self.assertEqual(self.client.get(f"/me/orders/{shipping['order_id']}", headers=h).json()['shipping']['recipient_name'], '홍길동')

        feature = self.client.post('/exchanges', headers=h, json={'items': [{'reward_id': self.reward_id('AI진단 1회 충전')}]}).json()
        detail = self.client.get(f"/me/orders/{feature['order_id']}", headers=h).json()
        self.assertEqual((detail['status'], detail['shipping'], detail['courier'], detail['tracking_no']), ('completed', None, None, None))
        self.assertEqual([i['is_shipping'] for i in detail['items']], [False])
        self.assertEqual([i['grant_count'] for i in detail['items']], [1])

    def test_kakao_link_choice_keeps_or_deletes_orders(self):
        h, uid = self.member()
        kakao_id = f'k{ShopTest._kakao_seq}'
        self.exchange(h, '물뿌리개')
        for choice, expected in (('kakao', 1), ('guest', 0)):
            guest = self.guest()
            with patch('main.fetch_kakao_profile', return_value={'kakao_id': kakao_id, 'nickname': '주문'}):
                asked = self.client.post('/auth/link-kakao', headers=guest, json={'code': 'x'}).json()
            self.assertEqual(asked['status'], 'choice_required')
            done = self.client.post('/auth/link-kakao', headers=guest, json={'link_ticket': asked['link_ticket'], 'choice': choice}).json()
            self.assertEqual(done['status'], 'linked')
            # 카카오 데이터를 고르면 주문이 남고, 비회원 데이터를 고르면 카카오 쪽 주문과 교환 기록이 함께 지워진다
            self.assertEqual(len(rows('SELECT * FROM orders WHERE user_id = :u', u=uid)), expected, choice)
            self.assertEqual(len(rows('SELECT * FROM reward_exchanges WHERE user_id = :u', u=uid)), expected, choice)

    def test_rewards_need_login_and_hide_inactive(self):
        self.assertEqual(self.client.get('/rewards').status_code, 401)
        res = self.client.get('/rewards', headers=self.guest())
        self.assertEqual(res.status_code, 200)
        self.assertEqual([r['name'] for r in res.json()], ['물뿌리개', 'AI진단 1회 충전'])

    def test_cart_add_counts_up_to_nine_and_moves_with_kakao_link(self):
        h = self.guest()  # 비회원도 담을 수 있다
        self.assertEqual(self.client.get('/cart', headers=h).json(), [])
        rid = rows("SELECT id FROM rewards WHERE name = '물뿌리개'")[0]['id']
        hidden = rows("SELECT id FROM rewards WHERE name = '숨김'")[0]['id']

        self.assertEqual(self.client.post('/cart/items', headers=h, json={'reward_id': rid}).json()['quantity'], 1)
        self.assertEqual(self.client.post('/cart/items', headers=h, json={'reward_id': rid}).json()['quantity'], 2)
        self.assertEqual(self.client.post('/cart/items', headers=h, json={'reward_id': hidden}).status_code, 404)
        self.assertEqual(self.client.post('/cart/items', headers=h, json={'reward_id': 99999}).status_code, 404)
        for _ in range(7):
            self.client.post('/cart/items', headers=h, json={'reward_id': rid})
        self.assertEqual(self.client.post('/cart/items', headers=h, json={'reward_id': rid}).status_code, 409)

        cart = self.client.get('/cart', headers=h).json()
        self.assertEqual([(c['name'], c['quantity'], c['price']) for c in cart], [('물뿌리개', 9, 400)])
        self.assertEqual(len(rows('SELECT * FROM cart_items')), 1)
        self.assertEqual(self.client.get('/cart').status_code, 401)

        with patch('main.fetch_kakao_profile', return_value={'kakao_id': 'cart-kakao', 'nickname': '테스트'}):
            linked = self.client.post('/auth/link-kakao', headers=h, json={'code': 'x'})
        h2 = {'Authorization': 'Bearer ' + linked.json()['access_token']}
        self.assertEqual(self.client.get('/cart', headers=h2).json()[0]['quantity'], 9)

    def test_cart_quantity_and_remove(self):
        h, other = self.guest(), self.guest()
        can, diag = self.reward_id('물뿌리개'), self.reward_id('AI진단 1회 충전')
        for rid in (can, diag):
            self.client.post('/cart/items', headers=h, json={'reward_id': rid})
        self.client.post('/cart/items', headers=other, json={'reward_id': can})

        patch_url = f'/cart/items/{can}'
        self.assertEqual(self.client.patch(patch_url, headers=h, json={'quantity': 5}).json()['quantity'], 5)
        self.assertEqual(self.client.patch(patch_url, headers=h, json={'quantity': 0}).status_code, 400)
        self.assertEqual(self.client.patch(patch_url, headers=h, json={'quantity': 10}).status_code, 400)
        self.assertEqual(self.client.patch('/cart/items/99999', headers=h, json={'quantity': 2}).status_code, 404)
        self.assertEqual(self.client.get('/cart', headers=other).json()[0]['quantity'], 1)  # 다른 사용자는 그대로

        # 선택 삭제(여러 개)와 개별 삭제는 같은 API. 다른 사용자의 장바구니는 건드리지 않는다
        res = self.client.delete(f'/cart/items?reward_ids={can}&reward_ids={diag}', headers=h)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.get('/cart', headers=h).json(), [])
        self.assertEqual(len(self.client.get('/cart', headers=other).json()), 1)
        self.assertEqual(self.client.delete(f'/cart/items?reward_ids={can}', headers=h).status_code, 200)  # 없어도 성공

    def test_shipping_address_is_one_per_user(self):
        h = self.guest()
        self.assertIsNone(self.client.get('/shipping-address', headers=h).json())

        saved = self.client.put('/shipping-address', headers=h, json=ADDRESS)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()['recipient'], '홍길동')  # 앞뒤 공백 제거

        again = {**ADDRESS, 'recipient': '김철수'}
        self.client.put('/shipping-address', headers=h, json=again)
        self.assertEqual(self.client.get('/shipping-address', headers=h).json()['recipient'], '김철수')
        self.assertEqual(len(rows('SELECT * FROM shipping_addresses')), 1)

        self.assertEqual(self.client.delete('/shipping-address', headers=h).status_code, 200)
        self.assertIsNone(self.client.get('/shipping-address', headers=h).json())
        self.assertEqual(self.client.delete('/shipping-address', headers=h).status_code, 200)  # 없어도 성공

    def test_shipping_address_phone_and_zip_format(self):
        h = self.guest()
        for phone in ('abc', '010-abcd-5678', '12345', '010--1234-5678', '010-1234-56789', '010 1234 5678', '-010-1234-5678'):
            res = self.client.put('/shipping-address', headers=h, json={**ADDRESS, 'phone': phone})
            self.assertEqual((res.status_code, res.json()['detail']), (400, '연락처를 올바르게 입력해 주세요.'), phone)
        for zip_code in ('1234', '123456', '가나다라마', '12 45', '1234a'):
            res = self.client.put('/shipping-address', headers=h, json={**ADDRESS, 'zip': zip_code})
            self.assertEqual((res.status_code, res.json()['detail']), (400, '우편번호를 올바르게 입력해 주세요.'), zip_code)
        for phone in ('010-1234-5678', '01012345678', '02-123-4567', '031-123-4567'):
            res = self.client.put('/shipping-address', headers=h, json={**ADDRESS, 'phone': phone})
            self.assertEqual(res.status_code, 200, phone)

    def test_shipping_address_validation_and_isolation(self):
        a, b = self.guest(), self.guest()
        res = self.client.put('/shipping-address', headers=a, json={**ADDRESS, 'recipient': ' '})
        self.assertEqual(res.json()['detail'], '받는 분을 입력해 주세요.')
        for missing in ('recipient', 'phone', 'zip', 'address'):
            res = self.client.put('/shipping-address', headers=a, json={**ADDRESS, missing: '  '})
            self.assertEqual(res.status_code, 400, missing)
        self.assertEqual(self.client.put('/shipping-address', headers=a, json={**ADDRESS, 'zip': '1' * 11}).status_code, 400)
        self.assertEqual(self.client.put('/shipping-address', headers=a, json={**ADDRESS, 'address_detail': ''}).status_code, 200)

        self.assertIsNone(self.client.get('/shipping-address', headers=b).json())  # 다른 사용자에겐 보이지 않는다

    def test_shipping_address_moves_with_kakao_link(self):
        h = self.guest()
        self.client.put('/shipping-address', headers=h, json=ADDRESS)
        with patch('main.fetch_kakao_profile', return_value={'kakao_id': 'shop-kakao', 'nickname': '테스트'}):
            linked = self.client.post('/auth/link-kakao', headers=h, json={'code': 'x'})
        self.assertEqual(linked.json()['status'], 'linked')
        h2 = {'Authorization': 'Bearer ' + linked.json()['access_token']}
        self.assertEqual(self.client.get('/shipping-address', headers=h2).json()['recipient'], '홍길동')


if __name__ == '__main__':
    unittest.main()
