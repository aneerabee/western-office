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
  dailyClosings,
  customersById,
  onClaimProfit,
  onSaveClosing,
}) {
  const [selectedDate, setSelectedDate] = useState(getTodayKey)
  const isToday = selectedDate === getTodayKey()
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
  const closing = !isToday && savedClosing?.snapshot ? savedClosing.snapshot : liveClosing
  const usingSavedSnapshot = !isToday && Boolean(savedClosing?.snapshot)

  const daily = closing.officeDaily

  return (
    <>
      {/* ── Header + Date ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>الإقفال اليومي</h2>
          <div className="panel-head compact">
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
            <button
              className="action-btn action-btn--green action-btn--xs"
              disabled={!isToday}
              onClick={() => onSaveClosing(selectedDate)}
              title={isToday ? 'حفظ سجل الإقفال لليوم الحالي' : 'يمكن حفظ الإقفال فقط لليوم الحالي'}
            >
              حفظ سجل اليوم
            </button>
          </div>
        </div>
        <p className="closing-date-label">{formatArabicDate(selectedDate)}</p>
        <p className="text-muted closing-note">
          {usingSavedSnapshot
            ? `يعرض الآن السجل المحفوظ لهذا اليوم. آخر حفظ: ${formatDate(savedClosing.savedAt)}`
            : savedClosing
              ? `يوجد سجل محفوظ لهذا اليوم بتاريخ ${formatDate(savedClosing.savedAt)}، لكن المعروض الآن هو الحساب اللحظي الحالي.`
              : isToday
                ? 'المعروض الآن حساب لحظي. ثبّت اليوم من زر حفظ سجل اليوم عند انتهاء العمل.'
                : 'لا يوجد سجل محفوظ لهذا اليوم، لذلك المعروض هو إعادة حساب من البيانات الحالية.'}
        </p>

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

        {daily.activityToday.length > 0 ? (
          <div className="closing-section">
            <h3>سجل نشاط اليوم ({daily.activityToday.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>المرسل</th>
                    <th>آخر نشاط</th>
                    <th>أنشطة اليوم</th>
                    <th>الحالة الحالية</th>
                    <th>للزبون</th>
                    <th>من الموظف</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.activityToday.map(({ transfer, activities, latestActivity }) => (
                    <tr key={`${transfer.id}-${latestActivity.at}`}>
                      <td className="ref-cell">{transfer.reference}</td>
                      <td>{(customersById || new Map()).get(transfer.customerId)?.name || transfer.receiverName}</td>
                      <td>{transfer.senderName}</td>
                      <td className="date-cell">{formatDate(latestActivity.at)}</td>
                      <td>{activities.map((item) => item.label).join(' / ')}</td>
                      <td>
                        <span className="status-badge" style={{ '--badge-color': statusMeta[transfer.status]?.color }}>
                          <span className="status-dot" />
                          {statusMeta[transfer.status]?.label}
                        </span>
                      </td>
                      <td>{transfer.customerAmount === null ? '-' : money(transfer.customerAmount)}</td>
                      <td>{transfer.systemAmount === null ? '-' : money(transfer.systemAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

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
                  {daily.createdToday.map(({ transfer: t, activityAtByType }) => (
                    <tr key={t.id} className={t.status === 'issue' ? 'row-issue' : t.status === 'picked_up' ? 'row-picked' : ''}>
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatTime(activityAtByType.created || t.createdAt)}</td>
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
                  {daily.sentToday.map(({ transfer: t, activityAtByType }) => (
                    <tr key={t.id}>
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatTime(activityAtByType.sent || t.sentAt)}</td>
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
                  {daily.pickedUpToday.map(({ transfer: t, activityAtByType }) => (
                    <tr key={t.id} className="row-picked">
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatTime(activityAtByType.picked_up || t.pickedUpAt)}</td>
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
                  {daily.settledToday.map(({ transfer: t, activityAtByType }) => (
                    <tr key={t.id} className="row-settled">
                      <td className="ref-cell">{t.reference}</td>
                      <td>{(customersById || new Map()).get(t.customerId)?.name || t.receiverName}</td>
                      <td className="date-cell">{formatTime(activityAtByType.settled || t.settledAt)}</td>
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
                  {daily.issueToday.map(({ transfer: t }) => (
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

        {(dailyClosings || []).length > 0 ? (
          <div className="closing-section">
            <h3>سجل الإقفالات المحفوظة</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>اليوم</th>
                    <th>وقت الحفظ</th>
                    <th>مستحق الزبائن</th>
                    <th>استلم من الموظف</th>
                    <th>دفع للزبائن</th>
                    <th>ربح تحقق</th>
                    <th>عند المحاسب</th>
                    <th>ربح قابل</th>
                    <th>عرض</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyClosings.map((record) => (
                    <tr key={record.id}>
                      <td className="date-cell">{formatArabicDate(record.date)}</td>
                      <td className="date-cell">{formatDate(record.savedAt)}</td>
                      <td>{money(record.snapshot?.customerSnapshot?.totalOutstanding)}</td>
                      <td>{money(record.snapshot?.officeDaily?.officeSystemReceivedToday)}</td>
                      <td>{money(record.snapshot?.officeDaily?.officeCustomerPaidToday)}</td>
                      <td>{money(record.snapshot?.officeDaily?.officeProfitRealizedToday)}</td>
                      <td>{money(record.snapshot?.accountantSnapshot?.cashOnHand)}</td>
                      <td>{money(record.snapshot?.accountantSnapshot?.claimableProfit)}</td>
                      <td>
                        <button
                          className="ghost-button ghost-button--small"
                          onClick={() => setSelectedDate(record.date)}
                        >
                          عرض
                        </button>
                      </td>
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
            {usingSavedSnapshot
              ? 'يعرض السجل المحفوظ لذلك اليوم'
              : isToday
                ? 'حتى هذه اللحظة'
                : 'أرقام اللحظة الحالية — ليست أرقام ذلك اليوم'}
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
              disabled={usingSavedSnapshot || closing.accountantSnapshot.claimableProfit <= 0}
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
