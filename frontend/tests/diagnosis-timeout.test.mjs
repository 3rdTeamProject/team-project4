import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('diagnosis transport timeout and read-only recovery', async t => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } })
  const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, localStorage: globalThis.localStorage }
  globalThis.localStorage = { getItem: () => 'mock-token' }
  try {
    const { api } = await server.ssrLoadModule('/src/api.js')
    await t.test('initial POST stops waiting at 90 seconds even if transport ignores abort', async () => {
      let fire, delay, signal, cleared = false
      globalThis.setTimeout = (fn, ms) => { fire = fn; delay = ms; return 17 }
      globalThis.clearTimeout = id => { if (id === 17) cleared = true }
      globalThis.fetch = async (_, options) => { signal = options.signal; return new Promise(() => {}) }
      const pending = api.createDiagnosis(new FormData(), 'original-key')
      assert.equal(delay, 90000)
      fire()
      await assert.rejects(pending, error => error.name === 'TimeoutError')
      assert.equal(signal.aborted, true)
      assert.equal(cleared, true)
    })
    globalThis.setTimeout = original.setTimeout
    globalThis.clearTimeout = original.clearTimeout
    await t.test('lost response lookup sends only an authenticated GET with the original key', async () => {
      const calls = []
      globalThis.fetch = async (url, options) => {
        calls.push({ url, ...options })
        return new Response(JSON.stringify({ request_id: 'saved-id', status: 'completed', result: { status: 'diagnosed', disease_name: 'saved result' } }))
      }
      const result = await api.diagnosisRequestByKey('original-key')
      assert.equal(result.requestId, 'saved-id')
      assert.equal(result.result.diseaseName, 'saved result')
      assert.equal(calls.length, 1)
      assert.equal(calls[0].method, 'GET')
      assert.equal(calls[0].headers['Idempotency-Key'], 'original-key')
      assert.equal(calls[0].headers.Authorization, 'Bearer mock-token')
      assert.equal(calls[0].body, undefined)
    })
    await t.test('lookup not found stays an error, not a new diagnosis POST', async () => {
      const methods = []
      globalThis.fetch = async (_, options) => { methods.push(options.method); return new Response('{}', { status: 404 }) }
      await assert.rejects(api.diagnosisRequestByKey('original-key'), error => error.status === 404)
      assert.deepEqual(methods, ['GET'])
    })
    await t.test('successful POST clears its deadline and preserves idempotency header', async () => {
      let options
      globalThis.fetch = async (_, value) => { options = value; return new Response('{"status":"uncertain"}') }
      assert.equal((await api.createDiagnosis(new FormData(), 'same-key')).status, 'uncertain')
      assert.equal(options.headers['Idempotency-Key'], 'same-key')
      assert.equal(options.signal.aborted, false)
    })
    for (const mode of ['response-body', 'status-read']) {
      await t.test(`${mode} waiting is bounded as well`, async () => {
        let fire, delay
        globalThis.setTimeout = (fn, ms) => { fire = fn; delay = ms; return 18 }
        globalThis.clearTimeout = () => {}
        globalThis.fetch = async () => ({ ok: true, json: () => new Promise(() => {}) })
        try {
          const pending = mode === 'response-body'
            ? api.createDiagnosis(new FormData(), 'original-key')
            : api.diagnosisRequestByKey('original-key')
          assert.equal(delay, mode === 'response-body' ? 90000 : 10000)
          fire()
          await assert.rejects(pending, error => error.name === 'TimeoutError')
        } finally {
          globalThis.setTimeout = original.setTimeout
          globalThis.clearTimeout = original.clearTimeout
        }
      })
    }
  } finally {
    Object.assign(globalThis, original)
    await server.close()
  }
})
