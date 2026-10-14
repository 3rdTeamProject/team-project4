// 주문 상태(고정 5개). 상태는 앱에서 바꾸지 않고 운영하는 사람이 Supabase에서 직접 바꾼다.
// backend/shop.py의 ORDER_STATUSES와 같은 값으로 맞춰야 한다.
// tone: warn(주문 접수·상품 준비 중) / info(배송 중) / done(배송 완료·충전 완료), group: 진행 중(ing) / 완료(done)
export const ORDER_STATUS = {
  received: { label: '주문 접수', tone: 'warn', group: 'ing' },
  preparing: { label: '상품 준비 중', tone: 'warn', group: 'ing' },
  shipping: { label: '배송 중', tone: 'info', group: 'ing' },
  delivered: { label: '배송 완료', tone: 'done', group: 'done' },
  completed: { label: '충전 완료', tone: 'done', group: 'done' },
}

// 배송 진행 4단계(배송 상품이 있는 주문). 상태 -> 현재 단계 번호(0~3). 배송 완료는 마지막 단계까지 모두 끝난 것.
export const SHIPPING_STEPS = ['주문 접수', '상품 준비', '배송 중', '배송 완료']
export const SHIPPING_STEP_INDEX = { received: 0, preparing: 1, shipping: 2, delivered: 3, completed: 3 }
export const SHIPPING_HEADLINE = {
  received: '주문이 접수됐어요',
  preparing: '상품을 준비하고 있어요',
  shipping: '상품이 배송 중이에요',
  delivered: '배송이 완료됐어요',
  completed: '배송이 완료됐어요',
}

// 2026.10.14 (기기의 현재 시간대 기준)
export function formatOrderDate(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

// 2026.10.14 14:32
export function formatOrderDateTime(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${formatOrderDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
