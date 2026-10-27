function diagnosisText(record) {
  const result = record.result || {}
  return record.outcome === 'uncertain'
    ? `판단 어려움: ${result.reason || '추가 확인이 필요해요.'}`
    : `의심 결과: ${result.diseaseName || result.disease_name || '결과 이름 없음'}`
}

export function recordDiagnosisInJournal({ userId, record, gardenState, localStore, sessionStore }) {
  if (!userId || !record?.request_id || !record.result || !record.crop_name) {
    throw new Error('기록할 진단 결과를 확인할 수 없어요.')
  }

  const key = `woori-garden-user-${userId}-journal-preview`
  let saved
  try { saved = JSON.parse(localStore.getItem(key) || 'null') } catch { saved = null }
  const journal = saved && Array.isArray(saved.entries) && saved.overrides && typeof saved.overrides === 'object'
    ? saved : { entries: [], overrides: {}, taskHistory: {} }
  const existingEntry = journal.entries.find(entry => entry.diagnosisRequestId === record.request_id)
  const alreadySaved = Boolean(existingEntry)

  const farms = gardenState?.state?.farms || []
  const match = farms.flatMap(farm => (farm.plots || []).map(plant => ({ farm, plant })))
    .find(({ plant }) => plant && String(plant.plantingId) === String(record.planting_id))
  const farmName = existingEntry?.farm || match?.farm.name || '진단 기록'
  const archived = !match || Boolean(match.plant.harvestedAt) || farmName !== match.farm.name

  if (!alreadySaved) {
    journal.entries.push({
      id: `diagnosis-${record.request_id}`,
      diagnosisRequestId: record.request_id,
      date: record.completed_at || record.created_at || new Date().toISOString(),
      farm: farmName,
      crop: record.crop_name,
      text: '',
      diagnosis: diagnosisText(record),
      diagnosisSymptoms: Array.isArray(record.symptoms) ? record.symptoms : [],
      photos: [],
    })
    localStore.setItem(key, JSON.stringify(journal))
  }

  try {
    sessionStore.setItem(`${key}-focus`, JSON.stringify({ farm: !archived ? farmName : 'all', archived, at: Date.now() }))
  } catch { /* The record remains saved even if this tab cannot remember its view. */ }
  return { alreadySaved, archived }
}
