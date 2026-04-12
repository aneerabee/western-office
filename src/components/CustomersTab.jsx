import { useState } from 'react'
import { statusMeta } from '../sampleData'
import {
  transitionTransfer,
  updateAmount,
  updateTransferField,
  validateTransition,
} from '../lib/transferLogic'
import { buildCustomerStatement } from '../lib/ledger'

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

function StatusActions({ item, onTransition }) {
  if (item.status === 'received') {
    return (
      <button
        className="action-btn action-btn--blue action-btn--xs"
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
          className="action-btn action-btn--green action-btn--xs"
          onClick={() => onTransition(item, 'picked_up')}
        >
          تم السحب
        </button>
        <button
          className="action-btn ghost-button--muted action-btn--xs"
          onClick={() => onTransition(item, 'review_hold')}
        >
          مراجعة لاحقة
        </button>
        <button
          className="action-btn action-btn--red action-btn--xs"
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
          className="action-btn action-btn--green action-btn--xs"
          onClick={() => onTransition(item, 'picked_up')}
        >
          تم السحب
        </button>
        <button
          className="action-btn action-btn--red action-btn--xs"
          onClick={() => onTransition(item, 'issue')}
        >
          مشكلة
        </button>
        <button
          className="action-btn action-btn--blue action-btn--xs"
          onClick={() => onTransition(item, 'received')}
        >
          أعدها جديدة
        </button>
      </div>
    )
  }
  if (item.status === 'picked_up') {
    return (
      <span className="status-done-badge status-done-badge--xs">
        تم {item.settled ? '· مسوّاة' : ''}
      </span>
    )
  }
  if (item.status === 'issue') {
    return (
      <button
        className="action-btn action-btn--blue action-btn--xs"
        onClick={() => onTransition(item, 'received')}
      >
        أعدها جديدة
      </button>
    )
  }
  return null
}

export default function CustomersTab({
  customers,
  customerSummary,
  customerDraft,
  setCustomerDraft,
  onAddCustomer,
  transfers,
  onPatchTransfer,
  onFeedback,
  ledgerEntries,
}) {
  const [viewMode, setViewMode] = useState(null)
  const [viewCustomerId, setViewCustomerId] = useState(null)

  function openTransfers(customerId) {
    if (viewMode === 'transfers' && viewCustomerId === customerId) {
      setViewMode(null)
      setViewCustomerId(null)
    } else {
      setViewMode('transfers')
      setViewCustomerId(customerId)
    }
  }

  function openStatement(customerId) {
    if (viewMode === 'statement' && viewCustomerId === customerId) {
      setViewMode(null)
      setViewCustomerId(null)
    } else {
      setViewMode('statement')
      setViewCustomerId(customerId)
    }
  }

  function safeTransition(item, nextStatus) {
    if (nextStatus === 'received') {
      if (!window.confirm('إعادة الحوالة لـ "جديدة" ستمسح كل المبالغ والتواريخ. هل أنت متأكد؟')) return
    }
    const check = validateTransition(item, nextStatus)
    if (!check.ok) {
      onFeedback(check.error)
      return
    }
    onPatchTransfer(item.id, (row) => transitionTransfer(row, nextStatus))
  }

  return (
    <section className="panel">
      <div className="panel-head compact">
        <h2>الزبائن</h2>
        <span className="panel-count">{customers.length}</span>
      </div>

      <form className="inline-form" onSubmit={onAddCustomer}>
        <input
          value={customerDraft.name}
          onChange={(e) => setCustomerDraft((c) => ({ ...c, name: e.target.value }))}
          placeholder="اسم الزبون"
        />
        <input
          inputMode="decimal"
          value={customerDraft.openingBalance}
          onChange={(e) => setCustomerDraft((c) => ({ ...c, openingBalance: e.target.value }))}
          placeholder="رصيد بداية"
        />
        <button type="submit">إضافة زبون</button>
      </form>

      {customerSummary.length === 0 ? (
        <div className="empty-state">لا يوجد زبائن</div>
      ) : (
        customerSummary.map((c) => {
          const isTransfersOpen = viewMode === 'transfers' && viewCustomerId === c.id
          const isStatementOpen = viewMode === 'statement' && viewCustomerId === c.id
          const customerTransfers = isTransfersOpen
            ? transfers
                .filter((t) => t.customerId === c.id)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            : []
          const statement = isStatementOpen
            ? buildCustomerStatement(customers, transfers, ledgerEntries, c.id)
            : []

          return (
            <div key={c.id} className="customer-card">
              <div className="customer-row">
                <button className="customer-name-btn" onClick={() => openTransfers(c.id)}>
                  {c.name}
                  <span className="count-badge">{c.transferCount}</span>
                  {isTransfersOpen ? ' ▲' : ' ▼'}
                </button>

                <div className="customer-stats">
                  <div className="mini-stat">
                    <span>جديدة</span>
                    <strong>{c.receivedCount}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>عند الموظف</span>
                    <strong className="text-blue">{c.withEmployeeCount}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>مراجعة لاحقة</span>
                    <strong className="text-orange">{c.reviewHoldCount}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>مشاكل</span>
                    <strong className="text-red">{c.issueCount}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>تم السحب</span>
                    <strong className="text-green">{c.pickedUpCount}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>الرصيد الجاري</span>
                    <strong className="balance-cell">{money(c.currentBalance)}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>غير مدفوع</span>
                    <strong className="text-orange">{money(c.unsettledAmount)}</strong>
                  </div>
                </div>

                <div className="customer-actions">
                  <button
                    className={`action-btn ${isStatementOpen ? 'action-btn--active' : 'action-btn--blue'}`}
                    onClick={() => openStatement(c.id)}
                  >
                    {isStatementOpen ? 'إخفاء الكشف' : 'كشف حساب'}
                  </button>
                </div>
              </div>

              {isTransfersOpen ? (
                <div className="customer-transfers-box">
                  <div className="customer-transfers-header">
                    حوالات {c.name} — {customerTransfers.length} حوالة
                  </div>
                  {customerTransfers.length === 0 ? (
                    <p className="text-muted" style={{ padding: '16px', textAlign: 'center' }}>لا توجد حوالات</p>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>الرقم</th>
                            <th>المرسل</th>
                            <th>التاريخ</th>
                            <th>الحالة</th>
                            <th>الإجراء</th>
                            <th>مبلغ الحوالة</th>
                            <th>للزبون</th>
                            <th>من الموظف</th>
                            <th>الربح</th>
                            <th>ملاحظة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerTransfers.map((t) => (
                            <tr
                              key={t.id}
                              className={
                                t.status === 'issue' ? 'row-issue'
                                  : t.settled ? 'row-settled'
                                  : t.status === 'picked_up' ? 'row-picked'
                                  : ''
                              }
                            >
                              <td className="ref-cell">{t.reference}</td>
                              <td>{t.senderName}</td>
                              <td className="date-cell">{formatDate(t.createdAt)}</td>
                              <td>
                                <span
                                  className="status-badge"
                                  style={{ '--badge-color': statusMeta[t.status]?.color }}
                                >
                                  <span className="status-dot" />
                                  {statusMeta[t.status]?.label}
                                </span>
                              </td>
                              <td>
                                <StatusActions item={t} onTransition={safeTransition} />
                              </td>
                              <td className="amount-info">
                                {t.transferAmount === null ? '-' : money(t.transferAmount)}
                              </td>
                              <td>
                                <input
                                  className="table-input table-input--sm"
                                  inputMode="decimal"
                                  value={t.customerAmount ?? ''}
                                  onChange={(e) =>
                                    onPatchTransfer(t.id, (r) => updateAmount(r, 'customerAmount', e.target.value))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="table-input table-input--sm"
                                  inputMode="decimal"
                                  value={t.systemAmount ?? ''}
                                  onChange={(e) =>
                                    onPatchTransfer(t.id, (r) => updateAmount(r, 'systemAmount', e.target.value))
                                  }
                                />
                              </td>
                              <td>{t.margin === null ? '-' : money(t.margin)}</td>
                              <td>
                                <input
                                  className="table-input table-input--sm"
                                  value={t.note || ''}
                                  onChange={(e) =>
                                    onPatchTransfer(t.id, (r) => updateTransferField(r, 'note', e.target.value))
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {isStatementOpen ? (
                <div className="settlement-box">
                  <div className="customer-transfers-header">
                    <strong>كشف حساب — {c.name}</strong>
                    <span className="text-muted">{statement.length} حركة</span>
                  </div>
                  {statement.length === 0 ? (
                    <p className="text-muted" style={{ padding: '16px', textAlign: 'center' }}>لا توجد حركات لهذا الزبون</p>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>التاريخ</th>
                            <th>النوع</th>
                            <th>الرقم</th>
                            <th>المرسل</th>
                            <th>له</th>
                            <th>عليه</th>
                            <th>الرصيد بعد الحركة</th>
                            <th>ملاحظة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statement.map((entry) => (
                            <tr key={entry.id}>
                              <td className="date-cell">{formatDate(entry.createdAt)}</td>
                              <td>{entry.label}</td>
                              <td className="ref-cell">{entry.reference}</td>
                              <td>{entry.senderName}</td>
                              <td>{entry.amount > 0 ? money(entry.amount) : '-'}</td>
                              <td>{entry.amount < 0 ? money(Math.abs(entry.amount)) : '-'}</td>
                              <td className="balance-cell">{money(entry.runningBalance)}</td>
                              <td>{entry.note || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })
      )}
    </section>
  )
}
