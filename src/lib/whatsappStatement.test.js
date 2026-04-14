import { describe, it, expect } from 'vitest'
import {
  buildCustomerWhatsappMessage,
  normalizePhoneForWhatsapp,
  buildWhatsappUrl,
} from './whatsappStatement'

/*
  Tests for the WhatsApp statement generator.

  The message is an Arabic text that the office owner sends to a merchant
  customer when they ask "what's my balance" or "how are things". It must:

  - Greet the customer by name
  - Show current amount owed to them (مستحق لك)
  - Show amount already settled (استلمت سابقاً)
  - Show total transfer count
  - List the most recent transfers in compact format
  - Include the office office name + date footer
  - Never leak other customers' data
*/

function mkCustomer(overrides = {}) {
  return {
    id: 100,
    name: 'بندريس',
    phone: '+905551234567',
    openingBalance: 0,
    settledTotal: 0,
    openingTransferCount: 0,
    createdAt: '2026-04-01T08:00:00.000Z',
    updatedAt: '2026-04-01T08:00:00.000Z',
    ...overrides,
  }
}

function mkTransfer(overrides = {}) {
  return {
    id: 1,
    customerId: 100,
    reference: '1234567890',
    senderName: 'أحمد',
    receiverName: 'سعيد',
    status: 'picked_up',
    settled: false,
    customerAmount: 500,
    systemAmount: 510,
    transferAmount: 520,
    margin: 10,
    createdAt: '2026-04-12T09:00:00.000Z',
    pickedUpAt: '2026-04-12T10:00:00.000Z',
    ...overrides,
  }
}

describe('normalizePhoneForWhatsapp', () => {
  it('handles international + prefix', () => {
    expect(normalizePhoneForWhatsapp('+90 555 123 45 67')).toBe('905551234567')
    expect(normalizePhoneForWhatsapp('+9 05 55 12 34 567')).toBe('905551234567')
  })

  it('strips 00 international call prefix', () => {
    expect(normalizePhoneForWhatsapp('(0090) 555-123-4567')).toBe('905551234567')
    expect(normalizePhoneForWhatsapp('00 90 555 123 4567')).toBe('905551234567')
  })

  it('converts local Turkish 0 5xx format to +90', () => {
    expect(normalizePhoneForWhatsapp('0555 123 45 67')).toBe('905551234567')
    expect(normalizePhoneForWhatsapp('05551234567')).toBe('905551234567')
  })

  it('keeps already-international numbers intact', () => {
    expect(normalizePhoneForWhatsapp('905551234567')).toBe('905551234567')
  })

  it('returns empty string for invalid input', () => {
    expect(normalizePhoneForWhatsapp('')).toBe('')
    expect(normalizePhoneForWhatsapp(null)).toBe('')
    expect(normalizePhoneForWhatsapp(undefined)).toBe('')
    expect(normalizePhoneForWhatsapp(123)).toBe('')
  })

  it('rejects numbers that are too short after normalization', () => {
    expect(normalizePhoneForWhatsapp('abc123def456')).toBe('')
    expect(normalizePhoneForWhatsapp('12345')).toBe('')
  })
})

describe('buildWhatsappUrl', () => {
  it('builds a valid wa.me URL with encoded text', () => {
    const url = buildWhatsappUrl('905551234567', 'مرحبا بك')
    expect(url).toMatch(/^https:\/\/wa\.me\/905551234567\?text=/)
    // Arabic text should be URL-encoded
    expect(url).toContain('%D9%85')
  })

  it('returns null when phone is invalid', () => {
    expect(buildWhatsappUrl('', 'hi')).toBeNull()
    expect(buildWhatsappUrl(null, 'hi')).toBeNull()
  })
})

describe('buildCustomerWhatsappMessage', () => {
  it('produces a non-empty message with customer name', () => {
    const customer = mkCustomer({ name: 'بندريس' })
    const msg = buildCustomerWhatsappMessage({
      customer,
      transfers: [mkTransfer({ customerId: customer.id })],
      ledgerEntries: [],
    })
    expect(msg.length).toBeGreaterThan(20)
    expect(msg).toContain('بندريس')
  })

  it('includes the owed amount (picked_up but not settled)', () => {
    const customer = mkCustomer({ id: 100, name: 'بندريس' })
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, status: 'picked_up', settled: false, customerAmount: 500 }),
      mkTransfer({ id: 2, customerId: 100, status: 'picked_up', settled: false, customerAmount: 300 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(msg).toContain('800')
  })

  it('shows the most recent settlement in its own section', () => {
    const customer = mkCustomer({ id: 100, name: 'بندريس' })
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, status: 'picked_up', settled: true, customerAmount: 1000, settledAt: '2026-04-13T10:00:00.000Z' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(msg).toContain('آخر تسوية')
    expect(msg).toContain('1,000')
  })

  it('includes total transfer count', () => {
    const customer = mkCustomer({ id: 100 })
    const transfers = [
      mkTransfer({ id: 1, customerId: 100 }),
      mkTransfer({ id: 2, customerId: 100 }),
      mkTransfer({ id: 3, customerId: 100 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(msg).toMatch(/\b3\b/)
  })

  it('only lists transfers created today; older ones never appear individually', () => {
    const customer = mkCustomer({ id: 100 })
    const today = new Date('2026-04-18T12:00:00.000Z')
    const transfers = [
      // Today — should appear
      mkTransfer({ id: 1, customerId: 100, reference: 'TODAYREF', createdAt: '2026-04-18T08:00:00.000Z' }),
      // Yesterday — should NOT appear individually
      mkTransfer({ id: 2, customerId: 100, reference: 'YESTREF', createdAt: '2026-04-17T08:00:00.000Z' }),
      // Last week — should NOT appear individually
      mkTransfer({ id: 3, customerId: 100, reference: 'OLDREF', createdAt: '2026-04-11T08:00:00.000Z' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [], now: today })
    expect(msg).toContain('TODAYREF')
    expect(msg).not.toContain('YESTREF')
    expect(msg).not.toContain('OLDREF')
  })

  it('never leaks data from other customers', () => {
    const customer = mkCustomer({ id: 100, name: 'بندريس' })
    // now must match the default createdAt date so the transfer lands
    // inside today's list where individual refs become visible
    const now = new Date('2026-04-12T15:00:00.000Z')
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, reference: 'MINE' }),
      mkTransfer({ id: 2, customerId: 999, reference: 'OTHER-CUSTOMER' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [], now })
    expect(msg).toContain('MINE')
    expect(msg).not.toContain('OTHER-CUSTOMER')
  })

  it('excludes deleted transfers', () => {
    const customer = mkCustomer({ id: 100 })
    const now = new Date('2026-04-12T15:00:00.000Z')
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, reference: 'KEEP' }),
      mkTransfer({ id: 2, customerId: 100, reference: 'DELETED', deletedAt: '2026-04-12T00:00:00.000Z' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [], now })
    expect(msg).toContain('KEEP')
    expect(msg).not.toContain('DELETED')
  })

  it('includes a footer with date', () => {
    const customer = mkCustomer({ id: 100 })
    const msg = buildCustomerWhatsappMessage({
      customer,
      transfers: [],
      ledgerEntries: [],
      now: new Date('2026-04-13T12:00:00.000Z'),
    })
    // Should mention the date — Arabic date formatter produces these
    expect(msg).toMatch(/2026|أبريل|04/)
  })

  it('handles a customer with zero transfers gracefully', () => {
    const customer = mkCustomer({ id: 100, name: 'زبون فارغ' })
    const msg = buildCustomerWhatsappMessage({ customer, transfers: [], ledgerEntries: [] })
    expect(msg).toContain('زبون فارغ')
    // Should mention 0 somewhere (no transfers)
    expect(msg.length).toBeGreaterThan(20)
  })

  it('formats money with thousand separators', () => {
    const customer = mkCustomer({ id: 100 })
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, status: 'picked_up', settled: false, customerAmount: 43170 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(msg).toMatch(/43,170|43٬170/) // Western or Arabic separator
  })

  it('never mutates any input', () => {
    const customer = mkCustomer({ id: 100 })
    const transfers = [mkTransfer({ customerId: 100 })]
    const customerBefore = JSON.stringify(customer)
    const transfersBefore = JSON.stringify(transfers)
    buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(JSON.stringify(customer)).toBe(customerBefore)
    expect(JSON.stringify(transfers)).toBe(transfersBefore)
  })

  it('counts opening balance as part of owed amount', () => {
    const customer = mkCustomer({ id: 100, openingBalance: 5000 })
    const msg = buildCustomerWhatsappMessage({
      customer,
      transfers: [],
      ledgerEntries: [
        { id: 'L1', customerId: 100, type: 'opening_balance', amount: 5000 },
      ],
    })
    // The opening balance appears as part of what's owed
    expect(msg).toContain('5,000')
  })

  /*
    Regression test: the owed-now and last-settlement amounts must come
    from summarize functions that actually track them per customer.
    Uses isolated reference/amount values so each number cannot accidentally
    appear via unrelated context.
  */
  it('shows the owed-now and last-settlement amounts as distinct labeled lines', () => {
    const customer = mkCustomer({ id: 200, name: 'اختبار التسوية' })
    // Two settled (totals = 777 + 888 = 1665) and one unsettled (123)
    const transfers = [
      mkTransfer({ id: 501, customerId: 200, reference: 'AAA', status: 'picked_up', settled: true, customerAmount: 777, settledAt: '2026-04-13T10:00:00.000Z' }),
      mkTransfer({ id: 502, customerId: 200, reference: 'BBB', status: 'picked_up', settled: true, customerAmount: 888, settledAt: '2026-04-13T10:00:00.000Z' }),
      mkTransfer({ id: 503, customerId: 200, reference: 'CCC', status: 'picked_up', settled: false, customerAmount: 123 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })

    // Owed-now line shows exactly 123$
    const owedLineMatch = msg.match(/المستحق لك الآن:\s*\*?([0-9,]+)\$?\*?/)
    expect(owedLineMatch).not.toBeNull()
    expect(owedLineMatch[1]).toBe('123')

    // Last-settlement amount line shows exactly 1,665$
    const settlementMatch = msg.match(/آخر تسوية[\s\S]*?المبلغ:\s*([0-9,]+)\$/)
    expect(settlementMatch).not.toBeNull()
    expect(settlementMatch[1]).toBe('1,665')
  })

  it('counts status buckets correctly (received / with_employee / issue / unsettled)', () => {
    const customer = mkCustomer({ id: 300 })
    const transfers = [
      mkTransfer({ id: 1, customerId: 300, reference: 'A', status: 'received' }),
      mkTransfer({ id: 2, customerId: 300, reference: 'B', status: 'with_employee' }),
      mkTransfer({ id: 3, customerId: 300, reference: 'C', status: 'with_employee' }),
      mkTransfer({ id: 4, customerId: 300, reference: 'D', status: 'issue' }),
      mkTransfer({ id: 5, customerId: 300, reference: 'E', status: 'picked_up', settled: false, customerAmount: 500 }),
      mkTransfer({ id: 6, customerId: 300, reference: 'F', status: 'picked_up', settled: false, customerAmount: 300 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(msg).toMatch(/جديدة لم تُرسل للموظف: 1 حوالة/)
    expect(msg).toMatch(/عند الموظف: 2 حوالة/)
    expect(msg).toMatch(/فيها مشاكل غير محلولة: 1 حوالة/)
    expect(msg).toMatch(/مسحوبة وتنتظر التسوية: 2 حوالة \(بقيمة 800\$\)/)
  })

  it('lists every unresolved issue with reference and sender name', () => {
    const customer = mkCustomer({ id: 350 })
    const transfers = [
      mkTransfer({ id: 1, customerId: 350, reference: 'ISS-1', senderName: 'أحمد', status: 'issue' }),
      mkTransfer({ id: 2, customerId: 350, reference: 'ISS-2', senderName: 'محمد', status: 'issue' }),
      mkTransfer({ id: 3, customerId: 350, reference: 'HAPPY', senderName: 'خالد', status: 'picked_up', settled: false, customerAmount: 500 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    // Count line
    expect(msg).toMatch(/فيها مشاكل غير محلولة: 2 حوالة/)
    // Each issue line present with ref + sender
    expect(msg).toMatch(/رقم ISS-1\s+·\s+المرسل: أحمد/)
    expect(msg).toMatch(/رقم ISS-2\s+·\s+المرسل: محمد/)
    // The non-issue transfer must NOT appear as an issue line
    expect(msg).not.toContain('رقم HAPPY  ·  المرسل: خالد')
  })

  it('issue detail lines use "—" for missing sender name', () => {
    const customer = mkCustomer({ id: 360 })
    const transfers = [
      mkTransfer({ id: 1, customerId: 360, reference: 'NO-SENDER', senderName: '', status: 'issue' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(msg).toMatch(/رقم NO-SENDER\s+·\s+المرسل: —/)
  })

  it('today section lists new today transfers + a status summary', () => {
    const customer = mkCustomer({ id: 400 })
    const today = new Date('2026-04-13T12:00:00.000Z')
    const transfers = [
      mkTransfer({
        id: 1, customerId: 400, reference: 'TODAY1',
        status: 'picked_up', settled: false,
        customerAmount: 500,
        createdAt: '2026-04-13T09:00:00.000Z',
        pickedUpAt: '2026-04-13T10:00:00.000Z',
      }),
      mkTransfer({
        id: 2, customerId: 400, reference: 'TODAY2',
        status: 'received',
        createdAt: '2026-04-13T11:00:00.000Z',
      }),
      mkTransfer({
        id: 3, customerId: 400, reference: 'TODAY3',
        status: 'issue',
        createdAt: '2026-04-13T11:30:00.000Z',
      }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [], now: today })
    // Header mentions 3 new today
    expect(msg).toMatch(/نشاط اليوم \(3 حوالة جديدة\)/)
    // Each of today's transfers listed with its reference
    expect(msg).toContain('TODAY1')
    expect(msg).toContain('TODAY2')
    expect(msg).toContain('TODAY3')
    // Summary block
    expect(msg).toMatch(/ملخص اليوم/)
    expect(msg).toMatch(/مسحوبة: 1 حوالة/)
    expect(msg).toMatch(/لم تُرسل للموظف بعد: 1 حوالة/)
    expect(msg).toMatch(/فيها مشاكل: 1 حوالة/)
  })

  it('does NOT include any older-transfers section — only essentials', () => {
    const customer = mkCustomer({ id: 450 })
    const today = new Date('2026-04-13T12:00:00.000Z')
    const transfers = [
      mkTransfer({ id: 1, customerId: 450, reference: 'TODAY_A', createdAt: '2026-04-13T09:00:00.000Z' }),
      mkTransfer({ id: 2, customerId: 450, reference: 'OLD_A', createdAt: '2026-04-10T10:00:00.000Z' }),
      mkTransfer({ id: 3, customerId: 450, reference: 'OLD_B', createdAt: '2026-04-09T10:00:00.000Z' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [], now: today })
    // Today's transfer IS listed
    expect(msg).toContain('TODAY_A')
    // Older transfers are NEVER listed individually — they only count in the
    // "حالة الحوالات الآن" / "آخر تسوية" aggregate sections
    expect(msg).not.toContain('OLD_A')
    expect(msg).not.toContain('OLD_B')
    expect(msg).not.toMatch(/حوالة سابقة/)
    expect(msg).not.toMatch(/آخر \d+ حوالة(?! جديدة)/)
  })

  it('last settlement section shows the most recent settlement batch', () => {
    const customer = mkCustomer({ id: 500 })
    const transfers = [
      mkTransfer({ id: 1, customerId: 500, reference: 'OLD1', status: 'picked_up', settled: true, settledAt: '2026-04-01T10:00:00.000Z', customerAmount: 100 }),
      mkTransfer({ id: 2, customerId: 500, reference: 'OLD2', status: 'picked_up', settled: true, settledAt: '2026-04-01T10:00:00.000Z', customerAmount: 200 }),
      mkTransfer({ id: 3, customerId: 500, reference: 'NEW1', status: 'picked_up', settled: true, settledAt: '2026-04-10T10:00:00.000Z', customerAmount: 500 }),
      mkTransfer({ id: 4, customerId: 500, reference: 'NEW2', status: 'picked_up', settled: true, settledAt: '2026-04-10T10:00:00.000Z', customerAmount: 700 }),
      mkTransfer({ id: 5, customerId: 500, reference: 'NEW3', status: 'picked_up', settled: true, settledAt: '2026-04-10T10:00:00.000Z', customerAmount: 300 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    // Last settlement is the 2026-04-10 batch: 3 transfers, 1,500 total
    const countMatch = msg.match(/آخر تسوية[\s\S]*?عدد الحوالات:\s*(\d+)\s*حوالة/)
    expect(countMatch).not.toBeNull()
    expect(countMatch[1]).toBe('3')
    const amountMatch = msg.match(/آخر تسوية[\s\S]*?المبلغ:\s*([0-9,]+)\$/)
    expect(amountMatch).not.toBeNull()
    expect(amountMatch[1]).toBe('1,500')
  })

  it('lists ALL of today new transfers regardless of count', () => {
    const customer = mkCustomer({ id: 600 })
    const today = new Date('2026-04-13T12:00:00.000Z')
    const transfers = []
    // 12 transfers created today
    for (let i = 1; i <= 12; i++) {
      transfers.push(mkTransfer({
        id: i, customerId: 600, reference: `T${i}`,
        createdAt: `2026-04-13T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${String((i % 2) * 30).padStart(2, '0')}:00.000Z`,
      }))
    }
    // And 3 older transfers — these MUST NOT appear in the message list
    for (let i = 13; i <= 15; i++) {
      transfers.push(mkTransfer({ id: i, customerId: 600, reference: `OLDER${i}`, createdAt: '2026-04-10T08:00:00.000Z' }))
    }
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [], now: today })
    // Today header says 12 new
    expect(msg).toMatch(/نشاط اليوم \(12 حوالة جديدة\)/)
    // All 12 today's refs appear
    for (let i = 1; i <= 12; i++) {
      expect(msg).toContain(`T${i}`)
    }
    // Older refs NEVER appear — they're only reflected in aggregate counts
    expect(msg).not.toContain('OLDER13')
    expect(msg).not.toContain('OLDER14')
    expect(msg).not.toContain('OLDER15')
  })
})
