import { getCustomerMonogram, getCustomerTheme } from '../lib/customerTheme'

export default function CustomerBadge({ customer, fallbackName = 'غير معروف', compact = false }) {
  const name = customer?.name || fallbackName
  return (
    <span
      className={`customer-badge${compact ? ' customer-badge--compact' : ''}`}
      style={getCustomerTheme(customer || fallbackName)}
      title={name}
    >
      <span className="customer-badge__mark">{getCustomerMonogram(name)}</span>
      <span className="customer-badge__name">{name}</span>
    </span>
  )
}
