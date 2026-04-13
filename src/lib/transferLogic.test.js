import { describe, expect, it } from 'vitest'
import {
  buildCustomerFromDraft,
  buildTransferFromDraft,
  createEmptyTransferBatchDraft,
  createEmptyTransferBatchRow,
  buildTransfersFromBatchDraft,
  computeMargin,
  parseMoney,
  filterTransfers,
  getTransferWorkflowTimestamp,
  getUnsettledForCustomer,
  migrateState,
  parseAppStateBackup,
  settleTransfers,
  sortTransfers,
  summarizeCustomers,
  summarizeTransfers,
  transitionTransfer,
  validateTransition,
  updateAmount,
} from './transferLogic'
import {
  buildCustomerStatement,
  buildLegacySettlementEntry,
  buildOpeningBalanceEntry,
  createLegacySettlementAdjustmentEntry,
  createOpeningBalanceAdjustmentEntry,
  createOpeningSettlementEntry,
  buildSeedLedgerEntries,
  buildTransferLedgerEntries,
  createProfitClaimEntry,
  groupPendingSettlementItems,
  groupUnsettledTransfersByCustomer,
  LEDGER_ENTRY_TYPES,
  summarizeOfficeLedger,
} from './ledger'

/* ══════════════════════════════════════════════════════
 *  Fixtures — realistic data used across all tests
 * ══════════════════════════════════════════════════════ */

const omar = {
  id: 201, name: 'عمر', openingBalance: 1000, openingTransferCount: 4, settledTotal: 200,
  createdAt: '2026-04-12T06:00:00.000Z', updatedAt: '2026-04-12T06:00:00.000Z',
}
const sara = {
  id: 202, name: 'سارة', openingBalance: 0, openingTransferCount: 0, settledTotal: 0,
  createdAt: '2026-04-12T06:00:00.000Z', updatedAt: '2026-04-12T06:00:00.000Z',
}
const customers = [omar, sara]
const seeds = buildSeedLedgerEntries(customers)

const txBase = {
  issueCode: '', note: '', transferAmount: null, settled: false, settledAt: null,
  sentAt: null, pickedUpAt: null, issueAt: null, reviewHoldAt: null, resetAt: null,
}

function makeTx(overrides) {
  return { ...txBase, ...overrides }
}

/* ══════════════════════════════════════════════════════
 *  1. الأساسيات — الحسابات والتحقق
 * ══════════════════════════════════════════════════════ */

describe('الأساسيات', () => {
  it('parseMoney يتعامل مع كل الحالات', () => {
    expect(parseMoney('')).toBe(0)
    expect(parseMoney(null)).toBe(0)
    expect(parseMoney(undefined)).toBe(0)
    expect(parseMoney('abc')).toBe(0)
    expect(parseMoney('100.5')).toBe(100.5)
    expect(parseMoney(0)).toBe(0)
    expect(parseMoney(-50)).toBe(-50)
  })

  it('computeMargin يحسب الفرق فقط عند وجود القيمتين', () => {
    expect(computeMargin(500, 480)).toBe(20)
    expect(computeMargin(100, 100)).toBe(0)
    expect(computeMargin(100, null)).toBeNull()
    expect(computeMargin(null, 90)).toBeNull()
    expect(computeMargin(null, null)).toBeNull()
  })

  it('updateAmount يحسب الهامش تلقائياً عند تغيير المبالغ', () => {
    const t = makeTx({ id: 1, systemAmount: null, customerAmount: null, margin: null })
    const step1 = updateAmount(t, 'systemAmount', '500')
    expect(step1.systemAmount).toBe(500)
    expect(step1.margin).toBeNull() // customerAmount لسه فارغ

    const step2 = updateAmount(step1, 'customerAmount', '480')
    expect(step2.margin).toBe(20)
  })

  it('updateAmount لا يحسب هامش عند تغيير transferAmount', () => {
    const t = makeTx({ id: 1, systemAmount: 500, customerAmount: 480, margin: 20 })
    const result = updateAmount(t, 'transferAmount', '600')
    expect(result.transferAmount).toBe(600)
    expect(result.margin).toBe(20) // لم يتغير
  })
})

/* ══════════════════════════════════════════════════════
 *  2. بناء الزبائن والحوالات
 * ══════════════════════════════════════════════════════ */

describe('بناء الزبائن والحوالات', () => {
  it('يرفض زبون بدون اسم', () => {
    expect(buildCustomerFromDraft({ name: '', openingBalance: '', openingTransferCount: '', settledTotal: '' }, []).ok).toBe(false)
  })

  it('يرفض زبون مكرر', () => {
    expect(buildCustomerFromDraft({ name: 'عمر', openingBalance: '0', openingTransferCount: '0', settledTotal: '0' }, customers).ok).toBe(false)
  })

  it('يقبل زبون جديد بأرقام صحيحة', () => {
    const r = buildCustomerFromDraft({ name: 'خالد', openingBalance: '500', openingTransferCount: '3', settledTotal: '100' }, customers)
    expect(r.ok).toBe(true)
    expect(r.value.openingBalance).toBe(500)
    expect(r.value.openingTransferCount).toBe(3)
    expect(r.value.settledTotal).toBe(100)
  })

  it('يرفض حوالة بدون زبون', () => {
    expect(buildTransferFromDraft(
      { customerId: '', senderName: 'أحمد', receiverName: 'محمد', reference: 'X-1', transferAmount: '', customerAmount: '' },
      [], customers,
    ).ok).toBe(false)
  })

  it('يرفض حوالة بدون مرسل', () => {
    const r = buildTransferFromDraft(
      { customerId: '201', senderName: '', receiverName: 'محمد', reference: 'X-1', transferAmount: '', customerAmount: '' },
      [], customers,
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('المرسل')
  })

  it('يرفض حوالة بدون مستلم', () => {
    const r = buildTransferFromDraft(
      { customerId: '201', senderName: 'أحمد', receiverName: '', reference: 'X-1', transferAmount: '', customerAmount: '' },
      [], customers,
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('المستلم')
  })

  it('يقبل رقم حوالة مكرر مع علامة isDuplicate', () => {
    const existing = [makeTx({ id: 1, reference: 'WU-100', customerId: 201, senderName: 'أحمد', receiverName: 'عمر', status: 'received', createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' })]
    const r = buildTransferFromDraft(
      { customerId: '201', senderName: 'سالم', receiverName: 'محمد', reference: 'wu-100', transferAmount: '', customerAmount: '' },
      existing, customers,
    )
    expect(r.ok).toBe(true)
    expect(r.isDuplicate).toBe(true)
    expect(r.value.reference).toBe('WU-100')
  })

  it('يُعلّم حوالة غير مكرّرة بأن isDuplicate=false', () => {
    const r = buildTransferFromDraft(
      { customerId: '201', senderName: 'أحمد', receiverName: 'محمد', reference: 'WU-NEW', transferAmount: '', customerAmount: '' },
      [], customers,
    )
    expect(r.ok).toBe(true)
    expect(r.isDuplicate).toBe(false)
  })

  it('ينشئ حوالة بحالة received مع المبالغ', () => {
    const r = buildTransferFromDraft(
      { customerId: '201', senderName: 'أحمد', receiverName: 'محمد علي', reference: ' wu-999 ', transferAmount: '500', customerAmount: '480' },
      [], customers,
    )
    expect(r.ok).toBe(true)
    expect(r.value.status).toBe('received')
    expect(r.value.reference).toBe('WU-999')
    expect(r.value.receiverName).toBe('محمد علي')
    expect(r.value.transferAmount).toBe(500)
    expect(r.value.customerAmount).toBe(480)
    expect(r.value.systemAmount).toBeNull()
    expect(r.value.settled).toBe(false)
  })

  it('ينشئ عدة حوالات لنفس الزبون من دفعة واحدة', () => {
    const r = buildTransfersFromBatchDraft(
      {
        customerId: '201',
        rows: [
          { senderName: 'أحمد', receiverName: 'محمد', reference: 'WU-2001', transferAmount: '500', customerAmount: '480' },
          { senderName: 'سالم', receiverName: 'يوسف', reference: 'WU-2002', transferAmount: '300', customerAmount: '290' },
          { senderName: 'ناصر', receiverName: 'إبراهيم', reference: 'WU-2003', transferAmount: '', customerAmount: '' },
        ],
      },
      [],
      customers,
    )

    expect(r.ok).toBe(true)
    expect(r.value).toHaveLength(3)
    expect(r.value[0].customerId).toBe(201)
    expect(r.value[1].reference).toBe('WU-2002')
    expect(r.value[2].transferAmount).toBeNull()
    expect(r.value[2].customerAmount).toBeNull()
  })

  it('يقبل التكرار داخل نفس الدفعة ويعدّه', () => {
    const r = buildTransfersFromBatchDraft(
      {
        customerId: '201',
        rows: [
          { senderName: 'أحمد', receiverName: 'محمد', reference: 'WU-3001', transferAmount: '500', customerAmount: '480' },
          { senderName: 'سالم', receiverName: 'يوسف', reference: 'wu-3001', transferAmount: '300', customerAmount: '290' },
        ],
      },
      [],
      customers,
    )

    expect(r.ok).toBe(true)
    expect(r.value).toHaveLength(2)
    expect(r.value[0].reference).toBe('WU-3001')
    expect(r.value[1].reference).toBe('WU-3001')
    expect(r.duplicatesCount).toBe(2)
  })

  it('يرفض سطر دفعة ناقص البيانات المطلوبة', () => {
    const r = buildTransfersFromBatchDraft(
      {
        customerId: '201',
        rows: [{ senderName: 'أحمد', receiverName: 'محمد', reference: '', transferAmount: '', customerAmount: '' }],
      },
      [],
      customers,
    )

    expect(r.ok).toBe(false)
    expect(r.error).toContain('السطر 1')
    expect(r.error).toContain('اسم المرسل واسم المستلم ورقم الحوالة')
  })

  it('يتجاهل الصفوف الفارغة في دفعة الحوالات', () => {
    const r = buildTransfersFromBatchDraft(
      {
        customerId: '201',
        rows: [
          createEmptyTransferBatchRow(),
          { senderName: 'أحمد', receiverName: 'محمد', reference: 'WU-4001', transferAmount: '', customerAmount: '' },
          createEmptyTransferBatchRow(),
        ],
      },
      [],
      customers,
    )

    expect(r.ok).toBe(true)
    expect(r.value).toHaveLength(1)
  })

  it('ينشئ مسودة دفعة جاهزة بعدة صفوف فارغة', () => {
    const draft = createEmptyTransferBatchDraft()
    expect(draft.customerId).toBe('')
    expect(draft.rows).toHaveLength(4)
  })
})

/* ══════════════════════════════════════════════════════
 *  3. التحقق من الانتقالات
 * ══════════════════════════════════════════════════════ */

describe('التحقق من الانتقالات', () => {
  it('يرفض الإرسال للموظف بدون transferAmount', () => {
    const t = makeTx({ transferAmount: null, customerAmount: 480 })
    expect(validateTransition(t, 'with_employee').ok).toBe(false)
  })

  it('يرفض الإرسال للموظف بدون customerAmount', () => {
    const t = makeTx({ transferAmount: 500, customerAmount: null })
    expect(validateTransition(t, 'with_employee').ok).toBe(false)
  })

  it('يقبل الإرسال للموظف مع المبلغين', () => {
    const t = makeTx({ transferAmount: 500, customerAmount: 480 })
    expect(validateTransition(t, 'with_employee').ok).toBe(true)
  })

  it('يرفض تم السحب بدون systemAmount', () => {
    const t = makeTx({ customerAmount: 480, systemAmount: null })
    expect(validateTransition(t, 'picked_up').ok).toBe(false)
  })

  it('يرفض تم السحب بدون customerAmount', () => {
    const t = makeTx({ customerAmount: null, systemAmount: 490 })
    expect(validateTransition(t, 'picked_up').ok).toBe(false)
  })

  it('يقبل تم السحب مع المبلغين', () => {
    const t = makeTx({ customerAmount: 480, systemAmount: 490 })
    expect(validateTransition(t, 'picked_up').ok).toBe(true)
  })
})

/* ══════════════════════════════════════════════════════
 *  4. دورة حياة الحوالة الكاملة
 * ══════════════════════════════════════════════════════ */

describe('دورة حياة الحوالة', () => {
  it('received → with_employee يسجّل sentAt', () => {
    const t = makeTx({ id: 1, status: 'received' })
    const next = transitionTransfer(t, 'with_employee')
    expect(next.status).toBe('with_employee')
    expect(next.sentAt).toBeTruthy()
  })

  it('with_employee → picked_up يسجّل pickedUpAt', () => {
    const t = makeTx({ id: 1, status: 'with_employee' })
    const next = transitionTransfer(t, 'picked_up')
    expect(next.status).toBe('picked_up')
    expect(next.pickedUpAt).toBeTruthy()
  })

  it('with_employee → review_hold يسجّل reviewHoldAt', () => {
    const t = makeTx({ id: 1, status: 'with_employee' })
    const next = transitionTransfer(t, 'review_hold')
    expect(next.status).toBe('review_hold')
    expect(next.reviewHoldAt).toBeTruthy()
  })

  it('with_employee → issue يسجّل issueAt', () => {
    const t = makeTx({ id: 1, status: 'with_employee' })
    const next = transitionTransfer(t, 'issue')
    expect(next.status).toBe('issue')
    expect(next.issueAt).toBeTruthy()
  })

  it('إعادة لـ received يمسح كل شيء', () => {
    const t = makeTx({
      id: 1, status: 'issue', issueCode: 'name_mismatch',
      transferAmount: 500, customerAmount: 480, systemAmount: 490, margin: 10,
      sentAt: 'x', pickedUpAt: 'x', settled: true, settledAt: 'x',
    })
    const next = transitionTransfer(t, 'received')
    expect(next.status).toBe('received')
    expect(next.issueCode).toBe('')
    expect(next.transferAmount).toBeNull()
    expect(next.customerAmount).toBeNull()
    expect(next.systemAmount).toBeNull()
    expect(next.margin).toBeNull()
    expect(next.sentAt).toBeNull()
    expect(next.pickedUpAt).toBeNull()
    expect(next.settled).toBe(false)
    expect(next.settledAt).toBeNull()
    expect(next.resetAt).toBeTruthy()
  })
})

/* ══════════════════════════════════════════════════════
 *  5. التسوية
 * ══════════════════════════════════════════════════════ */

describe('التسوية', () => {
  const pickedUp = makeTx({
    id: 10, customerId: 201, status: 'picked_up',
    systemAmount: 500, customerAmount: 480, margin: 20,
    createdAt: '2026-04-12T10:00:00.000Z', updatedAt: '2026-04-12T10:00:00.000Z',
  })

  it('settleTransfers يسوّي فقط picked_up غير المسوّاة', () => {
    const txs = [
      { ...pickedUp, id: 10 },
      { ...pickedUp, id: 11, settled: true }, // مسوّاة أصلاً
      makeTx({ id: 12, status: 'received', customerId: 201, createdAt: '2026-04-12T10:00:00.000Z', updatedAt: '2026-04-12T10:00:00.000Z' }), // ليست picked_up
    ]
    const result = settleTransfers(txs, [10, 11, 12])
    expect(result[0].settled).toBe(true)   // تسوّت
    expect(result[0].settledAt).toBeTruthy()
    expect(result[1].settled).toBe(true)   // كانت مسوّاة — لم تتغير
    expect(result[2].settled).toBe(false)  // ليست picked_up — لم تتأثر
  })

  it('getUnsettledForCustomer يرجع فقط picked_up غير المسوّاة لزبون محدد', () => {
    const txs = [
      { ...pickedUp, id: 20, customerId: 201 },
      { ...pickedUp, id: 21, customerId: 201, settled: true },
      { ...pickedUp, id: 22, customerId: 202 },
    ]
    const result = getUnsettledForCustomer(txs, 201)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(20)
  })
})

/* ══════════════════════════════════════════════════════
 *  6. الفلترة والترتيب
 * ══════════════════════════════════════════════════════ */

describe('الفلترة والترتيب', () => {
  const customersById = new Map(customers.map((c) => [c.id, c]))
  const txs = [
    makeTx({ id: 30, customerId: 201, reference: 'WU-AAA', senderName: 'أحمد', receiverName: 'عمر', status: 'received', createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' }),
    makeTx({ id: 31, customerId: 202, reference: 'WU-BBB', senderName: 'منى', receiverName: 'سارة', status: 'issue', createdAt: '2026-04-12T09:00:00.000Z', updatedAt: '2026-04-12T09:00:00.000Z' }),
    makeTx({ id: 32, customerId: 201, reference: 'WU-CCC', senderName: 'سالم', receiverName: 'عمر', status: 'picked_up', settled: true, systemAmount: 100, customerAmount: 90, margin: 10, createdAt: '2025-01-01T10:00:00.000Z', updatedAt: '2025-01-01T10:00:00.000Z' }),
  ]

  it('البحث بالرقم يجد الحوالة', () => {
    const r = filterTransfers(txs, { searchTerm: 'aaa', statusFilter: 'all', viewMode: 'all', customerFilter: 'all' }, customersById)
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe(30)
  })

  it('البحث باسم الزبون يجد حوالاته', () => {
    const r = filterTransfers(txs, { searchTerm: 'سارة', statusFilter: 'all', viewMode: 'all', customerFilter: 'all' }, customersById)
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe(31)
  })

  it('العرض النشط يخفي المسوّاة القديمة', () => {
    const r = filterTransfers(txs, { searchTerm: '', statusFilter: 'all', viewMode: 'active', customerFilter: 'all' }, customersById)
    expect(r.some((t) => t.id === 32)).toBe(false) // مسوّاة قديمة — مخفية
    expect(r.some((t) => t.id === 30)).toBe(true)   // received — ظاهرة
    expect(r.some((t) => t.id === 31)).toBe(true)   // issue — ظاهرة
  })

  it('العرض اليومي يعتمد على تاريخ التشغيل بعد إعادة الحوالة جديدة', () => {
    const resetToday = new Date().toISOString()
    const r = filterTransfers(
      [
        makeTx({
          id: 33,
          customerId: 201,
          reference: 'WU-DDD',
          senderName: 'م',
          receiverName: 'عمر',
          status: 'received',
          createdAt: '2026-04-01T08:00:00.000Z',
          updatedAt: resetToday,
          resetAt: resetToday,
        }),
      ],
      { searchTerm: '', statusFilter: 'all', viewMode: 'today', customerFilter: 'all' },
      customersById,
    )
    expect(r).toHaveLength(1)
    expect(getTransferWorkflowTimestamp(r[0])).toBe(resetToday)
  })

  it('العرض المكتمل يُظهر المسوّاة فقط', () => {
    const r = filterTransfers(txs, { searchTerm: '', statusFilter: 'all', viewMode: 'completed', customerFilter: 'all' }, customersById)
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe(32)
  })

  it('الترتيب الذكي يضع المشاكل أولاً', () => {
    const sorted = sortTransfers(txs, 'smart', customersById)
    expect(sorted[0].status).toBe('issue')
    expect(sorted[1].status).toBe('received')
  })

  it('الترتيب الأحدث يستخدم تاريخ التشغيل بعد reset', () => {
    const sorted = sortTransfers([
      makeTx({ id: 34, customerId: 201, reference: 'OLD', senderName: 'أ', receiverName: 'عمر', status: 'received', createdAt: '2026-04-01T08:00:00.000Z', updatedAt: '2026-04-12T11:00:00.000Z', resetAt: '2026-04-12T11:00:00.000Z' }),
      makeTx({ id: 35, customerId: 201, reference: 'NEW', senderName: 'ب', receiverName: 'عمر', status: 'received', createdAt: '2026-04-11T08:00:00.000Z', updatedAt: '2026-04-11T08:00:00.000Z' }),
    ], 'latest', customersById)
    expect(sorted[0].id).toBe(34)
  })

  it('الفلتر بالزبون يعرض حوالاته فقط', () => {
    const r = filterTransfers(txs, { searchTerm: '', statusFilter: 'all', viewMode: 'all', customerFilter: '202' }, customersById)
    expect(r).toHaveLength(1)
    expect(r[0].customerId).toBe(202)
  })
})

/* ══════════════════════════════════════════════════════
 *  7. دفتر الحسابات (Ledger)
 * ══════════════════════════════════════════════════════ */

describe('دفتر الحسابات', () => {
  it('buildOpeningBalanceEntry ينشئ قيد لرصيد موجب ويتجاهل الصفر', () => {
    expect(buildOpeningBalanceEntry(omar)).not.toBeNull()
    expect(buildOpeningBalanceEntry(omar).amount).toBe(1000)
    expect(buildOpeningBalanceEntry(omar).transferCount).toBe(4)
    expect(buildOpeningBalanceEntry(sara)).toBeNull()
  })

  it('buildLegacySettlementEntry ينشئ قيد سالب', () => {
    const entry = buildLegacySettlementEntry(omar)
    expect(entry).not.toBeNull()
    expect(entry.amount).toBe(-200)
    expect(buildLegacySettlementEntry(sara)).toBeNull()
  })

  it('buildTransferLedgerEntries يتجاهل غير picked_up', () => {
    const txs = [
      makeTx({ id: 1, status: 'received', customerAmount: 480, createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' }),
      makeTx({ id: 2, status: 'issue', customerAmount: 300, createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' }),
    ]
    expect(buildTransferLedgerEntries(txs)).toHaveLength(0)
  })

  it('picked_up غير مسوّاة تنشئ قيد DUE فقط', () => {
    const txs = [makeTx({ id: 3, status: 'picked_up', customerAmount: 480, settled: false, pickedUpAt: '2026-04-12T10:00:00.000Z', createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T10:00:00.000Z' })]
    const entries = buildTransferLedgerEntries(txs)
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe('transfer_due')
    expect(entries[0].amount).toBe(480)
    expect(entries[0].createdAt).toBe('2026-04-12T10:00:00.000Z') // يستخدم pickedUpAt
  })

  it('picked_up مسوّاة تنشئ DUE + SETTLEMENT', () => {
    const txs = [makeTx({ id: 4, status: 'picked_up', customerAmount: 480, settled: true, settledAt: '2026-04-12T12:00:00.000Z', pickedUpAt: '2026-04-12T10:00:00.000Z', createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T12:00:00.000Z' })]
    const entries = buildTransferLedgerEntries(txs)
    expect(entries).toHaveLength(2)
    expect(entries[0].amount).toBe(480)
    expect(entries[1].amount).toBe(-480)
    expect(entries[1].createdAt).toBe('2026-04-12T12:00:00.000Z') // يستخدم settledAt
  })

  it('كشف حساب الزبون بأرصدة تراكمية صحيحة', () => {
    const txs = [
      makeTx({ id: 5, customerId: 201, reference: 'T-5', senderName: 'أ', status: 'picked_up', customerAmount: 300, settled: false, pickedUpAt: '2026-04-12T10:00:00.000Z', createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T10:00:00.000Z' }),
      makeTx({ id: 6, customerId: 201, reference: 'T-6', senderName: 'ب', status: 'picked_up', customerAmount: 200, settled: true, settledAt: '2026-04-12T12:00:00.000Z', pickedUpAt: '2026-04-12T11:00:00.000Z', createdAt: '2026-04-12T09:00:00.000Z', updatedAt: '2026-04-12T12:00:00.000Z' }),
    ]
    const statement = buildCustomerStatement(customers, txs, seeds, 201)
    // opening 1000, legacy -200, due(T-5) +300, due(T-6) +200, settlement(T-6) -200
    const last = statement.at(-1)
    expect(last.runningBalance).toBe(1000 - 200 + 300 + 200 - 200)  // 1100
  })

  it('createProfitClaimEntry ينشئ قيد سالب بـ customerId=0', () => {
    const claim = createProfitClaimEntry(50)
    expect(claim.amount).toBe(-50)
    expect(claim.customerId).toBe(0)
    expect(claim.type).toBe('profit_claim')
  })

  it('createOpeningBalanceAdjustmentEntry ينشئ تعديلًا محاسبيًا مع فرق العدد', () => {
    const entry = createOpeningBalanceAdjustmentEntry(201, 150, 2)
    expect(entry.type).toBe('opening_balance_adjustment')
    expect(entry.amount).toBe(150)
    expect(entry.transferCount).toBe(2)
  })

  it('createLegacySettlementAdjustmentEntry ينشئ تعديلًا على التسوية السابقة', () => {
    const entry = createLegacySettlementAdjustmentEntry(201, 50)
    expect(entry.type).toBe('legacy_settlement_adjustment')
    expect(entry.amount).toBe(-50)
  })
})

/* ══════════════════════════════════════════════════════
 *  8. الملخصات والربط بين الأقسام
 * ══════════════════════════════════════════════════════ */

describe('الملخصات والربط بين الأقسام', () => {
  // سيناريو كامل: زبونين، 6 حوالات بحالات مختلطة
  const txs = [
    // عمر: received, with_employee, picked_up unsettled, picked_up settled
    makeTx({ id: 401, customerId: 201, reference: 'T-401', senderName: 'أ', receiverName: 'عمر', status: 'received', transferAmount: 500, customerAmount: 480, createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' }),
    makeTx({ id: 402, customerId: 201, reference: 'T-402', senderName: 'ب', receiverName: 'عمر', status: 'with_employee', transferAmount: 600, customerAmount: 570, sentAt: '2026-04-12T08:30:00.000Z', createdAt: '2026-04-12T08:10:00.000Z', updatedAt: '2026-04-12T08:30:00.000Z' }),
    makeTx({ id: 403, customerId: 201, reference: 'T-403', senderName: 'ج', receiverName: 'عمر', status: 'picked_up', transferAmount: 700, customerAmount: 660, systemAmount: 680, margin: 20, pickedUpAt: '2026-04-12T10:00:00.000Z', createdAt: '2026-04-12T08:20:00.000Z', updatedAt: '2026-04-12T10:00:00.000Z' }),
    makeTx({ id: 404, customerId: 201, reference: 'T-404', senderName: 'د', receiverName: 'عمر', status: 'picked_up', transferAmount: 300, customerAmount: 280, systemAmount: 290, margin: 10, settled: true, settledAt: '2026-04-12T11:00:00.000Z', pickedUpAt: '2026-04-12T09:30:00.000Z', createdAt: '2026-04-12T08:30:00.000Z', updatedAt: '2026-04-12T11:00:00.000Z' }),
    // سارة: issue, picked_up unsettled
    makeTx({ id: 405, customerId: 202, reference: 'T-405', senderName: 'ه', receiverName: 'سارة', status: 'issue', transferAmount: 250, customerAmount: 230, issueCode: 'missing_info', issueAt: '2026-04-12T09:15:00.000Z', createdAt: '2026-04-12T09:00:00.000Z', updatedAt: '2026-04-12T09:15:00.000Z' }),
    makeTx({ id: 406, customerId: 202, reference: 'T-406', senderName: 'و', receiverName: 'سارة', status: 'picked_up', transferAmount: 450, customerAmount: 420, systemAmount: 435, margin: 15, pickedUpAt: '2026-04-12T10:30:00.000Z', createdAt: '2026-04-12T09:10:00.000Z', updatedAt: '2026-04-12T10:30:00.000Z' }),
  ]

  it('ملخص الحوالات — الأعداد صحيحة', () => {
    const s = summarizeTransfers(txs)
    expect(s.total).toBe(6)
    expect(s.receivedCount).toBe(1)
    expect(s.withEmployeeCount).toBe(1)
    expect(s.reviewHoldCount).toBe(0)
    expect(s.issueCount).toBe(1)
    expect(s.pickedUpCount).toBe(3)      // 403, 404, 406
    expect(s.settledCount).toBe(1)        // 404
    expect(s.unsettledCount).toBe(2)      // 403, 406
  })

  it('ملخص الحوالات — المبالغ من picked_up فقط', () => {
    const s = summarizeTransfers(txs)
    expect(s.totalSystem).toBe(680 + 290 + 435)       // 1405
    expect(s.totalCustomer).toBe(660 + 280 + 420)     // 1360
    expect(s.totalMargin).toBe(20 + 10 + 15)          // 45
    expect(s.accountantPending).toBe(680 + 435)        // 1115 (unsettled system)
    expect(s.customerOwed).toBe(660 + 420)             // 1080 (unsettled customer)
  })

  it('ملخص الحوالات مع الرصيد الافتتاحي يطابق قسم التسويات', () => {
    const s = summarizeTransfers(txs, seeds, customers)
    expect(s.unsettledCount).toBe(6) // 4 افتتاحي + 2 حوالات غير مسواة
    expect(s.accountantPending).toBe(800 + 680 + 435)
    expect(s.customerOwed).toBe(800 + 660 + 420)
  })

  it('ملخص الزبائن — عمر', () => {
    const cs = summarizeCustomers(customers, txs, seeds)
    const o = cs.find((c) => c.id === 201)
    expect(o.transferCount).toBe(4)
    expect(o.receivedCount).toBe(1)
    expect(o.withEmployeeCount).toBe(1)
    expect(o.pickedUpCount).toBe(2)
    expect(o.settledCount).toBe(1)
    expect(o.unsettledCount).toBe(5)
    expect(o.unsettledAmount).toBe(1460)
    expect(o.openingOutstandingAmount).toBe(800)
    expect(o.openingOutstandingTransferCount).toBe(4)
    expect(o.settledAmount).toBe(280)
    // ledger: 1000 - 200 + 660 + 280 - 280 = 1460
    expect(o.currentBalance).toBe(1460)
  })

  it('ملخص الزبائن — سارة', () => {
    const cs = summarizeCustomers(customers, txs, seeds)
    const s = cs.find((c) => c.id === 202)
    expect(s.transferCount).toBe(2)
    expect(s.issueCount).toBe(1)
    expect(s.pickedUpCount).toBe(1)
    expect(s.unsettledCount).toBe(1)
    expect(s.unsettledAmount).toBe(420)
    // ledger: 0 + 420 = 420
    expect(s.currentBalance).toBe(420)
  })

  it('ملخص المكتب — كل الأرقام متسقة', () => {
    const office = summarizeOfficeLedger(customers, txs, seeds)
    expect(office.officeCustomerLiability).toBe(1460 + 420)      // 1880
    expect(office.accountantSystemReceived).toBe(1000 + 1405)
    expect(office.accountantCustomerPaid).toBe(200 + 280)        // legacy + settled
    expect(office.accountantOutstandingCustomer).toBe(1880)
    expect(office.accountantGrossMargin).toBe(45)
    expect(office.accountantRealizedMargin).toBe(10)             // from T-404 only
    expect(office.accountantClaimableProfit).toBe(10)
    expect(office.accountantPendingProfit).toBe(35)
    // cashOnHand (كاش فعلي بيد المحاسب) = 2405 - 480 - 0 = 1925
    expect(office.accountantCashOnHand).toBe(1925)
  })

  it('المعادلة الحسابية: مدفوع + مطالبات + كاش فعلي = المستلم', () => {
    const office = summarizeOfficeLedger(customers, txs, seeds)
    expect(
      office.accountantCustomerPaid +
      office.accountantClaimedProfit +
      office.accountantCashOnHand
    ).toBe(office.accountantSystemReceived)
  })

  it('المعادلة الحسابية بعد مطالبة ربح', () => {
    const claim = createProfitClaimEntry(10)
    const office = summarizeOfficeLedger(customers, txs, [...seeds, claim])
    expect(office.accountantClaimedProfit).toBe(10)
    expect(office.accountantClaimableProfit).toBe(0)
    expect(office.accountantCashOnHand).toBe(1915)  // 1925 - 10

    expect(
      office.accountantCustomerPaid +
      office.accountantClaimedProfit +
      office.accountantCashOnHand
    ).toBe(office.accountantSystemReceived)
  })

  it('المعادلة الحسابية بعد تسوية كاملة', () => {
    const settled = settleTransfers(txs, [403, 406])
    const office = summarizeOfficeLedger(customers, settled, seeds)
    expect(office.accountantOutstandingCustomer).toBe(800)
    expect(office.accountantCustomerPaid).toBe(200 + 280 + 660 + 420)  // 1560
    expect(office.accountantRealizedMargin).toBe(45)
    expect(office.accountantClaimableProfit).toBe(45)
    // cashOnHand = 2405 - 1560 - 0 = 845 (كاش فعلي يشمل 800 مستحق + 45 ربح)
    expect(office.accountantCashOnHand).toBe(845)

    expect(
      office.accountantCustomerPaid +
      office.accountantClaimedProfit +
      office.accountantCashOnHand
    ).toBe(office.accountantSystemReceived)
  })

  it('groupUnsettledTransfersByCustomer يجمّع بشكل صحيح', () => {
    const groups = groupUnsettledTransfersByCustomer(customers, txs)
    expect(groups).toHaveLength(2)
    const omarGroup = groups.find((g) => g.customerName === 'عمر')
    expect(omarGroup.items).toHaveLength(1) // T-403
    expect(omarGroup.customerTotal).toBe(660)
    const saraGroup = groups.find((g) => g.customerName === 'سارة')
    expect(saraGroup.items).toHaveLength(1) // T-406
    expect(saraGroup.customerTotal).toBe(420)
  })

  it('groupPendingSettlementItems يضم الرصيد الافتتاحي ضمن انتظار التسوية', () => {
    const groups = groupPendingSettlementItems(customers, txs, seeds)
    const omarGroup = groups.find((g) => g.customerName === 'عمر')
    expect(omarGroup.items[0].kind).toBe('opening_balance')
    expect(omarGroup.items[0].openingTransferCount).toBe(4)
    expect(omarGroup.customerTotal).toBe(1460)
  })

  it('تسوية الرصيد الافتتاحي تقلل المستحق والعدد الافتتاحي', () => {
    const openingSettlement = createOpeningSettlementEntry(201, 800, 4)
    const office = summarizeOfficeLedger(customers, txs, [...seeds, openingSettlement])
    const cs = summarizeCustomers(customers, txs, [...seeds, openingSettlement])
    const omarSummary = cs.find((c) => c.id === 201)

    expect(office.accountantOutstandingCustomer).toBe(1080)
    expect(office.accountantCustomerPaid).toBe(200 + 800 + 280)
    expect(omarSummary.openingOutstandingAmount).toBe(0)
    expect(omarSummary.openingOutstandingTransferCount).toBe(0)
    expect(omarSummary.unsettledAmount).toBe(660)
    expect(omarSummary.unsettledCount).toBe(1)
  })

  it('تعديل الرصيد الافتتاحي يضيف حركة جديدة بدل إعادة كتابة التاريخ', () => {
    const adjustment = createOpeningBalanceAdjustmentEntry(201, 200, 1)
    const office = summarizeOfficeLedger(customers, txs, [...seeds, adjustment])
    const statement = buildCustomerStatement(customers, txs, [...seeds, adjustment], 201)
    const omarSummary = summarizeCustomers(customers, txs, [...seeds, adjustment]).find((c) => c.id === 201)

    expect(statement.some((entry) => entry.type === 'opening_balance')).toBe(true)
    expect(statement.some((entry) => entry.type === 'opening_balance_adjustment')).toBe(true)
    expect(omarSummary.openingOutstandingAmount).toBe(1000)
    expect(omarSummary.openingOutstandingTransferCount).toBe(5)
    expect(office.accountantSystemReceived).toBe(2605)
  })

  it('تعديل التسوية السابقة يغيّر المدفوع للمحاسب بدون مسح القيد الأصلي', () => {
    const adjustment = createLegacySettlementAdjustmentEntry(201, 50)
    const office = summarizeOfficeLedger(customers, txs, [...seeds, adjustment])
    const statement = buildCustomerStatement(customers, txs, [...seeds, adjustment], 201)

    expect(statement.some((entry) => entry.type === 'legacy_settlement')).toBe(true)
    expect(statement.some((entry) => entry.type === 'legacy_settlement_adjustment')).toBe(true)
    expect(office.accountantCustomerPaid).toBe(530)
  })

  it('ملخص المكتب يتجاهل قيود الزبون المحذوف من حساب المحاسب', () => {
    const activeCustomers = customers.filter((customer) => customer.id !== 201)
    const activeTransfers = txs.filter((transfer) => transfer.customerId !== 201)
    const office = summarizeOfficeLedger(activeCustomers, activeTransfers, seeds)

    expect(office.officeCustomerLiability).toBe(420)
    expect(office.accountantSystemReceived).toBe(435)
    expect(office.accountantCustomerPaid).toBe(0)
    expect(office.accountantOutstandingCustomer).toBe(420)
    expect(office.accountantCashOnHand).toBe(435)
  })
})

/* ══════════════════════════════════════════════════════
 *  9. الهجرة والنسخ الاحتياطي
 * ══════════════════════════════════════════════════════ */

describe('الهجرة والنسخ الاحتياطي', () => {
  it('يحوّل الحالات القديمة بشكل صحيح', () => {
    const old = {
      customers,
      transfers: [
        { id: 1, customerId: 201, reference: 'OLD-1', senderName: 'أ', receiverName: 'عمر', status: 'new', paymentStatus: 'pending', systemAmount: 100, customerAmount: 90, margin: 10, createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' },
        { id: 2, customerId: 201, reference: 'OLD-2', senderName: 'ب', receiverName: 'عمر', status: 'paid', paymentStatus: 'paid', systemAmount: 200, customerAmount: 180, margin: 20, createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' },
        { id: 3, customerId: 202, reference: 'OLD-3', senderName: 'ج', receiverName: 'سارة', status: 'sent_to_operator', paymentStatus: 'pending', systemAmount: 150, customerAmount: 140, margin: 10, createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' },
      ],
    }
    const migrated = migrateState(old)
    expect(migrated.transfers[0].status).toBe('received')
    expect(migrated.transfers[0].settled).toBe(false)
    expect(migrated.transfers[0].transferAmount).toBeNull()
    expect(migrated.transfers[1].status).toBe('picked_up')
    expect(migrated.transfers[1].settled).toBe(true)
    expect(migrated.transfers[2].status).toBe('with_employee')
    expect(migrated.ledgerEntries.length).toBeGreaterThan(0)
  })

  it('استرجاع النسخة الاحتياطية يحافظ على البيانات', () => {
    const backup = JSON.stringify({
      customers,
      transfers: [],
      dailyClosings: [{ id: 'daily-closing-2026-04-12', date: '2026-04-12', savedAt: '2026-04-12T20:00:00.000Z', snapshot: { date: '2026-04-12' } }],
    })
    const restored = parseAppStateBackup(backup)
    expect(restored.customers).toHaveLength(2)
    expect(restored.transfers).toHaveLength(0)
    expect(restored.ledgerEntries.length).toBeGreaterThan(0) // seeds generated
    expect(Array.isArray(restored.claimHistory)).toBe(true)
    expect(restored.dailyClosings).toHaveLength(1)
  })

  it('فلتر التاريخ يعمل بشكل صحيح', () => {
    const customersById = new Map(customers.map((c) => [c.id, c]))
    const txs = [
      makeTx({ id: 70, customerId: 201, reference: 'D-1', senderName: 'أ', receiverName: 'عمر', status: 'received', createdAt: '2026-04-10T08:00:00.000Z', updatedAt: '2026-04-10T08:00:00.000Z' }),
      makeTx({ id: 71, customerId: 201, reference: 'D-2', senderName: 'ب', receiverName: 'عمر', status: 'received', createdAt: '2026-04-11T08:00:00.000Z', updatedAt: '2026-04-11T08:00:00.000Z' }),
      makeTx({ id: 72, customerId: 201, reference: 'D-3', senderName: 'ج', receiverName: 'عمر', status: 'received', createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' }),
    ]
    // من 11 فقط
    const r1 = filterTransfers(txs, { searchTerm: '', statusFilter: 'all', viewMode: 'all', customerFilter: 'all', dateFrom: '2026-04-11', dateTo: '' }, customersById)
    expect(r1).toHaveLength(2)

    // من 10 إلى 11
    const r2 = filterTransfers(txs, { searchTerm: '', statusFilter: 'all', viewMode: 'all', customerFilter: 'all', dateFrom: '2026-04-10', dateTo: '2026-04-11' }, customersById)
    expect(r2).toHaveLength(2)

    // بدون تاريخ = الكل
    const r3 = filterTransfers(txs, { searchTerm: '', statusFilter: 'all', viewMode: 'all', customerFilter: 'all', dateFrom: '', dateTo: '' }, customersById)
    expect(r3).toHaveLength(3)
  })

  it('سجل التدقيق يُسجّل تغييرات الحالة', () => {
    const t = makeTx({ id: 80, status: 'received', history: [] })
    const step1 = transitionTransfer(t, 'with_employee')
    expect(step1.history).toHaveLength(1)
    expect(step1.history[0].field).toBe('status')
    expect(step1.history[0].from).toBe('received')
    expect(step1.history[0].to).toBe('with_employee')

    const step2 = transitionTransfer(step1, 'picked_up')
    expect(step2.history).toHaveLength(2)
    expect(step2.history[1].from).toBe('with_employee')
    expect(step2.history[1].to).toBe('picked_up')
  })

  it('سجل التدقيق يُسجّل تغييرات المبالغ', () => {
    const t = makeTx({ id: 81, systemAmount: null, customerAmount: null, history: [] })
    const step1 = updateAmount(t, 'systemAmount', '500')
    expect(step1.history).toHaveLength(1)
    expect(step1.history[0].field).toBe('systemAmount')
    expect(step1.history[0].from).toBeNull()
    expect(step1.history[0].to).toBe(500)
  })

  it('الهجرة تضيف history فارغة للبيانات القديمة', () => {
    const migrated = migrateState({
      customers,
      transfers: [{ id: 1, customerId: 201, reference: 'M-1', senderName: 'أ', receiverName: 'عمر', status: 'new', paymentStatus: 'pending', systemAmount: 100, customerAmount: 90, margin: 10, createdAt: '2026-04-12T08:00:00.000Z', updatedAt: '2026-04-12T08:00:00.000Z' }],
      dailyClosings: [{ id: 'daily-closing-2026-04-10', date: '2026-04-10', snapshot: {} }],
    })
    expect(Array.isArray(migrated.transfers[0].history)).toBe(true)
    expect(migrated.dailyClosings).toHaveLength(1)
  })

  it('يرفض نسخة احتياطية تالفة', () => {
    expect(() => parseAppStateBackup('not json')).toThrow()
    expect(() => parseAppStateBackup('{}')).toThrow()
    expect(() => parseAppStateBackup('{"customers":[]}')).toThrow()
  })
})
