import { issueCatalog } from '../sampleData'
import { transitionTransfer, updateTransferField, validateTransition } from '../lib/transferLogic'

function formatDate(v) {
  if (!v) return '-'
  return new Intl.DateTimeFormat('ar', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v))
}

export default function IssuesTab({ transfers, customersById, onPatchTransfer, onFeedback }) {
  const issues = transfers.filter((t) => t.status === 'issue')

  const byCode = {}
  for (const t of issues) {
    const code = t.issueCode || 'unknown'
    if (!byCode[code]) byCode[code] = []
    byCode[code].push(t)
  }

  const labels = Object.fromEntries(issueCatalog.map((i) => [i.code, i.label]))
  labels.unknown = 'غير محدد'

  function reopenTransfer(item) {
    if (!window.confirm('إعادة الحوالة لـ "جديدة" ستمسح كل المبالغ والتواريخ. هل أنت متأكد؟')) return
    const check = validateTransition(item, 'received')
    if (!check.ok) {
      onFeedback?.(check.error)
      return
    }
    onPatchTransfer(item.id, (r) => transitionTransfer(r, 'received'))
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>المشاكل</h2>
        <span className="issue-total-badge">{issues.length}</span>
      </div>

      {issues.length === 0 ? (
        <div className="empty-state">لا توجد مشاكل حالياً</div>
      ) : (
        Object.entries(byCode).map(([code, items]) => (
          <div key={code} className="issue-group">
            <div className="issue-group-header">
              <span className="issue-type-badge">{labels[code] || code}</span>
              <span className="issue-group-count">{items.length}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الزبون</th>
                    <th>المرسل</th>
                    <th>التاريخ</th>
                    <th>نوع المشكلة</th>
                    <th>ملاحظة</th>
                    <th>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td className="ref-cell">{t.reference}</td>
                      <td>{customersById.get(t.customerId)?.name || t.receiverName}</td>
                      <td>{t.senderName}</td>
                      <td className="date-cell">{formatDate(t.createdAt)}</td>
                      <td>
                        <select
                          className="table-select"
                          value={t.issueCode || ''}
                          onChange={(e) =>
                            onPatchTransfer(t.id, (r) =>
                              updateTransferField(r, 'issueCode', e.target.value),
                            )
                          }
                        >
                          <option value="">غير محدد</option>
                          {issueCatalog.map((i) => (
                            <option key={i.code} value={i.code}>{i.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="table-input"
                          value={t.note || ''}
                          placeholder="ملاحظة..."
                          onChange={(e) =>
                            onPatchTransfer(t.id, (r) =>
                              updateTransferField(r, 'note', e.target.value),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="action-btn action-btn--blue"
                          onClick={() => reopenTransfer(t)}
                        >
                          أعدها جديدة
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  )
}
