import { describe, it, expect } from 'vitest'
import {
  parseViewerCustomerId,
  filterStateForViewer,
  isViewerCustomerValid,
} from './viewerMode'

describe('parseViewerCustomerId', () => {
  it('returns null for empty/missing search string', () => {
    expect(parseViewerCustomerId('')).toBeNull()
    expect(parseViewerCustomerId(null)).toBeNull()
    expect(parseViewerCustomerId(undefined)).toBeNull()
  })

  it('returns null when no viewer param present', () => {
    expect(parseViewerCustomerId('?other=1')).toBeNull()
    expect(parseViewerCustomerId('?tab=transfers')).toBeNull()
  })

  it('returns the numeric id when viewer param is a valid bigint', () => {
    expect(parseViewerCustomerId('?viewer=1776004308716001')).toBe(1776004308716001)
    expect(parseViewerCustomerId('?viewer=42')).toBe(42)
  })

  it('handles leading/trailing whitespace and other params', () => {
    expect(parseViewerCustomerId('?foo=bar&viewer=42&baz=1')).toBe(42)
    expect(parseViewerCustomerId('?viewer=  100  ')).toBe(100)
  })

  it('returns null for non-numeric viewer values', () => {
    expect(parseViewerCustomerId('?viewer=abc')).toBeNull()
    expect(parseViewerCustomerId('?viewer=')).toBeNull()
    expect(parseViewerCustomerId('?viewer=12.34')).toBeNull()
    expect(parseViewerCustomerId('?viewer=-10')).toBeNull()
  })

  it('rejects scientific notation and other tricks', () => {
    expect(parseViewerCustomerId('?viewer=1e5')).toBeNull()
    expect(parseViewerCustomerId('?viewer=0x10')).toBeNull()
    expect(parseViewerCustomerId('?viewer=Infinity')).toBeNull()
  })

  it('rejects zero', () => {
    expect(parseViewerCustomerId('?viewer=0')).toBeNull()
  })
})

describe('isViewerCustomerValid', () => {
  const customers = [
    { id: 1, name: 'أحمد', deletedAt: null },
    { id: 2, name: 'محمد', deletedAt: '2026-04-01T00:00:00Z' },
    { id: 3, name: 'سعيد' }, // no deletedAt field
  ]

  it('returns true for an existing, non-deleted customer', () => {
    expect(isViewerCustomerValid(1, customers)).toBe(true)
    expect(isViewerCustomerValid(3, customers)).toBe(true)
  })

  it('returns false for a soft-deleted customer', () => {
    expect(isViewerCustomerValid(2, customers)).toBe(false)
  })

  it('returns false for a missing customer', () => {
    expect(isViewerCustomerValid(99, customers)).toBe(false)
  })

  it('returns false for null/undefined id', () => {
    expect(isViewerCustomerValid(null, customers)).toBe(false)
    expect(isViewerCustomerValid(undefined, customers)).toBe(false)
  })

  it('returns false for empty customers', () => {
    expect(isViewerCustomerValid(1, [])).toBe(false)
    expect(isViewerCustomerValid(1, null)).toBe(false)
  })
})

describe('filterStateForViewer', () => {
  /*
    Setup: an office with 3 customers, multiple transfers, ledger entries,
    daily closings, and senders/receivers. We test that filtering for
    customer #2 returns ONLY their slice — and that senders/receivers are
    INTENTIONALLY NOT filtered (per user spec — viewer sees real counts).
  */
  const baseState = {
    customers: [
      { id: 1, name: 'زبون أ' },
      { id: 2, name: 'بندريس' },
      { id: 3, name: 'زبون ج' },
    ],
    transfers: [
      { id: 100, customerId: 1, senderName: 'أحمد', receiverName: 'محمد' },
      { id: 101, customerId: 2, senderName: 'علي', receiverName: 'سعيد' },
      { id: 102, customerId: 2, senderName: 'علي', receiverName: 'حسن' },
      { id: 103, customerId: 3, senderName: 'خالد', receiverName: 'محمد' },
      { id: 104, customerId: 2, senderName: 'حسين', receiverName: 'يوسف' },
    ],
    ledgerEntries: [
      { id: 'L1', customerId: 1, type: 'opening_balance', amount: 100 },
      { id: 'L2', customerId: 2, type: 'opening_balance', amount: 500 },
      { id: 'L3', customerId: 2, type: 'opening_settlement', amount: -500 },
      { id: 'L4', customerId: 3, type: 'opening_balance', amount: 200 },
      { id: 'L5', type: 'profit_claim', amount: 1000 }, // no customerId — office wide
    ],
    claimHistory: [
      { id: 'C1', amount: 500, claimedAt: '2026-04-01' },
      { id: 'C2', amount: 800, claimedAt: '2026-04-05' },
    ],
    dailyClosings: [
      { id: 'D1', date: '2026-04-10', snapshot: { foo: 'bar' } },
      { id: 'D2', date: '2026-04-11', snapshot: { foo: 'baz' } },
    ],
    senders: [
      { id: 's1', name: 'أحمد', legacyCount: 5 },
      { id: 's2', name: 'علي', legacyCount: 3 },
      { id: 's3', name: 'خالد', legacyCount: 2 },
      { id: 's4', name: 'حسين', legacyCount: 1 },
    ],
    receivers: [
      { id: 'r1', name: 'محمد', legacyCount: 10 },
      { id: 'r2', name: 'سعيد', legacyCount: 4 },
      { id: 'r3', name: 'حسن', legacyCount: 2 },
      { id: 'r4', name: 'يوسف', legacyCount: 1 },
    ],
  }

  it('keeps only the viewer customer', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.customers).toHaveLength(1)
    expect(filtered.customers[0].id).toBe(2)
    expect(filtered.customers[0].name).toBe('بندريس')
  })

  it('keeps only transfers owned by the viewer customer', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.transfers).toHaveLength(3)
    const ids = filtered.transfers.map((t) => t.id).sort((a, b) => a - b)
    expect(ids).toEqual([101, 102, 104])
    // Verify NO transfer for customer 1 or 3 leaks
    expect(filtered.transfers.every((t) => t.customerId === 2)).toBe(true)
  })

  it('keeps only ledger entries belonging to viewer (drops office-wide profit claims)', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.ledgerEntries).toHaveLength(2)
    const ids = filtered.ledgerEntries.map((e) => e.id).sort()
    expect(ids).toEqual(['L2', 'L3'])
    // Office-wide entries must NOT leak
    expect(filtered.ledgerEntries.find((e) => e.type === 'profit_claim')).toBeUndefined()
  })

  it('returns empty claimHistory (office concern, never shown to viewer)', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.claimHistory).toEqual([])
  })

  it('returns empty dailyClosings (office concern, never shown to viewer)', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.dailyClosings).toEqual([])
  })

  it('keeps senders FULL — viewer sees real global counts (per user spec)', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.senders).toHaveLength(4)
    // Same identities, untouched
    expect(filtered.senders).toEqual(baseState.senders)
  })

  it('keeps receivers FULL — viewer sees real global counts (per user spec)', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.receivers).toHaveLength(4)
    expect(filtered.receivers).toEqual(baseState.receivers)
  })

  it('exposes original transfers under transfersForPeopleCounts so PeopleTab can show TRUE counts', () => {
    const filtered = filterStateForViewer(baseState, 2)
    expect(filtered.transfersForPeopleCounts).toHaveLength(5)
    expect(filtered.transfersForPeopleCounts).toEqual(baseState.transfers)
  })

  it('returns empty arrays when the customer has nothing', () => {
    const stateWithEmpty = {
      ...baseState,
      transfers: [{ id: 999, customerId: 1, senderName: 'x', receiverName: 'y' }],
      ledgerEntries: [{ id: 'L1', customerId: 1, type: 'opening_balance' }],
    }
    const filtered = filterStateForViewer(stateWithEmpty, 2)
    expect(filtered.customers).toHaveLength(1)
    expect(filtered.transfers).toEqual([])
    expect(filtered.ledgerEntries).toEqual([])
    // Senders/receivers still untouched
    expect(filtered.senders).toEqual(baseState.senders)
  })

  it('handles a state with missing arrays gracefully', () => {
    const partialState = { customers: [{ id: 2, name: 'بندريس' }], transfers: [] }
    const filtered = filterStateForViewer(partialState, 2)
    expect(filtered.customers).toHaveLength(1)
    expect(filtered.transfers).toEqual([])
    expect(filtered.ledgerEntries).toEqual([])
    expect(filtered.claimHistory).toEqual([])
    expect(filtered.dailyClosings).toEqual([])
    expect(filtered.senders).toEqual([])
    expect(filtered.receivers).toEqual([])
    expect(filtered.transfersForPeopleCounts).toEqual([])
  })

  it('returns immutable copies — filtering the same state twice gives identical results', () => {
    const a = filterStateForViewer(baseState, 2)
    const b = filterStateForViewer(baseState, 2)
    expect(a.customers).toEqual(b.customers)
    expect(a.transfers).toEqual(b.transfers)
    expect(a.ledgerEntries).toEqual(b.ledgerEntries)
    // Original is never mutated
    expect(baseState.transfers).toHaveLength(5)
    expect(baseState.customers).toHaveLength(3)
  })

  it('CRITICAL: never leaks another customer transfer when ids overlap by string equality', () => {
    // Edge case: customerId stored as string in some transfers
    const tricky = {
      ...baseState,
      transfers: [
        { id: 200, customerId: '2', senderName: 'x', receiverName: 'y' }, // STRING
        { id: 201, customerId: 2, senderName: 'a', receiverName: 'b' },   // NUMBER
      ],
    }
    const filtered = filterStateForViewer(tricky, 2)
    // Both should match since we compare via Number()
    expect(filtered.transfers).toHaveLength(2)
  })
})
