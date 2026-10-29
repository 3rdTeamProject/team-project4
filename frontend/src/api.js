import { DIAGNOSIS_QUOTA_CHANGED } from './components/diagnosisQuota.js'

const API_URL = (import.meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

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
  constructor(status, message, data = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function gardenPhotoRequest(path, { method = 'GET', file, preview } = {}) {
  const token = storage.token
  const body = file ? new FormData() : undefined
  if (body) { body.append('preview', preview); body.append('photo', file) }
  const response = await fetch(`${API_URL}${path}`, {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiError(response.status, data.detail || '원본 사진 요청에 실패했습니다.')
  }
  if (file) return response.json()
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const name = encodedName ? decodeURIComponent(encodedName) : /filename="([^"]+)"/.exec(disposition)?.[1] || '재배일지-원본사진'
  return { blob, name }
}

function normalizeDiagnosisResult(data = {}) {
  const quota = data.quota ?? data
  const status = data.status === 'limit_exceeded' ? 'limit' : data.status

  return {
    ...data,
    status,
    diseaseName: data.disease_name ?? data.diseaseName,
    retakeGuidance: data.retake_guidance ?? data.retakeGuidance,
    additionalChecks: data.additional_checks ?? data.additionalChecks,
    remainingCount: quota.remaining_count ?? data.remainingCount,
    dailyLimit: quota.daily_limit ?? data.dailyLimit,
    usedCount: quota.used_count ?? data.usedCount,
    creditCount: quota.credit_count ?? data.creditCount,
    nextAvailableAt: data.next_available_at ?? quota.reset_at ?? data.nextAvailableAt,
    requestId: data.request_id ?? data.requestId,
    statusUrl: data.status_url ?? data.statusUrl,
    isDemo: data.is_demo ?? data.isDemo,
  }
}

async function parseResponse(response) {
  return response.json().catch(() => ({}))
}

function handleUnauthorized(response, token) {
  if (response.status === 401 && token) {
    storage.logout()
    if (window.location.pathname !== '/') window.location.assign('/')
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
export async function request(path, { method = 'GET', body, auth = true, redirectOn401 = true, signal } = {}) {
  const token = auth ? storage.token : null
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  const data = await parseResponse(res)
  if (!res.ok) {
    if (redirectOn401) {
      handleUnauthorized(res, token)
    }
    throw new ApiError(res.status, data.detail || '요청에 실패했습니다.', data)
  }
  return data
}

// This deadline ends browser waiting only; abort does not cancel server analysis.
async function fetchDiagnosis(path, options, timeoutMs) {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Diagnosis response deadline exceeded')
      error.name = 'TimeoutError'
      reject(error)
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`${API_URL}${path}`, { ...options, signal: controller.signal })
        return { response, data: await parseResponse(response) }
      })(),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function readDiagnosisRequest(path, idempotencyKey) {
  const token = storage.token
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const { response, data } = await fetchDiagnosis(path, { method: 'GET', headers, cache: 'no-store' }, 10000)
  if (!response.ok) {
    handleUnauthorized(response, token)
    throw new ApiError(response.status, data.detail || '진단 결과를 확인할 수 없습니다.', data)
  }
  return {
    ...data,
    result: data.result ? normalizeDiagnosisResult(data.result) : null,
    requestId: data.request_id ?? data.requestId,
    isDemo: data.is_demo ?? data.isDemo,
    quotaReserved: data.quota_reserved ?? data.quotaReserved,
  }
}

async function diagnosisRequest(path, { method = 'GET', body, idempotencyKey } = {}) {
  const token = storage.token
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const { response, data } = await fetchDiagnosis(path, {
    method,
    headers,
    body,
  }, 90000)
  if (!response.ok) {
    if (response.status === 429 || data.status) {
      return normalizeDiagnosisResult(data)
    }
    handleUnauthorized(response, token)
    throw new ApiError(response.status, data.detail || 'AI 진단 요청을 처리하지 못했어요.', data)
  }
  return normalizeDiagnosisResult(data)
}

export const api = {
  guestLogin: (guestToken) =>
    request('/auth/guest', { method: 'POST', body: guestToken ? { guest_token: guestToken } : {}, auth: false }),
  kakaoLogin: (code) => request('/auth/kakao', { method: 'POST', body: { code }, auth: false }),
  // 비회원 토큰이 무효(401)면 KakaoCallback이 일반 카카오 로그인으로 넘어가므로 자동 이동하지 않는다
  // body: { code } 또는 { link_ticket, choice }
  linkKakao: (body) => request('/auth/link-kakao', { method: 'POST', body, redirectOn401: false }),
  gardenState: () => request('/garden/state'),
  deleteGardenHistory: (plantingId) => request(`/garden/history/${encodeURIComponent(plantingId)}`, { method: 'DELETE' }),
  uploadGardenOriginal: (preview, file) => gardenPhotoRequest('/garden/photos/original', { method: 'POST', preview, file }),
  gardenOriginal: (previewHash) => gardenPhotoRequest(`/garden/photos/original/${encodeURIComponent(previewHash)}`),
  saveGarden: (revision, state) => request('/garden/state', {method: 'PUT', body: {revision, state}}),
  gardenTasks: () => request('/garden/tasks'),
  gardenCrops: () => request('/garden/crops'),
  gardenDex: () => request('/garden/dex'),
  gardenPlaces: (q) => request(`/garden/places?q=${encodeURIComponent(q)}`),
  gardenDevDay: () => request('/garden/dev/day'),
  setGardenDevDay: (offset) => request('/garden/dev/day', { method: 'POST', body: { offset } }),
  completeGardenTasks: (body) => request('/garden/tasks/complete', { method: 'POST', body }),
  me: () => request('/me'),
  rewards: () => request('/rewards'),
  exchange: async (body) => {
    const controller = new AbortController()
    let timer
    let result
    try {
      result = await Promise.race([
        request('/exchanges', { method: 'POST', body, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new Error('교환 결과를 확인하지 못했어요. 다시 구매하기 전에 주문 내역을 확인해 주세요.'))
          }, 30_000)
        }),
      ])
    } finally { clearTimeout(timer) }
    // Both single-item and cart purchases use this path. Mounted diagnosis
    // screens must supersede reads started before the purchase committed.
    window.dispatchEvent(new Event(DIAGNOSIS_QUOTA_CHANGED))
    return result
  },
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
  diagnosisQuota: () => request('/diagnoses/quota'),
  diagnosisHistory: (page = 1, plantingId = '', pageSize = 10) => request(`/diagnoses/history?${new URLSearchParams({ page, page_size: pageSize, ...(plantingId ? { planting_id: plantingId } : {}) })}`),
  createDiagnosis: (formData, idempotencyKey) =>
    diagnosisRequest('/diagnoses', {
      method: 'POST',
      body: formData,
      idempotencyKey,
    }),
  diagnosisRequest: (requestId) => readDiagnosisRequest(`/diagnoses/requests/${encodeURIComponent(requestId)}`),
  diagnosisRequestByKey: (key) => readDiagnosisRequest('/diagnoses/requests/by-idempotency-key', key),
}

export function kakaoAuthorizeUrl() {
  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_KAKAO_CLIENT_ID,
    redirect_uri: 'http://localhost:5173/auth/kakao/callback',
    response_type: 'code',
  })
  return `https://kauth.kakao.com/oauth/authorize?${params}`
}
