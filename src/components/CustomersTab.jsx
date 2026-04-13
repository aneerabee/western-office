import { useState } from 'react'
import { statusMeta } from '../sampleData'
import {
  transitionTransfer,
  updateAmount,
  updateTransferField,
  validateTransition,
} from '../lib/transferLogic'
import { buildCustomerStatement } from '../lib/ledger'
import { buildCustomerWhatsappMessage, buildWhatsappUrl } from '../lib/whatsappStatement'
import { getCustomerTheme, getCustomerMonogram } from '../lib/customerTheme'
import { formatEditableNumber, formatMoney, normalizeNumberInput } from '../lib/formatting'
import { getReceiverColorClass, lookupReceiverColor } from '../lib/people'

function getHealthLevel(currentBalance) {
  const v = Math.abs(Number(currentBalance) || 0)
  if (v < 0.01) return 'clear'
  if (v < 500) return 'caution'
  if (v < 2000) return 'warning'
  return 'danger'
}

function CircularProgress({ value, size = 42 }) {
  const radius = (size - 6) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value || 0))
  const offset = circumference - (clamped / 100) * circumference
  return (
    <svg width={size} height={size} className="circular-progress" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="4"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill="currentColor"
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  )
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
          className="action-btn action-btn--red action-btn--xs"
          onClick={() => onTransition(item, 'received')}
          title="إعادة هذه الحوالة فقط لحالة جديدة (مسح المبالغ والتواريخ)"
        >
          ⚠ أعدها جديدة
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
        className="action-btn action-btn--red action-btn--xs"
        onClick={() => onTransition(item, 'received')}
        title="إعادة هذه الحوالة فقط لحالة جديدة (مسح المبالغ والتواريخ)"
      >
        ⚠ أعدها جديدة
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
  onUpdateCustomer,
  onDeleteCustomer,
  transfers,
  onPatchTransfer,
  onResetTransfer,
  onFeedback,
  ledgerEntries,
  receiverColorMap,
  duplicateReferences,
}) {
  const [viewMode, setViewMode] = useState(null)
  const [viewCustomerId, setViewCustomerId] = useState(null)
  const [editingCustomerId, setEditingCustomerId] = useState(null)
  const [editDraft, setEditDraft] = useState({ name: '', openingBalance: '', openingTransferCount: '', phone: '' })

  function startEdit(customer) {
    setEditingCustomerId(customer.id)
    setEditDraft({
      name: customer.name || '',
      openingBalance: String(customer.openingBalance ?? ''),
      openingTransferCount: String(customer.openingTransferCount ?? ''),
      phone: customer.phone || '',
    })
  }

  function cancelEdit() {
    setEditingCustomerId(null)
  }

  function saveEdit(customerId) {
    onUpdateCustomer(customerId, {
      name: editDraft.name,
      openingBalance: editDraft.openingBalance,
      openingTransferCount: editDraft.openingTransferCount,
      phone: editDraft.phone,
    })
    setEditingCustomerId(null)
  }

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
      // Centralized rich confirm + undo flow lives in App.jsx
      onResetTransfer?.(item)
      return
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
          className="money-input"
          inputMode="decimal"
          value={formatEditableNumber(customerDraft.openingBalance)}
          onChange={(e) => setCustomerDraft((c) => ({ ...c, openingBalance: normalizeNumberInput(e.target.value) }))}
          placeholder="رصيد بداية"
        />
        <input
          inputMode="numeric"
          value={customerDraft.openingTransferCount}
          onChange={(e) => setCustomerDraft((c) => ({ ...c, openingTransferCount: e.target.value }))}
          placeholder="عدد حوالات البداية"
        />
        <input
          type="tel"
          inputMode="tel"
          value={customerDraft.phone || ''}
          onChange={(e) => setCustomerDraft((c) => ({ ...c, phone: e.target.value }))}
          placeholder="📱 رقم الواتساب (اختياري)"
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

          const healthLevel = getHealthLevel(c.currentBalance)
          const totalTransferCount = c.transferCount || 0
          const settledCount = c.settledCount || 0
          const settlementPct = totalTransferCount > 0
            ? (settledCount / totalTransferCount) * 100
            : 0
          const cardClasses = [
            'customer-card-v2',
            `health-${healthLevel}`,
            isTransfersOpen || isStatementOpen ? 'is-expanded' : '',
            editingCustomerId === c.id ? 'is-editing' : '',
          ].filter(Boolean).join(' ')

          return (
            <div key={c.id} className={cardClasses} style={getCustomerTheme(c)}>
              <div className="customer-stripe" aria-hidden="true" />

              <div className="customer-header">
                <div className="customer-avatar" aria-hidden="true">
                  {getCustomerMonogram(c.name)}
                </div>

                <div className="customer-identity">
                  <div className="customer-name-line">
                    <h3 className="customer-name">{c.name}</h3>
                    <span className={`health-badge health-badge--${healthLevel}`}>
                      {healthLevel === 'clear' && '✓ ممتاز'}
                      {healthLevel === 'caution' && '◯ متابعة'}
                      {healthLevel === 'warning' && '⚠ تنبيه'}
                      {healthLevel === 'danger' && '⚠ خطر'}
                    </span>
                  </div>
                  <div className="customer-sub">
                    <span className="customer-transfer-count">
                      {totalTransferCount} حوالة
                    </span>
                    {c.openingOutstandingTransferCount > 0 ? (
                      <span className="customer-opening-badge">
                        افتتاحي: {c.openingOutstandingTransferCount}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="customer-balance-block">
                  <div className="customer-balance-row">
                    <span>الرصيد الجاري</span>
                    <strong className={`balance-value balance-${healthLevel}`}>
                      {formatMoney(c.currentBalance)}
                    </strong>
                  </div>
                  <div className="customer-balance-row customer-balance-row--sub">
                    <span>غير مدفوع</span>
                    <strong className="text-orange">{formatMoney(c.unsettledAmount)}</strong>
                  </div>
                </div>

                <div className="customer-progress">
                  <CircularProgress value={settlementPct} size={56} />
                  <span className="customer-progress-label">
                    {settledCount} / {totalTransferCount}
                  </span>
                </div>

                <div className="customer-actions-v2">
                  <button
                    className={`customer-btn ${isTransfersOpen ? 'customer-btn--active' : ''}`}
                    onClick={() => openTransfers(c.id)}
                    title="عرض الحوالات"
                  >
                    <span className="customer-btn-icon">📋</span>
                    <span>حوالات</span>
                  </button>
                  <button
                    className={`customer-btn ${isStatementOpen ? 'customer-btn--active' : ''}`}
                    onClick={() => openStatement(c.id)}
                    title="عرض كشف الحساب"
                  >
                    <span className="customer-btn-icon">📊</span>
                    <span>كشف</span>
                  </button>
                  {(() => {
                    const customerObj = customers.find((cc) => cc.id === c.id)
                    const hasPhone = Boolean(customerObj?.phone && String(customerObj.phone).trim())
                    const handleWhatsApp = () => {
                      if (!customerObj) return
                      if (!hasPhone) {
                        startEdit(c)
                        onFeedback('أضف رقم واتساب الزبون في نموذج التعديل أولاً.')
                        return
                      }
                      const message = buildCustomerWhatsappMessage({
                        customer: customerObj,
                        transfers: transfers.filter((t) => t.customerId === c.id),
                        ledgerEntries: ledgerEntries.filter((e) => e.customerId === c.id),
                      })
                      const url = buildWhatsappUrl(customerObj.phone, message)
                      if (!url) {
                        onFeedback('رقم الواتساب غير صالح. عدّله أولاً.')
                        return
                      }
                      window.open(url, '_blank', 'noopener,noreferrer')
                    }
                    return (
                      <button
                        className={`customer-btn ${hasPhone ? 'customer-btn--whatsapp' : ''}`}
                        onClick={handleWhatsApp}
                        title={hasPhone ? 'إرسال كشف حساب عبر واتساب' : 'أضف رقم واتساب أولاً'}
                      >
                        <span className="customer-btn-icon">📱</span>
                        <span>واتساب</span>
                      </button>
                    )
                  })()}
                  <button
                    className="customer-btn"
                    onClick={() => startEdit(c)}
                    title="تعديل"
                  >
                    <span className="customer-btn-icon">✏</span>
                    <span>تعديل</span>
                  </button>
                  <button
                    className="customer-btn customer-btn--danger"
                    onClick={() => onDeleteCustomer(c.id)}
                    title="حذف"
                  >
                    <span className="customer-btn-icon">🗑</span>
                  </button>
                </div>
              </div>

              <div className="customer-chips">
                {c.receivedCount > 0 ? (
                  <span className="stat-chip stat-chip--neutral">
                    <span className="stat-chip-value">{c.receivedCount}</span>
                    <span className="stat-chip-label">جديدة</span>
                  </span>
                ) : null}
                {c.withEmployeeCount > 0 ? (
                  <span className="stat-chip stat-chip--blue">
                    <span className="stat-chip-value">{c.withEmployeeCount}</span>
                    <span className="stat-chip-label">عند الموظف</span>
                  </span>
                ) : null}
                {c.reviewHoldCount > 0 ? (
                  <span className="stat-chip stat-chip--amber">
                    <span className="stat-chip-value">{c.reviewHoldCount}</span>
                    <span className="stat-chip-label">مراجعة</span>
                  </span>
                ) : null}
                {c.issueCount > 0 ? (
                  <span className="stat-chip stat-chip--red">
                    <span className="stat-chip-value">{c.issueCount}</span>
                    <span className="stat-chip-label">مشاكل</span>
                  </span>
                ) : null}
                {c.pickedUpCount > 0 ? (
                  <span className="stat-chip stat-chip--green">
                    <span className="stat-chip-value">{c.pickedUpCount}</span>
                    <span className="stat-chip-label">تم السحب</span>
                  </span>
                ) : null}
                {totalTransferCount === 0 ? (
                  <span className="stat-chip stat-chip--muted">لا حوالات بعد</span>
                ) : null}
              </div>

              {editingCustomerId === c.id ? (
                <div className="customer-edit-box">
                  <div className="inline-form">
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="اسم الزبون"
                    />
                    <input
                      className="money-input"
                      inputMode="decimal"
                      value={formatEditableNumber(editDraft.openingBalance)}
                      onChange={(e) => setEditDraft((d) => ({ ...d, openingBalance: normalizeNumberInput(e.target.value) }))}
                      placeholder="رصيد افتتاحي"
                    />
                    <input
                      inputMode="numeric"
                      value={editDraft.openingTransferCount}
                      onChange={(e) => setEditDraft((d) => ({ ...d, openingTransferCount: e.target.value }))}
                      placeholder="عدد حوالات البداية"
                    />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={editDraft.phone}
                      onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
                      placeholder="📱 رقم الواتساب (اختياري)"
                    />
                    <button className="action-btn action-btn--green" onClick={() => saveEdit(c.id)}>حفظ</button>
                    <button className="ghost-button" onClick={cancelEdit}>إلغاء</button>
                  </div>
                </div>
              ) : null}

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
                            <th>المستلم</th>
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
                          {customerTransfers.map((t) => {
                            const refKey = String(t.reference || '').trim().toUpperCase()
                            const isDupRef = duplicateReferences && refKey && duplicateReferences.has(refKey)
                            const receiverPreview = lookupReceiverColor(receiverColorMap, t.receiverName)
                            const receiverClass = getReceiverColorClass(receiverPreview.colorLevel)
                            const rowClass = [
                              isDupRef ? 'row-duplicate-ref' : '',
                              t.status === 'issue' ? 'row-issue'
                                : t.settled ? 'row-settled'
                                : t.status === 'picked_up' ? 'row-picked'
                                : '',
                            ].filter(Boolean).join(' ')
                            return (
                            <tr key={t.id} className={rowClass}>
                              <td className="ref-cell">{t.reference}</td>
                              <td>{t.senderName}</td>
                              <td className={receiverClass}>
                                <span
                                  className="receiver-cell-content"
                                  title={receiverPreview.total > 0 ? `قديم ${receiverPreview.legacyCount} + نظام ${receiverPreview.systemCount} = ${receiverPreview.total}` : undefined}
                                >
                                  {receiverPreview.isTurkish ? (
                                    <span title="مستلم تركي" style={{ marginInlineEnd: 4 }}>🇹🇷</span>
                                  ) : null}
                                  {t.receiverName || '-'}
                                </span>
                              </td>
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
                                {t.transferAmount === null ? '-' : formatMoney(t.transferAmount)}
                              </td>
                              <td>
                                <input
                                  className="table-input table-input--sm money-input"
                                  inputMode="decimal"
                                  value={formatEditableNumber(t.customerAmount ?? '')}
                                  onChange={(e) =>
                                    onPatchTransfer(t.id, (r) => updateAmount(r, 'customerAmount', normalizeNumberInput(e.target.value)))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="table-input table-input--sm money-input"
                                  inputMode="decimal"
                                  value={formatEditableNumber(t.systemAmount ?? '')}
                                  onChange={(e) =>
                                    onPatchTransfer(t.id, (r) => updateAmount(r, 'systemAmount', normalizeNumberInput(e.target.value)))
                                  }
                                />
                              </td>
                              <td>{t.margin === null ? '-' : formatMoney(t.margin)}</td>
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
                            )
                          })}
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
                              <td>{entry.amount > 0 ? formatMoney(entry.amount) : '-'}</td>
                              <td>{entry.amount < 0 ? formatMoney(Math.abs(entry.amount)) : '-'}</td>
                              <td className="balance-cell">{formatMoney(entry.runningBalance)}</td>
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
