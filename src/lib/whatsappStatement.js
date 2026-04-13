import { summarizeLedgerByCustomer } from './ledger'

/*
  WhatsApp customer statement generator — PURE functions only.

  Given a customer and the surrounding state (transfers + ledger entries),
  produces a ready-to-send Arabic text message that the office owner can
  share with their merchant customer through WhatsApp. It also knows how
  to build the wa.me link and normalize phone numbers.

  The module never mutates inputs and never performs any I/O.
*/

const MAX_RECENT_TRANSFERS = 5

function formatMoney(value) {
  const n = Math.round(Number(value) || 0)
  try {
    return n.toLocaleString('en-US')
  } catch {
    return String(n)
  }
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

const STATUS_LABELS = {
  received: 'وصلت',
  with_employee: 'عند الموظف',
  review_hold: 'مراجعة',
  picked_up: 'مسحوبة',
  issue: 'مشكلة',
}

/**
 * Normalize a user-entered phone number to digits-only (wa.me format).
 * Returns empty string when the input cannot be normalized.
 */
export function normalizePhoneForWhatsapp(raw) {
  if (typeof raw !== 'string') return ''
  const digits = raw.replace(/[^0-9]/g, '')
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

  // Use the existing ledger math so numbers match the app exactly
  const summary = summarizeLedgerByCustomer(
    [customer],
    activeTransfers,
    customerLedger,
  )
  const bucket = summary.get(customer.id) || {
    currentBalance: 0,
    settledAmount: 0,
    unsettledAmount: 0,
    transferCount: 0,
    openingOutstandingAmount: 0,
  }

  const totalTransfers = activeTransfers.length + (customer.openingTransferCount || 0)
  const owedNow = Math.max(0, bucket.currentBalance)
  const settledTotal = Math.max(0, bucket.settledAmount)

  // Build the recent-transfers slice — newest first, cap at MAX_RECENT_TRANSFERS
  const recent = [...activeTransfers]
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    )
    .slice(0, MAX_RECENT_TRANSFERS)

  const lines = []
  lines.push(`السلام عليكم الأخ ${customer.name} 🙏`)
  lines.push('')
  lines.push('هذا كشف حسابك لدينا:')
  lines.push('')
  lines.push(`• عدد حوالاتك الكلّي: ${totalTransfers}`)
  lines.push(`• مستحق لك عندنا الآن: ${formatMoney(owedNow)}`)
  lines.push(`• استلمت سابقاً: ${formatMoney(settledTotal)}`)

  if (recent.length > 0) {
    lines.push('')
    lines.push(`آخر ${recent.length} حوالة:`)
    for (const t of recent) {
      const statusLabel = STATUS_LABELS[t.status] || t.status || ''
      const amt = typeof t.customerAmount === 'number' ? formatMoney(t.customerAmount) : '-'
      const ref = t.reference || '-'
      const dateStr = formatDate(t.createdAt)
      const receiver = t.receiverName || ''
      const parts = [`#${ref}`]
      if (receiver) parts.push(`→ ${receiver}`)
      parts.push(`(${statusLabel})`)
      parts.push(`${amt}`)
      if (dateStr) parts.push(`— ${dateStr}`)
      lines.push(`  ${parts.join(' ')}`)
    }
  } else {
    lines.push('')
    lines.push('لا توجد حوالات مسجّلة بعد.')
  }

  lines.push('')
  lines.push(`📅 تاريخ الكشف: ${formatDate(now.toISOString())}`)
  lines.push('شكراً لثقتك بنا 🤝')

  return lines.join('\n')
}
