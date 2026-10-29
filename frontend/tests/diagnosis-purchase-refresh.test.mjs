import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('successful purchase notifies quota watchers; failure does not, and diagnosis quota is preserved', async () => {
  const original = { fetch: globalThis.fetch, window: globalThis.window, localStorage: globalThis.localStorage }
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } })
  const events = []
  globalThis.window = { dispatchEvent: event => events.push(event.type) }
  globalThis.localStorage = { getItem: () => 'mock-token' }
  try {
    const { api } = await server.ssrLoadModule('/src/api.js')
    const order = { order_id: 1, point: 100 }
    const calls = []
    globalThis.fetch = async (url, options) => {
      calls.push({ url, ...options })
      return new Response(JSON.stringify(order))
    }
    assert.deepEqual(await api.exchange({ items: [{ reward_id: 1, quantity: 1 }] }), order)
    assert.deepEqual(events, ['diagnosis-quota-changed'])
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/exchanges'))
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].headers['Idempotency-Key'], undefined)
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'mock insufficient points' }), { status: 400 })
    await assert.rejects(api.exchange({ items: [] }))
    assert.equal(events.length, 1)
    const quota = { remaining_count: 0, daily_limit: 3, reset_at: '2026-10-27T00:00:00+09:00',
      purchased_balance: 2, purchased_reserved: 1, purchased_available: 1, can_request: true }
    globalThis.fetch = async () => new Response(JSON.stringify(quota))
    assert.deepEqual(await api.diagnosisQuota(), quota)
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'uncertain', reason: 'mock', quota }))
    const diagnosis = await api.createDiagnosis(new FormData(), 'mock-original-key')
    assert.deepEqual(diagnosis.quota, quota)
    assert.equal(diagnosis.status, 'uncertain')
    const oldSetTimeout = globalThis.setTimeout, oldClearTimeout = globalThis.clearTimeout
    let fire, signal
    try {
      globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 30_000); fire = fn; return 1 }
      globalThis.clearTimeout = () => {}
      globalThis.fetch = async (_, options) => { signal = options.signal; return new Promise(() => {}) }
      const pending = api.exchange({ items: [{ reward_id: 1 }] })
      fire()
      await assert.rejects(pending, /주문 내역/)
      assert.equal(signal.aborted, true)
      assert.equal(events.length, 1, 'timeout does not report a confirmed purchase')
    } finally {
      globalThis.setTimeout = oldSetTimeout
      globalThis.clearTimeout = oldClearTimeout
    }
  } finally {
    await server.close()
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
})
