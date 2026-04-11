import { describe, expect, it } from 'vitest'
import {
  buildTransferFromDraft,
  computeMargin,
  filterTransfers,
  parseTransfersBackup,
  sortTransfers,
  summarizeTransfers,
  togglePayment,
  transitionTransfer,
  updateAmount,
} from './transferLogic'

const sample = [
  {
    id: 1,
    reference: 'WU-100',
    senderName: 'أحمد',
    receiverName: 'خالد',
    status: 'new',
    issueCode: '',
    systemAmount: null,
    customerAmount: null,
    margin: null,
    paymentStatus: 'pending',
    note: '',
    createdAt: '2026-04-11T09:00:00.000Z',
    updatedAt: '2026-04-11T09:00:00.000Z',
  },
  {
    id: 2,
    reference: 'WU-200',
    senderName: 'منى',
    receiverName: 'ليلى',
    status: 'customer_confirmed',
    issueCode: '',
    systemAmount: 100,
    customerAmount: 90,
    margin: 10,
    paymentStatus: 'pending',
    note: '',
    createdAt: '2026-04-11T10:00:00.000Z',
    updatedAt: '2026-04-11T10:00:00.000Z',
  },
]

describe('transferLogic', () => {
  it('computes margin only when both amounts exist', () => {
    expect(computeMargin(100, 88)).toBe(12)
    expect(computeMargin(100, null)).toBeNull()
  })

  it('prevents duplicate references on create', () => {
    const result = buildTransferFromDraft(
      { senderName: 'سالم', receiverName: 'محمد', reference: 'wu-100' },
      sample,
    )

    expect(result.ok).toBe(false)
  })

  it('creates a normalized transfer from valid draft', () => {
    const result = buildTransferFromDraft(
      { senderName: 'سالم', receiverName: 'محمد', reference: ' wu-300 ' },
      sample,
    )

    expect(result.ok).toBe(true)
    expect(result.value.reference).toBe('WU-300')
    expect(result.value.status).toBe('new')
  })

  it('moves issue status to pending payment and keeps note', () => {
    const next = transitionTransfer(sample[1], 'issue')
    expect(next.status).toBe('issue')
    expect(next.paymentStatus).toBe('pending')
  })

  it('recomputes margin when amount changes', () => {
    const next = updateAmount(sample[0], 'systemAmount', '120')
    const final = updateAmount(next, 'customerAmount', '111')
    expect(final.margin).toBe(9)
  })

  it('toggles payment and aligns status', () => {
    const next = togglePayment(sample[1])
    expect(next.paymentStatus).toBe('paid')
    expect(next.status).toBe('paid')
  })

  it('reopens closed transfer if payment is toggled back to pending', () => {
    const closed = { ...sample[1], status: 'closed', paymentStatus: 'paid' }
    const next = togglePayment(closed)
    expect(next.paymentStatus).toBe('pending')
    expect(next.status).toBe('sent_to_accountant')
  })

  it('filters by search and payment', () => {
    const filtered = filterTransfers(sample, {
      searchTerm: 'ليلى',
      statusFilter: 'all',
      paymentFilter: 'pending',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].reference).toBe('WU-200')
  })

  it('sorts latest first by default mode', () => {
    const sorted = sortTransfers(sample, 'latest')
    expect(sorted[0].reference).toBe('WU-200')
  })

  it('summarizes amounts and ready items', () => {
    const summary = summarizeTransfers(sample)
    expect(summary.totalSystem).toBe(100)
    expect(summary.totalCustomer).toBe(90)
    expect(summary.totalMargin).toBe(10)
    expect(summary.readyForAccountant).toHaveLength(1)
  })

  it('parses valid backup payload', () => {
    const restored = parseTransfersBackup(JSON.stringify(sample))
    expect(restored).toHaveLength(2)
    expect(restored[0].reference).toBe('WU-100')
  })
})
