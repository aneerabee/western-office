import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { issueCatalog, seedCustomers, seedTransfers, statusMeta } from './sampleData'
import {
  FILTER_ALL,
  buildCustomerFromDraft,
  buildTransferFromDraft,
  createEmptyCustomerDraft,
  createEmptyTransferDraft,
  filterTransfers,
  parseAppStateBackup,
  serializeAppState,
  sortTransfers,
  statusOrder,
  summarizeCustomers,
  summarizeTransfers,
  togglePayment,
  transitionTransfer,
  updateAmount,
  updateCustomerField,
  updateTransferField,
} from './lib/transferLogic'

const STORAGE_KEY = 'western-office-state-v2'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function money(value) {
  return currency.format(Number(value || 0))
}

function formatDate(value) {
  if (!value) {
    return '-'
  }

  return new Intl.DateTimeFormat('ar', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function downloadFile({ fileName, content, contentType }) {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function buildCsv(rows, customersById) {
  const header = [
    'reference',
    'customer',
    'sender',
    'status',
    'system_amount',
    'customer_amount',
    'margin',
    'payment_status',
    'note',
  ]

  const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const body = rows.map((item) =>
    [
      item.reference,
      customersById.get(item.customerId)?.name || item.receiverName,
      item.senderName,
      statusMeta[item.status].label,
      item.systemAmount ?? '',
      item.customerAmount ?? '',
      item.margin ?? '',
      item.paymentStatus,
      item.note || '',
    ]
      .map(escapeCell)
      .join(','),
  )

  return `\uFEFF${[header.join(','), ...body].join('\n')}`
}

function App() {
  const importRef = useRef(null)
  const [transferDraft, setTransferDraft] = useState(createEmptyTransferDraft)
  const [customerDraft, setCustomerDraft] = useState(createEmptyCustomerDraft)
  const [feedback, setFeedback] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL)
  const [paymentFilter, setPaymentFilter] = useState(FILTER_ALL)
  const [customerFilter, setCustomerFilter] = useState(FILTER_ALL)
  const [sortMode, setSortMode] = useState('latest')
  const [state, setState] = useState(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      return stored
        ? JSON.parse(stored)
        : { customers: seedCustomers, transfers: seedTransfers }
    } catch {
      return { customers: seedCustomers, transfers: seedTransfers }
    }
  })

  const { customers, transfers } = state

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const customersById = useMemo(
    () => new Map(customers.map((item) => [item.id, item])),
    [customers],
  )

  const filteredTransfers = useMemo(() => {
    const filtered = filterTransfers(
      transfers,
      { searchTerm, statusFilter, paymentFilter, customerFilter },
      customersById,
    )
    return sortTransfers(filtered, sortMode, customersById)
  }, [
    customerFilter,
    customersById,
    paymentFilter,
    searchTerm,
    sortMode,
    statusFilter,
    transfers,
  ])

  const transferSummary = useMemo(
    () => summarizeTransfers(filteredTransfers),
    [filteredTransfers],
  )
  const customerSummary = useMemo(
    () => summarizeCustomers(customers, transfers),
    [customers, transfers],
  )

  function patchTransfer(id, updater) {
    setState((current) => ({
      ...current,
      transfers: current.transfers.map((item) => (item.id === id ? updater(item) : item)),
    }))
  }

  function patchCustomer(id, updater) {
    setState((current) => ({
      ...current,
      customers: current.customers.map((item) => (item.id === id ? updater(item) : item)),
    }))
  }

  function handleAddCustomer(event) {
    event.preventDefault()
    const result = buildCustomerFromDraft(customerDraft, customers)

    if (!result.ok) {
      setFeedback(result.error)
      return
    }

    setState((current) => ({
      ...current,
      customers: [...current.customers, result.value],
    }))
    setCustomerDraft(createEmptyCustomerDraft())
    setFeedback('تمت إضافة الزبون.')
  }

  function handleAddTransfer(event) {
    event.preventDefault()
    const result = buildTransferFromDraft(transferDraft, transfers, customers)

    if (!result.ok) {
      setFeedback(result.error)
      return
    }

    setState((current) => ({
      ...current,
      transfers: [result.value, ...current.transfers],
    }))
    setTransferDraft(createEmptyTransferDraft())
    setFeedback('تمت إضافة الحوالة.')
  }

  function resetFilters() {
    setSearchTerm('')
    setStatusFilter(FILTER_ALL)
    setPaymentFilter(FILTER_ALL)
    setCustomerFilter(FILTER_ALL)
    setSortMode('latest')
  }

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-${today}.csv`,
      content: buildCsv(filteredTransfers, customersById),
      contentType: 'text/csv;charset=utf-8;',
    })
  }

  function exportBackup() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-backup-${today}.json`,
      content: serializeAppState(state),
      contentType: 'application/json;charset=utf-8;',
    })
  }

  async function handleImportBackup(event) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const restored = parseAppStateBackup(text)
      setState(restored)
      setFeedback('تم استرجاع النسخة الاحتياطية.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'تعذر قراءة النسخة الاحتياطية.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="app-shell" dir="rtl">
      <header className="topbar">
        <div>
          <h1>Western Office</h1>
          <p className="path-line">
            المسار: <code>/Users/rabeeshaban/Documents/New project/western-office</code>
          </p>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={exportCsv}>
            CSV
          </button>
          <button className="ghost-button" onClick={exportBackup}>
            Backup
          </button>
          <button className="ghost-button" onClick={() => importRef.current?.click()}>
            Restore
          </button>
          <input
            ref={importRef}
            className="hidden-input"
            type="file"
            accept="application/json"
            onChange={handleImportBackup}
          />
        </div>
      </header>

      {feedback ? <div className="feedback-banner">{feedback}</div> : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span>الحوالات</span>
          <strong>{filteredTransfers.length}</strong>
        </article>
        <article className="stat-card">
          <span>مشاكل</span>
          <strong>{transferSummary.issueCount}</strong>
        </article>
        <article className="stat-card">
          <span>جاهز للمحاسب</span>
          <strong>{transferSummary.readyForAccountant.length}</strong>
        </article>
        <article className="stat-card">
          <span>مدفوعة</span>
          <strong>{transferSummary.paidCount}</strong>
        </article>
      </section>

      <section className="workspace-grid">
        <section className="panel">
          <div className="panel-head compact">
            <h2>الزبائن</h2>
          </div>

          <form className="inline-form" onSubmit={handleAddCustomer}>
            <input
              value={customerDraft.name}
              onChange={(event) =>
                setCustomerDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="اسم الزبون"
            />
            <input
              inputMode="decimal"
              value={customerDraft.openingBalance}
              onChange={(event) =>
                setCustomerDraft((current) => ({
                  ...current,
                  openingBalance: event.target.value,
                }))
              }
              placeholder="رصيد بداية"
            />
            <input
              inputMode="decimal"
              value={customerDraft.settledTotal}
              onChange={(event) =>
                setCustomerDraft((current) => ({
                  ...current,
                  settledTotal: event.target.value,
                }))
              }
              placeholder="تسليمات"
            />
            <button type="submit">إضافة زبون</button>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الزبون</th>
                  <th>رصيد بداية</th>
                  <th>منفذ</th>
                  <th>قيد التنفيذ</th>
                  <th>تسليمات</th>
                  <th>الرصيد الحالي</th>
                </tr>
              </thead>
              <tbody>
                {customerSummary.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.name}</td>
                    <td>
                      <input
                        className="table-input"
                        inputMode="decimal"
                        value={customer.openingBalance}
                        onChange={(event) =>
                          patchCustomer(customer.id, (item) =>
                            updateCustomerField(item, 'openingBalance', event.target.value),
                          )
                        }
                      />
                    </td>
                    <td>{money(customer.deliveredTotal)}</td>
                    <td>{money(customer.pendingTotal)}</td>
                    <td>
                      <input
                        className="table-input"
                        inputMode="decimal"
                        value={customer.settledTotal}
                        onChange={(event) =>
                          patchCustomer(customer.id, (item) =>
                            updateCustomerField(item, 'settledTotal', event.target.value),
                          )
                        }
                      />
                    </td>
                    <td>{money(customer.currentBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head compact">
            <h2>إضافة حوالة</h2>
          </div>

          <form className="inline-form" onSubmit={handleAddTransfer}>
            <select
              value={transferDraft.customerId}
              onChange={(event) =>
                setTransferDraft((current) => ({
                  ...current,
                  customerId: event.target.value,
                }))
              }
            >
              <option value="">اختر الزبون</option>
              {customers
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
                .map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
            </select>
            <input
              value={transferDraft.senderName}
              onChange={(event) =>
                setTransferDraft((current) => ({ ...current, senderName: event.target.value }))
              }
              placeholder="اسم المرسل"
            />
            <input
              value={transferDraft.reference}
              onChange={(event) =>
                setTransferDraft((current) => ({ ...current, reference: event.target.value }))
              }
              placeholder="رقم الحوالة"
            />
            <button type="submit">إضافة حوالة</button>
          </form>

          <div className="toolbar">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="بحث"
            />
            <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}>
              <option value={FILTER_ALL}>كل الزبائن</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value={FILTER_ALL}>كل الحالات</option>
              {statusOrder.map((statusKey) => (
                <option key={statusKey} value={statusKey}>
                  {statusMeta[statusKey].label}
                </option>
              ))}
            </select>
            <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              <option value={FILTER_ALL}>كل الدفع</option>
              <option value="pending">بانتظار</option>
              <option value="paid">تم الدفع</option>
            </select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="latest">الأحدث</option>
              <option value="oldest">الأقدم</option>
              <option value="customer">الزبون</option>
              <option value="sender">المرسل</option>
            </select>
            <button className="ghost-button ghost-button--muted" onClick={resetFilters}>
              تصفير
            </button>
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>الحوالات</h2>
          <div className="totals-line">
            <span>{money(transferSummary.totalSystem)}</span>
            <span>{money(transferSummary.totalCustomer)}</span>
            <span>{money(transferSummary.totalMargin)}</span>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الزبون</th>
                <th>المرسل</th>
                <th>وقت</th>
                <th>الحالة</th>
                <th>المشكلة</th>
                <th>السيستم</th>
                <th>للزبون</th>
                <th>الفرق</th>
                <th>ملاحظة</th>
                <th>الدفع</th>
                <th>حذف</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan="12" className="empty-table">
                    لا توجد نتائج
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((item) => (
                  <tr key={item.id}>
                    <td>{item.reference}</td>
                    <td>{customersById.get(item.customerId)?.name || item.receiverName}</td>
                    <td>{item.senderName}</td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>
                      <select
                        className="table-select"
                        value={item.status}
                        onChange={(event) => patchTransfer(item.id, (row) => transitionTransfer(row, event.target.value))}
                      >
                        {statusOrder.map((statusKey) => (
                          <option key={statusKey} value={statusKey}>
                            {statusMeta[statusKey].label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="table-select"
                        value={item.issueCode || ''}
                        disabled={item.status !== 'issue'}
                        onChange={(event) =>
                          patchTransfer(item.id, (row) =>
                            updateTransferField(row, 'issueCode', event.target.value),
                          )
                        }
                      >
                        <option value="">-</option>
                        {issueCatalog.map((issue) => (
                          <option key={issue.code} value={issue.code}>
                            {issue.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="table-input"
                        inputMode="decimal"
                        value={item.systemAmount ?? ''}
                        onChange={(event) =>
                          patchTransfer(item.id, (row) =>
                            updateAmount(row, 'systemAmount', event.target.value),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="table-input"
                        inputMode="decimal"
                        value={item.customerAmount ?? ''}
                        onChange={(event) =>
                          patchTransfer(item.id, (row) =>
                            updateAmount(row, 'customerAmount', event.target.value),
                          )
                        }
                      />
                    </td>
                    <td>{item.margin === null ? '-' : money(item.margin)}</td>
                    <td>
                      <input
                        className="table-input"
                        value={item.note || ''}
                        onChange={(event) =>
                          patchTransfer(item.id, (row) =>
                            updateTransferField(row, 'note', event.target.value),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button className="ghost-button" onClick={() => patchTransfer(item.id, togglePayment)}>
                        {item.paymentStatus === 'paid' ? 'تم' : 'انتظار'}
                      </button>
                    </td>
                    <td>
                      <button
                        className="danger-button"
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            transfers: current.transfers.filter((row) => row.id !== item.id),
                          }))
                        }
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default App
