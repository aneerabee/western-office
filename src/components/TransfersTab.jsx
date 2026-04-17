import { useMemo, useState } from 'react'
import { statusMeta } from '../sampleData'
import {
  FILTER_ALL,
  createEmptyTransferBatchRow,
  filterTransfers,
  statusOrder,
  sortTransfers,
  transitionTransfer,
  validateTransition,
  updateAmount,
  updateTransferField,
} from '../lib/transferLogic'
import {
  PERSON_KIND,
  collectNameSuggestions,
  getReceiverColorClass,
  lookupReceiverColor,
  referenceExists,
} from '../lib/people'
import { formatEditableNumber, formatMoney, normalizeNumberInput } from '../lib/formatting'
import CustomerBadge from './CustomerBadge'

function formatDate(v) {
  if (!v) return '-'
  return new Intl.DateTimeFormat('ar', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v))
}

const VIEW_LABELS = {
  active: 'نشطة — تحتاج انتباه',
  today: 'حوالات اليوم',
  all: 'كل الحوالات',
  completed: 'مكتملة فقط',
}

const STATUS_ICONS = {
  received: '●',
  with_employee: '➤',
  review_hold: '⏸',
  picked_up: '✓',
  issue: '⚠',
}

function CustomerPicker({ customers, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = customers.find((customer) => String(customer.id) === String(value))

  const visibleCustomers = customers
    .filter((customer) => customer.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))

  function pickCustomer(customerId) {
    onChange(String(customerId))
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={`customer-picker${open ? ' customer-picker--open' : ''}`}>
      <button
        type="button"
        className={`customer-picker-trigger ${selected ? 'customer-picker-trigger--selected' : ''}`}
        onClick={() => setOpen((state) => !state)}
      >
        <span className="customer-picker-label">{selected?.name || placeholder}</span>
        <span className="customer-picker-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div className="customer-picker-popover">
          <input
            className="customer-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث عن الزبون"
            autoFocus
          />
          <div className="customer-picker-list">
            <button
              type="button"
              className={`customer-picker-item ${!value ? 'customer-picker-item--active' : ''}`}
              onClick={() => pickCustomer('')}
            >
              {placeholder}
            </button>
            {visibleCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className={`customer-picker-item ${String(customer.id) === String(value) ? 'customer-picker-item--active' : ''}`}
                onClick={() => pickCustomer(customer.id)}
              >
                {customer.name}
              </button>
            ))}
            {visibleCustomers.length === 0 ? (
              <div className="customer-picker-empty">لا توجد نتائج</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function TransfersTab({
  filteredTransfers,
  allTransfers,
  customers,
  customersById,
  batchTransferDraft,
  setBatchTransferDraft,
  onAddTransferBatch,
  onPatchTransfer,
  onDeleteTransfer,
  onResetTransfer,
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  viewMode,
  setViewMode,
  customerFilter,
  setCustomerFilter,
  sortMode,
  setSortMode,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  onResetFilters,
  transferSummary,
  onFeedback,
  receiverColorMap,
  duplicateReferences,
  senders,
  receivers,
  readOnly = false,
  hideProfit = false,
}) {
  const [editingId, setEditingId] = useState(null)
  const [settledOpen, setSettledOpen] = useState(false)
  const [pickupFlowId, setPickupFlowId] = useState(null)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)

  // Does the user have any non-default filter active? Used to badge the
  // "فلاتر" toggle so filters aren't silently hiding results.
  const advancedFiltersActive =
    statusFilter !== FILTER_ALL ||
    customerFilter !== FILTER_ALL ||
    viewMode !== 'active' ||
    sortMode !== 'smart' ||
    Boolean(dateFrom) ||
    Boolean(dateTo)

  const senderSuggestions = useMemo(
    () => collectNameSuggestions(allTransfers, senders || [], PERSON_KIND.SENDER),
    [allTransfers, senders],
  )
  const receiverSuggestions = useMemo(
    () => collectNameSuggestions(allTransfers, receivers || [], PERSON_KIND.RECEIVER),
    [allTransfers, receivers],
  )

  const settledTransfers = useMemo(() => {
    const completedFilters = {
      searchTerm,
      statusFilter,
      viewMode: 'completed',
      customerFilter,
      dateFrom,
      dateTo,
    }

    return sortTransfers(
      filterTransfers(allTransfers, completedFilters, customersById),
      sortMode === 'smart' ? 'latest' : sortMode,
      customersById,
    )
  }, [
    allTransfers,
    customerFilter,
    customersById,
    dateFrom,
    dateTo,
    searchTerm,
    sortMode,
    statusFilter,
  ])

  const showSettledMatchesSection = viewMode === 'active' && settledTransfers.length > 0 && searchTerm.trim() !== ''
  const showSettledArchiveSection = viewMode === 'active' && settledTransfers.length > 0 && searchTerm.trim() === ''
  const isSettledSectionOpen = showSettledMatchesSection ? true : settledOpen

  // Smart grouped view
  const sections = sortMode === 'smart' ? groupBySections(filteredTransfers) : null

  function handleTransition(item, nextStatus) {
    if (nextStatus === 'received') {
      // Centralized rich confirm + undo flow lives in App.jsx
      onResetTransfer?.(item)
      return
    }
    const check = validateTransition(item, nextStatus)
    if (!check.ok) {
      if (nextStatus === 'picked_up') {
        setEditingId(item.id)
        setPickupFlowId(item.id)
        onFeedback(`${check.error} ثم اضغط حفظ السحب.`)
        return
      }
      onFeedback(check.error)
      setEditingId(item.id)
      return
    }
    setPickupFlowId(null)
    onPatchTransfer(item.id, (r) => transitionTransfer(r, nextStatus))
  }

  function updateBatchRow(rowId, field, value) {
    setBatchTransferDraft((draft) => ({
      ...draft,
      rows: draft.rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    }))
  }

  function addBatchRow() {
    setBatchTransferDraft((draft) => ({
      ...draft,
      rows: [...draft.rows, createEmptyTransferBatchRow()],
    }))
  }

  function removeBatchRow(rowId) {
    setBatchTransferDraft((draft) => {
      const nextRows = draft.rows.filter((row) => row.id !== rowId)
      return {
        ...draft,
        rows: nextRows.length > 0 ? nextRows : [createEmptyTransferBatchRow()],
      }
    })
  }

  return (
    <>
      {/* Autocomplete sources — always mounted so they work in single/batch/edit modes */}
      <datalist id="sender-name-suggestions">
        {senderSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="receiver-name-suggestions">
        {receiverSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {/* ── Add transfer (hidden in read-only mode) ── */}
      <section className="panel add-panel">
        {readOnly ? null : (
          <>
            <div className="add-panel__head">
              <div className="add-panel__title">
                <span className="add-panel__badge">+</span>
                <h2>إضافة حوالة</h2>
              </div>
              <span className="batch-form__count">
                {batchTransferDraft.rows.length === 1
                  ? 'حوالة واحدة'
                  : `${batchTransferDraft.rows.length} حوالات`}
              </span>
            </div>

          <form className="batch-form" onSubmit={onAddTransferBatch}>
            <div className="batch-form__customer">
              <CustomerPicker
                customers={customers}
                value={batchTransferDraft.customerId}
                onChange={(customerId) => setBatchTransferDraft((c) => ({ ...c, customerId }))}
                placeholder="اختر الزبون"
              />
            </div>

            <div className="batch-form__rows">
              {batchTransferDraft.rows.map((row, index) => {
                const rowDup = (row.reference || '').trim() !== '' && referenceExists(allTransfers, row.reference)
                const rowReceiverPreview = lookupReceiverColor(receiverColorMap, row.receiverName)
                const rowReceiverClass = getReceiverColorClass(rowReceiverPreview.colorLevel)
                return (
                  <div className="batch-row" key={row.id}>
                    <span className="batch-row__index">{index + 1}</span>
                    <div className="tf-cell">
                      <input
                        list="sender-name-suggestions"
                        value={row.senderName}
                        onChange={(e) => updateBatchRow(row.id, 'senderName', e.target.value)}
                        placeholder="المرسل"
                      />
                    </div>
                    <div className="tf-cell">
                      <input
                        list="receiver-name-suggestions"
                        className={rowReceiverClass ? `input-${rowReceiverClass}` : ''}
                        value={row.receiverName}
                        onChange={(e) => updateBatchRow(row.id, 'receiverName', e.target.value)}
                        placeholder="المستلم"
                      />
                      {row.receiverName && (rowReceiverPreview.total > 0 || rowReceiverPreview.isTurkish) ? (
                        <span className={`tf-float-chip ${rowReceiverClass || ''}`}>
                          {rowReceiverPreview.isTurkish ? <span title="مستلم تركي">🇹🇷</span> : null}
                          {rowReceiverPreview.total > 0 ? <span>{rowReceiverPreview.total}</span> : null}
                        </span>
                      ) : null}
                    </div>
                    <div className="tf-cell">
                      <input
                        className={rowDup ? 'input-duplicate-ref' : ''}
                        value={row.reference}
                        onChange={(e) => updateBatchRow(row.id, 'reference', e.target.value.toUpperCase())}
                        placeholder="رقم الحوالة"
                      />
                      {rowDup ? <span className="tf-float-chip tf-float-chip--warn">⚠</span> : null}
                    </div>
                    <div className="tf-cell">
                      <input
                        className="money-input"
                        inputMode="decimal"
                        value={formatEditableNumber(row.transferAmount)}
                        onChange={(e) => updateBatchRow(row.id, 'transferAmount', normalizeNumberInput(e.target.value))}
                        placeholder="المبلغ"
                      />
                    </div>
                    <div className="tf-cell">
                      <input
                        className="money-input"
                        inputMode="decimal"
                        value={formatEditableNumber(row.customerAmount)}
                        onChange={(e) => updateBatchRow(row.id, 'customerAmount', normalizeNumberInput(e.target.value))}
                        placeholder="للزبون"
                      />
                    </div>
                    <button
                      type="button"
                      className="batch-row__delete"
                      onClick={() => removeBatchRow(row.id)}
                      aria-label={`حذف الحوالة ${index + 1}`}
                      title="حذف هذه الحوالة"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="batch-form__actions">
              <button
                type="button"
                className="batch-add-row"
                onClick={addBatchRow}
              >
                ＋ إضافة حوالة أخرى
              </button>
              <button type="submit" className="transfer-submit">
                {batchTransferDraft.rows.length === 1
                  ? 'حفظ الحوالة'
                  : `حفظ ${batchTransferDraft.rows.length} حوالات`}
              </button>
            </div>
          </form>
          </>
        )}

        <div className="transfer-search-bar">
          <div className="transfer-search-bar__input">
            <span className="transfer-search-bar__icon" aria-hidden="true">⌕</span>
            <input
              className="search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث برقم الحوالة، اسم المرسل، أو المستلم..."
            />
            {searchTerm ? (
              <button
                type="button"
                className="transfer-search-bar__clear"
                onClick={() => setSearchTerm('')}
                aria-label="مسح البحث"
              >
                ×
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={`transfer-search-bar__toggle${advancedFiltersOpen ? ' transfer-search-bar__toggle--open' : ''}${advancedFiltersActive ? ' transfer-search-bar__toggle--active' : ''}`}
            onClick={() => setAdvancedFiltersOpen((v) => !v)}
            aria-expanded={advancedFiltersOpen}
          >
            فلاتر
            {advancedFiltersActive ? <span className="transfer-search-bar__dot" /> : null}
            <span className="transfer-search-bar__chevron" aria-hidden="true">{advancedFiltersOpen ? '▲' : '▼'}</span>
          </button>
        </div>

        {advancedFiltersOpen ? (
          <div className="advanced-filters">
            <select className="filter-select" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
              {Object.entries(VIEW_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {readOnly && customers.length <= 1 ? null : (
              <select className="filter-select" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
                <option value={FILTER_ALL}>كل الزبائن</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value={FILTER_ALL}>كل الحالات</option>
              {statusOrder.map((s) => (
                <option key={s} value={s}>{statusMeta[s].label}</option>
              ))}
            </select>
            <select className="filter-select" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="smart">ذكي</option>
              <option value="latest">الأحدث</option>
              <option value="oldest">الأقدم</option>
              <option value="customer">الزبون</option>
            </select>
            <input type="date" className="filter-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <input type="date" className="filter-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <button className="ghost-button ghost-button--muted" onClick={onResetFilters}>تصفير</button>
          </div>
        ) : null}
      </section>

      {/* ── Active transfers ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>الحوالات <span className="panel-count">{filteredTransfers.length}</span></h2>
          <div className="totals-line">
            <span>المستلم: {formatMoney(transferSummary.totalSystem)}</span>
            <span>للزبائن: {formatMoney(transferSummary.totalCustomer)}</span>
            {hideProfit ? null : (
              <span>الربح: {formatMoney(transferSummary.totalMargin)}</span>
            )}
          </div>
        </div>

        {filteredTransfers.length === 0 ? (
          <div className="empty-state">
            {viewMode === 'active'
              ? (showSettledMatchesSection
                  ? 'لا توجد حوالات نشطة مطابقة، وتوجد حوالات مسوّاة مطابقة في الأسفل.'
                  : 'لا توجد حوالات نشطة حالياً')
              : 'لا توجد نتائج'}
          </div>
        ) : sections ? (
          sections.map((section) => {
            if (section.items.length === 0) return null
            return (
              <div key={section.key} className="transfer-section">
                <div className="section-header" style={{ '--section-color': section.color }}>
                  <span className="section-dot" />
                  <span>{section.label}</span>
                  <span className="section-count">{section.items.length}</span>
                </div>
                <TransferTable
                  items={section.items}
                  customers={customers}
                  customersById={customersById}
                  onPatchTransfer={onPatchTransfer}
                  onDeleteTransfer={onDeleteTransfer}
                  onResetTransfer={onResetTransfer}
                  onTransition={handleTransition}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  pickupFlowId={pickupFlowId}
                  setPickupFlowId={setPickupFlowId}
                  onFeedback={onFeedback}
                  receiverColorMap={receiverColorMap}
                  duplicateReferences={duplicateReferences}
                  readOnly={readOnly}
                  hideProfit={hideProfit}
                />
              </div>
            )
          })
        ) : (
          <TransferTable
            items={filteredTransfers}
            customers={customers}
            customersById={customersById}
            onPatchTransfer={onPatchTransfer}
            onDeleteTransfer={onDeleteTransfer}
            onResetTransfer={onResetTransfer}
            onTransition={handleTransition}
            editingId={editingId}
            setEditingId={setEditingId}
            pickupFlowId={pickupFlowId}
            setPickupFlowId={setPickupFlowId}
            onFeedback={onFeedback}
            receiverColorMap={receiverColorMap}
            duplicateReferences={duplicateReferences}
            readOnly={readOnly}
            hideProfit={hideProfit}
          />
        )}
      </section>

      {/* ── Settled transfers section ── */}
      {showSettledMatchesSection || showSettledArchiveSection ? (
        <section className="panel settled-panel">
          <div className="panel-head">
            <button
              className="settled-toggle"
              onClick={() => setSettledOpen((v) => !v)}
            >
              <h2>
                {showSettledMatchesSection ? 'حوالات مسوّاة مطابقة للبحث' : 'حوالات مسوّاة'}
                <span className="panel-count">{settledTransfers.length}</span>
                <span className="toggle-arrow">{isSettledSectionOpen ? '▲' : '▼'}</span>
              </h2>
            </button>
          </div>

          {isSettledSectionOpen ? (
            <div className="transfer-card-list transfer-card-list--settled">
              {settledTransfers.map((t) => {
                const settledRefKey = String(t.reference || '').trim().toUpperCase()
                const settledIsDup = duplicateReferences && settledRefKey && duplicateReferences.has(settledRefKey)
                const settledReceiverPreview = lookupReceiverColor(receiverColorMap, t.receiverName)
                const settledReceiverClass = getReceiverColorClass(settledReceiverPreview.colorLevel)
                return (
                  <article
                    key={t.id}
                    className={`transfer-card tc-status-picked_up tc-settled ${settledIsDup ? 'tc-duplicate' : ''}`}
                  >
                    <div className="tc-stripe" aria-hidden="true" />
                    <div className="tc-body">
                      <div className="tc-row tc-row--top">
                        <div className="tc-ref-block">
                          <span className="tc-ref">{t.reference}</span>
                          <span className="tc-date">تسوية: {formatDate(t.settledAt || t.updatedAt)}</span>
                        </div>
                        <span className="tc-status-pill tc-status-pill--settled">
                          <span className="tc-status-icon" aria-hidden="true">✓</span>
                          مسوّاة
                        </span>
                        {settledIsDup ? (
                          <span className="tc-dup-badge">⚠ مكرر</span>
                        ) : null}
                        <div className="tc-customer-slot">
                          <CustomerBadge customer={customersById.get(t.customerId)} fallbackName={t.receiverName} compact />
                        </div>
                        <div className="tc-flow">
                          <span className="tc-flow-label">المرسل</span>
                          <span className="tc-sender">{t.senderName}</span>
                          <span className="tc-arrow" aria-hidden="true">←</span>
                          <span className="tc-flow-label">المستلم</span>
                          <span
                            className={`tc-receiver ${settledReceiverClass}`}
                            title={settledReceiverPreview.total > 0 ? `قديم ${settledReceiverPreview.legacyCount} + نظام ${settledReceiverPreview.systemCount} = ${settledReceiverPreview.total}` : undefined}
                          >
                            {settledReceiverPreview.isTurkish ? (
                              <span className="receiver-turkish-flag" title="مستلم تركي" style={{ marginInlineEnd: 4 }}>🇹🇷</span>
                            ) : null}
                            {t.receiverName || '-'}
                            {settledReceiverPreview.total > 0 ? (
                              <span className="tc-receiver-count">{settledReceiverPreview.total}</span>
                            ) : null}
                          </span>
                        </div>
                      </div>
                      <div className="tc-row tc-row--amounts">
                        <AmountChip label="الحوالة" value={t.transferAmount} kind="transfer" missing={typeof t.transferAmount !== 'number'} />
                        <span className="tc-amount-sep">←</span>
                        <AmountChip label="للزبون" value={t.customerAmount} kind="customer" missing={typeof t.customerAmount !== 'number'} />
                        {hideProfit ? null : (
                          <>
                            <span className="tc-amount-sep">←</span>
                            <AmountChip label="من الموظف" value={t.systemAmount} kind="system" missing={typeof t.systemAmount !== 'number'} />
                            <span className="tc-amount-sep">=</span>
                            <AmountChip label="الربح" value={t.margin} kind="margin" highlight={t.margin !== null && t.margin > 0} />
                          </>
                        )}
                      </div>
                      {t.note ? (
                        <div className="tc-note">
                          <span className="tc-note-icon" aria-hidden="true">📝</span>
                          <span className="tc-note-text">{t.note}</span>
                        </div>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

/* ── Section grouping ── */

const SECTION_META = [
  { key: 'issue', label: 'مشاكل — تحتاج حل', color: '#dc2626' },
  { key: 'review_hold', label: 'مراجعة لاحقة — ذكّر المكتب بها', color: '#a16207' },
  { key: 'received', label: 'جديدة — بانتظار الإرسال للموظف', color: '#64748b' },
  { key: 'with_employee', label: 'عند الموظف — بانتظار السحب', color: '#2563eb' },
  { key: 'picked_up', label: 'تم السحب', color: '#15803d' },
]

function groupBySections(transfers) {
  const groups = { issue: [], review_hold: [], received: [], with_employee: [], picked_up: [] }
  for (const t of transfers) {
    const key = groups[t.status] ? t.status : 'received'
    groups[key].push(t)
  }
  return SECTION_META.map((s) => ({ ...s, items: groups[s.key] || [] }))
}

/* ── Status action buttons with validation ── */

function StatusActions({ item, onTransition }) {
  if (item.status === 'received') {
    return (
      <button
        className="action-btn action-btn--blue"
        onClick={() => onTransition(item, 'with_employee')}
      >
        أرسل للموظف
      </button>
    )
  }
  if (item.status === 'with_employee') {
    return (
      <div className="action-group">
        <button
          className="action-btn action-btn--green"
          onClick={() => onTransition(item, 'picked_up')}
        >
          تم السحب
        </button>
        <button
          className="action-btn ghost-button--muted"
          onClick={() => onTransition(item, 'review_hold')}
        >
          مراجعة لاحقة
        </button>
        <button
          className="action-btn action-btn--red"
          onClick={() => onTransition(item, 'issue')}
        >
          مشكلة
        </button>
      </div>
    )
  }
  if (item.status === 'review_hold') {
    return (
      <div className="action-group">
        <button
          className="action-btn action-btn--green"
          onClick={() => onTransition(item, 'picked_up')}
        >
          تم السحب
        </button>
        <button
          className="action-btn action-btn--red"
          onClick={() => onTransition(item, 'issue')}
        >
          مشكلة
        </button>
        <button
          className="action-btn action-btn--red"
          onClick={() => onTransition(item, 'received')}
          title="إعادة هذه الحوالة فقط لحالة جديدة (مسح المبالغ والتواريخ)"
        >
          ⚠ أعدها جديدة
        </button>
      </div>
    )
  }
  if (item.status === 'picked_up') {
    return <span className="status-done-badge">تم السحب</span>
  }
  if (item.status === 'issue') {
    return (
      <button
        className="action-btn action-btn--red"
        onClick={() => onTransition(item, 'received')}
        title="إعادة هذه الحوالة فقط لحالة جديدة (مسح المبالغ والتواريخ)"
      >
        ⚠ أعدها جديدة
      </button>
    )
  }
  return null
}

/* ── Transfer table with edit mode ── */

function TransferTable({
  items,
  customers,
  customersById,
  onPatchTransfer,
  onDeleteTransfer,
  onResetTransfer,
  onTransition,
  editingId,
  setEditingId,
  pickupFlowId,
  setPickupFlowId,
  onFeedback,
  receiverColorMap,
  duplicateReferences,
  readOnly = false,
  hideProfit = false,
}) {
  function handleSave(item) {
    const isPickupFlow = pickupFlowId === item.id
    if (isPickupFlow) {
      const check = validateTransition(item, 'picked_up')
      if (!check.ok) {
        onFeedback(check.error)
        return
      }
      onPatchTransfer(item.id, (row) => transitionTransfer(row, 'picked_up'))
      setPickupFlowId(null)
    }
    setEditingId(null)
  }

  return (
    <div className="transfer-card-list">
      {items.map((item) => {
        const isEditing = editingId === item.id
        const isPickupFlow = pickupFlowId === item.id
        const refKey = String(item.reference || '').trim().toUpperCase()
        const isDuplicateRef = duplicateReferences && refKey && duplicateReferences.has(refKey)
        const receiverPreview = lookupReceiverColor(receiverColorMap, item.receiverName)
        const receiverColorClass = getReceiverColorClass(receiverPreview.colorLevel)
        const customer = customersById.get(item.customerId)

        const cardClasses = [
          'transfer-card',
          `tc-status-${item.status}`,
          item.settled ? 'tc-settled' : '',
          isEditing ? 'tc-editing' : '',
          isDuplicateRef ? 'tc-duplicate' : '',
        ].filter(Boolean).join(' ')

        return (
          <article key={item.id} className={cardClasses}>
            <div className="tc-stripe" aria-hidden="true" />

            <div className="tc-body">
              <div className="tc-row tc-row--top">
                <div className="tc-ref-block">
                  <span className="tc-ref">{item.reference}</span>
                  <span className="tc-date">{formatDate(item.createdAt)}</span>
                </div>

                <span className={`tc-status-pill tc-status-pill--${item.status}`}>
                  <span className="tc-status-icon" aria-hidden="true">{STATUS_ICONS[item.status]}</span>
                  {statusMeta[item.status]?.label}
                </span>

                {isDuplicateRef ? (
                  <span className="tc-dup-badge" title="رقم الحوالة مكرر">⚠ مكرر</span>
                ) : null}

                <div className="tc-customer-slot">
                  <CustomerBadge customer={customer} fallbackName={item.receiverName} compact />
                </div>

                <div className="tc-flow">
                  <span className="tc-flow-label">المرسل</span>
                  <span className="tc-sender">{item.senderName || '-'}</span>
                  <span className="tc-arrow" aria-hidden="true">←</span>
                  <span className="tc-flow-label">المستلم</span>
                  <span
                    className={`tc-receiver ${receiverColorClass}`}
                    title={receiverPreview.total > 0 ? `قديم ${receiverPreview.legacyCount} + نظام ${receiverPreview.systemCount} = ${receiverPreview.total}` : undefined}
                  >
                    {receiverPreview.isTurkish ? (
                      <span className="receiver-turkish-flag" title="مستلم تركي" style={{ marginInlineEnd: 4 }}>🇹🇷</span>
                    ) : null}
                    {item.receiverName || '-'}
                    {receiverPreview.total > 0 ? (
                      <span className="tc-receiver-count">{receiverPreview.total}</span>
                    ) : null}
                  </span>
                </div>
              </div>

              {!isEditing ? (
                <div className="tc-row tc-row--amounts">
                  <AmountChip
                    label="الحوالة"
                    value={item.transferAmount}
                    kind="transfer"
                    missing={typeof item.transferAmount !== 'number'}
                  />
                  <span className="tc-amount-sep">←</span>
                  <AmountChip
                    label="للزبون"
                    value={item.customerAmount}
                    kind="customer"
                    missing={typeof item.customerAmount !== 'number'}
                  />
                  {hideProfit ? null : (
                    <>
                      <span className="tc-amount-sep">←</span>
                      <AmountChip
                        label="من الموظف"
                        value={item.systemAmount}
                        kind="system"
                        missing={typeof item.systemAmount !== 'number'}
                        showWaiting={item.status === 'with_employee'}
                      />
                      <span className="tc-amount-sep">=</span>
                      <AmountChip
                        label="الربح"
                        value={item.margin}
                        kind="margin"
                        highlight={item.margin !== null && item.margin > 0}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {item.note && !isEditing ? (
                <div className="tc-note">
                  <span className="tc-note-icon" aria-hidden="true">📝</span>
                  <span className="tc-note-text">{item.note}</span>
                </div>
              ) : null}

              {isEditing ? (
                <div className="tc-edit-form">
                  <div className="tc-edit-grid">
                    <label className="tc-field">
                      <span>رقم الحوالة</span>
                      <input
                        className="tc-input"
                        value={item.reference}
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateTransferField(r, 'reference', e.target.value.toUpperCase()))
                        }
                      />
                    </label>
                    <label className="tc-field">
                      <span>الزبون</span>
                      <select
                        className="tc-input"
                        value={customers.some((c) => c.id === item.customerId) ? item.customerId : ''}
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateTransferField(r, 'customerId', Number(e.target.value)))
                        }
                      >
                        <option value="" disabled>اختر زبوناً</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="tc-field">
                      <span>المرسل</span>
                      <input
                        list="sender-name-suggestions"
                        className="tc-input"
                        value={item.senderName || ''}
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateTransferField(r, 'senderName', e.target.value))
                        }
                      />
                    </label>
                    <label className="tc-field">
                      <span>المستلم</span>
                      <input
                        list="receiver-name-suggestions"
                        className="tc-input"
                        value={item.receiverName || ''}
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateTransferField(r, 'receiverName', e.target.value))
                        }
                      />
                    </label>
                    <label className="tc-field">
                      <span>الحوالة</span>
                      <input
                        className="tc-input money-input"
                        inputMode="decimal"
                        value={formatEditableNumber(item.transferAmount ?? '')}
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateAmount(r, 'transferAmount', normalizeNumberInput(e.target.value)))
                        }
                      />
                    </label>
                    <label className="tc-field">
                      <span>للزبون</span>
                      <input
                        className="tc-input money-input"
                        inputMode="decimal"
                        value={formatEditableNumber(item.customerAmount ?? '')}
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateAmount(r, 'customerAmount', normalizeNumberInput(e.target.value)))
                        }
                      />
                    </label>
                    <label className="tc-field">
                      <span>من الموظف</span>
                      <input
                        className="tc-input money-input"
                        inputMode="decimal"
                        value={formatEditableNumber(item.systemAmount ?? '')}
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateAmount(r, 'systemAmount', normalizeNumberInput(e.target.value)))
                        }
                      />
                    </label>
                    <div className="tc-field tc-field--readonly">
                      <span>الربح</span>
                      <div className={`tc-readonly-value ${item.margin !== null && item.margin > 0 ? 'text-green' : ''}`}>
                        {item.margin === null ? '—' : formatMoney(item.margin)}
                      </div>
                    </div>
                    <label className="tc-field tc-field--full">
                      <span>ملاحظة</span>
                      <input
                        className="tc-input"
                        value={item.note || ''}
                        placeholder="اكتب ملاحظة إذا لزم الأمر"
                        onChange={(e) =>
                          onPatchTransfer(item.id, (r) => updateTransferField(r, 'note', e.target.value))
                        }
                      />
                    </label>
                    <div className="tc-field tc-field--full">
                      <span>الحالة</span>
                      {isPickupFlow ? (
                        <div className="tc-pickup-hint">
                          <span className="status-dot" />
                          تأكيد السحب بعد الحفظ
                        </div>
                      ) : (
                        <select
                          className="tc-input"
                          value={item.status}
                          onChange={(e) => {
                            const next = e.target.value
                            if (next === 'received') {
                              onResetTransfer?.(item)
                              return
                            }
                            const check = validateTransition(item, next)
                            if (!check.ok) { onFeedback(check.error); return }
                            onPatchTransfer(item.id, (r) => transitionTransfer(r, next))
                          }}
                        >
                          {statusOrder.map((s) => (
                            <option key={s} value={s}>{statusMeta[s].label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <TransferHistoryView history={item.history} />
                </div>
              ) : null}
            </div>

            {readOnly ? null : (
              <div className="tc-actions">
                {!isEditing ? (
                  <>
                    <StatusActions item={item} onTransition={onTransition} />
                    <button
                      className="tc-btn tc-btn--edit"
                      onClick={() => setEditingId(item.id)}
                    >
                      تعديل
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="tc-btn tc-btn--save"
                      onClick={() => handleSave(item)}
                    >
                      {isPickupFlow ? 'حفظ السحب' : 'حفظ'}
                    </button>
                    <button
                      className={isPickupFlow ? 'tc-btn tc-btn--ghost' : 'tc-btn tc-btn--danger'}
                      onClick={() => {
                        if (isPickupFlow) {
                          setPickupFlowId(null)
                          setEditingId(null)
                          return
                        }
                        if (onDeleteTransfer(item.id)) setEditingId(null)
                      }}
                    >
                      {isPickupFlow ? 'إلغاء' : 'حذف'}
                    </button>
                  </>
                )}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

/* ── Transfer history view (read-only) ── */
const HISTORY_FIELD_LABELS = {
  status: 'الحالة',
  reference: 'رقم الحوالة',
  customerId: 'الزبون',
  senderName: 'المرسل',
  receiverName: 'المستلم',
  transferAmount: 'مبلغ الحوالة',
  customerAmount: 'مبلغ الزبون',
  systemAmount: 'مبلغ الموظف',
  margin: 'الربح',
  note: 'ملاحظة',
  issueCode: 'نوع المشكلة',
}

function formatHistoryValue(value) {
  if (value == null || value === '') return '—'
  return String(value)
}

function formatHistoryDate(iso) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('ar', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function TransferHistoryView({ history }) {
  const [open, setOpen] = useState(false)
  const items = Array.isArray(history) ? history : []
  if (items.length === 0) {
    return (
      <div className="tc-history-wrap">
        <div className="tc-history-empty">📜 لا يوجد سجلّ تاريخي لهذه الحوالة بعد</div>
      </div>
    )
  }
  // Newest first
  const sorted = [...items].reverse()
  const visible = open ? sorted : sorted.slice(0, 5)
  return (
    <div className="tc-history-wrap">
      <button
        type="button"
        className="tc-history-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: '#f1f5f9',
          border: '1px solid #cbd5e1',
          padding: '6px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 'bold',
          width: '100%',
          textAlign: 'right',
        }}
      >
        📜 السجلّ التاريخي ({items.length}) {open ? '▲' : '▼'}
      </button>
      <ul
        className="tc-history-list"
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '8px 0 0 0',
          maxHeight: open ? 'none' : 220,
          overflow: open ? 'visible' : 'auto',
          fontSize: '0.85rem',
        }}
      >
        {visible.map((entry, i) => {
          const fieldLabel = HISTORY_FIELD_LABELS[entry.field] || entry.field
          return (
            <li
              key={i}
              style={{
                padding: '6px 8px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'baseline',
              }}
            >
              <span style={{ color: '#64748b', minWidth: 90 }}>
                {formatHistoryDate(entry.at)}
              </span>
              <strong style={{ color: '#0f172a' }}>{fieldLabel}:</strong>
              <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>
                {formatHistoryValue(entry.from)}
              </span>
              <span style={{ color: '#64748b' }}>←</span>
              <span style={{ color: '#16a34a', fontWeight: 'bold' }}>
                {formatHistoryValue(entry.to)}
              </span>
            </li>
          )
        })}
        {!open && sorted.length > 5 ? (
          <li style={{ padding: '6px 8px', color: '#64748b', textAlign: 'center' }}>
            ... + {sorted.length - 5} تغيير أقدم — اضغط الزر أعلاه للعرض الكامل
          </li>
        ) : null}
      </ul>
    </div>
  )
}

function AmountChip({ label, value, kind, missing, showWaiting, highlight }) {
  if (missing) {
    if (kind === 'system' && showWaiting) {
      return (
        <span className="amount-chip amount-chip--waiting">
          <span className="amount-chip-label">{label}</span>
          <span className="amount-chip-value">ينتظر</span>
        </span>
      )
    }
    if (kind === 'margin') {
      return (
        <span className="amount-chip amount-chip--margin amount-chip--empty">
          <span className="amount-chip-label">{label}</span>
          <span className="amount-chip-value">—</span>
        </span>
      )
    }
    return (
      <span className="amount-chip amount-chip--missing">
        <span className="amount-chip-label">{label}</span>
        <span className="amount-chip-value">مطلوب</span>
      </span>
    )
  }

  return (
    <span className={`amount-chip amount-chip--${kind}${highlight ? ' amount-chip--highlight' : ''}`}>
      <span className="amount-chip-label">{label}</span>
      <span className="amount-chip-value">{formatMoney(value)}</span>
    </span>
  )
}
