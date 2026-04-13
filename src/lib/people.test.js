import { describe, it, expect } from 'vitest'
import {
  PERSON_KIND,
  RECEIVER_COLOR_LEVELS,
  countFromTransfers,
  buildPeopleList,
  buildReceiverColorMap,
  lookupReceiverColor,
  findPersonByName,
  upsertPersonOverride,
  findDuplicateReferences,
  referenceExists,
  collectNameSuggestions,
  getReceiverColorLevel,
  getReceiverColorClass,
} from './people'

function makeTransfer(overrides) {
  return {
    id: overrides.id,
    customerId: overrides.customerId || 1,
    senderName: overrides.senderName || '',
    receiverName: overrides.receiverName || '',
    reference: overrides.reference || '',
    status: overrides.status || 'received',
    transferAmount: null,
    systemAmount: null,
    customerAmount: null,
    margin: null,
    settled: false,
    settledAt: null,
    note: '',
    sentAt: null,
    pickedUpAt: null,
    issueAt: null,
    reviewHoldAt: null,
    resetAt: null,
    history: [],
    createdAt: '2026-04-10T10:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
    deletedAt: overrides.deletedAt || null,
  }
}

describe('getReceiverColorLevel', () => {
  it('0..3 returns none', () => {
    for (const n of [0, 1, 2, 3]) expect(getReceiverColorLevel(n)).toBe(RECEIVER_COLOR_LEVELS.NONE)
  })

  it('4 returns yellow, 5 blue, 6 red, 7+ red-striped', () => {
    expect(getReceiverColorLevel(4)).toBe(RECEIVER_COLOR_LEVELS.YELLOW)
    expect(getReceiverColorLevel(5)).toBe(RECEIVER_COLOR_LEVELS.BLUE)
    expect(getReceiverColorLevel(6)).toBe(RECEIVER_COLOR_LEVELS.RED)
    expect(getReceiverColorLevel(7)).toBe(RECEIVER_COLOR_LEVELS.RED_STRIPED)
    expect(getReceiverColorLevel(25)).toBe(RECEIVER_COLOR_LEVELS.RED_STRIPED)
  })

  it('handles invalid inputs safely', () => {
    expect(getReceiverColorLevel(null)).toBe(RECEIVER_COLOR_LEVELS.NONE)
    expect(getReceiverColorLevel(undefined)).toBe(RECEIVER_COLOR_LEVELS.NONE)
    expect(getReceiverColorLevel(NaN)).toBe(RECEIVER_COLOR_LEVELS.NONE)
    expect(getReceiverColorLevel('5')).toBe(RECEIVER_COLOR_LEVELS.BLUE)
  })
})

describe('getReceiverColorClass', () => {
  it('returns correct CSS class per level', () => {
    expect(getReceiverColorClass(RECEIVER_COLOR_LEVELS.NONE)).toBe('')
    expect(getReceiverColorClass(RECEIVER_COLOR_LEVELS.YELLOW)).toBe('receiver-level-yellow')
    expect(getReceiverColorClass(RECEIVER_COLOR_LEVELS.BLUE)).toBe('receiver-level-blue')
    expect(getReceiverColorClass(RECEIVER_COLOR_LEVELS.RED)).toBe('receiver-level-red')
    expect(getReceiverColorClass(RECEIVER_COLOR_LEVELS.RED_STRIPED)).toBe('receiver-level-red-striped')
  })
})

describe('countFromTransfers', () => {
  const transfers = [
    makeTransfer({ id: 1, senderName: 'أحمد', receiverName: 'علي' }),
    makeTransfer({ id: 2, senderName: 'أحمد  ', receiverName: 'علي' }),
    makeTransfer({ id: 3, senderName: 'خالد', receiverName: 'سمير' }),
    makeTransfer({ id: 4, senderName: 'أحمد', receiverName: 'علي', deletedAt: '2026-04-10T10:00:00.000Z' }),
  ]

  it('counts senders ignoring soft-deleted (via buildPeopleList totals)', () => {
    const list = buildPeopleList(transfers, [], PERSON_KIND.SENDER)
    const ahmed = list.find((p) => p.name === 'أحمد')
    const khaled = list.find((p) => p.name === 'خالد')
    expect(ahmed.systemCount).toBe(2)
    expect(khaled.systemCount).toBe(1)
    expect(list).toHaveLength(2)
  })

  it('counts receivers ignoring soft-deleted', () => {
    const list = buildPeopleList(transfers, [], PERSON_KIND.RECEIVER)
    const ali = list.find((p) => p.name === 'علي')
    const sameer = list.find((p) => p.name === 'سمير')
    expect(ali.systemCount).toBe(2)
    expect(sameer.systemCount).toBe(1)
  })

  it('trims/normalizes whitespace', () => {
    const weird = [
      makeTransfer({ id: 10, receiverName: '  علي  ' }),
      makeTransfer({ id: 11, receiverName: 'علي' }),
    ]
    const list = buildPeopleList(weird, [], PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(1)
    expect(list[0].systemCount).toBe(2)
  })

  it('skips empty names', () => {
    const weird = [
      makeTransfer({ id: 12, receiverName: '' }),
      makeTransfer({ id: 13, receiverName: '   ' }),
      makeTransfer({ id: 14, receiverName: 'علي' }),
    ]
    const list = buildPeopleList(weird, [], PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('علي')
  })
})

describe('buildPeopleList', () => {
  it('combines system counts with legacy overrides (receivers)', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'علي' }),
      makeTransfer({ id: 2, receiverName: 'علي' }),
      makeTransfer({ id: 3, receiverName: 'سمير' }),
    ]
    const overrides = [
      { id: 'p1', name: 'علي', legacyCount: 3, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ]
    const list = buildPeopleList(transfers, overrides, PERSON_KIND.RECEIVER)

    const ali = list.find((p) => p.name === 'علي')
    expect(ali.legacyCount).toBe(3)
    expect(ali.systemCount).toBe(2)
    expect(ali.total).toBe(5)
    expect(ali.colorLevel).toBe(RECEIVER_COLOR_LEVELS.BLUE)
    expect(ali.hasOverride).toBe(true)

    const sameer = list.find((p) => p.name === 'سمير')
    expect(sameer.legacyCount).toBe(0)
    expect(sameer.systemCount).toBe(1)
    expect(sameer.total).toBe(1)
    expect(sameer.colorLevel).toBe(RECEIVER_COLOR_LEVELS.NONE)
    expect(sameer.hasOverride).toBe(false)
  })

  it('threshold 4 → yellow when combined total reaches 4', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'نبيل' }),
      makeTransfer({ id: 2, receiverName: 'نبيل' }),
    ]
    const overrides = [{ id: 'p1', name: 'نبيل', legacyCount: 2 }]
    const [nabil] = buildPeopleList(transfers, overrides, PERSON_KIND.RECEIVER)
    expect(nabil.total).toBe(4)
    expect(nabil.colorLevel).toBe(RECEIVER_COLOR_LEVELS.YELLOW)
  })

  it('threshold 7+ → red-striped', () => {
    const overrides = [{ id: 'p1', name: 'رائد', legacyCount: 10 }]
    const [raed] = buildPeopleList([], overrides, PERSON_KIND.RECEIVER)
    expect(raed.total).toBe(10)
    expect(raed.colorLevel).toBe(RECEIVER_COLOR_LEVELS.RED_STRIPED)
  })

  it('sender list has no color (always none)', () => {
    const transfers = [
      makeTransfer({ id: 1, senderName: 'كريم' }),
      makeTransfer({ id: 2, senderName: 'كريم' }),
      makeTransfer({ id: 3, senderName: 'كريم' }),
      makeTransfer({ id: 4, senderName: 'كريم' }),
      makeTransfer({ id: 5, senderName: 'كريم' }),
    ]
    const list = buildPeopleList(transfers, [], PERSON_KIND.SENDER)
    expect(list[0].total).toBe(5)
    expect(list[0].colorLevel).toBe(RECEIVER_COLOR_LEVELS.NONE)
  })

  it('orphan override (no transfers yet) still appears in list', () => {
    const overrides = [{ id: 'p1', name: 'سلمى', legacyCount: 4 }]
    const list = buildPeopleList([], overrides, PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('سلمى')
    expect(list[0].total).toBe(4)
  })

  it('ignores soft-deleted overrides', () => {
    const overrides = [
      { id: 'p1', name: 'ماجد', legacyCount: 10, deletedAt: '2026-04-10T10:00:00.000Z' },
    ]
    const list = buildPeopleList([], overrides, PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(0)
  })
})

describe('buildReceiverColorMap + lookupReceiverColor', () => {
  it('provides O(1) color lookup by name for table rendering', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'ياسر' }),
      makeTransfer({ id: 2, receiverName: 'ياسر' }),
      makeTransfer({ id: 3, receiverName: 'ياسر' }),
      makeTransfer({ id: 4, receiverName: 'ياسر' }),
    ]
    const map = buildReceiverColorMap(transfers, [])
    const yasser = lookupReceiverColor(map, 'ياسر')
    expect(yasser.total).toBe(4)
    expect(yasser.colorLevel).toBe(RECEIVER_COLOR_LEVELS.YELLOW)

    const unknown = lookupReceiverColor(map, 'unknown-name')
    expect(unknown.total).toBe(0)
    expect(unknown.colorLevel).toBe(RECEIVER_COLOR_LEVELS.NONE)
  })

  it('reflects legacy count in the lookup', () => {
    const overrides = [{ id: 'p1', name: 'فادي', legacyCount: 6 }]
    const map = buildReceiverColorMap([], overrides)
    const fadi = lookupReceiverColor(map, 'فادي')
    expect(fadi.total).toBe(6)
    expect(fadi.colorLevel).toBe(RECEIVER_COLOR_LEVELS.RED)
  })
})

describe('upsertPersonOverride', () => {
  it('adds a new override when name does not exist', () => {
    const next = upsertPersonOverride([], { name: 'أيمن', legacyCount: 3 })
    expect(next).toHaveLength(1)
    expect(next[0].name).toBe('أيمن')
    expect(next[0].legacyCount).toBe(3)
    expect(next[0].id).toBeDefined()
  })

  it('updates existing override by name (case/whitespace insensitive) without duplicating', () => {
    const initial = [
      { id: 'p1', name: 'أيمن', legacyCount: 3, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ]
    const next = upsertPersonOverride(initial, { name: '  أيمن  ', legacyCount: 10 })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('p1') // id preserved
    expect(next[0].legacyCount).toBe(10)
    expect(next[0].createdAt).toBe('2026-04-01') // createdAt preserved
  })

  it('does not mutate input array', () => {
    const initial = [{ id: 'p1', name: 'أيمن', legacyCount: 3 }]
    const snapshot = JSON.parse(JSON.stringify(initial))
    upsertPersonOverride(initial, { name: 'أيمن', legacyCount: 5 })
    expect(initial).toEqual(snapshot)
  })

  it('clamps negative or invalid counts to 0', () => {
    const a = upsertPersonOverride([], { name: 'ع', legacyCount: -5 })
    expect(a[0].legacyCount).toBe(0)
    const b = upsertPersonOverride([], { name: 'ع', legacyCount: 'abc' })
    expect(b[0].legacyCount).toBe(0)
  })

  it('ignores empty names', () => {
    const result = upsertPersonOverride([], { name: '', legacyCount: 5 })
    expect(result).toEqual([])
  })
})

describe('findPersonByName', () => {
  it('finds by normalized name', () => {
    const overrides = [{ id: 'p1', name: 'نور' }]
    expect(findPersonByName(overrides, '  نور  ').id).toBe('p1')
  })

  it('returns null when not found or name is empty', () => {
    expect(findPersonByName([], 'nobody')).toBeNull()
    expect(findPersonByName([{ id: 'p1', name: 'x' }], '')).toBeNull()
  })

  it('skips soft-deleted entries', () => {
    const overrides = [{ id: 'p1', name: 'نور', deletedAt: '2026-04-10' }]
    expect(findPersonByName(overrides, 'نور')).toBeNull()
  })
})

describe('findDuplicateReferences', () => {
  it('returns set of references that appear more than once', () => {
    const transfers = [
      makeTransfer({ id: 1, reference: 'REF-01' }),
      makeTransfer({ id: 2, reference: 'REF-01' }),
      makeTransfer({ id: 3, reference: 'REF-02' }),
      makeTransfer({ id: 4, reference: 'ref-01' }),
    ]
    const dups = findDuplicateReferences(transfers)
    expect(dups.has('REF-01')).toBe(true)
    expect(dups.has('REF-02')).toBe(false)
  })

  it('ignores deleted transfers', () => {
    const transfers = [
      makeTransfer({ id: 1, reference: 'REF-01' }),
      makeTransfer({ id: 2, reference: 'REF-01', deletedAt: '2026-04-10' }),
    ]
    const dups = findDuplicateReferences(transfers)
    expect(dups.size).toBe(0)
  })
})

describe('referenceExists', () => {
  const transfers = [
    makeTransfer({ id: 1, reference: 'REF-01' }),
    makeTransfer({ id: 2, reference: 'REF-02', deletedAt: '2026-04-10' }),
  ]

  it('detects existing ref', () => {
    expect(referenceExists(transfers, 'REF-01')).toBe(true)
    expect(referenceExists(transfers, '  ref-01  ')).toBe(true)
  })

  it('ignores deleted transfers', () => {
    expect(referenceExists(transfers, 'REF-02')).toBe(false)
  })

  it('empty reference returns false', () => {
    expect(referenceExists(transfers, '')).toBe(false)
    expect(referenceExists(transfers, '   ')).toBe(false)
  })
})

describe('Arabic variant normalization', () => {
  it('treats ي and ى as the same letter', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'علي' }),
      makeTransfer({ id: 2, receiverName: 'على' }),
    ]
    const list = buildPeopleList(transfers, [], PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(1)
    expect(list[0].total).toBe(2)
  })

  it('treats أ إ آ and ا as the same letter', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'أحمد' }),
      makeTransfer({ id: 2, receiverName: 'احمد' }),
      makeTransfer({ id: 3, receiverName: 'إحمد' }),
      makeTransfer({ id: 4, receiverName: 'آحمد' }),
    ]
    const list = buildPeopleList(transfers, [], PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(1)
    expect(list[0].total).toBe(4)
  })

  it('strips tashkeel diacritics', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'محمد' }),
      makeTransfer({ id: 2, receiverName: 'مُحَمَّد' }),
    ]
    const list = buildPeopleList(transfers, [], PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(1)
    expect(list[0].total).toBe(2)
  })

  it('treats ة and ه as the same letter', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'فاطمة' }),
      makeTransfer({ id: 2, receiverName: 'فاطمه' }),
    ]
    const list = buildPeopleList(transfers, [], PERSON_KIND.RECEIVER)
    expect(list).toHaveLength(1)
    expect(list[0].total).toBe(2)
  })

  it('matches upsertPersonOverride to existing row through variants', () => {
    const overrides = [{ id: 'p1', name: 'أحمد', legacyCount: 5 }]
    const next = upsertPersonOverride(overrides, { name: 'احمد', legacyCount: 8 })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('p1')
    expect(next[0].legacyCount).toBe(8)
  })
})

describe('collectNameSuggestions', () => {
  it('unions overrides + transfer names, deduped', () => {
    const transfers = [
      makeTransfer({ id: 1, receiverName: 'علي' }),
      makeTransfer({ id: 2, receiverName: 'سمير' }),
      makeTransfer({ id: 3, receiverName: 'علي', deletedAt: '2026-04-10' }),
    ]
    const overrides = [
      { id: 'p1', name: 'علي' },
      { id: 'p2', name: 'رنا' },
    ]
    const list = collectNameSuggestions(transfers, overrides, PERSON_KIND.RECEIVER)
    expect(list).toEqual(expect.arrayContaining(['علي', 'سمير', 'رنا']))
    // No duplicate for علي
    expect(list.filter((n) => n === 'علي')).toHaveLength(1)
  })
})
