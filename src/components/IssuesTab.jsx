import { issueCatalog } from '../sampleData'
import { updateTransferField } from '../lib/transferLogic'
import { getReceiverColorClass, lookupReceiverColor } from '../lib/people'
import CustomerBadge from './CustomerBadge'

function formatRelativeTime(isoString) {
  if (!isoString) return '—'
  const ms = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'الآن'
  if (mins < 60) return `قبل ${mins} دقيقة`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `قبل ${hours} ساعة`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'قبل يوم'
  if (days < 30) return `قبل ${days} يوم`
  const months = Math.floor(days / 30)
  if (months === 1) return 'قبل شهر'
  return `قبل ${months} شهر`
}

function getAgeSeverity(isoString) {
  if (!isoString) return 'fresh'
  const hours = (Date.now() - new Date(isoString).getTime()) / 3600000
  if (hours < 24) return 'fresh'
  if (hours < 72) return 'warming'
  if (hours < 168) return 'hot'
  return 'critical'
}

export default function IssuesTab({
  transfers,
  customersById,
  onPatchTransfer,
  onResetTransfer,
  onFeedback,
  receiverColorMap,
  duplicateReferences,
}) {
  const issues = transfers.filter((t) => t.status === 'issue')

  const byCode = {}
  for (const t of issues) {
    const code = t.issueCode || 'unknown'
    if (!byCode[code]) byCode[code] = []
    byCode[code].push(t)
  }

  const labels = Object.fromEntries(issueCatalog.map((i) => [i.code, i.label]))
  labels.unknown = 'غير محدد'

  return (
    <section className="panel issues-panel">
      <div className="panel-head compact">
        <h2>المشاكل</h2>
        <span className="issue-total-badge">{issues.length}</span>
      </div>

      {issues.length === 0 ? (
        <div className="empty-state issues-empty">
          <div className="issues-empty-icon" aria-hidden="true">✓</div>
          <div className="issues-empty-title">لا توجد مشاكل حالياً</div>
          <div className="issues-empty-sub">كل شيء تمام — استمرّ</div>
        </div>
      ) : (
        Object.entries(byCode).map(([code, items]) => (
          <div key={code} className="issue-group-v2">
            <div className="issue-group-header-v2">
              <span className="issue-type-chip">{labels[code] || code}</span>
              <span className="issue-group-count-v2">{items.length} حوالة</span>
            </div>

            <div className="issue-card-list">
              {items.map((t) => {
                const ageSeverity = getAgeSeverity(t.issueAt || t.createdAt)
                const refKey = String(t.reference || '').trim().toUpperCase()
                const isDupRef = duplicateReferences && refKey && duplicateReferences.has(refKey)
                const receiverPreview = lookupReceiverColor(receiverColorMap, t.receiverName)
                const receiverClass = getReceiverColorClass(receiverPreview.colorLevel)
                const cardClass = [
                  'issue-card',
                  `age-${ageSeverity}`,
                  isDupRef ? 'tc-duplicate' : '',
                ].filter(Boolean).join(' ')

                return (
                  <article key={t.id} className={cardClass}>
                    <div className="issue-stripe" aria-hidden="true" />
                    <div className="issue-card-body">
                      <div className="issue-card-top">
                        <div className="issue-ref-block">
                          <span className="issue-ref">⚠ {t.reference}</span>
                          <span className={`issue-age issue-age--${ageSeverity}`}>
                            {formatRelativeTime(t.issueAt || t.createdAt)}
                          </span>
                        </div>
                        {isDupRef ? <span className="tc-dup-badge">⚠ مكرر</span> : null}
                        <div className="issue-customer">
                          <CustomerBadge
                            customer={customersById.get(t.customerId)}
                            fallbackName={t.receiverName}
                            compact
                          />
                        </div>
                        <div className="issue-flow">
                          <span className="tc-sender">{t.senderName || '-'}</span>
                          <span className="tc-arrow" aria-hidden="true">←</span>
                          <span
                            className={`tc-receiver ${receiverClass}`}
                            title={receiverPreview.total > 0 ? `قديم ${receiverPreview.legacyCount} + نظام ${receiverPreview.systemCount} = ${receiverPreview.total}` : undefined}
                          >
                            {t.receiverName || '-'}
                            {receiverPreview.total > 0 ? (
                              <span className="tc-receiver-count">{receiverPreview.total}</span>
                            ) : null}
                          </span>
                        </div>
                      </div>

                      <div className="issue-card-controls">
                        <label className="issue-field">
                          <span>نوع المشكلة</span>
                          <select
                            className="tc-input"
                            value={t.issueCode || ''}
                            onChange={(e) =>
                              onPatchTransfer(t.id, (r) => updateTransferField(r, 'issueCode', e.target.value))
                            }
                          >
                            <option value="">غير محدد</option>
                            {issueCatalog.map((i) => (
                              <option key={i.code} value={i.code}>{i.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="issue-field issue-field--grow">
                          <span>ملاحظة</span>
                          <input
                            className="tc-input"
                            value={t.note || ''}
                            placeholder="اشرح المشكلة..."
                            onChange={(e) =>
                              onPatchTransfer(t.id, (r) => updateTransferField(r, 'note', e.target.value))
                            }
                          />
                        </label>
                      </div>
                    </div>

                    <div className="issue-card-actions">
                      <button
                        className="tc-btn tc-btn--danger"
                        onClick={() => onResetTransfer?.(t)}
                        title="إعادة هذه الحوالة فقط لحالة جديدة (مسح المبالغ والتواريخ)"
                      >
                        ⚠ أعدها جديدة
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        ))
      )}
    </section>
  )
}
