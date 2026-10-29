import assert from 'node:assert/strict'
import test from 'node:test'
import { recordDiagnosisInJournal } from './diagnosisJournal.js'

function store() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

const diagnosis = {
  request_id: 'request-1',
  planting_id: 42,
  crop_name: '방울토마토',
  completed_at: '2026-10-27T12:00:00',
  outcome: 'diagnosed',
  symptoms: ['잎 반점'],
  result: { diseaseName: '잎곰팡이병', evidence: ['잎에 반점이 있어요'], management: ['통풍을 좋게 해 주세요'] },
}

test('records a diagnosis for the matching farm and does not duplicate it', () => {
  const localStore = store()
  const sessionStore = store()
  const args = {
    userId: 7, record: diagnosis, localStore, sessionStore,
    gardenState: { state: { farms: [{ id: 'farm-1', name: '우리 텃밭', plots: [{ plantingId: 41 }, { plantingId: 42 }] }] } },
  }
  assert.equal(recordDiagnosisInJournal(args).alreadySaved, false)
  assert.equal(recordDiagnosisInJournal(args).alreadySaved, true)
  const saved = JSON.parse(localStore.getItem('woori-garden-user-7-journal-preview'))
  assert.equal(saved.entries.length, 1)
  assert.equal(saved.entries[0].farm, '우리 텃밭')
  assert.equal(saved.entries[0].diagnosisRequestId, 'request-1')
  assert.equal(saved.entries[0].plotRef, 'farm-1:2')
  assert.match(saved.entries[0].diagnosis, /잎곰팡이병/)
  assert.doesNotMatch(saved.entries[0].diagnosis, /권장 관리 방법/)
  assert.equal(JSON.parse(sessionStore.getItem('woori-garden-user-7-journal-preview-focus')).archived, false)
})

test('keeps a diagnosis visible under past cultivation when its planting is gone', () => {
  const localStore = store()
  const sessionStore = store()
  recordDiagnosisInJournal({ userId: 7, record: diagnosis, gardenState: { state: { farms: [] } }, localStore, sessionStore })
  assert.equal(JSON.parse(sessionStore.getItem('woori-garden-user-7-journal-preview-focus')).archived, true)
})
