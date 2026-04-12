export function getDateKey(isoString) {
  return isoString ? isoString.slice(0, 10) : ''
}

export function getTodayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pushDate(set, value) {
  const key = getDateKey(value)
  if (key) set.add(key)
}

export function getAvailableDates(transfers, claimHistory = []) {
  const dates = new Set()

  for (const transfer of transfers) {
    pushDate(dates, transfer.createdAt)
    pushDate(dates, transfer.sentAt)
    pushDate(dates, transfer.pickedUpAt)
    pushDate(dates, transfer.issueAt)
    pushDate(dates, transfer.reviewHoldAt)
    pushDate(dates, transfer.resetAt)
    pushDate(dates, transfer.settledAt)
    pushDate(dates, transfer.updatedAt)
  }

  for (const claim of claimHistory) {
    pushDate(dates, claim.createdAt)
  }

  return [...dates].sort().reverse()
}

function isOnDate(value, date) {
  return getDateKey(value) === date
}

export function computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, date) {
  const createdToday = transfers.filter((transfer) => isOnDate(transfer.createdAt, date))
  const sentToday = transfers.filter((transfer) => isOnDate(transfer.sentAt, date))
  const pickedUpToday = transfers.filter((transfer) => isOnDate(transfer.pickedUpAt, date))
  const issueToday = transfers.filter((transfer) => isOnDate(transfer.issueAt, date))
  const reviewHoldToday = transfers.filter((transfer) => isOnDate(transfer.reviewHoldAt, date))
  const resetToday = transfers.filter((transfer) => isOnDate(transfer.resetAt, date))
  const settledToday = transfers.filter((transfer) => isOnDate(transfer.settledAt, date))
  const claimsToday = claimHistory.filter((claim) => isOnDate(claim.createdAt, date))

  const officeSystemReceivedToday = pickedUpToday.reduce(
    (sum, transfer) => sum + (typeof transfer.systemAmount === 'number' ? transfer.systemAmount : 0),
    0,
  )
  const officeCustomerPaidToday = settledToday.reduce(
    (sum, transfer) => sum + (typeof transfer.customerAmount === 'number' ? transfer.customerAmount : 0),
    0,
  )
  const officeProfitRealizedToday = settledToday.reduce(
    (sum, transfer) => sum + (typeof transfer.margin === 'number' ? transfer.margin : 0),
    0,
  )
  const claimsValueToday = claimsToday.reduce((sum, claim) => sum + Math.abs(claim.amount || 0), 0)

  // Include transfers that went through issue status today but were later reset
  const issueFromHistory = transfers.filter((t) =>
    Array.isArray(t.history) &&
    t.history.some((h) => h.field === 'status' && h.to === 'issue' && isOnDate(h.at, date)) &&
    !isOnDate(t.issueAt, date),
  )
  const allIssueToday = [...issueToday, ...issueFromHistory]

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
      issueCount: allIssueToday.length,
      reviewHoldCount: reviewHoldToday.length,
      resetCount: resetToday.length,
      settledCount: settledToday.length,
      officeSystemReceivedToday,
      officeCustomerPaidToday,
      officeProfitRealizedToday,
      claimsValueToday,
      createdToday: createdToday.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      sentToday: sentToday.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
      pickedUpToday,
      issueToday: allIssueToday,
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
