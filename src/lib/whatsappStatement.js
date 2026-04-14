import { summarizeCustomers } from './transferLogic'

/*
  WhatsApp customer statement generator — PURE functions only.

  Given a customer and the surrounding state (transfers + ledger entries),
  produces a ready-to-send Arabic text message that the office owner can
  share with their merchant customer through WhatsApp. It also knows how
  to build the wa.me link and normalize phone numbers.

  The module never mutates inputs and never performs any I/O.
*/

function formatMoney(value) {
  const n = Math.round(Number(value) || 0)
  try {
    return n.toLocaleString('en-US')
  } catch {
    return String(n)
  }
}

function formatUsd(value) {
  return `${formatMoney(value)}$`
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('ar', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function toLocalDateKey(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const STATUS_LABELS = {
  received: 'وصلت',
  with_employee: 'عند الموظف',
  review_hold: 'مراجعة',
  picked_up: 'مسحوبة',
  issue: 'مشكلة',
}

/**
 * Normalize a user-entered phone number to wa.me format (pure digits,
 * international without any leading + or 00).
 *
 * Handles three common input shapes the user may type:
 *   1. International with +   (e.g. "+90 555 123 4567")
 *   2. International with 00  (e.g. "0090 555 123 4567")
 *   3. Local Turkish with 0   (e.g. "0555 123 4567" — 11 digits)
 *
 * Returns an empty string if the input cannot be normalized.
 * Default country code is Turkey (90) since the office operates there.
 */
const DEFAULT_COUNTRY_CODE = '90'

export function normalizePhoneForWhatsapp(raw) {
  if (typeof raw !== 'string') return ''
  let digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return ''

  // Case 2: strip '00' international call prefix → "0090..." becomes "90..."
  if (digits.startsWith('00')) {
    digits = digits.slice(2)
  } else if (digits.startsWith('0') && digits.length === 11) {
    // Case 3: Turkish local "0 5xx xxx xx xx" → prepend country code
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1)
  }

  // Final sanity: must be at least 10 digits (shortest viable country + number)
  if (digits.length < 10) return ''

  return digits
}

/**
 * Build the wa.me share URL for a phone + message. Returns null when
 * the phone is invalid so callers can fall back gracefully.
 */
export function buildWhatsappUrl(phone, message) {
  const normalized = normalizePhoneForWhatsapp(phone)
  if (!normalized) return null
  const encoded = encodeURIComponent(message || '')
  return `https://wa.me/${normalized}?text=${encoded}`
}

/**
 * Build the Arabic WhatsApp message body for a specific customer.
 *
 * @param {object} args
 * @param {object} args.customer  the single customer object
 * @param {Array}  args.transfers all transfers (function filters by customerId
 *                                and excludes soft-deleted)
 * @param {Array}  args.ledgerEntries all ledger entries (filtered by customerId)
 * @param {Date}   [args.now=new Date()] current time for the footer
 *
 * @returns {string} formatted Arabic message ready to send
 */
export function buildCustomerWhatsappMessage({
  customer,
  transfers = [],
  ledgerEntries = [],
  now = new Date(),
}) {
  if (!customer || !customer.id) return ''

  // Filter to THIS customer only — never leak anything else
  const activeTransfers = transfers.filter(
    (t) => t && !t.deletedAt && Number(t.customerId) === Number(customer.id),
  )
  const customerLedger = ledgerEntries.filter(
    (e) => e && !e.deletedAt && Number(e.customerId) === Number(customer.id),
  )

  // Use summarizeCustomers so we get the full summary (currentBalance,
  // settledAmount, unsettledAmount, totals). This is the SAME function
  // used by the rest of the app, so the numbers match exactly.
  const summaries = summarizeCustomers([customer], activeTransfers, customerLedger)
  const summary = summaries.find((s) => s.id === customer.id) || {
    currentBalance: 0,
    settledAmount: 0,
    unsettledAmount: 0,
    transferCount: 0,
    openingOutstandingAmount: 0,
    openingOutstandingTransferCount: 0,
  }

  const totalTransfers = (summary.transferCount || 0) + (summary.openingOutstandingTransferCount || 0)
  const owedNow = Math.max(0, Number(summary.currentBalance) || 0)
  const settledTotal = Math.max(0, Number(summary.settledAmount) || 0)

  // ── Status counts and today metrics ─────────────────────────────────
  const todayKey = toLocalDateKey(now.toISOString())

  let receivedCount = 0         // brought to us, not yet sent to employee
  let withEmployeeCount = 0     // forwarded, waiting to be available for pickup
  let reviewHoldCount = 0       // on hold for review
  let issueCount = 0            // unresolved problems
  let unsettledCount = 0        // picked up by customer but not paid out yet
  let unsettledTotal = 0        // sum of customerAmount for unsettledCount
  const issueTransfers = []     // detailed list for the issues section

  for (const t of activeTransfers) {
    if (t.status === 'received') receivedCount += 1
    else if (t.status === 'with_employee') withEmployeeCount += 1
    else if (t.status === 'review_hold') reviewHoldCount += 1
    else if (t.status === 'issue') {
      issueCount += 1
      issueTransfers.push(t)
    }
    else if (t.status === 'picked_up' && !t.settled) {
      unsettledCount += 1
      unsettledTotal += Number(t.customerAmount) || 0
    }
  }

  // ── Last settlement (most recent event across regular + opening) ────
  let lastSettlement = null // { settledAt, count, total, kind }
  // Regular transfer settlements — group by settledAt
  const transferSettlements = new Map()
  for (const t of activeTransfers) {
    if (!t.settled || !t.settledAt) continue
    const key = t.settledAt
    if (!transferSettlements.has(key)) {
      transferSettlements.set(key, { settledAt: key, count: 0, total: 0, kind: 'transfer' })
    }
    const bucket = transferSettlements.get(key)
    bucket.count += 1
    bucket.total += Number(t.customerAmount) || 0
  }
  for (const bucket of transferSettlements.values()) {
    if (!lastSettlement || new Date(bucket.settledAt).getTime() > new Date(lastSettlement.settledAt).getTime()) {
      lastSettlement = bucket
    }
  }
  // Opening-balance settlements from ledger
  for (const entry of customerLedger) {
    if (entry.type !== 'opening_transfer_settlement') continue
    const bucket = {
      settledAt: entry.createdAt,
      count: Math.max(0, Math.trunc(Number(entry.transferCount) || 0)) || 1,
      total: Math.abs(Number(entry.amount) || 0),
      kind: 'opening',
    }
    if (!lastSettlement || new Date(bucket.settledAt).getTime() > new Date(lastSettlement.settledAt).getTime()) {
      lastSettlement = bucket
    }
  }

  // ── Today's new transfers (full list + summary) ─────────────────────
  const todayTransfers = [...activeTransfers]
    .filter((t) => toLocalDateKey(t.createdAt) === todayKey)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())

  // Status breakdown for today's new transfers (drives the small "ملخص اليوم")
  let todayPickedUpCount = 0
  let todayWithEmployeeCount = 0
  let todayReceivedCount = 0
  let todayIssueCount = 0
  let todayReviewHoldCount = 0
  for (const t of todayTransfers) {
    if (t.status === 'picked_up') todayPickedUpCount += 1
    else if (t.status === 'with_employee') todayWithEmployeeCount += 1
    else if (t.status === 'received') todayReceivedCount += 1
    else if (t.status === 'issue') todayIssueCount += 1
    else if (t.status === 'review_hold') todayReviewHoldCount += 1
  }

  const formatTransferLine = (t, index) => {
    const statusLabel = STATUS_LABELS[t.status] || t.status || ''
    const amt = typeof t.customerAmount === 'number' ? formatUsd(t.customerAmount) : '-'
    const ref = t.reference || '-'
    const dateStr = formatDate(t.createdAt)
    const receiver = t.receiverName || ''
    const num = index + 1
    const parts = [`${num}- رقم ${ref}`]
    if (receiver) parts.push(`| المستلم: ${receiver}`)
    parts.push(`| الحالة: ${statusLabel}`)
    parts.push(`| المبلغ: ${amt}`)
    if (dateStr) parts.push(`| ${dateStr}`)
    return parts.join(' ')
  }

  // ── Build the message ───────────────────────────────────────────────
  const lines = []

  lines.push(`السلام عليكم الأخ ${customer.name}`)
  lines.push('')
  lines.push('كشف حسابك')
  lines.push('━━━━━━━━━━━━━━')
  lines.push('')

  // Section 1 — main balance
  lines.push('*الرصيد*')
  lines.push(`- المستحق لك الآن: *${formatUsd(owedNow)}*`)
  lines.push(`- عدد حوالاتك الكلّي: ${totalTransfers} حوالة`)
  lines.push('')

  // Section 2 — current status breakdown (count + value where relevant)
  const hasAnyStatus =
    receivedCount + withEmployeeCount + reviewHoldCount + issueCount + unsettledCount > 0
  if (hasAnyStatus) {
    lines.push('*حالة الحوالات الآن*')
    if (unsettledCount > 0) {
      lines.push(`- مسحوبة وتنتظر التسوية: ${unsettledCount} حوالة (بقيمة ${formatUsd(unsettledTotal)})`)
    }
    if (withEmployeeCount > 0) {
      lines.push(`- عند الموظف: ${withEmployeeCount} حوالة`)
    }
    if (receivedCount > 0) {
      lines.push(`- جديدة لم تُرسل للموظف: ${receivedCount} حوالة`)
    }
    if (reviewHoldCount > 0) {
      lines.push(`- قيد المراجعة: ${reviewHoldCount} حوالة`)
    }
    if (issueCount > 0) {
      lines.push(`- فيها مشاكل غير محلولة: ${issueCount} حوالة`)
      // Detailed list so the customer knows EXACTLY which references are
      // stuck. Indented with a "·" bullet so it reads as a sub-item under
      // the issues count line, and each field is separated by " · " too.
      for (const t of issueTransfers) {
        const ref = t.reference || '-'
        const sender = (t.senderName || '').trim() || '—'
        lines.push(`   · رقم ${ref}  ·  المرسل: ${sender}`)
      }
    }
    lines.push('')
  }

  // Section 3 — today's new transfers (listed) + today summary
  if (todayTransfers.length > 0) {
    lines.push(`*نشاط اليوم (${todayTransfers.length} حوالة جديدة)*`)
    lines.push('')
    lines.push('الحوالات الجديدة اليوم:')
    todayTransfers.forEach((t, index) => lines.push(formatTransferLine(t, index)))
    lines.push('')
    lines.push('ملخص اليوم:')
    if (todayPickedUpCount > 0) {
      lines.push(`- مسحوبة: ${todayPickedUpCount} حوالة`)
    }
    if (todayWithEmployeeCount > 0) {
      lines.push(`- عند الموظف: ${todayWithEmployeeCount} حوالة`)
    }
    if (todayReceivedCount > 0) {
      lines.push(`- لم تُرسل للموظف بعد: ${todayReceivedCount} حوالة`)
    }
    if (todayReviewHoldCount > 0) {
      lines.push(`- قيد المراجعة: ${todayReviewHoldCount} حوالة`)
    }
    if (todayIssueCount > 0) {
      lines.push(`- فيها مشاكل: ${todayIssueCount} حوالة`)
    }
    if (
      todayPickedUpCount +
        todayWithEmployeeCount +
        todayReceivedCount +
        todayReviewHoldCount +
        todayIssueCount ===
      0
    ) {
      lines.push('- لم يتم التحرك على أي منها بعد')
    }
    lines.push('')
  }

  // Section 4 — last settlement
  if (lastSettlement) {
    lines.push('*آخر تسوية*')
    const settlementDate = formatDate(lastSettlement.settledAt)
    lines.push(`- التاريخ: ${settlementDate}`)
    lines.push(`- عدد الحوالات: ${lastSettlement.count} حوالة`)
    lines.push(`- المبلغ: ${formatUsd(lastSettlement.total)}`)
    lines.push('')
  }

  // Empty state — only when absolutely nothing has been recorded
  if (activeTransfers.length === 0) {
    lines.push('لا توجد حوالات مسجّلة بعد.')
    lines.push('')
  }

  // Footer
  lines.push('━━━━━━━━━━━━━━')
  lines.push(`تاريخ الكشف: ${formatDate(now.toISOString())}`)
  lines.push('شكراً لثقتك بنا')

  return lines.join('\n')
}
