export const LEDGER_ENTRY_TYPES = {
  OPENING_BALANCE: 'opening_balance',
  LEGACY_SETTLEMENT: 'legacy_settlement',
  OPENING_TRANSFER_SETTLEMENT: 'opening_transfer_settlement',
  TRANSFER_DUE: 'transfer_due',
  TRANSFER_SETTLEMENT: 'transfer_settlement',
  PROFIT_CLAIM: 'profit_claim',
}

export const LEDGER_ENTRY_META = {
  [LEDGER_ENTRY_TYPES.OPENING_BALANCE]: {
    label: 'رصيد افتتاحي',
    direction: 'credit',
  },
  [LEDGER_ENTRY_TYPES.LEGACY_SETTLEMENT]: {
    label: 'تسوية سابقة',
    direction: 'debit',
  },
  [LEDGER_ENTRY_TYPES.OPENING_TRANSFER_SETTLEMENT]: {
    label: 'تسوية رصيد افتتاحي',
    direction: 'debit',
  },
  [LEDGER_ENTRY_TYPES.TRANSFER_DUE]: {
    label: 'استلام/استحقاق حوالة',
    direction: 'credit',
  },
  [LEDGER_ENTRY_TYPES.TRANSFER_SETTLEMENT]: {
    label: 'تسوية للزبون',
    direction: 'debit',
  },
  [LEDGER_ENTRY_TYPES.PROFIT_CLAIM]: {
    label: 'مطالبة ربح',
    direction: 'debit',
  },
}

function isoNow() {
  return new Date().toISOString()
}

function asNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0
}

function createEntry({
  id,
  customerId,
  type,
  amount,
  note = '',
  transferId = null,
  transferCount = 0,
  createdAt = isoNow(),
  updatedAt = createdAt,
}) {
  return {
    id,
    customerId,
    type,
    amount,
    note,
    transferId,
    transferCount,
    createdAt,
    updatedAt,
  }
}

export function buildOpeningBalanceEntry(customer) {
  if (!customer) return null
  const amount = asNumber(customer.openingBalance)
  if (!amount) return null
  return createEntry({
    id: `opening-${customer.id}`,
    customerId: customer.id,
    type: LEDGER_ENTRY_TYPES.OPENING_BALANCE,
    amount,
    note: customer.openingTransferCount
      ? `رصيد افتتاحي (${customer.openingTransferCount} حوالة)`
      : 'رصيد افتتاحي',
    transferCount: asNumber(customer.openingTransferCount),
    createdAt: customer.createdAt || isoNow(),
    updatedAt: customer.updatedAt || customer.createdAt || isoNow(),
  })
}

export function buildLegacySettlementEntry(customer) {
  if (!customer) return null
  const amount = asNumber(customer.settledTotal)
  if (!amount) return null
  return createEntry({
    id: `legacy-settlement-${customer.id}`,
    customerId: customer.id,
    type: LEDGER_ENTRY_TYPES.LEGACY_SETTLEMENT,
    amount: -Math.abs(amount),
    note: 'تسوية سابقة',
    createdAt: customer.createdAt || isoNow(),
    updatedAt: customer.updatedAt || customer.createdAt || isoNow(),
  })
}

export function buildSeedLedgerEntries(customers = []) {
  return customers.flatMap((customer) => {
    const opening = buildOpeningBalanceEntry(customer)
    const settlement = buildLegacySettlementEntry(customer)
    return [opening, settlement].filter(Boolean)
  })
}

export function createOpeningSettlementEntry(customerId, amount, transferCount = 0) {
  const normalizedAmount = Math.abs(asNumber(amount))
  const normalizedCount = Math.max(0, Math.trunc(asNumber(transferCount)))
  if (!normalizedAmount) return null
  const createdAt = isoNow()

  return createEntry({
    id: `opening-settlement-${customerId}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    customerId,
    type: LEDGER_ENTRY_TYPES.OPENING_TRANSFER_SETTLEMENT,
    amount: -normalizedAmount,
    note: normalizedCount ? `تسوية رصيد افتتاحي (${normalizedCount} حوالة)` : 'تسوية رصيد افتتاحي',
    transferCount: normalizedCount,
    createdAt,
    updatedAt: createdAt,
  })
}

export function buildTransferLedgerEntries(transfers = []) {
  return transfers.flatMap((transfer) => {
    if (transfer.status !== 'picked_up' || typeof transfer.customerAmount !== 'number') {
      return []
    }

    const dueEntry = createEntry({
      id: `transfer-due-${transfer.id}`,
      customerId: transfer.customerId,
      type: LEDGER_ENTRY_TYPES.TRANSFER_DUE,
      amount: transfer.customerAmount,
      note: `استحقاق حوالة ${transfer.reference}`,
      transferId: transfer.id,
      createdAt: transfer.pickedUpAt || transfer.updatedAt || transfer.createdAt || isoNow(),
      updatedAt: transfer.updatedAt || transfer.pickedUpAt || transfer.createdAt || isoNow(),
    })

    if (!transfer.settled) return [dueEntry]

    const settlementEntry = createEntry({
      id: `transfer-settlement-${transfer.id}`,
      customerId: transfer.customerId,
      type: LEDGER_ENTRY_TYPES.TRANSFER_SETTLEMENT,
      amount: -Math.abs(transfer.customerAmount),
      note: `تسوية حوالة ${transfer.reference}`,
      transferId: transfer.id,
      createdAt: transfer.settledAt || transfer.createdAt || isoNow(),
      updatedAt: transfer.updatedAt || transfer.settledAt || transfer.createdAt || isoNow(),
    })

    return [dueEntry, settlementEntry]
  })
}

export function buildLedgerEntries(transfers = [], persistedEntries = []) {
  const stableEntries = Array.isArray(persistedEntries) ? persistedEntries : []
  const transferEntries = buildTransferLedgerEntries(transfers)

  return [...stableEntries, ...transferEntries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}

export function summarizeLedgerByCustomer(customers = [], transfers = [], persistedEntries = []) {
  const ledgerEntries = buildLedgerEntries(transfers, persistedEntries)
  const byCustomer = new Map()

  for (const customer of customers) {
    byCustomer.set(customer.id, {
      currentBalance: 0,
      ledgerCredits: 0,
      ledgerDebits: 0,
      manualEntriesCount: 0,
      ledgerEntriesCount: 0,
      openingOutstandingAmount: 0,
      openingOutstandingTransferCount: Math.max(0, Math.trunc(asNumber(customer.openingTransferCount))),
    })
  }

  for (const entry of ledgerEntries) {
    const bucket = byCustomer.get(entry.customerId)
    if (!bucket) continue
    bucket.currentBalance += entry.amount
    bucket.ledgerEntriesCount += 1

    if (entry.amount >= 0) bucket.ledgerCredits += entry.amount
    else bucket.ledgerDebits += Math.abs(entry.amount)

    if (
      entry.type === LEDGER_ENTRY_TYPES.OPENING_BALANCE ||
      entry.type === LEDGER_ENTRY_TYPES.LEGACY_SETTLEMENT ||
      entry.type === LEDGER_ENTRY_TYPES.OPENING_TRANSFER_SETTLEMENT
    ) {
      bucket.manualEntriesCount += 1
    }

    if (
      entry.type === LEDGER_ENTRY_TYPES.OPENING_BALANCE ||
      entry.type === LEDGER_ENTRY_TYPES.LEGACY_SETTLEMENT ||
      entry.type === LEDGER_ENTRY_TYPES.OPENING_TRANSFER_SETTLEMENT
    ) {
      bucket.openingOutstandingAmount += entry.amount
    }

    if (entry.type === LEDGER_ENTRY_TYPES.OPENING_TRANSFER_SETTLEMENT) {
      bucket.openingOutstandingTransferCount = Math.max(
        0,
        bucket.openingOutstandingTransferCount - Math.max(0, Math.trunc(asNumber(entry.transferCount))),
      )
    }
  }

  for (const bucket of byCustomer.values()) {
    bucket.openingOutstandingAmount = Math.max(bucket.openingOutstandingAmount, 0)
    if (bucket.openingOutstandingAmount === 0) {
      bucket.openingOutstandingTransferCount = 0
    }
  }

  return byCustomer
}

export function buildCustomerStatement(customers = [], transfers = [], persistedEntries = [], customerId) {
  const customer = customers.find((item) => item.id === customerId)
  if (!customer) return []

  const transfersById = new Map(transfers.map((item) => [item.id, item]))
  const entries = buildLedgerEntries(transfers, persistedEntries)
    .filter((entry) => entry.customerId === customerId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  let runningBalance = 0

  return entries.map((entry) => {
    runningBalance += entry.amount
    const meta = LEDGER_ENTRY_META[entry.type] || {
      label: entry.type,
      direction: entry.amount >= 0 ? 'credit' : 'debit',
    }
    const transfer = entry.transferId ? transfersById.get(entry.transferId) : null

    return {
      ...entry,
      customerName: customer.name,
      label: meta.label,
      direction: meta.direction,
      reference: transfer?.reference || '-',
      senderName: transfer?.senderName || '-',
      runningBalance,
    }
  })
}

export function summarizeOfficeLedger(customers = [], transfers = [], persistedEntries = []) {
  const customerSummary = summarizeLedgerByCustomer(customers, transfers, persistedEntries)
  const pickedUp = transfers.filter((transfer) => transfer.status === 'picked_up')
  const openingBalanceTotal = persistedEntries
    .filter((entry) => entry.type === LEDGER_ENTRY_TYPES.OPENING_BALANCE)
    .reduce((sum, entry) => sum + Math.max(entry.amount || 0, 0), 0)
  const legacySettlementsTotal = persistedEntries
    .filter((entry) => entry.type === LEDGER_ENTRY_TYPES.LEGACY_SETTLEMENT)
    .reduce((sum, entry) => sum + Math.abs(entry.amount || 0), 0)
  const openingSettlementsTotal = persistedEntries
    .filter((entry) => entry.type === LEDGER_ENTRY_TYPES.OPENING_TRANSFER_SETTLEMENT)
    .reduce((sum, entry) => sum + Math.abs(entry.amount || 0), 0)

  const officeCustomerLiability = [...customerSummary.values()].reduce(
    (sum, item) => sum + Math.max(item.currentBalance, 0),
    0,
  )
  const accountantSystemReceived = openingBalanceTotal + pickedUp.reduce(
    (sum, transfer) => sum + (typeof transfer.systemAmount === 'number' ? transfer.systemAmount : 0),
    0,
  )
  const accountantCustomerPaid = legacySettlementsTotal + openingSettlementsTotal + pickedUp
    .filter((transfer) => transfer.settled)
    .reduce((sum, transfer) => sum + (typeof transfer.customerAmount === 'number' ? transfer.customerAmount : 0), 0)
  const accountantOutstandingCustomer = officeCustomerLiability
  const accountantGrossMargin = pickedUp.reduce(
    (sum, transfer) => sum + (typeof transfer.margin === 'number' ? transfer.margin : 0),
    0,
  )
  const accountantRealizedMargin = pickedUp
    .filter((transfer) => transfer.settled)
    .reduce((sum, transfer) => sum + (typeof transfer.margin === 'number' ? transfer.margin : 0), 0)
  const claimHistory = persistedEntries
    .filter((entry) => entry.type === LEDGER_ENTRY_TYPES.PROFIT_CLAIM)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const claimedProfit = claimHistory.reduce((sum, entry) => sum + Math.abs(entry.amount || 0), 0)
  const claimableProfit = Math.max(accountantRealizedMargin - claimedProfit, 0)
  const pendingProfit = Math.max(accountantGrossMargin - accountantRealizedMargin, 0)
  const accountantCashOnHand = accountantSystemReceived - accountantCustomerPaid - accountantOutstandingCustomer - claimedProfit
  const totalRunningBalance = [...customerSummary.values()].reduce(
    (sum, item) => sum + item.currentBalance,
    0,
  )

  return {
    officeCustomerLiability,
    accountantSystemReceived,
    accountantCustomerPaid,
    accountantOutstandingCustomer,
    accountantGrossMargin,
    accountantRealizedMargin,
    accountantClaimedProfit: claimedProfit,
    accountantClaimableProfit: claimableProfit,
    accountantPendingProfit: pendingProfit,
    accountantCashOnHand,
    claimHistory,
    totalRunningBalance,
  }
}

export function groupUnsettledTransfersByCustomer(customers = [], transfers = []) {
  return groupPendingSettlementItems(customers, transfers, [])
}

export function groupPendingSettlementItems(customers = [], transfers = [], persistedEntries = []) {
  const customersById = new Map(customers.map((customer) => [customer.id, customer]))
  const ledgerSummary = summarizeLedgerByCustomer(customers, transfers, persistedEntries)
  const groups = new Map()

  for (const transfer of transfers) {
    if (transfer.status !== 'picked_up' || transfer.settled) continue

    if (!groups.has(transfer.customerId)) {
      groups.set(transfer.customerId, {
        customerId: transfer.customerId,
        customerName: customersById.get(transfer.customerId)?.name || 'غير معروف',
        items: [],
        systemTotal: 0,
        customerTotal: 0,
        marginTotal: 0,
      })
    }

    const group = groups.get(transfer.customerId)
    group.items.push(transfer)
    group.systemTotal += asNumber(transfer.systemAmount)
    group.customerTotal += asNumber(transfer.customerAmount)
    group.marginTotal += asNumber(transfer.margin)
  }

  for (const customer of customers) {
    const ledger = ledgerSummary.get(customer.id)
    if (!ledger || ledger.openingOutstandingAmount <= 0) continue

    if (!groups.has(customer.id)) {
      groups.set(customer.id, {
        customerId: customer.id,
        customerName: customersById.get(customer.id)?.name || 'غير معروف',
        items: [],
        systemTotal: 0,
        customerTotal: 0,
        marginTotal: 0,
      })
    }

    const group = groups.get(customer.id)
    group.items.unshift({
      id: `opening:${customer.id}`,
      customerId: customer.id,
      reference: 'رصيد افتتاحي',
      senderName: ledger.openingOutstandingTransferCount
        ? `${ledger.openingOutstandingTransferCount} حوالة سابقة`
        : 'رصيد سابق',
      createdAt: customer.createdAt || isoNow(),
      systemAmount: ledger.openingOutstandingAmount,
      customerAmount: ledger.openingOutstandingAmount,
      margin: 0,
      settled: false,
      kind: 'opening_balance',
      openingTransferCount: ledger.openingOutstandingTransferCount,
    })
    group.systemTotal += ledger.openingOutstandingAmount
    group.customerTotal += ledger.openingOutstandingAmount
  }

  return [...groups.values()].sort((a, b) => b.customerTotal - a.customerTotal)
}

export function createProfitClaimEntry(amount) {
  const normalizedAmount = Math.abs(asNumber(amount))
  const createdAt = isoNow()

  return createEntry({
    id: `profit-claim-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    customerId: 0,
    type: LEDGER_ENTRY_TYPES.PROFIT_CLAIM,
    amount: -normalizedAmount,
    note: 'مطالبة ربح',
    createdAt,
    updatedAt: createdAt,
  })
}
