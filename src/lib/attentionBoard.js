/*
  Attention board — PURE function that derives alert items from current state.

  Philosophy:
    - Read-only. No mutations. No I/O.
    - Only surface things that the user can ACT ON.
    - Tiered severity so urgent issues rise to the top.
    - Every alert carries a `kind` + enough context for the UI to
      deep-link to the relevant tab/item.

  Alert kinds:
    STUCK_WITH_EMPLOYEE  — transfer sent to employee but not picked up
    UNRESOLVED_ISSUE     — transfer in 'issue' status for too long
    CLAIMABLE_PROFIT     — there is profit available to withdraw now
    DUPLICATE_REFERENCE  — two+ transfers share the same reference

  Thresholds are conservative and based on typical Western Union workflow.
*/

export const ALERT_SEVERITY = {
  URGENT: 'urgent',
  WARNING: 'warning',
  INFO: 'info',
}

export const ALERT_KIND = {
  STUCK_WITH_EMPLOYEE: 'stuck_with_employee',
  UNRESOLVED_ISSUE: 'unresolved_issue',
  CLAIMABLE_PROFIT: 'claimable_profit',
  DUPLICATE_REFERENCE: 'duplicate_reference',
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Thresholds
const STUCK_WARNING_HOURS = 48
const STUCK_URGENT_DAYS = 5
const ISSUE_WARNING_HOURS = 24
const ISSUE_URGENT_DAYS = 3

function arr(value) {
  return Array.isArray(value) ? value : []
}

function hoursSince(iso, now) {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (now.getTime() - t) / HOUR)
}

function stuckWithEmployeeAlerts(transfers, customers, now) {
  const alerts = []
  const customerById = new Map(customers.map((c) => [c.id, c]))
  for (const t of transfers) {
    if (!t || t.deletedAt) continue
    if (t.status !== 'with_employee') continue
    const hrs = hoursSince(t.sentAt, now)
    if (hrs < STUCK_WARNING_HOURS) continue
    const severity = hrs >= STUCK_URGENT_DAYS * 24 ? ALERT_SEVERITY.URGENT : ALERT_SEVERITY.WARNING
    const customer = customerById.get(t.customerId)
    const customerName = customer?.name || 'زبون'
    const hoursRounded = Math.round(hrs)
    const days = Math.floor(hoursRounded / 24)
    const timeText = days >= 1 ? `${days} يوم` : `${hoursRounded} ساعة`
    alerts.push({
      id: `stuck-${t.id}`,
      kind: ALERT_KIND.STUCK_WITH_EMPLOYEE,
      severity,
      icon: '⏳',
      title: `حوالة عند الموظف منذ ${timeText}`,
      detail: `${t.reference || '(بدون رقم)'} · ${customerName}`,
      transferId: t.id,
      reference: t.reference,
      customerId: t.customerId,
      hours: hoursRounded,
    })
  }
  return alerts
}

function unresolvedIssueAlerts(transfers, customers, now) {
  const alerts = []
  const customerById = new Map(customers.map((c) => [c.id, c]))
  for (const t of transfers) {
    if (!t || t.deletedAt) continue
    if (t.status !== 'issue') continue
    const hrs = hoursSince(t.issueAt || t.updatedAt, now)
    if (hrs < ISSUE_WARNING_HOURS) continue
    const severity = hrs >= ISSUE_URGENT_DAYS * 24 ? ALERT_SEVERITY.URGENT : ALERT_SEVERITY.WARNING
    const customer = customerById.get(t.customerId)
    const customerName = customer?.name || 'زبون'
    const hoursRounded = Math.round(hrs)
    const days = Math.floor(hoursRounded / 24)
    const timeText = days >= 1 ? `${days} يوم` : `${hoursRounded} ساعة`
    alerts.push({
      id: `issue-${t.id}`,
      kind: ALERT_KIND.UNRESOLVED_ISSUE,
      severity,
      icon: '⚠️',
      title: `مشكلة غير محلولة منذ ${timeText}`,
      detail: `${t.reference || '(بدون رقم)'} · ${customerName}`,
      transferId: t.id,
      reference: t.reference,
      customerId: t.customerId,
      hours: hoursRounded,
    })
  }
  return alerts
}

function claimableProfitAlerts(officeSummary) {
  const amount = Number(officeSummary?.accountantClaimableProfit) || 0
  if (amount <= 0) return []
  return [
    {
      id: 'claim-profit',
      kind: ALERT_KIND.CLAIMABLE_PROFIT,
      severity: ALERT_SEVERITY.INFO,
      icon: '💰',
      title: 'لديك ربح قابل للسحب',
      detail: `يمكنك سحب ${Math.round(amount).toLocaleString('en-US')} من صفحة الإقفال اليومي`,
      amount,
    },
  ]
}

function duplicateReferenceAlerts(transfers) {
  // Count non-deleted references (case-insensitive, trimmed)
  const counts = new Map()
  const examples = new Map() // first transfer per ref
  for (const t of transfers) {
    if (!t || t.deletedAt) continue
    const ref = String(t.reference || '').trim().toUpperCase()
    if (!ref) continue
    counts.set(ref, (counts.get(ref) || 0) + 1)
    if (!examples.has(ref)) examples.set(ref, t)
  }
  const alerts = []
  for (const [ref, count] of counts.entries()) {
    if (count <= 1) continue
    const first = examples.get(ref)
    alerts.push({
      id: `dup-${ref}`,
      kind: ALERT_KIND.DUPLICATE_REFERENCE,
      severity: ALERT_SEVERITY.WARNING,
      icon: '🔁',
      title: `رقم حوالة مكرّر (${count} مرّات)`,
      detail: `${ref} — تفقّد ما إذا كان خطأً أم حوالة حقيقية`,
      reference: ref,
      transferId: first?.id,
      count,
    })
  }
  return alerts
}

const SEVERITY_ORDER = {
  [ALERT_SEVERITY.URGENT]: 0,
  [ALERT_SEVERITY.WARNING]: 1,
  [ALERT_SEVERITY.INFO]: 2,
}

/**
 * Build the attention board from the current state.
 *
 * @param {object} args
 * @param {Array}  args.transfers         all transfers (active + deleted ok, filtered internally)
 * @param {Array}  args.customers         all customers
 * @param {Array}  args.ledgerEntries     ledger entries (unused for now but kept for future rules)
 * @param {object} args.officeSummary     output of summarizeOfficeLedger — we read claimable profit
 * @param {Date}   [args.now=new Date()]  clock for reproducibility
 *
 * @returns {Array<{id, kind, severity, icon, title, detail, ...}>}
 */
export function buildAttentionAlerts({
  transfers,
  customers,
  ledgerEntries, // eslint-disable-line no-unused-vars
  officeSummary,
  now = new Date(),
} = {}) {
  const t = arr(transfers)
  const c = arr(customers)

  const alerts = [
    ...stuckWithEmployeeAlerts(t, c, now),
    ...unresolvedIssueAlerts(t, c, now),
    ...claimableProfitAlerts(officeSummary),
    ...duplicateReferenceAlerts(t),
  ]

  // Stable sort by severity then by id for determinism
  alerts.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 99
    const sb = SEVERITY_ORDER[b.severity] ?? 99
    if (sa !== sb) return sa - sb
    return String(a.id).localeCompare(String(b.id))
  })

  return alerts
}
