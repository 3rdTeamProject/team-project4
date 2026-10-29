import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'

test('P2 limit rollover preserves inputs and pending recovery', async t => {
  let slots, cursor, effects, calls, memory, diagnosisResponse
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
    createDiagnosis: async () => { calls++; return diagnosisResponse() },
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
      diagnosisResponse = () => { throw Error('mock lost response') }
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
    const paidQuota = (free, balance, reserved = 0, allowed = free > 0 || balance > reserved) => ({
      ...oldQuota, remaining_count: free, purchased_balance: balance,
      purchased_reserved: reserved, purchased_available: Math.max(0, balance - reserved), can_request: allowed,
    })
    for (const [label, value, allowed] of [
      ['free three', paidQuota(3, 0), true],
      ['paid one with free exhausted', paidQuota(0, 1), true],
      ['both exhausted', paidQuota(0, 0), false],
      ['last purchased credit reserved', paidQuota(0, 1, 1), false],
      ['one available and two reserved', paidQuota(0, 3, 2), true],
      ['server denies despite displayed balance', paidQuota(3, 2, 0, false), false],
    ]) {
      await t.test(`preflight and purchased display: ${label}`, async () => {
        await setup()
        globalThis.p2Quota.quota = value
        render(); const html = await runEffects()
        assert.ok(html.includes(`구매한 진단 잔액: ${value.purchased_balance}회`))
        assert.ok(html.includes(`구매 진단 사용 가능: ${value.purchased_available}회`))
        assert.ok(html.includes(`총 이용 가능: ${value.remaining_count + value.purchased_available}회`))
        if (value.purchased_reserved) assert.ok(html.includes(`구매 진단 예약 중: ${value.purchased_reserved}회`))
        assert.equal(calls, 0, 'quota refresh alone never analyzes')
        await globalThis.p2Screen.sendDiagnosis()
        assert.equal(calls, allowed ? 1 : 0)
        if (!allowed) { render(); assert.equal(globalThis.p2Screen.getFlow().result.status, 'limit') }
      })
    }
    await t.test('same-day recharge unlocks limit, keeps inputs, and completion refreshes paid balance', async () => {
      await setup()
      const before = globalThis.p2Screen.getForm()
      globalThis.p2Quota.quota = paidQuota(0, 1)
      render(); await runEffects()
      assert.equal(globalThis.p2Screen.getFlow().screen, 'form')
      assert.deepEqual(globalThis.p2Screen.getForm(), before)
      assert.equal(calls, 0)
      diagnosisResponse = () => {
        globalThis.p2Quota.quota = paidQuota(0, 0)
        return { status: 'diagnosed', diseaseName: 'paid saved result', requestId: 'paid-completed' }
      }
      let refreshes = 0
      globalThis.p2Quota.refreshQuota = async () => { refreshes++; return globalThis.p2Quota.quota }
      render()
      await globalThis.p2Screen.sendDiagnosis()
      assert.equal(calls, 1)
      assert.equal(refreshes, 2, 'fresh preflight and post-completion refresh')
      const html = render()
      assert.ok(html.includes('paid saved result'))
      assert.ok(html.includes('구매한 진단 잔액: 0회'))
      assert.ok(html.includes('총 이용 가능: 0회'))
      assert.equal(globalThis.p2Screen.getFlow().result.status, 'diagnosed')
    })
    await t.test('server limit after an allowed preflight remains authoritative', async () => {
      await setup()
      globalThis.p2Quota.quota = paidQuota(0, 1)
      render(); await runEffects()
      diagnosisResponse = () => {
        globalThis.p2Quota.quota = paidQuota(0, 1, 1)
        return { status: 'limit', remainingCount: 0, nextAvailableAt: oldQuota.reset_at }
      }
      await globalThis.p2Screen.sendDiagnosis()
      render(); await runEffects()
      assert.equal(globalThis.p2Screen.getFlow().result.status, 'limit')
      assert.equal(calls, 1)
    })
    await t.test('same-day recharge does not unlock for loading, error, expired or denied quota', async () => {
      for (const state of ['loading', 'error', 'expired', 'denied']) {
        await setup()
        globalThis.p2Quota.quota = paidQuota(0, 1)
        if (state === 'loading') globalThis.p2Quota.quotaLoading = true
        if (state === 'error') globalThis.p2Quota.quotaError = 'mock error'
        if (state === 'expired') globalThis.p2Quota.quota.reset_at = '2026-10-23T00:00:00+09:00'
        if (state === 'denied') globalThis.p2Quota.quota.can_request = false
        render(); await runEffects()
        assert.equal(globalThis.p2Screen.getFlow().result.status, 'limit', state)
        assert.equal(calls, 0)
      }
    })
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
