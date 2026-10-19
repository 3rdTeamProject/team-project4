const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

export const storage = {
  get token() {
    return localStorage.getItem('token')
  },
  get loginType() {
    return localStorage.getItem('login_type')
  },
  get guestToken() {
    return localStorage.getItem('guest_token')
  },
  saveLogin(token, loginType) {
    localStorage.setItem('token', token)
    localStorage.setItem('login_type', loginType)
  },
  saveGuestToken(guestToken) {
    localStorage.setItem('guest_token', guestToken)
  },
  clearGuestToken() {
    localStorage.removeItem('guest_token')
  },
  // 로그아웃: 비회원 재로그인을 위해 guest_token은 남겨둔다
  logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('login_type')
  },
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * API 호출 공통 함수.
 *  - localStorage의 token을 Authorization: Bearer 헤더에 자동으로 붙인다.
 *  - 토큰을 보낸 요청이 401이면 저장된 로그인 정보를 지우고 시작 화면(/)으로 보낸다.
 * 옵션
 *  - auth: false  → 토큰을 붙이지 않는다(로그인 요청용).
 *  - redirectOn401: false → 401이어도 이동하지 않고 호출한 쪽이 처리하게 한다.
 */
export async function request(path, { method = 'GET', body, auth = true, redirectOn401 = true } = {}) {
  const token = auth ? storage.token : null
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && token && redirectOn401) {
      storage.logout()
      if (window.location.pathname !== '/') window.location.assign('/')
    }
    throw new ApiError(res.status, data.detail || '요청에 실패했습니다.')
  }
  return data
}

export const api = {
  guestLogin: (guestToken) =>
    request('/auth/guest', { method: 'POST', body: guestToken ? { guest_token: guestToken } : {}, auth: false }),
  kakaoLogin: (code) => request('/auth/kakao', { method: 'POST', body: { code }, auth: false }),
  // 비회원 토큰이 무효(401)면 KakaoCallback이 일반 카카오 로그인으로 넘어가므로 자동 이동하지 않는다
  // body: { code } 또는 { link_ticket, choice }
  linkKakao: (body) => request('/auth/link-kakao', { method: 'POST', body, redirectOn401: false }),
  gardenState: () => request('/garden/state'),
  saveGarden: (revision, state) => request('/garden/state', {method: 'PUT', body: {revision, state}}),
  gardenTasks: () => request('/garden/tasks'),
  gardenCrops: () => request('/garden/crops'),
  gardenPlaces: (q) => request(`/garden/places?q=${encodeURIComponent(q)}`),
  gardenDevDay: () => request('/garden/dev/day'),
  setGardenDevDay: (offset) => request('/garden/dev/day', { method: 'POST', body: { offset } }),
  completeGardenTasks: (body) => request('/garden/tasks/complete', { method: 'POST', body }),
  me: () => request('/me'),
  rewards: () => request('/rewards'),
  exchange: (body) => request('/exchanges', { method: 'POST', body }),
  orders: (status = 'all') => request(`/me/orders?status=${status}`),
  order: (id) => request(`/me/orders/${id}`),
  cart: () => request('/cart'),
  setCartQuantity: (rewardId, quantity) => request(`/cart/items/${rewardId}`, { method: 'PATCH', body: { quantity } }),
  removeFromCart: (rewardIds) =>
    request(`/cart/items?${rewardIds.map((id) => `reward_ids=${id}`).join('&')}`, { method: 'DELETE' }),
  addToCart: (rewardId) => request('/cart/items', { method: 'POST', body: { reward_id: rewardId } }),
  shippingAddress: () => request('/shipping-address'),
  saveShippingAddress: (address) => request('/shipping-address', { method: 'PUT', body: address }),
  deleteShippingAddress: () => request('/shipping-address', { method: 'DELETE' }),
  updateNotifications: (patch) => request('/me/notifications', { method: 'PATCH', body: patch }),
  mySummary: () => request('/me/summary'),
  pointLogs: (offset = 0, limit = 20) => request(`/me/point-logs?offset=${offset}&limit=${limit}`),
  updateNickname: (nickname) => request('/me/nickname', { method: 'PATCH', body: { nickname } }),
}

export function kakaoAuthorizeUrl() {
  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_KAKAO_CLIENT_ID,
    redirect_uri: 'http://localhost:5173/auth/kakao/callback',
    response_type: 'code',
  })
  return `https://kauth.kakao.com/oauth/authorize?${params}`
}
