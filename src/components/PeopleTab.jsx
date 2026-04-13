import { useMemo, useState } from 'react'
import {
  PERSON_KIND,
  buildPeopleList,
  getReceiverColorClass,
} from '../lib/people'

function PersonTable({
  kind,
  transfers,
  overrides,
  onUpsertPerson,
  readOnly = false,
}) {
  const [query, setQuery] = useState('')
  const [addDraft, setAddDraft] = useState({ name: '', legacyCount: '' })
  const [editingKey, setEditingKey] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  const people = useMemo(
    () => buildPeopleList(transfers, overrides, kind),
    [transfers, overrides, kind],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ar')
    if (!q) return people
    return people.filter((p) => p.name.toLocaleLowerCase('ar').includes(q))
  }, [people, query])

  const totalSystem = people.reduce((s, p) => s + p.systemCount, 0)
  const totalLegacy = people.reduce((s, p) => s + p.legacyCount, 0)
  const totalAll = totalSystem + totalLegacy

  function submitAdd(e) {
    e.preventDefault()
    if (!addDraft.name.trim()) return
    onUpsertPerson({
      name: addDraft.name,
      legacyCount: addDraft.legacyCount,
    })
    setAddDraft({ name: '', legacyCount: '' })
  }

  function startEditLegacy(row) {
    setEditingKey(row.key)
    setEditDraft(String(row.legacyCount || 0))
  }

  function saveEditLegacy(row) {
    onUpsertPerson({ name: row.name, legacyCount: editDraft })
    setEditingKey(null)
    setEditDraft('')
  }

  function cancelEdit() {
    setEditingKey(null)
    setEditDraft('')
  }

  const isReceiver = kind === PERSON_KIND.RECEIVER

  return (
    <div className="people-table-wrap">
      <div className="people-toolbar">
        {readOnly ? (
          <div className="people-toolbar-spacer" />
        ) : (
          <form className="people-add-inline" onSubmit={submitAdd}>
            <input
              value={addDraft.name}
              onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={isReceiver ? 'إضافة مستلم' : 'إضافة مرسل'}
            />
            <input
              className="people-count-input"
              inputMode="numeric"
              value={addDraft.legacyCount}
              onChange={(e) => setAddDraft((d) => ({ ...d, legacyCount: e.target.value }))}
              placeholder="قديم"
            />
            <button type="submit" className="action-btn action-btn--blue action-btn--xs">إضافة</button>
          </form>
        )}

        <div className="people-toolbar-spacer" />

        <input
          className="search-input people-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث..."
        />

        <div className="people-totals">
          <span>قديم <strong>{totalLegacy}</strong></span>
          <span>نظام <strong>{totalSystem}</strong></span>
          <span>المجموع <strong>{totalAll}</strong></span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state compact">
          {query ? 'لا توجد نتائج' : isReceiver ? 'لا يوجد مستلمون بعد' : 'لا يوجد مرسلون بعد'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="people-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th className="num-col">قديم</th>
                <th className="num-col">النظام</th>
                <th className="num-col">المجموع</th>
                {readOnly ? null : <th className="action-col"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const colorClass = isReceiver ? getReceiverColorClass(row.colorLevel) : ''
                const isEditing = editingKey === row.key
                return (
                  <tr key={row.key}>
                    <td className={`person-name-cell ${colorClass}`}>
                      <span className="person-name-text">{row.name}</span>
                    </td>
                    <td className="num-col">
                      {isEditing && !readOnly ? (
                        <input
                          className="table-input table-input--sm people-edit-input"
                          inputMode="numeric"
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditLegacy(row)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                      ) : (
                        <span className="person-count-legacy">{row.legacyCount}</span>
                      )}
                    </td>
                    <td className="num-col">
                      <span className="person-count-system">{row.systemCount}</span>
                    </td>
                    <td className="num-col">
                      <span className={`person-count-total ${colorClass}`}>{row.total}</span>
                    </td>
                    {readOnly ? null : (
                      <td className="action-col">
                        {isEditing ? (
                          <div className="action-group">
                            <button
                              className="action-btn action-btn--green action-btn--xs"
                              onClick={() => saveEditLegacy(row)}
                            >
                              ✓
                            </button>
                            <button
                              className="action-btn ghost-button action-btn--xs"
                              onClick={cancelEdit}
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            className="action-btn ghost-button action-btn--xs"
                            onClick={() => startEditLegacy(row)}
                            title="تعديل العدد القديم"
                          >
                            تعديل
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function PeopleTab({
  transfers,
  senders,
  receivers,
  onUpsertSender,
  onUpsertReceiver,
  readOnly = false,
}) {
  // Receivers is always the default tab — it's the priority per user spec
  const [activeKind, setActiveKind] = useState(PERSON_KIND.RECEIVER)

  const receiversCount = useMemo(
    () => buildPeopleList(transfers, receivers, PERSON_KIND.RECEIVER).length,
    [transfers, receivers],
  )
  const sendersCount = useMemo(
    () => buildPeopleList(transfers, senders, PERSON_KIND.SENDER).length,
    [transfers, senders],
  )

  return (
    <section className="panel people-panel">
      <div className="panel-head compact">
        <h2>الأشخاص</h2>
        <div className="people-sub-tabs">
          <button
            type="button"
            className={`people-sub-tab ${activeKind === PERSON_KIND.RECEIVER ? 'people-sub-tab--active' : ''}`}
            onClick={() => setActiveKind(PERSON_KIND.RECEIVER)}
          >
            المستلمون
            <span className="people-sub-tab-count">{receiversCount}</span>
          </button>
          <button
            type="button"
            className={`people-sub-tab ${activeKind === PERSON_KIND.SENDER ? 'people-sub-tab--active' : ''}`}
            onClick={() => setActiveKind(PERSON_KIND.SENDER)}
          >
            المرسلون
            <span className="people-sub-tab-count">{sendersCount}</span>
          </button>
        </div>
      </div>

      {activeKind === PERSON_KIND.RECEIVER ? (
        <>
          <div className="people-legend">
            <span className="legend-item"><span className="legend-swatch receiver-level-yellow" /> 4</span>
            <span className="legend-item"><span className="legend-swatch receiver-level-blue" /> 5</span>
            <span className="legend-item"><span className="legend-swatch receiver-level-red" /> 6</span>
            <span className="legend-item"><span className="legend-swatch receiver-level-red-striped" /> 7+</span>
            <span className="text-muted" style={{ fontSize: '0.7rem' }}>الألوان حسب المجموع (قديم + نظام)</span>
          </div>
          <PersonTable
            kind={PERSON_KIND.RECEIVER}
            transfers={transfers}
            overrides={receivers}
            onUpsertPerson={onUpsertReceiver}
            readOnly={readOnly}
          />
        </>
      ) : (
        <PersonTable
          kind={PERSON_KIND.SENDER}
          transfers={transfers}
          overrides={senders}
          onUpsertPerson={onUpsertSender}
          readOnly={readOnly}
        />
      )}
    </section>
  )
}
