import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'

test('P2 limit rollover preserves inputs and pending recovery', async t => {
  let slots, cursor, effects, calls, memory
  const originalNow = Date.now
  let time = Date.parse('2026-10-23T23:59:00+09:00')
  Date.now = () => time
  globalThis.p2Hooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
  }
  globalThis.sessionStorage = {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k),
  }
  globalThis.p2Api = {
    gardenState: async () => ({ state: { farms: [{ id: 'farm', plots: [{ kind: 'tomato' }] }] } }),
    gardenCrops: async () => ({ crops: [{ kind: 'tomato', name: 'crop' }] }),
    diagnosisHistory: async () => ({ items: [] }),
    createDiagnosis: async () => { calls++; throw Error('mock lost response') },
  }
  const oldQuota = { remaining_count: 0, daily_limit: 3, reset_at: '2026-10-24T00:00:00+09:00' }
  const newQuota = { remaining_count: 3, daily_limit: 3, reset_at: '2026-10-25T00:00:00+09:00' }
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
    name: 'p2-doubles', enforce: 'pre',
    transform(source, id) {
      if (!id.endsWith('/components/DiagnosisDetails.jsx')) return
      return source.replace("import { useEffect, useMemo, useRef, useState } from 'react'", 'const {useEffect,useMemo,useRef,useState}=globalThis.p2Hooks')
        .replace("import { api } from '../api.js'", 'const api=globalThis.p2Api')
        .replace("import useDiagnosisQuota from './useDiagnosisQuota.js'", 'const useDiagnosisQuota=()=>globalThis.p2Quota')
        .replace('  const quotaNotice =', '  globalThis.p2Screen={applyDiagnosisResponse,sendDiagnosis,setDiagnosisInput,setPhotos,getFlow:()=>flow,getForm:()=>({diagnosisInput,photos})};\n  const quotaNotice =')
    },
  }] })
  try {
    const { default: Details } = await server.ssrLoadModule('/src/components/DiagnosisDetails.jsx')
    const render = () => {
      cursor = 0; effects = []
      return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Details)))
    }
    const runEffects = async () => { effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); return render() }
    const setup = async () => {
      slots = []; memory = new Map(); calls = 0; time = Date.parse('2026-10-23T23:59:00+09:00')
      globalThis.p2Quota = { quota: oldQuota, quotaError: '', quotaLoading: false, refreshQuota: async () => globalThis.p2Quota.quota }
      render(); await runEffects()
      globalThis.p2Screen.setDiagnosisInput({ cropId: 'farm:1', symptoms: ['잎 변색'], description: 'keep description' })
      globalThis.p2Screen.setPhotos({ close: { file: new File(['mock-photo'], 'leaf.png'), url: 'blob:mock' } })
      render()
      globalThis.p2Screen.applyDiagnosisResponse({ status: 'limit', quota: oldQuota })
      render()
    }
    for (const count of [0, 1]) {
      await t.test(`same-day limit stays with remaining count ${count}`, async () => {
        await setup(); globalThis.p2Quota.quota = { ...oldQuota, remaining_count: count }
        render(); await runEffects()
        assert.equal(globalThis.p2Screen.getFlow().result.status, 'limit')
        assert.equal(calls, 0)
      })
    }
    await t.test('new KST day and successful available quota release only the old limit', async () => {
      await setup()
      const before = globalThis.p2Screen.getForm()
      time = Date.parse('2026-10-24T00:01:00+09:00')
      globalThis.p2Quota.quota = newQuota
      render(); const html = await runEffects()
      assert.equal(globalThis.p2Screen.getFlow().screen, 'form')
      assert.ok(!html.includes('AI 상세 진단 이용 횟수를 모두 사용했어요'))
      assert.deepEqual(globalThis.p2Screen.getForm(), before)
      assert.equal(calls, 0)
    })
    for (const state of ['error', 'loading', 'zero', 'stale']) {
      await t.test(`rollover does not unlock on ${state} quota`, async () => {
        await setup(); time = Date.parse('2026-10-24T00:01:00+09:00')
        globalThis.p2Quota.quota = state === 'zero' ? { ...newQuota, remaining_count: 0 } : state === 'stale' ? oldQuota : null
        globalThis.p2Quota.quotaError = state === 'error' ? 'mock error' : ''
        globalThis.p2Quota.quotaLoading = state === 'loading'
        render(); await runEffects()
        assert.equal(globalThis.p2Screen.getFlow().result.status, 'limit')
        assert.equal(calls, 0)
      })
    }
    await t.test('old pending is retained through rollover and allows explicit new diagnosis', async () => {
      await setup()
      const key = 'pending_ai_diagnosis_request'
      memory.set(key, JSON.stringify({ status: 'unknown', idempotencyKey: 'yesterday-key', requestId: 'old-id', fingerprint: 'old', createdAt: '2026-10-23T14:00:00Z' }))
      time = Date.parse('2026-10-24T00:01:00+09:00'); globalThis.p2Quota.quota = newQuota
      render(); await runEffects()
      assert.equal(JSON.parse(memory.get(key)).requestId, 'old-id')
      assert.equal(calls, 0)
      await globalThis.p2Screen.sendDiagnosis()
      assert.equal(calls, 1)
      assert.notEqual(JSON.parse(memory.get(key)).idempotencyKey, 'yesterday-key')
    })
    await t.test('completed diagnosis is not dismissed by a quota rollover', async () => {
      await setup()
      globalThis.p2Screen.applyDiagnosisResponse({ status: 'diagnosed', diseaseName: 'saved result', requestId: 'completed' })
      time = Date.parse('2026-10-24T00:01:00+09:00'); globalThis.p2Quota.quota = newQuota
      render(); const html = await runEffects()
      assert.equal(globalThis.p2Screen.getFlow().result.status, 'diagnosed')
      assert.ok(html.includes('saved result'))
    })
  } finally {
    await server.close(); Date.now = originalNow
    for (const name of ['p2Hooks', 'p2Api', 'p2Quota', 'p2Screen', 'sessionStorage']) delete globalThis[name]
  }
})
