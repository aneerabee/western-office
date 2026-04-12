import { describe, expect, it } from 'vitest'
import {
  collectTransferActivity,
  computeDailyClosing,
  createDailyClosingRecord,
  getAvailableDates,
  getDateKey,
  getFieldAtActivity,
  resolveClosingView,
} from './dailyClosing'
import { buildSeedLedgerEntries, createProfitClaimEntry, summarizeOfficeLedger } from './ledger'
import { summarizeCustomers } from './transferLogic'

const customers = [
  { id: 101, name: 'محمد', openingBalance: 500, settledTotal: 100, createdAt: '2026-04-11T09:00:00.000Z', updatedAt: '2026-04-11T09:00:00.000Z' },
  { id: 102, name: 'ليلى', openingBalance: 0, settledTotal: 0, createdAt: '2026-04-11T09:00:00.000Z', updatedAt: '2026-04-11T09:00:00.000Z' },
]

const transfers = [
  {
    id: 1, customerId: 101, reference: 'WU-100', senderName: 'أحمد', receiverName: 'محمد',
    status: 'picked_up', issueCode: '', systemAmount: 200, customerAmount: 180, margin: 20,
    settled: false, settledAt: null, note: '',
    createdAt: '2026-04-11T09:00:00.000Z', updatedAt: '2026-04-11T09:00:00.000Z', sentAt: '2026-04-11T09:10:00.000Z', pickedUpAt: '2026-04-11T09:20:00.000Z',
  },
  {
    id: 2, customerId: 102, reference: 'WU-200', senderName: 'منى', receiverName: 'ليلى',
    status: 'picked_up', issueCode: '', systemAmount: 100, customerAmount: 90, margin: 10,
    settled: true, settledAt: '2026-04-11T12:00:00.000Z', note: '',
    createdAt: '2026-04-10T10:00:00.000Z', updatedAt: '2026-04-11T12:00:00.000Z', sentAt: '2026-04-10T10:10:00.000Z', pickedUpAt: '2026-04-10T11:00:00.000Z',
  },
  {
    id: 3, customerId: 101, reference: 'WU-300', senderName: 'سالم', receiverName: 'محمد',
    status: 'issue', issueCode: 'name_mismatch', systemAmount: null, customerAmount: null, margin: null,
    settled: false, settledAt: null, note: '',
    createdAt: '2026-04-10T15:00:00.000Z', updatedAt: '2026-04-10T15:00:00.000Z', issueAt: '2026-04-11T08:00:00.000Z',
  },
]

const claimHistory = [createProfitClaimEntry(10)]
claimHistory[0].createdAt = '2026-04-11T16:00:00.000Z'
claimHistory[0].updatedAt = '2026-04-11T16:00:00.000Z'

const customerSummary = summarizeCustomers(customers, transfers, buildSeedLedgerEntries(customers))
const officeSummary = summarizeOfficeLedger(customers, transfers, [...buildSeedLedgerEntries(customers), ...claimHistory])

describe('dailyClosing', () => {
  it('extracts date key from ISO string', () => {
    expect(getDateKey('2026-04-11T09:00:00.000Z')).toBe('2026-04-11')
    expect(getDateKey('')).toBe('')
  })

  it('lists available dates sorted descending', () => {
    const dates = getAvailableDates(transfers, claimHistory)
    expect(dates[0]).toBe('2026-04-11')
    expect(dates[1]).toBe('2026-04-10')
    expect(dates).toHaveLength(2)
  })

  it('does not create fake closing dates from updatedAt only', () => {
    const noisyTransfer = {
      ...transfers[0],
      id: 99,
      createdAt: '2026-04-10T09:00:00.000Z',
      sentAt: null,
      pickedUpAt: null,
      issueAt: null,
      reviewHoldAt: null,
      resetAt: null,
      settledAt: null,
      updatedAt: '2026-04-15T10:00:00.000Z',
    }
    const dates = getAvailableDates([noisyTransfer], [])
    expect(dates).toEqual(['2026-04-10'])
  })

  it('computes daily closing for a specific date', () => {
    const closing = computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, '2026-04-11')
    expect(closing.customerSnapshot.totalOutstanding).toBe(580)
    expect(closing.officeDaily.createdCount).toBe(1)
    expect(closing.officeDaily.pickedUpCount).toBe(1)
    expect(closing.officeDaily.settledCount).toBe(1)
    expect(closing.officeDaily.officeSystemReceivedToday).toBe(200)
    expect(closing.officeDaily.officeCustomerPaidToday).toBe(90)
    expect(closing.officeDaily.claimsValueToday).toBe(10)
    expect(closing.officeDaily.activityToday.some((row) => row.transfer.id === 2)).toBe(true)
  })

  it('includes cumulative customer and accountant views', () => {
    const closing = computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, '2026-04-11')
    expect(closing.customerSnapshot.customerBreakdown).toHaveLength(2)
    const mohamed = closing.customerSnapshot.customerBreakdown.find((c) => c.name === 'محمد')
    expect(mohamed.pickedUpCount).toBe(1)
    expect(closing.accountantSnapshot.claimedProfit).toBe(10)
  })

  it('يوحّد سجل النشاط والعدادات عند issue ثم reset في نفس اليوم', () => {
    const txs = [
      {
        ...transfers[0],
        id: 44,
        reference: 'WU-440',
        status: 'received',
        issueAt: null,
        resetAt: '2026-04-11T18:30:00.000Z',
        history: [
          { field: 'status', from: 'with_employee', to: 'issue', at: '2026-04-11T18:00:00.000Z' },
          { field: 'status', from: 'issue', to: 'received', at: '2026-04-11T18:30:00.000Z' },
        ],
      },
    ]
    const summary = summarizeCustomers(customers, txs, buildSeedLedgerEntries(customers))
    const office = summarizeOfficeLedger(customers, txs, buildSeedLedgerEntries(customers))
    const closing = computeDailyClosing(txs, summary, office, [], '2026-04-11')
    const activity = collectTransferActivity(txs[0], '2026-04-11')

    expect(activity.map((item) => item.type)).toEqual(expect.arrayContaining(['issue', 'reset']))
    expect(closing.officeDaily.issueCount).toBe(1)
    expect(closing.officeDaily.resetCount).toBe(1)
    expect(closing.officeDaily.activityToday[0].activities.map((item) => item.type)).toEqual(
      expect.arrayContaining(['issue', 'reset']),
    )
    expect(closing.officeDaily.issueToday).toHaveLength(1)
  })

  it('يظهر يوم النشاط إذا كان موجودًا في history فقط', () => {
    const txs = [
      {
        ...transfers[0],
        id: 45,
        createdAt: '2026-04-10T08:00:00.000Z',
        issueAt: null,
        resetAt: '2026-04-11T11:00:00.000Z',
        history: [{ field: 'status', from: 'with_employee', to: 'issue', at: '2026-04-11T10:00:00.000Z' }],
      },
    ]

    expect(getAvailableDates(txs, [])).toContain('2026-04-11')
  })

  it('ينشئ سجل إقفال محفوظ قابل للمراجعة', () => {
    const closing = computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, '2026-04-11')
    const record = createDailyClosingRecord(closing)

    expect(record.date).toBe('2026-04-11')
    expect(record.snapshot.officeDaily.settledCount).toBe(1)
    expect(record.id).toBe('daily-closing-2026-04-11')
  })

  it('يمكن فتح snapshot محفوظ حتى لو كان لنفس تاريخ اليوم المحدد', () => {
    const liveClosing = { date: '2026-04-11', officeDaily: { createdCount: 9 } }
    const savedClosing = { snapshot: { date: '2026-04-11', officeDaily: { createdCount: 2 } } }

    expect(resolveClosingView(liveClosing, savedClosing, false)).toBe(liveClosing)
    expect(resolveClosingView(liveClosing, savedClosing, true)).toBe(savedClosing.snapshot)
  })

  it('يسترجع تفاصيل المشكلة كما كانت وقت الحدث حتى بعد reset', () => {
    const transfer = {
      ...transfers[0],
      status: 'received',
      issueCode: '',
      note: '',
      issueAt: null,
      resetAt: '2026-04-11T11:00:00.000Z',
      history: [
        { field: 'issueCode', from: '', to: 'name_mismatch', at: '2026-04-11T10:00:00.000Z' },
        { field: 'note', from: '', to: 'الاسم غير مطابق', at: '2026-04-11T10:00:00.000Z' },
        { field: 'status', from: 'with_employee', to: 'issue', at: '2026-04-11T10:01:00.000Z' },
        { field: 'status', from: 'issue', to: 'received', at: '2026-04-11T11:00:00.000Z' },
        { field: 'issueCode', from: 'name_mismatch', to: '', at: '2026-04-11T11:00:00.000Z' },
        { field: 'note', from: 'الاسم غير مطابق', to: '', at: '2026-04-11T11:00:00.000Z' },
      ],
    }
    const txs = [transfer]
    const summary = summarizeCustomers(customers, txs, buildSeedLedgerEntries(customers))
    const office = summarizeOfficeLedger(customers, txs, buildSeedLedgerEntries(customers))
    const closing = computeDailyClosing(txs, summary, office, [], '2026-04-11')

    expect(getFieldAtActivity(transfer, 'issueCode', '2026-04-11T10:01:00.000Z')).toBe('name_mismatch')
    expect(getFieldAtActivity(transfer, 'note', '2026-04-11T10:01:00.000Z')).toBe('الاسم غير مطابق')
    expect(closing.officeDaily.issueToday[0].issueCodeAt).toBe('name_mismatch')
    expect(closing.officeDaily.issueToday[0].noteAt).toBe('الاسم غير مطابق')
  })

  it('returns zeros for empty date', () => {
    const closing = computeDailyClosing(transfers, customerSummary, officeSummary, claimHistory, '2026-01-01')
    expect(closing.officeDaily.createdCount).toBe(0)
    expect(closing.officeDaily.officeSystemReceivedToday).toBe(0)
  })
})
