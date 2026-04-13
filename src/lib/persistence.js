import { createClient } from '@supabase/supabase-js'

const LOCAL_STORAGE_KEYS = ['western-office-state-v3', 'western-office-state-v2']
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_TABLES = {
  customers: 'wo_customers',
  transfers: 'wo_transfers',
  ledgerEntries: 'wo_ledger_entries',
  claimHistory: 'wo_claim_history',
  dailyClosings: 'wo_daily_closings',
  senders: 'wo_senders',
  receivers: 'wo_receivers',
}

let cachedClient = null

function hasBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function getPersistenceMode() {
  return SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'local'
}

function getSupabaseClient() {
  if (getPersistenceMode() !== 'supabase') return null
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cachedClient
}

function readLocalState() {
  if (!hasBrowserStorage()) return null
  for (const key of LOCAL_STORAGE_KEYS) {
    const raw = window.localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  }
  return null
}

function writeLocalState(state) {
  if (!hasBrowserStorage()) return
  window.localStorage.setItem(LOCAL_STORAGE_KEYS[0], JSON.stringify(state))
}

// Critical tables — if these fail, we abort load to prevent data loss
const CRITICAL_TABLES = ['customers', 'transfers', 'ledgerEntries', 'claimHistory']
// Optional tables — if missing (e.g. migration not applied), we use []
const OPTIONAL_TABLES = ['dailyClosings', 'senders', 'receivers']

async function loadTable(client, key) {
  try {
    const { data, error } = await client.from(SUPABASE_TABLES[key]).select('id,payload')
    if (error) return { key, data: null, error }
    return { key, data: data || [], error: null }
  } catch (err) {
    return { key, data: null, error: err }
  }
}

/**
 * Pure merge logic — given Supabase load results and a localStorage mirror,
 * decide what state to use for each table.
 *
 * Rules:
 * - CRITICAL tables: trust Supabase always (their existence is required)
 * - OPTIONAL tables: prefer non-empty source (Supabase first, else local mirror)
 *   This protects against silent data loss when Supabase tables don't exist.
 *
 * Exported for testing.
 */
export function mergeLoadResults(results, localMirror = {}) {
  const map = {}
  const fallbackUsed = {}

  for (const r of results) {
    if (OPTIONAL_TABLES.includes(r.key)) {
      const supabaseData = r.error ? null : (r.data || []).map((row) => row.payload)
      const localData = Array.isArray(localMirror[r.key]) ? localMirror[r.key] : null

      if (Array.isArray(supabaseData) && supabaseData.length > 0) {
        map[r.key] = supabaseData
      } else if (localData && localData.length > 0) {
        map[r.key] = localData
        fallbackUsed[r.key] = {
          reason: r.error ? 'table-missing' : 'table-empty',
          recoveredItems: localData.length,
        }
      } else {
        map[r.key] = supabaseData || []
      }
    } else {
      map[r.key] = (r.data || []).map((row) => row.payload)
    }
  }

  return { map, fallbackUsed }
}

async function loadFromSupabase() {
  const client = getSupabaseClient()
  if (!client) return null

  const allKeys = [...CRITICAL_TABLES, ...OPTIONAL_TABLES]
  const results = await Promise.all(allKeys.map((key) => loadTable(client, key)))

  // Fail fast if any critical table failed
  const criticalFailure = results.find((r) => CRITICAL_TABLES.includes(r.key) && r.error)
  if (criticalFailure) throw criticalFailure.error

  // localStorage is read as a fallback for OPTIONAL tables that may not exist
  // in Supabase yet (e.g. user hasn't applied the migration). Without this,
  // missing optional tables would silently wipe user data on every reload.
  const localMirror = readLocalState() || {}
  const { map, fallbackUsed } = mergeLoadResults(results, localMirror)

  if (Object.keys(fallbackUsed).length > 0) {
    console.warn(
      '[persistence] Optional Supabase tables missing or empty — restored from localStorage:',
      fallbackUsed,
    )
  }

  return {
    customers: map.customers,
    transfers: map.transfers,
    ledgerEntries: map.ledgerEntries,
    claimHistory: map.claimHistory,
    dailyClosings: map.dailyClosings || [],
    senders: map.senders || [],
    receivers: map.receivers || [],
  }
}

async function syncTable(client, table, rows) {
  const { data: existingRows, error: existingError } = await client.from(table).select('id')
  if (existingError) throw existingError

  const nextIds = new Set(rows.map((row) => row.id))
  const staleIds = (existingRows || [])
    .map((row) => row.id)
    .filter((id) => !nextIds.has(id))

  if (rows.length > 0) {
    const wrappedRows = rows.map((row) => ({
      id: row.id,
      payload: row,
    }))
    const { error } = await client.from(table).upsert(wrappedRows, { onConflict: 'id' })
    if (error) throw error
  }

  if (staleIds.length > 0) {
    const { error } = await client.from(table).delete().in('id', staleIds)
    if (error) throw error
  }
}

async function saveToSupabase(state) {
  const client = getSupabaseClient()
  if (!client) return

  // Critical tables — must succeed
  await syncTable(client, SUPABASE_TABLES.customers, state.customers)
  await syncTable(client, SUPABASE_TABLES.transfers, state.transfers)
  await syncTable(client, SUPABASE_TABLES.ledgerEntries, state.ledgerEntries || [])
  await syncTable(client, SUPABASE_TABLES.claimHistory, state.claimHistory || [])

  // Optional: don't block save if table is missing.
  // localStorage mirror (always written) guarantees no data loss even
  // if any of these fail — the user can recreate the table later.
  try {
    await syncTable(client, SUPABASE_TABLES.dailyClosings, state.dailyClosings || [])
  } catch (err) {
    console.warn('[persistence] dailyClosings sync failed (non-critical):', err?.message || err)
  }
  try {
    await syncTable(client, SUPABASE_TABLES.senders, state.senders || [])
  } catch (err) {
    console.warn('[persistence] senders sync failed (non-critical):', err?.message || err)
  }
  try {
    await syncTable(client, SUPABASE_TABLES.receivers, state.receivers || [])
  } catch (err) {
    console.warn('[persistence] receivers sync failed (non-critical):', err?.message || err)
  }
}

export async function loadPersistedState(fallbackState, migrateState) {
  try {
    if (getPersistenceMode() === 'supabase') {
      const remoteState = await loadFromSupabase()
      if (!remoteState) return { mode: 'supabase', state: fallbackState }
      return { mode: 'supabase', state: migrateState(remoteState) }
    }

    const localState = readLocalState()
    if (!localState) return { mode: 'local', state: fallbackState }
    return { mode: 'local', state: migrateState(localState) }
  } catch (err) {
    console.error('[persistence] load failed:', err)
    return { mode: getPersistenceMode(), state: fallbackState, loadError: true }
  }
}

export async function savePersistedState(state) {
  // ALWAYS mirror to localStorage first — offline safety net
  let localOk = true
  let localError = null
  try {
    writeLocalState(state)
  } catch (err) {
    localOk = false
    localError = err
    console.warn('[persistence] local mirror failed:', err?.message || err)
  }

  let supabaseOk = true
  let supabaseError = null
  if (getPersistenceMode() === 'supabase') {
    try {
      await saveToSupabase(state)
    } catch (err) {
      supabaseOk = false
      supabaseError = err
      throw err // caller retry logic still expects throw on Supabase failure
    }
  }

  return { localOk, supabaseOk, localError, supabaseError }
}
