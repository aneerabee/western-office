import { makeUniqueId, normalizeName } from './transferLogic'

/*
  People module — tracks senders and receivers as first-class entities.

  A "person" is identified by their name (case-insensitive, whitespace-normalized).
  Each person has a LEGACY count (transfers that existed before the system) and a
  SYSTEM count (derived from current transfers). The TOTAL is their sum and drives
  the color thresholds on the receiver side.

  IMPORTANT: This module is pure — it never mutates inputs and never invents
  IDs for existing transfers. It only reads transfer.senderName / transfer.receiverName.
*/

export const PERSON_KIND = {
  SENDER: 'sender',
  RECEIVER: 'receiver',
}

export const RECEIVER_COLOR_LEVELS = {
  NONE: 'none',
  YELLOW: 'yellow',
  BLUE: 'blue',
  RED: 'red',
  RED_STRIPED: 'red-striped',
}

export function getReceiverColorLevel(total) {
  const n = Number(total) || 0
  if (n >= 7) return RECEIVER_COLOR_LEVELS.RED_STRIPED
  if (n === 6) return RECEIVER_COLOR_LEVELS.RED
  if (n === 5) return RECEIVER_COLOR_LEVELS.BLUE
  if (n === 4) return RECEIVER_COLOR_LEVELS.YELLOW
  return RECEIVER_COLOR_LEVELS.NONE
}

export function getReceiverColorClass(level) {
  if (level === RECEIVER_COLOR_LEVELS.YELLOW) return 'receiver-level-yellow'
  if (level === RECEIVER_COLOR_LEVELS.BLUE) return 'receiver-level-blue'
  if (level === RECEIVER_COLOR_LEVELS.RED) return 'receiver-level-red'
  if (level === RECEIVER_COLOR_LEVELS.RED_STRIPED) return 'receiver-level-red-striped'
  return ''
}

/*
  Normalize Arabic name for matching. Handles common variants so that
  "علي" and "على" and "عليّ" all collapse to the same key:
  - strip tashkeel (fatha, kasra, damma, shadda, sukun, tanwin, etc.)
  - strip tatweel (kashida)
  - alif forms (أ إ آ ا ٱ) → ا
  - ya forms (ي ى ئ) → ي (alif maqsura → ya for matching purposes)
  - ta marbuta (ة) → ha (ه) — common interchange
  - lam-alif ligature not normalized (rare in names)
*/
const TASHKEEL_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g
function arabicNormalize(value) {
  let text = String(value ?? '')
  text = text.replace(TASHKEEL_RE, '')
  text = text.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // آ أ إ ٱ → ا
  text = text.replace(/[\u0649\u0626]/g, '\u064A') // ى ئ → ي
  text = text.replace(/\u0629/g, '\u0647') // ة → ه
  return text
}

function nameKey(value) {
  return arabicNormalize(normalizeName(value)).toLocaleLowerCase('ar')
}

function personField(kind) {
  return kind === PERSON_KIND.SENDER ? 'senderName' : 'receiverName'
}

/**
 * Build system counts directly from the transfers array (excluding deleted).
 * Returns a Map keyed by lowercased-normalized name → count.
 */
export function countFromTransfers(transfers = [], kind) {
  const field = personField(kind)
  const counts = new Map()
  for (const t of transfers) {
    if (!t || t.deletedAt) continue
    const raw = t[field]
    const key = nameKey(raw)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

/**
 * Build a full list of people for one kind (sender or receiver).
 * Merges the overrides array (which holds manual legacyCount + canonical name)
 * with the system counts from transfers. Every name that appears in either source
 * gets a row.
 *
 * Returns: Array<{
 *   id,              // from overrides if present, else null (virtual row)
 *   name,            // canonical display name (prefers override name if present)
 *   legacyCount,     // manual count before the system
 *   systemCount,     // auto-derived from transfers
 *   total,           // legacy + system
 *   colorLevel,      // RECEIVER_COLOR_LEVELS.* — empty string for senders
 *   hasOverride,     // true if the name has a row in overrides
 *   key,             // normalized name key
 * }>
 */
export function buildPeopleList(transfers = [], overrides = [], kind) {
  const system = countFromTransfers(transfers, kind)
  const rowsByKey = new Map()

  for (const override of overrides) {
    if (!override || override.deletedAt) continue
    const key = nameKey(override.name)
    if (!key) continue
    rowsByKey.set(key, {
      id: override.id,
      name: normalizeName(override.name),
      legacyCount: Math.max(0, Math.trunc(Number(override.legacyCount) || 0)),
      systemCount: 0,
      hasOverride: true,
      key,
      createdAt: override.createdAt,
      updatedAt: override.updatedAt,
    })
  }

  for (const [key, systemCount] of system.entries()) {
    if (rowsByKey.has(key)) {
      rowsByKey.get(key).systemCount = systemCount
    } else {
      const firstTransfer = transfers.find((t) => !t?.deletedAt && nameKey(t[personField(kind)]) === key)
      rowsByKey.set(key, {
        id: null,
        name: normalizeName(firstTransfer ? firstTransfer[personField(kind)] : key),
        legacyCount: 0,
        systemCount,
        hasOverride: false,
        key,
      })
    }
  }

  const rows = [...rowsByKey.values()].map((row) => {
    const total = row.legacyCount + row.systemCount
    return {
      ...row,
      total,
      colorLevel: kind === PERSON_KIND.RECEIVER ? getReceiverColorLevel(total) : RECEIVER_COLOR_LEVELS.NONE,
    }
  })

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.name.localeCompare(b.name, 'ar')
  })

  return rows
}

/**
 * Build a quick lookup map: normalized-name → { total, colorLevel, legacyCount, systemCount }
 * Used by tables that need to color receiver cells without re-computing everything.
 */
export function buildReceiverColorMap(transfers = [], receivers = []) {
  const list = buildPeopleList(transfers, receivers, PERSON_KIND.RECEIVER)
  const map = new Map()
  for (const row of list) {
    map.set(row.key, {
      total: row.total,
      colorLevel: row.colorLevel,
      legacyCount: row.legacyCount,
      systemCount: row.systemCount,
    })
  }
  return map
}

export function lookupReceiverColor(map, receiverName) {
  if (!map) return { total: 0, colorLevel: RECEIVER_COLOR_LEVELS.NONE }
  const entry = map.get(nameKey(receiverName))
  return entry || { total: 0, colorLevel: RECEIVER_COLOR_LEVELS.NONE }
}

/**
 * Find a sender/receiver override row by name (case-insensitive, trimmed).
 */
export function findPersonByName(overrides = [], name) {
  const key = nameKey(name)
  if (!key) return null
  return overrides.find((o) => !o.deletedAt && nameKey(o.name) === key) || null
}

/**
 * Immutably upsert a person override. Pass { name, legacyCount } as patch.
 * If the person exists (by normalized name), update legacyCount; otherwise add.
 */
export function upsertPersonOverride(overrides = [], patch) {
  const name = normalizeName(patch?.name || '')
  if (!name) return overrides
  const legacyCount = Math.max(0, Math.trunc(Number(patch?.legacyCount) || 0))
  const now = new Date().toISOString()

  const key = nameKey(name)
  const existingIdx = overrides.findIndex((o) => !o.deletedAt && nameKey(o.name) === key)

  if (existingIdx >= 0) {
    return overrides.map((row, idx) =>
      idx === existingIdx
        ? { ...row, name, legacyCount, updatedAt: now }
        : row,
    )
  }

  return [
    ...overrides,
    {
      id: makeUniqueId(),
      name,
      legacyCount,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ]
}

/**
 * Detect duplicate reference in a transfer list. Case-insensitive on reference.
 * Returns a Set of references that appear more than once.
 */
export function findDuplicateReferences(transfers = []) {
  const counts = new Map()
  for (const t of transfers) {
    if (!t || t.deletedAt) continue
    const ref = String(t.reference || '').trim().toUpperCase()
    if (!ref) continue
    counts.set(ref, (counts.get(ref) || 0) + 1)
  }
  const duplicates = new Set()
  for (const [ref, count] of counts.entries()) {
    if (count > 1) duplicates.add(ref)
  }
  return duplicates
}

/**
 * Fast check — is a proposed reference already used by a non-deleted transfer?
 */
export function referenceExists(transfers = [], reference) {
  const target = String(reference || '').trim().toUpperCase()
  if (!target) return false
  return transfers.some((t) => !t?.deletedAt && String(t.reference || '').trim().toUpperCase() === target)
}

/**
 * Union of all known names (from overrides + transfers) for autocomplete.
 * Returns sorted array of canonical display names, deduped by key.
 */
export function collectNameSuggestions(transfers = [], overrides = [], kind) {
  const seen = new Map()
  for (const override of overrides) {
    if (!override || override.deletedAt) continue
    const key = nameKey(override.name)
    if (!key) continue
    if (!seen.has(key)) seen.set(key, normalizeName(override.name))
  }
  const field = personField(kind)
  for (const t of transfers) {
    if (!t || t.deletedAt) continue
    const name = normalizeName(t[field] || '')
    const key = nameKey(name)
    if (!key) continue
    if (!seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'ar'))
}
