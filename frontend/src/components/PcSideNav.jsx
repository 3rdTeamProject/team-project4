const NAV_ITEMS = [
  { key: 'farms', label: '전체 농장', glyph: '▦' },
  { key: 'tasks', label: '오늘 할 일', glyph: '☷' },
  { key: 'menu', label: '메뉴', glyph: '☰' },
]

/**
 * PC 레이아웃의 왼쪽 세로 메뉴. 지금 열려 있는 항목(active)을 강조하고, 개발용 날짜·날씨 조정을 접고 펼 수 있게 아래에 둔다.
 * dev는 농장 화면(iframe)이 알려 준 값이라 날짜 이동 단위·날씨 목록을 여기서 따로 정하지 않는다.
 */
export default function PcSideNav({ active, onSelect, dev, onDev }) {
  return (
    <aside className="pc-side">
      <nav className="pc-nav" aria-label="주 메뉴">
        {NAV_ITEMS.map(({ key, label, glyph }) => (
          <button
            key={key}
            type="button"
            className={`pc-nav-item${active === key ? ' is-active' : ''}`}
            aria-current={active === key ? 'page' : undefined}
            onClick={() => onSelect(key)}
          >
            <span className="pc-nav-glyph" aria-hidden="true">{glyph}</span>
            {label}
          </button>
        ))}
      </nav>

      {dev?.enabled && (
        <details className="pc-dev">
          <summary>🛠 개발용</summary>
          <div className="pc-dev-group" role="group" aria-label="개발용 날짜 이동">
            <p className="pc-dev-title">오늘 {dev.today} (+{dev.offset}일)</p>
            <div className="pc-dev-buttons">
              {dev.steps.map(n => (
                <button key={n} type="button" onClick={() => onDev({ kind: 'day', add: n })}>+{n}일</button>
              ))}
              <button type="button" onClick={() => onDev({ kind: 'day', set: 0 })}>처음으로</button>
            </div>
          </div>
          <div className="pc-dev-group" role="group" aria-label="개발용 날씨 바꾸기">
            <p className="pc-dev-title">날씨</p>
            <div className="pc-dev-buttons">
              {dev.weather.map((w, i) => (
                <button key={w.label} type="button" aria-pressed={w.on} onClick={() => onDev({ kind: 'weather', i })}>{w.label}</button>
              ))}
            </div>
          </div>
        </details>
      )}
    </aside>
  )
}
