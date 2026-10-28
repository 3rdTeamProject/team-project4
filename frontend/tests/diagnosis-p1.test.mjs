import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'

test('P1 pending dates and definitive rejection regressions', async t => {
  let slots, cursor, effects, calls, reads, quotaReads, memory, behavior
  const originalNow = Date.now
  const originalFetch = globalThis.fetch
  Date.now = () => Date.parse('2026-10-23T15:01:00Z') // Oct 24 in Seoul
  globalThis.p1Hooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
  }
  globalThis.document = { addEventListener() {}, removeEventListener() {} } // 화면의 바깥 클릭·Esc 처리가 쓰는 document 대역
  globalThis.sessionStorage = {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k),
  }
  const pendingKey = 'pending_ai_diagnosis_request'
  globalThis.p1Quota = {
    quota: { remaining_count: 3, daily_limit: 3 }, quotaLoading: false, quotaError: '',
    refreshQuota: async () => { quotaReads++; return globalThis.p1Quota.quota },
  }
  globalThis.p1Api = {
    gardenState: async () => ({ state: { farms: [{ id: 'farm', plots: [{ kind: 'tomato' }] }] } }),
    gardenCrops: async () => ({ crops: [{ kind: 'tomato', name: 'crop' }] }),
    diagnosisHistory: async () => ({ items: [] }),
    diagnosisRequest: async id => {
      reads.push(id)
      return { status: 'unknown', created_at: '2026-10-23T14:59:00Z', error: 'mock unknown' }
    },
    createDiagnosis: async (_, key) => { calls.push(key); return behavior() },
  }
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
    name: 'p1-doubles', enforce: 'pre',
    transform(source, id) {
      if (!id.endsWith('/components/DiagnosisDetails.jsx')) return
      return source.replace("import { useEffect, useMemo, useRef, useState } from 'react'", 'const {useEffect,useMemo,useRef,useState}=globalThis.p1Hooks')
        .replace("import { api } from '../api.js'", 'const api=globalThis.p1Api')
        .replace("import useDiagnosisQuota from './useDiagnosisQuota.js'", 'const useDiagnosisQuota=()=>globalThis.p1Quota')
        .replace('  const quotaNotice =', '  globalThis.p1Screen={sendDiagnosis,recoverRequestStatus,checkRequestStatus,retryCurrentRequest,setFlow,setDiagnosisInput,setPhotos,returnToForm,getFlow:()=>flow,fingerprint:()=>fingerprintDiagnosis(diagnosisInput,selectedCrop,photos)};\n  const quotaNotice =')
    },
  }] })
  try {
    const { default: Details } = await server.ssrLoadModule('/src/components/DiagnosisDetails.jsx')
    const { api: realApi } = await server.ssrLoadModule('/src/api.js')
    globalThis.localStorage = { getItem: () => null }
    const render = () => {
      cursor = 0; effects = []
      return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Details)))
    }
    const setup = async () => {
      slots = []; memory = new Map(); calls = []; reads = []; quotaReads = 0
      behavior = () => { throw Error('mock lost response') }
      render(); effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve))
      globalThis.p1Screen.setDiagnosisInput({ cropId: 'farm:1', symptoms: ['잎 변색'], description: '' })
      globalThis.p1Screen.setPhotos({ close: { file: new File(['mock'], 'leaf.png', { type: 'image/png' }) } })
      render()
    }
    const save = overrides => {
      const attempt = { idempotencyKey: 'original-key', fingerprint: 'different-input', status: 'unknown', requestId: 'old-request', ...overrides }
      memory.set(pendingKey, JSON.stringify(attempt))
      return attempt
    }
    const pending = () => JSON.parse(memory.get(pendingKey) ?? 'null')
    for (const sameInput of [false, true]) {
      await t.test(`previous KST day permits explicit new diagnosis (same input=${sameInput})`, async () => {
        await setup()
        save({ createdAt: '2026-10-23T14:59:59Z', ...(sameInput ? { fingerprint: await globalThis.p1Screen.fingerprint() } : {}) })
        assert.equal(calls.length, 0, 'no automatic analysis at date rollover')
        await globalThis.p1Screen.sendDiagnosis()
        assert.equal(calls.length, 1)
        assert.notEqual(calls[0], 'original-key')
        assert.ok(quotaReads >= 1)
        assert.equal(reads.length, 0)
        assert.equal(pending().createdAt, '2026-10-23T15:01:00.000Z')
      })
    }
    for (const createdAt of ['2026-10-23T15:00:01Z', undefined, 'invalid', '2026-10-23T14:59:00']) {
      await t.test(`same-day or ambiguous date still blocks different input: ${createdAt}`, async () => {
        await setup(); save({ createdAt })
        await globalThis.p1Screen.sendDiagnosis()
        assert.equal(calls.length, 0)
        assert.equal(pending().idempotencyKey, 'original-key')
      })
    }
    await t.test('same-day lost response reuses its key', async () => {
      await setup()
      save({ createdAt: '2026-10-23T15:00:00Z', requestId: undefined, fingerprint: await globalThis.p1Screen.fingerprint() })
      await globalThis.p1Screen.sendDiagnosis()
      assert.deepEqual(calls, ['original-key'])
      assert.equal(pending().idempotencyKey, 'original-key')
    })
    await t.test('legacy request ID can recover its authoritative server creation date', async () => {
      await setup(); const attempt = save({})
      await globalThis.p1Screen.recoverRequestStatus(attempt)
      assert.deepEqual(reads, ['old-request'])
      assert.equal(pending().createdAt, '2026-10-23T14:59:00Z')
      globalThis.p1Screen.returnToForm(); render()
      await globalThis.p1Screen.sendDiagnosis()
      assert.equal(calls.length, 1)
    })
    await t.test('new date still obeys the server quota', async () => {
      await setup(); save({ createdAt: '2026-10-23T14:59:59Z' })
      globalThis.p1Quota.quota.remaining_count = 0
      try {
        await globalThis.p1Screen.sendDiagnosis()
        assert.equal(calls.length, 0)
        assert.equal(quotaReads, 1)
        assert.equal(pending().requestId, 'old-request', 'quota rejection must retain the previous status lookup')
      }
      finally { globalThis.p1Quota.quota.remaining_count = 3 }
    })
    for (const httpStatus of [422, 404, 503]) {
      await t.test(`confirmed pre-creation HTTP ${httpStatus} permits corrected input`, async () => {
        await setup()
        globalThis.fetch = async () => new Response(JSON.stringify({
          status: 'rejected_before_creation', request_created: false, detail: 'mock rejected',
        }), { status: httpStatus, headers: { 'Content-Type': 'application/json' } })
        behavior = () => realApi.createDiagnosis(new FormData(), 'test-key')
        await globalThis.p1Screen.sendDiagnosis()
        assert.equal(pending(), null)
        render(); assert.equal(globalThis.p1Screen.getFlow().retryMode, 'new')
        globalThis.p1Screen.returnToForm()
        globalThis.p1Screen.setDiagnosisInput({ cropId: 'farm:1', symptoms: ['시듦'], description: 'corrected' })
        render(); await globalThis.p1Screen.sendDiagnosis()
        assert.equal(calls.length, 2)
      })
    }
    for (const httpStatus of [422, 404, 429, 502, 503, undefined]) {
      await t.test(`unconfirmed HTTP/network error preserves the key: ${httpStatus}`, async () => {
        await setup(); behavior = () => { const e = Error('mock ambiguous failure'); e.status = httpStatus; throw e }
        await globalThis.p1Screen.sendDiagnosis()
        const key = pending().idempotencyKey
        assert.equal(pending().status, 'unknown')
        await globalThis.p1Screen.sendDiagnosis()
        assert.deepEqual(calls, [key, key])
      })
    }
    await t.test('server unknown and request ID remain recoverable', async () => {
      await setup(); behavior = () => ({ status: 'unknown', requestId: 'server-request' })
      await globalThis.p1Screen.sendDiagnosis()
      assert.equal(pending().status, 'unknown')
      assert.equal(pending().requestId, 'server-request')
      await globalThis.p1Screen.sendDiagnosis()
      assert.deepEqual(reads, ['server-request'])
      assert.equal(calls.length, 1)
    })
    await t.test('unconfirmed rejection cannot clear a known request ID', async () => {
      await setup(); behavior = () => ({ status: 'rejected_before_creation', request_created: false, requestId: 'existing-request' })
      await globalThis.p1Screen.sendDiagnosis()
      assert.ok(pending())
    })
    await t.test('service daily limit is distinct from an unconfirmed HTTP 429', async () => {
      await setup(); behavior = () => ({ status: 'limit', remainingCount: 0 })
      await globalThis.p1Screen.sendDiagnosis()
      assert.equal(pending(), null)
      render(); assert.equal(globalThis.p1Screen.getFlow().result.status, 'limit')
    })
    await t.test('network loss ends loading and key-only retry restores the stored result without POST', async () => {
      await setup()
      await globalThis.p1Screen.sendDiagnosis()
      let html = render()
      assert.equal(globalThis.p1Screen.getFlow().screen, 'error')
      assert.ok(html.includes('AI 진단 결과를 확인하는 데 시간이 오래 걸리고 있습니다.'))
      assert.ok(html.includes('진단 결과 다시 확인'))
      const key = pending().idempotencyKey
      const lookups = []
      globalThis.p1Api.diagnosisRequestByKey = async value => {
        lookups.push(value)
        return { requestId: 'saved-result', status: 'completed', result: { status: 'diagnosed', diseaseName: 'DB saved result' } }
      }
      await globalThis.p1Screen.retryCurrentRequest()
      render()
      assert.deepEqual(lookups, [key])
      assert.equal(calls.length, 1)
      assert.equal(globalThis.p1Screen.getFlow().result.diseaseName, 'DB saved result')
      assert.equal(pending(), null)
    })
    for (const status of ['processing', 'reserved', 'unknown', 'failed_before_analysis', 'not-found']) {
      await t.test(`read-only recovery handles ${status} without new analysis`, async () => {
        await setup(); await globalThis.p1Screen.sendDiagnosis(); render()
        const key = pending().idempotencyKey
        globalThis.p1Api.diagnosisRequestByKey = async value => {
          assert.equal(value, key)
          if (status === 'not-found') throw Error('404 observation only')
          return { requestId: 'recovered-id', status }
        }
        await globalThis.p1Screen.retryCurrentRequest()
        const html = render()
        assert.equal(calls.length, 1)
        assert.equal(globalThis.p1Screen.getFlow().screen, 'error')
        if (status === 'failed_before_analysis') {
          assert.equal(pending(), null)
          assert.equal(globalThis.p1Screen.getFlow().retryMode, 'new')
        } else {
          assert.equal(pending().idempotencyKey, key)
          if (status === 'processing' || status === 'reserved') {
            assert.ok(html.includes('AI 진단이 진행 중입니다'))
            assert.ok(!html.includes('AI 진단을 완료하지 못했어요'))
          }
        }
      })
    }
    await t.test('known ID recovery and duplicate clicks perform one GET and no POST', async () => {
      await setup()
      save({ requestId: 'known-id' })
      let finish
      const previous = globalThis.p1Api.diagnosisRequest
      globalThis.p1Api.diagnosisRequest = id => {
        reads.push(id)
        return new Promise(resolve => { finish = resolve })
      }
      try {
        const first = globalThis.p1Screen.checkRequestStatus('known-id')
        await globalThis.p1Screen.checkRequestStatus('known-id')
        finish({ requestId: 'known-id', status: 'completed', result: { status: 'uncertain', reason: 'saved uncertainty' } })
        await first
        render()
        assert.deepEqual(reads, ['known-id'])
        assert.equal(calls.length, 0)
        assert.equal(globalThis.p1Screen.getFlow().result.status, 'uncertain')
      } finally { globalThis.p1Api.diagnosisRequest = previous }
    })
    await t.test('timeout exits loading, retains the key and does not claim analysis failed', async () => {
      await setup()
      behavior = () => { const error = Error('browser deadline'); error.name = 'TimeoutError'; throw error }
      await globalThis.p1Screen.sendDiagnosis()
      const html = render()
      assert.equal(globalThis.p1Screen.getFlow().screen, 'error')
      assert.equal(pending().status, 'unknown')
      assert.equal(pending().idempotencyKey, calls[0])
      assert.ok(html.includes('이미 진단이 진행 중일 수 있으니 결과를 다시 확인해 주세요.'))
      assert.ok(!html.includes('AI 진단을 완료하지 못했어요'))
    })
    await t.test('bounded polling ends the spinner with a read-only confirmation action', async () => {
      await setup(); save({ requestId: 'polling-id' })
      globalThis.p1Screen.setFlow({ screen: 'loading', source: 'api', requestId: 'polling-id', pollAttempts: 19 })
      render()
      const previous = globalThis.p1Api.diagnosisRequest
      const originalWindow = globalThis.window
      let tick
      globalThis.window = { setTimeout: fn => { tick = fn; return 1 }, clearTimeout: () => {} }
      globalThis.p1Api.diagnosisRequest = async () => ({ status: 'processing' })
      try {
        const cleanup = effects.at(-2)()
        await tick()
        cleanup()
        const html = render()
        assert.equal(globalThis.p1Screen.getFlow().screen, 'error')
        assert.ok(html.includes('진단 결과 다시 확인'))
        assert.equal(calls.length, 0)
        assert.equal(pending().idempotencyKey, 'original-key')
      } finally {
        globalThis.p1Api.diagnosisRequest = previous
        globalThis.window = originalWindow
      }
    })
    await t.test('a late lookup response cannot replace a newer pending request', async () => {
      await setup(); const attempt = save({ requestId: 'old-id' })
      let finish
      const previous = globalThis.p1Api.diagnosisRequest
      globalThis.p1Api.diagnosisRequest = () => new Promise(resolve => { finish = resolve })
      try {
        const lookup = globalThis.p1Screen.recoverRequestStatus(attempt, true)
        save({ idempotencyKey: 'new-key', requestId: 'new-id' })
        finish({ status: 'completed', result: { status: 'diagnosed', diseaseName: 'obsolete' } })
        await lookup
        render()
        assert.equal(pending().idempotencyKey, 'new-key')
        assert.notEqual(globalThis.p1Screen.getFlow().screen, 'result')
      } finally { globalThis.p1Api.diagnosisRequest = previous }
    })
  } finally {
    await server.close(); Date.now = originalNow; globalThis.fetch = originalFetch
    for (const name of ['p1Hooks', 'p1Api', 'p1Quota', 'p1Screen', 'sessionStorage', 'localStorage', 'document']) delete globalThis[name]
  }
})
