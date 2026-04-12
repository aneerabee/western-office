const tabs = [
  { key: 'transfers', label: 'حوالات' },
  { key: 'customers', label: 'زبائن' },
  { key: 'settlements', label: 'تسويات' },
  { key: 'closing', label: 'إقفال' },
  { key: 'issues', label: 'مشاكل' },
]

export default function TabNav({ active, onChange, issueCount }) {
  return (
    <div className="segmented">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`segmented-btn${active === tab.key ? ' segmented-btn--active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          <span>{tab.label}</span>
          {tab.key === 'issues' && issueCount > 0 ? (
            <span className="segmented-badge">{issueCount}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
