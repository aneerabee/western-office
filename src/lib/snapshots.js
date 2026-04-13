/*
  Rolling snapshots — an in-browser safety net against silent data loss.

  Stores up to MAX_SLOTS historical copies of app state under separate
  localStorage keys, keyed by wall-clock timestamp. At most once per
  THROTTLE_MS, a new snapshot is added and the oldest is evicted.

  Kept intentionally small and pure: all I/O goes through an injected
  `storage` object so unit tests run without jsdom.

  Contract:
    - listSnapshots(storage): SnapshotMeta[]  // newest first
    - saveSnapshot(storage, state, now?):  { saved, reason }
    - readSnapshot(storage, id): parsed state object or null
    - pruneSnapshots(storage): removes stale/orphan entries

  SnapshotMeta = { id, savedAt, size }
*/

export const SNAPSHOT_INDEX_KEY = 'western-office-snapshots-index-v1'
export const SNAPSHOT_PREFIX = 'western-office-snapshot-v1:'
export const MAX_SLOTS = 5
export const THROTTLE_MS = 60 * 60 * 1000 // 1 hour

function safeGet(storage, key) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function safeRemove(storage, key) {
  try {
    storage.removeItem(key)
  } catch {
    // ignore
  }
}

function readIndex(storage) {
  const raw = safeGet(storage, SNAPSHOT_INDEX_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.savedAt === 'number' &&
        typeof entry.size === 'number',
    )
  } catch {
    return []
  }
}

function writeIndex(storage, index) {
  return safeSet(storage, SNAPSHOT_INDEX_KEY, JSON.stringify(index))
}

export function listSnapshots(storage) {
  return [...readIndex(storage)].sort((a, b) => b.savedAt - a.savedAt)
}

export function readSnapshot(storage, id) {
  if (!id || typeof id !== 'string') return null
  const raw = safeGet(storage, SNAPSHOT_PREFIX + id)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveSnapshot(storage, state, now = Date.now()) {
  const index = readIndex(storage)

  // Throttle: skip if a snapshot was taken within THROTTLE_MS
  const newest = index.reduce(
    (max, entry) => (entry.savedAt > max ? entry.savedAt : max),
    0,
  )
  if (newest > 0 && now - newest < THROTTLE_MS) {
    return { saved: false, reason: 'throttled' }
  }

  let serialized
  try {
    serialized = JSON.stringify(state)
  } catch {
    return { saved: false, reason: 'serialize-failed' }
  }

  const id = `${now}`
  const size = serialized.length

  const written = safeSet(storage, SNAPSHOT_PREFIX + id, serialized)
  if (!written) {
    return { saved: false, reason: 'write-failed' }
  }

  // Newest first — we'll drop anything past MAX_SLOTS
  const nextIndex = [{ id, savedAt: now, size }, ...index].sort(
    (a, b) => b.savedAt - a.savedAt,
  )
  const keep = nextIndex.slice(0, MAX_SLOTS)
  const drop = nextIndex.slice(MAX_SLOTS)

  for (const evicted of drop) {
    safeRemove(storage, SNAPSHOT_PREFIX + evicted.id)
  }

  const indexWritten = writeIndex(storage, keep)
  if (!indexWritten) {
    // Rollback: remove the snapshot we just wrote so index stays consistent
    safeRemove(storage, SNAPSHOT_PREFIX + id)
    return { saved: false, reason: 'index-write-failed' }
  }

  return { saved: true, reason: 'ok', id }
}

/*
  Remove snapshot entries whose backing values are missing (and vice versa).
  Useful after quota errors or when multiple tabs race.
*/
export function pruneSnapshots(storage) {
  const index = readIndex(storage)
  const alive = index.filter(
    (entry) => safeGet(storage, SNAPSHOT_PREFIX + entry.id) !== null,
  )
  if (alive.length !== index.length) {
    writeIndex(storage, alive)
  }
  return alive.length
}
