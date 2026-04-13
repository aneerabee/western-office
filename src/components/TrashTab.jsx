import { useMemo, useState } from 'react'
import { statusMeta } from '../sampleData'
import { formatMoney } from '../lib/formatting'
import { getCustomerMonogram } from '../lib/customerTheme'

function formatDate(v) {
  if (!v) return '-'
  return new Intl.DateTimeFormat('ar', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v))
}

export default function TrashTab({
  deletedTransfers,
  deletedCustomers,
  customersById,
  onRestoreTransfer,
  onRestoreCustomer,
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | transfers | customers

  const q = query.trim().toLocaleLowerCase('ar')
  const filteredCustomers = useMemo(
    () =>
      deletedCustomers.filter((c) =>
        !q || (c.name || '').toLocaleLowerCase('ar').includes(q),
      ),
    [deletedCustomers, q],
  )
  const filteredTransfers = useMemo(
    () =>
      deletedTransfers.filter((t) => {
        if (!q) return true
        const customer = customersById.get(t.customerId)?.name || ''
        return (
          (t.reference || '').toLocaleLowerCase('ar').includes(q) ||
          (t.senderName || '').toLocaleLowerCase('ar').includes(q) ||
          (t.receiverName || '').toLocaleLowerCase('ar').includes(q) ||
          customer.toLocaleLowerCase('ar').includes(q)
        )
      }),
    [deletedTransfers, customersById, q],
  )

  const showTransfers = filter === 'all' || filter === 'transfers'
  const showCustomers = filter === 'all' || filter === 'customers'
  const totalCount = deletedTransfers.length + deletedCustomers.length
  const isEmpty = totalCount === 0

  return (
    <section className="panel trash-panel">
      <div className="panel-head compact">
        <h2>المحذوفات</h2>
        <span className="panel-count">{totalCount}</span>
      </div>

      <div className="trash-toolbar">
        <input
          className="search-input trash-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث في المحذوفات..."
          aria-label="بحث في العناصر المحذوفة"
        />
        <div className="trash-filter-tabs" role="tablist" aria-label="تصفية المحذوفات">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            aria-label={`الكل، ${totalCount} عنصر`}
            className={`trash-filter-tab ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            الكل <span className="trash-filter-count" aria-hidden="true">{totalCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'transfers'}
            aria-label={`حوالات، ${deletedTransfers.length} عنصر`}
            className={`trash-filter-tab ${filter === 'transfers' ? 'is-active' : ''}`}
            onClick={() => setFilter('transfers')}
          >
            حوالات <span className="trash-filter-count" aria-hidden="true">{deletedTransfers.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'customers'}
            aria-label={`زبائن، ${deletedCustomers.length} عنصر`}
            className={`trash-filter-tab ${filter === 'customers' ? 'is-active' : ''}`}
            onClick={() => setFilter('customers')}
          >
            زبائن <span className="trash-filter-count" aria-hidden="true">{deletedCustomers.length}</span>
          </button>
        </div>
      </div>

      <p className="trash-note">
        كل المحذوفات محفوظة بالكامل — لا يوجد حذف نهائي. اضغط "استعادة" لإعادة أي عنصر.
      </p>

      {isEmpty ? (
        <div className="empty-state issues-empty">
          <div className="issues-empty-icon" aria-hidden="true">🗑</div>
          <div className="issues-empty-title">السلة فارغة</div>
          <div className="issues-empty-sub">لم يتم حذف أي شيء</div>
        </div>
      ) : null}

      {showCustomers && filteredCustomers.length > 0 ? (
        <div className="trash-section">
          <h3 className="trash-section-title">
            زبائن محذوفون
            <span className="trash-section-count">{filteredCustomers.length}</span>
          </h3>
          <div className="trash-card-list">
            {filteredCustomers.map((c) => (
              <article key={c.id} className="trash-card trash-card--customer">
                <div className="trash-card-avatar" aria-hidden="true">
                  {getCustomerMonogram(c.name)}
                </div>
                <div className="trash-card-body">
                  <div className="trash-card-title">{c.name}</div>
                  <div className="trash-card-meta">
                    <span>رصيد افتتاحي: <strong>{formatMoney(c.openingBalance || 0)}</strong></span>
                    <span>حوالات افتتاحية: <strong>{c.openingTransferCount || 0}</strong></span>
                  </div>
                  <div className="trash-card-date">حُذف {formatDate(c.deletedAt)}</div>
                </div>
                <button
                  className="tc-btn tc-btn--save trash-restore-btn"
                  onClick={() => onRestoreCustomer(c.id)}
                >
                  ↻ استعادة
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {showTransfers && filteredTransfers.length > 0 ? (
        <div className="trash-section">
          <h3 className="trash-section-title">
            حوالات محذوفة
            <span className="trash-section-count">{filteredTransfers.length}</span>
          </h3>
          <div className="trash-card-list">
            {filteredTransfers.map((t) => (
              <article key={t.id} className="trash-card trash-card--transfer">
                <div className="trash-card-body">
                  <div className="trash-card-title">
                    <span className="trash-card-ref">⚫ {t.reference}</span>
                    <span className="trash-card-status">
                      {statusMeta[t.status]?.label || t.status}
                    </span>
                  </div>
                  <div className="trash-card-meta">
                    <span>
                      {customersById.get(t.customerId)?.name || t.receiverName || '—'}
                      {' · '}
                      {t.senderName || '—'} ← {t.receiverName || '—'}
                    </span>
                    {typeof t.transferAmount === 'number' ? (
                      <span>{formatMoney(t.transferAmount)}</span>
                    ) : null}
                  </div>
                  <div className="trash-card-date">حُذفت {formatDate(t.deletedAt)}</div>
                </div>
                <button
                  className="tc-btn tc-btn--save trash-restore-btn"
                  onClick={() => onRestoreTransfer(t.id)}
                >
                  ↻ استعادة
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!isEmpty && q
        && (!showTransfers || filteredTransfers.length === 0)
        && (!showCustomers || filteredCustomers.length === 0) ? (
        <div className="empty-state compact">لا توجد نتائج مطابقة للبحث</div>
      ) : null}
    </section>
  )
}
