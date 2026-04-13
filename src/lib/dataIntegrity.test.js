import { describe, it, expect } from 'vitest'
import {
  migrateState,
  parseAppStateBackup,
  serializeAppState,
  summarizeTransfers,
  summarizeCustomers,
  filterTransfers,
  sortTransfers,
  transitionTransfer,
  updateAmount,
  updateTransferField,
  settleTransfers,
} from './transferLogic'
import {
  summarizeOfficeLedger,
  summarizeLedgerByCustomer,
  buildCustomerStatement,
  groupPendingSettlementItems,
} from './ledger'
import { computeDailyClosing, createDailyClosingRecord } from './dailyClosing'

/*
  This test suite exists to PROTECT the user's real data.
  Any change in code that touches, modifies, or drops existing fields on
  customers, transfers, ledger entries, claim history, or daily closings
  must cause these tests to fail. Update them only when you have explicit
  permission to change the data contract.
*/

const REAL_CUSTOMER = Object.freeze({
  id: 1700000000001,
  name: 'أحمد التاجر',
  openingBalance: 3585,
  openingTransferCount: 12,
  settledTotal: 1000,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-04-10T12:00:00.000Z',
})

const REAL_CUSTOMER_2 = Object.freeze({
  id: 1700000000002,
  name: 'سعيد الوسيط',
  openingBalance: 500,
  openingTransferCount: 3,
  settledTotal: 0,
  createdAt: '2026-03-15T11:00:00.000Z',
  updatedAt: '2026-03-15T11:00:00.000Z',
})

const REAL_TRANSFER_PICKED = Object.freeze({
  id: 1700000010001,
  customerId: 1700000000001,
  senderName: 'محمد المرسل',
  receiverName: 'علي المستلم',
  reference: 'REF-0001',
  status: 'picked_up',
  issueCode: '',
  transferAmount: 500,
  systemAmount: 510,
  customerAmount: 495,
  margin: 15,
  settled: true,
  settledAt: '2026-04-09T14:00:00.000Z',
  note: 'ملاحظة تجريبية',
  sentAt: '2026-04-09T10:00:00.000Z',
  pickedUpAt: '2026-04-09T13:00:00.000Z',
  issueAt: null,
  reviewHoldAt: null,
  resetAt: null,
  history: Object.freeze([
    Object.freeze({ field: 'status', from: 'received', to: 'with_employee', at: '2026-04-09T10:00:00.000Z' }),
    Object.freeze({ field: 'status', from: 'with_employee', to: 'picked_up', at: '2026-04-09T13:00:00.000Z' }),
  ]),
  createdAt: '2026-04-09T09:00:00.000Z',
  updatedAt: '2026-04-09T14:00:00.000Z',
})

const REAL_TRANSFER_ACTIVE = Object.freeze({
  id: 1700000010002,
  customerId: 1700000000002,
  senderName: 'محمد المرسل',
  receiverName: 'علي المستلم',
  reference: 'REF-0002',
  status: 'with_employee',
  issueCode: '',
  transferAmount: 300,
  systemAmount: null,
  customerAmount: 290,
  margin: null,
  settled: false,
  settledAt: null,
  note: '',
  sentAt: '2026-04-12T10:00:00.000Z',
  pickedUpAt: null,
  issueAt: null,
  reviewHoldAt: null,
  resetAt: null,
  history: Object.freeze([
    Object.freeze({ field: 'status', from: 'received', to: 'with_employee', at: '2026-04-12T10:00:00.000Z' }),
  ]),
  createdAt: '2026-04-12T09:00:00.000Z',
  updatedAt: '2026-04-12T10:00:00.000Z',
})

const REAL_LEDGER_OPENING = Object.freeze({
  id: 'opening-1700000000001',
  customerId: 1700000000001,
  type: 'opening_balance',
  amount: 3585,
  note: 'رصيد افتتاحي (12 حوالة)',
  transferId: null,
  transferCount: 12,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
})

const REAL_LEDGER_LEGACY = Object.freeze({
  id: 'legacy-settlement-1700000000001',
  customerId: 1700000000001,
  type: 'legacy_settlement',
  amount: -1000,
  note: 'تسوية سابقة',
  transferId: null,
  transferCount: 0,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
})

const REAL_CLAIM = Object.freeze({
  id: 1700000020001,
  customerId: 0,
  type: 'profit_claim',
  amount: -15,
  note: 'مطالبة ربح',
  transferId: null,
  transferCount: 0,
  createdAt: '2026-04-10T08:00:00.000Z',
  updatedAt: '2026-04-10T08:00:00.000Z',
})

function buildRealState() {
  return {
    customers: [{ ...REAL_CUSTOMER }, { ...REAL_CUSTOMER_2 }],
    transfers: [
      { ...REAL_TRANSFER_PICKED, history: REAL_TRANSFER_PICKED.history.map((h) => ({ ...h })) },
      { ...REAL_TRANSFER_ACTIVE, history: REAL_TRANSFER_ACTIVE.history.map((h) => ({ ...h })) },
    ],
    ledgerEntries: [{ ...REAL_LEDGER_OPENING }, { ...REAL_LEDGER_LEGACY }],
    claimHistory: [{ ...REAL_CLAIM }],
    dailyClosings: [],
  }
}

function assertPreserved(source, result) {
  for (const key of Object.keys(source)) {
    expect(result[key]).toEqual(source[key])
  }
}

describe('Data integrity — existing fields must never be dropped or modified', () => {
  it('migrateState preserves every existing customer field', () => {
    const state = buildRealState()
    const migrated = migrateState(state)

    for (const original of state.customers) {
      const found = migrated.customers.find((c) => c.id === original.id)
      expect(found).toBeDefined()
      assertPreserved(original, found)
    }
  })

  it('migrateState preserves every existing transfer field (including history)', () => {
    const state = buildRealState()
    const migrated = migrateState(state)

    for (const original of state.transfers) {
      const found = migrated.transfers.find((t) => t.id === original.id)
      expect(found).toBeDefined()
      for (const key of Object.keys(original)) {
        if (key === 'history') {
          expect(found.history).toHaveLength(original.history.length)
          original.history.forEach((entry, idx) => {
            expect(found.history[idx]).toEqual(entry)
          })
        } else {
          expect(found[key]).toEqual(original[key])
        }
      }
    }
  })

  it('migrateState preserves every existing ledger entry field', () => {
    const state = buildRealState()
    const migrated = migrateState(state)

    for (const original of state.ledgerEntries) {
      const found = migrated.ledgerEntries.find((e) => e.id === original.id)
      expect(found).toBeDefined()
      assertPreserved(original, found)
    }
  })

  it('migrateState preserves every existing claim history entry', () => {
    const state = buildRealState()
    const migrated = migrateState(state)

    for (const original of state.claimHistory) {
      const found = migrated.claimHistory.find((c) => c.id === original.id)
      expect(found).toBeDefined()
      assertPreserved(original, found)
    }
  })

  it('summarize/filter/sort functions do not mutate inputs', () => {
    const state = buildRealState()
    const frozen = JSON.parse(JSON.stringify(state))

    summarizeTransfers(state.transfers, state.ledgerEntries, state.customers)
    summarizeCustomers(state.customers, state.transfers, state.ledgerEntries)
    summarizeOfficeLedger(state.customers, state.transfers, state.ledgerEntries)
    summarizeLedgerByCustomer(state.customers, state.transfers, state.ledgerEntries)
    groupPendingSettlementItems(state.customers, state.transfers, state.ledgerEntries)
    filterTransfers(
      state.transfers,
      { searchTerm: '', statusFilter: 'all', viewMode: 'all', customerFilter: 'all', dateFrom: '', dateTo: '' },
      new Map(state.customers.map((c) => [c.id, c])),
    )
    sortTransfers(state.transfers, 'smart', new Map())
    buildCustomerStatement(state.customers, state.transfers, state.ledgerEntries, state.customers[0].id)

    expect(state).toEqual(frozen)
  })

  it('transition and update helpers return new objects without mutating the original', () => {
    const state = buildRealState()
    const [, activeTransfer] = state.transfers
    const frozenBefore = JSON.parse(JSON.stringify(activeTransfer))

    const updated = updateAmount(activeTransfer, 'systemAmount', 305)
    expect(activeTransfer).toEqual(frozenBefore)
    expect(updated.systemAmount).toBe(305)
    expect(updated).not.toBe(activeTransfer)

    const withNote = updateTransferField(activeTransfer, 'note', 'new note')
    expect(activeTransfer).toEqual(frozenBefore)
    expect(withNote.note).toBe('new note')

    const transitioned = transitionTransfer(activeTransfer, 'picked_up')
    expect(activeTransfer).toEqual(frozenBefore)
    expect(transitioned.status).toBe('picked_up')

    const settled = settleTransfers(state.transfers, [state.transfers[0].id])
    expect(state.transfers[0].settled).toBe(true) // was already settled
    expect(settled[0]).toEqual(state.transfers[0])
  })

  it('serialize + parseAppStateBackup roundtrip keeps all fields byte-identical', () => {
    const migrated = migrateState(buildRealState())
    const json = serializeAppState(migrated)
    const restored = parseAppStateBackup(json)

    for (const original of migrated.customers) {
      const found = restored.customers.find((c) => c.id === original.id)
      expect(found).toBeDefined()
      assertPreserved(original, found)
    }

    for (const original of migrated.transfers) {
      const found = restored.transfers.find((t) => t.id === original.id)
      expect(found).toBeDefined()
      for (const key of Object.keys(original)) {
        expect(found[key]).toEqual(original[key])
      }
    }

    for (const original of migrated.ledgerEntries) {
      const found = restored.ledgerEntries.find((e) => e.id === original.id)
      expect(found).toBeDefined()
      assertPreserved(original, found)
    }

    for (const original of migrated.claimHistory) {
      const found = restored.claimHistory.find((c) => c.id === original.id)
      expect(found).toBeDefined()
      assertPreserved(original, found)
    }
  })

  it('computeDailyClosing + createDailyClosingRecord do not mutate transfers/ledger/claim', () => {
    const state = buildRealState()
    const frozen = JSON.parse(JSON.stringify(state))

    const customerSummary = summarizeCustomers(state.customers, state.transfers, state.ledgerEntries)
    const nonClaim = state.ledgerEntries.filter((e) => e.type !== 'profit_claim')
    const office = summarizeOfficeLedger(
      state.customers,
      state.transfers,
      [...nonClaim, ...state.claimHistory],
    )
    const closing = computeDailyClosing(
      state.transfers,
      customerSummary,
      office,
      state.claimHistory,
      '2026-04-09',
    )
    const record = createDailyClosingRecord(closing)
    expect(record.snapshot).toBeDefined()

    expect(state).toEqual(frozen)
  })

  it('never invents IDs for existing items during migration', () => {
    const state = buildRealState()
    const migrated = migrateState(state)
    expect(migrated.customers.map((c) => c.id)).toEqual(state.customers.map((c) => c.id))
    expect(migrated.transfers.map((t) => t.id)).toEqual(state.transfers.map((t) => t.id))
    expect(migrated.ledgerEntries.map((e) => e.id)).toEqual(state.ledgerEntries.map((e) => e.id))
    expect(migrated.claimHistory.map((c) => c.id)).toEqual(state.claimHistory.map((c) => c.id))
  })

  it('migrateState leaves deletedAt alone for soft-deleted items', () => {
    const state = buildRealState()
    state.transfers[1].deletedAt = '2026-04-12T11:00:00.000Z'
    state.customers[1].deletedAt = '2026-04-12T11:05:00.000Z'
    const migrated = migrateState(state)
    expect(migrated.transfers[1].deletedAt).toBe('2026-04-12T11:00:00.000Z')
    expect(migrated.customers[1].deletedAt).toBe('2026-04-12T11:05:00.000Z')
  })
})
