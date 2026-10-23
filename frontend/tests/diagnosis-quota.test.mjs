import assert from 'node:assert/strict'
import test from 'node:test'
import { createDiagnosisQuota, kstDate, nextKstMidnight, watchDiagnosisQuota } from '../src/components/diagnosisQuota.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  let time = Date.parse('2026-10-23T23:59:59+09:00')
  const requests = []
  const published = []
  const controller = createDiagnosisQuota({
    now: () => time,
    publish: value => published.push(value),
    fetchQuota: () => {
      const request = deferred()
      requests.push(request)
      return request.promise
    },
  })
  return { controller, requests, published, now: () => time, advance: delta => { time += delta } }
}
const quota = count => ({ remaining_count: count, daily_limit: 3, reset_at: '2026-10-24T00:00:00+09:00' })

test('3, 2, 1, 0 are published exactly as returned by the server', async () => {
  const { controller, requests } = setup()
  for (const count of [3, 2, 1, 0]) {
    const result = controller.refresh()
    assert.equal(controller.getState().quota, null)
    await tick()
    requests.at(-1).resolve(quota(count))
    assert.deepEqual(await result, quota(count))
    assert.deepEqual(controller.getState(), { quota: quota(count), loading: false, error: '' })
  }
})

test('concurrent retry/focus/visibility reads share a request', async () => {
  const { controller, requests } = setup()
  const first = controller.refresh()
  assert.equal(controller.refresh(), first)
  await tick()
  assert.equal(requests.length, 1)
  requests[0].resolve(quota(2))
  await first
})

test('post-diagnosis read supersedes a pre-diagnosis read, even in reverse arrival order', async () => {
  const { controller, requests } = setup()
  const old = controller.refresh()
  await tick()
  const latest = controller.refresh({ invalidate: true })
  await tick()
  requests[1].resolve(quota(1))
  await latest
  requests[0].resolve(quota(3))
  assert.equal(await old, null)
  assert.equal(controller.getState().quota.remaining_count, 1)
})

test('obsolete failure cannot clear a newer successful quota', async () => {
  const { controller, requests } = setup()
  const old = controller.refresh()
  await tick()
  const latest = controller.refresh({ invalidate: true })
  await tick()
  requests[1].resolve(quota(2))
  await latest
  requests[0].reject(Error('old failure'))
  await old
  assert.equal(controller.getState().quota.remaining_count, 2)
  assert.equal(controller.getState().error, '')
})

test('failure hides old numbers, exposes guidance, and permits explicit retry', async () => {
  const { controller, requests } = setup()
  let result = controller.refresh()
  await tick()
  requests[0].resolve(quota(3))
  await result
  result = controller.refresh()
  assert.equal(controller.getState().quota, null)
  await tick()
  requests[1].reject(Error('offline'))
  assert.equal(await result, null)
  assert.equal(controller.getState().error, '남은 횟수를 확인할 수 없습니다')
  assert.equal(controller.getState().quota, null)
  result = controller.refresh()
  await tick()
  requests[2].resolve(quota(1))
  await result
  assert.equal(controller.getState().quota.remaining_count, 1)
  assert.equal(controller.getState().error, '')
})

test('KST rollover re-queries without awarding three uses locally', async () => {
  const env = setup()
  const before = env.controller.refresh()
  await tick()
  env.requests[0].resolve(quota(0))
  await before
  assert.equal(env.controller.checkDate(), false)
  env.advance(1000)
  assert.equal(kstDate(env.now()), '2026-10-24')
  assert.equal(env.controller.checkDate(), true)
  assert.equal(env.controller.checkDate(), false)
  assert.equal(env.controller.getState().quota, null)
  await tick()
  env.requests[1].resolve({ ...quota(2), reset_at: '2026-10-25T00:00:00+09:00' })
  await tick()
  assert.equal(env.controller.getState().quota.remaining_count, 2)
})

test('read crossing midnight cannot publish the previous day result', async () => {
  const env = setup()
  const request = env.controller.refresh()
  await tick()
  env.advance(1000)
  env.requests[0].resolve(quota(0))
  await tick()
  assert.equal(env.controller.getState().quota, null)
  assert.equal(env.requests.length, 2)
  env.requests[1].resolve(quota(3))
  await request
  assert.equal(env.controller.getState().quota.remaining_count, 3)
})

test('unmount prevents late updates', async () => {
  const { controller, requests, published } = setup()
  const request = controller.refresh()
  await tick()
  controller.dispose()
  const count = published.length
  requests[0].resolve(quota(2))
  assert.equal(await request, null)
  assert.equal(published.length, count)
})

function events() {
  const listeners = new Map()
  return {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    fire: name => listeners.get(name)?.(),
    listeners,
  }
}

test('tab return coalesces events; midnight timer and sleep recovery check KST dates', async () => {
  const env = setup()
  let timeout, delay, interval
  const window = {
    ...events(),
    setTimeout(fn, ms) { timeout = fn; delay = ms; return 1 },
    clearTimeout() {},
    setInterval(fn) { interval = fn; return 2 },
    clearInterval() {},
  }
  const document = { ...events(), visibilityState: 'visible' }
  const stop = watchDiagnosisQuota(env.controller, { window, document, now: env.now })
  assert.equal(delay, 1000)
  window.fire('focus')
  document.fire('visibilitychange')
  window.fire('pageshow')
  await tick()
  assert.equal(env.requests.length, 1)
  env.requests[0].resolve(quota(0))
  await tick()
  interval()
  await tick()
  assert.equal(env.requests.length, 1, 'no periodic quota polling on the same day')
  env.advance(1000)
  timeout()
  await tick()
  assert.equal(env.requests.length, 2)
  env.requests[1].resolve(quota(3))
  await tick()
  document.visibilityState = 'hidden'
  window.fire('focus')
  await tick()
  assert.equal(env.requests.length, 2)
  env.advance(2 * 24 * 60 * 60 * 1000)
  document.visibilityState = 'visible'
  interval()
  window.fire('focus')
  await tick()
  assert.equal(env.requests.length, 3)
  env.requests[2].resolve(quota(1))
  await tick()
  stop()
  assert.equal(window.listeners.size, 0)
  assert.equal(document.listeners.size, 0)
})

test('next midnight uses KST rather than the machine timezone', () => {
  const now = Date.parse('2026-10-23T14:59:59Z')
  assert.equal(nextKstMidnight(now), Date.parse('2026-10-23T15:00:00Z'))
})
