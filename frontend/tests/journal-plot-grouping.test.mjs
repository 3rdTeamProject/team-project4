import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../public/garden/features.js', import.meta.url), 'utf8')
const declaration = source.split('\n').find(line => line.startsWith('function journalGroupRecords('))
const memoDeclaration = source.split('\n').find(line => line.startsWith('function journalVisibleMemo('))
const visibleMemo = runInNewContext(`(${memoDeclaration})`)
const groupRecords = runInNewContext(`(${declaration})`, {
  journalSeparateObservations: record => record,
  journalDayKey: date => date,
  journalPlotRef: record => record.plotRef,
  journalTaskTitles: () => [],
  journalVisibleMemo: visibleMemo,
})

test('photo-only journal shows the image without a generated memo', () => {
  const record = { id: 'photo', date: '2026-10-29', farm: '텃밭', crop: '상추', plotRef: 'farm-1:1', text: '오늘의 작물 사진을 남겼어요.', photos: ['photo-1'] }
  assert.equal(groupRecords([record])[0].text, '')
  assert.equal(visibleMemo(record), '')
})

test('same crop in different plots remains in separate journal cards', () => {
  const records = [
    { id: 'a', date: '2026-10-29', farm: '텃밭', crop: '상추', plotRef: 'farm-1:1', text: '1번 칸' },
    { id: 'b', date: '2026-10-29', farm: '텃밭', crop: '상추', plotRef: 'farm-1:2', text: '2번 칸' },
    { id: 'c', date: '2026-10-29', farm: '텃밭', crop: '상추', plotRef: 'farm-1:1', text: '1번 칸 추가 기록' },
  ]
  const cards = groupRecords(records)
  assert.equal(cards.length, 2)
  assert.equal(cards[0].entries.length, 2)
  assert.equal(cards[1].id, 'b')
  assert.doesNotMatch(cards[0].text, /2번 칸/)
})

test('same plot and day remain separate across removed and new plantings', () => {
  const records = [
    { id: 'old', date: '2026-10-29', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1', archiveCycleId: 'removed-1', text: 'old' },
    { id: 'new', date: '2026-10-29', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1', text: 'new' },
  ]
  assert.equal(groupRecords(records).length, 2)
})

test('server planting IDs keep same-day records from different crops apart', () => {
  const records = [
    { id: 'old', date: '2026-10-29', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1', plantingId: 10, text: 'old' },
    { id: 'new', date: '2026-10-29', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1', plantingId: 11, text: 'new' },
  ]
  assert.equal(groupRecords(records).length, 2)
})

test('old planting stays in past cultivation after same-day replant', () => {
  const declaration = source.split('\n').find(line => line.startsWith('function journalArchived('))
  const plant = { plantingId: 11, plantedAt: '2026-10-29' }
  const context = {
    state: { farms: [{ id: 'farm-1', name: 'farm', plots: [plant] }] },
    journalPlotRef: record => record.plotRef,
    journalDayKey: date => date,
    meta: () => ({ name: 'lettuce' }),
  }
  const archived = runInNewContext(`(${declaration})`, context)
  const record = { farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1', date: '2026-10-29' }
  assert.equal(archived({ ...record, plantingId: 10 }), true)
  assert.equal(archived({ ...record, plantingId: 11 }), false)
})

test('a planting record still appears after its crop was removed', () => {
  const declaration = source.slice(source.indexOf('function journalPlantingRecord('), source.indexOf('function journalEntries('))
  const context = {
    journalLocal: { overrides: {} }, journalBasePlotRef: record => record.plotRef,
    journalPlotRef: record => record.plotRef, journalDayKey: date => date,
    journalPlotCandidates: () => [], state: { records: [] },
  }
  const plantingRecord = runInNewContext(`(${declaration})`, context)
  const record = { date: '2026-10-29', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1', text: '', photos: [] }
  assert.equal(plantingRecord(record, 0).event, 'planting')
})

test('an archived planting does not hide a new planting on the same day and plot', () => {
  const declaration = source.slice(source.indexOf('function journalPlantingRecord('), source.indexOf('function journalEntries('))
  const old = { date: '2026-10-29', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1', text: 'old' }
  const next = { ...old, text: 'new' }
  const context = {
    journalLocal: { overrides: { 'base-0': { archiveCycleId: 'removed-1' } } },
    journalBasePlotRef: record => record.plotRef, journalPlotRef: record => record.plotRef,
    journalDayKey: date => date, journalPlotCandidates: () => [{ farm: { id: 'farm-1' }, plant: { plantedAt: '2026-10-29', method: 'seed' }, index: 0 }],
    state: { records: [old, next] },
  }
  const plantingRecord = runInNewContext(`(${declaration})`, context)
  assert.equal(plantingRecord(next, 1).event, 'planting')
})

test('removing a crop archives only its current plot records', () => {
  const declaration = source.slice(source.indexOf('function journalArchiveRemovedCrop('), source.indexOf('function journalPlantingText('))
  const old = { id: 'base-0', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:1' }
  const other = { id: 'base-1', farm: 'farm', crop: 'lettuce', plotRef: 'farm-1:2' }
  const journalLocal = { entries: [], overrides: {}, taskHistory: { '2026-10-29|farm-1:1': ['water'] } }
  const context = {
    journalEntries: () => [old, other], journalArchived: () => false,
    journalPlotRef: record => record.plotRef, journalTaskTitles: () => ['water'],
    journalPersist: () => true, journalLocal, meta: () => ({ name: 'lettuce' }),
    Date, Math, JSON,
  }
  const archive = runInNewContext(`(${declaration})`, context)
  assert.equal(archive({ id: 'farm-1', name: 'farm' }, {}, 0), true)
  assert.ok(journalLocal.overrides['base-0'].archiveCycleId)
  assert.equal(journalLocal.overrides['base-1'], undefined)
  assert.equal(journalLocal.taskHistory['2026-10-29|farm-1:1'], undefined)
})

test('planting record stays visible without edit or delete actions', () => {
  const editableDeclaration = source.slice(source.indexOf('function journalEditableEntries('), source.indexOf('let journalGroupEditIds='))
  const cardDeclaration = source.split('\n').find(line => line.startsWith('function journalCard('))
  const context = {
    journalOpen: new Set(), journalMenu: null,
    journalPlantingMethod: () => 'seed', journalDateLabel: date => date,
    journalPlotLabel: () => '1번 칸', journalPhotoTile: () => '', esc: value => String(value),
  }
  const editableEntries = runInNewContext(`(${editableDeclaration})`, context)
  const card = runInNewContext(`(${cardDeclaration})`, { ...context, journalEditableEntries: editableEntries })
  const planting = { id: 'base-0', date: '2026-10-29', farm: '텃밭', crop: '상추', event: 'planting', text: '' }
  const html = card(planting)
  assert.match(html, /상추 재배 시작/)
  assert.doesNotMatch(html, /data-jr="menu"|data-jr="edit"|data-jr="delete"/)

  const openCard = runInNewContext(`(${cardDeclaration})`, { ...context, journalMenu: 'group-1', journalEditableEntries: editableEntries })
  const mixed = openCard({ ...planting, id: 'group-1', entries: [planting, { ...planting, id: 'base-1', event: undefined, text: '물 줌' }] })
  assert.match(mixed, /data-jr="menu"/)
  assert.match(mixed, /data-id="base-1"/)
  assert.doesNotMatch(mixed, /data-id="base-0"/)
  assert.match(mixed, /재배 기록/)
  assert.doesNotMatch(mixed, /기록 1|기록 2|2개/)

  const first = { ...planting, id: 'base-1', event: undefined, text: '사진', photos: ['photo-1'] }
  const second = { ...planting, id: 'base-2', event: undefined, text: '메모' }
  assert.deepEqual(Array.from(editableEntries({ entries: [first, second] })[0].groupIds), ['base-1', 'base-2'])
  const combined = openCard({ ...planting, id: 'group-1', event: undefined, entries: [first, second] })
  assert.equal((combined.match(/data-jr="edit"/g) || []).length, 1)
  assert.equal((combined.match(/data-jr="delete"/g) || []).length, 1)
  assert.match(combined, /data-group="group-1"/)
  assert.doesNotMatch(combined, /기록 1|기록 2|2개/)
})

test('past-cultivation crop delete leaves other crops and plots intact', async () => {
  const declaration = source.slice(source.indexOf('function journalDeleteArchiveCrop('), source.indexOf("app.addEventListener('click',e=>{const b=e.target.closest('[data-jr=\"farm-fold\"]')"))
  const entries = [
    { id: 'base-0', farm: '텃밭 A', crop: '상추', key: '텃밭 A|상추|1', archived: true },
    { id: 'local-1', farm: '텃밭 A', crop: '상추', key: '텃밭 A|상추|1', archived: true },
    { id: 'base-2', farm: '텃밭 A', crop: '상추', key: '텃밭 A|상추|1', archived: false },
    { id: 'base-3', farm: '텃밭 A', crop: '상추', key: '텃밭 A|상추|2', archived: true },
    { id: 'base-4', farm: '텃밭 A', crop: '토마토', key: '텃밭 A|토마토|1', archived: true },
  ]
  const journalLocal = { entries: [entries[1]], overrides: {} }
  const context = {
    journalEntries: () => entries,
    journalArchived: entry => entry.archived,
    journalArchiveCropKey: entry => entry.key,
    journalPlotLabel: () => '1번 칸', journalLocal,
    askConfirm: () => Promise.resolve(true),
    journalPersist: () => true,
    journalOpen: new Set(['open']), journalMenu: 'menu',
    render: () => {},
  }
  runInNewContext(`(${declaration})`, context)('텃밭 A|상추|1')
  await Promise.resolve()
  assert.equal(context.journalLocal.overrides['base-0'].hidden, true)
  assert.equal(context.journalLocal.entries.length, 0)
  assert.equal(context.journalLocal.overrides['base-2'], undefined)
  assert.equal(context.journalLocal.overrides['base-3'], undefined)
  assert.equal(context.journalLocal.overrides['base-4'], undefined)
})

test('past cultivation with a server planting ID uses the delete API', async () => {
  const declaration = source.slice(source.indexOf('function journalDeleteArchiveCrop('), source.indexOf("app.addEventListener('click',e=>{const b=e.target.closest('[data-jr=\"farm-fold\"]')"))
  const entry = { id: 'base-0', farm: 'farm', crop: 'lettuce', plantingId: 11, journalId: 20, key: 'farm|lettuce|11' }
  const journalLocal = { entries: [], overrides: {} }
  let requestedId = null
  let applied = null
  const context = {
    journalEntries: () => [entry], journalArchived: () => true,
    journalArchiveCropKey: record => record.key, journalPlotLabel: () => '1',
    journalLocal, askConfirm: () => Promise.resolve(true),
    hostApi: async (_, payload) => { requestedId = payload.plantingId; return { state: { records: [] } } },
    journalRebaseBaseRecords: () => {}, journalPersist: () => true,
    journalOpen: new Set(), journalMenu: null,
    applyServerState: state => { applied = state },
    window: { parent: {} }, render: () => {}, toast: () => {},
  }
  runInNewContext(`(${declaration})`, context)(entry.key)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(requestedId, 11)
  assert.equal(applied.records.length, 0)
  assert.equal(journalLocal.overrides['base-0'], undefined)
})
