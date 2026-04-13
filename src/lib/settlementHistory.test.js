import { describe, it, expect } from 'vitest'
import {
  buildSettlementHistory,
  summarizeSettlementHistory,
  filterSettlementEvents,
} from './settlementHistory'

const customers = [
  { id: 1, name: 'أحمد التاجر' },
  { id: 2, name: 'سعيد الوسيط' },
  { id: 3, name: 'كريم الوكيل', deletedAt: '2026-04-10T10:00:00.000Z' },
]

function makeTransfer(o) {
  return {
    id: o.id,
    customerId: o.customerId,
    senderName: o.senderName || 'م',
    receiverName: o.receiverName || 'ر',
    reference: o.reference || `REF-${o.id}`,
    status: o.status || 'picked_up',
    transferAmount: o.transferAmount ?? 100,
    customerAmount: o.customerAmount ?? 95,
    systemAmount: o.systemAmount ?? 105,
    margin: o.margin ?? 10,
    settled: o.settled ?? true,
    settledAt: o.settledAt ?? null,
    pickedUpAt: o.pickedUpAt || null,
    note: o.note || '',
    deletedAt: o.deletedAt || null,
    history: [],
    createdAt: o.createdAt || '2026-04-09T08:00:00.000Z',
    updatedAt: o.updatedAt || o.settledAt || '2026-04-09T08:00:00.000Z',
  }
}

describe('buildSettlementHistory', () => {
  it('groups regular settled transfers by (customerId, settledAt)', () => {
    const transfers = [
      makeTransfer({ id: 101, customerId: 1, settledAt: '2026-04-12T14:00:00.000Z', customerAmount: 200, systemAmount: 215, margin: 15 }),
      makeTransfer({ id: 102, customerId: 1, settledAt: '2026-04-12T14:00:00.000Z', customerAmount: 300, systemAmount: 320, margin: 20 }),
      makeTransfer({ id: 103, customerId: 2, settledAt: '2026-04-12T14:00:00.000Z', customerAmount: 50, systemAmount: 55, margin: 5 }),
    ]
    const events = buildSettlementHistory(transfers, [], customers)

    expect(events).toHaveLength(2)
    const ahmedEvent = events.find((e) => e.customerId === 1)
    expect(ahmedEvent.count).toBe(2)
    expect(ahmedEvent.totalCustomer).toBe(500)
    expect(ahmedEvent.totalSystem).toBe(535)
    expect(ahmedEvent.totalMargin).toBe(35)
    expect(ahmedEvent.kind).toBe('transfer')
    expect(ahmedEvent.customerName).toBe('أحمد التاجر')
  })

  it('different settledAt creates separate events even for same customer', () => {
    const transfers = [
      makeTransfer({ id: 1, customerId: 1, settledAt: '2026-04-10T10:00:00.000Z', customerAmount: 100 }),
      makeTransfer({ id: 2, customerId: 1, settledAt: '2026-04-12T10:00:00.000Z', customerAmount: 200 }),
    ]
    const events = buildSettlementHistory(transfers, [], customers)
    expect(events).toHaveLength(2)
    expect(events[0].settledAt).toBe('2026-04-12T10:00:00.000Z') // newest first
    expect(events[1].settledAt).toBe('2026-04-10T10:00:00.000Z')
  })

  it('skips soft-deleted transfers', () => {
    const transfers = [
      makeTransfer({ id: 1, customerId: 1, settledAt: '2026-04-10T10:00:00.000Z' }),
      makeTransfer({ id: 2, customerId: 1, settledAt: '2026-04-10T10:00:00.000Z', deletedAt: '2026-04-11T08:00:00.000Z' }),
    ]
    const events = buildSettlementHistory(transfers, [], customers)
    expect(events).toHaveLength(1)
    expect(events[0].count).toBe(1)
  })

  it('skips unsettled transfers', () => {
    const transfers = [
      makeTransfer({ id: 1, customerId: 1, settled: false, settledAt: null }),
      makeTransfer({ id: 2, customerId: 1, settledAt: '2026-04-10T10:00:00.000Z' }),
    ]
    const events = buildSettlementHistory(transfers, [], customers)
    expect(events).toHaveLength(1)
    expect(events[0].items[0].transferId).toBe(2)
  })

  it('opening_transfer_settlement entries become standalone events', () => {
    const ledgerEntries = [
      {
        id: 'opening-settlement-1-2026-04-12',
        customerId: 1,
        type: 'opening_transfer_settlement',
        amount: -3000,
        transferCount: 5,
        note: 'تسوية رصيد افتتاحي (5 حوالة)',
        createdAt: '2026-04-12T15:00:00.000Z',
        updatedAt: '2026-04-12T15:00:00.000Z',
      },
    ]
    const events = buildSettlementHistory([], ledgerEntries, customers)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('opening')
    expect(events[0].totalCustomer).toBe(3000)
    expect(events[0].count).toBe(5)
    expect(events[0].customerName).toBe('أحمد التاجر')
  })

  it('opening with transferCount=0 falls back to count=1', () => {
    const ledgerEntries = [
      { id: 'os-1', customerId: 1, type: 'opening_transfer_settlement', amount: -500, transferCount: 0, createdAt: '2026-04-12T15:00:00.000Z' },
    ]
    const events = buildSettlementHistory([], ledgerEntries, customers)
    expect(events[0].count).toBe(1)
  })

  it('mixed regular + opening events are sorted newest first', () => {
    const transfers = [
      makeTransfer({ id: 1, customerId: 1, settledAt: '2026-04-10T10:00:00.000Z' }),
    ]
    const ledgerEntries = [
      { id: 'os-1', customerId: 1, type: 'opening_transfer_settlement', amount: -1000, transferCount: 3, createdAt: '2026-04-13T10:00:00.000Z' },
      { id: 'os-2', customerId: 2, type: 'opening_transfer_settlement', amount: -500, transferCount: 2, createdAt: '2026-04-12T10:00:00.000Z' },
    ]
    const events = buildSettlementHistory(transfers, ledgerEntries, customers)
    expect(events).toHaveLength(3)
    expect(events[0].kind).toBe('opening')
    expect(events[0].settledAt).toBe('2026-04-13T10:00:00.000Z')
    expect(events[1].settledAt).toBe('2026-04-12T10:00:00.000Z')
    expect(events[2].settledAt).toBe('2026-04-10T10:00:00.000Z')
  })

  it('ignores other ledger entry types', () => {
    const ledgerEntries = [
      { id: 'ob-1', customerId: 1, type: 'opening_balance', amount: 1000, createdAt: '2026-04-01T08:00:00.000Z' },
      { id: 'ls-1', customerId: 1, type: 'legacy_settlement', amount: -500, createdAt: '2026-04-01T08:00:00.000Z' },
      { id: 'pc-1', customerId: 0, type: 'profit_claim', amount: -50, createdAt: '2026-04-12T10:00:00.000Z' },
      { id: 'td-1', customerId: 1, type: 'transfer_due', amount: 200, createdAt: '2026-04-10T10:00:00.000Z' },
    ]
    const events = buildSettlementHistory([], ledgerEntries, customers)
    expect(events).toHaveLength(0)
  })

  it('handles deleted customer name fallback gracefully', () => {
    const transfers = [
      makeTransfer({ id: 1, customerId: 3, settledAt: '2026-04-10T10:00:00.000Z' }),
    ]
    const events = buildSettlementHistory(transfers, [], customers)
    expect(events).toHaveLength(1)
    expect(events[0].customerName).toBe('كريم الوكيل')
  })

  it('handles empty inputs', () => {
    expect(buildSettlementHistory()).toEqual([])
    expect(buildSettlementHistory([], [], [])).toEqual([])
  })

  it('does NOT mutate inputs', () => {
    const transfers = [
      makeTransfer({ id: 1, customerId: 1, settledAt: '2026-04-10T10:00:00.000Z' }),
    ]
    const ledgerEntries = [
      { id: 'os-1', customerId: 1, type: 'opening_transfer_settlement', amount: -500, transferCount: 2, createdAt: '2026-04-12T10:00:00.000Z' },
    ]
    const tFreeze = JSON.parse(JSON.stringify(transfers))
    const lFreeze = JSON.parse(JSON.stringify(ledgerEntries))
    const cFreeze = JSON.parse(JSON.stringify(customers))

    buildSettlementHistory(transfers, ledgerEntries, customers)

    expect(transfers).toEqual(tFreeze)
    expect(ledgerEntries).toEqual(lFreeze)
    expect(customers).toEqual(cFreeze)
  })
})

describe('summarizeSettlementHistory', () => {
  it('aggregates totals and event counts', () => {
    const events = [
      { id: '1', kind: 'transfer', count: 3, totalCustomer: 600, totalSystem: 645, totalMargin: 45 },
      { id: '2', kind: 'transfer', count: 2, totalCustomer: 400, totalSystem: 440, totalMargin: 40 },
      { id: '3', kind: 'opening',  count: 5, totalCustomer: 2000, totalSystem: 0, totalMargin: 0 },
    ]
    const sum = summarizeSettlementHistory(events)
    expect(sum.eventCount).toBe(3)
    expect(sum.transferCount).toBe(10)
    expect(sum.totalCustomer).toBe(3000)
    expect(sum.totalSystem).toBe(1085)
    expect(sum.totalMargin).toBe(85)
    expect(sum.transferEvents).toBe(2)
    expect(sum.openingEvents).toBe(1)
  })

  it('handles empty input', () => {
    expect(summarizeSettlementHistory([])).toEqual({
      eventCount: 0,
      transferCount: 0,
      totalCustomer: 0,
      totalSystem: 0,
      totalMargin: 0,
      transferEvents: 0,
      openingEvents: 0,
    })
  })
})

describe('filterSettlementEvents', () => {
  const events = [
    { id: '1', kind: 'transfer', customerId: 1, customerName: 'أحمد', items: [{ reference: 'REF-100', senderName: 'م1', receiverName: 'ر1' }] },
    { id: '2', kind: 'transfer', customerId: 2, customerName: 'سعيد', items: [{ reference: 'REF-200', senderName: 'م2', receiverName: 'ر2' }] },
    { id: '3', kind: 'opening', customerId: 1, customerName: 'أحمد', items: [] },
  ]

  it('filters by customerId', () => {
    expect(filterSettlementEvents(events, { customerId: 1 })).toHaveLength(2)
    expect(filterSettlementEvents(events, { customerId: 2 })).toHaveLength(1)
  })

  it('returns all when customerId is "all"', () => {
    expect(filterSettlementEvents(events, { customerId: 'all' })).toHaveLength(3)
  })

  it('searches by customer name', () => {
    expect(filterSettlementEvents(events, { search: 'أحمد' })).toHaveLength(2)
  })

  it('searches by transfer reference', () => {
    expect(filterSettlementEvents(events, { search: 'REF-200' })).toHaveLength(1)
  })

  it('searches by sender / receiver', () => {
    expect(filterSettlementEvents(events, { search: 'ر1' })).toHaveLength(1)
  })

  it('combines filter and search', () => {
    expect(filterSettlementEvents(events, { customerId: 1, search: 'REF-100' })).toHaveLength(1)
  })

  it('empty inputs', () => {
    expect(filterSettlementEvents()).toEqual([])
    expect(filterSettlementEvents(events, {})).toHaveLength(3)
  })
})
