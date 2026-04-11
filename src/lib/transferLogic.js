export const FILTER_ALL = 'all'

export const statusOrder = [
  'new',
  'sent_to_operator',
  'under_review',
  'issue',
  'approved',
  'customer_confirmed',
  'sent_to_accountant',
  'paid',
  'closed',
]

export function createEmptyDraft() {
  return {
    senderName: '',
    receiverName: '',
    reference: '',
  }
}

export function normalizeReference(reference) {
  return reference.trim().toUpperCase()
}

export function computeMargin(systemAmount, customerAmount) {
  if (typeof systemAmount !== 'number' || typeof customerAmount !== 'number') {
    return null
  }

  return systemAmount - customerAmount
}

export function buildTransferFromDraft(draft, existingTransfers = []) {
  const senderName = draft.senderName.trim()
  const receiverName = draft.receiverName.trim()
  const reference = normalizeReference(draft.reference)

  if (!senderName || !receiverName || !reference) {
    return { ok: false, error: 'يجب إدخال اسم المرسل واسم المستلم ورقم الحوالة.' }
  }

  const duplicate = existingTransfers.some(
    (item) => normalizeReference(item.reference) === reference,
  )

  if (duplicate) {
    return { ok: false, error: 'رقم الحوالة موجود مسبقًا، راجع السجل بدل تكرارها.' }
  }

  const now = new Date()

  return {
    ok: true,
    value: {
      id: now.getTime(),
      reference,
      senderName,
      receiverName,
      status: 'new',
      issueCode: '',
      systemAmount: null,
      customerAmount: null,
      margin: null,
      paymentStatus: 'pending',
      note: 'تمت إضافتها يدويًا بانتظار إرسالها للموظف.',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  }
}

export function transitionTransfer(item, nextStatus) {
  const now = new Date().toISOString()
  const nextItem = {
    ...item,
    status: nextStatus,
    updatedAt: now,
  }

  if (nextStatus === 'issue') {
    nextItem.note = item.note || 'تحتاج متابعة لأن الموظف أشار إلى وجود مشكلة.'
    nextItem.paymentStatus = 'pending'
  }

  if (nextStatus === 'paid' || nextStatus === 'closed') {
    nextItem.paymentStatus = 'paid'
  }

  if (nextStatus !== 'issue') {
    nextItem.issueCode = ''
  }

  return nextItem
}

export function updateAmount(item, field, value) {
  const parsed = value === '' ? null : Number(value)

  if (Number.isNaN(parsed)) {
    return item
  }

  const nextItem = {
    ...item,
    [field]: parsed,
    updatedAt: new Date().toISOString(),
  }

  return {
    ...nextItem,
    margin: computeMargin(nextItem.systemAmount, nextItem.customerAmount),
  }
}

export function togglePayment(item) {
  const nextPaid = item.paymentStatus === 'paid' ? 'pending' : 'paid'
  const nextStatus =
    nextPaid === 'paid'
      ? item.status === 'closed'
        ? 'closed'
        : 'paid'
      : item.status === 'paid' || item.status === 'closed'
        ? 'sent_to_accountant'
        : item.status

  return {
    ...item,
    paymentStatus: nextPaid,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  }
}

export function updateTransferField(item, field, value) {
  return {
    ...item,
    [field]: value,
    updatedAt: new Date().toISOString(),
  }
}

export function filterTransfers(transfers, filters) {
  const normalizedSearch = filters.searchTerm.trim().toLowerCase()

  return transfers.filter((item) => {
    const matchesSearch =
      normalizedSearch === '' ||
      item.reference.toLowerCase().includes(normalizedSearch) ||
      item.senderName.toLowerCase().includes(normalizedSearch) ||
      item.receiverName.toLowerCase().includes(normalizedSearch) ||
      (item.note || '').toLowerCase().includes(normalizedSearch)

    const matchesStatus =
      filters.statusFilter === FILTER_ALL || item.status === filters.statusFilter

    const matchesPayment =
      filters.paymentFilter === FILTER_ALL || item.paymentStatus === filters.paymentFilter

    return matchesSearch && matchesStatus && matchesPayment
  })
}

export function sortTransfers(transfers, sortMode) {
  const sorted = [...transfers]

  switch (sortMode) {
    case 'oldest':
      sorted.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      return sorted
    case 'receiver':
      sorted.sort((a, b) => a.receiverName.localeCompare(b.receiverName, 'ar'))
      return sorted
    case 'sender':
      sorted.sort((a, b) => a.senderName.localeCompare(b.senderName, 'ar'))
      return sorted
    case 'latest':
    default:
      sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      return sorted
  }
}

export function summarizeTransfers(transfers) {
  const totalSystem = transfers.reduce(
    (sum, item) => sum + (typeof item.systemAmount === 'number' ? item.systemAmount : 0),
    0,
  )
  const totalCustomer = transfers.reduce(
    (sum, item) => sum + (typeof item.customerAmount === 'number' ? item.customerAmount : 0),
    0,
  )
  const totalMargin = transfers.reduce(
    (sum, item) => sum + (typeof item.margin === 'number' ? item.margin : 0),
    0,
  )
  const issueCount = transfers.filter((item) => item.status === 'issue').length
  const readyForAccountant = transfers.filter(
    (item) => item.status === 'customer_confirmed' || item.status === 'sent_to_accountant',
  )
  const paidToday = transfers.filter((item) => item.paymentStatus === 'paid')

  return {
    totalSystem,
    totalCustomer,
    totalMargin,
    issueCount,
    readyForAccountant,
    paidToday,
  }
}

export function serializeTransfers(transfers) {
  return JSON.stringify(transfers, null, 2)
}

export function parseTransfersBackup(text) {
  const parsed = JSON.parse(text)

  if (!Array.isArray(parsed)) {
    throw new Error('النسخة الاحتياطية غير صالحة.')
  }

  return parsed.map((item) => ({
    issueCode: '',
    note: '',
    paymentStatus: 'pending',
    systemAmount: null,
    customerAmount: null,
    margin: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...item,
    reference: normalizeReference(item.reference || ''),
  }))
}
