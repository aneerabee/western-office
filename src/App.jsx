import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { seedCustomers, seedTransfers, statusMeta } from './sampleData'
import { computeDailyClosing, createDailyClosingRecord } from './lib/dailyClosing'
import {
  FILTER_ALL,
  buildCustomerFromDraft,
  buildTransferFromDraft,
  createEmptyCustomerDraft,
  createEmptyTransferDraft,
  filterTransfers,
  migrateState,
  parseAppStateBackup,
  serializeAppState,
  settleTransfers,
  sortTransfers,
  summarizeCustomers,
  summarizeTransfers,
} from './lib/transferLogic'
import {
  buildOpeningBalanceEntry,
  buildLegacySettlementEntry,
  createOpeningSettlementEntry,
  createProfitClaimEntry,
  summarizeLedgerByCustomer,
  summarizeOfficeLedger,
} from './lib/ledger'
import { getPersistenceMode, loadPersistedState, savePersistedState } from './lib/persistence'
import TabNav from './components/TabNav'
import TransfersTab from './components/TransfersTab'
import CustomersTab from './components/CustomersTab'
import SettlementsTab from './components/SettlementsTab'
import DailyClosingTab from './components/DailyClosingTab'
import IssuesTab from './components/IssuesTab'

function downloadFile({ fileName, content, contentType }) {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function buildCsv(rows, customersById) {
  const header = [
    'reference', 'customer', 'sender', 'status', 'settled',
    'system_amount', 'customer_amount', 'margin', 'note',
  ]
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const body = rows.map((t) =>
    [
      t.reference,
      customersById.get(t.customerId)?.name || t.receiverName,
      t.senderName,
      statusMeta[t.status]?.label || t.status,
      t.settled ? 'نعم' : 'لا',
      t.systemAmount ?? '',
      t.customerAmount ?? '',
      t.margin ?? '',
      t.note || '',
    ].map(esc).join(','),
  )
  return `\uFEFF${[header.join(','), ...body].join('\n')}`
}

const FALLBACK_STATE = migrateState({
  customers: seedCustomers,
  transfers: seedTransfers,
  ledgerEntries: [],
  claimHistory: [],
  dailyClosings: [],
})

const VALID_TABS = new Set(['transfers', 'customers', 'settlements', 'closing', 'issues'])

function getTabFromHash() {
  const hash = window.location.hash.replace('#', '')
  return VALID_TABS.has(hash) ? hash : 'transfers'
}

function App() {
  const importRef = useRef(null)
  const [activeTab, setActiveTab] = useState(getTabFromHash)
  const [transferDraft, setTransferDraft] = useState(createEmptyTransferDraft)
  const [customerDraft, setCustomerDraft] = useState(createEmptyCustomerDraft)
  const [feedback, setFeedback] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL)
  const [viewMode, setViewMode] = useState('active')
  const [customerFilter, setCustomerFilter] = useState(FILTER_ALL)
  const [sortMode, setSortMode] = useState('smart')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storageMode, setStorageMode] = useState(getPersistenceMode())
  const [isHydrated, setIsHydrated] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [state, setState] = useState(FALLBACK_STATE)

  const { customers, transfers, ledgerEntries, claimHistory, dailyClosings } = state

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const result = await loadPersistedState(FALLBACK_STATE, migrateState)
      if (cancelled) return
      setStorageMode(result.mode)
      if (result.loadError) {
        setLoadFailed(true)
        setFeedback('تعذر تحميل البيانات — لن يتم الحفظ حتى تُحل المشكلة.')
      } else {
        setState(result.state)
        setIsHydrated(true)
      }
    }

    hydrate()

    return () => {
      cancelled = true
    }
  }, [])

  const changeTab = useCallback((tab) => {
    setActiveTab(tab)
    window.location.hash = tab
  }, [])

  useEffect(() => {
    function onHashChange() {
      setActiveTab(getTabFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!isHydrated) return

    savePersistedState(state).catch(() => {
      setFeedback('تعذر حفظ البيانات في طبقة التخزين الحالية.')
    })
  }, [isHydrated, state])

  const customersById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  )

  const filteredTransfers = useMemo(() => {
    const filtered = filterTransfers(
      transfers,
      { searchTerm, statusFilter, viewMode, customerFilter, dateFrom, dateTo },
      customersById,
    )
    return sortTransfers(filtered, sortMode, customersById)
  }, [customerFilter, customersById, dateFrom, dateTo, searchTerm, viewMode, sortMode, statusFilter, transfers])

  const transferSummary = useMemo(
    () => summarizeTransfers(transfers),
    [transfers],
  )
  const customerSummary = useMemo(
    () => summarizeCustomers(customers, transfers, ledgerEntries),
    [customers, ledgerEntries, transfers],
  )
  const officeSummary = useMemo(
    () => {
      const nonClaimLedger = ledgerEntries.filter((e) => e.type !== 'profit_claim')
      return summarizeOfficeLedger(customers, transfers, [...nonClaimLedger, ...claimHistory])
    },
    [claimHistory, customers, ledgerEntries, transfers],
  )

  const issueCount = transferSummary.issueCount

  function patchTransfer(id, updater) {
    setState((s) => ({
      ...s,
      transfers: s.transfers.map((t) => (t.id === id ? updater(t) : t)),
    }))
  }

  function deleteTransfer(id) {
    if (!window.confirm('هل أنت متأكد من حذف هذه الحوالة؟ لا يمكن التراجع.')) return false
    setState((s) => ({
      ...s,
      transfers: s.transfers.filter((t) => t.id !== id),
    }))
    setFeedback('تم حذف الحوالة.')
    return true
  }

  function handleSettle(transferIds) {
    if (!window.confirm(`تأكيد تسوية ${transferIds.length} حوالة؟`)) return
    setState((s) => {
      const transferOnlyIds = transferIds
        .filter((id) => !String(id).startsWith('opening:'))
        .map((id) => Number(id))
      const openingCustomerIds = transferIds
        .filter((id) => String(id).startsWith('opening:'))
        .map((id) => Number(String(id).split(':')[1]))

      const ledgerSummary = summarizeLedgerByCustomer(s.customers, s.transfers, s.ledgerEntries)
      const openingEntries = openingCustomerIds
        .map((customerId) => {
          const ledger = ledgerSummary.get(customerId)
          if (!ledger || ledger.openingOutstandingAmount <= 0) return null
          return createOpeningSettlementEntry(
            customerId,
            ledger.openingOutstandingAmount,
            ledger.openingOutstandingTransferCount,
          )
        })
        .filter(Boolean)

      return {
        ...s,
        transfers: settleTransfers(s.transfers, transferOnlyIds),
        ledgerEntries: openingEntries.length > 0 ? [...s.ledgerEntries, ...openingEntries] : s.ledgerEntries,
      }
    })
    setFeedback(`تمت تسوية ${transferIds.length} عنصر.`)
  }

  function handleClaimProfit() {
    // Read current claimable amount from the latest state (not stale closure)
    const nonClaimLedger = state.ledgerEntries.filter((entry) => entry.type !== 'profit_claim')
    const currentSummary = summarizeOfficeLedger(
      state.customers,
      state.transfers,
      [...nonClaimLedger, ...state.claimHistory],
    )
    const claimedAmount = currentSummary.accountantClaimableProfit

    if (claimedAmount <= 0) {
      setFeedback('لا يوجد ربح متاح للمطالبة الآن.')
      return
    }

    // Confirm BEFORE touching state — pure updater below
    if (!window.confirm(`تأكيد مطالبة ربح بقيمة ${claimedAmount.toFixed(2)}؟`)) return

    const entry = createProfitClaimEntry(claimedAmount)
    setState((s) => ({
      ...s,
      claimHistory: [entry, ...s.claimHistory],
    }))
    setFeedback(`تم تسجيل مطالبة ربح بقيمة ${claimedAmount.toFixed(2)}.`)
  }

  function handleSaveDailyClosing(date) {
    setState((s) => {
      const customerSummarySnapshot = summarizeCustomers(s.customers, s.transfers, s.ledgerEntries)
      const nonClaimLedger = s.ledgerEntries.filter((entry) => entry.type !== 'profit_claim')
      const officeSummarySnapshot = summarizeOfficeLedger(
        s.customers,
        s.transfers,
        [...nonClaimLedger, ...s.claimHistory],
      )
      const closing = computeDailyClosing(
        s.transfers,
        customerSummarySnapshot,
        officeSummarySnapshot,
        s.claimHistory,
        date,
      )
      const record = createDailyClosingRecord(closing)
      const nextDailyClosings = [
        ...s.dailyClosings.filter((item) => item.date !== date),
        record,
      ].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())

      return {
        ...s,
        dailyClosings: nextDailyClosings,
      }
    })

    setFeedback(`تم حفظ سجل الإقفال ليوم ${date}.`)
  }

  function handleAddCustomer(e) {
    e.preventDefault()
    const result = buildCustomerFromDraft(customerDraft, customers)
    if (!result.ok) { setFeedback(result.error); return }
    const openingEntry = buildOpeningBalanceEntry(result.value)
    const legacyEntry = buildLegacySettlementEntry(result.value)
    const newEntries = [openingEntry, legacyEntry].filter(Boolean)
    setState((s) => ({
      ...s,
      customers: [...s.customers, result.value],
      ledgerEntries: newEntries.length > 0 ? [...s.ledgerEntries, ...newEntries] : s.ledgerEntries,
    }))
    setCustomerDraft(createEmptyCustomerDraft())
    setFeedback('تمت إضافة الزبون.')
  }

  function handleUpdateCustomer(customerId, patch) {
    // patch = { name?, openingBalance?, settledTotal?, openingTransferCount? }
    const trimmedName = typeof patch.name === 'string' ? patch.name.trim().replace(/\s+/g, ' ') : null
    if (trimmedName !== null && !trimmedName) {
      setFeedback('اسم الزبون لا يمكن أن يكون فارغاً.')
      return
    }
    const dupName = trimmedName && customers.some(
      (c) => c.id !== customerId && c.name.toLowerCase() === trimmedName.toLowerCase(),
    )
    if (dupName) {
      setFeedback('اسم الزبون موجود مسبقاً.')
      return
    }

    setState((s) => {
      const now = new Date().toISOString()
      const updatedCustomers = s.customers.map((c) => {
        if (c.id !== customerId) return c
        return {
          ...c,
          name: trimmedName ?? c.name,
          openingBalance: patch.openingBalance !== undefined
            ? Number(patch.openingBalance) || 0
            : c.openingBalance,
          settledTotal: patch.settledTotal !== undefined
            ? Number(patch.settledTotal) || 0
            : c.settledTotal,
          openingTransferCount: patch.openingTransferCount !== undefined
            ? Math.max(0, Math.trunc(Number(patch.openingTransferCount) || 0))
            : (c.openingTransferCount || 0),
          updatedAt: now,
        }
      })

      const updatedCustomer = updatedCustomers.find((c) => c.id === customerId)

      // Rebuild opening/legacy ledger entries for this customer only
      const otherEntries = s.ledgerEntries.filter((entry) =>
        entry.customerId !== customerId ||
        (entry.type !== 'opening_balance' && entry.type !== 'legacy_settlement'),
      )
      const newOpening = buildOpeningBalanceEntry(updatedCustomer)
      const newLegacy = buildLegacySettlementEntry(updatedCustomer)
      const rebuiltEntries = [newOpening, newLegacy].filter(Boolean)

      return {
        ...s,
        customers: updatedCustomers,
        ledgerEntries: [...otherEntries, ...rebuiltEntries],
      }
    })

    setFeedback('تم تعديل الزبون.')
  }

  function handleDeleteCustomer(customerId) {
    const customer = customers.find((c) => c.id === customerId)
    if (!customer) return

    // Block deletion if customer has any transfers
    const hasTransfers = transfers.some((t) => t.customerId === customerId)
    if (hasTransfers) {
      setFeedback(`لا يمكن حذف "${customer.name}" — لديه حوالات مرتبطة. احذف الحوالات أولاً.`)
      return
    }

    if (!window.confirm(`حذف الزبون "${customer.name}" نهائياً؟ لا يمكن التراجع.`)) return

    setState((s) => ({
      ...s,
      customers: s.customers.filter((c) => c.id !== customerId),
      // Remove ALL ledger entries belonging to this customer (opening, legacy, opening_settlements)
      ledgerEntries: s.ledgerEntries.filter((entry) => entry.customerId !== customerId),
    }))
    setFeedback(`تم حذف الزبون "${customer.name}".`)
  }

  function handleAddTransfer(e) {
    e.preventDefault()
    const result = buildTransferFromDraft(transferDraft, transfers, customers)
    if (!result.ok) { setFeedback(result.error); return }
    setState((s) => ({ ...s, transfers: [result.value, ...s.transfers] }))
    setTransferDraft(createEmptyTransferDraft())
    setFeedback('تمت إضافة الحوالة.')
  }

  function resetFilters() {
    setSearchTerm('')
    setStatusFilter(FILTER_ALL)
    setViewMode('active')
    setCustomerFilter(FILTER_ALL)
    setSortMode('smart')
    setDateFrom('')
    setDateTo('')
  }

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-${today}.csv`,
      content: buildCsv(filteredTransfers, customersById),
      contentType: 'text/csv;charset=utf-8;',
    })
  }

  function exportBackup() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-backup-${today}.json`,
      content: serializeAppState(state),
      contentType: 'application/json;charset=utf-8;',
    })
  }

  async function handleImportBackup(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!window.confirm('استرجاع النسخة الاحتياطية سيستبدل كل البيانات الحالية. هل أنت متأكد؟')) {
      e.target.value = ''
      return
    }
    try {
      const text = await file.text()
      setState(parseAppStateBackup(text))
      // Restore enables hydration and clears any prior load failure
      setLoadFailed(false)
      setIsHydrated(true)
      setFeedback('تم استرجاع النسخة الاحتياطية.')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'تعذر قراءة النسخة الاحتياطية.')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="app-shell" dir="rtl">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Western Office</h1>
          <span className="storage-badge">
            {storageMode === 'supabase' ? 'سحابي' : 'محلي'}
          </span>
        </div>
        <TabNav active={activeTab} onChange={changeTab} issueCount={issueCount} />
        <div className="topbar-actions">
          <button className="ghost-button" onClick={exportCsv} title="CSV">CSV</button>
          <button className="ghost-button" onClick={exportBackup} title="نسخة احتياطية">نسخة</button>
          <button className="ghost-button" onClick={() => importRef.current?.click()} title="استرجاع">استرجاع</button>
          <input
            ref={importRef}
            className="hidden-input"
            type="file"
            accept="application/json"
            onChange={handleImportBackup}
          />
        </div>
      </header>

      {loadFailed ? (
        <div className="error-banner">تعذر تحميل البيانات — التغييرات لن تُحفظ. أعد تحميل الصفحة.</div>
      ) : null}

      {feedback ? (
        <div className="feedback-banner" onClick={() => setFeedback('')}>{feedback}</div>
      ) : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span>الحوالات</span>
          <strong>{transferSummary.total}</strong>
        </article>
        <article className="stat-card">
          <span>عند الموظف</span>
          <strong className="text-blue">{transferSummary.withEmployeeCount}</strong>
        </article>
        <article className="stat-card">
          <span>مراجعة لاحقة</span>
          <strong className="text-orange">{transferSummary.reviewHoldCount}</strong>
        </article>
        <article className="stat-card stat-card--warning">
          <span>مشاكل</span>
          <strong>{issueCount}</strong>
        </article>
        <article className="stat-card">
          <span>بانتظار التسوية</span>
          <strong className="text-orange">{transferSummary.unsettledCount}</strong>
        </article>
        <article className="stat-card stat-card--highlight">
          <span>مستحق للزبائن الآن</span>
          <strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(officeSummary.officeCustomerLiability)}</strong>
        </article>
        <article className="stat-card">
          <span>عند المحاسب الآن</span>
          <strong className="text-blue">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(officeSummary.accountantCashOnHand)}</strong>
        </article>
        <article className="stat-card">
          <span>ربح قابل للـ Claim</span>
          <strong className="text-green">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(officeSummary.accountantClaimableProfit)}</strong>
        </article>
      </section>

      {activeTab === 'transfers' ? (
        <TransfersTab
          filteredTransfers={filteredTransfers}
          allTransfers={transfers}
          customers={customers}
          customersById={customersById}
          transferDraft={transferDraft}
          setTransferDraft={setTransferDraft}
          onAddTransfer={handleAddTransfer}
          onPatchTransfer={patchTransfer}
          onDeleteTransfer={deleteTransfer}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          viewMode={viewMode}
          setViewMode={setViewMode}
          customerFilter={customerFilter}
          setCustomerFilter={setCustomerFilter}
          sortMode={sortMode}
          setSortMode={setSortMode}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          onResetFilters={resetFilters}
          transferSummary={transferSummary}
          onFeedback={setFeedback}
        />
      ) : null}

      {activeTab === 'customers' ? (
        <CustomersTab
          customers={customers}
          customerSummary={customerSummary}
          customerDraft={customerDraft}
          setCustomerDraft={setCustomerDraft}
          onAddCustomer={handleAddCustomer}
          onUpdateCustomer={handleUpdateCustomer}
          onDeleteCustomer={handleDeleteCustomer}
          transfers={transfers}
          onPatchTransfer={patchTransfer}
          onFeedback={setFeedback}
          ledgerEntries={ledgerEntries}
        />
      ) : null}

      {activeTab === 'settlements' ? (
        <SettlementsTab
          customers={customers}
          transfers={transfers}
          ledgerEntries={ledgerEntries}
          onSettle={handleSettle}
        />
      ) : null}

      {activeTab === 'closing' ? (
        <DailyClosingTab
          transfers={transfers}
          customerSummary={customerSummary}
          officeSummary={officeSummary}
          claimHistory={claimHistory}
          dailyClosings={dailyClosings}
          customersById={customersById}
          onClaimProfit={handleClaimProfit}
          onSaveClosing={handleSaveDailyClosing}
        />
      ) : null}

      {activeTab === 'issues' ? (
        <IssuesTab
          transfers={transfers}
          customersById={customersById}
          onPatchTransfer={patchTransfer}
          onFeedback={setFeedback}
        />
      ) : null}
    </div>
  )
}

export default App
