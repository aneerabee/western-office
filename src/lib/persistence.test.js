import { describe, it, expect } from 'vitest'
import { mergeLoadResults } from './persistence'

/*
  Tests for the load-merge behavior — specifically the bug where missing
  Supabase optional tables (wo_senders, wo_receivers) would silently wipe
  user data even when localStorage had it.
*/

function ok(key, payloads = []) {
  return {
    key,
    data: payloads.map((p) => ({ id: p.id, payload: p })),
    error: null,
  }
}

function failed(key, message = 'relation does not exist') {
  return {
    key,
    data: null,
    error: { message },
  }
}

describe('mergeLoadResults — critical tables (always trust Supabase)', () => {
  it('returns supabase data for customers/transfers/ledgerEntries/claimHistory', () => {
    const results = [
      ok('customers', [{ id: 1, name: 'أحمد' }]),
      ok('transfers', [{ id: 10, reference: 'REF-1' }]),
      ok('ledgerEntries', [{ id: 'L1', amount: 100 }]),
      ok('claimHistory', [{ id: 'C1', amount: -10 }]),
      ok('dailyClosings', []),
      ok('senders', []),
      ok('receivers', []),
    ]
    const { map, fallbackUsed } = mergeLoadResults(results, {})
    expect(map.customers).toEqual([{ id: 1, name: 'أحمد' }])
    expect(map.transfers).toEqual([{ id: 10, reference: 'REF-1' }])
    expect(map.ledgerEntries).toEqual([{ id: 'L1', amount: 100 }])
    expect(map.claimHistory).toEqual([{ id: 'C1', amount: -10 }])
    expect(Object.keys(fallbackUsed)).toHaveLength(0)
  })
})

describe('mergeLoadResults — optional tables fallback', () => {
  it('🔑 senders table MISSING in supabase → restores from localStorage', () => {
    const results = [
      ok('customers', [{ id: 1 }]),
      ok('transfers', []),
      ok('ledgerEntries', []),
      ok('claimHistory', []),
      ok('dailyClosings', []),
      failed('senders', 'table not found'),
      failed('receivers', 'table not found'),
    ]
    const localMirror = {
      senders: [
        { id: 's1', name: 'أحمد المرسل', legacyCount: 5 },
        { id: 's2', name: 'سعيد المرسل', legacyCount: 3 },
      ],
      receivers: [
        { id: 'r1', name: 'محمد المستلم', legacyCount: 2 },
      ],
    }
    const { map, fallbackUsed } = mergeLoadResults(results, localMirror)

    expect(map.senders).toHaveLength(2)
    expect(map.senders[0].name).toBe('أحمد المرسل')
    expect(map.receivers).toHaveLength(1)
    expect(map.receivers[0].name).toBe('محمد المستلم')

    expect(fallbackUsed.senders).toEqual({ reason: 'table-missing', recoveredItems: 2 })
    expect(fallbackUsed.receivers).toEqual({ reason: 'table-missing', recoveredItems: 1 })
  })

  it('🔑 senders table EXISTS but EMPTY → restores from localStorage if non-empty', () => {
    const results = [
      ok('customers', []),
      ok('transfers', []),
      ok('ledgerEntries', []),
      ok('claimHistory', []),
      ok('dailyClosings', []),
      ok('senders', []), // exists but empty
      ok('receivers', []),
    ]
    const localMirror = {
      senders: [{ id: 's1', name: 'مرسل قديم', legacyCount: 7 }],
      receivers: [],
    }
    const { map, fallbackUsed } = mergeLoadResults(results, localMirror)

    expect(map.senders).toHaveLength(1)
    expect(map.senders[0].name).toBe('مرسل قديم')
    expect(fallbackUsed.senders).toEqual({ reason: 'table-empty', recoveredItems: 1 })

    expect(map.receivers).toEqual([])
    expect(fallbackUsed.receivers).toBeUndefined()
  })

  it('Supabase has data → wins over localStorage (truth from cloud)', () => {
    const results = [
      ok('customers', []),
      ok('transfers', []),
      ok('ledgerEntries', []),
      ok('claimHistory', []),
      ok('dailyClosings', []),
      ok('senders', [{ id: 's-cloud', name: 'من السحابة' }]),
      ok('receivers', []),
    ]
    const localMirror = {
      senders: [{ id: 's-local', name: 'من المحلي' }],
    }
    const { map } = mergeLoadResults(results, localMirror)
    expect(map.senders).toHaveLength(1)
    expect(map.senders[0].name).toBe('من السحابة')
  })

  it('both supabase and localStorage are empty → returns empty array', () => {
    const results = [
      ok('customers', []),
      ok('transfers', []),
      ok('ledgerEntries', []),
      ok('claimHistory', []),
      ok('dailyClosings', []),
      ok('senders', []),
      ok('receivers', []),
    ]
    const { map, fallbackUsed } = mergeLoadResults(results, {})
    expect(map.senders).toEqual([])
    expect(map.receivers).toEqual([])
    expect(Object.keys(fallbackUsed)).toHaveLength(0)
  })

  it('table missing AND localStorage empty → returns empty array', () => {
    const results = [
      ok('customers', []),
      ok('transfers', []),
      ok('ledgerEntries', []),
      ok('claimHistory', []),
      ok('dailyClosings', []),
      failed('senders'),
      failed('receivers'),
    ]
    const { map, fallbackUsed } = mergeLoadResults(results, { senders: [], receivers: [] })
    expect(map.senders).toEqual([])
    expect(map.receivers).toEqual([])
    expect(Object.keys(fallbackUsed)).toHaveLength(0)
  })

  it('dailyClosings missing → also falls back to localStorage', () => {
    const results = [
      ok('customers', []),
      ok('transfers', []),
      ok('ledgerEntries', []),
      ok('claimHistory', []),
      failed('dailyClosings'),
      ok('senders', []),
      ok('receivers', []),
    ]
    const localMirror = {
      dailyClosings: [
        { id: 'dc1', date: '2026-04-12', snapshot: { foo: 'bar' } },
      ],
    }
    const { map, fallbackUsed } = mergeLoadResults(results, localMirror)
    expect(map.dailyClosings).toHaveLength(1)
    expect(fallbackUsed.dailyClosings.recoveredItems).toBe(1)
  })

  it('localStorage with non-array values is safely ignored', () => {
    const results = [
      ok('customers', []),
      ok('transfers', []),
      ok('ledgerEntries', []),
      ok('claimHistory', []),
      ok('dailyClosings', []),
      failed('senders'),
      failed('receivers'),
    ]
    const localMirror = { senders: 'not an array', receivers: null }
    const { map } = mergeLoadResults(results, localMirror)
    expect(map.senders).toEqual([])
    expect(map.receivers).toEqual([])
  })
})
