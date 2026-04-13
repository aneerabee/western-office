/*
  Viewer mode — read-only customer-scoped slice of app state.

  When a user opens the app with `?viewer=<customerId>`, every visible
  data structure must be filtered down to that single customer. Other
  customers' transfers, ledger entries, daily closings, and profit
  history must NEVER appear — even by accident.

  Two exceptions, by explicit user spec:
    - senders, receivers: shown UNCHANGED so the viewer sees real global
      counts. The People tab uses `transfersForPeopleCounts` (the
      original, unfiltered transfers) to compute its tallies.
    - All write actions are blocked elsewhere (App.jsx blockIfReadOnly).

  All functions here are pure — no DOM, no global state.
*/

const VIEWER_PARAM = 'viewer'

/**
 * Parse `?viewer=<id>` from a search string. Returns the customer id as
 * a Number, or null if absent / invalid. Strict: only positive integers.
 *
 * Strict on purpose. Loose parsing is how data leaks happen.
 */
export function parseViewerCustomerId(search) {
  if (!search || typeof search !== 'string') return null

  let qs = search
  if (qs.startsWith('?')) qs = qs.slice(1)
  if (qs.length === 0) return null

  let raw = null
  for (const part of qs.split('&')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = decodeURIComponent(part.slice(0, eq))
    if (key === VIEWER_PARAM) {
      raw = decodeURIComponent(part.slice(eq + 1))
      break
    }
  }

  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (trimmed.length === 0) return null

  // Strict integer check: only digits, no leading zero (except "0" which
  // we reject below), no dots, no exponents.
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null

  const n = Number(trimmed)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

/**
 * Returns true if `customerId` is a non-deleted customer in `customers`.
 */
export function isViewerCustomerValid(customerId, customers) {
  if (customerId == null) return false
  if (!Array.isArray(customers) || customers.length === 0) return false
  const target = Number(customerId)
  return customers.some(
    (c) => c && Number(c.id) === target && !c.deletedAt,
  )
}

function arr(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Returns a new state object scoped to one customer. Original is never
 * mutated. The result includes:
 *
 *   - customers:       [the single matching customer]
 *   - transfers:       only that customer's transfers
 *   - ledgerEntries:   only that customer's ledger entries
 *   - claimHistory:    [] (office-only — never shown)
 *   - dailyClosings:   [] (office-only — never shown)
 *   - senders:         FULL untouched list (per spec)
 *   - receivers:       FULL untouched list (per spec)
 *   - transfersForPeopleCounts: FULL untouched transfers (so PeopleTab
 *                              can compute true global counts)
 */
export function filterStateForViewer(state, viewerCustomerId) {
  const targetId = Number(viewerCustomerId)
  const allTransfers = arr(state?.transfers)

  const customers = arr(state?.customers).filter(
    (c) => c && Number(c.id) === targetId,
  )
  const transfers = allTransfers.filter(
    (t) => t && Number(t.customerId) === targetId,
  )
  const ledgerEntries = arr(state?.ledgerEntries).filter(
    (e) => e && Number(e.customerId) === targetId,
  )

  return {
    customers,
    transfers,
    ledgerEntries,
    claimHistory: [],
    dailyClosings: [],
    senders: arr(state?.senders),
    receivers: arr(state?.receivers),
    transfersForPeopleCounts: allTransfers,
  }
}
