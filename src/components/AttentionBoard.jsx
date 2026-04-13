import { useState } from 'react'
import { ALERT_KIND } from '../lib/attentionBoard'

/*
  AttentionBoard — collapsible proactive alerts panel.

  Auto-hides when there are zero alerts. When there's at least one,
  it renders a compact bar at the top of the app with:
    - Severity-colored pills, URGENT first
    - Click-to-act button that deep-links to the relevant tab

  The actual alerts come pre-sorted and deduped from buildAttentionAlerts.
  This component is dumb on purpose — no computation, just rendering +
  delegating navigation back to the parent.
*/

const SEVERITY_LABELS = {
  urgent: 'عاجل',
  warning: 'تنبيه',
  info: 'معلومة',
}

function ActionButton({ alert, onAction }) {
  if (alert.kind === ALERT_KIND.CLAIMABLE_PROFIT) {
    return (
      <button
        type="button"
        className="attention-action attention-action--primary"
        onClick={() => onAction?.({ type: 'claim-profit' })}
      >
        ✋ اسحب الآن
      </button>
    )
  }
  if (alert.kind === ALERT_KIND.DUPLICATE_REFERENCE) {
    return (
      <button
        type="button"
        className="attention-action"
        onClick={() => onAction?.({ type: 'filter-transfers', search: alert.reference })}
      >
        🔍 اعرض
      </button>
    )
  }
  // STUCK_WITH_EMPLOYEE or UNRESOLVED_ISSUE — jump to transfers tab with the reference filter
  return (
    <button
      type="button"
      className="attention-action"
      onClick={() => onAction?.({ type: 'filter-transfers', search: alert.reference, transferId: alert.transferId })}
    >
      ↗ افتح
    </button>
  )
}

function AlertRow({ alert, onAction }) {
  return (
    <div className={`attention-alert attention-alert--${alert.severity}`}>
      <span className="attention-alert-icon" aria-hidden="true">{alert.icon}</span>
      <div className="attention-alert-body">
        <div className="attention-alert-title">{alert.title}</div>
        <div className="attention-alert-detail">{alert.detail}</div>
      </div>
      <span className={`attention-alert-severity attention-alert-severity--${alert.severity}`}>
        {SEVERITY_LABELS[alert.severity] || alert.severity}
      </span>
      <ActionButton alert={alert} onAction={onAction} />
    </div>
  )
}

export default function AttentionBoard({ alerts = [], onAction }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!Array.isArray(alerts) || alerts.length === 0) return null

  const urgentCount = alerts.filter((a) => a.severity === 'urgent').length
  const warningCount = alerts.filter((a) => a.severity === 'warning').length
  const infoCount = alerts.filter((a) => a.severity === 'info').length

  return (
    <section
      className={`attention-board ${urgentCount > 0 ? 'attention-board--has-urgent' : ''}`}
      aria-label="لوحة انتباه اليوم"
    >
      <div className="attention-board-head">
        <span className="attention-board-icon" aria-hidden="true">🔔</span>
        <div className="attention-board-title-wrap">
          <h3 className="attention-board-title">انتباه اليوم</h3>
          <div className="attention-board-subtitle">
            {urgentCount > 0 ? <span className="attention-count attention-count--urgent">{urgentCount} عاجل</span> : null}
            {warningCount > 0 ? <span className="attention-count attention-count--warning">{warningCount} تنبيه</span> : null}
            {infoCount > 0 ? <span className="attention-count attention-count--info">{infoCount} معلومة</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="attention-board-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          title={collapsed ? 'عرض التنبيهات' : 'إخفاء'}
        >
          {collapsed ? '▼' : '▲'}
        </button>
      </div>

      {!collapsed ? (
        <div className="attention-board-list">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} onAction={onAction} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
