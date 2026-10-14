export function formatLogDate(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

export function formatLogAmount(amount) {
  const abs = Math.abs(amount).toLocaleString()
  return amount < 0 ? `−${abs}P` : `+${abs}P`
}
