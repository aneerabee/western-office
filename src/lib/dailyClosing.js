export function getDateKey(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getTodayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS_ACTIVITY_META = {
  with_employee: { type: 'sent', label: 'أُرسلت للموظف' },
  picked_up: { type: 'picked_up', label: 'تم السحب' },
  review_hold: { type: 'review_hold', label: 'مراجعة لاحقة' },
  issue: { type: 'issue', label: 'مشكلة' },
  received: { type: 'reset', label: 'أعيدت جديدة' },
}

function pushDate(set, value) {
  const key = getDateKey(value)
  if (key) set.add(key)
}

export function getAvailableDates(transfers, claimHistory = [], dailyClosings = []) {
  const dates = new Set()

  for (const transfer of transfers) {
    pushDate(dates, transfer.createdAt)
    pushDate(dates, transfer.sentAt)
    pushDate(dates, transfer.pickedUpAt)
    pushDate(dates, transfer.issueAt)
    pushDate(dates, transfer.reviewHoldAt)
    pushDate(dates, transfer.resetAt)
    pushDate(dates, transfer.settledAt)

    if (Array.isArray(transfer.history)) {
      for (const entry of transfer.history) {
        if (entry?.field === 'status') {
          pushDate(dates, entry.at)
        }
      }
    }
  }

  for (const claim of claimHistory) {
    pushDate(dates, claim.createdAt)
  }

  for (const closing of dailyClosings) {
    if (closing?.date) dates.add(closing.date)
  }

  return [...dates].sort().reverse()
}

function isOnDate(value, date) {
  return getDateKey(value) === date
}

function addActivity(activityMap, type, label, at) {
  if (!type || !label || !at) return
  const key = `${type}:${at}`
  if (!activityMap.has(key)) {
    activityMap.set(key, { type, label, at })
  }
}

export function collectTransferActivity(transfer, date) {
  const activityMap = new Map()

  if (isOnDate(transfer.createdAt, date)) addActivity(activityMap, 'created', 'دخلت', transfer.createdAt)
  if (isOnDate(transfer.sentAt, date)) addActivity(activityMap, 'sent', 'أُرسلت للموظف', transfer.sentAt)
  if (isOnDate(transfer.pickedUpAt, date)) addActivity(activityMap, 'picked_up', 'تم السحب', transfer.pickedUpAt)
  if (isOnDate(transfer.reviewHoldAt, date)) addActivity(activityMap, 'review_hold', 'مراجعة لاحقة', transfer.reviewHoldAt)
  if (isOnDate(transfer.issueAt, date)) addActivity(activityMap, 'issue', 'مشكلة', transfer.issueAt)
  if (isOnDate(transfer.resetAt, date)) addActivity(activityMap, 'reset', 'أعيدت جديدة', transfer.resetAt)
  if (isOnDate(transfer.settledAt, date)) addActivity(activityMap, 'settled', 'تسوية', transfer.settledAt)

  if (Array.isArray(transfer.history)) {
    for (const entry of transfer.history) {
      if (entry?.field !== 'status' || !isOnDate(entry.at, date)) continue
      const meta = STATUS_ACTIVITY_META[entry.to]
      if (!meta) continue
      addActivity(activityMap, meta.type, meta.label, entry.at)
    }
  }

  return [...activityMap.values()].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

function buildActivityRows(transfers, date) {
  return transfers
    .map((transfer) => {
      const activities = collectTransferActivity(transfer, date)
      if (activities.length === 0) return null
      const latestActivity = activities[activities.length - 1]
      const activityAtByType = Object.fromEntries(activities.map((item) => [item.type, item.at]))

      return {
        transfer,
        activities,
        latestActivity,
        activityAtByType,
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.latestActivity.at).getTime() - new Date(a.latestActivity.at).getTime())
}

function rowsByActivityType(activityRows, type) {
  return activityRows
    .filter((row) => row.activities.some((item) => item.type === type))
    .sort((a, b) => new Date(b.activityAtByType[type]).getTime() - new Date(a.activityAtByType[type]).getTime())
}

export function getFieldAtActivity(transfer, field, activityAt) {
  const current = transfer?.[field]
  if (!Array.isArray(transfer?.history) || transfer.history.length === 0) {
    return current ?? null
  }

  const activityTime = new Date(activityAt).getTime()
  let lastValue = null
  let hasLaterChange = false

  for (const entry of transfer.history) {
    if (entry?.field !== field) continue
    const entryTime = new Date(entry.at).getTime()
    if (entryTime > activityTime) {
      hasLaterChange = true
      break
    }
    if (entry.to !== null && entry.to !== undefined) lastValue = entry.to
  }

  if (lastValue !== null) return lastValue
  if (!hasLaterChange && current !== null && current !== undefined) return current
  return null
}

function sumTransferAmount(rows, field, activityType) {
  return rows.reduce((sum, row) => {
    const activityAt = row.activityAtByType?.[activityType] || row.latestActivity?.at
    const value = getFieldAtActivity(row.transfer, field, activityAt)
    return sum + (typeof value === 'number' ? value : 0)
  }, 0)
}

export function createDailyClosingRecord(closing) {
  const now = new Date().toISOString()
  return {
    id: `daily-closing-${closing.date}`,
    date: closing.date,
    savedAt: now,
    updatedAt: now,
    snapshot: JSON.parse(JSON.stringify(closing)),
  }
}

export function resolveClosingView(liveClosing, savedClosing, preferSaved = false) {
  return preferSaved && savedClosing?.snapshot ? savedClosing.snapshot : liveClosing
}

export function computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, date) {
  const activityToday = buildActivityRows(transfers, date)
  const createdToday = rowsByActivityType(activityToday, 'created')
  const sentToday = rowsByActivityType(activityToday, 'sent')
  const pickedUpToday = rowsByActivityType(activityToday, 'picked_up')
  const issueToday = rowsByActivityType(activityToday, 'issue').map((row) => ({
    ...row,
    issueCodeAt: getFieldAtActivity(row.transfer, 'issueCode', row.activityAtByType.issue),
    noteAt: getFieldAtActivity(row.transfer, 'note', row.activityAtByType.issue),
  }))
  const reviewHoldToday = rowsByActivityType(activityToday, 'review_hold')
  const resetToday = rowsByActivityType(activityToday, 'reset')
  const settledToday = rowsByActivityType(activityToday, 'settled')
  const claimsToday = claimHistory.filter((claim) => isOnDate(claim.createdAt, date))

  const officeSystemReceivedToday = sumTransferAmount(pickedUpToday, 'systemAmount', 'picked_up')
  const officeCustomerPaidToday = sumTransferAmount(settledToday, 'customerAmount', 'settled')
  const officeProfitRealizedToday = sumTransferAmount(settledToday, 'margin', 'settled')
  const claimsValueToday = claimsToday.reduce((sum, claim) => sum + Math.abs(claim.amount || 0), 0)

  return {
    date,
    customerSnapshot: {
      totalOutstanding: officeSummary.officeCustomerLiability,
      totalCustomers: customerSummary.length,
      receivedCount: customerSummary.reduce((sum, item) => sum + item.receivedCount, 0),
      withEmployeeCount: customerSummary.reduce((sum, item) => sum + item.withEmployeeCount, 0),
      reviewHoldCount: customerSummary.reduce((sum, item) => sum + item.reviewHoldCount, 0),
      issueCount: customerSummary.reduce((sum, item) => sum + item.issueCount, 0),
      pickedUpCount: customerSummary.reduce((sum, item) => sum + item.pickedUpCount, 0),
      customerBreakdown: customerSummary,
    },
    officeDaily: {
      createdCount: createdToday.length,
      sentCount: sentToday.length,
      pickedUpCount: pickedUpToday.length,
      issueCount: issueToday.length,
      reviewHoldCount: reviewHoldToday.length,
      resetCount: resetToday.length,
      settledCount: settledToday.length,
      officeSystemReceivedToday,
      officeCustomerPaidToday,
      officeProfitRealizedToday,
      claimsValueToday,
      activityToday,
      createdToday,
      sentToday,
      pickedUpToday,
      issueToday,
      reviewHoldToday,
      resetToday,
      settledToday,
    },
    accountantSnapshot: {
      cashOnHand: officeSummary.accountantCashOnHand,
      systemReceived: officeSummary.accountantSystemReceived,
      customerPaid: officeSummary.accountantCustomerPaid,
      outstandingCustomer: officeSummary.accountantOutstandingCustomer,
      claimableProfit: officeSummary.accountantClaimableProfit,
      claimedProfit: officeSummary.accountantClaimedProfit,
      pendingProfit: officeSummary.accountantPendingProfit,
      grossMargin: officeSummary.accountantGrossMargin,
      claimsToday,
      claimHistory: officeSummary.claimHistory,
    },
  }
}
