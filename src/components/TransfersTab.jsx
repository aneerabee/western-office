import { useState } from 'react'
import { statusMeta } from '../sampleData'
import {
  FILTER_ALL,
  statusOrder,
  transitionTransfer,
  validateTransition,
  updateAmount,
  updateTransferField,
} from '../lib/transferLogic'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function money(v) {
  return currency.format(Number(v || 0))
}

function formatDate(v) {
  if (!v) return '-'
  return new Intl.DateTimeFormat('ar', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v))
}

const VIEW_LABELS = {
  active: 'نشطة — تحتاج انتباه',
  today: 'حوالات اليوم',
  all: 'كل الحوالات',
  completed: 'مكتملة فقط',
}

export default function TransfersTab({
  filteredTransfers,
  allTransfers,
  customers,
  customersById,
  transferDraft,
  setTransferDraft,
  onAddTransfer,
  onPatchTransfer,
  onDeleteTransfer,
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  viewMode,
  setViewMode,
  customerFilter,
  setCustomerFilter,
  sortMode,
  setSortMode,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  onResetFilters,
  transferSummary,
  onFeedback,
}) {
  const [editingId, setEditingId] = useState(null)
  const [settledOpen, setSettledOpen] = useState(false)

  // Settled transfers for the separate section
  const settledTransfers = allTransfers
    .filter((t) => t.status === 'picked_up' && t.settled)
    .sort((a, b) => new Date(b.settledAt || b.updatedAt).getTime() - new Date(a.settledAt || a.updatedAt).getTime())

  // Smart grouped view
  const sections = sortMode === 'smart' ? groupBySections(filteredTransfers) : null

  function handleTransition(item, nextStatus) {
    if (nextStatus === 'received') {
      if (!window.confirm('إعادة الحوالة لـ "جديدة" ستمسح كل المبالغ والتواريخ. هل أنت متأكد؟')) return
    }
    const check = validateTransition(item, nextStatus)
    if (!check.ok) {
      onFeedback(check.error)
      setEditingId(item.id)
      return
    }
    onPatchTransfer(item.id, (r) => transitionTransfer(r, nextStatus))
  }

  return (
    <>
      {/* ── Add transfer ── */}
      <section className="panel">
        <div className="panel-head compact">
          <h2>إضافة حوالة</h2>
        </div>

        <form className="inline-form" onSubmit={onAddTransfer}>
          <select
            value={transferDraft.customerId}
            onChange={(e) => setTransferDraft((c) => ({ ...c, customerId: e.target.value }))}
          >
            <option value="">اختر الزبون</option>
            {customers
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
          <input
            value={transferDraft.senderName}
            onChange={(e) => setTransferDraft((c) => ({ ...c, senderName: e.target.value }))}
            placeholder="اسم المرسل"
          />
          <input
            value={transferDraft.reference}
            onChange={(e) => setTransferDraft((c) => ({ ...c, reference: e.target.value }))}
            placeholder="رقم الحوالة"
          />
          <input
            inputMode="decimal"
            value={transferDraft.transferAmount}
            onChange={(e) => setTransferDraft((c) => ({ ...c, transferAmount: e.target.value }))}
            placeholder="مبلغ الحوالة"
          />
          <input
            inputMode="decimal"
            value={transferDraft.customerAmount}
            onChange={(e) => setTransferDraft((c) => ({ ...c, customerAmount: e.target.value }))}
            placeholder="كم بنعطوه"
          />
          <button type="submit">إضافة حوالة</button>
        </form>

        <div className="toolbar">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث بالرقم أو الاسم أو الملاحظة"
          />
          <select className="view-select" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
            {Object.entries(VIEW_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            type="date"
            className="date-filter"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="من تاريخ"
          />
          <input
            type="date"
            className="date-filter"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="إلى تاريخ"
          />
          <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value={FILTER_ALL}>كل الزبائن</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value={FILTER_ALL}>كل الحالات</option>
            {statusOrder.map((s) => (
              <option key={s} value={s}>{statusMeta[s].label}</option>
            ))}
          </select>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
            <option value="smart">ذكي (الأهم أولاً)</option>
            <option value="latest">الأحدث</option>
            <option value="oldest">الأقدم</option>
            <option value="customer">الزبون</option>
          </select>
          <button className="ghost-button ghost-button--muted" onClick={onResetFilters}>تصفير</button>
        </div>
      </section>

      {/* ── Active transfers ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>الحوالات <span className="panel-count">{filteredTransfers.length}</span></h2>
          <div className="totals-line">
            <span>المستلم: {money(transferSummary.totalSystem)}</span>
            <span>للزبائن: {money(transferSummary.totalCustomer)}</span>
            <span>الربح: {money(transferSummary.totalMargin)}</span>
          </div>
        </div>

        {filteredTransfers.length === 0 ? (
          <div className="empty-state">
            {viewMode === 'active' ? 'لا توجد حوالات نشطة حالياً' : 'لا توجد نتائج'}
          </div>
        ) : sections ? (
          sections.map((section) => {
            if (section.items.length === 0) return null
            return (
              <div key={section.key} className="transfer-section">
                <div className="section-header" style={{ '--section-color': section.color }}>
                  <span className="section-dot" />
                  <span>{section.label}</span>
                  <span className="section-count">{section.items.length}</span>
                </div>
                <TransferTable
                  items={section.items}
                  customers={customers}
                  customersById={customersById}
                  onPatchTransfer={onPatchTransfer}
                  onDeleteTransfer={onDeleteTransfer}
                  onTransition={handleTransition}
                  editingId={editingId}
                  setEditingId={setEditingId}
                />
              </div>
            )
          })
        ) : (
          <TransferTable
            items={filteredTransfers}
            customers={customers}
            customersById={customersById}
            onPatchTransfer={onPatchTransfer}
            onDeleteTransfer={onDeleteTransfer}
            onTransition={handleTransition}
            editingId={editingId}
            setEditingId={setEditingId}
          />
        )}
      </section>

      {/* ── Settled transfers section ── */}
      {viewMode === 'active' && settledTransfers.length > 0 ? (
        <section className="panel settled-panel">
          <div className="panel-head">
            <button
              className="settled-toggle"
              onClick={() => setSettledOpen((v) => !v)}
            >
              <h2>
                حوالات مسوّاة
                <span className="panel-count">{settledTransfers.length}</span>
                <span className="toggle-arrow">{settledOpen ? '▲' : '▼'}</span>
              </h2>
            </button>
          </div>

          {settledOpen ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>المرسل</th>
                    <th>تاريخ التسوية</th>
                    <th>مبلغ الحوالة</th>
                    <th>للزبون</th>
                    <th>من الموظف</th>
                    <th>الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {settledTransfers.map((t) => (
                    <tr key={t.id} className="row-settled">
                      <td className="ref-cell">{t.reference}</td>
                      <td>{customersById.get(t.customerId)?.name}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatDate(t.settledAt || t.updatedAt)}</td>
                      <td className="amount-info">{t.transferAmount === null ? '-' : money(t.transferAmount)}</td>
                      <td>{money(t.customerAmount)}</td>
                      <td>{money(t.systemAmount)}</td>
                      <td>{t.margin === null ? '-' : money(t.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

/* ── Section grouping ── */

const SECTION_META = [
  { key: 'issue', label: 'مشاكل — تحتاج حل', color: '#dc2626' },
  { key: 'review_hold', label: 'مراجعة لاحقة — ذكّر المكتب بها', color: '#a16207' },
  { key: 'received', label: 'جديدة — بانتظار الإرسال للموظف', color: '#64748b' },
  { key: 'with_employee', label: 'عند الموظف — بانتظار السحب', color: '#2563eb' },
  { key: 'picked_up', label: 'تم السحب', color: '#15803d' },
]

function groupBySections(transfers) {
  const groups = { issue: [], review_hold: [], received: [], with_employee: [], picked_up: [] }
  for (const t of transfers) {
    const key = groups[t.status] ? t.status : 'received'
    groups[key].push(t)
  }
  return SECTION_META.map((s) => ({ ...s, items: groups[s.key] || [] }))
}

/* ── Status action buttons with validation ── */

function StatusActions({ item, onTransition }) {
  if (item.status === 'received') {
    return (
      <button
        className="action-btn action-btn--blue"
        onClick={() => onTransition(item, 'with_employee')}
      >
        أرسل للموظف
      </button>
    )
  }
  if (item.status === 'with_employee') {
    return (
      <div className="action-group">
        <button
          className="action-btn action-btn--green"
          onClick={() => onTransition(item, 'picked_up')}
        >
          تم السحب
        </button>
        <button
          className="action-btn ghost-button--muted"
          onClick={() => onTransition(item, 'review_hold')}
        >
          مراجعة لاحقة
        </button>
        <button
          className="action-btn action-btn--red"
          onClick={() => onTransition(item, 'issue')}
        >
          مشكلة
        </button>
      </div>
    )
  }
  if (item.status === 'review_hold') {
    return (
      <div className="action-group">
        <button
          className="action-btn action-btn--green"
          onClick={() => onTransition(item, 'picked_up')}
        >
          تم السحب
        </button>
        <button
          className="action-btn action-btn--red"
          onClick={() => onTransition(item, 'issue')}
        >
          مشكلة
        </button>
        <button
          className="action-btn action-btn--blue"
          onClick={() => onTransition(item, 'received')}
        >
          أعدها جديدة
        </button>
      </div>
    )
  }
  if (item.status === 'picked_up') {
    return <span className="status-done-badge">تم السحب</span>
  }
  if (item.status === 'issue') {
    return (
      <button
        className="action-btn action-btn--blue"
        onClick={() => onTransition(item, 'received')}
      >
        أعدها جديدة
      </button>
    )
  }
  return null
}

/* ── Transfer table with edit mode ── */

function TransferTable({ items, customers, customersById, onPatchTransfer, onDeleteTransfer, onTransition, editingId, setEditingId }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>الرقم</th>
            <th>الزبون</th>
            <th>المرسل</th>
            <th>التاريخ</th>
            <th>الإجراء</th>
            <th>مبلغ الحوالة</th>
            <th>للزبون</th>
            <th>من الموظف</th>
            <th>الربح</th>
            <th>ملاحظة</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isEditing = editingId === item.id
            const missingTransfer = typeof item.transferAmount !== 'number'
            const missingCustomer = typeof item.customerAmount !== 'number'
            const missingSystem = typeof item.systemAmount !== 'number'

            return (
              <tr
                key={item.id}
                className={
                  item.status === 'issue' ? 'row-issue'
                    : item.status === 'picked_up' ? 'row-picked'
                    : ''
                }
              >
                <td className="ref-cell">
                  {isEditing ? (
                    <input
                      className="table-input"
                      value={item.reference}
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => updateTransferField(r, 'reference', e.target.value.toUpperCase()))
                      }
                    />
                  ) : item.reference}
                </td>
                <td>
                  {isEditing ? (
                    <select
                      className="table-select"
                      value={item.customerId}
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => {
                          const nextCustomerId = Number(e.target.value)
                          const customer = customers.find((entry) => entry.id === nextCustomerId)
                          return {
                            ...updateTransferField(r, 'customerId', nextCustomerId),
                            receiverName: customer?.name || r.receiverName,
                          }
                        })
                      }
                    >
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.name}</option>
                      ))}
                    </select>
                  ) : (
                    customersById.get(item.customerId)?.name
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      className="table-input"
                      value={item.senderName}
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => updateTransferField(r, 'senderName', e.target.value))
                      }
                    />
                  ) : item.senderName}
                </td>
                <td className="date-cell">{formatDate(item.createdAt)}</td>
                <td>
                  {isEditing ? (
                    <select
                      className="table-select import-status-select"
                      value={item.status}
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => transitionTransfer(r, e.target.value))
                      }
                    >
                      {statusOrder.map((s) => (
                        <option key={s} value={s}>{statusMeta[s].label}</option>
                      ))}
                    </select>
                  ) : (
                    <StatusActions item={item} onTransition={onTransition} />
                  )}
                </td>

                {/* مبلغ الحوالة */}
                <td className={missingTransfer && !isEditing ? 'cell-warning' : 'amount-info'}>
                  {isEditing ? (
                    <input
                      className="table-input"
                      inputMode="decimal"
                      value={item.transferAmount ?? ''}
                      placeholder="مبلغ الحوالة"
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => updateAmount(r, 'transferAmount', e.target.value))
                      }
                    />
                  ) : (
                    item.transferAmount === null ? <span className="missing-hint">مطلوب</span> : money(item.transferAmount)
                  )}
                </td>

                {/* للزبون */}
                <td className={missingCustomer && !isEditing ? 'cell-warning' : ''}>
                  {isEditing ? (
                    <input
                      className="table-input"
                      inputMode="decimal"
                      value={item.customerAmount ?? ''}
                      placeholder="كم بنعطوه"
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => updateAmount(r, 'customerAmount', e.target.value))
                      }
                    />
                  ) : (
                    item.customerAmount === null ? <span className="missing-hint">مطلوب</span> : money(item.customerAmount)
                  )}
                </td>

                {/* المستلم من الموظف */}
                <td className={missingSystem && item.status === 'with_employee' && !isEditing ? 'cell-warning' : ''}>
                  {isEditing ? (
                    <input
                      className="table-input"
                      inputMode="decimal"
                      value={item.systemAmount ?? ''}
                      placeholder="المستلم من الموظف"
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => updateAmount(r, 'systemAmount', e.target.value))
                      }
                    />
                  ) : (
                    item.systemAmount === null
                      ? (item.status === 'with_employee' ? <span className="missing-hint">ينتظر</span> : '-')
                      : money(item.systemAmount)
                  )}
                </td>

                {/* الربح */}
                <td className={item.margin !== null && item.margin > 0 ? 'text-green' : ''}>
                  {item.margin === null ? '-' : money(item.margin)}
                </td>

                {/* ملاحظة */}
                <td>
                  {isEditing ? (
                    <input
                      className="table-input"
                      value={item.note || ''}
                      placeholder="ملاحظة"
                      onChange={(e) =>
                        onPatchTransfer(item.id, (r) => updateTransferField(r, 'note', e.target.value))
                      }
                    />
                  ) : (
                    <span className="note-text">{item.note || '-'}</span>
                  )}
                </td>

                {/* أزرار التحكم */}
                <td>
                  <div className="row-actions">
                    <button
                      className={`action-btn ${isEditing ? 'action-btn--green' : 'action-btn--blue'} action-btn--xs`}
                      onClick={() => setEditingId(isEditing ? null : item.id)}
                    >
                      {isEditing ? 'حفظ' : 'تعديل'}
                    </button>
                    {isEditing ? (
                      <button
                        className="danger-button"
                        onClick={() => { onDeleteTransfer(item.id); setEditingId(null) }}
                      >
                        حذف
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
