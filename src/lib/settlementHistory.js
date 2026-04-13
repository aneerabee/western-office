/*
  Settlement history — READ-ONLY view of past settlement events.

  Reads from existing fields without modifying anything:
  - transfers with `settled === true` and `settledAt` (regular transfer settlements)
  - ledgerEntries with type `opening_transfer_settlement` (opening balance settlements)

  Groups regular transfer settlements by (customerId, settledAt). When the
  operator confirms a batch of selected items in SettlementsTab, all of them
  receive the SAME `settledAt` timestamp via `settleTransfers` — so identical
  timestamps reliably identify a single settlement event.

  Opening-balance settlements are independent ledger entries with their own
  `createdAt` and become standalone events.

  This module NEVER mutates its inputs.
*/

const OPENING_SETTLEMENT_TYPE = 'opening_transfer_settlement'

function safeNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0
}

function getCustomerName(customersById, customerId) {
  if (!customersById) return ''
  const customer = customersById.get
    ? customersById.get(customerId)
    : customersById[customerId]
  return customer?.name || ''
}

/**
 * Build the full chronological settlement history.
 *
 * @param {Array} transfers - all transfers (active + soft-deleted are skipped)
 * @param {Array} ledgerEntries - all ledger entries (deleted entries skipped)
 * @param {Array} customers - all customers (used to look up names; deleted ok)
 * @returns {Array<SettlementEvent>} sorted from newest to oldest
 */
export function buildSettlementHistory(transfers = [], ledgerEntries = [], customers = []) {
  const customersById = new Map(customers.map((c) => [c.id, c]))
  const events = []

  // ── Group regular transfer settlements ──
  // Key = `${customerId}|${settledAt}` to identify one batch settlement event
  const transferGroups = new Map()
  for (const t of transfers) {
    if (!t || t.deletedAt) continue
    if (!t.settled || !t.settledAt) continue
    const key = `${t.customerId}|${t.settledAt}`
    if (!transferGroups.has(key)) {
      transferGroups.set(key, {
        customerId: t.customerId,
        settledAt: t.settledAt,
        items: [],
      })
    }
    transferGroups.get(key).items.push({
      transferId: t.id,
      reference: t.reference,
      senderName: t.senderName,
      receiverName: t.receiverName,
      transferAmount: t.transferAmount,
      customerAmount: t.customerAmount,
      systemAmount: t.systemAmount,
      margin: t.margin,
      pickedUpAt: t.pickedUpAt,
      note: t.note || '',
    })
  }

  for (const [key, group] of transferGroups.entries()) {
    const totalCustomer = group.items.reduce((s, i) => s + safeNumber(i.customerAmount), 0)
    const totalSystem = group.items.reduce((s, i) => s + safeNumber(i.systemAmount), 0)
    const totalMargin = group.items.reduce((s, i) => s + safeNumber(i.margin), 0)
    events.push({
      id: `settlement-batch-${key}`,
      kind: 'transfer',
      settledAt: group.settledAt,
      customerId: group.customerId,
      customerName: getCustomerName(customersById, group.customerId),
      count: group.items.length,
      items: group.items,
      totalCustomer,
      totalSystem,
      totalMargin,
      note: '',
    })
  }

  // ── Opening-balance settlements (one ledger entry = one event) ──
  for (const entry of ledgerEntries) {
    if (!entry || entry.type !== OPENING_SETTLEMENT_TYPE) continue
    if (entry.deletedAt) continue
    const amount = Math.abs(safeNumber(entry.amount))
    const transferCount = Math.max(0, Math.trunc(safeNumber(entry.transferCount)))
    events.push({
      id: `settlement-opening-${entry.id}`,
      kind: 'opening',
      settledAt: entry.createdAt,
      customerId: entry.customerId,
      customerName: getCustomerName(customersById, entry.customerId),
      count: transferCount || 1,
      items: [],
      totalCustomer: amount,
      totalSystem: 0,
      totalMargin: 0,
      note: entry.note || 'تسوية رصيد افتتاحي',
    })
  }

  events.sort((a, b) => {
    const ta = new Date(a.settledAt).getTime() || 0
    const tb = new Date(b.settledAt).getTime() || 0
    return tb - ta
  })

  return events
}

/**
 * Top-level totals across all settlement events.
 * Pure summarization — does not mutate inputs.
 */
export function summarizeSettlementHistory(events = []) {
  return events.reduce(
    (acc, ev) => ({
      eventCount: acc.eventCount + 1,
      transferCount: acc.transferCount + (ev.count || 0),
      totalCustomer: acc.totalCustomer + safeNumber(ev.totalCustomer),
      totalSystem: acc.totalSystem + safeNumber(ev.totalSystem),
      totalMargin: acc.totalMargin + safeNumber(ev.totalMargin),
      transferEvents: acc.transferEvents + (ev.kind === 'transfer' ? 1 : 0),
      openingEvents: acc.openingEvents + (ev.kind === 'opening' ? 1 : 0),
    }),
    {
      eventCount: 0,
      transferCount: 0,
      totalCustomer: 0,
      totalSystem: 0,
      totalMargin: 0,
      transferEvents: 0,
      openingEvents: 0,
    },
  )
}

/**
 * Filter events by customer name and reference search.
 */
export function filterSettlementEvents(events = [], { customerId = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return events.filter((ev) => {
    if (customerId !== 'all' && ev.customerId !== customerId) return false
    if (!q) return true
    if ((ev.customerName || '').toLowerCase().includes(q)) return true
    return (ev.items || []).some(
      (item) =>
        (item.reference || '').toLowerCase().includes(q) ||
        (item.senderName || '').toLowerCase().includes(q) ||
        (item.receiverName || '').toLowerCase().includes(q),
    )
  })
}
