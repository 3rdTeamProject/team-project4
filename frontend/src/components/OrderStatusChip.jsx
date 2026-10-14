import { ORDER_STATUS } from '../constants/order.js'
import '../pages/orders.css'

// 주문 상태 칩. 모르는 상태 값은 그리지 않는다.
export default function OrderStatusChip({ status }) {
  const info = ORDER_STATUS[status]
  if (!info) return null
  return <span className={`order-chip ${info.tone}`}>{info.label}</span>
}
