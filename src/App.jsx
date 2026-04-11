import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { issueCatalog, operationalRules, seedTransfers, statusMeta } from './sampleData'
import {
  FILTER_ALL,
  buildTransferFromDraft,
  createEmptyDraft,
  filterTransfers,
  parseTransfersBackup,
  serializeTransfers,
  sortTransfers,
  statusOrder,
  summarizeTransfers,
  togglePayment,
  transitionTransfer,
  updateAmount,
  updateTransferField,
} from './lib/transferLogic'

const STORAGE_KEY = 'western-office-transfers'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function money(value) {
  if (value === null || value === undefined) {
    return 'غير محدد'
  }

  return currency.format(value)
}

function formatDate(value) {
  if (!value) {
    return 'غير محدد'
  }

  return new Intl.DateTimeFormat('ar', {
    year: 'numeric',
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

function buildCsv(rows) {
  const header = [
    'reference',
    'sender_name',
    'receiver_name',
    'status',
    'issue_code',
    'system_amount',
    'customer_amount',
    'margin',
    'payment_status',
    'note',
    'created_at',
  ]

  const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const body = rows.map((item) =>
    [
      item.reference,
      item.senderName,
      item.receiverName,
      statusMeta[item.status].label,
      item.issueCode || '',
      item.systemAmount ?? '',
      item.customerAmount ?? '',
      item.margin ?? '',
      item.paymentStatus,
      item.note || '',
      item.createdAt ?? '',
    ]
      .map(escapeCell)
      .join(','),
  )

  return `\uFEFF${[header.join(','), ...body].join('\n')}`
}

function App() {
  const importRef = useRef(null)
  const [draft, setDraft] = useState(createEmptyDraft)
  const [feedback, setFeedback] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL)
  const [paymentFilter, setPaymentFilter] = useState(FILTER_ALL)
  const [sortMode, setSortMode] = useState('latest')
  const [transfers, setTransfers] = useState(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : seedTransfers
    } catch {
      return seedTransfers
    }
  })

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers))
  }, [transfers])

  const filteredTransfers = useMemo(() => {
    const filtered = filterTransfers(transfers, { searchTerm, statusFilter, paymentFilter })
    return sortTransfers(filtered, sortMode)
  }, [paymentFilter, searchTerm, sortMode, statusFilter, transfers])

  const { totalSystem, totalCustomer, totalMargin, issueCount, readyForAccountant, paidToday } =
    useMemo(() => summarizeTransfers(filteredTransfers), [filteredTransfers])

  const groupedTransfers = useMemo(
    () =>
      statusOrder
        .map((statusKey) => ({
          key: statusKey,
          meta: statusMeta[statusKey],
          items: filteredTransfers.filter((item) => item.status === statusKey),
        }))
        .filter((group) => group.items.length > 0),
    [filteredTransfers],
  )

  function handleDraftChange(event) {
    const { name, value } = event.target
    setDraft((current) => ({ ...current, [name]: value }))
  }

  function handleAddTransfer(event) {
    event.preventDefault()
    const result = buildTransferFromDraft(draft, transfers)

    if (!result.ok) {
      setFeedback(result.error)
      return
    }

    setTransfers((current) => [result.value, ...current])
    setDraft(createEmptyDraft())
    setFeedback('تمت إضافة الحوالة بنجاح.')
  }

  function patchTransfer(id, updater) {
    setTransfers((current) =>
      current.map((item) => (item.id === id ? updater(item) : item)),
    )
  }

  function handleStatusChange(id, nextStatus) {
    patchTransfer(id, (item) => transitionTransfer(item, nextStatus))
  }

  function handleAmountChange(id, field, value) {
    patchTransfer(id, (item) => updateAmount(item, field, value))
  }

  function handleTextFieldChange(id, field, value) {
    patchTransfer(id, (item) => updateTransferField(item, field, value))
  }

  function handleIssueCodeChange(id, value) {
    patchTransfer(id, (item) => updateTransferField(item, 'issueCode', value))
  }

  function handleTogglePaid(id) {
    patchTransfer(id, (item) => togglePayment(item))
  }

  function removeTransfer(id) {
    setTransfers((current) => current.filter((item) => item.id !== id))
  }

  function resetFilters() {
    setSearchTerm('')
    setStatusFilter(FILTER_ALL)
    setPaymentFilter(FILTER_ALL)
    setSortMode('latest')
  }

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-${today}.csv`,
      content: buildCsv(filteredTransfers),
      contentType: 'text/csv;charset=utf-8;',
    })
  }

  function exportBackup() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-backup-${today}.json`,
      content: serializeTransfers(transfers),
      contentType: 'application/json;charset=utf-8;',
    })
  }

  async function handleImportBackup(event) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const restored = parseTransfersBackup(text)
      setTransfers(sortTransfers(restored, 'latest'))
      setFeedback('تم استرجاع النسخة الاحتياطية بنجاح.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'تعذر قراءة النسخة الاحتياطية.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="app-shell" dir="rtl">
      <header className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Single Operator Mode</span>
          <h1>نظامك الشخصي لتنظيم حوالات ويسترن</h1>
          <p className="hero-text">
            النظام الآن مبني لصاحب المكتب نفسه: إدخال خفيف، تعديل مباشر، حماية من تكرار
            رقم الحوالة، ونسخة احتياطية حتى لا تضيع بياناتك.
          </p>
          {feedback ? <p className="feedback-banner">{feedback}</p> : null}
        </div>

        <form className="quick-entry" onSubmit={handleAddTransfer}>
          <div className="quick-entry__header">
            <span className="panel-kicker">Quick Add</span>
            <h2>إضافة حوالة بسرعة</h2>
          </div>

          <label>
            <span>اسم المرسل</span>
            <input
              name="senderName"
              value={draft.senderName}
              onChange={handleDraftChange}
              placeholder="مثال: خالد الدوكالي"
            />
          </label>

          <label>
            <span>اسم المستلم</span>
            <input
              name="receiverName"
              value={draft.receiverName}
              onChange={handleDraftChange}
              placeholder="مثال: محمد الورفلي"
            />
          </label>

          <label>
            <span>رقم الحوالة</span>
            <input
              name="reference"
              value={draft.reference}
              onChange={handleDraftChange}
              placeholder="مثال: WU-843210"
            />
          </label>

          <button type="submit">إضافة مباشرة</button>
        </form>
      </header>

      <main className="main-grid">
        <section className="panel summary-panel">
          <div className="closing-grid">
            <article className="closing-card">
              <span>الحوالات الظاهرة</span>
              <strong>{filteredTransfers.length}</strong>
            </article>
            <article className="closing-card">
              <span>فيها مشاكل</span>
              <strong>{issueCount}</strong>
            </article>
            <article className="closing-card">
              <span>جاهزة للمحاسب</span>
              <strong>{readyForAccountant.length}</strong>
            </article>
            <article className="closing-card">
              <span>تم دفعها</span>
              <strong>{paidToday.length}</strong>
            </article>
          </div>
        </section>

        <section className="panel overview-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Daily Flow</span>
              <h2>المسار التشغيلي</h2>
            </div>
            <p>الشاشة كلها مصممة لتخدم العمل الحقيقي اليومي، لا لتجبرك على نماذج كثيرة.</p>
          </div>

          <div className="flow-steps">
            {operationalRules.map((rule) => (
              <article className="flow-card" key={rule.title}>
                <strong>{rule.title}</strong>
                <p>{rule.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel pipeline-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Pipeline</span>
              <h2>توزيع الحوالات حسب الحالة</h2>
            </div>
            <p>أي معاملة لا يجب أن تبقى داخل واتساب فقط. مكانها هنا حتى لا تضيع.</p>
          </div>

          <div className="pipeline-lanes">
            {groupedTransfers.map((group) => (
              <section className="lane" key={group.key}>
                <header>
                  <div className="lane-title">
                    <span
                      className="status-dot"
                      style={{ '--status-color': group.meta.color }}
                    />
                    <h3>{group.meta.label}</h3>
                  </div>
                  <strong>{group.items.length}</strong>
                </header>

                <div className="lane-list">
                  {group.items.map((item) => (
                    <article className="transfer-card" key={item.id}>
                      <div className="transfer-topline">
                        <strong>{item.receiverName}</strong>
                        <span>{item.reference}</span>
                      </div>
                      <p>المرسل: {item.senderName}</p>
                      <dl>
                        <div>
                          <dt>السيستم</dt>
                          <dd>{money(item.systemAmount)}</dd>
                        </div>
                        <div>
                          <dt>للزبون</dt>
                          <dd>{money(item.customerAmount)}</dd>
                        </div>
                        <div>
                          <dt>الفرق</dt>
                          <dd>{money(item.margin)}</dd>
                        </div>
                      </dl>
                      <small>{item.note || 'لا توجد ملاحظة.'}</small>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Control Table</span>
              <h2>لوحة التحكم الرئيسية</h2>
            </div>
            <p>من هنا تدير كل شيء: الفرز، البحث، الحالات، القيم، الملاحظات، والنسخ الاحتياطي.</p>
          </div>

          <div className="toolbar">
            <label className="toolbar-field toolbar-field--search">
              <span>بحث سريع</span>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="ابحث باسم أو رقم حوالة أو ملاحظة"
              />
            </label>

            <label className="toolbar-field">
              <span>الحالة</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value={FILTER_ALL}>كل الحالات</option>
                {statusOrder.map((statusKey) => (
                  <option key={statusKey} value={statusKey}>
                    {statusMeta[statusKey].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="toolbar-field">
              <span>الدفع</span>
              <select
                value={paymentFilter}
                onChange={(event) => setPaymentFilter(event.target.value)}
              >
                <option value={FILTER_ALL}>كلها</option>
                <option value="pending">بانتظار</option>
                <option value="paid">تم الدفع</option>
              </select>
            </label>

            <label className="toolbar-field">
              <span>الترتيب</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
                <option value="latest">الأحدث أولًا</option>
                <option value="oldest">الأقدم أولًا</option>
                <option value="receiver">حسب المستلم</option>
                <option value="sender">حسب المرسل</option>
              </select>
            </label>

            <div className="toolbar-actions">
              <button className="ghost-button" onClick={exportCsv}>
                تصدير CSV
              </button>
              <button className="ghost-button" onClick={exportBackup}>
                نسخة احتياطية
              </button>
              <button className="ghost-button" onClick={() => importRef.current?.click()}>
                استرجاع
              </button>
              <button className="ghost-button ghost-button--muted" onClick={resetFilters}>
                تصفير الفلاتر
              </button>
              <input
                ref={importRef}
                className="hidden-input"
                type="file"
                accept="application/json"
                onChange={handleImportBackup}
              />
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم الحوالة</th>
                  <th>المرسل</th>
                  <th>المستلم</th>
                  <th>أضيفت</th>
                  <th>الحالة</th>
                  <th>سبب المشكلة</th>
                  <th>قيمة السيستم</th>
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
                      لا توجد نتائج مطابقة للفلاتر الحالية.
                    </td>
                  </tr>
                ) : (
                  filteredTransfers.map((item) => (
                    <tr key={item.id}>
                      <td>{item.reference}</td>
                      <td>{item.senderName}</td>
                      <td>{item.receiverName}</td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>
                        <select
                          className="table-select"
                          value={item.status}
                          onChange={(event) => handleStatusChange(item.id, event.target.value)}
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
                          onChange={(event) => handleIssueCodeChange(item.id, event.target.value)}
                        >
                          <option value="">لا يوجد</option>
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
                            handleAmountChange(item.id, 'systemAmount', event.target.value)
                          }
                          placeholder="اختياري"
                        />
                      </td>
                      <td>
                        <input
                          className="table-input"
                          inputMode="decimal"
                          value={item.customerAmount ?? ''}
                          onChange={(event) =>
                            handleAmountChange(item.id, 'customerAmount', event.target.value)
                          }
                          placeholder="اختياري"
                        />
                      </td>
                      <td>{money(item.margin)}</td>
                      <td>
                        <textarea
                          className="table-note"
                          value={item.note || ''}
                          onChange={(event) =>
                            handleTextFieldChange(item.id, 'note', event.target.value)
                          }
                          placeholder="اكتب ملاحظة سريعة"
                          rows="2"
                        />
                      </td>
                      <td>
                        <button className="ghost-button" onClick={() => handleTogglePaid(item.id)}>
                          {item.paymentStatus === 'paid' ? 'تم الدفع' : 'بانتظار'}
                        </button>
                      </td>
                      <td>
                        <button className="danger-button" onClick={() => removeTransfer(item.id)}>
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="6">الإجماليات حسب النتائج الظاهرة</td>
                  <td>{money(totalSystem)}</td>
                  <td>{money(totalCustomer)}</td>
                  <td>{money(totalMargin)}</td>
                  <td colSpan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="panel split-panel">
          <div className="subpanel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Accounting</span>
                <h2>جاهز للمحاسب</h2>
              </div>
              <p>هذه الحوالات جاهزة للانتقال من المتابعة إلى التنفيذ المالي.</p>
            </div>

            <div className="action-list">
              {readyForAccountant.length === 0 ? (
                <article className="action-row empty-state">
                  <div>
                    <strong>لا توجد حوالات جاهزة الآن</strong>
                    <p>عندما تؤكد الحوالة للزبون ستظهر هنا تلقائيًا.</p>
                  </div>
                </article>
              ) : (
                readyForAccountant.map((item) => (
                  <article className="action-row" key={item.id}>
                    <div>
                      <strong>{item.receiverName}</strong>
                      <p>{item.reference}</p>
                    </div>
                    <div>
                      <strong>{money(item.customerAmount)}</strong>
                      <p>{statusMeta[item.status].label}</p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="subpanel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Issues</span>
                <h2>أنواع المشاكل</h2>
              </div>
              <p>الأسباب ثابتة حتى تعرف أين يتعطل العمل بدل ملاحظات مبعثرة.</p>
            </div>

            <div className="issue-list">
              {issueCatalog.map((issue) => (
                <article className="issue-card" key={issue.code}>
                  <strong>{issue.label}</strong>
                  <p>{issue.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
