import { buildSeedLedgerEntries, summarizeLedgerByCustomer } from './ledger'

export const FILTER_ALL = 'all'

export const statusOrder = ['received', 'with_employee', 'review_hold', 'picked_up', 'issue']

/* ── Drafts ── */

export function createEmptyTransferDraft() {
  return {
    customerId: '',
    senderName: '',
    reference: '',
    transferAmount: '',
    customerAmount: '',
  }
}

export function createEmptyCustomerDraft() {
  return { name: '', openingBalance: '', openingTransferCount: '', settledTotal: '' }
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
      id: now.getTime(),
      name,
      openingBalance: parseMoney(draft.openingBalance),
      openingTransferCount: Math.max(0, Math.trunc(parseMoney(draft.openingTransferCount))),
      settledTotal: parseMoney(draft.settledTotal),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  }
}

export function buildTransferFromDraft(draft, existingTransfers = [], customers = []) {
  const senderName = normalizeName(draft.senderName)
  const reference = normalizeReference(draft.reference)
  const customerId = Number(draft.customerId)
  const customer = customers.find((c) => c.id === customerId)

  if (!customer) return { ok: false, error: 'يجب اختيار الزبون من القائمة.' }
  if (!senderName) return { ok: false, error: 'يجب إدخال اسم المرسل.' }
  if (!reference) return { ok: false, error: 'يجب إدخال رقم الحوالة.' }

  const dup = existingTransfers.some((t) => normalizeReference(t.reference) === reference)
  if (dup) return { ok: false, error: 'رقم الحوالة موجود مسبقًا.' }

  const transferAmount = draft.transferAmount === '' ? null : Number(draft.transferAmount)
  const customerAmount = draft.customerAmount === '' ? null : Number(draft.customerAmount)

  const now = new Date()
  return {
    ok: true,
    value: {
      id: now.getTime(),
      customerId,
      senderName,
      receiverName: customer.name,
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

export function updateAmount(item, field, value) {
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

export function summarizeTransfers(transfers) {
  const pickedUp = transfers.filter((t) => t.status === 'picked_up')
  const unsettled = pickedUp.filter((t) => !t.settled)

  const totalSystem = pickedUp.reduce(
    (s, t) => s + (typeof t.systemAmount === 'number' ? t.systemAmount : 0), 0,
  )
  const totalCustomer = pickedUp.reduce(
    (s, t) => s + (typeof t.customerAmount === 'number' ? t.customerAmount : 0), 0,
  )
  const totalMargin = pickedUp.reduce(
    (s, t) => s + (typeof t.margin === 'number' ? t.margin : 0), 0,
  )

  const accountantPending = unsettled.reduce(
    (s, t) => s + (typeof t.systemAmount === 'number' ? t.systemAmount : 0), 0,
  )
  const customerOwed = unsettled.reduce(
    (s, t) => s + (typeof t.customerAmount === 'number' ? t.customerAmount : 0), 0,
  )

  return {
    total: transfers.length,
    receivedCount: transfers.filter((t) => t.status === 'received').length,
    withEmployeeCount: transfers.filter((t) => t.status === 'with_employee').length,
    reviewHoldCount: transfers.filter((t) => t.status === 'review_hold').length,
    pickedUpCount: pickedUp.length,
    issueCount: transfers.filter((t) => t.status === 'issue').length,
    settledCount: pickedUp.filter((t) => t.settled).length,
    unsettledCount: unsettled.length,
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

  return {
    customers,
    transfers,
    ledgerEntries,
    claimHistory,
    dailyClosings,
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
