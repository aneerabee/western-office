import { describe, it, expect, beforeEach } from 'vitest'
import {
  MAX_SLOTS,
  THROTTLE_MS,
  SNAPSHOT_INDEX_KEY,
  SNAPSHOT_PREFIX,
  saveSnapshot,
  listSnapshots,
  readSnapshot,
  pruneSnapshots,
} from './snapshots'

function makeStorage(initial = {}) {
  const store = { ...initial }
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    _raw: store,
  }
}

function makeFailingStorage(failOn = 'set') {
  return {
    getItem: () => null,
    setItem: () => {
      if (failOn === 'set') throw new Error('QuotaExceeded')
    },
    removeItem: () => {},
  }
}

describe('saveSnapshot', () => {
  it('saves first snapshot and returns metadata', () => {
    const storage = makeStorage()
    const result = saveSnapshot(storage, { customers: [{ id: 1 }] }, 1000)
    expect(result.saved).toBe(true)
    expect(result.id).toBe('1000')
    const list = listSnapshots(storage)
    expect(list).toHaveLength(1)
    expect(list[0].savedAt).toBe(1000)
  })

  it('stores the full state (not a reference) and reads it back', () => {
    const storage = makeStorage()
    const state = { customers: [{ id: 'c1', name: 'اختبار' }], transfers: [] }
    const { id } = saveSnapshot(storage, state, 1000)
    const restored = readSnapshot(storage, id)
    expect(restored).toEqual(state)
    // Mutation of original does not affect the saved copy
    state.customers.push({ id: 'c2' })
    const restored2 = readSnapshot(storage, id)
    expect(restored2.customers).toHaveLength(1)
  })

  it('throttles writes within the 1-hour window', () => {
    const storage = makeStorage()
    saveSnapshot(storage, { v: 1 }, 1000)
    const second = saveSnapshot(storage, { v: 2 }, 1000 + 1000)
    expect(second.saved).toBe(false)
    expect(second.reason).toBe('throttled')
    expect(listSnapshots(storage)).toHaveLength(1)
  })

  it('allows a new snapshot exactly at the throttle boundary', () => {
    const storage = makeStorage()
    saveSnapshot(storage, { v: 1 }, 1000)
    const second = saveSnapshot(storage, { v: 2 }, 1000 + THROTTLE_MS)
    expect(second.saved).toBe(true)
    expect(listSnapshots(storage)).toHaveLength(2)
  })

  it('evicts the oldest snapshot when exceeding MAX_SLOTS', () => {
    const storage = makeStorage()
    const times = []
    for (let i = 0; i < MAX_SLOTS + 2; i++) {
      const t = 1000 + i * THROTTLE_MS
      times.push(t)
      saveSnapshot(storage, { v: i }, t)
    }
    const list = listSnapshots(storage)
    expect(list).toHaveLength(MAX_SLOTS)
    // The two oldest timestamps must be gone from the backing store
    expect(storage.getItem(SNAPSHOT_PREFIX + times[0])).toBeNull()
    expect(storage.getItem(SNAPSHOT_PREFIX + times[1])).toBeNull()
    // The newest MAX_SLOTS must be present
    for (let i = 2; i < MAX_SLOTS + 2; i++) {
      expect(storage.getItem(SNAPSHOT_PREFIX + times[i])).not.toBeNull()
    }
  })

  it('listSnapshots returns newest first regardless of insertion order', () => {
    const storage = makeStorage()
    saveSnapshot(storage, { v: 'a' }, 2 * THROTTLE_MS)
    saveSnapshot(storage, { v: 'b' }, 4 * THROTTLE_MS)
    saveSnapshot(storage, { v: 'c' }, 1 * THROTTLE_MS + 4 * THROTTLE_MS)
    const list = listSnapshots(storage)
    expect(list.map((e) => e.savedAt)).toEqual([
      5 * THROTTLE_MS,
      4 * THROTTLE_MS,
      2 * THROTTLE_MS,
    ])
  })

  it('returns write-failed when storage.setItem throws', () => {
    const storage = makeFailingStorage('set')
    const result = saveSnapshot(storage, { v: 1 }, 1000)
    expect(result.saved).toBe(false)
    expect(result.reason).toBe('write-failed')
  })

  it('returns serialize-failed on a circular state', () => {
    const storage = makeStorage()
    const bad = {}
    bad.self = bad
    const result = saveSnapshot(storage, bad, 1000)
    expect(result.saved).toBe(false)
    expect(result.reason).toBe('serialize-failed')
  })

  it('ignores corrupted index JSON and starts fresh', () => {
    const storage = makeStorage({ [SNAPSHOT_INDEX_KEY]: 'not json' })
    const result = saveSnapshot(storage, { v: 1 }, 1000)
    expect(result.saved).toBe(true)
    expect(listSnapshots(storage)).toHaveLength(1)
  })
})

describe('readSnapshot', () => {
  it('returns null for missing id', () => {
    const storage = makeStorage()
    expect(readSnapshot(storage, 'nope')).toBeNull()
  })

  it('returns null for empty or invalid id', () => {
    const storage = makeStorage()
    expect(readSnapshot(storage, '')).toBeNull()
    expect(readSnapshot(storage, null)).toBeNull()
  })

  it('returns null if backing data is corrupted', () => {
    const storage = makeStorage()
    saveSnapshot(storage, { v: 1 }, 1000)
    storage.setItem(SNAPSHOT_PREFIX + '1000', '{{{corrupt')
    expect(readSnapshot(storage, '1000')).toBeNull()
  })
})

describe('pruneSnapshots', () => {
  it('removes orphaned index entries whose data is missing', () => {
    const storage = makeStorage()
    saveSnapshot(storage, { v: 1 }, 1000)
    saveSnapshot(storage, { v: 2 }, 1000 + THROTTLE_MS)
    // Manually wipe one of the backing entries
    storage.removeItem(SNAPSHOT_PREFIX + '1000')
    const remaining = pruneSnapshots(storage)
    expect(remaining).toBe(1)
    const list = listSnapshots(storage)
    expect(list).toHaveLength(1)
    expect(list[0].savedAt).toBe(1000 + THROTTLE_MS)
  })

  it('is a no-op when nothing is orphaned', () => {
    const storage = makeStorage()
    saveSnapshot(storage, { v: 1 }, 1000)
    saveSnapshot(storage, { v: 2 }, 1000 + THROTTLE_MS)
    const remaining = pruneSnapshots(storage)
    expect(remaining).toBe(2)
  })
})
