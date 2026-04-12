import { useMemo, useState } from 'react'
import { groupPendingSettlementItems } from '../lib/ledger'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function money(value) {
  return currency.format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ar', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function SettlementsTab({ customers, transfers, ledgerEntries, onSettle }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const groups = useMemo(
    () => groupPendingSettlementItems(customers, transfers, ledgerEntries),
    [customers, ledgerEntries, transfers],
  )

  const totals = useMemo(() => {
    const selectedTransfers = groups.flatMap((group) => group.items).filter((item) => selectedIds.has(String(item.id)))
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
    <section className="panel">
      <div className="panel-head">
        <h2>التسويات</h2>
        <div className="settlement-actions">
          <button className="ghost-button ghost-button--small" onClick={selectAll}>تحديد الكل</button>
          <button className="ghost-button ghost-button--small" onClick={clearSelection}>إلغاء التحديد</button>
          <button
            className="action-btn action-btn--green"
            disabled={selectedIds.size === 0}
            onClick={confirmSettlement}
          >
            تأكيد التسوية
          </button>
        </div>
      </div>

      <div className="closing-grid">
        <div className="closing-card">
          <span>العناصر المحددة</span>
          <strong>{totals.count}</strong>
        </div>
        <div className="closing-card">
          <span>من الموظف</span>
          <strong>{money(totals.system)}</strong>
        </div>
        <div className="closing-card">
          <span>للزبائن</span>
          <strong className="text-orange">{money(totals.customer)}</strong>
        </div>
        <div className="closing-card">
          <span>الربح</span>
          <strong className="text-green">{money(totals.margin)}</strong>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">لا توجد عناصر بانتظار التسوية</div>
      ) : (
        groups.map((group) => {
          const groupIds = group.items.map((item) => item.id)
          const selectedCount = groupIds.filter((id) => selectedIds.has(id)).length
          const allSelected = selectedCount === groupIds.length

          return (
            <div key={group.customerId} className="settlement-group">
              <div className="issue-group-header">
                <div className="settlement-group-headline">
                  <strong>{group.customerName}</strong>
                  <span className="count-badge">
                    {group.items.reduce((sum, item) => sum + (item.openingTransferCount || 1), 0)}
                  </span>
                </div>
                <div className="settlement-group-totals">
                  <span>من الموظف: {money(group.systemTotal)}</span>
                  <span>للزبون: {money(group.customerTotal)}</span>
                  <span>ربح: {money(group.marginTotal)}</span>
                </div>
                <button className="ghost-button ghost-button--small" onClick={() => toggleGroup(group)}>
                  {allSelected ? 'إلغاء المجموعة' : `تحديد المجموعة${selectedCount ? ` (${selectedCount})` : ''}`}
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                    <th>اختيار</th>
                    <th>النوع</th>
                    <th>الرقم</th>
                    <th>البيان</th>
                    <th>التاريخ</th>
                    <th>من الموظف</th>
                    <th>للزبون</th>
                    <th>الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(String(item.id))}
                          onChange={() => toggleTransfer(item.id)}
                        />
                      </td>
                      <td>{item.kind === 'opening_balance' ? 'افتتاحي' : 'حوالة'}</td>
                      <td className="ref-cell">{item.reference}</td>
                      <td>{item.senderName}</td>
                      <td className="date-cell">{formatDate(item.createdAt)}</td>
                      <td>{money(item.systemAmount)}</td>
                      <td>{money(item.customerAmount)}</td>
                        <td>{money(item.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </section>
  )
}
