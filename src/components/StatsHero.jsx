import { useCountUp } from '../lib/useCountUp'

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function StatCard({ icon, label, value, tone, money = false, urgent = false }) {
  const animatedValue = useCountUp(value, 650)
  const displayValue = money ? formatCurrency(animatedValue) : Math.round(animatedValue)
  return (
    <article className={`stats-hero-card tone-${tone || 'neutral'}${urgent ? ' tone-urgent' : ''}`}>
      <div className="stats-hero-icon" aria-hidden="true">{icon}</div>
      <div className="stats-hero-body">
        <span className="stats-hero-label">{label}</span>
        <strong className="stats-hero-value">{displayValue}</strong>
      </div>
    </article>
  )
}

export default function StatsHero({
  transferSummary,
  officeSummary,
  issueCount,
  viewerMode = false,
  viewerSettledTotal = null,
}) {
  return (
    <section className="stats-hero">
      <StatCard icon="📋" label="الحوالات" value={transferSummary.total} tone="neutral" />
      <StatCard icon="➤" label="عند الموظف" value={transferSummary.withEmployeeCount} tone="blue" />
      <StatCard icon="⏸" label="مراجعة لاحقة" value={transferSummary.reviewHoldCount} tone="amber" />
      <StatCard icon="⚠" label="مشاكل" value={issueCount} tone="red" urgent={issueCount > 0} />
      <StatCard icon="⏳" label="بانتظار التسوية" value={transferSummary.unsettledCount} tone="amber" />
      {viewerMode ? (
        <>
          <StatCard icon="💰" label="مستحق لك" value={officeSummary.officeCustomerLiability} tone="orange" money />
          <StatCard icon="✓" label="استلمت سابقاً" value={viewerSettledTotal || 0} tone="green" money />
        </>
      ) : (
        <>
          <StatCard icon="💰" label="مستحق للزبائن" value={officeSummary.officeCustomerLiability} tone="orange" money />
          <StatCard icon="🏦" label="عند المحاسب" value={officeSummary.accountantCashOnHand} tone="blue" money />
          <StatCard icon="✨" label="ربح قابل للسحب" value={officeSummary.accountantClaimableProfit} tone="green" money />
        </>
      )}
    </section>
  )
}
