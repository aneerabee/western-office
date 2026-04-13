import { useMemo, useState } from 'react'
import { statusMeta } from '../sampleData'
import { computeDailyClosing, getAvailableDates, getTodayKey, resolveClosingView } from '../lib/dailyClosing'
import { formatMoney } from '../lib/formatting'
import { getReceiverColorClass, lookupReceiverColor } from '../lib/people'
import CustomerBadge from './CustomerBadge'

function formatTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ar', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
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

function formatArabicDate(dateStr) {
  if (!dateStr) return '-'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${dateStr}T12:00:00`))
}

function ReceiverCell({ name, receiverColorMap }) {
  const preview = lookupReceiverColor(receiverColorMap, name)
  const colorClass = getReceiverColorClass(preview.colorLevel)
  return (
    <td className={colorClass}>
      <span
        className="receiver-cell-content"
        title={preview.total > 0 ? `قديم ${preview.legacyCount} + نظام ${preview.systemCount} = ${preview.total}` : undefined}
      >
        {name || '-'}
      </span>
    </td>
  )
}

function isDuplicateRef(duplicateReferences, reference) {
  if (!duplicateReferences) return false
  const key = String(reference || '').trim().toUpperCase()
  return Boolean(key && duplicateReferences.has(key))
}

function withDupClass(baseClass, isDup) {
  return [baseClass, isDup ? 'row-duplicate-ref' : ''].filter(Boolean).join(' ')
}

function CollapsibleSection({ title, count, initiallyOpen = false, children }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className={`closing-collapsible ${open ? 'closing-collapsible--open' : ''}`}>
      <button
        type="button"
        className="closing-collapsible-head"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="closing-collapsible-arrow">{open ? '▼' : '◀'}</span>
        <span className="closing-collapsible-title">{title}</span>
        <span className="closing-collapsible-count">{count}</span>
      </button>
      {open ? <div className="closing-collapsible-body">{children}</div> : null}
    </div>
  )
}

export default function DailyClosingTab({
  transfers,
  customerSummary,
  officeSummary,
  claimHistory,
  dailyClosings,
  customersById,
  onClaimProfit,
  onSaveClosing,
  receiverColorMap,
  duplicateReferences,
}) {
  const [selectedDate, setSelectedDate] = useState(getTodayKey)
  const [preferSavedSnapshot, setPreferSavedSnapshot] = useState(false)
  const [activeView, setActiveView] = useState('activity') // activity | overview | history
  const isToday = selectedDate === getTodayKey()
  const canSaveClosing = selectedDate <= getTodayKey()
  const availableDates = useMemo(
    () => getAvailableDates(transfers, claimHistory, dailyClosings),
    [claimHistory, dailyClosings, transfers],
  )

  const liveClosing = useMemo(
    () => computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, selectedDate),
    [claimHistory, customerSummary, officeSummary, selectedDate, transfers],
  )
  const savedClosing = useMemo(
    () => (dailyClosings || []).find((item) => item.date === selectedDate) || null,
    [dailyClosings, selectedDate],
  )
  const closing = resolveClosingView(liveClosing, savedClosing, preferSavedSnapshot)
  const usingSavedSnapshot = Boolean(preferSavedSnapshot && savedClosing?.snapshot)

  const daily = closing.officeDaily

  return (
    <section className="panel closing-panel">
      {/* ── 1) Compact header ── */}
      <div className="closing-header">
        <div className="closing-header-row">
          <h2>الإقفال اليومي</h2>
          <select
            className="closing-date-select"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value)
              setPreferSavedSnapshot(false)
            }}
          >
            {availableDates.length === 0 ? (
              <option value={selectedDate}>{selectedDate}</option>
            ) : (
              availableDates.map((date) => (
                <option key={date} value={date}>{date}</option>
              ))
            )}
          </select>
          <span className="closing-date-label">{formatArabicDate(selectedDate)}</span>
          <div className="closing-header-spacer" />
          <button
            className="action-btn action-btn--green"
            disabled={!canSaveClosing}
            onClick={() => onSaveClosing(selectedDate)}
            title={canSaveClosing ? 'حفظ سجل الإقفال لهذا اليوم' : 'لا يمكن حفظ يوم مستقبلي'}
          >
            حفظ اليوم
          </button>
        </div>

        <div className="closing-kpi-strip">
          <div className="closing-kpi">
            <span>دخلت</span>
            <strong>{daily.createdCount}</strong>
          </div>
          <div className="closing-kpi">
            <span>سُحبت</span>
            <strong className="text-green">{daily.pickedUpCount}</strong>
          </div>
          <div className="closing-kpi">
            <span>تسويات</span>
            <strong>{daily.settledCount}</strong>
          </div>
          <div className="closing-kpi closing-kpi--accent">
            <span>عند المحاسب</span>
            <strong className="text-blue">{formatMoney(closing.accountantSnapshot.cashOnHand)}</strong>
          </div>
          <div className="closing-kpi closing-kpi--accent">
            <span>الربح المتحقق</span>
            <strong className="text-green">{formatMoney(daily.officeProfitRealizedToday)}</strong>
          </div>
        </div>

        <div className="closing-context-note">
          {usingSavedSnapshot
            ? `📌 يعرض السجل المحفوظ لهذا اليوم — آخر حفظ ${formatDate(savedClosing.savedAt)}`
            : savedClosing
              ? `💾 يوجد سجل محفوظ لهذا اليوم (${formatDate(savedClosing.savedAt)})، المعروض الآن هو الحساب اللحظي`
              : isToday
                ? 'يُحفظ الإقفال تلقائياً لليوم السابق عند فتح النظام في اليوم الجديد'
                : 'لا يوجد سجل محفوظ لهذا اليوم — المعروض إعادة حساب من البيانات الحالية'}
        </div>
      </div>

      {/* ── 2) Sub-tabs ── */}
      <div className="closing-sub-tabs">
        <button
          type="button"
          className={`closing-sub-tab ${activeView === 'activity' ? 'closing-sub-tab--active' : ''}`}
          onClick={() => setActiveView('activity')}
        >
          حركة اليوم
        </button>
        <button
          type="button"
          className={`closing-sub-tab ${activeView === 'overview' ? 'closing-sub-tab--active' : ''}`}
          onClick={() => setActiveView('overview')}
        >
          الصورة العامة
        </button>
        <button
          type="button"
          className={`closing-sub-tab ${activeView === 'history' ? 'closing-sub-tab--active' : ''}`}
          onClick={() => setActiveView('history')}
        >
          السجل المحفوظ
          {(dailyClosings || []).length > 0 ? (
            <span className="closing-sub-tab-count">{dailyClosings.length}</span>
          ) : null}
        </button>
      </div>

      {/* ── 3a) ACTIVITY VIEW ── */}
      {activeView === 'activity' ? (
        <div className="closing-view">
          <div className="closing-quick-stats">
            <div className="closing-quick-stat"><span>دخلت</span><strong>{daily.createdCount}</strong></div>
            <div className="closing-quick-stat"><span>أُرسلت</span><strong className="text-blue">{daily.sentCount}</strong></div>
            <div className="closing-quick-stat"><span>سحبت</span><strong className="text-green">{daily.pickedUpCount}</strong></div>
            <div className="closing-quick-stat"><span>مراجعة</span><strong className="text-orange">{daily.reviewHoldCount}</strong></div>
            <div className="closing-quick-stat"><span>مشاكل</span><strong className="text-red">{daily.issueCount}</strong></div>
            <div className="closing-quick-stat"><span>تسويات</span><strong>{daily.settledCount}</strong></div>
            <div className="closing-quick-stat"><span>من الموظف</span><strong>{formatMoney(daily.officeSystemReceivedToday)}</strong></div>
            <div className="closing-quick-stat"><span>للزبائن</span><strong>{formatMoney(daily.officeCustomerPaidToday)}</strong></div>
          </div>

          {daily.createdToday.length > 0 ? (
            <CollapsibleSection title="دخلت اليوم" count={daily.createdToday.length}>
              <div className="table-wrap">
                <table className="compact-closing-table">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>الزبون</th>
                      <th>المرسل</th>
                      <th>المستلم</th>
                      <th>الوقت</th>
                      <th>الحالة</th>
                      <th>الحوالة</th>
                      <th>للزبون</th>
                      <th>الربح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.createdToday.map(({ transfer: t, activityAtByType }) => (
                      <tr key={t.id} className={withDupClass(t.status === 'issue' ? 'row-issue' : t.status === 'picked_up' ? 'row-picked' : '', isDuplicateRef(duplicateReferences, t.reference))}>
                        <td className="ref-cell">{t.reference}</td>
                        <td>
                          <CustomerBadge customer={(customersById || new Map()).get(t.customerId)} fallbackName={t.receiverName} compact />
                        </td>
                        <td>{t.senderName}</td>
                        <ReceiverCell name={t.receiverName} receiverColorMap={receiverColorMap} />
                        <td className="date-cell">{formatTime(activityAtByType.created || t.createdAt)}</td>
                        <td>
                          <span className="status-badge" style={{ '--badge-color': statusMeta[t.status]?.color }}>
                            <span className="status-dot" />
                            {statusMeta[t.status]?.label}
                          </span>
                        </td>
                        <td className="amount-info">{t.transferAmount === null ? '-' : formatMoney(t.transferAmount)}</td>
                        <td>{t.customerAmount === null ? '-' : formatMoney(t.customerAmount)}</td>
                        <td className="text-green">{t.margin === null ? '-' : formatMoney(t.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          ) : null}

          {daily.sentToday.length > 0 ? (
            <CollapsibleSection title="أُرسلت للموظف اليوم" count={daily.sentToday.length}>
              <div className="table-wrap">
                <table className="compact-closing-table">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>الزبون</th>
                      <th>المرسل</th>
                      <th>المستلم</th>
                      <th>الوقت</th>
                      <th>الحوالة</th>
                      <th>للزبون</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.sentToday.map(({ transfer: t, activityAtByType }) => (
                      <tr key={t.id} className={withDupClass('', isDuplicateRef(duplicateReferences, t.reference))}>
                        <td className="ref-cell">{t.reference}</td>
                        <td>
                          <CustomerBadge customer={(customersById || new Map()).get(t.customerId)} fallbackName={t.receiverName} compact />
                        </td>
                        <td>{t.senderName}</td>
                        <ReceiverCell name={t.receiverName} receiverColorMap={receiverColorMap} />
                        <td className="date-cell">{formatTime(activityAtByType.sent || t.sentAt)}</td>
                        <td className="amount-info">{t.transferAmount === null ? '-' : formatMoney(t.transferAmount)}</td>
                        <td>{t.customerAmount === null ? '-' : formatMoney(t.customerAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          ) : null}

          {daily.pickedUpToday.length > 0 ? (
            <CollapsibleSection title="تم سحبها اليوم" count={daily.pickedUpToday.length}>
              <div className="table-wrap">
                <table className="compact-closing-table">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>الزبون</th>
                      <th>المرسل</th>
                      <th>المستلم</th>
                      <th>الوقت</th>
                      <th>من الموظف</th>
                      <th>للزبون</th>
                      <th>الربح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.pickedUpToday.map(({ transfer: t, activityAtByType }) => (
                      <tr key={t.id} className={withDupClass('row-picked', isDuplicateRef(duplicateReferences, t.reference))}>
                        <td className="ref-cell">{t.reference}</td>
                        <td>
                          <CustomerBadge customer={(customersById || new Map()).get(t.customerId)} fallbackName={t.receiverName} compact />
                        </td>
                        <td>{t.senderName}</td>
                        <ReceiverCell name={t.receiverName} receiverColorMap={receiverColorMap} />
                        <td className="date-cell">{formatTime(activityAtByType.picked_up || t.pickedUpAt)}</td>
                        <td>{formatMoney(t.systemAmount)}</td>
                        <td>{formatMoney(t.customerAmount)}</td>
                        <td className="text-green">{formatMoney(t.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          ) : null}

          {daily.settledToday.length > 0 ? (
            <CollapsibleSection title="تسويات اليوم" count={daily.settledToday.length}>
              <div className="table-wrap">
                <table className="compact-closing-table">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>الزبون</th>
                      <th>المستلم</th>
                      <th>الوقت</th>
                      <th>من الموظف</th>
                      <th>للزبون</th>
                      <th>الربح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.settledToday.map(({ transfer: t, activityAtByType }) => (
                      <tr key={t.id} className={withDupClass('row-settled', isDuplicateRef(duplicateReferences, t.reference))}>
                        <td className="ref-cell">{t.reference}</td>
                        <td>
                          <CustomerBadge customer={(customersById || new Map()).get(t.customerId)} fallbackName={t.receiverName} compact />
                        </td>
                        <ReceiverCell name={t.receiverName} receiverColorMap={receiverColorMap} />
                        <td className="date-cell">{formatTime(activityAtByType.settled || t.settledAt)}</td>
                        <td>{formatMoney(t.systemAmount)}</td>
                        <td>{formatMoney(t.customerAmount)}</td>
                        <td className="text-green">{formatMoney(t.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          ) : null}

          {daily.issueToday.length > 0 ? (
            <CollapsibleSection title="مشاكل اليوم" count={daily.issueToday.length}>
              <div className="table-wrap">
                <table className="compact-closing-table">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>الزبون</th>
                      <th>المرسل</th>
                      <th>المستلم</th>
                      <th>نوع المشكلة</th>
                      <th>ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.issueToday.map(({ transfer: t, issueCodeAt, noteAt }) => (
                      <tr key={t.id} className={withDupClass('row-issue', isDuplicateRef(duplicateReferences, t.reference))}>
                        <td className="ref-cell">{t.reference}</td>
                        <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                        <td>{t.senderName}</td>
                        <ReceiverCell name={t.receiverName} receiverColorMap={receiverColorMap} />
                        <td>{issueCodeAt || '-'}</td>
                        <td>{noteAt || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          ) : null}

          {daily.createdToday.length === 0
            && daily.sentToday.length === 0
            && daily.pickedUpToday.length === 0
            && daily.settledToday.length === 0
            && daily.issueToday.length === 0 ? (
            <div className="empty-state">لا توجد حركة لهذا اليوم</div>
          ) : null}
        </div>
      ) : null}

      {/* ── 3b) OVERVIEW VIEW ── */}
      {activeView === 'overview' ? (
        <div className="closing-view">
          <div className="closing-overview-grid">
            {/* Customer side */}
            <div className="closing-overview-card">
              <div className="closing-overview-head">
                <h3>الزبائن</h3>
                <span className="closing-overview-sub">
                  مستحق: <strong>{formatMoney(closing.customerSnapshot.totalOutstanding)}</strong>
                </span>
              </div>
              <div className="closing-mini-stats">
                <div><span>جديدة</span><strong>{closing.customerSnapshot.receivedCount}</strong></div>
                <div><span>عند الموظف</span><strong className="text-blue">{closing.customerSnapshot.withEmployeeCount}</strong></div>
                <div><span>مراجعة</span><strong className="text-orange">{closing.customerSnapshot.reviewHoldCount}</strong></div>
                <div><span>مشاكل</span><strong className="text-red">{closing.customerSnapshot.issueCount}</strong></div>
                <div><span>تم السحب</span><strong className="text-green">{closing.customerSnapshot.pickedUpCount}</strong></div>
              </div>
            </div>

            {/* Accountant side */}
            <div className="closing-overview-card closing-overview-card--accent">
              <div className="closing-overview-head">
                <h3>المحاسب</h3>
                <button
                  className="action-btn action-btn--green action-btn--xs"
                  disabled={usingSavedSnapshot || closing.accountantSnapshot.claimableProfit <= 0}
                  onClick={onClaimProfit}
                >
                  مطالبة بالربح
                </button>
              </div>
              <div className="closing-mini-stats">
                <div><span>عنده الآن</span><strong className="text-blue">{formatMoney(closing.accountantSnapshot.cashOnHand)}</strong></div>
                <div><span>من ويسترن</span><strong>{formatMoney(closing.accountantSnapshot.systemReceived)}</strong></div>
                <div><span>دفع للزبائن</span><strong>{formatMoney(closing.accountantSnapshot.customerPaid)}</strong></div>
                <div><span>مازال للزبائن</span><strong className="text-orange">{formatMoney(closing.accountantSnapshot.outstandingCustomer)}</strong></div>
                <div><span>ربح قابل</span><strong className="text-green">{formatMoney(closing.accountantSnapshot.claimableProfit)}</strong></div>
                <div><span>ربح معلّق</span><strong>{formatMoney(closing.accountantSnapshot.pendingProfit)}</strong></div>
                <div><span>ربح مسحوب</span><strong>{formatMoney(closing.accountantSnapshot.claimedProfit)}</strong></div>
              </div>
            </div>
          </div>

          {closing.customerSnapshot.customerBreakdown.length > 0 ? (
            <CollapsibleSection title="تفصيل الزبائن" count={closing.customerSnapshot.customerBreakdown.length}>
              <div className="table-wrap">
                <table className="compact-closing-table">
                  <thead>
                    <tr>
                      <th>الزبون</th>
                      <th>جديدة</th>
                      <th>عند الموظف</th>
                      <th>مراجعة</th>
                      <th>مشاكل</th>
                      <th>تم السحب</th>
                      <th>الرصيد الجاري</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closing.customerSnapshot.customerBreakdown.map((customer) => (
                      <tr key={customer.id}>
                        <td>{customer.name}</td>
                        <td>{customer.receivedCount}</td>
                        <td>{customer.withEmployeeCount}</td>
                        <td>{customer.reviewHoldCount}</td>
                        <td>{customer.issueCount}</td>
                        <td>{customer.pickedUpCount}</td>
                        <td className="balance-cell">{formatMoney(customer.currentBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          ) : null}

          {closing.accountantSnapshot.claimHistory.length > 0 ? (
            <CollapsibleSection title="سجل مطالبات الربح" count={closing.accountantSnapshot.claimHistory.length}>
              <div className="table-wrap">
                <table className="compact-closing-table">
                  <thead>
                    <tr>
                      <th>تاريخ المطالبة</th>
                      <th>القيمة</th>
                      <th>ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closing.accountantSnapshot.claimHistory.map((claim) => (
                      <tr key={claim.id}>
                        <td className="date-cell">{formatDate(claim.createdAt)}</td>
                        <td>{formatMoney(Math.abs(claim.amount || 0))}</td>
                        <td>{claim.note || 'مطالبة ربح'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          ) : null}
        </div>
      ) : null}

      {/* ── 3c) HISTORY VIEW ── */}
      {activeView === 'history' ? (
        <div className="closing-view">
          {(dailyClosings || []).length === 0 ? (
            <div className="empty-state">لا توجد إقفالات محفوظة بعد</div>
          ) : (
            <div className="table-wrap">
              <table className="compact-closing-table">
                <thead>
                  <tr>
                    <th>اليوم</th>
                    <th>وقت الحفظ</th>
                    <th>مستحق الزبائن</th>
                    <th>من الموظف</th>
                    <th>للزبائن</th>
                    <th>ربح تحقق</th>
                    <th>عند المحاسب</th>
                    <th>ربح قابل</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dailyClosings.map((record) => (
                    <tr key={record.id}>
                      <td className="date-cell">{formatArabicDate(record.date)}</td>
                      <td className="date-cell">{formatDate(record.savedAt)}{record.autoSaved ? ' · تلقائي' : ''}</td>
                      <td>{formatMoney(record.snapshot?.customerSnapshot?.totalOutstanding)}</td>
                      <td>{formatMoney(record.snapshot?.officeDaily?.officeSystemReceivedToday)}</td>
                      <td>{formatMoney(record.snapshot?.officeDaily?.officeCustomerPaidToday)}</td>
                      <td className="text-green">{formatMoney(record.snapshot?.officeDaily?.officeProfitRealizedToday)}</td>
                      <td className="text-blue">{formatMoney(record.snapshot?.accountantSnapshot?.cashOnHand)}</td>
                      <td>{formatMoney(record.snapshot?.accountantSnapshot?.claimableProfit)}</td>
                      <td>
                        <button
                          className="action-btn ghost-button action-btn--xs"
                          onClick={() => {
                            setSelectedDate(record.date)
                            setPreferSavedSnapshot(true)
                            setActiveView('activity')
                          }}
                        >
                          عرض
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
