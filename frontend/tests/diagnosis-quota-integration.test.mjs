import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'

// Render the real component with controlled hook state and API doubles. No
// network or production credentials are used; production modules are not edited.
test('diagnosis screen refresh wiring and quota error/retry UI', async () => {
  let slots = [], cursor = 0, effects = [], refreshes = [], historyCalls = 0
  const storage = new Map()
  globalThis.sessionStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  }
  globalThis.quotaTestHooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useRef(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useMemo: fn => fn(),
    useEffect: fn => effects.push(fn),
  }
  const serverQuota = { remaining_count: 2, daily_limit: 3, reset_at: '2026-10-24T00:00:00+09:00' }
  const refreshQuota = async options => { refreshes.push(options); return serverQuota }
  globalThis.quotaTestState = { quota: serverQuota, quotaLoading: false, quotaError: '', refreshQuota }
  globalThis.quotaTestApi = {
    gardenState: async () => ({ state: { farms: [{ id: 'farm', plots: [{ kind: 'tomato' }] }] } }),
    gardenCrops: async () => ({ crops: [{ kind: 'tomato', name: 'crop' }] }),
    diagnosisHistory: async () => { historyCalls++; return { items: [] } },
    diagnosisRequest: async () => { throw Error('mock status failure') },
    createDiagnosis: async () => { throw Error('mock network failure') },
  }
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    plugins: [{
      name: 'quota-integration-doubles', enforce: 'pre',
      transform(source, id) {
        if (!id.endsWith('/components/DiagnosisDetails.jsx')) return
        return source
          .replace("import { useEffect, useMemo, useRef, useState } from 'react'", 'const { useEffect, useMemo, useRef, useState } = globalThis.quotaTestHooks')
          .replace("import { api } from '../api.js'", 'const api = globalThis.quotaTestApi')
          .replace("import useDiagnosisQuota from './useDiagnosisQuota.js'", 'const useDiagnosisQuota = () => globalThis.quotaTestState')
          .replace('  const quotaNotice =', '  globalThis.quotaTestScreen = { applyDiagnosisResponse, returnToForm, recoverRequestStatus, sendDiagnosis, setDiagnosisInput, setPhotos };\n  const quotaNotice =')
      },
    }],
  })
  try {
    const { default: Details } = await server.ssrLoadModule('/src/components/DiagnosisDetails.jsx')
    const render = () => {
      cursor = 0
      effects = []
      return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Details)))
    }
    render()
    effects.forEach(fn => fn())
    await new Promise(resolve => setImmediate(resolve))
    let html = render()
    assert.equal(historyCalls, 1)
    assert.ok(html.includes('2/3회'))
    for (const status of ['diagnosed', 'uncertain', 'unknown', 'failed_before_analysis']) {
      refreshes = []
      globalThis.quotaTestScreen.applyDiagnosisResponse({ status, requestId: `request-${status}` })
      assert.deepEqual(refreshes, [{ invalidate: true }], status)
    }
    refreshes = []
    globalThis.quotaTestScreen.returnToForm()
    assert.deepEqual(refreshes, [undefined])
    render()

    refreshes = []
    await globalThis.quotaTestScreen.recoverRequestStatus({ requestId: 'recover', idempotencyKey: 'recover-key', fingerprint: 'old' })
    assert.deepEqual(refreshes, [{ invalidate: true }])
    storage.clear()
    globalThis.quotaTestScreen.returnToForm()
    globalThis.quotaTestScreen.setDiagnosisInput({ cropId: 'farm:1', symptoms: ['잎 변색'], description: '' })
    globalThis.quotaTestScreen.setPhotos({ close: { file: new File(['mock-photo'], 'leaf.png', { type: 'image/png' }) } })
    render()
    refreshes = []
    await globalThis.quotaTestScreen.sendDiagnosis()
    assert.deepEqual(refreshes, [undefined, { invalidate: true }], 'preflight and network failure')

    globalThis.quotaTestState = { quota: null, quotaLoading: false, quotaError: '남은 횟수를 확인할 수 없습니다', refreshQuota }
    html = render()
    assert.ok(html.includes('남은 횟수를 확인할 수 없습니다'))
    assert.ok(html.includes('횟수 다시 확인'))
    assert.ok(!html.includes('2/3회'))
    globalThis.quotaTestScreen.applyDiagnosisResponse({ status: 'limit', remainingCount: 0, nextAvailableAt: '2026-10-24T00:00:00+09:00' })
    html = render()
    assert.ok(!html.includes('남은 외부 AI 진단 횟수:'), 'limit snapshot does not present an old count as current')
    assert.ok(html.includes('남은 횟수를 확인할 수 없습니다'))
    globalThis.quotaTestScreen.returnToForm()
    html = render()
    assert.ok(html.includes('남은 횟수를 확인할 수 없습니다'))
    assert.ok(html.includes('아직 완료된 AI 상세 진단이 없습니다'))
    assert.ok(html.includes('href="/diagnosis/history"'))
    assert.equal(historyCalls, 1, 'quota refreshes do not reload recent diagnosis history')
  } finally {
    await server.close()
    delete globalThis.quotaTestHooks
    delete globalThis.quotaTestApi
    delete globalThis.quotaTestState
    delete globalThis.quotaTestScreen
    delete globalThis.sessionStorage
  }
})
