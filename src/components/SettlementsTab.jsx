import { useMemo, useState } from 'react'
import { groupPendingSettlementItems } from '../lib/ledger'
import { formatMoney } from '../lib/formatting'
import { getCustomerMonogram, getCustomerTheme } from '../lib/customerTheme'
import { getReceiverColorClass, lookupReceiverColor } from '../lib/people'
import {
  buildSettlementHistory,
  filterSettlementEvents,
  summarizeSettlementHistory,
} from '../lib/settlementHistory'

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ar', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatFullDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRelative(isoString) {
  if (!isoString) return ''
  const ms = Date.now() - new Date(isoString).getTime()
  if (ms < 0) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'الآن'
  if (mins < 60) return `قبل ${mins} دقيقة`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `قبل ${hours} ساعة`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'أمس'
  if (days < 30) return `قبل ${days} يوم`
  const months = Math.floor(days / 30)
  if (months === 1) return 'قبل شهر'
  return `قبل ${months} شهر`
}

export default function SettlementsTab({
  customers,
  allCustomers,
  transfers,
  ledgerEntries,
  onSettle,
  receiverColorMap,
  duplicateReferences,
  readOnly = false,
  hideProfit = false,
}) {
  // Use allCustomers (includes deleted) for history lookup so deleted
  // customer names still appear in past settlement events.
  const customersForHistory = allCustomers || customers
  const [view, setView] = useState('pending') // 'pending' | 'history'
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [historyFilter, setHistoryFilter] = useState({ customerId: 'all', search: '' })
  const [expandedEventId, setExpandedEventId] = useState(null)

  const groups = useMemo(
    () => groupPendingSettlementItems(customers, transfers, ledgerEntries),
    [customers, ledgerEntries, transfers],
  )

  const settlementHistory = useMemo(
    () => buildSettlementHistory(transfers, ledgerEntries, customersForHistory),
    [transfers, ledgerEntries, customersForHistory],
  )

  const filteredHistory = useMemo(
    () => filterSettlementEvents(settlementHistory, historyFilter),
    [settlementHistory, historyFilter],
  )

  const historySummary = useMemo(
    () => summarizeSettlementHistory(filteredHistory),
    [filteredHistory],
  )

  const totals = useMemo(() => {
    const selectedTransfers = groups
      .flatMap((group) => group.items)
      .filter((item) => selectedIds.has(String(item.id)))
    return {
      count: selectedTransfers.length,
      system: selectedTransfers.reduce((sum, item) => sum + (item.systemAmount || 0), 0),
      customer: selectedTransfers.reduce((sum, item) => sum + (item.customerAmount || 0), 0),
      margin: selectedTransfers.reduce((sum, item) => sum + (item.margin || 0), 0),
    }
  }, [groups, selectedIds])

  function toggleTransfer(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const normalizedId = String(id)
      if (next.has(normalizedId)) next.delete(normalizedId)
      else next.add(normalizedId)
      return next
    })
  }

  function toggleGroup(group) {
    const groupIds = group.items.map((item) => String(item.id))
    setSelectedIds((prev) => {
      const allSelected = groupIds.every((id) => prev.has(id))
      const next = new Set(prev)
      for (const id of groupIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(groups.flatMap((group) => group.items.map((item) => String(item.id)))))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function confirmSettlement() {
    if (selectedIds.size === 0) return
    onSettle([...selectedIds])
    setSelectedIds(new Set())
  }

  return (
    <section className={`panel settlements-panel ${view === 'history' ? 'settlements-panel--history' : ''}`}>
      <div className="panel-head compact">
        <h2>التسويات</h2>
        <div className="settle-sub-tabs">
          <button
            type="button"
            className={`settle-sub-tab ${view === 'pending' ? 'settle-sub-tab--active' : ''}`}
            onClick={() => setView('pending')}
          >
            للتسوية
            {groups.length > 0 ? <span className="settle-sub-tab-count">{groups.length}</span> : null}
          </button>
          <button
            type="button"
            className={`settle-sub-tab ${view === 'history' ? 'settle-sub-tab--active' : ''}`}
            onClick={() => setView('history')}
          >
            تمت التسوية
            {settlementHistory.length > 0 ? (
              <span className="settle-sub-tab-count">{settlementHistory.length}</span>
            ) : null}
          </button>
        </div>
        {view === 'pending' && !readOnly ? (
          <div className="settle-toolbar">
            <button className="ghost-button ghost-button--small" onClick={selectAll}>تحديد الكل</button>
            <button className="ghost-button ghost-button--small" onClick={clearSelection}>إلغاء التحديد</button>
          </div>
        ) : null}
      </div>

      {view === 'history' ? (
        <SettlementHistoryView
          events={filteredHistory}
          summary={historySummary}
          customers={customers}
          filter={historyFilter}
          setFilter={setHistoryFilter}
          expandedEventId={expandedEventId}
          setExpandedEventId={setExpandedEventId}
          hideProfit={hideProfit}
          readOnly={readOnly}
          receiverColorMap={receiverColorMap}
        />
      ) : groups.length === 0 ? (
        <div className="empty-state issues-empty">
          <div className="issues-empty-icon" aria-hidden="true">✓</div>
          <div className="issues-empty-title">لا توجد عناصر بانتظار التسوية</div>
        </div>
      ) : (
        <div className="settlement-card-list">
          {groups.map((group) => {
            const groupIds = group.items.map((item) => String(item.id))
            const selectedCount = groupIds.filter((id) => selectedIds.has(id)).length
            const allSelected = selectedCount === groupIds.length && groupIds.length > 0
            const pct = groupIds.length > 0 ? (selectedCount / groupIds.length) * 100 : 0
            const virtualCustomer = { id: group.customerId, name: group.customerName }

            return (
              <article
                key={group.customerId}
                className={`settle-card ${selectedCount > 0 ? 'settle-card--has-selection' : ''} ${allSelected ? 'settle-card--all' : ''}`}
                style={getCustomerTheme(virtualCustomer)}
              >
                <div className="settle-card-header">
                  <div className="settle-avatar" aria-hidden="true">
                    {getCustomerMonogram(group.customerName)}
                  </div>
                  <div className="settle-identity">
                    <h3 className="settle-customer-name">{group.customerName}</h3>
                    <div className="settle-progress-text">
                      {readOnly
                        ? `${groupIds.length} حوالة`
                        : `${selectedCount} / ${groupIds.length} محدّدة`}
                    </div>
                  </div>
                  <div className="settle-totals">
                    {hideProfit ? null : (
                      <div className="settle-total">
                        <span>من الموظف</span>
                        <strong>{formatMoney(group.systemTotal)}</strong>
                      </div>
                    )}
                    <div className="settle-total">
                      <span>للزبون</span>
                      <strong className="text-orange">{formatMoney(group.customerTotal)}</strong>
                    </div>
                    {hideProfit ? null : (
                      <div className="settle-total">
                        <span>الربح</span>
                        <strong className="text-green">{formatMoney(group.marginTotal)}</strong>
                      </div>
                    )}
                  </div>
                  {readOnly ? null : (
                    <button
                      className={`settle-toggle-btn ${allSelected ? 'settle-toggle-btn--active' : ''}`}
                      onClick={() => toggleGroup(group)}
                    >
                      {allSelected ? '✓ الكل محدّد' : 'تحديد الكل'}
                    </button>
                  )}
                </div>

                <div className="settle-progress-bar" aria-hidden="true">
                  <div className="settle-progress-fill" style={{ width: `${pct}%` }} />
                </div>

                <div className="settle-item-list">
                  {group.items.map((item) => {
                    const isSelected = selectedIds.has(String(item.id))
                    const refKey = String(item.reference || '').trim().toUpperCase()
                    const isDupRef = duplicateReferences && refKey && duplicateReferences.has(refKey)
                    const receiverPreview = lookupReceiverColor(receiverColorMap, item.receiverName)
                    const receiverClass = getReceiverColorClass(receiverPreview.colorLevel)

                    const ItemTag = readOnly ? 'div' : 'label'
                    return (
                      <ItemTag
                        key={item.id}
                        className={`settle-item ${isSelected ? 'settle-item--selected' : ''} ${isDupRef ? 'settle-item--dup' : ''}`}
                      >
                        {readOnly ? null : (
                          <input
                            type="checkbox"
                            className="settle-check"
                            checked={isSelected}
                            onChange={() => toggleTransfer(item.id)}
                          />
                        )}
                        <div className="settle-item-main">
                          <div className="settle-item-head">
                            <span className="settle-item-kind">
                              {item.kind === 'opening_balance' ? '◯ افتتاحي' : '◈ حوالة'}
                            </span>
                            <span className="settle-item-ref">{item.reference}</span>
                            <span className="settle-item-date">{formatDate(item.createdAt)}</span>
                          </div>
                          <div className="settle-item-flow">
                            <span className="tc-sender">{item.senderName}</span>
                            <span className="tc-arrow" aria-hidden="true">←</span>
                            <span className={`tc-receiver ${receiverClass}`}>
                              {receiverPreview.isTurkish ? (
                                <span className="receiver-turkish-flag" title="مستلم تركي" style={{ marginInlineEnd: 4 }}>🇹🇷</span>
                              ) : null}
                              {item.receiverName || '-'}
                              {receiverPreview.total > 0 ? (
                                <span className="tc-receiver-count">{receiverPreview.total}</span>
                              ) : null}
                            </span>
                          </div>
                        </div>
                        <div className="settle-item-amounts">
                          {hideProfit ? null : (
                            <span className="amount-chip amount-chip--system">
                              <span className="amount-chip-label">من الموظف</span>
                              <span className="amount-chip-value">{formatMoney(item.systemAmount)}</span>
                            </span>
                          )}
                          <span className="amount-chip amount-chip--customer">
                            <span className="amount-chip-label">للزبون</span>
                            <span className="amount-chip-value">{formatMoney(item.customerAmount)}</span>
                          </span>
                          {hideProfit ? null : (
                            <span className="amount-chip amount-chip--margin amount-chip--highlight">
                              <span className="amount-chip-label">الربح</span>
                              <span className="amount-chip-value">{formatMoney(item.margin)}</span>
                            </span>
                          )}
                        </div>
                      </ItemTag>
                    )
                  })}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {!readOnly && view === 'pending' && selectedIds.size > 0 ? (
        <div className="settle-floating-bar" role="region" aria-label="شريط التسوية">
          <div className="settle-floating-info">
            <div className="settle-floating-stat">
              <span>محدّد</span>
              <strong>{totals.count}</strong>
            </div>
            <div className="settle-floating-stat">
              <span>من الموظف</span>
              <strong>{formatMoney(totals.system)}</strong>
            </div>
            <div className="settle-floating-stat">
              <span>للزبائن</span>
              <strong className="text-orange">{formatMoney(totals.customer)}</strong>
            </div>
            <div className="settle-floating-stat">
              <span>الربح</span>
              <strong className="text-green">{formatMoney(totals.margin)}</strong>
            </div>
          </div>
          <div className="settle-floating-actions">
            <button className="tc-btn tc-btn--ghost" onClick={clearSelection}>إلغاء</button>
            <button className="tc-btn tc-btn--save settle-confirm-btn" onClick={confirmSettlement}>
              تأكيد تسوية {totals.count}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/* ── Read-only settlement history view ── */
function SettlementHistoryView({
  events,
  summary,
  customers,
  filter,
  setFilter,
  expandedEventId,
  setExpandedEventId,
  hideProfit = false,
  receiverColorMap = null,
}) {
  const activeCustomers = useMemo(
    () => customers.filter((c) => !c.deletedAt).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar')),
    [customers],
  )

  function toggleExpand(eventId) {
    setExpandedEventId((current) => (current === eventId ? null : eventId))
  }

  return (
    <div className="settle-history">
      <div className="settle-history-summary">
        <div className="settle-history-stat">
          <span>أحداث التسوية</span>
          <strong>{summary.eventCount}</strong>
        </div>
        <div className="settle-history-stat">
          <span>إجمالي الحوالات</span>
          <strong>{summary.transferCount}</strong>
        </div>
        <div className="settle-history-stat">
          <span>إجمالي مدفوع للزبائن</span>
          <strong className="text-orange">{formatMoney(summary.totalCustomer)}</strong>
        </div>
        {hideProfit ? null : (
          <>
            <div className="settle-history-stat">
              <span>إجمالي المستلم من الموظف</span>
              <strong>{formatMoney(summary.totalSystem)}</strong>
            </div>
            <div className="settle-history-stat">
              <span>إجمالي الربح المحقَّق</span>
              <strong className="text-green">{formatMoney(summary.totalMargin)}</strong>
            </div>
          </>
        )}
      </div>

      <div className="settle-history-filters">
        <select
          className="filter-select"
          value={filter.customerId}
          onChange={(e) => setFilter((f) => ({ ...f, customerId: e.target.value === 'all' ? 'all' : Number(e.target.value) }))}
          aria-label="تصفية حسب الزبون"
        >
          <option value="all">كل الزبائن</option>
          {activeCustomers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          className="search-input settle-history-search"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          placeholder="بحث برقم الحوالة، المرسل، المستلم، أو اسم الزبون..."
          aria-label="بحث في سجل التسويات"
        />
      </div>

      {events.length === 0 ? (
        <div className="empty-state issues-empty">
          <div className="issues-empty-icon" aria-hidden="true">📜</div>
          <div className="issues-empty-title">
            {filter.customerId !== 'all' || filter.search ? 'لا توجد نتائج للتصفية' : 'لا يوجد سجل تسويات بعد'}
          </div>
          <div className="issues-empty-sub">
            {filter.customerId !== 'all' || filter.search ? 'جرّب تغيير التصفية' : 'كل تسوية تُنفّذها ستظهر هنا'}
          </div>
        </div>
      ) : (
        <div className="settle-history-list">
          {events.map((event) => {
            const isExpanded = expandedEventId === event.id
            const virtualCustomer = { id: event.customerId, name: event.customerName }
            return (
              <article
                key={event.id}
                className={`settle-history-event settle-history-event--${event.kind} ${isExpanded ? 'is-expanded' : ''}`}
                style={getCustomerTheme(virtualCustomer)}
              >
                <button
                  type="button"
                  className="settle-history-head"
                  onClick={() => toggleExpand(event.id)}
                  aria-expanded={isExpanded}
                >
                  <div className="settle-history-avatar" aria-hidden="true">
                    {getCustomerMonogram(event.customerName)}
                  </div>
                  <div className="settle-history-identity">
                    <div className="settle-history-customer">
                      {event.customerName || 'زبون محذوف'}
                      <span className={`settle-history-kind-badge settle-history-kind-badge--${event.kind}`}>
                        {event.kind === 'opening' ? 'رصيد افتتاحي' : 'حوالات'}
                      </span>
                    </div>
                    <div className="settle-history-date">
                      <span>{formatFullDate(event.settledAt)}</span>
                      <span className="settle-history-relative">{formatRelative(event.settledAt)}</span>
                    </div>
                  </div>
                  <div className="settle-history-stats">
                    <div className="settle-history-stat-cell">
                      <span>عدد الحوالات</span>
                      <strong>{event.count}</strong>
                    </div>
                    <div className="settle-history-stat-cell">
                      <span>دُفع للزبون</span>
                      <strong className="text-orange">{formatMoney(event.totalCustomer)}</strong>
                    </div>
                    {event.kind === 'transfer' && !hideProfit ? (
                      <>
                        <div className="settle-history-stat-cell">
                          <span>من الموظف</span>
                          <strong>{formatMoney(event.totalSystem)}</strong>
                        </div>
                        <div className="settle-history-stat-cell">
                          <span>الربح</span>
                          <strong className="text-green">{formatMoney(event.totalMargin)}</strong>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <span className="settle-history-arrow" aria-hidden="true">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="settle-history-body">
                    {event.kind === 'opening' ? (
                      <div className="settle-history-opening-note">
                        {event.note}
                        <span className="settle-history-opening-amount">
                          {formatMoney(event.totalCustomer)} عن {event.count} حوالة
                        </span>
                      </div>
                    ) : event.items.length === 0 ? (
                      <div className="empty-state compact">لا توجد تفاصيل</div>
                    ) : (
                      <div className="table-wrap">
                        <table className="settle-history-items-table">
                          <thead>
                            <tr>
                              <th>الرقم</th>
                              <th>المرسل</th>
                              <th>المستلم</th>
                              <th>تاريخ السحب</th>
                              <th>دُفع للزبون</th>
                              {hideProfit ? null : (
                                <>
                                  <th>من الموظف</th>
                                  <th>الربح</th>
                                </>
                              )}
                              <th>ملاحظة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {event.items.map((item) => {
                              const itemRecv = lookupReceiverColor(receiverColorMap, item.receiverName)
                              return (
                                <tr key={item.transferId}>
                                  <td className="ref-cell">{item.reference}</td>
                                  <td>{item.senderName || '-'}</td>
                                  <td>
                                    {itemRecv.isTurkish ? (
                                      <span title="مستلم تركي" style={{ marginInlineEnd: 4 }}>🇹🇷</span>
                                    ) : null}
                                    {item.receiverName || '-'}
                                  </td>
                                  <td className="date-cell">{formatDate(item.pickedUpAt)}</td>
                                  <td>{formatMoney(item.customerAmount)}</td>
                                  {hideProfit ? null : (
                                    <>
                                      <td>{formatMoney(item.systemAmount)}</td>
                                      <td className="text-green">{formatMoney(item.margin)}</td>
                                    </>
                                  )}
                                  <td>{item.note || '-'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
