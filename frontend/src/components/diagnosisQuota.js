const KST_OFFSET = 9 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

export function kstDate(now) {
  return new Date(now + KST_OFFSET).toISOString().slice(0, 10)
}

export function nextKstMidnight(now) {
  return Math.floor((now + KST_OFFSET) / DAY) * DAY + DAY - KST_OFFSET
}

// Only the latest quota GET may publish a value. Mutation-triggered refreshes
// supersede in-flight reads; concurrent ordinary refreshes share one GET.
export function createDiagnosisQuota({ fetchQuota, publish, now = Date.now }) {
  let version = 0
  let pending = null
  let active = true
  let observedDate = kstDate(now())
  let state = { quota: null, loading: true, error: '' }
  const emit = value => {
    state = value
    if (active) publish(state)
  }

  function refresh({ invalidate = false } = {}) {
    if (!active) return Promise.resolve(null)
    if (pending && !invalidate) return pending
    const requestVersion = ++version
    const requestDate = kstDate(now())
    observedDate = requestDate
    emit({ quota: null, loading: true, error: '' })
    const request = Promise.resolve().then(fetchQuota).then(quota => {
      if (!active || requestVersion !== version) return null
      if (requestDate !== kstDate(now())) {
        return refresh({ invalidate: true })
      }
      emit({ quota, loading: false, error: '' })
      return quota
    }).catch(() => {
      if (active && requestVersion === version) {
        emit({ quota: null, loading: false, error: '남은 횟수를 확인할 수 없습니다' })
      }
      return null
    }).finally(() => {
      if (requestVersion === version) pending = null
    })
    pending = request
    return request
  }

  return {
    refresh,
    getState: () => state,
    checkDate() {
      if (observedDate === kstDate(now())) return false
      refresh({ invalidate: true })
      return true
    },
    dispose() {
      active = false
      version++
      pending = null
    },
  }
}

export function watchDiagnosisQuota(controller, { window, document, now = Date.now }) {
  let timer
  function schedule() {
    window.clearTimeout(timer)
    const reset = Date.parse(controller.getState().quota?.reset_at)
    const boundary = reset > now() ? reset : nextKstMidnight(now())
    timer = window.setTimeout(() => {
      controller.checkDate()
      schedule()
    }, Math.max(1, boundary - now()))
  }
  function activate() {
    if (document.visibilityState === 'hidden') return
    if (!controller.checkDate()) controller.refresh()
    schedule()
  }
  // The low-frequency check detects sleep/clock changes without polling the API.
  const interval = window.setInterval(() => {
    if (document.visibilityState !== 'hidden' && controller.checkDate()) schedule()
  }, 60_000)
  document.addEventListener('visibilitychange', activate)
  window.addEventListener('focus', activate)
  window.addEventListener('pageshow', activate)
  schedule()
  return () => {
    window.clearTimeout(timer)
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', activate)
    window.removeEventListener('focus', activate)
    window.removeEventListener('pageshow', activate)
  }
}
