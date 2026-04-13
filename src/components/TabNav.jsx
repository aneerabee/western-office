const tabs = [
  { key: 'transfers', label: 'حوالات' },
  { key: 'customers', label: 'زبائن' },
  { key: 'people', label: 'أشخاص' },
  { key: 'settlements', label: 'تسويات' },
  { key: 'closing', label: 'إقفال' },
  { key: 'issues', label: 'مشاكل' },
  { key: 'trash', label: 'محذوفات' },
]

export default function TabNav({ active, onChange, issueCount, trashCount = 0, visibleTabs }) {
  // visibleTabs (optional): array of tab keys to show. If omitted, all tabs render.
  const renderedTabs = Array.isArray(visibleTabs)
    ? tabs.filter((t) => visibleTabs.includes(t.key))
    : tabs
  return (
    <div className="segmented">
      {renderedTabs.map((tab) => (
        <button
          key={tab.key}
          className={`segmented-btn${active === tab.key ? ' segmented-btn--active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          <span>{tab.label}</span>
          {tab.key === 'issues' && issueCount > 0 ? (
            <span className="segmented-badge">{issueCount}</span>
          ) : null}
          {tab.key === 'trash' && trashCount > 0 ? (
            <span className="segmented-badge">{trashCount}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
