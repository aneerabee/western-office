import {
  buildSeedLedgerEntries,
  groupPendingSettlementItems,
  summarizeLedgerByCustomer,
} from './ledger'

export const FILTER_ALL = 'all'

let _idCounter = 0
export function makeUniqueId() {
  // Date.now() ≈ 1.76e12, *1000 = 1.76e15 (still below MAX_SAFE_INTEGER 9.0e15)
  // Counter 0-999 per millisecond — 1000 unique ids/ms is more than enough
  _idCounter = (_idCounter + 1) % 1000
  return Date.now() * 1000 + _idCounter
}

export const statusOrder = ['received', 'with_employee', 'review_hold', 'picked_up', 'issue']

/* ── Drafts ── */

export function createEmptyTransferDraft() {
  return {
    customerId: '',
    senderName: '',
    receiverName: '',
    reference: '',
    transferAmount: '',
    customerAmount: '',
  }
}

function createDraftRowId() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyTransferBatchRow() {
  return {
    id: createDraftRowId(),
    senderName: '',
    receiverName: '',
    reference: '',
    transferAmount: '',
    customerAmount: '',
  }
}

export function createEmptyTransferBatchDraft() {
  return {
    customerId: '',
    rows: [createEmptyTransferBatchRow()],
  }
}

export function createEmptyCustomerDraft() {
  return { name: '', openingBalance: '', openingTransferCount: '', settledTotal: '', phone: '' }
}

// Keep a raw phone string for storage — trim whitespace, preserve + and digits.
// Normalization to digits-only happens only at the WhatsApp URL layer.
function normalizePhoneField(value) {
  if (value == null) return ''
  return String(value).trim()
}

/* ── Normalization ── */

export function normalizeReference(ref) {
  return String(ref ?? '').trim().toUpperCase()
}

export function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ')
}

export function parseMoney(value) {
  if (value === '' || value === null || value === undefined) return 0
  const n = Number(value)
  return Number.isNaN(n) ? 0 : n
}

export function computeMargin(systemAmount, customerAmount) {
  if (typeof systemAmount !== 'number' || typeof customerAmount !== 'number') return null
  return systemAmount - customerAmount
}

export function getTransferWorkflowTimestamp(item) {
  return item.resetAt || item.createdAt || item.updatedAt || ''
}

/* ── Build ── */

export function buildCustomerFromDraft(draft, existingCustomers = []) {
  const name = normalizeName(draft.name)
  if (!name) return { ok: false, error: 'يجب إدخال اسم الزبون.' }

  const dup = existingCustomers.some(
    (c) => normalizeName(c.name).toLowerCase() === name.toLowerCase(),
  )
  if (dup) return { ok: false, error: 'الزبون موجود مسبقًا.' }

  const now = new Date()
  return {
    ok: true,
    value: {
      id: makeUniqueId(),
      name,
      openingBalance: parseMoney(draft.openingBalance),
      openingTransferCount: Math.max(0, Math.trunc(parseMoney(draft.openingTransferCount))),
      settledTotal: parseMoney(draft.settledTotal),
      phone: normalizePhoneField(draft.phone),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  }
}

export function buildTransferFromDraft(draft, existingTransfers = [], customers = []) {
  const senderName = normalizeName(draft.senderName)
  const receiverName = normalizeName(draft.receiverName)
  const reference = normalizeReference(draft.reference)
  const customerId = Number(draft.customerId)
  const customer = customers.find((c) => c.id === customerId)

  if (!customer) return { ok: false, error: 'يجب اختيار الزبون من القائمة.' }
  if (!senderName) return { ok: false, error: 'يجب إدخال اسم المرسل.' }
  if (!receiverName) return { ok: false, error: 'يجب إدخال اسم المستلم.' }
  if (!reference) return { ok: false, error: 'يجب إدخال رقم الحوالة.' }

  // Note: duplicate reference is NOT blocked here — save is allowed and
  // both transfers get highlighted visually via the duplicateReferences set.
  const isDuplicate = existingTransfers.some((t) => normalizeReference(t.reference) === reference)

  const transferAmount = draft.transferAmount === '' ? null : Number(draft.transferAmount)
  const customerAmount = draft.customerAmount === '' ? null : Number(draft.customerAmount)

  const now = new Date()
  return {
    ok: true,
    isDuplicate,
    value: {
      id: makeUniqueId(),
      customerId,
      senderName,
      receiverName,
      reference,
      status: 'received',
      issueCode: '',
      transferAmount: Number.isNaN(transferAmount) ? null : transferAmount,
      systemAmount: null,
      customerAmount: Number.isNaN(customerAmount) ? null : customerAmount,
      margin: null,
      settled: false,
      settledAt: null,
      note: '',
      sentAt: null,
      pickedUpAt: null,
      issueAt: null,
      reviewHoldAt: null,
      resetAt: null,
      history: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  }
}

function splitBatchTransferLine(line) {
  if (line.includes('\t')) {
    return line.split('\t').map((part) => part.trim())
  }

  return line.split('|').map((part) => part.trim())
}

export function buildTransfersFromBatchDraft(draft, existingTransfers = [], customers = []) {
  const customerId = Number(draft.customerId)
  const customer = customers.find((item) => item.id === customerId)
  if (!customer) return { ok: false, error: 'يجب اختيار الزبون من القائمة.' }

  const rows = Array.isArray(draft.rows)
    ? draft.rows
    : String(draft.lines ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [senderName = '', receiverName = '', reference = '', transferAmount = '', customerAmount = ''] =
            splitBatchTransferLine(line)
          return { senderName, receiverName, reference, transferAmount, customerAmount }
        })

  if (rows.length === 0) {
    return { ok: false, error: 'يجب إدخال حوالة واحدة على الأقل.' }
  }

  const created = []

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const senderName = String(row.senderName ?? '').trim()
    const receiverName = String(row.receiverName ?? '').trim()
    const reference = String(row.reference ?? '').trim()
    const transferAmount = row.transferAmount ?? ''
    const customerAmount = row.customerAmount ?? ''

    const isBlank =
      senderName === '' &&
      receiverName === '' &&
      reference === '' &&
      String(transferAmount).trim() === '' &&
      String(customerAmount).trim() === ''

    if (isBlank) continue

    if (!senderName || !receiverName || !reference) {
      return {
        ok: false,
        error: `السطر ${index + 1}: يجب إدخال اسم المرسل واسم المستلم ورقم الحوالة.`,
      }
    }

    const result = buildTransferFromDraft(
      {
        customerId: String(customerId),
        senderName,
        receiverName,
        reference,
        transferAmount,
        customerAmount,
      },
      [...existingTransfers, ...created],
      customers,
    )

    if (!result.ok) {
      return {
        ok: false,
        error: `السطر ${index + 1}: ${result.error}`,
      }
    }

    created.push(result.value)
  }

  if (created.length === 0) {
    return { ok: false, error: 'يجب إدخال حوالة واحدة على الأقل.' }
  }

  const duplicatesCount = created.filter((item) => {
    const normalized = normalizeReference(item.reference)
    return existingTransfers.some((t) => normalizeReference(t.reference) === normalized)
      || created.filter((other) => normalizeReference(other.reference) === normalized).length > 1
  }).length

  return { ok: true, value: created, duplicatesCount }
}

/* ── Validation ── */

export function validateTransition(item, nextStatus) {
  if (nextStatus === 'with_employee') {
    if (typeof item.transferAmount !== 'number') {
      return { ok: false, error: 'يجب إدخال مبلغ الحوالة قبل الإرسال للموظف.' }
    }
    if (typeof item.customerAmount !== 'number') {
      return { ok: false, error: 'يجب إدخال المبلغ للزبون قبل الإرسال للموظف.' }
    }
  }

  if (nextStatus === 'picked_up') {
    if (typeof item.systemAmount !== 'number') {
      return { ok: false, error: 'يجب إدخال المبلغ المستلم من الموظف قبل تأكيد السحب.' }
    }
    if (typeof item.customerAmount !== 'number') {
      return { ok: false, error: 'يجب إدخال المبلغ للزبون.' }
    }
  }

  return { ok: true }
}

/* ── Status transitions ── */

const MAX_HISTORY = 50

function addHistory(item, field, from, to) {
  const history = Array.isArray(item.history) ? item.history : []
  const next = [...history, { field, from, to, at: new Date().toISOString() }]
  return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
}

export function transitionTransfer(item, nextStatus) {
  const now = new Date().toISOString()
  const next = {
    ...item,
    status: nextStatus,
    updatedAt: now,
    history: addHistory(item, 'status', item.status, nextStatus),
  }

  if (nextStatus === 'with_employee') {
    next.sentAt = now
  }

  if (nextStatus === 'picked_up') {
    next.pickedUpAt = now
  }

  if (nextStatus === 'issue') {
    next.issueAt = now
  }

  if (nextStatus === 'review_hold') {
    next.reviewHoldAt = now
  }

  if (nextStatus === 'received') {
    const resetFields = ['transferAmount', 'systemAmount', 'customerAmount', 'margin']
    for (const f of resetFields) {
      if (item[f] !== null && item[f] !== undefined) {
        next.history = addHistory({ history: next.history }, f, item[f], null)
      }
    }
    next.resetAt = now
    next.sentAt = null
    next.pickedUpAt = null
    next.reviewHoldAt = null
    next.issueAt = null
    next.settled = false
    next.settledAt = null
    next.transferAmount = null
    next.systemAmount = null
    next.customerAmount = null
    next.margin = null
  }

  if (nextStatus !== 'issue' && nextStatus !== 'review_hold') {
    next.issueCode = ''
  }

  return next
}

/* ── Field updates ── */

/*
  A settled transfer is LOCKED: its amounts, customer and identifying
  fields must not change without first un-settling (via the reset flow).
  updateAmount/updateTransferField refuse to apply changes on such items.
  This is a safety net — the UI already hides the edit controls, but a
  library-level guard protects against any future regression that would
  silently corrupt the settlement history or profit claims.
*/
export function isTransferLocked(item) {
  return Boolean(item && item.settled === true)
}

export function updateAmount(item, field, value) {
  if (isTransferLocked(item)) return item
  const parsed = value === '' ? null : Number(value)
  if (Number.isNaN(parsed)) return item

  const next = {
    ...item,
    [field]: parsed,
    updatedAt: new Date().toISOString(),
    history: addHistory(item, field, item[field], parsed),
  }

  if (field === 'transferAmount') return next

  return { ...next, margin: computeMargin(next.systemAmount, next.customerAmount) }
}

export function updateTransferField(item, field, value) {
  if (isTransferLocked(item)) return item
  const oldValue = item[field]
  if (field === 'customerId') {
    return {
      ...item,
      customerId: Number(value),
      updatedAt: new Date().toISOString(),
      history: addHistory(item, field, oldValue, Number(value)),
    }
  }
  return {
    ...item,
    [field]: value,
    updatedAt: new Date().toISOString(),
    history: addHistory(item, field, oldValue, value),
  }
}

export function updateCustomerField(item, field, value) {
  const isMoneyField = field === 'openingBalance' || field === 'settledTotal'
  const isCountField = field === 'openingTransferCount'
  return {
    ...item,
    [field]: isMoneyField
      ? parseMoney(value)
      : isCountField
        ? Math.max(0, Math.trunc(parseMoney(value)))
        : value,
    updatedAt: new Date().toISOString(),
  }
}

/* ── Settlement ── */

export function settleTransfers(transfers, transferIds) {
  const idSet = new Set(transferIds)
  const now = new Date().toISOString()

  return transfers.map((t) => {
    if (!idSet.has(t.id)) return t
    if (t.status !== 'picked_up' || t.settled) return t
    return { ...t, settled: true, settledAt: now, updatedAt: now }
  })
}

export function getUnsettledForCustomer(transfers, customerId) {
  return transfers.filter(
    (t) => t.customerId === customerId && t.status === 'picked_up' && !t.settled,
  )
}

/* ── Filtering & Sorting ── */

function toLocalDateKey(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getTodayDate() {
  return toLocalDateKey(new Date())
}

export function filterTransfers(transfers, filters, customersById = new Map()) {
  const search = filters.searchTerm.trim().toLowerCase()
  const today = getTodayDate()

  return transfers.filter((t) => {
    const custName = (customersById.get(t.customerId)?.name || t.receiverName || '').toLowerCase()

    const matchSearch =
      search === '' ||
      (t.reference || '').toLowerCase().includes(search) ||
      (t.senderName || '').toLowerCase().includes(search) ||
      (t.receiverName || '').toLowerCase().includes(search) ||
      custName.includes(search) ||
      (t.note || '').toLowerCase().includes(search)

    const matchStatus = filters.statusFilter === FILTER_ALL || t.status === filters.statusFilter

    const matchCustomer =
      filters.customerFilter === FILTER_ALL || t.customerId === Number(filters.customerFilter)

    let matchView = true
    const createdDate = toLocalDateKey(getTransferWorkflowTimestamp(t))
    if (filters.viewMode === 'active') {
      // Show: issues + received + with_employee + any picked_up still awaiting settlement
      if (t.status === 'issue') matchView = true
      else if (t.status === 'received' || t.status === 'with_employee' || t.status === 'review_hold') matchView = true
      else if (t.status === 'picked_up' && !t.settled) matchView = true
      else matchView = false
    } else if (filters.viewMode === 'today') {
      matchView = createdDate === today
    } else if (filters.viewMode === 'completed') {
      matchView = t.status === 'picked_up' && t.settled
    }
    // 'all' shows everything

    let matchDate = true
    if (filters.dateFrom) {
      matchDate = createdDate >= filters.dateFrom
    }
    if (matchDate && filters.dateTo) {
      matchDate = createdDate <= filters.dateTo
    }

    return matchSearch && matchStatus && matchCustomer && matchView && matchDate
  })
}

const STATUS_PRIORITY = { issue: 0, review_hold: 1, received: 2, with_employee: 3, picked_up: 4 }

export function sortTransfers(transfers, sortMode, customersById = new Map()) {
  const sorted = [...transfers]
  const getWorkflowTime = (item) => new Date(getTransferWorkflowTimestamp(item)).getTime()

  switch (sortMode) {
    case 'smart':
      sorted.sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 9
        const pb = STATUS_PRIORITY[b.status] ?? 9
        if (pa !== pb) return pa - pb
        return getWorkflowTime(b) - getWorkflowTime(a)
      })
      return sorted
    case 'oldest':
      sorted.sort((a, b) => getWorkflowTime(a) - getWorkflowTime(b))
      return sorted
    case 'customer':
      sorted.sort((a, b) =>
        (customersById.get(a.customerId)?.name || '').localeCompare(
          customersById.get(b.customerId)?.name || '', 'ar',
        ),
      )
      return sorted
    case 'sender':
      sorted.sort((a, b) => (a.senderName || '').localeCompare(b.senderName || '', 'ar'))
      return sorted
    case 'latest':
    default:
      sorted.sort((a, b) => getWorkflowTime(b) - getWorkflowTime(a))
      return sorted
  }
}

/* ── Summaries ── */

export function summarizeTransfers(transfers, ledgerEntries = [], customers = []) {
  const pickedUp = transfers.filter((t) => t.status === 'picked_up')
  const pendingSettlementGroups = groupPendingSettlementItems(customers, transfers, ledgerEntries)
  const pendingSettlementItems = pendingSettlementGroups.flatMap((group) => group.items)

  const totalSystem = pickedUp.reduce(
    (s, t) => s + (typeof t.systemAmount === 'number' ? t.systemAmount : 0), 0,
  )
  const totalCustomer = pickedUp.reduce(
    (s, t) => s + (typeof t.customerAmount === 'number' ? t.customerAmount : 0), 0,
  )
  const totalMargin = pickedUp.reduce(
    (s, t) => s + (typeof t.margin === 'number' ? t.margin : 0), 0,
  )
  const accountantPending = pendingSettlementGroups.reduce(
    (sum, group) => sum + group.systemTotal,
    0,
  )
  const customerOwed = pendingSettlementGroups.reduce(
    (sum, group) => sum + group.customerTotal,
    0,
  )

  return {
    total: transfers.length,
    receivedCount: transfers.filter((t) => t.status === 'received').length,
    withEmployeeCount: transfers.filter((t) => t.status === 'with_employee').length,
    reviewHoldCount: transfers.filter((t) => t.status === 'review_hold').length,
    pickedUpCount: pickedUp.length,
    issueCount: transfers.filter((t) => t.status === 'issue').length,
    settledCount: pickedUp.filter((t) => t.settled).length,
    unsettledCount: pendingSettlementItems.reduce(
      (sum, item) => sum + (item.openingTransferCount || 1),
      0,
    ),
    totalSystem,
    totalCustomer,
    totalMargin,
    accountantPending,
    customerOwed,
  }
}

export function summarizeCustomers(customers, transfers, ledgerEntries = []) {
  const ledgerSummary = summarizeLedgerByCustomer(customers, transfers, ledgerEntries)

  return customers
    .map((customer) => {
      const own = transfers.filter((t) => t.customerId === customer.id)
      const pickedUp = own.filter((t) => t.status === 'picked_up')
      const settled = pickedUp.filter((t) => t.settled)
      const unsettled = pickedUp.filter((t) => !t.settled)

      const settledAmount = settled.reduce(
        (s, t) => s + (typeof t.customerAmount === 'number' ? t.customerAmount : 0), 0,
      )
      const unsettledAmount = unsettled.reduce(
        (s, t) => s + (typeof t.customerAmount === 'number' ? t.customerAmount : 0), 0,
      )
      const totalMargin = pickedUp.reduce(
        (s, t) => s + (typeof t.margin === 'number' ? t.margin : 0), 0,
      )
      const ledger = ledgerSummary.get(customer.id) || {
        currentBalance: 0,
        ledgerCredits: 0,
        ledgerDebits: 0,
        manualEntriesCount: 0,
        ledgerEntriesCount: 0,
        openingOutstandingAmount: 0,
        openingOutstandingTransferCount: 0,
      }

      return {
        ...customer,
        transferCount: own.length,
        pickedUpCount: pickedUp.length,
        receivedCount: own.filter((t) => t.status === 'received').length,
        withEmployeeCount: own.filter((t) => t.status === 'with_employee').length,
        reviewHoldCount: own.filter((t) => t.status === 'review_hold').length,
        issueCount: own.filter((t) => t.status === 'issue').length,
        settledCount: settled.length,
        unsettledCount: unsettled.length + ledger.openingOutstandingTransferCount,
        settledAmount,
        unsettledAmount: unsettledAmount + ledger.openingOutstandingAmount,
        totalMargin,
        currentBalance: ledger.currentBalance,
        ledgerCredits: ledger.ledgerCredits,
        ledgerDebits: ledger.ledgerDebits,
        manualEntriesCount: ledger.manualEntriesCount,
        ledgerEntriesCount: ledger.ledgerEntriesCount,
        openingOutstandingAmount: ledger.openingOutstandingAmount,
        openingOutstandingTransferCount: ledger.openingOutstandingTransferCount,
      }
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'))
}

/* ── Serialization ── */

export function serializeAppState(state) {
  return JSON.stringify(state, null, 2)
}

const OLD_STATUS_MAP = {
  new: 'received',
  sent_to_operator: 'with_employee',
  under_review: 'with_employee',
  approved: 'picked_up',
  customer_confirmed: 'picked_up',
  sent_to_accountant: 'picked_up',
  paid: 'picked_up',
  closed: 'picked_up',
  issue: 'issue',
  received: 'received',
  with_employee: 'with_employee',
  picked_up: 'picked_up',
}

function migrateTransfer(t) {
  const newStatus = OLD_STATUS_MAP[t.status] || t.status
  const wasSettled =
    ['sent_to_accountant', 'paid', 'closed'].includes(t.status) || t.paymentStatus === 'paid'
  const updatedAt = t.updatedAt || t.createdAt || new Date().toISOString()

  return {
    ...t,
    status: newStatus,
    settled: t.settled ?? wasSettled,
    settledAt: t.settledAt ?? (wasSettled ? updatedAt : null),
    sentAt: t.sentAt ?? (newStatus === 'with_employee' ? updatedAt : null),
    pickedUpAt: t.pickedUpAt ?? (newStatus === 'picked_up' ? updatedAt : null),
    issueAt: t.issueAt ?? (newStatus === 'issue' ? updatedAt : null),
    reviewHoldAt: t.reviewHoldAt ?? (newStatus === 'review_hold' ? updatedAt : null),
    resetAt: t.resetAt ?? null,
    transferAmount: t.transferAmount ?? null,
    history: Array.isArray(t.history) ? t.history : [],
  }
}

export function migrateState(state) {
  const customers = Array.isArray(state.customers) ? state.customers : []
  const transfers = Array.isArray(state.transfers) ? state.transfers.map(migrateTransfer) : []
  const ledgerEntries = Array.isArray(state.ledgerEntries)
    ? state.ledgerEntries
    : buildSeedLedgerEntries(customers)
  const claimHistory = Array.isArray(state.claimHistory) ? state.claimHistory : []
  const dailyClosings = Array.isArray(state.dailyClosings) ? state.dailyClosings : []
  const senders = Array.isArray(state.senders) ? state.senders : []
  const receivers = Array.isArray(state.receivers) ? state.receivers : []

  return {
    customers,
    transfers,
    ledgerEntries,
    claimHistory,
    dailyClosings,
    senders,
    receivers,
  }
}

export function parseAppStateBackup(text) {
  const parsed = JSON.parse(text)

  if (!parsed || !Array.isArray(parsed.customers) || !Array.isArray(parsed.transfers)) {
    throw new Error('النسخة الاحتياطية غير صالحة.')
  }

  return migrateState({
    customers: parsed.customers.map((c) => ({
      openingBalance: 0,
      openingTransferCount: 0,
      settledTotal: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...c,
      name: normalizeName(c.name || ''),
    })),
    ledgerEntries: Array.isArray(parsed.ledgerEntries) ? parsed.ledgerEntries : undefined,
    claimHistory: Array.isArray(parsed.claimHistory) ? parsed.claimHistory : [],
    dailyClosings: Array.isArray(parsed.dailyClosings) ? parsed.dailyClosings : [],
    senders: Array.isArray(parsed.senders) ? parsed.senders : [],
    receivers: Array.isArray(parsed.receivers) ? parsed.receivers : [],
    transfers: parsed.transfers.map((t) => ({
      issueCode: '',
      note: '',
      transferAmount: null,
      systemAmount: null,
      customerAmount: null,
      margin: null,
      settled: false,
      settledAt: null,
      sentAt: null,
      pickedUpAt: null,
      issueAt: null,
      reviewHoldAt: null,
      resetAt: null,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...t,
      reference: normalizeReference(t.reference || ''),
    })),
  })
}
