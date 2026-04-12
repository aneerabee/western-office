import { useMemo, useState } from 'react'
import { statusMeta } from '../sampleData'
import { computeDailyClosing, getAvailableDates, getTodayKey } from '../lib/dailyClosing'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function money(value) {
  return currency.format(Number(value || 0))
}

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

export default function DailyClosingTab({
  transfers,
  customerSummary,
  officeSummary,
  claimHistory,
  customersById,
  onClaimProfit,
}) {
  const [selectedDate, setSelectedDate] = useState(getTodayKey)
  const isToday = selectedDate === getTodayKey()
  const availableDates = useMemo(
    () => getAvailableDates(transfers, claimHistory),
    [claimHistory, transfers],
  )

  const closing = useMemo(
    () => computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, selectedDate),
    [claimHistory, customerSummary, officeSummary, selectedDate, transfers],
  )

  const daily = closing.officeDaily

  return (
    <>
      {/* ── Header + Date ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>الإقفال اليومي</h2>
          <select
            className="closing-date-select"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          >
            {availableDates.length === 0 ? (
              <option value={selectedDate}>{selectedDate}</option>
            ) : (
              availableDates.map((date) => (
                <option key={date} value={date}>{date}</option>
              ))
            )}
          </select>
        </div>
        <p className="closing-date-label">{formatArabicDate(selectedDate)}</p>

        {/* ── حركة اليوم ── */}
        <div className="closing-section">
          <h3>حركة اليوم</h3>
          <div className="closing-grid">
            <div className="closing-card closing-card--accent">
              <span>دخلت</span>
              <strong>{daily.createdCount}</strong>
            </div>
            <div className="closing-card">
              <span>أُرسلت للموظف</span>
              <strong>{daily.sentCount}</strong>
            </div>
            <div className="closing-card">
              <span>تم سحبها</span>
              <strong>{daily.pickedUpCount}</strong>
            </div>
            <div className="closing-card">
              <span>مراجعة لاحقة</span>
              <strong>{daily.reviewHoldCount}</strong>
            </div>
            <div className="closing-card">
              <span>مشاكل</span>
              <strong>{daily.issueCount}</strong>
            </div>
            <div className="closing-card">
              <span>تسويات</span>
              <strong>{daily.settledCount}</strong>
            </div>
          </div>

          <div className="closing-grid">
            <div className="closing-card">
              <span>المستلم من الموظف</span>
              <strong>{money(daily.officeSystemReceivedToday)}</strong>
            </div>
            <div className="closing-card">
              <span>المدفوع للزبائن</span>
              <strong>{money(daily.officeCustomerPaidToday)}</strong>
            </div>
            <div className="closing-card closing-card--margin">
              <span>الربح المتحقق</span>
              <strong>{money(daily.officeProfitRealizedToday)}</strong>
            </div>
          </div>
        </div>

        {/* ── حوالات دخلت اليوم ── */}
        {daily.createdToday.length > 0 ? (
          <div className="closing-section">
            <h3>حوالات دخلت اليوم ({daily.createdToday.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>المرسل</th>
                    <th>الوقت</th>
                    <th>الحالة</th>
                    <th>مبلغ الحوالة</th>
                    <th>للزبون</th>
                    <th>المستلم</th>
                    <th>الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.createdToday.map((t) => (
                    <tr key={t.id} className={t.status === 'issue' ? 'row-issue' : t.status === 'picked_up' ? 'row-picked' : ''}>
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatTime(t.createdAt)}</td>
                      <td>
                        <span className="status-badge" style={{ '--badge-color': statusMeta[t.status]?.color }}>
                          <span className="status-dot" />
                          {statusMeta[t.status]?.label}
                        </span>
                      </td>
                      <td className="amount-info">{t.transferAmount === null ? '-' : money(t.transferAmount)}</td>
                      <td>{t.customerAmount === null ? '-' : money(t.customerAmount)}</td>
                      <td>{t.systemAmount === null ? '-' : money(t.systemAmount)}</td>
                      <td>{t.margin === null ? '-' : money(t.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ── أُرسلت للموظف اليوم ── */}
        {daily.sentToday.length > 0 ? (
          <div className="closing-section">
            <h3>أُرسلت للموظف اليوم ({daily.sentToday.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>المرسل</th>
                    <th>وقت الإرسال</th>
                    <th>مبلغ الحوالة</th>
                    <th>للزبون</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.sentToday.map((t) => (
                    <tr key={t.id}>
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatTime(t.sentAt)}</td>
                      <td className="amount-info">{t.transferAmount === null ? '-' : money(t.transferAmount)}</td>
                      <td>{t.customerAmount === null ? '-' : money(t.customerAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ── حوالات تم سحبها اليوم ── */}
        {daily.pickedUpToday.length > 0 ? (
          <div className="closing-section">
            <h3>تم سحبها اليوم ({daily.pickedUpToday.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>المرسل</th>
                    <th>وقت السحب</th>
                    <th>المستلم</th>
                    <th>للزبون</th>
                    <th>الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.pickedUpToday.map((t) => (
                    <tr key={t.id} className="row-picked">
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatTime(t.pickedUpAt)}</td>
                      <td>{money(t.systemAmount)}</td>
                      <td>{money(t.customerAmount)}</td>
                      <td>{money(t.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ── تسويات اليوم ── */}
        {daily.settledToday.length > 0 ? (
          <div className="closing-section">
            <h3>تسويات اليوم ({daily.settledToday.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>وقت التسوية</th>
                    <th>المستلم</th>
                    <th>للزبون</th>
                    <th>الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.settledToday.map((t) => (
                    <tr key={t.id} className="row-settled">
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td className="date-cell">{formatTime(t.settledAt)}</td>
                      <td>{money(t.systemAmount)}</td>
                      <td>{money(t.customerAmount)}</td>
                      <td>{money(t.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ── مشاكل اليوم ── */}
        {daily.issueToday.length > 0 ? (
          <div className="closing-section">
            <h3>مشاكل اليوم ({daily.issueToday.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>المرسل</th>
                    <th>نوع المشكلة</th>
                    <th>ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.issueToday.map((t) => (
                    <tr key={t.id} className="row-issue">
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td>{t.issueCode || '-'}</td>
                      <td>{t.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── الصورة العامة (تراكمي) ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>الصورة العامة</h2>
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {isToday ? 'حتى هذه اللحظة' : 'أرقام اللحظة الحالية — ليست أرقام ذلك اليوم'}
          </span>
        </div>

        <div className="closing-section">
          <h3>ملخص الزبائن</h3>
          <div className="closing-grid">
            <div className="closing-card closing-card--accent">
              <span>مستحق للزبائن</span>
              <strong>{money(closing.customerSnapshot.totalOutstanding)}</strong>
            </div>
            <div className="closing-card">
              <span>جديدة</span>
              <strong>{closing.customerSnapshot.receivedCount}</strong>
            </div>
            <div className="closing-card">
              <span>عند الموظف</span>
              <strong>{closing.customerSnapshot.withEmployeeCount}</strong>
            </div>
            <div className="closing-card">
              <span>مراجعة</span>
              <strong>{closing.customerSnapshot.reviewHoldCount}</strong>
            </div>
            <div className="closing-card">
              <span>مشاكل</span>
              <strong>{closing.customerSnapshot.issueCount}</strong>
            </div>
            <div className="closing-card">
              <span>تم السحب</span>
              <strong>{closing.customerSnapshot.pickedUpCount}</strong>
            </div>
          </div>

          <div className="table-wrap">
            <table>
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
                    <td className="balance-cell">{money(customer.currentBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="closing-section">
          <div className="panel-head compact">
            <h3>المحاسب</h3>
            <button
              className="action-btn action-btn--green action-btn--xs"
              disabled={closing.accountantSnapshot.claimableProfit <= 0}
              onClick={onClaimProfit}
            >
              مطالبة بالربح
            </button>
          </div>

          <div className="closing-grid">
            <div className="closing-card">
              <span>عنده الآن</span>
              <strong>{money(closing.accountantSnapshot.cashOnHand)}</strong>
            </div>
            <div className="closing-card">
              <span>استلم من ويسترن</span>
              <strong>{money(closing.accountantSnapshot.systemReceived)}</strong>
            </div>
            <div className="closing-card">
              <span>دفع للزبائن</span>
              <strong>{money(closing.accountantSnapshot.customerPaid)}</strong>
            </div>
            <div className="closing-card">
              <span>ما زال للزبائن</span>
              <strong>{money(closing.accountantSnapshot.outstandingCustomer)}</strong>
            </div>
            <div className="closing-card">
              <span>ربح قابل للمطالبة</span>
              <strong className="text-green">{money(closing.accountantSnapshot.claimableProfit)}</strong>
            </div>
            <div className="closing-card">
              <span>ربح معلّق</span>
              <strong>{money(closing.accountantSnapshot.pendingProfit)}</strong>
            </div>
            <div className="closing-card">
              <span>ربح تم سحبه</span>
              <strong>{money(closing.accountantSnapshot.claimedProfit)}</strong>
            </div>
          </div>

          {closing.accountantSnapshot.claimHistory.length > 0 ? (
            <div className="table-wrap">
              <table>
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
                      <td>{money(Math.abs(claim.amount || 0))}</td>
                      <td>{claim.note || 'مطالبة ربح'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}
