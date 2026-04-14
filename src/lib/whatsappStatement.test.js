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

  it('includes the already-settled amount', () => {
    const customer = mkCustomer({ id: 100, name: 'بندريس' })
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, status: 'picked_up', settled: true, customerAmount: 1000, settledAt: '2026-04-13T10:00:00.000Z' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
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

  it('lists recent transfers (max 5) with reference numbers', () => {
    const customer = mkCustomer({ id: 100 })
    const transfers = []
    for (let i = 1; i <= 8; i++) {
      transfers.push(mkTransfer({
        id: i,
        customerId: 100,
        reference: `REF${i}`,
        createdAt: `2026-04-${10 + i}T08:00:00.000Z`,
      }))
    }
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    // The 5 newest should appear (REF8, REF7, REF6, REF5, REF4)
    expect(msg).toContain('REF8')
    expect(msg).toContain('REF7')
    expect(msg).toContain('REF4')
    // The older ones should NOT appear (REF1, REF2, REF3)
    expect(msg).not.toContain('REF1\n') // not as a whole token
  })

  it('never leaks data from other customers', () => {
    const customer = mkCustomer({ id: 100, name: 'بندريس' })
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, reference: 'MINE' }),
      mkTransfer({ id: 2, customerId: 999, reference: 'OTHER-CUSTOMER' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
    expect(msg).toContain('MINE')
    expect(msg).not.toContain('OTHER-CUSTOMER')
  })

  it('excludes deleted transfers', () => {
    const customer = mkCustomer({ id: 100 })
    const transfers = [
      mkTransfer({ id: 1, customerId: 100, reference: 'KEEP' }),
      mkTransfer({ id: 2, customerId: 100, reference: 'DELETED', deletedAt: '2026-04-12T00:00:00.000Z' }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })
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
    Regression test: the settled amount must come from a summarize
    function that actually tracks settled amounts per customer.
    This test uses isolated reference/amount values so that the
    settled amount cannot accidentally appear via unrelated context.
  */
  it('shows the settled amount as a distinct labeled line — exact amount isolated from other numbers', () => {
    const customer = mkCustomer({ id: 200, name: 'اختبار التسوية' })
    // Two settled (totals = 777 + 888 = 1665) and one unsettled (123)
    const transfers = [
      mkTransfer({ id: 501, customerId: 200, reference: 'AAA', status: 'picked_up', settled: true, customerAmount: 777, settledAt: '2026-04-13T10:00:00.000Z' }),
      mkTransfer({ id: 502, customerId: 200, reference: 'BBB', status: 'picked_up', settled: true, customerAmount: 888, settledAt: '2026-04-13T10:00:00.000Z' }),
      mkTransfer({ id: 503, customerId: 200, reference: 'CCC', status: 'picked_up', settled: false, customerAmount: 123 }),
    ]
    const msg = buildCustomerWhatsappMessage({ customer, transfers, ledgerEntries: [] })

    // Find the "استلمت سابقاً" line and check it shows exactly 1,665
    const settledLineMatch = msg.match(/استلمت سابقاً:\s*([0-9,]+)/)
    expect(settledLineMatch).not.toBeNull()
    expect(settledLineMatch[1]).toBe('1,665')

    // And the owed-now line shows exactly 123
    const owedLineMatch = msg.match(/مستحق لك عندنا الآن:\s*([0-9,]+)/)
    expect(owedLineMatch).not.toBeNull()
    expect(owedLineMatch[1]).toBe('123')
  })
})
