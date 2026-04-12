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
const OPTIONAL_TABLES = ['dailyClosings']

async function loadTable(client, key) {
  try {
    const { data, error } = await client.from(SUPABASE_TABLES[key]).select('id,payload')
    if (error) return { key, data: null, error }
    return { key, data: data || [], error: null }
  } catch (err) {
    return { key, data: null, error: err }
  }
}

async function loadFromSupabase() {
  const client = getSupabaseClient()
  if (!client) return null

  const allKeys = [...CRITICAL_TABLES, ...OPTIONAL_TABLES]
  const results = await Promise.all(allKeys.map((key) => loadTable(client, key)))

  // Fail fast if any critical table failed
  const criticalFailure = results.find((r) => CRITICAL_TABLES.includes(r.key) && r.error)
  if (criticalFailure) throw criticalFailure.error

  const map = {}
  for (const r of results) {
    map[r.key] = (r.data || []).map((row) => row.payload)
  }

  return {
    customers: map.customers,
    transfers: map.transfers,
    ledgerEntries: map.ledgerEntries,
    claimHistory: map.claimHistory,
    dailyClosings: map.dailyClosings || [],
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

  // Optional: don't block save if table is missing
  try {
    await syncTable(client, SUPABASE_TABLES.dailyClosings, state.dailyClosings || [])
  } catch (err) {
    console.warn('[persistence] dailyClosings sync failed (non-critical):', err?.message || err)
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
  if (getPersistenceMode() === 'supabase') {
    await saveToSupabase(state)
    return
  }
  writeLocalState(state)
}
