import { useMemo, useState } from 'react'
import { buildPeopleList } from '../lib/people'

export default function PublicTurkishReceivers({ transfers, receivers }) {
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const all = buildPeopleList(transfers || [], receivers || [], 'receiver')
    const turkish = all.filter((r) => r.isTurkish)
    return turkish.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [transfers, receivers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, query])

  const totalCount = rows.length
  const totalLegacy = rows.reduce((sum, r) => sum + (r.legacyCount || 0), 0)
  const totalSystem = rows.reduce((sum, r) => sum + (r.systemCount || 0), 0)
  const totalAll = totalLegacy + totalSystem

  return (
    <div className="public-list-shell" dir="rtl">
      <header className="public-list-header">
        <h1>🇹🇷 قائمة المستلمين الأتراك</h1>
        <div className="public-list-summary">
          <span className="public-chip"><strong>{totalCount}</strong> مستلم</span>
          <span className="public-chip"><strong>{totalAll}</strong> حوالة إجمالاً</span>
        </div>
      </header>

      <input
        className="public-search"
        type="search"
        placeholder="ابحث باسم المستلم..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="public-empty">
          {query ? 'لا توجد نتائج' : 'لا يوجد مستلمون أتراك بعد'}
        </div>
      ) : (
        <ol className="public-list">
          {filtered.map((row, idx) => (
            <li key={row.key} className="public-row">
              <span className="public-row-rank">{idx + 1}</span>
              <div className="public-row-body">
                <div className="public-row-name">
                  <span className="public-row-flag" aria-hidden="true">🇹🇷</span>
                  <span className="public-row-name-text">{row.name}</span>
                </div>
                <div className="public-row-counts">
                  <span className="public-count public-count--total" title="المجموع">
                    <strong>{row.total}</strong>
                    <em>المجموع</em>
                  </span>
                  {row.legacyCount > 0 ? (
                    <span className="public-count" title="قديم">
                      {row.legacyCount}
                      <em>قديم</em>
                    </span>
                  ) : null}
                  {row.systemCount > 0 ? (
                    <span className="public-count" title="نظام">
                      {row.systemCount}
                      <em>نظام</em>
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <footer className="public-list-footer">
        <span>القائمة تُحدَّث تلقائياً — Western Office</span>
      </footer>
    </div>
  )
}
