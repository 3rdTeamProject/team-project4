import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'

test('garden diagnosis entry opens the real form; legacy journal editing stays local', () => {
  const source = readFileSync('public/garden/features.js', 'utf8')
  const start = source.indexOf('const baseNavigate=navigate;')
  const end = source.indexOf('const baseFormPage=', start)
  const calls = []
  const window = {}
  const context = vm.createContext({
    window, parent: { postMessage: (...args) => calls.push(args) },
    location: { origin: 'https://local.test', assign: url => calls.push(url) },
    navigate: view => calls.push(view), journalEdit: null, view: 'detail',
  })
  vm.runInContext(source.slice(start, end), context)
  context.navigate('diagnosis')
  assert.equal(calls[0][0].to, '/diagnosis?mode=detail')
  assert.equal(calls[0][1], 'https://local.test')
  calls.length = 0
  context.parent = window
  context.navigate('diagnosis')
  assert.deepEqual(calls, ['/diagnosis?mode=detail'])
  calls.length = 0
  context.journalEdit = 'existing-record'
  context.navigate('diagnosis')
  assert.deepEqual(calls, ['diagnosis'])
})

test('default, old leaf and detail URLs all render the existing AI form', async () => {
  globalThis.localStorage = { getItem: () => 'test-token' }
  globalThis.window = { history: { state: { idx: 0 } } }
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
    name: 'direct-entry-form-double',
    transform(source, id) {
      if (id.endsWith('/components/DiagnosisDetails.jsx')) return 'export default function Details(){return "AI_FORM"}'
    },
  }] })
  try {
    const { default: Diagnosis } = await server.ssrLoadModule('/src/pages/Diagnosis.jsx')
    const { default: Result } = await server.ssrLoadModule('/src/components/DiagnosisResult.jsx')
    for (const url of ['/diagnosis', '/diagnosis?mode=leaf', '/diagnosis?mode=detail']) {
      const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(Diagnosis)))
      assert.match(html, /AI_FORM/)
      assert.doesNotMatch(html, /잎 관찰|YOLO|모델 미연결/)
    }
    const limit = renderToStaticMarkup(React.createElement(MemoryRouter, {}, React.createElement(Result, { result: { status: 'limit' } })))
    assert.match(limit, /href="\/pointshop"/)
    assert.doesNotMatch(limit, /잎 관찰/)
    const environment = renderToStaticMarkup(React.createElement(MemoryRouter, {}, React.createElement(Result, {
      result: { status: 'diagnosed', diseaseName: '수분 부족 의심', evidence: ['잎 처짐'], management: ['흙 수분 확인'], additionalChecks: [] },
    })))
    assert.match(environment, /수분 부족 의심/)
    assert.match(environment, /환경적 원인/)
    const uncertain = renderToStaticMarkup(React.createElement(MemoryRouter, {}, React.createElement(Result, {
      result: { status: 'uncertain', diseaseName: null, reason: '사진만으로 구분하기 어렵습니다.', retakeGuidance: [], additionalChecks: ['물주기 주기 확인'] },
    })))
    assert.match(uncertain, /물주기 주기 확인/)
    assert.match(uncertain, /판단하기 어려워요/)
  } finally {
    await server.close()
    delete globalThis.window
    delete globalThis.localStorage
  }
})
