import { describe, it, expect } from 'vitest'
import {
  buildAttentionAlerts,
  ALERT_SEVERITY,
  ALERT_KIND,
} from './attentionBoard'

/*
  Attention board — proactive alerts derived from current state.
  Pure function: same inputs → same outputs, no side effects.

  All tests use `now` as a fixed clock so results are deterministic.
*/

const NOW = new Date('2026-04-13T12:00:00.000Z')

function mkCustomer(overrides = {}) {
  return {
    id: 1,
    name: 'زبون افتراضي',
    openingBalance: 0,
    settledTotal: 0,
    openingTransferCount: 0,
    createdAt: '2026-03-01T08:00:00.000Z',
    updatedAt: '2026-03-01T08:00:00.000Z',
    ...overrides,
  }
}

function mkTransfer(overrides = {}) {
  return {
    id: 1,
    customerId: 1,
    reference: 'R1',
    senderName: 'س',
    receiverName: 'م',
    status: 'received',
    settled: false,
    transferAmount: 1000,
    customerAmount: 980,
    systemAmount: 990,
    margin: 10,
    createdAt: '2026-04-12T08:00:00.000Z',
    ...overrides,
  }
}

describe('buildAttentionAlerts — empty state', () => {
  it('returns empty array when there is nothing to flag', () => {
    const alerts = buildAttentionAlerts({
      transfers: [],
      customers: [],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    expect(alerts).toEqual([])
  })

  it('returns empty when transfers are fresh and nothing is urgent', () => {
    const alerts = buildAttentionAlerts({
      transfers: [
        mkTransfer({ status: 'with_employee', sentAt: NOW.toISOString() }),
      ],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    expect(alerts).toEqual([])
  })
})

describe('buildAttentionAlerts — stuck with-employee', () => {
  it('warns when a transfer has been with the employee > 48 hours', () => {
    const sentAt = new Date(NOW.getTime() - 50 * 60 * 60 * 1000).toISOString()
    const alerts = buildAttentionAlerts({
      transfers: [mkTransfer({ id: 10, reference: 'STUCK', status: 'with_employee', sentAt })],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    expect(alerts.length).toBeGreaterThan(0)
    const stuck = alerts.find((a) => a.kind === ALERT_KIND.STUCK_WITH_EMPLOYEE)
    expect(stuck).toBeTruthy()
    expect(stuck.transferId).toBe(10)
    expect(stuck.severity).toBe(ALERT_SEVERITY.WARNING)
  })

  it('escalates severity to URGENT when > 5 days', () => {
    const sentAt = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
    const alerts = buildAttentionAlerts({
      transfers: [mkTransfer({ id: 10, status: 'with_employee', sentAt })],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    const stuck = alerts.find((a) => a.kind === ALERT_KIND.STUCK_WITH_EMPLOYEE)
    expect(stuck.severity).toBe(ALERT_SEVERITY.URGENT)
  })

  it('does not flag freshly-sent transfers', () => {
    const sentAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const alerts = buildAttentionAlerts({
      transfers: [mkTransfer({ status: 'with_employee', sentAt })],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    expect(alerts).toEqual([])
  })

  it('skips deleted transfers', () => {
    const sentAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const alerts = buildAttentionAlerts({
      transfers: [
        mkTransfer({ status: 'with_employee', sentAt, deletedAt: '2026-04-12T00:00:00Z' }),
      ],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    expect(alerts).toEqual([])
  })
})

describe('buildAttentionAlerts — unresolved issues', () => {
  it('flags issue transfers older than 24 hours', () => {
    const issueAt = new Date(NOW.getTime() - 26 * 60 * 60 * 1000).toISOString()
    const alerts = buildAttentionAlerts({
      transfers: [mkTransfer({ id: 5, reference: 'BAD', status: 'issue', issueAt })],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    const issue = alerts.find((a) => a.kind === ALERT_KIND.UNRESOLVED_ISSUE)
    expect(issue).toBeTruthy()
    expect(issue.transferId).toBe(5)
  })

  it('escalates to URGENT at 3+ days', () => {
    const issueAt = new Date(NOW.getTime() - 80 * 60 * 60 * 1000).toISOString()
    const alerts = buildAttentionAlerts({
      transfers: [mkTransfer({ status: 'issue', issueAt })],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    const issue = alerts.find((a) => a.kind === ALERT_KIND.UNRESOLVED_ISSUE)
    expect(issue.severity).toBe(ALERT_SEVERITY.URGENT)
  })
})

describe('buildAttentionAlerts — claimable profit reminder', () => {
  it('informs the user when profit is claimable > 0', () => {
    const alerts = buildAttentionAlerts({
      transfers: [],
      customers: [],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 465, officeCustomerLiability: 0 },
      now: NOW,
    })
    const claim = alerts.find((a) => a.kind === ALERT_KIND.CLAIMABLE_PROFIT)
    expect(claim).toBeTruthy()
    expect(claim.amount).toBe(465)
    expect(claim.severity).toBe(ALERT_SEVERITY.INFO)
  })

  it('does not show when claimable is zero', () => {
    const alerts = buildAttentionAlerts({
      transfers: [],
      customers: [],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    const claim = alerts.find((a) => a.kind === ALERT_KIND.CLAIMABLE_PROFIT)
    expect(claim).toBeUndefined()
  })
})

describe('buildAttentionAlerts — duplicate references', () => {
  it('flags duplicate reference numbers', () => {
    const alerts = buildAttentionAlerts({
      transfers: [
        mkTransfer({ id: 1, reference: 'SAME' }),
        mkTransfer({ id: 2, reference: 'SAME' }),
        mkTransfer({ id: 3, reference: 'UNIQUE' }),
      ],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    const dup = alerts.find((a) => a.kind === ALERT_KIND.DUPLICATE_REFERENCE)
    expect(dup).toBeTruthy()
    expect(dup.reference).toBe('SAME')
  })

  it('case-insensitive duplicate detection', () => {
    const alerts = buildAttentionAlerts({
      transfers: [
        mkTransfer({ id: 1, reference: 'abc123' }),
        mkTransfer({ id: 2, reference: 'ABC123' }),
      ],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 0, officeCustomerLiability: 0 },
      now: NOW,
    })
    const dup = alerts.find((a) => a.kind === ALERT_KIND.DUPLICATE_REFERENCE)
    expect(dup).toBeTruthy()
  })
})

describe('buildAttentionAlerts — ordering', () => {
  it('urgent alerts come before warning, warning before info', () => {
    // Issue old enough to be URGENT
    const issueAt = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    // Stuck with-employee for WARNING
    const sentAt = new Date(NOW.getTime() - 50 * 60 * 60 * 1000).toISOString()

    const alerts = buildAttentionAlerts({
      transfers: [
        mkTransfer({ id: 1, reference: 'A', status: 'issue', issueAt }),
        mkTransfer({ id: 2, reference: 'B', status: 'with_employee', sentAt }),
      ],
      customers: [mkCustomer()],
      ledgerEntries: [],
      officeSummary: { accountantClaimableProfit: 100, officeCustomerLiability: 0 },
      now: NOW,
    })

    // Ensure urgent < warning < info in sort order
    const sevOrder = { urgent: 0, warning: 1, info: 2 }
    for (let i = 1; i < alerts.length; i++) {
      expect(sevOrder[alerts[i - 1].severity]).toBeLessThanOrEqual(sevOrder[alerts[i].severity])
    }
  })
})

describe('buildAttentionAlerts — read-only, pure', () => {
  it('never mutates inputs', () => {
    const transfers = [
      mkTransfer({ status: 'with_employee', sentAt: new Date(NOW.getTime() - 72 * 3600000).toISOString() }),
    ]
    const customers = [mkCustomer()]
    const ledger = []
    const office = { accountantClaimableProfit: 50, officeCustomerLiability: 0 }
    const snap = JSON.stringify({ transfers, customers, ledger, office })
    buildAttentionAlerts({ transfers, customers, ledgerEntries: ledger, officeSummary: office, now: NOW })
    expect(JSON.stringify({ transfers, customers, ledger, office })).toBe(snap)
  })

  it('handles missing or malformed state gracefully', () => {
    expect(() =>
      buildAttentionAlerts({
        transfers: null,
        customers: undefined,
        ledgerEntries: null,
        officeSummary: null,
        now: NOW,
      }),
    ).not.toThrow()
  })
})
